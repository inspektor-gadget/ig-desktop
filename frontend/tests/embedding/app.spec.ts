import { expect, test, type Page } from '@playwright/test';

/** Asserts that no matching command is sent, now or after the page settles. */
async function expectNoRequests(page: Page, commands: string[], settleMs = 300) {
	const matching = () =>
		page.evaluate(
			(commands) => window.embedding.requests.filter((request) => commands.includes(request.cmd)),
			commands
		);
	expect(await matching()).toEqual([]);
	await page.evaluate(
		(settleMs) =>
			new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, settleMs))),
		settleMs
	);
	expect(await matching()).toEqual([]);
}

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

test('cell interaction embedding is opt-in and forwards the originating instance and schema', async ({
	page
}) => {
	for (const enabled of [false, true]) {
		await page.goto(
			`/tests/embedding/?initialPath=/env/test-env/running/run-one${enabled ? '&cellActions' : ''}`
		);
		await page.getByText('Table', { exact: true }).click();
		const cell = page
			.getByRole('gridcell')
			.filter({ hasText: /^alpha$/ })
			.first();
		await cell.click({ button: 'right' });
		expect(await page.evaluate(() => window.embedding.cellEvents)).toEqual(
			enabled
				? [
						{
							instanceID: 'run-one',
							datasource: 'events',
							row: { comm: 'alpha' },
							fieldAnnotations: {}
						}
					]
				: []
		);
		await expectNoRequests(page, ['runGadget']);
	}
});

test('metadata-based launch prefills are opt-in, preserve edits and warn on a different target', async ({
	page
}) => {
	await page.goto('/tests/embedding/?extraEnvironment&fileOutput&pcap');
	await page.waitForFunction(() => window.embedding);
	await page.evaluate(() =>
		window.embedding.update({
			path: '/gadgets/run/test/image:latest?env=test-env'
		})
	);
	const pid = page.getByRole('textbox', { name: 'PID', exact: true });
	await expect(pid).toHaveValue('');
	await expect(page.getByRole('alert')).toHaveCount(0);
	await page.evaluate(() =>
		window.embedding.update({
			path: '/gadgets/run/test/image:latest?env=test-env&context=1',
			resolveLaunchParameters: (
				metadata,
				environmentID
			): { params: Record<string, string>; warnings?: string[] } =>
				environmentID === 'test-env' && metadata.params?.some((param) => param.key === 'pid')
					? { params: { pid: '123' } }
					: { params: {}, warnings: ['The selected process filter is unavailable.'] }
		})
	);
	await expect(pid).toHaveValue('123');
	await pid.fill('456');
	await page.evaluate(() => window.embedding.update({ homeTitle: 'Unrelated host update' }));
	await expect(pid).toHaveValue('456');
	await page.locator('select').first().selectOption('other-env');
	await expect(pid).toHaveValue('');
	await expect(page.getByRole('alert')).toHaveText('The selected process filter is unavailable.');
	await expectNoRequests(page, ['runGadget']);
	await page.getByRole('button', { name: 'Run Gadget', exact: true }).click();
	await expect
		.poll(() =>
			page.evaluate(
				() => window.embedding.requests.filter((request) => request.cmd === 'runGadget').length
			)
		)
		.toBe(1);
	expect(
		await page.evaluate(
			() =>
				window.embedding.requests.findLast((request) => request.cmd === 'runGadget')?.data?.params
		)
	).toEqual({});
});

test('empty welcome header honors the plain host title without changing the default', async ({
	page
}) => {
	await page.goto('/tests/embedding/?empty');
	const heading = page.getByRole('heading', { level: 1 });
	await expect(heading).toHaveText('Welcome!');
	expect(await heading.evaluate((node) => getComputedStyle(node).backgroundImage)).not.toBe('none');
	await page.evaluate(() => window.embedding.update({ homeTitle: 'Inspektor Gadget' }));
	await expect(heading).toHaveText('Inspektor Gadget');
	expect(await heading.evaluate((node) => getComputedStyle(node).backgroundImage)).toBe('none');
	expect(await heading.evaluate((node) => getComputedStyle(node).color)).not.toBe(
		'rgba(0, 0, 0, 0)'
	);
});

