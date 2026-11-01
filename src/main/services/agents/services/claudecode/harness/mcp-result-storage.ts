import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const INLINE_LIMIT_BYTES = 16 * 1024

export function projectMcpArtifactForContext(
  result: { details?: unknown },
  workspacePath: string
): { content: Array<{ type: 'text'; text: string }>; details: Record<string, unknown> } | undefined {
  const details = result.details as Record<string, unknown> | undefined
  const artifact = details?.artifact as { file_path?: unknown; bytes?: unknown } | undefined
  // Only project artifacts saved by the local preservation path, not remote references.
  if (!artifact || typeof artifact.file_path !== 'string'
    || path.resolve(path.dirname(artifact.file_path)) !== path.resolve(workspacePath, '.tool-results')
    || !/^[a-f0-9-]{36}\.json$/.test(path.basename(artifact.file_path))
    || typeof artifact.bytes !== 'number' || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0) {
    return undefined
  }
  const savedArtifact = { file_path: artifact.file_path, bytes: artifact.bytes }
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        offloaded: true,
        reason: 'Full MCP result saved outside context. Inspect only needed fields with Bash/jq; do not inline the full file or Base64. Do not repeat the API call. Load images only when visual inspection is needed.',
        artifact: savedArtifact
      })
    }],
    // Do not retain structuredContent copies of images in Pi history either.
    details: { artifact: savedArtifact, ...(details?.billing !== undefined ? { billing: details.billing } : {}) }
  }
}

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
    // Save standalone text directly for jq, but retain structured data when present.
    const content = result.content
    const raw = result.structuredContent === undefined
      && Array.isArray(content) && content.length === 1 && content[0]?.type === 'text'
      ? content[0].text : text
    await fsp.writeFile(filePath, raw, { encoding: 'utf8', mode: 0o600 })
    details.artifact = { file_path: filePath, bytes: Buffer.byteLength(raw, 'utf8') }
  }
  return { content: result.content, details: Object.keys(details).length ? details : undefined }
}
