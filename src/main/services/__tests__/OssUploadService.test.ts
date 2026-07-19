import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockNetFetch, mockStoreGet, mockStoreSet } = vi.hoisted(() => ({
  mockNetFetch: vi.fn(),
  mockStoreGet: vi.fn(),
  mockStoreSet: vi.fn()
}))

vi.mock('electron', () => ({
  net: {
    fetch: mockNetFetch
  }
}))

vi.mock('electron-store', () => ({
  default: class MockStore {
    get(key: string) {
      return mockStoreGet(key)
    }

    set(key: string, value: unknown) {
      return mockStoreSet(key, value)
    }
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }))
  }
}))

import { ossUploadService } from '../OssUploadService'

function mockJsonResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data)
  } as Response
}

describe('OssUploadService', () => {
  let tempFilePath = ''

  beforeEach(async () => {
    vi.clearAllMocks()
    ;(ossUploadService as any).accessToken = null
    ;(ossUploadService as any).refreshPromise = null
    mockStoreGet.mockImplementation((key: string) => (key === 'auth.refresh_token' ? 'refresh-token' : undefined))

    tempFilePath = path.join(os.tmpdir(), `oss-upload-${Date.now()}.mp3`)
    await fs.writeFile(tempFilePath, Buffer.from('hello upload'))
  })

  afterEach(async () => {
    if (tempFilePath) {
      await fs.rm(tempFilePath, { force: true })
    }
  })

  it('uploads local files with fixed folder and hash-based object key', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          refresh_token: 'refresh-token-next',
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          bucket_name: 'jianying-upload-tmp',
          region: 'oss-cn-hangzhou',
          key_prefix: 'agent_tmp',
          credentials: {
            AccessKeyId: 'ak',
            AccessKeySecret: 'sk',
            SecurityToken: 'st'
          }
        })
      )
      .mockResolvedValueOnce(mockJsonResponse({}, true, 200))

    const bytes = await fs.readFile(tempFilePath)
    const hash = createHash('sha256').update(bytes).digest('hex')
    const result = await ossUploadService.uploadLocalFile(tempFilePath, {
      bucket: 'jianying-upload-tmp',
      region: 'oss-cn-hangzhou',
      folder: 'agent_tmp'
    })

    expect(mockStoreSet).toHaveBeenCalledWith('auth.refresh_token', 'refresh-token-next')
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/sts/get_credentials',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'Content-Type': 'application/json'
        }),
        body: JSON.stringify({
          bucket_name: 'jianying-upload-tmp',
          folder: 'agent_tmp'
        })
      })
    )
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      3,
      'https://jianying-upload-tmp.oss-cn-hangzhou.aliyuncs.com',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(FormData)
      })
    )
    expect(result.objectKey).toBe(`agent_tmp/vectcut_koubo_tmp_file_${hash}.mp3`)
    expect(result.publicUrl).toBe(`https://player.install-ai-guider.top/agent_tmp/vectcut_koubo_tmp_file_${hash}.mp3`)
    expect(result.signedPublicUrl).toContain(`https://player.install-ai-guider.top/agent_tmp/vectcut_koubo_tmp_file_${hash}.mp3?`)
    expect(result.bucket).toBe('jianying-upload-tmp')
    expect(result.region).toBe('oss-cn-hangzhou')
    expect(result.contentType).toBe('audio/mpeg')
    expect(result.size).toBe(bytes.length)
  })
})
