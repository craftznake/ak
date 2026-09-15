# Delegation guard (pi extension)

`extensions/pi/delegation-guard.ts` is a mechanical nudge/escalation layer on
top of the prose-only DIRECT/DELEGATE delegation gate described in
`shared.md`, `docs/primary-agent-model.md`, and
`docs/deterministic-workflow.md`. Those docs describe the policy; this
extension is the first mechanical enforcement of it, for the pi harness only.

It does not implement or change the delegation policy itself. It only makes
the existing "classify DIRECT vs DELEGATE before non-trivial tool use" rule
harder to silently ignore inside a pi session.

## What it does

The extension counts "investigative" tool results since the last reset:

- built-in `read`, `grep`, `find`, `ls` tool calls
- `bash`/`powershell` calls whose command looks like a search/inspection
  command (`grep`, `rg`, `ag`, `find`, `ls`, `cat`, `head`, `tail`, `wc`,
  `git log|diff|show|blame`)

The counter resets to zero whenever:

- a `bash`/`powershell` call's command matches a crew-spawn shape (`ak
  crew-spawn ...` or `ak crew-spawn ...`) and did not error, or
- an assistant message contains the literal word `DIRECT` (the whitelist-reason
  language shared.md already asks the agent to state when staying DIRECT on a
  non-trivial-looking task)

Two thresholds escalate the response, both **non-blocking**:

1. **Soft threshold** (default 6): injects a steering reminder message citing
   the current count and suggesting `ak crew-spawn` or a stated DIRECT
   justification. Repeats every `soft` calls past the first crossing.
2. **Hard threshold** (default 12, or `2x soft` if configured lower than
   soft): in TUI/RPC mode, shows `ctx.ui.confirm(...)` asking whether to keep
   going DIRECT or delegate now, and reflects the answer back into the
   session as a steering message so the agent has an explicit instruction to
   act on. In print/JSON mode (no UI), it falls back to a stronger reminder
   message instead of a dialog, since there is nothing to confirm against.

At no point does it call `{ block: true }` on a `tool_call`, so a real tool
call is never rejected. A legitimately-DIRECT multi-step task only sees
reminder text, never a hard stop, unless the user actively picks "delegate"
in the hard-threshold confirm dialog.

A footer status (`delegation-guard`) shows the running count once it is
nonzero: `delegation-gate: <n>/<hard threshold>`.

## Configuration

Environment variables, read once at extension load:

| Variable | Default | Meaning |
|---|---|---|
| `AK_DELEGATION_GUARD` | unset (enabled) | Set to `0` to fully disable; the extension becomes a no-op and registers nothing. |
| `AK_DELEGATION_GUARD_SOFT_THRESHOLD` | `6` | Investigative-call count that triggers the first (and each subsequent) soft reminder. |
| `AK_DELEGATION_GUARD_HARD_THRESHOLD` | `12` | Investigative-call count that triggers the hard confirm/strong-reminder escalation. Must exceed the soft threshold; if configured `<=` soft, it is coerced to `2x soft`. |

There is no `.agent-kit/` config file for this extension; env vars were
chosen to match the rest of this repo's convention (`ak`'s
`AK_CREW_COMMAND`, `AK_NO_NOTIFY`, etc.) and to make it trivial to override
per-invocation (`AK_DELEGATION_GUARD_SOFT_THRESHOLD=3 pi`) without editing
files.

## Disabling

```sh
AK_DELEGATION_GUARD=0 pi
```

or export it in your shell profile to disable globally. The extension is
also easy to remove entirely: delete the symlink installed by `install.sh`
at `~/.pi/agent/extensions/delegation-guard.ts` (or the source file if
installed manually).

## Commands

- `/delegation-guard` — show the current count and next threshold values.
- `/delegation-guard reset` — manually zero the counters (useful if you know
  you are about to delegate and don't want a stale reminder mid-turn).

## Known limitations

- **State does not survive session replacement.** Counters live in extension
  closure state, reset on `session_start` (covers `/new`, `/resume`, `/fork`,
  `/reload`, and process start). They are not reconstructed from session
  history, so a resumed session that was already deep into investigation
  starts back at zero. Reconstructing from `ctx.sessionManager.getBranch()`
  on `session_start` was considered but skipped for this iteration to keep
  the implementation small; it is a reasonable follow-up if reload-time
  resets prove disruptive in practice.
- **Heuristic-based investigative detection.** The `bash`/`powershell`
  command regex is intentionally conservative-ish but will both under- and
  over-count: `git grep`, custom scripts that pipe through `awk`, or
  editor-in-a-loop patterns are not currently counted; on the other side, a
  single `grep` used for a genuinely tiny/DIRECT task still counts toward
  the total, which is why the soft threshold is a reminder and never a
  block.
- **DIRECT-detection is a bare substring match** on the assistant's own
  text (`\bDIRECT\b`). An assistant could reset the counter by saying the
  word "DIRECT" without a real whitelist justification. This mirrors the
  existing honor-system nature of the prose gate; the guard's job is to
  surface the reminder, not to grade the justification text.
- **Hard-threshold dialog only appears with UI.** `-p` (print mode) and
  `--mode json` runs cannot show `ctx.ui.confirm(...)`, so the hard
  threshold falls back to another steering message there. This was verified
  directly (see below); it is a deliberate mode-behavior choice, not an
  oversight — the extensions.md docs are explicit that `ctx.hasUI` is
  `false` in those modes.

## What was verified vs. reasoned about

Verified directly against a real `pi --mode json -p` session with
`extensions.md`-documented events (`tool_result`, `message_end`,
`session_start`), using low thresholds (`AK_DELEGATION_GUARD_SOFT_THRESHOLD=1`,
`AK_DELEGATION_GUARD_HARD_THRESHOLD=3`) and prompts that forced a sequence of
`grep`/`find` bash calls:

- extension loads cleanly under `pi -e ./extensions/pi/delegation-guard.ts`
  with no startup errors
- soft-threshold reminder fires as a `role: "custom"` message after crossing
  the count, repeats on subsequent crossings
- hard-threshold message fires (fallback text, since `-p`/JSON mode has no
  UI) after crossing the hard count
- a `bash` call matching `ak crew-spawn ...` resets the counter to zero,
  confirmed by a following investigative call re-triggering the soft
  reminder at count 1 instead of continuing to climb
- an assistant message containing the word `DIRECT` also resets the counter
  to zero, confirmed the same way

**Not verified end-to-end** (reasoned about from the extensions.md docs and
type declarations only, not exercised live):

- the `ctx.ui.confirm(...)` hard-threshold dialog path and its steering
  message, since driving that requires an interactive TUI session with a
  human (or scripted terminal input) answering the dialog — not practical to
  simulate headlessly in this pass
- behavior across `/reload`, `/resume`, and `/fork` (the `session_start`
  reset path) — reasoned from the documented event lifecycle, not run
  through those flows live in this session
- interaction with pi's parallel tool execution mode when several
  investigative tool calls in one assistant turn finish out of order; the
  `tool_result` handler increments a plain closure variable per event, which
  should be safe under Node's single-threaded event loop, but was not
  stress-tested with genuinely concurrent sibling tool calls

## Feasibility for other harnesses (not implemented)

This pass only targets pi, per the crew brief. Rough translation notes for
future work, not implemented here:

- **opencode**: opencode's plugin/permission model would need a similar
  tool-call interception point to count investigative calls and inject a
  system/user-visible reminder message. Its extension surface differs
  enough from pi's `pi.on("tool_result", ...)` + `pi.sendMessage(...)` API
  that this would be a separate implementation, not a port.
- **claude (Claude Code)**: Claude Code's hook system (`PreToolUse`/
  `PostToolUse` style hooks) could plausibly implement the same counting and
  reminder-injection idea, but its hook payloads and message-injection
  mechanics are different from pi's extension events and would need their
  own design pass.

Both are noted as plausible, not scoped or attempted in this crew's work.
