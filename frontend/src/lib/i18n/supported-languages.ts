/**
 * Languages IG Desktop ships translations for.
 *
 * To add a language: add an entry here (code → native display name) and create
 * `locales/<code>/translation.json`. Codes are matched case-insensitively;
 * locale folders use the lowercased code (e.g. `zh-TW` → `locales/zh-tw/`).
 */
export const supportedLanguages: Record<string, string> = {
	en: 'English',
	de: 'Deutsch',
	es: 'Español',
	fr: 'Français',
	hi: 'हिन्दी',
	it: 'Italiano',
	ro: 'Română',
	ru: 'Русский',
	tr: 'Türkçe',
	ur: 'اردو'
};

/** Language codes that render right-to-left. */
export const rtlLanguages = new Set<string>(['ur']);
