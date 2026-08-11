import { expect, test, type Page } from '@playwright/test';

const EVENT_COUNT = 2000;

test.beforeEach(async ({ page }) => {
	await page.route('**/demo/recents/dns-map.json', async (route) => {
		const response = await route.fetch();
		const recent = await response.json();
		const source = recent.events as Array<{
			timestamp: number;
			data: Record<string, unknown>;
		}>;
		const startedAt = source[0].timestamp;
		recent.events = Array.from({ length: EVENT_COUNT }, (_, index) => {
			const original = source[index % source.length];
			const cycle = Math.floor(index / source.length);
			return {
				...original,
				id: index + 1,
				timestamp: startedAt + Math.floor(index / 20) * 25,
				data: {
					...original.data,
					id: `${String(original.data.id)}-${cycle}`,
					msgID: index,
					timestamp_raw: Number(original.data.timestamp_raw) + cycle * 100_000_000
				}
			};
		});
		await route.fulfill({ response, json: recent });
	});

	await page.addInitScript(() => {
		localStorage.setItem(
			'ig-configuration',
			JSON.stringify({
				theme: 'dark',
				maxEventsPerGadget: 10000,
				checkForUpdates: false,
				sendAnalytics: false
			})
		);
	});
});

async function startHeartbeat(page: Page) {
	await page.evaluate(() => {
		const samples: number[] = [];
		let previous = performance.now();
		window.setInterval(() => {
			const now = performance.now();
			samples.push(now - previous);
			previous = now;
		}, 50);
		Reflect.set(window, '__dnsLoadHeartbeat', samples);
	});
}

test('DNS Map catches up without starving the main thread', async ({ page }) => {
	test.setTimeout(30_000);
	await page.goto('/env/demo-env');
	await startHeartbeat(page);

	const startedAt = Date.now();
	await page.getByTitle('Run again').first().click();
	await expect(page).toHaveURL(/\/env\/demo-env\/running\/.+/);
	await page.getByRole('button', { name: 'DNS Map', exact: true }).click();

	await expect(page.getByText(`${EVENT_COUNT} events`, { exact: true })).toBeVisible();
	await expect(page.getByText('Stopped', { exact: true })).toBeVisible();
	await expect(page.locator('.dns-map-edge-card').first()).toBeVisible();

	const elapsedMs = Date.now() - startedAt;
	const maxHeartbeatDelayMs = await page.evaluate(() =>
		Math.max(...(Reflect.get(window, '__dnsLoadHeartbeat') as number[]))
	);

	expect(elapsedMs).toBeLessThan(8000);
	expect(maxHeartbeatDelayMs).toBeLessThan(500);
});
