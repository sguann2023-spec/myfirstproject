import type { McpHttpServerConfig, Options } from '@anthropic-ai/claude-agent-sdk'
import { loggerService } from '@logger'
import AssistantServer from '@main/mcpServers/assistant'
import type BrowserServer from '@main/mcpServers/browser/server'
import ClawServer from '@main/mcpServers/claw'
import CutWorkflowServer from '@main/mcpServers/cut-workflow'
import DigitalHumanServer from '@main/mcpServers/digital-human'
import DraftDownloadServer from '@main/mcpServers/draft-download'
import DraftElementsServer from '@main/mcpServers/draft-elements'
import DraftManagementServer from '@main/mcpServers/draft-management'
import FfmpegMediaServer from '@main/mcpServers/ffmpeg-media'
import FileSystemServer from '@main/mcpServers/filesystem'
import FileUploadServer from '@main/mcpServers/file-upload'
import type ImageGenerateServer from '@main/mcpServers/image-generate'
import ImageUnderstandServer from '@main/mcpServers/image-understand'
import KouboTemplateServer from '@main/mcpServers/koubo-template'
import MaterialsServer from '@main/mcpServers/materials'
import SeedAudioServer from '@main/mcpServers/seed-audio'
import SocialCopywritingServer from '@main/mcpServers/social-copywriting'
import SkillsServer from '@main/mcpServers/skills'
import SpeechGenerateServer from '@main/mcpServers/speech-generate'
import SubtitleRecognitionServer from '@main/mcpServers/subtitle-recognition'
import SubtitleTemplateServer from '@main/mcpServers/subtitle-template'
import SystemServer from '@main/mcpServers/system'
import type VideoGenerateServer from '@main/mcpServers/video-generate'
import VideoUnderstandServer from '@main/mcpServers/video-understand'
import VoiceConversionServer from '@main/mcpServers/voice-conversion'
import WorkspaceMemoryServer from '@main/mcpServers/workspaceMemory'
import ZhipuSearchServer from '@main/mcpServers/zhipu-search'
import { buildVectcutMcpPattern, buildVectcutMcpToolName } from '@shared/mcp'

import type { GetAgentSessionResponse } from '../..'
import type { CapabilityDecision, RuntimeCapability } from '../capability-router'
import { addAutoAllowedTool, type ToolSurface } from '../tool-surface'

const logger = loggerService.withContext('ClaudeCodeToolRegistry')

type RuntimeMcpServerConfig = NonNullable<Options['mcpServers']>[string] & {
  longRunning?: boolean
  timeout?: number
}

