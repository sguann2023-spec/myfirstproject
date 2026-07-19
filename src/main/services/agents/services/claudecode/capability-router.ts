export type RuntimeCapability =
  | 'browser'
  | 'search'
  | 'uploadFile'
  | 'image'
  | 'speech'
  | 'seedAudio'
  | 'subtitleTemplate'
  | 'draftCreate'
  | 'draftUpdateMeta'
  | 'draftInspect'
  | 'draftDownload'
  | 'copylab'
  | 'digitalHuman'
  | 'kouboTemplate'
  | 'system'
  | 'skills'
  | 'agentMemory'
  | 'claw'
  | 'assistant'

export type RuntimeToolLayer = 'chat' | 'web' | 'workspace-read' | 'workspace-write' | 'agentic'

export type IntentDomain = 'chat' | 'workspace' | 'web' | 'ai_media' | 'skills' | 'auxiliary' | 'scrapt' | 'cut'

export type ActiveIntentDomain = {
  domain: IntentDomain
  subdomains: string[]
  role: 'primary' | 'support'
  score: number
}

export type CapabilityDecision = {
  turn: number
  selected: Set<RuntimeCapability>
  reasons: Record<string, string[]>
  stickyApplied: string[]
  activeDomains: ActiveIntentDomain[]
  primaryDomain: IntentDomain
  subdomains: string[]
  companionDomains: IntentDomain[]
  domainReasons: string[]
  preferredMcpTools: string[]
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
  preferredMcpTools?: string[]
}

const syncSelectedCapabilitiesFromActiveDomains = (
  activeDomains: ActiveIntentDomain[],
  selected: Set<RuntimeCapability>,
  reasons: Record<string, string[]>
) => {
  for (const activeDomain of activeDomains) {
    if (activeDomain.domain === 'web') {
      if (activeDomain.subdomains.includes('browser') && !selected.has('browser')) {
        addCapabilityReason(selected, reasons, 'browser', 'intent:web.browser')
      }
      if (activeDomain.subdomains.includes('search') && !selected.has('search')) {
        addCapabilityReason(selected, reasons, 'search', 'intent:web.search')
      }
      continue
    }

    if (activeDomain.domain === 'ai_media') {
      if (activeDomain.subdomains.includes('image') && !selected.has('image')) {
        addCapabilityReason(selected, reasons, 'image', 'intent:ai_media.image')
      }
      if (activeDomain.subdomains.includes('speech') && !selected.has('speech')) {
        addCapabilityReason(selected, reasons, 'speech', 'intent:ai_media.speech')
      }
      if (activeDomain.subdomains.includes('seed_audio') && !selected.has('seedAudio')) {
        addCapabilityReason(selected, reasons, 'seedAudio', 'intent:ai_media.seed_audio')
      }
      if (activeDomain.subdomains.includes('digital_human') && !selected.has('digitalHuman')) {
        addCapabilityReason(selected, reasons, 'digitalHuman', 'intent:ai_media.digital_human')
      }
      continue
    }

    if (activeDomain.domain === 'scrapt') {
      if (activeDomain.subdomains.includes('derive_prompt') && !selected.has('copylab')) {
        addCapabilityReason(selected, reasons, 'copylab', 'intent:scrapt.derive_prompt')
      }
      continue
    }

    if (activeDomain.domain === 'cut') {
      if (activeDomain.subdomains.includes('draft_create') && !selected.has('draftCreate')) {
        addCapabilityReason(selected, reasons, 'draftCreate', 'intent:cut.draft_create')
      }
      if (activeDomain.subdomains.includes('draft_update_meta') && !selected.has('draftUpdateMeta')) {
        addCapabilityReason(selected, reasons, 'draftUpdateMeta', 'intent:cut.draft_update_meta')
      }
      if (activeDomain.subdomains.includes('draft_inspect') && !selected.has('draftInspect')) {
        addCapabilityReason(selected, reasons, 'draftInspect', 'intent:cut.draft_inspect')
      }
      if (activeDomain.subdomains.includes('draft_download') && !selected.has('draftDownload')) {
        addCapabilityReason(selected, reasons, 'draftDownload', 'intent:cut.draft_download')
      }
      if (activeDomain.subdomains.includes('subtitle_template') && !selected.has('subtitleTemplate')) {
        addCapabilityReason(selected, reasons, 'subtitleTemplate', 'intent:cut.subtitle_template')
      }
      if (activeDomain.subdomains.includes('template') && !selected.has('kouboTemplate')) {
        addCapabilityReason(selected, reasons, 'kouboTemplate', 'intent:cut.template')
      }
      continue
    }

    if (activeDomain.domain === 'workspace') {
      if (activeDomain.subdomains.includes('upload') && !selected.has('uploadFile')) {
        addCapabilityReason(selected, reasons, 'uploadFile', 'intent:workspace.upload')
      }
      continue
    }

    if (activeDomain.domain === 'skills') {
      if (activeDomain.subdomains.some((subdomain) => ['find_skill', 'create_skill'].includes(subdomain)) && !selected.has('skills')) {
        addCapabilityReason(selected, reasons, 'skills', 'intent:skills')
      }
      continue
    }

    if (activeDomain.domain === 'auxiliary') {
      if (activeDomain.subdomains.includes('memory') && !selected.has('agentMemory')) {
        addCapabilityReason(selected, reasons, 'agentMemory', 'intent:auxiliary.memory')
      }
      if (activeDomain.subdomains.includes('system') && !selected.has('system')) {
        addCapabilityReason(selected, reasons, 'system', 'intent:auxiliary.system')
      }
      if (activeDomain.subdomains.includes('assistant') && !selected.has('assistant')) {
        addCapabilityReason(selected, reasons, 'assistant', 'intent:auxiliary.assistant')
      }
      if (activeDomain.subdomains.includes('automation') && !selected.has('claw')) {
        addCapabilityReason(selected, reasons, 'claw', 'intent:auxiliary.automation')
      }
    }
  }
}

