#!/usr/bin/env sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
local_bin="$HOME/.local/bin"

install_symlink() {
  source_path=$1
  target_path=$2
  target_dir=$(dirname -- "$target_path")
  mkdir -p "$target_dir"

  if [ -L "$target_path" ]; then
    ln -sfn "$source_path" "$target_path"
    printf 'Updated symlink %s -> %s\n' "$target_path" "$source_path"
  elif [ -e "$target_path" ]; then
    backup_path="$target_path.agent-kit-backup.$(date +%Y%m%d%H%M%S).$$"
    mv "$target_path" "$backup_path"
    ln -sfn "$source_path" "$target_path"
    printf 'Moved existing %s to %s and installed symlink -> %s\n' "$target_path" "$backup_path" "$source_path"
  else
    ln -sfn "$source_path" "$target_path"
    printf 'Installed symlink %s -> %s\n' "$target_path" "$source_path"
  fi
}

ensure_path_in_shell() {
  bin_dir=$1
  shell_name=${SHELL##*/}
  marker="# agent-kit: make ak available"

  case "$shell_name" in
    zsh)
      rc_file="$HOME/.zshrc"
      path_block='case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) export PATH="$HOME/.local/bin:$PATH" ;;
esac'
      ;;
    bash)
      rc_file="$HOME/.bashrc"
      path_block='case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) export PATH="$HOME/.local/bin:$PATH" ;;
esac'
      ;;
    fish)
      mkdir -p "$HOME/.config/fish/conf.d"
      rc_file="$HOME/.config/fish/conf.d/agent-kit.fish"
      path_block='fish_add_path -g "$HOME/.local/bin"'
      ;;
    *)
      rc_file="$HOME/.profile"
      path_block='case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) export PATH="$HOME/.local/bin:$PATH" ;;
esac'
      ;;
  esac

  if [ -f "$rc_file" ] && grep -Fq "$marker" "$rc_file"; then
    printf 'Shell PATH setup already present in %s.\n' "$rc_file"
  elif [ -e "$rc_file" ] && [ ! -w "$rc_file" ]; then
    printf 'Skipped PATH setup in %s because it is not writable.\n' "$rc_file"
  else
    mkdir -p "$(dirname -- "$rc_file")"
    {
      printf '\n%s\n' "$marker"
      printf '%s\n' "$path_block"
    } >>"$rc_file"
    printf 'Added %s to future interactive shells via %s.\n' "$bin_dir" "$rc_file"
  fi

  case ":${PATH:-}:" in
    *":$bin_dir:"*)
      printf '%s is already on current PATH.\n' "$bin_dir"
      ;;
    *)
      printf '%s is not on current PATH. Restart your shell or source %s before running ak by name here.\n' "$bin_dir" "$rc_file"
      ;;
  esac
}

mkdir -p "$HOME/.config/opencode" "$HOME/.claude/skills" "$HOME/.pi/agent/extensions" "$local_bin"

install_symlink "$repo_dir/claude.md" "$HOME/.claude/CLAUDE.md"
install_symlink "$repo_dir/shared.md" "$HOME/.claude/shared.md"

install_symlink "$repo_dir/pi.md" "$HOME/.pi/agent/AGENTS.md"
install_symlink "$repo_dir/shared.md" "$HOME/.pi/agent/shared.md"
install_symlink "$repo_dir/extensions/pi/ak-context-file-imports.ts" "$HOME/.pi/agent/extensions/ak-context-file-imports.ts"

install_symlink "$repo_dir/bin/ak" "$local_bin/ak"
ensure_path_in_shell "$local_bin"

if [ -d "$repo_dir/.agents/skills/lavish" ]; then
  install_symlink "$repo_dir/.agents/skills/lavish" "$HOME/.claude/skills/lavish"
fi

opencode_config="$HOME/.config/opencode/opencode.json"
opencode_instruction="$repo_dir/opencode.md"
if [ ! -f "$opencode_config" ]; then
  cat >"$opencode_config" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "instructions": ["$opencode_instruction"]
}
EOF
  printf 'Created %s\n' "$opencode_config"
else
  if python3 - "$opencode_config" "$opencode_instruction" <<'PY'
import json
import pathlib
import sys

config_path = pathlib.Path(sys.argv[1])
instruction_path = sys.argv[2]

try:
    data = json.loads(config_path.read_text())
except Exception:
    raise SystemExit(1)

instructions = data.get('instructions')
if instructions is None:
    instructions = []
elif not isinstance(instructions, list):
    raise SystemExit(1)

if instruction_path not in instructions:
    instructions.append(instruction_path)
    data['instructions'] = instructions
    config_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
    print('updated')
PY
  then
    printf 'Updated %s with %s\n' "$opencode_config" "$opencode_instruction"
  else
    printf 'Skipped %s because it is not a JSON config with an instructions array.\n' "$opencode_config"
    printf 'Add this instruction path manually if it is missing:\n%s\n' "$opencode_instruction"
  fi
fi

printf 'Installed agent-kit symlinks. Restart agent harnesses and any shell that did not already have ~/.local/bin on PATH.\n'
