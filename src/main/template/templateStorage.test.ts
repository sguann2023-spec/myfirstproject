import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userDataPath = ''

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => userDataPath),
    isPackaged: false,
    getAppPath: vi.fn(() => process.cwd())
  }
}))

describe('模版本地持久化', () => {
  beforeEach(() => {
    userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'template-storage-'))
  })

  afterEach(() => {
    fs.rmSync(userDataPath, { recursive: true, force: true })
  })

  it('为默认模版创建 workspace/template/scenes 下的独立文件夹并可写回', async () => {
    const { createStoredTemplateDocument, formatTemplateModifiedAt, listStoredTemplates, loadStoredTemplateDocument, saveStoredTemplateDocument } = await import('./templateStorage')
    const stored = createStoredTemplateDocument('sentence-image')
    expect(stored.templateStorage.directory).toContain(path.join('Data', 'Workspaces', 'template', 'scenes'))
    expect(path.basename(stored.templateStorage.directory)).not.toBe('一句一图')
    expect(stored.templateStorage.templatePath).toBe(path.join(stored.templateStorage.directory, 'template.json'))
    expect(JSON.parse(fs.readFileSync(stored.templateStorage.templatePath, 'utf8')).scenes[0].name).toBe('一句一图')
    const next = stored.templateJson.replace('一句一图', '一句一图改名')
    saveStoredTemplateDocument({ templateJson: next, templateStorage: stored.templateStorage })
    expect(fs.readFileSync(stored.templateStorage.templatePath, 'utf8')).toBe(next)
    expect(listStoredTemplates()).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'local', name: '一句一图改名', description: '1分钟前', templatePath: stored.templateStorage.templatePath })
    ]))
    expect(loadStoredTemplateDocument(stored.templateStorage.templatePath)).toMatchObject({
      templateJson: next,
      templateStorage: stored.templateStorage
    })
    const now = new Date('2026-10-16T12:00:00')
    expect(formatTemplateModifiedAt(new Date('2026-10-16T11:42:00'), now)).toBe('18分钟前')
    expect(formatTemplateModifiedAt(new Date('2026-10-16T09:30:00'), now)).toBe('2小时前')
    expect(formatTemplateModifiedAt(new Date('2026-10-13T12:00:00'), now)).toBe('3 天前')
    expect(formatTemplateModifiedAt(new Date('2026-10-08T12:00:00'), now)).toBe('10/08')
  })

  it('把旧 workspace agent 目录中的模版迁移到新的 template 目录', async () => {
    const legacyDirectory = path.join(userDataPath, 'Data', 'Workspaces', 'vectcut_claw_default', 'template', 'scenes', '一句一图')
    fs.mkdirSync(legacyDirectory, { recursive: true })
    const legacyTemplatePath = path.join(legacyDirectory, 'template.json')
    fs.writeFileSync(legacyTemplatePath, JSON.stringify({ scenes: [{ name: '旧模版' }] }), 'utf8')
    const { listStoredTemplates } = await import('./templateStorage')
    const local = listStoredTemplates().find(item => item.source === 'local' && item.name === '旧模版')!
    expect(local.templatePath).toContain(path.join('Data', 'Workspaces', 'template', 'scenes'))
    expect(local.templatePath).not.toContain('vectcut_claw_default')
    expect(path.basename(path.dirname(local.templatePath!))).not.toBe('一句一图')
    expect(fs.existsSync(legacyTemplatePath)).toBe(false)
  })
})
