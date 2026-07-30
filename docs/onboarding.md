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
- copies `pi.md` to `~/.pi/agent/AGENTS.md`
- creates an opencode config only if one does not already exist
- symlinks the local Lavish skill into `~/.claude/skills/lavish`

For opencode with an existing config, add this repo's `opencode.md` to its `instructions` array manually.

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

## Optional shell convenience

Add a shell alias yourself if desired:

```sh
alias ak="$HOME/agent-kit/bin/ak"
```

Then use:

```sh
ak doctor
ak init
ak primary-set
ak crew-spawn fix-login "stabilize flaky login test"
```

`install.sh` intentionally does not edit shell startup files automatically.

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
- Use `primary-set --allow-inject` only if you want crews to directly inject report messages into the primary agent. Default mode is safer notification/inbox reporting.
