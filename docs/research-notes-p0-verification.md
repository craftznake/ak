# Research notes: P0 verification (adversarial)

Independent verification of the P0 delivery fix (`zyomqrwy`, commit `4b8e8430`).
Verifier: worker crew `p0-verify`, stacked on `zyomqrwy`.

Verdicts: **CONFIRMED** (observed live), **REFUTED** (observed the opposite),
**UNPROVEN** (could not test). Code reading was never treated as sufficient for a
delivery claim.

## Resolution of the `undelivered_at` contradiction (the first job)

The author's handback left `state=reported` plus `undelivered_at` at the same
timestamp, while its report claimed "live-agent wake exit 0, dead-target wake exit 1".

**Both statements are literally true, and the contradiction is explained by a stale
primary registration — not a transport bug.**

```
$ cat .agent-kit/primary                # the primary's registration
session=default
target=w0:p4
tab=w0:t4
workspace=w0
```

```
$ herdr agent get w0:p4 --session default
{"error":{"code":"agent_not_found","message":"agent target w0:p4 not found"},...}
$ herdr pane get w0:p4 --session default
{"error":{"code":"pane_not_found","message":"pane w0:p4 not found"},...}
$ herdr workspace list --session default   # no "w0" workspace exists
workspaces: w1B ("rexa"), w1C ("ak-p0-selftest")
$ herdr agent list --session default | <cwd == agent-kit repo>
w1B:p2  agent_status "done"  cwd /Users/craftznake/Projects/github.com/hnimtadd/agent-kit
```

The registered target `w0:p4` no longer exists (the workspace was regenerated as
`w1B`; the live primary agent is now `w1B:p2`). So at handback `backend_wake default
w0:p4` correctly returned exit 1 ("no agent registered … raw pane wake send failed"),
`mark_wake_undelivered` appended `undelivered_at`, and `ak done` exited non-zero.
That is the designed fail-loudly behavior, not a silent lie. The author's test passed
because it woke a *fresh throwaway pane*, never the actual registered primary target.

Live reproduction from this worktree:

```
$ bin/ak crew-report p0-verify "verify: worktree-safe report probe"
note: no agent registered at target w0:p4 (status: agent_not_found); using raw pane input fallback
error: raw pane wake send failed for target w0:p4 (no agent registered)
error: report for crew p0-verify was written but the primary wake was NOT delivered (exit 1)
crew reported: p0-verify   # report.md, inbox, chat.log, state all written first
(exit 1)
```

The transport itself is healthy (see claim 5). **Recommended action:** the primary
should re-run `ak primary-set` from its actual pane (`w1B:p2`). This is a
registration/liveness problem, deliberately out of scope for a worker to mutate.

## Verdict table

