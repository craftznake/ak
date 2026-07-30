---
name: crew-delegation
description: Use when the user asks for multi-step, parallelizable, investigative, or risky software work. Helps the primary agent delegate to Herdr-visible crews with isolated worktrees.
argument-hint: <user request to delegate>
---

# Crew delegation

Act as the primary agent. The user should talk to one agent; you decide whether to delegate.

## When to delegate

Spawn crews for work that is parallelizable, investigative, risky, long-running, or benefits from an isolated worktree.

Do not spawn for tiny direct answers or trivial single-file edits.

## Commands

Register yourself once per session if not already registered:

```sh
bin/ak primary-set
```

Spawn a crew:

```sh
bin/ak crew-spawn <slug> "<clear brief>"
```

Inspect fleet state only when needed:

```sh
bin/ak crew-audit
bin/ak crew-peek <slug> 120
```

Crews report back with:

```sh
bin/ak crew-report <slug> "summary, files changed, checks, blockers"
```

Finish only after reviewing the report and confirming the worktree is clean:

```sh
bin/ak crew-finish <slug>
```

## Brief template

A good crew brief includes:

- objective
- repository/worktree context
- constraints
- expected deliverable
- checks to run
- explicit safety boundaries
- instruction to run `bin/ak crew-report <slug> ...` when ready

## Reporting style

Tell the user what you delegated and why, then stay concise. Surface only outcomes, blockers, decisions, and risk. Do not expose routine terminal mechanics unless useful.
