// crew-status: renders a persistent, auto-updating "Crews" panel in the pi TUI
// showing every ak crew (worker) with its purpose and live status, so the
// primary never has to poke each worker pane to see whether it is running.
//
// Data sources (all read-only, verified against live files):
//   <repo>/.agent-kit/crew/<slug>/meta        key=value: slug, worktree, branch,
//                                             herdr_session, herdr_pane, command,
//                                             created_at, brief, ...
//   <repo>/.agent-kit/crew/<slug>/state       key=value: state=running|reported|done,
//                                             started_at, reported_at, finished_at
//   <repo>/.agent-kit/crew/<slug>/brief.md    "# Objective" section -> one-line purpose
//   herdr agent list --session <session>      live agent_status per pane (JSON)
//
// The live status comes from herdr (`herdr agent list`, one subprocess per
// distinct session per poll) rather than the write-only `state` file, matching
// what `ak crew-status`/`ak crew-audit` show. `herdr agent get <pane> --session
// <session>` returns the same `.result.agent.agent_status`; `agent list` is the
// batched form and lets us tell "pane gone" (absent from the list) apart from
// "backend unavailable" (the whole call failed/timed out).
//
// Non-blocking: the render path (`render(width)`) is synchronous and reads only
// the in-memory model. Data collection runs on a setTimeout chain in the
// background and only ever touches tiny files synchronously plus a bounded
// `herdr` subprocess via `pi.exec(..., { timeout })`; a slow/hanging herdr is
// killed by the timeout and the panel keeps the last good model. Status is
// refreshed every AK_CREW_STATUS_INTERVAL_MS (default 3000ms).
//
//
// Scope: primary sessions only, and only the current session's crews. A
// worker checkout (.agent-kit/role with role=worker) renders nothing at all
// and never starts the polling loop. In a primary session a crew is included
// iff its meta session_id equals the current session token from
// .agent-kit/primary; a legacy crew with no session_id in meta is included
// only while actually live. Crews from other pi sessions are no longer live,
// so they cannot appear — this is structural, not a threshold (no
// elapsed-time/mtime/state filtering).
//
// Disable: AK_CREW_STATUS=0 (also "false"/"off"/"no") disables at load; the
// /crew-status on|off command toggles at runtime.

import type { ExtensionAPI, ExtensionContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import * as fs from "node:fs";
import * as path from "node:path";

const WIDGET_KEY = "crew-status";

interface CrewRow {
    slug: string;
    role: string;
    worktree?: string;
    branch?: string;
    session?: string; // herdr session name (meta herdr_session)
    sessionId?: string; // pi session token (meta session_id)
    pane?: string;
    command?: string;
    createdAtMs?: number;
    startedAtMs?: number;
    lifecycleState?: string;
    reportedAtMs?: number;
    finishedAtMs?: number;
    hasMeta: boolean;
    purpose?: string;
    liveStatus: string;
    statusSinceMs: number;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function isDisabled(raw: string | undefined): boolean {
    if (!raw) return false;
    const v = raw.trim().toLowerCase();
    return v === "0" || v === "false" || v === "off" || v === "no";
}

function positiveInt(raw: string | undefined, fallback: number, min: number): number {
    if (!raw) return fallback;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, n);
}

// ---------------------------------------------------------------------------
// Pure parsing / formatting helpers (exported for testability)
// ---------------------------------------------------------------------------

export function parseKeyValue(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of text.split("\n")) {
        const eq = line.indexOf("=");
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        const value = line.slice(eq + 1).trim();
        if (key) out[key] = value;
    }
    return out;
}

function readKeyValueFile(file: string): Record<string, string> {
    try {
        return parseKeyValue(fs.readFileSync(file, "utf8"));
    } catch {
        return {};
    }
}

// ---------------------------------------------------------------------------
// Session scoping (current session only) + worker suppression
// ---------------------------------------------------------------------------

/** Current session token from `.agent-kit/primary` (key `session_id=`).
 *
 * Read fresh on every collection tick — the primary may re-register
 * mid-session and the token changes, so it is never cached for the process
 * lifetime. */
function readPrimarySessionId(root: string): string | undefined {
    return readKeyValueFile(path.join(root, ".agent-kit", "primary")).session_id || undefined;
}

/** A worker checkout is one whose `.agent-kit/role` carries `role=worker`
 * (see docs/roles-model.md). The panel is the primary's supervision view, so
 * worker sessions render nothing at all and never start the polling loop. */
function isWorkerCheckout(root: string | undefined): boolean {
    if (!root) return false;
    return readKeyValueFile(path.join(root, ".agent-kit", "role")).role === "worker";
}

