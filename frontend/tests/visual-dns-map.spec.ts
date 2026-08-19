import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Visual regression coverage for the DNS Map visualizer, using deterministic
 * demo-mode data derived from `buildRepresentativeDnsFixture`
 * (src/lib/utils/dns/dnsFixtures.ts) via scripts/generate-demo-dns-recent.ts
 * - see docs/DNS_MAP.md. That fixture is a smaller, readable subset of the
 * same raw trace_dns event fixture builders the pure pipeline tests
 * (dnsMapGraph.test.ts) assert against: ~12 workloads across all 3
 * namespaces plus the non-Kubernetes fallback group, 4 resolvers, and one
 * representative example of each documented severity case.
 *
 * Demo mode requires no live daemon or Docker: it replays a canned event
 * stream through the same message-handling code path a live gadget run
 * uses (demoBackend.handleRunGadget -> handleGadgetInfo/handleGadgetEvent/
 * handleGadgetQuit), just with static fixture data instead of a real
 * connection.
 */

/** Order-independent set-equality assertion for locator text-content arrays. */
function assertSetEqual(actual: string[], expected: string[]): void {
	expect(new Set(actual)).toEqual(new Set(expected));
}

test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		localStorage.setItem('ig-language', 'en');
		localStorage.setItem(
			'ig-configuration',
			JSON.stringify({
				theme: 'dark',
				designTheme: 'default',
				gradientEnabled: false,
				checkForUpdates: false,
				sendAnalytics: false,
				experimentalSessionRecording: false,
				experimentalGadgetWizard: false
			})
		);
		localStorage.setItem('ig-start-count', '3');
		localStorage.setItem('ig-update-opt-in-shown', 'true');
		localStorage.setItem('ig-analytics-opt-in-shown', 'true');
	});
});

/** Run the fixture-derived "DNS Map demo" recent gadget and switch to the DNS Map tab. */
async function openDnsMap(page: Page) {
	await page.goto('/env/demo-env');
	await expect(page.getByRole('heading', { name: 'Demo Environment' })).toBeVisible();

	await page
		.locator('.group\\/item')
		.filter({ hasText: 'trace_dns:demo' })
		.getByTitle('Run again')
		.click();
	await expect(page).toHaveURL(/\/env\/demo-env\/running\/.+/);

	// All 33 fixture events have been replayed and the instance has stopped.
	await expect(page.getByText('33 events', { exact: true })).toBeVisible();
	await expect(page.getByText('Stopped', { exact: true })).toBeVisible();

	await page.getByRole('button', { name: 'DNS Map', exact: true }).click();
	await expect(
		page.getByText('12 workloads, 4 resolvers, 0 pending', { exact: true })
	).toBeVisible();

	// Let the compound layout/fitView settle before screenshotting.
	await page.waitForTimeout(300);
	await page.evaluate(() => document.fonts.ready);
}

