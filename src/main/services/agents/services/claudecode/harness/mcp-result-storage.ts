import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const INLINE_LIMIT_BYTES = 16 * 1024

export async function preserveMcpResult(
  result: { content?: unknown; structuredContent?: unknown },
  workspacePath: string
): Promise<{ content: unknown; details: unknown }> {
  const text = JSON.stringify(result)
  const details = result.structuredContent && typeof result.structuredContent === 'object'
    ? { ...result.structuredContent as Record<string, unknown> }
    : {}
  if (!details.billing && Array.isArray(result.content)) {
    for (const item of result.content) {
      if (item?.type !== 'text') continue
      try {
        const parsed = JSON.parse(item.text)
        if (parsed?.billing) details.billing = parsed.billing
      } catch {
        // Non-JSON tool content has no embedded billing metadata.
      }
    }
  }
  if (Buffer.byteLength(text, 'utf8') > INLINE_LIMIT_BYTES) {
    const directory = path.join(workspacePath, '.tool-results')
    await fsp.mkdir(directory, { recursive: true })
    const filePath = path.join(directory, `${randomUUID()}.json`)
    // Save a single text payload directly so jq can read the provider's JSON.
    const content = result.content
    const raw = Array.isArray(content) && content.length === 1 && content[0]?.type === 'text'
      ? content[0].text : text
    await fsp.writeFile(filePath, raw, { encoding: 'utf8', mode: 0o600 })
    details.artifact = { file_path: filePath, bytes: Buffer.byteLength(raw, 'utf8') }
  }
  return { content: result.content, details: Object.keys(details).length ? details : undefined }
}
