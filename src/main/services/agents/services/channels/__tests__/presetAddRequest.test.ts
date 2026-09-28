import { describe, expect, it } from 'vitest'
import { normalizeDirectPresetAddRequest } from '../presetAddRequest'

describe('preset add direct request normalization', () => {
  it('forwards animation, transition, mask and volume fields', () => {
    const normalized = normalizeDirectPresetAddRequest({
      presetId: 'preset-1',
      draftId: 'draft-1',
      intro_animation: '渐显',
      intro_animation_duration: 0.7,
      outro_animation: '渐隐',
      outro_animation_duration: 0.8,
      transition: '叠化',
      transition_duration: 0.5,
      mask_type: 'rectangle',
      mask_invert: false,
      mask_round_corner: 10,
      volume: 0,
      group_animation: 'unsupported'
    })
    expect(normalized).toMatchObject({
      preset_id: 'preset-1',
      draft_id: 'draft-1',
      intro_animation: '渐显',
      intro_animation_duration: 0.7,
      outro_animation: '渐隐',
      outro_animation_duration: 0.8,
      transition: '叠化',
      transition_duration: 0.5,
      mask_type: 'rectangle',
      mask_invert: false,
      mask_round_corner: 10,
      volume: 0
    })
    expect(normalized).not.toHaveProperty('group_animation')
  })

  it('omits unselected effects and optional numbers', () => {
    const defaults = normalizeDirectPresetAddRequest({ presetId: 'preset-1' })
    expect(defaults).toEqual({ preset_id: 'preset-1' })
    expect(normalizeDirectPresetAddRequest({
      presetId: 'preset-1', transition_duration: null, mask_invert: false
    })).toEqual({ preset_id: 'preset-1', mask_invert: false })
  })
})
