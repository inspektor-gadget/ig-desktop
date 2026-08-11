/**
 * Generates a deterministic "recent gadget" demo entry for the Playwright
 * visual harness, derived from the same raw trace_dns fixture builders used
 * by the pure pipeline tests (dnsFixtures.ts) - specifically the smaller
 * `buildRepresentativeDnsFixture`, which keeps the screenshots readable at
 * a fixed viewport size while still covering every documented severity
 * case. The full 20-pod/3-namespace `buildRichDnsFixture` is used only by
 * dnsMapGraph.test.ts's scale/grouping/non-overlap assertions.
 *
 * Not part of the app build; run manually (and re-run) whenever the
 * fixture changes:
 *
 *   node scripts/generate-demo-dns-recent.ts
 *
 * Writes static/demo/recents/dns-map.json and registers it in
 * static/demo/config.json's `recents` list (idempotent - re-running does
 * not duplicate the entry). The visual harness runs it via the "Run again"
 * button on an environment's recent-gadget history, which replays through
 * the same demo-backend message protocol
 * (handleGadgetInfo/handleGadgetEvent/handleGadgetQuit) a live gadget run
 * uses.
 */

import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as prettier from 'prettier';
import {
	buildRepresentativeDnsFixture,
	RICH_DNS_CONFIG,
	FIXTURE_BASE_NS
} from '../src/lib/utils/dns/dnsFixtures.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const staticDemoDir = join(__dirname, '..', 'static', 'demo');

/** All field fullNames the DNS map pipeline can consume, matching RICH_DNS_CONFIG's mapping. */
const DNS_FIELDS: { fullName: string; kind: string }[] = [
	{ fullName: 'id', kind: 'String' },
	{ fullName: 'qr_raw', kind: 'Bool' },
	{ fullName: 'qr', kind: 'String' },
	{ fullName: 'name', kind: 'String' },
	{ fullName: 'qtype_raw', kind: 'Uint16' },
	{ fullName: 'qtype', kind: 'String' },
	{ fullName: 'src.addr', kind: 'String' },
	{ fullName: 'src.port', kind: 'Uint16' },
	{ fullName: 'src.proto', kind: 'String' },
	{ fullName: 'dst.addr', kind: 'String' },
	{ fullName: 'dst.port', kind: 'Uint16' },
	{ fullName: 'timestamp_raw', kind: 'Uint64' },
	{ fullName: 'latency_ns_raw', kind: 'Uint64' },
	{ fullName: 'rcode', kind: 'String' },
	{ fullName: 'rcode_raw', kind: 'Uint16' },
	{ fullName: 'num_answers', kind: 'Uint32' },
	{ fullName: 'addresses', kind: 'String' },
	{ fullName: 'pkt_type_raw', kind: 'Uint8' },
	{ fullName: 'pkt_type', kind: 'String' },
	{ fullName: 'k8s.node', kind: 'String' },
	{ fullName: 'k8s.namespace', kind: 'String' },
	{ fullName: 'k8s.podName', kind: 'String' },
	{ fullName: 'k8s.containerName', kind: 'String' },
	{ fullName: 'runtime.containerId', kind: 'String' },
	{ fullName: 'runtime.containerName', kind: 'String' },
	{ fullName: 'runtime.runtimeName', kind: 'String' },
	{ fullName: 'netns_id', kind: 'Uint64' },
	{ fullName: 'src.k8s.kind', kind: 'String' },
	{ fullName: 'src.k8s.name', kind: 'String' },
	{ fullName: 'src.k8s.namespace', kind: 'String' },
	{ fullName: 'dst.k8s.kind', kind: 'String' },
	{ fullName: 'dst.k8s.name', kind: 'String' },
	{ fullName: 'dst.k8s.namespace', kind: 'String' }
];

function buildDatasource() {
	return {
		id: 'dns',
		name: 'dns',
		type: 1, // streaming
		fields: DNS_FIELDS.map((f, index) => ({
			name: f.fullName.split('.').pop() ?? f.fullName,
			fullName: f.fullName,
			kind: f.kind,
			index,
			flags: 0,
			tags: [],
			annotations: {}
		})),
		annotations: {}
	};
}

async function main() {
	const rawEvents = buildRepresentativeDnsFixture();
	// Sanity: every field RICH_DNS_CONFIG maps must actually exist in DNS_FIELDS,
	// otherwise the demo datasource's field signature wouldn't match what the
	// visualizer requires (REQUIRED_DNS_FIELDS) or what enrichment expects.
	const declaredFullNames = new Set(DNS_FIELDS.map((f) => f.fullName));
	for (const value of Object.values(RICH_DNS_CONFIG)) {
		if (typeof value === 'string' && !declaredFullNames.has(value)) {
			throw new Error(`DNS_FIELDS is missing a field declared in RICH_DNS_CONFIG: ${value}`);
		}
	}

	const startedAt = Math.round(FIXTURE_BASE_NS / 1e6);
	const recordedEvents = rawEvents.map((event, i) => ({
		id: i + 1,
		runId: 'dns-map-demo-run',
		// Spread recorded timestamps out by 5ms each purely for stable
		// ordering; the harness uses instant delivery, so pacing doesn't
		// otherwise matter here.
		timestamp: startedAt + i * 5,
		type: 3,
		datasourceId: 'dns',
		data: event
	}));

	const recentPath = join(staticDemoDir, 'recents', 'dns-map.json');
	const recent = {
		id: 'dns-map-demo-recent',
		name: 'DNS Map demo',
		image: 'trace_dns:demo',
		params: {},
		gadgetInfo: {
			imageName: 'trace_dns:demo',
			dataSources: [buildDatasource()],
			datasources: [buildDatasource()]
		},
		events: recordedEvents
	};
	writeFileSync(recentPath, JSON.stringify(recent, null, '\t') + '\n');
	console.log(`Wrote ${recentPath} (${recordedEvents.length} events)`);

	const configPath = join(staticDemoDir, 'config.json');
	const config = JSON.parse(readFileSync(configPath, 'utf-8'));
	if (!config.recents.includes('dns-map.json')) {
		config.recents.push('dns-map.json');
		// Format with Prettier (matching the project's own JSON style,
		// which keeps short arrays like `recents` on one line) instead of
		// plain JSON.stringify, so re-running this script never produces
		// unnecessary formatting churn.
		const formatted = await prettier.format(JSON.stringify(config, null, 2), {
			parser: 'json',
			useTabs: true
		});
		writeFileSync(configPath, formatted);
		console.log(`Registered dns-map.json in ${configPath}`);
	} else {
		console.log(`${configPath} already references dns-map.json`);
	}
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
