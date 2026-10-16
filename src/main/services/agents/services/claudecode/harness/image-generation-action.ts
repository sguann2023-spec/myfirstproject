/** Agent image requests wait for the result internally; status remains available for recovery. */
export function normalizeImageGenerationArguments(
  toolName: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  if (!['mcp__vectcut__image__generate_or_edit_image', 'mcp__vectcut__image__generate_image'].includes(toolName)) return args
  const action = typeof args.action === 'string' ? args.action.trim().toLowerCase() : ''
  if (!action || action === 'submit') return { ...args, action: 'submit_and_wait' }
  return args
}
