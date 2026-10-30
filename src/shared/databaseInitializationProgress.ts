export type MigrationProgress = (phase: string, count?: number, total?: number, detail?: string) => void

export interface DatabaseInitializationProgress {
  status: 'idle' | 'initializing' | 'initialized' | 'failed'
  phase: string
  startedAt?: number
  count?: number
  total?: number
  detail?: string
}

const stages: Record<string, string> = {
  opening: '正在打开数据库',
  'copy-baseline': '正在复制数据',
  'import-records': '正在迁移记录',
  'import-log': '正在迁移记录',
  schema: '正在升级数据库表结构',
  verify: '正在校验结果',
  'verify-history': '正在校验结果',
  'replace-tables': '正在切换新数据表',
  publish: '正在保存并发布新数据库',
  cleanup: '正在清理旧数据库',
  'constraint-copy': '正在复制数据',
  'constraint-rebuild': '正在升级并校验数据约束',
  'constraint-compare': '正在比对历史记录和当前数据',
  'integrity-check': '正在检查数据库完整性',
  'constraint-verified': '数据约束校验完成',
  'constraint-publish': '正在保存约束升级结果',
  'index-rebuild': '正在建立查询索引',
  'index-complete': '查询索引已就绪',
  'overlay-schema': '正在准备新数据库',
  'overlay-attach': '正在连接旧对话数据库',
  'overlay-warning': '部分旧对话暂不可用',
  'overlay-ready': '数据库已就绪'
}

export function formatDatabaseInitializationProgress(progress: DatabaseInitializationProgress): string {
  if (progress.status === 'initialized') return '正在初始化服务'
  if (progress.status === 'failed') return '数据库初始化失败'
  if (progress.status === 'idle') return '正在初始化数据库'
  let text = stages[progress.phase] ?? '正在初始化数据库'
  if (['copy-baseline', 'constraint-copy', 'verify', 'index-rebuild'].includes(progress.phase) && typeof progress.count === 'number' && progress.total && progress.total > 0) {
    const percentage = Math.min(100, Math.max(0, Math.floor(progress.count / progress.total * 100)))
    text += ` ${percentage}%`
  } else if (['import-records', 'import-log'].includes(progress.phase) && typeof progress.count === 'number') {
    text += ` 已处理${progress.count.toLocaleString('zh-CN')}条`
  }
  return text
}
