<script lang="ts">
	export let data: {
		entries: {
			id: string;
			cache_key: string;
			updated_at: string | null;
			stale_at: string | null;
			status: 'fresh' | 'stale';
			dataSize: number;
		}[];
		totalCount: number;
		staleCount: number;
		freshCount: number;
	};

	const formatDate = (value: string | null) => {
		if (!value) return '—';
		const parsed = new Date(value);
		return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
	};

	function confirmClearAll(event: Event) {
		if (!confirm('Clear all cached API responses?')) {
			event.preventDefault();
		}
	}
</script>

<div class="cache-admin">
	<header>
		<div>
			<h1>API Response Cache</h1>
			<p>
				Total entries: <strong>{data.totalCount}</strong>
				<span class="separator">•</span>
				Fresh: <strong>{data.freshCount}</strong>
				<span class="separator">•</span>
				Stale: <strong>{data.staleCount}</strong>
			</p>
		</div>
		<div class="actions">
			<form method="POST" action="?/clearStale">
				<button type="submit" class="btn">Clear Stale</button>
			</form>
			<form method="POST" action="?/clearAll" on:submit={confirmClearAll}>
				<button type="submit" class="btn btn-danger">Clear All</button>
			</form>
			<form method="POST" action="?/clearPattern" class="pattern-form">
				<input
					class="input"
					type="text"
					name="pattern"
					placeholder="project:% or sign-requests:%"
				/>
				<button type="submit" class="btn btn-small">Clear</button>
			</form>
		</div>
	</header>

	{#if data.entries.length === 0}
		<div class="empty">No cached API responses.</div>
	{:else}
		<div class="panel">
			<table>
				<thead>
					<tr>
						<th>Cache Key</th>
						<th>Status</th>
						<th>Data Size</th>
						<th>Updated At</th>
						<th>Stale At</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each data.entries as entry}
						<tr>
							<td class="mono">{entry.cache_key}</td>
							<td>
								{#if entry.status === 'fresh'}
									<span class="badge fresh">Fresh</span>
								{:else}
									<span class="badge stale">Stale</span>
								{/if}
							</td>
							<td>{entry.dataSize.toFixed(1)} KB</td>
							<td>{formatDate(entry.updated_at)}</td>
							<td>{formatDate(entry.stale_at)}</td>
							<td>
								<form method="POST" action="?/clearOne">
									<input type="hidden" name="cacheKey" value={entry.cache_key} />
									<button type="submit" class="btn btn-small">Clear</button>
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<style>
	.cache-admin {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem;
	}

	header {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 1.5rem;
	}

	header h1 {
		margin: 0 0 0.4rem;
	}

	header p {
		margin: 0;
		color: #4b5563;
	}

	.separator {
		margin: 0 0.35rem;
	}

	.actions {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
		align-items: center;
	}

	.pattern-form {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.input {
		border: 1px solid #d1d5db;
		border-radius: 999px;
		padding: 0.45rem 0.9rem;
		font-size: 0.9rem;
		min-height: 40px;
		min-width: 220px;
	}

	.panel {
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		background: #fff;
		padding: 1rem;
		overflow-x: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.93rem;
	}

	th,
	td {
		text-align: left;
		padding: 0.65rem 0.75rem;
		border-bottom: 1px solid #e5e7eb;
		vertical-align: top;
	}

	th {
		font-weight: 600;
		color: #111827;
		white-space: nowrap;
	}

	tbody tr:last-child td {
		border-bottom: none;
	}

	.mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
			'Courier New', monospace;
		font-size: 0.88rem;
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

	.btn-small {
		padding: 0.35rem 0.85rem;
		min-height: 36px;
		font-size: 0.85rem;
	}

	.btn-danger {
		border-color: #fca5a5;
		color: #b91c1c;
	}

	.badge {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		background: #eef2ff;
		color: #3730a3;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.badge.fresh {
		background: #dcfce7;
		color: #166534;
	}

	.badge.stale {
		background: #fef3c7;
		color: #92400e;
	}

	.empty {
		border: 1px dashed #d1d5db;
		border-radius: 12px;
		padding: 1.5rem;
		text-align: center;
		color: #6b7280;
		background: #fff;
	}

	@media (max-width: 720px) {
		.cache-admin {
			padding: 1.5rem 1.25rem;
		}

		.actions {
			width: 100%;
			justify-content: flex-start;
		}

		.input {
			min-width: 180px;
		}
	}
</style>
