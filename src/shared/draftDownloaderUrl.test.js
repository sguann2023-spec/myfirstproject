import { describe, expect, it, vi } from 'vitest'

import { enqueueDraftDownloaderLink, parseDraftDownloaderUrl } from './draftDownloaderUrl'

describe('parseDraftDownloaderUrl', () => {
  it('extracts the draft id from the fixed downloader link', () => {
    expect(parseDraftDownloaderUrl(
      'https://www.vectcut.com/draft/downloader?draft_id=dfd_cat_1793899278_7c13470c'
    )).toBe('dfd_cat_1793899278_7c13470c')
  })

  it('keeps the draft id when the link carries extra query params', () => {
    expect(parseDraftDownloaderUrl(
      'https://www.vectcut.com/draft/downloader?draft_id=dfd_cat_1793899278_7c13470c&is_capcut=0'
    )).toBe('dfd_cat_1793899278_7c13470c')
  })

  it.each([
    ['https://www.vectcut.com/draft/downloader'], // 缺 draft_id
    ['https://www.vectcut.com/draft/downloader?draft_id='], // 空 draft_id
    ['https://www.vectcut.com/draft/other?draft_id=dfd_cat_1'], // 非 downloader 路径
    ['https://example.com/draft/downloader?draft_id=dfd_cat_1'], // 非 vectcut 域名
    ['https://www.vectcut.com/draft/downloaderx?draft_id=dfd_cat_1'], // 路径前缀相似但不同
    ['not a url'],
    [''],
    [null],
  ])('rejects non-draft link: %j', (value) => {
    expect(parseDraftDownloaderUrl(value)).toBe('')
  })
})

describe('enqueueDraftDownloaderLink', () => {
  it('enriches the draft and enqueues it', async () => {
    const enrich = vi.fn(async ([item]) => [{
      ...item,
      draft_name: '新西兰 | 字幕样式复刻修正版',
      cover: 'https://img.example.com/c.jpg',
      createdAt: 1234,
    }])
    const enqueue = vi.fn()

    const enqueued = await enqueueDraftDownloaderLink(
      'https://www.vectcut.com/draft/downloader?draft_id=dfd_cat_1793899278_7c13470c&is_capcut=0',
      '',
      { enrich, enqueue }
    )

    expect(enqueued).toBe(true)
    expect(enrich).toHaveBeenCalledExactlyOnceWith([{ draft_id: 'dfd_cat_1793899278_7c13470c', draft_name: undefined }])
    expect(enqueue).toHaveBeenCalledExactlyOnceWith({
      draft_id: 'dfd_cat_1793899278_7c13470c',
      draft_name: '新西兰 | 字幕样式复刻修正版',
      cover: 'https://img.example.com/c.jpg',
      createdAt: 1234,
    })
  })

  it('passes the clicked link title to enrich as draft_name', async () => {
    const enrich = vi.fn(async ([item]) => [item])
    const enqueue = vi.fn()

    await enqueueDraftDownloaderLink(
      'https://www.vectcut.com/draft/downloader?draft_id=dfd_cat_x', '链接标题', { enrich, enqueue }
    )

    expect(enrich).toHaveBeenCalledExactlyOnceWith([{ draft_id: 'dfd_cat_x', draft_name: '链接标题' }])
    expect(enqueue).toHaveBeenCalledExactlyOnceWith({ draft_id: 'dfd_cat_x', draft_name: '链接标题' })
  })

  it('returns false without enqueueing when enrich drops the draft', async () => {
    const enrich = vi.fn(async () => [])
    const enqueue = vi.fn()

    const enqueued = await enqueueDraftDownloaderLink(
      'https://www.vectcut.com/draft/downloader?draft_id=dfd_cat_y', '', { enrich, enqueue }
    )

    expect(enqueued).toBe(false)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('returns false without enriching for a non-draft link', async () => {
    const enrich = vi.fn()
    const enqueue = vi.fn()

    const enqueued = await enqueueDraftDownloaderLink('https://www.vectcut.com/docs/intro', '', { enrich, enqueue })

    expect(enqueued).toBe(false)
    expect(enrich).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
  })
})
