<script lang="ts">
	export let data;
</script>

<div class="container">
	<header>
		<h1>CPR Client Portal</h1>
		<p>Welcome to Custom Professional Renovations</p>
	</header>

	<main>
		<section class="hero">
			<h2>Access Your Project</h2>
			<p>View project status, documents, and communicate with your team.</p>
			<a href="/auth/login" class="btn-primary">Client Login</a>
		</section>

		<section class="features">
			<div class="feature">
				<h3>Project Dashboard</h3>
				<p>Real-time updates on your renovation progress</p>
			</div>
			<div class="feature">
				<h3>Documents</h3>
				<p>Access contracts, invoices, and project photos</p>
			</div>
			<div class="feature">
				<h3>Communication</h3>
				<p>Direct messaging with your project manager</p>
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

	header {
		text-align: center;
		margin-bottom: 3rem;
	}

	h1 {
		font-size: 2.5rem;
		color: #1a1a1a;
		margin-bottom: 0.5rem;
	}

	.hero {
		text-align: center;
		padding: 3rem 0;
		margin-bottom: 3rem;
		background: #f5f5f5;
		border-radius: 8px;
	}

	.btn-primary {
		display: inline-block;
		padding: 1rem 2rem;
		background: #0066cc;
		color: white;
		text-decoration: none;
		border-radius: 4px;
		font-weight: 600;
		margin-top: 1rem;
	}

	.btn-primary:hover {
		background: #0052a3;
	}

	.features {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
		gap: 2rem;
	}

	.feature {
		padding: 2rem;
		border: 1px solid #ddd;
		border-radius: 8px;
	}

	.feature h3 {
		margin-bottom: 0.5rem;
		color: #0066cc;
	}
</style>