---
name: crew-delegation
description: Use when the user asks for multi-step, parallelizable, investigative, or risky software work. Helps the primary agent delegate to Herdr-visible crews with isolated worktrees.
argument-hint: <user request to delegate>
---

# Crew delegation

Act as the primary agent. The user should talk to one agent; you decide whether to delegate.

## When to delegate

Delegate by default. Spawn crews for any work that is parallelizable, investigative, risky, long-running, separable into tracks, or benefits from an isolated worktree/focused worker.

Do not spawn only for truly tiny direct answers, immediate clarification, or trivial low-risk edits where delegation overhead would exceed the work.

## Model selection

Choose the lightest sufficient crew model/command for each workload:

- cheap/fast model: mechanical edits, docs, grep-based research, simple test fixes, formatting, rote migrations
- mid model: normal feature work, moderate debugging, cross-file edits, test stabilization
- strong model: ambiguous root-cause analysis, architecture, risky refactors, security-sensitive work, final synthesis/review

Use harness controls such as `AK_CREW_COMMAND='pi --model <model>' bin/ak crew-spawn ...` when available. If the exact model flag differs by harness, choose the appropriate command for that harness. Mention the intended capability level in the crew brief.

## Commands

Register yourself once per session if not already registered:

```sh
bin/ak primary-set
```

Spawn a crew:

```sh
bin/ak crew-spawn <slug> "<clear brief>"
```

Spawn with a specific lightweight/sufficient command when appropriate:

```sh
AK_CREW_COMMAND='<harness/model command>' bin/ak crew-spawn <slug> "<clear brief>"
```

Inspect fleet state only when needed:

```sh
bin/ak crew-audit
bin/ak crew-peek <slug> 120
```

Proactively request cost updates from all crews:

```sh
bin/ak crew-cost-prompt "include model, session, token estimate if known, and current task phase"
```

Summarize logged crew spend:

```sh
bin/ak crew-cost-summary
```

Crews log spend when asked, at meaningful milestones, and before handback:

```sh
bin/ak crew-cost <slug> <usd|unknown> "model/session, token estimate if known, work covered"
```

Crews report back with:

```sh
bin/ak crew-report <slug> "summary, files changed, checks, cost notes, blockers"
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
- chosen capability/model level and why it is sufficient
- checks to run
- explicit safety boundaries
- cost-tracking requirement: run `bin/ak crew-cost <slug> <usd|unknown> ...` when asked, at milestones, and before handback
- instruction to run `bin/ak crew-report <slug> ...` when ready

## Reporting style

Tell the user what you delegated and why, then stay concise. Surface only outcomes, blockers, decisions, risk, and cost summaries. Do not expose routine terminal mechanics unless useful.

## Cost tracking

Use lightweight, proactive ledger tracking:

- Primary may trigger cost collection any time with `bin/ak crew-cost-prompt`.
- Each crew logs entries to `.agent-kit/crew/<slug>/cost.tsv` with `bin/ak crew-cost`.
- Use numeric USD values when known; use `unknown` when the harness does not expose spend.
- Include model, provider/session, token estimate if available, and work phase in the note.
- Before final user handoff, run `bin/ak crew-cost-summary` and include the summary when cost matters or the user asks.
- Cost logs are operational telemetry, not authority; if provider billing differs, provider billing wins.
