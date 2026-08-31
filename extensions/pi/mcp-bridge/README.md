# mcp-bridge

Pi extension that lets the Pi coding agent call MCP (Model Context Protocol)
servers as tools. Pi has no built-in MCP client (by design - see the pi
README's "No MCP" note), so this bridges the gap: it connects to configured
MCP servers with the official `@modelcontextprotocol/sdk` and registers each
discovered MCP tool as a Pi tool via `pi.registerTool()`.

## Config reuse

Servers are **not** redefined here. This extension reads the same `mcp`
config block already used for the opencode agent:

```
~/.config/opencode/opencode.json  ->  .mcp
```

so a server only needs to be defined once across harnesses. Shape per server
(identical to opencode's):

```json
{
  "mcp": {
    "my-remote": { "type": "remote", "url": "https://example/mcp" },
    "my-local": {
      "type": "local",
      "command": ["uvx", "my-mcp-server"],
      "env": { "TOKEN": "{env:MY_TOKEN}" }
    }
  }
}
```

`{env:VAR}` tokens in `env`/`headers` resolve against `process.env`, same as
opencode.

Additional layered sources, later wins on name collision:

1. `$AK_OPENCODE_CONFIG` (defaults to `~/.config/opencode/opencode.json[c]`)
2. `$AK_MCP_CONFIG` - path to an extra file with the same `{ "mcp": {...} }` shape
3. `.pi/mcp.json` under the current project - same shape, highest priority

Set `"enabled": false` on a server entry to keep its definition around
without connecting it.

## Usage

```
/mcp                        show configured servers and connection status
/mcp connect <name|all>     connect a server and register its tools
/mcp disconnect <name|all>  disconnect a server and drop its registered tools
```

Connections are lazy and opt-in: nothing connects until you run
`/mcp connect`. To auto-connect on every session start, set:

```sh
export AK_MCP_AUTOCONNECT="my-local,my-remote"   # or "all"
```

Registered tools are named `mcp__<server>__<tool>` (sanitized, max 64 chars).

## Known limitation: OAuth-gated remotes

Several of the "remote" MCP servers wired up for opencode on this machine
(Atlassian, Slack, Glean, GitLab, corp-gws-mcp, Datadog, ...) are gated
behind an interactive OAuth flow that opencode's own MCP client completes
via a browser redirect. **This extension has no OAuth/browser UI**, so those
servers will fail to connect with an auth error unless you supply a
pre-obtained bearer token:

```json
{
  "mcp": {
    "some-remote": {
      "type": "remote",
      "url": "https://example/mcp",
      "headers": { "Authorization": "Bearer {env:SOME_REMOTE_TOKEN}" }
    }
  }
}
```

Put the override in `$AK_MCP_CONFIG` or `.pi/mcp.json` rather than editing
opencode's config, since opencode's OAuth-managed servers should stay as-is.

Local/stdio servers (e.g. `mcp-kibana-search`, which authenticates via plain
env vars) work out of the box with no extra config.

## Setup

This extension has its own npm dependency (`@modelcontextprotocol/sdk`), so
it needs `npm install` once:

```sh
cd extensions/pi/mcp-bridge
npm install
```

`install.sh` does this automatically when `npm` is on `PATH`.
