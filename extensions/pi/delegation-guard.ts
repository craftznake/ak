import type { ExtensionAPI, ToolResultEvent } from "@earendil-works/pi-coding-agent";

// delegation-guard: a mechanical nudge/escalation for the DIRECT/DELEGATE
// delegation gate documented in shared.md / docs/primary-agent-model.md /
// docs/deterministic-workflow.md. That gate is prose-only today, so nothing
// stops a primary agent from quietly doing multi-file investigative or
// implementation work itself instead of spawning a crew via
// `ak crew-spawn`.
//
// This extension tracks a rolling count of "investigative" tool calls
// (read, grep, find, ls, and bash/powershell commands that look like
// grep/rg/find/ls/cat/head/tail/git-log-ish inspection) since the last
// crew-spawn-shaped bash/powershell call or the last assistant message that
// contained an explicit `DIRECT` whitelist-reason justification.
//
// - Crossing a soft threshold injects a steering reminder message (not a
//   block) suggesting `ak crew-spawn`.
// - Crossing a hard threshold shows a confirm dialog (TUI/RPC only) asking
//   whether to keep going DIRECT or delegate now, and reflects the answer
//   back into the session as a steering message. In modes without UI
//   (print/json) the hard threshold instead sends a stronger reminder.
// - A successful crew-spawn-shaped bash/powershell call, or an assistant
//   message containing the literal word "DIRECT", fully resets the counters.
//
// This never blocks a tool call. It only injects messages / asks a
// dismissable question, so a truly-DIRECT tiny task is never hard-stopped.
//
// Config (env vars, read once at extension load; documented in
// docs/delegation-guard.md):
//   AK_DELEGATION_GUARD=0                    disable entirely (no-op)
//   AK_DELEGATION_GUARD_SOFT_THRESHOLD=<n>    default 6
//   AK_DELEGATION_GUARD_HARD_THRESHOLD=<n>    default 12 (must be > soft)
//
// Known limitations (see docs/delegation-guard.md for full notes):
//   - Counters are per-process/session-start; they reset on /new, /resume,
//     /fork, and /reload rather than being reconstructed from session
//     history. A resumed session that was already deep in investigation
//     starts back at zero.
//   - "Investigative" detection is a regex heuristic on bash/powershell
//     commands; it can under- or over-count edge cases.

const CREW_SPAWN_RE = /(^|[/\s])(bin\/ak|ak)\s+crew-spawn\b/;
const INVESTIGATIVE_SHELL_RE = /\b(grep|rg|ag|find|ls|cat|head|tail|wc|git\s+(log|diff|show|blame))\b/i;
const DIRECT_JUSTIFICATION_RE = /\bDIRECT\b/;