test('DNS Map: full multi-namespace topology', async ({ page }) => {
	await openDnsMap(page);

	const datasource = page.locator('.dns-map-container');

	// Sanity: all 3 real namespaces plus the non-Kubernetes fallback group
	// are genuinely present as their own group labels (not a substring
	// match against unrelated text like "kubernetes.default.svc...") -
	// this is not a 2-3 node degenerate case.
	const groupLabels = await datasource.locator('.dns-namespace-group-label').allTextContents();
	assertSetEqual(groupLabels, ['default', 'kube-system', 'monitoring', 'Other (non-Kubernetes)']);

	await expect(datasource).toContainText('checkout-6f9b8c-abcde');
	await expect(datasource).toContainText('cart-7d8f9-pqrst');
	await expect(datasource).toContainText('kube-proxy-4jz8n');
	await expect(datasource).toContainText('metrics-server-7f6b9-abc12');
	await expect(datasource).toContainText('prometheus-server-0');
	await expect(datasource).toContainText('svc kube-dns');

	// Severity summaries for the representative examples of every
	// documented case are visible, not just implied by color.
	await expect(datasource).toContainText('3 NXDOMAIN'); // checkout's search-suffix expansion
	await expect(datasource).toContainText('1 server error'); // cart's ServerFailure
	await expect(datasource).toContainText('1 timeout'); // metrics-server's retries+timeout
	await expect(datasource).toContainText('1 late'); // kube-proxy-4jz8n
	await expect(datasource).toContainText('1 slow'); // kube-proxy-8xk2m

	// Aggregate edge severity is encoded on the path itself (not just the
	// card) - assert at least one path of each non-healthy severity class
	// is actually rendered.
	await expect(datasource.locator('path.dns-map-edge-path--error').first()).toBeAttached();
	await expect(datasource.locator('path.dns-map-edge-path--warning').first()).toBeAttached();
	await expect(datasource.locator('path.dns-map-edge-path--info').first()).toBeAttached();
	await expect(datasource.locator('path.dns-map-edge-path--healthy').first()).toBeAttached();
	await expect(datasource.locator('.dns-workload-node .svelte-flow__handle-left')).toHaveCount(0);
	await expect(datasource.locator('.dns-resolver-node .svelte-flow__handle-right')).toHaveCount(0);
	await expect(datasource.locator('.dns-map-edge-dot')).toHaveCount(0);

	// Accessible summaries exist on workload/resolver cards (identity +
	// query count + severity), not just title/color.
	await expect(
		page.getByRole('group', { name: /metrics-server-7f6b9-abc12.*1 query.*Error/ })
	).toBeVisible();
	await expect(page.getByRole('group', { name: /svc kube-dns.*queries.*Error/ })).toBeVisible();

	await expect(page).toHaveScreenshot('dns-map-full-topology.png');
});

test('DNS Map: issues-only view keeps warnings and errors', async ({ page }) => {
	await openDnsMap(page);

	const datasource = page.locator('.dns-map-container');
	const issuesToggle = page.getByRole('button', { name: 'Issues only', exact: true });
	await expect(issuesToggle).toHaveAttribute('aria-pressed', 'false');
	await issuesToggle.click();
	await expect(issuesToggle).toHaveAttribute('aria-pressed', 'true');

	// Header counts shrink to only the workloads/resolvers with warnings
	// or errors (4 workloads, 2 resolvers) - the toggle is a visibility
	// filter, never a recomputation of totals shown elsewhere.
	await expect(
		page.getByText('4 workloads, 2 resolvers, 0 pending', { exact: true })
	).toBeVisible();

	// The remaining, still-failing representative examples are visible...
	await expect(datasource).toContainText('cart-7d8f9-pqrst');
	await expect(datasource).toContainText('kube-proxy-4jz8n');
	await expect(datasource).toContainText('kube-proxy-8xk2m');
	await expect(datasource).toContainText('metrics-server-7f6b9-abc12');
	// ...and the healthy-only workloads/resolvers are gone, including the
	// entire "monitoring" namespace group (only healthy workloads there).
	await expect(datasource).not.toContainText('checkout-6f9b8c-abcde');
	await expect(datasource).not.toContainText('frontend-5c7d6-uvwxy');
	await expect(datasource).not.toContainText('prometheus-server-0');
	const remainingGroupLabels = await datasource
		.locator('.dns-namespace-group-label')
		.allTextContents();
	assertSetEqual(remainingGroupLabels, ['default', 'kube-system']);

	// The map remounts on filter change (see DnsNetwork.svelte's `{#key}`)
	// so fitView re-centers on the smaller remaining subset - no extra
	// zoom needed here; it already fills the frame legibly.
	await page.waitForTimeout(300);

	await expect(page).toHaveScreenshot('dns-map-issues-only.png');
});

