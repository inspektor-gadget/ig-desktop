# Private VS Code client

Build from the IG Desktop module (no Wails, frontend embed, or HTTP listener):

```sh
CGO_ENABLED=0 go build -tags withoutebpf -o bin/ig-vscode-client ./cmd/ig-vscode-client
# Cross-build only; this does not establish macOS runtime support:
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -tags withoutebpf \
  -o bin/ig-vscode-client-darwin-arm64 ./cmd/ig-vscode-client
bin/ig-vscode-client --data-dir /absolute/extension/global-storage/backend
```

`withoutebpf` excludes upstream Linux-only helper initialization. Sessions use
pure-Go `modernc.org/sqlite`, including in CGO-disabled builds. The injected root
contains `env`, `helm`, `plugins`, and `sessions`. No Desktop home configuration is
automatically shared. Kubeconfig and credential helpers still resolve on the
extension host. Existing Desktop `NewServices()` callers retain their defaults.

## Framing and readiness

Private stdin/stdout, one UTF-8 JSON object per line; stdout is protocol only,
stderr is diagnostics. Maximum JSON frame: **8,388,608 bytes**, excluding LF.
Writes are serialized and backpressured (pipe writes time out after 5 seconds).
At most **128** in-flight requests; request IDs must be unique while pending.
Commands may execute concurrently; await a reply before a dependent command.
Request `type` may be omitted, matching existing Desktop adapters. Only the
legacy `{"cmd":"helo"}` notification may omit `reqID`; its ACK has an empty ID.

```json
{"type":1,"cmd":"clientHello","reqID":"host-1","data":{"protocolVersion":1}}
```

Await the matching successful type-1 reply before declaring the process ready:

```json
{"type":1,"cmd":"clientHello","reqID":"host-1","success":true,"error":"","data":{"protocolVersion":1,"version":"dev","maxFrameBytes":8388608,"maxPendingRequests":128,"commands":["clientHello","shutdown","..."],"environments":[],"capabilities":{"sessions":true,"recording":true,"sessionPagination":true,"sessionError":"","duration":true,"detachedDuration":false,"remoteLease":false,"transientKubernetesTargets":true}}}
```

`commands` is the actual complete handler list, not the abbreviated example.
An environment is `{id,name,runtime,params}`; runtime is `grpc-k8s` or `grpc-ig`.
Unavailable sessions are advertised as false with a diagnostic `sessionError`;
recording/session commands then return errors. Legacy `helo` broadcasts type-100
environment events and now acknowledges once. Repeated `clientHello` returns the
startup environment snapshot; use `helo` for a fresh enumeration.

Malformed JSON returns a type-1 error (empty reqID when unidentifiable). Invalid
envelopes and unknown commands return errors, not success. Oversized frames,
duplicate in-flight IDs, and write failures are fatal: diagnostics on stderr,
owned-context cancellation, nonzero exit. Oversized output is not silently
truncated. The host must bound retention, reject pending promises on process
exit, and consume stdout continuously.

## Transient Kubernetes targets (private stdio only)

Only this executable opts in with `Handler.EnableTransientKubernetes()` before
registering handlers. Desktop and WebSocket services do not expose these commands
by default. `clientHello.capabilities.transientKubernetesTargets` advertises support.

`kubeconfig` is either `{"kind":"default"}` (normal client-go loading rules) or
`{"kind":"file","path":"/absolute/path/to/config"}`. An explicit file or context
error never falls back to default/in-cluster configuration.

| Command | Data | Successful result |
| --- | --- | --- |
| `getKubernetesContexts` | `{kubeconfig}` | `{contexts:[{name,namespace}],currentContext}` |
| `createKubernetesTarget` | `{kubeconfig,context,requireCurrentContext?}` | `{id,name,runtime:"grpc-k8s",namespace,expiresAt}` |
| `touchKubernetesTarget` | `{id}` | `{expiresAt}` |
| `releaseKubernetesTarget` | `{id}` | `{released}` |

Only context display metadata is returned, never kubeconfig/authentication
objects. Registration resolves the **selected** context and its namespace once,
preserving source-relative certificate/key/exec paths. Empty namespaces become
`default`. Later kubeconfig edits do not retarget registrations. Credential files
and credential helpers still follow client-go's normal authentication behavior
when a client connects; registration/discovery do not execute helpers.
Legacy auth-provider refresh is allowed in memory, but its client-go persister
is disabled for transient targets, so refresh cannot rewrite the kubeconfig.

Explorer actions set `requireCurrentContext:true`: the requested context must
still equal `current-context` in the same kubeconfig snapshot used to create the
registration. A switch since context discovery produces an explicit retry error,
not a target in either the old or new context. Omitting/clearing this flag keeps
explicit-context selection available. The extension separately guards changes
to its configuration source while awaiting preparation; later context/source
changes do not redirect the frozen target.

IDs are `adhoc-` followed by a UUID. `expiresAt` is Unix milliseconds. Registrations
have renewable five-minute leases, are capped at 64, swept once per minute (and
on registry access), and cleared on backend cancellation. Unknown/expired
handles are errors, never saved-environment fallbacks. Release is idempotent:
`released:false` means an already released/expired/unknown well-formed handle.
Neither registrations nor kubeconfig edits are persisted, and `KUBECONFIG` is
not changed.