| # | Claim | Verdict | Evidence |
|---|-------|---------|----------|
| 1 | `herdr agent prompt` gone from wake paths; all delivery subcommands exist | **CONFIRMED** | `grep -n "herdr agent prompt" bin/ak` → no match (exit 1). `herdr agent --help` lists `send get wait` (no `prompt`); `herdr pane --help` lists `send-text send-keys`. Live: `herdr agent send w1B:pC "x"` → `{"result":{"type":"ok"}}`; `herdr pane send-keys … enter` worked. |
| 2 | `backend_wake` returns 0 only on CONFIRMED delivery | **REFUTED** (pre-fix), then fixed | Pre-fix: `herdr agent send w1B:pC "PREEXISTING-TEXT"` (no Enter), then `crew-report` → exit 0 while pane showed corrupted `PREEXISTING-TEXTcrew verify-fixture: REAL-WAKE-MARKER-2`. 0 meant "keystroke delivered", not "message delivered/​accepted". |
| 3 | Durable artifacts written before non-zero wake exit | **CONFIRMED** | Failed wake (above) still left `report.md`, `inbox/…-p0-verify.md`, `chat.log` entry, and `state` with `undelivered_at` before exit 1. |
| 4 | `ak reply` honors `AK_NO_WAKE=1` | **CONFIRMED** | `AK_NO_WAKE=1 bin/ak reply …` → "wake disabled via AK_NO_WAKE", exit 0. Without it → exit 1 (stale target) but chat.log entry written first. |
| 5 | Wake to live agent confirmed; explain `undelivered_at` | **CONFIRMED** (transport) / **REFUTED** as literally stated for `w0:p4` | Transport: wake to live `done` agent → exit 0, agent `done→working` observed. Mid-turn steer queued, not lost. `w0:p4` does not exist (see resolution above). |
| 6 | `crew-spawn` non-zero + recovery on unconfirmed startup; no bare success | **CONFIRMED** | `AK_CREW_STARTUP_TIMEOUT=1 AK_CREW_READY_TIMEOUT=1 crew-spawn` → exit 1, no `crew spawned`, printed `crew-send …` and `crew-finish …` recovery commands. |
| 7 | Startup prompt proves acceptance; total time bounded | **CONFIRMED** | `crew_deliver_startup_prompt` uses one overall wall-clock deadline (`AK_CREW_STARTUP_TIMEOUT`) bounding both phases. Forced timeout=1ms → spawn exited in ~1s (no hang). Acceptance proven by agent leaving idle/done (observed `working` after spawn). |
| 8 | `meta` written before anything that can fail late | **CONFIRMED** | Aborted spawn left a discoverable crew: `meta` (slug/worktree/herdr_* fields) + `brief.md` + `state=running`. Not an invisible orphan. |
| 9 | `crew-cost`/`crew-checkpoint`/`crew-report` work from a worktree | **CONFIRMED** | From this worktree: `crew-cost p0-verify …` → exit 0 (writes primary repo); `crew-checkpoint p0-verify …` → exit 0; `crew-report p0-verify …` → writes report then exit 1 (stale target). Unknown slug → `unknown crew` exit 1 for all three. |
| 10 | Docs describe reality | **CONFIRMED** (one residual noted) | No doc asserts a non-existent herdr subcommand (the only `agent prompt`/`--kind` mentions are negative statements about the old broken path). Residual: `docs/primary-agent-model.md:68` still says crews "report back with `ak crew-report`/`ak crew-report`" (should be `ak done`), and has duplicated `ak primary-set or ak primary-set`, `ak crew-spawn or ak crew-spawn`, `ak crew-finish …/ak crew-finish …` lines. |
| 11 | No regression in `role/whoami/crew-status/crew-audit/chat/phase/primary-show/docs` | **CONFIRMED** | All ran with sane output. (Note: `crew-status`/`crew-audit`/`primary-show` still use `repo_root`, so from a worktree they show "no crew state"/"no primary registered" — pre-existing, not a P0 regression.) |

## Cross-check: `extensions/pi/crew-status.ts`

The panel reads `meta` keys `slug, worktree, branch, herdr_session, herdr_pane,
command, created_at, brief` and `state` keys `state, started_at, reported_at,
finished_at` via a generic `key=value` parser (`parseKeyValue`). All those keys
still exist after P0. The new `undelivered_at` key is parsed harmlessly and ignored
(duplicates are last-wins, no error). **No incompatibility.** The panel already
treats live `herdr agent_status` as authoritative, which is exactly right given that
`state=reported` is not authoritative (finding F4 below).

## Confirmed defects

