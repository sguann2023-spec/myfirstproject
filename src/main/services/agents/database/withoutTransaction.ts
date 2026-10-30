/** Runs once on the root executor. Completed statements are not rolled back. */
export async function withoutTransaction<Database, Result>(
  database: Database,
  operation: (executor: Database) => Promise<Result>
): Promise<Result> {
  return operation(database)
}
