# Safety model

The repo uses a simple human-supervised crew model.

## Rules

- One primary agent coordinates the workflow.
- Every parallel task gets its own git worktree.
- Every crew is visible in Herdr.
- The primary agent is responsible for review, checks, and final judgment.
- No merge, force-push, reset, clean, or discard happens without explicit approval.
- A crew can be closed only when its worktree is clean.
- A crew should have a report before it is finished.
- A crew should push its completion note back to the primary with `bin/ak crew-report`.

## Lifecycle

1. Register the primary with `bin/ak primary-set`.
2. Spawn a crew with `bin/ak crew-spawn`.
3. Work in the isolated worktree.
4. Push completion back with `bin/ak crew-report`.
5. Audit progress with `bin/ak crew-audit`.
6. Finish the crew with `bin/ak crew-finish` once the worktree is clean.

## Failure handling

- Dirty worktree: stop and inspect before cleanup.
- Missing report: write one before finish.
- Missing Herdr session: keep the worktree intact.
- Unknown state: treat conservatively and do not clean up automatically.
