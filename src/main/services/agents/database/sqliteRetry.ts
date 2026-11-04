type SqliteDiagnosticCause = {
  name: string
  code?: string
  rawCode?: number
  category?: string
  frameBytes?: number
  maxFrameBytes?: number
  frames?: string[]
}

/** Safe diagnostics: never log wrapper messages (Drizzle includes SQL and parameters). */
export function sqliteErrorDiagnostics(error: unknown): SqliteDiagnosticCause & { causes: SqliteDiagnosticCause[] } {
  const causes: SqliteDiagnosticCause[] = []
  const seen = new Set<unknown>()
  let current: any = error
  while (current && typeof current === 'object' && !seen.has(current) && causes.length < 8) {
    seen.add(current)
    const message = typeof current.message === 'string' ? current.message : ''
    const category = /^Database frame exceeds size limit/.test(message) ? 'frame_size'
      : /\bSQLITE_BUSY(?:_\w+)?\b|database is locked/i.test(message) ? 'busy'
      : /\bSQLITE_LOCKED(?:_\w+)?\b|database table is locked/i.test(message) ? 'locked'
        : /foreign key constraint/i.test(message) ? 'foreign_key'
          : /unique constraint/i.test(message) ? 'unique'
            : /not null constraint/i.test(message) ? 'not_null'
              : /no such table/i.test(message) ? 'missing_table'
                : /no such column|has no column named/i.test(message) ? 'missing_column'
                  : /offline for storage replacement/i.test(message) ? 'storage_maintenance'
                    : /writer stopped after an earlier failure/i.test(message) ? 'writer_stopped'
                      : /duplicate entity identity/i.test(message) ? 'duplicate_identity'
                        : /broker.*(?:disconnected|connection closed|timed out)/i.test(message) ? 'broker_disconnected'
                          : /worker exited/i.test(message) ? 'worker_exited'
                            : /identity mismatch|configuration mismatch|configuration hello/i.test(message) ? 'broker_configuration'
                              : /writer is closed|client closed|shutting down/i.test(message) ? 'closed'
                                : /safely represented|safe integer range/i.test(message) ? 'integer_range'
                                  : /disk.*full|SQLITE_FULL/i.test(message) ? 'disk_full'
                                    : /disk I\/O|SQLITE_IOERR/i.test(message) ? 'io_error'
                                      : /readonly database|SQLITE_READONLY/i.test(message) ? 'readonly'
                                      : /syntax error/i.test(message) ? 'syntax_error'
                                        : /malformed JSON/i.test(message) ? 'malformed_json'
                                          : /unqualified entity view|exactly one SQL statement|unsupported/i.test(message) ? 'unsupported_statement'
                                            : undefined
    causes.push({
      name: String(current.name || 'Error').slice(0, 80),
      code: typeof current.code === 'string' ? current.code.slice(0, 80) : undefined,
      rawCode: typeof current.rawCode === 'number' ? current.rawCode : undefined,
      frameBytes: typeof current.frameBytes === 'number' ? current.frameBytes : undefined,
      maxFrameBytes: typeof current.maxFrameBytes === 'number' ? current.maxFrameBytes : undefined,
      category,
      // Omit stack headers, which repeat the SQL-bearing wrapper message.
      frames: typeof current.stack === 'string'
        ? current.stack.split('\n').filter((line: string) => /^\s+at\s/.test(line)).slice(0, 8)
        : undefined
    })
    current = current.cause
  }
  return { ...(causes[0] ?? { name: 'UnknownError' }), causes }
}

/** Drizzle, SessionError and AggregateError can wrap the actual SQLite failure. */
export function isSqliteBusy(error: unknown, seen = new Set<unknown>()): boolean {
  if (error == null || seen.has(error)) return false
  seen.add(error)
  if (typeof error === 'string') return /\bSQLITE_BUSY(?:_\w+)?\b|database is locked/i.test(error)
  if (typeof error !== 'object') return false
  const value = error as { code?: unknown; message?: unknown; cause?: unknown; errors?: unknown[] }
  return isSqliteBusy(value.code, seen) || isSqliteBusy(value.message, seen)
    || isSqliteBusy(value.cause, seen)
    || (Array.isArray(value.errors) && value.errors.some((item) => isSqliteBusy(item, seen)))
}

export async function retrySqliteBusy<T>(operation: () => Promise<T>): Promise<T> {
  // Compatibility export for existing callers; submitted writes must never be retried.
  return operation()
}
