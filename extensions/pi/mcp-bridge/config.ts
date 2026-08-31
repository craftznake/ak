import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// mcp-bridge/config: loads MCP server definitions by reusing opencode's own
// `mcp` config block (see ~/.config/opencode/opencode.json) as the single
// source of truth, so servers only need to be defined once across harnesses.
//
// Server shape mirrors opencode's mcp config exactly:
//   "remote": { "type": "remote", "url": "...", "headers"?: {...} }
//   "local":  { "type": "local", "command": ["cmd", "arg"], "env"?: {...} }
// `{env:VAR}` tokens inside "env"/"headers" values are resolved the same way
// opencode resolves them (against process.env).

export type McpRemoteServerConfig = {
    type: "remote";
    url: string;
    headers?: Record<string, string>;
    enabled?: boolean;
};

export type McpLocalServerConfig = {
    type: "local";
    command: string[];
    env?: Record<string, string>;
    enabled?: boolean;
};

export type McpServerConfig = McpRemoteServerConfig | McpLocalServerConfig;
export type McpServerMap = Record<string, McpServerConfig>;

export type LoadedMcpConfig = {
    servers: McpServerMap;
    sources: string[];
    warnings: string[];
};

const ENV_TOKEN_RE = /\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Resolve `{env:VAR}` tokens the same way opencode's mcp config does. */
export function interpolateEnv(value: string): string {
    return value.replace(ENV_TOKEN_RE, (_match, name: string) => process.env[name] ?? "");
}

function interpolateRecord(record: Record<string, string> | undefined): Record<string, string> | undefined {
    if (!record) return undefined;
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(record)) result[key] = interpolateEnv(value);
    return result;
}

/**
 * Best-effort JSONC comment stripper. Tracks string/comment state character
 * by character so it never mangles a `//` that appears inside a string value
 * (e.g. `"url": "https://example.com"`), unlike a naive regex strip.
 */
export function stripJsonComments(text: string): string {
    let out = "";
    let inString = false;
    let stringQuote = "";
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const next = text[i + 1];

        if (inLineComment) {
            if (ch === "\n") {
                inLineComment = false;
                out += ch;
            }
            continue;
        }

        if (inBlockComment) {
            if (ch === "*" && next === "/") {
                inBlockComment = false;
                i++;
            }
            continue;
        }

        if (inString) {
            out += ch;
            if (ch === "\\") {
                out += next ?? "";
                i++;
                continue;
            }
            if (ch === stringQuote) inString = false;
            continue;
        }

        if (ch === '"' || ch === "'") {
            inString = true;
            stringQuote = ch;
            out += ch;
            continue;
        }

        if (ch === "/" && next === "/") {
            inLineComment = true;
            i++;
            continue;
        }

        if (ch === "/" && next === "*") {
            inBlockComment = true;
            i++;
            continue;
        }

        out += ch;
    }

    return out;
}

async function readJsonFile(path: string): Promise<unknown | undefined> {
    if (!existsSync(path)) return undefined;
    const raw = await readFile(path, "utf8");
    const cleaned = path.endsWith(".jsonc") ? stripJsonComments(raw) : raw;
    return JSON.parse(cleaned);
}

function extractServerMap(data: unknown): McpServerMap {
    if (!data || typeof data !== "object") return {};
    const mcp = (data as { mcp?: unknown }).mcp;
    if (!mcp || typeof mcp !== "object") return {};
    return mcp as McpServerMap;
}

function opencodeConfigPaths(): string[] {
    if (process.env.AK_OPENCODE_CONFIG) return [resolve(process.env.AK_OPENCODE_CONFIG)];
    const dir = join(homedir(), ".config", "opencode");
    return [join(dir, "opencode.json"), join(dir, "opencode.jsonc")];
}

/**
 * Load MCP server definitions.
 *
 * Merge order (later sources win on name collision):
 *   1. Global opencode config (`$AK_OPENCODE_CONFIG` or `~/.config/opencode/opencode.json[c]`)
 *   2. `$AK_MCP_CONFIG` - explicit override/addendum file, same `{ "mcp": {...} }` shape
 *   3. Project-local `.pi/mcp.json` under `cwd` - same shape, highest priority
 *
 * Servers with `enabled: false` are dropped. Malformed/missing files produce
 * a warning instead of throwing, so a typo in one source never blocks the
 * others from loading.
 */
export async function loadMcpServers(cwd: string): Promise<LoadedMcpConfig> {
    const servers: McpServerMap = {};
    const sources: string[] = [];
    const warnings: string[] = [];

    const candidatePaths = [...opencodeConfigPaths()];
    if (process.env.AK_MCP_CONFIG) candidatePaths.push(resolve(process.env.AK_MCP_CONFIG));
    candidatePaths.push(resolve(cwd, ".pi", "mcp.json"));

    for (const path of candidatePaths) {
        try {
            const data = await readJsonFile(path);
            if (data === undefined) continue;
            const map = extractServerMap(data);
            if (Object.keys(map).length === 0) continue;
            Object.assign(servers, map);
            sources.push(path);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warnings.push(`Failed to read MCP config ${path}: ${message}`);
        }
    }

    for (const [name, cfg] of Object.entries(servers)) {
        if (cfg.enabled === false) {
            delete servers[name];
            continue;
        }
        if (cfg.type === "local") {
            servers[name] = { ...cfg, env: interpolateRecord(cfg.env) };
        } else if (cfg.type === "remote") {
            servers[name] = { ...cfg, headers: interpolateRecord(cfg.headers) };
        }
    }

    return { servers, sources, warnings };
}
