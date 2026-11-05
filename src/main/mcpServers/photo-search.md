# Photo Search

The independent `photo-search` service supports still photos only:

- `search_images`: query photos, with orientation, color, collection and ordering filters.
- `get_image`: retrieve image versions, credits and a download registration reference.
- `track_download`: register a user's selected photo for use; this is not a media download.

Pagination starts at 1. `per_page` is between 1 and 30, defaulting to 10. Only
search and details are automatically allowed in the built-in Agent. Registration
is non-read-only, requires `user_selected: true`, and is never automatically
retried, including after an authorization or ambiguous network failure.

Searches and previews do not register downloads. When displaying photos, use the
original image URLs, preserve query parameters such as `ixid`, and display the
returned photographer and source attribution links. Generic service branding
does not remove the photo's attribution requirements or original URL provenance.

Requests go to the authenticated, stateless cloud MCP endpoint. Only trusted
cloud or local development destinations are accepted. `PHOTO_SEARCH_MCP_URL`
overrides the endpoint for development; local hosts never receive cloud login
credentials. Responses are size-limited and projected into image metadata,
original references and credits rather than raw upstream payloads.

```bash
pnpm exec vitest run --config src/main/mcpServers/__tests__/photo-search.vitest.config.mjs
```
