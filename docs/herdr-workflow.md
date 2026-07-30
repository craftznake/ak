# Herdr workflow

The user's preferred multiplexer is Herdr. This repo intentionally keeps Herdr integration lightweight: visible task tabs, stable labels, and explicit commands instead of a large autonomous fleet manager.

## Model

- `agent-kit` workspace: personal coordination and planning.
- one tab per task: `ak-<slug>`.
- optional separate git worktree for task isolation.
- agent remains responsible for reporting checks and handoff in chat.

## Manual task launch

```sh
herdr workspace create --label agent-kit --cwd "$PWD" --no-focus
herdr tab create --label ak-fix-login --cwd "$PWD" --no-focus
```

Then start the desired harness in the tab, for example `pi`, `claude`, `opencode`, or `codex`.

## Helper script

`bin/ak` provides a small wrapper:

```sh
bin/ak doctor
bin/ak init
bin/ak plan "migration strategy"
bin/ak lavish .lavish/migration-strategy.html
bin/ak herdr-tab fix-login .
```

The wrapper refuses Herdr operations when `herdr` is missing; it does not silently fall back to tmux or another multiplexer.

## Safety boundaries

- Herdr is presentation/coordination, not authority.
- Git state and project instructions remain authoritative.
- Do not infer ownership from a tab label alone.
- Do not close or delete workspaces/tabs containing unknown or unlanded work.
