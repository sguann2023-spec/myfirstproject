import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureHomepageSkillInstalled, buildSkillMentionHighlightRegex } from './skillExample';
afterEach(() => { delete window.api; vi.restoreAllMocks(); });

describe('homepage skill installation', () => {
  const skill = { folderName: 'hero', directoryPath: '/resources/quick/skills/hero', version: '2.0.0' };
  it('preserves an already installed skill without overwriting its files', async () => {
    window.api = { skill: { list: vi.fn().mockResolvedValue({ success: true, data: [{ folderName: 'hero' }] }), readSkillFile: vi.fn().mockResolvedValue({ success: true, data: '2.0.0' }), installFromDirectory: vi.fn() } };
    await ensureHomepageSkillInstalled(skill);
    expect(window.api.skill.installFromDirectory).not.toHaveBeenCalled();
  });
  it.each([
    ['1.9.0', true], ['2.0.0-beta.1', true], ['2.0.0', false], ['3.0.0', false],
    ['1.10.0', true], [null, false], ['unknown', false],
  ])('compares installed version %s before replacing: %s', async (installedVersion, replace) => {
    window.api = { skill: {
      list: vi.fn().mockResolvedValue({ success: true, data: [{ id: 'installed-id', folderName: 'hero' }] }),
      readSkillFile: vi.fn().mockResolvedValue({ success: true, data: installedVersion }),
      installFromDirectory: vi.fn().mockResolvedValue({ success: true }),
    } };
    await ensureHomepageSkillInstalled(skill);
    expect(window.api.skill.readSkillFile).toHaveBeenCalledWith('installed-id', '.version');
    expect(window.api.skill.installFromDirectory).toHaveBeenCalledTimes(replace ? 1 : 0);
  });
  it('does not overwrite when the version query fails', async () => {
    window.api = { skill: {
      list: vi.fn().mockResolvedValue({ success: true, data: [{ folderName: 'hero' }] }),
      readSkillFile: vi.fn().mockResolvedValue({ success: false }), installFromDirectory: vi.fn(),
    } };
    await expect(ensureHomepageSkillInstalled(skill)).rejects.toThrow('读取已安装技能版本失败');
    expect(window.api.skill.installFromDirectory).not.toHaveBeenCalled();
  });
  it('does not continue when installation fails', async () => {
    window.api = { skill: { list: vi.fn().mockResolvedValue({ success: true, data: [] }), installFromDirectory: vi.fn().mockResolvedValue({ success: false }) } };
    await expect(ensureHomepageSkillInstalled(skill)).rejects.toThrow('安装技能失败');
  });
});

describe('skill modification mentions', () => {
  it('recognizes only the skill name before the 技能 suffix', () => {
    const regex = buildSkillMentionHighlightRegex(['微缩世界化妆品带货']);
    const matches = [...'修改@微缩世界化妆品带货技能，我想要'.matchAll(regex)];
    expect(matches.map((match) => match[0])).toEqual(['@微缩世界化妆品带货']);
    expect(buildSkillMentionHighlightRegex(['口播']).test('@口播技能增强')).toBe(false);
  });
  it('escapes model punctuation and prefers the longest skill label', () => {
    expect([...('修改@技能(A)+技能，我想要').matchAll(buildSkillMentionHighlightRegex(['技能(A)+']))][0][0]).toBe('@技能(A)+');
    expect([...('修改@口播技能技能，我想要').matchAll(buildSkillMentionHighlightRegex(['口播', '口播技能']))][0][0]).toBe('@口播技能');
  });
});
