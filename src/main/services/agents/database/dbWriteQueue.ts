/**
 * Global async mutex serializing transactional writes to the agents database.
 *
 * The libsql local client multiplexes every statement over a single SQLite
 * connection, so two concurrently open transactions interleave their
 * statements and fail with `SQLITE_BUSY: database is locked` or
 * `cannot commit transaction - SQL statements in progress`. Every code path
 * that wraps multiple statements in a transaction (canonical transcript,
 * durable PI session storage, legacy dual writes, backfill/reconciliation)
 * must acquire this lock first. Plain single-statement reads and writes are
 * safe without it.
 */

let tail: Promise<void> = Promise.resolve()

export function withDbWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = tail.then(operation, operation)
  tail = result.then(
    () => undefined,
    () => undefined
  )
  return result
}
