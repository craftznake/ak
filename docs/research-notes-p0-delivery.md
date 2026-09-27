# Research notes: P0 — ak handoff transport no longer lies

- **Scope:** `bin/ak`, `docs/{herdr-workflow,reporting-model,roles-model,supervision-model}.md`, `tests/test-p0-delivery.sh`, and this note. No `extensions/`, no Go-port plan, no `shared.md`.
- **Pre-work tree:** jj change `zyomqrwy` (this worktree), parent `nprtvqyl` (`f717e5ef`).
- **What this is:** the transport fix only. The durable inbox/ack/re-ring ladder (P1) and correlation (P2) are deliberately left to later crews.

## What the old path was, and the proof it was broken

- `bin/ak:1212` `backend_wake` and `bin/ak:824` `crew_spawn` both called `herdr agent prompt … --wait --timeout`, which **does not exist** in the installed CLI.
- Live evidence (herdr 0.7.3, this machine):
  - `herdr --version` → `herdr 0.7.3`
  - `herdr agent --help` lists `list get read send rename focus wait attach start explain` — no `prompt`.
  - `herdr agent prompt w0:p4 "x" --session default` → prints the `herdr agent` usage and exits 2.
  - `herdr agent start probe --kind pi` → `usage: herdr agent start <name> [--cwd PATH] [--workspace ID] [--tab ID] [--split …] -- <argv…>` and exits 2 — no `--kind`, no `--pane`.
- `herdr agent send <target> <text>` **does** exist (literal text, no Enter); `herdr pane send-text/send-keys` exist and accept `--session`. The fix uses only these.
- Consequence: every spawn printed the misleading `did not settle within 120000ms` warning for what was an instant unknown-subcommand failure, then printed `crew spawned` and exited 0; every `ak done`/`ak reply`/`crew-report` wake silently fell through and discarded the error with `|| true`.

## What changed

### Spawn (port of unmerged jj change `pwzlmzkz`, reviewed and corrected)

- Added `herdr_agent_pane_attach_supported` — probes `herdr agent start --help` for `--pane` instead of whitelisting versions, so the unsupported attach attempt is skipped (no warning spam on every spawn). On 0.7.3 this is false, so `herdr_tab_create` uses `herdr pane run` and Herdr auto-detects the harness.
- Fixed a port bug: the source change assigned the resolved agent kind into an undefined `agent_kind`; here it is assigned to `kind` and recorded as `HERDR_CREATED_AGENT_KIND` before the pane-attach probe may clear it.
- Added `crew_deliver_startup_prompt`, which:
  - waits for an input-ready agent (`idle`/`done`) up to `AK_CREW_READY_TIMEOUT` (default 15000ms);
  - submits the prompt as raw pane input, then proves acceptance by the agent **leaving** `idle`/`done` (working/blocked, or idle→done), re-pressing Enter only (never retyping) while the submit key is swallowed;
  - for an arbitrary (non-agent) command, proves delivery by the prompt text becoming visible in the pane;
  - is bounded by a single overall wall-clock deadline (`AK_CREW_STARTUP_TIMEOUT`, default 120000ms) covering both phases.
- `crew_spawn` now exits non-zero and prints the worktree path plus an exact `crew-send` recovery command when the startup prompt cannot be confirmed accepted. It never prints `crew spawned` over a deaf crew.
- `crew_spawn` writes a minimal `meta` **before** `herdr_tab_create` (then rewrites it with the herdr fields), so an aborted spawn leaves a discoverable crew instead of an invisible orphan worktree/tab.

### Wake

