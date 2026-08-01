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
2. **Delegation gate** - before non-trivial tool use, classify the task as `DIRECT` or `DELEGATE`. Use `DIRECT` only for tiny/conversational/clarifying/trivial low-risk work; use `DELEGATE` for investigative, research, comparison, architecture, scaffolding, risky, multi-step, cross-file, long-running, review/audit, or separable work. State the whitelist reason if a non-trivial-looking task remains `DIRECT`.
3. **Orient** - read instructions, repo status, package/tooling files, and only then source.
4. **Plan** - for non-trivial work, write a short checklist; use Lavish for visual/decision-heavy plans.
5. **Spawn crews for delegated work** - create isolated worktrees and visible Herdr tabs before the primary performs the substantive implementation or research.
6. **Implement** - make the smallest correct edits, usually in a crew for delegatable work.
7. **Verify** - run narrow checks, then broader checks if warranted.
8. **Supervise** - the primary agent checks progress, blockers, and safety boundaries.
9. **Audit** - verify each crew has a clean worktree and a written report before cleanup.
10. **Finish** - close the crew only after the safety gate passes.
11. **Handoff** - report changed files, checks, and unresolved risk.

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
