export type RuntimeCapability =
  | 'browser'
  | 'search'
  | 'image'
  | 'speech'
  | 'draftDownload'
  | 'copylab'
  | 'digitalHuman'
  | 'kouboTemplate'
  | 'system'
  | 'skills'
  | 'agentMemory'
  | 'claw'
  | 'assistant'

export type RuntimeToolLayer = 'chat' | 'workspace-read' | 'workspace-write' | 'agentic'

export type CapabilityDecision = {
  turn: number
  selected: Set<RuntimeCapability>
  reasons: Record<string, string[]>
  stickyApplied: string[]
  toolLayer: RuntimeToolLayer
  toolLayerReasons: string[]
}

export type ToolGuidanceOptions = {
  hasClaw?: boolean
  hasSkills?: boolean
  hasMemory?: boolean
  hasWeb?: boolean
  hasSystem?: boolean
  hasContentCreation?: boolean
  hasWorkspaceTools?: boolean
  hasWriteTools?: boolean
  hasAgenticTools?: boolean
}

const ALL_OPTIONAL_RUNTIME_CAPABILITIES: RuntimeCapability[] = [
  'browser',
  'search',
  'image',
  'speech',
  'draftDownload',
  'copylab',
  'digitalHuman',
  'kouboTemplate',
  'system',
  'skills',
  'agentMemory',
  'claw',
  'assistant'
]

const STICKY_RUNTIME_CAPABILITIES = new Set<RuntimeCapability>([
  'browser',
  'search',
  'image',
  'speech',
  'draftDownload',
  'digitalHuman',
  'kouboTemplate',
  'copylab'
])

const CAPABILITY_STICKY_TURNS = 3

const normalizeCapabilityText = (value: string) => String(value || '').toLowerCase()

const hasAnyKeyword = (text: string, keywords: string[]) => keywords.some((keyword) => text.includes(keyword))

const hasUrlLikeText = (text: string) => /https?:\/\/|localhost:\d+|127\.0\.0\.1:\d+|0\.0\.0\.0:\d+/i.test(text)

const TOKEN_BOUNDARY = "(?:^|[\\s\"'`“”‘’(（[【])"
const TOKEN_BODY = "[^\\s\"'`“”‘’()（）[\\]【】<>《》,:，。；;!?！？]+"
const COMMON_TEXT_FILE_EXTENSIONS =
  'txt|mdx?|html?|css|scss|sass|less|jsx?|tsx?|mjs|cjs|vue|svelte|astro|jsonc?|jsonl|ndjson|ya?ml|toml|xml|csv|tsv|log|rst|adoc|tex|py|ipynb|java|kt|kts|go|rs|rb|php|swift|scala|cs|cpp|cxx|cc|c|h|hpp|m|mm|sh|bash|zsh|fish|ps1|bat|cmd|sql|env|ini|conf|config|properties|lock|gradle|dockerfile|gitignore|npmrc|yarnrc|editorconfig|prettierrc|eslintrc|babelrc'
