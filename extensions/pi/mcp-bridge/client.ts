import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServerConfig } from "./config.ts";
import { ensureFreshAuthorizationHeader, looksLikeAuthError } from "./oauth.ts";

// mcp-bridge/client: connects to one configured MCP server and returns a
// ready-to-use SDK Client. Remote servers try modern Streamable HTTP first,
// then fall back to the legacy HTTP+SSE transport - the same backwards
// compatibility strategy the MCP TypeScript SDK documents for its own
// example client (see streamableHttpWithSseFallbackClient.ts upstream).

const CLIENT_INFO = { name: "ak-pi-mcp-bridge", version: "0.1.0" };

export type McpTransportKind = "stdio" | "streamable-http" | "sse";

export type McpConnection = {
    client: Client;
    transport: Transport;
    transportKind: McpTransportKind;
};

/** Wrap fetch to inject static headers (e.g. a pre-obtained bearer token). */
function buildFetchWithHeaders(headers: Record<string, string> | undefined): typeof fetch | undefined {
    if (!headers || Object.keys(headers).length === 0) return undefined;
    return (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const merged = new Headers(init?.headers);
        for (const [key, value] of Object.entries(headers)) merged.set(key, value);
        return fetch(input, { ...init, headers: merged });
    };
}

async function attemptConnect(url: URL, headers: Record<string, string> | undefined): Promise<McpConnection> {
    const fetchImpl = buildFetchWithHeaders(headers);
    const requestInit = headers ? { headers } : undefined;

    try {
        const transport = new StreamableHTTPClientTransport(url, { requestInit, fetch: fetchImpl });
        const client = new Client(CLIENT_INFO);
        await client.connect(transport);
        return { client, transport, transportKind: "streamable-http" };
    } catch (streamableError) {
        // Header injection on the legacy SSE fallback covers the recurring
        // POST requests (requestInit) and the initial GET/EventSource
        // stream (eventSourceInit.fetch) - the latter depends on the
        // underlying `eventsource` polyfill honoring a custom fetch.
        const transport = new SSEClientTransport(url, {
            requestInit,
            eventSourceInit: fetchImpl ? { fetch: fetchImpl } : undefined,
        });
        const client = new Client(CLIENT_INFO);
        try {
            await client.connect(transport);
            return { client, transport, transportKind: "sse" };
        } catch (sseError) {
            const streamableMessage = streamableError instanceof Error ? streamableError.message : String(streamableError);
            const sseMessage = sseError instanceof Error ? sseError.message : String(sseError);
            throw new Error(`streamable-http: ${streamableMessage}; sse: ${sseMessage}`);
        }
    }
}

async function connectRemote(name: string, cfg: { url: string; headers?: Record<string, string> }): Promise<McpConnection> {
    const url = new URL(cfg.url);

    // Auto-inject a bearer token from opencode's shared OAuth cache
    // (~/.local/share/opencode/mcp-auth.json) when the server config itself
    // doesn't already supply an explicit Authorization header. Transparently
    // refreshes an expired access token via the refresh_token grant first.
    const autoHeader = await ensureFreshAuthorizationHeader(name, cfg.url, cfg.headers);
    const headers = autoHeader ? { Authorization: autoHeader, ...cfg.headers } : cfg.headers;

    try {
        return await attemptConnect(url, headers);
    } catch (firstError) {
        if (!looksLikeAuthError(firstError)) {
            throw buildConnectError(name, cfg.url, firstError);
        }

        // Looked like an auth rejection: force a refresh (ignoring our own
        // expiry bookkeeping, in case the server invalidated the token
        // early) and retry once with the new token before giving up.
        const refreshedHeader = await ensureFreshAuthorizationHeader(name, cfg.url, cfg.headers, { forceRefresh: true });
        if (!refreshedHeader || refreshedHeader === autoHeader) {
            throw buildConnectError(name, cfg.url, firstError, { hadCachedToken: Boolean(autoHeader) });
        }

        try {
            const retryHeaders = { Authorization: refreshedHeader, ...cfg.headers };
            return await attemptConnect(url, retryHeaders);
        } catch (secondError) {
            throw buildConnectError(name, cfg.url, secondError, { hadCachedToken: true, refreshAttempted: true });
        }
    }
}

function buildConnectError(
    name: string,
    url: string,
    error: unknown,
    opts: { hadCachedToken?: boolean; refreshAttempted?: boolean } = {},
): Error {
    const message = error instanceof Error ? error.message : String(error);
    const hint = opts.refreshAttempted
        ? "A cached OAuth token was refreshed and retried but the server still rejected it - " +
          `run "opencode mcp auth ${name}" to fully re-authenticate.`
        : opts.hadCachedToken
          ? `A cached OAuth token for "${name}" was sent but rejected and could not be refreshed - ` +
            `run "opencode mcp auth ${name}" to fully re-authenticate.`
          : "If this server requires OAuth (as most Atlassian/Slack/Glean-style remotes do), run " +
            `"opencode mcp auth ${name}" once so this extension can reuse + auto-refresh that token, ` +
            'or supply a pre-obtained bearer token via "headers": { "Authorization": "Bearer {env:VAR}" }.';
    return new Error(`MCP server "${name}" (${url}) failed to connect - ${message}. ${hint}`);
}

async function connectLocal(name: string, cfg: { command: string[]; env?: Record<string, string> }): Promise<McpConnection> {
    const [command, ...args] = cfg.command;
    if (!command) throw new Error(`MCP server "${name}" has an empty "command"`);

    const transport = new StdioClientTransport({
        command,
        args,
        env: { ...process.env, ...(cfg.env ?? {}) } as Record<string, string>,
    });
    const client = new Client(CLIENT_INFO);
    await client.connect(transport);
    return { client, transport, transportKind: "stdio" };
}

export async function connectMcpServer(name: string, cfg: McpServerConfig): Promise<McpConnection> {
    return cfg.type === "local" ? connectLocal(name, cfg) : connectRemote(name, cfg);
}
