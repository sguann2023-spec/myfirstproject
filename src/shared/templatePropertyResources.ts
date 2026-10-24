import { ANIMATION_META } from './textAnimations'

export const templateFonts = [
  { value: 'HarmonyOS_Sans_SC_Regular', label: 'HarmonyOS Sans SC Regular', resourceId: '7265595305163231781' },
  { value: 'HarmonyOS_Sans_SC_Medium', label: 'HarmonyOS Sans SC Medium', resourceId: '7265595177916437050' },
  { value: 'HarmonyOS_Sans_SC_Bold', label: 'HarmonyOS Sans SC Bold', resourceId: '7265594890002633272' }
]

export const templateTransitions = [
  { value: '叠化', label: '叠化', resourceId: '6724845717472416269', effectId: '322577', isOverlap: true }
]

export function templateAnimations(type: string, key: string): Array<{ value: string; label: string; resourceId: string; effectId: string }> {
  const groups = type === 'text' ? { intro_animation: 'Text_intro', outro_animation: 'Text_outro', loop_animation: 'Text_loop_anim' }
    : { intro_animation: 'Intro_type', outro_animation: 'Outro_type', ...(type === 'image' ? { combo_animation: 'Group_animation_type' } : {}) }
  const group = groups[key]
  return group ? ANIMATION_META[group] ?? [] : []
}
