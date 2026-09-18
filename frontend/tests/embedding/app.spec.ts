import { expect, test } from '@playwright/test';

const browserErrors: string[] = [];
test.beforeEach(async ({ page }, testInfo) => {
	browserErrors.length = 0;
	page.on('pageerror', (error) => browserErrors.push(error.message));
	await page.route('https://artifacthub.io/api/v1/packages/search**', (route) =>
		route.fulfill({
			json: {
				packages: [
					{
						name: 'fixture-gadget',
						normalized_name: 'fixture-gadget',
						description: 'A gadget',
						version: '1.0',
						repository: { name: 'fixture' }
					}
				]
			}
		})
	);
	if (!testInfo.title.includes('initial controlled')) {
		await page.goto('/tests/embedding/');
		await page.waitForFunction(() => window.embedding);
	}
});

test.afterEach(() => expect(browserErrors).toEqual([]));

test('restored controlled table survives metadata scheduling races', async ({ page }) => {
	test.skip(!process.env.IG_REACT_MODULES, 'Supply host React peers');
	await page.addInitScript(() =>
		localStorage.setItem('ig-preferences', JSON.stringify({ 'datasource.events.view': 'chart' }))
	);
	for (const delay of [-2, -1, 0, 1, 5, 25, 100, 0, 1, 5, 25, 100]) {
		const path = '/env/test-env/running/run-one';
		await page.goto(
			`/tests/embedding/react.html?restored&metadataDelay=${delay}&initialPath=${encodeURIComponent(path)}`
		);
		await expect(
			page.getByRole('grid', { name: 'Gadget output: 1 rows' }),
			`metadata delay ${delay}; history: ${JSON.stringify(await page.evaluate(() => window.embedding?.states))}`
		).toContainText('alpha');
		await expect
			.poll(() => page.evaluate(() => window.embedding.states.at(-1)?.result?.visualizers.events))
			.toBe('table');
		const results = await page.evaluate(() =>
			window.embedding.states.filter((state) => state.result)
		);
		expect(
			results.every((state) => state.result?.visualizers.events === 'table'),
			JSON.stringify(results)
		).toBe(true);
	}
});

test('restored React controls apply after asynchronous metadata despite saved chart preference', async ({
	page
}) => {
	test.skip(!process.env.IG_REACT_MODULES, 'Supply host React peers');
	await page.addInitScript(() =>
		localStorage.setItem('ig-preferences', JSON.stringify({ 'datasource.events.view': 'chart' }))
	);
	const path = '/env/test-env/running/run-one';
	await page.goto(`/tests/embedding/react.html?restored&initialPath=${encodeURIComponent(path)}`);
	await expect(page.getByRole('grid', { name: 'Gadget output: 1 rows' })).toContainText('alpha');
	await expect
		.poll(() => page.evaluate(() => window.embedding.states.at(-1)?.result?.visualizers.events))
		.toBe('table');
	await page.getByTitle('Environments', { exact: true }).click();
	await expect(page.getByText('Embedding environment', { exact: true })).toBeVisible();
	await page.evaluate(() => window.embedding.update({ path: '/env/test-env/running/run-one' }));
	await expect(page.getByRole('grid', { name: 'Gadget output: 1 rows' })).toContainText('alpha');
	await expect
		.poll(() => page.evaluate(() => window.embedding.states.at(-1)?.result?.visualizers.events))
		.toBe('table');
	await page.getByRole('button', { name: 'Chart', exact: true }).click();
	await expect
		.poll(() => page.evaluate(() => window.embedding.states.at(-1)?.result?.visualizers.events))
		.toBe('chart');
	await page.evaluate(() =>
		window.embedding.update({
			viewState: { search: '', visualizers: { events: 'table' } }
		})
	);
	await expect(page.getByRole('grid', { name: 'Gadget output: 1 rows' })).toContainText('alpha');
	await page.getByRole('button', { name: 'Chart', exact: true }).click();
	await expect
		.poll(() => page.evaluate(() => window.embedding.states.at(-1)?.result?.visualizers.events))
		.toBe('chart');
	await page.reload();
	await expect(page.getByRole('grid', { name: 'Gadget output: 1 rows' })).toContainText('alpha');
	await expect
		.poll(() => page.evaluate(() => window.embedding.states.at(-1)?.result?.visualizers.events))
		.toBe('table');
});

