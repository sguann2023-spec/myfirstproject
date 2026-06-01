export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource_link'; uri: string; name: string; title?: string; mimeType?: string }

export function successResponse(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
    isError: false
  }
}

export function imageResponse(base64: string, mimeType = 'image/png') {
  return {
    content: [{ type: 'image' as const, data: base64, mimeType }],
    isError: false
  }
}

export function imageResourceLinkResponse(uri: string, mimeType = 'image/png', name = 'screenshot') {
  return {
    structuredContent: {
      publicUrl: uri,
      url: uri,
      mimeType,
      uploadedImageUrls: [uri],
      text: `Screenshot uploaded: ${uri}`
    },
    content: [
      { type: 'text' as const, text: `Screenshot uploaded: ${uri}` },
      { type: 'resource_link' as const, uri, name, title: name, mimeType }
    ],
    isError: false
  }
}

export function errorResponse(error: Error | string) {
  const message = error instanceof Error ? error.message : error
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true
  }
}
