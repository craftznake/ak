#!/usr/bin/env sh
# Ladder + correlation self-test.
#
# Covers: bounded re-ring ladder (re-ring at grace boundary, escalate after max
# and stop), acked records never re-ring, fire-and-forget never rings,
# dead/missing target escalates directly without typing, and the pending-reply
# correlation bound (exactly one recovery request, at most one escalation).
#
# The re-ring ladder and correlation bound run against a fixture crew with no
# live pane (AK_INBOX_RING_OK=1 simulates a successful doorbell keystroke). The
# dead-target case uses a real herdr probe against a bogus pane.
set -eu

AK=$(cd "$(dirname "$0")/.." && pwd)/bin/ak
tmp=$(mktemp -d "${TMPDIR:-/tmp}/ak-ladder.XXXXXX")

cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT HUP INT TERM

git init -q "$tmp"
git -C "$tmp" config user.email ladder@example.invalid
git -C "$tmp" config user.name "ak ladder test"
git -C "$tmp" commit -q --allow-empty -m init

mkcrew() {
    slug=$1
    pane=${2:-}
    mkdir -p "$tmp/.agent-kit/crew/$slug"
    if [ -n "$pane" ]; then
        cat >"$tmp/.agent-kit/crew/$slug/meta" <<EOF
slug=$slug
repo=$tmp
worktree=$tmp
branch=ak/$slug
vcs=git
brief=$tmp/.agent-kit/crew/$slug/brief.md
herdr_session=default
herdr_pane=$pane
EOF
    else
        cat >"$tmp/.agent-kit/crew/$slug/meta" <<EOF
slug=$slug
repo=$tmp
worktree=$tmp
branch=ak/$slug
vcs=git
brief=$tmp/.agent-kit/crew/$slug/brief.md
EOF
    fi
    printf 'schema=ak-crew-state.v1\nstate=running\n' >"$tmp/.agent-kit/crew/$slug/state"
}

export AK_NO_WAKE=1 AK_NO_NOTIFY=1
run() { (cd "$tmp" && "$AK" "$@"); }

echo "== 1. ladder: re-ring at grace boundary, escalate after max, stop =="
mkcrew ladder
export AK_INBOX_RING_OK=1 AK_INBOX_GRACE_SECS=0 AK_INBOX_RING_MAX=3
run crew-send ladder "unacked ladder message" >/dev/null
rs="$tmp/.agent-kit/crew/ladder/inbox/.ring-state"
[ -f "$rs" ] || { echo "FAIL: no ring-state after initial ring" >&2; exit 1; }
# ring-state helpers: count of a seq, and "absent" (0 when not present/file gone)
ring_count() { awk -F'\t' -v s="$1" '$1==s{print $2; exit}' "$rs"; }
ring_absent() { [ -f "$rs" ] || return 0; awk -F'\t' -v s="$1" '$1==s{found=1} END{exit found?0:1}' "$rs"; }
# initial ring = count 1
[ "$(ring_count 001)" = 1 ] || { echo "FAIL: initial ring count != 1" >&2; cat "$rs" >&2; exit 1; }
# grace=0 => each sweep re-rings once
run crew-sweep ladder >/dev/null
[ "$(ring_count 001)" = 2 ] || { echo "FAIL: expected re-ring count 2" >&2; exit 1; }
run crew-sweep ladder >/dev/null
[ "$(ring_count 001)" = 3 ] || { echo "FAIL: expected re-ring count 3" >&2; exit 1; }
# 3 >= max => next sweep escalates and stops (ring-state entry removed)
run crew-sweep ladder >/dev/null
[ -e "$tmp/.agent-kit/crew/ladder/inbox/.escalated/001" ] || { echo "FAIL: no escalation marker after max attempts" >&2; exit 1; }
ring_absent 001 || { echo "FAIL: escalated record still has a ring-state entry" >&2; exit 1; }
# and it never rings again: count must not reappear
run crew-sweep ladder >/dev/null
ring_absent 001 || { echo "FAIL: escalated record re-ringed" >&2; exit 1; }
echo "ladder OK"

