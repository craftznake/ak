# Crew status panel (Pi extension)

`extensions/pi/crew-status.ts` renders a persistent, auto-updating `Crews` panel
in the Pi TUI so the primary can see, at a glance, every ak crew (worker), what
it is doing, and whether it is running — without poking each worker pane.

It is wired exactly like the other `extensions/pi/*.ts` extensions:
`install.sh` symlinks it into `~/.pi/agent/extensions/`, where Pi
auto-discovers it. (The extension also works via
`pi -e extensions/pi/crew-status.ts`.)

## What it shows

A bordered widget above the editor, one row per crew plus a dim purpose line:

```
┌─ Crews ────────────────────────────────────────────── 2 running ─┐
│ 12:21  ak-delivery-p0 (worker)                        working · 7s │
│   ↳ Make ak's handoff transport stop lying. Today both startup-… │
│ 42:45  firstmate-study (worker)                   idle (reported) · 4s │
│   ↳ Produce a precise, evidence-backed technical spec of how firstm… │
└────────────────────────────────────────────────────────────────────┘
```

- **Left:** elapsed time since the crew started (`MM:SS`, `H:MM:SS` past an
  hour), then the slug and its role (`worker`).
- **Right:** a short live status word plus how long it has been in that state
  (`4s`, `1m05s`, …). Status words: `working`, `idle`, `blocked`, `starting`
  (herdr `pending`), `done`, `gone`, `unknown`, `error`. When the lifecycle
  `state` file is `reported`, a dim `(reported)` tag is appended (a `done`
  crew is not rendered at all — see scope below).
- **Purpose line:** the one-line `# Objective` from the crew's `brief.md`,
  clipped to ~64 chars with markdown emphasis stripped. Crews with no `meta`
  (a spawn that aborted before `meta` was written) show a `no meta` note.
- **Title count:** `N running` (crews whose live status is `working`), or
  `N crews` when none are working. Crews are ordered live-first: `working`,
  `blocked`/`error`, `starting`, `idle`, `unknown`, then `done`/`gone`.

The widget is an always-visible status region — it never injects chat messages,
never steals focus, and never touches the LLM context.

## Scope: registered primary, current session, unfinished crews

The panel is the primary's supervision view, and its scoping is structural,
not a time threshold:

- **Worker sessions render nothing at all.** If the checkout's
  `.agent-kit/role` carries `role=worker` (see `docs/roles-model.md`), the
  widget never installs and the polling loop never starts.
- **Registered primary only.** A tagged (session-scoped) crew renders only
  when the current pi process *verifiably owns* the primary token: the
  token's `pi_session=` (recorded by `ak primary-set` from the registering
  session's `PI_SESSION_ID` — the same value extensions read from
  `ctx.sessionManager.getSessionId()`) must equal this process's own pi
  session id. A second pi tab in the same repo that has not run
  `ak primary-set` reads the same on-disk token but cannot prove ownership,
  so it renders none of the registered primary's crews; with nothing left to
  show, the panel renders nothing at all (no box, no note). Fail safe: a token without
  `pi_session` (written before the field existed, or from a non-pi shell) is
  owned by nobody — no tab renders its tagged crews until the primary
  re-runs `ak primary-set`.
- **Current session only.** Within the owning primary, a crew is included
  iff its meta `session_id` equals the token's `session_id=`, re-read on
  every collection tick (the primary may re-register mid-session). Crews
  from other pi sessions are no longer live, so they cannot appear — this is
  structural, not a threshold. Elapsed time, file mtime, and the `state` file
  are never used for filtering; `state` is not authoritative for liveness.
- **Legacy crews** (spawned before `session_id` was written to meta, so no
  `session_id` key) are included only while verifiably live right now: their
  herdr pane must be present **and** carry the crew's own `crew-<slug>`
  agent name (see live status below), with a status that is neither `gone`,
  `agent_not_found`, `missing`, nor `unknown`.
