type PreferenceValue = number | boolean | string | any[];

interface PreferencesData {
	[key: string]: PreferenceValue;
}

class Preferences {
	preferences = $state<PreferencesData>(JSON.parse(window.localStorage['ig-preferences'] || '{}'));

	set(key: string, value: PreferenceValue): void {
		this.preferences[key] = value;
		window.localStorage['ig-preferences'] = JSON.stringify($state.snapshot(this.preferences));
	}

	get(key: string): PreferenceValue | undefined {
		return this.preferences[key];
	}

	getDefault(key: string, val: PreferenceValue): PreferenceValue {
		return this.preferences[key] !== undefined ? this.preferences[key] : val;
	}
}

export const preferences = new Preferences();
