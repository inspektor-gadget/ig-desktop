import type { IGThemeTokens } from './set-theme';

export const materialLight: IGThemeTokens = {
	primary: '#1976d2',
	primaryHover: '#1565c0',
	primaryMuted: 'rgba(25, 118, 210, 0.12)',
	surface: '#ffffff',
	surfaceRaised: '#f5f5f5',
	text: 'rgba(0, 0, 0, 0.87)',
	textSecondary: 'rgba(0, 0, 0, 0.6)',
	textMuted: 'rgba(0, 0, 0, 0.38)',
	textOnPrimary: '#ffffff',
	border: 'rgba(0, 0, 0, 0.12)',
	borderStrong: 'rgba(0, 0, 0, 0.23)',
	error: '#d32f2f',
	success: '#2e7d32',
	warning: '#ed6c02',
	radiusSm: '4px',
	radiusMd: '4px',
	radiusLg: '8px',
	fontSans: "'Roboto', 'Helvetica', 'Arial', sans-serif",
	fontMono: "'Roboto Mono', monospace"
};

export const materialDark: IGThemeTokens = {
	...materialLight,
	surface: '#121212',
	surfaceRaised: '#1e1e1e',
	text: 'rgba(255, 255, 255, 0.87)',
	textSecondary: 'rgba(255, 255, 255, 0.6)',
	textMuted: 'rgba(255, 255, 255, 0.38)',
	border: 'rgba(255, 255, 255, 0.12)',
	borderStrong: 'rgba(255, 255, 255, 0.23)',
	primary: '#90caf9',
	primaryHover: '#42a5f5',
	primaryMuted: 'rgba(144, 202, 249, 0.12)',
	textOnPrimary: 'rgba(0, 0, 0, 0.87)'
};
