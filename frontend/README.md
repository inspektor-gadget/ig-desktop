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

`configuration.snapshot()`, `apply(snapshot)` and `onChange(callback)` support
host-owned preference synchronization, including resets. Hydrate before mounting
and suppress feedback while applying host snapshots. `launchPreset` supplies a
typed launcher preset without encoding parameters in a URL.
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

The embedding browser tests load the **production library** with a deterministic
transport fixture. They cover reused screens, metadata-backed parameters,
recording launch, attach/replay, controlled and manual result changes, real table
filtering, unsupported-visualizer fallback, and disconnect cancellation. They do
not establish connectivity to a real IG runtime or validate a VS Code package.
