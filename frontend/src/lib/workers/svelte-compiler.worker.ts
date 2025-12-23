/**
 * Web Worker for compiling Svelte 5 plugin bundles at runtime.
 *
 * This worker handles the CPU-intensive compilation process off the main thread.
 * It uses the svelte/compiler package to transform Svelte source code into
 * executable JavaScript.
 *
 * Sandboxed plugins (gadget-provided) have restricted imports for security.
 */

import { compile } from 'svelte/compiler';
import type {
	PluginCompileRequest,
	PluginCompileResponse,
	CompiledFile
} from '$lib/types/plugin';

/**
 * Allowed imports for sandboxed (gadget) plugins.
 * These are safe libraries that don't provide system access.
 */
const SANDBOXED_ALLOWED_IMPORTS = [
	// Svelte runtime (handled separately)
	'svelte',
	'svelte/internal',
	'svelte/internal/client',
	'svelte/internal/disclose-version',
	'svelte/store',
	'svelte/motion',
	'svelte/transition',
	'svelte/animate',
	'svelte/easing',

	// D3 visualization libraries (safe, no DOM manipulation beyond SVG)
	'd3-scale',
	'd3-array',
	'd3-shape',
	'd3-format',
	'd3-time',
	'd3-time-format',
	'd3-interpolate',
	'd3-color',
	'd3-path',

	// Local imports (relative paths)
	'./',
	'../'
];

/**
 * Check if an import is allowed for sandboxed plugins.
 */
function isImportAllowed(importPath: string, sandboxed: boolean): boolean {
	if (!sandboxed) return true;

	// Allow relative imports (local files within the plugin)
	if (importPath.startsWith('./') || importPath.startsWith('../')) {
		return true;
	}

	// Check against allowlist
	return SANDBOXED_ALLOWED_IMPORTS.some(
		(allowed) => importPath === allowed || importPath.startsWith(allowed + '/')
	);
}

/**
 * Extract all imports from source code and validate them.
 * Returns array of disallowed imports, or empty array if all are valid.
 */
