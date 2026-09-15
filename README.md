# agent-kit

Personal portable agent instructions and lightweight workflow helpers for Claude Code, Pi, opencode, and any agent that reads `AGENTS.md`.

This is intentionally a **small Firstmate-inspired workflow**. It keeps the parts that fit a deterministic software-engineering setup:

- one primary agent you chat with that self-detects its role (primary vs worker)
- a primary that coordinates multiple crews (workers) in isolated VCS workspaces (`jj workspace` for jj repos, git worktrees for git repos)
- a primary/worker message chatbox: workers wake the primary when done
- a backend-dev loop: research -> plan -> approve -> implement -> test -> notify, with phases
- Herdr-visible task tabs (behind a backend seam so other backends can be added later)
- Lavish-powered interactive planning for architectural/big changes
- explicit safety boundaries instead of hidden autonomy

## Layout

- `shared.md` - source-of-truth behavior for agents
- `AGENTS.md` - repo entrypoint that imports `shared.md`
- `claude.md` - Claude Code entrypoint
- `pi.md` - Pi entrypoint
- `opencode.md` - opencode entrypoint
- `extensions/pi/ak-context-file-imports.ts` - Pi extension that expands `@*.md` imports from loaded context files into the system prompt
- `ak` - small helper for setup, plans, Lavish, Herdr tabs, and crew lifecycle
- `docs/deterministic-workflow.md` - workflow contract
- `docs/roles-model.md` - primary/worker role detection, worker marker, and chatbox
- `docs/dev-workflow.md` - backend-dev loop (research → plan → approve → implement → test → notify) and phases
- `docs/herdr-workflow.md` - Herdr usage notes
- `docs/onboarding.md` - setup on this machine, other machines, and per repo
- `docs/primary-agent-model.md` - firstmate-style primary delegation behavior
- `docs/supervision-model.md` - crew supervision commands and loop
- `docs/reporting-model.md` - push reporting from crews to the primary
- `docs/safety-model.md` - cleanup and isolation rules
- `docs/research-notes.md` - notes from Firstmate and Lavish research
- `extensions/pi/ak-phase-status.ts` - Pi extension that renders the current role/phase in the primary session
- `.agents/skills/lavish/` - local Lavish skill prompt

## Install

```sh
./install.sh
```

The script:

- symlinks `claude.md` to `~/.claude/CLAUDE.md`
- symlinks `pi.md` to `~/.pi/agent/AGENTS.md`
- symlinks `shared.md` beside those entrypoints for relative imports
- symlinks the Pi `ak-context-file-imports` extension to expand `@shared.md`-style context imports
- symlinks `ak` to `~/.local/ak`
- adds an idempotent `~/.local/bin` PATH block to the active shell's startup file when that file is writable
- creates or updates an opencode config so it includes this repo's `opencode.md` in `instructions`
- symlinks the local Lavish skill into `~/.claude/skills/lavish`

Existing non-symlink install targets are moved to `*.agent-kit-backup.*` before the symlink is installed.

If opencode already has a config, `install.sh` will add this repo's `opencode.md` to its `instructions` array while preserving existing providers, plugins, and permissions.

## Onboarding

See `docs/onboarding.md` for global, per-machine, and per-repo setup.

Short version:

```sh
git clone <your-agent-kit-repo-url> ~/agent-kit
cd ~/agent-kit
./install.sh
ak doctor
```

In a work repo:

```sh
ak init
ak primary-set
```

## Daily workflow

Primary side:

```sh
ak doctor
ak init
ak role                 # -> primary (default when unset)
ak primary-set
ak phase set research
ak plan "fix flaky login test"
ak phase set implementing
ak crew-spawn fix-login "stabilize the flaky login test"
ak chat fix-login       # read the primary/worker transcript
ak crew-audit
ak crew-finish fix-login
ak phase set done
```

Worker side (inside the crew worktree the primary spawned):

```sh
ak role                 # -> worker
ak reply "which config toggles the login timeout?"   # ask mid-task, wakes primary
ak done "fixed the flaky wait, added a regression test, suite green"  # report + wake primary
```

For interactive planning:

```sh
mkdir -p .lavish
# agent writes .lavish/plan.html
ak lavish .lavish/plan.html
npx -y lavish-axi poll .lavish/plan.html
```

## Design influences

Researched inspirations:

- `kunchenguid/firstmate`: agent distro, visible crew, Herdr backend, isolated workspaces, explicit project modes, strong safety boundaries.
- `kunchenguid/lavish-axi`: local-first HTML review loop, annotation/polling workflow, visual plans and reports.

This repo keeps a smaller personal setup suitable for a software engineer who wants deterministic, inspectable work with one primary agent and visible crews rather than a full autonomous fleet manager.