test('Kubernetes dashboard requires confirmed absence and explicit deployment, then recovers', async ({
	page
}) => {
	await page.goto('/tests/embedding/?dashboard=loading&initialPath=/env/test-env');
	await expect(page.getByText('Headless Gadget Instances', { exact: true })).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Deploy Inspektor Gadget', exact: true })
	).toHaveCount(0);
	await expect(page.getByText('Recorded Sessions', { exact: true })).toBeVisible();
	await page.evaluate(() => window.embedding.dashboard('missing'));
	await expect(
		page.getByText('No valid Inspektor Gadget deployment was found', { exact: false })
	).toBeVisible();
	await expect(page.getByText('Headless Gadget Instances', { exact: true })).toHaveCount(0);
	await expect(page.getByText('Run Gadget', { exact: true })).toHaveCount(0);
	await expect(page.getByText('Recorded Sessions', { exact: true })).toBeVisible();
	expect(
		await page.evaluate(() =>
			window.embedding.requests.filter((r) => r.cmd === 'deployIG' || r.cmd === 'getChartValues')
		)
	).toEqual([]);
	await page.getByRole('button', { name: 'Deploy Inspektor Gadget', exact: true }).click();
	const modal = page.getByRole('dialog');
	await expect(
		modal.getByRole('heading', { name: 'Deploy Inspektor Gadget to Kubernetes' })
	).toBeVisible();
	await expect(modal.getByLabel('Namespace', { exact: true })).toHaveValue('custom-gadget');
	await expect(modal.getByLabel('Namespace', { exact: true })).toBeDisabled();
	expect(
		await page.evaluate(() => window.embedding.requests.filter((r) => r.cmd === 'deployIG'))
	).toEqual([]);
	await modal.getByRole('button', { name: 'Deploy', exact: true }).click();
	await expect(page.getByText('Headless Gadget Instances', { exact: true })).toBeVisible();
	await expect(
		page.getByText('No valid Inspektor Gadget deployment was found', { exact: false })
	).toHaveCount(0);
	await expect(page.getByText('Recorded Sessions', { exact: true })).toBeVisible();
	const requests = await page.evaluate(() =>
		window.embedding.requests.filter((r) => r.cmd === 'deployIG')
	);
	expect(requests).toHaveLength(1);
	expect(requests[0].data).toMatchObject({
		environmentID: 'test-env',
		namespace: 'custom-gadget',
		redeploy: false,
		undeploy: false
	});
});

test('Kubernetes errors, connected state and non-Kubernetes dashboards never offer deployment', async ({
	page
}) => {
	for (const scenario of ['error', 'uncertain', 'connected', 'missing&nonK8s']) {
		await page.goto(`/tests/embedding/?dashboard=${scenario}&initialPath=/env/test-env`);
		await expect(page.getByText('Headless Gadget Instances', { exact: true })).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Deploy Inspektor Gadget', exact: true })
		).toHaveCount(0);
		await expect(page.getByText('Recorded Sessions', { exact: true })).toBeVisible();
		expect(
			await page.evaluate(() => window.embedding.requests.filter((r) => r.cmd === 'deployIG'))
		).toEqual([]);
	}
});

test('host deployment dialog preparation is opt-in and never executes by itself', async ({
	page
}) => {
	await page.goto(
		'/tests/embedding/?dashboard=connected&initialPath=/env/test-env?deployment=undeploy'
	);
	await expect(page.getByText('Headless Gadget Instances', { exact: true })).toBeVisible();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	for (const action of ['deploy', 'redeploy', 'undeploy'] as const) {
		await page.evaluate(
			(action) =>
				window.embedding.update({
					path: `/env/test-env?request=${action}`,
					environmentDeployment: { action, namespace: 'host-namespace' }
				}),
			action
		);
		const modal = page.getByRole('dialog');
		await expect(
			modal.getByRole('button', { name: action[0].toUpperCase() + action.slice(1), exact: true })
		).toBeVisible();
		await expect(modal.getByLabel('Namespace', { exact: true })).toHaveValue('host-namespace');
		await expectNoRequests(page, ['deployIG']);
		await modal.getByRole('button', { name: 'Close (Force)', exact: true }).click();
		await expect(modal).toHaveCount(0);
	}
});

test('a failed Kubernetes recheck clears the old deployment offer', async ({ page }) => {
	await page.clock.install();
	await page.goto('/tests/embedding/?dashboard=missing&initialPath=/env/test-env');
	await expect(
		page.getByRole('button', { name: 'Deploy Inspektor Gadget', exact: true })
	).toBeVisible();
	await page.evaluate(() => window.embedding.dashboard('error'));
	await page.clock.fastForward(7_000);
	await expect(page.getByText('Headless Gadget Instances', { exact: true })).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Deploy Inspektor Gadget', exact: true })
	).toHaveCount(0);
	await expect(page.getByText('Recorded Sessions', { exact: true })).toBeVisible();
});

test('restricted app mode never offers Kubernetes deployment', async ({ page }) => {
	test.skip(process.env.VITE_APP_MODE !== 'single-env', 'Requires the restricted app-mode build');
	await page.goto('/tests/embedding/?dashboard=missing&initialPath=/env/test-env');
	await expect(page.getByText('Headless Gadget Instances', { exact: true })).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Deploy Inspektor Gadget', exact: true })
	).toHaveCount(0);
	await expect(page.getByText('Recorded Sessions', { exact: true })).toBeVisible();
	expect(
		await page.evaluate(() => window.embedding.requests.filter((r) => r.cmd === 'deployIG'))
	).toEqual([]);
});

