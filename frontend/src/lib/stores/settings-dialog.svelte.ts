import { overrideStack } from '$lib/utils/override-stack';

/**
 * Global store for managing the settings dialog state with deep-linking support.
 * Allows opening the settings dialog and navigating directly to a specific category/setting.
 */

interface SettingsDialogState {
	open: boolean;
	targetCategory: string | null;
	targetSetting: string | null;
	hostManaged: boolean;
}

const state = $state<SettingsDialogState>({
	open: false,
	targetCategory: null,
	targetSetting: null,
	hostManaged: false
});

const hostOpeners = overrideStack<(category?: string, setting?: string) => void>();

export const settingsDialog = {
	/** Cleanup removes only this opener, so out-of-order cleanup never reinstalls a disposed one. */
	setOpener(opener: (category?: string, setting?: string) => void) {
		return hostOpeners.push(opener);
	},
	get hostManaged() {
		return state.hostManaged;
	},
	set hostManaged(value: boolean) {
		state.hostManaged = value;
	},
	get open() {
		return state.open;
	},
	set open(value: boolean) {
		const hostOpener = hostOpeners.current;
		if (value && hostOpener) {
			hostOpener(state.targetCategory ?? undefined, state.targetSetting ?? undefined);
			return;
		}
		state.open = value;
		if (!value) {
			// Clear targets when closing
			state.targetCategory = null;
			state.targetSetting = null;
		}
	},
	get targetCategory() {
		return state.targetCategory;
	},
	get targetSetting() {
		return state.targetSetting;
	},

	/**
	 * Open the settings dialog, optionally navigating to a specific category and setting.
	 * @param category - The category ID to navigate to (e.g., 'general', 'appearance')
	 * @param setting - The setting key to highlight (e.g., 'maxEventsPerGadget')
	 */
	openTo(category?: string, setting?: string) {
		const hostOpener = hostOpeners.current;
		if (hostOpener) {
			hostOpener(category, setting);
			return;
		}
		state.targetCategory = category ?? null;
		state.targetSetting = setting ?? null;
		state.open = true;
	},

	/**
	 * Close the settings dialog and clear any targets.
	 */
	close() {
		state.open = false;
		state.targetCategory = null;
		state.targetSetting = null;
	},

	/**
	 * Clear the target setting (called after highlighting is complete).
	 */
	clearTarget() {
		state.targetCategory = null;
		state.targetSetting = null;
	}
};
