/**
 * Application configuration schema
 *
 * Example setting structure:
 *
 * {
 *   key: 'settingName',           // Unique key for localStorage
 *   title: 'Setting Title',       // Display name
 *   description: 'Help text',     // Optional description
 *   type: 'toggle',               // toggle | select | text | number | range
 *   default: false                // Default value
 * }
 *
 * For select type, add:
 *   options: { value1: 'Label 1', value2: 'Label 2' }
 *
 * For number/range types, add:
 *   min: 0, max: 100, step: 10
 *
 * For range type, optionally add:
 *   unit: '%'
 */

import type { ConfigurationSchema } from './config.types';

export const configurationSchema: ConfigurationSchema = {
	categories: [
		{
			id: 'general',
			name: 'General',
			icon: '⚙️',
			settings: [
				{
					key: 'checkForUpdates',
					title: 'Check for updates on start',
					description:
						'Automatically check for new versions when the application starts. Connects to GitHub to fetch release information.',
					type: 'toggle',
					default: false
				}
			]
		},
		{
			id: 'appearance',
			name: 'Appearance',
			icon: '🎨',
			settings: [
				{
					key: 'gradientEnabled',
					title: 'Use gradients in design',
					description: 'Enable gradient background effect in the application',
					type: 'toggle',
					default: true
				}
			]
		}
	]
};
