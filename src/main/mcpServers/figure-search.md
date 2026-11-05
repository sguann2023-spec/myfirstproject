# Figure Search

The independent `figure-search` service exposes only `search_images`, mapped to
the backend's `search_stickman` tool at `https://open.vectcut.com/stickman/mcp`.
It searches existing stickman figure images, not generated images or arbitrary
media. It does not recolor, upload, download or insert assets into a timeline.
Do not assume a license or guaranteed transparency.

Only `query` and `topk` are accepted. `query` is required, trimmed and limited to
1-2000 Unicode code points. `topk` is an integer from 1 to 50, defaulting to 10.
No `license_key`, `license`, `collection` or `color` parameter is exposed or
forwarded. Authentication is supplied through the current login credential in
the Authorization header; the backend selects its configured collection.

Each successful search consumes 1 resource unit under the backend's existing
project 78 policy. The tool declares `readOnlyHint: false` and
`idempotentHint: false`. A paid `tools/call` is sent only once, even on 401,
network failure, timeout or an invalid response. Errors warn that resources may
have been consumed and require outcome confirmation before another search.
Initialization may refresh expired credentials, but never retries the paid call.

The shared `media-proxy.ts` performs stateless JSON-RPC 2.0 negotiation using
protocol `2025-03-26`: `initialize`, `notifications/initialized`, then
`tools/call`. The operation timeout is 195000 ms. No sessions, result caches or
media fetches are shared across requests. JSON responses are limited to 4 MiB.
Results contain `mediaType`, the validated `query` and image entries projected
to `id`, `score`, `url` and `category`, plus the local tool title. Original HTTP(S)
URLs, including signed query parameters, are preserved. Internal `meta`,
`filename`, `source`, provider fields and raw diagnostics are not returned.

`FIGURE_SEARCH_MCP_URL` overrides the endpoint for development. Only the trusted
cloud origin or localhost/loopback hosts with the exact `/stickman/mcp` path are
accepted; credentials are never sent to local hosts and redirects are rejected.
This addition does not change service registration or helpers.

Run the isolated tests without live networking or resource consumption:

```bash
pnpm exec vitest run --config src/main/mcpServers/__tests__/figure-search.vitest.config.mjs
```
