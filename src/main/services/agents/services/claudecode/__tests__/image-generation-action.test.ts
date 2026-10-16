import { describe, expect, it } from 'vitest'
import { normalizeImageGenerationArguments } from '../harness/image-generation-action'

const tool = 'mcp__vectcut__image__generate_or_edit_image'
describe('agent image generation action', () => {
  it.each([undefined, '', 'submit', ' SUBMIT '])('uses automatic waiting for action %s', action => {
    const args = { action, prompt: 'edit', model: 'nano_banana_2.1', size: '576x1024', referenceImages: ['https://example.com/ref.png'] }
    expect(normalizeImageGenerationArguments(tool, args)).toEqual({ ...args, action: 'submit_and_wait' })
    expect(args.action).toBe(action)
  })
  it('preserves status recovery and explicit waiting', () => {
    for (const action of ['status', 'submit_and_wait']) {
      const args = { action, taskId: 'existing-task' }
      expect(normalizeImageGenerationArguments(tool, args)).toBe(args)
    }
  })
  it('leaves unrelated tools and invalid actions unchanged', () => {
    const args = { action: 'submit' }
    expect(normalizeImageGenerationArguments('mcp__vectcut__video__generate_video', args)).toBe(args)
    const invalid = { action: 'invalid' }
    expect(normalizeImageGenerationArguments(tool, invalid)).toBe(invalid)
  })
})
