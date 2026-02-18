<script lang="ts">
	let diagnostics = $state<{ loading: boolean; data: any; error: string }>({
		loading: false, data: null, error: ''
	});
	let audit = $state<{ loading: boolean; data: any; error: string }>({
		loading: false, data: null, error: ''
	});
	let portals = $state<{ loading: boolean; data: any; error: string }>({
		loading: false, data: null, error: ''
	});
	let photosDiagnostics = $state<{ loading: boolean; data: any; error: string }>({
		loading: false, data: null, error: ''
	});
	let photosDealId = $state('');

	let copiedKey = $state('');

	async function fetchEndpoint(
		key: 'diagnostics' | 'audit' | 'portals',
		stateRef: { loading: boolean; data: any; error: string }
	) {
		stateRef.loading = true;
		stateRef.data = null;
		stateRef.error = '';
		try {
			const res = await fetch(`/api/zprojects/${key}`);
			if (!res.ok) {
				const text = await res.text().catch(() => '');
				throw new Error(`${res.status} ${res.statusText}${text ? ': ' + text : ''}`);
			}
			stateRef.data = await res.json();
		} catch (err) {
			stateRef.error = err instanceof Error ? err.message : 'Unknown error';
		} finally {
			stateRef.loading = false;
		}
	}

	async function fetchPhotosDiagnostics() {
		photosDiagnostics.loading = true;
		photosDiagnostics.data = null;
		photosDiagnostics.error = '';
		try {
			const dealId = photosDealId.trim();
			if (!dealId) throw new Error('Enter a deal ID');
			const res = await fetch(`/api/zprojects/photos-diagnostics?dealId=${encodeURIComponent(dealId)}`);
			if (!res.ok) {
				const text = await res.text().catch(() => '');
				throw new Error(`${res.status} ${res.statusText}${text ? ': ' + text : ''}`);
			}
			photosDiagnostics.data = await res.json();
		} catch (err) {
			photosDiagnostics.error = err instanceof Error ? err.message : 'Unknown error';
		} finally {
			photosDiagnostics.loading = false;
		}
	}

	function copyJson(key: string, data: any) {
		try {
			navigator.clipboard.writeText(JSON.stringify(data, null, 2));
			copiedKey = key;
			setTimeout(() => { if (copiedKey === key) copiedKey = ''; }, 2000);
		} catch { /* clipboard not available */ }
	}

	function loadDiagnostics() { fetchEndpoint('diagnostics', diagnostics); }
	function loadAudit() { fetchEndpoint('audit', audit); }
	function loadPortals() { fetchEndpoint('portals', portals); }
	function loadPhotosDiagnostics() { fetchPhotosDiagnostics(); }
</script>

