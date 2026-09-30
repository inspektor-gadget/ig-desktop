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
stderr is diagnostics. At startup the client keeps private copies of fds 0/1 and
points fd 1 at stderr (fd 0 at the null device), so stray writes to stdout land
in diagnostics instead of corrupting frames. Maximum JSON frame: **8,388,608 bytes**, excluding LF.
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
An environment is `{id,name,runtime,params,kubeconfig?}`; runtime is `grpc-k8s` or `grpc-ig`.
The optional top-level `kubeconfig` is a source reference for imported Kubernetes
environments, not credential contents. The extension strips it and connection
parameters from webview and agent projections.
Unavailable sessions are advertised as false with a diagnostic `sessionError`;
recording/session commands then return errors. Legacy `helo` broadcasts type-100
environment events and now acknowledges once. Repeated `clientHello` returns the
startup environment snapshot; use `helo` for a fresh enumeration.

Malformed JSON returns a type-1 error (empty reqID when unidentifiable). Invalid
envelopes and unknown commands return errors, not success. Oversized incoming
frames, duplicate in-flight IDs, and write failures (including a write that
cannot complete within 5 seconds) are fatal: diagnostics on stderr,
owned-context cancellation, nonzero exit. Oversized output is never truncated
and does not end the connection: a response that would exceed the frame limit
is replaced by an error reply (`response exceeds frame limit`) to the same
`reqID`, and an oversized unsolicited event is dropped with a stderr warning.
The host must bound retention, reject pending promises on process
exit, and consume stdout continuously.

## Transient Kubernetes targets (private stdio only)

Only this executable opts in with `Handler.EnableTransientKubernetes()` before
registering handlers. Desktop and WebSocket services do not expose these commands
by default. `clientHello.capabilities.transientKubernetesTargets` advertises support.

`kubeconfig` is either `{"kind":"default"}` (normal client-go loading rules) or
`{"kind":"file","path":"/absolute/path/to/config"}`. File paths are lexically
cleaned (`/a//b` and `/a/b` are the same source). An explicit file or context
error never falls back to default/in-cluster configuration.

| Command | Data | Successful result |
| --- | --- | --- |
| `getKubernetesContexts` | `{kubeconfig}` | `{contexts:[{name,namespace}],currentContext}` |
| `importKubernetesEnvironment` | `{kubeconfig,context}` | Saved `grpc-k8s` environment, after a type-100 environment event |
| `createKubernetesTarget` | `{kubeconfig,context,requireCurrentContext?,matchSavedEnvironments?}` | `{id,name,runtime:"grpc-k8s",namespace,expiresAt,savedEnvironments?:[{id,name}]}` |
| `touchKubernetesTarget` | `{id}` | `{expiresAt}` |
| `releaseKubernetesTarget` | `{id}` | `{released}` |

Import validates the selected named context locally, without cluster requests,
credential-plugin execution or deployment. It stores only its source reference
and context, and repeated imports of that source/context reuse the imported
environment. Runtime, completion and deployment resolve that source on each
operation; a missing source/context never falls back. Imported filter namespace
defaults follow the selected context. Source-relative credential paths remain
client-go resolved. Import serialization is per storage owner, not a cross-process
transaction. The import command is private to this client, like target creation.

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

`matchSavedEnvironments:true` optionally returns saved identities whose
`grpc-k8s` connection is proven equal to this registration. Matching compares
the effective context, namespace, and locally resolved cluster/authentication
configuration, including TLS, proxy, impersonation, auth-provider and exec
declarations. Context/source names alone are not evidence of equality.
Only default runtime connection parameters match (omitted or explicitly equal
`gadget-namespace`, `tcp-port`, and `connection-timeout`). Unknown parameters and
nonempty legacy `params.kubeconfig` overrides are conservatively excluded: the
legacy saved runtime does not consistently honor that override. Imported
top-level `kubeconfig` references are supported and compared against their actual
source, even when the default kubeconfig is unavailable. Unusable individual
candidates are skipped; failure to enumerate saved storage is an error, not a
no-match result. Matching neither connects nor executes credential plugins.
The legacy saved runtime currently derives its default gadget filter namespace
from the active context even with an explicit saved context. That default must
also equal the frozen selected namespace; otherwise the candidate is excluded.