const COMMON_TEXT_FILE_PATTERN = new RegExp(
  `${TOKEN_BOUNDARY}(?:\\.{0,2}/)?${TOKEN_BODY}\\.(${COMMON_TEXT_FILE_EXTENSIONS})(?:\\b|$)`,
  'i'
)
const GENERIC_DOTTED_FILE_PATTERN = new RegExp(
  `${TOKEN_BOUNDARY}(?:\\.{0,2}/)?${TOKEN_BODY}\\.([a-z][a-z0-9_-]{0,15})(?:\\b|$)`,
  'gi'
)
const PATH_LIKE_PATTERN =
  /(?:^|[\s"'`“”‘’(（[【])(?:\.{1,2}\/|~\/|\/|[A-Za-z]:[\\/])[^\s"'`“”‘’()（）[\]【】<>《》]+/i
const SPECIAL_FILENAME_PATTERN =
  /(?:^|[\s"'`“”‘’(（[【])(?:dockerfile|makefile|procfile|readme|license|changelog|authors|contributors|package\.json|tsconfig(?:\.[\w.-]+)?\.json|vite\.config\.[\w.-]+|webpack\.config\.[\w.-]+|tailwind\.config\.[\w.-]+)(?:\b|$)/i
const GENERIC_DOMAIN_LIKE_EXTENSIONS = new Set([
  'com',
  'cn',
  'net',
  'org',
  'io',
  'ai',
  'dev',
  'app',
  'co',
  'gov',
  'edu',
  'top',
  'xyz',
  'site'
])

const hasGenericDottedFileReference = (text: string) => {
  GENERIC_DOTTED_FILE_PATTERN.lastIndex = 0
  for (const match of text.matchAll(GENERIC_DOTTED_FILE_PATTERN)) {
    const ext = String(match[1] || '').toLowerCase()
    const token = String(match[0] || '').trim()
    if (!ext || GENERIC_DOMAIN_LIKE_EXTENSIONS.has(ext)) continue
    if (/^[\d.]+$/.test(token)) continue
    return true
  }
  return false
}

const hasFileReference = (text: string, opts: { allowUnknownExtensions?: boolean } = {}) =>
  PATH_LIKE_PATTERN.test(text) ||
  COMMON_TEXT_FILE_PATTERN.test(text) ||
  SPECIAL_FILENAME_PATTERN.test(text) ||
  (opts.allowUnknownExtensions === true && hasGenericDottedFileReference(text))

const addCapabilityReason = (
  selected: Set<RuntimeCapability>,
  reasons: Record<string, string[]>,
  capability: RuntimeCapability,
  reason: string
) => {
  selected.add(capability)
  reasons[capability] = [...(reasons[capability] ?? []), reason]
}

const maxLayer = (a: RuntimeToolLayer, b: RuntimeToolLayer): RuntimeToolLayer => {
  const order: RuntimeToolLayer[] = ['chat', 'workspace-read', 'workspace-write', 'agentic']
  return order.indexOf(a) >= order.indexOf(b) ? a : b
}

export class CapabilityRouter {
  private turnsBySession = new Map<string, number>()
  private stickyBySession = new Map<string, Map<RuntimeCapability, number>>()

  constructor(private readonly opts: { forceMountAllRuntimeMcpTools?: boolean } = {}) {}

  select(args: {
    prompt: string
    sessionId: string
    imageCount: number
    isAssistant: boolean
    autonomousEnabled: boolean
    builtinRole?: string
    hasCustomMcpServers: boolean
  }): CapabilityDecision {
    const turn = (this.turnsBySession.get(args.sessionId) ?? 0) + 1
    this.turnsBySession.set(args.sessionId, turn)

    const selected = new Set<RuntimeCapability>()
    const reasons: Record<string, string[]> = {}
    const stickyApplied: string[] = []
    const text = normalizeCapabilityText(args.prompt)

    if (this.opts.forceMountAllRuntimeMcpTools) {
      for (const capability of ALL_OPTIONAL_RUNTIME_CAPABILITIES) {
        addCapabilityReason(selected, reasons, capability, 'env:CHERRY_AGENT_MOUNT_ALL_MCP_TOOLS')
      }
    } else {
      if (args.isAssistant) {
        addCapabilityReason(selected, reasons, 'assistant', 'assistant-role')
      }

      if (
        hasUrlLikeText(args.prompt) ||
        hasAnyKeyword(text, [
          '网页',
          '浏览器',
          '打开网页',
          '点击',
          '页面截图',
          '调试页面',
          'localhost',
          'browser',
          'web page',
          'click',
          'screenshot'
        ])
      ) {
        addCapabilityReason(selected, reasons, 'browser', 'prompt:browser-or-url')
      }

      if (
        hasAnyKeyword(text, [
          '搜索',
          '查找',
          '查询',
          '最新',
          '联网',
          '网上',
          '新闻',
          '资料',
          'search',
          'look up',
          'google',
          '百度'
        ])
      ) {
        addCapabilityReason(selected, reasons, 'search', 'prompt:search')
      }

      if (
        args.imageCount > 0 ||
        hasAnyKeyword(text, [
          '生成图',
          '生成图片',
          '画一张',
          '做张图',
          '封面',
          '海报',
          '配图',
          '修图',
          '换背景',
          '抠图',
          'image',
          'cover',
          'poster'
        ])
      ) {
        addCapabilityReason(
          selected,
          reasons,
          'image',
          args.imageCount > 0 ? 'prompt:image-with-attachment' : 'prompt:image'
        )
      }

      if (hasAnyKeyword(text, ['语音', '配音', '音色', '朗读', '声音', 'tts', 'voice', 'speech', 'audio'])) {
        addCapabilityReason(selected, reasons, 'speech', 'prompt:speech')
      }

      if (
        hasAnyKeyword(text, [
          '数字人',
          '口播',
          '唇形',
          '唇动',
          '人像驱动',
          '形象',
          'lip sync',
          'lipsync',
          'image driven'
        ])
      ) {
        addCapabilityReason(selected, reasons, 'digitalHuman', 'prompt:digital-human')
      }

      if (hasAnyKeyword(text, ['下载草稿', '草稿下载', '剪映草稿', 'capcut draft', 'draft download'])) {
        addCapabilityReason(selected, reasons, 'draftDownload', 'prompt:draft-download')
      }

      if (hasAnyKeyword(text, ['口播模板', '模板草稿', 'koubo', 'template'])) {
        addCapabilityReason(selected, reasons, 'kouboTemplate', 'prompt:koubo-template')
      }

      if (hasAnyKeyword(text, ['文案', '脚本', '标题', '话术', '种草', '广告语', 'copywriting', 'copy lab'])) {
        addCapabilityReason(selected, reasons, 'copylab', 'prompt:copywriting')
      }

      if (hasAnyKeyword(text, ['vectcut://', '打开设置', '跳转设置', 'deeplink', '系统设置'])) {
        addCapabilityReason(selected, reasons, 'system', 'prompt:system-action')
      }

      if (
        /(^|\s)@[\p{L}\p{N}_-]+/u.test(args.prompt) ||
        hasAnyKeyword(text, ['技能', 'skill', '成员', '安装技能', '新建成员'])
      ) {
        addCapabilityReason(selected, reasons, 'skills', 'prompt:skills')
      }

      if (hasAnyKeyword(text, ['记住', '记忆', '忘记', 'remember', 'memory'])) {
        addCapabilityReason(selected, reasons, 'agentMemory', 'prompt:memory')
      }

      if (args.autonomousEnabled && hasAnyKeyword(text, ['定时', '提醒', '通知', '计划任务', 'cron', 'notify'])) {
        addCapabilityReason(selected, reasons, 'claw', 'prompt:schedule-or-notify')
      }

      const sticky = this.stickyBySession.get(args.sessionId) ?? new Map<RuntimeCapability, number>()
      for (const [capability, expiresAtTurn] of Array.from(sticky.entries())) {
        if (expiresAtTurn < turn) {
          sticky.delete(capability)
          continue
        }

        if (!selected.has(capability)) {
          addCapabilityReason(selected, reasons, capability, `sticky:${expiresAtTurn - turn + 1}`)
          stickyApplied.push(`${capability}:${expiresAtTurn}`)
        }
      }

      for (const capability of selected) {
        if (STICKY_RUNTIME_CAPABILITIES.has(capability)) {
          sticky.set(capability, turn + CAPABILITY_STICKY_TURNS)
        }
      }

      if (sticky.size > 0) {
        this.stickyBySession.set(args.sessionId, sticky)
      } else {
        this.stickyBySession.delete(args.sessionId)
      }
    }

    if (!args.isAssistant) {
      selected.delete('assistant')
      delete reasons.assistant
    }
    if (!args.autonomousEnabled) {
      selected.delete('claw')
      delete reasons.claw
    }

    const { toolLayer, toolLayerReasons } = classifyToolLayer({
      prompt: args.prompt,
      normalizedPrompt: text,
      selected,
      hasCustomMcpServers: args.hasCustomMcpServers,
      isAssistant: args.isAssistant
    })

    return {
      turn,
      selected,
      reasons,
      stickyApplied,
      toolLayer,
      toolLayerReasons
    }
  }
}

export function buildToolGuidanceOptions(args: {
  decision: CapabilityDecision
  autonomousEnabled: boolean
}): ToolGuidanceOptions {
  const { decision, autonomousEnabled } = args
  return {
    hasClaw: autonomousEnabled && decision.selected.has('claw'),
    hasSkills: decision.selected.has('skills'),
    hasMemory: decision.selected.has('agentMemory'),
    hasWeb: decision.selected.has('search') || decision.selected.has('browser'),
    hasSystem: decision.selected.has('system'),
    hasContentCreation: decision.selected.has('copylab'),
    hasWorkspaceTools: decision.toolLayer !== 'chat',
    hasWriteTools: decision.toolLayer === 'workspace-write' || decision.toolLayer === 'agentic',
    hasAgenticTools: decision.toolLayer === 'agentic'
  }
}

function classifyToolLayer(args: {
  prompt: string
  normalizedPrompt: string
  selected: Set<RuntimeCapability>
  hasCustomMcpServers: boolean
  isAssistant: boolean
}): { toolLayer: RuntimeToolLayer; toolLayerReasons: string[] } {
  const reasons: string[] = []
  let layer: RuntimeToolLayer = 'chat'

  const text = args.normalizedPrompt
  const hasWorkspaceContextKeyword = hasAnyKeyword(text, [
    '代码',
    '文件',
    '文档',
    '目录',
    '工程',
    '项目',
    '日志',
    'log',
    'repo',
    'repository',
    'workspace',
    'source'
  ])
  const hasReadActionKeyword = hasAnyKeyword(text, [
    '阅读',
    '读取',
    '查看',
    '看下',
    '看一下',
    '检查',
    '分析',
    'review',
    'explain this code'
  ])
  const hasWorkspaceReadIntent =
    hasWorkspaceContextKeyword ||
    hasFileReference(args.prompt) ||
    (hasReadActionKeyword && hasFileReference(args.prompt, { allowUnknownExtensions: true })) ||
    /(^|\s)(src|package\.json|tsconfig|vite|webpack|electron)\b/i.test(args.prompt)

  if (hasWorkspaceReadIntent) {
    layer = maxLayer(layer, 'workspace-read')
    reasons.push('prompt:workspace-read')
  }

  if (
    hasAnyKeyword(text, [
      '修改',
      '改动',
      '修复',
      '实现',
      '新增',
      '创建',
      '删除',
      '重构',
      '写入',
      '保存',
      '补充',
      '替换',
      'edit',
      'fix',
      'implement',
      'create',
      'delete',
      'write',
      'refactor',
      'patch',
      'change'
    ])
  ) {
    layer = maxLayer(layer, 'workspace-write')
    reasons.push('prompt:workspace-write')
  }

  if (
    hasAnyKeyword(text, [
      '运行',
      '执行',
      '跑测试',
      '运行测试',
      '执行测试',
      '构建',
      '打包',
      '部署',
      '提交',
      'npm test',
      'pnpm test',
      'yarn test',
      'bun test',
      'pytest',
      'vitest',
      'jest',
      'playwright'
    ]) ||
    /\b(run|execute|build|deploy|commit)\b/i.test(args.prompt) ||
    /\b(cargo|go)\s+test\b/i.test(args.prompt)
  ) {
    layer = maxLayer(layer, 'agentic')
    reasons.push('prompt:agentic-execution')
  }

  if (args.hasCustomMcpServers) {
    layer = maxLayer(layer, 'agentic')
    reasons.push('session:custom-mcp')
  }

  if (args.isAssistant) {
    layer = maxLayer(layer, 'workspace-read')
    reasons.push('assistant:read-context')
  }

  const toolLikeCapabilityCount = Array.from(args.selected).filter(
    (capability) => capability !== 'copylab' && capability !== 'search'
  ).length
  if (toolLikeCapabilityCount > 0) {
    layer = maxLayer(layer, 'workspace-read')
    reasons.push('capability:runtime-tool')
  }

  if (args.selected.has('skills') || args.selected.has('agentMemory') || args.selected.has('claw')) {
    layer = maxLayer(layer, 'agentic')
    reasons.push('capability:stateful-management')
  }

  return {
    toolLayer: layer,
    toolLayerReasons: reasons.length ? reasons : ['prompt:chat']
  }
}
