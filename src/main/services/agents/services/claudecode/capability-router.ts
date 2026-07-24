import type { SkillMatchSignal, SkillTriggerMode } from '../../skill-mounting/types'

export type RuntimeCapability =
  | 'bash'
  | 'browser'
  | 'search'
  | 'workspaceDownload'
  | 'webDownload'
  | 'uploadFile'
  | 'image'
  | 'speech'
  | 'seedAudio'
  | 'audioExtract'
  | 'audioConcat'
  | 'frameCapture'
  | 'mediaDownload'
  | 'mediaDuration'
  | 'mediaTrim'
  | 'videoConcat'
  | 'textAdd'
  | 'textAddBatch'
  | 'textDelete'
  | 'textUpdate'
  | 'subtitleRecognition'
  | 'subtitleSrt'
  | 'textIntroAnimationList'
  | 'textOutroAnimationList'
  | 'textLoopAnimationList'
  | 'fontList'
  | 'imageAdd'
  | 'imageAddBatch'
  | 'imageUpdate'
  | 'imageDelete'
  | 'videoAdd'
  | 'videoAddBatch'
  | 'videoUpdate'
  | 'videoDelete'
  | 'transitionTypeList'
  | 'audioAdd'
  | 'audioAddBatch'
  | 'audioUpdate'
  | 'audioDelete'
  | 'audioEffectTypeList'
  | 'keyframeAdd'
  | 'effectAdd'
  | 'effectUpdate'
  | 'effectDelete'
  | 'characterEffectTypeList'
  | 'sceneEffectTypeList'
  | 'filterAdd'
  | 'filterUpdate'
  | 'filterDelete'
  | 'filterTypeList'
  | 'imageIntroAnimationList'
  | 'imageOutroAnimationList'
  | 'imageLoopAnimationList'
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
  preferredLocalSkillFilename?: string
  preferredLocalSkillTriggerMode?: SkillTriggerMode
  preferredLocalSkillMatchedBy?: SkillMatchSignal[]
  preferredLocalSkillMatchedEvidence?: string[]
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
  preferredLocalSkillFilename?: string
  preferredLocalSkillTriggerMode?: SkillTriggerMode
  preferredLocalSkillMatchedBy?: SkillMatchSignal[]
  preferredLocalSkillMatchedEvidence?: string[]
  preferredLocalSkillSdkDiscovered?: boolean
}

type WorkspaceSkillRef = {
  name: string
  description?: string
  filename: string
}

type WorkspaceSkillMatch = {
  skill: WorkspaceSkillRef
  triggerMode: SkillTriggerMode
  matchedBy: SkillMatchSignal[]
  matchedEvidence: string[]
}