test('DNS Map: namespace filter never dead-ends - selecting a namespace keeps the select visible and restorable', async ({
	page
}) => {
	await openDnsMap(page);

	const select = page.getByLabel('Filter DNS map by namespace');
	await expect(select).toBeVisible();

	// Selecting a real namespace scopes the header counts/nodes to it...
	await select.selectOption('default');
	await expect(
		page.getByText('4 workloads, 3 resolvers, 0 pending', { exact: true })
	).toBeVisible();
	const datasource = page.locator('.dns-map-container');
	await expect(datasource).toContainText('cart-7d8f9-pqrst');
	await expect(datasource).not.toContainText('prometheus-server-0');

	// ...and, unlike the dead-end this regression-tests, the select itself
	// stays visible/labeled and still shows the other namespaces - it must
	// never derive its own options from the already-scoped model.
	await expect(select).toBeVisible();
	await expect(select).toHaveValue('default');
	await expect(page.getByLabel('Filter DNS map by namespace')).toBeVisible();

	// Choosing "All namespaces" restores the full, unscoped topology.
	await select.selectOption('');
	await expect(
		page.getByText('12 workloads, 4 resolvers, 0 pending', { exact: true })
	).toBeVisible();
	await expect(datasource).toContainText('prometheus-server-0');
	await expect(select).toBeVisible();
});

test('DNS Map: namespace filter select has a programmatic accessible name', async ({ page }) => {
	await openDnsMap(page);

	await expect(page.getByLabel('Filter DNS map by namespace')).toBeVisible();
});

test('DNS Map: clicking a compact edge card opens the correlated transaction modal with query names and answers', async ({
	page
}) => {
	await openDnsMap(page);

	// The checkout-6f9b8c-abcde workload's edge (NXDOMAIN search-suffix
	// expansion, ending in success) is a good NXDOMAIN/info example: 4
	// total, 3 NXDOMAIN, and the intermediate/final names + resolved
	// address are exactly what a debugging user needs the modal to expose.
	const card = page.locator('.dns-map-edge-card').filter({ hasText: 'Info' }).first();
	await expect(card).toBeVisible();
	await card.click();

	const modal = page.getByRole('dialog');
	await expect(modal).toBeVisible();

	// The successful, final search-suffix expansion attempt and its
	// resolved address.
	await expect(modal.getByRole('cell', { name: 'redis.', exact: true })).toBeVisible();
	await expect(modal.getByRole('cell', { name: '203.0.113.5', exact: true })).toBeVisible();
	// An intermediate NXDOMAIN attempt (no answer) is present too - the
	// modal shows every correlated transaction, not just the last one.
	await expect(
		modal.getByRole('cell', { name: 'redis.svc.cluster.local.', exact: true })
	).toBeVisible();
	await expect(modal.getByRole('columnheader', { name: 'Answers', exact: true })).toBeVisible();

	await page.keyboard.press('Escape');
	await expect(modal).toBeHidden();
});

test('DNS Map: workload and resolver query counts open node-filtered transaction lists', async ({
	page
}) => {
	await openDnsMap(page);

	const workload = page.getByRole('group', { name: /checkout-6f9b8c-abcde.*4 queries/ });
	await workload
		.getByRole('button', { name: '4 DNS transactions, press Enter for details' })
		.focus();
	await page.keyboard.press('Enter');
	const modal = page.getByRole('dialog');
	await expect(modal.locator('tbody tr')).toHaveCount(4);
	await page.keyboard.press('Escape');

	const resolver = page.getByRole('group', { name: /svc kube-dns.*12 queries/ });
	await resolver
		.getByRole('button', { name: '12 DNS transactions, press Enter for details' })
		.focus();
	await page.keyboard.press('Enter');
	await expect(modal.locator('tbody tr')).toHaveCount(12);
	await expect(modal.getByRole('heading')).toHaveText('svc kube-dns — 12 DNS transactions');
	await expect(page).toHaveScreenshot('dns-map-query-list.png');
});

