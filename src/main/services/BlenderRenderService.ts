import { spawn, execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { localBlenderService } from '@main/services/LocalBlenderService'
import { validatePath } from '@main/mcpServers/filesystem/types'
import { resolveFfmpegPath } from '@main/utils/prepare-subtitle-audio'
import { BLENDER_RENDER_TIMEOUT_MS } from '@shared/blender'

export type BlenderRenderInput = {
  script?: string
  script_path?: string
  blend_path?: string
  mode?: 'still' | 'animation'
  frame?: number
  frame_start?: number
  frame_end?: number
  fps?: number
  engine?: 'CYCLES' | 'BLENDER_EEVEE_NEXT'
  resolution_x?: number
  resolution_y?: number
  samples?: number
  timeout_seconds?: number
}
export type BlenderRenderContext = { signal?: AbortSignal; onProgress?: (progress: number, message: string) => void }
export type BlenderRenderResult = {
  status: 'success' | 'failed' | 'cancelled' | 'timeout'
  mode: 'still' | 'animation'
  output_dir?: string
  blend_path?: string
  image_path?: string
  video_path?: string
  frames_dir?: string
  frame_count?: number
  error?: string
  log_tail: string
  warnings: string[]
}

const LOG_LIMIT = 16 * 1024
const SCRIPT_LIMIT = 2 * 1024 * 1024
const CLEANUP_MS = 1500
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

/** Also used by MCP: do not rely on clients respecting the advertised schema. */
export function parseBlenderRenderInput(value: unknown): BlenderRenderInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Render arguments must be an object')
  const args = value as Record<string, unknown>
  const allowed = ['script', 'script_path', 'blend_path', 'mode', 'frame', 'frame_start', 'frame_end', 'fps', 'engine', 'resolution_x', 'resolution_y', 'samples', 'timeout_seconds']
  for (const key of Object.keys(args)) if (!allowed.includes(key)) throw new Error(`Unknown render argument: ${key}`)
  for (const key of ['script', 'script_path', 'blend_path']) {
    if (args[key] !== undefined && (typeof args[key] !== 'string' || !(args[key] as string).trim() || (args[key] as string).includes('\0'))) throw new Error(`${key} must be a nonempty string without NUL characters`)
  }
  if (args.script !== undefined && args.script_path !== undefined) throw new Error('Provide at most one of script and script_path')
  if (args.script === undefined && args.script_path === undefined && args.blend_path === undefined) throw new Error('Provide a script or blend_path')
  if (args.script !== undefined && Buffer.byteLength(args.script as string) > SCRIPT_LIMIT) throw new Error('script exceeds 2 MiB')
  if (args.mode !== undefined && args.mode !== 'still' && args.mode !== 'animation') throw new Error('mode must be still or animation')
  if (args.engine !== undefined && args.engine !== 'CYCLES' && args.engine !== 'BLENDER_EEVEE_NEXT') throw new Error('Unsupported render engine')
  const ranges: Record<string, [number, number]> = {
    frame: [0, 1_048_574], frame_start: [0, 1_048_574], frame_end: [0, 1_048_574], fps: [1, 240],
    resolution_x: [1, 16_384], resolution_y: [1, 16_384], samples: [1, 65_536], timeout_seconds: [1, BLENDER_RENDER_TIMEOUT_MS / 1000]
  }
  for (const [key, [min, max]] of Object.entries(ranges)) {
    if (args[key] !== undefined && (!Number.isInteger(args[key]) || (args[key] as number) < min || (args[key] as number) > max)) throw new Error(`${key} must be an integer between ${min} and ${max}`)
  }
  if ((args.mode ?? 'still') === 'still' && (args.frame_start !== undefined || args.frame_end !== undefined)) throw new Error('frame_start/frame_end require animation mode')
  if (args.mode === 'animation' && args.frame !== undefined) throw new Error('frame is only valid for still mode')
  if (args.frame_start !== undefined && args.frame_end !== undefined && (args.frame_start as number) > (args.frame_end as number)) throw new Error('frame_start must not exceed frame_end')
  return { ...args } as BlenderRenderInput
}

