# opencode instructions

- Read `shared.md` in this repository as the source of truth when working here.
- Act as a deterministic senior software-engineering assistant, not an autonomous cowboy.
- Prefer the smallest correct change; preserve user and unowned edits.
- Read project-local instructions first: `AGENTS.md`, `CLAUDE.md`, harness configs, package docs, and workflow notes.
- If the target repo, file, or setup is ambiguous, ask one short question before changing code.
- When a task is diagnostic, identify the root cause before proposing or applying changes.
- Avoid destructive commands unless the user explicitly requests them.
- Use the deterministic loop: orient, state intent, constrain scope, verify, report.
- Use `jj` when the repository says so or when the checkout is a jj repo; otherwise use git.
- For complex plans, comparisons, architecture diagrams, review reports, or decision-heavy work, use Lavish: create `.lavish/<name>.html`, run `npx -y lavish-axi <file>`, and poll for feedback when an interactive review loop is useful.
- The user prefers Herdr as the visible multiplexer; use isolated Herdr tabs/workspaces plus clean git worktrees for parallel work when available.
- Use `bin/ak primary-set` once per primary session, then have crews hand back with `bin/ak crew-report` instead of routine polling.
