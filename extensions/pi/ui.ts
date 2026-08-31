/**
 * ui: recreates the "breadcrumb footer + vim-style mode badge" look
 * requested from a reference screenshot (path > branch > model > thinking >
 * context gauge, plus a second usage/quota line, and a NORMAL/INSERT badge
 * on the editor's bottom border).
 *
 * Two independent pieces, each toggleable:
 *
 * 1. Custom footer (`/statusline [on|off]`) - ON by default. Purely
 *    cosmetic, safe to leave on:
 *      line 1: cwd > git branch (+ dirty marker) > model > thinking level >
 *              context-window gauge/percent/tokens
 *      line 2: provider usage/quota gauges (e.g. "5h" / "Week" windows),
 *              best-effort - only appears once the provider actually sends
 *              rate-limit-style response headers we can parse (see
 *              `parseUsageWindows` below). Anthropic subscription accounts
 *              are the most likely source of this; most API-key providers
 *              won't send anything usable, in which case the line is simply
 *              omitted. Use `/statusline headers` to inspect what was
 *              captured, and `/statusline demo` to preview the line with
 *              fake numbers.
 *
 * 2. Vim-style modal editor with a mode badge (`/vim-mode [on|off]`) - OFF
 *    by default because it changes how typing works (you must press `i` to
 *    enter insert mode before typing, `Escape` to go back to normal mode).
 *    Turn it on if you actually want the modal-editing behavior shown in the
 *    screenshot; otherwise leave it off and just enjoy the footer.
 */

