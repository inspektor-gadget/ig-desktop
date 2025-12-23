/**
 * Theme service
 * Manages dark/light/system theme switching with reactive state
 */

import { browser } from '$app/environment';
import { configuration } from '$lib/stores/configuration.svelte';

type ThemePreference = 'dark' | 'light' | 'system';
type ResolvedTheme = 'dark' | 'light';

const DARK_THEME_COLOR = '#09090B';
const LIGHT_THEME_COLOR = '#f9fafb';

class ThemeService {
	/** System prefers dark mode */
	private systemPrefersDark = $state(
		browser ? window.matchMedia('(prefers-color-scheme: dark)').matches : true
	);

	/** The user's theme preference from settings */
	readonly preference = $derived((configuration.get('theme') as ThemePreference) || 'dark');

	/** The actual resolved theme (dark or light) */
	readonly resolvedTheme: ResolvedTheme = $derived(
		this.preference === 'system' ? (this.systemPrefersDark ? 'dark' : 'light') : this.preference
	);

	/** True if current theme is dark */
	readonly isDark = $derived(this.resolvedTheme === 'dark');

	/** Theme color for meta tag */
	readonly themeColor = $derived(this.isDark ? DARK_THEME_COLOR : LIGHT_THEME_COLOR);

	constructor() {
		if (browser) {
			// Listen for system preference changes
			const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
			mediaQuery.addEventListener('change', (e) => {
				this.systemPrefersDark = e.matches;
			});
		}
	}

	/** Apply theme to document - called from layout effect */
	applyTheme(): void {
		if (!browser) return;

		document.documentElement.classList.toggle('dark', this.isDark);
		document.querySelector('meta[name="theme-color"]')?.setAttribute('content', this.themeColor);
	}
}

export const themeService = new ThemeService();
