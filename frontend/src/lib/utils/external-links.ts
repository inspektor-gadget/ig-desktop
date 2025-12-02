/**
 * External links helper that abstracts browser opening functionality.
 * Uses Wails Browser.OpenURL() in desktop mode, falls back to window.open()
 * in browser mode.
 */

import { environment } from '$lib/services/environment.service.svelte';

/**
 * Opens an external URL in the appropriate manner based on the runtime environment.
 * In Wails desktop mode, uses the native browser opener.
 * In browser mode, opens in a new tab.
 *
 * @param url - The URL to open
 */
export async function openExternalURL(url: string): Promise<void> {
	if (environment.isApp) {
		// Dynamic import to avoid loading Wails runtime in browser mode
		const { Browser } = await import('@wailsio/runtime');
		Browser.OpenURL(url);
	} else {
		window.open(url, '_blank', 'noopener,noreferrer');
	}
}
