/**
 * Configuration type definitions
 */

export type SettingType = 'toggle' | 'select' | 'text' | 'number' | 'range';

export interface BaseSetting {
	key: string;
	title: string;
	description?: string;
	type: SettingType;
}

export interface ToggleSetting extends BaseSetting {
	type: 'toggle';
	default: boolean;
}

export interface SelectSetting extends BaseSetting {
	type: 'select';
	options: Record<string, string>; // value -> label
	default: string;
}

export interface TextSetting extends BaseSetting {
	type: 'text';
	placeholder?: string;
	default: string;
}

export interface NumberSetting extends BaseSetting {
	type: 'number';
	min?: number;
	max?: number;
	step?: number;
	default: number;
}

export interface RangeSetting extends BaseSetting {
	type: 'range';
	min: number;
	max: number;
	step: number;
	unit?: string;
	default: number;
}

export type Setting = ToggleSetting | SelectSetting | TextSetting | NumberSetting | RangeSetting;

export interface Category {
	id: string;
	name: string;
	icon: string;
	settings: Setting[];
}

export interface ConfigurationSchema {
	categories: Category[];
}
