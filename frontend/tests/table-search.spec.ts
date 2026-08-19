import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		localStorage.setItem(
			'ig-configuration',
			JSON.stringify({
				theme: 'dark',
				designTheme: 'default',
				searchModeFilter: true,
				checkForUpdates: false,
				sendAnalytics: false
			})
		);
		localStorage.setItem('ig-start-count', '3');
		localStorage.setItem('ig-update-opt-in-shown', 'true');
		localStorage.setItem('ig-analytics-opt-in-shown', 'true');
	});
});

test('top-bar search filters datasource table rows', async ({ page }) => {
	await page.goto('/env/demo-env');
	await page
		.locator('.group\\/item')
		.filter({ hasText: 'top_process' })
		.getByTitle('Run again')
		.click();
	await expect(page).toHaveURL(/\/env\/demo-env\/running\/.+/);
	await expect(page.getByText('Stopped', { exact: true })).toBeVisible();

	const grid = page.getByRole('grid', { name: 'Gadget output: 155 rows' });
	await expect(grid).toContainText('dockerd');
	await expect(grid).toContainText('slirp4netns');

	await page.getByPlaceholder('Search...').fill('dockerd');

	await expect(page.getByRole('grid', { name: 'Gadget output: 1 rows' })).toContainText('dockerd');
	await expect(page.getByRole('grid')).not.toContainText('slirp4netns');

	await page.getByPlaceholder('Search...').fill('__no_such_process__');
	await expect(page.getByRole('grid', { name: 'Gadget output: 0 rows' })).toBeVisible();
});

test('top-bar search filters event-backed datasource table rows', async ({ page }) => {
	await page.goto('/env/demo-env');
	await page
		.locator('.group\\/item')
		.filter({ hasText: 'trace_open' })
		.getByTitle('Run again')
		.click();
	await expect(page).toHaveURL(/\/env\/demo-env\/running\/.+/);

	const grid = page.getByRole('grid', { name: /Gadget output: \d+ rows/ });
	await expect(grid).toContainText('lima-guestagent');
	await expect(grid).toContainText('ig');

	await page.getByPlaceholder('Search...').fill('lima-guestagent');

	await expect(page.getByRole('grid', { name: 'Gadget output: 1 rows' })).toContainText(
		'lima-guestagent'
	);
	await expect(page.getByRole('grid')).not.toContainText('ig');
});
