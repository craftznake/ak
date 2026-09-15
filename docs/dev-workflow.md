# Backend-dev workflow

This is the default loop the **primary** runs for feature/development work (the common case for a backend engineer: "build/change something"). It sits on top of the generic deterministic loop in `docs/deterministic-workflow.md` and the delegation rules in `docs/primary-agent-model.md`, adding an explicit negotiate → approve → implement → test → notify shape.

The current phase is tracked in `.agent-kit/phase` via `ak phase` and rendered in the pi primary session by the `ak-phase-status` extension.

## Phases

```
research -> planning -> awaiting-approval -> implementing -> testing -> done
```

Set the phase as you move through the loop:

```sh
ak phase set research
ak phase show          # or: ak phase
ak whoami              # shows role + current phase
```

### 1. Research & plan (`research` -> `planning`)

- Understand the request; restate objective, repo, constraints, done condition.
- Do a scope check, not the whole investigation. If real investigation is needed (root-cause, cross-file tracing, reproduction), delegate a scout crew rather than digging personally — see the delegation gate in `docs/primary-agent-model.md`.
- Produce a concrete plan.

### 2. Negotiate / approve (`awaiting-approval`) — hard gate for complex work

- **Complex or architectural change** (multiple files, new component, schema/interface change, migration, risky refactor): propose via **Lavish**. Create a local HTML artifact under `.lavish/`, open it with `npx -y lavish-axi <file>`, and run the foreground `poll` loop until the user responds. Do not start implementing until approved.
- **Small / low-risk change**: a short plain-text plan is enough, and you may **auto-proceed** without a formal approval round when the work is clearly small and reversible. Still state the plan first.
- The gate is about risk, not ceremony: gate complex work, keep small work fast.

Rule of thumb for Lavish: use it when the change touches architecture or is a big/multi-part change; use plain text otherwise.

### 3. Implement (`implementing`)

- Delegate implementation to one or more worker crews in isolated worktrees (`ak crew-spawn <slug> "<brief>"`), choosing the lightest sufficient model.
- Keep the primary on intake, supervision, synthesis, and decisions.
- Workers talk back with `ak reply` mid-task and hand off with `ak done`.

### 4. Test / verify (`testing`)

- Verification is its own phase, not an afterthought. Prefer: formatter/linter for touched files → targeted unit test → package/project test → integration only when warranted.
- The worker runs the checks in its worktree and reports results in `ak done`; the primary reviews. If a check cannot run, say why and what evidence replaced it.

### 5. Notify (`done`)

- On `ak done`, the worker wakes the primary. The primary reviews the report, then reports the outcome to you: what changed, checks run, residual risk, and any decision needed (e.g. merge approval).
- Merge, force-push, and other destructive/irreversible actions remain your explicit decision — the primary never does them autonomously.
- After review and a clean worktree, close the crew with `ak crew-finish <slug>` and set `ak phase set done`.

## What this does not add

- No background watcher or autonomous fleet manager.
- No auto-merge.
- No hidden work: every crew is visible in the backend, and phase/role are inspectable via `ak whoami`.
