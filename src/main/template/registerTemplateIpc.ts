import { BrowserWindow, dialog, ipcMain } from 'electron'
import { pathToFileURL } from 'node:url'
import { compileImageTemplate, exampleImageTemplate } from './imageTemplate'
import {
  addEditorElement, analyzeEditorDocument, compileEditorDocument, editorInitialTemplate
} from './editorModel'
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
  ipcMain.handle('template:editor-test-export', (event, payload) => {
    const owner = event.sender.id
    if (!owners.has(owner)) {
      owners.add(owner)
      event.sender.once('destroyed', () => { owners.delete(owner); exporter.forget(owner) })
    }
    return exporter.run(owner, payload)
  })
  ipcMain.handle('template:editor-defaults', () => ({
    templateJson: JSON.stringify(editorInitialTemplate, null, 2),
    configJson: JSON.stringify({ timing_rules: {}, sources: {} }, null, 2)
  }))
  ipcMain.handle('template:editor-analyze', (_event, payload) => analyzeEditorDocument(payload))
  ipcMain.handle('template:editor-compile', (_event, payload) => compileEditorDocument(payload))
  ipcMain.handle('template:editor-add', async (event, payload, input) => {
    if (!['text', 'image', 'video', 'audio', 'sticker', 'filter', 'effect'].includes(input?.type)) throw new Error('不支持的素材类型')
    if (['text', 'sticker', 'filter', 'effect'].includes(input.type)) return addEditorElement(payload, input)
    const filters = {
      image: { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
      video: { name: '视频', extensions: ['mp4', 'mov', 'mkv', 'webm'] },
      audio: { name: '音频', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac'] }
    }
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options = { properties: ['openFile' as const], filters: [filters[input.type as keyof typeof filters]] }
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    return addEditorElement(payload, { type: input.type, selectedId: input.selectedId, source: result.filePaths[0] })
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
