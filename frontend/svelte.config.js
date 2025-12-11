import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Base path for deploying to a subdirectory (e.g., '/igd-demo')
// Set via VITE_BASE_PATH environment variable at build time
const basePath = process.env.VITE_BASE_PATH || '';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		adapter: adapter({
			precompress: false,
			fallback: 'index.html'
		}),
		paths: {
			base: basePath
		}
	}
};

export default config;
