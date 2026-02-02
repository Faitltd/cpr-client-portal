<div class="app-bg">
	<div class="app-content">
		<slot />
	</div>
</div>

<style>
	.app-bg {
		position: relative;
		min-height: 100vh;
		background: url('/images/cpr-logo.png') center/cover no-repeat fixed;
	}

	.app-bg::before {
		content: '';
		position: absolute;
		inset: 0;
		background: rgba(255, 255, 255, 0.78);
	}

	.app-content {
		position: relative;
		z-index: 1;
	}
</style>
