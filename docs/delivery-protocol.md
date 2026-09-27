# Delivery protocol (ak)

This is the durable, acknowledged delivery protocol between the primary and
crews. It is the contract the bash `bin/ak` implements today and the Go port
(`docs/research-notes-go-port.md`) must match. Everything below is normative;
where a behavior is not described here it is undefined and must not be relied
on.

## 1. Invariants

1. **The on-disk files are the source of truth; the terminal is a doorbell.**
   A primary→worker message is a *durable inbox record*. The terminal only ever
   carries a short, constant, payload-free doorbell line. The record's fate
   alone governs the exit status of the write.
2. **Delivery is at-least-once with a ceiling.** Ack-required records are
   re-rung on a bounded ladder and then escalated; nothing retries forever,
   nothing is silently dropped.
3. **Acknowledgement is a filesystem move.** A worker acknowledges a record by
   moving it to `handled/`; the move *is* the ack.
4. **Lifecycle state is authoritative and transition-guarded.** `state` is the
   only source of a crew's lifecycle state; illegal transitions fail loudly.
5. **Every primary-bound wake is framed.** Worker-authored text is flattened to
   one line and prefixed with `[crew <slug>]` before it reaches the primary, so
   it can never masquerade as a user turn.

## 2. On-disk formats

### 2.1 Steering inbox record — `.agent-kit/crew/<slug>/inbox/NNN.msg`

```
schema=ak-inbox.v1
id=<opaque id; idempotency key, never a wall-clock value>
at=<utc ISO-8601>
from=primary
delivery=<fire-and-forget | ack-required>
--
<exact message body; newlines are legal; nothing after -- is re-escaped or parsed>
```

- Written via temp file + atomic `rename` in the same directory.
- The sequence `NNN` is `%03d`, allocated under the per-crew lock by scanning
  **both** `inbox/` and `inbox/handled/`, so a number is never reused.
- The body is read back by skipping to the `--` line, then reading verbatim
  (`awk 'f{print} /^--$/{f=1}'`). It survives embedded newlines, `--`, backticks,
  `$(...)`, quotes, and tabs unchanged.
- Handled records live in `inbox/handled/NNN.msg`.

### 2.2 Ring state — `inbox/.ring-state`

TSV, one line per in-flight ack-required record, rewritten atomically under the
per-crew lock:

```
<seq>\t<count>\t<epoch-seconds>
```

`count` is the number of doorbell rings attempted so far (including the first);
`epoch` is the last ring time (Unix seconds). A record whose count reaches the
max is escalated and its line is removed (it stops ringing).

### 2.3 Ladder escalation marker — `inbox/.escalated/<seq>`

A durable marker file (content is the escalation timestamp) written when an
unacked ack-required record exhausts its ring budget. Its presence means "stop
ringing this record."

### 2.4 Lifecycle state — `.agent-kit/crew/<slug>/state`

```
schema=ak-crew-state.v1
state=<spawning|running|reported|done|failed>
started_at=<utc>      # set once on running
reported_at=<utc>     # set once on reported
finished_at=<utc>     # set once on done
failed_at=<utc>       # set once on failed (spawn failure or ak crew-fail)
failed_reason=<one-line>  # recorded by ak crew-fail; flattened, last-wins
undelivered_at=<utc>  # optional, single authoritative value (last-wins)
```

`state` is authoritative. The live agent status (from the backend) is a
*separate, clearly labelled* probe and is never conflated with lifecycle state.

State machine (only these transitions are legal; anything else fails loudly):

```
spawning -> running | failed
running  -> reported | failed
reported -> reported | done      # reported->reported is idempotent re-report
done     -> done                 # idempotent re-finish
failed   -> spawning | done      # re-brief, or abandon (--abandon)
```

Entering `failed`:

- `ak crew-spawn` writes `state=failed` when a crew is created but its
  startup prompt was never accepted (the crew is running without its brief).
