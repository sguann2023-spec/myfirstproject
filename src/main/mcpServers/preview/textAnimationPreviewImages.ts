import { net } from 'electron'
import sharp from 'sharp'

export type TextAnimationPreviewKind = 'intro' | 'outro' | 'loop'

export type TextAnimationPreviewItem = {
  name: string
  title?: string
  preview_url: string
}

export type TextAnimationPreviewImage = {
  item: TextAnimationPreviewItem
  buffer: Buffer
  base64: string
  mimeType: 'image/png'
  width: number
  height: number
}

export type TextAnimationPreviewImagesResult = {
  rendered: TextAnimationPreviewImage[]
  failed: Array<{ name: string; reason: string }>
}

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 15000

const fetchArrayBuffer = async (url: string, timeoutMs: number): Promise<Buffer> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await net.fetch(url, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const ab = await response.arrayBuffer()
    return Buffer.from(ab)
  } finally {
    clearTimeout(timer)
  }
}

export const fetchTextAnimationPreviewImages = async (
  items: TextAnimationPreviewItem[],
  options: { downloadTimeoutMs?: number } = {}
): Promise<TextAnimationPreviewImagesResult> => {
  const validItems = Array.isArray(items) ? items.filter((it) => it && it.preview_url) : []
  const timeoutMs = Math.max(1000, Math.round(options.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS))

  const results = await Promise.all(
    validItems.map(async (item) => {
      try {
        // The backend preview_url is already a single animation contact sheet (3x3 frames).
        // Do not stitch multiple animations into another sprite, or the frame grid becomes unreadable.
        const source = await fetchArrayBuffer(item.preview_url, timeoutMs)
        const metadata = await sharp(source).metadata()
        const png = await sharp(source).png().toBuffer()
        return {
          image: {
            item,
            buffer: png,
            base64: png.toString('base64'),
            mimeType: 'image/png' as const,
            width: metadata.width ?? 0,
            height: metadata.height ?? 0
          },
          error: null as string | null
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { image: null, error: message, item }
      }
    })
  )

  return {
    rendered: results.flatMap((result) => result.image ? [result.image] : []),
    failed: results.flatMap((result) => result.image ? [] : [{ name: result.item.name, reason: result.error ?? 'unknown' }])
  }
}
