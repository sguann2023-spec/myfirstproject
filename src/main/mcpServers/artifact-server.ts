import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import fs from 'node:fs/promises'
import { windowService } from '@main/services/WindowService'
import path from 'node:path'
import { artifactTypes, listArtifacts, registerArtifact, type ArtifactType } from '../services/artifactIndex'
import { validatePath } from './filesystem/types'
import { saveArtifactFile } from './filesystem/tools/download'

export default class ArtifactServer {
  public mcpServer = new McpServer({ name: 'artifact_server', version: '1.0.0' }, { capabilities: { tools: {} } })
  constructor(private cwd: string, private runtimeSessionId?: string, private accessiblePaths: string[] = []) {
    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
      { name: 'add_artifact', description: 'Save and register an existing session artifact in workspace/artifact; cloud drafts are registered without downloading. Documents must be local txt/html/md/markdown files in the authorized workspace. Skip temporary/test files and outputs already auto-registered; use list_artifacts when unsure. Register updated deliverables again to refresh the existing entry.', inputSchema: { type: 'object', properties: { type: { type: 'string', enum: [...artifactTypes] }, url: { type: 'string' }, filePath: { type: 'string' }, draftId: { type: 'string' }, taskId: { type: 'string' }, source: { type: 'string' }, name: { type: 'string' } }, required: ['type'], additionalProperties: false } },
      { name: 'list_artifacts', description: 'List current runtime session artifacts, including automatically generated artifacts.', inputSchema: { type: 'object', properties: { type: { type: 'string', enum: [...artifactTypes] } }, additionalProperties: false } }
    ] }))
    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async request => {
      try {
        if (!this.runtimeSessionId?.trim()) throw new Error('A reliable runtime session is required')
        const args = request.params.arguments ?? {}
        const type = args.type as ArtifactType | undefined
        if (type !== undefined && !artifactTypes.includes(type)) throw new Error('Unsupported artifact type')
        let result: unknown
        if (request.params.name === 'list_artifacts') result = listArtifacts(this.runtimeSessionId, type)
        else if (request.params.name === 'add_artifact') {
          if (!type) throw new Error('type is required')
          const fields: Record<string, string> = {}
          for (const key of ['url', 'filePath', 'draftId', 'taskId', 'source', 'name']) {
            if (args[key] !== undefined) {
              if (typeof args[key] !== 'string' || !(args[key] as string).trim()) throw new Error(`Invalid ${key}`)
              fields[key] = (args[key] as string).trim()
            }
          }
          if (fields.filePath) {
            let authorized: string | undefined
            for (const root of [this.cwd, ...this.accessiblePaths]) {
              try { authorized = await validatePath(fields.filePath, root); break } catch {}
            }
            if (!authorized) throw new Error('Access denied: artifact outside authorized paths')
            fields.filePath = authorized
            if (!(await fs.stat(fields.filePath)).isFile()) throw new Error('Artifact must be an existing regular file')
          }
          if (type === 'document' && (!fields.filePath || fields.url || !['.txt', '.html', '.md', '.markdown'].includes(path.extname(fields.filePath).toLowerCase()))) throw new Error('Unsupported local document')
          if (fields.url && !['http:', 'https:'].includes(new URL(fields.url).protocol)) throw new Error('Unsupported URL protocol')
          if (type === 'draft' && !fields.draftId) throw new Error('draftId is required')
          const originalPath = fields.filePath
          if (type !== 'draft') {
            if (type === 'document' && !fields.name) fields.name = path.basename(fields.filePath)
            fields.filePath = await saveArtifactFile({ workspaceRoot: this.cwd, filePath: fields.filePath, url: fields.url,
              extension: type === 'audio' ? '.mp3' : type === 'video' ? '.mp4' : '.png' })
          }
          result = registerArtifact({ ...fields, ...(originalPath ? { aliases: [originalPath] } : {}), type, runtimeSessionId: this.runtimeSessionId })
        } else throw new Error('Unknown artifact tool')
        if (request.params.name === 'add_artifact') {
          try { windowService.getMainWindow()?.webContents.send('app:artifact-registered', result) } catch { /* Index remains authoritative when the renderer is unavailable. */ }
        }
        return { content: [{ type: 'text', text: JSON.stringify(result) }] }
      } catch (error) { return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] } }
    })
  }
}
