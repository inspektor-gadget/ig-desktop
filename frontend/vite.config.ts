import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
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
	plugins: [sveltekit(), tailwindcss()]
});
