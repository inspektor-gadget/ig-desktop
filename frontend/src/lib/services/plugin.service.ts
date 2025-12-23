/**
 * Service for compiling and loading multi-file plugins at runtime.
 *
 * This service manages the lifecycle of plugins:
 * 1. Sends source files to a Web Worker for compilation
 * 2. Sets up the Svelte runtime shim
 * 3. Executes compiled modules in dependency order
 * 4. Returns the entrypoint exports
 * 5. Cleans up resources when plugins are unloaded
 */

import type {
	PluginBundle,
	CompiledPlugin,
	PluginCompileRequest,
	PluginCompileResponse,
	CompiledFile
} from '$lib/types/plugin';
import { getPluginEntrypoint, validatePluginBundle } from '$lib/types/plugin';
// @ts-expect-error - svelte/internal/client is not typed but needed for runtime compilation
import * as svelteInternalClient from 'svelte/internal/client';
// @ts-expect-error - svelte/internal/disclose-version is not typed but needed for runtime compilation
import * as svelteInternalDiscloseVersion from 'svelte/internal/disclose-version';
import * as svelte from 'svelte';
import CompilerWorker from '$lib/workers/svelte-compiler.worker?worker';

const svelteRuntime = {
	...svelteInternalClient,
	...svelteInternalDiscloseVersion,
	...svelte
};

class PluginService {
	private runtimeInitialized = false;
	private worker: Worker | null = null;
	private pendingCompilations = new Map<
		string,
		{
			resolve: (response: PluginCompileResponse) => void;
			reject: (error: Error) => void;
		}
	>();

	/**
	 * Initialize the Svelte runtime shim.
	 * Must be called before executing any compiled plugin code.
	 */
	ensureRuntimeInitialized(): void {
		if (!this.runtimeInitialized) {
			(globalThis as any).__svelte_runtime__ = svelteRuntime;
			this.runtimeInitialized = true;
		}
	}

	/**
	 * Get or create the compiler worker.
	 */
	private getWorker(): Worker {
		if (!this.worker) {
			this.worker = new CompilerWorker();
			this.worker.onmessage = (e: MessageEvent<PluginCompileResponse>) => {
				const response = e.data;
				if (response.type === 'compile-plugin-result') {
					const pending = this.pendingCompilations.get(response.id);
					if (pending) {
						this.pendingCompilations.delete(response.id);
						pending.resolve(response);
					}
				}
			};
			this.worker.onerror = (e) => {
				console.error('Plugin compiler worker error:', e);
			};
		}
		return this.worker;
	}

	/**
	 * Send compilation request to worker and wait for result.
	 */
	private compileInWorker(
		bundle: PluginBundle,
		sandboxed: boolean = false
	): Promise<PluginCompileResponse> {
		return new Promise((resolve, reject) => {
			this.pendingCompilations.set(bundle.id, { resolve, reject });

			const entrypoint = getPluginEntrypoint(bundle);

			// Create plain object copies to avoid Svelte 5 proxy serialization issues
			const plainFiles: Record<string, string> = {};
			for (const [path, source] of Object.entries(bundle.files)) {
				plainFiles[path] = source;
			}

			const request: PluginCompileRequest = {
				type: 'compile-plugin',
				id: bundle.id,
				pluginType: bundle.type,
				files: plainFiles,
				entrypoint,
				sandboxed
			};

			this.getWorker().postMessage(request);

			// Timeout after 60 seconds (multi-file compilation may take longer)
			setTimeout(() => {
				if (this.pendingCompilations.has(bundle.id)) {
					this.pendingCompilations.delete(bundle.id);
					reject(new Error('Plugin compilation timed out'));
				}
			}, 60000);
		});
	}

