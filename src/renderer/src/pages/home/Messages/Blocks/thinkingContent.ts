// Visibility only: never strip provider content, signatures or transcript metadata.
// Match the zero-width characters already treated as invisible by Markdown headings.
export const hasMeaningfulThinkingContent = (content: string | null | undefined): boolean =>
  typeof content === 'string' && /[^\s\u200B-\u200D\uFEFF]/u.test(content)
