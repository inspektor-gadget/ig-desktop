import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './tests',
	outputDir: 'test-results',
	snapshotPathTemplate: '{testDir}/screenshots/{projectName}/{arg}{ext}',
	fullyParallel: false,
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	reporter: [['list'], ['html', { open: 'never' }]],
	timeout: 60_000,
	expect: {
		timeout: 15_000,
		toHaveScreenshot: {
			animations: 'disabled',
			caret: 'hide',
			maxDiffPixelRatio: 0.001
		}
	},
	use: {
		baseURL: 'http://127.0.0.1:4173',
		browserName: 'chromium',
		viewport: { width: 1600, height: 1000 },
		locale: 'en-US',
		timezoneId: 'UTC',
		colorScheme: 'dark',
		reducedMotion: 'reduce',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},
	webServer: {
		// Demo mode (VITE_APP_MODE=demo) needs no live daemon/Docker: the DNS
		// map screenshots use static, fixture-derived demo data (see
		// scripts/generate-demo-dns-recent.ts) served entirely from
		// static/demo/. `vite preview` serves the SvelteKit adapter-static
		// build with correct SPA fallback routing for client-side routes
		// like /env/<id>.
		command: 'npm run build:demo && npm run preview -- --port 4173 --strictPort',
		url: 'http://127.0.0.1:4173/demo/config.json',
		reuseExistingServer: false,
		timeout: 180_000
	}
});
