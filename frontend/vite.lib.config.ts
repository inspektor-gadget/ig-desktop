import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig({
	define: {
		'import.meta.env.VITE_APP_MODE': JSON.stringify(process.env.VITE_APP_MODE || 'full')
	},
	plugins: [
		svelte({
			compilerOptions: {
				// Library components need to work without SvelteKit
				css: 'injected'
			}
		}),
		tailwindcss()
	],
	resolve: {
		alias: {
			$lib: resolve(__dirname, 'src/lib'),
			'$app/paths': resolve(__dirname, 'src/lib/compat/app-paths.ts'),
			'$app/state': resolve(__dirname, 'src/lib/compat/app-state.ts'),
			'$app/environment': resolve(__dirname, 'src/lib/compat/app-environment.ts'),
			'$app/navigation': resolve(__dirname, 'src/lib/compat/app-navigation.ts')
		}
	},
	build: {
		lib: {
			entry: resolve(__dirname, 'src/lib/index.ts'),
			formats: ['es'],
			fileName: 'ig-frontend'
		},
		rollupOptions: {
			external: ['svelte', 'svelte/legacy', 'svelte/store', '@wailsio/runtime']
		},
		outDir: 'dist-lib',
		cssCodeSplit: false // Bundle all CSS into one file
	}
});
