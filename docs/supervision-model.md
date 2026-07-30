# Supervision model

The primary agent supervises crews instead of babysitting every terminal manually.

## Commands

- `bin/ak primary-set` - register the primary agent's Herdr target once.
- `bin/ak primary-show` - inspect the recorded primary target.
- `bin/ak crew-status` - compact table for all crews.
- `bin/ak crew-audit` - richer summary with cleanliness and report readiness.
- `bin/ak crew-report <slug> <message>` - push a completed report back to the primary.
- `bin/ak crew-peek <slug>` - inspect a crew's visible Herdr output.
- `bin/ak crew-send <slug> <message>` - nudge a crew directly.
- `bin/ak crew-finish <slug>` - close a clean crew and remove its isolated worktree.

## Recommended loop

- register the primary once with `bin/ak primary-set`
- spawn crew
- let it work in its own worktree
- have the crew push back with `bin/ak crew-report`
- peek only when needed
- send explicit guidance when blocked
- audit before cleanup
- finish only after the report exists and the worktree is clean

## Push reporting

`crew-report` writes the durable report, appends an inbox entry, marks the crew as reported, and shows a Herdr notification when available. Direct injection into the primary agent is opt-in via `bin/ak primary-set --allow-inject`. This avoids routine polling while keeping the primary in control of final review and cleanup.

## What this is not

- not an autonomous fleet manager
- not a hidden background watcher
- not a merge bot
- not a cleanup script that guesses safety