The host can select the sole match or offer a picker for multiple matches.
Selection uses **both** `environmentID: savedID` and
`kubernetesTargetID: originalAdhocID` on `getGadgetInfo`, `runGadget`, Kubernetes
resource completion, and target-bearing attach/list/remove requests. Each such
request verifies the live handle, its candidate pairing, and that the saved
environment still exists with unchanged runtime/connection parameters. A stale
or edited pairing fails; it never silently switches to an ordinary saved
connection. The runtime uses an owned copy of the original frozen configuration,
while recording, session history and stream events retain the **saved** identity.
File-output provenance retains the saved name and frozen context/namespace.
Target-bearing deploy/check/undeploy and environment-management requests are
rejected rather than ignoring the handle. Unrelated saved operations without
`kubernetesTargetID` continue using the saved environment's ordinary connection.

Omitting `matchSavedEnvironments`, or finding no match, retains the transient
behavior below. Saved bindings are process-local, not persisted or restored
after restart. Kubeconfig declarations and inline credentials are frozen;
external certificate/key/token file contents, credential-plugin results, and
process/network environment (for example proxy environment variables) are not.
Those still follow client-go's normal connection-time behavior.

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
against transient identities are unsupported. A matched saved identity supports
its normal recording and runtime operations through the frozen handle.

The host must renew while window-owned views/streams need the registration.
Release/expiry only forgets the registration; runtimes already created own their
config and are not stopped. Cancel a running capture explicitly using its local
instance ID via `stopInstance`. Preset namespace/pod values are editable defaults,
not a collection-isolation boundary.

## Missing Kubernetes deployments

`listInstances` remains a failed command when IG is absent. Only a successful,
empty pod lookup followed by complete IG workload discovery may add
`data: {"deploymentMissing":true,"gadgetNamespace":"gadget"}` to that rejection.
Discovery checks both supported IG labels on DaemonSets, Deployments and Pods,
including other namespaces. Installed-but-unready workloads, RBAC/authentication
failures and connection failures never carry this signal. Preserve error data
through host bridges; do not infer absence from error messages.

`checkIGDeployment` similarly returns `missing:true` only for confirmed absence;
`deployed:true` identifies an installation, not readiness or working connectivity.
Incomplete discovery returns an error field instead of claiming absence.

`deployIG` accepts an optional saved `environmentID`. When supplied, the backend
resolves its current saved Kubernetes context and IG namespace and ignores
client-supplied connection/namespace overrides. The shared dashboard uses this
only after explicit modal confirmation. Without the ID, Create Environment's
existing explicit deployment configuration is unchanged. Transient identities
and target-bearing management requests remain unsupported.

Deployment error events (type 202), in both progress and terminal paths, include
`ownershipConflict:true` and `resourceConflicts` when Helm's install ownership
validation rejects existing objects. Each conflict contains only
`{apiVersion,kind,namespace,name,uid,resourceVersion,blockedReason?}`. Identities
come from the selected chart's rendered manifest and Kubernetes GETs, not parsed
error text. No object data, credentials or kubeconfig is included. If inspection
fails, the actual failure is reported and the list is empty.

After explicit object-specific user confirmation, `deployIG` accepts
`redeploy:true` with `cleanupResources:[{apiVersion,kind,namespace,name,uid,resourceVersion}]`
and the failed attempt's configuration and saved environment identity. Nonempty
approvals are rejected on ordinary deploy or undeploy. Exact mode **bypasses**
label-based uninstall: it re-renders the selected chart using Helm's read-only
server dry-run, proves the entire current conflict set matches the approvals,
preflights deletion authorization/admission, re-reads all objects, and deletes
only the approved objects using both UID and resourceVersion preconditions.
Only an **omitted** `cleanupResources` field retains the existing explicit
label-based redeploy path. Explicit `[]`, `null`, malformed/incomplete identities
and duplicate approvals are rejected before deployment starts, never interpreted
as authorization for label cleanup. An ordinary retry never authorizes cleanup.

Changed identities, deletion-precondition conflicts and recreated objects return
fresh `resourceConflicts` when inspection succeeds. The frontend must discard
previous selections and obtain new object-specific approvals, never reuse them.

