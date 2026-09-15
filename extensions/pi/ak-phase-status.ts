import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

// ak-phase-status: renders the current agent-kit role + backend-dev phase as a
// status line inside the pi session, so the primary can always see where it is
// in the research -> planning -> awaiting-approval -> implementing -> testing ->
// done loop that shared.md / docs/dev-workflow.md define.
//
// It reads two files written by `bin/ak`:
//   <repo>/.agent-kit/role   (role=worker marker; absent => primary)
//   <repo>/.agent-kit/phase  (phase=<name>, set via `ak phase set <name>`)
//
// Both are plain key=value files. This extension only reads them; it never
// writes. The status refreshes on session start and after each turn/tool call,
// so it reflects `ak phase set ...` run mid-turn by the next render. TUI-only:
// it uses ctx.ui.setStatus and is inert without a UI, so it never touches the
// LLM context.

const STATUS_KEY = "ak-phase";

function readKeyValue(file: string, key: string): string | undefined {
    let text: string;
    try {
        text = fs.readFileSync(file, "utf8");
    } catch {
        return undefined;
    }
    for (const line of text.split("\n")) {
        const eq = line.indexOf("=");
        if (eq === -1) continue;
        if (line.slice(0, eq) === key) return line.slice(eq + 1).trim();
    }
    return undefined;
}

// Walk up from `start` to find the nearest directory that looks like a repo
// root or already carries agent-kit state. Bounded to avoid runaway loops.
function findRoot(start: string): string | undefined {
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

function computeStatus(cwd: string): string | undefined {
    const root = findRoot(cwd);
    if (!root) return undefined;
    const agentKit = path.join(root, ".agent-kit");
    if (!fs.existsSync(agentKit)) return undefined;

    const roleFile = path.join(agentKit, "role");
    const phaseFile = path.join(agentKit, "phase");

    const role = readKeyValue(roleFile, "role");
    const phase = readKeyValue(phaseFile, "phase");

    let label: string;
    if (role === "worker") {
        const slug = readKeyValue(roleFile, "slug");
        label = slug ? `ak: worker/${slug}` : "ak: worker";
    } else {
        label = "ak: primary";
    }
    return phase ? `${label} \u00b7 ${phase}` : label;
}

export default function akPhaseStatus(pi: ExtensionAPI) {
    let enabled = true;

    function refresh(ctx: ExtensionContext) {
        if (!enabled || !ctx.hasUI) return;
        ctx.ui.setStatus(STATUS_KEY, computeStatus(ctx.cwd));
    }

    pi.on("session_start", (_event, ctx) => refresh(ctx));
    pi.on("turn_start", (_event, ctx) => refresh(ctx));
    pi.on("turn_end", (_event, ctx) => refresh(ctx));
    pi.on("message_end", (_event, ctx) => refresh(ctx));
    // Refresh right after a tool call so `ak phase set ...` run via bash shows
    // up without waiting for the whole turn to end.
    pi.on("tool_result", (_event, ctx) => refresh(ctx));

    pi.registerCommand("ak-phase", {
        description: "Show or toggle the agent-kit role/phase status line (usage: /ak-phase [on|off])",
        handler: async (args, ctx) => {
            const arg = args.trim().toLowerCase();
            if (arg === "on") enabled = true;
            else if (arg === "off") {
                enabled = false;
                ctx.ui.setStatus(STATUS_KEY, undefined);
                ctx.ui.notify("agent-kit phase status hidden", "info");
                return;
            }
            refresh(ctx);
            const status = computeStatus(ctx.cwd);
            ctx.ui.notify(status ? `Current: ${status}` : "No agent-kit state found here.", "info");
        },
    });
}
