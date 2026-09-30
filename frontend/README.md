# Inspektor Gadget Frontend

This is a Svelte-based frontend for [Inspektor Gadget](https://inspektor-gadget.io).

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```bash
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```bash
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

## Embedding the Desktop interface

`EmbeddableApp` is the library application entry point. It reuses the Desktop
environment list/create/detail, running-instance tabs, detached-instance
management, ArtifactHub discovery, arbitrary-image launcher, recording controls,
and session replay components. Desktop routes are thin adapters around those
same components; the library does not load the SvelteKit router.

For Kubernetes environments, a confirmed missing installation replaces the live
gadget cards with a deployment offer; Recorded Sessions remains available.
Neither initial loading nor ordinary connection/authentication/RBAC failures
show this offer. The backend marks a rejected `listInstances` response with
`data: { deploymentMissing: true, gadgetNamespace }` only after successful empty
discovery of IG-labeled DaemonSets, Deployments and Pods, including other namespaces.
Unready installations are not missing. Hosts must preserve rejected-response
data, not classify error text. Backends without this signal and builds without
`canCreateEnvironment` retain their existing dashboard behavior.

The offer opens the same deployment modal as Create Environment. Only its
explicit Deploy action submits `deployIG`; success refreshes the instance list.
Saved-environment deployments send `environmentID`, resolved by the backend to
the saved Kubernetes context and IG namespace (the namespace is fixed in this
modal). Connection credentials never need to be supplied by the webview.

Missing workloads do not imply that all supporting resources have been removed.
When Helm reports conflicting resource ownership, the deployment error offers
**Clean up and redeploy...** with a separate destructive-action confirmation.
The backend supplies safe metadata for chart resource conflicts. The modal lists
each object and requires an explicit deletion checkbox, including for unlabeled
objects. Approval sends the exact API version, kind, namespace, name, UID and
resource version in `cleanupResources`, with the failed attempt's configuration.
This mode deletes only approved chart conflicts rather than sweeping IG labels.
Changed identities require fresh review; other Helm owners, Kubernetes owner
references and protected/shared resources block recovery. Cancellation and
ordinary retry never carry approvals. Backends reporting only the older
ownership flag retain the separately confirmed label-based removal flow.

Existing configuration may be replaced and running gadgets interrupted. Resources
outside the approved conflicts remain protected; GitOps reconciliation must be
suspended at its source. No resource is automatically adopted into Helm.

```tsx
import { EmbeddableApp } from '@inspektor-gadget/frontend';
import { IGProvider, SvelteWrapper } from '@inspektor-gadget/react';
// Also load the emitted dist-lib/ig-frontend.css in your bundler.

<IGProvider adapter={adapter} language={hostLocale}>
	<SvelteWrapper
		component={EmbeddableApp}
		path="/env/my-environment"
		sessions={true}
		onNavigate={onNavigate}
		onStateChange={onAppliedState}
	/>
</IGProvider>;
```

`SvelteWrapper` takes individual component props: use
`<SvelteWrapper component={EmbeddableApp} {...props} />`, **not** `props={props}`.
The latter passes one property named `props`, leaving the application's `path`
unset.

Use one provider/application per document: services, navigation compatibility
state, and preferences are document-level singletons. Do not supply a competing
`IGProvider.onNavigate` when using `EmbeddableApp`; use the application's callback.
`initializeIG()` remains available to other hosts and now returns a cleanup
function. Cleanup disconnects the adapter and rejects outstanding requests.
`IGProvider` installs the transport before mounting its children, including
deep-linked screens that issue API requests during component initialization.
`apiService.cancelPending(reason?)` and `websocketService.disconnect()` are public
alternatives; late replies to cancelled calls are ignored.

### Host navigation and result controls

The exported `EmbeddableAppProps`, `EmbeddableAppState`, `ResultViewState`, and
`ResultViewChange` describe the contract:

- `path?: string`: Desktop URL including query parameters; defaults to `/`.
  Supported paths are `/`, `/environment/create`, `/env/:env`,
  `/env/:env/running/:instanceID`, `/browse/artifacthub`,
  `/browse/artifacthub/:repository/:package/:version`,
  `/gadgets/run/:image`, and `/sessions/:id`.
- `onNavigate?(path)`: navigation notification, including manual navigation.
  Links and back buttons work without a host callback. When controlling `path`,
  mirror this callback into host state so subsequent navigation commands change
  the prop, including a return to the route that preceded a manual navigation.
  The supplied initial path is rendered synchronously; startup acknowledgements
  use the same revision-checked navigation flow as later path updates.
- `viewState?: { search?: string; visualizers?: Record<string, string> }`:
  search text and **datasource-name → visualizer-ID** commands for the visible
  live/replay result. Pass a new object to apply a new command; omitted fields
  retain normal local behavior. `Gadget` and `GadgetWrapper` also accept this
  prop and `onViewStateChange`.
  Keep that object stable across acknowledgement-only React renders (for
  example, with `useMemo`); `SvelteWrapper` updates only changed host props so
  receiving an acknowledgement does not replay an unchanged command.
- `onStateChange?({ path, result? })`: actual applied state. `result` is absent
  before a result is mounted; when present it contains `instanceID`, effective
  debounced `search`, `visualizers`, and `availableVisualizers` (datasource-name
  → supported ID array). Manual edits are reported. Unsupported visualizers
  report their effective fallback, **not** the requested value. Hosts must
  compare the requested target/state with this callback before acknowledging;
  receipt of a navigation notification alone is not a result-state acknowledgement.
  This acknowledges view configuration, not completion of asynchronous filtering
  or receipt of backend events.
- `sessions?: boolean`: defaults to `true` for this application and controls the
  existing experimental recording/session UI. Desktop routes keep their existing
  configuration-controlled behavior.
- `fileOutput?: { formats: ('jsonl' | 'pcap-ng')[]; host: string; notify?: boolean }`:
  an explicit native-host capability for file-producing runs. Omit it for the
  unchanged table-only behavior used by browser, demo, website, and Insights
  embeddings. When supplied, the launcher offers **Default table view** and
  **To a file**; table remains the default. JSONL is available for typed
  datasources, while PCAP-NG is shown only for exactly one datasource advertising
  `cli.supported-output-modes` with a comma-separated `pcap-ng` token.
  The host must implement `selectFileOutput { format }` (returning either
  `null` for silent cancellation or `{ token, format, path, host, overwrite }`),
  `releaseFileOutput { token }`, and accept the one-use token in
  `runGadget.output`. File starts are foreground-only and unrecorded; recent
  presets retain only `{ format, datasourceIds? }`, never a token, path, or
  overwrite decision. Use `notify: false` only when the host centrally presents
  terminal file-capture notifications; picker/start/stop errors remain shared
  UI operation errors. Embedded file-status Copy uses
  `copyFileOutputPath { instanceID }` when `notify: false`.
  Existing destinations require host-side explicit confirmation. A successful
  replacement is no-clobber publication through a temporary recovery file. If
  replacement fails, the prior file is kept at terminal `recoveryPath`, which
  the shared status view displays as **Previous file**; after a successful
  replacement it is deleted.
  A brief interval without the final destination name is an intentional
  replacement limitation.

- `environmentDeployment?: { action: 'deploy' | 'redeploy' | 'undeploy'; namespace: string }`:
  prepares the existing deployment dialog when mounting a saved Kubernetes
  environment page. The user must still explicitly submit the action; this prop
  never executes deployment. Use the saved environment's namespace (the backend
  binds the operation to its saved connection). A new route, including a distinct
  request query value, remounts the page for repeated actions. Omission preserves
  existing behavior; deployment query parameters alone have no shared meaning.