echo "== 2. acked record never re-rings =="
run crew-send ladder "will be acked" >/dev/null
# record 002 (001 was escalated). ack it.
run ack ladder 002 >/dev/null
[ -f "$tmp/.agent-kit/crew/ladder/inbox/handled/002.msg" ] || { echo "FAIL: ack failed" >&2; exit 1; }
ring_absent 002 || { echo "FAIL: acked record still in ring-state" >&2; exit 1; }
echo "ack-never-re-ring OK"

echo "== 3. fire-and-forget never rings =="
run crew-send --fire-and-forget ladder "fire and forget" >/dev/null
ff="$tmp/.agent-kit/crew/ladder/inbox/003.msg"
[ -f "$ff" ] || { echo "FAIL: fire-and-forget record not written" >&2; exit 1; }
grep -q '^delivery=fire-and-forget$' "$ff" || { echo "FAIL: wrong delivery mode" >&2; exit 1; }
ring_absent 003 || { echo "FAIL: fire-and-forget record entered ring-state" >&2; exit 1; }
echo "fire-and-forget OK"

echo "== 4. dead/missing target: escalate directly, no typing =="
unset AK_INBOX_RING_OK
mkcrew dead bogus-nonexistent-pane
run crew-send dead "message to a dead pane" >/dev/null
[ -e "$tmp/.agent-kit/crew/dead/inbox/.escalated/001" ] || { echo "FAIL: dead target was not escalated directly" >&2; exit 1; }
deadrs="$tmp/.agent-kit/crew/dead/inbox/.ring-state"
if [ -f "$deadrs" ] && awk -F'\t' '$1=="001"{found=1} END{exit found?0:1}' "$deadrs"; then
    echo "FAIL: dead target was typed at (ring-state present)" >&2
    exit 1
fi
echo "dead-target OK"

echo "== 5. correlation: exactly one recovery, at most one escalation =="
export AK_INBOX_RING_OK=1
mkcrew corr
run crew-send --expect-reply corr "please investigate X" >/dev/null
pdir="$tmp/.agent-kit/crew/corr/pending"
corr=$(ls "$pdir" | head -n 1)
[ -n "$corr" ] || { echo "FAIL: no pending reply record armed" >&2; exit 1; }
phase() { awk -F= '$1=="phase"{print $2; exit}' "$pdir/$corr"; }
[ "$(phase)" = waiting ] || { echo "FAIL: expected waiting phase, got $(phase)" >&2; exit 1; }

run crew-sweep corr >/dev/null
[ "$(phase)" = recovery-sent ] || { echo "FAIL: expected recovery-sent after 1st sweep, got $(phase)" >&2; exit 1; }

run crew-sweep corr >/dev/null
[ "$(phase)" = escalated ] || { echo "FAIL: expected escalated after 2nd sweep, got $(phase)" >&2; exit 1; }
[ -e "$tmp/.agent-kit/crew/corr/escalated/$corr" ] || { echo "FAIL: no correlation escalation marker" >&2; exit 1; }

# third sweep must do nothing new (never loop)
rec1=$(grep -l 'Recovery request' "$tmp/.agent-kit/crew/corr/inbox"/*.msg 2>/dev/null | wc -l | tr -d ' ')
run crew-sweep corr >/dev/null
rec2=$(grep -l 'Recovery request' "$tmp/.agent-kit/crew/corr/inbox"/*.msg 2>/dev/null | wc -l | tr -d ' ')
[ "$rec1" = 1 ] || { echo "FAIL: expected exactly 1 recovery request, got $rec1" >&2; exit 1; }
[ "$rec2" = 1 ] || { echo "FAIL: recovery request looped (now $rec2)" >&2; exit 1; }
echo "correlation-bound OK"

echo "== 6. correlated report resolves the expectation =="
mkcrew corr2
run crew-send --expect-reply corr2 "second expectation" >/dev/null
corr2=$(ls "$tmp/.agent-kit/crew/corr2/pending" | head -n 1)
run crew-report corr2 "done: found it, corr=$corr2" >/dev/null
phase2=$(awk -F= '$1=="phase"{print $2; exit}' "$tmp/.agent-kit/crew/corr2/pending/$corr2")
[ "$phase2" = resolved ] || { echo "FAIL: expected resolved, got $phase2" >&2; exit 1; }
echo "correlation-resolve OK"

echo "ladder-correlation self-test: PASS"
