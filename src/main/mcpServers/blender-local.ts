import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js'
import { localBlenderService } from '@main/services/LocalBlenderService'
import { BlenderRenderService } from '@main/services/BlenderRenderService'
import { windowService } from '@main/services/WindowService'
import { registerArtifact } from '@main/services/artifactIndex'
import { BLENDER_RENDER_TIMEOUT_MS } from '@shared/blender'

type ExecutionExtra = {
  signal?: AbortSignal
  _meta?: { progressToken?: string | number }
  sendNotification?: (notification: { method: 'notifications/progress'; params: { progressToken: string | number; progress: number; total: number; message: string } }) => Promise<void>
}

const integer = (minimum: number, maximum: number) => ({ type: 'integer' as const, minimum, maximum })
const TOOLS: Tool[] = [
  {
    name: 'blender_status',
    description: 'Check the configured or auto-discovered local Blender executable and version. No download, remote request, or rendering.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'blender_render',
    description: 'Run local Blender Python or render an existing workspace .blend in one awaited call. Python builds the scene; the wrapper sets output/render settings, saves scene.blend and renders PNG or PNG frames plus local MP4. Files must be in the authorized workspace; outputs use unique artifact/blender directories. Executes local Python with user permissions, NOT a sandbox. No cloud service or billing, executable override, arbitrary CLI flags, or async submission/polling. Use only trusted scripts and projects.',
    inputSchema: {
      type: 'object',
      properties: {
        script: { type: 'string', minLength: 1, description: 'Inline Python scene-building script; mutually exclusive with script_path. Maximum 2 MiB.' },
        script_path: { type: 'string', minLength: 1, description: 'Nonempty Python file in the workspace; mutually exclusive with script.' },
        blend_path: { type: 'string', minLength: 1, description: 'Nonempty workspace .blend file; may be combined with one script.' },
        mode: { type: 'string', enum: ['still', 'animation'], default: 'still' },
        frame: integer(0, 1_048_574),
        frame_start: integer(0, 1_048_574),
        frame_end: integer(0, 1_048_574),
        fps: integer(1, 240),
        engine: { type: 'string', enum: ['CYCLES', 'BLENDER_EEVEE_NEXT'] },
        resolution_x: integer(1, 16_384),
        resolution_y: integer(1, 16_384),
        samples: integer(1, 65_536),
        timeout_seconds: { ...integer(1, BLENDER_RENDER_TIMEOUT_MS / 1000), default: BLENDER_RENDER_TIMEOUT_MS / 1000, description: 'Single deadline for preparation, Blender rendering, and local video encoding.' }
      },
      anyOf: [{ required: ['script'] }, { required: ['script_path'] }, { required: ['blend_path'] }],
      not: { required: ['script', 'script_path'] },
      additionalProperties: false
    }
  }
]

function result(payload: Record<string, unknown>, isError = false) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }], structuredContent: payload, ...(isError ? { isError: true } : {}) }
}

/** Session identity is supplied by trusted runtime wiring, never tool arguments. */
export default class BlenderLocalServer {
  public readonly mcpServer: McpServer
  private readonly renderer = new BlenderRenderService()

  constructor(private readonly workspacePath?: string, private readonly options: { runtimeSessionId?: string } = {}) {
    const mcp = this.mcpServer = new McpServer({ name: 'blender-local', version: '1.0.0' }, { capabilities: { tools: {} } })
    mcp.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))
    mcp.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      try {
        const args = request.params.arguments ?? {}
        if (request.params.name === 'blender_status') {
          if (Object.keys(args).length) throw new Error('blender_status accepts no arguments')
          return result({ ...await localBlenderService.getPathInfo() })
        }
        if (request.params.name !== 'blender_render') throw new Error(`Unknown Blender tool: ${request.params.name}`)
        const execution = extra as ExecutionExtra
        let notificationPending = false
        const onProgress = (progress: number, message: string) => {
          const token = execution?._meta?.progressToken
          if (token === undefined || !execution?.sendNotification || notificationPending) return
          notificationPending = true
          // Fire-and-catch: a disconnected/hung client must not block render completion.
          try {
            void Promise.resolve(execution.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress, total: 100, message } }))
              .catch(() => {}).finally(() => { notificationPending = false })
          } catch { notificationPending = false }
        }
        const output = await this.renderer.render(this.workspacePath, args, { signal: execution?.signal, onProgress })
        if (output.status === 'success') {
          const session = this.options.runtimeSessionId?.trim()
          if (session) {
            const filePath = output.video_path ?? output.image_path
            if (filePath) {
              try {
                const artifact = registerArtifact({ runtimeSessionId: session, type: output.video_path ? 'video' : 'image', filePath, source: 'blender-local' })
                try { windowService.getMainWindow()?.webContents.send('app:artifact-registered', artifact) }
                catch (error) { output.warnings.push(`Artifact saved, but preview notification failed: ${error instanceof Error ? error.message : String(error)}`) }
              } catch (error) { output.warnings.push(`Render succeeded, but artifact registration failed: ${error instanceof Error ? error.message : String(error)}`) }
            }
          } else output.warnings.push('No trusted runtime session; outputs were saved but not registered as session artifacts.')
        }
        return result({ ...output }, output.status !== 'success')
      } catch (error) { return result({ status: 'failed', error: error instanceof Error ? error.message : String(error) }, true) }
    })
    // Cover explicit MCP close and transport disconnect; preserve SDK lifecycle hooks.
    const originalClose = mcp.close.bind(mcp)
    mcp.close = async () => { await this.renderer.close(); await originalClose() }
    const originalOnClose = mcp.server.onclose
    mcp.server.onclose = () => { void this.renderer.close(); originalOnClose?.() }
  }

  async close(): Promise<void> { await this.mcpServer.close() }
}
