import { createHash } from 'node:crypto'
import Store from 'electron-store'

type JobStatus = 'running' | 'success' | 'failed' | 'interrupted'
export type BackgroundJob = {
  job_id: string
  request_id: string
  fingerprint: string
  kind: string
  status: JobStatus
  progress: number
  message: string
  created_at: string
  updated_at: string
  task_id?: string
  metadata?: Record<string, unknown>
  result?: Record<string, unknown>
}
export type JobUpdate = (patch: Partial<BackgroundJob>) => void
type JobRun = (update: JobUpdate) => Promise<Record<string, unknown>>

const activeJobs = new Set<string>()

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonicalize(item)]))
  }
  return value
}

// Shared across MCP transport instances; disk records survive disconnects and app restarts.
export class BackgroundJobStore {
  private readonly store = new Store({ name: 'vectcut-background-jobs' })

  constructor(private readonly accountId: string) {
    if (!accountId) throw new Error('Sign in again: a stable account ID is required for background tasks')
  }

  private key(jobId: string) {
    return `jobs.${createHash('sha256').update(this.accountId).digest('hex')}.${jobId}`
  }

  start(kind: string, requestId: string, args: Record<string, unknown>, run: JobRun): BackgroundJob {
    if (!requestId.trim()) throw new Error('requestId is required; reuse it when retrying the same task')
    const jobId = createHash('sha256').update(`${kind}:${requestId}`).digest('hex')
    const fingerprint = createHash('sha256').update(JSON.stringify(canonicalize(args))).digest('hex')
    const existing = this.store.get(this.key(jobId)) as BackgroundJob | undefined
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error('requestId already exists with different parameters')
      return existing
    }
    const now = new Date().toISOString()
    const job: BackgroundJob = {
      job_id: jobId, request_id: requestId, fingerprint, kind, status: 'running',
      progress: 0, message: '任务已受理，正在后台准备', created_at: now, updated_at: now
    }
    this.store.set(this.key(jobId), job)
    this.execute(job, run)
    return job
  }

  get(jobId: string, kind: string, resume: (job: BackgroundJob, update: JobUpdate) => Promise<Record<string, unknown>>) {
    const job = this.store.get(this.key(jobId)) as BackgroundJob | undefined
    if (!job || job.kind !== kind) throw new Error('Background task not found for this account and tool')
    if ((job.status === 'running' || job.status === 'interrupted') && !activeJobs.has(this.key(jobId))) {
      if (job.task_id) {
        this.execute(job, (update) => resume(job, update))
      } else {
        this.update(jobId, {
          status: 'interrupted',
          message: '准备或提交阶段被中断，服务端是否已创建任务未知。请先核对任务记录，不要自动重新提交。'
        })
      }
    }
    return this.store.get(this.key(jobId)) as BackgroundJob
  }

  private update(jobId: string, patch: Partial<BackgroundJob>) {
    const job = this.store.get(this.key(jobId)) as BackgroundJob
    this.store.set(this.key(jobId), { ...job, ...patch, updated_at: new Date().toISOString() })
  }

  private execute(job: BackgroundJob, run: JobRun) {
    const key = this.key(job.job_id)
    activeJobs.add(key)
    this.update(job.job_id, { status: 'running' })
    // Do not attach background work to a transport's cancellation signal or progress channel.
    setImmediate(() => {
      void run((patch) => this.update(job.job_id, patch))
        .then((result) => this.update(job.job_id, { status: 'success', progress: 100, message: '任务完成', result }))
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          this.update(job.job_id, {
            status: /task failed|creation failed|returned no task ID|required|Invalid|Unknown template/i.test(message)
              ? 'failed' : 'interrupted',
            message
          })
        })
        .finally(() => activeJobs.delete(key))
    })
  }
}

export const BACKGROUND_REQUEST_ID_PROPERTY = {
  type: 'string',
  description: 'Required unique ID for this logical task. Reuse the same ID and parameters after timeout; never create a new ID just to retry.'
}

export const backgroundStatusTool = (name: string, description: string) => ({
  name, description,
  inputSchema: {
    type: 'object' as const,
    properties: { jobId: { type: 'string', description: 'Local job_id returned by the start tool, not upstream task_id.' } },
    required: ['jobId'],
    additionalProperties: false
  }
})
