import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		// Don't watch nested git worktrees or scratch directories — they
		// recursively contain the entire repo and overwhelm Node's file scanner.
		watch: {
			ignored: ['**/.claude/**', '**/.git/**', '**/node_modules/**', '**/.svelte-kit/**']
		},
		fs: {
			strict: false
		}
	}
});