- `backend_wake` no longer calls `herdr agent prompt`. It probes `backend_agent_status` first; where an agent surface is available it submits via `herdr agent send <target> <message>` (literal text honoring bracketed-paste) plus an explicit `herdr pane send-keys <target> enter`. A plain non-agent shell pane falls back to raw `pane send-text` + Enter, and that fallback is logged. `backend_agent_status` now captures herdr's stderr so a missing agent is reported as `agent_not_found` (not `unknown`).
- `ak_reply` and `crew_report_core` no longer end the wake with `|| true`. On a failed wake they print the backend's error to stderr, record `undelivered_at=<ts>` in `.agent-kit/crew/<slug>/state`, and exit non-zero. The durable artifacts (`report.md`, inbox, `chat.log`, `state`) are always written **before** the wake is attempted.
- `AK_NO_WAKE=1` is now honored by `ak reply` as well as reports (reports already honored it).

### Worktree safety

- `crew_root()` resolves `.agent-kit/crew` state from the role marker's `primary_repo` when run in a worker worktree, else the current checkout root. `crew-cost`, `crew-checkpoint`, and `crew-report` now use it, matching how `ak done`/`ak reply` already worked. Verified live: `bin/ak crew-cost ak-delivery-p0 …` now succeeds from inside this worktree (previously `unknown crew`).

### Docs and handback canonicalization

- Rewrote `docs/herdr-workflow.md` "Crew startup handoff" and `docs/reporting-model.md` wake section to describe the real commands and the new failure/exit contract; removed the phantom `herdr agent start --kind/--pane` and `herdr agent prompt --wait` claims.
- Made `ak done` (from the worktree) the canonical handback everywhere: the generated startup prompt now says `ak done`, and `docs/{roles-model,reporting-model,supervision-model}.md` treat `ak crew-report <slug>` as the primary-root equivalent. `docs/dev-workflow.md` already said `ak done` and was left as-is.

## New failure / exit contract

`backend_wake` returns:

| code | meaning |
| --- | --- |
| 0 | delivered and submit confirmed (agent path: `agent send` + Enter both returned 0; raw fallback: `send-text` + Enter both returned 0, visibly logged) |
| 1 | send failed — nothing may be assumed delivered (agent path send failed, or raw fallback send-text failed) |
| 2 | text submitted but the submit key (Enter) was not confirmed |

Distinct messages are never collapsed: "no agent registered at target" (no agent surface, raw fallback engaged and logged) vs "submitted but submit unconfirmed" (text sent, Enter unconfirmed).

`ak done` / `ak reply` / `crew-report` exit non-zero (the backend's code) when the wake fails, after the durable artifacts are written. With `AK_NO_WAKE=1` (or no registered primary target) they still write artifacts and exit 0. `crew-spawn` exits non-zero when startup-prompt delivery is not confirmed.

## Observed test evidence

`tests/test-p0-delivery.sh` (scratch git repo + throwaway `ak-p0-selftest` workspace/tab, `AK_NO_NOTIFY=1`):

- spawn delivery: `crew spawned: p0-selftest-XXXXX`, pane auto-detected, agent status `working` after spawn (acceptance proven), exit 0.
- wake to a live agent: `crew reported`, exit 0.
- wake to a dead target: `no agent registered at target bogus-nonexistent-pane (status: agent_not_found)`, `raw pane wake send failed`, `primary wake was NOT delivered (exit 1)`, command exit 1, and `undelivered_at=` present in `state`.

`bash -n bin/ak` passes. `shellcheck` is not installed on this machine.

## Deliberately left to P1/P2

- Durable inbox/ack, re-ring ladder, message ids, dedupe, per-crew locks, atomic state writes, and correlation tokens.
- `crew-resume` still only prints the progress ledger.
- `primary_notify` (dead code) still contains a `|| true` wake; it is never called. Wire it in or delete it in P1.
- The stale `.agent-kit/primary` target (see below) is a registration/liveness problem, not a transport one.

## Residual notes

- This machine's `.agent-kit/primary` records `target=w0:p4`, but the live agents are in workspace `w1B`; `herdr agent get w0:p4` returns `agent_not_found`. That is real, and it means the handback wake at the end of this crew is expected to fail loudly and record `undelivered_at` — which is now the designed behavior rather than a silent lie.
