import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages/messages'
import { loggerService } from '@logger'
import { ossUploadService } from '@main/services/OssUploadService'

const logger = loggerService.withContext('ClaudeCodeMessageContent')
const IMAGE_MAX_DIMENSION = 2000
const IMAGE_MAX_BYTES = 5 * 1024 * 1024

export async function buildMessageContent(
  prompt: string,
  images?: Array<{ data: string; media_type: string }>
): Promise<string | ContentBlockParam[]> {
  if (!images || images.length === 0) {
    return prompt
  }

  const blocks: ContentBlockParam[] = [{ type: 'text', text: prompt }]

  const uploadedImages = await Promise.all(
    images.map(async (image) => {
      const resized = await resizeImageIfNeeded(image.data, image.media_type)
      const uploaded = await ossUploadService.uploadImageBase64(resized.data, resized.media_type)
      return { ...uploaded, media_type: resized.media_type }
    })
  )

  for (const uploaded of uploadedImages) {
    blocks.push({
      type: 'image',
      source: {
        type: 'url',
        url: uploaded.publicUrl
      }
    })
  }

  return blocks
}

export async function resizeImageIfNeeded(
  base64Data: string,
  mediaType: string
): Promise<{ data: string; media_type: string }> {
  try {
    const { default: sharp } = await import('sharp')
    let buffer: Buffer = Buffer.from(base64Data, 'base64')
    const metadata = await sharp(buffer).metadata()

    let width = metadata.width ?? 0
    let height = metadata.height ?? 0

    const needsResize = width > IMAGE_MAX_DIMENSION || height > IMAGE_MAX_DIMENSION
    const needsShrink = buffer.length > IMAGE_MAX_BYTES
    const needsConvert = mediaType !== 'image/png'

    if (!needsResize && !needsShrink && !needsConvert) {
      return { data: base64Data, media_type: mediaType }
    }

    if (needsResize) {
      const scale = Math.min(IMAGE_MAX_DIMENSION / width, IMAGE_MAX_DIMENSION / height)
      width = Math.round(width * scale)
      height = Math.round(height * scale)
      buffer = await sharp(buffer).resize(width, height, { fit: 'inside', withoutEnlargement: true }).png().toBuffer()
      logger.info('Resized oversized image for Claude API', {
        original: `${metadata.width}x${metadata.height}`,
        resized: `${width}x${height}`
      })
    } else if (needsConvert || needsShrink) {
      buffer = await sharp(buffer).png().toBuffer()
    }

    let attempt = 0
    while (buffer.length > IMAGE_MAX_BYTES && attempt < 5) {
      attempt += 1
      const shrinkFactor = 0.7
      width = Math.round(width * shrinkFactor)
      height = Math.round(height * shrinkFactor)
      buffer = await sharp(buffer).resize(width, height, { fit: 'inside', withoutEnlargement: true }).png().toBuffer()
      logger.info('Shrinking image to fit 5MB API limit', {
        attempt,
        size: `${(buffer.length / 1024 / 1024).toFixed(1)}MB`,
        dimensions: `${width}x${height}`
      })
    }

    if (buffer.length > IMAGE_MAX_BYTES) {
      logger.warn('Image still exceeds 5MB after shrinking, passing through', {
        size: `${(buffer.length / 1024 / 1024).toFixed(1)}MB`
      })
    }

    return {
      data: buffer.toString('base64'),
      media_type: 'image/png'
    }
  } catch (error) {
    logger.warn('Image resize failed, passing through as-is', {
      error: error instanceof Error ? error.message : String(error)
    })
    return { data: base64Data, media_type: mediaType }
  }
}