Pass a transient ID as `environmentID` to `getGadgetInfo`, foreground `runGadget`,
or `getK8sNodes/Namespaces/Pods/Containers/Labels`. All use copies of the same
resolved config. Detached runs, `record:true`, and nonempty `sessionId` or
`sessionName` are rejected. `record:false` and empty optional session fields are
treated as absent (JSON null also has the ordinary Go zero-value semantics).
Attach, remote list/remove, environment management, and deployment requests
against transient IDs are unsupported. Stored-environment behavior is unchanged.

The host must renew while window-owned views/streams need the registration.
Release/expiry only forgets the registration; runtimes already created own their
config and are not stopped. Cancel a running capture explicitly using its local
instance ID via `stopInstance`. Preset namespace/pod values are editable defaults,
not a collection-isolation boundary.

## Captures and identity

```json
{"type":1,"cmd":"runGadget","reqID":"run-1","data":{"image":"ghcr.io/inspektor-gadget/gadget/trace_exec:latest","environmentID":"environment-uuid","params":{},"durationSeconds":30,"record":false}}
```

Successful ACK echoes run fields with `data.id` assigned a **connection-local
UUID**. Start acknowledgment means accepted, not successful remote execution.
Run errors arrive in the terminal event. Arbitrary images and metadata-backed
parameter strings use the existing runtime; `getGadgetInfo` takes
`{url,environmentID}`.

`durationSeconds` is an integer in `0..9223372036`. Omitted/zero means manual
ongoing operation. Positive durations set both a client context deadline and
the existing gRPC run-request timeout. The client timer starts at acceptance,
including connection/setup time, not at first event. It is independent of any
editor/webview. Positive duration with `detached:true` is rejected.

Events can precede the start ACK. Buffer bounded early events by `instanceID`,
then associate them when the ACK arrives:

```json
{"type":2,"environmentID":"environment-uuid","instanceID":"local-uuid","data":{"dataSources":[]},"sessionInfo":{"sessionId":"session-uuid","runId":"recorded-run-uuid","isNew":true}}
{"type":3,"instanceID":"local-uuid","datasourceID":"events","data":{"comm":"example"}}
{"type":5,"environmentID":"environment-uuid","instanceID":"local-uuid","data":{"reason":"duration","error":""}}
```

Type 2 is protobuf-JSON gadget metadata, 3 a row, 4 a log, 5 terminal, 6 an
array/snapshot. Metadata is emitted before datasource rows. Terminal `reason`
is `completed`, `cancelled`, or `duration`; a nonempty `error` indicates failure.
Session/run IDs are separate from both local and remote instance IDs.

| Command | Data | Meaning/result |
| --- | --- | --- |
| `stopInstance` | `{id: localUUID}` | ACK null: cancellation requested, not completion; await type 5. Unknown ID errors. |
| `listInstances` | `{environmentID}` | Remote protobuf JSON `{gadgetInstances:[...]}`. |
| `runGadget` detached | `{image,environmentID,params,detached:true,instanceName?}` | ACK includes local `id` and assigned `remoteInstanceID` (32 hex). Type 5 completes creation, not the remote gadget. |
| `attachInstance` | `{id: remoteInstanceID,image,environmentID,params,instanceName?}` | ACK `id` is a **new local** attachment UUID. Older callers may put the remote ID in `image` instead. |
| `removeInstance` | `{id: remoteInstanceID,environmentID}` | Explicitly removes remote detached instance. |

Stopping an attachment disconnects it; it does **not** remove the remote gadget.
Detached creation is explicitly independent after completion. Detached creation
does not supply a recordable stream; `record:true` with detached is rejected.
Multi-target creation can fail partially; inspect errors and list/remove
explicitly rather than assuming automatic rollback.

## Recording and replay

Foreground runs accept `record`, `sessionId` (optional existing session), and
`sessionName`. Setup failures terminate with an explicit error, not a silent
unrecorded capture. The metadata event supplies the resulting session/run IDs.
Storage write/finalization failures are diagnosed on stderr.

- `listSessions`: `{environmentId}` (note lowercase `d`).
- `getSession`: `{sessionId}`; session metadata and runs with `gadgetInfo`.
- `getGadgetRun` (also `getRun`): `{sessionId,runId}`; one run and metadata.
- `getRunEvents`: `{sessionId,runId}`; legacy full replay array.
- `getRunEventsPage`: `{sessionId,runId,afterID:0,limit:1000}`; bounded row count,
  limit 1–1000; returns `{events,hasMore,nextAfterID}` in insertion-ID order.
  Continue with `afterID:nextAfterID`. Each event is
  `{id,runId,timestamp,type,datasourceId?,data}`; timestamps are Unix milliseconds.
- `deleteSession`: `{sessionId}`; retain the UI's explicit deletion workflow.

Frame limits still apply to replay pages and individual events; reduce the page
limit for large events. Legacy full replay may exceed the frame limit.

## Shutdown and runtime semantics

`{"type":1,"cmd":"shutdown","reqID":"bye","data":{}}` ACKs null, then cancels owned
contexts; EOF and SIGTERM/SIGINT also cancel them. The reader remains responsive
while commands run. Shutdown allows up to 5 seconds for command handlers and
35 seconds for owned streams/final recording flush (the runtime allows 30 seconds
for final profile results). Terminal events may follow the shutdown ACK.

Foreground runtime cancellation sends a gRPC stop request and drains final
results. Attachment cancellation closes only its stream. A client crash cannot
send or await that stop request; this client does **not** advertise a remote
lease or guarantee remote cleanup after arbitrary crash/network failure. The
daemon's own timeout/disconnect behavior must be verified on the actual runtime.
No real cluster, macOS runtime, or remote-host execution is established by local
fake-gRPC tests and cross-compilation alone.