	/**
	 * Compile a plugin bundle into an executable plugin.
	 * @param bundle - The plugin source bundle
	 * @param sandboxed - If true, restrict imports to safe libraries only (for gadget plugins)
	 */
	async compile(bundle: PluginBundle, sandboxed: boolean = false): Promise<CompiledPlugin> {
		this.ensureRuntimeInitialized();

		// Validate bundle
		const validationError = validatePluginBundle(bundle);
		if (validationError) {
			throw new Error(validationError);
		}

		// Compile in worker (with sandboxing if requested)
		const response = await this.compileInWorker(bundle, sandboxed);

		if (!response.success || !response.files) {
			throw new Error(response.error || 'Compilation failed');
		}

		// Execute compiled modules and get entrypoint
		const { exports, moduleUrls, css, compiledModules } = await this.executeModules(
			bundle.id,
			response.files,
			response.entrypoint!
		);

		return {
			id: bundle.id,
			name: bundle.name,
			type: bundle.type,
			moduleUrls,
			exports,
			css,
			compiledAt: Date.now(),
			compiledModules,
			entrypoint: response.entrypoint!
		};
	}

	/**
	 * Execute compiled modules in order and return the entrypoint exports.
	 */
	private async executeModules(
		pluginId: string,
		files: CompiledFile[],
		entrypoint: string
	): Promise<{
		exports: unknown;
		moduleUrls: string[];
		css?: string;
		compiledModules: Record<string, string>;
	}> {
		const moduleUrls: string[] = [];
		const cssChunks: string[] = [];
		const compiledModules: Record<string, string> = {};

		// Initialize plugin module registry
		if (!(globalThis as any).__plugin_modules__) {
			(globalThis as any).__plugin_modules__ = {};
		}
		(globalThis as any).__plugin_modules__[pluginId] = {};

		// Execute dependency modules first (already sorted by worker)
		for (const file of files) {
			// Store compiled code for caching
			compiledModules[file.path] = file.code;

			if (file.path === entrypoint) continue;

			// Execute as ES module (registers itself in __plugin_modules__ as side effect)
			const blob = new Blob([file.code], { type: 'text/javascript' });
			const url = URL.createObjectURL(blob);
			moduleUrls.push(url);

			try {
				await import(/* @vite-ignore */ url);
			} catch (e) {
				moduleUrls.forEach((u) => URL.revokeObjectURL(u));
				throw new Error(`Failed to load module ${file.path}: ${e}`);
			}

			if (file.css) {
				cssChunks.push(file.css);
			}
		}

		// Execute entrypoint and get exports
		const entrypointFile = files.find((f) => f.path === entrypoint);
		if (!entrypointFile) {
			moduleUrls.forEach((u) => URL.revokeObjectURL(u));
			throw new Error(`Entrypoint not found: ${entrypoint}`);
		}

		const entrypointBlob = new Blob([entrypointFile.code], { type: 'text/javascript' });
		const entrypointUrl = URL.createObjectURL(entrypointBlob);
		moduleUrls.push(entrypointUrl);

		try {
			const module = await import(/* @vite-ignore */ entrypointUrl);

			if (entrypointFile.css) {
				cssChunks.push(entrypointFile.css);
			}

			return {
				exports: module.default,
				moduleUrls,
				css: cssChunks.length > 0 ? cssChunks.join('\n') : undefined,
				compiledModules
			};
		} catch (e) {
			moduleUrls.forEach((u) => URL.revokeObjectURL(u));
			throw new Error(`Failed to load entrypoint: ${e}`);
		}
	}

	/**
	 * Unload a compiled plugin and clean up its resources.
	 */
	unload(plugin: CompiledPlugin): void {
		// Revoke all blob URLs
		plugin.moduleUrls.forEach((url) => URL.revokeObjectURL(url));

		// Clean up module registry
		if ((globalThis as any).__plugin_modules__?.[plugin.id]) {
			delete (globalThis as any).__plugin_modules__[plugin.id];
		}
	}

	/**
	 * Terminate the worker when no longer needed.
	 */
	dispose(): void {
		if (this.worker) {
			this.worker.terminate();
			this.worker = null;
		}
		this.pendingCompilations.clear();
	}
}

export const pluginService = new PluginService();
