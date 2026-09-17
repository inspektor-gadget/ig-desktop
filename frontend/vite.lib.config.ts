import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { cpSync, mkdirSync } from 'fs';

/** Copy theme CSS files to dist-lib/themes/ after build. */
function copyThemes(): Plugin {
	let outDir = 'dist-lib';
	return {
		name: 'copy-themes',
		configResolved(config) {
			outDir = resolve(config.root, config.build.outDir);
		},
		writeBundle() {
			const src = resolve(__dirname, 'src/lib/themes');
			const dest = resolve(outDir, 'themes');
			mkdirSync(dest, { recursive: true });
			cpSync(src, dest, { recursive: true, filter: (s) => s.endsWith('.css') || !s.includes('.') });
		}
	};
}

export default defineConfig({
	base: './',
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
		tailwindcss(),
		copyThemes()
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
			external: [/^svelte(\/.*)?$/, '@wailsio/runtime']
		},
		outDir: 'dist-lib',
		cssCodeSplit: false // Bundle all CSS into one file
	}
});
