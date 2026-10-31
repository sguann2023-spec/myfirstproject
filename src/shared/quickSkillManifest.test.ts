import { describe, expect, it } from 'vitest'
import { isQuickSkillCompatible, parseQuickSkillsResponse, selectHomepageSkills } from './quickSkillManifest'

describe('homepage operations configuration', () => {
  it('filters before taking three and does not require a hardcoded action', () => {
    const skills = {
      deleted: { deleted: true, order: 0 },
      incompatible: { maxAppVersion: '1.0.0', order: 0 },
      d: { folderName: 'd', order: 3 },
      b: { folderName: 'b', order: 1 },
      a: { folderName: 'a', order: 1 },
      c: { folderName: 'c', order: 2 }
    }
    expect(selectHomepageSkills({ skills }, '1.7.27').map((item) => item.folderName)).toEqual(['a', 'b', 'c'])
    expect(Object.keys(skills)).toHaveLength(6)
  })
  it('includes both version boundaries and supports old entries without bounds', () => {
    const entry = { minAppVersion: '1.7.15', maxAppVersion: '1.7.27' }
    expect(isQuickSkillCompatible(entry, '1.7.15')).toBe(true)
    expect(isQuickSkillCompatible(entry, '1.7.27')).toBe(true)
    expect(isQuickSkillCompatible(entry, '1.7.28')).toBe(false)
    expect(isQuickSkillCompatible(entry, '1.7.14')).toBe(false)
    expect(isQuickSkillCompatible({}, '1.7.27')).toBe(true)
  })
  it('distinguishes a successful empty configuration from invalid or failed responses', () => {
    expect(parseQuickSkillsResponse({ code: 0, data: { skills: {} } })).toEqual({ skills: {} })
    for (const payload of [{ code: 1 }, { code: 0, data: {} }, { code: 0, data: { skills: [] } }]) {
      expect(() => parseQuickSkillsResponse(payload)).toThrow()
    }
  })
  it('rejects invalid package paths and ignores server-provided cache paths', () => {
    const entry = { folderName: 'hero', version: '1.0.0', downloadUrl: 'https://example.com/hero.zip', storageRelativePath: '../../outside' }
    const parsed = parseQuickSkillsResponse({ code: 0, data: { skills: { hero: entry } } })
    expect(parsed.skills.hero.storageRelativePath).toBeUndefined()
    for (const folderName of ['../outside', '/absolute', '.', '..', 'C:\\outside']) {
      expect(() => parseQuickSkillsResponse({ code: 0, data: { skills: { hero: { ...entry, folderName } } } })).toThrow()
    }
  })
})
