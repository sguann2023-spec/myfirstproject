type RecoveryPriority = 'foreground' | 'background'

type RecoveryTask = {
  priority: RecoveryPriority
  result: Promise<unknown>
  execute: () => Promise<void>
}

/** Recovery stays serial on its SQLite connection; only pending work can move. */
export class ContextRecoveryQueue {
  private pending: RecoveryTask[] = []
  private draining = false
  private foregroundHolds = 0

  holdForeground(): () => void {
    this.foregroundHolds++
    let released = false
    return () => {
      if (released) return
      released = true
      this.foregroundHolds--
      this.schedule()
    }
  }

  private schedule(): void {
    if (!this.draining && this.pending.length) {
      this.draining = true
      void Promise.resolve().then(() => this.drain())
    }
  }

  run<T>(operation: () => Promise<T>, priority: RecoveryPriority = 'foreground'): Promise<T> {
    let resolve!: (value: T) => void
    let reject!: (error: unknown) => void
    const result = new Promise<T>((done, failed) => { resolve = done; reject = failed })
    this.pending.push({ priority, result, execute: async () => {
      try { resolve(await operation()) } catch (error) { reject(error) }
    } })
    this.schedule()
    return result
  }

  promote(result: Promise<unknown>): void {
    const task = this.pending.find(task => task.result === result)
    if (task) task.priority = 'foreground'
    this.schedule()
  }

  private async drain(): Promise<void> {
    try {
      while (this.pending.length) {
        const firstForeground = this.pending.findIndex(task => task.priority === 'foreground')
        if (firstForeground < 0 && this.foregroundHolds > 0) break
        const [task] = this.pending.splice(firstForeground < 0 ? 0 : firstForeground, 1)
        await task.execute()
      }
    } finally {
      this.draining = false
    }
  }
}
