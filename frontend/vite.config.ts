import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
	define: {
		'import.meta.env.VITE_APP_MODE': JSON.stringify(process.env.VITE_APP_MODE || 'full')
	},
	server: {
		host: '0.0.0.0',
		proxy: {
			'/api': 'http://127.0.0.1:8087',
			'/api/v1/ws': {
				target: 'ws://127.0.0.1:9080',
				ws: true,
				rewriteWsOrigin: true
			}
		}
	},
	plugins: [
		sveltekit({
			preprocess: vitePreprocess(),
			adapter: adapter({
				precompress: false,
				fallback: 'index.html'
			}),
			paths: {
				base: (process.env.VITE_BASE_PATH || '') as '' | `/${string}`
			}
		}),
		tailwindcss()
	]
});
