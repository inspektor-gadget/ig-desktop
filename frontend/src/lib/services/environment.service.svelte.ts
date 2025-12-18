/**
 * Environment service for detecting and managing the runtime environment.
 * Provides reactive state for whether the app is running in Wails (desktop)
 * or browser mode, and exposes feature availability flags.
 */

type EnvironmentMode = 'wails' | 'browser';
type Platform = 'mac' | 'windows' | 'linux' | 'unknown';

/**
 * Detects the current runtime environment.
 * Returns 'wails' if running in the Wails desktop app, 'browser' otherwise.
 *
 * Detection methods:
 * 1. Check for window.wails (Wails v3 injects this)
 * 2. Check for window.runtime (Wails runtime object)
 * 3. Check for webkit messageHandlers (macOS webview)
 * 4. Check URL - Wails serves from wails:// or localhost with specific patterns
 */
function detectEnvironment(): EnvironmentMode {
	if (typeof window === 'undefined') {
		return 'browser';
	}

	// Check for Wails v3 globals
	if ('wails' in window) {
		return 'wails';
	}

	// Check for runtime object (may be injected later, but check anyway)
	if ('runtime' in window && window.runtime) {
		return 'wails';
	}

	// Check for webkit message handlers (macOS Wails webview)
	if ('webkit' in window && (window as any).webkit?.messageHandlers?.external) {
		return 'wails';
	}

	// Check for Chrome webview (Windows Wails webview)
	if ('chrome' in window && (window as any).chrome?.webview) {
		return 'wails';
	}

	// If served from localhost on typical Wails dev port or file://, likely Wails
	const url = window.location.href;
	if (url.startsWith('wails://') || url.startsWith('file://')) {
		return 'wails';
	}

	return 'browser';
}

/**
 * Detects the current operating system platform.
 */
function detectPlatform(): Platform {
	if (typeof window === 'undefined' || typeof navigator === 'undefined') {
		return 'unknown';
	}

	const userAgent = navigator.userAgent.toLowerCase();
	const platform = navigator.platform?.toLowerCase() || '';

	if (platform.includes('mac') || userAgent.includes('macintosh')) {
		return 'mac';
	}
	if (platform.includes('win') || userAgent.includes('windows')) {
		return 'windows';
	}
	if (platform.includes('linux') || userAgent.includes('linux')) {
		return 'linux';
	}

	return 'unknown';
}

/**
 * Environment service singleton that provides reactive environment detection
 * and feature availability flags.
 */
class EnvironmentService {
	/** The detected runtime environment mode */
	readonly mode: EnvironmentMode = $state(detectEnvironment());

	/** The detected operating system platform */
	readonly platform: Platform = $state(detectPlatform());

	/** True if running in Wails desktop app */
	readonly isApp = $derived(this.mode === 'wails');

	/** True if running on macOS */
	readonly isMac = $derived(this.platform === 'mac');

	/** True if running on Windows */
	readonly isWindows = $derived(this.platform === 'windows');

	/** True if running on Linux */
	readonly isLinux = $derived(this.platform === 'linux');

	/** True if running in browser */
	readonly isBrowser = $derived(this.mode === 'browser');

	/** True if window controls (minimize/maximize/close) should be shown */
	readonly hasWindowControls = $derived(this.isApp);

	/** True if native clipboard API is available via Wails */
	readonly hasNativeClipboard = $derived(this.isApp);

	/** True if native browser opening is available via Wails */
	readonly hasNativeBrowser = $derived(this.isApp);
}

/**
 * Singleton instance of the environment service.
 */
export const environment = new EnvironmentService();
