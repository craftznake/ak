# Push reporting model

Crew reporting is push-first, not poll-first.

## Setup

Run this once from the primary agent's Herdr tab:

```sh
bin/ak primary-set
```

This records the primary Herdr target in `.agent-kit/primary`. By default crew reports wake the primary by sending the report message into the registered agent/pane. This avoids a blocking wait loop while still letting crews trigger the next primary-agent turn.

If you want inbox/notification-only behavior, opt out:

```sh
bin/ak primary-set --notify-only
```

`--allow-inject` is still accepted for older habits, but wakeup is now the default.

Inspect it with:

```sh
bin/ak primary-show
```

## Crew handback

When a crew is ready to hand back, it runs:

```sh
bin/ak crew-report <slug> "summary, changed files, checks, blockers"
```

That command:

- writes `.agent-kit/crew/<slug>/report.md`
- appends `.agent-kit/inbox/<timestamp>-<slug>.md`
- marks the crew state as `reported`
- shows a Herdr notification when available (`AK_NO_NOTIFY=1` disables it)
- wakes the registered primary agent by sending the summary into its Herdr target (`AK_NO_WAKE=1` disables this per command)

If no primary is registered, the command still writes the report and inbox entry; it just cannot wake a primary session.

## Cleanup remains separate

Reporting does not clean up the worktree. The primary still reviews and then runs:

```sh
bin/ak crew-finish <slug>
```

`crew-finish` refuses dirty worktrees, preserving safety.
