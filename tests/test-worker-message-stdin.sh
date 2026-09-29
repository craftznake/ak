#!/usr/bin/env sh
# Worker done/reply stdin preserves shell metacharacters and durable artifacts.
set -eu

AK=$(cd "$(dirname "$0")/.." && pwd)/bin/ak
tmp=$(mktemp -d "${TMPDIR:-/tmp}/ak-worker-stdin.XXXXXX")
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT HUP INT TERM

git init -q "$tmp"
git -C "$tmp" config user.email worker-stdin@example.invalid
git -C "$tmp" config user.name "ak worker stdin test"
git -C "$tmp" commit -q --allow-empty -m init

slug=stdin-fixture
worker="$tmp/worker"
mkdir -p "$worker/.agent-kit" "$tmp/.agent-kit/crew/$slug"
cat >"$tmp/.agent-kit/role" <<EOF
role=worker
slug=$slug
primary_repo=$tmp
primary_session=test
primary_target=
EOF
cat >"$tmp/.agent-kit/crew/$slug/meta" <<EOF
slug=$slug
repo=$tmp
worktree=$worker
branch=ak/$slug
vcs=git
brief=$tmp/.agent-kit/crew/$slug/brief.md
EOF
printf 'schema=ak-crew-state.v1\nstate=running\n' >"$tmp/.agent-kit/crew/$slug/state"
mkdir -p "$tmp/.agent-kit"
printf 'session=test\ntarget=\ninject=1\n' >"$tmp/.agent-kit/primary"
export AK_NO_NOTIFY=1 AK_DEBUG_WAKE="$tmp/wake.log"

BODY=$(printf 'Report with `find`, $HOME, $(literal-substitution), and\nsecond line with `cargo build`.')
# A legacy inline argument is expanded by the invoking shell before ak starts.
legacy=$(sh -c 'printf "%s" "legacy `printf command-substitution` $HOME"')
[ "$legacy" = "legacy command-substitution $HOME" ] || { echo "FAIL: legacy-shell repro unexpected: [$legacy]" >&2; exit 1; }
echo "legacy inline shell expansion reproduced (backticks executed before ak)"

# The fixture worktree is a real repository so ak's repo-root role lookup works.
git init -q "$worker"
git -C "$worker" config user.email worker@example.invalid
git -C "$worker" config user.name worker
git -C "$worker" commit -q --allow-empty -m init
mkdir -p "$worker/.agent-kit"
cp "$tmp/.agent-kit/role" "$worker/.agent-kit/role"
(cd "$worker" && printf '%s\n' "$BODY" | "$AK" done)
report="$tmp/.agent-kit/crew/$slug/report.md"
chat="$tmp/.agent-kit/crew/$slug/chat.log"
inbox="$tmp/.agent-kit/inbox"
for file in "$report" "$chat" "$inbox"/*.md "$tmp/wake.log"; do
    [ -f "$file" ] || { echo "FAIL: missing durable output: $file" >&2; exit 1; }
    grep -Fq '`find`' "$file" || { echo "FAIL: backticks missing from $file" >&2; exit 1; }
    grep -Fq '$HOME' "$file" || { echo "FAIL: dollar sign missing from $file" >&2; exit 1; }
    grep -Fq '$(literal-substitution)' "$file" || { echo "FAIL: literal command substitution missing from $file" >&2; exit 1; }
    grep -Fq 'second line with `cargo build`.' "$file" || { echo "FAIL: multiline content missing from $file" >&2; exit 1; }
done
[ "$(grep -c '^worker[[:space:]]' "$chat")" -eq 1 ] || { echo "FAIL: chat entry missing or duplicated" >&2; exit 1; }
grep -q '^\[crew stdin-fixture\]' "$tmp/wake.log" || { echo "FAIL: framed wake content missing" >&2; exit 1; }
[ "$(grep -c '^\[crew stdin-fixture\]' "$tmp/wake.log")" -eq 1 ] || { echo "FAIL: framed wake content duplicated" >&2; exit 1; }
# With no registered primary target there is no wake to attempt; framed content is recorded by the diagnostic hook.
grep -Fq 'state=reported' "$tmp/.agent-kit/crew/$slug/state" || { echo "FAIL: crew state not reported" >&2; exit 1; }
echo "stdin done content round-trips to report.md, chat.log, inbox; PASS"

# Verify explicit '-' is also stdin for reply, without ending the crew.
(cd "$worker" && printf 'reply `literal` $HOME\n' | "$AK" reply -)
grep -Fq 'reply `literal` $HOME' "$chat" || { echo "FAIL: reply stdin did not reach chat.log" >&2; exit 1; }
echo "stdin reply content round-trips to chat.log; PASS"
