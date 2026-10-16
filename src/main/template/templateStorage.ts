import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { TEMPLATE_PRESETS } from '../../shared/templatePresets'
import { getDataPath } from '../utils'
import { createEditorPreset } from './editorPresets'

export interface TemplateStorageRef {
  directory: string
  templatePath: string
}

export interface StoredTemplateDocument {
  templateJson: string
  configJson: string
  templateStorage: TemplateStorageRef
}

export interface TemplateListItem {
  id: string
  name: string
  description: string
  source: 'preset' | 'local'
  templatePath?: string
}

const TEMPLATE_FILE = 'template.json'
const LEGACY_WORKSPACE_AGENT_ID = 'vectcut_claw_default'
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function getTemplateScenesDirectory() {
  return getDataPath(path.join('Workspaces', 'template', 'scenes'))
}

function getLegacyTemplateScenesDirectory() {
  return path.join(getDataPath(), 'Workspaces', LEGACY_WORKSPACE_AGENT_ID, 'template', 'scenes')
}

function uniqueDirectoryPath(root: string) {
  let candidate = path.join(root, randomUUID())
  while (fs.existsSync(candidate)) {
    candidate = path.join(root, randomUUID())
  }
  return candidate
}

function uniqueDirectory(root: string) {
  const candidate = uniqueDirectoryPath(root)
  fs.mkdirSync(candidate, { recursive: true })
  return candidate
}

function migrateLegacyTemplates() {
  const legacyRoot = getLegacyTemplateScenesDirectory()
  if (!fs.existsSync(legacyRoot)) return
  const root = getTemplateScenesDirectory()
  for (const entry of fs.readdirSync(legacyRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const source = path.join(legacyRoot, entry.name)
    if (!fs.existsSync(path.join(source, TEMPLATE_FILE))) continue
    const target = uniqueDirectoryPath(root)
    try {
      fs.renameSync(source, target)
    } catch {
      fs.cpSync(source, target, { recursive: true })
      fs.rmSync(source, { recursive: true, force: true })
    }
  }
}

export function formatTemplateModifiedAt(modifiedAt: Date, now = new Date()) {
  const diff = Math.max(0, now.getTime() - modifiedAt.getTime())
  if (diff < HOUR) return `${Math.max(1, Math.floor(diff / MINUTE))}分钟前`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}小时前`
  if (diff <= 7 * DAY) return `${Math.floor(diff / DAY)} 天前`
  const month = String(modifiedAt.getMonth() + 1).padStart(2, '0')
  const date = String(modifiedAt.getDate()).padStart(2, '0')
  return `${month}/${date}`
}

function assertInsideScenesDirectory(filePath: string) {
  const root = path.resolve(getTemplateScenesDirectory())
  const resolved = path.resolve(filePath)
  const relative = path.relative(root, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('模版保存路径不在工作空间内')
  return resolved
}

function readTemplateName(templatePath: string, fallback: string) {
  try {
    const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'))
    return template?.scenes?.[0]?.name || fallback
  } catch {
    return fallback
  }
}

export function createStoredTemplateDocument(presetId: unknown = 'empty'): StoredTemplateDocument {
  const template = createEditorPreset(presetId)
  migrateLegacyTemplates()
  const root = getTemplateScenesDirectory()
  const directory = uniqueDirectory(root)
  const templatePath = path.join(directory, TEMPLATE_FILE)
  const templateJson = JSON.stringify(template, null, 2)
  fs.writeFileSync(templatePath, templateJson, 'utf8')
  return {
    templateJson,
    configJson: JSON.stringify({ timing_rules: {}, sources: {} }, null, 2),
    templateStorage: { directory, templatePath }
  }
}

export function loadStoredTemplateDocument(templatePath: string): StoredTemplateDocument {
  const resolved = assertInsideScenesDirectory(templatePath)
  const templateJson = fs.readFileSync(resolved, 'utf8')
  return {
    templateJson,
    configJson: JSON.stringify({ timing_rules: {}, sources: {} }, null, 2),
    templateStorage: { directory: path.dirname(resolved), templatePath: resolved }
  }
}

export function listStoredTemplates(): TemplateListItem[] {
  migrateLegacyTemplates()
  const root = getTemplateScenesDirectory()
  const localTemplates = fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map((entry): TemplateListItem | null => {
      const templatePath = path.join(root, entry.name, TEMPLATE_FILE)
      if (!fs.existsSync(templatePath)) return null
      const stat = fs.statSync(templatePath)
      return {
        id: `local:${templatePath}`,
        name: readTemplateName(templatePath, entry.name),
        description: formatTemplateModifiedAt(stat.mtime),
        source: 'local',
        templatePath
      }
    })
    .filter((item): item is TemplateListItem => Boolean(item))
    .sort((left, right) => fs.statSync(right.templatePath!).mtimeMs - fs.statSync(left.templatePath!).mtimeMs)
  return [
    ...TEMPLATE_PRESETS.map((preset): TemplateListItem => ({ ...preset, source: 'preset' })),
    ...localTemplates
  ]
}

export function saveStoredTemplateDocument(payload: { templateJson?: string; templateStorage?: Partial<TemplateStorageRef> }) {
  if (!payload?.templateStorage?.templatePath || typeof payload.templateJson !== 'string') return
  const templatePath = assertInsideScenesDirectory(payload.templateStorage.templatePath)
  fs.mkdirSync(path.dirname(templatePath), { recursive: true })
  fs.writeFileSync(templatePath, payload.templateJson, 'utf8')
}
