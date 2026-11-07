/** UI-only direct-request metadata. Never copy arbitrary message fields into presentation. */
export const DIRECT_REQUEST_METADATA_FIELDS = Object.freeze([
  'draftRequest', 'draftExportRequest', 'draftDownloadRequest', 'draftModifyRequest',
  'textAddRequest', 'presetAddRequest', 'speechRequest', 'seedAudioRequest',
  'voiceConversionRequest', 'audioAddRequest', 'imageAddRequest', 'aiVideoRequest',
  'imageGenerateRequest', 'digitalHumanRequest', 'draftInspectRequest', 'reversePromptRequest',
  'subtitleRecognitionRequest', 'subtitleStoryboardRequest', 'videoUnderstandRequest', 'skillTemplateSource'
] as const)

export type DirectRequestMetadataField = typeof DIRECT_REQUEST_METADATA_FIELDS[number]
export type DirectRequestMetadata = Partial<Record<DirectRequestMetadataField, unknown>>

/** Extract own, defined whitelist fields without mutating the input (payloads stay opaque). */
export function extractDirectRequestMetadata(value: unknown): DirectRequestMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  const result: DirectRequestMetadata = {}
  for (const field of DIRECT_REQUEST_METADATA_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(source, field) && source[field] !== undefined) {
      result[field] = source[field]
    }
  }
  return result
}