// Include a crew iff its meta `session_id` equals the current session token
// from `.agent-kit/primary`: crews from other pi sessions are no longer live,
// so they cannot appear — this is structural, not a threshold. (No
// elapsed-time/mtime filtering; the `state` file is not authoritative for
// liveness.) A legacy crew with no `session_id` in meta is included only if it
// is live right now: its herdr agent status is neither gone, agent_not_found,
// missing, nor unknown.
const NON_LIVE_STATUSES: ReadonlySet<string> = new Set(["gone", "agent_not_found", "missing", "unknown"]);

function isLiveStatus(status: string): boolean {
    return !NON_LIVE_STATUSES.has(status);
}

function isCrewVisible(crew: CrewRow, currentSessionId: string | undefined): boolean {
    if (crew.sessionId) {
        return currentSessionId !== undefined && crew.sessionId === currentSessionId;
    }
    // Legacy untagged crew (spawned before session_id was written to meta):
    // visible only while actually live right now.
    return isLiveStatus(crew.liveStatus);
}

export function findRoot(start: string): string | undefined {
    let dir = start;
    for (let i = 0; i < 64; i++) {
        if (
            fs.existsSync(path.join(dir, ".agent-kit")) ||
            fs.existsSync(path.join(dir, ".git")) ||
            fs.existsSync(path.join(dir, ".jj"))
        ) {
            return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return undefined;
}

function parseIsoMs(value: string | undefined): number | undefined {
    if (!value) return undefined;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : undefined;
}

function pad2(n: number): string {
    return n < 10 ? `0${n}` : String(n);
}

/** Elapsed time since the crew started: `MM:SS`, or `H:MM:SS` past an hour. */
export function formatElapsed(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) ms = 0;
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}:${pad2(m)}:${pad2(s)}`;
    return `${pad2(m)}:${pad2(s)}`;
}

/** Time in the current state, compactly: `4s`, `1m05s`, then `MM:SS`. */
export function formatAge(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) ms = 0;
    const totalSec = Math.floor(ms / 1000);
    if (totalSec < 60) return `${totalSec}s`;
    if (totalSec < 3600) {
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        return `${m}m${pad2(s)}s`;
    }
    return formatElapsed(ms);
}

/** Extract the one-line purpose from a brief.md "# Objective" section. */
export function extractObjective(text: string): string | undefined {
    const lines = text.split("\n");
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
        const t = lines[i]!.trim();
        if (t === "# Objective" || t === "## Objective") {
            idx = i;
            break;
        }
    }
    if (idx === -1) return undefined;
    const collected: string[] = [];
    for (let i = idx + 1; i < lines.length; i++) {
        const t = lines[i]!.trim();
        if (t === "") {
            if (collected.length > 0) break;
            continue;
        }
        if (t.startsWith("#")) break;
        collected.push(t);
    }
    if (collected.length === 0) return undefined;
    return collected.join(" ").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Crew data reading (read-only)
// ---------------------------------------------------------------------------

export function listCrewDirs(root: string): string[] {
    const crewBase = path.join(root, ".agent-kit", "crew");
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(crewBase, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries
        .filter((e) => e.isDirectory())
        .map((e) => path.join(crewBase, e.name))
        .sort();
}

// Purpose cache keyed on the brief's mtime so we don't re-parse on every tick.
interface PurposeCacheEntry {
    mtimeMs: number;
    purpose: string | undefined;
}
const purposeCache = new Map<string, PurposeCacheEntry>();

function readPurpose(briefPath: string | undefined, crewDir: string): string | undefined {
    const p = briefPath && briefPath.trim() ? briefPath : path.join(crewDir, "brief.md");
    let mtimeMs = 0;
    try {
        mtimeMs = fs.statSync(p).mtimeMs;
    } catch {
        return undefined;
    }
    const cached = purposeCache.get(p);
    if (cached && cached.mtimeMs === mtimeMs) return cached.purpose;
    let purpose: string | undefined;
    try {
        purpose = extractObjective(fs.readFileSync(p, "utf8"));
    } catch {
        purpose = undefined;
    }
    purposeCache.set(p, { mtimeMs, purpose });
    return purpose;
}

export function readCrew(dir: string): CrewRow {
    const slug = path.basename(dir);
    const metaPath = path.join(dir, "meta");
    const hasMeta = fs.existsSync(metaPath);
    const meta = readKeyValueFile(metaPath);
    const state = readKeyValueFile(path.join(dir, "state"));

    const purposeFromMeta = meta.title ?? meta.purpose;
    const purpose = purposeFromMeta !== undefined && purposeFromMeta !== ""
        ? purposeFromMeta
        : readPurpose(meta.brief, dir);

    const createdAtMs = parseIsoMs(meta.created_at);
    const startedAtMs = parseIsoMs(state.started_at) ?? createdAtMs;
    const reportedAtMs = parseIsoMs(state.reported_at);
    const finishedAtMs = parseIsoMs(state.finished_at);

    return {
        slug,
        role: "worker", // ak crews are always workers (crew_spawn writes role=worker)
        worktree: meta.worktree || undefined,
        branch: meta.branch || undefined,
        session: meta.herdr_session || undefined,
        sessionId: meta.session_id || undefined,
        pane: meta.herdr_pane || undefined,
        command: meta.command || undefined,
        createdAtMs,
        startedAtMs,
        lifecycleState: state.state || undefined,
        reportedAtMs,
        finishedAtMs,
        hasMeta,
        purpose: purpose || undefined,
        liveStatus: "unknown",
        statusSinceMs: Date.now(),
    };
}

// In a worker worktree the local .agent-kit has no crew/ directory; fall back
// to the primary repo recorded in the worker role marker so workers also see
// the full crew set.
function resolveCrewRoot(foundRoot: string | undefined): string | undefined {
    if (!foundRoot) return undefined;
    if (fs.existsSync(path.join(foundRoot, ".agent-kit", "crew"))) return foundRoot;
    const role = readKeyValueFile(path.join(foundRoot, ".agent-kit", "role"));
    const primaryRepo = role.primary_repo;
    if (primaryRepo && fs.existsSync(path.join(primaryRepo, ".agent-kit", "crew"))) {
        return primaryRepo;
    }
    return foundRoot;
}

// ---------------------------------------------------------------------------
// Live status via herdr
// ---------------------------------------------------------------------------

async function queryAgents(pi: ExtensionAPI, session: string, timeoutMs: number): Promise<Map<string, string> | undefined> {
    try {
        const result = await pi.exec("herdr", ["agent", "list", "--session", session], { timeout: timeoutMs });
        if (result.code !== 0) return undefined;
        const parsed = JSON.parse(result.stdout) as {
            result?: { agents?: Array<{ pane_id?: unknown; agent_status?: unknown }> };
        };
        const agents = parsed?.result?.agents;
        if (!Array.isArray(agents)) return undefined;
        const map = new Map<string, string>();
        for (const a of agents) {
            const pane = a?.pane_id;
            const status = a?.agent_status;
            if (typeof pane === "string" && typeof status === "string") map.set(pane, status);
        }
        return map;
    } catch {
        return undefined;
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const STATUS_WORD: Record<string, string> = {
    working: "working",
    idle: "idle",
    blocked: "blocked",
    pending: "starting",
    done: "done",
    gone: "gone",
    unknown: "unknown",
    error: "error",
};

const STATUS_COLOR: Record<string, ThemeColor> = {
    working: "success",
    idle: "muted",
    blocked: "warning",
    pending: "dim",
    done: "dim",
    gone: "dim",
    unknown: "warning",
    error: "warning",
};

function statusWordFor(status: string): string {
    return STATUS_WORD[status] ?? status;
}

function statusColorFor(status: string): ThemeColor {
    return STATUS_COLOR[status] ?? "muted";
}

/** Strip markdown emphasis and clip a purpose to a compact one-liner. */
function clipPurpose(text: string, max = 64): string {
    const t = text.replace(/\*\*/g, "").replace(/`/g, "").replace(/\s+/g, " ").trim();
    if (t.length <= max) return t;
    return t.slice(0, max - 1).trimEnd() + "…";
}

