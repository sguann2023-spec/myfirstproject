import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

vi.mock('@main/utils/process', () => ({ findExecutableInEnv: async () => null }))
vi.mock('@main/utils', () => ({ getResourcePath: () => path.resolve('resources') }))
vi.mock('@main/services/ConfigManager', () => ({
  ConfigKeys: { BlenderPath: 'blenderPath' }, configManager: { get: () => null, set() {} }
}))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ info() {}, warn() {}, debug() {}, error() {} }) } }))
vi.mock('@main/services/artifactIndex', () => ({ registerArtifact: vi.fn(input => ({ ...input, id: 'smoke-artifact' })) }))
vi.mock('@main/services/WindowService', () => ({ windowService: { getMainWindow: () => undefined } }))

import BlenderLocalServer from '../blender-local'
import { localBlenderService } from '@main/services/LocalBlenderService'

const scene = `import bpy
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add()
cube = bpy.context.object
cube.rotation_euler.z = 0.0
cube.keyframe_insert(data_path='rotation_euler', frame=1)
cube.rotation_euler.z = 0.3
cube.keyframe_insert(data_path='rotation_euler', frame=2)
bpy.ops.object.camera_add(location=(5, -5, 4))
camera = bpy.context.object
camera.rotation_euler = (-camera.location).to_track_quat('-Z', 'Y').to_euler()
bpy.context.scene.camera = camera
bpy.ops.object.light_add(type='AREA', location=(3, -4, 5))
bpy.context.object.data.energy = 500
bpy.context.scene.render.engine = 'CYCLES'
bpy.context.scene.cycles.device = 'CPU'
`

describe.skipIf(process.env.BLENDER_LOCAL_SMOKE !== '1')('installed headless Blender smoke', () => {
  let root: string
  let server: BlenderLocalServer
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'blender-local-smoke-'))
    server = new BlenderLocalServer(root)
  })
  afterAll(async () => {
    await server?.close()
    if (root) await fs.rm(root, { recursive: true, force: true })
  })
  const call = async (name: string, args: object, extra = {}) => {
    const handler = (server.mcpServer.server as any)._requestHandlers.get('tools/call')
    const result = await handler({ method: 'tools/call', params: { name, arguments: args } }, extra)
    return { result, data: JSON.parse(result.content[0].text) }
  }
  it('discovers the installed executable without opening its UI', async () => {
    const info = await localBlenderService.getPathInfo({ force: true })
    expect(info.status, JSON.stringify(info)).toBe('ready')
    expect(info.version).toMatch(/^\d+\.\d+/)
  })
  it('renders a CPU PNG and editable blend in one MCP call', async () => {
    const progress = vi.fn(async () => {})
    const { result, data } = await call('blender_render', {
      script: scene, mode: 'still', engine: 'CYCLES', resolution_x: 32, resolution_y: 32, samples: 1, timeout_seconds: 60
    }, { _meta: { progressToken: 0 }, sendNotification: progress })
    expect(data.status, JSON.stringify(data)).toBe('success')
    expect(result.isError).not.toBe(true)
    expect((await fs.readFile(data.image_path)).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect((await fs.stat(data.blend_path)).size).toBeGreaterThan(0)
    expect(progress).toHaveBeenCalled()
  })
  it('renders two CPU frames and encodes a local MP4 in the same call', async () => {
    const { data } = await call('blender_render', {
      script: scene, mode: 'animation', frame_start: 1, frame_end: 2, fps: 2,
      engine: 'CYCLES', resolution_x: 32, resolution_y: 32, samples: 1, timeout_seconds: 60
    })
    expect(data.status, JSON.stringify(data)).toBe('success')
    expect(data.frame_count).toBe(2)
    expect((await fs.readFile(data.video_path)).subarray(4, 8).toString()).toBe('ftyp')
  })
  it('cancels an owned sleeping Blender process without waiting for its full script', async () => {
    const controller = new AbortController()
    const pending = call('blender_render', {
      script: 'import time\nprint("SMOKE_SLEEPING", flush=True)\ntime.sleep(30)', timeout_seconds: 60
    }, {
      signal: controller.signal, _meta: { progressToken: 'cancel-smoke' },
      sendNotification: async (notification: any) => {
        if (notification.params.message.includes('SMOKE_SLEEPING')) controller.abort(new Error('Smoke cancellation'))
      }
    })
    const watchdog = setTimeout(() => controller.abort(new Error('Smoke cancellation fallback')), 10_000)
    try {
      const { data } = await pending
      expect(data.status, JSON.stringify(data)).toBe('cancelled')
    } finally { clearTimeout(watchdog) }
  })
})