/** PID-scoped only. Never terminate another Blender instance by executable name. */
async function killOwnedTree(pid: number | undefined): Promise<void> {
  if (!pid || pid <= 0) return
  if (process.platform === 'win32') {
    await new Promise<void>(resolve => {
      let settled = false
      const finish = () => { if (!settled) { settled = true; clearTimeout(timer); resolve() } }
      const timer = setTimeout(finish, CLEANUP_MS)
      try { execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { shell: false, windowsHide: true, timeout: CLEANUP_MS }, finish) } catch { finish() }
    })
  } else {
    try { process.kill(-pid, 'SIGKILL') } catch { /* Already exited, or no owned process group. */ }
  }
}

/** Self-contained: user code runs before all wrapper-owned render/output settings. */
function bootstrap(config: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(config)).toString('base64')
  return `import bpy, json, base64, os\n\ndef _vectcut_render():\n    cfg = json.loads(base64.b64decode('${payload}').decode('utf-8'))\n    if cfg['blend']:\n        bpy.ops.wm.open_mainfile(filepath=cfg['blend'])\n    if cfg['script']:\n        exec(compile(cfg['script'], cfg['script_name'], 'exec'), {'__name__': '__main__', '__file__': cfg['script_name']})\n    scene = bpy.context.scene\n    if cfg.get('engine'): scene.render.engine = cfg['engine']\n    if cfg.get('resolution_x') is not None: scene.render.resolution_x = cfg['resolution_x']\n    if cfg.get('resolution_y') is not None: scene.render.resolution_y = cfg['resolution_y']\n    scene.render.resolution_percentage = 100\n    if cfg.get('samples') is not None:\n        scene.cycles.samples = cfg['samples']\n        eevee = getattr(scene, 'eevee', None)\n        if eevee is not None and hasattr(eevee, 'taa_render_samples'): eevee.taa_render_samples = cfg['samples']\n    if cfg.get('fps') is not None:\n        scene.render.fps = cfg['fps']\n        scene.render.fps_base = 1.0\n    scene.render.image_settings.file_format = 'PNG'\n    scene.render.image_settings.color_mode = 'RGBA'\n    scene.render.use_file_extension = True\n    scene.render.use_compositing = False\n    scene.render.use_sequencer = False\n    scene.render.use_multiview = False\n    scene.render.use_border = False\n    scene.render.use_crop_to_border = False\n    scene.render.use_overwrite = True\n    scene.render.use_placeholder = False\n    if cfg['mode'] == 'animation':\n        scene.frame_start = cfg.get('frame_start', scene.frame_start)\n        scene.frame_end = cfg.get('frame_end', scene.frame_end)\n        scene.frame_step = 1\n        if scene.frame_start < 0 or scene.frame_end < scene.frame_start or scene.frame_end > 1048574:\n            raise ValueError('Invalid effective animation frame range')\n        scene.render.filepath = cfg['frames_prefix']\n    else:\n        scene.frame_set(cfg.get('frame', scene.frame_current))\n        scene.render.filepath = cfg['image_path']\n    bpy.ops.wm.save_as_mainfile(filepath=cfg['project'])\n    bpy.ops.render.render(animation=cfg['mode'] == 'animation', write_still=cfg['mode'] != 'animation')\n    metadata = {'frame_start': scene.frame_start, 'frame_end': scene.frame_end, 'fps': scene.render.fps / scene.render.fps_base}\n    with open(cfg['metadata'], 'w', encoding='utf-8') as f: json.dump(metadata, f)\n    print('VECTCUT_RENDER_COMPLETE', flush=True)\n\n_vectcut_render()\n`
}

export class BlenderRenderService {
  private readonly active = new Set<{ controller: AbortController; done: Promise<unknown> }>()
  private closed = false

  render(workspacePath: string | undefined, input: unknown, context: BlenderRenderContext = {}): Promise<BlenderRenderResult> {
    const controller = new AbortController()
    if (this.closed) controller.abort(new Error('Blender render service closed'))
    const signal = context.signal ? AbortSignal.any([context.signal, controller.signal]) : controller.signal
    const entry = { controller, done: Promise.resolve() as Promise<unknown> }
    const done = this.execute(workspacePath, input, { ...context, signal }).finally(() => this.active.delete(entry))
    entry.done = done
    this.active.add(entry)
    return done
  }

  async close(): Promise<void> {
    this.closed = true
    const active = [...this.active]
    for (const entry of active) entry.controller.abort(new Error('Blender render service closed'))
    let timer: ReturnType<typeof setTimeout> | undefined
    try { await Promise.race([Promise.allSettled(active.map(entry => entry.done)), new Promise(resolve => { timer = setTimeout(resolve, CLEANUP_MS + 500) })]) } finally { clearTimeout(timer) }
  }

