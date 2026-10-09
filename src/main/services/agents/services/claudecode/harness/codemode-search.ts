export type CodemodeSearchEntry = {
  name: string
  description?: string
  inputSchema?: Record<string, unknown> | boolean
}

const summarizeValue = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const tokenizeSearchText = (value: string): string[] => {
  const normalized = String(value || '').toLowerCase()
  const latinTokens = normalized.match(/[a-z0-9_]+/g) ?? []
  const cjkRuns = normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu) ?? []
  const cjkTokens = cjkRuns.flatMap((run: string) => {
    const chars = Array.from(run)
    return chars.length <= 2
      ? [run]
      : [run, ...chars.slice(0, -1).map((char, index) => `${char}${chars[index + 1]}`)]
  })
  return [...latinTokens, ...cjkTokens]
}

export function rankCodemodeTools(
  tools: CodemodeSearchEntry[],
  query: string,
  limit = 8
): CodemodeSearchEntry[] {
  const queryTokens = Array.from(new Set(tokenizeSearchText(query)))
  if (queryTokens.length === 0) return []

  return tools
    .map((tool) => {
      const name = tool.name.toLowerCase()
      const description = String(tool.description || '').toLowerCase()
      const schemaText = summarizeValue(tool.inputSchema).toLowerCase()
      const searchableText = `${name} ${description} ${schemaText}`
      const searchableTokens = tokenizeSearchText(searchableText)
      const tokenCounts = new Map<string, number>()
      for (const token of searchableTokens) {
        tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1)
      }

      let score = 0
      for (const token of queryTokens) {
        const count = tokenCounts.get(token) ?? 0
        if (count > 0) score += 1 + Math.log1p(count)
        if (name.includes(token)) score += 4
        if (description.includes(token)) score += 1.5
      }
      if (searchableText.includes(String(query || '').trim().toLowerCase())) score += 8
      return { tool, score }
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name))
    .slice(0, Math.max(1, Math.min(20, Math.floor(limit) || 8)))
    .map((entry) => entry.tool)
}

export function searchCodemodeTools(
  tools: CodemodeSearchEntry[],
  query: string,
  limit = 5
): Array<{ name: string; description: string }> {
  return rankCodemodeTools(tools, query, limit).map((tool) => ({
    name: tool.name,
    description: String(tool.description || '').slice(0, 240)
  }))
}