const ALL_OPTIONAL_RUNTIME_CAPABILITIES: RuntimeCapability[] = [
  'browser',
  'search',
  'uploadFile',
  'image',
  'speech',
  'seedAudio',
  'subtitleTemplate',
  'draftCreate',
  'draftUpdateMeta',
  'draftInspect',
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
  'uploadFile',
  'image',
  'speech',
  'seedAudio',
  'subtitleTemplate',
  'draftCreate',
  'draftUpdateMeta',
  'draftInspect',
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
  const order: RuntimeToolLayer[] = ['chat', 'web', 'workspace-read', 'workspace-write', 'agentic']
  return order.indexOf(a) >= order.indexOf(b) ? a : b
}

const hasWorkspaceAccess = (layer: RuntimeToolLayer): boolean =>
  layer === 'workspace-read' || layer === 'workspace-write' || layer === 'agentic'

const WORKSPACE_CONTEXT_KEYWORDS = [
  '代码',
  '文件',
  '文档',
  '目录',
  '工程',
  '项目',
  '日志',
  '仓库',
  'repo',
  'repository',
  'workspace',
  'source'
]

const WORKSPACE_READ_ACTION_KEYWORDS = [
  '阅读',
  '读取',
  '查看',
  '看下',
  '看一下',
  '检查',
  '分析',
  'review',
  'explain this code'
]

const WORKSPACE_FIND_KEYWORDS = [
  '查一下有没有',
  '找一下有没有',
  '有没有文件',
  '有没有这个文件',
  '有没有这个字',
  '有没有这段文字',
  '搜索文件',
  '搜索代码',
  '查找文件',
  '查找文字',
  '定位文件',
  '定位代码',
  'grep',
  'glob',
  '搜索工程',
  '搜索项目',
  '全文检索'
]

const WORKSPACE_WRITE_KEYWORDS = [
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
  '创建文件',
  '新增文件',
  '写文件',
  '写个文件',
  '写个测试文件',
  '写网页',
  '写一个网页',
  '写一个页面',
  '生成页面',
  '生成网页'
]

const WORKSPACE_EXECUTE_KEYWORDS = [
  '运行',
  '执行',
  '跑测试',
  '运行测试',
  '执行测试',
  '构建',
  '打包',
  '部署',
  '启动服务',
  'npm test',
  'pnpm test',
  'yarn test',
  'bun test',
  'pytest',
  'vitest',
  'jest',
  'playwright'
]