- `ak crew-fail <slug> [reason text...]` is the supervisor path to retire a
  crew that will never report on its own (stuck, crashed, or wedged worker).
  It transitions `spawning`/`running` -> `failed` under the per-crew lock and
  records `failed_at` plus a one-line flattened `failed_reason`. Any other
  source state (including `failed` itself and `done`) fails loudly.

Leaving `failed`:

- `failed -> done`: `ak crew-finish --abandon <slug>` retires a failed crew
  **without a report** (a failed crew never got to report - demanding one is
  the abandon deadlock). A **missing** worktree, a dead/absent Herdr tab, and
  an unregistered VCS workspace are tolerated (warned, then proceeded) so
  retirement cannot wedge on leftovers. Guards that protect salvageable work
  stay in force: a **dirty** worktree and a non-empty jj workspace change
  still refuse, and `--abandon` changes nothing for `reported`/`done` crews
  (they still require a genuine report and a clean worktree).
- `failed -> spawning` (re-brief) is defined by the state machine but not yet
  driven by any command: a steered message cannot be answered by a failed
  crew (`crew-report` rejects it), so re-briefing currently means abandoning
  and re-spawning. Known residual.

### 2.5 Pending reply — `.agent-kit/crew/<slug>/pending/<corr>`

```
schema=ak-pending-reply.v1
corr=<16 lowercase hex>
slug=<slug>
request_summary=<flattened one-line summary>
created_at=<utc>
phase=<waiting|recovery-sent|escalated|resolved>
resolved_at=<utc>      # present when resolved
resolved_by=<report id> # present when resolved
```

The `corr` token is random hex (privacy-safe: not a path or name).

### 2.6 Correlation escalation marker — `.agent-kit/crew/<slug>/escalated/<corr>`

Durable keyed decision written when a pending expectation escalates. Removed
when the expectation is resolved.

### 2.7 Crew metadata — `.agent-kit/crew/<slug>/meta`

Adds two keys on top of the historical `key=value` set:

- `title=<one-line purpose>` — derived at spawn from the brief's `# Objective`
  first line (truncated to 72 chars), neutral fallback `crew task` if absent.
- `session_id=<opaque token>` — the session generation that spawned the crew,
  copied from `.agent-kit/primary`.

`meta` (including `title`/`session_id`) is written **before** the Herdr tab is
created, so an aborted spawn remains discoverable.

### 2.8 Primary registration — `.agent-kit/primary`

Gains `schema=ak-primary.v1` (first line) and `session_id=<opaque token>`
(regenerated by every `ak primary-set`).

## 3. The doorbell

When `ak crew-send` delivers a message it rings the worker pane with one
constant line (the same every ring, derived only from the inbox path):

```
: agent-kit instruction waiting: list '<inbox>'/*.msg, read and act on each in numeric order, then ack each handled file by moving it to '<inbox>'/handled/ (the move IS the ack).
```

- The leading `: ` is a POSIX no-op, so the line is inert if typed into a bare
  shell.
- The line carries no message payload. Re-ringing it is free.
- The exit status of `crew-send` reflects the **record write**, never the
  keystroke.

## 4. Acknowledgement

`ak ack [<slug>] [<seq|path>]` moves the record from `inbox/` to `inbox/handled/`
and clears its ring-state entry. The move is the acknowledgement. With no
sequence argument it acknowledges all pending records in numeric order and lists
what it acknowledged. Acknowledgement is idempotent: re-acknowledging a record
that already sits in `handled/` is a no-op that exits 0 (`already acked`), and
the move is re-checked under the per-crew lock so two racing acks of the same
record never lose or duplicate it; an unknown record (nowhere on disk) still
exits 1.

The generated worker brief states the contract concretely, including the exact
`ak ack <seq>` command and that without the ack the primary will ring again and
eventually treat the worker as stuck.

## 5. Re-ring ladder and escalation

For each unacked `ack-required` record:

- It is due for one more ring per grace period (`AK_INBOX_GRACE_SECS`, default
  90).
- After `AK_INBOX_RING_MAX` attempts (default 3) it escalates: a durable
  escalation marker is written and a notification emitted; ringing stops.
