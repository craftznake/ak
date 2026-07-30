# VCS workflow

This repository supports both jj and git working-copy isolation for crews.

## Crew workspace cleanup

`bin/ak crew-finish` owns VCS cleanup after the safety preconditions are met: a report exists and the crew worktree is clean.

### jj

For jj repos, `crew-spawn` creates an isolated jj workspace with an empty working-copy change described as `agent-kit crew: <slug>` and records that change id in crew metadata.

When finishing a jj crew, `crew-finish`:

1. verifies the crew worktree is clean;
2. verifies the recorded spawn change still exists, is empty, and still has the expected `agent-kit crew: <slug>` description;
3. closes the Herdr tab when available;
4. forgets the jj workspace;
5. abandons the empty spawn change; and
6. removes the workspace directory.

If the recorded jj change is non-empty or has an unexpected description, `crew-finish` refuses to clean it up and leaves the crew intact for review.

### git

For git repos, `crew-spawn` creates a git worktree on `ak/<slug>`. When finishing a clean crew, `crew-finish` removes the git worktree and deletes that local branch.
