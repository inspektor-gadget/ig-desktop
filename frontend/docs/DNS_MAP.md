# DNS Map

The **DNS Map** visualizer (`dns-network` plugin id, displayed as "DNS Map")
groups correlated `trace_dns` traffic into Kubernetes-namespace-grouped
workload nodes, resolver nodes, and severity-aggregated edges between them,
so DNS failures are immediately visible and actionable instead of buried in
a flat transaction table.

Pipeline: raw `trace_dns` events -> `computeDnsCorrelation` (`dnsCorrelator.ts`)
-> `buildDnsMapModel` / `layoutDnsMapModel` (`dnsMapGraph.ts`) -> XYFlow
nodes/edges rendered by `DnsNetwork.svelte` / `DnsNetworkChart.svelte`.

## Capture-side attribution

Each raw event's k8s/runtime/netns identity fields (`k8s.node`,
`k8s.namespace`, `k8s.podName`, `k8s.containerName`, `runtime.containerId`,
`runtime.containerName`, `runtime.runtimeName`, `netns_id`) describe
whichever host actually **captured** that packet - not necessarily the
logical requester or resolver. `pkt_type` tells us which:

| Direction | `pkt_type`                             | Identity belongs to                                                                                      |
| --------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| request   | `OUTGOING` (4)                         | requester (captured leaving the requester)                                                               |
| request   | anything else (typically `HOST`/0)     | resolver (captured arriving at the resolver)                                                             |
| response  | `HOST` (0)                             | requester (captured arriving at the requester)                                                           |
| response  | anything else (typically `OUTGOING`/4) | resolver (captured leaving the resolver)                                                                 |
| either    | missing/unknown                        | **requester** (documented default - most non-Kubernetes/simple captures only observe the requester side) |

Separately, authoritative Kubernetes object enrichment (`src.k8s.kind/name/namespace`,
`dst.k8s.kind/name/namespace`) is attached to the requester/resolver sides
based purely on packet direction (independent of which side captured it),
and only when `name` is non-empty - a `kind: "raw"` with an empty name means
"not resolved to a k8s object", never a real (if oddly-named) reference.
Resolver labels use this enrichment when present (e.g. "svc kube-dns" /
"kube-system"); otherwise they fall back to plain `IP:port` - the map never
guesses a resolver's identity from its address.

### Client/server duplicate observations

The same logical query is often captured independently at both the client
and the resolver (e.g. a client pod's outgoing request _and_ CoreDNS's own
incoming-request capture). These are **not deduplicated** - both become
separate, fully-valid transactions (the correlation key includes capture
identity), which is correct: they really are two independent observations
of the same conversation, and merging them would silently hide asymmetric
visibility (e.g. a request the client saw leave but the resolver never
received).

To still group these into one workload card, the graph builder resolves
each transaction's requester identity through an **address-backfill map**:
if any transaction in the retained set has full namespace+pod identity for
a given requester address, that identity is used for every transaction
sharing that address, even ones whose own capturing observation didn't
carry it (e.g. captured resolver-side, where only the resolver's own
identity was known). This never changes transaction identity or
correlation - it only affects which workload group a transaction displays
under.

## Workload key precedence

Workload nodes group by (in order, never falling back once a tier matches):

1. `namespace` + `podName` (sidecars - different container, same pod - and
   UDP/TCP/dual-stack traffic from the same pod all collapse into one node)
2. runtime `runtimeName` + (`containerName` or `containerId`)
3. `netns_id`
4. requester address (last resort)

Namespace grouping uses the resolved `namespace` independently: a workload
with no known namespace renders inside a single, clearly-labeled
**"Other (non-Kubernetes)"** fallback area rather than being silently
dropped or merged with real namespaces. Empty-but-present k8s fields (a
common Docker-only capture shape) are normalized to `undefined` and never
create an empty-string namespace/pod group.

## Severity ladder

One function (`dnsSeverity.ts`) is the single source of truth for both
per-transaction and per-aggregate (edge/workload/resolver) severity:

1. **error** - `no-response` (timeout) or a server-error rcode
   (`FormatError`/1, `ServerFailure`/2, `NotImplemented`/4, `Refused`/5)
2. **warning** - `late-response`, any retry (`retryCount > 0`), or latency
   at/above the slow threshold
3. **info** - NXDOMAIN-only (`NameError`/3), `orphan-response`, or
   `ambiguous` (mDNS/multicast) - explicitly _not_ warning, even though
   these are still worth surfacing
4. **healthy** - otherwise

The slow threshold is derived from the datasource's response timeout as
`timeoutMs / 10` (not a separate hardcoded constant), so a more tolerant
environment's configured timeout also relaxes what counts as "slow".

Severity is always shown as an icon + text label with a semantic `ig-*`
color, never color alone. Edge cards show an icon, label, count breakdown,
and severity-tinted surface; workload/resolver cards show an icon and
count; and the edge **path** itself is colored via a
`dns-map-edge-path--<severity>` CSS class (`severityEdgeClass` in
`dnsSeverity.ts`) mapped to the same `--ig-color-error`/`--ig-color-warning`/
`--ig-color-text-muted`/`--ig-color-success` variables the cards use - so an
edge's severity is visible at a glance without opening or hovering
anything, even before reading its card.

Edge cards additionally carry a severity-tinted **background** (a
`dns-map-edge-card--<severity>` class, `severityCardClass` in
`dnsSeverity.ts`), computed with CSS `color-mix()` from the same semantic
`--ig-color-error`/`--ig-color-warning`/`--ig-color-text-muted`/
`--ig-color-success` variable into `--ig-color-surface` - never a raw
color value, and still fully theme-aware since the mix recomputes with
whichever surface token the active theme defines.

