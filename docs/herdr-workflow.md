# Herdr workflow

The user's preferred multiplexer is Herdr. This repo uses it as the visible coordination layer for a primary agent plus isolated crews.

## Model

- one primary agent coordinates the workflow.
- each crew gets its own VCS workspace (`jj workspace` for jj repos, git worktree for git repos).
- each crew is surfaced in Herdr as `ak-<slug>`.
- one Herdr session/workspace ("space") is intended per project: `crew-spawn` opens each crew as a new **tab inside the current Herdr workspace** (resolved from `HERDR_WORKSPACE_ID` when ak runs inside a Herdr-managed pane), instead of creating a separate `agent-kit` workspace. Set `AK_HERDR_WORKSPACE` to pin a different/explicit workspace label if you want crews isolated from the caller's workspace.
- the primary agent remains responsible for checks, safety, and handoff in chat.

## Manual task launch

```sh
herdr workspace create --label agent-kit --cwd "$PWD" --no-focus
herdr tab create --label ak-fix-login --cwd "$PWD" --no-focus
```

Then start the desired harness/model in the tab, for example `pi`, `claude`, `opencode`, or `codex`. Choose the lightest sufficient model for the crew's workload.

## Helper script

`ak` provides a small wrapper:

```sh
ak doctor
ak init
ak primary-set
ak plan "migration strategy"
ak lavish .lavish/migration-strategy.html
ak herdr-tab fix-login .
ak crew-spawn fix-login "stabilize the flaky login test"
AK_CREW_COMMAND='<harness/model command>' ak crew-spawn docs-sweep "update related docs with a lightweight model"
ak crew-status
ak crew-audit
ak crew-report fix-login "ready for review"
ak crew-peek fix-login 120
ak crew-send fix-login "how's the test fix going?"
ak crew-finish fix-login
```

The wrapper refuses Herdr operations when `herdr` is missing; it does not silently fall back to tmux or another multiplexer.

## Crew startup handoff

The installed herdr (0.7.x) cannot attach a named agent to an existing pane: `herdr agent start` no longer accepts `--kind/--pane`, and `herdr agent prompt` does not exist. `crew-spawn` probes for `--pane` support once (`herdr agent start --help`) and, on 0.7.x, always launches the crew command with `herdr pane run <pane> <cmd>`; Herdr then auto-detects the harness (e.g. `pi`) in the pane. On a herdr that does support pane attach, the `agent start` path is still used.

The startup prompt (read the brief and begin, then hand back from the worktree with `ak done`) is submitted as raw pane input (`pane send-text` + Enter), and **delivery is proven, not assumed**:

1. `crew-spawn` waits up to `AK_CREW_READY_TIMEOUT` (default 15000ms) for the pane's agent to report an input-ready state (`idle`/`done`).
2. It submits the prompt, then polls the agent status until the agent **leaves** `idle`/`done` (working/blocked, or idle→done), re-pressing Enter only (never retyping) while the submit key is swallowed during TUI startup.
3. `AK_CREW_STARTUP_TIMEOUT` (default 120000ms) is a single overall wall-clock deadline bounding both phases, so a broken pane cannot hang spawn forever.

If delivery cannot be confirmed, `crew-spawn` **exits non-zero** and prints the worktree path plus an exact `crew-send` recovery command; it never prints `crew spawned` over a silently deaf crew. The crew's `meta` file is written before the tab is created, so an aborted spawn is still visible to `crew-status`/`crew-audit`/`crew-finish`.

For an `AK_CREW_COMMAND` that is an arbitrary command (not a recognized agent kind), there is no agent state to observe, so the best available proof is the prompt text becoming visible in the pane.

## Progress ledger

For long-running crews, use checkpoints to record completed items that survive session changes:

```sh
ak crew-checkpoint fix-login "diagnosed flaky auth token refresh"
ak crew-checkpoint fix-login "fixed token expiry window"
ak crew-resume fix-login
```

`crew-checkpoint` appends a timestamped line to `.agent-kit/crew/<slug>/progress.tsv`. `crew-resume` prints the full ledger so a new session (or the primary) can see what has already been completed.

Use checkpoints when:
- A crew spans multiple sessions.
- The primary needs visibility into incremental progress.
- A compacted or restarted crew needs to pick up where it left off.

## Safety boundaries

- Herdr is presentation/coordination, not authority.
- Git state and project instructions remain authoritative.
- Do not infer ownership from a tab label alone.
- Do not close or delete workspaces/tabs containing unknown or unlanded work.
- Finish a crew only after its worktree is clean and a report exists.
