# agent-kit

Personal portable agent instructions and lightweight workflow helpers for Claude Code, Pi, opencode, and any agent that reads `AGENTS.md`.

This is intentionally **not** a full Firstmate clone. It keeps the parts that fit a deterministic software-engineering workflow:

- shared harness instructions
- Herdr-first visible task tabs
- small plan/verify/handoff loop
- Lavish-powered interactive planning when prose is not enough
- no autonomous merges, destructive cleanup, or hidden fleet state

## Layout

- `shared.md` - source-of-truth behavior for agents
- `AGENTS.md` - repo entrypoint that imports `shared.md`
- `claude.md` - Claude Code entrypoint
- `pi.md` - Pi entrypoint
- `opencode.md` - opencode entrypoint
- `bin/ak` - small helper for setup, plans, Lavish, and Herdr tabs
- `docs/deterministic-workflow.md` - workflow contract
- `docs/herdr-workflow.md` - Herdr usage notes
- `docs/research-notes.md` - notes from Firstmate and Lavish research
- `.agents/skills/lavish/` - local Lavish skill prompt

## Install

```sh
./install.sh
```

The script:

- symlinks `claude.md` to `~/.claude/CLAUDE.md`
- copies `pi.md` to `~/.pi/agent/AGENTS.md`
- creates an opencode config only when one does not already exist
- symlinks the local Lavish skill into `~/.claude/skills/lavish`

If opencode already has a config, add `opencode.md` manually to preserve existing providers, plugins, and permissions.

## Daily workflow

```sh
bin/ak doctor
bin/ak init
bin/ak plan "fix flaky login test"
bin/ak herdr-tab fix-login . pi
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

- `kunchenguid/firstmate`: agent distro, visible crew, Herdr backend, isolated worktrees, explicit project modes, strong safety boundaries.
- `kunchenguid/lavish-axi`: local-first HTML review loop, annotation/polling workflow, visual plans and reports.

This repo keeps a smaller personal setup suitable for a software engineer who wants deterministic, inspectable work rather than a full autonomous crew manager.
