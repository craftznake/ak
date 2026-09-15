# Push reporting model

Crew reporting is push-first, not poll-first.

## Setup

Run this once from the primary agent's Herdr tab:

```sh
ak primary-set
```

This records the primary Herdr target in `.agent-kit/primary`. By default crew reports wake the primary by sending the report message into the registered agent/pane. This avoids a blocking wait loop while still letting crews trigger the next primary-agent turn. `primary-set` validates explicit Herdr targets and refuses known crew slugs/panes so a crew cannot accidentally register itself as the primary.

If you want inbox/notification-only behavior, opt out:

```sh
ak primary-set --notify-only
```

`--allow-inject` is still accepted for older habits, but wakeup is now the default.

Inspect it with:

```sh
ak primary-show
```

## Crew handback

When a crew is ready to hand back, the preferred command — runnable from inside the worker's own worktree — is:

```sh
ak done "summary, changed files, checks, blockers"
```

`ak done` resolves the crew slug and primary target from the worker role marker (`.agent-kit/role`), writes the report against the primary repo, appends the shared chat transcript, and wakes the primary. Use `ak reply "<message>"` for a mid-task question/status that wakes the primary without ending the task, and `ak chat` to read the transcript.

The equivalent primary-repo-rooted command (used by older crews, or when running from the primary repo) is:

```sh
ak crew-report <slug> "summary, changed files, checks, blockers"
```

Both go through the same core. That command:

- writes `.agent-kit/crew/<slug>/report.md`
- appends `.agent-kit/inbox/<timestamp>-<slug>.md`
- marks the crew state as `reported`
- shows a Herdr notification when available (`AK_NO_NOTIFY=1` disables it)
- wakes the registered primary agent by sending the summary into its Herdr target (`AK_NO_WAKE=1` disables this per command)

The wake uses `herdr agent prompt <target> <message>` (fire-and-forget, no `--wait`), which atomically submits text and an encoded Enter while honoring the pane's live bracketed-paste mode. This is reliable where raw `pane send-text` + `pane send-keys enter` was not: the Enter can no longer land without actually submitting. If the registered target does not resolve to a recognized Herdr agent (e.g. a plain shell pane), `primary_notify` falls back to the raw `pane send-text` + `pane send-keys enter` path as a last resort.

If no primary is registered, the command still writes the report and inbox entry; it just cannot wake a primary session.

## Cleanup remains separate

Reporting does not clean up the worktree. The primary still reviews and then runs:

```sh
ak crew-finish <slug>
```

`crew-finish` refuses dirty worktrees, preserving safety.
