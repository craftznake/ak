# Onboarding

Use this repo either globally for your machine-wide agent behavior, or per repo when a project needs its own checked-in workflow.

## One machine, global default

Clone once:

```sh
git clone <your-agent-kit-repo-url> ~/agent-kit
cd ~/agent-kit
./install.sh
bin/ak doctor
```

Then restart your agent harnesses.

What `install.sh` does:

- symlinks `claude.md` to `~/.claude/CLAUDE.md`
- symlinks `shared.md` beside Claude's entrypoint for relative imports
- symlinks `pi.md` to `~/.pi/agent/AGENTS.md`
- symlinks `shared.md` beside Pi's entrypoint for relative imports
- symlinks the Pi `ak-context-file-imports` extension to `~/.pi/agent/extensions/ak-context-file-imports.ts` so `@shared.md`-style imports are expanded into Pi's system prompt
- symlinks `bin/ak` to `~/.local/bin/ak`
- adds an idempotent `~/.local/bin` PATH block to the active shell's startup file when that file is writable
- creates or updates an opencode config so it includes this repo's `opencode.md` in `instructions`
- symlinks the local Lavish skill into `~/.claude/skills/lavish`

Existing non-symlink install targets are moved to `*.agent-kit-backup.*` before the symlink is installed.

For opencode with an existing config, `install.sh` will merge this repo's `opencode.md` into its `instructions` array while preserving the rest of the config.

## Daily primary-agent startup

From the repo you are working in:

```sh
/path/to/agent-kit/bin/ak doctor
/path/to/agent-kit/bin/ak init
/path/to/agent-kit/bin/ak primary-set
```

Then talk to the primary agent normally. For multi-step work it can spawn crews:

```sh
/path/to/agent-kit/bin/ak crew-spawn fix-login "stabilize flaky login test"
```

Crews report back with:

```sh
/path/to/agent-kit/bin/ak crew-report fix-login "fixed, tests passed, ready for review"
```

## Shell convenience

`install.sh` symlinks `ak` into `~/.local/bin/ak` and appends a marked, idempotent PATH block for the active shell (`~/.zshrc`, `~/.bashrc`, fish `conf.d`, or `~/.profile`) when that block is not already installed and the startup file is writable.

After install, restart the shell or source the updated startup file, then use:

```sh
ak doctor
ak init
ak primary-set
ak crew-spawn fix-login "stabilize flaky login test"
```

## Per-repo setup

Use per-repo setup when you want the workflow to travel with a specific project.

### Option A: checked-in thin AGENTS.md

Create `AGENTS.md` in the project:

```md
# Project agent instructions

Follow the global agent-kit workflow from ~/agent-kit/shared.md.

Project-specific rules:

- Run the project's documented checks before handoff.
- Preserve unowned edits.
```

This is simple and portable, but each developer must have their own global agent-kit installed.

### Option B: vendor this repo as tooling

Add this repo as a submodule, subtree, or copied tools directory, for example:

```sh
git submodule add <your-agent-kit-repo-url> tools/agent-kit
```

Then project agents can use:

```sh
tools/agent-kit/bin/ak init
tools/agent-kit/bin/ak primary-set
tools/agent-kit/bin/ak crew-spawn <slug> "<brief>"
```

This is better when the project team wants the same helper scripts and docs.

## New machine checklist

1. Install prerequisites:
   - git
   - jq
   - node/npm/npx
   - Herdr
   - your agent harnesses: Pi, Claude Code, opencode, etc.
2. Clone this repo.
3. Run `./install.sh`.
4. Restart harnesses.
5. Run `bin/ak doctor`.
6. In each active work repo, run `bin/ak init` and `bin/ak primary-set`.

## Notes

- `.agent-kit/` and `.lavish/` are local runtime state and should stay gitignored.
- `primary-set` is per work repo/session because it records the current primary Herdr target.
- `primary-set` wakes the registered primary by default when crews report. Use `primary-set --notify-only` if you want notification/inbox-only reporting.
