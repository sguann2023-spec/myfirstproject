import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { isQuickSkillCompatible, isSafeSkillFolder, type QuickSkillsManifest } from '../../shared/quickSkillManifest'
import { getDataPath, getResourcePath } from '.'

// This release reads bundled templates exclusively; remote activation stays disabled.
export const useBundledHomepageSkills = (): boolean => true
export const getQuickSkillsRoot = () => path.join(getDataPath(), 'QuickSkills')
export const getQuickSkillsManifestPath = () => path.join(getQuickSkillsRoot(), 'manifest.json')

/** One immutable bundled snapshot per process; ignore all previous operation caches. */
let activeSnapshot: Promise<{ manifest: QuickSkillsManifest; basePath: string }> | undefined
export function getActiveQuickSkills() {
  if (!activeSnapshot) activeSnapshot = (async () => {
    const basePath = path.join(getResourcePath(), 'quick', 'skills')
    try {
      return { manifest: JSON.parse(await fs.readFile(path.join(basePath, 'manifest.json'), 'utf-8')) as QuickSkillsManifest, basePath }
    } catch { return { manifest: { skills: {} } as QuickSkillsManifest, basePath } }
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
