/**
 * Clipboard helper that abstracts clipboard functionality.
 * Uses Wails Clipboard.SetText() in desktop mode, falls back to
 * navigator.clipboard in browser mode.
 */

import { environment } from '$lib/services/environment.service.svelte';

/**
 * Copies text to the clipboard.
 * In Wails desktop mode, uses the native clipboard API.
 * In browser mode, uses the navigator.clipboard API.
 *
 * @param text - The text to copy to clipboard
 * @returns Promise that resolves to true if successful, false otherwise
 */
export async function copyToClipboard(text: string): Promise<boolean> {
	if (environment.isApp) {
		try {
			// Dynamic import to avoid loading Wails runtime in browser mode
			const { Clipboard } = await import('@wailsio/runtime');
			await Clipboard.SetText(text);
			return true;
		} catch (err) {
			console.error('Failed to copy to clipboard via Wails:', err);
			return false;
		}
	} else {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch (err) {
			console.error('Failed to copy to clipboard via navigator:', err);
			return false;
		}
	}
}