Blocked conflicts require manual resolution and prevent the whole exact cleanup;
approving only an eligible subset is insufficient. Blocking includes any owner
reference, foreign Helm release/installer ownership, Helm storage/keep policy,
cluster-scoped objects (including Namespaces and CRDs), cross-namespace objects,
and shared/unsupported kinds. Eligible kinds are namespace-local ConfigMaps,
Secrets, ServiceAccounts, Services, apps/v1 DaemonSets and Deployments. Client
eligibility claims are ignored. Missing, extra, duplicate or changed approvals
stop before deletion and require fresh inspection/confirmation.

There is no automatic adoption, delete retry, or label sweep in exact mode.
Inspection/preflight failures delete nothing. Kubernetes offers no multi-object
delete transaction: a race or server failure during the real deletion phase can
leave partial cleanup; the error reports how many deletion requests preceded
the failure and installation stops. Deletion completion is checked before
installation; recreated objects require fresh confirmation. Helm's ownership
override is used only for read-only rendering, never for the real install.

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
array/snapshot, and 7 a file-output status. Metadata is emitted before datasource rows. Terminal `reason`
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

## Authorized foreground file output

Only private stdio and explicitly enabled **native** Wails services support file
output. Ordinary web/socket services, including a Wails `server` build, do not
register its commands and independently reject `runGadget.data.output`.
`clientHello.capabilities.fileOutput` and `getFileOutputCapabilities` return the
same `{formats:["jsonl","pcap-ng"],host:"hostname"}` object. File selection grants
no recording, detached execution, or remote-filesystem capability.

| Command | Request data | Successful `data` |
| --- | --- | --- |
| `prepareFileOutput` (private stdio only) | `{path,format,overwrite?:false}` | `{token,format,path,host,overwrite}` |
| `selectFileOutput` (native Wails only) | `{format}` | Same selection; `null` for cancelled native picker |
| `releaseFileOutput` | `{token}` | `null`; idempotent for unused/unknown tokens |
| `getFileOutputCapabilities` | `{}` | `{formats:["jsonl","pcap-ng"],host}` |

The path must be absolute and on the backend host. Preparation opens the parent
directory for identity tracking but **creates no file** and starts no gadget.
Tokens are opaque, one-use, format-bound, expire after 30 minutes, and are capped
at 128 outstanding selections. Release selection when format/target/gadget
changes or the configuration closes. Never persist tokens or paths in presets.
Selections and active writers reserve their final pathname within the host
manager. A changed destination/directory invalidates approval.

Existing destinations require explicit `overwrite:true` approval. Preparation
records identity, mode, size, modification time and a streaming SHA-256 content
fingerprint; Start revalidates the identity metadata. Native Wails additionally displays an explicit
Replace confirmation **after** preparing that fingerprint and releases the token
on cancellation. Trusted hosts should likewise prepare before confirmation and
retain that token, rather than create a fresh approval after confirmation.
The returned `overwrite` indicates whether an existing file was selected.
The content is hashed twice: at preparation and once at publication, on the
file actually moved aside, which is where it closes the check-then-act gap. Its
cost is proportional to the previous file size, without holding a capture-wide
buffer or any writer lock.

**Replacement safety semantics:** portable OS APIs do not offer atomic
identity/content-checked replacement. After clean capture finalization, move the
destination to a unique sibling `.recovery` name with a native **no-replace**
rename, verify the object actually moved against the approved fingerprint, then
publish the new capture with the same no-replace rename. There is briefly no file
at the final pathname; this is not an atomic exchange. A competing creation is
never overwritten. On failure, restore the recovery with a no-replace rename
only if the final name is free. Otherwise preserve both recovery and partial,
return failure and expose `recoveryPath`. After successful publication the
recovery file is deleted; processes that still hold the old file open keep it
alive until they close it (POSIX unlink semantics; `FILE_SHARE_DELETE` on
Windows). Linux uses
`renameat2(RENAME_NOREPLACE)`, macOS `renameatx_np(RENAME_EXCL)`, and Windows
handle-relative `NtSetInformationFile` with replacement disabled. All operations
use the held parent directory. Where the filesystem or kernel lacks no-replace
rename, publication of a new file falls back to an exclusive hard link plus
removal of the partial; replacing an existing file requires no-replace rename,
so preparation probes the directory and refuses `overwrite:true` up front where
it is unsupported. There is no unconditional rename-over-target fallback.