test('Kubernetes deployment rejection stays visible without disconnecting the dashboard', async ({
	page
}) => {
	await page.goto('/tests/embedding/?dashboard=missing&deployError&initialPath=/env/test-env');
	await page.getByRole('button', { name: 'Deploy Inspektor Gadget', exact: true }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Deploy', exact: true }).click();
	await expect(page.getByRole('alert')).toHaveText('fixture deployment forbidden');
	await page.getByTitle('Close (Force)').click();
	await expect(page.getByText('Recorded Sessions', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Deploy Inspektor Gadget', exact: true }).click();
	await expect(page.getByRole('dialog')).toBeVisible();
});

test('Helm ownership conflict requires explicit cleanup confirmation before redeployment', async ({
	page
}) => {
	await page.goto(
		'/tests/embedding/?dashboard=missing&ownershipConflict&initialPath=/env/test-env'
	);
	await page.getByRole('button', { name: 'Deploy Inspektor Gadget', exact: true }).click();
	const modal = page.getByRole('dialog');
	await modal.getByRole('button', { name: 'Deploy', exact: true }).click();
	await expect(
		modal.getByRole('heading', { name: 'Deployment Failed', exact: true })
	).toBeVisible();
	await modal.getByRole('button', { name: 'Clean up and redeploy...', exact: true }).click();
	await expect(
		modal.getByText('Unidentified resources will not be deleted', { exact: false })
	).toBeVisible();
	await expect(modal.getByText('suspend its reconciliation first', { exact: false })).toBeVisible();
	await modal.getByRole('button', { name: 'Cancel cleanup', exact: true }).click();
	expect(
		await page.evaluate(() => window.embedding.requests.filter((r) => r.cmd === 'deployIG'))
	).toHaveLength(1);
	await modal.getByRole('button', { name: 'Clean up and redeploy...', exact: true }).click();
	await modal.getByRole('button', { name: 'Confirm cleanup and redeploy', exact: true }).click();
	await expect(page.getByText('Headless Gadget Instances', { exact: true })).toBeVisible();
	await expect(page.getByText('Recorded Sessions', { exact: true })).toBeVisible();
	const requests = await page.evaluate(() =>
		window.embedding.requests.filter((r) => r.cmd === 'deployIG')
	);
	expect(requests).toHaveLength(2);
	expect(requests[0].data).toMatchObject({ redeploy: false, undeploy: false });
	expect(requests[1].data).toEqual({ ...requests[0].data, redeploy: true });
});

test('deployment error text alone does not enable destructive recovery', async ({ page }) => {
	await page.goto(
		'/tests/embedding/?dashboard=missing&unclassifiedConflict&initialPath=/env/test-env'
	);
	await page.getByRole('button', { name: 'Deploy Inspektor Gadget', exact: true }).click();
	const modal = page.getByRole('dialog');
	await modal.getByRole('button', { name: 'Deploy', exact: true }).click();
	await expect(
		modal.getByRole('heading', { name: 'Deployment Failed', exact: true })
	).toBeVisible();
	await expect(
		modal.getByRole('button', { name: 'Clean up and redeploy...', exact: true })
	).toHaveCount(0);
	expect(
		await page.evaluate(() => window.embedding.requests.filter((r) => r.cmd === 'deployIG'))
	).toHaveLength(1);
});

test('unlabeled chart conflicts require approval of each exact resource and forget cancelled approval', async ({
	page
}) => {
	await page.goto(
		'/tests/embedding/?dashboard=missing&ownershipConflict&exactConflicts&initialPath=/env/test-env'
	);
	await page.getByRole('button', { name: 'Deploy Inspektor Gadget', exact: true }).click();
	const modal = page.getByRole('dialog');
	await modal.getByRole('button', { name: 'Deploy', exact: true }).click();
	await modal.getByRole('button', { name: 'Clean up and redeploy...', exact: true }).click();
	const confirm = modal.getByRole('button', { name: 'Confirm cleanup and redeploy', exact: true });
	const configmap = modal.getByRole('checkbox', {
		name: 'Approve deletion of ConfigMap custom-gadget/gadget',
		exact: true
	});
	const serviceAccount = modal.getByRole('checkbox', {
		name: 'Approve deletion of ServiceAccount custom-gadget/gadget',
		exact: true
	});
	await expect(confirm).toBeDisabled();
	await configmap.check();
	await expect(confirm).toBeDisabled();
	await serviceAccount.check();
	await expect(confirm).toBeEnabled();
	await modal.getByRole('button', { name: 'Cancel cleanup', exact: true }).click();
	expect(
		await page.evaluate(() => window.embedding.requests.filter((r) => r.cmd === 'deployIG'))
	).toHaveLength(1);
	await modal.getByRole('button', { name: 'Clean up and redeploy...', exact: true }).click();
	await expect(configmap).not.toBeChecked();
	await expect(serviceAccount).not.toBeChecked();
	await configmap.check();
	await serviceAccount.check();
	await confirm.click();
	await expect(page.getByText('Headless Gadget Instances', { exact: true })).toBeVisible();
	const requests = await page.evaluate(() =>
		window.embedding.requests.filter((r) => r.cmd === 'deployIG')
	);
	expect(requests).toHaveLength(2);
	expect(requests[1].data).toEqual({
		...requests[0].data,
		redeploy: true,
		cleanupResources: [
			{
				apiVersion: 'v1',
				kind: 'ConfigMap',
				namespace: 'custom-gadget',
				name: 'gadget',
				uid: 'configmap-uid',
				resourceVersion: '17'
			},
			{
				apiVersion: 'v1',
				kind: 'ServiceAccount',
				namespace: 'custom-gadget',
				name: 'gadget',
				uid: 'serviceaccount-uid',
				resourceVersion: '23'
			}
		]
	});
});

test('controller-owned chart conflicts block exact cleanup', async ({ page }) => {
	await page.goto(
		'/tests/embedding/?dashboard=missing&ownershipConflict&exactConflicts&blockedConflict&initialPath=/env/test-env'
	);
	await page.getByRole('button', { name: 'Deploy Inspektor Gadget', exact: true }).click();
	const modal = page.getByRole('dialog');
	await modal.getByRole('button', { name: 'Deploy', exact: true }).click();
	await modal.getByRole('button', { name: 'Clean up and redeploy...', exact: true }).click();
	await modal
		.getByRole('checkbox', {
			name: 'Approve deletion of ConfigMap custom-gadget/gadget',
			exact: true
		})
		.check();
	await expect(
		modal.getByRole('checkbox', {
			name: 'Approve deletion of ServiceAccount custom-gadget/gadget',
			exact: true
		})
	).toBeDisabled();
	await expect(
		modal.getByText('This resource has a Kubernetes owner reference.', { exact: true })
	).toBeVisible();
	await expect(
		modal.getByRole('button', { name: 'Confirm cleanup and redeploy', exact: true })
	).toBeDisabled();
	expect(
		await page.evaluate(() => window.embedding.requests.filter((r) => r.cmd === 'deployIG'))
	).toHaveLength(1);
});

test('changed conflict identities require fresh approval instead of reusing the old confirmation', async ({
	page
}) => {
	await page.goto(
		'/tests/embedding/?dashboard=missing&ownershipConflict&exactConflicts&changedConflict&initialPath=/env/test-env'
	);
	await page.getByRole('button', { name: 'Deploy Inspektor Gadget', exact: true }).click();
	const modal = page.getByRole('dialog');
	await modal.getByRole('button', { name: 'Deploy', exact: true }).click();
	await modal.getByRole('button', { name: 'Clean up and redeploy...', exact: true }).click();
	await modal
		.getByRole('checkbox', {
			name: 'Approve deletion of ConfigMap custom-gadget/gadget',
			exact: true
		})
		.check();
	await modal
		.getByRole('checkbox', {
			name: 'Approve deletion of ServiceAccount custom-gadget/gadget',
			exact: true
		})
		.check();
	await modal.getByRole('button', { name: 'Confirm cleanup and redeploy', exact: true }).click();
	await expect(
		modal.getByText('The approved ConfigMap changed. Review and confirm the current resources.', {
			exact: true
		})
	).toBeVisible();
	await modal.getByRole('button', { name: 'Clean up and redeploy...', exact: true }).click();
	await expect(
		modal.getByRole('checkbox', {
			name: 'Approve deletion of ConfigMap custom-gadget/gadget',
			exact: true
		})
	).not.toBeChecked();
	await expect(
		modal.getByRole('button', { name: 'Confirm cleanup and redeploy', exact: true })
	).toBeDisabled();
	expect(
		await page.evaluate(() => window.embedding.requests.filter((r) => r.cmd === 'deployIG'))
	).toHaveLength(2);
	await modal.getByRole('button', { name: 'Try Again', exact: true }).click();
	await modal.getByRole('button', { name: 'Deploy', exact: true }).click();
	await expect(
		modal.getByRole('heading', { name: 'Deployment Failed', exact: true })
	).toBeVisible();
	const retry = await page.evaluate(() =>
		window.embedding.requests.filter((r) => r.cmd === 'deployIG').at(-1)
	);
	expect(retry?.data?.cleanupResources).toBeUndefined();
	expect(retry?.data?.redeploy).toBe(false);
});

test('malformed conflict metadata cannot fall back to label-based cleanup', async ({ page }) => {
	for (const [scenario, message] of [
		['malformedConflicts', 'Invalid resource conflict metadata.'],
		['emptyConflicts', 'No current conflicting resource details are available.']
	]) {
		await page.goto(
			`/tests/embedding/?dashboard=missing&ownershipConflict&${scenario}&initialPath=/env/test-env`
		);
		await page.getByRole('button', { name: 'Deploy Inspektor Gadget', exact: true }).click();
		const modal = page.getByRole('dialog');
		await modal.getByRole('button', { name: 'Deploy', exact: true }).click();
		await expect(modal.getByText(message, { exact: false }).first()).toBeVisible();
		await expect(
			modal.getByRole('button', { name: 'Clean up and redeploy...', exact: true })
		).toHaveCount(0);
		expect(
			await page.evaluate(() => window.embedding.requests.filter((r) => r.cmd === 'deployIG'))
		).toHaveLength(1);
	}
});

test('undeploy explains installation detection and presents operation-specific failures', async ({
	page
}) => {
	await page.goto('/tests/embedding/?undeploy');
	await expect(
		page.getByText('The existing Helm release is detected automatically', { exact: false })
	).toBeVisible();
	await expect(page.getByText('suspend its reconciliation first', { exact: false })).toBeVisible();
	await page.getByRole('button', { name: 'Undeploy', exact: true }).click();
	await expect(
		page.getByRole('heading', { name: 'Undeployment Failed', exact: true })
	).toBeVisible();
	await expect(page.getByText('fixture permission denied', { exact: true }).first()).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Clean up and redeploy...', exact: true })
	).toHaveCount(0);
	const requests = await page.evaluate(() => window.embedding.requests);
	expect(requests.filter((request) => request.cmd === 'deployIG')).toHaveLength(1);
	expect(requests.find((request) => request.cmd === 'deployIG')?.data).toMatchObject({
		namespace: 'gadget',
		releaseName: 'gadget',
		kubeContext: 'fixture-context',
		undeploy: true
	});
	expect(requests.some((request) => request.cmd === 'getChartValues')).toBe(false);
});

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
	const fileModeNote = page.getByText('File captures run in the foreground', { exact: false });
	await expect(page.getByText('Detached', { exact: true })).toBeVisible();
	await expect(page.getByText('Record to Session', { exact: true })).toBeVisible();
	await expect(fileModeNote).toHaveCount(0);
	await page.getByLabel('Mode', { exact: true }).selectOption({ label: 'To a file' });
	// File starts ignore headless and recording options, so they are not offered.
	await expect(page.getByText('Detached', { exact: true })).toHaveCount(0);
	await expect(page.getByText('Record to Session', { exact: true })).toHaveCount(0);
	await expect(fileModeNote).toBeVisible();
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

test('VS Code launcher focuses Run when ready and Enter starts; other hosts keep their focus', async ({
	page
}) => {
	await page.goto(
		'/tests/embedding/?initialPath=%2Fgadgets%2Frun%2Ftest%2Fimage%3Alatest%3Fenv%3Dtest-env'
	);
	await expect(page.getByRole('button', { name: 'Run Gadget', exact: true })).toBeEnabled();
	expect(
		await page
			.getByRole('button', { name: 'Run Gadget', exact: true })
			.evaluate((node) => node === document.activeElement)
	).toBe(false);
	await page.goto(
		'/tests/embedding/?focusLaunchAction&initialPath=%2Fgadgets%2Frun%2Ftest%2Fimage%3Alatest%3Fenv%3Dtest-env'
	);
	const run = page.getByRole('button', { name: 'Run Gadget', exact: true });
	await expect(run).toBeFocused();
	await expect(page.getByRole('textbox', { name: 'PID' })).toBeVisible();
	await expect(page.getByRole('checkbox', { name: /^Detached/ })).toHaveCount(1);
	await expect(page.getByRole('checkbox', { name: 'Show advanced options' })).toHaveCount(1);
	await page.keyboard.press('Enter');
	await expect
		.poll(() =>
			page.evaluate(
				() => window.embedding.requests.filter((request) => request.cmd === 'runGadget').length
			)
		)
		.toBe(1);
	expect(
		await page.evaluate(
			() => window.embedding.requests.find((request) => request.cmd === 'runGadget')?.data?.image
		)
	).toBe('test/image:latest');
});

test('VS Code launcher does not steal keyboard focus during metadata loading', async ({ page }) => {
	await page.goto(
		'/tests/embedding/?focusLaunchAction&slowGadgetInfo&initialPath=%2Fgadgets%2Frun%2Ftest%2Fimage%3Alatest%3Fenv%3Dtest-env'
	);
	const environment = page.getByRole('combobox', { name: 'Select environment' });
	await environment.focus();
	await expect(page.getByRole('button', { name: 'Run Gadget', exact: true })).toBeEnabled();
	await expect(environment).toBeFocused();
	await page.keyboard.press('Tab');
	expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
});

test('opt-in custom options remember output and parameters, rebind scope, and reset per gadget', async ({
	page
}) => {
	await page.goto('/tests/embedding/?fileOutput&pcap&launchPreferences&savedOptions');
	await page.waitForFunction(() => window.embedding);
	await page.evaluate(() =>
		window.embedding.update({
			path: '/gadgets/run/test/image:latest',
			launchPreset: {
				image: 'test/image:latest',
				environmentID: 'test-env',
				params: { 'operator.KubeManager.namespace': 'current-namespace' }
			}
		})
	);
	await expect(page.getByLabel('Output', { exact: true })).toHaveValue('jsonl');
	await expect(page.getByText('Using your last custom options', { exact: true })).toBeVisible();
	await expect(page.getByText('Detached', { exact: true })).toHaveCount(0);
	await expect(
		page.getByText('File captures run in the foreground', { exact: false })
	).toBeVisible();
	await expect(page.getByLabel('Mode', { exact: true })).toHaveCount(0);
	await page.getByLabel('Output', { exact: true }).selectOption('table');
	await page.getByRole('button', { name: 'Run Gadget', exact: true }).click();
	await expect
		.poll(() =>
			page.evaluate(
				() => window.embedding.requests.filter((request) => request.cmd === 'runGadget').length
			)
		)
		.toBe(1);
	expect(
		await page.evaluate(
			() => window.embedding.requests.findLast((request) => request.cmd === 'runGadget')?.data
		)
	).toMatchObject({
		rememberOptions: true,
		params: { pid: '42', 'operator.KubeManager.namespace': 'current-namespace' }
	});
	await page.evaluate(() =>
		window.embedding.update({
			path: '/gadgets/run/test/image:latest?env=test-env',
			launchPreset: undefined
		})
	);
	await expect(page.getByLabel('Output', { exact: true })).toHaveValue('table');
	await page.getByRole('button', { name: 'Reset to gadget defaults', exact: true }).click();
	await expect(page.getByLabel('Output', { exact: true })).toHaveValue('pcap-ng');
	await expect(page.getByText('Using your last custom options', { exact: true })).toHaveCount(0);
	await page.getByRole('button', { name: 'Choose file and start...', exact: true }).click();
	await expect
		.poll(() =>
			page.evaluate(
				() => window.embedding.requests.filter((request) => request.cmd === 'runGadget').length
			)
		)
		.toBe(2);
	const request = await page.evaluate(
		() => window.embedding.requests.findLast((request) => request.cmd === 'runGadget')?.data
	);
	expect(request).toMatchObject({
		rememberOptions: true,
		output: { format: 'pcap-ng', datasourceIds: ['events'] },
		detached: false,
		record: false
	});
	expect(request?.params).not.toMatchObject({ pid: '42' });
	expect(JSON.stringify(request)).not.toContain('current-namespace');
	expect(JSON.stringify(request)).not.toContain('old-namespace');
	await page.evaluate(() =>
		window.embedding.update({
			path: '/gadgets/run/test/image:latest',
			launchPreset: {
				image: 'test/image:latest',
				environmentID: 'test-env',
				restoreDefaults: false,
				params: { pid: '7' }
			}
		})
	);
	await expect(page.getByLabel('Output', { exact: true })).toHaveValue('table');
	await expect(page.getByText('Using your last custom options', { exact: true })).toHaveCount(0);
	await page.evaluate(() =>
		window.embedding.update({
			path: '/gadgets/run/test/image:latest?env=test-env&params=%7B%22pid%22%3A%229%22%7D',
			launchPreset: undefined
		})
	);
	await expect(page.getByLabel('Output', { exact: true })).toHaveValue('table');
	await expect(page.getByText('Using your last custom options', { exact: true })).toHaveCount(0);
	expect(
		await page.evaluate(() =>
			JSON.parse(localStorage.getItem('env:test-env:gadget-history') ?? '[]').some(
				(entry: { rememberOptions?: boolean }) => entry.rememberOptions
			)
		)
	).toBe(false);
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
	await expectNoRequests(page, ['runGadget']);
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

test('frozen saved launcher locks only its target and keeps recording and detached features', async ({
	page
}) => {
	await page.evaluate(() =>
		window.embedding.update({
			path: '/gadgets/run/test/image:latest',
			launchPreset: {
				image: 'test/image:latest',
				environmentID: 'test-env',
				kubernetesTargetID: 'frozen-target',
				kubernetesTargetName: 'Frozen context: fixture',
				params: { pid: '42' }
			}
		})
	);
	const environment = page
		.locator('select')
		.filter({ has: page.locator('option[value="test-env"]') });
	await expect(environment).toBeDisabled();
	await expect(page.getByRole('status')).toHaveText('Frozen context: fixture');
	await expect(page.getByText('Detached', { exact: true })).toBeVisible();
	await page.getByText('Record to Session', { exact: true }).click();
	await expectNoRequests(page, ['runGadget']);
	await page.getByRole('button', { name: 'Run Gadget', exact: true }).click();
	await expect
		.poll(() =>
			page.evaluate(
				() => window.embedding.requests.find((request) => request.cmd === 'runGadget')?.data
			)
		)
		.toMatchObject({
			environmentID: 'test-env',
			record: true,
			detached: false,
			params: { pid: '42' }
		});
	await page.evaluate(() =>
		window.embedding.update({
			path: '/gadgets/run/test/image:latest?env=test-env',
			launchPreset: undefined
		})
	);
	await expect(environment).toBeEnabled();
	await expect(page.getByText('Frozen context: fixture')).toHaveCount(0);
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

test('a launch preset applies only to the launch route for its image', async ({ page }) => {
	await page.evaluate(() =>
		window.embedding.update({
			path: '/gadgets/run/other/image:latest?env=test-env',
			launchPreset: {
				image: 'test/image:latest',
				environmentID: 'other-env',
				params: { pid: '42' },
				transient: true,
				kubernetesTargetID: 'frozen-target',
				kubernetesTargetName: 'Frozen context: fixture'
			}
		})
	);
	const pid = page.getByRole('textbox', { name: 'PID', exact: true });
	await expect(pid).toHaveValue('');
	await expect(page.getByRole('combobox', { name: 'Select environment' })).toBeEnabled();
	await expect(page.getByRole('combobox', { name: 'Select environment' })).toHaveValue('test-env');
	await expect(page.getByRole('status')).toHaveCount(0);
	await expect(page.getByText('Detached', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Run Gadget', exact: true }).click();
	await expect
		.poll(() =>
			page.evaluate(
				() => window.embedding.requests.find((request) => request.cmd === 'runGadget')?.data
			)
		)
		.toMatchObject({ image: 'other/image:latest', environmentID: 'test-env', params: {} });
	expect(
		await page.evaluate(() => localStorage.getItem('env:test-env:gadget-history'))
	).not.toBeNull();
	await page.evaluate(() => window.embedding.update({ path: '/gadgets/run/test/image:latest/' }));
	await expect(pid).toHaveValue('42');
	await expect(page.getByRole('combobox', { name: 'Select environment' })).toBeDisabled();
});

test('an equal launch preset object keeps launcher edits; changed content re-applies', async ({
	page
}) => {
	const preset = {
		image: 'test/image:latest',
		environmentID: 'test-env',
		params: { pid: '42' },
		instanceName: 'from-host'
	};
	await page.evaluate(
		(launchPreset) =>
			window.embedding.update({ path: '/gadgets/run/test/image:latest', launchPreset }),
		preset
	);
	const pid = page.getByRole('textbox', { name: 'PID', exact: true });
	await expect(pid).toHaveValue('42');
	const infoRequests = () =>
		page.evaluate(
			() => window.embedding.requests.filter((request) => request.cmd === 'getGadgetInfo').length
		);
	const fetched = await infoRequests();
	await pid.fill('456');
	await page.getByText('Detached', { exact: true }).click();
	await expect(page.getByRole('textbox', { name: 'Instance Name' })).toHaveValue('from-host');
	await page.getByRole('textbox', { name: 'Instance Name' }).fill('edited');
	// React hosts commonly recreate an equal object on every render.
	for (let render = 0; render < 3; render++) {
		await page.evaluate(
			(launchPreset) => window.embedding.update({ launchPreset: { ...launchPreset } }),
			preset
		);
	}
	await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)));
	await expect(pid).toHaveValue('456');
	await expect(page.getByRole('textbox', { name: 'Instance Name' })).toHaveValue('edited');
	expect(await infoRequests()).toBe(fetched);
	await page.evaluate(
		(launchPreset) =>
			window.embedding.update({ launchPreset: { ...launchPreset, params: { pid: '7' } } }),
		preset
	);
	await expect(pid).toHaveValue('7');
});

test('an unsupported output format from history falls back to table with a supported format', async ({
	page
}) => {
	await page.goto(
		'/tests/embedding/?fileOutput&initialPath=' +
			encodeURIComponent('/gadgets/run/test/image:latest?env=test-env&output=pcap-ng')
	);
	await expect(page.getByLabel('Mode', { exact: true })).toHaveValue('table');
	await page.getByLabel('Mode', { exact: true }).selectOption({ label: 'To a file' });
	await expect(page.getByLabel('Format', { exact: true })).toHaveValue('jsonl');
	await expect(page.getByText('PCAP-NG requires exactly one packet datasource.')).toHaveCount(0);
	await page.goto(
		'/tests/embedding/?fileOutput&pcap&initialPath=' +
			encodeURIComponent('/gadgets/run/test/image:latest?env=test-env&output=pcap-ng')
	);
	await expect(page.getByLabel('Mode', { exact: true })).toHaveValue('file');
	await expect(page.getByLabel('Format', { exact: true })).toHaveValue('pcap-ng');
});

test('VS Code launcher focuses Run once per metadata load, not on later state changes', async ({
	page
}) => {
	await page.goto(
		'/tests/embedding/?focusLaunchAction&initialPath=%2Fgadgets%2Frun%2Ftest%2Fimage%3Alatest%3Fenv%3Dtest-env'
	);
	const run = page.getByRole('button', { name: 'Run Gadget', exact: true });
	await expect(run).toBeFocused();
	// A state change while nothing is focused (element.click() does not move focus).
	await page.getByRole('checkbox', { name: /^Record to Session/ }).evaluate((node) => {
		(document.activeElement as HTMLElement | null)?.blur();
		(node as HTMLInputElement).click();
	});
	await expect(page.getByRole('checkbox', { name: /^Record to Session/ })).toBeChecked();
	await page.getByRole('radio', { name: 'Add to Existing' }).evaluate((node) => {
		(node as HTMLInputElement).click();
		(document.activeElement as HTMLElement | null)?.blur();
	});
	await page.getByRole('radio', { name: 'New Session' }).evaluate((node) => {
		(node as HTMLInputElement).click();
		(document.activeElement as HTMLElement | null)?.blur();
	});
	await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
	await expect(run).toBeEnabled();
	await expect(run).not.toBeFocused();
	await page.keyboard.press('Enter');
	await expectNoRequests(page, ['runGadget']);
});

test('a prepared deployment dialog survives environment updates and is consumed once', async ({
	page
}) => {
	await page.goto('/tests/embedding/?dashboard=connected&initialPath=/env/test-env');
	await expect(page.getByText('Headless Gadget Instances', { exact: true })).toBeVisible();
	const deployment = { action: 'redeploy', namespace: 'host-namespace' } as const;
	await page.evaluate(
		(environmentDeployment) =>
			window.embedding.update({ path: '/env/test-env?request=1', environmentDeployment }),
		deployment
	);
	const modal = page.getByRole('dialog');
	await expect(modal.getByRole('button', { name: 'Redeploy', exact: true })).toBeVisible();
	// Environment replacement (update/reconnect) must not close an open dialog...
	await page.evaluate(() => window.embedding.environmentUpdate());
	await page.evaluate(() => window.embedding.update({ sessions: false }));
	await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)));
	await expect(modal.getByRole('button', { name: 'Redeploy', exact: true })).toBeVisible();
	await expect(modal.getByLabel('Namespace', { exact: true })).toHaveValue('host-namespace');
	await modal.getByRole('button', { name: 'Close (Force)', exact: true }).click();
	await expect(modal).toHaveCount(0);
	// ...nor reopen a closed one, including when the host re-sends an equal request.
	await page.evaluate(() => window.embedding.environmentUpdate());
	await page.evaluate(() => window.embedding.update({ sessions: true }));
	await page.evaluate(
		(environmentDeployment) =>
			window.embedding.update({ environmentDeployment: { ...environmentDeployment } }),
		deployment
	);
	await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
	await expect(modal).toHaveCount(0);
	await expectNoRequests(page, ['deployIG']);
});

test('the headless documentation link uses the host external-link opener', async ({ page }) => {
	await page.evaluate(() => {
		(window as unknown as { opened: string[] }).opened = window.embedding.captureExternal();
		window.embedding.update({ path: '/env/test-env' });
	});
	const pages = page.context().pages().length;
	await page.getByTitle('Documentation', { exact: true }).click();
	await expect
		.poll(() => page.evaluate(() => (window as unknown as { opened: string[] }).opened))
		.toEqual(['https://inspektor-gadget.io/docs/latest/reference/headless']);
	expect(page.context().pages()).toHaveLength(pages);
});

test('file capture Stop and Copy path failures are reported, not swallowed', async ({ page }) => {
	for (const hostNotifications of [false, true]) {
		await page.goto(
			`/tests/embedding/?fileOutput&stopError&copyError${hostNotifications ? '&hostNotifications' : ''}&initialPath=${encodeURIComponent('/gadgets/run/test/image:latest?env=test-env')}`
		);
		await page.getByLabel('Mode', { exact: true }).selectOption({ label: 'To a file' });
		await page.getByRole('button', { name: 'Choose destination', exact: true }).click();
		await page.getByRole('button', { name: 'Run Gadget', exact: true }).click();
		await expect(page.getByText('File capture', { exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect(
			page.getByText('Failed to stop the capture: fixture stopInstance failed', { exact: true })
		).toBeVisible();
		await page.getByRole('button', { name: 'Copy path', exact: true }).click();
		await expect(
			page.getByText('Failed to copy the capture path:', { exact: false })
		).toBeVisible();
	}
});

test('keyboard cell actions use one roving tab stop and anchor menus to the cell', async ({
	page
}) => {
	await page.goto('/tests/embedding/?initialPath=/env/test-env/running/run-one&cellActions');
	await page.getByText('Table', { exact: true }).click();
	const cells = page.getByRole('gridcell');
	await expect(cells.filter({ hasText: /^beta$/ })).toHaveCount(1);
	const tabbable = page.locator('[role="gridcell"][tabindex="0"]');
	await expect(tabbable).toHaveCount(1);
	expect(await cells.count()).toBeGreaterThan(1);
	await tabbable.focus();
	const first = await tabbable.textContent();
	await page.keyboard.press('ArrowDown');
	const focused = page.locator('[role="gridcell"]:focus');
	await expect(focused).not.toHaveText(first ?? '');
	await expect(tabbable).toHaveCount(1);
	await expect(focused).toHaveAttribute('tabindex', '0');
	await page.keyboard.press('ArrowUp');
	await expect(focused).toHaveText(first ?? '');
	await page.keyboard.press('Shift+F10');
	await expect.poll(() => page.evaluate(() => window.embedding.cellPositions.length)).toBe(1);
	const box = await focused.boundingBox();
	const position = await page.evaluate(() => window.embedding.cellPositions[0]);
	// Anchored to the focused cell, never the viewport origin.
	expect(position.x).toBeGreaterThanOrEqual(Math.floor(box!.x));
	expect(position.x).toBeLessThanOrEqual(Math.ceil(box!.x + box!.width));
	expect(position.y).toBeGreaterThanOrEqual(Math.floor(box!.y));
	expect(position.y).toBeLessThanOrEqual(Math.ceil(box!.y + box!.height));
	await focused.dispatchEvent('contextmenu', { clientX: 0, clientY: 0 });
	await expect.poll(() => page.evaluate(() => window.embedding.cellPositions.length)).toBe(2);
	expect(await page.evaluate(() => window.embedding.cellPositions[1])).toEqual({
		x: expect.closeTo(box!.x, 0),
		y: expect.closeTo(box!.y + box!.height, 0)
	});
	await expectNoRequests(page, ['runGadget']);
});
