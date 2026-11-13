import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import { promisify } from 'node:util'
import { resolveFfprobePath } from './prepare-subtitle-audio'
const execFileAsync = promisify(execFile)

/** FFmpeg 6 prores_ks writes version=0 and deprecated 0x40 alpha flag for 4444.
 * Match the version=1 / alpha-depth-only headers produced by modern prores_ks.
 * Packet size, slice payload, MOV atoms and alpha samples remain unchanged.
 * Only modify the private temporary output, never a source or arbitrary packet.
 */
export async function normalizeProresAlphaHeaders(file: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const { stdout } = await execFileAsync(resolveFfprobePath(), [
    '-v', 'error', '-select_streams', 'v:0', '-show_packets',
    '-show_entries', 'packet=pos,size', '-of', 'json', file
  ], { windowsHide: true, timeout: 60_000, maxBuffer: 16 * 1024 * 1024, signal })
  const packets = (JSON.parse(String(stdout)) as { packets?: Array<{ pos?: string; size?: string }> }).packets
  if (!packets?.length) throw new Error('ProRes 输出没有可验证的视频帧')
  const handle = await fs.open(file, 'r+')
  let changed = 0
  try {
    const stat = await handle.stat()
    for (const packet of packets) {
      signal?.throwIfAborted()
      const pos = Number(packet.pos), size = Number(packet.size)
      if (!Number.isSafeInteger(pos) || !Number.isSafeInteger(size) || pos < 0 || size < 28 || pos + size > stat.size) throw new Error('ProRes 帧位置或长度无效')
      const b = Buffer.alloc(28)
      if ((await handle.read(b, 0, b.length, pos)).bytesRead !== b.length || b.toString('ascii', 4, 8) !== 'icpf' || b.readUInt32BE(0) !== size) throw new Error('不支持的 ProRes 帧结构')
      const version = b.readUInt16BE(10), flags = b[25]
      const chroma = b[20] >> 6
      // Only the known legacy FFmpeg encoder header is eligible.
      if (version === 0 && b.toString('ascii', 12, 16) === 'Lavc' && chroma === 3 && [0x41, 0x42].includes(flags)) {
        const v = Buffer.from([0, 1]); await handle.write(v, 0, 2, pos + 10)
        const a = Buffer.from([flags & 0x0f]); await handle.write(a, 0, 1, pos + 25)
        changed++
      } else if (version !== 1 || chroma !== 3 || ![1, 2].includes(flags)) {
        throw new Error('未知 ProRes Alpha 帧头，不能安全规范化')
      }
    }
    await handle.sync()
  } finally { await handle.close() }
  return { prores_frame_header_version: 1, alpha_header_normalized_frames: changed, video_frames: packets.length }
}