- **Retired crews disappear.** A crew with lifecycle `state=done` (`ak
  crew-finish` has already torn its worktree/workspace/tab down) is not
  rendered at all — a display-only filter; its records stay readable under
  `.agent-kit/crew/<slug>/`. Unretired crews stay visible: a `failed` or
  `reported` crew renders (with its honest status) until the primary
  retires it.
- **Honest dead rows.** A tagged crew whose pane died still renders with
  its real herdr status (`gone`, `idle`, `done`, …) until the primary retires
  it; `state=running` alone never resurrects a dead crew.

## Data sources (all read-only, verified by inspection)

| Data | Source |
| --- | --- |
| slug, worktree, branch, session, session_id, pane, created_at, title | `<repo>/.agent-kit/crew/<slug>/meta` (`key=value`) |
| lifecycle state, started_at, reported_at, finished_at | `<repo>/.agent-kit/crew/<slug>/state` (`key=value`) |
| purpose | `title=` key in `meta` when present (the crew spawn path writes one), falling back to the `<slug>/brief.md` `# Objective` section (mtime-keyed cache) |
| current session token | `<repo>/.agent-kit/primary` (`session_id=`, `pi_session=`), re-read on every collection tick |
| live status | `herdr agent list --session <session>` (JSON `.result.agents[]`), matched by `pane_id` + agent `name` (`crew-<slug>`) |

The live status comes from herdr (the same source `ak crew-status` /
`ak crew-audit` read via `herdr agent get <pane>`), not from the write-only
`state` file. `herdr agent list` is the batched form: one subprocess per
distinct session per poll instead of one per crew. A pane is the crew's own
only when both its `pane_id` **and** its herdr agent `name` match:
`crew_spawn` starts each crew's agent under the name `crew-<slug>`
(slugified, max 32 chars). Herdr pane ids get recycled, so a bare pane-id
match is not identity — a live pane carrying a dead crew's old id (an
unrelated tab, a nameless pane, or some other agent) renders `gone`, never a
false `idle`/`working`. A pane that is absent from the list renders `gone`;
a failed/timed-out herdr call renders `unknown` (distinct from `idle`).
Worker checkouts render nothing at all (see the
scope section above); a non-worker checkout without a local `crew/`
directory falls back to the `primary_repo` recorded in `.agent-kit/role`.
Whenever the visible crew list is empty for any reason (no crews, not the
owning primary, worker checkout, no `.agent-kit` state here), the panel
renders nothing at all — no border, no note — so an idle fleet takes zero
vertical space.

## Refresh and non-blocking behavior

- **Interval:** `AK_CREW_STATUS_INTERVAL_MS` (default **3000 ms**, min 1000).
- **Herdr timeout:** `AK_CREW_STATUS_HERDR_TIMEOUT_MS` (default **2000 ms**),
  enforced by `pi.exec(..., { timeout })`, which kills a slow/hanging herdr.
- **Tick order:** retired (`state=done`) crews are dropped first, then live
  statuses refresh, then the ownership + session-scope filter
  (see above) prunes the model, then the panel renders once — stale rows never
  flash, and untagged legacy crews are judged by fresh herdr status.
- The render path is synchronous and pure: it reads only an in-memory model and
  never does I/O or awaits. Collection runs on a `setTimeout` chain in the
  background (a `polling` flag prevents overlap); each poll does cheap
  synchronous reads of the tiny `meta`/`state`/`brief` files plus one bounded
  async herdr call per session. The panel keeps the last good model while a
  poll is in flight, so a slow herdr never stalls the UI.

## Disable switch

Set `AK_CREW_STATUS=0` (also `false`, `off`, `no`) before starting Pi to do
nothing at load. `/crew-status off` hides it at runtime; `/crew-status on`
re-enables; `/crew-status` reports the current state; `/crew-status refresh`
forces an immediate poll.
