# Visual tests

The Playwright suite covers the DNS Map visualizer using **demo mode**
(`VITE_APP_MODE=demo`), so no live Inspektor Gadget daemon or Docker is
required. The screenshot data is a deterministic, fixture-derived "recent
gadget" entry (see `scripts/generate-demo-dns-recent.ts` and
`docs/DNS_MAP.md`) built from `buildRepresentativeDnsFixture` in
`src/lib/utils/dns/dnsFixtures.ts` - a smaller, readable subset of the same
raw `trace_dns` event fixture builders the pure pipeline tests
(`dnsMapGraph.test.ts`) assert against.

Prerequisites:

- Chromium installed with `npx playwright install chromium`

Run the suite from the repository root:

```sh
npm --prefix frontend run test:e2e
```

Update baselines after an intentional UI change:

```sh
npm --prefix frontend run test:e2e -- --update-snapshots
```

Regenerating the demo data after a fixture change:

```sh
node frontend/scripts/generate-demo-dns-recent.ts
```

## Why demo mode instead of a live daemon

The visual spec runs the fixture-derived recent gadget via the "Run again"
button on an environment's recent-gadget history (`/env/<id>`), which
replays through `demoBackend.handleRunGadget` - the same message-handling
code path (`handleGadgetInfo`/`handleGadgetEvent`/`handleGadgetQuit`) a
live WebSocket-connected gadget run uses, just with static fixture data
instead of a real connection. The test waits for the replay to finish
("Stopped", all fixture events delivered) before screenshotting, so the
topology, severities, and filters are all fully populated and settled.

Note: the sessions/[id] page's own client-side `ReplayService` (used by its
"View results"/"Play" buttons) was found, during this work, to trigger a
pre-existing `effect_update_depth_exceeded` loop in
`useDnsCorrelation.svelte.ts` once a DNS-datasource instance's `running`
state settles - reproducible with completely unmodified DNS correlator
code, unrelated to this change. It was fixed by scoping the correlation
hook's `$effect` dependencies with `svelte`'s `untrack()` (see
`useDnsCorrelation.svelte.ts`) so re-running `recompute()` no longer
depends on values `recompute` itself reads. The `handleRunGadget` demo path
used by these tests exercises the same hook and confirms the fix.
