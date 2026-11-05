# Stock Media Search

The `stock-search` service provides four read-only tools:

- `search_videos`: search footage, B-roll and backgrounds.
- `get_video`: retrieve a selected video's media references.
- `search_audios`: search music tracks and background music.
- `get_audio`: retrieve a selected track's preview and download references.

Searches require `query`; details require the ID from a search result. Pagination
is zero-based with `page_size` between 1 and 100 (default 20). No dedicated sound
effect capability is assumed, and no generation, download or editing is exposed.

The tool list is static and restricted locally as well as by the search gateway.
Cloud calls carry the current login credential with refresh support. Each request
uses its own MCP session and closes it afterwards. The service supports JSON and
SSE responses, limits response size, and returns selected media metadata rather
than analytics identifiers, internal filenames or arbitrary upstream payloads.
Original media URLs remain available for previews and subsequent downloads.

`STOCK_SEARCH_MCP_URL` can select a local development endpoint. Arbitrary remote
hosts and redirects are rejected; cloud credentials are never sent to local hosts.

```bash
pnpm exec vitest run --config src/main/mcpServers/__tests__/stock-search.vitest.config.mjs
```
