<script lang="ts">
	let email = '';
	let password = '';
	let message = '';
	let loading = false;

	let emailInput: HTMLInputElement | null = null;
	let passwordInput: HTMLInputElement | null = null;

	const submitPassword = async () => {
		message = '';
		const nextEmail = (emailInput?.value ?? email).trim();
		const nextPassword = passwordInput?.value ?? password;
		email = nextEmail;
		password = nextPassword;

		if (!nextEmail || !nextPassword) {
			message = 'Email and password are required.';
			return;
		}

		loading = true;
		try {
			const res = await fetch('/auth/trade/password', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: nextEmail, password: nextPassword })
			});
			const data = await res.json().catch(() => ({}));
			if (res.ok) {
				window.location.href = '/trade/dashboard';
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
		<h1>Trade Partner Login</h1>
		<p>Sign in with your password.</p>
	</header>

	<form class="card" on:submit|preventDefault={submitPassword}>
		<label for="email">Email</label>
		<input
			id="email"
			name="email"
			type="email"
			bind:this={emailInput}
			bind:value={email}
			placeholder="you@example.com"
			autocomplete="username"
			autocapitalize="none"
			spellcheck="false"
		/>

		<label for="password">Password</label>
		<input
			id="password"
			name="password"
			type="password"
			bind:this={passwordInput}
			bind:value={password}
			placeholder="••••••••"
			autocomplete="current-password"
		/>

		<button type="submit" disabled={loading}>Sign In</button>
		{#if message}
			<p class="message">{message}</p>
		{/if}
	</form>
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
