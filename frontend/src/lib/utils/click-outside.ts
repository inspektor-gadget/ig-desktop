/**
 * Svelte action for detecting clicks outside an element.
 * Useful for closing dropdowns, menus, and modals.
 *
 * @example
 * <div use:clickOutside={{ enabled: menuOpen, onClickOutside: () => menuOpen = false }}>
 *   Menu content
 * </div>
 */

export interface ClickOutsideParams {
	/** Whether click-outside detection is active */
	enabled: boolean;
	/** Callback when a click outside is detected */
	onClickOutside: () => void;
	/** Optional element IDs to exclude from "outside" detection (e.g., trigger buttons) */
	excludeIds?: string[];
}

export function clickOutside(node: HTMLElement, params: ClickOutsideParams) {
	let { enabled, onClickOutside, excludeIds = [] } = params;

	function handleClick(event: MouseEvent) {
		if (!enabled) return;

		const target = event.target as Node;

		// Check if click is inside the node
		if (node.contains(target)) return;

		// Check if click is inside any excluded elements
		for (const id of excludeIds) {
			const excludedEl = document.getElementById(id);
			if (excludedEl?.contains(target)) return;
		}

		onClickOutside();
	}

	// Use capture phase to handle clicks before they bubble
	document.addEventListener('click', handleClick, true);

	return {
		update(newParams: ClickOutsideParams) {
			enabled = newParams.enabled;
			onClickOutside = newParams.onClickOutside;
			excludeIds = newParams.excludeIds ?? [];
		},
		destroy() {
			document.removeEventListener('click', handleClick, true);
		}
	};
}
