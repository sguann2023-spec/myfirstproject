import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { isQuickSkillCompatible, isSafeSkillFolder, type QuickSkillsManifest } from '../../shared/quickSkillManifest'
import { getDataPath, getResourcePath } from '.'
import { isHomepageOperationsMockEnabled } from './homepageOperationsMock'

export const getQuickSkillsRoot = () => path.join(getDataPath(), isHomepageOperationsMockEnabled() ? 'QuickSkillsMock' : 'QuickSkills')
export const getQuickSkillsManifestPath = () => path.join(getQuickSkillsRoot(), 'manifest.json')

/** One immutable active snapshot per process, including first-run bundle fallback. */
let activeSnapshot: Promise<{ manifest: QuickSkillsManifest; basePath: string }> | undefined
export function getActiveQuickSkills() {
  if (!activeSnapshot) activeSnapshot = (async () => {
    try {
      const manifest = JSON.parse(await fs.readFile(getQuickSkillsManifestPath(), 'utf-8'))
      if (!manifest?.skills || typeof manifest.skills !== 'object' || Array.isArray(manifest.skills)) throw new Error('Invalid cache')
      return { manifest: manifest as QuickSkillsManifest, basePath: path.join(getQuickSkillsRoot(), 'skills') }
    } catch {
      const basePath = path.join(getResourcePath(), 'quick', 'skills')
      try {
        return { manifest: JSON.parse(await fs.readFile(path.join(basePath, 'manifest.json'), 'utf-8')) as QuickSkillsManifest, basePath }
      } catch { return { manifest: { skills: {} } as QuickSkillsManifest, basePath } }
    }
  })()
  return activeSnapshot
}

export async function listQuickSkillSources() {
  const { manifest, basePath } = await getActiveQuickSkills()
  return Object.entries(manifest.skills).flatMap(([key, entry]) => {
    const folderName = String(entry.folderName || key)
    if (entry.deleted || !isSafeSkillFolder(folderName) || !isQuickSkillCompatible(entry, app.getVersion())) return []
    const directory = path.resolve(basePath, entry.storageRelativePath || folderName)
    if (!directory.startsWith(path.resolve(basePath) + path.sep)) return []
    return [{ folderName, directory, entry }]
  })
}
