<script lang="ts">
	const PDF_URL = '/documents/ultimate-home-building-checklist.pdf';
</script>

<svelte:head>
	<title>Ultimate Home Building Checklist · CPR</title>
</svelte:head>

<div class="viewer">
	<header class="bar">
		<a class="back" href="/dashboard" aria-label="Back to dashboard">
			<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
				<path d="M12 4l-6 6 6 6" />
			</svg>
			<span>Dashboard</span>
		</a>
		<h1>Ultimate Home Building Checklist</h1>
		<a class="download" href={PDF_URL} download>
			<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
				<path d="M10 3v9m0 0l-3.5-3.5M10 12l3.5-3.5M4 15h12" />
			</svg>
			<span>Download</span>
		</a>
	</header>

	<div class="frame">
		<object data={`${PDF_URL}#view=FitH`} type="application/pdf" title="Ultimate Home Building Checklist">
			<iframe src={`${PDF_URL}#view=FitH`} title="Ultimate Home Building Checklist"></iframe>
			<p class="fallback">
				Your browser can't display the checklist inline.
				<a href={PDF_URL} target="_blank" rel="noreferrer noopener">Open the checklist in a new tab</a>.
			</p>
		</object>
	</div>
</div>

<style>
	.viewer {
		position: fixed;
		inset: 0;
		display: flex;
		flex-direction: column;
		background: #f5f5f4;
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem 1rem;
		background: #fff;
		border-bottom: 1px solid #e5e5e4;
		flex: 0 0 auto;
	}

	.bar h1 {
		flex: 1 1 auto;
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		color: #1c1917;
		text-align: center;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.back,
	.download {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.9rem;
		font-weight: 500;
		text-decoration: none;
		color: #44403c;
		padding: 0.4rem 0.7rem;
		border-radius: 8px;
		flex: 0 0 auto;
	}

	.back:hover,
	.download:hover {
		background: #f5f5f4;
	}

	.download {
		border: 1px solid #d6d3d1;
	}

	.frame {
		flex: 1 1 auto;
		min-height: 0;
	}

	.frame :global(object),
	.frame iframe {
		width: 100%;
		height: 100%;
		border: 0;
		display: block;
	}

	.fallback {
		padding: 2rem;
		text-align: center;
		color: #44403c;
	}

	@media (max-width: 560px) {
		.bar h1 {
			font-size: 0.85rem;
		}
		.back span,
		.download span {
			display: none;
		}
	}
</style>
