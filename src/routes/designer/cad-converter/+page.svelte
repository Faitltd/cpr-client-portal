<script lang="ts">
	import type { PageData } from './$types';

	export let data: PageData;

	type State = 'idle' | 'selected' | 'converting' | 'done' | 'error';

	let state: State = 'idle';
	let dragging = false;
	let file: File | null = null;
	let errorMessage = '';
	let errorRef = '';
	let downloadUrl = '';
	let downloadName = '';
	let showHelp = false;
	let fileInput: HTMLInputElement;

	function reset() {
		if (downloadUrl) URL.revokeObjectURL(downloadUrl);
		downloadUrl = '';
		downloadName = '';
		file = null;
		errorMessage = '';
		errorRef = '';
		state = 'idle';
		if (fileInput) fileInput.value = '';
	}

	function accept(candidate: File | null | undefined) {
		if (!candidate) return;
		if (!/\.dwg$/i.test(candidate.name)) {
			file = null;
			errorMessage = 'Please upload a DWG file exported from ProKitchen.';
			errorRef = '';
			state = 'error';
			return;
		}
		file = candidate;
		errorMessage = '';
		errorRef = '';
		state = 'selected';
	}

	function onDrop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		accept(event.dataTransfer?.files?.[0]);
	}

	function onDragOver(event: DragEvent) {
		event.preventDefault();
		dragging = true;
	}

	function onDragLeave() {
		dragging = false;
	}

	function onPick(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		accept(input.files?.[0]);
	}

	function fileNameFromDisposition(header: string | null, fallback: string): string {
		if (header) {
			const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
			if (utf8) {
				try {
					return decodeURIComponent(utf8[1]);
				} catch {
					/* fall through */
				}
			}
			const plain = /filename="([^"]+)"/i.exec(header);
			if (plain) return plain[1];
		}
		return fallback;
	}

	async function convert() {
		if (!file) return;
		state = 'converting';
		errorMessage = '';
		errorRef = '';

		const body = new FormData();
		body.append('file', file);

		try {
			const res = await fetch('/api/designer/cad-convert', { method: 'POST', body });

			if (!res.ok) {
				let message = 'The converter encountered an unexpected error. No file was saved.';
				let ref = res.headers.get('x-job-id') ?? '';
				try {
					const payload = await res.json();
					if (payload?.message) message = payload.message;
					if (payload?.jobId) ref = payload.jobId;
				} catch {
					/* non-JSON error body */
				}
				errorMessage = message;
				errorRef = ref;
				state = 'error';
				return;
			}

			const blob = await res.blob();
			const fallback = `${file.name.replace(/\.dwg$/i, '')}.dxf`;
			downloadName = fileNameFromDisposition(res.headers.get('content-disposition'), fallback);
			downloadUrl = URL.createObjectURL(blob);
			state = 'done';
		} catch {
			errorMessage = 'The converter could not be reached. Check your connection and try again.';
			errorRef = '';
			state = 'error';
		}
	}
</script>

<svelte:head>
	<title>ProKitchen to Chief Architect Converter · CPR Portal</title>
</svelte:head>