- `fire-and-forget` records are excluded entirely (never rung, never in the
  ring-state).
- Acked records never re-ring (their ring-state entry is cleared on ack).
- **Liveness is probed before typing.** If the target is positively
  dead/missing (`agent_not_found`), no keystroke is sent and the record is
  escalated directly. Anything uncertain (`unknown`) is rung (false-`dead`
  asymmetry).
- **Every attempt consumes a rung, typed or not.** The first ring attempt is
  recorded in the ring-state even when the keystroke failed (uncertain
  target), and a failed re-ring still counts toward `AK_INBOX_RING_MAX` - so
  a record that can never be rung is still escalated after the max instead
  of sitting untracked forever. Only a positively dead target escalates
  without consuming rungs.

The ladder is driven synchronously, with **no background watcher**:

- `ak crew-send <slug> ...` advances that crew's ladder (and pending-reply
  recovery, §6) before delivering each new message, so every steer makes
  outstanding unacked/uncorrelated messages progress.
- `ak crew-sweep <slug>` drives one crew; `ak crew-sweep` with no argument
  drives **every** crew (all crews under `.agent-kit/crew/`).

Operational consequence, stated plainly: the re-ring guarantee is only as
alive as the primary. If the primary steers or sweeps at least once per grace
window, unacked records are re-rung and escalate on schedule. If the primary
goes entirely silent, nothing re-rings - but nothing is lost either: the
on-disk inbox record, ring-state, and escalation markers remain the durable
truth, and the very next `crew-send`/`crew-sweep` (whichever comes first)
advances the ladder again. Ladder progress is observable via `ak crew-audit`,
which shows per-crew pending record count, age, and attempt count.

## 6. Correlation / pending-reply expectation

When the primary sends an `ack-required` steer that expects a reply
(`ak crew-send --expect-reply <slug> <msg>`):

1. A durable pending record (2.5) is created **before** delivery, with a fresh
   `corr` token, and the token is embedded in the steered message body.
2. The worker echoes the token back in its handback summary; `ak done` /
   `crew-report` carry it (as `corr=<hex>`).
3. The expectation is resolved **only** by a correlated report carrying the
   token — never by transport success, never by the chat transcript.
4. If a turn completes with no correlated report, the next `ak crew-send` steer
   or `ak crew-sweep` (per-crew or global) sends **exactly one** automatic
   recovery request (phase `waiting` → `recovery-sent`, after the grace
   period measured from `created_at`), then escalates **once** if that also
   completes without a correlated report (`recovery-sent` → `escalated`,
   after the grace period measured from `recovered_at`). It never loops,
   never repeatedly injects, never silently expires. The exactly-once
   decisions are re-checked under the per-crew lock, so concurrent sweeps
   cannot double-send a recovery or double-escalate. Escalation opens a
   durable keyed marker that is closed when the expectation is finally
   resolved.

## 7. Locks

- `.agent-kit/locks/crew-<slug>.lock` guards every per-crew state transition,
  inbox sequence allocation, ring-state rewrite, ack move, and `crew-finish`.
  The primitive is `mkdir`-based, byte-compatible with the Go port plan, with
  no external dependency.
- `.agent-kit/locks/crew-spawn.lock` continues to guard worktree creation.
- `crew-finish` holds the per-crew lock for its whole run, so it can never tear
  down a worktree while a report is in flight.
- **Stale-lock reclamation.** Every holder records its pid in
  `<lock>.lock.pid` and releases both files on exit (including trapped
  signals). A waiter that finds a recorded holder that is positively dead
  (`kill -0` fails) claims the stale lock by renaming the pid record - only
  one reclaimer can win the rename, so racing reclaimers cannot both take the
  lock - then tears down and retakes the lock directory. A lock with no pid
  record (legacy) is reclaimed by age after `AK_LOCK_STALE_SECS` (default 300).
  Residual: if a dead holder's pid was recycled by an unrelated live process,
  reclamation stalls until the waiter's 60s lock timeout fails loudly; there
  is no pid-identity check beyond `kill -0` in POSIX sh.

