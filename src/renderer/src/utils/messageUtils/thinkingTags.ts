// Display-only normalization for provider text quirks (never mutates stored transcripts).
// Some gateways emit reasoning inline in content as <thinking>...</thinking> and join
// bold list items without newlines ("**A****B****C**"), which Markdown otherwise renders
// as one concatenated bold run or leaves literal asterisks behind.

const THINKING_TAG_PATTERN = /<thinking>([\s\S]*?)(?:<\/thinking>|$)/g

export const splitThinkingTags = (text: string): { main: string; thinking: string } => {
  const source = String(text || '')
  if (!source.includes('<thinking>')) {
    return { main: source.replace(/<\/thinking>/g, ''), thinking: '' }
  }
  const segments: string[] = []
  const main = source.replace(THINKING_TAG_PATTERN, (_match, inner: string) => {
    segments.push(inner)
    return ''
  })
  return {
    main: main.replace(/<\/thinking>/g, ''),
    thinking: segments.join('\n\n')
  }
}

// "**A****B**" -> "**A**\n\n**B**" so each bold item renders on its own line.
export const repairBoldRunConcatenation = (text: string): string => String(text || '').replace(/\*\*(?=\*\*)/g, '**\n\n')

// Plain-text preview lines for thinking headers: repaired line breaks, no emphasis markers.
export const thinkingPreviewLines = (content: string | null | undefined): string[] =>
  repairBoldRunConcatenation(String(content || ''))
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/\*\*/g, '').trim())
    .filter((line) => /[^\s\u200B-\u200D\uFEFF]/u.test(line))