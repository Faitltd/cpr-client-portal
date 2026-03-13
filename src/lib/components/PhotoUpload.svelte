<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	export let maxFiles = 5;
	export let existingPhotos: { id: string; url: string; name: string }[] = [];

	const dispatch = createEventDispatcher<{
		change: { id: string; url: string; name: string }[];
	}>();

	type PhotoEntry = {
		id: string;
		url: string;
		name: string;
		file?: File;
		uploading?: boolean;
		progress?: number;
		error?: string;
	};

	let photos: PhotoEntry[] = existingPhotos.map((p) => ({ ...p }));
	let dragOver = false;
	let uploadError = '';
	let fileInput: HTMLInputElement;

	$: photoIds = photos.filter((p) => !p.uploading && !p.error).map((p) => ({ id: p.id, url: p.url, name: p.name }));
	$: canAdd = photos.length < maxFiles;

	function compressImage(file: File, maxDim = 2048, quality = 0.85): Promise<File> {
		return new Promise((resolve) => {
			if (file.size < 500_000) {
				resolve(file);
				return;
			}

			const img = new Image();
			const url = URL.createObjectURL(file);
			img.onload = () => {
				URL.revokeObjectURL(url);
				let { width, height } = img;

				if (width <= maxDim && height <= maxDim && file.size < 2_000_000) {
					resolve(file);
					return;
				}

				if (width > maxDim || height > maxDim) {
					const ratio = Math.min(maxDim / width, maxDim / height);
					width = Math.round(width * ratio);
					height = Math.round(height * ratio);
				}

				const canvas = document.createElement('canvas');
				canvas.width = width;
				canvas.height = height;
				const ctx = canvas.getContext('2d')!;
				ctx.drawImage(img, 0, 0, width, height);

				canvas.toBlob(
					(blob) => {
						if (blob) {
							resolve(new File([blob], file.name, { type: 'image/jpeg' }));
						} else {
							resolve(file);
						}
					},
					'image/jpeg',
					quality
				);
			};
			img.onerror = () => {
				URL.revokeObjectURL(url);
				resolve(file);
			};
			img.src = url;
		});
	}

	async function uploadFiles(files: File[]) {
		uploadError = '';
		const remaining = maxFiles - photos.length;
		const toUpload = files.slice(0, remaining);

		if (files.length > remaining) {
			uploadError = `Only ${remaining} more file${remaining !== 1 ? 's' : ''} allowed.`;
		}

		for (const rawFile of toUpload) {
			if (!rawFile.type.startsWith('image/')) {
				uploadError = `"${rawFile.name}" is not an image.`;
				continue;
			}
			if (rawFile.size > 10 * 1024 * 1024) {
				uploadError = `"${rawFile.name}" exceeds 10MB limit.`;
				continue;
			}

			const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
			const preview = URL.createObjectURL(rawFile);
			const entry: PhotoEntry = {
				id: tempId,
				url: preview,
				name: rawFile.name,
				file: rawFile,
				uploading: true,
				progress: 0
			};
			photos = [...photos, entry];

			try {
				const compressed = await compressImage(rawFile);
				const formData = new FormData();
				formData.append('files', compressed, compressed.name);

				const res = await fetch('/api/trade/photos/upload', {
					method: 'POST',
					body: formData
				});

				if (!res.ok) {
					const payload = await res.json().catch(() => ({}));
					throw new Error(payload?.error || `Upload failed (${res.status})`);
				}

				const payload = await res.json();
				const uploaded = payload?.data?.[0];
				if (!uploaded) throw new Error('No upload data returned');

				URL.revokeObjectURL(preview);
				photos = photos.map((p) =>
					p.id === tempId
						? { id: uploaded.id, url: uploaded.url, name: uploaded.name }
						: p
				);
				dispatch('change', photoIds);
			} catch (err) {
				photos = photos.map((p) =>
					p.id === tempId
						? { ...p, uploading: false, error: err instanceof Error ? err.message : 'Upload failed' }
						: p
				);
			}
		}
	}

	function handleFileSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files) {
			uploadFiles(Array.from(input.files));
			input.value = '';
		}
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		if (e.dataTransfer?.files) {
			uploadFiles(Array.from(e.dataTransfer.files));
		}
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		dragOver = true;
	}

	function handleDragLeave() {
		dragOver = false;
	}

	function removePhoto(id: string) {
		const photo = photos.find((p) => p.id === id);
		if (photo?.file) {
			URL.revokeObjectURL(photo.url);
		}
		photos = photos.filter((p) => p.id !== id);
		dispatch('change', photoIds);
	}

	function retryPhoto(entry: PhotoEntry) {
		if (!entry.file) return;
		removePhoto(entry.id);
		uploadFiles([entry.file]);
	}

	export function getPhotoIds(): string[] {
		return photos.filter((p) => !p.uploading && !p.error).map((p) => p.id);
	}

	export function reset() {
		for (const p of photos) {
			if (p.file) URL.revokeObjectURL(p.url);
		}
		photos = [];
		uploadError = '';
		dispatch('change', []);
	}
