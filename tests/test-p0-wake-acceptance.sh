#!/usr/bin/env sh
# Independent verification test for the P0 wake "confirmed delivery" claim.
#
# The author's test only asserted the EXIT CODE of a live-agent wake, which the
# pre-fix backend_wake returned whenever `herdr agent send` + `pane send-keys
# enter` both exited 0 — i.e. when the KEYSTROKE was delivered, not when the
# agent ACCEPTED the prompt. This test asserts acceptance itself: after a wake,
# the agent must actually enter the `working` state, and the acceptance probe
# (`herdr agent wait --status working`) must be a real signal (it times out
# against a settled, non-woken agent).
#
# Isolated like the author's test: scratch git repo + throwaway herdr tab, no
# mutation of the real primary's crews or state.
set -eu

AK=$(cd "$(dirname "$0")/.." && pwd)/bin/ak
tmp=$(mktemp -d "${TMPDIR:-/tmp}/ak-p0-wake.XXXXXX")
slug="p0-wake-$$"
TAB=
SESSION="${AK_HERDR_SESSION:-default}"

cleanup() {
    if [ -n "$TAB" ]; then
        herdr tab close "$TAB" --session "$SESSION" >/dev/null 2>&1 || true
    fi
    # Close the throwaway workspace too: `herdr workspace create` leaves an
    # initial tab named after the scratch dir, and `tab close` refuses to
    # close a workspace's last tab, so only `workspace close` fully removes it.
    wsid=$(herdr workspace list --session "$SESSION" 2>/dev/null \
        | jq -r --arg l "$AK_HERDR_WORKSPACE" '(.result.workspaces // .workspaces // [])[] | select(.label == $l or ((.label // "") | sub("^\\[[0-9]+\\] "; "") == $l)) | (.workspace_id // .id)' 2>/dev/null | head -n 1)
    [ -n "$wsid" ] && herdr workspace close "$wsid" --session "$SESSION" >/dev/null 2>&1 || true
    rm -rf "$tmp"
}
trap cleanup EXIT HUP INT TERM

git init -q "$tmp"
git -C "$tmp" config user.email p0-wake@example.invalid
git -C "$tmp" config user.name "ak p0 wake test"
git -C "$tmp" commit -q --allow-empty -m init

export AK_NO_NOTIFY=1
export AK_HERDR_SESSION="$SESSION"
export AK_HERDR_WORKSPACE="ak-p0-wake-selftest"
export AK_CREW_STARTUP_TIMEOUT=60000
export AK_CREW_READY_TIMEOUT=20000
export AK_WAKE_ACCEPT_TIMEOUT=8000

echo "== spawn a throwaway fixture crew =="
(
    cd "$tmp" &&
        "$AK" crew-spawn "$slug" "You are a wake-acceptance test fixture. Stay idle. Do not create files, do not run commands, do not report."
)
META="$tmp/.agent-kit/crew/$slug/meta"
[ -f "$META" ] || { echo "FAIL: crew meta missing after spawn" >&2; exit 1; }
PANE=$(awk -F= '$1=="herdr_pane"{print $2}' "$META")
SESSION=$(awk -F= '$1=="herdr_session"{print $2}' "$META")
TAB=$(awk -F= '$1=="herdr_tab"{print $2}' "$META")
[ -n "$PANE" ] || { echo "FAIL: no herdr pane recorded in meta" >&2; exit 1; }

agent_status() {
    herdr agent get "$PANE" --session "$SESSION" 2>/dev/null \
        | jq -r '.result.agent.agent_status // empty' 2>/dev/null || true
}

echo "== wait for the fixture to settle to idle/done =="
status=
i=0
while [ "$i" -lt 90 ]; do
    status=$(agent_status)
    case "$status" in
    idle | done) break ;;
    esac
    i=$((i + 1))
    sleep 1
done
case "$status" in
idle | done) : ;;
*) echo "FAIL: fixture never settled (last status: ${status:-unknown})" >&2; exit 1 ;;
esac
echo "settled status: $status"

echo "== acceptance probe must be a real signal: times out against a settled, non-woken agent =="
# herdr 0.9 renamed `agent wait --status` to `--until`; probe the surface so
# the suite asserts the same behavior on both herdr generations.
wait_state_flag=--status
herdr agent wait --help 2>&1 | grep -q -- '--until' && wait_state_flag=--until
if herdr agent wait "$PANE" "$wait_state_flag" working --timeout 800 --session "$SESSION" >/dev/null 2>&1; then
    echo "FAIL: agent wait --status working returned success on a non-woken settled agent" >&2
    exit 1
fi
echo "agent wait timed out on non-woken agent (expected)"

echo "== wake a live agent and assert it actually enters working =="
mkdir -p "$tmp/.agent-kit"
printf 'session=%s\ntarget=%s\nagent=pi\ninject=1\n' "$SESSION" "$PANE" >"$tmp/.agent-kit/primary"
if ! (cd "$tmp" && "$AK" crew-report "$slug" "p0 wake-acceptance live probe"); then
    echo "FAIL: live wake returned non-zero" >&2
    exit 1
fi
# Acceptance, not just the exit code: the agent must leave idle/done -> working.
accepted=0
i=0
while [ "$i" -lt 10 ]; do
    status=$(agent_status)
    if [ "$status" = working ]; then
        accepted=1
        break
    fi
    i=$((i + 1))
    sleep 0.5
done
[ "$accepted" = 1 ] || { echo "FAIL: wake returned 0 but agent never entered working (last status: ${status:-unknown})" >&2; exit 1; }
echo "agent entered working after wake (acceptance confirmed)"

echo "== dead/nonexistent target still fails loudly and records undelivered_at =="
printf 'session=%s\ntarget=bogus-nonexistent-pane\nagent=pi\ninject=1\n' "$SESSION" >"$tmp/.agent-kit/primary"
set +e
out=$(cd "$tmp" && "$AK" crew-report "$slug" "p0 dead-wake probe" 2>&1)
rc=$?
set -e
printf '%s\n' "$out"
[ "$rc" -ne 0 ] || { echo "FAIL: dead wake returned exit 0" >&2; exit 1; }
printf '%s\n' "$out" | grep -q 'no agent registered' || { echo "FAIL: missing 'no agent registered' message" >&2; exit 1; }
grep -q '^undelivered_at=' "$tmp/.agent-kit/crew/$slug/state" || { echo "FAIL: undelivered_at not recorded" >&2; exit 1; }

echo "P0 wake-acceptance verification: PASS"
