#!/usr/bin/env sh
# Self-test for the ak P0 delivery fix: successful spawn delivery, a wake to a
# live agent, and a wake to a dead/nonexistent target.
#
# Isolated by design: it creates its own scratch git repo and throwaway herdr
# workspace/tab, and never touches the real primary's crews or state.
set -eu

AK=$(cd "$(dirname "$0")/.." && pwd)/bin/ak
tmp=$(mktemp -d "${TMPDIR:-/tmp}/ak-p0-test.XXXXXX")
slug="p0-selftest-$$"
TAB=
SESSION="${AK_HERDR_SESSION:-default}"

cleanup() {
    if [ -n "$TAB" ]; then
        herdr tab close "$TAB" --session "$SESSION" >/dev/null 2>&1 || true
    fi
    rm -rf "$tmp"
}
trap cleanup EXIT HUP INT TERM

# Scratch "primary" repo so the test never mutates the real primary's state.
git init -q "$tmp"
git -C "$tmp" config user.email p0-test@example.invalid
git -C "$tmp" config user.name "ak p0 test"
git -C "$tmp" commit -q --allow-empty -m init

export AK_NO_NOTIFY=1
export AK_HERDR_SESSION="$SESSION"
export AK_HERDR_WORKSPACE="ak-p0-selftest"
export AK_CREW_STARTUP_TIMEOUT=60000
export AK_CREW_READY_TIMEOUT=20000

echo "== 1. spawn delivery (acceptance-proven) =="
(
    cd "$tmp" &&
        "$AK" crew-spawn "$slug" "You are a delivery self-test fixture. Do not create or modify any files, do not run commands, do not report; just stay idle."
)
META="$tmp/.agent-kit/crew/$slug/meta"
[ -f "$META" ] || { echo "FAIL: crew meta missing after spawn" >&2; exit 1; }
PANE=$(awk -F= '$1=="herdr_pane"{print $2}' "$META")
SESSION=$(awk -F= '$1=="herdr_session"{print $2}' "$META")
TAB=$(awk -F= '$1=="herdr_tab"{print $2}' "$META")
[ -n "$PANE" ] || { echo "FAIL: no herdr pane recorded in meta" >&2; exit 1; }
echo "spawned pane: $PANE (session $SESSION)"

status=$(herdr agent get "$PANE" --session "$SESSION" 2>/dev/null | jq -r '.result.agent.agent_status // empty' || true)
echo "throwaway agent status after spawn: ${status:-unknown}"
[ -n "$status" ] || { echo "FAIL: throwaway agent not detected" >&2; exit 1; }

echo "== 2. wake to a live agent =="
mkdir -p "$tmp/.agent-kit"
printf 'session=%s\ntarget=%s\nagent=pi\ninject=1\n' "$SESSION" "$PANE" >"$tmp/.agent-kit/primary"
(cd "$tmp" && "$AK" crew-report "$slug" "p0 live-wake self-test")

echo "== 3. wake to a dead/nonexistent target =="
printf 'session=%s\ntarget=bogus-nonexistent-pane\nagent=pi\ninject=1\n' "$SESSION" >"$tmp/.agent-kit/primary"
set +e
out=$(cd "$tmp" && "$AK" crew-report "$slug" "p0 dead-wake self-test" 2>&1)
rc=$?
set -e
printf '%s\n' "$out"
[ "$rc" -ne 0 ] || { echo "FAIL: dead wake returned exit 0" >&2; exit 1; }
printf '%s\n' "$out" | grep -q 'no agent registered' || { echo "FAIL: missing 'no agent registered' message" >&2; exit 1; }
grep -q '^undelivered_at=' "$tmp/.agent-kit/crew/$slug/state" || { echo "FAIL: undelivered_at not recorded in crew state" >&2; exit 1; }

echo "== teardown =="
echo "P0 delivery self-test: PASS"
