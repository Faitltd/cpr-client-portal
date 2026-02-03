<script lang="ts">
	export let data: { tradePartner: { name?: string | null; email: string } };
</script>

<div class="dashboard">
	<header>
		<h1>Trade Partner Dashboard</h1>
		<p>Welcome {data.tradePartner.name || data.tradePartner.email}</p>
	</header>

	<div class="card">
		<p>We will add schedules, work orders, and documents here next.</p>
	</div>
</div>

<style>
	.dashboard {
		max-width: 900px;
		margin: 0 auto;
		padding: 2rem;
	}

	header {
		margin-bottom: 2rem;
	}

	.card {
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		padding: 1.5rem;
		background: #fff;
	}
</style>