Workload and resolver cards also carry an `aria-label` summarizing identity

- query count + severity (e.g. "metrics-server-7f6b9-abc12, 1 query,
  Error"), so the same triage information conveyed visually is available to
  assistive technology, not just via `title`/color.

## Aggregation and honest filtering

Edges aggregate all transactions between one workload and one resolver
(which may span multiple legacy `peerKey`s, e.g. different requester
addresses/protocols for the same pod) and expose the **exact transaction
IDs** backing them, so the detail modal always opens precisely what an
edge card summarized - never a broader `peerKey`-based filter that could
include unrelated transactions. Every edge card is a clickable (and
keyboard-activatable) affordance to that modal: a compact, always-visible
"View queries →" hint makes this obvious at rest, not just on hover, and
the modal's transaction table includes an **Answers** column (the
resolved addresses, when known) alongside state/rcode/latency so a click
surfaces what the response actually contained, not just whether it
succeeded.

The query count on every workload and resolver node opens the same modal,
filtered to that node's exact transaction IDs.

Two independent filters compose in a fixed order:

1. **Namespace filter** (select, only shown when more than one namespace is
   present) scopes the _transactions_ before aggregation - every count
   shown anywhere reflects only the selected namespace's in-scope data.
2. **"Issues only"** (a button with `aria-pressed`) is a _post-aggregation
   visibility_ filter: it keeps warning/error edges and hides healthy or
   informational edges, then drops any workload/resolver/namespace group
   left with no remaining edges. Informational NXDOMAIN responses are
   excluded because Kubernetes search-suffix expansion commonly produces
   them before a successful answer. The filter never recomputes or changes
   any count - a workload showing "300 total / 3 failures" still shows
   exactly that after toggling "Issues only". When nothing remains, the
   empty state reads "No DNS issues in the retained window" rather than the
   generic "waiting for traffic" message.

Datasource annotations can set the initial view:

| Annotation                          | Effect                                              |
| ----------------------------------- | --------------------------------------------------- |
| `view.dns.issues-only=true`         | Start with the issues-only filter enabled           |
| `view.dns.namespace-selector=false` | Hide the namespace selector                         |
| `view.dns.response-timeout=<value>` | Set the response timeout, e.g. `5s` (default: `5s`) |

The namespace selector is never shown when fewer than two namespaces are
present, regardless of annotation.

All aggregate counts (total, timeouts, server errors, NXDOMAIN, retries,
late/slow, worst/recent latency) are computed strictly over the currently
**retained** event buffer - there's no persisted history beyond what the
underlying ring buffer/snapshot already holds.

## Layout

Namespaces render as visible, deterministic group boxes (namespaces,
workloads within them, and resolvers are all pre-sorted before layout) using
the existing `@dagrejs/dagre` compound-graph support (`compound: true`,
`setParent`) and XYFlow's native `parentId`/group-node support - no new
layout dependency and no hand-rolled overlap avoidance. Dagre's `rankdir`
is `'LR'`: namespace groups read as vertically-stacked lanes (one visible
"row" per namespace, plus the "Other (non-Kubernetes)" fallback lane when
used), with workload -> resolver flow running left-to-right within each
lane. Resolver nodes are never placed inside a namespace group, even when
their own namespace is known - they render in their own rank to the right
of every lane, since a resolver (e.g. CoreDNS) is commonly shared across
namespaces. The namespace label is drawn inside Dagre's own natural cluster
margin rather than by inflating the computed bounding box after the fact
(inflating independently of what Dagre used to guarantee non-overlapping
cluster placement would silently reintroduce overlap between adjacent
groups). Edge cards remain XYFlow edge labels rather than interactive nodes,
but their compact dimensions are supplied to Dagre so it reserves a
non-overlapping position for each card. Each connection uses two Bézier
segments routed through that computed label position; decorative connection
handles are deliberately omitted because the read-only cards are not real
connection endpoints.

The map has no chart-local layout or drag-persistence state. Nodes and groups
are not draggable; a click is a plain (no-op) selection like any other
read-only visualizer. Positions are cached and only recomputed via Dagre
when the model's topology (the set of namespace/workload/resolver/edge
keys, `dnsMapTopologyKey`) actually changes - not on every transaction
batch - since live traffic can arrive tens of times per second while the
topology itself changes far less often (`refreshDnsMapLayoutData`, matched
by stable node id, not array position, since a node's sort order can
change - e.g. authoritative resolver enrichment arriving later - without
its identity changing). "Issues only" filters that full cached layout
rather than laying out the warning/error subset again, so severity changes
can show or hide cards without moving the retained topology.

## Testing

`dnsMapGraph.test.ts`, `dnsCaptureMeta.test.ts`, and `dnsSeverity.test.ts`
drive the whole pipeline from raw `trace_dns`-shaped events
(`dnsFixtures.ts`'s `buildRichDnsFixture`, covering 20 pods across 3
namespaces, several resolvers, and every edge case described above)
through `computeDnsCorrelation` and `buildDnsMapModel`/`layoutDnsMapModel`,
asserting grouping, severity, filtering, and non-overlapping compound
layout at scale. `dnsConfig.test.ts` covers the view annotations.
`dnsFixtures.ts` also exposes a smaller
`buildRepresentativeDnsFixture` (~12 workloads, 4 resolvers, one example of
each severity case) used only by the Playwright visual harness
(`frontend/tests/visual-dns-map.spec.ts`) so the committed screenshots stay
legible at a fixed viewport. Run the unit tests with:

```sh
npm --prefix frontend test
```
