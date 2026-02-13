<div class="container">
	<main>
		<section class="hero">
			<img src="/images/cpr-logo.png" alt="Custom Professional Renovations" class="logo-hero" />
			<div class="cta-row">
				<a href="/auth/portal" class="btn-primary">Portal Login</a>
			</div>
		</section>
	</main>
</div>

<style>
	.container {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem;
	}

	.hero {
		text-align: center;
		min-height: calc(100vh - 4rem);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1.5rem;
	}

	.logo-hero {
		width: min(60vw, 630px);
		height: min(50vh, 364px);
		object-fit: contain;
	}

	.cta-row {
		display: flex;
		justify-content: center;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.btn-primary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 1rem 2rem;
		background: #0066cc;
		color: white;
		text-decoration: none;
		border-radius: 4px;
		font-weight: 600;
		min-height: 44px;
		box-sizing: border-box;
	}

	.btn-primary:hover {
		background: #0052a3;
	}

	.btn-secondary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 1rem 2rem;
		background: #f5f5f5;
		color: #1a1a1a;
		text-decoration: none;
		border-radius: 4px;
		font-weight: 600;
		border: 1px solid #d0d0d0;
		min-height: 44px;
		box-sizing: border-box;
	}

	.btn-secondary:hover {
		background: #e9e9e9;
	}

	@media (max-width: 720px) {
		.container {
			padding: 1.5rem 1.25rem;
		}

		.hero {
			min-height: auto;
			padding: 2rem 0 3rem;
		}

		.cta-row {
			flex-direction: column;
			width: 100%;
			align-items: center;
		}

		.btn-primary,
		.btn-secondary {
			width: min(100%, 18rem);
			padding: 0.75rem 1.25rem;
			font-size: 0.95rem;
		}
	}
</style>