test('initial controlled result path never acknowledges the default home route', async ({
	page
}) => {
	const path = '/env/test-env/running/run-one';
	await page.goto(`/tests/embedding/?initialPath=${encodeURIComponent(path)}`);
	await page.waitForFunction(() => window.embedding);
	await expect(page.getByPlaceholder('Search...')).toBeVisible();
	expect(await page.evaluate(() => window.embedding.initialResultVisible)).toBe(true);
	const paths = await page.evaluate(() => window.embedding.states.map((state) => state.path));
	expect(paths.length).toBeGreaterThan(0);
	expect(paths.every((applied) => applied === path)).toBe(true);
});

test('toast actions expire, evict, run once, and report async failures', async ({ page }) => {
	const once = await page.evaluate(() => window.embedding.showToast());
	await expect
		.poll(() => page.evaluate((id) => window.embedding.triggerToast(id), once))
		.toBe('ok');
	await expect
		.poll(() => page.evaluate((id) => window.embedding.triggerToast(id), once))
		.toBe('missing');
	expect(await page.evaluate(() => window.embedding.toastClicks())).toBe(1);

	const expired = await page.evaluate(() => window.embedding.showToast(1));
	await page.waitForTimeout(10);
	await expect
		.poll(() => page.evaluate((id) => window.embedding.triggerToast(id), expired))
		.toBe('missing');

	const ids = await page.evaluate(() =>
		Array.from({ length: 6 }, () => window.embedding.showToast())
	);
	await expect
		.poll(() => page.evaluate((id) => window.embedding.triggerToast(id), ids[0]))
		.toBe('missing');
	const rejected = await page.evaluate(() => window.embedding.showToast(0, true));
	await expect
		.poll(() => page.evaluate((id) => window.embedding.triggerToast(id), rejected))
		.toBe('failed');
});

test('React provider preserves the initial controlled result path', async ({ page }) => {
	test.skip(
		!process.env.IG_REACT_MODULES,
		'Supply the host React peer modules to exercise its effects'
	);
	const path = '/env/test-env/running/run-one';
	await page.goto(`/tests/embedding/react.html?initialPath=${encodeURIComponent(path)}`);
	await page.waitForFunction(() => window.embedding);
	await expect(page.getByPlaceholder('Search...')).toBeVisible();
	const paths = await page.evaluate(() => window.embedding.states.map((state) => state.path));
	expect(paths.length).toBeGreaterThan(0);
	expect(paths.every((applied) => applied === path)).toBe(true);
});

test('React provider initializes transport before initial controlled create screen', async ({
	page
}) => {
	test.skip(
		!process.env.IG_REACT_MODULES,
		'Supply the host React peer modules to exercise its effects'
	);
	const path = '/environment/create';
	await page.goto(`/tests/embedding/react.html?initialPath=${encodeURIComponent(path)}`);
	await page.waitForFunction(() => window.embedding);
	await expect(page.getByText('Create Environment', { exact: true }).first()).toBeVisible();
	await expect
		.poll(() =>
			page.evaluate(() =>
				window.embedding.requests.some((request) => request.cmd === 'getRuntimes')
			)
		)
		.toBe(true);
	expect(
		await page.evaluate(() =>
			window.embedding.states.every((state) => state.path === '/environment/create')
		)
	).toBe(true);
});

