<script lang="ts">
	export let data: { isConfigured: boolean };
	export let form: { message?: string } | undefined;
</script>

<div class="container">
	<header>
		<h1>Admin Login</h1>
		<p>Set or reset client passwords.</p>
	</header>

	{#if !data.isConfigured}
		<div class="notice">
			<p>Admin password is not configured. Add <code>PORTAL_ADMIN_PASSWORD</code> to your .env file.</p>
		</div>
	{:else}
		<form method="POST" class="card">
			<label for="password">Admin Password</label>
			<input id="password" type="password" name="password" />
			<button type="submit">Sign In</button>
			{#if form?.message}
				<p class="message">{form.message}</p>
			{/if}
		</form>
	{/if}
</div>

<style>
	.container {
		max-width: 480px;
		margin: 0 auto;
		padding: 2rem;
	}

	header {
		text-align: center;
		margin-bottom: 2rem;
	}

	.card {
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		padding: 1.5rem;
		background: #fff;
	}

	.notice {
		border: 1px solid #ffd4a3;
		background: #fff7ed;
		padding: 1rem;
		border-radius: 8px;
	}

	label {
		display: block;
		font-weight: 600;
		margin-bottom: 0.5rem;
	}

	input {
		width: 100%;
		padding: 0.75rem;
		border: 1px solid #ccc;
		border-radius: 6px;
		margin-bottom: 1rem;
		min-height: 44px;
	}

	button {
		width: 100%;
		padding: 0.75rem;
		border: none;
		border-radius: 6px;
		background: #0066cc;
		color: white;
		font-weight: 600;
		cursor: pointer;
		min-height: 44px;
	}

	.message {
		margin-top: 1rem;
		color: #b91c1c;
	}

	@media (max-width: 720px) {
		.container {
			padding: 1.5rem 1.25rem;
		}

		.card {
			padding: 1.25rem;
		}
	}
</style>
