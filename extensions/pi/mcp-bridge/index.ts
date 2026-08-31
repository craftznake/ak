import {
    DEFAULT_MAX_BYTES,
    DEFAULT_MAX_LINES,
    formatSize,
    truncateHead,
    type AgentToolResult,
    type ExtensionAPI,
    type ExtensionContext,
    type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Type } from "typebox";
import { connectMcpServer, type McpConnection } from "./client.ts";
import { loadMcpServers, type McpServerConfig } from "./config.ts";

// mcp-bridge: gives Pi the same MCP tool-calling capability opencode has, by
// reusing opencode's own `mcp` config block (see config.ts) instead of
// re-defining servers a second time, and bridging each discovered MCP tool
// into a Pi tool via pi.registerTool().
//
// Connections are opt-in and lazy by default (see /mcp below): several of
// the remote servers configured for opencode on this machine (Atlassian,
// Slack, Glean, GitLab, corp-gws-mcp, Datadog) are gated behind an OAuth
// flow that opencode's own MCP client completes interactively. This
// extension has no browser/OAuth UI, so those servers will fail to connect
// unless you supply a pre-obtained bearer token via a "headers" field on
// the server config. Local/stdio servers (e.g. mcp-kibana-search) and any
// remote server behind static-token auth work out of the box.
//
// Usage:
//   /mcp                        - show configured servers and connection status
//   /mcp connect <name|all>     - connect and register that server's tools
//   /mcp disconnect <name|all>  - disconnect and drop its registered tools
//
// Auto-connect on session start: set AK_MCP_AUTOCONNECT="server1,server2" (or
// "all") in the environment. Left unset, the extension is a no-op until the
// user runs /mcp connect.

type ToolDetails = {
    server: string;
    tool: string;
};

type PiTextContent = { type: "text"; text: string };
type PiImageContent = { type: "image"; data: string; mimeType: string };
type PiContent = PiTextContent | PiImageContent;

type TrackedConnection = McpConnection & { toolNames: string[] };

const connections = new Map<string, TrackedConnection>();

function sanitizeSegment(input: string): string {
    const cleaned = input
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "");
    return cleaned || "x";
}

/** mcp__<server>__<tool>, matching the naming convention MCP-bridging tools
 * elsewhere in the ecosystem use, truncated to stay under common function
 * name length limits (e.g. OpenAI's 64 chars). */
function buildToolName(serverName: string, toolName: string): string {
    const name = `mcp__${sanitizeSegment(serverName)}__${sanitizeSegment(toolName)}`;
    return name.length <= 64 ? name : name.slice(0, 64);
}

function toPiContent(blocks: Array<Record<string, unknown>>): PiContent[] {
    const out: PiContent[] = [];

    for (const block of blocks) {
        const type = block.type as string | undefined;

        if (type === "text") {
            const truncation = truncateHead(String(block.text ?? ""), {
                maxLines: DEFAULT_MAX_LINES,
                maxBytes: DEFAULT_MAX_BYTES,
            });
            let text = truncation.content;
            if (truncation.truncated) {
                text +=
                    `\n\n[MCP tool output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines ` +
                    `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).]`;
            }
            out.push({ type: "text", text });
            continue;
        }

        if (type === "image") {
            out.push({
                type: "image",
                data: String(block.data ?? ""),
                mimeType: String(block.mimeType ?? "application/octet-stream"),
            });
            continue;
        }

        if (type === "resource") {
            const resource = block.resource as { uri?: string; text?: string } | undefined;
            out.push({ type: "text", text: resource?.text ?? `[resource ${resource?.uri ?? "unknown"}]` });
            continue;
        }

        if (type === "resource_link") {
            out.push({ type: "text", text: `[resource link: ${String(block.uri ?? "unknown")}]` });
            continue;
        }

        out.push({ type: "text", text: `[unsupported MCP content type: ${type ?? "unknown"}]` });
    }

    if (out.length === 0) out.push({ type: "text", text: "(no content)" });
    return out;
}

function buildToolDefinition(
    serverName: string,
    piToolName: string,
    tool: { name: string; description?: string; inputSchema?: unknown },
): ToolDefinition {
    const snippet = (tool.description ?? `${tool.name} via MCP server ${serverName}`).split("\n")[0]?.slice(0, 140);

    return {
        name: piToolName,
        label: `${serverName}: ${tool.name}`,
        description: tool.description ?? `Tool "${tool.name}" provided by MCP server "${serverName}".`,
        promptSnippet: snippet,
        parameters: Type.Unsafe<Record<string, unknown>>(tool.inputSchema ?? { type: "object", properties: {} }),
        async execute(_toolCallId, params, signal): Promise<AgentToolResult<ToolDetails>> {
            const conn = connections.get(serverName);
            if (!conn) {
                throw new Error(`MCP server "${serverName}" is not connected. Run /mcp connect ${serverName} first.`);
            }

            const result = await conn.client.callTool(
                { name: tool.name, arguments: (params ?? {}) as Record<string, unknown> },
                undefined,
                signal ? { signal } : undefined,
            );

            const content = toPiContent((result.content ?? []) as Array<Record<string, unknown>>);
            if (result.isError) {
                const message =
                    content
                        .map((c) => (c.type === "text" ? c.text : `[${c.type} content]`))
                        .join("\n") || "MCP tool call failed";
                throw new Error(message);
            }

            return { content, details: { server: serverName, tool: tool.name } };
        },
    };
}