export type RuntimeMcpRegistryResult = {
  mountedRuntimeMcpServers: string[]
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
  videoGenerateServer: VideoGenerateServer
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
    videoGenerateServer,
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
  const hasActiveDomain = (domain: CapabilityDecision['activeDomains'][number]['domain']) =>
    capabilityDecision.activeDomains.some((entry) => entry.domain === domain)
  const hasChatTurn =
    capabilityDecision.primaryDomain === 'chat' || capabilityDecision.activeDomains.some((entry) => entry.domain === 'chat')
  const hasWorkspaceDomain = hasActiveDomain('workspace')
  const hasMaterialsDomain = hasActiveDomain('materials')
  const hasWebDomain = hasActiveDomain('web')
  const hasAiMediaDomain = hasActiveDomain('ai_media')
  const hasCutDomain = hasActiveDomain('cut')
  const hasSkillsDomain = hasActiveDomain('skills')
  const hasAuxiliaryDomain = hasActiveDomain('auxiliary')
  const hasScraptDomain = hasActiveDomain('scrapt')
  const shouldMountCapability = (capability: RuntimeCapability) => capabilityDecision.selected.has(capability)
  const mountMcpServer = (key: string, config: RuntimeMcpServerConfig) => {
    options.mcpServers![key] = config
    mountedRuntimeMcpServers.push(key)
  }
  const vt = (serverName: string, toolName: string) => buildVectcutMcpToolName(serverName, toolName)
  const vp = (serverName: string) => buildVectcutMcpPattern(serverName)
  const allowMcpPattern = (pattern: string) => {
    addAutoAllowedTool(toolSurface, pattern)
    options.allowedTools = toolSurface.allowedToolsOption
  }
  const allowMcpTools = (toolNames: string[]) => {
    for (const toolName of toolNames) {
      autoAllowTools.add(toolName)
      addAutoAllowedTool(toolSurface, toolName)
    }
    options.allowedTools = toolSurface.allowedToolsOption
  }

  if (hasWorkspaceDomain || hasWebDomain || hasCutDomain) {
    const fileSystemServer = new FileSystemServer(cwd)
    mountMcpServer('filesystem', { type: 'sdk', name: 'filesystem-server', instance: fileSystemServer.mcpServer })
    allowMcpTools([
      vt('filesystem-server', 'glob'),
      vt('filesystem-server', 'ls'),
      vt('filesystem-server', 'grep'),
      vt('filesystem-server', 'download'),
      vt('filesystem-server', 'edit'),
      vt('filesystem-server', 'write'),
      vt('filesystem-server', 'delete')
    ])
  }

  if (hasMaterialsDomain) {
    const materialsServer = new MaterialsServer(cwd)
    mountMcpServer('materials', { type: 'sdk', name: 'materials', instance: materialsServer.mcpServer })
    autoAllowTools.add(vt('materials', 'folder_links'))
    allowMcpPattern(vp('materials'))
  }

  if (hasWebDomain) {
    const browserServer = await getOrCreateBrowserServer(session.id)
    mountMcpServer('browser', { type: 'sdk', name: '@cherry/browser', instance: browserServer.mcpServer })
    for (const toolName of [
      vt('browser', 'open'),
      vt('browser', 'click'),
      vt('browser', 'type'),
      vt('browser', 'press'),
      vt('browser', 'scroll'),
      vt('browser', 'focus'),
      vt('browser', 'hover'),
      vt('browser', 'wait_for'),
      vt('browser', 'inspect'),
      vt('browser', 'execute'),
      vt('browser', 'reload'),
      vt('browser', 'screenshot'),
      vt('browser', 'snapshot'),
      vt('browser', 'list_tabs'),
      vt('browser', 'switch_tab'),
      vt('browser', 'close_tab'),
      vt('browser', 'reset')
    ]) {
      autoAllowTools.add(toolName)
    }
    allowMcpPattern(vp('browser'))
  }

  if (hasWebDomain) {
    const zhipuSearchServer = new ZhipuSearchServer()
    mountMcpServer('search', { type: 'sdk', name: 'search', instance: zhipuSearchServer.mcpServer })
    autoAllowTools.add(vt('search', 'web_search'))
    allowMcpPattern(vp('search'))
  }

  if (hasWorkspaceDomain) {
    const fileUploadServer = new FileUploadServer()
    mountMcpServer('file-upload', { type: 'sdk', name: 'file-upload', instance: fileUploadServer.mcpServer })
    autoAllowTools.add(vt('file-upload', 'upload_file_to_oss'))
    allowMcpPattern(vp('file-upload'))
  }

  if (hasChatTurn || shouldMountCapability('imageUnderstand')) {
    const imageUnderstandServer = new ImageUnderstandServer(cwd)
    mountMcpServer('image-understand', {
      type: 'sdk',
      name: 'image-understand',
      instance: imageUnderstandServer.mcpServer
    })
    autoAllowTools.add(vt('image-understand', 'inspect_image'))
    allowMcpPattern(vp('image-understand'))
  }

  if (hasAiMediaDomain) {
    mountMcpServer('image', {
      type: 'sdk',
      name: 'image',
      instance: imageGenerateServer.createMcpServer(),
      longRunning: true,
      timeout: 10 * 60
    })
    autoAllowTools.add(vt('image', 'generate_or_edit_image'))
    autoAllowTools.add(vt('image', 'generate_image'))
    allowMcpPattern(vp('image'))
  }

  if (hasAiMediaDomain) {
    mountMcpServer('video', {
      type: 'sdk',
      name: 'video',
      instance: videoGenerateServer.createMcpServer(),
      longRunning: true,
      timeout: 35 * 60
    })
    autoAllowTools.add(vt('video', 'generate_video'))
    autoAllowTools.add(vt('video', 'get_video_capabilities'))
    allowMcpPattern(vp('video'))
  }

  if (hasAiMediaDomain) {
    const speechGenerateServer = new SpeechGenerateServer()
    mountMcpServer('speech', { type: 'sdk', name: 'speech', instance: speechGenerateServer.mcpServer })
    autoAllowTools.add(vt('speech', 'generate_speech'))
    allowMcpPattern(vp('speech'))
  }

  if (hasAiMediaDomain) {
    const voiceConversionServer = new VoiceConversionServer()
    mountMcpServer('voice-conversion', {
      type: 'sdk',
      name: 'voice-conversion',
      instance: voiceConversionServer.mcpServer
    })
    autoAllowTools.add(vt('voice-conversion', 'submit_voice_conversion_task'))
    autoAllowTools.add(vt('voice-conversion', 'get_voice_conversion_task_status'))
    allowMcpPattern(vp('voice-conversion'))
  }

  if (hasAiMediaDomain) {
    const seedAudioServer = new SeedAudioServer()
    mountMcpServer('seed-audio', { type: 'sdk', name: 'seed-audio', instance: seedAudioServer.mcpServer })
    autoAllowTools.add(vt('seed-audio', 'generate_seed_audio'))
    allowMcpPattern(vp('seed-audio'))
  }

  if (hasCutDomain) {
    const ffmpegMediaServer = new FfmpegMediaServer()
    mountMcpServer('ffmpeg-media', {
      type: 'sdk',
      name: 'ffmpeg-media',
      instance: ffmpegMediaServer.mcpServer
    })
    if (shouldMountCapability('audioExtract')) autoAllowTools.add(vt('ffmpeg-media', 'extract_audio_from_video'))
    if (shouldMountCapability('audioConcat')) autoAllowTools.add(vt('ffmpeg-media', 'concatenate_audio_files'))
    if (shouldMountCapability('frameCapture')) autoAllowTools.add(vt('ffmpeg-media', 'capture_frame_at_timestamp'))
    if (shouldMountCapability('mediaDuration')) autoAllowTools.add(vt('ffmpeg-media', 'get_media_duration'))
    if (shouldMountCapability('mediaTrim')) autoAllowTools.add(vt('ffmpeg-media', 'trim_media_segment'))
    if (shouldMountCapability('videoConcat')) autoAllowTools.add(vt('ffmpeg-media', 'concatenate_video_files'))
    allowMcpPattern(vp('ffmpeg-media'))
  }

  if (hasCutDomain) {
    const draftManagementServer = new DraftManagementServer(cwd)
    mountMcpServer('draft-management', {
      type: 'sdk',
      name: 'draft-management',
      instance: draftManagementServer.mcpServer
    })
    if (shouldMountCapability('draftCreate')) autoAllowTools.add(vt('draft-management', 'create_draft'))
    if (shouldMountCapability('draftUpdateMeta')) autoAllowTools.add(vt('draft-management', 'modify_draft'))
    if (shouldMountCapability('draftInspect')) autoAllowTools.add(vt('draft-management', 'query_script'))
    allowMcpPattern(vp('draft-management'))
  }

  if (hasCutDomain) {
    const draftDownloadServer = new DraftDownloadServer()
    mountMcpServer('draft-download', {
      type: 'sdk',
      name: 'draft-download',
      instance: draftDownloadServer.mcpServer
    })
    if (shouldMountCapability('draftDownload')) autoAllowTools.add(vt('draft-download', 'download_draft'))
    if (shouldMountCapability('draftExport')) autoAllowTools.add(vt('draft-download', 'export_draft'))
    allowMcpPattern(vp('draft-download'))
  }

  if (hasCutDomain) {
    const draftElementsServer = new DraftElementsServer()
    mountMcpServer('draft-elements', {
      type: 'sdk',
      name: 'draft-elements',
      instance: draftElementsServer.mcpServer
    })
    if (shouldMountCapability('textAdd')) autoAllowTools.add(vt('draft-elements', 'add_text'))
    if (shouldMountCapability('textAddBatch')) autoAllowTools.add(vt('draft-elements', 'add_batch_text'))
    if (shouldMountCapability('textDelete')) autoAllowTools.add(vt('draft-elements', 'remove_text'))
    if (shouldMountCapability('textUpdate')) autoAllowTools.add(vt('draft-elements', 'modify_text'))
    if (shouldMountCapability('subtitleSrt')) autoAllowTools.add(vt('draft-elements', 'add_subtitle'))
    if (shouldMountCapability('textIntroAnimationList')) autoAllowTools.add(vt('draft-elements', 'get_text_intro_types'))
    if (shouldMountCapability('textOutroAnimationList')) autoAllowTools.add(vt('draft-elements', 'get_text_outro_types'))
    if (shouldMountCapability('textLoopAnimationList')) autoAllowTools.add(vt('draft-elements', 'get_text_loop_anim_types'))
    if (shouldMountCapability('fontList')) autoAllowTools.add(vt('draft-elements', 'get_font_types'))
    if (shouldMountCapability('imageAdd')) autoAllowTools.add(vt('draft-elements', 'add_image'))
    if (shouldMountCapability('imageAddBatch')) autoAllowTools.add(vt('draft-elements', 'add_batch_image'))
    if (shouldMountCapability('presetAdd')) autoAllowTools.add(vt('draft-elements', 'add_preset'))
    if (shouldMountCapability('presetAddBatch')) autoAllowTools.add(vt('draft-elements', 'add_batch_preset'))
    if (shouldMountCapability('imageUpdate')) autoAllowTools.add(vt('draft-elements', 'modify_image'))
    if (shouldMountCapability('imageDelete')) autoAllowTools.add(vt('draft-elements', 'remove_image'))
    if (shouldMountCapability('videoAdd')) autoAllowTools.add(vt('draft-elements', 'add_video'))
    if (shouldMountCapability('videoAddBatch')) autoAllowTools.add(vt('draft-elements', 'add_batch_video'))
    if (shouldMountCapability('videoUpdate')) autoAllowTools.add(vt('draft-elements', 'modify_video'))
    if (shouldMountCapability('videoDelete')) autoAllowTools.add(vt('draft-elements', 'remove_video'))
    if (shouldMountCapability('transitionTypeList')) autoAllowTools.add(vt('draft-elements', 'get_transition_types'))
    if (shouldMountCapability('audioAdd')) autoAllowTools.add(vt('draft-elements', 'add_audio'))
    if (shouldMountCapability('audioAddBatch')) autoAllowTools.add(vt('draft-elements', 'add_batch_audio'))
    if (shouldMountCapability('audioUpdate')) autoAllowTools.add(vt('draft-elements', 'modify_audio'))
    if (shouldMountCapability('audioDelete')) autoAllowTools.add(vt('draft-elements', 'remove_audio'))
    if (shouldMountCapability('audioEffectTypeList')) autoAllowTools.add(vt('draft-elements', 'get_audio_effect_types'))
    if (shouldMountCapability('keyframeAdd')) autoAllowTools.add(vt('draft-elements', 'add_video_keyframe'))
    if (shouldMountCapability('effectAdd')) autoAllowTools.add(vt('draft-elements', 'add_effect'))
    if (shouldMountCapability('effectUpdate')) autoAllowTools.add(vt('draft-elements', 'modify_effect'))
    if (shouldMountCapability('effectDelete')) autoAllowTools.add(vt('draft-elements', 'remove_effect'))
    if (shouldMountCapability('characterEffectTypeList')) {
      autoAllowTools.add(vt('draft-elements', 'get_video_character_effect_types'))
    }
    if (shouldMountCapability('sceneEffectTypeList')) {
      autoAllowTools.add(vt('draft-elements', 'get_video_scene_effect_types'))
    }
    if (shouldMountCapability('filterAdd')) autoAllowTools.add(vt('draft-elements', 'add_filter'))
    if (shouldMountCapability('filterUpdate')) autoAllowTools.add(vt('draft-elements', 'modify_filter'))
    if (shouldMountCapability('filterDelete')) autoAllowTools.add(vt('draft-elements', 'remove_filter'))
    if (shouldMountCapability('filterTypeList')) autoAllowTools.add(vt('draft-elements', 'get_filter_types'))
    if (shouldMountCapability('imageIntroAnimationList')) {
      autoAllowTools.add(vt('draft-elements', 'get_intro_animation_types'))
    }
    if (shouldMountCapability('imageOutroAnimationList')) {
      autoAllowTools.add(vt('draft-elements', 'get_outro_animation_types'))
    }
    if (shouldMountCapability('imageLoopAnimationList')) {
      autoAllowTools.add(vt('draft-elements', 'get_combo_animation_types'))
    }
    allowMcpPattern(vp('draft-elements'))
  }

  if (hasCutDomain) {
    const subtitleRecognitionServer = new SubtitleRecognitionServer(cwd)
    mountMcpServer('subtitle-recognition', {
      type: 'sdk',
      name: 'subtitle-recognition',
      instance: subtitleRecognitionServer.mcpServer,
      longRunning: true,
      timeout: 35 * 60
    })
    autoAllowTools.add(vt('subtitle-recognition', 'submit_subtitle_recognition_task'))
    allowMcpPattern(vp('subtitle-recognition'))
  }

  if (hasCutDomain) {
    const videoUnderstandServer = new VideoUnderstandServer(cwd)
    mountMcpServer('video-understand', {
      type: 'sdk',
      name: 'video-understand',
      instance: videoUnderstandServer.mcpServer,
      longRunning: true,
      timeout: 35 * 60
    })
    autoAllowTools.add(vt('video-understand', 'submit_video_detail_task'))
    allowMcpPattern(vp('video-understand'))
  }

  if (hasCutDomain) {
    const subtitleTemplateServer = new SubtitleTemplateServer()
    mountMcpServer('subtitle-template', {
      type: 'sdk',
      name: 'subtitle-template',
      instance: subtitleTemplateServer.mcpServer,
      longRunning: true,
      timeout: 35 * 60
    })
    autoAllowTools.add(vt('subtitle-template', 'generate_smart_subtitle'))
    allowMcpPattern(vp('subtitle-template'))
  }

  if (hasCutDomain) {
    const cutWorkflowServer = new CutWorkflowServer(cwd)
    mountMcpServer('cut-workflow', {
      type: 'sdk',
      name: 'cut-workflow',
      instance: cutWorkflowServer.mcpServer,
      longRunning: true,
      timeout: 35 * 60
    })
    autoAllowTools.add(vt('cut-workflow', 'execute_workflow'))
    allowMcpPattern(vp('cut-workflow'))
  }

  if (hasScraptDomain) {
    const socialCopywritingServer = new SocialCopywritingServer()
    mountMcpServer('copylab', {
      type: 'sdk',
      name: 'copylab',
      instance: socialCopywritingServer.mcpServer,
      longRunning: true,
      timeout: 10 * 60
    })
    autoAllowTools.add(vt('copylab', 'derive_copy_prompt'))
    allowMcpPattern(vp('copylab'))
  }

  if (hasAiMediaDomain) {
    const digitalHumanServer = new DigitalHumanServer()
    mountMcpServer('digital-human', {
      type: 'sdk',
      name: 'digital-human',
      instance: digitalHumanServer.mcpServer,
      longRunning: true,
      timeout: 35 * 60
    })
    autoAllowTools.add(vt('digital-human', 'create_lip_sync_digital_human'))
    autoAllowTools.add(vt('digital-human', 'create_image_driven_digital_human'))
    autoAllowTools.add(vt('digital-human', 'create_omni_image_driven_digital_human'))
    autoAllowTools.add(vt('digital-human', 'create_seedance_digital_human'))
    allowMcpPattern(vp('digital-human'))
  }

  if (hasCutDomain) {
    const kouboTemplateServer = new KouboTemplateServer()
    mountMcpServer('koubo-template', {
      type: 'sdk',
      name: 'koubo-template',
      instance: kouboTemplateServer.mcpServer,
      longRunning: true,
      timeout: 20 * 60
    })
    autoAllowTools.add(vt('koubo-template', 'submit_koubo_template_task'))
    allowMcpPattern(vp('koubo-template'))
  }

  if (hasAuxiliaryDomain) {
    const systemServer = new SystemServer()
    mountMcpServer('system', { type: 'sdk', name: 'system', instance: systemServer.mcpServer })
    autoAllowTools.add(vt('system', 'open_deeplink'))
    allowMcpPattern(vp('system'))
  }

  if (hasSkillsDomain) {
    const skillsServer = new SkillsServer(session.agent_id, cwd)
    mountMcpServer('skills', { type: 'sdk', name: 'skills', instance: skillsServer.mcpServer })
    autoAllowTools.add(vt('skills', 'skills'))
    allowMcpPattern(vp('skills'))
  }

  if (hasAuxiliaryDomain) {
    const workspaceMemoryServer = new WorkspaceMemoryServer(session.agent_id)
    mountMcpServer('agent-memory', {
      type: 'sdk',
      name: 'agent-memory',
      instance: workspaceMemoryServer.mcpServer
    })
    autoAllowTools.add(vt('agent-memory', 'memory'))
    allowMcpPattern(vp('agent-memory'))
  }

  if (autonomousEnabled && hasAuxiliaryDomain) {
    const sourceChannelId = await resolveSourceChannel(session.agent_id, session.id)
    const clawServer = new ClawServer(session.agent_id, sourceChannelId)
    mountMcpServer('claw', { type: 'sdk', name: 'claw', instance: clawServer.mcpServer })
    autoAllowTools.add(vt('claw', 'cron'))
    autoAllowTools.add(vt('claw', 'notify'))
    autoAllowTools.add(vt('claw', 'config'))
    allowMcpPattern(vp('claw'))

    logger.debug('Injected autonomous claw MCP server', {
      agentId: session.agent_id,
      totalMcpServers: Object.keys(options.mcpServers).length
    })
  }

  if (isAssistant && hasAuxiliaryDomain) {
    const assistantServer = new AssistantServer()
    mountMcpServer('assistant', { type: 'sdk', name: 'assistant', instance: assistantServer.mcpServer })
    autoAllowTools.add(vt('assistant', 'navigate'))
    autoAllowTools.add(vt('assistant', 'diagnose'))
    if (Array.isArray(options.allowedTools) && options.allowedTools.length > 0) {
      allowMcpPattern(vp('assistant'))
    } else {
      options.allowedTools = [vp('assistant')]
    }

    logger.debug('Cherry Assistant: injected assistant MCP server', {
      agentId: session.agent_id,
      totalMcpServers: Object.keys(options.mcpServers).length
    })
  }

  options.allowedTools = Array.from(autoAllowTools).sort()

  return {
    mountedRuntimeMcpServers
  }
}