import type { ExtensionAPI, ExtensionContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Small formatting helpers
// ---------------------------------------------------------------------------

function homeRelative(p: string): string {
    const home = os.homedir();
    if (p === home) return "~";
    if (p.startsWith(home + path.sep)) return `~${p.slice(home.length)}`;
    return p;
}

function trimNum(v: number): string {
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function fmtTokens(n: number): string {
    if (n >= 1_000_000) return `${trimNum(n / 1_000_000)}M`;
    if (n >= 1_000) return `${trimNum(n / 1_000)}k`;
    return `${n}`;
}

function fmtDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return "0m";
    const totalMin = Math.round(ms / 60_000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h > 0) return m > 0 ? `${h}h${m}m` : `${h}h`;
    return `${m}m`;
}

/** Render a horizontal gauge: filled portion in `filledColor`, rest dim. */
function gauge(percent: number | null, width: number, theme: Theme, filledColor: ThemeColor = "accent"): string {
    const w = Math.max(1, width);
    if (percent == null) return theme.fg("dim", "─".repeat(w));
    const clamped = Math.min(100, Math.max(0, percent));
    const filled = Math.round((clamped / 100) * w);
    const rest = w - filled;
    return theme.fg(filledColor, "─".repeat(filled)) + theme.fg("dim", "─".repeat(rest));
}

const THINKING_COLOR: Record<string, ThemeColor> = {
    minimal: "thinkingMinimal",
    low: "thinkingLow",
    medium: "thinkingMedium",
    high: "thinkingHigh",
    xhigh: "thinkingXhigh",
    max: "thinkingMax",
};

function providerLabel(providerId?: string): string {
    switch (providerId) {
        case "anthropic":
            return "Claude";
        case "openai":
            return "OpenAI";
        case "google":
        case "google-vertex":
        case "gemini":
            return "Gemini";
        default:
            return providerId ? providerId[0]!.toUpperCase() + providerId.slice(1) : "Usage";
    }
}

// ---------------------------------------------------------------------------
// Best-effort provider usage/quota window parsing from response headers
// ---------------------------------------------------------------------------

interface UsageWindow {
    label: string;
    percent: number | null;
    resetMs: number | null;
}

const SUFFIX_RE = /-(limit|remaining|reset|resets[-_]?at|reset[-_]?at|status|used|utilization|percentage|pct)$/i;

function computePercent(fields: Record<string, string>): number | null {
    const pctRaw = fields.utilization ?? fields.percentage ?? fields.pct;
    if (pctRaw !== undefined) {
        const v = Number.parseFloat(pctRaw);
        if (!Number.isNaN(v)) return v <= 1 ? v * 100 : v;
    }
    const limit = fields.limit !== undefined ? Number.parseFloat(fields.limit) : undefined;
    const remaining = fields.remaining !== undefined ? Number.parseFloat(fields.remaining) : undefined;
    if (limit && remaining !== undefined && !Number.isNaN(limit) && !Number.isNaN(remaining) && limit > 0) {
        return ((limit - remaining) / limit) * 100;
    }
    return null;
}

function computeResetMs(raw: string | undefined): number | null {
    if (!raw) return null;
    const num = Number(raw);
    if (!Number.isNaN(num)) {
        if (num > 1e12) return num - Date.now(); // epoch ms
        if (num > 1e9) return num * 1000 - Date.now(); // epoch seconds
        return num * 1000; // relative seconds remaining
    }
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return parsed - Date.now();
    return null;
}

function labelFromGroupKey(key: string): string {
    const k = key.toLowerCase();
    const hourMatch = k.match(/(\d+)\s*h(?:our)?/);
    if (hourMatch) return `${hourMatch[1]}h`;
    const dayMatch = k.match(/(\d+)\s*d(?:ay)?/);
    if (dayMatch) {
        const n = Number(dayMatch[1]);
        return n === 7 ? "Week" : `${n}d`;
    }
    if (k.includes("week")) return "Week";
    if (k.includes("session")) return "Session";
    if (k.includes("daily") || k.includes("day")) return "Day";
    if (k.includes("month")) return "Month";
    const parts = key.split(/[-_]/).filter(Boolean);
    return parts[parts.length - 1] || key;
}

/**
 * Group raw rate-limit-ish headers by their base key (stripping known
 * -limit/-remaining/-reset/... suffixes) and turn each group into a usage
 * window. Purely heuristic - adapt `labelFromGroupKey`/`computePercent` if
 * your provider uses a different shape once you've inspected it via
 * `/statusline headers`.
 */
function parseUsageWindows(headers: Record<string, string>): UsageWindow[] {
    const groups = new Map<string, Record<string, string>>();
    for (const [key, value] of Object.entries(headers)) {
        const m = key.match(SUFFIX_RE);
        if (!m) continue;
        const groupKey = key.slice(0, key.length - m[0].length);
        const field = m[1]!.toLowerCase().replace(/[-_]/g, "");
        if (!groups.has(groupKey)) groups.set(groupKey, {});
        groups.get(groupKey)![field] = value;
    }

    const windows: UsageWindow[] = [];
    for (const [groupKey, fields] of groups) {
        const percent = computePercent(fields);
        if (percent === null) continue;
        const resetMs = computeResetMs(fields.reset ?? fields.resetsat ?? fields.resetat);
        windows.push({ label: labelFromGroupKey(groupKey), percent, resetMs });
    }

    return windows.sort((a, b) => (a.resetMs ?? Number.POSITIVE_INFINITY) - (b.resetMs ?? Number.POSITIVE_INFINITY)).slice(0, 2);
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function statusUI(pi: ExtensionAPI) {
    let footerEnabled = true;
    let vimEnabled = true;
    let demoMode = false;

    // Latest ExtensionContext seen from any event. Extension contexts expose
    // live model/thinking-level/getContextUsage(), so capturing it once and
    // re-reading it later inside render() reflects current state (same
    // pattern as examples/extensions/custom-footer.ts).
    let latestCtx: ExtensionContext | undefined;
    let requestFooterRender: (() => void) | undefined;

    const rateLimitHeaders: Record<string, string> = {};
    let gitDirty = false;

    const captureCtx = (ctx: ExtensionContext) => {
        latestCtx = ctx;
        requestFooterRender?.();
    };

    pi.on("session_start", (_event, ctx) => captureCtx(ctx));
    pi.on("model_select", (_event, ctx) => captureCtx(ctx));
    pi.on("thinking_level_select", (_event, ctx) => captureCtx(ctx));
    pi.on("turn_start", (_event, ctx) => captureCtx(ctx));
    pi.on("turn_end", (_event, ctx) => captureCtx(ctx));
    pi.on("message_end", (_event, ctx) => captureCtx(ctx));

    pi.on("after_provider_response", (event) => {
        for (const [key, value] of Object.entries(event.headers)) {
            if (/ratelimit/i.test(key)) rateLimitHeaders[key.toLowerCase()] = value;
        }
    });

    async function refreshGitDirty(cwd: string): Promise<boolean> {
        try {
            const result = await pi.exec("git", ["status", "--porcelain"], { cwd, timeout: 3000 });
            return result.code === 0 && result.stdout.trim().length > 0;
        } catch {
            return false;
        }
    }

    function getUsageWindows(): UsageWindow[] {
        if (demoMode) {
            return [
                { label: "5h", percent: 0, resetMs: (4 * 60 + 54) * 60_000 },
                { label: "Week", percent: 25, resetMs: (8 * 60 + 34) * 60_000 },
            ];
        }
        return parseUsageWindows(rateLimitHeaders);
    }

    function setFooter(ctx: ExtensionContext) {
        if (!footerEnabled) {
            ctx.ui.setFooter(undefined);
            return;
        }
        ctx.ui.setFooter((tui, theme, footerData) => {
            requestFooterRender = () => tui.requestRender();
            const branchUnsub = footerData.onBranchChange(() => tui.requestRender());

            const cwd = latestCtx?.cwd ?? ctx.cwd;
            let gitTimer: ReturnType<typeof setInterval> | undefined;
            if (footerData.getGitBranch() !== null) {
                const poll = () => {
                    void refreshGitDirty(cwd).then((dirty) => {
                        if (dirty !== gitDirty) {
                            gitDirty = dirty;
                            tui.requestRender();
                        }
                    });
                };
                poll();
                gitTimer = setInterval(poll, 5000);
            }

            return {
                dispose() {
                    branchUnsub();
                    if (gitTimer) clearInterval(gitTimer);
                    requestFooterRender = undefined;
                },
                invalidate() { },
                render(width: number): string[] {
                    const sep = theme.fg("dim", " > ");
                    const branch = footerData.getGitBranch();

                    const line1Parts: string[] = [theme.fg("text", homeRelative(latestCtx?.cwd ?? cwd))];
                    if (branch) {
                        const dirtyMark = gitDirty ? theme.fg("warning", " *") : "";
                        line1Parts.push(theme.fg("accent", branch) + dirtyMark);
                    }
                    const c = latestCtx;
                    if (c?.model) {
                        const modelLabel = c.model.id.split("/").pop() ?? c.model.id;
                        line1Parts.push(theme.fg("text", modelLabel));
                    }
                    if (c?.thinkingLevel) {
                        const color = THINKING_COLOR[c.thinkingLevel] ?? "dim";
                        line1Parts.push(theme.fg(color, c.thinkingLevel));
                    }
                    const usage = c?.getContextUsage();
                    if (usage) {
                        const gaugeStr = gauge(usage.percent, 12, theme, "accent");
                        const pctStr = usage.percent != null ? theme.fg("text", `${Math.round(usage.percent)}%`) : theme.fg("dim", "?%");
                        const tokensStr =
                            usage.tokens != null
                                ? theme.fg("dim", `${fmtTokens(usage.tokens)}/${fmtTokens(usage.contextWindow)}`)
                                : theme.fg("dim", fmtTokens(usage.contextWindow));
                        line1Parts.push(`${theme.fg("dim", "ctx")} ${gaugeStr} ${pctStr} ${tokensStr}`);
                    }
                    const line1 = line1Parts.join(sep);

                    const windows = getUsageWindows();
                    const lines = [truncateToWidth(line1, width)];
                    if (windows.length > 0) {
                        const provider = providerLabel(c?.model?.provider);
                        const parts = windows.map((w) => {
                            const gaugeStr = gauge(w.percent, 12, theme, "accent");
                            const pctStr = w.percent != null ? theme.fg("text", `${Math.round(w.percent)}%`) : theme.fg("dim", "?%");
                            const resetStr = w.resetMs != null ? theme.fg("dim", fmtDuration(w.resetMs)) : "";
                            return `${theme.fg("dim", w.label)} ${gaugeStr} ${pctStr}${resetStr ? ` ${resetStr}` : ""}`;
                        });
                        const line2 = `${theme.fg("text", provider)}${sep}${parts.join(sep)}`;
                        lines.push(truncateToWidth(line2, width));
                    }
                    return lines;
                },
            };
        });
    }

    pi.on("session_start", (_event, ctx) => setFooter(ctx));

    pi.registerCommand("statusline", {
        description: "Toggle the breadcrumb/usage footer, or inspect captured rate-limit headers (usage: /statusline [on|off|demo|headers])",
        handler: async (args, ctx) => {
            const arg = args.trim().toLowerCase();
            if (arg === "on") footerEnabled = true;
            else if (arg === "off") footerEnabled = false;
            else if (arg === "demo") {
                demoMode = !demoMode;
                ctx.ui.notify(`Statusline demo usage data ${demoMode ? "enabled" : "disabled"}`, "info");
                setFooter(ctx);
                return;
            } else if (arg === "headers") {
                const keys = Object.keys(rateLimitHeaders);
                ctx.ui.notify(
                    keys.length > 0
                        ? `Captured rate-limit headers: ${JSON.stringify(rateLimitHeaders)}`
                        : "No rate-limit-style response headers captured yet from this provider.",
                    "info",
                );
                return;
            } else footerEnabled = !footerEnabled;

            setFooter(ctx);
            ctx.ui.notify(`Statusline footer ${footerEnabled ? "enabled" : "disabled"}`, "info");
        },
    });

    // -------------------------------------------------------------------
    // Vim-style modal editor with a NORMAL/INSERT mode badge (opt-in)
    // -------------------------------------------------------------------

    type Mode = "normal" | "insert";

    // Editor (from pi-tui) marks most of its cursor/edit helpers as
    // TypeScript-`private`, which only blocks *design-time* access - at
    // runtime they're plain methods on the instance. `Editor.handleInput`
    // dispatches to them based on keybinding matches (e.g. ctrl+left ->
    // moveWordBackwards()), but there's no default keybinding we can just
    // forward a synthetic escape sequence for to trigger word motion, undo,
    // line-start/end, etc. So for vim motions beyond plain arrows we call
    // the underlying methods directly via this cast.
    interface EditorInternals {
        moveWordBackwards(): void;
        moveWordForwards(): void;
        moveToLineStart(): void;
        moveToLineEnd(): void;
        handleForwardDelete(): void;
        addNewLine(): void;
        undo(): void;
        pushUndoSnapshot(): void;
        setCursorCol(col: number): void;
        state: { lines: string[]; cursorLine: number; cursorCol: number };
    }

    type WordCharClass = "space" | "word" | "punct";

    function charClass(ch: string): WordCharClass {
        if (/\s/.test(ch)) return "space";
        if (/[A-Za-z0-9_]/.test(ch)) return "word";
        return "punct";
    }

    /**
     * vim `e` motion: index of the last character of the current/next word,
     * scanning forward from (but not including) `col` on a single line.
     * There's no built-in Editor equivalent (only word-start motions), so
     * this is a small local approximation - good enough for a single-line
     * prompt box, not a full vim word-object implementation.
     */
    function wordEndIndex(line: string, col: number): number {
        const n = line.length;
        if (n === 0) return 0;
        let i = Math.min(col + 1, n - 1);
        while (i < n && charClass(line[i]!) === "space") i++;
        if (i >= n) return n - 1;
        const cls = charClass(line[i]!);
        while (i + 1 < n && charClass(line[i + 1]!) === cls) i++;
        return i;
    }

    type OperatorMotion = "w" | "b" | "e" | "$" | "0" | "h" | "l";
    const OPERATOR_MOTIONS: OperatorMotion[] = ["w", "b", "e", "$", "0", "h", "l"];

    // Note: the `theme` param that setEditorComponent's factory receives is a
    // stripped-down EditorTheme (border color + select-list theme only), not
    // the full Theme with .fg()/.bg(). For a colored badge we read the full
    // Theme from `latestCtx.ui.theme` (same object session_start/etc. give us)
    // instead, falling back to a plain unstyled label if unavailable.
    class VimEditor extends CustomEditor {
        mode: Mode = "insert";
        private pendingOperator: "d" | "c" | null = null;

        private get internal(): EditorInternals {
            return this as unknown as EditorInternals;
        }

        private deleteCurrentLine(): void {
            const ed = this.internal;
            ed.pushUndoSnapshot();
            const { lines } = ed.state;
            if (lines.length <= 1) {
                lines[0] = "";
                ed.state.cursorLine = 0;
            } else {
                lines.splice(ed.state.cursorLine, 1);
                if (ed.state.cursorLine >= lines.length) ed.state.cursorLine = lines.length - 1;
            }
            ed.setCursorCol(Math.min(ed.state.cursorCol, (lines[ed.state.cursorLine] ?? "").length));
            this.onChange?.(this.getText());
        }

        private changeCurrentLine(): void {
            const ed = this.internal;
            ed.pushUndoSnapshot();
            ed.state.lines[ed.state.cursorLine] = "";
            ed.setCursorCol(0);
            this.onChange?.(this.getText());
            this.mode = "insert";
        }

        /** Delete text between two (line, col) positions, order-independent. */
        private deleteBetween(aLine: number, aCol: number, bLine: number, bCol: number): void {
            const ed = this.internal;
            const [fromLine, fromCol, toLine, toCol] =
                aLine < bLine || (aLine === bLine && aCol <= bCol) ? [aLine, aCol, bLine, bCol] : [bLine, bCol, aLine, aCol];
            if (fromLine === toLine && fromCol === toCol) return;
            ed.pushUndoSnapshot();
            const { lines } = ed.state;
            if (fromLine === toLine) {
                const line = lines[fromLine] ?? "";
                lines[fromLine] = line.slice(0, fromCol) + line.slice(toCol);
            } else {
                const firstLine = lines[fromLine] ?? "";
                const lastLine = lines[toLine] ?? "";
                lines.splice(fromLine, toLine - fromLine + 1, firstLine.slice(0, fromCol) + lastLine.slice(toCol));
            }
            ed.state.cursorLine = fromLine;
            ed.setCursorCol(fromCol);
            this.onChange?.(this.getText());
        }

        /** Apply the pending `d`/`c` operator combined with a motion key. */
        private applyOperatorMotion(motion: OperatorMotion): void {
            const operator = this.pendingOperator;
            this.pendingOperator = null;
            if (!operator) return;

            const ed = this.internal;
            const startLine = ed.state.cursorLine;
            const startCol = ed.state.cursorCol;
            const startLineText = ed.state.lines[startLine] ?? "";
            let endLine = startLine;
            let endCol = startCol;

            switch (motion) {
                case "w":
                    if (operator === "c") {
                        // vim quirk: "cw" behaves like "ce" (stops at word end, doesn't
                        // eat trailing whitespace the way "dw" would).
                        endCol = wordEndIndex(startLineText, startCol) + 1;
                    } else {
                        ed.moveWordForwards();
                        endLine = ed.state.cursorLine;
                        endCol = ed.state.cursorCol;
                    }
                    break;
                case "b":
                    ed.moveWordBackwards();
                    endLine = ed.state.cursorLine;
                    endCol = ed.state.cursorCol;
                    break;
                case "e":
                    endCol = wordEndIndex(startLineText, startCol) + 1; // inclusive of last char
                    break;
                case "$":
                    endCol = startLineText.length; // exclusive end already covers last char
                    break;
                case "0":
                    endCol = 0;
                    break;
                case "h":
                    endCol = Math.max(0, startCol - 1);
                    break;
                case "l":
                    endCol = startCol + 1;
                    break;
            }

            this.deleteBetween(startLine, startCol, endLine, endCol);
            if (operator === "c") this.mode = "insert";
        }

        handleInput(data: string): void {
            if (matchesKey(data, "escape")) {
                this.pendingOperator = null;
                if (this.mode === "insert") {
                    this.mode = "normal";
                    return;
                }
                super.handleInput(data);
                return;
            }

            if (this.mode === "insert") {
                super.handleInput(data);
                return;
            }

            // Two-key normal-mode commands: "dd"/"cc" (whole line), or an
            // operator ("d"/"c") followed by a motion ("dw", "de", "cb", ...).
            if (this.pendingOperator) {
                const operator = this.pendingOperator;
                if (data === operator) {
                    this.pendingOperator = null;
                    if (operator === "d") this.deleteCurrentLine();
                    else this.changeCurrentLine();
                    return;
                }
                if ((OPERATOR_MOTIONS as string[]).includes(data)) {
                    this.applyOperatorMotion(data as OperatorMotion);
                    return;
                }
                // Unsupported combo (e.g. "dx") - cancel the pending operator.
                this.pendingOperator = null;
                return;
            }

            const ed = this.internal;
            switch (data) {
                // Mode changes
                case "i":
                    this.mode = "insert";
                    return;
                case "a":
                    super.handleInput("\x1b[C"); // move right, then insert (vim "append")
                    this.mode = "insert";
                    return;
                case "A":
                    ed.moveToLineEnd();
                    this.mode = "insert";
                    return;
                case "I":
                    ed.moveToLineStart();
                    this.mode = "insert";
                    return;
                case "o":
                    ed.moveToLineEnd();
                    ed.addNewLine();
                    this.mode = "insert";
                    return;
                // Character motion
                case "h":
                    super.handleInput("\x1b[D");
                    return;
                case "j":
                    super.handleInput("\x1b[B");
                    return;
                case "k":
                    super.handleInput("\x1b[A");
                    return;
                case "l":
                    super.handleInput("\x1b[C");
                    return;
                // Word motion
                case "w":
                    ed.moveWordForwards();
                    return;
                case "e": {
                    const line = ed.state.lines[ed.state.cursorLine] ?? "";
                    ed.setCursorCol(wordEndIndex(line, ed.state.cursorCol));
                    return;
                }
                case "b":
                    ed.moveWordBackwards();
                    return;
                // Line motion
                case "0":
                    ed.moveToLineStart();
                    return;
                case "$":
                    ed.moveToLineEnd();
                    return;
                // Editing
                case "x":
                    ed.handleForwardDelete();
                    return;
                case "u":
                    ed.undo();
                    return;
                case "d":
                case "c":
                    this.pendingOperator = data;
                    return;
            }
            // Let ctrl+c / app shortcuts through; swallow other printable keys.
            if (data.length === 1 && data.charCodeAt(0) >= 32) return;
            super.handleInput(data);
        }

        render(width: number): string[] {
            const lines = super.render(width);
            if (lines.length === 0) return lines;
            const fullTheme = latestCtx?.ui.theme;
            const badge = fullTheme
                ? this.mode === "normal"
                    ? fullTheme.bg("selectedBg", fullTheme.fg("accent", fullTheme.bold(" NORMAL ")))
                    : fullTheme.fg("dim", " INSERT ")
                : this.mode === "normal"
                    ? " NORMAL "
                    : " INSERT ";
            const badgeWidth = visibleWidth(badge);
            const lastLine = lines[lines.length - 1]!;
            lines[lines.length - 1] = truncateToWidth(lastLine, Math.max(0, width - badgeWidth), "") + badge;
            return lines;
        }
    }

    function applyVimMode(ctx: ExtensionContext) {
        ctx.ui.setEditorComponent(vimEnabled ? (tui, theme, kb) => new VimEditor(tui, theme, kb) : undefined);
    }

    pi.on("session_start", (_event, ctx) => applyVimMode(ctx));

    pi.registerCommand("vim-mode", {
        description: "Toggle vim-style modal editing with a NORMAL/INSERT badge (usage: /vim-mode [on|off])",
        handler: async (args, ctx) => {
            const arg = args.trim().toLowerCase();
            if (arg === "on") vimEnabled = true;
            else if (arg === "off") vimEnabled = false;
            else vimEnabled = !vimEnabled;

            applyVimMode(ctx);
            ctx.ui.notify(
                vimEnabled
                    ? "Vim mode enabled - press Escape for NORMAL mode, i for INSERT mode."
                    : "Vim mode disabled - back to normal typing.",
                "info",
            );
        },
    });
}
