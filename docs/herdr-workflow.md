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

`crew-spawn` starts the crew's harness with `herdr agent start <name> --kind <kind> --pane <id>` whenever `AK_CREW_COMMAND` (default `pi`) resolves to a recognized Herdr agent kind (`pi`, `claude`, `codex`, `gemini`, `cursor`, `devin`, `agy`, `cline`, `omp`, `mastracode`, `opencode`, `copilot`, `kimi`, `kiro`, `droid`, `amp`, `grok`, `hermes`, `kilo`, `qodercli`, `maki`). `agent start` only returns once Herdr detects the agent and it is ready for input, so no readiness guessing is needed. The startup prompt (read the brief and begin) is then submitted with `herdr agent prompt <target> "<prompt>" --wait --timeout "$AK_CREW_STARTUP_TIMEOUT"` (default 120000ms), which atomically submits text and an encoded Enter honoring the pane's live bracketed-paste mode. A timeout only logs a warning; it does not fail `crew-spawn`, since the crew may simply be slow to start or already working.

For an `AK_CREW_COMMAND` that is an arbitrary command (not a recognized agent kind), `crew-spawn` keeps using `herdr pane run` as before, then polls `herdr agent get` briefly for Herdr's own agent auto-detection before submitting the startup prompt (via `herdr agent prompt` if an agent is detected, otherwise via raw `herdr pane send-text` + `herdr pane send-keys enter` as a last resort).

## Safety boundaries

- Herdr is presentation/coordination, not authority.
- Git state and project instructions remain authoritative.
- Do not infer ownership from a tab label alone.
- Do not close or delete workspaces/tabs containing unknown or unlanded work.
- Finish a crew only after its worktree is clean and a report exists.
