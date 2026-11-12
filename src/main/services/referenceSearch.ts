import * as fs from 'fs/promises'
import * as path from 'path'

const excluded = new Set(['node_modules', 'dist', 'build', 'coverage', '__pycache__', 'venv', 'vendor', 'target'])

// Literal root-relative matching, before the cap. Never follow directory symlinks.
export async function searchReferenceFiles(root: string, query: string, limit: number): Promise<string[]> {
  const needle = query.replace(/\\/g, '/').trim().toLowerCase()
  const matches: string[] = []
  async function visit(directory: string, relative: string) {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (matches.length >= limit) return
      if (entry.name.startsWith('.') || excluded.has(entry.name)) continue
      const name = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) await visit(path.join(directory, entry.name), name)
      else if (entry.isFile() && name.toLowerCase().includes(needle)) matches.push(name)
    }
  }
  await visit(root, '')
  return matches
}
