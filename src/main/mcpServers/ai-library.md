# AI Library

`ai-library` searches shared, already-generated image and video assets across
users. It is not a generation service or a current-user history view. All four
tools are read-only; none generates, bills, downloads, or inserts timeline items.
Honor explicit requests for new generation and check reuse rights before use.

| Public tool | Upstream tool | Required input |
| --- | --- | --- |
| `search_images` | `search_ai_images` | `query` |
| `search_videos` | `search_ai_videos` | `query` |
| `get_image` | `get_ai_image` | `log_id` |
| `get_video` | `get_ai_video` | `log_id` |

Only these four mappings are exposed; upstream discovery is not forwarded.
Search accepts `mode` (`semantic` by default, or `keyword`), `limit` (1-50,
default 20), `size`, and `model`. `provider` and user/reference filters are not
accepted. Details require a positive safe integer `log_id` from a library result.
Keyword search matches literal prompt substrings, newest first. Semantic results
are bounded candidates, not exhaustive pagination; `has_more_in_window` does not
mean there is a next-page API.

Asset output is explicitly projected to `log_id`, `prompt`, `image_url` or
`video_url`, `size`, `model`, and finite `score` when available. Search envelopes
retain only computed count, selected mode and boolean continuation/bounded flags.
Provider, user identities, reference inputs, timestamps, fallback markers, raw
payloads, database details and candidate diagnostics are not forwarded. Videos
must have a trimmed, case-insensitive status of `success`, `succeeded`,
`completed`, or `done`; other videos are excluded from search and rejected for
details. Status is used for validation, not exposed as metadata.

`duration_ms` is generation elapsed time, **not video playback duration**. It is
omitted, never renamed to `duration`. Probe selected media separately if playback
duration is needed. Preserve the original media URL and signed query parameters;
the proxy does not fetch media or cache expiring URLs.

The implementation uses the existing `media-proxy.ts` without modifying it.
The default endpoint is `https://open.vectcut.com/vectdash/mcp`; the alias
`/ai_history/mcp` is also accepted. `AI_LIBRARY_MCP_URL` overrides the endpoint.
Only the trusted cloud origin or loopback development hosts are allowed, with
either exact path, no credentials/query/fragment. Local endpoints receive no
cloud credentials. Authentication, bounded JSON responses, stateless per-call
initialization and sanitized errors are provided by the shared proxy.

The contract is based on `backend/vectdash/app.py` and `history_db.py` in the
sibling `CapCutPreviewer` repository. No registration or helper changes are made.

```bash
pnpm exec vitest run --config src/main/mcpServers/__tests__/ai-library.vitest.config.mjs
```
