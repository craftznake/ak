# agent-kit

Personal portable agent instructions and lightweight workflow helpers for Claude Code, Pi, opencode, and any agent that reads `AGENTS.md`.

This is intentionally a **small Firstmate-inspired workflow**. It keeps the parts that fit a deterministic software-engineering setup:

- one primary agent coordinating multiple crews
- isolated VCS workspaces per crew (`jj workspace` for jj repos, git worktrees for git repos)
- Herdr-visible task tabs
- a small plan/verify/handoff loop
- Lavish-powered interactive planning when prose is not enough
- explicit safety boundaries instead of hidden autonomy

## Layout

- `shared.md` - source-of-truth behavior for agents
- `AGENTS.md` - repo entrypoint that imports `shared.md`
- `claude.md` - Claude Code entrypoint
- `pi.md` - Pi entrypoint
- `opencode.md` - opencode entrypoint
- `extensions/pi/ak-context-file-imports.ts` - Pi extension that expands `@*.md` imports from loaded context files into the system prompt
- `bin/ak` - small helper for setup, plans, Lavish, Herdr tabs, and crew lifecycle
- `docs/deterministic-workflow.md` - workflow contract
- `docs/herdr-workflow.md` - Herdr usage notes
- `docs/onboarding.md` - setup on this machine, other machines, and per repo
- `docs/primary-agent-model.md` - firstmate-style primary delegation behavior
- `docs/supervision-model.md` - crew supervision commands and loop
- `docs/reporting-model.md` - push reporting from crews to the primary
- `docs/safety-model.md` - cleanup and isolation rules
- `docs/research-notes.md` - notes from Firstmate and Lavish research
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
- symlinks `bin/ak` to `~/.local/bin/ak`
- adds an idempotent `~/.local/bin` PATH block to the active shell's startup file when that file is writable
- creates an opencode config only when one does not already exist
- symlinks the local Lavish skill into `~/.claude/skills/lavish`

Existing non-symlink install targets are moved to `*.agent-kit-backup.*` before the symlink is installed.

If opencode already has a config, add `opencode.md` manually to preserve existing providers, plugins, and permissions.

## Onboarding

See `docs/onboarding.md` for global, per-machine, and per-repo setup.

Short version:

```sh
git clone <your-agent-kit-repo-url> ~/agent-kit
cd ~/agent-kit
./install.sh
bin/ak doctor
```

In a work repo:

```sh
ak init
ak primary-set
```

## Daily workflow

```sh
bin/ak doctor
bin/ak init
bin/ak primary-set
bin/ak plan "fix flaky login test"
bin/ak crew-spawn fix-login "stabilize the flaky login test"
bin/ak crew-report fix-login "fixed and ready for review"
bin/ak crew-audit
bin/ak crew-finish fix-login
```

For interactive planning:

```sh
mkdir -p .lavish
# agent writes .lavish/plan.html
bin/ak lavish .lavish/plan.html
npx -y lavish-axi poll .lavish/plan.html
```

## Design influences

Researched inspirations:

- `kunchenguid/firstmate`: agent distro, visible crew, Herdr backend, isolated workspaces, explicit project modes, strong safety boundaries.
- `kunchenguid/lavish-axi`: local-first HTML review loop, annotation/polling workflow, visual plans and reports.

This repo keeps a smaller personal setup suitable for a software engineer who wants deterministic, inspectable work with one primary agent and visible crews rather than a full autonomous fleet manager.
