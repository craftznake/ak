# Supervision model

The primary agent supervises crews instead of babysitting every terminal manually.

## Commands

- `ak role` - print whether this session is `primary` or `worker`.
- `ak whoami` - verbose identity: role, slug, primary target, backend, phase.
- `ak phase [show|set <phase>]` - read/advance the backend-dev phase (`.agent-kit/phase`).
- `ak primary-set` - register the primary agent's Herdr target once.
- `ak primary-show` - inspect the recorded primary target.
- `ak crew-status` - compact table for all crews.
- `ak crew-audit` - richer summary with cleanliness and report readiness.
- `ak crew-report <slug> <message>` - push a completed report back to the primary.
- `ak crew-cost <slug> <usd|unknown> [note...]` - append a lightweight spend entry for a crew.
- `ak crew-cost-summary` - summarize logged spend across crews.
- `ak crew-cost-prompt [message...]` - proactively ask all active crews to log current spend.
- `ak crew-peek <slug>` - inspect a crew's visible Herdr output.
- `ak crew-send <slug> <message>` - nudge a crew directly (also logged to the shared chat).
- `ak chat <slug> [lines]` - read the primary/worker chat transcript for a crew.
- `ak crew-finish <slug>` - close a clean crew and remove its isolated worktree.

Worker-side (run from inside a crew worktree): `ak reply <message>` messages the primary mid-task and wakes it; `ak done <message>` reports completion and wakes the primary.

## Recommended loop

- register the primary once from the primary Herdr pane with `ak primary-set`
- spawn crew
- let it work in its own worktree
- proactively ask for spend snapshots with `ak crew-cost-prompt` when cost matters
- have the crew push back with `ak crew-report`
- summarize spend with `ak crew-cost-summary` before handoff when useful
- peek only when needed
- send explicit guidance when blocked
- audit before cleanup
- finish only after the report exists and the worktree is clean

## Push reporting

`crew-report` writes the durable report, appends an inbox entry, marks the crew as reported, shows a Herdr notification when available, and wakes the registered primary by sending the report message into its Herdr target. This avoids both routine polling and a blocking wait loop while keeping the primary in control of final review and cleanup. `primary-set` refuses explicit targets that are not found in Herdr and refuses known crew slugs/panes.

Use `ak primary-set --notify-only` or `AK_NO_WAKE=1 ak crew-report ...` when you want inbox/notification-only reporting.

## Cost tracking

Cost tracking is a lightweight local ledger, not a provider-billing replacement. Crews log entries under `.agent-kit/crew/<slug>/cost.tsv` using numeric values when known and `unknown` when the harness does not expose cost. The primary can trigger collection with `crew-cost-prompt` and summarize with `crew-cost-summary`.

## What this is not

- not an autonomous fleet manager
- not a hidden background watcher or blocking wait job
- not a merge bot
- not a cleanup script that guesses safety
