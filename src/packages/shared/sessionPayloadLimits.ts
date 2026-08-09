const textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null

export const MAX_INLINE_PAYLOAD_BYTES = 2 * 1024 * 1024
export const MAX_INLINE_TOOL_PAYLOAD_BYTES = 16 * 1024

const LARGE_FIELD_KEYS = new Set(['data', 'base64', 'contentBase64', 'content_base64'])

export function getUtf8ByteLength(value: unknown): number {
  const text = typeof value === 'string' ? value : String(value ?? '')
  if (textEncoder) {
    return textEncoder.encode(text).length
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.byteLength(text, 'utf8')
  }
  return text.length
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function truncateUtf8ToBytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0 || !text) return ''
  if (getUtf8ByteLength(text) <= maxBytes) return text

  let low = 0
  let high = text.length
  let best = ''

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidate = text.slice(0, mid)
    if (getUtf8ByteLength(candidate) <= maxBytes) {
      best = candidate
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return best
}

function buildInlineLimitNotice(label: string, originalBytes: number, maxBytes: number): string {
  return [
    '',
    '',
    `[${label} 已截断：原始大小 ${formatByteSize(originalBytes)}，超过 ${formatByteSize(maxBytes)} 的硬限制。请将完整输入/输出写入工作空间文件，再用 shell、grep、jq、head、sed 等方式按需读取。]`
  ].join('')
}

export function limitInlineText(
  value: unknown,
  options: { label?: string; maxBytes?: number } = {}
): string {
  const label = options.label || '内容'
  const maxBytes = Number.isFinite(options.maxBytes) ? Number(options.maxBytes) : MAX_INLINE_PAYLOAD_BYTES
  const text = typeof value === 'string' ? value : String(value ?? '')
  const originalBytes = getUtf8ByteLength(text)

  if (originalBytes <= maxBytes) {
    return text
  }

  const notice = buildInlineLimitNotice(label, originalBytes, maxBytes)
  const noticeBytes = getUtf8ByteLength(notice)
  const budget = Math.max(0, maxBytes - noticeBytes)
  return `${truncateUtf8ToBytes(text, budget)}${notice}`
}

export function limitInlineToolText(
  value: unknown,
  options: { label?: string; maxBytes?: number } = {}
): string {
  return limitInlineText(value, {
    label: options.label,
    maxBytes: Number.isFinite(options.maxBytes) ? Number(options.maxBytes) : MAX_INLINE_TOOL_PAYLOAD_BYTES
  })
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value ?? '')
  }
}

function sanitizeInlinePayloadInternal(
  value: unknown,
  options: { label?: string; maxBytes?: number },
  seen: WeakSet<object>
): unknown {
  const label = options.label || '内容'
  const maxBytes = Number.isFinite(options.maxBytes) ? Number(options.maxBytes) : MAX_INLINE_PAYLOAD_BYTES

  if (value == null || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    return limitInlineText(value, { label, maxBytes })
  }

  if (Array.isArray(value)) {
    const next = value.map((item, index) =>
      sanitizeInlinePayloadInternal(item, { label: `${label}[${index}]`, maxBytes }, seen)
    )
    const serialized = safeStringify(next)
    if (getUtf8ByteLength(serialized) <= maxBytes) {
      return next
    }
    return limitInlineText(serialized, { label, maxBytes })
  }

  if (typeof value === 'object') {
    if (seen.has(value as object)) {
      return '[Circular]'
    }
    seen.add(value as object)

    const next: Record<string, unknown> = {}
    for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
      if (typeof entryValue === 'string' && LARGE_FIELD_KEYS.has(key)) {
        const entryBytes = getUtf8ByteLength(entryValue)
        if (entryBytes > Math.floor(maxBytes / 4)) {
          next[key] = `[已省略超大字段 ${key}，原始大小 ${formatByteSize(entryBytes)}]`
          continue
        }
      }
      next[key] = sanitizeInlinePayloadInternal(entryValue, { label: `${label}.${key}`, maxBytes }, seen)
    }

    const serialized = safeStringify(next)
    if (getUtf8ByteLength(serialized) <= maxBytes) {
      return next
    }
    return limitInlineText(serialized, { label, maxBytes })
  }

  return limitInlineText(value, { label, maxBytes })
}

export function sanitizeInlinePayload(
  value: unknown,
  options: { label?: string; maxBytes?: number } = {}
): unknown {
  return sanitizeInlinePayloadInternal(value, options, new WeakSet())
}

export function limitInlineToolPayload(
  value: unknown,
  options: { label?: string; maxBytes?: number } = {}
): unknown {
  const label = options.label || '工具回包'
  const maxBytes = Number.isFinite(options.maxBytes) ? Number(options.maxBytes) : MAX_INLINE_TOOL_PAYLOAD_BYTES

  if (value == null || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    return limitInlineToolText(value, { label, maxBytes })
  }

  const serialized = safeStringify(value)
  if (getUtf8ByteLength(serialized) <= maxBytes) {
    return value
  }

  return limitInlineToolText(serialized, { label, maxBytes })
}
