# Crew status panel (Pi extension)

`extensions/pi/crew-status.ts` renders a persistent, auto-updating `Crews` panel
in the Pi TUI so the primary can see, at a glance, every ak crew (worker), what
it is doing, and whether it is running — without poking each worker pane.

It is wired exactly like `ak-phase-status.ts`: `install.sh` symlinks it into
`~/.pi/agent/extensions/`, where Pi auto-discovers it. (A future `install.sh`
run should add the same one-line symlink for `crew-status.ts`; the extension
also works via `pi -e extensions/pi/crew-status.ts`.)

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
  `state` file is `reported` or `done`, a dim `(reported)`/`(done)` tag is
  appended.
- **Purpose line:** the one-line `# Objective` from the crew's `brief.md`,
  clipped to ~64 chars with markdown emphasis stripped. Crews with no `meta`
  (a spawn that aborted before `meta` was written) show a `no meta` note.
- **Title count:** `N running` (crews whose live status is `working`), or
  `N crews` when none are working. Crews are ordered live-first: `working`,
  `blocked`/`error`, `starting`, `idle`, `unknown`, then `done`/`gone`.

The widget is an always-visible status region — it never injects chat messages,
never steals focus, and never touches the LLM context.

## Data sources (all read-only, verified by inspection)

| Data | Source |
| --- | --- |
| slug, worktree, branch, session, pane, created_at | `<repo>/.agent-kit/crew/<slug>/meta` (`key=value`) |
| lifecycle state, started_at, reported_at, finished_at | `<repo>/.agent-kit/crew/<slug>/state` (`key=value`) |
| purpose | `<slug>/brief.md` `# Objective` section (mtime-keyed cache); a `title=`/`purpose=` key in `meta` wins if present (none exists today) |
| live status | `herdr agent list --session <session>` (JSON `.result.agents[]`), matched by `pane_id` |

The live status comes from herdr (the same source `ak crew-status` /
`ak crew-audit` read via `herdr agent get <pane>`), not from the write-only
`state` file. `herdr agent list` is the batched form: one subprocess per
distinct session per poll instead of one per crew. A pane that is absent from
the list renders `gone`; a failed/timed-out herdr call renders `unknown`
(distinct from `idle`). In a worker worktree the local `.agent-kit` has no
`crew/` directory, so the panel falls back to the `primary_repo` recorded in
the worker role marker; otherwise it says `no crews`.

## Refresh and non-blocking behavior

- **Interval:** `AK_CREW_STATUS_INTERVAL_MS` (default **3000 ms**, min 1000).
- **Herdr timeout:** `AK_CREW_STATUS_HERDR_TIMEOUT_MS` (default **2000 ms**),
  enforced by `pi.exec(..., { timeout })`, which kills a slow/hanging herdr.
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
