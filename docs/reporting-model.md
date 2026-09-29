# Push reporting model

Crew reporting is push-first, not poll-first.

## Setup

Run this once from the primary agent's Herdr tab:

```sh
ak primary-set
```

This records the primary Herdr target in `.agent-kit/primary`. By default crew reports wake the primary by sending the report message into the registered agent/pane. This avoids a blocking wait loop while still letting crews trigger the next primary-agent turn. `primary-set` validates explicit Herdr targets and refuses known crew slugs/panes so a crew cannot accidentally register itself as the primary.

If you want inbox/notification-only behavior, opt out:

```sh
ak primary-set --notify-only
```

`--allow-inject` is still accepted for older habits, but wakeup is now the default.

Inspect it with:

```sh
ak primary-show
```

## Crew handback

When a crew is ready to hand back, the preferred command — runnable from inside the worker's own worktree — is:

```sh
ak done <<'AK_MESSAGE'
summary, changed files, checks, blockers
AK_MESSAGE
```

`ak done` resolves the crew slug and primary target from the worker role marker (`.agent-kit/role`), writes the report against the primary repo, appends the shared chat transcript, and wakes the primary. Use the same quoted-heredoc form with `ak reply` for a mid-task question/status that wakes the primary without ending the task, and `ak chat` to read the transcript. `ak done` and `ak reply` also read stdin when called without arguments or with a single `-`. Prefer stdin for arbitrary text: inline double-quoted shell arguments execute backticks and `$(...)` before `ak` receives them.

The equivalent primary-repo-rooted command (used by older crews, or when running from the primary repo) is:

```sh
ak crew-report <slug> <message text...>
```

This is the primary-root form; worker-side handback should use `ak done` with stdin as shown above.

Both go through the same core. That command:

- writes `.agent-kit/crew/<slug>/report.md` (with a unique report id)
- appends `.agent-kit/inbox/<timestamp>-<id>-<slug>.md` (unique, never overwritten)
- transitions the authoritative lifecycle state `running -> reported` (idempotent for repeated reports; a `done` or `failed` crew rejects the report)
- shows a Herdr notification when available (`AK_NO_NOTIFY=1` disables it)
- wakes the registered primary agent by sending the framed summary into its Herdr target (`AK_NO_WAKE=1` disables this per command)

The wake is built on commands that exist in herdr 0.7.3. It probes the target's agent status first; where an agent surface is available it submits the summary via `herdr agent send <target> <message>` (literal text honoring the pane's bracketed-paste mode) plus an explicit `pane send-keys <target> enter`, then confirms acceptance by waiting for the agent to enter the `working` state with `herdr agent wait <target> --status working --timeout <AK_WAKE_ACCEPT_TIMEOUT>` (default 8000ms). A plain non-agent shell pane falls back to raw `pane send-text` + Enter, and that fallback is logged (no agent to confirm against).

A wake is no longer fire-and-forget. `ak done` / `ak reply` / `crew-report` report a failed wake on stderr, exit non-zero, and record a single authoritative `undelivered_at=<ts>` in `.agent-kit/crew/<slug>/state` (last-wins, never duplicated) so the primary can discover the miss without watching stderr. The durable artifacts (`report.md`, inbox, `chat.log`, `state`) are always written **before** the wake is attempted, so a lost wake never loses a report. Two distinct failure messages are kept separate: "no agent registered at target" (no agent surface; raw fallback engaged and the pane send failed) and "submitted but not confirmed accepted" (the text and Enter reached the pane but the agent did not enter `working` within `AK_WAKE_ACCEPT_TIMEOUT`). Worker-authored text is flattened to one line and prefixed `[crew <slug>]` before it reaches the primary, so it can never masquerade as a user turn.

`AK_NO_WAKE=1` disables the wake for `ak done` / `ak reply` / `crew-report`; the artifacts are still written and those commands still exit 0. `AK_NO_NOTIFY=1` disables the Herdr notification.

A mid-task note that must not end the crew is recorded with `ak crew-report --note <slug> "..."`: it appends to the crew `notes.md` and the chat transcript without flipping lifecycle state or waking the primary.

If no primary is registered, the command still writes the report and inbox entry and exits 0; there is simply no wake to attempt.

## Cleanup remains separate

Reporting does not clean up the worktree. The primary still reviews and then runs:

```sh
ak crew-finish <slug>
```

`crew-finish` refuses dirty worktrees, preserving safety.