test('DNS Map: edge card expands on hover/focus to reveal details, and stays compact at rest', async ({
	page
}) => {
	await openDnsMap(page);

	await page.getByRole('button', { name: 'Issues only', exact: true }).click();
	await page.waitForTimeout(300);

	// Deliberately target the "timeout" edge (severity Error), not the
	// Info/NXDOMAIN edge: it is index 0 of 5 issues-only cards (i.e. not
	// the last DOM edge), which is the case the z-index/overlap regression
	// actually needs (XYFlow sets an inline z-index on every edge label,
	// including later-DOM ones that would otherwise stack above an
	// earlier-DOM edge's expansion regardless of hover/focus).
	const allCards = page.locator('.dns-map-edge-card');
	const cardCount = await allCards.count();
	expect(cardCount).toBeGreaterThan(1);
	const card = allCards.filter({ hasText: '1 timeout' }).first();
	// Capture every other card's resting bounding box up front (before this
	// card expands and while every card is still in its resting position),
	// so the overlap check below is derived from real layout, not a
	// hardcoded coordinate.
	const neighborBoxes: { x: number; y: number; width: number; height: number }[] = [];
	for (let i = 0; i < cardCount; i++) {
		const candidate = allCards.nth(i);
		if ((await candidate.getAttribute('aria-label')) === (await card.getAttribute('aria-label')))
			continue;
		const box = await candidate.boundingBox();
		if (box) neighborBoxes.push(box);
	}
	expect(neighborBoxes.length).toBeGreaterThan(0);

	const expandedDetails = card.locator('.dns-map-edge-expanded');
	const restingBox = await card.boundingBox();
	assertBox(restingBox);
	// Resting state is compact (roughly 130-150px), not the old fixed 240px.
	const restingCssWidth = await card.evaluate((element) =>
		Number.parseFloat(getComputedStyle(element).width)
	);
	expect(restingCssWidth).toBe(144);
	for (const neighbor of neighborBoxes) {
		expect(
			neighbor.x < restingBox!.x + restingBox!.width &&
				neighbor.x + neighbor.width > restingBox!.x &&
				neighbor.y < restingBox!.y + restingBox!.height &&
				neighbor.y + neighbor.height > restingBox!.y,
			'compact edge cards must not overlap'
		).toBe(false);
	}

	// The full breakdown/preview list exist in the DOM (for immediate
	// availability on hover/focus, no network/async delay) but are not
	// visible at rest - `not.toContainText` would be misleading here since
	// hidden elements still contribute to `textContent`.
	await expect(expandedDetails).toBeHidden();

	await card.hover();
	await page.waitForTimeout(300);
	const hoverBox = await card.boundingBox();
	assertBox(hoverBox);
	expect(hoverBox!.width).toBeGreaterThan(restingBox!.width);
	await expect(expandedDetails).toBeVisible();
	await expect(card.getByText('1 timeout', { exact: true })).toHaveCount(1);
	await expect(expandedDetails).toContainText('retrying');
	await expect(expandedDetails).toContainText('unreachable-backend.monitoring.svc.cluster.local.');

	// XYFlow sets an inline `z-index: 0` on every `.svelte-flow__edge-label`
	// portal, which normally beats a plain (non-`!important`) class rule -
	// verify the computed z-index actually reflects the `!important`
	// override, not just that the class is present in markup.
	await expectEdgeLabelZIndex(card, '1000');

	// Move the mouse away so hover state clears, then verify keyboard
	// focus alone (no hover) also expands the same card.
	await page.mouse.move(0, 0);
	await page.waitForTimeout(200);
	await expect(expandedDetails).toBeHidden();
	await card.focus();
	await page.waitForTimeout(300);
	const focusBox = await card.boundingBox();
	assertBox(focusBox);
	expect(focusBox!.width).toBeGreaterThan(restingBox!.width);
	await expect(expandedDetails).toBeVisible();
	await expect(expandedDetails).toContainText('unreachable-backend.monitoring.svc.cluster.local.');
	await expectEdgeLabelZIndex(card, '1000');

	// role=button, keyboard activation, and the accessible summary are all
	// preserved from before this change.
	await expect(card).toHaveAttribute('role', 'button');
	await expect(card).toHaveAttribute(
		'aria-label',
		/\d+ DNS transactions?, severity Error, press Enter for details/
	);
});

function assertBox(box: { width: number; height: number } | null): asserts box is {
	width: number;
	height: number;
} {
	expect(box).not.toBeNull();
}

/** Assert the computed (not just inline-authored) z-index of the hovered/focused card's `.svelte-flow__edge-label` ancestor. */
async function expectEdgeLabelZIndex(card: Locator, expected: string): Promise<void> {
	const zIndex = await card.evaluate((el) => {
		const label = el.closest('.svelte-flow__edge-label');
		return label ? getComputedStyle(label).zIndex : null;
	});
	expect(zIndex).toBe(expected);
}
