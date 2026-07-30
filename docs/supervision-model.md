# Supervision model

The primary agent supervises crews instead of babysitting every terminal manually.

## Commands

- `bin/ak primary-set` - register the primary agent's Herdr target once.
- `bin/ak primary-show` - inspect the recorded primary target.
- `bin/ak crew-status` - compact table for all crews.
- `bin/ak crew-audit` - richer summary with cleanliness and report readiness.
- `bin/ak crew-report <slug> <message>` - push a completed report back to the primary.
- `bin/ak crew-cost <slug> <usd|unknown> [note...]` - append a lightweight spend entry for a crew.
- `bin/ak crew-cost-summary` - summarize logged spend across crews.
- `bin/ak crew-cost-prompt [message...]` - proactively ask all active crews to log current spend.
- `bin/ak crew-peek <slug>` - inspect a crew's visible Herdr output.
- `bin/ak crew-send <slug> <message>` - nudge a crew directly.
- `bin/ak crew-finish <slug>` - close a clean crew and remove its isolated worktree.

## Recommended loop

- register the primary once with `bin/ak primary-set`
- spawn crew
- let it work in its own worktree
- proactively ask for spend snapshots with `bin/ak crew-cost-prompt` when cost matters
- have the crew push back with `bin/ak crew-report`
- summarize spend with `bin/ak crew-cost-summary` before handoff when useful
- peek only when needed
- send explicit guidance when blocked
- audit before cleanup
- finish only after the report exists and the worktree is clean

## Push reporting

`crew-report` writes the durable report, appends an inbox entry, marks the crew as reported, shows a Herdr notification when available, and wakes the registered primary by sending the report message into its Herdr target. This avoids both routine polling and a blocking wait loop while keeping the primary in control of final review and cleanup.

Use `bin/ak primary-set --notify-only` or `AK_NO_WAKE=1 bin/ak crew-report ...` when you want inbox/notification-only reporting.

## Cost tracking

Cost tracking is a lightweight local ledger, not a provider-billing replacement. Crews log entries under `.agent-kit/crew/<slug>/cost.tsv` using numeric values when known and `unknown` when the harness does not expose cost. The primary can trigger collection with `crew-cost-prompt` and summarize with `crew-cost-summary`.

## What this is not

- not an autonomous fleet manager
- not a hidden background watcher or blocking wait job
- not a merge bot
- not a cleanup script that guesses safety
