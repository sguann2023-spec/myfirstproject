import { beforeEach, describe, expect, it, vi } from 'vitest'
const { records } = vi.hoisted(() => ({ records: new Map<string, unknown>() }))
vi.mock('electron-store', () => ({
  default: class {
    get(key: string) { return records.get(key) }
    set(key: string, value: unknown) { records.set(key, value) }
  }
}))
import { BackgroundJobStore } from '../background-job'

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

describe('BackgroundJobStore', () => {
  beforeEach(() => records.clear())

  it('returns before slow work and deduplicates across transport instances', async () => {
    const jobs = new BackgroundJobStore('account-a')
    let finish!: (value: Record<string, unknown>) => void
    const run = vi.fn(() => new Promise<Record<string, unknown>>((resolve) => { finish = resolve }))
    const first = jobs.start('digital-human', 'request-a', { b: 2, a: 1 }, run)
    expect(first.status).toBe('running')
    expect(run).not.toHaveBeenCalled()
    const duplicate = new BackgroundJobStore('account-a').start('digital-human', 'request-a', { a: 1, b: 2 }, run)
    expect(duplicate.job_id).toBe(first.job_id)
    await tick()
    expect(run).toHaveBeenCalledTimes(1)
    finish({ video_url: 'https://example.com/digital.mp4' })
    await tick()
    expect(jobs.get(first.job_id, 'digital-human', vi.fn())).toMatchObject({
      status: 'success', result: { video_url: 'https://example.com/digital.mp4' }
    })
  })

  it('rejects changed parameters and isolates accounts and task kinds', async () => {
    const jobs = new BackgroundJobStore('account-a')
    const first = jobs.start('digital-human', 'request-b', { text: 'one' }, async () => ({}))
    expect(() => jobs.start('digital-human', 'request-b', { text: 'two' }, async () => ({})))
      .toThrow('different parameters')
    expect(() => new BackgroundJobStore('account-b').get(first.job_id, 'digital-human', vi.fn()))
      .toThrow('not found')
    expect(() => jobs.get(first.job_id, 'koubo-template', vi.fn())).toThrow('not found')
    await tick()
  })

  it('resumes only known upstream tasks and never resubmits an uncertain submission', async () => {
    const jobs = new BackgroundJobStore('account-a')
    const first = jobs.start('digital-human', 'request-c', {}, async (update) => {
      update({ task_id: 'upstream-1', metadata: { mode: 'lip_sync' } })
      throw new Error('network unavailable')
    })
    await tick()
    const resume = vi.fn(async () => ({ video_url: 'https://example.com/recovered.mp4' }))
    expect(jobs.get(first.job_id, 'digital-human', resume).status).toBe('running')
    await tick()
    expect(resume).toHaveBeenCalledOnce()
    expect(jobs.get(first.job_id, 'digital-human', resume).status).toBe('success')

    const uncertain = jobs.start('digital-human', 'request-d', {}, async () => { throw new Error('network unavailable') })
    await tick()
    expect(jobs.get(uncertain.job_id, 'digital-human', resume)).toMatchObject({
      status: 'interrupted', message: expect.stringContaining('不要自动重新提交')
    })
    expect(resume).toHaveBeenCalledOnce()
  })

  it('keeps explicit upstream failures terminal', async () => {
    const jobs = new BackgroundJobStore('account-a')
    const first = jobs.start('koubo-template', 'request-e', {}, async (update) => {
      update({ task_id: 'failed-1' })
      throw new Error('Koubo template task failed: insufficient points')
    })
    await tick()
    const resume = vi.fn()
    expect(jobs.get(first.job_id, 'koubo-template', resume).status).toBe('failed')
    expect(resume).not.toHaveBeenCalled()
  })
})
