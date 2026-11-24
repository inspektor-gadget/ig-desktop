/**
 * Configuration store
 * Manages both modal state and configuration settings with localStorage persistence
 */

import { configurationSchema, getFullConfigurationSchema } from '#lib/config.ts';
import type { Setting } from '#lib/config.types.ts';

export const configurationStorageKey = 'ig-configuration';

export type ConfigurationValue =
	| boolean
	| string
	| number
	| Record<string, unknown>
	| unknown[]
	| null;
export type ConfigurationSnapshot = Record<string, ConfigurationValue>;
export type ConfigurationChange = (snapshot: Readonly<ConfigurationSnapshot>) => void;

/** Built per call because plugins can extend the schema; callers hoist it out of loops. */
function settingsByKey(): Map<string, Setting> {
	return new Map(
		getFullConfigurationSchema()
			.categories.flatMap((category) => category.settings)
			.map((setting) => [setting.key, setting])
	);
}

function validValue(setting: Setting, value: unknown): value is ConfigurationValue {
	if (setting.type === 'toggle') return typeof value === 'boolean';
	if (setting.type === 'text') return typeof value === 'string';
	if (setting.type === 'select') return typeof value === 'string' && value in setting.options;
	return (
		typeof value === 'number' &&
		Number.isFinite(value) &&
		(setting.min === undefined || value >= setting.min) &&
		(setting.max === undefined || value <= setting.max)
	);
}

class ConfigurationStore {
	private state = $state({
		isOpen: false
	});

	// Settings stored with reactivity
	private settings = $state<ConfigurationSnapshot>(this.loadSettings());
	private subscribers = new Set<ConfigurationChange>();

	/**
	 * Load settings from localStorage or use defaults from schema
	 */
	private loadSettings(): ConfigurationSnapshot {
		if (typeof window === 'undefined') {
			return this.getDefaults();
		}

		try {
			const stored = window.localStorage.getItem(configurationStorageKey);
			if (stored) {
				const parsed = JSON.parse(stored);
				if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
					const defaults = this.getDefaults();
					const settings = settingsByKey();
					for (const [key, value] of Object.entries(parsed)) {
						const setting = settings.get(key);
						if (setting && validValue(setting, value)) defaults[key] = value;
					}
					return defaults;
				}
			}
		} catch (error) {
			console.error('Failed to load configuration:', error);
		}

		return this.getDefaults();
	}

	/**
	 * Get default values from schema
	 */
	private getDefaults(): ConfigurationSnapshot {
		const defaults: ConfigurationSnapshot = {};
		for (const category of configurationSchema.categories) {
			for (const setting of category.settings) {
				defaults[setting.key] = setting.default;
			}
		}
		return defaults;
	}

	/**
	 * Persist settings to localStorage
	 */
	private persist(): void {
		if (typeof window === 'undefined') return;

		try {
			window.localStorage.setItem(
				configurationStorageKey,
				JSON.stringify($state.snapshot(this.settings))
			);
		} catch (error) {
			console.error('Failed to persist configuration:', error);
		}
	}

	get isOpen() {
		return this.state.isOpen;
	}

	open() {
		this.state.isOpen = true;
	}

	close() {
		this.state.isOpen = false;
	}

	toggle() {
		this.state.isOpen = !this.state.isOpen;
	}

	/**
	 * Get a setting value by key
	 */
	get(key: string): ConfigurationValue | undefined {
		return this.settings[key];
	}

	/**
	 * Set a setting value by key and persist
	 */
	set(key: string, value: ConfigurationValue): void {
		const setting = settingsByKey().get(key);
		if (!setting) throw new Error(`Unknown configuration setting: ${key}`);
		if (!validValue(setting, value))
			throw new Error(`Invalid value for configuration setting: ${key}`);
		this.settings[key] = value;
		this.persist();
		this.notify();
	}

	/**
	 * Get all settings
	 */
	getAll(): ConfigurationSnapshot {
		return this.snapshot();
	}

	/** Return a serializable copy suitable for embedding hosts. */
	snapshot(): ConfigurationSnapshot {
		return $state.snapshot(this.settings);
	}

	/**
	 * Replace known, schema-valid settings while keeping omitted keys at their defaults.
	 * This is intentionally the same validation boundary used by embedded hosts.
	 */
	apply(snapshot: Record<string, unknown>): void {
		const defaults = this.getDefaults();
		const next = { ...defaults };
		const settings = settingsByKey();
		for (const [key, value] of Object.entries(snapshot)) {
			const setting = settings.get(key);
			if (setting && validValue(setting, value)) next[key] = value;
		}
		this.settings = next;
		this.persist();
		this.notify();
	}

	onChange(callback: ConfigurationChange): () => void {
		this.subscribers.add(callback);
		return () => this.subscribers.delete(callback);
	}

	private notify(): void {
		const snapshot = this.snapshot();
		for (const callback of this.subscribers) callback(snapshot);
	}

	/**
	 * Reset all settings to defaults
	 */
	reset(): void {
		this.settings = this.getDefaults();
		this.persist();
		this.notify();
	}

	/**
	 * Reset a specific setting to its default
	 */
	resetKey(key: string): void {
		const defaults = this.getDefaults();
		if (key in defaults) {
			this.settings[key] = defaults[key];
			this.persist();
			this.notify();
		}
	}
}

export const configuration = new ConfigurationStore();