function parseBoolEnabled(raw: string | undefined): boolean {
    return raw !== "0";
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
    if (!raw) return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function isInvestigativeToolResult(event: ToolResultEvent): boolean {
    if (event.toolName === "read" || event.toolName === "grep" || event.toolName === "find" || event.toolName === "ls") {
        return true;
    }
    if (event.toolName === "bash" || event.toolName === "powershell") {
        const command = String((event.input as { command?: unknown }).command ?? "");
        return INVESTIGATIVE_SHELL_RE.test(command);
    }
    return false;
}

function isCrewSpawnToolResult(event: ToolResultEvent): boolean {
    if (event.toolName !== "bash" && event.toolName !== "powershell") return false;
    const command = String((event.input as { command?: unknown }).command ?? "");
    return CREW_SPAWN_RE.test(command);
}

function extractAssistantText(message: unknown): string {
    const msg = message as { role?: string; content?: unknown };
    if (msg?.role !== "assistant" || !Array.isArray(msg.content)) return "";
    return msg.content
        .filter((part: unknown): part is { type: string; text: string } => {
            const p = part as { type?: unknown; text?: unknown };
            return p?.type === "text" && typeof p.text === "string";
        })
        .map((part) => part.text)
        .join("\n");
}

export default function delegationGuard(pi: ExtensionAPI) {
    const enabled = parseBoolEnabled(process.env.AK_DELEGATION_GUARD);
    if (!enabled) return;

    const softThreshold = parsePositiveInt(process.env.AK_DELEGATION_GUARD_SOFT_THRESHOLD, 6);
    const rawHard = parsePositiveInt(process.env.AK_DELEGATION_GUARD_HARD_THRESHOLD, 12);
    const hardThreshold = rawHard > softThreshold ? rawHard : softThreshold * 2;

    let sinceReset = 0;
    let nextSoftAt = softThreshold;
    let nextHardAt = hardThreshold;
    let confirmInFlight = false;

    function resetCounters() {
        sinceReset = 0;
        nextSoftAt = softThreshold;
        nextHardAt = hardThreshold;
    }

    function updateStatus(ctx: { hasUI: boolean; ui: { setStatus(key: string, text: string | undefined): void } }) {
        if (!ctx.hasUI) return;
        ctx.ui.setStatus("delegation-guard", sinceReset > 0 ? `delegation-gate: ${sinceReset}/${nextHardAt}` : undefined);
    }

    pi.on("session_start", (_event, ctx) => {
        resetCounters();
        updateStatus(ctx);
    });

    pi.on("message_end", (event) => {
        if (DIRECT_JUSTIFICATION_RE.test(extractAssistantText(event.message))) {
            resetCounters();
        }
    });

    pi.on("tool_result", async (event, ctx) => {
        if (isCrewSpawnToolResult(event)) {
            if (!event.isError) resetCounters();
            updateStatus(ctx);
            return;
        }

        if (!isInvestigativeToolResult(event)) return;

        sinceReset += 1;

        if (sinceReset >= nextHardAt) {
            nextHardAt += hardThreshold;

            if (ctx.hasUI && !confirmInFlight) {
                confirmInFlight = true;
                try {
                    const keepGoing = await ctx.ui.confirm(
                        "Delegation gate",
                        `${sinceReset} investigative tool calls since the last crew-spawn or DIRECT justification. ` +
                            "Keep working DIRECT? Choose No to delegate this to a crew via ak crew-spawn now.",
                    );
                    pi.sendMessage(
                        {
                            customType: "delegation-guard",
                            display: true,
                            content: keepGoing
                                ? "User confirmed continuing DIRECT past the delegation-gate hard threshold. " +
                                  "Proceed with the smallest correct change, and re-run the delegation gate if scope grows further."
                                : "User chose to delegate at the delegation-gate hard threshold. Stop further direct " +
                                  "investigation/implementation now and spawn a crew via `ak crew-spawn <slug> <brief>` " +
                                  "before continuing.",
                        },
                        { deliverAs: "steer" },
                    );
                } finally {
                    confirmInFlight = false;
                }
            } else {
                pi.sendMessage(
                    {
                        customType: "delegation-guard",
                        display: true,
                        content:
                            `Delegation gate: ${sinceReset} investigative tool calls since the last crew-spawn or DIRECT ` +
                            "justification, well past the reminder threshold. Classify this DIRECT vs DELEGATE now: state " +
                            "the whitelist reason if staying DIRECT, or spawn a crew via `ak crew-spawn <slug> <brief>`.",
                    },
                    { deliverAs: "steer" },
                );
            }
        } else if (sinceReset >= nextSoftAt) {
            nextSoftAt += softThreshold;
            pi.sendMessage(
                {
                    customType: "delegation-guard",
                    display: true,
                    content:
                        `Delegation gate reminder: ${sinceReset} investigative tool calls (read/grep/find/bash search) ` +
                        "since the last crew-spawn or DIRECT justification. Per shared.md's delegation gate, classify " +
                        "this as DIRECT (state the whitelist reason) or DELEGATE now via `ak crew-spawn <slug> <brief>`.",
                },
                { deliverAs: "steer" },
            );
        }

        updateStatus(ctx);
    });

    pi.registerCommand("delegation-guard", {
        description: "Show or reset delegation-gate guard counters (usage: /delegation-guard [status|reset])",
        handler: async (args, ctx) => {
            const arg = args.trim().toLowerCase();
            if (arg === "reset") {
                resetCounters();
                updateStatus(ctx);
                ctx.ui.notify("Delegation-gate counters reset.", "info");
                return;
            }

            ctx.ui.notify(
                `Investigative calls since reset: ${sinceReset} (next nudge at ${nextSoftAt}, next hard prompt at ${nextHardAt}). ` +
                    `Soft threshold ${softThreshold}, hard threshold ${hardThreshold}.`,
                "info",
            );
        },
    });
}