<section class="converter">
	<header class="intro">
		<h1>ProKitchen → Chief Architect</h1>
		<p>Convert a ProKitchen DWG into a Chief Architect-compatible DXF.</p>
	</header>

	{#if state === 'done'}
		<div class="panel success">
			<p class="headline">Conversion complete</p>
			<a class="primary" href={downloadUrl} download={downloadName}>Download {downloadName}</a>
			<p class="fine">Your uploaded files are not stored after conversion.</p>
			<button class="secondary" type="button" on:click={reset}>Convert Another File</button>
		</div>
	{:else}
		<!-- svelte-ignore a11y-no-static-element-interactions -->
		<div
			class="dropzone"
			class:dragging
			class:busy={state === 'converting'}
			on:drop={onDrop}
			on:dragover={onDragOver}
			on:dragleave={onDragLeave}
		>
			{#if state === 'converting'}
				<p class="headline">Converting file…</p>
				<p class="fine">{file?.name}</p>
			{:else if file}
				<p class="headline">{file.name}</p>
				<button class="primary" type="button" on:click={convert}>Convert to DXF</button>
				<button class="link" type="button" on:click={reset}>Choose a different file</button>
			{:else}
				<p class="headline">Drop DWG file here</p>
				<p class="fine">or</p>
				<button class="primary" type="button" on:click={() => fileInput.click()}
					>Choose DWG File</button
				>
				<p class="fine">Supported file: .dwg (up to {data.maxUploadMb} MB)</p>
			{/if}

			<input
				bind:this={fileInput}
				class="hidden-input"
				type="file"
				accept=".dwg"
				on:change={onPick}
			/>
		</div>
	{/if}

	{#if state === 'error'}
		<div class="panel error">
			<p>{errorMessage}</p>
			{#if errorRef}<p class="fine">Reference: {errorRef}</p>{/if}
			<button class="secondary" type="button" on:click={reset}>Start Over</button>
		</div>
	{/if}

	<details class="help" bind:open={showHelp}>
		<summary>How do I use this in Chief Architect?</summary>
		<ol>
			<li>Download the generated .dxf file.</li>
			<li>Open the Chief Architect plan you want to import into.</li>
			<li>Select File → Import → Import Drawing (DWG, DXF).</li>
			<li>Check a known dimension after import — an island width, for example.</li>
		</ol>
		<p class="fine">
			The result is an import-ready DXF drawing, not a Chief Architect plan. Cabinets, walls, and
			appliances come in as CAD linework.
		</p>
	</details>
</section>

<style>
	.converter {
		max-width: 680px;
		margin: 0 auto;
	}

	.intro {
		text-align: center;
		margin-bottom: 1.5rem;
	}

	.intro h1 {
		font-size: 1.5rem;
		margin: 0 0 0.35rem;
		color: #0f172a;
	}

	.intro p {
		margin: 0;
		color: #475569;
		font-size: 0.95rem;
	}

	.dropzone {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		border: 2px dashed #cbd5e1;
		border-radius: 12px;
		background: #ffffff;
		padding: 3rem 1.5rem;
		text-align: center;
		transition: border-color 0.15s ease, background 0.15s ease;
	}

	.dropzone.dragging {
		border-color: #111827;
		background: #f1f5f9;
	}

	.dropzone.busy {
		opacity: 0.75;
	}

	.panel {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		border-radius: 12px;
		padding: 2rem 1.5rem;
		text-align: center;
		margin-bottom: 1rem;
	}

	.panel.success {
		border: 1px solid #bbf7d0;
		background: #f0fdf4;
	}

	.panel.error {
		border: 1px solid #fecaca;
		background: #fef2f2;
		color: #991b1b;
		margin-top: 1rem;
	}

	.headline {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 600;
		color: #0f172a;
	}

	.fine {
		margin: 0;
		font-size: 0.85rem;
		color: #64748b;
	}

	.primary {
		display: inline-block;
		padding: 0.65rem 1.4rem;
		border-radius: 8px;
		border: 1px solid #111827;
		background: #111827;
		color: #ffffff;
		font-weight: 600;
		font-size: 0.95rem;
		text-decoration: none;
		cursor: pointer;
	}

	.primary:hover {
		background: #1f2937;
	}

	.secondary {
		padding: 0.5rem 1.1rem;
		border-radius: 8px;
		border: 1px solid #cbd5e1;
		background: #ffffff;
		color: #334155;
		font-weight: 600;
		font-size: 0.9rem;
		cursor: pointer;
	}

	.link {
		border: none;
		background: none;
		color: #475569;
		font-size: 0.85rem;
		text-decoration: underline;
		cursor: pointer;
	}

	.hidden-input {
		display: none;
	}

	.help {
		margin-top: 1.5rem;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		background: #ffffff;
		padding: 0.85rem 1rem;
	}

	.help summary {
		cursor: pointer;
		font-weight: 600;
		font-size: 0.9rem;
		color: #334155;
	}

	.help ol {
		margin: 0.75rem 0 0.5rem;
		padding-left: 1.2rem;
		color: #334155;
		font-size: 0.9rem;
		line-height: 1.6;
	}
</style>