test('transient launchers keep target fixed and do not record or persist launch history', async ({
	page
}) => {
	await page.evaluate(() =>
		window.embedding.update({
			path: '/gadgets/run/test/image:latest',
			launchPreset: {
				image: 'test/image:latest',
				environmentID: 'test-env',
				params: { pid: '42' },
				transient: true,
				record: true,
				detached: true,
				sessionName: 'must-not-record'
			}
		})
	);
	await expect(page.getByText('test/image:latest', { exact: true }).first()).toBeVisible();
	await expect(page.locator('select').first()).toBeDisabled();
	await expect(
		page.getByText(
			'Ad-hoc Kubernetes target: not saved. Only foreground, unrecorded runs are available.'
		)
	).toBeVisible();
	await expect(page.getByText('Detached', { exact: true })).toHaveCount(0);
	await expect(page.getByText('PID', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Run Gadget', exact: true }).click();
	await expect
		.poll(() =>
			page.evaluate(
				() => window.embedding.requests.filter((request) => request.cmd === 'runGadget').length
			)
		)
		.toBe(1);
	const request = await page.evaluate(
		() => window.embedding.requests.find((request) => request.cmd === 'runGadget')!.data
	);
	expect(request?.environmentID).toBe('test-env');
	expect(request?.detached).toBe(false);
	expect(request?.record).toBe(false);
	expect(request?.sessionId).toBeUndefined();
	expect(request?.sessionName).toBeUndefined();
	expect(request?.params).toEqual({ pid: '42' });
	expect(await page.evaluate(() => localStorage.getItem('env:test-env:gadget-history'))).toBeNull();
	expect(
		await page.evaluate(() => localStorage.getItem('env:test-env:gadget-url-recent'))
	).toBeNull();
});

test('file output is host-opt-in, requires a destination, and opens its status without table data', async ({
	page
}) => {
	await page.goto(
		'/tests/embedding/?fileOutput&initialPath=%2Fgadgets%2Frun%2Ftest%2Fimage%3Alatest'
	);
	await page.waitForFunction(() => window.embedding);
	await page.locator('select').first().selectOption('test-env');
	await expect(page.getByText('Parameters', { exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Mode', exact: true })).toBeVisible();
	await page.getByLabel('Mode', { exact: true }).selectOption({ label: 'To a file' });
	await expect(page.getByRole('button', { name: 'Run Gadget', exact: true })).toBeDisabled();
	await page.getByRole('button', { name: 'Choose destination', exact: true }).click();
	await expect(
		page.getByText('/captures/capture.jsonl (test host)', { exact: true })
	).toBeVisible();
	await page.getByRole('button', { name: 'Run Gadget', exact: true }).click();
	await expect(page.getByText('File capture', { exact: true })).toBeVisible();
	const request = await page.evaluate(
		() => window.embedding.requests.findLast((entry) => entry.cmd === 'runGadget')?.data
	);
	expect(request).toMatchObject({
		detached: false,
		record: false,
		output: { token: 'selected-once', format: 'jsonl' }
	});
});

test('file mode stays hidden without an explicit host capability', async ({ page }) => {
	await page.evaluate(() =>
		window.embedding.update({
			path: '/gadgets/run/test/image:latest?env=test-env',
			fileOutput: undefined
		})
	);
	await expect(page.getByText('Parameters', { exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Mode', exact: true })).toHaveCount(0);
});

test('external link overrides restore the normal browser fallback', async ({ page }) => {
	expect(await page.evaluate(() => window.embedding.externalLinks())).toEqual([
		{ kind: 'host', url: 'https://example.com/host' },
		{
			kind: 'browser',
			url: 'https://example.com/browser',
			target: '_blank',
			features: 'noopener,noreferrer'
		}
	]);
});

test('reuses environment, discovery, launcher and replay screens without navigation side effects', async ({
	page
}) => {
	await expect(page.getByText('Embedding environment', { exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Ready to explore?', exact: true })).toHaveClass(
		/bg-gradient-to-r/
	);
	await page.getByTitle('Create Environment').click();
	await expect(page.getByText('Create Environment', { exact: true }).first()).toBeVisible();
	await page.getByTitle('Gadget Gallery').click();
	await expect(page.getByText('fixture-gadget', { exact: true })).toBeVisible();
	await page.getByText('fixture-gadget', { exact: true }).click();
	await expect(page.getByText('test/image:latest')).toBeVisible();
	await page.evaluate(() =>
		window.embedding.update({
			path: '/gadgets/run/test/image:latest?env=test-env&params=%7B%22pid%22%3A%2242%22%7D'
		})
	);
	await expect(page.getByText('test/image:latest', { exact: true }).first()).toBeVisible();
	await expect
		.poll(() =>
			page
				.locator('input')
				.evaluateAll((inputs) =>
					inputs.some((input) => input instanceof HTMLInputElement && input.value === '42')
				)
		)
		.toBe(true);
	expect(
		await page.evaluate(() => window.embedding.requests.some((r) => r.cmd === 'runGadget'))
	).toBe(false);
	await page.getByText('Record to Session', { exact: true }).click();
	await page.getByRole('button', { name: 'Run Gadget', exact: true }).click();
	await expect(page.getByPlaceholder('Search...')).toBeVisible();
	expect(
		await page.evaluate(() => window.embedding.requests.find((r) => r.cmd === 'runGadget')?.data)
	).toMatchObject({
		image: 'test/image:latest',
		environmentID: 'test-env',
		params: { pid: '42' },
		record: true
	});
	await page.evaluate(() => window.embedding.update({ path: '/env/test-env' }));
	await expect(page.getByText('Detached gadget', { exact: true })).toBeVisible();
	await expect(page.getByText('Saved capture', { exact: true })).toBeVisible();
	await page.getByTitle('Attach', { exact: true }).click();
	await expect(page.getByPlaceholder('Search...')).toBeVisible();
	expect(
		await page.evaluate(
			() => window.embedding.requests.find((r) => r.cmd === 'attachInstance')?.data
		)
	).toMatchObject({
		image: 'remote-one',
		environmentID: 'test-env'
	});
	await page.evaluate(() => window.embedding.update({ path: '/env/test-env' }));
	await page.getByTitle('Delete', { exact: true }).click();
	expect(
		await page.evaluate(() => window.embedding.requests.some((r) => r.cmd === 'removeInstance'))
	).toBe(false);
	await page.getByRole('button', { name: 'Remove', exact: true }).click();
	await expect
		.poll(() =>
			page.evaluate(() => window.embedding.requests.find((r) => r.cmd === 'removeInstance')?.data)
		)
		.toEqual({
			environmentID: 'test-env',
			id: 'remote-one'
		});
	await page.evaluate(() => window.embedding.update({ path: '/sessions/saved' }));
	await expect(page.getByText('Saved capture', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'View Results' }).click();
	await expect(page.getByPlaceholder('Search...')).toBeVisible();
});

test('acknowledges actual result controls, manual changes and public disconnect cancellation', async ({
	page
}) => {
	await page.evaluate(() =>
		window.embedding.update({
			path: '/env/test-env/running/run-one',
			viewState: { search: 'alpha', visualizers: { events: 'table' } }
		})
	);
	await expect(page.getByRole('grid', { name: 'Gadget output: 1 rows' })).toContainText('alpha');
	await expect
		.poll(() => page.evaluate(() => window.embedding.states.at(-1)?.result?.search))
		.toBe('alpha');
	await page.getByPlaceholder('Search...').fill('beta');
	await expect
		.poll(() => page.evaluate(() => window.embedding.states.at(-1)?.result?.search))
		.toBe('beta');
	await expect(page.getByRole('grid', { name: 'Gadget output: 1 rows' })).toContainText('beta');
	await page.getByRole('button', { name: 'Chart', exact: true }).click();
	await expect
		.poll(() => page.evaluate(() => window.embedding.states.at(-1)?.result?.visualizers.events))
		.toBe('chart');
	await page.evaluate(() =>
		window.embedding.update({ viewState: { search: 'alpha', visualizers: { events: 'table' } } })
	);
	await expect(page.getByRole('grid', { name: 'Gadget output: 1 rows' })).toContainText('alpha');
	await expect
		.poll(() => page.evaluate(() => window.embedding.states.at(-1)?.result?.visualizers.events))
		.toBe('table');
	await page.evaluate(() =>
		window.embedding.update({ viewState: { search: '', visualizers: { events: 'not-a-plugin' } } })
	);
	await expect
		.poll(() => page.evaluate(() => window.embedding.states.at(-1)?.result?.visualizers.events))
		.toBe('chart');
	await page.evaluate(() =>
		window.embedding.update({ viewState: { search: '', visualizers: { events: 'table' } } })
	);
	await expect(page.getByRole('grid', { name: 'Gadget output: 2 rows' })).toBeVisible();
	expect(await page.evaluate(() => window.embedding.cancelPending())).toBe(true);
});

test('malformed host paths render not-found instead of crashing the application', async ({
	page
}) => {
	for (const path of ['env/test-env', '/env/%E0%A4%A', '/\\example.org']) {
		await page.evaluate((path) => window.embedding.update({ path }), path);
		await expect(page.getByText('Page not found', { exact: true })).toBeVisible();
		await page.evaluate(() => window.embedding.update({ path: '/env/test-env' }));
		await expect(page.getByText('Page not found', { exact: true })).toHaveCount(0);
	}
	expect(await page.evaluate(() => location.host)).toBe('127.0.0.1:4175');
});
