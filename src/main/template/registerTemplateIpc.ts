import { BrowserWindow, dialog, ipcMain } from 'electron'
import { pathToFileURL } from 'node:url'
import { compileImageTemplate, exampleImageTemplate } from './imageTemplate'
import {
  addEditorElement, analyzeEditorDocument, compileEditorDocument
} from './editorModel'
import { applyEditorAction } from './editorActions'
import { createStoredTemplateDocument, listStoredTemplates, loadStoredTemplateDocument, saveStoredTemplateDocument } from './templateStorage'
import { hydrateMediaDurations, probeMediaDurationMicros } from './mediaProbe'
import CutWorkflowServer from '../mcpServers/cut-workflow'
import DraftDownloadServer from '../mcpServers/draft-download'
import { TemplateTestExporter } from './testExport'

export function registerTemplateIpc() {
  const workflowServer = new CutWorkflowServer()
  const draftServer = new DraftDownloadServer()
  const exporter = new TemplateTestExporter({
    execute: (workflow) => workflowServer.executeWorkflow(workflow),
    exportDraft: (args) => draftServer.processDraftAction('export_draft', args)
  })
  const owners = new Set<number>()
  ipcMain.handle('template:editor-test-export', async (event, payload) => {
    const owner = event.sender.id
    if (!owners.has(owner)) {
      owners.add(owner)
      event.sender.once('destroyed', () => { owners.delete(owner); exporter.forget(owner) })
    }
    return exporter.run(owner, (await hydrateMediaDurations(payload)).payload)
  })
  ipcMain.handle('template:editor-list', () => listStoredTemplates())
  ipcMain.handle('template:editor-defaults', (_event, input) => {
    if (input?.templatePath) return loadStoredTemplateDocument(input.templatePath)
    return createStoredTemplateDocument(input?.presetId ?? input)
  })
  ipcMain.handle('template:editor-analyze', async (_event, payload) => {
    const hydrated = await hydrateMediaDurations(payload)
    const result = analyzeEditorDocument(hydrated.payload)
    saveStoredTemplateDocument(hydrated.payload)
    return hydrated.changed ? { ...result, templateJson: hydrated.payload.templateJson } : result
  })
  ipcMain.handle('template:editor-compile', async (_event, payload) => compileEditorDocument((await hydrateMediaDurations(payload)).payload))
  ipcMain.handle('template:editor-edit', async (_event, payload, action) => {
    const hydrated = await hydrateMediaDurations(payload)
    const result = applyEditorAction(hydrated.payload, action)
    saveStoredTemplateDocument({ ...payload, templateJson: result.templateJson })
    return result
  })
  ipcMain.handle('template:editor-add', async (event, payload, input) => {
    if (!['scene', 'batch-scene', 'text', 'image', 'video', 'audio', 'sticker', 'filter', 'effect'].includes(input?.type)) throw new Error('不支持的素材类型')
    if (['scene', 'batch-scene', 'text', 'sticker', 'filter', 'effect'].includes(input.type)) {
      const result = addEditorElement(payload, input)
      saveStoredTemplateDocument({ ...payload, templateJson: result.templateJson })
      return result
    }
    const filters = {
      image: { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
      video: { name: '视频', extensions: ['mp4', 'mov', 'mkv', 'webm'] },
      audio: { name: '音频', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac'] }
    }
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options = { properties: ['openFile' as const], filters: [filters[input.type as keyof typeof filters]] }
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    const source = result.filePaths[0]
    const sourceDuration = ['video', 'audio'].includes(input.type) ? await probeMediaDurationMicros(source) : undefined
    const added = addEditorElement(payload, { ...input, source, sourceDuration })
    saveStoredTemplateDocument({ ...payload, templateJson: added.templateJson })
    return added
  })
  ipcMain.handle('template:image-defaults', () => ({
    template: exampleImageTemplate,
    previewUrl: pathToFileURL(exampleImageTemplate.elements[0].source).href
  }))
  ipcMain.handle('template:compile-image', (_event, input) =>
    compileImageTemplate(exampleImageTemplate, input))
  ipcMain.handle('template:select-image', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options = {
      properties: ['openFile' as const],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    }
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    const source = result.filePaths[0]
    return result.canceled || !source ? null : { source, previewUrl: pathToFileURL(source).href }
  })
}
