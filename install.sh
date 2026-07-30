#!/usr/bin/env sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

mkdir -p "$HOME/.claude" "$HOME/.pi/agent" "$HOME/.config/opencode"

ln -sf "$repo_dir/claude.md" "$HOME/.claude/CLAUDE.md"
cp "$repo_dir/pi.md" "$HOME/.pi/agent/AGENTS.md"

opencode_config="$HOME/.config/opencode/opencode.json"
if [ ! -f "$opencode_config" ]; then
  cat >"$opencode_config" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "instructions": ["$repo_dir/opencode.md"]
}
EOF
  printf 'Created %s\n' "$opencode_config"
else
  printf 'Skipped existing %s\n' "$opencode_config"
  printf 'Add this instruction path manually if it is missing:\n%s\n' "$repo_dir/opencode.md"
fi

printf 'Installed Claude Code and Pi instructions. Restart each harness to reload config.\n'
