/**
 * Plugin Cache Service
 *
 * Manages browser-side caching of compiled plugins using IndexedDB.
 * Uses SHA-256 hashing of source files for cache key generation,
 * ensuring cache invalidation when plugin source changes.
 */

import type { PluginManifest } from '$lib/types/plugin-manifest';

/**
 * Cached plugin data stored in IndexedDB.
 */
export interface CachedPlugin {
	/** Cache key (plugin-id:hash) */
	cacheKey: string;
	/** Plugin manifest */
	manifest: PluginManifest;
	/** Compiled JavaScript modules (path -> code) */
	compiledModules: Record<string, string>;
	/** Combined CSS */
	css?: string;
	/** Entrypoint path */
	entrypoint: string;
	/** Timestamp when cached */
	cachedAt: number;
	/** Source files hash for verification */
	sourceHash: string;
}

const DB_NAME = 'ig-plugin-cache';
const DB_VERSION = 1;
const STORE_NAME = 'compiled-plugins';

class PluginCacheService {
	private db: IDBDatabase | null = null;
	private initPromise: Promise<void> | null = null;

	/**
	 * Initialize the IndexedDB database.
	 */
	async init(): Promise<void> {
		if (this.db) return;
		if (this.initPromise) return this.initPromise;

		this.initPromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, DB_VERSION);

			request.onerror = () => {
				console.error('Failed to open plugin cache database:', request.error);
				reject(request.error);
			};

			request.onsuccess = () => {
				this.db = request.result;
				resolve();
			};

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					const store = db.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });
					// Index by plugin ID for listing all versions
					store.createIndex('pluginId', 'manifest.id', { unique: false });
					// Index by cached time for cleanup
					store.createIndex('cachedAt', 'cachedAt', { unique: false });
				}
			};
		});

		return this.initPromise;
	}

	/**
	 * Generate a cache key from plugin source files.
	 * Uses SHA-256 hash of concatenated file contents for versioning.
	 */
	async generateCacheKey(pluginId: string, files: Record<string, string>): Promise<string> {
		// Sort files by path for consistent hashing
		const sortedContent = Object.entries(files)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([path, source]) => `${path}:\n${source}`)
			.join('\n---\n');

		const hash = await this.hashString(sortedContent);
		return `${pluginId}:${hash}`;
	}

	/**
	 * Compute SHA-256 hash of a string.
	 */
	private async hashString(content: string): Promise<string> {
		const encoder = new TextEncoder();
		const data = encoder.encode(content);
		const hashBuffer = await crypto.subtle.digest('SHA-256', data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
	}

	/**
	 * Get a cached plugin by cache key.
	 */
	async get(cacheKey: string): Promise<CachedPlugin | null> {
		await this.init();
		if (!this.db) return null;

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction(STORE_NAME, 'readonly');
			const store = transaction.objectStore(STORE_NAME);
			const request = store.get(cacheKey);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result || null);
		});
	}

	/**
	 * Check if a plugin is cached.
	 */
	async has(cacheKey: string): Promise<boolean> {
		const cached = await this.get(cacheKey);
		return cached !== null;
	}

	/**
	 * Store a compiled plugin in the cache.
	 */
	async set(plugin: CachedPlugin): Promise<void> {
		await this.init();
		if (!this.db) return;

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
			const store = transaction.objectStore(STORE_NAME);
			const request = store.put(plugin);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve();
		});
	}

	/**
	 * Delete a cached plugin.
	 */
	async delete(cacheKey: string): Promise<void> {
		await this.init();
		if (!this.db) return;

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
			const store = transaction.objectStore(STORE_NAME);
			const request = store.delete(cacheKey);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve();
		});
	}

	/**
	 * Delete all cached versions of a plugin.
	 */
	async deleteAllVersions(pluginId: string): Promise<void> {
		await this.init();
		if (!this.db) return;

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
			const store = transaction.objectStore(STORE_NAME);
			const index = store.index('pluginId');
			const request = index.openCursor(IDBKeyRange.only(pluginId));

			request.onerror = () => reject(request.error);
			request.onsuccess = () => {
				const cursor = request.result;
				if (cursor) {
					cursor.delete();
					cursor.continue();
				} else {
					resolve();
				}
			};
		});
	}

	/**
	 * Clear all cached plugins.
	 */
	async clear(): Promise<void> {
		await this.init();
		if (!this.db) return;

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
			const store = transaction.objectStore(STORE_NAME);
			const request = store.clear();

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve();
		});
	}

	/**
	 * Get cache statistics.
	 */
	async getStats(): Promise<{ count: number; oldestCachedAt: number | null }> {
		await this.init();
		if (!this.db) return { count: 0, oldestCachedAt: null };

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction(STORE_NAME, 'readonly');
			const store = transaction.objectStore(STORE_NAME);
			const countRequest = store.count();
			const oldestRequest = store.index('cachedAt').openCursor();

			let count = 0;
			let oldestCachedAt: number | null = null;

			countRequest.onsuccess = () => {
				count = countRequest.result;
			};

			oldestRequest.onsuccess = () => {
				const cursor = oldestRequest.result;
				if (cursor) {
					oldestCachedAt = cursor.value.cachedAt;
				}
			};

			transaction.oncomplete = () => resolve({ count, oldestCachedAt });
			transaction.onerror = () => reject(transaction.error);
		});
	}

	/**
	 * Clean up old cache entries.
	 * Removes entries older than maxAge milliseconds.
	 */
	async cleanup(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
		await this.init();
		if (!this.db) return 0;

		const cutoff = Date.now() - maxAgeMs;
		let deletedCount = 0;

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
			const store = transaction.objectStore(STORE_NAME);
			const index = store.index('cachedAt');
			const range = IDBKeyRange.upperBound(cutoff);
			const request = index.openCursor(range);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => {
				const cursor = request.result;
				if (cursor) {
					cursor.delete();
					deletedCount++;
					cursor.continue();
				}
			};

			transaction.oncomplete = () => resolve(deletedCount);
		});
	}

	/**
	 * List all cached plugins.
	 */
	async list(): Promise<CachedPlugin[]> {
		await this.init();
		if (!this.db) return [];

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction(STORE_NAME, 'readonly');
			const store = transaction.objectStore(STORE_NAME);
			const request = store.getAll();

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result);
		});
	}

	/**
	 * Close the database connection.
	 */
	close(): void {
		if (this.db) {
			this.db.close();
			this.db = null;
			this.initPromise = null;
		}
	}
}

/** Singleton plugin cache service */
export const pluginCache = new PluginCacheService();
