import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))
vi.mock('electron-store', () => ({ default: class { get() {} } }))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ info() {}, warn() {}, error() {} }) } }))
vi.mock('@main/utils', () => ({ getResourcePath: () => '/tmp' }))
vi.mock('../social-copywriting', () => ({
  default: class {
    mcpServer = { close: vi.fn() }
    async resolveVideoShareLink(source: string, billing: any) {
      if (source.includes('douyin.com')) {
        billing.record('parse_share_link', { billing: { consume: '0.1' } })
        return 'https://cdn.example.com/video.mp4'
      }
      return source
    }
  },
}))

import VideoUnderstandServer from '../video-understand'

describe('逐帧拉片直连计费', () => {
  it('合并分享解析和每批视觉计费，不重复计算视觉总价', async () => {
    const server = new VideoUnderstandServer()
    const submit = vi.spyOn(server as any, 'submitVideoDetailTask').mockImplementation(async (args: any, extra: any) => {
      expect(args.videoUrls).toEqual(['https://cdn.example.com/video.mp4', '/tmp/local.mp4'])
      expect(args.includeSummaries).toBe(true)
      expect(args.includeDetails).toBeUndefined()
      extra.onBilling({ total_consumed_points: 1.2 })
      extra.onBilling({ total_consumed_points: 0.3 })
      extra.onBilling({ total_consumed_points: 0.25 }, 'asr')
      return { content: [{ type: 'text', text: JSON.stringify({ billing: { total_consumed_points: 1.5 }, videos: [] }) }] }
    })
    const result = await server.executeDirectRequest({
      videoUrls: ['https://v.douyin.com/share/', '/tmp/local.mp4'],
    }, { requestId: 'r' })
    const response = JSON.parse(result.content[0].text)
    expect(response.billing.total_consumed_points).toBe(1.85)
    expect(response.billing.complete).toBe(true)
    expect(response.billing.stages).toHaveLength(4)
    expect(response.billing.stages[3]).toEqual({ stage: 'asr', points_consumed: 0.25 })
    expect(submit).toHaveBeenCalledOnce()
    await server.mcpServer.close()
  })
  it('理解失败仍保留分享解析费和已完成批次费用', async () => {
    const server = new VideoUnderstandServer()
    vi.spyOn(server as any, 'submitVideoDetailTask').mockImplementation(async (_args: any, extra: any) => {
      extra.onBilling({ total_consumed_points: 0.5 })
      throw new Error('第二批分析失败')
    })
    const result = await server.executeDirectRequest({ videoUrls: ['https://v.douyin.com/share/'] }, { requestId: 'r' })
    expect(result).toHaveProperty('isError', true)
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      error: '第二批分析失败', billing: { total_consumed_points: 0.6, complete: false },
    })
    await server.mcpServer.close()
  })
  it('直接视频 URL 不产生分享解析费', async () => {
    const server = new VideoUnderstandServer()
    vi.spyOn(server as any, 'submitVideoDetailTask').mockImplementation(async (_args: any, extra: any) => {
      extra.onBilling({ total_consumed_points: 0.5 })
      return { content: [{ type: 'text', text: '{"billing":{"total_consumed_points":0.5}}' }] }
    })
    const result = await server.executeDirectRequest({ videoUrls: ['https://cdn.example.com/video.mp4'] }, { requestId: 'r' })
    expect(JSON.parse(result.content[0].text).billing).toMatchObject({
      total_consumed_points: 0.5, stages: [{ stage: 'video_understand', points_consumed: 0.5 }],
    })
    await server.mcpServer.close()
  })
})
