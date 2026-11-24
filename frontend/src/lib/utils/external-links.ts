/**
 * External links helper that abstracts browser opening functionality.
 * Uses Wails Browser.OpenURL() in desktop mode, falls back to window.open()
 * in browser mode.
 */

import { environment } from '#lib/services/environment.service.svelte.ts';
import { overrideStack } from './override-stack';

const hostOpeners = overrideStack<(url: string) => void | Promise<void>>();

/**
 * Override external links for an embedding host. Cleanup removes only this opener, so
 * out-of-order cleanup never reinstalls a disposed one.
 */
export function setExternalURLOpener(opener: (url: string) => void | Promise<void>): () => void {
	return hostOpeners.push(opener);
}

/** Only absolute http(s) URLs without embedded credentials may leave the application. */
export function isSafeExternalURL(url: unknown): url is string {
	if (typeof url !== 'string') return false;
	try {
		const parsed = new URL(url);
		return (
			(parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
			!parsed.username &&
			!parsed.password
		);
	} catch {
		return false;
	}
}

/**
 * Opens an external URL in the appropriate manner based on the runtime environment.
 * In Wails desktop mode, uses the native browser opener.
 * In browser mode, opens in a new tab.
 *
 * Unsafe URLs (see `isSafeExternalURL`) are ignored for every opener.
 *
 * @param url - The URL to open
 */
export async function openExternalURL(url: string): Promise<void> {
	if (!isSafeExternalURL(url)) {
		console.warn('Blocked external URL that is not plain http(s):', url);
		return;
	}
	const hostOpener = hostOpeners.current;
	if (hostOpener) {
		await hostOpener(url);
		return;
	}
	if (environment.isApp) {
		// Dynamic import to avoid loading Wails runtime in browser mode
		const { Browser } = await import('@wailsio/runtime');
		Browser.OpenURL(url);
	} else {
		window.open(url, '_blank', 'noopener,noreferrer');
	}
}
