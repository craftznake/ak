# Roles model

Every agent-kit session is either the **primary** (the one agent you chat with) or a **worker** (a crew agent spawned by the primary in its own worktree). A session self-detects its role; you do not pass a flag.

## Role detection

Run this first in any session:

```sh
ak role        # prints "primary" or "worker"
ak whoami      # verbose: role, slug, primary target, backend, phase
```

Detection rule:

- A checkout is a **worker** iff it has a worker role marker at `<repo_root>/.agent-kit/role` containing `role=worker`.
- Otherwise the session is the **primary** by default. Nothing to set — unset means primary.

The marker is written by `ak crew-spawn` into the crew's isolated worktree, so a crew agent that runs `ak role` from its own working directory correctly reports `worker`, while the top-level checkout you chat in reports `primary`.

`.agent-kit/` is gitignored (both git worktrees and jj workspaces honor the tracked `.gitignore`), so the marker never makes a worktree look dirty and never blocks `crew-finish`.

### Worker marker fields

`<worktree>/.agent-kit/role`:

```
role=worker
slug=<crew slug>
primary_repo=<absolute path to the primary repo>
primary_session=<backend session, e.g. default>
primary_target=<backend target/pane of the primary>
created_at=<UTC timestamp>
```

These let a worker find and wake the primary from its own cwd without knowing anything else.

## Session role bootstrap

On the first substantive turn:

1. Run `ak role`.
2. If **primary** and not yet registered for this repo/session, run `ak primary-set` (see `docs/reporting-model.md`).
3. If **worker**, read your brief at `.agent-kit/crew/<slug>/brief.md`, follow the worker contract, and when finished run `ak done "<summary>"` to report and wake the primary.

## Primary/worker chatbox

Primary and workers share a durable per-crew transcript at `.agent-kit/crew/<slug>/chat.log` (lines of `who\ttimestamp\tmessage`).

- Primary → worker: `ak crew-send <slug> "<message>"` (delivers to the worker's session and logs it).
- Worker → primary, mid-task: `ak reply "<message>"` (logs it and wakes the primary; run from the worktree).
- Worker → primary, completion: `ak done "<summary>"` (writes the report, logs it, wakes the primary).
- Read the transcript: `ak chat <slug> [lines]` as primary, or just `ak chat` as a worker (it resolves its own slug).

`ak reply` and `ak done` resolve the primary from the worker role marker, so they work from inside the worktree without extra arguments.

## Backend

All session-backend interaction (wake, notify, pane read/send, tab close, agent status) goes through `backend_*` wrappers in `bin/ak`, selected by `AK_BACKEND` (default `herdr`). Only `herdr` is implemented today; the seam exists so another backend (tmux, zellij, ...) can be added by implementing those cases without touching the command surface. An unknown `AK_BACKEND` fails with a clear error instead of guessing.
