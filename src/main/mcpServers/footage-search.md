# Footage Search

The independent `footage-search` module uses `media-proxy.ts` and exposes only:

- `search_images`: search still photos, optionally filtering by color.
- `get_image`: retrieve a photo using its positive integer `photo_id`.
- `search_videos`: search stock footage and B-roll, not music or sound effects.
- `get_video`: retrieve a video using its positive integer `video_id`.

Both searches require `query` (1-500 Unicode code points). Pagination starts at
1, with `page` up to 10000 and `per_page` from 1 to 80 (default 15). Optional
filters are `orientation` (landscape/portrait/square), `size` (large/medium/small)
and `locale` from the backend's supported locale list. Only images accept
`color`, a supported named color or `#RRGGBB`. IDs must be safe integers from
1 to 9007199254740991. Unknown tools and parameters fail before network access.

All four operations are read-only. They return projected metadata, original
image versions, video file links/resolutions, preview references and creator
credits, never raw provider JSON or internal diagnostics. Preserve exact URLs
including query parameters. Upstream pagination URLs are replaced by
`has_next_page` and `has_prev_page`; paginate using the search tool's `page`.
Show the returned source link prominently and
credit creators where possible; generic tool branding does not remove URL
provenance or attribution. Check licenses and third-party rights before use.
No download tracking, media download or timeline insertion is performed.

The default endpoint is `https://open.vectcut.com/pexels/mcp`; `/pexel/mcp` is
also allowed. `FOOTAGE_SEARCH_MCP_URL` overrides it for development. The shared
proxy permits only the trusted cloud origin or loopback development hosts,
uses stateless JSON-RPC with bounded responses and existing login/API-key
authentication, and never sends cloud credentials to local hosts. No provider
account or provider API key is requested from the user. The service is registered
in the built-in Agent and local aggregate MCP under the materials domain.

Run the isolated mocked-network tests:

```bash
pnpm exec vitest run --config src/main/mcpServers/__tests__/footage-search.vitest.config.mjs
```