/** Fit `left` and `right` between two edge glyphs, filling the gap with `fill`. */
function frameLine(width: number, left: string, right: string, leftEdge: string, rightEdge: string, fill: string): string {
    const inner = Math.max(0, width - 2);
    let l = left;
    let r = right;
    while (visibleWidth(l) + visibleWidth(r) > inner && visibleWidth(r) > 0) {
        r = truncateToWidth(r, Math.max(0, visibleWidth(r) - 1), "");
    }
    while (visibleWidth(l) + visibleWidth(r) > inner && visibleWidth(l) > 0) {
        l = truncateToWidth(l, Math.max(0, visibleWidth(l) - 1), "");
    }
    const gap = Math.max(0, inner - visibleWidth(l) - visibleWidth(r));
    return leftEdge + l + fill.repeat(gap) + r + rightEdge;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function crewStatus(pi: ExtensionAPI) {
    const enabledByEnv = !isDisabled(process.env.AK_CREW_STATUS);
    const intervalMs = positiveInt(process.env.AK_CREW_STATUS_INTERVAL_MS, 3000, 1000);
    const herdrTimeoutMs = positiveInt(process.env.AK_CREW_STATUS_HERDR_TIMEOUT_MS, 2000, 250);

    let enabled = enabledByEnv;
    let running = false; // true only while a TUI session owns the widget/timer
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polling = false;
    let requestRender: (() => void) | undefined;
    let latestCtx: ExtensionContext | undefined;
    let currentTheme: Theme | undefined;
    let root: string | undefined;
    let widgetInstalled = false;

    const model = new Map<string, CrewRow>();

    function stopTimer() {
        if (timer) {
            clearTimeout(timer);
            timer = undefined;
        }
    }

    function teardown(ctx?: ExtensionContext) {
        running = false;
        stopTimer();
        polling = false;
        requestRender = undefined;
        widgetInstalled = false;
        model.clear();
        if (ctx?.hasUI) ctx.ui.setWidget(WIDGET_KEY, undefined);
    }

    function setStatus(crew: CrewRow, next: string) {
        if (next !== crew.liveStatus) {
            crew.liveStatus = next;
            crew.statusSinceMs = Date.now();
        }
    }

    function themeNow(): Theme | undefined {
        return latestCtx?.ui.theme ?? currentTheme;
    }

    function style(plain: string, fn: (t: Theme) => string): string {
        const t = themeNow();
        if (!t) return plain;
        try {
            return fn(t);
        } catch {
            return plain;
        }
    }

    function renderPanel(width: number): string[] {
        if (width <= 2) return [];

        const statusPriority: Record<string, number> = { working: 0, blocked: 1, error: 1, pending: 2, idle: 3, unknown: 4, done: 5, gone: 6 };
        const priority = (c: CrewRow) => statusPriority[c.liveStatus] ?? 4;
        const crews = [...model.values()].sort(
            (a, b) =>
                priority(a) - priority(b) ||
                (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0) ||
                a.slug.localeCompare(b.slug),
        );

        if (crews.length === 0) {
            const title = style("Crews", (t) => t.fg("accent", t.bold ? t.bold("Crews") : "Crews"));
            const noteText = root ? "no crews" : "no .agent-kit state found here";
            const note = style(noteText, (t) => t.fg("muted", noteText));
            return [
                frameLine(width, "─ " + title + " ", " ─", "┌", "┐", "─"),
                frameLine(width, "  " + note, "", "│", "│", " "),
                frameLine(width, "─", "─", "└", "┘", "─"),
            ];
        }

        const now = Date.now();
        const working = crews.filter((c) => c.liveStatus === "working").length;
        const title = style("Crews", (t) => t.fg("accent", t.bold ? t.bold("Crews") : "Crews"));
        const count = working > 0 ? `${working} running` : `${crews.length} crew${crews.length === 1 ? "" : "s"}`;
        const countStyled = style(count, (t) => t.fg("muted", count));

        const lines: string[] = [frameLine(width, "─ " + title + " ", " " + countStyled + " ─", "┌", "┐", "─")];

        for (const c of crews) {
            const elapsed = formatElapsed(now - (c.startedAtMs ?? now));
            const age = formatAge(now - c.statusSinceMs);

            const left =
                " " +
                style(elapsed, (t) => t.fg("dim", elapsed)) +
                "  " +
                style(c.slug, (t) => t.fg("text", c.slug)) +
                " " +
                style(`(${c.role})`, (t) => t.fg("muted", `(${c.role})`));

            const statusWord = statusWordFor(c.liveStatus);
            const statusStyled = style(statusWord, (t) => t.fg(statusColorFor(c.liveStatus), statusWord));
            const tag =
                c.lifecycleState === "reported" || c.lifecycleState === "done"
                    ? " " + style(`(${c.lifecycleState})`, (t) => t.fg("dim", `(${c.lifecycleState})`))
                    : "";
            const right = `${statusStyled}${tag} ` + style(`· ${age}`, (t) => t.fg("dim", `· ${age}`)) + " ";

            lines.push(frameLine(width, left, right, "│", "│", " "));

            if (c.purpose) {
                const purposeText = clipPurpose(c.purpose);
                const p = style(`↳ ${purposeText}`, (t) => t.fg("dim", `↳ ${purposeText}`));
                lines.push(frameLine(width, "   " + p, "", "│", "│", " "));
            }
            if (!c.hasMeta) {
                const note = style("no meta (spawn may have aborted)", (t) =>
                    t.fg("warning", "no meta (spawn may have aborted)"),
                );
                lines.push(frameLine(width, "   " + note, "", "│", "│", " "));
            }
        }

        lines.push(frameLine(width, "─", "─", "└", "┘", "─"));
        return lines;
    }

    function syncModel(dirs: string[]) {
        const seen = new Set<string>();
        for (const dir of dirs) {
            const crew = readCrew(dir);
            seen.add(crew.slug);
            const prev = model.get(crew.slug);
            if (prev) {
                // Preserve live status and its age across polls; file-derived
                // fields are refreshed below.
                crew.liveStatus = prev.liveStatus;
                crew.statusSinceMs = prev.statusSinceMs;
            }
            model.set(crew.slug, crew);
        }
        for (const slug of [...model.keys()]) {
            if (!seen.has(slug)) model.delete(slug);
        }
    }

    async function refreshLiveStatuses(): Promise<void> {
        const bySession = new Map<string, CrewRow[]>();
        for (const crew of model.values()) {
            if (!crew.session || !crew.pane) continue;
            const list = bySession.get(crew.session);
            if (list) list.push(crew);
            else bySession.set(crew.session, [crew]);
        }
        for (const [session, crews] of bySession) {
            const agents = await queryAgents(pi, session, herdrTimeoutMs);
            for (const crew of crews) {
                const next = agents === undefined ? "unknown" : (agents.get(crew.pane!) ?? "gone");
                setStatus(crew, next);
            }
        }
    }

    async function tick() {
        if (!running || !enabled || polling) return;
        polling = true;
        try {
            const found = root ?? findRoot(latestCtx?.cwd ?? process.cwd());
            root = resolveCrewRoot(found);
            const dirs = root ? listCrewDirs(root) : [];
            syncModel(dirs);
            // Live statuses first: the session-scope filter below judges
            // untagged legacy crews by their live herdr status, so it must run
            // after the refresh. Render once, only after scoping, so stale
            // rows never flash.
            await refreshLiveStatuses();
            const currentSessionId = root ? readPrimarySessionId(root) : undefined;
            for (const [slug, crew] of [...model]) {
                if (!isCrewVisible(crew, currentSessionId)) model.delete(slug);
            }
            requestRender?.();
        } catch {
            // Keep the last good model; never let a poll error blank the panel.
        } finally {
            polling = false;
            schedule(intervalMs);
        }
    }

    function schedule(delay: number) {
        if (!running || !enabled) return;
        stopTimer();
        timer = setTimeout(() => void tick(), delay);
    }

    function setup(ctx: ExtensionContext) {
        latestCtx = ctx;
        if (!enabled || ctx.mode !== "tui" || widgetInstalled) return;
        // Primary sessions only: a worker checkout (.agent-kit/role with
        // role=worker) renders nothing at all and never starts polling.
        const found = findRoot(ctx.cwd);
        if (isWorkerCheckout(found)) return;
        root = resolveCrewRoot(found);
        ctx.ui.setWidget(WIDGET_KEY, (tui, theme) => {
            currentTheme = theme;
            requestRender = () => tui.requestRender();
            return {
                render: (width: number) => renderPanel(width),
                invalidate() {
                    // Recompute themed strings on the next render.
                },
                dispose() {
                    running = false;
                    stopTimer();
                    requestRender = undefined;
                },
            };
        });
        widgetInstalled = true;
        running = true;
        schedule(0);
    }

    pi.on("session_start", (_event, ctx) => setup(ctx));
    pi.on("session_shutdown", (_event, ctx) => teardown(ctx));

    pi.registerCommand("crew-status", {
        description:
            "Show or toggle the ak crew status panel (usage: /crew-status [on|off|refresh])",
        handler: async (args, ctx) => {
            const arg = args.trim().toLowerCase();
            if (arg === "on") {
                enabled = true;
                setup(ctx);
                if (isWorkerCheckout(findRoot(ctx.cwd))) {
                    ctx.ui.notify("crew status panel stays hidden in worker sessions", "info");
                } else {
                    ctx.ui.notify("crew status panel enabled", "info");
                }
                return;
            }
            if (arg === "off") {
                enabled = false;
                teardown(ctx);
                ctx.ui.notify("crew status panel hidden", "info");
                return;
            }
            if (arg === "refresh") {
                requestRender?.();
                void tick();
                return;
            }
            const n = model.size;
            const working = [...model.values()].filter((c) => c.liveStatus === "working").length;
            ctx.ui.notify(
                `crew-status ${enabled ? "enabled" : "disabled"}; ${n} crew${n === 1 ? "" : "s"} (${working} working); ` +
                    `root=${root ?? "none"}; interval=${intervalMs}ms`,
                "info",
            );
        },
    });
}
