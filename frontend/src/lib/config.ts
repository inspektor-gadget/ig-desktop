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
				},
				{
					key: 'sendAnalytics',
					title: 'Send anonymized usage metrics',
					description: 'Help improve Inspektor Gadget Desktop by sending anonymous usage data.',
					type: 'toggle',
					default: false
				},
				{
					key: 'maxEventsPerGadget',
					title: 'Maximum events per gadget',
					description:
						'Limit the number of events shown per gadget instance to improve performance. Older events will be discarded.',
					type: 'number',
					min: 10,
					max: 10000,
					step: 10,
					default: 500
				},
				{
					key: 'searchModeFilter',
					title: 'Search mode: Filter entries',
					description:
						'When enabled, search filters out non-matching entries. When disabled, search highlights matching entries instead.',
					type: 'toggle',
					default: true
				},
				{
					key: 'searchHighlightInFilterMode',
					title: 'Highlight matches in filter mode',
					description:
						'When enabled, matching text is also highlighted when using filter mode. May impact performance.',
					type: 'toggle',
					default: false
				},
				{
					key: 'copyFormat',
					title: 'Copy format for rows',
					description:
						'Format used when copying selected rows to clipboard. CSV format is compatible with Excel and Google Sheets. Hold Alt while copying to exclude headers.',
					type: 'select',
					options: {
						csv: 'CSV (Excel/Sheets compatible)',
						json: 'JSON'
					},
					default: 'csv'
				}
			]
		},
		{
			id: 'appearance',
			name: 'Appearance',
			icon: '🎨',
			settings: [
				{
					key: 'theme',
					title: 'Theme',
					description:
						'Choose your preferred color scheme. System follows your OS preference.',
					type: 'select',
					options: {
						dark: 'Dark',
						light: 'Light',
						system: 'System'
					},
					default: 'dark'
				},
				{
					key: 'gradientEnabled',
					title: 'Use gradients in design',
					description: 'Enable gradient background effect in the application',
					type: 'toggle',
					default: true
				}
			]
		},
		{
			id: 'recordings',
			name: 'Recordings',
			icon: '🔴',
			requiredSetting: 'experimentalSessionRecording',
			settings: [
				{
					key: 'alwaysRecord',
					title: 'Always record',
					description:
						'Automatically record all gadget runs. Sessions will be created for each environment.',
					type: 'toggle',
					default: false
				},
				{
					key: 'singleSessionPerStart',
					title: 'Use single session per program start',
					description:
						'When enabled, all recordings within the same environment will be saved to a single session file per program start, instead of creating new sessions for each recording. Each environment maintains its own session.',
					type: 'toggle',
					default: false
				}
			]
		},
		{
			id: 'experimental',
			name: 'Experimental',
			icon: '🧪',
			settings: [
				{
					key: 'experimentalSessionRecording',
					title: 'Session Recording',
					description:
						'Enable session recording feature to capture and replay gadget runs. This feature is still being developed.',
					type: 'toggle',
					default: false
				}
			]
		}
	]
};
