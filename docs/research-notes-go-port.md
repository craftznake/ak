# Research notes: ak → Go CLI migration plan

- **Scope:** the migration contract for rewriting `bin/ak` (1652 lines of POSIX sh) as a Go CLI, designed so the bash `ak` and the Go `ak` can coexist on one `.agent-kit/` state directory and cut over without a flag day.
- **Not in scope:** writing Go, touching `bin/ak`, editing any other doc. This is a design document only.
- **Method:** re-derived every decision from two prior crews' work — the internal audit (`docs/research-notes-ak-handoff-audit.md`, cited here as **audit §N**) and the external comparison (`docs/research-notes-firstmate.md`, cited as **firstmate**). Read all of `bin/ak` and all of `docs/` in this worktree; inspected the primary repo's live `.agent-kit/` state read-only.
- **Version caveat:** this plan is written against the pre-fix tree. Two sibling worktrees are landing changes concurrently (`ak-spawn-fix`, and a P0 delivery crew editing `bin/ak`, `docs/herdr-workflow.md`, `docs/reporting-model.md`). Where this plan depends on a P0 behavior, it states the dependency explicitly so the port does not hard-code today's broken wake path.

---

## 1. Design principles

The invariants the Go implementation must enforce that bash cannot express. The first two are the audit's headline findings; the rest are justified additions.

1. **A spawn is not successful until the startup message is confirmed accepted by the worker.** `crew-spawn` must exit non-zero and leave the crew in an explicit `failed` state unless the worker demonstrably consumed the startup prompt (agent left `idle`, submitted, and returned to `busy`, or an explicit worker ack arrived). Bash exits 0 even when the brief is silently never delivered (audit §4.1, §8.1). *This is the single highest-value invariant; everything in §4/§6/§8 exists to serve it.*

2. **Every primary wake carries a durable transcript record with an id; the primary can reconstruct state without the pane.** A wake is a *notification* over a durable record, never the record itself (firstmate "the durable record IS the delivery"). Every report/reply/inbox write is idempotent by a `MessageID`, and the primary can rebuild the full picture (who reported, in what order, with what content) from `report.md` + `inbox/` + `chat.log` alone — the pane is an accelerator, not a dependency (audit §8.3).

3. **The on-disk files are the source of truth; the terminal is a doorbell.** Terminal keystrokes are best-effort and unverifiable; the filesystem is the correctness boundary. This is firstmate's strongest idea (inbox + doorbell + ack) and directly fixes audit §6.1/§6.2 (worker text masquerading as user input through the pane).

4. **Lifecycle state is authoritative and transitions are compare-and-swap-guarded.** `state` stops being write-only (audit §7.7, §8.5): it is the *only* source of `Crew.State`, and every transition validates the legal-state-machine (§3). Concurrent `crew-finish` vs `ak done` cannot produce a torn state file (audit §5.6, §5.5).

5. **Delivery is at-least-once with a ceiling: retry, ack, idempotency, but never infinite, never silent.** Confirmation is a hard precondition where the caller opts in; failure surfaces as a distinct non-zero exit code and a durable "undelivered" flag — never a swallowed `|| true` (audit §3, §8.2; firstmate re-ring ladder).

6. **Backend specifics (herdr/tmux/zellij) live behind one seam.** No herdr knowledge leaks above `Backend` (audit §6, §9). The phantom `herdr agent prompt` / `agent start --kind` branches are *not* ported; the Go backend implements only subcommands that exist in herdr 0.7.3 and adds a submission-confirmation step.

7. **Bash and Go share one versioned format; neither writes a file the other cannot read.** This is the coexistence invariant (§5). Where a format cannot carry a schema key without breaking a bash reader, that is a stated decision, not an accident.

8. **Worker-authored text is framed, flattened, and prefixed before it reaches the primary's prompt.** The chat-log flattening (`tr '\t\n' '  '`) is applied to the wake payload too, so the wake and the durable record never diverge (audit §6.1, §8.7).

9. **Nothing is fire-and-forget unless the caller opts in.** `Backend.Wake` returns a receipt; the delivery layer confirms or reports unconfirmed. The one deliberate exception is `crew-cost-prompt` (a broadcast nudge), which still reports per-target results in its exit code (§6).