  private async execute(workspacePath: string | undefined, input: unknown, context: BlenderRenderContext): Promise<BlenderRenderResult> {
    let mode: 'still' | 'animation' = 'still'
    let outputDir: string | undefined
    let logTail = ''
    let lastProgress = 0
    let lastNotice = 0
    let phase = 'Preparing local Blender render'
    const deadline = new AbortController()
    const signal = context.signal ? AbortSignal.any([context.signal, deadline.signal]) : deadline.signal
    let timer: ReturnType<typeof setTimeout> | undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined
    const progress = (value: number, text: string, force = false) => {
      lastProgress = Math.max(lastProgress, value)
      phase = text.slice(-400)
      if (force || Date.now() - lastNotice >= 750) {
        lastNotice = Date.now()
        try { context.onProgress?.(lastProgress, phase) } catch { /* Progress delivery must not fail rendering. */ }
      }
    }
    const append = (chunk: Buffer | string) => {
      const text = chunk.toString().replace(/\x1b\[[0-9;]*m/g, '')
      logTail = (logTail + text).slice(-LOG_LIMIT)
      progress(Math.min(85, lastProgress + 0.1), text.trim() || phase)
    }
    // Race non-process preparation too; late probes must never launch Blender after cancellation.
    const checked = async <T>(operation: Promise<T>): Promise<T> => {
      signal.throwIfAborted()
      let abort: () => void = () => {}
      try {
        return await Promise.race([operation, new Promise<never>((_, reject) => {
          abort = () => reject(signal.reason)
          signal.addEventListener('abort', abort, { once: true })
          if (signal.aborted) abort()
        })])
      } finally { signal.removeEventListener('abort', abort) }
    }
    try {
      signal.throwIfAborted()
      const args = parseBlenderRenderInput(input)
      mode = args.mode ?? 'still'
      timer = setTimeout(() => deadline.abort(new Error('Blender render deadline exceeded')), (args.timeout_seconds ?? BLENDER_RENDER_TIMEOUT_MS / 1000) * 1000)
      progress(0, phase, true)
      heartbeat = setInterval(() => progress(lastProgress, phase, true), 5000)
      if (!workspacePath?.trim()) throw new Error('A configured workspace is required for local rendering')
      const root = await checked(fs.realpath(workspacePath))
      if (!(await checked(fs.stat(root))).isDirectory()) throw new Error('Workspace must be a directory')
      const file = async (requested: string): Promise<string> => {
        const authorized = await checked(validatePath(requested, root))
        const real = await checked(fs.realpath(authorized))
        await checked(validatePath(real, root))
        const stat = await checked(fs.stat(real))
        if (!stat.isFile() || stat.size === 0) throw new Error('Input must be a nonempty regular workspace file')
        return real
      }
      const blend = args.blend_path ? await file(args.blend_path) : undefined
      if (blend && path.extname(blend).toLowerCase() !== '.blend') throw new Error('blend_path must be a .blend file')
      let script = args.script
      let scriptName = '<inline-blender-script>'
      if (args.script_path) {
        scriptName = await file(args.script_path)
        if ((await checked(fs.stat(scriptName))).size > SCRIPT_LIMIT) throw new Error('script_path exceeds 2 MiB')
        script = await checked(fs.readFile(scriptName, 'utf8'))
        if (!script.trim() || script.includes('\0')) throw new Error('script_path must contain nonempty Python text without NUL characters')
      }
      const executable = await checked(localBlenderService.requireExecutable())
      signal.throwIfAborted()
      const base = await checked(validatePath(path.join(root, 'artifact', 'blender'), root))
      await checked(fs.mkdir(base, { recursive: true }))
      await checked(validatePath(await checked(fs.realpath(base)), root))
      outputDir = await checked(fs.mkdtemp(path.join(base, 'render-')))
      outputDir = await checked(validatePath(await checked(fs.realpath(outputDir)), root))
      const framesDir = await checked(validatePath(path.join(outputDir, 'frames'), root))
      await checked(fs.mkdir(framesDir))
      const owned = async (name: string) => checked(validatePath(path.join(outputDir!, name), root))
      const project = await owned('scene.blend')
      const imagePath = await owned('render.png')
      const metadataPath = await owned('render-metadata.json')
      const bootstrapPath = await owned('bootstrap.py')
      await checked(fs.writeFile(bootstrapPath, bootstrap({ ...args, script: script ?? null, script_name: scriptName, blend: blend ?? null, project,
        mode, image_path: imagePath, frames_prefix: path.join(framesDir, 'frame_'), metadata: metadataPath }), { flag: 'wx' }))
      progress(5, 'Rendering with local Blender', true)
      await this.run(executable.path, ['--background', '--factory-startup', '--disable-autoexec', '--python-exit-code', '1', '--python', bootstrapPath], outputDir, signal, append)
      signal.throwIfAborted()
      const outputFile = async (requested: string) => {
        const real = await file(requested)
        await checked(validatePath(real, outputDir))
        return real
      }
      await outputFile(project)
      if (mode === 'still') {
        await outputFile(imagePath)
        signal.throwIfAborted()
        progress(100, 'Local Blender render complete', true)
        return { status: 'success', mode, output_dir: outputDir, blend_path: project, image_path: imagePath, log_tail: logTail, warnings: [] }
      }
      const metadataFile = await outputFile(metadataPath)
      if ((await checked(fs.stat(metadataFile))).size > 4096) throw new Error('Invalid render metadata')
      const metadata = JSON.parse(await checked(fs.readFile(metadataFile, 'utf8')))
      const { frame_start: start, frame_end: end, fps } = metadata
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > 1_048_574 || typeof fps !== 'number' || !Number.isFinite(fps) || fps <= 0 || fps > 240) throw new Error('Invalid effective animation range or fps')
      // Check sequentially without returning or retaining a giant frame path array.
      for (let frame = start; frame <= end; frame++) await outputFile(path.join(framesDir, `frame_${String(frame).padStart(4, '0')}.png`))
      const videoPath = await owned('render.mp4')
      progress(90, 'Encoding PNG frames to local MP4', true)
      await this.run(resolveFfmpegPath(), ['-hide_banner', '-nostdin', '-y', '-framerate', String(fps), '-start_number', String(start), '-i', path.join(framesDir, 'frame_%04d.png'), '-frames:v', String(end - start + 1), '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', videoPath], outputDir, signal, append)
      await outputFile(videoPath)
      signal.throwIfAborted()
      progress(100, 'Local Blender animation complete', true)
      return { status: 'success', mode, output_dir: outputDir, blend_path: project, video_path: videoPath, frames_dir: framesDir, frame_count: end - start + 1, log_tail: logTail, warnings: [] }
    } catch (error) {
      const status = deadline.signal.aborted ? 'timeout' : signal.aborted ? 'cancelled' : 'failed'
      return { status, mode, ...(outputDir ? { output_dir: outputDir } : {}), error: message(error).slice(-2000), log_tail: logTail, warnings: [] }
    } finally { clearTimeout(timer); clearInterval(heartbeat) }
  }

