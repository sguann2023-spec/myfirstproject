import type { SkillTriggerMode } from './types'

export function buildHostSkillInvocationPrompt(args: {
  prompt: string
  skillName: string
  skillMdPath: string
  skillMarkdown: string
  triggerMode: SkillTriggerMode
}): string {
  const prompt = String(args.prompt || '').trim()
  const skillName = String(args.skillName || '').trim()
  const skillMdPath = String(args.skillMdPath || '').trim()
  const skillMarkdown = String(args.skillMarkdown || '').trim()
  const triggerMode = args.triggerMode

  if (!skillName || !skillMdPath || !skillMarkdown) {
    return prompt
  }

  return [
    '[Host-resolved local skill invocation]',
    `The target local workspace skill for this turn is \`${skillName}\`.`,
    `Trigger mode: \`${triggerMode}\`.`,
    `Resolved skill source: \`${skillMdPath}\`.`,
    'The host has already resolved and loaded this SKILL.md.',
    'Do not spend tools rediscovering the skill, listing skill directories, or searching the marketplace before execution.',
    'Treat the embedded SKILL.md below as the execution instructions for this turn.',
    '',
    '<skill_md>',
    skillMarkdown,
    '</skill_md>',
    '',
    '[User request]',
    prompt
  ].join('\n')
}
