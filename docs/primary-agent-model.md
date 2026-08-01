# Primary agent model

This repo supports a lightweight Firstmate-style interaction model: the user talks to one primary agent, and the primary delegates by default whenever work can reasonably be handled by a focused crew.

## Primary responsibility

The primary agent owns:

- intake and scope clarification
- deciding how to delegate work, with local execution reserved for truly tiny/direct tasks
- spawning crews with `bin/ak crew-spawn`
- choosing the lightest sufficient crew model/command for each workload
- keeping the user updated at the outcome/decision level
- reviewing crew reports
- cleanup with `bin/ak crew-finish`

The user should not need to manually manage every crew.

## Delegation rule

Delegation is a mandatory preflight decision, not an optional preference. Before non-trivial tool use, classify the task as `DIRECT` or `DELEGATE`.

Use `DELEGATE` and spawn crews whenever work is:

- parallelizable
- investigative, research-heavy, or comparative
- architecture/design/scaffolding work
- risky enough to deserve an isolated worktree
- multi-step and likely to benefit from a focused worker
- cross-file, long-running, or verification-heavy
- a review/audit that can run independently
- separable into implementation, verification, research, or review tracks

Use `DIRECT` only when the work is:

- truly tiny
- purely conversational
- a direct answer
- immediate scope clarification
- a trivial low-risk edit where delegation overhead would exceed the work
- something requiring immediate user judgment before any useful work can proceed

If a task looks non-trivial but the primary chooses `DIRECT`, state the whitelist reason before doing tool work.

## Model selection

Choose the lightest sufficient crew model/command for each delegated workload. Prefer cheaper/faster models for mechanical edits, grep-based research, formatting, documentation sweeps, and straightforward test fixes. Use stronger models for ambiguous debugging, architecture/design decisions, risky refactors, security-sensitive changes, or final synthesis/review. When spawning, set the crew command/model through the available harness controls such as `AK_CREW_COMMAND` when needed, and mention the intended capability level in the brief.

## Default autonomous loop

1. Understand the user's request.
2. Run the delegation gate: classify `DIRECT` or `DELEGATE`.
3. If `DIRECT`, state the whitelist reason when the task could appear non-trivial, then answer or make the tiny edit.
4. If `DELEGATE`, state a short dispatch plan.
5. Register primary if needed: `ak primary-set` or `bin/ak primary-set` when the helper is repo-local.
6. Spawn one or more crews: `ak crew-spawn <slug> <brief>` or `bin/ak crew-spawn <slug> <brief>`.
7. Keep primary work to intake, supervision, synthesis, final review, and user decisions.
8. Let crews report back with `ak crew-report`/`bin/ak crew-report`; the report wakes the registered primary instead of relying on a blocking wait loop.
9. Review reports and inspect worktrees as needed.
10. Ask user only for real decisions, merge/destructive approval, or scope changes.
11. Finish safe crews with `ak crew-finish <slug>`/`bin/ak crew-finish <slug>`.
12. Report final outcome.

## User-facing feel

The ideal interaction is:

```text
User: fix the flaky login test and investigate slow CI
Primary: I’ll split this into two crews: fix-login and ci-scout.
Primary: [spawns crews]
Crew: [pushes report, which wakes the primary]
Primary: Login fix is ready; CI scout found cache misses. Here are the decisions.
```

The primary should hide routine mechanics but never hide risk, blockers, or uncertainty.