</script>

<div class="photo-upload">
	{#if canAdd}
		<!-- svelte-ignore a11y-no-static-element-interactions -->
		<div
			class="drop-zone"
			class:drag-over={dragOver}
			on:drop={handleDrop}
			on:dragover={handleDragOver}
			on:dragleave={handleDragLeave}
			role="button"
			tabindex="0"
			on:click={() => fileInput.click()}
			on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); }}
		>
			<input
				bind:this={fileInput}
				type="file"
				accept="image/*"
				capture="environment"
				multiple
				on:change={handleFileSelect}
				style="display:none"
			/>
			<span class="drop-icon">+</span>
			<span class="drop-text">Tap to add photos</span>
			<span class="drop-hint">or drag & drop (max {maxFiles})</span>
		</div>
	{/if}

	{#if uploadError}
		<p class="upload-error">{uploadError}</p>
	{/if}

	{#if photos.length > 0}
		<div class="photo-previews">
			{#each photos as photo (photo.id)}
				<div class="preview-item" class:has-error={!!photo.error}>
					<img src={photo.url} alt={photo.name} class="preview-img" />
					{#if photo.uploading && !photo.error}
						<div class="upload-overlay">
							<div class="spinner"></div>
						</div>
					{/if}
					{#if photo.error}
						<div class="error-overlay">
							<span class="error-icon">!</span>
							<button class="retry-btn" on:click={() => retryPhoto(photo)} type="button">Retry</button>
						</div>
					{/if}
					<button class="remove-btn" on:click={() => removePhoto(photo.id)} type="button" aria-label="Remove photo">×</button>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.photo-upload {
		display: grid;
		gap: 0.75rem;
	}

	.drop-zone {
		border: 2px dashed #d1d5db;
		border-radius: 8px;
		padding: 1.25rem;
		text-align: center;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		background: #f9fafb;
		transition: border-color 0.15s, background 0.15s;
		min-height: 44px;
	}

	.drop-zone:hover,
	.drop-zone.drag-over {
		border-color: #0066cc;
		background: #eff6ff;
	}

	.drop-icon {
		font-size: 1.5rem;
		font-weight: 700;
		color: #6b7280;
		line-height: 1;
	}

	.drop-text {
		font-size: 0.95rem;
		font-weight: 600;
		color: #374151;
	}

	.drop-hint {
		font-size: 0.8rem;
		color: #9ca3af;
	}

	.upload-error {
		margin: 0;
		color: #b91c1c;
		font-size: 0.85rem;
	}

	.photo-previews {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.preview-item {
		position: relative;
		width: 80px;
		height: 80px;
		border-radius: 8px;
		overflow: hidden;
		border: 1px solid #e5e7eb;
	}

	.preview-item.has-error {
		border-color: #fca5a5;
	}

	.preview-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.upload-overlay {
		position: absolute;
		inset: 0;
		background: rgba(255, 255, 255, 0.7);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.spinner {
		width: 24px;
		height: 24px;
		border: 3px solid #d1d5db;
		border-top-color: #0066cc;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.error-overlay {
		position: absolute;
		inset: 0;
		background: rgba(254, 226, 226, 0.85);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
	}

	.error-icon {
		font-weight: 700;
		color: #b91c1c;
		font-size: 1.1rem;
	}

	.retry-btn {
		font-size: 0.7rem;
		padding: 0.15rem 0.5rem;
		border: 1px solid #b91c1c;
		border-radius: 4px;
		background: #fff;
		color: #b91c1c;
		cursor: pointer;
		font-weight: 600;
	}

	.remove-btn {
		position: absolute;
		top: 2px;
		right: 2px;
		width: 22px;
		height: 22px;
		border: none;
		background: rgba(0, 0, 0, 0.55);
		color: #fff;
		border-radius: 50%;
		font-size: 0.85rem;
		line-height: 1;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
	}

	.remove-btn:hover {
		background: rgba(0, 0, 0, 0.75);
	}
</style>
