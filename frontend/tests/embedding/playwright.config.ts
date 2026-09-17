import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	testDir: '.',
	testMatch: '*.spec.ts',
	outputDir: '../../test-results/embedding',
	workers: 1,
	reporter: 'list',
	use: { baseURL: 'http://127.0.0.1:4175', browserName: 'chromium' },
	webServer: {
		cwd: fileURLToPath(new URL('../..', import.meta.url)),
		command:
			'npm run build:lib -- --outDir build-embedding && npx vite --config tests/embedding/vite.config.ts',
		url: 'http://127.0.0.1:4175/tests/embedding/',
		timeout: 180_000
	}
});
