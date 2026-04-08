<script lang="ts">
	import { page } from '$app/stores';

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

		if (!nextPassword) {
			message = 'Password is required.';
			return;
		}

		loading = true;
		try {
			const res = await fetch('/auth/portal/password', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: nextEmail, password: nextPassword })
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

	$: serverMessage =
		$page.url.searchParams.get('error') === 'inactive'
			? 'Your portal access is not active yet.'
			: $page.url.searchParams.get('error') === 'invalid'
				? 'Invalid email or password.'
				: '';
</script>

<div class="container">
	<main>
		<img src="/images/cpr-logo.png" alt="Custom Professional Renovations" class="logo" />

		<form
			class="card"
			method="post"
			action="/auth/portal/password"
			on:submit|preventDefault={submitPassword}
		>
			<p class="hint">Use your email as the username. New client passwords default to the client phone number.</p>

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
			{#if message || serverMessage}
				<p class="message">{message || serverMessage}</p>
			{/if}
		</form>
	</main>
</div>

<style>
	.container {
		max-width: 480px;
		margin: 0 auto;
		padding: 2rem;
	}

	main {
		min-height: calc(100vh - 4rem);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1.5rem;
	}

	.logo {
		width: min(60vw, 360px);
		height: auto;
		object-fit: contain;
	}

	.card {
		width: 100%;
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		padding: 1.5rem;
		background: #fff;
	}

	.hint {
		text-align: center;
		color: #666;
		font-size: 0.9rem;
		margin-bottom: 1.25rem;
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

		main {
			min-height: auto;
			padding: 2rem 0 3rem;
		}

		.card {
			padding: 1.25rem;
		}
	}
</style>