```json
{"cmd":"runGadget","reqID":"capture","data":{"image":"example/gadget:tag","environmentID":"environment-uuid","params":{},"durationSeconds":30,"output":{"token":"opaque-one-use-token","format":"jsonl","datasourceIds":["events"]}}}
```

Omit `datasourceIds` for all supported JSONL sources. Unknown, duplicate, or
unsupported sources fail, using actual runtime metadata rather than previously
fetched configuration metadata. PCAP-NG requires exactly one packet-capable
datasource in the gadget; an explicit selection must contain only that source.
`record`, `detached`, nonempty `sessionId`, and nonempty `sessionName` are rejected.
Known authorization/open failures reject the command before run acceptance;
remote/metadata/encoding failures arrive as terminal failures after acceptance.

The run acknowledgement has its usual fields and `data.output` is the **status**,
not the consumed token. Type 7 carries this same object directly in `data`, with
the usual `environmentID` and `instanceID`. Type 5's `data` includes `output`
alongside `reason` and `error`:

```json
{"format":"jsonl","path":"/host/captures/run.jsonl","partialPath":"/host/captures/.run.jsonl.UUID.partial","host":"hostname","state":"running","records":100,"bytes":18254,"datasourceIds":["events"]}
```

States: `starting`, `running`, `stopping`, `completed`, `failed`. `error` is present
on failure (bounded to 4 KiB plus a truncation marker); `partialPath` is present
while writing and on failure if at least one record was written (a failed run
without records removes its partial). `recoveryPath` identifies preserved previous/
displaced destination data when replacement fails; it is absent after successful
replacement (or if deleting the recovery file failed, it remains present).
Progress is
approximately once per second plus state changes and finalization; metadata
precedes type-7 progress. An early setup failure can emit a type-5 final status
without metadata. File runs send **no type-3/6 payloads or type-4 runtime logs**, use no frontend data
buffer and do not write SQLite sessions. The host should retain only bounded
terminal status summaries; this backend does not persist or expose file contents.

The writer creates a mode-0600, exclusive, uniquely named sibling partial.
Callbacks are synchronous/backpressured, bounded by the incoming record/snapshot,
serialized against finalization, and stop the run on write errors. Runtime
receivers and local operators stop before flush/close. Publication occurs only
after successful flush, fsync and close, using an atomic **no-replace rename**
through the held directory handle (so FAT32/exFAT, SMB and FUSE targets without
hard links work), or an exclusive hard link where no-replace rename is
unsupported. The recovery name is removed only after successful publication.
Failed publication leaves the partial and restores the old destination if possible.
A destination that appears during capture is never overwritten. If removing the
redundant partial name fails after publication, completion retains `partialPath`
as well as any `recoveryPath`.
Bytes count successful OS writes. Before publication the capture is fsynced, and
the directory is fsynced after publication (skipped on Windows and on
filesystems that do not support directory fsync).

### JSONL schema version 1

UTF-8, one complete JSON object plus LF per line:

1. `{"type":"capture","version":1,"format":"ig-jsonl","provenance":{...},"integerEncoding":"int64-uint64-and-integer-arrays-decimal-strings"}`
2. One `{"type":"schema","datasourceId":"...","datasourceType":1|2,"fields":[...],"annotations":{...}}`
   per selected datasource, before any data. Fields use the pinned IG field
   descriptors (`fullName`, numeric `kind`, flags, tags, annotations, etc.).
3. `{"type":"data","datasourceId":"...","data":{...}}` for a single event, or
   `{"type":"snapshot","datasourceId":"...","data":[...]}` for one array update.
   Empty snapshots remain `[]`, not missing events.

