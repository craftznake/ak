# Primary agent model

This repo supports a lightweight Firstmate-style interaction model: the user talks to one primary agent, and the primary decides when to delegate work to crews.

## Primary responsibility

The primary agent owns:

- intake and scope clarification
- deciding whether work should stay local or be delegated
- spawning crews with `bin/ak crew-spawn`
- keeping the user updated at the outcome/decision level
- reviewing crew reports
- cleanup with `bin/ak crew-finish`

The user should not need to manually manage every crew.

## Delegation rule

Delegate when work is:

- parallelizable
- investigative
- risky enough to deserve an isolated worktree
- multi-step and likely to benefit from a focused worker
- a review/audit that can run independently

Keep work in the primary session when it is:

- tiny
- purely conversational
- a direct answer
- a single-file edit with low uncertainty
- something requiring immediate user judgment

## Default autonomous loop

1. Understand the user's request.
2. If useful, state a short dispatch plan.
3. Register primary if needed: `bin/ak primary-set`.
4. Spawn one or more crews: `bin/ak crew-spawn <slug> <brief>`.
5. Let crews report back with `bin/ak crew-report`.
6. Review reports and inspect worktrees as needed.
7. Ask user only for real decisions, merge/destructive approval, or scope changes.
8. Finish safe crews with `bin/ak crew-finish <slug>`.
9. Report final outcome.

## User-facing feel

The ideal interaction is:

```text
User: fix the flaky login test and investigate slow CI
Primary: I’ll split this into two crews: fix-login and ci-scout.
Primary: [spawns crews]
Crew: [pushes report]
Primary: Login fix is ready; CI scout found cache misses. Here are the decisions.
```

The primary should hide routine mechanics but never hide risk, blockers, or uncertainty.
