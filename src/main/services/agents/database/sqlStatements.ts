/** Split migration scripts without splitting quoted text or trigger bodies. */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let start = 0, quote = '', comment = '', token = '', trigger = false, depth = 0, cases = 0
  const finish = () => {
    const word = token.toUpperCase()
    if (word === 'TRIGGER') trigger = true
    if (trigger && word === 'CASE') cases++
    if (trigger && word === 'BEGIN') depth++
    if (trigger && word === 'END') { if (cases) cases--; else depth-- }
    token = ''
  }
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i], next = sql[i + 1]
    if (comment === '--') { if (ch === '\n') comment = ''; continue }
    if (comment === '/*') { if (ch === '*' && next === '/') { comment = ''; i++ }; continue }
    if (quote) { if (ch === quote) { if (next === quote && quote !== ']') i++; else quote = '' }; continue }
    if (ch === '-' && next === '-') { finish(); comment = '--'; i++; continue }
    if (ch === '/' && next === '*') { finish(); comment = '/*'; i++; continue }
    if (ch === "'" || ch === '"' || ch === '`' || ch === '[') { finish(); quote = ch === '[' ? ']' : ch; continue }
    if (/[a-zA-Z_]/.test(ch)) { token += ch; continue }
    finish()
    if (ch === ';' && depth <= 0) {
      const part = sql.slice(start, i + 1).trim()
      if (part.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '').trim()) statements.push(part)
      start = i + 1; trigger = false; depth = 0; cases = 0
    }
  }
  finish()
  const tail = sql.slice(start).trim()
  if (tail.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '').trim()) statements.push(tail)
  return statements
}