function validateImports(source: string, sandboxed: boolean): string[] {
	if (!sandboxed) return [];

	const disallowed: string[] = [];

	// Match all import statements
	const importRegex = /import\s+(?:[^'"]*\s+from\s+)?['"]([^'"]+)['"]/g;
	let match;

	while ((match = importRegex.exec(source)) !== null) {
		const importPath = match[1];
		if (!isImportAllowed(importPath, true)) {
			disallowed.push(importPath);
		}
	}

	// Also check dynamic imports
	const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
	while ((match = dynamicImportRegex.exec(source)) !== null) {
		const importPath = match[1];
		if (!isImportAllowed(importPath, true)) {
			disallowed.push(importPath);
		}
	}

	return [...new Set(disallowed)]; // Remove duplicates
}

self.onmessage = async (e: MessageEvent<PluginCompileRequest>) => {
	handlePluginCompile(e.data);
};

/**
 * Compile a multi-file plugin bundle.
 */
function handlePluginCompile(request: PluginCompileRequest): void {
	const { id, files, entrypoint, sandboxed = false } = request;

	try {
		// Validate entrypoint exists
		if (!files[entrypoint]) {
			throw new Error(`Entrypoint not found: ${entrypoint}`);
		}

		// Validate imports if sandboxed
		if (sandboxed) {
			const allDisallowed: { file: string; imports: string[] }[] = [];

			for (const [path, source] of Object.entries(files)) {
				const disallowed = validateImports(source, true);
				if (disallowed.length > 0) {
					allDisallowed.push({ file: path, imports: disallowed });
				}
			}

			if (allDisallowed.length > 0) {
				const details = allDisallowed
					.map((d) => `${d.file}: ${d.imports.join(', ')}`)
					.join('\n');
				throw new Error(
					`Sandboxed plugin contains disallowed imports:\n${details}\n\n` +
						`Only Svelte and D3 visualization libraries are allowed.`
				);
			}
		}

		// Get all Svelte files
		const svelteFiles = Object.keys(files).filter((path) => path.endsWith('.svelte'));

		// Build dependency graph and compile in order
		const compiledFiles: CompiledFile[] = [];
		const compiled = new Map<string, string>();

		// Compile all Svelte files
		for (const path of svelteFiles) {
			const source = files[path];
			const result = compile(source, {
				generate: 'client',
				dev: true,
				css: 'injected',
				runes: true,
				filename: path
			});

			const errors = result.warnings.filter((w) => w.code.startsWith('error'));
			if (errors.length > 0) {
				throw new Error(`Error in ${path}: ${errors.map((e) => e.message).join('\n')}`);
			}

			let code = result.js.code;

			// Transform svelte runtime imports
			code = transformSvelteImports(code);

			// Transform local imports to use module registry
			code = transformLocalImports(code, path, svelteFiles, id);

			// Append module registration for dependencies (not entrypoint)
			if (path !== entrypoint) {
				code = appendModuleRegistration(code, path, id);
			}

			compiled.set(path, code);
			compiledFiles.push({
				path,
				code,
				css: result.css?.code
			});
		}

		// Ensure entrypoint is last (dependencies loaded first)
		const sortedFiles = compiledFiles
			.filter((f) => f.path !== entrypoint)
			.concat(compiledFiles.filter((f) => f.path === entrypoint));

		const response: PluginCompileResponse = {
			type: 'compile-plugin-result',
			id,
			success: true,
			files: sortedFiles,
			entrypoint
		};
		self.postMessage(response);
	} catch (error) {
		const response: PluginCompileResponse = {
			type: 'compile-plugin-result',
			id,
			success: false,
			error: error instanceof Error ? error.message : String(error)
		};
		self.postMessage(response);
	}
}

/**
 * Transform svelte imports to use the global runtime shim.
 */
function transformSvelteImports(code: string): string {
	const namespaceImports: string[] = [];
	const namedImports: string[] = [];

	// Handle namespace imports: import * as $ from 'svelte/...'
	code = code.replace(
		/import\s*\*\s*as\s+(\w+|\$)\s+from\s*['"]svelte[^'"]*['"];?/g,
		(_match, name) => {
			namespaceImports.push(name);
			return '';
		}
	);

	// Handle named imports: import { a, b } from 'svelte/...'
	code = code.replace(/import\s*\{([^}]+)\}\s*from\s*['"]svelte[^'"]*['"];?/g, (_match, symbols) => {
		const names = symbols
			.split(',')
			.map((s: string) => s.trim())
			.filter((s: string) => s.length > 0);
		namedImports.push(...names);
		return '';
	});

	// Handle side-effect imports: import 'svelte/...'
	code = code.replace(/import\s*['"]svelte[^'"]*['"];?/g, '');

	const preambleLines: string[] = [];

	for (const name of namespaceImports) {
		preambleLines.push(`const ${name} = globalThis.__svelte_runtime__;`);
	}

	if (namedImports.length > 0) {
		const destructureItems = namedImports.map((s) => {
			const asMatch = s.match(/^(\w+)\s+as\s+(\w+)$/);
			if (asMatch) {
				return `${asMatch[1]}: ${asMatch[2]}`;
			}
			return s;
		});
		preambleLines.push(`const { ${destructureItems.join(', ')} } = globalThis.__svelte_runtime__;`);
	}

	const preamble = preambleLines.length > 0 ? preambleLines.join('\n') + '\n' : '';
	return preamble + code;
}

/**
 * Transform local imports to use the plugin module registry.
 *
 * Converts:
 *   import SubComponent from './SubComponent.svelte';
 * To:
 *   const SubComponent = globalThis.__plugin_modules__['plugin-id']['SubComponent.svelte'].default;
 */
