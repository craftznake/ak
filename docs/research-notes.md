# Research notes: firstmate and lavish-axi

## firstmate takeaways

Useful patterns to borrow lightly:

- **Agent distro, not app**: repo contents teach agents how to behave through instructions, skills, scripts, and local state conventions.
- **Visible backend**: work happens in visible tmux/Herdr/zellij/cmux/Orca containers instead of hidden subprocesses.
- **Isolation**: parallel work uses clean worktrees so tasks do not collide.
- **Strict authority boundaries**: no merges or destructive cleanup without explicit human authorization.
- **Session-start recovery**: state on disk plus visible backend inventory is more reliable than chat memory.
- **Outcome reporting**: agents report PRs, checks, failures, and decisions plainly.

What this repo intentionally does not copy yet:

- full crew supervision
- autonomous spawning and wake queues
- secondmates
- X mode
- PR merge automation
- complex backend recovery logic

## lavish-axi takeaways

Useful patterns to adopt now:

- Use local HTML artifacts for plans, architecture, comparisons, and reports.
- Open artifacts with `npx -y lavish-axi <file>`; no global install required.
- Poll in the foreground for feedback when the user wants an interactive loop.
- Treat browser layout warnings as blockers to fix before review.
- Keep artifacts portable with relative local assets.

## Resulting personal design

This repo becomes a small deterministic agent kit:

- shared instructions define the behavior contract
- Herdr gives visible task containers
- `bin/ak` provides minimal repeatable commands
- Lavish is available as a skill/workflow for interactive planning
- humans remain the authority for merges, destructive actions, and scope changes
