/**
 * Framework-agnostic i18next setup for IG Desktop.
 *
 * Uses plain `i18next` (no React or Svelte binding) so the same instance works
 * in the standalone Wails app and when embedded in a Headlamp plugin. Catalogs
 * follow Headlamp's conventions — flat natural keys (key = English source
 * string), `{{var}}` interpolation — so translations and tooling transfer.
 *
 * Locale catalogs are lazy-loaded: Vite code-splits each language into its own
 * chunk, fetched on demand when that language is first selected.
 *
 * The Svelte-runes binding lives in `index.svelte.ts`; import from there in
 * components. This file deliberately has no UI-framework dependency.
 */
import i18next, { type BackendModule, type ReadCallback } from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { supportedLanguages } from './supported-languages';

/** Lazy loaders for every locale catalog, keyed by `./locales/<lng>/<ns>.json`. */
const localeLoaders = import.meta.glob<{ default: Record<string, string> }>(
	'./locales/*/*.json'
);

/** i18next backend that resolves a catalog to its lazily-imported Vite chunk. */
const lazyBackend: BackendModule = {
	type: 'backend',
	init: () => {},
	read(language: string, namespace: string, callback: ReadCallback) {
		const loader = localeLoaders[`./locales/${language.toLowerCase()}/${namespace}.json`];
		if (!loader) {
			// No catalog for this language/namespace — fall back, don't retry.
			callback(null, {});
			return;
		}
		loader()
			.then((module) => callback(null, module.default))
			.catch((error) => callback(error, false));
	}
};

/** Dedicated i18next instance for IG Desktop, isolated from any host instance. */
export const igI18n = i18next.createInstance();

/** Resolves once the initial language and `translation` namespace have loaded. */
export const i18nReady = igI18n
	.use(LanguageDetector)
	.use(lazyBackend)
	.init({
		fallbackLng: 'en',
		supportedLngs: Object.keys(supportedLanguages),
		nonExplicitSupportedLngs: true,
		ns: ['translation'],
		defaultNS: 'translation',
		// Headlamp-compatible catalog conventions: flat natural keys
		// (key = English source string) and `|` as the namespace separator.
		keySeparator: false,
		nsSeparator: '|',
		contextSeparator: '//context:',
		returnEmptyString: false,
		interpolation: { escapeValue: false },
		detection: {
			order: ['querystring', 'localStorage', 'navigator'],
			lookupQuerystring: 'lng',
			lookupLocalStorage: 'ig-language',
			caches: ['localStorage']
		},
		debug: import.meta.env.DEV
	});