- `launchPreferences?: boolean`: defaults to `false`. VS Code opts in to a
  single **Output** selector and **Choose file and start...**. Without saved
  options, PCAP-ng is selected for exactly one packet datasource when supported
  by the host; other gadgets default to table output. The host must implement
  `getGadgetDefaults { image }` returning `null` or `{ params, output? }`, and
  `resetGadgetDefaults { image }`. Requests use the exact image reference.
  The launcher marks custom starts with `rememberOptions: true`; the host strips
  this field before runtime dispatch and persists sanitized options only after
  acknowledgement, using protected storage, never browser localStorage.
  `selectFileOutput` receives `startAfterSelection: true` for the combined action,
  so the host can label confirmation **Start recording**. Cancellation returns
  `null` and does not start anything.
  Restored parameters are filtered against current metadata and exclude target
  selectors; explicit current presets override them. `launchPreset.restoreDefaults:
false` bypasses remembered options and packet-first defaults for explicit Recent
  requests. Reset preserves current target selectors. Quick actions should use
  the ordinary runtime path without `rememberOptions`, not execute via a preset.
  Omission preserves Desktop/Insights launcher defaults.

Navigation alone never starts a gadget. The existing launcher reads `env`,
`params` (JSON), `detached`, and `instanceName` query parameters and still requires
the user to click Run. Live instance IDs, remote detached IDs, and session/run IDs
remain distinct. Changing pages does not stop an active capture.

### Bundling, styles, and existing host hooks

For native result tabs, `EmbeddedGadget` composes `GadgetWrapper` with the existing
settings and confirmation modals, without application navigation or internal tabs.
Its `instanceID` is the transport's local instance ID, not a host run ID or remote
detached ID. `showToasts={false}` suppresses the embedded toast container in both
`EmbeddedGadget` and `EmbeddableApp`.

