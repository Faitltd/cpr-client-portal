<script lang="ts">
	let email = '';
	let password = '';
	let message = '';
	let loading = false;

	const submitPassword = async () => {
		message = '';
		loading = true;
		try {
			const res = await fetch('/auth/portal/password', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, password })
			});
			const data = await res.json().catch(() => ({}));
			if (res.ok) {
				window.location.href = data.redirect || '/dashboard';
				return;
			}
			message = data.message || 'Unable to sign in.';
		} catch {
			message = 'Unable to sign in.';
		} finally {
			loading = false;
		}
	};
</script>

<div class="container">
	<header>
		<h1>Portal Login</h1>
		<p>Sign in with your password.</p>
	</header>

	<div class="card">
		<label for="email">Email</label>
		<input id="email" type="email" bind:value={email} placeholder="you@example.com" />

		<label for="password">Password</label>
		<input id="password" type="password" bind:value={password} placeholder="••••••••" />

		<button on:click={submitPassword} disabled={loading || !password}>Sign In</button>
		{#if message}
			<p class="message">{message}</p>
		{/if}
	</div>
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

	button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
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