const WORKSPACE_TASK_KEYWORDS = ['待办', 'todo', '任务拆解', '任务列表', 'task list', 'todo list']
const WORKSPACE_UPLOAD_KEYWORDS = [
  '上传文件',
  '上传这个文件',
  '上传该文件',
  '上传到oss',
  '上传到 oss',
  '传到oss',
  '传到 oss',
  '上传到对象存储',
  'upload file',
  'upload to oss'
]

const WEB_SEARCH_KEYWORDS = [
  '搜索',
  '查询',
  '最新',
  '联网',
  '网上',
  '新闻',
  '资料',
  '热点',
  '热搜',
  '官网',
  '官方文档',
  'search',
  'look up',
  'google',
  '百度'
]

const WEB_BROWSER_KEYWORDS = [
  '浏览器',
  '打开网页',
  '打开页面',
  '打开网站',
  '访问网页',
  '访问页面',
  '点击',
  '页面截图',
  '调试页面',
  'browser',
  'open page',
  'web page',
  'click',
  'screenshot'
]

const WEB_FETCH_KEYWORDS = ['抓取网页', '抓网页', '读取网页', '获取网页内容', 'fetch url', 'fetch page', 'webfetch']

const WEB_SCREENSHOT_KEYWORDS = ['截图', '页面截图', '网页截图', '快照', 'snapshot']
const WEB_OPEN_KEYWORDS = [
  '打开网页',
  '打开页面',
  '打开网站',
  '访问网页',
  '访问页面',
  '打开百度',
  'open page',
  'open url',
  'open website',
  'visit page',
  'visit website'
]

const CUT_CREATE_KEYWORDS = ['创建草稿', '新建草稿', 'create draft', 'new draft', 'start draft']
const CUT_TEMPLATE_KEYWORDS = ['口播模板', '模板草稿', 'koubo', 'template', '模板剪辑', '模版剪辑', '剪一下口播']
const CUT_SUBTITLE_TEMPLATE_KEYWORDS = ['字幕模板', '字幕模版', 'smart subtitle', 'subtitle template']

const hasDraftMetaUpdateIntent = (text: string) =>
  (text.includes('草稿') || text.includes('draft')) &&
  ((/(修改|更改|改一下|改下|更新|设置|替换).{0,12}(封面|名称|名字|标题)/.test(text) ||
    /(封面|名称|名字|标题).{0,12}(修改|更改|改一下|改下|更新|设置|替换)/.test(text)))

const hasDraftInspectIntent = (text: string) =>
  hasAnyKeyword(text, ['query script', 'query_script']) ||
  ((text.includes('草稿') || text.includes('draft')) &&
    ((/(查看|查询|检查|确认|校验|核对|核查|看下|看一下).{0,16}(内容|脚本|元素|轨道|字幕|素材|对不对|是否正确|有没有加对|是否添加正确)/.test(text) ||
      /(内容|脚本|元素|轨道|字幕|素材).{0,8}(对不对|正确|是否正确|有没有加对|是否添加正确)/.test(text) ||
      /复杂修改|很多元素|多个元素/.test(text) && /(确认|检查|校验|核对|核查|看下|看一下)/.test(text))))

const hasDraftDownloadIntent = (text: string) =>
  hasAnyKeyword(text, ['下载草稿', '草稿下载', '剪映草稿', 'capcut draft', 'draft download']) ||
  /下载.{0,8}草稿/.test(text) ||
  /草稿.{0,8}下载/.test(text) ||
  /\bdownload\b.{0,12}\bdraft\b/i.test(text) ||
  /\bdraft\b.{0,12}\bdownload\b/i.test(text)

const hasSubtitleTemplateIntent = (text: string) =>
  hasAnyKeyword(text, CUT_SUBTITLE_TEMPLATE_KEYWORDS) ||
  ((/(给|帮|把|为|对).{0,8}(音频|视频|音轨|素材|录音)/.test(text) ||
    /(音频|视频|音轨|素材|录音).{0,8}(加上|添加|套用|应用|生成|做一个|上一段)/.test(text)) &&
    /(字幕|字幕模板|字幕模版)/.test(text)) ||
  (/(字幕|字幕模板|字幕模版)/.test(text) && /(音频|视频|audio|video)/.test(text))

