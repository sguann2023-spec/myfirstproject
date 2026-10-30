import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('business persistence boundary', () => {
  it.each(['AgentService.ts', 'SessionService.ts', 'channels/sessionStreamIpc.ts'])(
    '%s does not own database transaction or rollback control',
    (file) => {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
      expect(source).not.toMatch(/\.transaction\s*\(/)
      expect(source).not.toMatch(/\.rollback\s*\(/)
    }
  )
})
