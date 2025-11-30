/**
 * Global store for managing the settings dialog state with deep-linking support.
 * Allows opening the settings dialog and navigating directly to a specific category/setting.
 */

interface SettingsDialogState {
	open: boolean;
	targetCategory: string | null;
	targetSetting: string | null;
}

let state = $state<SettingsDialogState>({
	open: false,
	targetCategory: null,
	targetSetting: null
});

export const settingsDialog = {
	get open() {
		return state.open;
	},
	set open(value: boolean) {
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