<div class="zp-admin">
	<header>
		<h1>Zoho Projects Diagnostics</h1>
		<p>Admin tools for Zoho Projects integration health, mapping audit, and portal discovery.</p>
	</header>

	<section class="panel">
		<div class="panel-header">
			<h2>Diagnostics</h2>
			<div class="panel-actions">
				<button class="btn" on:click={loadDiagnostics} disabled={diagnostics.loading}>
					{diagnostics.loading ? 'Loading…' : 'Fetch'}
				</button>
				{#if diagnostics.data}
					<button class="btn btn-copy" on:click={() => copyJson('diagnostics', diagnostics.data)}>
						{copiedKey === 'diagnostics' ? 'Copied!' : 'Copy JSON'}
					</button>
				{/if}
			</div>
		</div>
		<p class="panel-desc">Scope info, candidate field names, related lists, sample deals, and mapping preview.</p>
		{#if diagnostics.error}
			<div class="panel-error">{diagnostics.error}</div>
		{/if}
		{#if diagnostics.data}
			<pre class="panel-json">{JSON.stringify(diagnostics.data, null, 2)}</pre>
		{/if}
	</section>

	<section class="panel">
		<div class="panel-header">
			<h2>Photos Diagnostics</h2>
			<div class="panel-actions">
				<input class="deal-input" type="text" bind:value={photosDealId} placeholder="Deal ID" />
				<button class="btn" on:click={loadPhotosDiagnostics} disabled={photosDiagnostics.loading}>
					{photosDiagnostics.loading ? 'Loading…' : 'Fetch'}
				</button>
				{#if photosDiagnostics.data}
					<button class="btn btn-copy" on:click={() => copyJson('photosDiagnostics', photosDiagnostics.data)}>
						{copiedKey === 'photosDiagnostics' ? 'Copied!' : 'Copy JSON'}
					</button>
				{/if}
			</div>
		</div>
		<p class="panel-desc">
			Inspect progress-photo field values, parsed ID references, URL probes, and recommended durable source.
		</p>
		{#if photosDiagnostics.error}
			<div class="panel-error">{photosDiagnostics.error}</div>
		{/if}
		{#if photosDiagnostics.data}
			<pre class="panel-json">{JSON.stringify(photosDiagnostics.data, null, 2)}</pre>
		{/if}
	</section>

	<section class="panel">
		<div class="panel-header">
			<h2>Mapping Audit</h2>
			<div class="panel-actions">
				<button class="btn" on:click={loadAudit} disabled={audit.loading}>
					{audit.loading ? 'Loading…' : 'Fetch'}
				</button>
				{#if audit.data}
					<button class="btn btn-copy" on:click={() => copyJson('audit', audit.data)}>
						{copiedKey === 'audit' ? 'Copied!' : 'Copy JSON'}
					</button>
				{/if}
			</div>
		</div>
		<p class="panel-desc">Mapping audit summary across active deals with project resolve checks.</p>
		{#if audit.error}
			<div class="panel-error">{audit.error}</div>
		{/if}
		{#if audit.data}
			<pre class="panel-json">{JSON.stringify(audit.data, null, 2)}</pre>
		{/if}
	</section>

	<section class="panel">
		<div class="panel-header">
			<h2>Portal Discovery</h2>
			<div class="panel-actions">
				<button class="btn" on:click={loadPortals} disabled={portals.loading}>
					{portals.loading ? 'Loading…' : 'Fetch'}
				</button>
				{#if portals.data}
					<button class="btn btn-copy" on:click={() => copyJson('portals', portals.data)}>
						{copiedKey === 'portals' ? 'Copied!' : 'Copy JSON'}
					</button>
				{/if}
			</div>
		</div>
		<p class="panel-desc">Portals payload for ZOHO_PROJECTS_PORTAL_ID environment setup.</p>
		{#if portals.error}
			<div class="panel-error">{portals.error}</div>
		{/if}
		{#if portals.data}
			<pre class="panel-json">{JSON.stringify(portals.data, null, 2)}</pre>
		{/if}
	</section>
</div>

<style>
	.zp-admin {
		max-width: 1000px;
		margin: 0 auto;
		padding: 2rem;
	}

	header {
		margin-bottom: 2rem;
	}

	h1 {
		margin: 0 0 0.5rem;
	}

	header p {
		margin: 0;
		color: #4b5563;
	}

	.panel {
		margin-bottom: 2rem;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		background: #fff;
		padding: 1.25rem;
	}

	.panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.panel-header h2 {
		margin: 0;
	}

	.panel-actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		align-items: center;
	}

	.deal-input {
		min-width: 220px;
		padding: 0.5rem 0.75rem;
		border: 1px solid #d1d5db;
		border-radius: 999px;
		font-size: 0.93rem;
		min-height: 40px;
	}

	.panel-desc {
		margin: 0.5rem 0 0;
		color: #6b7280;
		font-size: 0.93rem;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.5rem 1rem;
		border: 1px solid #d0d0d0;
		border-radius: 999px;
		background: #fff;
		color: #1a1a1a;
		min-height: 40px;
		cursor: pointer;
		font-size: 0.93rem;
	}

	.btn:hover {
		background: #f3f4f6;
	}

	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-copy {
		border-color: #a5b4fc;
		color: #4338ca;
	}

	.panel-error {
		margin-top: 0.75rem;
		padding: 0.75rem 1rem;
		border: 1px solid #fecaca;
		background: #fff5f5;
		border-radius: 8px;
		color: #b91c1c;
		font-size: 0.93rem;
	}

	.panel-json {
		margin: 0.75rem 0 0;
		padding: 1rem;
		background: #f8fafc;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		overflow-x: auto;
		font-size: 0.85rem;
		line-height: 1.5;
		max-height: 500px;
		overflow-y: auto;
		white-space: pre-wrap;
		word-break: break-word;
	}

	@media (max-width: 720px) {
		.zp-admin {
			padding: 1.5rem 1.25rem;
		}
	}
</style>