async function registerServerTools(pi: ExtensionAPI, serverName: string, client: Client): Promise<string[]> {
    const { tools } = await client.listTools();
    const toolNames: string[] = [];
    for (const tool of tools) {
        const piToolName = buildToolName(serverName, tool.name);
        toolNames.push(piToolName);
        pi.registerTool(buildToolDefinition(serverName, piToolName, tool));
    }
    return toolNames;
}

function updateStatus(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    if (connections.size === 0) {
        ctx.ui.setStatus("mcp-bridge", undefined);
        return;
    }
    const totalTools = Array.from(connections.values()).reduce((sum, c) => sum + c.toolNames.length, 0);
    ctx.ui.setStatus("mcp-bridge", `mcp: ${connections.size} server(s), ${totalTools} tool(s)`);
}

async function connectAndRegister(pi: ExtensionAPI, name: string, cfg: McpServerConfig, ctx: ExtensionContext): Promise<void> {
    if (connections.has(name)) {
        ctx.ui.notify(`MCP server "${name}" is already connected.`, "info");
        return;
    }

    try {
        const conn = await connectMcpServer(name, cfg);
        const toolNames = await registerServerTools(pi, name, conn.client);
        connections.set(name, { ...conn, toolNames });
        ctx.ui.notify(`Connected MCP server "${name}" via ${conn.transportKind} (${toolNames.length} tool(s)).`, "info");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Failed to connect MCP server "${name}": ${message}`, "error");
    }
}

async function disconnectServer(name: string, ctx: ExtensionContext): Promise<void> {
    const conn = connections.get(name);
    if (!conn) {
        ctx.ui.notify(`MCP server "${name}" is not connected.`, "warning");
        return;
    }
    connections.delete(name);
    try {
        await conn.client.close();
    } catch {
        // best effort - server may already be gone
    }
    ctx.ui.notify(`Disconnected MCP server "${name}".`, "info");
}

async function reportStatus(ctx: ExtensionContext): Promise<void> {
    const { servers, sources, warnings } = await loadMcpServers(ctx.cwd);
    for (const warning of warnings) ctx.ui.notify(warning, "warning");

    const names = Object.keys(servers);
    if (names.length === 0) {
        ctx.ui.notify(
            "No MCP servers configured. Set AK_OPENCODE_CONFIG, edit ~/.config/opencode/opencode.json's " +
                'mcp block, or add a { "mcp": {...} } file at .pi/mcp.json.',
            "info",
        );
        return;
    }

    const lines = names.map((name) => {
        const conn = connections.get(name);
        const cfg = servers[name];
        const kind = cfg.type === "local" ? `local: ${cfg.command.join(" ")}` : `remote: ${cfg.url}`;
        return conn
            ? `- ${name} [connected via ${conn.transportKind}, ${conn.toolNames.length} tool(s)] (${kind})`
            : `- ${name} [not connected] (${kind})`;
    });

    ctx.ui.notify([`MCP servers (source: ${sources.join(", ") || "none"}):`, ...lines].join("\n"), "info");
}

export default function mcpBridge(pi: ExtensionAPI) {
    pi.registerCommand("mcp", {
        description: "Manage MCP server connections bridged from opencode's mcp config (usage: /mcp [connect|disconnect] [name|all])",
        handler: async (args, ctx) => {
            const [sub, ...rest] = args.trim().split(/\s+/).filter(Boolean);

            if (!sub || sub === "list" || sub === "status") {
                await reportStatus(ctx);
                return;
            }

            if (sub === "connect") {
                const { servers, warnings } = await loadMcpServers(ctx.cwd);
                for (const warning of warnings) ctx.ui.notify(warning, "warning");

                const targets = rest.length === 0 || rest[0] === "all" ? Object.keys(servers) : rest;
                if (targets.length === 0) {
                    ctx.ui.notify("No MCP servers configured to connect.", "warning");
                    return;
                }

                for (const name of targets) {
                    const cfg = servers[name];
                    if (!cfg) {
                        ctx.ui.notify(
                            `Unknown MCP server "${name}". Configured: ${Object.keys(servers).join(", ") || "(none)"}`,
                            "warning",
                        );
                        continue;
                    }
                    await connectAndRegister(pi, name, cfg, ctx);
                }
                updateStatus(ctx);
                return;
            }

            if (sub === "disconnect") {
                const targets = rest.length === 0 || rest[0] === "all" ? Array.from(connections.keys()) : rest;
                for (const name of targets) await disconnectServer(name, ctx);
                updateStatus(ctx);
                return;
            }

            ctx.ui.notify("Usage: /mcp [connect|disconnect] [name|all], or /mcp for status", "warning");
        },
    });

    pi.on("session_start", async (_event, ctx) => {
        updateStatus(ctx);

        const auto = process.env.AK_MCP_AUTOCONNECT;
        if (!auto?.trim()) return;

        const { servers, warnings } = await loadMcpServers(ctx.cwd);
        for (const warning of warnings) ctx.ui.notify(warning, "warning");

        const targets = auto.trim() === "all" ? Object.keys(servers) : auto.split(",").map((s) => s.trim()).filter(Boolean);
        for (const name of targets) {
            const cfg = servers[name];
            if (!cfg) {
                ctx.ui.notify(`AK_MCP_AUTOCONNECT: unknown MCP server "${name}"`, "warning");
                continue;
            }
            await connectAndRegister(pi, name, cfg, ctx);
        }
        updateStatus(ctx);
    });

    pi.on("session_shutdown", async () => {
        for (const conn of connections.values()) {
            try {
                await conn.client.close();
            } catch {
                // best effort
            }
        }
        connections.clear();
    });
}
