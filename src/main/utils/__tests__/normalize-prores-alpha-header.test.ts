import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
const { execMock } = vi.hoisted(() => ({ execMock: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile: execMock }))
vi.mock('../prepare-subtitle-audio', () => ({ resolveFfprobePath: () => 'probe' }))
import { normalizeProresAlphaHeaders } from '../normalize-prores-alpha-header'
const dirs: string[] = []
afterEach(async () => { vi.clearAllMocks(); await Promise.all(dirs.splice(0).map(d => fs.rm(d, { recursive: true, force: true }))) })
async function fixture(version = 0, alpha = 0x42, vendor = 'Lavc') {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'prores-header-')); dirs.push(dir)
 const file = path.join(dir, 'private.mov'); const b = Buffer.alloc(128, 0x77)
 b.writeUInt32BE(80,32);b.write('icpf',36);b.writeUInt16BE(0x94,40);b.writeUInt16BE(version,42);b.write(vendor,44);b[52]=0xc0;b[57]=alpha
 await fs.writeFile(file,b)
 execMock.mockImplementation((_c,_a,_o,cb) => cb(null,{stdout:JSON.stringify({packets:[{pos:'32',size:'80'}]}),stderr:''}))
 return {file,b}
}
describe('ProRes legacy alpha header normalization', () => {
 it('changes only version and alpha flag bytes, leaving all frame payload unchanged', async () => {
  const {file,b}=await fixture();const out=await normalizeProresAlphaHeaders(file);const actual=await fs.readFile(file)
  expect(out).toMatchObject({prores_frame_header_version:1,alpha_header_normalized_frames:1,video_frames:1})
  const expected=Buffer.from(b);expected.writeUInt16BE(1,42);expected[57]=2
  expect(actual.equals(expected)).toBe(true)
 })
 it('leaves modern valid headers untouched',async()=>{
  const {file,b}=await fixture(1,2);expect((await normalizeProresAlphaHeaders(file)).alpha_header_normalized_frames).toBe(0)
  expect((await fs.readFile(file)).equals(b)).toBe(true)
 })
 it('rejects unknown legacy encoders instead of guessing',async()=>{
  const {file,b}=await fixture(0,0x42,'ABCD');await expect(normalizeProresAlphaHeaders(file)).rejects.toThrow('未知')
  expect((await fs.readFile(file)).equals(b)).toBe(true)
 })
 it('rejects invalid packet locations',async()=>{
  const {file}=await fixture();execMock.mockImplementation((_c,_a,_o,cb)=>cb(null,{stdout:JSON.stringify({packets:[{pos:'99999',size:'80'}]}),stderr:''}))
  await expect(normalizeProresAlphaHeaders(file)).rejects.toThrow('位置或长度')
 })
})