- **D1 (fixed) — `backend_wake` return 0 overstated "confirmed delivery".** Severity:
  high (it was the one thing P0 was supposed to make truthful). The return-0 path
  depended only on `herdr agent send` + `pane send-keys enter` both exiting 0, i.e.
  keystroke delivery, with no check that the agent accepted the prompt. Reproduction:
  pre-filling the target input box produced a corrupted delivery
  (`PREEXISTING-TEXTcrew verify-fixture: REAL-WAKE-MARKER-2`) while `crew-report`
  still exited 0. Fix: after the Enter, `backend_wake` now confirms acceptance with
  `herdr agent wait <target> --status working --timeout ${AK_WAKE_ACCEPT_TIMEOUT:-8000}`,
  returning 2 (not 0) if the agent does not enter `working` in time. Proof: live wake
  to a `done` agent now blocks ~1s until the agent enters `working` and then returns 0;
  `herdr agent wait --status working` on a non-woken settled agent times out (rc 1), so
  the acceptance signal is real. An agent already mid-turn is already `working`, so the
  wait returns immediately and the steer is queued (verified live: mid-turn steer was
  processed in the agent's next turn, not lost).

- **D2 (documented, not code) — stale primary registration.** `.agent-kit/primary`
  records `target=w0:p4`; the live primary is `w1B:p2`. Every real handback wake now
  fails loudly with `no agent registered`. This is the correct *behavior* (fail loudly,
  don't lie); the *registration* is what is wrong. Recommended: primary re-runs
  `ak primary-set` from its actual pane.

- **D3 (test hygiene, fixed in my test; author's test shares it) — orphan workspace.**
  `herdr workspace create --label $AK_HERDR_WORKSPACE --cwd $PWD` (called by
  `herdr_workspace_id` for a fresh workspace label) leaves an initial tab named after
  the cwd, and `herdr tab close` refuses to close a workspace's last tab. The tests
  only closed the fixture tab, leaking one workspace + tab per run (observed: `w1C`
  from the author's run, and `w1D`/`w1E` from mine). `tests/test-p0-wake-acceptance.sh`
  now also resolves the workspace id by label and runs `herdr workspace close`. The
  author's `tests/test-p0-delivery.sh` has the same leak and should be patched the same
  way (left to the author/primary; not edited here to keep the diff minimal).

## Findings that are behavior, not defects

- **F4 — `state` is not authoritative.** `crew-report` (and `ak done`) always
  overwrite `report.md` and set `state=reported`, so a mid-task `crew-report` makes a
  still-working crew look "reported" (this happened to me during verification). The
  live `herdr agent_status` is the authoritative completion signal — which is what
  `crew-status.ts` already uses. Recorded, not "fixed": changing `crew-report` to not
  mark `reported` would break the handback contract.
- **F5 — `undelivered_at` is appended, not overwritten.** `mark_wake_undelivered` uses
  `>>`; repeated failures append multiple `undelivered_at` lines (observed: two lines
  in `p0-verify/state`). Consumers must take the last line (the extension's parser does
  so implicitly via last-wins).
- **F6 — raw-fallback wakes have no acceptance proof.** For a plain (non-agent) shell
  pane, `backend_wake` returns 0 on `send-text`+Enter keystroke delivery; there is no
  agent to confirm against. Inherent limitation, logged by the code.

## `herdr agent wait` tradeoff (spawn loop: keep)

`herdr 0.7.3` exposes `herdr agent wait <target> --status idle|working|blocked|unknown
--timeout MS`, the native acceptance primitive. `backend_wake` now uses it (D1). The
spawn loop `crew_deliver_startup_prompt` should **not** be replaced with it: the loop
additionally waits for input-readiness, re-presses Enter when the submit key is
swallowed during TUI startup, distinguishes `agent_not_found`/`unknown`, and has a
marker-visibility fallback for non-agent commands — none of which `agent wait` provides.
Its single overall deadline already bounds total time, so there is no hang incentive to
swap it out.

## Files changed

- `bin/ak` — `backend_wake` now confirms acceptance via `herdr agent wait --status
  working` (returns 2 on non-acceptance); added `AK_WAKE_ACCEPT_TIMEOUT` (default 8000)
  to usage.
- `docs/reporting-model.md` — wake paragraph + failure-message description updated to
  the new acceptance-confirmed contract (only the text made factually wrong by D1).
- `tests/test-p0-wake-acceptance.sh` — new independent test asserting acceptance (agent
  must enter `working` after a wake, not merely exit 0), that the acceptance probe is a
  real signal, and the dead-target failure path; cleans up its throwaway workspace.

## Checks

- `bash -n bin/ak` clean.
- `tests/test-p0-delivery.sh` (author's) — PASS (no regression).
- `tests/test-p0-wake-acceptance.sh` (new) — PASS.
- `jj status` shows only `M bin/ak`, `M docs/reporting-model.md`,
  `A tests/test-p0-wake-acceptance.sh`.

## Merge recommendation

Safe to merge **after** the primary re-registers its target (`ak primary-set`): the
transport and acceptance confirmation now work and are tested. The one blocker is the
stale `target=w0:p4` registration, which is outside a worker's scope to change and must
be fixed by the primary before handbacks will actually reach it.
