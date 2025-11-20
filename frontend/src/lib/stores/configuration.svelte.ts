/**
 * Configuration store
 * Manages both modal state and configuration settings with localStorage persistence
 */

import { configurationSchema } from '$lib/config';
import type { Setting } from '$lib/config.types';

const STORAGE_KEY = 'ig-configuration';

type SettingValue = boolean | string | number;
type SettingsData = Record<string, SettingValue>;

class ConfigurationStore {
	private state = $state({
		isOpen: false
	});

	// Settings stored with reactivity
	private settings = $state<SettingsData>(this.loadSettings());

	/**
	 * Load settings from localStorage or use defaults from schema
	 */
	private loadSettings(): SettingsData {
		if (typeof window === 'undefined') {
			return this.getDefaults();
		}

		try {
			const stored = window.localStorage.getItem(STORAGE_KEY);
			if (stored) {
				const parsed = JSON.parse(stored);
				// Merge with defaults to ensure all keys exist
				return { ...this.getDefaults(), ...parsed };
			}
		} catch (error) {
			console.error('Failed to load configuration:', error);
		}

		return this.getDefaults();
	}

	/**
	 * Get default values from schema
	 */
	private getDefaults(): SettingsData {
		const defaults: SettingsData = {};
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
			window.localStorage.setItem(STORAGE_KEY, JSON.stringify($state.snapshot(this.settings)));
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
	get(key: string): SettingValue | undefined {
		return this.settings[key];
	}

	/**
	 * Set a setting value by key and persist
	 */
	set(key: string, value: SettingValue): void {
		this.settings[key] = value;
		this.persist();
	}

	/**
	 * Get all settings
	 */
	getAll(): SettingsData {
		return this.settings;
	}

	/**
	 * Reset all settings to defaults
	 */
	reset(): void {
		this.settings = this.getDefaults();
		this.persist();
	}

	/**
	 * Reset a specific setting to its default
	 */
	resetKey(key: string): void {
		const defaults = this.getDefaults();
		if (key in defaults) {
			this.settings[key] = defaults[key];
			this.persist();
		}
	}
}

export const configuration = new ConfigurationStore();
