import path from 'node:path'
import { fileURLToPath } from 'node:url'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** Tracks confirmed image results, including local copies, within one agent invocation. */
export class ImageInspectionState {
  private readonly generatedSources = new Set<string>()

  constructor(private readonly workspacePath: string) {}

  private sourceKey(source: string): string {
    if (source.startsWith('file://')) return fileURLToPath(source)
    return /^(https?:|data:)/i.test(source) ? source : path.resolve(this.workspacePath, source)
  }

  recordSuccess(toolName: string, args: Record<string, unknown>, result: unknown): void {
    if (toolName === 'mcp__vectcut__filesystem-server__download') {
      if (typeof args.url === 'string' && this.generatedSources.has(this.sourceKey(args.url)) && typeof args.file_path === 'string') {
        this.generatedSources.add(this.sourceKey(args.file_path))
      }
      return
    }
    if (!['mcp__vectcut__image__generate_or_edit_image', 'mcp__vectcut__image__generate_image'].includes(toolName) || !isRecord(result)) return
    const payloads: unknown[] = [result.structuredContent]
    if (Array.isArray(result.content)) {
      for (const block of result.content) {
        if (!isRecord(block) || block.type !== 'text' || typeof block.text !== 'string') continue
        try { payloads.push(JSON.parse(block.text)) } catch { /* Non-JSON preview text. */ }
      }
    }
    for (const payload of payloads) {
      if (!isRecord(payload) || payload.status !== 'success') continue
      const image = isRecord(payload.output) ? payload.output.image_url : undefined
      const fallback = isRecord(payload.result) ? payload.result.image : undefined
      const source = image || fallback
      if (typeof source === 'string' && source) this.generatedSources.add(this.sourceKey(source))
    }
  }

  inspectionError(toolName: string, args: Record<string, unknown>, error: unknown): unknown {
    if (toolName !== 'mcp__vectcut__image-understand__inspect_image') return error
    if (isRecord(error) && error.name === 'AbortError') return error
    const source = args.file_path || args.path || args.image_url || args.url || args.image
    const generated = typeof source === 'string' && this.generatedSources.has(this.sourceKey(source))
    const message = error instanceof Error ? error.message : String(error)
    const timeout = (isRecord(error) && error.code === -32001) || /timed?\s*out|timeout|超时/i.test(message)
    const notice = generated
      ? `图片已生成，检查${timeout ? '超时' : '失败'}。请保留已有图片，告知用户检查未完成；不要因此重新提交生图任务。`
      : `图片检查${timeout ? '超时' : '失败'}。这不代表图片生成失败；不要仅因检查失败重新提交生图任务。`
    return new Error(`${notice}\n原因：${message}`, { cause: error })
  }
}
