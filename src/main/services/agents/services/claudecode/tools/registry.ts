import type { McpHttpServerConfig, Options } from '@anthropic-ai/claude-agent-sdk'
import { loggerService } from '@logger'
import AssistantServer from '@main/mcpServers/assistant'
import type BrowserServer from '@main/mcpServers/browser/server'
import ClawServer from '@main/mcpServers/claw'
import DigitalHumanServer from '@main/mcpServers/digital-human'
import DraftDownloadServer from '@main/mcpServers/draft-download'
import DraftElementsServer from '@main/mcpServers/draft-elements'
import DraftManagementServer from '@main/mcpServers/draft-management'
import FfmpegMediaServer from '@main/mcpServers/ffmpeg-media'
import FileSystemServer from '@main/mcpServers/filesystem'
import FileUploadServer from '@main/mcpServers/file-upload'
import type ImageGenerateServer from '@main/mcpServers/image-generate'
import KouboTemplateServer from '@main/mcpServers/koubo-template'
import SeedAudioServer from '@main/mcpServers/seed-audio'
import SocialCopywritingServer from '@main/mcpServers/social-copywriting'
import SkillsServer from '@main/mcpServers/skills'
import SpeechGenerateServer from '@main/mcpServers/speech-generate'
import SubtitleRecognitionServer from '@main/mcpServers/subtitle-recognition'
import SubtitleTemplateServer from '@main/mcpServers/subtitle-template'
import SystemServer from '@main/mcpServers/system'
import VideoUnderstandServer from '@main/mcpServers/video-understand'
import VoiceConversionServer from '@main/mcpServers/voice-conversion'
import WorkspaceMemoryServer from '@main/mcpServers/workspaceMemory'
import ZhipuSearchServer from '@main/mcpServers/zhipu-search'

import type { GetAgentSessionResponse } from '../..'
import type { CapabilityDecision, RuntimeCapability } from '../capability-router'
import { addAutoAllowedTool, type ToolSurface } from '../tool-surface'

const logger = loggerService.withContext('ClaudeCodeToolRegistry')

type RuntimeMcpServerConfig = NonNullable<Options['mcpServers']>[string]

export type RuntimeMcpRegistryResult = {
  mountedRuntimeMcpServers: string[]
  skippedRuntimeMcpServers: string[]
}

