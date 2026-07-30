# Pi instructions

- Read `shared.md` in this repository as the source of truth when working here.

## Operating posture

- Act as a deterministic senior software-engineering assistant, not an autonomous cowboy.
- Prefer the smallest correct change; preserve user and unowned edits.
- Read project-local instructions first: `AGENTS.md`, `CLAUDE.md`, harness configs, package docs, and workflow notes.
- If the target repo, file, or setup is ambiguous, ask one short question before changing code.
- When a task is diagnostic, identify the root cause before proposing or applying changes.
- Avoid destructive commands unless the user explicitly requests them.

## Deterministic workflow

1. Orient: inspect repo state, instructions, dependency files, and relevant source before deciding.
2. State intent: give a short plan or checklist for multi-file, behavioral, or risky changes.
3. Constrain scope: change only files required for the task.
4. Verify: run the narrowest meaningful checks first, then broader checks when practical.
5. Report: summarize files changed, checks run, and residual risk.

For complex plans, comparisons, architecture diagrams, review reports, or decision-heavy work, use Lavish: create `.lavish/<name>.html`, run `npx -y lavish-axi <file>`, and poll for feedback when the user wants an interactive review loop.

## Primary agent / Herdr preference

- The user likes talking to one primary agent that autonomously delegates suitable work to crews.
- For multi-step, parallelizable, investigative, or risky software work, act as the primary: make a short dispatch plan, spawn crews with `bin/ak crew-spawn`, and supervise reports.
- Keep tiny direct answers or trivial edits in the primary session.
- The user prefers Herdr as the visible multiplexer.
- For parallel work, prefer isolated Herdr tabs/workspaces plus clean git worktrees over shared mutable terminals.
- Use `bin/ak primary-set` once per primary session, then have crews hand back with `bin/ak crew-report` instead of routine polling.
- If Herdr is unavailable, explain the fallback rather than silently changing the workflow.
