import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { searchReferenceFiles } from '../referenceSearch'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))) })
async function fixture(files: string[]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reference-search-'))
  roots.push(root)
  for (const file of files) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true })
    await fs.writeFile(path.join(root, file), '')
  }
  return root
}

describe('literal recursive reference search', () => {
  it('matches relative paths and filenames before applying the limit', async () => {
    const root = await fixture(['a.txt', 'b.txt', 'chat/app.py', 'other/app.py'])
    expect(await searchReferenceFiles(root, 'app.py', 1)).toEqual(['chat/app.py'])
    expect(await searchReferenceFiles(root, 'CHAT\\APP.PY', 20)).toEqual(['chat/app.py'])
    expect(await searchReferenceFiles(root, 'missing/app.py', 20)).toEqual([])
    expect(await searchReferenceFiles(root, 'a*p.py', 20)).toEqual([])
    expect(await searchReferenceFiles(root, path.basename(root), 20)).toEqual([])
  })

  it('searches beyond ten levels but excludes hidden/generated trees and symlinks', async () => {
    const deep = `${Array(15).fill('nested').join('/')}/app.py`
    const root = await fixture([deep, '.hidden/app.py', 'node_modules/app.py', 'dist/app.py', '__pycache__/app.py'])
    await fs.symlink(root, path.join(root, 'loop'), 'dir')
    expect(await searchReferenceFiles(root, 'app.py', 20)).toEqual([deep])
  })

  it('surfaces inaccessible roots rather than reporting no matches', async () => {
    const root = await fixture([])
    await expect(searchReferenceFiles(path.join(root, 'gone'), 'app.py', 20)).rejects.toThrow()
  })
})
