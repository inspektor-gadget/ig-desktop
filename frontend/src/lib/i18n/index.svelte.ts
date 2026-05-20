/**
 * Svelte 5 runes binding for {@link igI18n}.
 *
 * `t()` reads a reactive `version` signal, so any component that calls it
 * re-renders when the language changes or a lazily-loaded catalog arrives.
 * No React dependency — plain Svelte runes.
 */
import type { TOptions } from 'i18next';
import { igI18n } from './config';

/** Bumped on every i18next event that can change a translation's output. */
let version = $state(0);
/** The active language code. */
let currentLanguage = $state(igI18n.language || 'en');

igI18n.on('languageChanged', (language) => {
	currentLanguage = language;
	version++;
});
igI18n.on('loaded', () => version++);

/**
 * Reactive translation function. Mirrors `i18next.t` — pass `{{var}}` values
 * and `count` for pluralization via `options`.
 */
export function t(key: string, options?: TOptions): string {
	// Reading `version` registers a Svelte reactive dependency, so components
	// re-render when the language switches or a lazy catalog finishes loading.
	return version >= 0 ? (igI18n.t(key, options) as string) : key;
}

/** Change the active language. Persisted to localStorage by the detector. */
export function setLanguage(language: string): Promise<unknown> {
	return igI18n.changeLanguage(language);
}

/** The active language code (reactive). */
export function getLanguage(): string {
	return currentLanguage;
}

/** Subscribe to language changes. Returns an unsubscribe function. */
export function onLanguageChange(callback: (language: string) => void): () => void {
	igI18n.on('languageChanged', callback);
	return () => igI18n.off('languageChanged', callback);
}
