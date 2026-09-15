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

### Mid-investigation delegation (do not become the crew)

The delegation gate is not a one-shot check at the very start - it also applies the moment orientation stops being a scope check and turns into the actual investigation. Long-running investigation (root-causing a crash/bug, tracing behavior or history across multiple files/repos, comparing versions, forming and testing a hypothesis, reproducing a failure) is always `DELEGATE`, no exceptions for "I'm already halfway through." A quick scope check to classify the task (confirm repo/branch, locate the relevant files/services, skim one or two files) is fine and expected; reading many files, grepping across repos, walking git history, or building a hypothesis chain is the delegated work itself.

If the primary notices mid-task that it has drifted into doing the investigation personally, stop, write down what's been learned so far, and spawn a crew with that context in the brief instead of finishing the investigation solo. Carrying forward useful leads (files already found, hypotheses already formed) into the brief is good; using them as an excuse to skip delegation is not.

## Backend-dev loop and phases

For development work (the common "build/change something" case), the primary runs the phased loop owned by `docs/dev-workflow.md`: research → plan → negotiate/approve → implement → test → notify, tracked with `ak phase set <phase>`. The approval step is a hard gate for architectural/big changes (propose via Lavish, wait for explicit approval) and may be auto-proceeded for small, low-risk, reversible changes (state the plan first). Delegation still applies within the loop: implementation and investigation run in worker crews, and workers hand back with `ak done`.

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

## Mechanical enforcement (pi)

The delegation gate above is a policy, enforced today mostly by the agent re-reading and self-policing it each turn. For the pi harness, `extensions/pi/delegation-guard.ts` adds a lightweight mechanical nudge/escalation on top of it: it counts investigative tool calls since the last `bin/ak crew-spawn`-shaped command or stated `DIRECT` justification, and injects reminder messages (then an optional confirm prompt) as that count grows, without blocking any tool call. See `docs/delegation-guard.md` for thresholds, config, and how to disable it. It does not change the policy in this document; it only makes it harder to silently ignore inside a pi session.
