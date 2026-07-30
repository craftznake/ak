# Deterministic agent workflow

This is the lightweight, personal version inspired by Firstmate's operating model without adopting its full fleet manager.

## Goals

- One primary agent coordinating the rest.
- Small, reversible changes.
- Clean task boundaries.
- Plans before risky work.
- Explicit verification before claiming completion.
- Safety first: isolate, supervise, then merge only with approval.

## Default loop

1. **Intake** - restate objective, repo, constraints, and done condition.
2. **Orient** - read instructions, repo status, package/tooling files, and only then source.
3. **Plan** - for non-trivial work, write a short checklist; use Lavish for visual/decision-heavy plans.
4. **Spawn crews when parallelism helps** - create isolated worktrees and visible Herdr tabs.
5. **Implement** - make the smallest correct edits.
6. **Verify** - run narrow checks, then broader checks if warranted.
7. **Supervise** - the primary agent checks progress, blockers, and safety boundaries.
8. **Audit** - verify each crew has a clean worktree and a written report before cleanup.
9. **Finish** - close the crew only after the safety gate passes.
10. **Handoff** - report changed files, checks, and unresolved risk.

## Worktree policy

- One task = one branch/worktree when work is parallel, risky, or long-running.
- Never share one dirty checkout between independent tasks.
- Do not discard, reset, clean, or force-push without explicit approval.

## Planning policy

Use plain chat for small edits. Use Lavish when the answer is easier to review visually:

- technical plans
- architecture diagrams
- trade-off matrices
- implementation roadmaps
- code-review reports
- release or migration plans

Recommended command pattern:

```sh
mkdir -p .lavish
# agent writes .lavish/<topic>.html
npx -y lavish-axi .lavish/<topic>.html
npx -y lavish-axi poll .lavish/<topic>.html
```

## Verification policy

Prefer checks in this order:

1. formatter/linter for touched language
2. targeted unit test
3. package or project test
4. integration/e2e only when the change warrants it

If a check cannot run, say why and what evidence replaced it.