  private run(executable: string, args: string[], cwd: string, signal: AbortSignal, append: (chunk: Buffer | string) => void): Promise<void> {
    signal.throwIfAborted()
    return new Promise<void>((resolve, reject) => {
      let child: ReturnType<typeof spawn>
      let settled = false
      let stopping = false
      let closeSeen = false
      let killComplete = false
      let stopReason: Error | undefined
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(cleanupTimer)
        signal.removeEventListener('abort', abort)
        child?.stdout?.removeListener('data', append)
        child?.stderr?.removeListener('data', append)
        if (error) reject(error); else resolve()
      }
      const stop = (error: Error) => {
        if (settled || stopping) return
        stopping = true
        stopReason = error
        if (!child?.pid) { finish(error); return }
        // Wait for both the owned-tree termination command and child close. A
        // broken/mocked child may never emit close, so cleanup is still bounded.
        cleanupTimer = setTimeout(() => finish(error), CLEANUP_MS + 100)
        void killOwnedTree(child.pid).finally(() => {
          killComplete = true
          if (closeSeen) finish(error)
        })
      }
      const abort = () => stop(new Error(message(signal.reason ?? 'Render cancelled')))
      try {
        child = spawn(executable, args, { cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
        child.stdout?.on('data', append)
        child.stderr?.on('data', append)
        child.once('error', error => stop(error))
        child.once('close', (code, closeSignal) => {
          closeSeen = true
          if (stopping) { if (killComplete) finish(stopReason); return }
          if (code !== 0) stop(new Error(`Local render process exited with ${closeSignal ?? code ?? 'unknown status'}`))
          else finish()
        })
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
      } catch (error) { finish(new Error(`Failed to spawn local render process: ${message(error)}`)) }
    })
  }
}
