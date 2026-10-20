# Bounded MCP compatibility preflight

**Passed for the selected pair:** the actual upstream Agent client initialized the filesystem MCP connection, listed tools, wrote a file inside a disposable allowed directory and read its contents back. The program also checked the file's actual bytes. This establishes interoperability for those operations, not cancellation behavior or the complete basic example's model loop.

No model APIs were called and no stop/cancel/recovery experiment was run. The preflight used Python 3.12.14 on Linux and Node.js 24.19.0. The pinned server requires Node.js 24 or later.

| Component | Exact tested source/environment |
|---|---|
| mcp-agent | `f62d849350816588b1c6294e7914bbe4d8b84072`, package 0.2.6 |
| Python MCP SDK | 1.23.1 from the upstream frozen `uv.lock` |
| Filesystem server | `51b6382a3e827aceb6bce430b1208d69b93d95ea`, source package 2.0.0 |
| Host-only dependency addition | `socksio==1.0.0` for the sandbox's SOCKS proxy |

The first attempt stopped before the MCP handshake because the host proxy required that optional dependency. After installing it, the same client/server revisions passed. Both attempts are retained. Tracked upstream source and lock files were unchanged. Source-lock hashes and the built server entrypoint hash are recorded in `evidence/mcp-smoke.json`. Setup plus the passing run completed within the prospective 30-minute budget; its measured total is recorded in `INTEGRATION_SELECTION.json`.

## Explicit profile changes

- Keep the upstream Agent client, filesystem server and stdio transport.
- Restrict the server to a disposable allowed directory and disable the fetch server.
- Replace the read/fetch demonstration task with an explicitly requested file write and a read-back check.
- Disable usage/export telemetry.
- For this compatibility check only, invoke the real tools directly through `Agent.call_tool`; no model chooses the tools.

The funded MCP profile is **in-flight tool calls only**, with benign and already-committed controls. This target has no queue or delegation profile and will not be presented as covering the pilot's retry/recovery scenarios. In-flight cancellation and real-model stop messages remain untested.

## Reproduction outline (Linux)

Check out both repositories at the revisions above, using Node.js 24+ and Python 3.12. In the mcp-agent checkout run `uv sync --frozen --no-dev`. Add `socksio==1.0.0` only if the host uses a SOCKS proxy. In the MCP servers checkout run:

```bash
npm ci --ignore-scripts --workspace=@modelcontextprotocol/server-filesystem --include-workspace-root=false --no-audit --no-fund
npm run build --workspace=@modelcontextprotocol/server-filesystem
```

Then use the mcp-agent environment's Python to run `scripts/mcp_compat_smoke.py`, passing `--agent-source`, `--server-source` and an output JSON path through `--out`. The script verifies the revisions, sets a 90-second protocol-operation bound, records failures and uses an automatically removed directory for the file effect. Whole-setup timing remains governed by the separate 30-minute preflight budget.