const hasSeedAudioIntent = (text: string) =>
  /豆包.{0,8}(语音|音频)/.test(text) ||
  /(语音|音频).{0,8}豆包/.test(text) ||
  text.includes('seed-audio') ||
  text.includes('seed audio') ||
  ((text.includes('语音') || text.includes('音频')) &&
    /(参考图片|参考音频|参考图|参考声音|音色|多人|背景音乐|音效)/.test(text))

const COPYLAB_EXPLICIT_KEYWORDS = [
  '反推',
  '提示词',
  '爆款',
  '仿写',
  '复刻',
  '拆解',
  '提炼提示词',
  '根据链接生成提示词',
  'derive prompt',
  'reverse engineer',
  'reverse-engineer',
  'imitate',
  'viral copy'
]

export class CapabilityRouter {
  private turnsBySession = new Map<string, number>()
  private stickyBySession = new Map<string, Map<RuntimeCapability, number>>()

  constructor(private readonly opts: { forceMountAllRuntimeMcpTools?: boolean } = {}) {}

  select(args: {
    prompt: string
    intentPrompt?: string
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
    const intentPrompt = String(args.intentPrompt || args.prompt || '')
    const text = normalizeCapabilityText(intentPrompt)

    if (this.opts.forceMountAllRuntimeMcpTools) {
      for (const capability of ALL_OPTIONAL_RUNTIME_CAPABILITIES) {
        addCapabilityReason(selected, reasons, capability, 'env:CHERRY_AGENT_MOUNT_ALL_MCP_TOOLS')
      }
    } else {
      const hasDraftCreateIntent =
        hasAnyKeyword(text, CUT_CREATE_KEYWORDS) ||
        /(?:创建|新建|开始).{0,8}草稿/.test(text) ||
        /draft.{0,8}(create|new|start)/.test(text)
      const hasDraftUpdateIntent = hasDraftMetaUpdateIntent(text)
      const shouldInspectDraft = hasDraftInspectIntent(text)
      const shouldDownloadDraft = hasDraftDownloadIntent(text)
      const shouldApplySubtitleTemplate = hasSubtitleTemplateIntent(text)
      const hasTemplateIntent = hasAnyKeyword(text, CUT_TEMPLATE_KEYWORDS)
      const hasCutSpecificIntent =
        hasDraftCreateIntent ||
        hasDraftUpdateIntent ||
        shouldInspectDraft ||
        shouldDownloadDraft ||
        shouldApplySubtitleTemplate ||
        hasTemplateIntent
      const hasImplicitBrowserUrlIntent = hasUrlLikeText(args.prompt) && !hasCutSpecificIntent

      if (args.isAssistant) {
        addCapabilityReason(selected, reasons, 'assistant', 'assistant-role')
      }

      if (hasImplicitBrowserUrlIntent || hasAnyKeyword(text, [...WEB_BROWSER_KEYWORDS, 'localhost'])) {
        addCapabilityReason(selected, reasons, 'browser', 'prompt:browser-or-url')
      }

      if (hasAnyKeyword(text, WEB_SEARCH_KEYWORDS)) {
        addCapabilityReason(selected, reasons, 'search', 'prompt:search')
      }

      if (
        hasAnyKeyword(text, WORKSPACE_UPLOAD_KEYWORDS) ||
        /(?:上传|传).{0,8}(文件|附件|素材|音频|视频|图片)/.test(text) ||
        /(?:上传|传).{0,12}(oss|对象存储)/.test(text) ||
        /(文件|附件|素材|音频|视频|图片).{0,8}(上传|传到oss|上传到oss)/.test(text)
      ) {
        addCapabilityReason(selected, reasons, 'uploadFile', 'prompt:upload-file')
      }

      if (
        args.imageCount > 0 ||
        hasAnyKeyword(text, [
          '生成图',
          '生成图片',
          '画一张',
          '做张图',
          '海报',
          '配图',
          '修图',
          '换背景',
          '抠图',
          'image',
          'cover',
          'poster'
        ]) ||
        (text.includes('封面') && !hasDraftUpdateIntent)
      ) {
        addCapabilityReason(
          selected,
          reasons,
          'image',
          args.imageCount > 0 ? 'prompt:image-with-attachment' : 'prompt:image'
        )
      }

      const shouldGenerateSeedAudio = hasSeedAudioIntent(text)

      if (hasAnyKeyword(text, ['语音', '配音', '音色', '朗读', '声音', 'tts', 'voice', 'speech', 'audio']) && !shouldGenerateSeedAudio) {
        addCapabilityReason(selected, reasons, 'speech', 'prompt:speech')
      }

      if (shouldGenerateSeedAudio) {
        addCapabilityReason(selected, reasons, 'seedAudio', 'prompt:seed-audio')
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

      if (hasDraftCreateIntent) {
        addCapabilityReason(selected, reasons, 'draftCreate', 'prompt:draft-create')
      }

      if (hasDraftUpdateIntent) {
        addCapabilityReason(selected, reasons, 'draftUpdateMeta', 'prompt:draft-update-meta')
      }

      if (shouldInspectDraft) {
        addCapabilityReason(selected, reasons, 'draftInspect', 'prompt:draft-inspect')
      }

      if (shouldDownloadDraft) {
        addCapabilityReason(selected, reasons, 'draftDownload', 'prompt:draft-download')
      }

      if (shouldApplySubtitleTemplate) {
        addCapabilityReason(selected, reasons, 'subtitleTemplate', 'prompt:subtitle-template')
      }

      if (hasTemplateIntent) {
        addCapabilityReason(selected, reasons, 'kouboTemplate', 'prompt:koubo-template')
      }

      if (hasAnyKeyword(text, COPYLAB_EXPLICIT_KEYWORDS)) {
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

    const {
      activeDomains,
      primaryDomain,
      subdomains,
      companionDomains,
      domainReasons,
      preferredMcpTools,
      toolLayer,
      toolLayerReasons
    } = classifyIntent({
      prompt: intentPrompt,
      normalizedPrompt: text,
      selected,
      hasCustomMcpServers: args.hasCustomMcpServers,
      isAssistant: args.isAssistant
    })

    syncSelectedCapabilitiesFromActiveDomains(activeDomains, selected, reasons)

    return {
      turn,
      selected,
      reasons,
      stickyApplied,
      activeDomains,
      primaryDomain,
      subdomains,
      companionDomains,
      domainReasons,
      preferredMcpTools,
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
    hasWorkspaceTools: hasWorkspaceAccess(decision.toolLayer),
    hasWriteTools: decision.toolLayer === 'workspace-write' || decision.toolLayer === 'agentic',
    hasAgenticTools: decision.toolLayer === 'agentic',
    preferredMcpTools: decision.preferredMcpTools
  }
}

function classifyIntent(args: {
  prompt: string
  normalizedPrompt: string
  selected: Set<RuntimeCapability>
  hasCustomMcpServers: boolean
  isAssistant: boolean
}): {
  activeDomains: ActiveIntentDomain[]
  primaryDomain: IntentDomain
  subdomains: string[]
  companionDomains: IntentDomain[]
  domainReasons: string[]
  preferredMcpTools: string[]
  toolLayer: RuntimeToolLayer
  toolLayerReasons: string[]
} {
  const domainReasons: string[] = []
  const preferredMcpTools = new Set<string>()
  const text = args.normalizedPrompt
  const domainSubdomains = new Map<IntentDomain, Set<string>>()
  const addDomainSubdomain = (domain: IntentDomain, subdomain: string, reason: string) => {
    const current = domainSubdomains.get(domain) ?? new Set<string>()
    current.add(subdomain)
    domainSubdomains.set(domain, current)
    domainReasons.push(`${domain}.${subdomain}:${reason}`)
  }

  const hasWorkspaceContextKeyword = hasAnyKeyword(text, WORKSPACE_CONTEXT_KEYWORDS)
  const hasReadActionKeyword = hasAnyKeyword(text, WORKSPACE_READ_ACTION_KEYWORDS)
  const hasWorkspaceReadIntent =
    hasWorkspaceContextKeyword ||
    hasFileReference(args.prompt) ||
    (hasReadActionKeyword && hasFileReference(args.prompt, { allowUnknownExtensions: true })) ||
    /(^|\s)(src|package\.json|tsconfig|vite|webpack|electron)\b/i.test(args.prompt)

  const hasWorkspaceFindIntent =
    hasAnyKeyword(text, WORKSPACE_FIND_KEYWORDS) ||
    (/有没有/.test(text) && (text.includes('文件') || text.includes('文字') || text.includes('内容')))
  const hasWorkspaceWriteIntent =
    hasAnyKeyword(text, WORKSPACE_WRITE_KEYWORDS) ||
    /(?:^|[\s，。,])写个[^，。\s]*文件/.test(text) ||
    /\b(edit|fix|implement|create|delete|write|refactor|patch|change)\b/i.test(args.prompt)
  const hasWorkspaceExecuteIntent =
    hasAnyKeyword(text, WORKSPACE_EXECUTE_KEYWORDS) ||
    /\b(run|execute|build|deploy|commit)\b/i.test(args.prompt) ||
    /\b(cargo|go)\s+test\b/i.test(args.prompt)
  const hasWorkspaceTaskIntent = hasAnyKeyword(text, WORKSPACE_TASK_KEYWORDS)
  const hasWorkspaceUploadIntent = args.selected.has('uploadFile')
  const hasNotebookIntent = text.includes('notebook') || text.includes('ipynb')
  const hasCutSpecificIntent =
    args.selected.has('draftCreate') ||
    args.selected.has('draftUpdateMeta') ||
    args.selected.has('draftInspect') ||
    args.selected.has('draftDownload') ||
    args.selected.has('subtitleTemplate') ||
    args.selected.has('kouboTemplate')
  const hasImplicitWebUrlOpenIntent = hasUrlLikeText(args.prompt) && !hasCutSpecificIntent
  const hasExplicitWebOpenIntent =
    hasAnyKeyword(text, WEB_OPEN_KEYWORDS) ||
    /(打开|访问|进入)(一下|一下子|下|帮我打开|帮忙打开)?[^，。！？\n]{0,20}(网页|页面|网站|百度)/.test(text)
  const hasWebOpenIntent =
    hasImplicitWebUrlOpenIntent || hasExplicitWebOpenIntent
  const hasWebSearchIntent =
    args.selected.has('search') ||
    hasAnyKeyword(text, WEB_SEARCH_KEYWORDS) ||
    /(查一下|看下|看一下|搜索).*(官方|官网|文档|资料|热点|热搜)/.test(text)

  if (hasWorkspaceReadIntent) {
    addDomainSubdomain('workspace', 'read', 'prompt:workspace-read')
  }
  if (hasWorkspaceFindIntent) {
    addDomainSubdomain('workspace', 'find', 'prompt:workspace-find')
    addDomainSubdomain('workspace', 'read', 'prompt:workspace-find-implies-read')
  }
  if (hasWorkspaceUploadIntent) {
    addDomainSubdomain('workspace', 'upload', 'capability:workspace-upload')
    addDomainSubdomain('workspace', 'read', 'capability:workspace-upload-implies-read')
  }
  if (hasWorkspaceWriteIntent) addDomainSubdomain('workspace', 'write', 'prompt:workspace-write')
  if (hasWorkspaceExecuteIntent) addDomainSubdomain('workspace', 'execute', 'prompt:workspace-execute')
  if (hasWorkspaceTaskIntent) addDomainSubdomain('workspace', 'task', 'prompt:workspace-task')
  if (hasNotebookIntent) addDomainSubdomain('workspace', 'notebook', 'prompt:workspace-notebook')

  if (hasWebSearchIntent) {
    addDomainSubdomain('web', 'search', 'prompt:web-search')
  }
  if (args.selected.has('browser') || hasAnyKeyword(text, WEB_BROWSER_KEYWORDS) || hasImplicitWebUrlOpenIntent || hasWebOpenIntent) {
    addDomainSubdomain('web', 'browser', 'prompt:web-browser')
  }
  if (hasWebOpenIntent) preferredMcpTools.add('mcp__browser__open')
  if (hasAnyKeyword(text, WEB_FETCH_KEYWORDS)) addDomainSubdomain('web', 'fetch', 'prompt:web-fetch')
  if (hasAnyKeyword(text, WEB_SCREENSHOT_KEYWORDS)) addDomainSubdomain('web', 'screenshot', 'prompt:web-screenshot')
  if (hasAnyKeyword(text, ['浏览器自动化', '自动操作页面', '网页执行', 'browser execute'])) {
    addDomainSubdomain('web', 'execute', 'prompt:web-execute')
  }

  if (args.selected.has('image')) addDomainSubdomain('ai_media', 'image', 'capability:image')
  if (args.selected.has('speech')) addDomainSubdomain('ai_media', 'speech', 'capability:speech')
  if (args.selected.has('seedAudio')) addDomainSubdomain('ai_media', 'seed_audio', 'capability:seed-audio')
  if (args.selected.has('digitalHuman')) addDomainSubdomain('ai_media', 'digital_human', 'capability:digital-human')

  if (args.selected.has('skills')) {
    addDomainSubdomain('skills', text.includes('创建') || text.includes('新建') ? 'create_skill' : 'find_skill', 'capability:skills')
  }

  if (args.selected.has('agentMemory')) addDomainSubdomain('auxiliary', 'memory', 'capability:memory')
  if (args.selected.has('assistant')) addDomainSubdomain('auxiliary', 'assistant', 'capability:assistant')
  if (args.selected.has('claw')) addDomainSubdomain('auxiliary', 'automation', 'capability:automation')
  if (args.selected.has('system')) addDomainSubdomain('auxiliary', 'system', 'capability:system')

  if (args.selected.has('copylab')) addDomainSubdomain('scrapt', 'derive_prompt', 'capability:copylab')

  if (args.selected.has('uploadFile')) preferredMcpTools.add('mcp__file-upload__upload_file_to_oss')
  if (args.selected.has('seedAudio')) preferredMcpTools.add('mcp__seed-audio__generate_seed_audio')
  if (args.selected.has('draftCreate')) preferredMcpTools.add('mcp__draft-management__create_draft')
  if (args.selected.has('draftUpdateMeta')) preferredMcpTools.add('mcp__draft-management__modify_draft')
  if (args.selected.has('draftInspect')) preferredMcpTools.add('mcp__draft-management__query_script')
  if (args.selected.has('draftDownload')) preferredMcpTools.add('mcp__draft-download__download_draft')
  if (args.selected.has('subtitleTemplate')) preferredMcpTools.add('mcp__subtitle-template__generate_smart_subtitle')
  if (args.selected.has('kouboTemplate')) preferredMcpTools.add('mcp__koubo-template__submit_koubo_template_task')

  if (args.selected.has('draftCreate')) addDomainSubdomain('cut', 'draft_create', 'capability:draft-create')
  if (args.selected.has('draftUpdateMeta')) addDomainSubdomain('cut', 'draft_update_meta', 'capability:draft-update-meta')
  if (args.selected.has('draftInspect')) addDomainSubdomain('cut', 'draft_inspect', 'capability:draft-inspect')
  if (args.selected.has('draftDownload')) addDomainSubdomain('cut', 'draft_download', 'capability:draft-download')
  if (args.selected.has('subtitleTemplate')) addDomainSubdomain('cut', 'subtitle_template', 'capability:subtitle-template')
  if (args.selected.has('kouboTemplate')) addDomainSubdomain('cut', 'template', 'capability:koubo-template')

  const getSubdomains = (domain: IntentDomain) => Array.from(domainSubdomains.get(domain) ?? []).sort()
  const workspaceSubdomains = getSubdomains('workspace')
  const webSubdomains = getSubdomains('web')
  const aiMediaSubdomains = getSubdomains('ai_media')
  const skillsSubdomains = getSubdomains('skills')
  const auxiliarySubdomains = getSubdomains('auxiliary')
  const scraptSubdomains = getSubdomains('scrapt')
  const cutSubdomains = getSubdomains('cut')
  const domainPriority: Record<IntentDomain, number> = {
    cut: 0,
    ai_media: 1,
    scrapt: 2,
    skills: 3,
    workspace: 4,
    web: 5,
    auxiliary: 6,
    chat: 7
  }

  const workspaceScore =
    (workspaceSubdomains.includes('write') ? 4 : 0) +
    (workspaceSubdomains.includes('execute') ? 4 : 0) +
    (workspaceSubdomains.includes('task') ? 3 : 0) +
    (workspaceSubdomains.includes('upload') ? 3 : 0) +
    (workspaceSubdomains.includes('find') ? 2 : 0) +
    (workspaceSubdomains.includes('read') ? 2 : 0)
  const webScore =
    (webSubdomains.includes('browser') ? 3 : 0) +
    (webSubdomains.includes('search') ? 2 : 0) +
    (webSubdomains.includes('fetch') ? 2 : 0) +
    (webSubdomains.includes('execute') ? 2 : 0) +
    (webSubdomains.includes('screenshot') ? 1 : 0)
  const domainScoreMap: Record<IntentDomain, number> = {
    chat: 0,
    workspace: workspaceScore,
    web: webScore,
    ai_media: aiMediaSubdomains.length > 0 ? 6 + aiMediaSubdomains.length : 0,
    skills: skillsSubdomains.length > 0 ? 5 + skillsSubdomains.length : 0,
    auxiliary: auxiliarySubdomains.length > 0 ? 2 + auxiliarySubdomains.length : 0,
    scrapt: scraptSubdomains.length > 0 ? 6 + scraptSubdomains.length : 0,
    cut: cutSubdomains.length > 0 ? 7 + cutSubdomains.length : 0
  }

  let primaryDomain: IntentDomain = 'chat'
  if (cutSubdomains.length > 0) primaryDomain = 'cut'
  else if (aiMediaSubdomains.length > 0) primaryDomain = 'ai_media'
  else if (scraptSubdomains.length > 0) primaryDomain = 'scrapt'
  else if (skillsSubdomains.length > 0) primaryDomain = 'skills'
  else if (workspaceScore > 0 || webScore > 0) primaryDomain = workspaceScore >= webScore ? 'workspace' : 'web'
  else if (auxiliarySubdomains.length > 0) primaryDomain = 'auxiliary'

  const allDomains: IntentDomain[] = ['chat', 'workspace', 'web', 'ai_media', 'skills', 'auxiliary', 'scrapt', 'cut']
  const companionDomains = allDomains.filter((domain) => {
    if (domain === 'chat' || domain === primaryDomain) return false
    return getSubdomains(domain).length > 0
  })
  const activeDomains = allDomains
    .filter((domain) => domain !== 'chat' && getSubdomains(domain).length > 0)
    .sort((left, right) => {
      if (left === primaryDomain) return -1
      if (right === primaryDomain) return 1
      const scoreDelta = domainScoreMap[right] - domainScoreMap[left]
      if (scoreDelta !== 0) return scoreDelta
      return domainPriority[left] - domainPriority[right]
    })
    .map((domain): ActiveIntentDomain => ({
      domain,
      subdomains: getSubdomains(domain),
      role: domain === primaryDomain ? 'primary' : 'support',
      score: domainScoreMap[domain]
    }))

  const subdomains = getSubdomains(primaryDomain)
  const toolLayerReasons: string[] = []
  let toolLayer: RuntimeToolLayer = 'chat'

  if (webSubdomains.length > 0) {
    toolLayer = maxLayer(toolLayer, 'web')
    toolLayerReasons.push('domain:web')
  }
  if (workspaceSubdomains.some((subdomain) => ['read', 'find', 'notebook', 'upload'].includes(subdomain))) {
    toolLayer = maxLayer(toolLayer, 'workspace-read')
    toolLayerReasons.push('domain:workspace-read')
  }
  if (workspaceSubdomains.includes('write')) {
    toolLayer = maxLayer(toolLayer, 'workspace-write')
    toolLayerReasons.push('domain:workspace-write')
  }
  if (
    workspaceSubdomains.includes('execute') ||
    workspaceSubdomains.includes('task') ||
    args.selected.has('skills') ||
    args.selected.has('agentMemory') ||
    args.selected.has('claw')
  ) {
    toolLayer = maxLayer(toolLayer, 'agentic')
    toolLayerReasons.push('domain:agentic-management')
  }
  if (args.hasCustomMcpServers) {
    toolLayer = maxLayer(toolLayer, 'agentic')
    toolLayerReasons.push('session:custom-mcp')
  }
  if (args.isAssistant) {
    toolLayer = maxLayer(toolLayer, 'workspace-read')
    toolLayerReasons.push('assistant:read-context')
  }

  return {
    activeDomains,
    primaryDomain,
    subdomains,
    companionDomains,
    domainReasons: domainReasons.length ? domainReasons : ['chat:default'],
    preferredMcpTools: Array.from(preferredMcpTools).sort(),
    toolLayer,
    toolLayerReasons: toolLayerReasons.length ? toolLayerReasons : ['prompt:chat']
  }
}
