import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

// mcp-bridge/oauth: makes OAuth-gated remote MCP servers (mcp-gitlab,
// Atlassian, Slack, Glean, ...) usable without a browser, by doing the
// *refresh_token* half of the OAuth dance ourselves whenever a usable
// refresh token is already on disk.
//
// We deliberately reuse opencode's own token cache
// (`~/.local/share/opencode/mcp-auth.json`, same file its own MCP client
// writes to after completing the interactive browser flow) instead of
// inventing a second store: run `opencode mcp auth <name>` once (in
// opencode, since it owns the browser-based authorization_code+PKCE flow),
// and from then on this extension can silently refresh + reuse that token
// for as long as the refresh token stays valid - no browser involved, no
// re-running opencode.
//
// What this does NOT do: complete the initial authorization_code grant
// (needs a browser + redirect listener). If a server has no cached entry at
// all, `ensureFreshAuthorizationHeader` returns undefined and the caller
// falls back to the previous behavior (fail with a message pointing at a
// pre-obtained bearer token override).

export type OAuthTokens = {
    accessToken: string;
    refreshToken?: string;
    /** Unix seconds. */
    expiresAt?: number;
    scope?: string;
};

export type OAuthClientInfo = {
    clientId: string;
    clientSecret?: string;
    clientIdIssuedAt?: number;
    clientSecretExpiresAt?: number;
};

export type OAuthEntry = {
    tokens: OAuthTokens;
    clientInfo?: OAuthClientInfo;
    serverUrl?: string;
};

type OAuthStore = Record<string, OAuthEntry>;

const AUTH_SKEW_SECONDS = 60;

function storePath(): string {
    if (process.env.AK_MCP_OAUTH_STORE) return resolve(process.env.AK_MCP_OAUTH_STORE);
    const dataHome = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
    return join(dataHome, "opencode", "mcp-auth.json");
}

async function readStore(): Promise<OAuthStore> {
    try {
        const raw = await readFile(storePath(), "utf8");
        return JSON.parse(raw) as OAuthStore;
    } catch {
        return {};
    }
}

async function writeStore(store: OAuthStore): Promise<void> {
    const path = storePath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(store, null, 4)}\n`, { mode: 0o600 });
}

async function updateEntry(serverName: string, patch: OAuthEntry): Promise<void> {
    const store = await readStore();
    const existing = store[serverName];
    store[serverName] = {
        ...existing,
        ...patch,
        tokens: { ...existing?.tokens, ...patch.tokens },
        clientInfo: patch.clientInfo ?? existing?.clientInfo,
    };
    await writeStore(store);
}

function isExpired(tokens: OAuthTokens): boolean {
    if (typeof tokens.expiresAt !== "number") return false; // unknown TTL: assume still good
    return Date.now() / 1000 + AUTH_SKEW_SECONDS >= tokens.expiresAt;
}

async function tryFetchJson(url: string): Promise<Record<string, unknown> | undefined> {
    try {
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        if (!res.ok) return undefined;
        return (await res.json()) as Record<string, unknown>;
    } catch {
        return undefined;
    }
}

/**
 * Discover the OAuth 2.0 token endpoint for a remote MCP server, per the
 * discovery chain both RFC 8414 (authorization server metadata) and
 * RFC 9728 (protected resource metadata -> authorization_servers) describe.
 */
async function discoverTokenEndpoint(serverUrl: string): Promise<string | undefined> {
    const origin = new URL(serverUrl).origin;

    const direct = await tryFetchJson(`${origin}/.well-known/oauth-authorization-server`);
    if (typeof direct?.token_endpoint === "string") return direct.token_endpoint;

    const protectedResource = await tryFetchJson(`${origin}/.well-known/oauth-protected-resource`);
    const servers = protectedResource?.authorization_servers;
    const issuer = Array.isArray(servers) ? servers[0] : undefined;
    if (typeof issuer === "string") {
        const issuerOrigin = new URL(issuer).origin;
        const meta = await tryFetchJson(`${issuerOrigin}/.well-known/oauth-authorization-server`);
        if (typeof meta?.token_endpoint === "string") return meta.token_endpoint;
    }

    return undefined;
}

type RefreshResult = { accessToken: string; refreshToken?: string; expiresAt?: number; scope?: string };

async function performRefresh(
    tokenEndpoint: string,
    clientId: string,
    refreshToken: string,
    clientSecret?: string,
): Promise<RefreshResult | undefined> {
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId });
    if (clientSecret) body.set("client_secret", clientSecret);

    const res = await fetch(tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    });
    if (!res.ok) return undefined;

    const json = (await res.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
    };
    if (!json.access_token) return undefined;

    return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token ?? refreshToken,
        expiresAt: typeof json.expires_in === "number" ? Date.now() / 1000 + json.expires_in : undefined,
        scope: json.scope,
    };
}

/**
 * Best-effort: turn a cached OAuth entry for `serverName` into a fresh
 * `Authorization: Bearer <token>` header value, refreshing first if the
 * cached access token is expired (or `forceRefresh` is set, e.g. after a
 * 401 mid-session). Returns undefined when there's nothing usable -
 * no cached entry, or the caller already supplies an explicit
 * "Authorization" header (which always wins).
 */
export async function ensureFreshAuthorizationHeader(
    serverName: string,
    serverUrl: string,
    explicitHeaders: Record<string, string> | undefined,
    opts: { forceRefresh?: boolean } = {},
): Promise<string | undefined> {
    if (explicitHeaders && Object.keys(explicitHeaders).some((key) => key.toLowerCase() === "authorization")) {
        return undefined;
    }

    const entry = (await readStore())[serverName];
    if (!entry?.tokens?.accessToken) return undefined;

    if (!opts.forceRefresh && !isExpired(entry.tokens)) {
        return `Bearer ${entry.tokens.accessToken}`;
    }

    if (!entry.tokens.refreshToken || !entry.clientInfo?.clientId) {
        // Nothing to refresh with - hand back whatever we have. If it's
        // actually stale the caller's 401 retry will surface a clear error.
        return `Bearer ${entry.tokens.accessToken}`;
    }

    try {
        const tokenEndpoint = await discoverTokenEndpoint(entry.serverUrl ?? serverUrl);
        if (!tokenEndpoint) return `Bearer ${entry.tokens.accessToken}`;

        const refreshed = await performRefresh(
            tokenEndpoint,
            entry.clientInfo.clientId,
            entry.tokens.refreshToken,
            entry.clientInfo.clientSecret,
        );
        if (!refreshed) return `Bearer ${entry.tokens.accessToken}`;

        await updateEntry(serverName, {
            serverUrl: entry.serverUrl ?? serverUrl,
            clientInfo: entry.clientInfo,
            tokens: refreshed,
        });

        return `Bearer ${refreshed.accessToken}`;
    } catch {
        return `Bearer ${entry.tokens.accessToken}`;
    }
}

/** True when an error looks like an OAuth bearer-token rejection (401 / invalid_token). */
export function looksLikeAuthError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /\b401\b|invalid_token|unauthorized/i.test(message);
}
