export type MentionableSkill = {
  name: string
  filename: string
  description?: string
  path?: string
  skillMdPath?: string
  source?: 'workspace' | 'global'
}

export type ExplicitSkillMention = {
  skill: MentionableSkill
  matchedLabel: string
}

export function resolveExplicitSkillMention(
  prompt: string,
  skills: MentionableSkill[]
): ExplicitSkillMention | undefined {
  const text = String(prompt || '')
  if (!text.includes('@')) return undefined

  const candidates = skills
    .flatMap((skill) =>
      [skill.name, skill.filename]
        .map((label) => String(label || '').trim())
        .filter(Boolean)
        .map((label) => ({ skill, label }))
    )
    .sort((left, right) => right.label.length - left.label.length)

  for (const candidate of candidates) {
    const pattern = new RegExp(`(^|\\s)@${escapeRegExp(candidate.label)}(?=\\s|$)`, 'u')
    if (pattern.test(text)) {
      return {
        skill: candidate.skill,
        matchedLabel: candidate.label
      }
    }
  }

  return undefined
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
