import type { IGThemeTokens } from './set-theme';

export const headlampLight: IGThemeTokens = {
	primary: '#0078d4',
	primaryHover: '#106ebe',
	primaryMuted: 'rgba(0, 120, 212, 0.12)',
	surface: '#ffffff',
	surfaceRaised: '#faf9f8',
	text: 'rgba(0, 0, 0, 0.87)',
	textSecondary: '#242424',
	textMuted: '#59636e',
	textOnPrimary: '#ffffff',
	border: 'rgba(0, 0, 0, 0.12)',
	borderStrong: 'rgba(0, 0, 0, 0.23)',
	error: '#c62828',
	success: '#2e7d32',
	warning: 'rgb(196, 69, 0)',
	radiusSm: '4px',
	radiusMd: '4px',
	radiusLg: '8px',
	fontSans: "'Overpass', sans-serif",
	fontMono: "'Overpass Mono', monospace"
};

export const headlampDark: IGThemeTokens = {
	...headlampLight,
	primary: '#4B99EE',
	primaryHover: '#6CB6F2',
	primaryMuted: 'rgba(75, 153, 238, 0.12)',
	surface: '#1f1f1f',
	surfaceRaised: '#1B1A19',
	text: '#ffffff',
	textSecondary: '#aeaeae',
	textMuted: '#6b7280',
	textOnPrimary: '#ffffff',
	border: 'rgba(255, 255, 255, 0.12)',
	borderStrong: 'rgba(255, 255, 255, 0.23)',
	error: '#E37D80',
	success: '#54B054',
	warning: 'rgb(255, 181, 104)'
};
