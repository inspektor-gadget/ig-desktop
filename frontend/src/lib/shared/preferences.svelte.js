class Preferences {
	preferences = $state(JSON.parse(window.localStorage['ig-preferences'] || '{}'));

	/**
	 * @param {string} key
	 * @param {number | boolean | string} value
	 */
	set(key, value) {
		this.preferences[key] = value;
		window.localStorage['ig-preferences'] = JSON.stringify($state.snapshot(this.preferences));
	}

	/**
	 * @param {string} key
	 */
	get(key) {
		return this.preferences[key];
	}

	/**
	 * @param {string} key
	 * @param {number | boolean | string} val
	 */
	getDefault(key, val) {
		return this.preferences[key] !== undefined ? this.preferences[key] : val;
	}
}

export const preferences = new Preferences();