10. **A false "dead" verdict is worse than a false "alive".** Only a positively-dead/missing pane is acted on; anything uncertain is "unknown" and never triggers a duplicate spawn onto a live worktree (firstmate steal #6, audit §4 liveness asymmetry).

---

## 2. Package / module layout

**Reject the firstmate-scale decomposition explicitly.** firstmate is 204 scripts, ~117k lines of bash, five backends, ~13 harness adapters, a watcher daemon, a second supervision branch, and a lease axis — the complexity *is* its product (firstmate "Do NOT copy" #1). `ak` is 1652 lines, one backend, one primary, no watcher, no second actor. The Go port's correct size is a few thousand lines across eight small packages. Anything that looks like a fleet manager, an event bus daemon, or a lease manager is a scope error.

```
agent-kit/                      # module root (github.com/hnimtadd/agent-kit or ak/cmd)
├── cmd/ak/                     # main: flag parsing, command dispatch, the exit-code contract
├── internal/cli/               # one file per command; wires protocol+store+backend+workspace+delivery
├── internal/protocol/          # core types (§3), state machine, validation, no dependencies
├── internal/store/             # CrewStore: the filesystem impl of the versioned formats (§5)
├── internal/backend/           # Backend interface (§4) + herdr impl; tmux/zellij land here later
├── internal/workspace/         # Workspace interface (§4) + jj/git impls
├── internal/delivery/          # Delivery interface (§4) + impl (confirmation, retry, ack, idempotency)
└── internal/schema/            # the schema= key constants, parsers/serializers shared by store and tests
```

Dependency direction is strict and acyclic:

- `protocol` imports nothing internal. It holds the types, the `CrewState` transition table, and the `ValidTransition` function. It is the *only* place a state transition can be declared legal.
- `schema` imports `protocol` only. It owns parsing/serializing each on-disk format, including the legacy (schema-less) v1 and the Go-written (schema'd) v1.
- `store` imports `protocol` + `schema`. It owns atomic writes, locks, and sequence allocation. No backend calls.
- `backend`, `workspace`, `delivery` import `protocol` (and `delivery` also `backend` + `store`). None of the three import `cli`.
- `cli` imports everything and is the only package that touches `os.Exit`.

**Why these are the seams, and no more:**

- `Backend` is the seam the audit already drew (`backend_*` wrappers, `bin/ak:1182`+). It is where all session-manager specifics live, so tmux/zellij become new implementations, not edits to command logic.
- `CrewStore` is the "filesystem now, SQLite later" seam the audit's §9 names. The versioned formats live behind it, so the cutover and the compat tests (§5, §7) exercise the store, not the CLI.
- `Workspace` is the jj/git seam, and it must exist as a *type* because of audit §5.1: a jj workspace has no `.git` file, so any future code that "just uses `git -C`" is a landmine. Encapsulating jj/git behind `Workspace` makes that mistake unrepresentable.
- `Delivery` is the layer that does not exist today (audit §9, firstmate steal #1/#2/#5). It is a distinct package so its correctness (the hard part) is testable in isolation from any live terminal (§8).

Deliberately **absent**: a `watcher`/`daemon` package, a `wakequeue` package, a `lease` package, a `supervision` package, a second-actor package. `Delivery` is a synchronous bounded-retry call *inside* a CLI command, not a background service. If the port ever grows a watcher, that is a later, separate decision — not part of this contract.

---

## 3. Core types

Every field is justified by the audit's artifact inventory (audit §2) or is explicitly marked new. Go sketches; `time.Time` is UTC throughout.

```go
package protocol

type Role string
const ( RolePrimary Role = "primary"; RoleWorker Role = "worker" )

type Party string
const ( PartyPrimary Party = "primary"; PartyWorker Party = "worker" )

type VCS string
const ( VCSJJ VCS = "jj"; VCSGit VCS = "git" )

// CrewState is a real state machine, not a string that any code can write.
type CrewState string
const (
    CrewSpawning CrewState = "spawning" // created, not yet launched/accepted
    CrewRunning  CrewState = "running"  // startup prompt accepted
    CrewReported CrewState = "reported" // report.md + inbox written
    CrewDone     CrewState = "done"     // worktree cleaned, tab closed
    CrewFailed   CrewState = "failed"   // spawn/delivery failed; discoverable, needs recovery
)

// Legal transitions. The store enforces these via compare-and-swap (§4/§5).
func (s CrewState) ValidTransition(next CrewState) bool {
    switch s {
    case CrewSpawning: return next == CrewRunning || next == CrewFailed
    case CrewRunning:  return next == CrewReported || next == CrewFailed
    case CrewReported: return next == CrewDone
    case CrewDone:     return next == CrewDone                 // idempotent re-finish
    case CrewFailed:   return next == CrewSpawning || next == CrewDone // re-brief or abandon
    default:           return false
    }
}
```

Note the two deliberate additions over bash: `spawning` and `failed` are *explicit, discoverable* states (audit §9 state machine; bash's "invisible orphan" is exactly the absence of these). `failed → spawning` is the recovery re-brief; `failed → done` is the human-authorized abandonment (requires a flag, §6).

```go
// PrimaryRegistration = .agent-kit/primary (audit §2).
type PrimaryRegistration struct {
    Session      string    // session=
    Target       string    // target=   backend pane/agent id
    Agent        string    // agent=    detected harness label, may be empty
    Tab          string
    Workspace    string
    Cwd          string
    Inject       bool      // inject= 1|0: may reports wake the agent
    RegisteredAt time.Time // registered_at=
}

// WorkerMarker = <worktree>/.agent-kit/role (audit §2, §9).
type WorkerMarker struct {
    Role           Role   // always worker
    Slug           string
    PrimaryRepo    string
    PrimarySession string
    PrimaryTarget  string // spawn-time snapshot; NOT authoritative at reply time (audit §8.9)
    CreatedAt      time.Time
}

// Crew = .agent-kit/crew/<slug>/meta merged with .../state (audit §2).
type Crew struct {
    Slug      string
    Repo      string
    Worktree  string
    Branch    string
    VCS       VCS
    ChangeID  string // jj only; empty for git
    BriefPath string
    Session   string
    Workspace string
    Tab       string
    Pane      string
    Command   string
    CreatedAt time.Time

    State      CrewState // authoritative, from state=
    StartedAt  time.Time
    ReportedAt time.Time
    FinishedAt time.Time
}
```

The meta/state split is a bash artifact; Go keeps the files separate on disk (§5, coexistence) but presents one `Crew` type. `State` is read *only* from `state`, never from a live pane (fixes audit §7.7).

```go
type MessageKind string
const (
    MsgStartup    MessageKind = "startup-prompt"
    MsgReply      MessageKind = "reply"
    MsgReport     MessageKind = "report"
    MsgGuidance   MessageKind = "guidance"    // primary -> worker (ak crew-send)
    MsgCostPrompt MessageKind = "cost-prompt" // ak crew-cost-prompt
)

// Message is the unit the Delivery layer moves. New: bash has no message id,
// kind, or sequence anywhere (audit §4 Q5 "none").
type Message struct {
    ID   string      // idempotency key: uuid or content hash; never a wall-clock second
    Kind MessageKind
    From Party
    To   string      // PartyPrimary, or a crew slug
    Seq  uint64      // per-crew monotonic; implicit as chat.log line ordinal (§5)
    Body string      // single line: newlines/tabs already flattened
    At   time.Time
}

// Report = report.md (audit §2) + the idempotency key bash lacks.
type Report struct {
    Slug       string
    Outcome    string
    Files      []string
    Checks     []string
    Cost       string
    Notes      string
    ReportedAt time.Time
    MessageID  string // idempotency key; dedupes duplicate reports (§5)
}

// ChatMessage = chat.log row (audit §2), upgraded with an explicit seq.
type ChatMessage struct {
    Seq  uint64    // per-crew monotonic; line ordinal on disk (§5)
    Who  Party
    At   time.Time
    Text string    // flattened, single line
}

// InboxRecord = .agent-kit/inbox/<id>-<slug>.md (audit §2). The id is new and
// replaces the second-resolution timestamp that collides (audit §5.4).
type InboxRecord struct {
    ID         string    // seq or uuid; NOT a second-resolution timestamp
    Slug       string
    ReportedAt time.Time
    ReportPath string
    Body       string
}

// PendingReply is new. It is the parent-side proof that a correlated answer
// arrived, which ak has no analogue of today (audit §8.3 "no parent-side proof
// that a crew report arrived"; firstmate steal #5). One outstanding
// expectation per crew is enough for a tool of this size.
type PendingReply struct {
    CorrID      string // random hex; privacy-safe correlation token
    Slug        string
    Expectation string // human summary of what answer is expected
    State       PendingReplyState
    CreatedAt   time.Time
    ResolvedAt  time.Time
    ResolvedBy  string // the correlated report's MessageID
}
type PendingReplyState string
const (
    PRWaiting     PendingReplyState = "waiting"
    PRResolved    PendingReplyState = "resolved"
    PRRecoverSent PendingReplyState = "recovery-sent" // exactly one recovery request
    PREscalated   PendingReplyState = "escalated"     // exactly one escalation, then stop
)
```

**Field-to-audit traceability** (full table in Appendix A):

| Type | Field | Source |
|---|---|---|
| PrimaryRegistration.* | all | audit §2 `.agent-kit/primary` row; §9 entity |
| WorkerMarker.* | all | audit §2 `.agent-kit/role` row; §9 entity |
| Crew.{Slug..Command,CreatedAt} | | audit §2 `meta` row |
| Crew.State | | audit §2 `state` row; **new** authoritative read (fixes §7.7) |
| Crew.{StartedAt,ReportedAt,FinishedAt} | | audit §2 `state` row |
| Message.{ID,Kind,Seq} | | **new** — audit §4 Q5 (none exists) |
| Message.{From,To,Body,At} | | audit §3 command surface + §6 injection |
| Report.* | | audit §2 `report.md` + `inbox` rows |
| Report.MessageID | | **new** — fixes audit §5.4/§8.6 |
| ChatMessage.{Who,At,Text} | | audit §2 `chat.log` row |
| ChatMessage.Seq | | **new** — fixes audit §5.3 (no ordering) |
| InboxRecord.* | | audit §2 `inbox` row |
| InboxRecord.ID | | **new** — fixes audit §5.4 |
| PendingReply.* | | **new** — audit §8.3 + firstmate steal #5 |

---

## 4. Interfaces

Method sets return errors; nothing is fire-and-forget unless the caller opts in. `ctx` is threaded for bounded waits.

```go
package backend

type AgentStatus string
const (
    AgentIdle    AgentStatus = "idle"
    AgentWorking AgentStatus = "working"
    AgentBlocked AgentStatus = "blocked"
    AgentUnknown AgentStatus = "unknown"
    AgentGone    AgentStatus = "gone"
)

type TabRef struct { Session, Workspace, Tab, Pane string }
type TabSpec struct { Label, Cwd string }
type AgentSpec struct { Name, Kind, Command, Cwd string }

type WakeReceipt struct {
    Accepted    bool      // true only if submission was confirmed
    SubmittedAt time.Time
    Detail      string    // e.g. "agent left idle" or "unconfirmed: pane not read back"
}

type Backend interface {
    Notify(ctx context.Context, session, title, body string) error

    // Wake must confirm the message was submitted into the target agent,
    // not merely that a send-keys returned 0 (audit §4 "wake unconfirmed").
    // Accepted=false with nil error means "submitted, unconfirmed".
    Wake(ctx context.Context, session, target, message string) (WakeReceipt, error)

    PaneSend(ctx context.Context, session, pane, text string) error
    PaneSubmit(ctx context.Context, session, pane string) error
    PaneRead(ctx context.Context, session, pane string, lines int) (string, error)
    AgentStatus(ctx context.Context, session, pane string) (AgentStatus, error)
    AgentStart(ctx context.Context, spec AgentSpec) (pane string, err error)
    TabCreate(ctx context.Context, spec TabSpec) (TabRef, error)
    TabClose(ctx context.Context, session, tab string) error
}
```

`backend.AgentStatus` maps 1:1 to the audit's `AgentStatus` vocabulary (§9) and to `backend_agent_status` (`bin/ak:1258`). The herdr implementation uses only subcommands that exist in 0.7.3 (`herdr agent send`, `pane run` + submit, `agent get`, `tab create/close`, `notification show`) — the phantom `agent prompt` and `agent start --kind/--pane` paths are deleted, not ported (audit §4.1, §7.1, §7.2).

```go
package store

type CostEntry struct {
    At       time.Time
    Slug     string
    Amount   string // numeric or "unknown"
    Currency string
    Provider, Model, Session, Note string
}

// ErrIllegalTransition and ErrStateChanged are the CAS failure modes.
var ErrIllegalTransition = errors.New("illegal crew state transition")
var ErrStateChanged      = errors.New("crew state changed concurrently")

type CrewStore interface {
    CreateCrew(ctx context.Context, c protocol.Crew) error
    GetCrew(ctx context.Context, slug string) (protocol.Crew, error)
    ListCrews(ctx context.Context) ([]protocol.Crew, error)

    // TransitionCrewState is a compare-and-swap: fails with ErrIllegalTransition
    // unless next is legal from current, and ErrStateChanged if another writer
    // moved it first. This is the guard against crew-finish racing ak done
    // (audit §5.6) and non-atomic state rewrites (audit §5.5).
    TransitionCrewState(ctx context.Context, slug string, from, to protocol.CrewState, at time.Time) error

    WriteBrief(ctx context.Context, slug string, brief string) (path string, err error)
    AppendChat(ctx context.Context, slug string, m protocol.ChatMessage) (seq uint64, err error)
    ReadChat(ctx context.Context, slug string, afterSeq uint64, limit int) ([]protocol.ChatMessage, error)
    WriteReport(ctx context.Context, slug string, r protocol.Report) (path string, err error) // idempotent by r.MessageID
    WriteInbox(ctx context.Context, e protocol.InboxRecord) (path string, err error)
    AppendProgress(ctx context.Context, slug string, item string, at time.Time) error
    AppendCost(ctx context.Context, slug string, c CostEntry) error
    PutPrimary(ctx context.Context, p protocol.PrimaryRegistration) error
    GetPrimary(ctx context.Context) (protocol.PrimaryRegistration, error)
    PutPendingReply(ctx context.Context, p protocol.PendingReply) error
    GetPendingReply(ctx context.Context, slug string) (protocol.PendingReply, error)
}
```

`CreateCrew` writes `meta` + `state=spawning` atomically **before** the tab is created, so a crash anywhere after worktree creation still leaves a discoverable crew (fixes audit §4 "invisible orphan", §5.7). Discovery never depends on `meta` alone; `ListCrews` scans `crew/*/state` and `crew/*/brief.md` as fallback (audit §8.4).

```go
package workspace

// Workspace isolates crew work. jj and git are the two implementations.
// The type exists so the audit §5.1 landmine (a jj workspace has no .git,
// so git -C resolves upward to the primary repo) cannot be reintroduced.
type Workspace interface {
    // Create makes the isolated workspace and returns its path and, for jj,
    // the spawned change id.
    Create(ctx context.Context, repo, slug, branch string) (worktree, changeID string, err error)

    // IsClean reports (clean, exists). A missing worktree is (false, false) +
    // no error, so the caller can distinguish "missing" from "dirty"
    // (fixes audit §8.11: crew-finish misreports missing as dirty).
    IsClean(ctx context.Context, c protocol.Crew) (clean, exists bool, err error)

    // Destroy refuses if dirty or if work is unexplained (unlanded commits).
    Destroy(ctx context.Context, c protocol.Crew) error
}
```

```go
package delivery

// Delivery is the layer missing entirely today (audit §9). It owns
// confirmation, retry, ack, idempotency, and ordering.
type Delivery interface {
    // Deliver submits a message and either confirms it was accepted by the
    // target agent or returns the receipt with Accepted=false. It retries with
    // bounded backoff and is idempotent on Message.ID. The durable record is
    // written by the caller (store) BEFORE Deliver, so a failed delivery never
    // loses the record — the doorbell is retried, the record is not re-sent.
    Deliver(ctx context.Context, m protocol.Message) (Receipt, error)

    // Confirm waits (bounded) for the consumer's explicit ack and returns
    // nil on ack, or an error on timeout. The ack is a filesystem move/mark,
    // not a transport ACK (firstmate steal #5; audit §8.3).
    Confirm(ctx context.Context, m protocol.Message) error

    RecordPending(ctx context.Context, slug, expectation string) (corrID string, err error)
    ResolvePending(ctx context.Context, corrID, byMessageID string) error
}

type Receipt struct {
    ID          string
    SubmittedAt time.Time
    Accepted    bool // agent consumed the message (left idle -> busy -> idle, or explicit ack)
    Attempts    int
}
```

The delivery guarantee is **at-least-once with a ceiling**: retry up to a bounded count with backoff, then stop and surface `Accepted=false` (never infinite, never silent — firstmate re-ring ladder, audit §8.3). `Confirm` is what turns "spawn reported success" into "spawn confirmed the worker accepted the brief" (invariant #1).

---

## 5. On-disk format and versioning

This is the part that makes coexistence possible. Two rules up front:

- **Go can read everything bash has ever written** (treat "no `schema=` key" as legacy v1 — structurally identical to schema'd v1).
- **Bash can keep reading everything Go writes**, for every field bash actually reads.

### 5.1 Schema-carrying strategy, chosen per file by its bash read/write profile

| File | Schema marker | Grammar | Write style |
|---|---|---|---|
| `.agent-kit/primary` | `schema=ak-primary.v1` | key=value | temp + rename |
| `.agent-kit/phase` | `schema=ak-phase.v1` | key=value | temp + rename |
| `.agent-kit/crew/<slug>/meta` | `schema=ak-crew-meta.v1` | key=value | temp + rename |
| `.agent-kit/crew/<slug>/state` | `schema=ak-crew-state.v1` | key=value | temp + rename, under per-crew lock |
| `<worktree>/.agent-kit/role` | `schema=ak-worker-role.v1` | key=value | temp + rename |
| `.agent-kit/crew/<slug>/brief.md` | `<!-- schema=ak-brief.v1 -->` | markdown | temp + rename |
| `.agent-kit/crew/<slug>/report.md` | `<!-- schema=ak-report.v1 -->` | markdown | temp + rename, idempotent |
| `.agent-kit/inbox/<id>-<slug>.md` | `<!-- schema=ak-inbox.v1 -->` | markdown | temp + rename, unique id |
| `.agent-kit/crew/<slug>/pending-reply` | `schema=ak-pending-reply.v1` | key=value | temp + rename |
| `.agent-kit/crew/<slug>/chat.log` | *(none — v1 grammar is the version)* | `who\t<iso8601>\tmessage` | O_APPEND, one `write()` per record |
| `.agent-kit/crew/<slug>/chat.seq` | `schema=ak-chat-seq.v1` | `seq=N` | temp + rename under lock |
| `.agent-kit/crew/<slug>/cost.tsv` | *(header row is the version)* | `timestamp\tslug\tamount\tcurrency\tprovider\tmodel\tsession\tnote` | O_APPEND |
| `.agent-kit/crew/<slug>/progress.tsv` | *(header row is the version)* | `timestamp\titem` | O_APPEND |

**Why three different markers:**

- **key=value files** get a plain `schema=ak-*.v1` first line. Bash's readers are field-name `awk` matchers (`primary_target`, `role_field`, `crew_field`, `phase_current`, `is_registered_crew_target`) that ignore unknown keys, so the line is *additive and invisible to bash*. Bash's only `cat`-style read (`primary_show`) displays it harmlessly. This is the primary coexistence mechanism.
- **Markdown payloads** (brief/report/inbox) get an HTML-comment first line, invisible when rendered and invisible to bash (bash only *existence*-checks these files — `[ -f "$report" ]` — it never parses their content).
- **Append-only TSV files** (chat.log, cost.tsv, progress.tsv) deliberately get **no** schema line, because bash's readers are line-positional: `chat_render` reads every line as `who\tts\tmsg`, and `crew_cost_summary`'s awk skips exactly line 1. A prepended schema line would render as a garbage chat row or shift the cost header into the data rows. Their version is their exact grammar, frozen at v1 for the whole coexistence window. A future v2 of any of these requires a Go-only cutover and a new path, never an in-place edit.

**The one hard format constraint:** `chat.log` grammar must not change — no `seq` column, no `id` column. The monotonic `Seq` lives in the sidecar `chat.seq` and is implicit as line ordinal in `chat.log` (O_APPEND single-write preserves append order = seq order). This is why `ChatMessage.Seq` is a field but not a column.

### 5.2 Atomic write strategy

- **Rewrites** (all key=value files, brief/report/inbox, chat.seq): write to `<final>.tmp-<pid>-<rand>` in the *same directory*, `f.Sync()`, `os.Rename(tmp, final)`, then open the directory and `Sync()` it. Never `>` truncate-in-place (audit §5.5, §8.14). A crash leaves either the old or the new file, never an empty/partial one.
- **Appends** (chat.log, cost.tsv, progress.tsv): `os.OpenFile(O_APPEND|O_CREATE|O_WRONLY)`, one `Write` of a single pre-flattened record (message newlines/tabs already replaced with spaces), then `Sync()`. One `write()` per record means a local-filesystem append is a whole record, never interleaved.
- **Every `state` transition** is a temp+rename under the per-crew lock and is a compare-and-swap: read current state, validate `ValidTransition`, write `state=<next>`. The loser of a race gets `ErrStateChanged`.

### 5.3 Sequence allocation and locking

- **Lock primitive:** mkdir-based, byte-compatible with bash's `lock_acquire` (`bin/ak:197`, which does `mkdir` + `sleep 0.5` + timeout). Go writes `<pid>` and `<unix-time>` into the lock directory so it can do *stale-lock reclamation* (a lock older than 60s whose owner pid is dead is removed) — something bash cannot do, and the reason a crashed bash spawn currently deadlocks forever. The one lock bash already takes, `.agent-kit/locks/crew-spawn.lock`, is reused as-is.
- **Locks introduced by Go:** `.agent-kit/locks/crew-<slug>.lock` (all state transitions, report, finish), `.agent-kit/locks/chat-<slug>.lock` (chat.seq allocation + append), `.agent-kit/locks/inbox.lock` (inbox id allocation). Bash never takes these, so no primitive mismatch is possible.
- **Sequence allocation** is the same pattern everywhere: hold lock → read counter file → write `counter+1` via temp+rename → release. `chat.seq` feeds `ChatMessage.Seq`/`Message.Seq`; the inbox counter feeds `InboxRecord.ID` as `NNN-<slug>.md` (never a second-resolution timestamp — fixes audit §5.4). Message/report idempotency keys (`Message.ID`, `Report.MessageID`) are uuids or content hashes, not wall-clock values.

### 5.4 Bash/Go coexistence

The `ak` command is one implementation *at a time* (swapped behind the symlink), but a half-migrated fleet is normal: a worker can be mid-task under bash while the primary has already cut over to Go. The contract that makes this safe:

1. **Go reads legacy (no `schema=`) and schema'd files identically** — same parser, schema line optional.
2. **Go writes only formats bash can still read** (5.1). The new files (`chat.seq`, `pending-reply`) are additive; bash never opens them.
3. **Go never rewrites a file bash is mid-append on.** Appends are lock-free O_APPEND single-writes, and Go's readers tolerate a trailing partial line by dropping it (and flagging divergence, §5.5).
4. **`state` is the compatibility shim for lifecycle.** Bash still writes `state=running/reported/done`; Go writes `state=spawning/running/reported/done/failed` *plus* `schema=`. Bash's `awk`-based readers ignore the schema line, and bash itself never reads `state` anyway (audit §7.7), so the new `failed` value cannot break bash.
5. **Inbox uniqueness without breaking bash.** Go writes `<id>-<slug>.md`; bash writes `<second>-<slug>.md`. Both coexist in the same dir. Neither implementation parses identity from the filename — Go reads `slug` and `report` path from the file body, so mixed filenames are safe.

### 5.5 Divergence detection

- **chat.seq vs line count:** if `chat.log` has more lines than `chat.seq` says, a legacy writer (bash) appended without incrementing the counter. Go reconciles by re-scanning line ordinals (seq = line count) rather than erroring, and logs a one-line "legacy writer interleaved" note.
- **Unknown schema key or version:** Go refuses to *write* to a file whose schema it doesn't recognize (read-only report + clear error), so a future-version file is never silently clobbered.
- **`ak doctor` gains a state self-check** (not a new command — an extension of an existing one): scan `.agent-kit/`, parse every file with the store, and report anything unparseable or any schema/version mismatch. This is the divergence tripwire during cutover (§7).

### 5.6 Migration/compatibility test strategy

A test must assert all of the following, or a half-migrated state dir is not proven safe:

1. **Golden parse:** every bash-written fixture (captured from the real primary `.agent-kit/` into `internal/schema/testdata/`) parses into the typed struct with every field equal to the audit's inventory value.
2. **Round-trip:** Go serialize → re-parse → identical struct; and Go serialize → the *equivalent bash reader* (`awk -F= '$1=="target"…'` etc.) → identical field value. (Run the bash snippet in the test via `sh -c`, read-only.)
3. **Half-migrated dir:** a fixture directory mixing schema'd and legacy files parses with no error and yields the same results as the all-legacy equivalent.
4. **Atomicity:** kill the process between temp-write and rename (fault injection in the test) → final file is the old *or* new content, never empty/partial.
5. **Concurrency:** N goroutines append to the same `chat.log` → exactly N complete lines, monotonic seq, no torn/interleaved lines; N goroutines report the same crew → distinct inbox ids, idempotent by `MessageID`.
6. **CAS:** concurrent `TransitionCrewState` (report vs finish) → exactly one wins, the other gets `ErrStateChanged`, the `state` file is never torn.
7. **Idempotency:** writing the same `Report.MessageID` twice → one inbox entry, one report, no loss (audit §5.4, §8.6).

---

## 6. CLI surface compatibility

### 6.1 Command list (unchanged from an agent's point of view)

The full dispatch table from `bin/ak:1540-1652`, preserved verbatim as subcommand names and argument shapes:

`doctor`, `init`, `plan`, `lavish`, `herdr-tab`, `role`, `whoami`, `phase`, `primary-set`, `primary-show`, `crew-spawn`, `crew-status`, `crew-audit`, `crew-report`, `crew-resume`, `crew-cost`, `crew-checkpoint`, `crew-cost-summary`, `crew-cost-prompt`, `crew-peek`, `crew-send`, `chat`, `crew-finish`, `docs`, `reply`, `done`, plus `-h/--help/help`.

No subcommand is added or removed. `reply`/`done` remain worktree-runnable; the worker-facing `crew-cost`/`crew-checkpoint`/`crew-report` become worktree-safe by resolving the primary repo from the role marker (fixes audit §7.11) without changing their CLI shape.

### 6.2 Exit-code contract (stable, explicit)

The current contract is emergent from `set -e` (audit §3/§4: many failures are silent, and the wake paths swallow errors with `|| true`). Go makes it a first-class contract:

| Code | Meaning | Used by |
|---|---|---|
| `0` | Success, including "nothing to do" (e.g. `crew-status` with no crews, `docs list` of an empty dir) | all commands |
| `1` | Operational failure: unknown crew, dirty/missing worktree, spawn failed, store error, backend error, missing dependency, illegal state | all commands |
| `2` | Usage error: unknown subcommand, missing/extra/invalid argument | all commands |
| `3` | **Durable artifact written, delivery unconfirmed.** The report/chat/inbox is on disk, but the wake could not be *confirmed* accepted. Non-zero so the harness notices (P0 requirement: wake failure is non-zero), while distinct from `1` so callers know the data survived. | `done`, `crew-report`, `reply` (and `crew-cost-prompt`, see below) |

Per-command specifics that matter:

- **`crew-spawn`** → `0` only when the crew reached `running` (startup prompt accepted, invariant #1); `1` otherwise, with `state=failed` written and a recovery command printed. `2` for usage. *Deliberate change:* bash exits 0 with the brief undelivered (audit §4.1).
- **`done` / `crew-report`** → `0` = report written *and* wake confirmed; `3` = report written, wake unconfirmed (primary polls inbox); `1` = report not written (store error). *Deliberate change:* bash swallowed wake failure with `|| true` and always exited 0 (audit §3).
- **`reply`** → `0` = chat appended + wake confirmed; `3` = chat appended, wake unconfirmed; `1` = chat append failed. Also honors `AK_NO_WAKE` and the primary's `inject` flag — which bash's `reply` ignores (audit §8.9).
- **`crew-finish`** → `0` success; `1` refusal (dirty, non-empty jj change, missing report, or state not `reported`); `2` usage. *Deliberate change:* a *missing* worktree is reported distinctly ("worktree missing") and no longer mislabeled "dirty" (audit §8.11); finishing a `failed`/`spawning` orphan requires an explicit flag and a human-facing confirmation, because there is no report (audit §9).
- **Read-only commands** (`role`, `whoami`, `chat`, `crew-status`, `crew-audit`, `crew-peek`, `crew-resume`, `crew-cost-summary`, `docs`, `primary-show`, `phase show`) → `0` on success, `1` on operational error (unknown crew, unknown doc), `2` on usage. `primary-show` with no primary → `1` (matches bash), message "no primary registered". `chat` on an unknown slug → `1` (loud, unlike bash's silent "no chat log").
- **`crew-cost` / `crew-checkpoint`** → `0` success, `1` unknown crew / store error, `2` usage.
- **`crew-cost-prompt`** → the one explicit fire-and-forget broadcast; `0` if all prompts confirmed, `3` if ≥1 unconfirmed, `1` if none could be sent (it counts and reports rather than silently continuing, unlike bash's `|| continue`).
- **`primary-set`** → `0`; `1` refusal (target not found in the backend, or target resolves to a known crew by the *store*, including the auto-detected current pane — fixes the audit §7.10 guard gap); `2` usage.
- **`doctor`** → `0` all tools present, `1` any missing. Extended to also run the §5.5 state self-check.
- **`phase`** → `0`; `2` invalid phase or missing argument.

### 6.3 Deliberate behavior changes (each with its why)

| # | Change | Why (audit ref) |
|---|---|---|
| 1 | `crew-spawn` fails loudly unless the brief is accepted | §4.1, §8.1 |
| 2 | wake failure is non-zero (exit 3) and honors `AK_NO_WAKE`/`inject` | §8.2, §8.9 |
| 3 | `state` is authoritative; status/audit read it, pane status shown separately | §7.7, §8.5 |
| 4 | `meta` written before the tab is created; discovery is meta-independent | §4, §5.7, §8.4 |
| 5 | inbox ids unique; report idempotent by `MessageID` | §5.4, §8.6 |
| 6 | wake payload flattened + `[crew <slug>]` prefix, identical to the logged text | §6.1, §8.7 |
| 7 | per-crew lock + CAS on state transitions | §5.5, §5.6, §8.8 |
| 8 | `reply`/`crew-cost`/`crew-checkpoint`/`crew-report` resolve the primary from the role marker, not the cwd | §7.11 |
| 9 | `crew-finish` distinguishes missing vs dirty | §8.11 |
| 10 | `crew-resume` keeps its name but its help/description says "print the progress ledger" and it never claims to relaunch | §7.8, §8.12 |
| 11 | `primary-set` crew-refusal reads the store, so a meta-less crew pane is still refused | §7.10 |
| 12 | all writes atomic (temp+rename / O_APPEND single-write), no `>` truncate | §5.5, §8.14 |
| 13 | startup prompt tells workers to hand back with `ak done` (unified with the brief and docs), not `crew-report` | §7.4 |

---

## 7. Cutover plan

Staged, each stage reversible, each stage runnable against the same `.agent-kit/` state with the other implementation still available. The command name stays `ak`; the implementation is swapped behind the `~/.local/bin/ak` symlink (or the repo-local `bin/ak`).

**Stage 0 — freeze the format.** Declare today's on-disk formats the frozen v1 (§5). No bash changes required. Capture golden fixtures into `internal/schema/testdata/`.

**Stage 1 — Go ships read-only commands first.** `role`, `whoami`, `chat`, `crew-status`, `crew-audit`, `crew-peek`, `crew-resume`, `crew-cost-summary`, `docs`, `phase show`, `primary-show`. These only read; they cannot corrupt state. Run Go and bash side by side on the same dir and diff outputs (they must agree, except where §6.3 documents a deliberate change). This stage proves the schema parser against real bash-written state.

**Stage 2 — Go ships additive writes.** `crew-cost`, `crew-checkpoint`, `phase set`, and the `chat_append` used by `crew-send`/`reply` (append-only, single-write). Low blast radius; bash can keep reading the results.

**Stage 3 — Go ships rewrites with schema keys.** `primary-set`, `init`, `plan`, and `crew-spawn`'s role/brief/meta/state writes. From here Go-written state carries `schema=` and remains bash-readable (5.1). `crew-spawn` also flips to the invariant #1 contract (fail unless accepted).

**Stage 4 — Go ships the transition/delivery commands.** `crew-spawn` finalize, `done`, `crew-report`, `reply`, `crew-send`, `crew-finish`, with the CAS state machine and the Delivery layer. This is the risky stage; it is the only one gated on a live smoke (§8) before the symlink swaps.

**Stage 5 — swap, observe, then retire.** Point the `ak` symlink at the Go binary. Keep the bash `bin/ak` present (read-only) for rollback. After a quiet period with no divergence (§5.5), delete nothing automatically — retiring the bash file is a separate, human-approved cleanup, exactly like merge approval.

**Divergence detection** during coexistence: the §5.5 signals (chat.seq drift, unknown schema, `ak doctor` self-check) plus the Stage 1 diffing. Any divergence is reported as a doctor finding; the operator re-points the symlink to the known-good implementation.

**Rollback:** re-point the symlink at bash. Because Go never writes a format bash cannot read (5.1), and never migrates/renames existing files in place, rolling back is lossless. The only forward-only artifacts are the *additive* files (`chat.seq`, `pending-reply`, schema lines), which bash ignores. Rollback therefore has no data migration to undo — it is a symlink flip.

---

## 8. Testing strategy

### 8.1 What is testable without a live agent

- **Delivery layer** against a `fakeBackend` (in-memory recorder with programmable `AgentStatus` sequences): confirmation logic (idle→busy→idle = accepted; no busy transition = unconfirmed), bounded retry/backoff, idempotency (same `Message.ID` twice → one effect), `Confirm` ack timeout, the re-ring ceiling (no infinite retry, surfaces `Accepted=false`).
- **Store** against temp dirs: every §5.6 assertion (golden parse, round-trip incl. running the bash `awk` readers, half-migrated dir, atomicity fault injection, concurrency, CAS, idempotency).
- **Workspace** against temp jj and git repos: `Create` produces a clean isolated workspace; `Destroy` refuses dirty and refuses unexplained jj changes (vcs-workflow.md); the §5.1 jj-has-no-.git case is a regression test (must route through `jj -R`, never `git -C`).
- **Exit-code contract** as table-driven tests with fake Backend + fake/temp Store: each §6.2 row asserted (including exit 3 on unconfirmed wake, exit 1 on store error, exit 2 on usage).
- **CLI surface** as a golden test of the dispatch table: every subcommand and its arity matches `bin/ak`'s usage block.

### 8.2 What must be tested live

- One real `crew-spawn` smoke on herdr 0.7.3 (the fallback path `pane run` + auto-detect + submit), asserting the worker actually consumes the brief.
- One real `ak done` → primary wake, asserting the primary pane transitions to busy (wake *confirmed*, not just send-keys exit 0).
- Composer pre-check: never submit into a pane holding someone's half-typed text (firstmate steal #3).

### 8.3 Failure-injection cases the audit §4 matrix implies

Each is a named test; together they prove the type system makes the §4 failures unrepresentable or loudly detected:

| Case | Injected | Required outcome |
|---|---|---|
| **dead pane** | target pane gone at wake | exit 3, report/inbox still durable, primary can reconstruct from store |
| **lost prompt** | startup prompt never consumed | `crew-spawn` exit 1, `state=failed`, recovery command printed (no false success) |
| **wake unconfirmed** | send succeeds, agent never goes busy | exit 3, durable "undelivered" flag, no silent `|| true` |
| **duplicate report** | two `done` in the same second | two distinct inbox ids, idempotent by `MessageID`, no overwrite |
| **concurrent finish** | `crew-finish` races `ak done` | CAS: one transition wins, other gets `ErrStateChanged`, state file never torn |
| **aborted spawn** | `herdr tab create` fails mid-spawn | `meta`+`state=spawning` already durable → `state=failed`, discoverable, no invisible orphan |

---

## 9. What NOT to port

Explicit deletions, not rewrites. These are behaviors whose current existence is a bug or dead weight (audit §7/§8):

1. **`report.template.md`** — written by `crew-spawn` (`bin/ak:773`), read by nobody (audit §2, §7.6). Do not create it. The report skeleton lives in the `schema` serializer, not a template file.
2. **`primary_notify`** — defined (`bin/ak:593`), never called (audit §7.5). The wake path is `Delivery` + `Backend.Wake`; there is no notify fallback function to port.
3. **The write-only `state` file as a display source** — i.e., the *inversion*: `crew_status`/`crew_audit` reading a live pane and ignoring `state` (audit §7.7). Do not port "state is never read". Port the authoritative `Crew.State`, and show pane status as a separate, clearly-labeled column.
4. **Second-resolution inbox filenames** (`${reported_at}-${slug}.md`, `bin/ak:1528`) — collision on same-second reports (audit §5.4). Replace with `InboxRecord.ID`.
5. **`crew-resume`'s misleading name/semantics** — it prints `progress.tsv` and "resumes" nothing (audit §7.8). Keep the name (surface compat) but make its help honest ("print the progress ledger"); do not port the implied relaunch behavior.
6. **The phantom herdr branches** — `herdr agent prompt` and `herdr agent start --kind/--pane`, both nonexistent in herdr 0.7.3 (audit §4.1, §7.1, §7.2). The Go backend implements only existing subcommands and adds explicit submission confirmation instead of the misleading "did not settle within 120000ms" warning.
7. **The redundant `.git/info/exclude` runtime-ignore in jj workspaces** — a no-op there (audit §2). The tracked `.gitignore` is sufficient; keep only what actually works per VCS.
8. **`crew-cost-prompt`'s raw-keystroke broadcast** (`backend_pane_send` loop with `|| continue`) — route it through `Delivery` so each target's outcome is known, even though the broadcast itself is an opted-in fire-and-forget.
9. **The docs-vs-code drift itself** — `agent start --kind` docs, the `crew-report`-vs-`ak done` startup-prompt split, and the "timeout only warns" description (audit §7.1-7.4). The Go port unifies on `ak done` for handback and regenerates the handoff docs from the implementation once the protocol is fixed.

---

## Appendix A — field/type traceability

| Type / field | Audit source | firstmate source | New? |
|---|---|---|---|
| `PrimaryRegistration` (all) | §2 primary row; §9 | task registry `.meta` | no |
| `WorkerMarker` (all) | §2 role row; §9 | from-firstmate marker (weaker) | no |
| `Crew` meta fields | §2 meta row | task registry | no |
| `Crew.State` + `CrewState` machine | §2 state row; §9 | crew-state machine | **spawning/failed are new** |
| `Message.{ID,Kind,Seq}` | §4 Q5 ("none") | message envelope schema; monotonic seq | **new** |
| `Message.{From,To,Body,At}` | §3; §6 injection | inbox record | no |
| `Report.MessageID` | §5.4, §8.6 | corr token | **new** |
| `ChatMessage.Seq` | §5.3 | monotonic seq | **new** |
| `InboxRecord.ID` | §5.4 | `%03d` never-reused seq | **new** |
| `PendingReply` | §8.3 gap | pending-reply + corr | **new** |
| `Backend` (all methods) | §3 backend seam; §9 | backend adapters (5 impls; ak ports 1) | no |
| `CrewStore` | §9 | task registry + inbox | no |
| `Workspace` | §5.1 VCS caveat; vcs-workflow.md | treehouse worktree | no |
| `Delivery` | §9 "missing layer" | inbox+doorbell+ack; re-ring ladder | **new** |
| exit `3` (delivery unconfirmed) | §4 wake unconfirmed | typed-plane exit 3 | **new** |
| `schema=ak-*.v1` keys | §9 "no protocol versioning" | `schema=fm-*.v1` envelopes | **new** |

## Appendix B — open questions / evidence missing

These are the points this plan cannot fully settle without evidence, and says so rather than guessing:

1. **Worker-side ack mechanism.** Invariant #1 needs a *confirmed* acceptance signal. The audit's "agent left idle → busy" heuristic is herdr-0.7.3-specific; the firstmate "worker renames the message file to `handled/`" is the robust alternative but requires the worker's harness to cooperate. The P0 crew owns this decision; the port should consume whatever P0 lands rather than invent a competing ack. **Evidence needed:** what P0's acceptance check actually is.
2. **SQLite timing.** `CrewStore` is "filesystem now, SQLite later"; nothing in this contract assumes SQLite. **Evidence needed:** none for v1 — the seam is the plan.
3. **`crew-finish` of a `failed` orphan's flag spelling.** The state machine requires `failed → done` to be explicit and human-authorized, but the exact flag (`--abandoned`? interactive confirm?) is a UX call. **Evidence needed:** user preference.

## Appendix C — self-review checklist

- [x] Every type/field traceable to audit §2/§9 or firstmate, or marked new with a rationale (Appendix A).
- [x] Every file a Go binary would read/write given a schema key and an atomicity strategy (§5.1 table).
- [x] Exit-code contract complete and stable, with the P0 wake-failure-non-zero requirement made explicit (§6.2).
- [x] Cutover is staged and reversible with a rollback story that is a symlink flip (§7).
- [x] Failure-injection cases cover the audit §4 matrix (§8.3).
- [x] "What NOT to port" names each dead artifact and write-only behavior (§9).
