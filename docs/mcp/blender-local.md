# Local Blender MCP

`blender-local` provides two tools: `blender_status` and `blender_render`. It uses an installed, configured or auto-discovered native Blender executable. It does not download Blender, make remote service requests, submit asynchronous jobs, use cloud rendering, or report cloud billing. It is intentionally not included in the external aggregate MCP server.

## Permissions and trust

`blender_status` only checks local installation information. `blender_render` executes Python locally and follows the application's existing tool execution policy, without an additional Blender-specific approval step. This is **not a Python or filesystem sandbox**. Only use scripts and `.blend` projects you trust. Blender runs with the application's OS-user privileges. Workspace validation restricts the explicit tool input and output paths; Python, scene handlers, linked assets, and external dependencies can still access other resources with those privileges. `--disable-autoexec` suppresses automatic project script execution, but is not a security boundary for explicitly supplied Python. No tool argument can select an executable, append arbitrary CLI flags, or supply a runtime session identity.

The executable is configured in application settings, not through MCP arguments. `blender_status({})` returns `{configuredPath, path, source, status, version, error?, installUrl}` from the local executable service. Follow `installUrl` or select an existing executable in settings if it is unavailable. The status call does not install anything.

## Render inputs

One `blender_render` call waits for completion, including local MP4 encoding. Supply a script or a project, or combine a project with one script. Supplying both `script` and `script_path` is an error. Script files and `.blend` inputs must be nonempty regular files authorized under the configured workspace. Relative paths are workspace-relative; outside paths and symlink escapes are rejected. Inline/file Python scripts are capped at 2 MiB.

| Argument | Meaning |
| --- | --- |
| `script` | Inline Python scene-building code. |
| `script_path` | Existing workspace Python text file; mutually exclusive with `script`. |
| `blend_path` | Existing workspace `.blend`; opened before optional Python runs. |
| `mode` | `still` (default) or `animation`. |
| `frame` | Still-only integer frame, 0–1048574. Otherwise use the scene's current frame. |
| `frame_start`, `frame_end` | Animation-only integer bounds, 0–1048574, ordered start ≤ end. Omitted bounds use scene values. |
| `fps` | Integer 1–240; omitted uses scene rate, including its `fps_base`. |
| `engine` | `CYCLES` or `BLENDER_EEVEE_NEXT`; omitted uses the scene engine. |
| `resolution_x`, `resolution_y` | Integers 1–16384; omitted uses scene dimensions. Render percentage is always 100%. |
| `samples` | Integer 1–65536, applied to Cycles and legacy Eevee sampling when available. Eevee sampling APIs vary by Blender release. |
| `timeout_seconds` | Integer 1–3600; default 3600. One deadline covers preparation, rendering, frame checks, and MP4 encoding. |

Other keys, remote URLs, output path overrides, executable overrides, and CLI flag arguments are unsupported. Effective animation bounds and FPS are also checked after loading the project/script.

User Python should build/configure the scene and camera, not call render itself. A self-contained bootstrap loads the project, runs the script, then applies wrapper-owned output settings and requested render overrides. It saves `scene.blend` and invokes the Blender render operator. Output is always PNG; compositing, sequencing, multiview, and border rendering are disabled to keep the output contract predictable. The wrapper preserves original inputs and creates a unique workspace `artifact/blender/render-*` directory. Blender launches with background, factory-startup, disable-autoexec, and python-exit-code 1 flags, a native executable, `shell:false`, hidden Windows console, and explicit render-directory cwd. Scripts should use explicit workspace paths for assets; their cwd is not the source script directory.

### Small CPU still

Call `blender_render` with:

```json
{
  "script": "import bpy\nbpy.ops.wm.read_factory_settings(use_empty=True)\nbpy.ops.mesh.primitive_cube_add()\nbpy.ops.object.camera_add(location=(4, -4, 3))\ncamera = bpy.context.object\ncamera.rotation_euler = (-camera.location).to_track_quat('-Z', 'Y').to_euler()\nbpy.context.scene.camera = camera\nbpy.ops.object.light_add(type='AREA', location=(2, -2, 5))\nbpy.context.object.data.energy = 500\nbpy.context.scene.render.engine = 'CYCLES'\nbpy.context.scene.cycles.device = 'CPU'",
  "mode": "still",
  "engine": "CYCLES",
  "resolution_x": 128,
  "resolution_y": 128,
  "samples": 8,
  "timeout_seconds": 120
}
```

