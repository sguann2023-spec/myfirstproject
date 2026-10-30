type SqliteDiagnosticCause = {
  name: string
  code?: string
  rawCode?: number
  category?: string
}

/** Safe diagnostics: never log wrapper messages (Drizzle includes SQL and parameters). */
export function sqliteErrorDiagnostics(error: unknown): SqliteDiagnosticCause & { causes: SqliteDiagnosticCause[] } {
  const causes: SqliteDiagnosticCause[] = []
  const seen = new Set<unknown>()
  let current: any = error
  while (current && typeof current === 'object' && !seen.has(current) && causes.length < 8) {
    seen.add(current)
    const message = typeof current.message === 'string' ? current.message : ''
    const category = /\bSQLITE_BUSY(?:_\w+)?\b|database is locked/i.test(message) ? 'busy'
      : /\bSQLITE_LOCKED(?:_\w+)?\b|database table is locked/i.test(message) ? 'locked'
        : /foreign key constraint/i.test(message) ? 'foreign_key'
          : /unique constraint/i.test(message) ? 'unique'
            : /not null constraint/i.test(message) ? 'not_null'
              : /no such table/i.test(message) ? 'missing_table'
                : /no such column|has no column named/i.test(message) ? 'missing_column'
                  : undefined
    causes.push({
      name: String(current.name || 'Error').slice(0, 80),
      code: typeof current.code === 'string' ? current.code.slice(0, 80) : undefined,
      rawCode: typeof current.rawCode === 'number' ? current.rawCode : undefined,
      category
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
