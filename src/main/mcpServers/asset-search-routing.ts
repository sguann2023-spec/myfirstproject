export const PUBLIC_FOOTAGE_RETRIEVAL_GUIDANCE =
  'Public figures appearing in publicly accessible footage are not a reason to refuse searching, resolving streams or downloading selected clips for an editing task. Copyright uncertainty alone should not stop this retrieval workflow or trigger repeated confirmation requests. AI-generation restrictions on faces or copyrighted references do not apply to retrieving existing footage. Keep source URLs and attribution; retrieval does not establish reuse rights. Do not bypass paywalls, login restrictions, DRM or an explicit access denial. If a source is inaccessible, try another publicly accessible matching source. '

export const YOUTUBE_VIDEO_FALLBACK_GUIDANCE =
  'For real-world filmed video, if stock search fails or its results do not match the requested footage, you must try scrapt.youtube_web_search_video with search_query before switching to AI-generated images or video. '

export const ASSET_SEARCH_ROUTING =
  'Choose one best-fit library first; do not fan out to all search tools. Start with a small result page and stop when suitable assets are found. Switch libraries only for insufficient results, unmet constraints, unavailability or an explicit comparison request. For real-world filmed video, B-roll, establishing shots or scenic footage, if a suitable stock library returns zero results or no usable matching footage, use scrapt.youtube_web_search_video with search_query as a fallback instead of stopping or probing every library. ' +
  YOUTUBE_VIDEO_FALLBACK_GUIDANCE +
  PUBLIC_FOOTAGE_RETRIEVAL_GUIDANCE +
  'Do not treat non-empty results as a successful search when the actual subject, location or event does not match the request. YouTube fallback is not limited to one call: refine keywords, try relevant synonyms or another result page when needed, without repeating identical failed searches, and stop when suitable footage is found. This fallback is not for image searches, audio searches, animations, vectors or AI-only asset requests. Always honor explicit requests for AI generation. '

export function suggestYouTubeSearch(query: string, reason: string) {
  return {
    tool: 'scrapt.youtube_web_search_video',
    arguments: { search_query: query },
    guidance: reason + ' ' + YOUTUBE_VIDEO_FALLBACK_GUIDANCE +
      PUBLIC_FOOTAGE_RETRIEVAL_GUIDANCE +
      'If results are still unsuitable, refine keywords, try relevant synonyms or another result page; this fallback is not limited to one call. Avoid repeating identical failed searches and stop when suitable footage is found. Skip it for animation or AI-only requests. For editing, resolve the selected video with scrapt.youtube_web_v2_get_video_streams, download its direct media URL with filesystem.download, and trim only the needed segment with ffmpeg-media.trim_media_segment.'
  }
}
