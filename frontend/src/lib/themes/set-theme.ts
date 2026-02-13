/**
 * Theme token overrides accepted by setTheme().
 * All properties are optional — only specified tokens are overridden.
 */
export interface IGThemeTokens {
	primary?: string;
	primaryHover?: string;
	primaryMuted?: string;
	surface?: string;
	surfaceRaised?: string;
	text?: string;
	textSecondary?: string;
	textMuted?: string;
	textOnPrimary?: string;
	border?: string;
	borderStrong?: string;
	error?: string;
	success?: string;
	warning?: string;
	radiusSm?: string;
	radiusMd?: string;
	radiusLg?: string;
	fontSans?: string;
	fontMono?: string;
}

/** Maps IGThemeTokens keys to --ig-* CSS custom property names. */
const TOKEN_MAP: Record<keyof IGThemeTokens, string> = {
	primary: '--ig-color-primary',
	primaryHover: '--ig-color-primary-hover',
	primaryMuted: '--ig-color-primary-muted',
	surface: '--ig-color-surface',
	surfaceRaised: '--ig-color-surface-raised',
	text: '--ig-color-text',
	textSecondary: '--ig-color-text-secondary',
	textMuted: '--ig-color-text-muted',
	textOnPrimary: '--ig-color-text-on-primary',
	border: '--ig-color-border',
	borderStrong: '--ig-color-border-strong',
	error: '--ig-color-error',
	success: '--ig-color-success',
	warning: '--ig-color-warning',
	radiusSm: '--ig-radius-sm',
	radiusMd: '--ig-radius-md',
	radiusLg: '--ig-radius-lg',
	fontSans: '--ig-font-sans',
	fontMono: '--ig-font-mono'
};

/**
 * Programmatically apply theme token overrides.
 * Sets CSS custom properties on `document.documentElement` (:root).
 *
 * Useful for bridging a host app's theme (e.g., MUI `useTheme()`) into
 * IG component tokens at runtime.
 *
 * @example
 * ```ts
 * import { setTheme } from '@inspektor-gadget/frontend';
 *
 * const muiTheme = useTheme();
 * setTheme({
 *   primary: muiTheme.palette.primary.main,
 *   surface: muiTheme.palette.background.paper,
 *   fontSans: muiTheme.typography.fontFamily,
 *   radiusMd: `${muiTheme.shape.borderRadius}px`,
 * });
 * ```
 */
export function setTheme(tokens: IGThemeTokens): void {
	const root = document.documentElement;
	for (const [key, value] of Object.entries(tokens)) {
		const prop = TOKEN_MAP[key as keyof IGThemeTokens];
		if (prop && value != null) {
			root.style.setProperty(prop, value);
		}
	}
}

/**
 * Remove all programmatically-set theme overrides, restoring CSS defaults.
 */
export function resetTheme(): void {
	const root = document.documentElement;
	for (const prop of Object.values(TOKEN_MAP)) {
		root.style.removeProperty(prop);
	}
}
