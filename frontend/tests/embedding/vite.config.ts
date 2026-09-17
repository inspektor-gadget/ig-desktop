import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const reactModules = process.env.IG_REACT_MODULES;

export default defineConfig({
	resolve: {
		conditions: ['browser'],
		dedupe: ['svelte'],
		alias: reactModules
			? {
					react: resolve(reactModules, 'react'),
					'react-dom': resolve(reactModules, 'react-dom'),
					'@fixture/provider': resolve('react/src/IGProvider.tsx'),
					'@fixture/wrapper': resolve('react/src/SvelteWrapper.tsx'),
					'@inspektor-gadget/frontend': resolve('build-embedding/ig-frontend.js')
				}
			: {}
	},
	server: { host: '127.0.0.1', port: 4175, strictPort: true },
	optimizeDeps: {
		entries: reactModules
			? ['tests/embedding/index.html', 'tests/embedding/react.html']
			: ['tests/embedding/index.html'],
		exclude: ['@wailsio/runtime', 'svelte'],
		include: reactModules ? ['react', 'react-dom/client'] : []
	}
});