function transformLocalImports(
	code: string,
	currentPath: string,
	bundleFiles: string[],
	pluginId: string
): string {
	const importAssignments: string[] = [];

	// Handle default imports: import Foo from './Foo.svelte'
	code = code.replace(
		/import\s+(\w+)\s+from\s*['"](\.\/[^'"]+\.svelte)['"];?/g,
		(_match, name, importPath) => {
			const resolvedPath = resolvePath(currentPath, importPath);
			if (bundleFiles.includes(resolvedPath)) {
				importAssignments.push(
					`const ${name} = globalThis.__plugin_modules__['${pluginId}']['${resolvedPath}'].default;`
				);
				return '';
			}
			return _match; // Keep external imports as-is
		}
	);

	// Handle named imports: import { Foo, Bar } from './components.svelte'
	code = code.replace(
		/import\s*\{([^}]+)\}\s*from\s*['"](\.\/[^'"]+\.svelte)['"];?/g,
		(_match, symbols, importPath) => {
			const resolvedPath = resolvePath(currentPath, importPath);
			if (bundleFiles.includes(resolvedPath)) {
				const names = symbols
					.split(',')
					.map((s: string) => s.trim())
					.filter((s: string) => s.length > 0);

				for (const name of names) {
					const asMatch = name.match(/^(\w+)\s+as\s+(\w+)$/);
					if (asMatch) {
						importAssignments.push(
							`const ${asMatch[2]} = globalThis.__plugin_modules__['${pluginId}']['${resolvedPath}']['${asMatch[1]}'];`
						);
					} else {
						importAssignments.push(
							`const ${name} = globalThis.__plugin_modules__['${pluginId}']['${resolvedPath}']['${name}'];`
						);
					}
				}
				return '';
			}
			return _match;
		}
	);

	// Handle namespace imports: import * as Foo from './Foo.svelte'
	code = code.replace(
		/import\s*\*\s*as\s+(\w+)\s+from\s*['"](\.\/[^'"]+\.svelte)['"];?/g,
		(_match, name, importPath) => {
			const resolvedPath = resolvePath(currentPath, importPath);
			if (bundleFiles.includes(resolvedPath)) {
				importAssignments.push(
					`const ${name} = globalThis.__plugin_modules__['${pluginId}']['${resolvedPath}'];`
				);
				return '';
			}
			return _match;
		}
	);

	if (importAssignments.length > 0) {
		return importAssignments.join('\n') + '\n' + code;
	}
	return code;
}

/**
 * Resolve a relative import path from a given file.
 */
function resolvePath(fromPath: string, importPath: string): string {
	// Remove ./ prefix
	const cleanImport = importPath.replace(/^\.\//, '');

	// For simple cases (flat structure), just return the filename
	// For nested paths, we'd need more complex resolution
	const fromDir = fromPath.includes('/') ? fromPath.substring(0, fromPath.lastIndexOf('/')) : '';

	if (fromDir && importPath.startsWith('./')) {
		return fromDir + '/' + cleanImport;
	}

	return cleanImport;
}

/**
 * Append module registry registration to compiled code.
 * Keeps original exports intact - just adds a side effect that registers the module.
 */
function appendModuleRegistration(code: string, path: string, pluginId: string): string {
	const defaultExportName = getDefaultExportName(code);

	// Append registry initialization and registration after the module code.
	// The exported function is also available in module scope, so we can reference it.
	const registration = [
		'',
		'// Register in plugin module registry for inter-component imports',
		'if (!globalThis.__plugin_modules__) globalThis.__plugin_modules__ = {};',
		`if (!globalThis.__plugin_modules__["${pluginId}"]) globalThis.__plugin_modules__["${pluginId}"] = {};`,
		`globalThis.__plugin_modules__["${pluginId}"]["${path}"] = { default: ${defaultExportName} };`
	].join('\n');

	return code + registration;
}

/**
 * Extract the default export name from compiled Svelte code.
 * Svelte 5 compiler generates: export default function ComponentName($$anchor, $$props) { ... }
 */
function getDefaultExportName(code: string): string {
	// Look for "export default function <name>" pattern (Svelte 5 style)
	const exportDefaultFuncMatch = code.match(/export\s+default\s+function\s+(\w+)\s*\(/);
	if (exportDefaultFuncMatch) {
		return exportDefaultFuncMatch[1];
	}

	// Look for "export function <name>" pattern
	const exportFuncMatch = code.match(/export\s+function\s+(\w+)\s*\(/);
	if (exportFuncMatch) {
		return exportFuncMatch[1];
	}

	// Look for "export default <identifier>" (not followed by function/class)
	const defaultIdentMatch = code.match(/export\s+default\s+([A-Z]\w*)\s*[;\n]/);
	if (defaultIdentMatch) {
		return defaultIdentMatch[1];
	}

	// Fallback: look for any function that looks like a component (capital letter, takes $$anchor)
	const componentMatch = code.match(/function\s+([A-Z]\w*)\s*\(\s*\$\$anchor/);
	if (componentMatch) {
		return componentMatch[1];
	}

	// Last resort: any function with capital letter
	const anyFuncMatch = code.match(/function\s+([A-Z]\w*)\s*\(/);
	if (anyFuncMatch) {
		return anyFuncMatch[1];
	}

	return 'Component';
}
