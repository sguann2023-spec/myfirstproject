export type MentionableSkill = {
  name: string
  filename: string
  description?: string
  path?: string
  skillMdPath?: string
  version?: string
  source?: 'workspace' | 'global'
}

export type ExplicitSkillMention = {
  skill: MentionableSkill
  matchedLabel: string
}

/** Local routing metadata selects the immutable hidden package, never an installed namesake. */
export function resolveSkillInvocationMention(
  prompt: string,
  installed: MentionableSkill[],
  hidden: MentionableSkill[],
  quickSource?: { folderName?: string; version?: string }
): ExplicitSkillMention | undefined {
  if (!quickSource) return resolveExplicitSkillMention(prompt, [...installed, ...hidden])
  const selected = hidden.find((skill) => skill.filename === quickSource.folderName && skill.version === quickSource.version)
  if (!selected || !quickSource.version) throw new Error('模版版本已不可用，请重新选择模版')
  const mention = resolveExplicitSkillMention(prompt, [selected])
  if (!mention) throw new Error('请保留模版的技能提及，或退出模版后发送')
  return mention
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
    const pattern = new RegExp(`(^|\\s|使用)@${escapeRegExp(candidate.label)}(?=\\s|$)`, 'u')
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
