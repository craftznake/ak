# Push reporting model

Crew reporting is push-first, not poll-first.

## Setup

Run this once from the primary agent's Herdr tab:

```sh
bin/ak primary-set
```

This records the primary Herdr target in `.agent-kit/primary`. By default it uses safe notification-only mode and does not inject text into the primary agent's composer. If you explicitly want direct agent injection, opt in:

```sh
bin/ak primary-set --allow-inject
```

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
- sends the summary directly into the registered primary agent only when `--allow-inject` was used

If no primary is registered, the command still writes the report and inbox entry; it just cannot target a primary session.

## Cleanup remains separate

Reporting does not clean up the worktree. The primary still reviews and then runs:

```sh
bin/ak crew-finish <slug>
```

`crew-finish` refuses dirty worktrees, preserving safety.