const syncSelectedCapabilitiesFromActiveDomains = (
  activeDomains: ActiveIntentDomain[],
  selected: Set<RuntimeCapability>,
  reasons: Record<string, string[]>
) => {
  for (const activeDomain of activeDomains) {
    if (activeDomain.domain === 'chat') {
      if (activeDomain.subdomains.includes('bash') && !selected.has('bash')) {
        addCapabilityReason(selected, reasons, 'bash', 'intent:chat.bash')
      }
      continue
    }

    if (activeDomain.domain === 'web') {
      if (activeDomain.subdomains.includes('browser') && !selected.has('browser')) {
        addCapabilityReason(selected, reasons, 'browser', 'intent:web.browser')
      }
      if (activeDomain.subdomains.includes('search') && !selected.has('search')) {
        addCapabilityReason(selected, reasons, 'search', 'intent:web.search')
      }
      if (activeDomain.subdomains.includes('download') && !selected.has('webDownload')) {
        addCapabilityReason(selected, reasons, 'webDownload', 'intent:web.download')
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
      if (activeDomain.subdomains.includes('audio_extract') && !selected.has('audioExtract')) {
        addCapabilityReason(selected, reasons, 'audioExtract', 'intent:cut.audio_extract')
      }
      if (activeDomain.subdomains.includes('audio_concat') && !selected.has('audioConcat')) {
        addCapabilityReason(selected, reasons, 'audioConcat', 'intent:cut.audio_concat')
      }
      if (activeDomain.subdomains.includes('media_download') && !selected.has('mediaDownload')) {
        addCapabilityReason(selected, reasons, 'mediaDownload', 'intent:cut.media_download')
      }
      if (activeDomain.subdomains.includes('frame_capture') && !selected.has('frameCapture')) {
        addCapabilityReason(selected, reasons, 'frameCapture', 'intent:cut.frame_capture')
      }
      if (activeDomain.subdomains.includes('media_duration') && !selected.has('mediaDuration')) {
        addCapabilityReason(selected, reasons, 'mediaDuration', 'intent:cut.media_duration')
      }
      if (activeDomain.subdomains.includes('media_trim') && !selected.has('mediaTrim')) {
        addCapabilityReason(selected, reasons, 'mediaTrim', 'intent:cut.media_trim')
      }
      if (activeDomain.subdomains.includes('video_concat') && !selected.has('videoConcat')) {
        addCapabilityReason(selected, reasons, 'videoConcat', 'intent:cut.video_concat')
      }
      if (activeDomain.subdomains.includes('text_add') && !selected.has('textAdd')) {
        addCapabilityReason(selected, reasons, 'textAdd', 'intent:cut.text_add')
      }
      if (activeDomain.subdomains.includes('text_add_batch') && !selected.has('textAddBatch')) {
        addCapabilityReason(selected, reasons, 'textAddBatch', 'intent:cut.text_add_batch')
      }
      if (activeDomain.subdomains.includes('text_delete') && !selected.has('textDelete')) {
        addCapabilityReason(selected, reasons, 'textDelete', 'intent:cut.text_delete')
      }
      if (activeDomain.subdomains.includes('text_update') && !selected.has('textUpdate')) {
        addCapabilityReason(selected, reasons, 'textUpdate', 'intent:cut.text_update')
      }
      if (activeDomain.subdomains.includes('subtitle_srt') && !selected.has('subtitleSrt')) {
        addCapabilityReason(selected, reasons, 'subtitleSrt', 'intent:cut.subtitle_srt')
      }
      if (activeDomain.subdomains.includes('subtitle_recognition') && !selected.has('subtitleRecognition')) {
        addCapabilityReason(selected, reasons, 'subtitleRecognition', 'intent:cut.subtitle_recognition')
      }
      if (activeDomain.subdomains.includes('text_intro_animation_list') && !selected.has('textIntroAnimationList')) {
        addCapabilityReason(selected, reasons, 'textIntroAnimationList', 'intent:cut.text_intro_animation_list')
      }
      if (activeDomain.subdomains.includes('text_outro_animation_list') && !selected.has('textOutroAnimationList')) {
        addCapabilityReason(selected, reasons, 'textOutroAnimationList', 'intent:cut.text_outro_animation_list')
      }
      if (activeDomain.subdomains.includes('text_loop_animation_list') && !selected.has('textLoopAnimationList')) {
        addCapabilityReason(selected, reasons, 'textLoopAnimationList', 'intent:cut.text_loop_animation_list')
      }
      if (activeDomain.subdomains.includes('font_list') && !selected.has('fontList')) {
        addCapabilityReason(selected, reasons, 'fontList', 'intent:cut.font_list')
      }
      if (activeDomain.subdomains.includes('image_add') && !selected.has('imageAdd')) {
        addCapabilityReason(selected, reasons, 'imageAdd', 'intent:cut.image_add')
      }
      if (activeDomain.subdomains.includes('image_add_batch') && !selected.has('imageAddBatch')) {
        addCapabilityReason(selected, reasons, 'imageAddBatch', 'intent:cut.image_add_batch')
      }
      if (activeDomain.subdomains.includes('image_update') && !selected.has('imageUpdate')) {
        addCapabilityReason(selected, reasons, 'imageUpdate', 'intent:cut.image_update')
      }
      if (activeDomain.subdomains.includes('image_delete') && !selected.has('imageDelete')) {
        addCapabilityReason(selected, reasons, 'imageDelete', 'intent:cut.image_delete')
      }
      if (activeDomain.subdomains.includes('video_add') && !selected.has('videoAdd')) {
        addCapabilityReason(selected, reasons, 'videoAdd', 'intent:cut.video_add')
      }
      if (activeDomain.subdomains.includes('video_add_batch') && !selected.has('videoAddBatch')) {
        addCapabilityReason(selected, reasons, 'videoAddBatch', 'intent:cut.video_add_batch')
      }
      if (activeDomain.subdomains.includes('video_update') && !selected.has('videoUpdate')) {
        addCapabilityReason(selected, reasons, 'videoUpdate', 'intent:cut.video_update')
      }
      if (activeDomain.subdomains.includes('video_delete') && !selected.has('videoDelete')) {
        addCapabilityReason(selected, reasons, 'videoDelete', 'intent:cut.video_delete')
      }
      if (activeDomain.subdomains.includes('transition_type_list') && !selected.has('transitionTypeList')) {
        addCapabilityReason(selected, reasons, 'transitionTypeList', 'intent:cut.transition_type_list')
      }
      if (activeDomain.subdomains.includes('audio_add') && !selected.has('audioAdd')) {
        addCapabilityReason(selected, reasons, 'audioAdd', 'intent:cut.audio_add')
      }
      if (activeDomain.subdomains.includes('audio_add_batch') && !selected.has('audioAddBatch')) {
        addCapabilityReason(selected, reasons, 'audioAddBatch', 'intent:cut.audio_add_batch')
      }
      if (activeDomain.subdomains.includes('audio_update') && !selected.has('audioUpdate')) {
        addCapabilityReason(selected, reasons, 'audioUpdate', 'intent:cut.audio_update')
      }
      if (activeDomain.subdomains.includes('audio_delete') && !selected.has('audioDelete')) {
        addCapabilityReason(selected, reasons, 'audioDelete', 'intent:cut.audio_delete')
      }
      if (activeDomain.subdomains.includes('audio_effect_type_list') && !selected.has('audioEffectTypeList')) {
        addCapabilityReason(selected, reasons, 'audioEffectTypeList', 'intent:cut.audio_effect_type_list')
      }
      if (activeDomain.subdomains.includes('keyframe_add') && !selected.has('keyframeAdd')) {
        addCapabilityReason(selected, reasons, 'keyframeAdd', 'intent:cut.keyframe_add')
      }
      if (activeDomain.subdomains.includes('effect_add') && !selected.has('effectAdd')) {
        addCapabilityReason(selected, reasons, 'effectAdd', 'intent:cut.effect_add')
      }
      if (activeDomain.subdomains.includes('effect_update') && !selected.has('effectUpdate')) {
        addCapabilityReason(selected, reasons, 'effectUpdate', 'intent:cut.effect_update')
      }
      if (activeDomain.subdomains.includes('effect_delete') && !selected.has('effectDelete')) {
        addCapabilityReason(selected, reasons, 'effectDelete', 'intent:cut.effect_delete')
      }
      if (activeDomain.subdomains.includes('character_effect_type_list') && !selected.has('characterEffectTypeList')) {
        addCapabilityReason(selected, reasons, 'characterEffectTypeList', 'intent:cut.character_effect_type_list')
      }
      if (activeDomain.subdomains.includes('scene_effect_type_list') && !selected.has('sceneEffectTypeList')) {
        addCapabilityReason(selected, reasons, 'sceneEffectTypeList', 'intent:cut.scene_effect_type_list')
      }
      if (activeDomain.subdomains.includes('filter_add') && !selected.has('filterAdd')) {
        addCapabilityReason(selected, reasons, 'filterAdd', 'intent:cut.filter_add')
      }
      if (activeDomain.subdomains.includes('filter_update') && !selected.has('filterUpdate')) {
        addCapabilityReason(selected, reasons, 'filterUpdate', 'intent:cut.filter_update')
      }
      if (activeDomain.subdomains.includes('filter_delete') && !selected.has('filterDelete')) {
        addCapabilityReason(selected, reasons, 'filterDelete', 'intent:cut.filter_delete')
      }
      if (activeDomain.subdomains.includes('filter_type_list') && !selected.has('filterTypeList')) {
        addCapabilityReason(selected, reasons, 'filterTypeList', 'intent:cut.filter_type_list')
      }
      if (activeDomain.subdomains.includes('image_intro_animation_list') && !selected.has('imageIntroAnimationList')) {
        addCapabilityReason(selected, reasons, 'imageIntroAnimationList', 'intent:cut.image_intro_animation_list')
      }
      if (activeDomain.subdomains.includes('image_outro_animation_list') && !selected.has('imageOutroAnimationList')) {
        addCapabilityReason(selected, reasons, 'imageOutroAnimationList', 'intent:cut.image_outro_animation_list')
      }
      if (activeDomain.subdomains.includes('image_loop_animation_list') && !selected.has('imageLoopAnimationList')) {
        addCapabilityReason(selected, reasons, 'imageLoopAnimationList', 'intent:cut.image_loop_animation_list')
      }
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
      if (activeDomain.subdomains.includes('download') && !selected.has('workspaceDownload')) {
        addCapabilityReason(selected, reasons, 'workspaceDownload', 'intent:workspace.download')
      }
      if (activeDomain.subdomains.includes('upload') && !selected.has('uploadFile')) {
        addCapabilityReason(selected, reasons, 'uploadFile', 'intent:workspace.upload')
      }
      continue
    }

    if (activeDomain.domain === 'skills') {
      if (
        activeDomain.subdomains.some((subdomain) =>
          ['search_skill', 'list_skill', 'create_skill', 'register_skill', 'invoke_skill'].includes(subdomain)
        ) &&
        !selected.has('skills')
      ) {
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
  'bash',
  'browser',
  'search',
  'workspaceDownload',
  'webDownload',
  'uploadFile',
  'image',
  'speech',
  'seedAudio',
  'audioExtract',
  'audioConcat',
  'frameCapture',
  'mediaDownload',
  'mediaDuration',
  'mediaTrim',
  'videoConcat',
  'textAdd',
  'textAddBatch',
  'textDelete',
  'textUpdate',
  'subtitleRecognition',
  'subtitleSrt',
  'textIntroAnimationList',
  'textOutroAnimationList',
  'textLoopAnimationList',
  'fontList',
  'imageAdd',
  'imageAddBatch',
  'imageUpdate',
  'imageDelete',
  'videoAdd',
  'videoAddBatch',
  'videoUpdate',
  'videoDelete',
  'transitionTypeList',
  'audioAdd',
  'audioAddBatch',
  'audioUpdate',
  'audioDelete',
  'audioEffectTypeList',
  'keyframeAdd',
  'effectAdd',
  'effectUpdate',
  'effectDelete',
  'characterEffectTypeList',
  'sceneEffectTypeList',
  'filterAdd',
  'filterUpdate',
  'filterDelete',
  'filterTypeList',
  'imageIntroAnimationList',
  'imageOutroAnimationList',
  'imageLoopAnimationList',
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
  'bash',
  'browser',
  'search',
  'workspaceDownload',
  'webDownload',
  'uploadFile',
  'image',
  'speech',
  'seedAudio',
  'audioExtract',
  'audioConcat',
  'frameCapture',
  'mediaDownload',
  'mediaDuration',
  'mediaTrim',
  'videoConcat',
  'textAdd',
  'textAddBatch',
  'textDelete',
  'textUpdate',
  'subtitleRecognition',
  'subtitleSrt',
  'textIntroAnimationList',
  'textOutroAnimationList',
  'textLoopAnimationList',
  'fontList',
  'imageAdd',
  'imageAddBatch',
  'imageUpdate',
  'imageDelete',
  'videoAdd',
  'videoAddBatch',
  'videoUpdate',
  'videoDelete',
  'transitionTypeList',
  'audioAdd',
  'audioAddBatch',
  'audioUpdate',
  'audioDelete',
  'audioEffectTypeList',
  'keyframeAdd',
  'effectAdd',
  'effectUpdate',
  'effectDelete',
  'characterEffectTypeList',
  'sceneEffectTypeList',
  'filterAdd',
  'filterUpdate',
  'filterDelete',
  'filterTypeList',
  'imageIntroAnimationList',
  'imageOutroAnimationList',
  'imageLoopAnimationList',
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
const VIDEO_FILE_REFERENCE_PATTERN = new RegExp(
  `${TOKEN_BOUNDARY}(?:\\.{0,2}/)?${TOKEN_BODY}\\.(mp4|mov|m4v|mkv|avi|flv|webm|wmv|mpeg|mpg|ts|m2ts|mts)(?:\\b|$)`,
  'i'
)
const AUDIO_FILE_REFERENCE_PATTERN = new RegExp(
  `${TOKEN_BOUNDARY}(?:\\.{0,2}/)?${TOKEN_BODY}\\.(mp3|wav|m4a|aac|flac|ogg|opus|wma|aiff|aif|amr)(?:\\b|$)`,
  'i'
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

const normalizeSkillPhrase = (value: string): string =>
  normalizeCapabilityText(value).replace(/^[@#]+/, '').trim()

const collectWorkspaceSkillMatchSignals = (
  skill: WorkspaceSkillRef
): Array<{ signal: SkillMatchSignal; phrase: string }> => {
  const signals = new Map<string, { signal: SkillMatchSignal; phrase: string }>()
  const addPhrase = (signal: SkillMatchSignal, value: string | undefined) => {
    const normalized = normalizeSkillPhrase(String(value || ''))
    if (!normalized) return
    if (normalized.length < 2) return
    signals.set(`${signal}:${normalized}`, { signal, phrase: normalized })
  }

  addPhrase('name', skill.name)
  addPhrase('filename', skill.filename)

  for (const part of String(skill.description || '')
    .split(/[，。,；;、:：()（）\[\]【】]/)
    .map((item) => item.trim())
    .filter(Boolean)) {
    const normalized = normalizeSkillPhrase(part)
    if (!normalized || normalized.length < 3) continue
    if (['用户提到', '时触发', '触发', '生成', '技能'].includes(normalized)) continue
    addPhrase('description', normalized)
  }

  return Array.from(signals.values())
}

const SKILL_MENTION_PATTERN = /(^|\s)@([\p{L}\p{N}_-]+)/gu

const extractMentionedSkillNames = (value: string): string[] => {
  const mentions: string[] = []
  for (const match of String(value || '').matchAll(SKILL_MENTION_PATTERN)) {
    const token = normalizeSkillPhrase(match[2] || '')
    if (token) mentions.push(token)
  }
  return Array.from(new Set(mentions))
}

const findWorkspaceSkillMatch = (
  prompt: string,
  normalizedPrompt: string,
  workspaceSkills: WorkspaceSkillRef[] = []
): WorkspaceSkillMatch | undefined => {
  if (workspaceSkills.length === 0) return undefined

  const mentionedSkillNames = extractMentionedSkillNames(prompt)
  if (mentionedSkillNames.length > 0) {
    for (const mentionedSkillName of mentionedSkillNames) {
      for (const skill of workspaceSkills) {
        const explicitSignals = collectWorkspaceSkillMatchSignals(skill).filter(
          (item) => item.signal === 'name' || item.signal === 'filename'
        )
        const matchedSignals = explicitSignals.filter((item) => item.phrase === mentionedSkillName)
        if (matchedSignals.length === 0) continue
        return {
          skill,
          triggerMode: 'explicit',
          matchedBy: Array.from(new Set(matchedSignals.map((item) => item.signal))),
          matchedEvidence: [mentionedSkillName]
        }
      }
    }
  }

  for (const skill of workspaceSkills) {
    const matchedSignals = collectWorkspaceSkillMatchSignals(skill).filter(
      (item) => item.phrase && normalizedPrompt.includes(item.phrase)
    )
    if (matchedSignals.length === 0) continue
    return {
      skill,
      triggerMode: 'implicit',
      matchedBy: Array.from(new Set(matchedSignals.map((item) => item.signal))),
      matchedEvidence: Array.from(new Set(matchedSignals.map((item) => item.phrase)))
    }
  }

  return undefined
}

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
const WORKSPACE_DOWNLOAD_KEYWORDS = [
  '下载',
  '下载到本地',
  '下载到当前工作区',
  '下载到workspace',
  '保存到本地',
  '保存到工作区',
  '保存到 workspace',
  '另存为',
  'download',
  'save to workspace',
  'save locally'
]
const WORKSPACE_UPLOAD_KEYWORDS = [
  '上传',
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
  '百度',
  '查',
  '看',
  '找',
  '搜',
  '网'
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
const CHAT_BASH_KEYWORDS = [
  'bash',
  'shell',
  'terminal',
  '终端',
  '命令行',
  '跑命令',
  '执行命令',
  '执行脚本',
  '运行脚本',
  'python3',
  'ffmpeg',
  'curl'
]
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
const CUT_SUBTITLE_RECOGNITION_KEYWORDS = [
  '字幕识别',
  '识别字幕',
  '提取字幕',
  '字幕提取',
  '字幕转写',
  '字幕文案',
  '带时间轴的字幕',
  'subtitle recognition',
  'transcribe subtitle'
]
const DRAFT_REFERENCE_PATTERN = /(草稿|draft|dfd_[a-z0-9_-]*)/
const DRAFT_INSPECT_VERB_PATTERN = /(查看|查询|检查|确认|校验|核对|核查|看下|看一下)/
const DRAFT_VISUAL_ATTRIBUTE_PATTERN = /(动画|弹入|转场|位置|样式|特效|右上|左上|右下|左下|居中|效果)/
const DRAFT_VISUAL_INSPECT_PATTERN = new RegExp(
  `(?:${DRAFT_REFERENCE_PATTERN.source}.{0,80}${DRAFT_INSPECT_VERB_PATTERN.source}|${DRAFT_INSPECT_VERB_PATTERN.source}.{0,40}${DRAFT_REFERENCE_PATTERN.source}).{0,40}${DRAFT_VISUAL_ATTRIBUTE_PATTERN.source}`
)

const hasDraftMetaUpdateIntent = (text: string) =>
  (text.includes('草稿') || text.includes('draft')) &&
  ((/(修改|更改|改一下|改下|更新|设置|替换).{0,12}(封面|名称|名字|标题)/.test(text) ||
    /(封面|名称|名字|标题).{0,12}(修改|更改|改一下|改下|更新|设置|替换)/.test(text)))

const hasDraftInspectIntent = (text: string) =>
  hasAnyKeyword(text, ['query script', 'query_script']) ||
  DRAFT_VISUAL_INSPECT_PATTERN.test(text) ||
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
    /(字幕模板|字幕模版|字幕样式|字幕风格|样式模板|样式模版)/.test(text)) ||
  (/(字幕样式|字幕风格|字幕模板|字幕模版|样式模板|样式模版)/.test(text) &&
    /(音频|视频|audio|video)/.test(text))

const hasMediaFileReference = (text: string) => AUDIO_FILE_REFERENCE_PATTERN.test(text) || hasVideoFileReference(text)

const hasLocalMediaContext = (text: string) =>
  hasMediaFileReference(text) ||
  /(本地|工作区|workspace).{0,8}(音频|视频|文件|素材|录音)/.test(text) ||
  /(音频|视频|文件|素材|录音).{0,8}(本地|工作区|workspace)/.test(text)

const hasSubtitleRecognitionIntent = (text: string) =>
  (hasAnyKeyword(text, CUT_SUBTITLE_RECOGNITION_KEYWORDS) ||
    ((/(识别|提取|抽取|转写|转成|转换成|导出)/.test(text) || /\basr\b/.test(text)) &&
      /(字幕|文案|台词|时间轴)/.test(text)) ||
    (/(字幕|文案|台词)/.test(text) && /(识别|提取|抽取|转写)/.test(text))) &&
  (hasAudioSubject(text) || hasVideoSubject(text) || hasMediaFileReference(text) || hasUrlLikeText(text)) &&
  !hasSubtitleTemplateIntent(text) &&
  !/(添加到草稿|加回草稿|回写草稿|写回草稿|(?:加回|写回|添加到).{0,6}草稿|(?:给|帮|把|将).{0,12}上屏|字幕模板|字幕模版|样式模板|样式模版|套字幕样式|套模版|套模板)/.test(
    text
  )

const CUT_LOOKUP_KEYWORDS = ['查看', '看下', '看一下', '查询', '列出', '有哪些', '可用', '支持', '列表']
const hasCutDraftContext = (text: string) => /(草稿|draft|dfd_)/.test(text)
const hasLookupIntent = (text: string) => hasAnyKeyword(text, CUT_LOOKUP_KEYWORDS)
const hasTextSubject = (text: string) => /(文字|文本)/.test(text)
const hasImageSubject = (text: string) => /(图片|配图|image)/.test(text)
const hasVideoSubject = (text: string) => /(视频|video|视频片段)/.test(text)
const hasVideoFileReference = (text: string) => VIDEO_FILE_REFERENCE_PATTERN.test(text)
const hasAudioSubject = (text: string) => /(音频|音轨|bgm|配乐|音乐|audio)/.test(text)
const hasEffectSubject = (text: string) => /特效/.test(text) && !/音频特效/.test(text)
const hasFilterSubject = (text: string) => /滤镜/.test(text)
const hasVisualMediaSubject = (text: string) => hasImageSubject(text) || hasVideoSubject(text)

const hasTextAddIntent = (text: string) =>
  hasCutDraftContext(text) &&
  hasTextSubject(text) &&
  /(添加|加上|新增|插入|放入)/.test(text) &&
  !/(批量|删除|移除|修改|编辑|更新|srt|字幕)/.test(text)

const hasTextAddBatchIntent = (text: string) =>
  hasCutDraftContext(text) && hasTextSubject(text) && /(批量|多个|多段|一批)/.test(text) && /(添加|加上|新增|插入)/.test(text)

const hasTextDeleteIntent = (text: string) =>
  hasCutDraftContext(text) && hasTextSubject(text) && /(删除|移除|去掉)/.test(text)

const hasTextUpdateIntent = (text: string) =>
  hasCutDraftContext(text) && hasTextSubject(text) && /(修改|编辑|更新|替换|改一下|改成)/.test(text)

const hasSubtitleSrtIntent = (text: string) =>
  hasCutDraftContext(text) && text.includes('srt') && /(字幕|添加|导入|加入|插入)/.test(text)

const hasTextIntroAnimationListIntent = (text: string) =>
  hasLookupIntent(text) && hasTextSubject(text) && /(入场|进场)/.test(text) && /动画/.test(text)

const hasTextOutroAnimationListIntent = (text: string) =>
  hasLookupIntent(text) && hasTextSubject(text) && /(出场|退场)/.test(text) && /动画/.test(text)

const hasTextLoopAnimationListIntent = (text: string) =>
  hasLookupIntent(text) && hasTextSubject(text) && /循环/.test(text) && /动画/.test(text)

const hasFontListIntent = (text: string) => hasLookupIntent(text) && /字体/.test(text)

const hasImageAddIntent = (text: string) =>
  hasCutDraftContext(text) &&
  hasImageSubject(text) &&
  /(添加|加上|新增|插入|放入)/.test(text) &&
  !/(批量|删除|移除|修改|编辑|更新)/.test(text)

const hasImageAddBatchIntent = (text: string) =>
  hasCutDraftContext(text) && hasImageSubject(text) && /(批量|多张|一批)/.test(text) && /(添加|加上|新增|插入)/.test(text)

const hasImageUpdateIntent = (text: string) =>
  hasCutDraftContext(text) && hasImageSubject(text) && /(修改|编辑|更新|替换|改一下|改成)/.test(text)

const hasImageDeleteIntent = (text: string) =>
  hasCutDraftContext(text) && hasImageSubject(text) && /(删除|移除|去掉)/.test(text)

const hasVideoAddIntent = (text: string) =>
  hasCutDraftContext(text) &&
  hasVideoSubject(text) &&
  /(添加|加上|新增|插入|放入)/.test(text) &&
  !/(批量|删除|移除|修改|编辑|更新)/.test(text)

const hasVideoAddBatchIntent = (text: string) =>
  hasCutDraftContext(text) && hasVideoSubject(text) && /(批量|多个|多段|一批)/.test(text) && /(添加|加上|新增|插入)/.test(text)

const hasVideoUpdateIntent = (text: string) =>
  hasCutDraftContext(text) && hasVideoSubject(text) && /(修改|编辑|更新|替换|改一下|改成)/.test(text)

const hasVideoDeleteIntent = (text: string) =>
  hasCutDraftContext(text) && hasVideoSubject(text) && /(删除|移除|去掉)/.test(text)

const hasTransitionTypeListIntent = (text: string) => hasLookupIntent(text) && /转场/.test(text)

const hasAudioAddIntent = (text: string) =>
  hasCutDraftContext(text) &&
  hasAudioSubject(text) &&
  /(添加|加上|新增|插入|放入)/.test(text) &&
  !/(批量|删除|移除|修改|编辑|更新|特效)/.test(text)

const hasAudioAddBatchIntent = (text: string) =>
  hasCutDraftContext(text) && hasAudioSubject(text) && /(批量|多个|多段|一批)/.test(text) && /(添加|加上|新增|插入)/.test(text)

const hasAudioUpdateIntent = (text: string) =>
  hasCutDraftContext(text) && hasAudioSubject(text) && /(修改|编辑|更新|替换|改一下|改成)/.test(text)

const hasAudioDeleteIntent = (text: string) =>
  hasCutDraftContext(text) && hasAudioSubject(text) && /(删除|移除|去掉)/.test(text)

const hasAudioEffectTypeListIntent = (text: string) => hasLookupIntent(text) && hasAudioSubject(text) && /特效/.test(text)

const hasAudioExtractIntent = (text: string) =>
  (hasVideoSubject(text) ||
    hasVideoFileReference(text) ||
    ((/文件|素材/.test(text) || hasFileReference(text, { allowUnknownExtensions: true })) &&
      /(提取|抽取|导出|拆出|分离)/.test(text))) &&
  (hasAudioSubject(text) || /音轨/.test(text)) &&
  /(分离|提取|抽取|导出|拆出|转成|转换)/.test(text) &&
  !/(添加|加上|新增|插入|放入|字幕模板|字幕模版|字幕)/.test(text)

const hasFrameCaptureIntent = (text: string) =>
  ((hasVideoSubject(text) || /(截帧|抽帧|导出帧|提取帧|帧图片|帧图)/.test(text)) &&
    (/(截帧|抽帧|导出帧|提取帧|帧图片|帧图|关键帧)/.test(text) ||
      ((/时间戳|时间点|某一帧|某个时间点/.test(text) || /第.{0,6}秒/.test(text)) &&
        /(截图|画面|图片|图像|封面|抓取|提取|截取)/.test(text)))) ||
  (/截取/.test(text) && /(帧图片|帧图)/.test(text))

const hasMediaDurationIntent = (text: string) =>
  (hasAudioSubject(text) || hasVideoSubject(text)) &&
  /(时长|duration|多长|长度)/.test(text) &&
  !hasCutDraftContext(text)

const hasMediaTrimIntent = (text: string) =>
  (hasAudioSubject(text) || hasVideoSubject(text)) &&
  (((/(截取|裁剪|剪出|剪下|切出|保留)/.test(text) || /trim/.test(text)) && /(片段|一段|区间|范围|时间段|时间范围)/.test(text)) ||
    (/从/.test(text) && /到/.test(text) && /(视频|音频|片段)/.test(text)))

const hasAudioConcatIntent = (text: string) =>
  hasAudioSubject(text) &&
  /(拼接|拼在一起|合并|接在一起|串起来|concat|concatenate|merge)/.test(text) &&
  !hasCutDraftContext(text)

const hasVideoConcatIntent = (text: string) =>
  (hasVideoSubject(text) || hasVideoFileReference(text)) &&
  /(拼接|拼在一起|合并|接在一起|串起来|concat|concatenate|merge)/.test(text) &&
  !hasCutDraftContext(text)

const hasDownloadKeyword = (text: string) =>
  hasAnyKeyword(text, WORKSPACE_DOWNLOAD_KEYWORDS) || /(下载|保存).{0,12}(本地|工作区|workspace|下来)/.test(text)

const hasMediaLink = (text: string) =>
  hasUrlLikeText(text) && (/\.(mp3|wav|m4a|aac|flac|ogg|mp4|mov|mkv|avi|webm|jpg|jpeg|png|gif|webp)\b/i.test(text) || /(音频|视频|图片|链接)/.test(text))

const hasMediaDownloadIntent = (text: string) => hasDownloadKeyword(text) && hasMediaLink(text) && !hasDraftDownloadIntent(text)

const hasChatBashIntent = (text: string) =>
  hasAnyKeyword(text, CHAT_BASH_KEYWORDS) ||
  /(运行|执行|跑).{0,12}(bash|shell|terminal|命令|脚本)/.test(text) ||
  /\b(python3?|bash|sh|zsh|ffmpeg|curl|node)\b/.test(text)

const hasKeyframeAddIntent = (text: string) =>
  hasCutDraftContext(text) && /关键帧/.test(text) && /(添加|加上|新增)/.test(text)

const hasEffectAddIntent = (text: string) =>
  hasCutDraftContext(text) && hasEffectSubject(text) && /(添加|加上|新增|插入)/.test(text) && !/(删除|移除|修改|编辑|更新)/.test(text)

const hasEffectUpdateIntent = (text: string) =>
  hasCutDraftContext(text) && hasEffectSubject(text) && /(修改|编辑|更新|替换|改一下|改成)/.test(text)

const hasEffectDeleteIntent = (text: string) =>
  hasCutDraftContext(text) && hasEffectSubject(text) && /(删除|移除|去掉)/.test(text)

const hasCharacterEffectTypeListIntent = (text: string) => hasLookupIntent(text) && /人物特效/.test(text)

const hasSceneEffectTypeListIntent = (text: string) => hasLookupIntent(text) && /场景特效/.test(text)

const hasFilterAddIntent = (text: string) =>
  hasCutDraftContext(text) && hasFilterSubject(text) && /(添加|加上|新增|插入)/.test(text) && !/(删除|移除|修改|编辑|更新)/.test(text)

const hasFilterUpdateIntent = (text: string) =>
  hasCutDraftContext(text) && hasFilterSubject(text) && /(修改|编辑|更新|替换|改一下|改成)/.test(text)

const hasFilterDeleteIntent = (text: string) =>
  hasCutDraftContext(text) && hasFilterSubject(text) && /(删除|移除|去掉)/.test(text)

const hasFilterTypeListIntent = (text: string) => hasLookupIntent(text) && hasFilterSubject(text) && /类型/.test(text)

const hasImageIntroAnimationListIntent = (text: string) =>
  hasLookupIntent(text) && hasVisualMediaSubject(text) && /(入场|进场)/.test(text) && /动画/.test(text)

const hasImageOutroAnimationListIntent = (text: string) =>
  hasLookupIntent(text) && hasVisualMediaSubject(text) && /(出场|退场)/.test(text) && /动画/.test(text)

const hasImageLoopAnimationListIntent = (text: string) =>
  hasLookupIntent(text) && hasVisualMediaSubject(text) && /(循环|组合)/.test(text) && /动画/.test(text)

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

const SKILL_MANAGEMENT_KEYWORDS = [
  '安装技能',
  '创建技能',
  '新建技能',
  '删除技能',
  '移除技能',
  '卸载技能',
  'install skill',
  'create skill',
  'new skill',
  'remove skill',
  'delete skill'
]

const SKILL_SEARCH_KEYWORDS = ['搜索技能', '查找技能', '搜索现成技能', '查市场技能', 'search skill', 'find skill']
const SKILL_LIST_KEYWORDS = ['列出技能', '技能列表', '查看技能', '有哪些技能', '有哪些本地技能', 'list skill', 'skill list']
const SKILL_REGISTER_KEYWORDS = ['注册技能', 'register skill']

const hasSkillCreationIntent = (text: string) =>
  hasAnyKeyword(text, ['新建成员', '创建成员', 'create member']) ||
  ((text.includes('创建') || text.includes('新建')) && hasAnyKeyword(text, ['技能', 'skill', '成员']))

const hasSkillSearchIntent = (text: string) => hasAnyKeyword(text, SKILL_SEARCH_KEYWORDS)

const hasSkillListIntent = (text: string) =>
  hasAnyKeyword(text, SKILL_LIST_KEYWORDS) ||
  ((/(查看|检查|分析|修改|编辑|删除|移除)/.test(text) && /(技能|skill|成员)/.test(text)))

const hasSkillRegisterIntent = (text: string) =>
  hasAnyKeyword(text, SKILL_REGISTER_KEYWORDS) ||
  /注册.{0,8}(技能|skill|成员)/.test(text) ||
  /(技能|skill|成员).{0,8}注册/.test(text)

const hasSkillManagementIntent = (text: string) =>
  hasSkillCreationIntent(text) ||
  hasSkillRegisterIntent(text) ||
  hasSkillSearchIntent(text) ||
  hasSkillListIntent(text) ||
  hasAnyKeyword(text, SKILL_MANAGEMENT_KEYWORDS) ||
  (/(注册|安装|搜索|查找|列出)/.test(text) && /(技能|skill|成员)/.test(text))

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
    workspaceSkills?: WorkspaceSkillRef[]
  }): CapabilityDecision {
    const turn = (this.turnsBySession.get(args.sessionId) ?? 0) + 1
    this.turnsBySession.set(args.sessionId, turn)

    const selected = new Set<RuntimeCapability>()
    const reasons: Record<string, string[]> = {}
    const stickyApplied: string[] = []
    const intentPrompt = String(args.intentPrompt || args.prompt || '')
    const text = normalizeCapabilityText(intentPrompt)

    let matchedWorkspaceSkill: WorkspaceSkillMatch | undefined

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
      const hasTextAdd = hasTextAddIntent(text)
      const hasTextAddBatch = hasTextAddBatchIntent(text)
      const hasTextDelete = hasTextDeleteIntent(text)
      const hasTextUpdate = hasTextUpdateIntent(text)
      const hasSubtitleRecognition = hasSubtitleRecognitionIntent(text)
      const hasSubtitleSrt = hasSubtitleSrtIntent(text)
      const hasTextIntroAnimationList = hasTextIntroAnimationListIntent(text)
      const hasTextOutroAnimationList = hasTextOutroAnimationListIntent(text)
      const hasTextLoopAnimationList = hasTextLoopAnimationListIntent(text)
      const hasFontList = hasFontListIntent(text)
      const hasImageAdd = hasImageAddIntent(text)
      const hasImageAddBatch = hasImageAddBatchIntent(text)
      const hasImageUpdate = hasImageUpdateIntent(text)
      const hasImageDelete = hasImageDeleteIntent(text)
      const hasVideoAdd = hasVideoAddIntent(text)
      const hasVideoAddBatch = hasVideoAddBatchIntent(text)
      const hasVideoUpdate = hasVideoUpdateIntent(text)
      const hasVideoDelete = hasVideoDeleteIntent(text)
      const hasTransitionTypeList = hasTransitionTypeListIntent(text)
      const hasAudioAdd = hasAudioAddIntent(text)
      const hasAudioAddBatch = hasAudioAddBatchIntent(text)
      const hasAudioUpdate = hasAudioUpdateIntent(text)
      const hasAudioDelete = hasAudioDeleteIntent(text)
      const hasAudioEffectTypeList = hasAudioEffectTypeListIntent(text)
      const hasAudioExtract = hasAudioExtractIntent(text)
      const hasAudioConcat = hasAudioConcatIntent(text)
      const hasChatBash = hasChatBashIntent(text)
      const hasFrameCapture = hasFrameCaptureIntent(text)
      const hasMediaDownload = hasMediaDownloadIntent(text)
      const hasMediaDuration = hasMediaDurationIntent(text)
      const hasMediaTrim = hasMediaTrimIntent(text)
      const hasVideoConcat = hasVideoConcatIntent(text)
      const hasKeyframeAdd = hasKeyframeAddIntent(text)
      const hasEffectAdd = hasEffectAddIntent(text)
      const hasEffectUpdate = hasEffectUpdateIntent(text)
      const hasEffectDelete = hasEffectDeleteIntent(text)
      const hasCharacterEffectTypeList = hasCharacterEffectTypeListIntent(text)
      const hasSceneEffectTypeList = hasSceneEffectTypeListIntent(text)
      const hasFilterAdd = hasFilterAddIntent(text)
      const hasFilterUpdate = hasFilterUpdateIntent(text)
      const hasFilterDelete = hasFilterDeleteIntent(text)
      const hasFilterTypeList = hasFilterTypeListIntent(text)
      const hasImageIntroAnimationList = hasImageIntroAnimationListIntent(text)
      const hasImageOutroAnimationList = hasImageOutroAnimationListIntent(text)
      const hasImageLoopAnimationList = hasImageLoopAnimationListIntent(text)
      const shouldApplySubtitleTemplate = hasSubtitleTemplateIntent(text)
      const hasTemplateIntent = hasAnyKeyword(text, CUT_TEMPLATE_KEYWORDS) && !shouldApplySubtitleTemplate
      const hasCutSpecificIntent =
        hasTextAdd ||
        hasTextAddBatch ||
        hasTextDelete ||
        hasTextUpdate ||
        hasSubtitleRecognition ||
        hasSubtitleSrt ||
        hasTextIntroAnimationList ||
        hasTextOutroAnimationList ||
        hasTextLoopAnimationList ||
        hasFontList ||
        hasImageAdd ||
        hasImageAddBatch ||
        hasImageUpdate ||
        hasImageDelete ||
        hasVideoAdd ||
        hasVideoAddBatch ||
        hasVideoUpdate ||
        hasVideoDelete ||
        hasTransitionTypeList ||
        hasAudioAdd ||
        hasAudioAddBatch ||
        hasAudioUpdate ||
        hasAudioDelete ||
        hasAudioEffectTypeList ||
        hasAudioConcat ||
        hasKeyframeAdd ||
        hasEffectAdd ||
        hasEffectUpdate ||
        hasEffectDelete ||
        hasCharacterEffectTypeList ||
        hasSceneEffectTypeList ||
        hasFilterAdd ||
        hasFilterUpdate ||
        hasFilterDelete ||
        hasFilterTypeList ||
        hasImageIntroAnimationList ||
        hasImageOutroAnimationList ||
        hasImageLoopAnimationList ||
        hasMediaDownload ||
        hasDraftCreateIntent ||
        hasDraftUpdateIntent ||
        shouldInspectDraft ||
        shouldDownloadDraft ||
        shouldApplySubtitleTemplate ||
        hasTemplateIntent ||
        hasVideoConcat
      const hasWorkspaceDownloadIntent = hasDownloadKeyword(text) && !hasMediaDownload && !shouldDownloadDraft
      const hasWebDownloadIntent = hasDownloadKeyword(text) && hasUrlLikeText(args.prompt) && !hasMediaDownload && !shouldDownloadDraft
      const hasImplicitBrowserUrlIntent =
        hasUrlLikeText(args.prompt) && !hasCutSpecificIntent && !hasWorkspaceDownloadIntent && !hasWebDownloadIntent

      if (args.isAssistant) {
        addCapabilityReason(selected, reasons, 'assistant', 'assistant-role')
      }

      if (hasChatBash) {
        addCapabilityReason(selected, reasons, 'bash', 'prompt:chat-bash')
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
        /(文件|附件|素材|音频|视频|图片).{0,8}(上传|传到oss|上传到oss)/.test(text) ||
        (hasSubtitleRecognition && !hasUrlLikeText(args.prompt) && hasLocalMediaContext(text))
      ) {
        addCapabilityReason(selected, reasons, 'uploadFile', 'prompt:upload-file')
      }

      if (hasWorkspaceDownloadIntent) {
        addCapabilityReason(selected, reasons, 'workspaceDownload', 'prompt:workspace-download')
      }

      if (hasWebDownloadIntent) {
        addCapabilityReason(selected, reasons, 'webDownload', 'prompt:web-download')
      }

      if (
        !hasCutSpecificIntent &&
        (args.imageCount > 0 ||
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
          (text.includes('封面') && !hasDraftUpdateIntent))
      ) {
        addCapabilityReason(
          selected,
          reasons,
          'image',
          args.imageCount > 0 ? 'prompt:image-with-attachment' : 'prompt:image'
        )
      }

      const shouldGenerateSeedAudio = hasSeedAudioIntent(text)

      if (
        !hasCutSpecificIntent &&
        hasAnyKeyword(text, ['语音', '配音', '音色', '朗读', '声音', 'tts', 'voice', 'speech', 'audio']) &&
        !shouldGenerateSeedAudio
      ) {
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

      if (hasTextAdd) {
        addCapabilityReason(selected, reasons, 'textAdd', 'prompt:text-add')
      }

      if (hasTextAddBatch) {
        addCapabilityReason(selected, reasons, 'textAddBatch', 'prompt:text-add-batch')
      }

      if (hasTextDelete) {
        addCapabilityReason(selected, reasons, 'textDelete', 'prompt:text-delete')
      }

      if (hasTextUpdate) {
        addCapabilityReason(selected, reasons, 'textUpdate', 'prompt:text-update')
      }

      if (hasSubtitleSrt) {
        addCapabilityReason(selected, reasons, 'subtitleSrt', 'prompt:subtitle-srt')
      }

      if (hasSubtitleRecognition) {
        addCapabilityReason(selected, reasons, 'subtitleRecognition', 'prompt:subtitle-recognition')
      }

      if (hasTextIntroAnimationList) {
        addCapabilityReason(selected, reasons, 'textIntroAnimationList', 'prompt:text-intro-animation-list')
      }

      if (hasTextOutroAnimationList) {
        addCapabilityReason(selected, reasons, 'textOutroAnimationList', 'prompt:text-outro-animation-list')
      }

      if (hasTextLoopAnimationList) {
        addCapabilityReason(selected, reasons, 'textLoopAnimationList', 'prompt:text-loop-animation-list')
      }

      if (hasFontList) {
        addCapabilityReason(selected, reasons, 'fontList', 'prompt:font-list')
      }

      if (hasImageAdd) {
        addCapabilityReason(selected, reasons, 'imageAdd', 'prompt:image-add')
      }

      if (hasImageAddBatch) {
        addCapabilityReason(selected, reasons, 'imageAddBatch', 'prompt:image-add-batch')
      }

      if (hasImageUpdate) {
        addCapabilityReason(selected, reasons, 'imageUpdate', 'prompt:image-update')
      }

      if (hasImageDelete) {
        addCapabilityReason(selected, reasons, 'imageDelete', 'prompt:image-delete')
      }

      if (hasVideoAdd) {
        addCapabilityReason(selected, reasons, 'videoAdd', 'prompt:video-add')
      }

      if (hasVideoAddBatch) {
        addCapabilityReason(selected, reasons, 'videoAddBatch', 'prompt:video-add-batch')
      }

      if (hasVideoUpdate) {
        addCapabilityReason(selected, reasons, 'videoUpdate', 'prompt:video-update')
      }

      if (hasVideoDelete) {
        addCapabilityReason(selected, reasons, 'videoDelete', 'prompt:video-delete')
      }

      if (hasTransitionTypeList) {
        addCapabilityReason(selected, reasons, 'transitionTypeList', 'prompt:transition-type-list')
      }

      if (hasAudioAdd) {
        addCapabilityReason(selected, reasons, 'audioAdd', 'prompt:audio-add')
      }

      if (hasAudioAddBatch) {
        addCapabilityReason(selected, reasons, 'audioAddBatch', 'prompt:audio-add-batch')
      }

      if (hasAudioUpdate) {
        addCapabilityReason(selected, reasons, 'audioUpdate', 'prompt:audio-update')
      }

      if (hasAudioDelete) {
        addCapabilityReason(selected, reasons, 'audioDelete', 'prompt:audio-delete')
      }

      if (hasAudioEffectTypeList) {
        addCapabilityReason(selected, reasons, 'audioEffectTypeList', 'prompt:audio-effect-type-list')
      }

      if (hasAudioExtract) {
        addCapabilityReason(selected, reasons, 'audioExtract', 'prompt:audio-extract')
      }

      if (hasAudioConcat) {
        addCapabilityReason(selected, reasons, 'audioConcat', 'prompt:audio-concat')
      }

      if (hasFrameCapture) {
        addCapabilityReason(selected, reasons, 'frameCapture', 'prompt:frame-capture')
      }

      if (hasMediaDownload) {
        addCapabilityReason(selected, reasons, 'mediaDownload', 'prompt:media-download')
      }

      if (hasMediaDuration) {
        addCapabilityReason(selected, reasons, 'mediaDuration', 'prompt:media-duration')
      }

      if (hasMediaTrim) {
        addCapabilityReason(selected, reasons, 'mediaTrim', 'prompt:media-trim')
      }

      if (hasVideoConcat) {
        addCapabilityReason(selected, reasons, 'videoConcat', 'prompt:video-concat')
      }

      if (hasKeyframeAdd) {
        addCapabilityReason(selected, reasons, 'keyframeAdd', 'prompt:keyframe-add')
      }

      if (hasEffectAdd) {
        addCapabilityReason(selected, reasons, 'effectAdd', 'prompt:effect-add')
      }

      if (hasEffectUpdate) {
        addCapabilityReason(selected, reasons, 'effectUpdate', 'prompt:effect-update')
      }

      if (hasEffectDelete) {
        addCapabilityReason(selected, reasons, 'effectDelete', 'prompt:effect-delete')
      }

      if (hasCharacterEffectTypeList) {
        addCapabilityReason(selected, reasons, 'characterEffectTypeList', 'prompt:character-effect-type-list')
      }

      if (hasSceneEffectTypeList) {
        addCapabilityReason(selected, reasons, 'sceneEffectTypeList', 'prompt:scene-effect-type-list')
      }

      if (hasFilterAdd) {
        addCapabilityReason(selected, reasons, 'filterAdd', 'prompt:filter-add')
      }

      if (hasFilterUpdate) {
        addCapabilityReason(selected, reasons, 'filterUpdate', 'prompt:filter-update')
      }

      if (hasFilterDelete) {
        addCapabilityReason(selected, reasons, 'filterDelete', 'prompt:filter-delete')
      }

      if (hasFilterTypeList) {
        addCapabilityReason(selected, reasons, 'filterTypeList', 'prompt:filter-type-list')
      }

      if (hasImageIntroAnimationList) {
        addCapabilityReason(selected, reasons, 'imageIntroAnimationList', 'prompt:image-intro-animation-list')
      }

      if (hasImageOutroAnimationList) {
        addCapabilityReason(selected, reasons, 'imageOutroAnimationList', 'prompt:image-outro-animation-list')
      }

      if (hasImageLoopAnimationList) {
        addCapabilityReason(selected, reasons, 'imageLoopAnimationList', 'prompt:image-loop-animation-list')
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

      matchedWorkspaceSkill = findWorkspaceSkillMatch(args.prompt, text, args.workspaceSkills)

      if (!selected.has('skills') && matchedWorkspaceSkill) {
        addCapabilityReason(
          selected,
          reasons,
          'skills',
          `prompt:workspace-skill:${matchedWorkspaceSkill.triggerMode}:${matchedWorkspaceSkill.skill.filename}`
        )
      }

      if (selected.has('skills') && !matchedWorkspaceSkill && (args.workspaceSkills?.length ?? 0) > 0) {
        matchedWorkspaceSkill = findWorkspaceSkillMatch(args.prompt, text, args.workspaceSkills)
      }

      if (hasAnyKeyword(text, ['记住', '记忆', '忘记', 'remember', 'memory'])) {
        addCapabilityReason(selected, reasons, 'agentMemory', 'prompt:memory')
      }

      if (args.autonomousEnabled && hasAnyKeyword(text, ['定时', '提醒', '通知', '计划任务', 'cron', 'notify'])) {
        addCapabilityReason(selected, reasons, 'claw', 'prompt:schedule-or-notify')
      }

      if (selected.has('skills')) {
        for (const capability of ALL_OPTIONAL_RUNTIME_CAPABILITIES) {
          addCapabilityReason(selected, reasons, capability, 'intent:skills-all-tools')
        }
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
      matchedWorkspaceSkill: matchedWorkspaceSkill?.skill,
      matchedWorkspaceSkillTriggerMode: matchedWorkspaceSkill?.triggerMode,
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
      preferredLocalSkillFilename: subdomains.includes('invoke_skill') ? matchedWorkspaceSkill?.skill.filename : undefined,
      preferredLocalSkillTriggerMode: subdomains.includes('invoke_skill') ? matchedWorkspaceSkill?.triggerMode : undefined,
      preferredLocalSkillMatchedBy: subdomains.includes('invoke_skill') ? matchedWorkspaceSkill?.matchedBy : undefined,
      preferredLocalSkillMatchedEvidence: subdomains.includes('invoke_skill')
        ? matchedWorkspaceSkill?.matchedEvidence
        : undefined,
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
    preferredMcpTools: decision.preferredMcpTools,
    preferredLocalSkillFilename: decision.preferredLocalSkillFilename,
    preferredLocalSkillTriggerMode: decision.preferredLocalSkillTriggerMode,
    preferredLocalSkillMatchedBy: decision.preferredLocalSkillMatchedBy,
    preferredLocalSkillMatchedEvidence: decision.preferredLocalSkillMatchedEvidence
  }
}

function classifyIntent(args: {
  prompt: string
  normalizedPrompt: string
  selected: Set<RuntimeCapability>
  matchedWorkspaceSkill?: WorkspaceSkillRef
  matchedWorkspaceSkillTriggerMode?: SkillTriggerMode
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

  if (args.selected.has('bash')) {
    addDomainSubdomain('chat', 'bash', 'capability:chat-bash')
  }

  const hasWorkspaceContextKeyword = hasAnyKeyword(text, WORKSPACE_CONTEXT_KEYWORDS)
  const hasReadActionKeyword = hasAnyKeyword(text, WORKSPACE_READ_ACTION_KEYWORDS)
  const hasWorkspaceReadIntent =
    hasWorkspaceContextKeyword ||
    hasFileReference(args.prompt) ||
    hasVideoFileReference(args.prompt) ||
    (hasReadActionKeyword && hasFileReference(args.prompt, { allowUnknownExtensions: true })) ||
    /(^|\s)(src|package\.json|tsconfig|vite|webpack|electron)\b/i.test(args.prompt)

  const hasWorkspaceFindIntent =
    hasAnyKeyword(text, WORKSPACE_FIND_KEYWORDS) ||
    (/有没有/.test(text) && (text.includes('文件') || text.includes('文字') || text.includes('内容')))
  const hasWorkspaceDownloadIntent = args.selected.has('workspaceDownload')
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
  const hasWebDownloadIntent = args.selected.has('webDownload')
  const hasNotebookIntent = text.includes('notebook') || text.includes('ipynb')
  const hasCutSpecificIntent =
    args.selected.has('audioExtract') ||
    args.selected.has('audioConcat') ||
    args.selected.has('frameCapture') ||
    args.selected.has('mediaDownload') ||
    args.selected.has('mediaDuration') ||
    args.selected.has('mediaTrim') ||
    args.selected.has('videoConcat') ||
    args.selected.has('textAdd') ||
    args.selected.has('textAddBatch') ||
    args.selected.has('textDelete') ||
    args.selected.has('textUpdate') ||
    args.selected.has('subtitleRecognition') ||
    args.selected.has('subtitleSrt') ||
    args.selected.has('textIntroAnimationList') ||
    args.selected.has('textOutroAnimationList') ||
    args.selected.has('textLoopAnimationList') ||
    args.selected.has('fontList') ||
    args.selected.has('imageAdd') ||
    args.selected.has('imageAddBatch') ||
    args.selected.has('imageUpdate') ||
    args.selected.has('imageDelete') ||
    args.selected.has('videoAdd') ||
    args.selected.has('videoAddBatch') ||
    args.selected.has('videoUpdate') ||
    args.selected.has('videoDelete') ||
    args.selected.has('transitionTypeList') ||
    args.selected.has('audioAdd') ||
    args.selected.has('audioAddBatch') ||
    args.selected.has('audioUpdate') ||
    args.selected.has('audioDelete') ||
    args.selected.has('audioEffectTypeList') ||
    args.selected.has('keyframeAdd') ||
    args.selected.has('effectAdd') ||
    args.selected.has('effectUpdate') ||
    args.selected.has('effectDelete') ||
    args.selected.has('characterEffectTypeList') ||
    args.selected.has('sceneEffectTypeList') ||
    args.selected.has('filterAdd') ||
    args.selected.has('filterUpdate') ||
    args.selected.has('filterDelete') ||
    args.selected.has('filterTypeList') ||
    args.selected.has('imageIntroAnimationList') ||
    args.selected.has('imageOutroAnimationList') ||
    args.selected.has('imageLoopAnimationList') ||
    args.selected.has('draftCreate') ||
    args.selected.has('draftUpdateMeta') ||
    args.selected.has('draftInspect') ||
    args.selected.has('draftDownload') ||
    args.selected.has('subtitleTemplate') ||
    args.selected.has('kouboTemplate')
  const hasImplicitWebUrlOpenIntent =
    hasUrlLikeText(args.prompt) && !hasCutSpecificIntent && !hasWorkspaceDownloadIntent && !hasWebDownloadIntent
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
  if (hasWorkspaceDownloadIntent) {
    addDomainSubdomain('workspace', 'download', 'prompt:workspace-download')
    addDomainSubdomain('workspace', 'read', 'prompt:workspace-download-implies-read')
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
  if (hasWebDownloadIntent) {
    addDomainSubdomain('web', 'download', 'prompt:web-download')
  }
  if (args.selected.has('browser') || hasAnyKeyword(text, WEB_BROWSER_KEYWORDS) || hasImplicitWebUrlOpenIntent || hasWebOpenIntent) {
    addDomainSubdomain('web', 'browser', 'prompt:web-browser')
  }
  if (hasWebOpenIntent && !hasWebDownloadIntent && !hasWorkspaceDownloadIntent) preferredMcpTools.add('mcp__browser__open')
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
    const skillSubdomain =
      args.matchedWorkspaceSkill && args.matchedWorkspaceSkillTriggerMode === 'explicit'
        ? 'invoke_skill'
        : hasSkillCreationIntent(text)
          ? 'create_skill'
          : hasSkillRegisterIntent(text)
            ? 'register_skill'
            : hasSkillSearchIntent(text)
              ? 'search_skill'
              : args.matchedWorkspaceSkill && !hasSkillManagementIntent(text)
                ? 'invoke_skill'
                : 'list_skill'
    addDomainSubdomain('skills', skillSubdomain, 'capability:skills')
  }

  if (args.selected.has('agentMemory')) addDomainSubdomain('auxiliary', 'memory', 'capability:memory')
  if (args.selected.has('assistant')) addDomainSubdomain('auxiliary', 'assistant', 'capability:assistant')
  if (args.selected.has('claw')) addDomainSubdomain('auxiliary', 'automation', 'capability:automation')
  if (args.selected.has('system')) addDomainSubdomain('auxiliary', 'system', 'capability:system')

  if (args.selected.has('copylab')) addDomainSubdomain('scrapt', 'derive_prompt', 'capability:copylab')

  if (args.selected.has('uploadFile')) preferredMcpTools.add('mcp__file-upload__upload_file_to_oss')
  if (args.selected.has('workspaceDownload') || args.selected.has('webDownload') || args.selected.has('mediaDownload')) {
    preferredMcpTools.add('mcp__filesystem-server__download')
  }
  if (args.selected.has('seedAudio')) preferredMcpTools.add('mcp__seed-audio__generate_seed_audio')
  if (args.selected.has('audioExtract')) preferredMcpTools.add('mcp__ffmpeg-media__extract_audio_from_video')
  if (args.selected.has('audioConcat')) preferredMcpTools.add('mcp__ffmpeg-media__concatenate_audio_files')
  if (args.selected.has('frameCapture')) preferredMcpTools.add('mcp__ffmpeg-media__capture_frame_at_timestamp')
  if (args.selected.has('mediaDuration')) preferredMcpTools.add('mcp__ffmpeg-media__get_media_duration')
  if (args.selected.has('mediaTrim')) preferredMcpTools.add('mcp__ffmpeg-media__trim_media_segment')
  if (args.selected.has('videoConcat')) preferredMcpTools.add('mcp__ffmpeg-media__concatenate_video_files')
  if (args.selected.has('textAdd')) preferredMcpTools.add('mcp__draft-elements__add_text')
  if (args.selected.has('textAddBatch')) preferredMcpTools.add('mcp__draft-elements__add_batch_text')
  if (args.selected.has('textDelete')) preferredMcpTools.add('mcp__draft-elements__remove_text')
  if (args.selected.has('textUpdate')) preferredMcpTools.add('mcp__draft-elements__modify_text')
  if (args.selected.has('subtitleRecognition')) preferredMcpTools.add('mcp__subtitle-recognition__submit_subtitle_recognition_task')
  if (args.selected.has('subtitleSrt')) preferredMcpTools.add('mcp__draft-elements__add_subtitle')
  if (args.selected.has('textIntroAnimationList')) preferredMcpTools.add('mcp__draft-elements__get_text_intro_types')
  if (args.selected.has('textOutroAnimationList')) preferredMcpTools.add('mcp__draft-elements__get_text_outro_types')
  if (args.selected.has('textLoopAnimationList')) preferredMcpTools.add('mcp__draft-elements__get_text_loop_anim_types')
  if (args.selected.has('fontList')) preferredMcpTools.add('mcp__draft-elements__get_font_types')
  if (args.selected.has('imageAdd')) preferredMcpTools.add('mcp__draft-elements__add_image')
  if (args.selected.has('imageAddBatch')) preferredMcpTools.add('mcp__draft-elements__add_batch_image')
  if (args.selected.has('imageUpdate')) preferredMcpTools.add('mcp__draft-elements__modify_image')
  if (args.selected.has('imageDelete')) preferredMcpTools.add('mcp__draft-elements__remove_image')
  if (args.selected.has('videoAdd')) preferredMcpTools.add('mcp__draft-elements__add_video')
  if (args.selected.has('videoAddBatch')) preferredMcpTools.add('mcp__draft-elements__add_batch_video')
  if (args.selected.has('videoUpdate')) preferredMcpTools.add('mcp__draft-elements__modify_video')
  if (args.selected.has('videoDelete')) preferredMcpTools.add('mcp__draft-elements__remove_video')
  if (args.selected.has('transitionTypeList')) preferredMcpTools.add('mcp__draft-elements__get_transition_types')
  if (args.selected.has('audioAdd')) preferredMcpTools.add('mcp__draft-elements__add_audio')
  if (args.selected.has('audioAddBatch')) preferredMcpTools.add('mcp__draft-elements__add_batch_audio')
  if (args.selected.has('audioUpdate')) preferredMcpTools.add('mcp__draft-elements__modify_audio')
  if (args.selected.has('audioDelete')) preferredMcpTools.add('mcp__draft-elements__remove_audio')
  if (args.selected.has('audioEffectTypeList')) preferredMcpTools.add('mcp__draft-elements__get_audio_effect_types')
  if (args.selected.has('keyframeAdd')) preferredMcpTools.add('mcp__draft-elements__add_video_keyframe')
  if (args.selected.has('effectAdd')) preferredMcpTools.add('mcp__draft-elements__add_effect')
  if (args.selected.has('effectUpdate')) preferredMcpTools.add('mcp__draft-elements__modify_effect')
  if (args.selected.has('effectDelete')) preferredMcpTools.add('mcp__draft-elements__remove_effect')
  if (args.selected.has('characterEffectTypeList')) preferredMcpTools.add('mcp__draft-elements__get_video_character_effect_types')
  if (args.selected.has('sceneEffectTypeList')) preferredMcpTools.add('mcp__draft-elements__get_video_scene_effect_types')
  if (args.selected.has('filterAdd')) preferredMcpTools.add('mcp__draft-elements__add_filter')
  if (args.selected.has('filterUpdate')) preferredMcpTools.add('mcp__draft-elements__modify_filter')
  if (args.selected.has('filterDelete')) preferredMcpTools.add('mcp__draft-elements__remove_filter')
  if (args.selected.has('filterTypeList')) preferredMcpTools.add('mcp__draft-elements__get_filter_types')
  if (args.selected.has('imageIntroAnimationList')) preferredMcpTools.add('mcp__draft-elements__get_intro_animation_types')
  if (args.selected.has('imageOutroAnimationList')) preferredMcpTools.add('mcp__draft-elements__get_outro_animation_types')
  if (args.selected.has('imageLoopAnimationList')) preferredMcpTools.add('mcp__draft-elements__get_combo_animation_types')
  if (args.selected.has('draftCreate')) preferredMcpTools.add('mcp__draft-management__create_draft')
  if (args.selected.has('draftUpdateMeta')) preferredMcpTools.add('mcp__draft-management__modify_draft')
  if (args.selected.has('draftInspect')) preferredMcpTools.add('mcp__draft-management__query_script')
  if (args.selected.has('draftDownload')) preferredMcpTools.add('mcp__draft-download__download_draft')
  if (args.selected.has('subtitleTemplate')) preferredMcpTools.add('mcp__subtitle-template__generate_smart_subtitle')
  if (args.selected.has('kouboTemplate')) preferredMcpTools.add('mcp__koubo-template__submit_koubo_template_task')

  if (args.selected.has('audioExtract')) addDomainSubdomain('cut', 'audio_extract', 'capability:audio-extract')
  if (args.selected.has('audioConcat')) addDomainSubdomain('cut', 'audio_concat', 'capability:audio-concat')
  if (args.selected.has('mediaDownload')) addDomainSubdomain('cut', 'media_download', 'capability:media-download')
  if (args.selected.has('frameCapture')) addDomainSubdomain('cut', 'frame_capture', 'capability:frame-capture')
  if (args.selected.has('mediaDuration')) addDomainSubdomain('cut', 'media_duration', 'capability:media-duration')
  if (args.selected.has('mediaTrim')) addDomainSubdomain('cut', 'media_trim', 'capability:media-trim')
  if (args.selected.has('videoConcat')) addDomainSubdomain('cut', 'video_concat', 'capability:video-concat')
  if (args.selected.has('textAdd')) addDomainSubdomain('cut', 'text_add', 'capability:text-add')
  if (args.selected.has('textAddBatch')) addDomainSubdomain('cut', 'text_add_batch', 'capability:text-add-batch')
  if (args.selected.has('textDelete')) addDomainSubdomain('cut', 'text_delete', 'capability:text-delete')
  if (args.selected.has('textUpdate')) addDomainSubdomain('cut', 'text_update', 'capability:text-update')
  if (args.selected.has('subtitleRecognition')) {
    addDomainSubdomain('cut', 'subtitle_recognition', 'capability:subtitle-recognition')
  }
  if (args.selected.has('subtitleSrt')) addDomainSubdomain('cut', 'subtitle_srt', 'capability:subtitle-srt')
  if (args.selected.has('textIntroAnimationList')) {
    addDomainSubdomain('cut', 'text_intro_animation_list', 'capability:text-intro-animation-list')
  }
  if (args.selected.has('textOutroAnimationList')) {
    addDomainSubdomain('cut', 'text_outro_animation_list', 'capability:text-outro-animation-list')
  }
  if (args.selected.has('textLoopAnimationList')) {
    addDomainSubdomain('cut', 'text_loop_animation_list', 'capability:text-loop-animation-list')
  }
  if (args.selected.has('fontList')) addDomainSubdomain('cut', 'font_list', 'capability:font-list')
  if (args.selected.has('imageAdd')) addDomainSubdomain('cut', 'image_add', 'capability:image-add')
  if (args.selected.has('imageAddBatch')) addDomainSubdomain('cut', 'image_add_batch', 'capability:image-add-batch')
  if (args.selected.has('imageUpdate')) addDomainSubdomain('cut', 'image_update', 'capability:image-update')
  if (args.selected.has('imageDelete')) addDomainSubdomain('cut', 'image_delete', 'capability:image-delete')
  if (args.selected.has('videoAdd')) addDomainSubdomain('cut', 'video_add', 'capability:video-add')
  if (args.selected.has('videoAddBatch')) addDomainSubdomain('cut', 'video_add_batch', 'capability:video-add-batch')
  if (args.selected.has('videoUpdate')) addDomainSubdomain('cut', 'video_update', 'capability:video-update')
  if (args.selected.has('videoDelete')) addDomainSubdomain('cut', 'video_delete', 'capability:video-delete')
  if (args.selected.has('transitionTypeList')) addDomainSubdomain('cut', 'transition_type_list', 'capability:transition-type-list')
  if (args.selected.has('audioAdd')) addDomainSubdomain('cut', 'audio_add', 'capability:audio-add')
  if (args.selected.has('audioAddBatch')) addDomainSubdomain('cut', 'audio_add_batch', 'capability:audio-add-batch')
  if (args.selected.has('audioUpdate')) addDomainSubdomain('cut', 'audio_update', 'capability:audio-update')
  if (args.selected.has('audioDelete')) addDomainSubdomain('cut', 'audio_delete', 'capability:audio-delete')
  if (args.selected.has('audioEffectTypeList')) {
    addDomainSubdomain('cut', 'audio_effect_type_list', 'capability:audio-effect-type-list')
  }
  if (args.selected.has('keyframeAdd')) addDomainSubdomain('cut', 'keyframe_add', 'capability:keyframe-add')
  if (args.selected.has('effectAdd')) addDomainSubdomain('cut', 'effect_add', 'capability:effect-add')
  if (args.selected.has('effectUpdate')) addDomainSubdomain('cut', 'effect_update', 'capability:effect-update')
  if (args.selected.has('effectDelete')) addDomainSubdomain('cut', 'effect_delete', 'capability:effect-delete')
  if (args.selected.has('characterEffectTypeList')) {
    addDomainSubdomain('cut', 'character_effect_type_list', 'capability:character-effect-type-list')
  }
  if (args.selected.has('sceneEffectTypeList')) {
    addDomainSubdomain('cut', 'scene_effect_type_list', 'capability:scene-effect-type-list')
  }
  if (args.selected.has('filterAdd')) addDomainSubdomain('cut', 'filter_add', 'capability:filter-add')
  if (args.selected.has('filterUpdate')) addDomainSubdomain('cut', 'filter_update', 'capability:filter-update')
  if (args.selected.has('filterDelete')) addDomainSubdomain('cut', 'filter_delete', 'capability:filter-delete')
  if (args.selected.has('filterTypeList')) addDomainSubdomain('cut', 'filter_type_list', 'capability:filter-type-list')
  if (args.selected.has('imageIntroAnimationList')) {
    addDomainSubdomain('cut', 'image_intro_animation_list', 'capability:image-intro-animation-list')
  }
  if (args.selected.has('imageOutroAnimationList')) {
    addDomainSubdomain('cut', 'image_outro_animation_list', 'capability:image-outro-animation-list')
  }
  if (args.selected.has('imageLoopAnimationList')) {
    addDomainSubdomain('cut', 'image_loop_animation_list', 'capability:image-loop-animation-list')
  }
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
    chat: getSubdomains('chat').length > 0 ? 1 + getSubdomains('chat').length : 0,
    workspace: workspaceScore,
    web: webScore,
    ai_media: aiMediaSubdomains.length > 0 ? 6 + aiMediaSubdomains.length : 0,
    skills: skillsSubdomains.length > 0 ? 5 + skillsSubdomains.length : 0,
    auxiliary: auxiliarySubdomains.length > 0 ? 2 + auxiliarySubdomains.length : 0,
    scrapt: scraptSubdomains.length > 0 ? 6 + scraptSubdomains.length : 0,
    cut: cutSubdomains.length > 0 ? 7 + cutSubdomains.length : 0
  }

  let primaryDomain: IntentDomain = 'chat'
  if (skillsSubdomains.length > 0) primaryDomain = 'skills'
  else if (cutSubdomains.length > 0) primaryDomain = 'cut'
  else if (aiMediaSubdomains.length > 0) primaryDomain = 'ai_media'
  else if (scraptSubdomains.length > 0) primaryDomain = 'scrapt'
  else if (workspaceScore > 0 || webScore > 0) primaryDomain = workspaceScore >= webScore ? 'workspace' : 'web'
  else if (auxiliarySubdomains.length > 0) primaryDomain = 'auxiliary'

  const allDomains: IntentDomain[] = ['chat', 'workspace', 'web', 'ai_media', 'skills', 'auxiliary', 'scrapt', 'cut']
  const companionDomains = allDomains.filter((domain) => {
    if (domain === 'chat' || domain === primaryDomain) return false
    return getSubdomains(domain).length > 0
  })
  const activeDomains = allDomains
    .filter((domain) => getSubdomains(domain).length > 0)
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