## 8. Exit codes

| Code | Meaning |
|---|---|
| 0 | Success, including "nothing to do". |
| 1 | Operational failure (unknown crew, illegal state transition, store error, backend error, report rejected, finish refused). |
| 2 | Usage error (unknown option, missing/invalid argument). |
| 3 | Durable artifact written, wake delivery unconfirmed. The bash implementation currently surfaces the backend's own 1 (send failed) / 2 (submit/acceptance unconfirmed) codes on wake failure; exit 3 is the Go port's normalized single code for the same condition (see `docs/research-notes-go-port.md` §6.2). |

Per-command contract:

- `crew-send` → 0 if the record was written (or an idempotent re-send was
  recognised); 1 if the record could not be written; 2 usage. **The doorbell
  keystroke never changes the exit code.**
- `ak ack` → 0 (acknowledged, or nothing to ack); 1 unknown crew/record; 2 usage.
- `crew-sweep` → 0 on success; 1 unknown crew; 2 usage.
- `crew-report` → 0 report written + wake confirmed; non-zero (the backend's 1 = send failed / 2 = unconfirmed acceptance) if the wake failed after the report was written, with `undelivered_at` recorded; 1 if the report was rejected (finished/failed crew); 2 usage. Note: herdr >= 0.9 rejects submitting a prompt into a blocked agent, which surfaces here as a wake failure (1) with `undelivered_at` recorded - the report itself is durable and the wake is retried on the next report/steer.
- `crew-report --note` → 0 note recorded, state unchanged; never flips state.
- `crew-finish` → 0; 1 refusal (not `reported`/`done`, or `failed` without
  `--abandon`, or missing/dirty worktree, or missing report); 2 usage. A
  **missing** worktree is reported distinctly from a **dirty** one. For a
  `failed` crew finished with `--abandon`, no report is required and a missing
  worktree/absent tab/unregistered workspace are tolerated (§2.4); a dirty
  worktree or non-empty jj workspace change still refuses.
- `crew-fail` → 0 (`spawning`/`running` -> `failed`, reason recorded); 1
  unknown crew or illegal source state (including an already-`failed` crew,
  which points at `crew-finish --abandon`); 2 usage.
- `crew-spawn` → 0 only when the crew reached `running` (startup prompt
  accepted); 1 otherwise with `state=failed` written and a recovery command
  printed; 2 usage.

## 9. Environment knobs

| Env | Default | Meaning |
|---|---|---|
| `AK_INBOX_GRACE_SECS` | 90 | Seconds between re-ring attempts for an unacked ack-required record. |
| `AK_INBOX_RING_MAX` | 3 | Max doorbell ring attempts before escalation. |
| `AK_LOCK_STALE_SECS` | 300 | Max age (s) before a lock directory without a pid record is reclaimed as stale. |
| `AK_WAKE_ACCEPT_TIMEOUT` | 8000 | ms to wait for a woken agent to enter `working`. |
| `AK_CREW_STARTUP_TIMEOUT` | 120000 | ms overall deadline for startup-prompt acceptance. |
| `AK_CREW_READY_TIMEOUT` | 15000 | ms to wait for the crew pane to be input-ready. |
| `AK_NO_WAKE` | unset | Disable the primary wake injection. |
| `AK_NO_NOTIFY` | unset | Disable backend notifications. |
| `AK_BACKEND` | herdr | Session backend (only herdr implemented). |
| `AK_DEBUG_WAKE` | unset | Path; append each framed wake and doorbell line (diagnostic/test hook). |
| `AK_INBOX_RING_OK` | unset | Test seam; treat every doorbell ring as a successful keystroke. |

## 10. Command surface (additive)

New commands: `ak ack`, `ak crew-sweep`, `ak crew-fail`, and `ak crew-report
--note`. `ak crew-sweep` accepts no argument (sweep every crew). All
pre-existing command names and argument shapes are preserved. `ak chat` remains
the human-readable transcript and is no longer the delivery mechanism (but is
not removed).
