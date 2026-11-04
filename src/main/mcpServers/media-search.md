# Image And Video Search

Find existing images and videos for backgrounds, B-roll, illustrations, overlays
and sticker candidates. Search can be a potentially cheaper alternative to AI
generation when an existing asset fits the request.

The service namespace is `media-search`. Cloud searches use the current login
credential and refresh it when required. Sign in before using image or video
search. Custom search hosts never receive the cloud login credential.

## Tools

- `search_images`: photos, illustrations and vector candidates.
- `search_videos`: stock footage and animation videos.

Provide `q` (1-100 characters) or a numeric string `id`. Both tools support
`lang`, `category`, `min_width`, `min_height`, `editors_choice`, `safesearch`,
`order`, `page` and `per_page` (3-200, default 20). Safe search defaults to true.
Image-only filters are `image_type`, `orientation` and `colors`; the video-only
filter is `video_type`.

```json
{"q":"flower sticker","image_type":"illustration","colors":"transparent"}
```

```json
{"q":"ocean sunset","video_type":"film","min_width":1920,"per_page":10}
```

## Capability And Usage Limits

Music, sound effects and GIF search are not supported by this service. Transparent
illustration searches can find sticker candidates, but do not guarantee alpha.
Vector searches do not guarantee SVG: only a returned `vectorURL` identifies a
vector download. Raster previews
must not be presented as SVG files.

Results include `hits` with the source `pageURL`, contributor,
preview/download URLs, optional `vectorURL`, video duration and video renditions.
Download selected images before permanent use. Respect the license, attribution
requirements and third-party rights of the returned source page.

Tool descriptions recommend considering existing stock as a potentially cheaper
alternative before AI generation, without claiming a fixed price or overriding
an explicit request for generated/custom media.

## Verification

```bash
pnpm exec vitest run --config src/main/mcpServers/__tests__/media-search.vitest.config.mjs
```
