# agent-kit

Portable shared instructions for `opencode`, Claude Code, and Pi.

## What is here

- `shared.md` - the core instruction set
- `claude.md` - Claude Code entrypoint that imports `shared.md`
- `opencode.md` - opencode instruction file
- `pi.md` - Pi instruction file

## How to use

Run:

```sh
./install.sh
```

The script symlinks Claude Code, copies Pi instructions, and creates a minimal opencode config only when one does not already exist.

If opencode already has a config, add the `opencode.md` path manually to preserve existing providers, plugins, and permissions.

### Claude Code

Copy or symlink `claude.md` to `~/.claude/CLAUDE.md`.

### Pi

Copy `pi.md` to `~/.pi/agent/AGENTS.md`.

### opencode

Point `instructions` in `~/.config/opencode/opencode.json` at `opencode.md`.

Example:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "instructions": ["/absolute/path/to/agent-kit/opencode.md"]
}
```

## Notes

- Keep this repo small and portable.
- Update `shared.md` first when changing behavior.
- Keep the harness-specific files thin wrappers around `shared.md`.
