<script lang="ts">
	export let data: { email: string };

	let password = '';
	let confirm = '';
	let message = '';
	let loading = false;

	const submit = async () => {
		message = '';
		if (password.length < 8) {
			message = 'Password must be at least 8 characters.';
			return;
		}
		if (password !== confirm) {
			message = 'Passwords do not match.';
			return;
		}

		loading = true;
		try {
			const res = await fetch('/account/password', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ password })
			});
			const payload = await res.json().catch(() => ({}));
			if (res.ok) {
				message = payload.message || 'Password updated.';
				password = '';
				confirm = '';
			} else {
				message = payload.message || 'Unable to update password.';
			}
		} catch {
			message = 'Unable to update password.';
		} finally {
			loading = false;
		}
	};
</script>

<div class="container">
	<header>
		<h1>Account</h1>
		<p>Signed in as {data.email}</p>
	</header>

	<div class="card">
		<h2>Set Password</h2>
		<label for="password">New Password</label>
		<input id="password" type="password" bind:value={password} />

		<label for="confirm">Confirm Password</label>
		<input id="confirm" type="password" bind:value={confirm} />

		<button on:click={submit} disabled={loading || !password || !confirm}>Update Password</button>
		{#if message}
			<p class="message">{message}</p>
		{/if}
	</div>

	<a class="back" href="/dashboard">← Back to Dashboard</a>
</div>

<style>
	.container {
		max-width: 540px;
		margin: 0 auto;
		padding: 2rem;
	}

	header {
		margin-bottom: 1.5rem;
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
		margin: 1rem 0 0.5rem;
	}

	input {
		width: 100%;
		padding: 0.75rem;
		border: 1px solid #ccc;
		border-radius: 6px;
	}

	button {
		width: 100%;
		margin-top: 1.25rem;
		padding: 0.75rem;
		border: none;
		border-radius: 6px;
		background: #0066cc;
		color: white;
		font-weight: 600;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.message {
		margin-top: 1rem;
		color: #333;
	}

	.back {
		display: inline-block;
		margin-top: 1.5rem;
		color: #0066cc;
		text-decoration: none;
	}
</style>
