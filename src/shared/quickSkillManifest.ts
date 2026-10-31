import semver from 'semver'

export interface QuickSkillEntry {
  version?: string
  downloadUrl?: string
  minAppVersion?: string
  maxAppVersion?: string
  deleted?: boolean
  tombstoneVersion?: string
  name?: string
  folderName?: string
  action?: string
  order?: number
  headline?: string
  description?: string
  websitePath?: string
  coverPath?: string
  coverUrl?: string
  previewVideoUrl?: string
  title?: string
  content?: string
  followers_count?: string
  likes_count?: string
  web_share?: string
  estimated_usage?: string | number
  /** Local cache metadata; never accepted from the service. */
  storageRelativePath?: string
}

export interface QuickSkillsManifest {
  updatedAt?: string
  skills: Record<string, QuickSkillEntry>
}

export function isSafeSkillFolder(value: string): boolean {
  return Boolean(value && value !== '.' && value !== '..' && !/[\\/\0:]/.test(value) && !value.startsWith('.'))
}

export function isQuickSkillCompatible(entry: QuickSkillEntry, appVersion: string): boolean {
  const current = semver.valid(appVersion)
  if (!current) return false
  if (entry.minAppVersion && (!semver.valid(entry.minAppVersion) || semver.lt(current, entry.minAppVersion))) return false
  if (entry.maxAppVersion && (!semver.valid(entry.maxAppVersion) || semver.gt(current, entry.maxAppVersion))) return false
  return true
}

/** Reject malformed successes instead of replacing a working cache with an empty one. */
export function parseQuickSkillsResponse(payload: unknown): QuickSkillsManifest {
  const response = payload as { code?: number; data?: QuickSkillsManifest }
  const manifest = response?.data
  if (response?.code !== 0 || !manifest || !manifest.skills || typeof manifest.skills !== 'object' || Array.isArray(manifest.skills)) {
    throw new Error('首页运营配置格式无效')
  }
  const skills: Record<string, QuickSkillEntry> = {}
  for (const [key, raw] of Object.entries(manifest.skills)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('首页运营条目格式无效')
    const entry = { ...raw }
    delete entry.storageRelativePath
    entry.folderName = String(entry.folderName || key).trim()
    if (!isSafeSkillFolder(entry.folderName)) throw new Error('首页技能目录无效')
    if (!entry.deleted && (!semver.valid(entry.version || '') || !/^https:\/\//i.test(entry.downloadUrl || ''))) {
      throw new Error('首页技能版本或下载地址无效')
    }
    skills[key] = entry
  }
  return { updatedAt: manifest.updatedAt, skills }
}

export function selectHomepageSkills(manifest: QuickSkillsManifest, appVersion: string): QuickSkillEntry[] {
  return Object.values(manifest?.skills || {})
    .filter((entry) => !entry.deleted && isQuickSkillCompatible(entry, appVersion))
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)
      || String(a.folderName || '').localeCompare(String(b.folderName || '')))
    .slice(0, 3)
}
