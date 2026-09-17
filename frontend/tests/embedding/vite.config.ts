import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const reactModules = process.env.IG_REACT_MODULES;
const svelteModules = process.env.IG_SVELTE_MODULES;
const runtimeAliases: Array<[string, string]> = [];
if (svelteModules) {
	const exports: Record<string, string | { browser?: string; default?: string }> = JSON.parse(
		readFileSync(resolve(svelteModules, 'svelte/package.json'), 'utf8')
	).exports;
	for (const [subpath, entry] of Object.entries(exports)) {
		const file = typeof entry === 'string' ? entry : (entry.browser ?? entry.default);
		if (file)
			runtimeAliases.push([
				subpath === '.' ? 'svelte' : `svelte${subpath.slice(1)}`,
				resolve(svelteModules, 'svelte', file)
			]);
	}
	runtimeAliases.sort(([left], [right]) => right.length - left.length);
}

export default defineConfig({
	resolve: {
		conditions: ['browser'],
		dedupe: ['svelte'],
		alias: {
			...Object.fromEntries(runtimeAliases),
			...(reactModules
				? {
						react: resolve(reactModules, 'react'),
						'react-dom': resolve(reactModules, 'react-dom'),
						'@fixture/provider': resolve('react/src/IGProvider.tsx'),
						'@fixture/wrapper': resolve('react/src/SvelteWrapper.tsx'),
						'@inspektor-gadget/frontend': resolve('build-embedding/ig-frontend.js')
					}
				: {})
		}
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