`EmbeddableApp` accepts `showNavigation={false}` to hide its application toolbar
and `showTabs={false}` to hide environment/result tab headers when a host supplies
native navigation. Both default to `true`; a host can retain internal result tabs
without also showing the application toolbar.
The optional `homeTitle` replaces the home greeting with a plain theme-colored
heading. Without it, Desktop and library consumers retain the existing greeting
and gradient.

Hosts can subscribe to `toastStore`, retain actions in their originating document,
and await `toastStore.triggerAction(id)`. Actions are one-shot and reject expired
or evicted toasts; host navigation/disposal checks remain the host's responsibility.
`settingsDialog.openTo()` opens the reused modal. Setting
`settingsDialog.hostManaged = true` explains and disables host-controlled
appearance/language options; the default keeps Desktop's controls enabled.
Hosts with a native settings editor can install
`settingsDialog.setOpener((category, setting) => ...)` before mounting to route
settings links to that editor instead. It returns a cleanup function that restores
the previous opener. Without an opener, the existing modal behavior is unchanged.
`setExternalURLOpener(opener)` similarly redirects calls to `openExternalURL`;
its cleanup restores the previous opener. When no host override is installed,
Wails still uses `Browser.OpenURL` and browser consumers still use
`window.open(..., '_blank', 'noopener,noreferrer')`.

`configuration.snapshot()`, `apply(snapshot)` and `onChange(callback)` support
host-owned preference synchronization, including resets. Hydrate before mounting
and suppress feedback while applying host snapshots. `launchPreset` supplies a
typed launcher preset without encoding parameters in a URL. It applies only to
the launch route whose image equals `launchPreset.image` (compared as the route
decodes it); other launch routes keep their ordinary defaults, target selection
and history.
An optional `launchPreset.transient` locks the selected environment and suppresses
detached execution, recording, and launch-history writes for temporary host
targets. The default is unchanged; the host must enforce the same restrictions
in its controller/backend rather than treating hidden controls as authorization.
`applyGadgetHistories(...)` mirrors explicitly supplied host-owned history into
the reused environment screens. Call `useHostGadgetHistory()` before mounting to
keep those mirrors and manual launcher history in document memory rather than
localStorage when the host provides protected persistence. Desktop's default
localStorage history is unchanged.

Run `npm run build:lib`; package entry remains `dist-lib/ig-frontend.js` (no new
package export map). `npm run build:lib -- --outDir build-embedding` uses a separate
output directory, useful when preserving an existing build. Include
`ig-frontend.css`, adjacent lazy-loaded JS/locale chunks, `assets/` workers, and
`themes/` in the host bundle. Worker URLs are relative to their compiled modules.
The inline table filter worker needs `worker-src blob:`; its fallback uses a data
URL. Existing Svelte-injected component styles also need the host's compatible
style CSP. The library's existing optional plugin/Monaco chunks are still emitted;
embedding does not activate local plugin discovery or a plugin designer.

Source consumers need the aliases from `vite.lib.config.ts`:
`$lib` and `$app/{paths,state,environment,navigation}`. The `app-state.ts` shim
re-exports reactive state from `app-state.svelte.ts`; compile rune modules with
the Svelte Vite plugin. Keep a single Svelte runtime with your React host.

Use existing `setTheme`/`resetTheme` token APIs and the host's `.dark` class, plus
`IGProvider.language`/`setLanguage`. Some reused screens still use legacy light/
dark utility colors; host theme/localization matching is best effort, not a new
upstream theme or i18n implementation. ArtifactHub's list currently fetches
`https://artifacthub.io` directly and requires that origin in `connect-src`.

### Focused validation

```bash
node --test src/lib/utils/embedded-route.test.ts
npx playwright test --config tests/embedding/playwright.config.ts
npm run check
```

To also exercise the actual React provider/wrapper effect ordering, supply a
directory containing the host's installed `react` and `react-dom` peer packages:

```bash
IG_REACT_MODULES=/path/to/host/node_modules npx playwright test --config tests/embedding/playwright.config.ts
```

Without that variable, only the optional React-specific check is skipped.
Set `IG_SVELTE_MODULES` to a host's `node_modules` directory as well to exercise
its actual Svelte runtime rather than this checkout's runtime.
Precompiled Svelte output requires the matching compiler/runtime version.
For example, output from Svelte 5.57.0 must not be paired with a host's 5.56.8
runtime; newly generated internal helpers may not exist there.

The embedding browser tests load the **production library** with a deterministic
transport fixture. They cover reused screens, metadata-backed parameters,
recording launch, attach/replay, controlled and manual result changes, real table
filtering, unsupported-visualizer fallback, and disconnect cancellation. They do
not establish connectivity to a real IG runtime or validate a VS Code package.
