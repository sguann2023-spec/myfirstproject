import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getWorkspaceActivityPaths, isWorkspaceRunning, remapWorkspacePath, validateWorkspaceRename, workspaceActivity, workspacePathsOverlap } from '../workspaceRename'

const roots: string[] = []
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-rename-')))
  roots.push(root)
  const source = path.join(root, 'old')
  fs.mkdirSync(source)
  return { root, source }
}
afterEach(() => {
  roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }))
  workspaceActivity.runPaths.clear()
})
describe('workspace rename safety', () => {
  it('scopes runs to all referenced workspace paths, including descendants and ancestors', () => {
    const paths = getWorkspaceActivityPaths({ accessible_paths: ['/work/old/sub', 'relative'],
      configuration: { selected_workspace_path: '/work/selected' } })
    expect(paths).toEqual(['/work/old/sub', '/work/selected'])
    workspaceActivity.runPaths.set(Symbol(), paths)
    expect(isWorkspaceRunning('/work/old')).toBe(true)
    expect(isWorkspaceRunning('/work/selected')).toBe(true)
    expect(isWorkspaceRunning('/work/older')).toBe(false)
    expect(isWorkspaceRunning('/work/other')).toBe(false)
    expect(workspacePathsOverlap('/work/old/sub/deep', paths)).toBe(true)
    expect(workspacePathsOverlap('/work/old/', ['/work/old/./sub'])).toBe(true)
    expect(workspacePathsOverlap(undefined as any, paths)).toBe(false)
  })
  it.each(['', '.', '..', '../escape', 'a/b', 'a\\b', 'x\0', ' trailing ', 'x.', 'CON', 'a'.repeat(256)])('rejects invalid name %j', (name) => {
    expect(() => validateWorkspaceRename(fixture().source, name)).toThrow()
  })
  it.each(['中', '😀'])('validates 20 Unicode codepoints for %s', (char) => {
    const { source } = fixture()
    expect(validateWorkspaceRename(source, char.repeat(20))).toContain(char.repeat(20))
    expect(() => validateWorkspaceRename(source, char.repeat(21))).toThrow('最多20字')
  })
  it('allows a sibling directory and rejects an existing destination', () => {
    const { root, source } = fixture()
    expect(validateWorkspaceRename(source, '新名称')).toBe(path.join(root, '新名称'))
    fs.mkdirSync(path.join(root, 'taken'))
    expect(() => validateWorkspaceRename(source, 'taken')).toThrow('已存在')
    expect(validateWorkspaceRename(source, 'old')).toBe(source)
  })
  it('rejects symlinks and root paths', () => {
    const { root, source } = fixture()
    const link = path.join(root, 'link')
    fs.symlinkSync(source, link)
    expect(() => validateWorkspaceRename(link, 'new')).toThrow()
    expect(() => validateWorkspaceRename(path.parse(root).root, 'new')).toThrow()
  })
  it('remaps every descendant but not prefix siblings or relative paths', () => {
    expect(remapWorkspacePath('/a/old', '/a/old', '/a/new')).toBe('/a/new')
    expect(remapWorkspacePath('/a/old/sub/file', '/a/old', '/a/new')).toBe('/a/new/sub/file')
    expect(remapWorkspacePath('/a/older', '/a/old', '/a/new')).toBe('/a/older')
    expect(remapWorkspacePath('old/file', '/a/old', '/a/new')).toBe('old/file')
  })
})