### Project animation

```json
{
  "blend_path": "scenes/product.blend",
  "script_path": "scripts/adjust_lighting.py",
  "mode": "animation",
  "frame_start": 1,
  "frame_end": 24,
  "fps": 24,
  "engine": "CYCLES",
  "resolution_x": 640,
  "resolution_y": 360,
  "samples": 16,
  "timeout_seconds": 600
}
```

The wrapper renders contiguous `frames/frame_0001.png` etc. and uses the existing local FFmpeg resolver to encode `render.mp4` (H.264, yuv420p, faststart; odd dimensions are padded to even dimensions). This is silent video: no scene audio is mixed into MP4. PNG frames and `scene.blend` remain available locally; no frame list or media bytes are embedded in the tool response. Prefer short low-resolution tests before long renders.

## Results and artifacts

Results are JSON in text content and `structuredContent`:

- Success: `status:"success"`, `mode`, `output_dir`, `blend_path`, `log_tail`, `warnings`; a still adds `image_path`, while animation adds `video_path`, `frames_dir`, and `frame_count`.
- Failure: `status:"failed"|"cancelled"|"timeout"`, `mode`, `error`, `log_tail`, `warnings`, and `output_dir` if allocated; MCP sets `isError:true`. Early protocol/status errors may omit render-specific fields.
- Logs retain only the last 16 Ki characters. Progress messages retain at most 400 characters, are throttled, and emit idle heartbeats roughly every five seconds. Standard MCP progress token `0` is supported. Progress percentages before completion are indicative, not precise frame estimates. A failed/disconnected notification never fails the render.

When the caller supplies a trusted runtime session via the server constructor, successful final PNG/MP4 outputs are registered with `registerArtifact` and emit only `app:artifact-registered`. `.blend` is returned as a path, not misclassified as a document. Animation frames are not individually registered. Without a session the render still succeeds with saved paths and a warning, but nothing is indexed. Artifact/index/preview errors preserve successful render outputs and are returned as warnings.

Timeout, request cancellation, explicit MCP close, and transport disconnect terminate only the owned PID tree: Windows uses `taskkill /PID <pid> /T /F` via `execFile`, Unix uses the spawned process group. Cleanup waits for child close with a bounded fallback if close never arrives; it never kills by executable name. Partial outputs are retained for inspection. Internal render budget is 3600 seconds; the MCP registry uses a slightly larger 3660-second allowance for cleanup/transport.

## Backend integration and tests

```ts
import BlenderLocalServer from '@main/mcpServers/blender-local'
import { BlenderRenderService } from '@main/services/BlenderRenderService'

const server = new BlenderLocalServer(workspacePath, { runtimeSessionId })
// server.mcpServer is the SDK McpServer; server.close() aborts owned work and closes MCP.

const renderer = new BlenderRenderService()
const result = await renderer.render(workspacePath, input, { signal, onProgress })
await renderer.close()
```

`render(workspacePath: string | undefined, input: unknown, context?: {signal?: AbortSignal; onProgress?: (progress: number, message: string) => void})` returns `Promise<BlenderRenderResult>`. `close(): Promise<void>` aborts active work and prevents new renders on that instance. `parseBlenderRenderInput(value: unknown): BlenderRenderInput` is exported for strict schema/semantic checks. Dependency contract is `localBlenderService.requireExecutable(): Promise<{path:string,version:string,...}>` plus `getPathInfo({force?}?)`; shared constants are imported from `@shared/blender`.

Simulated tests require neither a Blender installation nor networking:

```sh
pnpm exec vitest run --config src/main/mcpServers/__tests__/blender-local.vitest.config.mjs
```

Opt-in real local Blender CPU smoke (small still, two-frame MP4, cancellation; no GUI):

```sh
BLENDER_LOCAL_SMOKE=1 pnpm exec vitest run --config src/main/mcpServers/__tests__/blender-local.vitest.config.mjs
```