export async function mountRuntimeMcpServers(input: {
  options: Options
  session: GetAgentSessionResponse
  apiConfig: {
    host: string
    port: number
    apiKey: string
  }
  cwd: string
  capabilityDecision: CapabilityDecision
  toolSurface: ToolSurface
  autoAllowTools: Set<string>
  autonomousEnabled: boolean
  isAssistant: boolean
  imageGenerateServer: ImageGenerateServer
  getOrCreateBrowserServer: (sessionId: string) => Promise<BrowserServer>
  resolveSourceChannel: (agentId: string, sessionId: string) => Promise<string | undefined>
}): Promise<RuntimeMcpRegistryResult> {
  const {
    options,
    session,
    apiConfig,
    cwd,
    capabilityDecision,
    toolSurface,
    autoAllowTools,
    autonomousEnabled,
    isAssistant,
    imageGenerateServer,
    getOrCreateBrowserServer,
    resolveSourceChannel
  } = input

  if (session.mcps && session.mcps.length > 0) {
    const mcpList: Record<string, McpHttpServerConfig> = {}
    for (const mcpId of session.mcps) {
      mcpList[mcpId] = {
        type: 'http',
        url: `http://${apiConfig.host}:${apiConfig.port}/v1/mcps/${mcpId}/mcp`,
        headers: {
          Authorization: `Bearer ${apiConfig.apiKey}`
        }
      }
    }
    options.mcpServers = mcpList
    options.strictMcpConfig = true
  }

  if (!options.mcpServers) {
    options.mcpServers = {}
  }

  const mountedRuntimeMcpServers: string[] = []
  const skippedRuntimeMcpServers: string[] = []
  const shouldMountCapability = (capability: RuntimeCapability) => capabilityDecision.selected.has(capability)
  const mountMcpServer = (key: string, config: RuntimeMcpServerConfig) => {
    options.mcpServers![key] = config
    mountedRuntimeMcpServers.push(key)
  }
  const markSkipped = (key: string) => {
    skippedRuntimeMcpServers.push(key)
  }
  const allowMcpPattern = (pattern: string) => {
    addAutoAllowedTool(toolSurface, pattern)
    options.allowedTools = toolSurface.allowedToolsOption
  }

  if (
    shouldMountCapability('workspaceDownload') ||
    shouldMountCapability('webDownload') ||
    shouldMountCapability('mediaDownload')
  ) {
    const fileSystemServer = new FileSystemServer(cwd)
    mountMcpServer('filesystem', { type: 'sdk', name: 'filesystem-server', instance: fileSystemServer.mcpServer })
    autoAllowTools.add('mcp__filesystem-server__download')
    allowMcpPattern('mcp__filesystem-server__*')
  } else {
    markSkipped('filesystem')
  }

  if (shouldMountCapability('browser')) {
    const browserServer = await getOrCreateBrowserServer(session.id)
    mountMcpServer('browser', { type: 'sdk', name: '@cherry/browser', instance: browserServer.mcpServer })
    for (const toolName of [
      'mcp__browser__open',
      'mcp__browser__click',
      'mcp__browser__type',
      'mcp__browser__press',
      'mcp__browser__scroll',
      'mcp__browser__focus',
      'mcp__browser__hover',
      'mcp__browser__wait_for',
      'mcp__browser__inspect',
      'mcp__browser__execute',
      'mcp__browser__reload',
      'mcp__browser__screenshot',
      'mcp__browser__snapshot',
      'mcp__browser__list_tabs',
      'mcp__browser__switch_tab',
      'mcp__browser__close_tab',
      'mcp__browser__reset'
    ]) {
      autoAllowTools.add(toolName)
    }
    allowMcpPattern('mcp__browser__*')
  } else {
    markSkipped('browser')
  }

  if (shouldMountCapability('search')) {
    const zhipuSearchServer = new ZhipuSearchServer()
    mountMcpServer('search', { type: 'sdk', name: 'search', instance: zhipuSearchServer.mcpServer })
    autoAllowTools.add('mcp__search__web_search')
    allowMcpPattern('mcp__search__*')
  } else {
    markSkipped('search')
  }

  if (shouldMountCapability('uploadFile')) {
    const fileUploadServer = new FileUploadServer()
    mountMcpServer('file-upload', { type: 'sdk', name: 'file-upload', instance: fileUploadServer.mcpServer })
    autoAllowTools.add('mcp__file-upload__upload_file_to_oss')
    allowMcpPattern('mcp__file-upload__*')
  } else {
    markSkipped('file-upload')
  }

  if (shouldMountCapability('image')) {
    mountMcpServer('image', { type: 'sdk', name: 'image', instance: imageGenerateServer.mcpServer })
    autoAllowTools.add('mcp__image__generate_or_edit_image')
    autoAllowTools.add('mcp__image__generate_image')
    allowMcpPattern('mcp__image__*')
  } else {
    markSkipped('image')
  }

  if (shouldMountCapability('speech')) {
    const speechGenerateServer = new SpeechGenerateServer()
    mountMcpServer('speech', { type: 'sdk', name: 'speech', instance: speechGenerateServer.mcpServer })
    autoAllowTools.add('mcp__speech__generate_speech')
    allowMcpPattern('mcp__speech__*')
  } else {
    markSkipped('speech')
  }

  if (shouldMountCapability('voiceConversion')) {
    const voiceConversionServer = new VoiceConversionServer()
    mountMcpServer('voice-conversion', {
      type: 'sdk',
      name: 'voice-conversion',
      instance: voiceConversionServer.mcpServer
    })
    autoAllowTools.add('mcp__voice-conversion__submit_voice_conversion_task')
    autoAllowTools.add('mcp__voice-conversion__get_voice_conversion_task_status')
    allowMcpPattern('mcp__voice-conversion__*')
  } else {
    markSkipped('voice-conversion')
  }

  if (shouldMountCapability('seedAudio')) {
    const seedAudioServer = new SeedAudioServer()
    mountMcpServer('seed-audio', { type: 'sdk', name: 'seed-audio', instance: seedAudioServer.mcpServer })
    autoAllowTools.add('mcp__seed-audio__generate_seed_audio')
    allowMcpPattern('mcp__seed-audio__*')
  } else {
    markSkipped('seed-audio')
  }

  if (
    shouldMountCapability('audioExtract') ||
    shouldMountCapability('audioConcat') ||
    shouldMountCapability('frameCapture') ||
    shouldMountCapability('mediaDuration') ||
    shouldMountCapability('mediaTrim') ||
    shouldMountCapability('videoConcat')
  ) {
    const ffmpegMediaServer = new FfmpegMediaServer()
    mountMcpServer('ffmpeg-media', {
      type: 'sdk',
      name: 'ffmpeg-media',
      instance: ffmpegMediaServer.mcpServer
    })
    if (shouldMountCapability('audioExtract')) autoAllowTools.add('mcp__ffmpeg-media__extract_audio_from_video')
    if (shouldMountCapability('audioConcat')) autoAllowTools.add('mcp__ffmpeg-media__concatenate_audio_files')
    if (shouldMountCapability('frameCapture')) autoAllowTools.add('mcp__ffmpeg-media__capture_frame_at_timestamp')
    if (shouldMountCapability('mediaDuration')) autoAllowTools.add('mcp__ffmpeg-media__get_media_duration')
    if (shouldMountCapability('mediaTrim')) autoAllowTools.add('mcp__ffmpeg-media__trim_media_segment')
    if (shouldMountCapability('videoConcat')) autoAllowTools.add('mcp__ffmpeg-media__concatenate_video_files')
    allowMcpPattern('mcp__ffmpeg-media__*')
  } else {
    markSkipped('ffmpeg-media')
  }

  if (
    shouldMountCapability('draftCreate') ||
    shouldMountCapability('draftUpdateMeta') ||
    shouldMountCapability('draftInspect')
  ) {
    const draftManagementServer = new DraftManagementServer()
    mountMcpServer('draft-management', {
      type: 'sdk',
      name: 'draft-management',
      instance: draftManagementServer.mcpServer
    })
    if (shouldMountCapability('draftCreate')) autoAllowTools.add('mcp__draft-management__create_draft')
    if (shouldMountCapability('draftUpdateMeta')) autoAllowTools.add('mcp__draft-management__modify_draft')
    if (shouldMountCapability('draftInspect')) autoAllowTools.add('mcp__draft-management__query_script')
  } else {
    markSkipped('draft-management')
  }

  if (shouldMountCapability('draftDownload')) {
    const draftDownloadServer = new DraftDownloadServer()
    mountMcpServer('draft-download', {
      type: 'sdk',
      name: 'draft-download',
      instance: draftDownloadServer.mcpServer
    })
    autoAllowTools.add('mcp__draft-download__download_draft')
    allowMcpPattern('mcp__draft-download__*')
  } else {
    markSkipped('draft-download')
  }

  if (
    shouldMountCapability('textAdd') ||
    shouldMountCapability('textAddBatch') ||
    shouldMountCapability('textDelete') ||
    shouldMountCapability('textUpdate') ||
    shouldMountCapability('subtitleSrt') ||
    shouldMountCapability('textIntroAnimationList') ||
    shouldMountCapability('textOutroAnimationList') ||
    shouldMountCapability('textLoopAnimationList') ||
    shouldMountCapability('fontList') ||
    shouldMountCapability('imageAdd') ||
    shouldMountCapability('imageAddBatch') ||
    shouldMountCapability('imageUpdate') ||
    shouldMountCapability('imageDelete') ||
    shouldMountCapability('videoAdd') ||
    shouldMountCapability('videoAddBatch') ||
    shouldMountCapability('videoUpdate') ||
    shouldMountCapability('videoDelete') ||
    shouldMountCapability('transitionTypeList') ||
    shouldMountCapability('audioAdd') ||
    shouldMountCapability('audioAddBatch') ||
    shouldMountCapability('audioUpdate') ||
    shouldMountCapability('audioDelete') ||
    shouldMountCapability('audioEffectTypeList') ||
    shouldMountCapability('keyframeAdd') ||
    shouldMountCapability('effectAdd') ||
    shouldMountCapability('effectUpdate') ||
    shouldMountCapability('effectDelete') ||
    shouldMountCapability('characterEffectTypeList') ||
    shouldMountCapability('sceneEffectTypeList') ||
    shouldMountCapability('filterAdd') ||
    shouldMountCapability('filterUpdate') ||
    shouldMountCapability('filterDelete') ||
    shouldMountCapability('filterTypeList') ||
    shouldMountCapability('imageIntroAnimationList') ||
    shouldMountCapability('imageOutroAnimationList') ||
    shouldMountCapability('imageLoopAnimationList')
  ) {
    const draftElementsServer = new DraftElementsServer()
    mountMcpServer('draft-elements', {
      type: 'sdk',
      name: 'draft-elements',
      instance: draftElementsServer.mcpServer
    })
    if (shouldMountCapability('textAdd')) autoAllowTools.add('mcp__draft-elements__add_text')
    if (shouldMountCapability('textAddBatch')) autoAllowTools.add('mcp__draft-elements__add_batch_text')
    if (shouldMountCapability('textDelete')) autoAllowTools.add('mcp__draft-elements__remove_text')
    if (shouldMountCapability('textUpdate')) autoAllowTools.add('mcp__draft-elements__modify_text')
    if (shouldMountCapability('subtitleSrt')) autoAllowTools.add('mcp__draft-elements__add_subtitle')
    if (shouldMountCapability('textIntroAnimationList')) autoAllowTools.add('mcp__draft-elements__get_text_intro_types')
    if (shouldMountCapability('textOutroAnimationList')) autoAllowTools.add('mcp__draft-elements__get_text_outro_types')
    if (shouldMountCapability('textLoopAnimationList')) autoAllowTools.add('mcp__draft-elements__get_text_loop_anim_types')
    if (shouldMountCapability('fontList')) autoAllowTools.add('mcp__draft-elements__get_font_types')
    if (shouldMountCapability('imageAdd')) autoAllowTools.add('mcp__draft-elements__add_image')
    if (shouldMountCapability('imageAddBatch')) autoAllowTools.add('mcp__draft-elements__add_batch_image')
    if (shouldMountCapability('imageUpdate')) autoAllowTools.add('mcp__draft-elements__modify_image')
    if (shouldMountCapability('imageDelete')) autoAllowTools.add('mcp__draft-elements__remove_image')
    if (shouldMountCapability('videoAdd')) autoAllowTools.add('mcp__draft-elements__add_video')
    if (shouldMountCapability('videoAddBatch')) autoAllowTools.add('mcp__draft-elements__add_batch_video')
    if (shouldMountCapability('videoUpdate')) autoAllowTools.add('mcp__draft-elements__modify_video')
    if (shouldMountCapability('videoDelete')) autoAllowTools.add('mcp__draft-elements__remove_video')
    if (shouldMountCapability('transitionTypeList')) autoAllowTools.add('mcp__draft-elements__get_transition_types')
    if (shouldMountCapability('audioAdd')) autoAllowTools.add('mcp__draft-elements__add_audio')
    if (shouldMountCapability('audioAddBatch')) autoAllowTools.add('mcp__draft-elements__add_batch_audio')
    if (shouldMountCapability('audioUpdate')) autoAllowTools.add('mcp__draft-elements__modify_audio')
    if (shouldMountCapability('audioDelete')) autoAllowTools.add('mcp__draft-elements__remove_audio')
    if (shouldMountCapability('audioEffectTypeList')) autoAllowTools.add('mcp__draft-elements__get_audio_effect_types')
    if (shouldMountCapability('keyframeAdd')) autoAllowTools.add('mcp__draft-elements__add_video_keyframe')
    if (shouldMountCapability('effectAdd')) autoAllowTools.add('mcp__draft-elements__add_effect')
    if (shouldMountCapability('effectUpdate')) autoAllowTools.add('mcp__draft-elements__modify_effect')
    if (shouldMountCapability('effectDelete')) autoAllowTools.add('mcp__draft-elements__remove_effect')
    if (shouldMountCapability('characterEffectTypeList')) {
      autoAllowTools.add('mcp__draft-elements__get_video_character_effect_types')
    }
    if (shouldMountCapability('sceneEffectTypeList')) {
      autoAllowTools.add('mcp__draft-elements__get_video_scene_effect_types')
    }
    if (shouldMountCapability('filterAdd')) autoAllowTools.add('mcp__draft-elements__add_filter')
    if (shouldMountCapability('filterUpdate')) autoAllowTools.add('mcp__draft-elements__modify_filter')
    if (shouldMountCapability('filterDelete')) autoAllowTools.add('mcp__draft-elements__remove_filter')
    if (shouldMountCapability('filterTypeList')) autoAllowTools.add('mcp__draft-elements__get_filter_types')
    if (shouldMountCapability('imageIntroAnimationList')) {
      autoAllowTools.add('mcp__draft-elements__get_intro_animation_types')
    }
    if (shouldMountCapability('imageOutroAnimationList')) {
      autoAllowTools.add('mcp__draft-elements__get_outro_animation_types')
    }
    if (shouldMountCapability('imageLoopAnimationList')) {
      autoAllowTools.add('mcp__draft-elements__get_combo_animation_types')
    }
    allowMcpPattern('mcp__draft-elements__*')
  } else {
    markSkipped('draft-elements')
  }

  if (shouldMountCapability('subtitleRecognition')) {
    const subtitleRecognitionServer = new SubtitleRecognitionServer(cwd)
    mountMcpServer('subtitle-recognition', {
      type: 'sdk',
      name: 'subtitle-recognition',
      instance: subtitleRecognitionServer.mcpServer
    })
    autoAllowTools.add('mcp__subtitle-recognition__submit_subtitle_recognition_task')
    autoAllowTools.add('mcp__subtitle-recognition__get_subtitle_recognition_task_status')
    allowMcpPattern('mcp__subtitle-recognition__*')
  } else {
    markSkipped('subtitle-recognition')
  }

  if (shouldMountCapability('videoUnderstand')) {
    const videoUnderstandServer = new VideoUnderstandServer(cwd)
    mountMcpServer('video-understand', {
      type: 'sdk',
      name: 'video-understand',
      instance: videoUnderstandServer.mcpServer
    })
    autoAllowTools.add('mcp__video-understand__submit_video_detail_task')
    autoAllowTools.add('mcp__video-understand__get_video_detail_task_status')
    allowMcpPattern('mcp__video-understand__*')
  } else {
    markSkipped('video-understand')
  }

  if (shouldMountCapability('subtitleTemplate')) {
    const subtitleTemplateServer = new SubtitleTemplateServer()
    mountMcpServer('subtitle-template', {
      type: 'sdk',
      name: 'subtitle-template',
      instance: subtitleTemplateServer.mcpServer
    })
    autoAllowTools.add('mcp__subtitle-template__generate_smart_subtitle')
    autoAllowTools.add('mcp__subtitle-template__get_smart_subtitle_task_status')
    allowMcpPattern('mcp__subtitle-template__*')
  } else {
    markSkipped('subtitle-template')
  }

  if (shouldMountCapability('copylab')) {
    const socialCopywritingServer = new SocialCopywritingServer()
    mountMcpServer('copylab', {
      type: 'sdk',
      name: 'copylab',
      instance: socialCopywritingServer.mcpServer
    })
    autoAllowTools.add('mcp__copylab__derive_copy_prompt')
    allowMcpPattern('mcp__copylab__*')
  } else {
    markSkipped('copylab')
  }

  if (shouldMountCapability('digitalHuman')) {
    const digitalHumanServer = new DigitalHumanServer()
    mountMcpServer('digital-human', {
      type: 'sdk',
      name: 'digital-human',
      instance: digitalHumanServer.mcpServer
    })
    autoAllowTools.add('mcp__digital-human__create_lip_sync_digital_human')
    autoAllowTools.add('mcp__digital-human__get_lip_sync_digital_human_status')
    autoAllowTools.add('mcp__digital-human__create_image_driven_digital_human')
    autoAllowTools.add('mcp__digital-human__get_image_driven_digital_human_status')
    allowMcpPattern('mcp__digital-human__*')
  } else {
    markSkipped('digital-human')
  }

  if (shouldMountCapability('kouboTemplate')) {
    const kouboTemplateServer = new KouboTemplateServer()
    mountMcpServer('koubo-template', {
      type: 'sdk',
      name: 'koubo-template',
      instance: kouboTemplateServer.mcpServer
    })
    autoAllowTools.add('mcp__koubo-template__submit_koubo_template_task')
    autoAllowTools.add('mcp__koubo-template__get_koubo_template_task_status')
    allowMcpPattern('mcp__koubo-template__*')
  } else {
    markSkipped('koubo-template')
  }

  if (shouldMountCapability('system')) {
    const systemServer = new SystemServer()
    mountMcpServer('system', { type: 'sdk', name: 'system', instance: systemServer.mcpServer })
    autoAllowTools.add('mcp__system__open_deeplink')
    allowMcpPattern('mcp__system__*')
  } else {
    markSkipped('system')
  }

  if (shouldMountCapability('skills')) {
    const skillsServer = new SkillsServer(session.agent_id, cwd)
    mountMcpServer('skills', { type: 'sdk', name: 'skills', instance: skillsServer.mcpServer })
    autoAllowTools.add('mcp__skills__skills')
    allowMcpPattern('mcp__skills__*')
  } else {
    markSkipped('skills')
  }

  if (shouldMountCapability('agentMemory')) {
    const workspaceMemoryServer = new WorkspaceMemoryServer(session.agent_id)
    mountMcpServer('agent-memory', {
      type: 'sdk',
      name: 'agent-memory',
      instance: workspaceMemoryServer.mcpServer
    })
    autoAllowTools.add('mcp__agent-memory__memory')
    allowMcpPattern('mcp__agent-memory__*')
  } else {
    markSkipped('agent-memory')
  }

  if (autonomousEnabled && shouldMountCapability('claw')) {
    const sourceChannelId = await resolveSourceChannel(session.agent_id, session.id)
    const clawServer = new ClawServer(session.agent_id, sourceChannelId)
    mountMcpServer('claw', { type: 'sdk', name: 'claw', instance: clawServer.mcpServer })
    autoAllowTools.add('mcp__claw__cron')
    autoAllowTools.add('mcp__claw__notify')
    autoAllowTools.add('mcp__claw__config')
    allowMcpPattern('mcp__claw__*')

    logger.debug('Injected autonomous claw MCP server', {
      agentId: session.agent_id,
      totalMcpServers: Object.keys(options.mcpServers).length
    })
  } else {
    markSkipped('claw')
  }

  if (isAssistant && shouldMountCapability('assistant')) {
    const assistantServer = new AssistantServer()
    mountMcpServer('assistant', { type: 'sdk', name: 'assistant', instance: assistantServer.mcpServer })
    autoAllowTools.add('mcp__assistant__navigate')
    autoAllowTools.add('mcp__assistant__diagnose')
    if (Array.isArray(options.allowedTools) && options.allowedTools.length > 0) {
      allowMcpPattern('mcp__assistant__*')
    } else {
      options.allowedTools = ['mcp__assistant__*']
    }

    logger.debug('Cherry Assistant: injected assistant MCP server', {
      agentId: session.agent_id,
      totalMcpServers: Object.keys(options.mcpServers).length
    })
  } else {
    markSkipped('assistant')
  }

  options.allowedTools = Array.from(autoAllowTools).sort()

  return {
    mountedRuntimeMcpServers,
    skippedRuntimeMcpServers
  }
}
