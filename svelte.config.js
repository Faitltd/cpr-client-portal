import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Explicitly preprocess <script lang="ts"> so TypeScript is stripped the same
	// way in every environment. Without this, TS-in-Svelte only works by luck of
	// the installed toolchain version, which breaks on a fresh CI install.
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			out: 'build'
		})
	}
};

export default config;