Provenance contains image, environment ID, local instance ID, backend host, gadget
params, requested duration, UTC start timestamp and a safe `target` descriptor.
Saved targets supply `{name,runtime,transient:false}`. Frozen ad-hoc Kubernetes
targets supply `{name,runtime:"grpc-k8s",context,defaultNamespace,transient:true}`,
copied from the registration rather than reloading kubeconfig. Offline readers
therefore retain the selected context/label after the ad-hoc UUID expires.
`defaultNamespace` is the frozen default, not a collection-isolation guarantee;
explicit gadget scope parameters remain in `params`. Target provenance never
includes environment connection options, kubeconfig paths, credentials or API
server configuration. Flattened field names and visibility follow the existing IG JSON
formatter with all visible/hidden fields enabled (explicit `json.skip` and
unreferenced fields are still omitted). Scalars `int64`/`uint64` and **all integer
arrays** are decimal strings, avoiding JS rounding and unsigned-array overflow.
Smaller integer scalars and finite floats remain JSON numbers; booleans and
strings retain their types, binary/fallback fields use hexadecimal strings.
Schema `kind` determines the original type. Non-JSON values fail the capture.
`records` counts encoded data/snapshot lines, **one per snapshot**,
including empty snapshots; schema/provenance lines contribute bytes but not
records. Output is buffered and flushed at least once per second and at
finalization, so a crash loses at most about one second of records; abruptly
interrupted partial files may have an incomplete final line.

### PCAP-NG annotation contract

Uses `gopacket/pcapgo` v1.7.0 (the pinned IG v0.55.1 dependency), adapting the
extcap writer without its subprocess, hardcoded datasource/field names or filter.
`cli.supported-output-modes` is parsed as comma-separated tokens containing
`pcap-ng`. `pcap.payload`, `pcap.timestamp`, and `pcap.packet-length` must point to
bytes/uint8-array, timestamp, and uint32 original-length fields respectively.
The pinned tcpdump annotation points at an RFC3339Nano **string** timestamp;
the pinned formatter converts its raw field to Unix nanoseconds. For a string
timestamp this writer uses the uint64 `<field>_raw` sibling when present (the
string layout can be overridden by `formatters.timestamp.format`), otherwise it
parses the string as RFC3339Nano; it also accepts an explicitly annotated uint64
Unix-nanosecond field. It does not reproduce the pinned CLI's erroneous
string-as-uint64 read.
Timestamps outside nonnegative int64 nanoseconds are rejected.

Ethernet link type follows that IG contract. Captured length is the payload
length, original length comes from the annotation, and nanosecond resolution is
preserved. Interface identity uses length-prefixed values of
`pcap.interface-key:true` fields and string `pcap.interface-var` fields; metadata
variables are query-escaped in interface descriptions. A present string
`proc.comm` becomes a packet comment. Section comments include versioned
provenance. The file has an initial placeholder interface 0 (pcapgo cannot
write a section without one; it keeps zero-packet files valid) that no packet
uses; observed interfaces are added separately. Limits: 65,536 observed interfaces,
64 KiB identity keys (8 MiB aggregate), and 60,000-byte section/interface/comment metadata; exceeding
them fails rather than growing memory or truncating metadata silently.
`records` counts encoded packets (see buffering above); bytes include all headers
and metadata. Packet payload never takes a JSON round trip.

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

`sessionId` must be a canonical (lowercase, hyphenated) UUID; anything else is
rejected before it is used as a storage path.

Frame limits still apply to replay pages and individual events; reduce the page
limit for large events. Legacy full replay may exceed the frame limit, in which
case it fails with `response exceeds frame limit`.

## Shutdown and runtime semantics

`{"type":1,"cmd":"shutdown","reqID":"bye","data":{}}` cancels owned contexts,
drains command handlers and streams, then ACKs null (or a drain error).
EOF and SIGTERM/SIGINT also cancel them, even while the host keeps stdin open,
and the process exits after the same drain: status 0 unless draining fails.
The reader remains responsive while commands run. A panicking command handler
is logged to stderr and answered with an error reply; it does not end the
process. Shutdown allows up to 5 seconds for command handlers and
35 seconds for owned streams/final recording flush (the runtime allows 30 seconds
for final profile results). Orderly shutdown emits terminal file statuses before
its ACK; EOF/signals have no acknowledgement. Native Wails shutdown also requests
Stop for owned runs and allows 35 seconds to finalize before returning. Crashes,
blocked storage, a non-reading pipe, and forced process termination can defeat
graceful finalization; partial output is retained.

Foreground runtime cancellation sends a gRPC stop request and drains final
results. Attachment cancellation closes only its stream. A client crash cannot
send or await that stop request; this client does **not** advertise a remote
lease or guarantee remote cleanup after arbitrary crash/network failure. The
daemon's own timeout/disconnect behavior must be verified on the actual runtime.
No real cluster, macOS runtime, or remote-host execution is established by local
fake-gRPC tests and cross-compilation alone.
