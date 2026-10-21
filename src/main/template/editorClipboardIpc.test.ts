import { beforeEach, expect, it, vi } from 'vitest'
import { registerTemplateIpc } from './registerTemplateIpc'
import { createEditorPreset } from './editorPresets'
import { analyzeEditorDocument } from './editorModel'

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  text: '',
  save: vi.fn()
}))
vi.mock('electron', () => ({
  BrowserWindow: {}, dialog: {},
  ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => state.handlers.set(name, handler) },
  clipboard: { writeText: (text: string) => { state.text = text }, readText: () => state.text }
}))
vi.mock('./mediaProbe', () => ({
  hydrateMediaDurations: async (payload: any) => ({ payload, changed: false }),
  probeMediaDurationMicros: vi.fn()
}))
vi.mock('./templateStorage', () => ({
  createStoredTemplateDocument: vi.fn(), listStoredTemplates: vi.fn(),
  loadStoredTemplateDocument: vi.fn(), saveStoredTemplateDocument: state.save
}))
vi.mock('../mcpServers/cut-workflow', () => ({ default: class {} }))
vi.mock('../mcpServers/draft-download', () => ({ default: class {} }))
vi.mock('./testExport', () => ({ TemplateTestExporter: class {} }))

beforeEach(() => {
  state.text = ''
  state.handlers.clear()
  state.save.mockClear()
  registerTemplateIpc()
})

it('复制写入系统剪贴板，粘贴通过原编辑事务保存副本', async () => {
  const payload = { templateJson: JSON.stringify(createEditorPreset('sentence-image')) }
  expect(await state.handlers.get('template:editor-copy')!({}, payload, 'text-1')).toBe(true)
  expect(JSON.parse(state.text).id).toBe('text-1')
  const result = await state.handlers.get('template:editor-edit')!({}, payload,
    { type: 'paste', id: 'text-1', scopeId: 'sentence-scene-1' })
  expect(result.selectedId).not.toBe('text-1')
  expect(analyzeEditorDocument(result).timeline.find(item => item.id === result.selectedId)?.duration).toBe(5)
  expect(state.save).toHaveBeenCalledWith({ ...payload, templateJson: result.templateJson })
})

it('不信任渲染端传入的剪贴板内容，系统剪贴板无效时不保存', async () => {
  const payload = { templateJson: JSON.stringify(createEditorPreset('sentence-image')) }
  await state.handlers.get('template:editor-copy')!({}, payload, 'text-1')
  const snapshot = state.text
  state.text = 'ordinary text'
  await expect(state.handlers.get('template:editor-edit')!({}, payload,
    { type: 'paste', id: 'text-1', clipboard: snapshot })).rejects.toThrow('请先复制')
  expect(state.save).not.toHaveBeenCalled()
})
