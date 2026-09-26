import path from 'node:path'

import { loggerService } from '@logger'
import type { AggregateServerEntry } from '@main/apiServer/utils/mcp'
import { setAggregateServerEntries } from '@main/apiServer/utils/mcp'
import { getDataPath } from '@main/utils'

const logger = loggerService.withContext('LocalAggregateMcpService')
const LOCAL_AGGREGATE_AGENT_ID = 'vectcut_claw_default'

let initializePromise: Promise<void> | null = null

function getLocalAggregateWorkspacePath(): string {
  return path.join(getDataPath(), 'local-mcp-workspace')
}

export async function initializeLocalAggregateMcpService(): Promise<void> {
  if (initializePromise) {
    return initializePromise
  }

  initializePromise = (async () => {
    const workspacePath = getLocalAggregateWorkspacePath()
    const [
      { default: AssistantServer },
      { default: BrowserServer },
      { default: CutWorkflowServer },
      { default: DigitalHumanServer },
      { default: DraftDownloadServer },
      { default: DraftElementsServer },
      { default: DraftManagementServer },
      { default: FfmpegMediaServer },
      { default: FileSystemServer },
      { default: FileUploadServer },
      { default: ImageGenerateServer },
      { default: ImageUnderstandServer },
      { default: KouboTemplateServer },
      { default: MaterialsServer },
      { default: RemoveBgServer },
      { default: SeedAudioServer },
      { default: SocialCopywritingServer },
      { default: SkillsServer },
      { default: SpeechGenerateServer },
      { default: StoryboardEditorServer },
      { default: SubtitleRecognitionServer },
      { default: SubtitleTemplateServer },
      { default: SystemServer },
      { default: VideoGenerateServer },
      { default: VideoUnderstandServer },
      { default: VoiceConversionServer },
      { default: WorkspaceMemoryServer },
      { default: ClawServer },
      { default: ZhipuSearchServer }
    ] = await Promise.all([
      import('@main/mcpServers/assistant'),
      import('@main/mcpServers/browser/server'),
      import('@main/mcpServers/cut-workflow'),
      import('@main/mcpServers/digital-human'),
      import('@main/mcpServers/draft-download'),
      import('@main/mcpServers/draft-elements'),
      import('@main/mcpServers/draft-management'),
      import('@main/mcpServers/ffmpeg-media'),
      import('@main/mcpServers/filesystem'),
      import('@main/mcpServers/file-upload'),
      import('@main/mcpServers/image-generate'),
      import('@main/mcpServers/image-understand'),
      import('@main/mcpServers/koubo-template'),
      import('@main/mcpServers/materials'),
      import('@main/mcpServers/remove-bg'),
      import('@main/mcpServers/seed-audio'),
      import('@main/mcpServers/social-copywriting'),
      import('@main/mcpServers/skills'),
      import('@main/mcpServers/speech-generate'),
      import('@main/mcpServers/storyboard-editor'),
      import('@main/mcpServers/subtitle-recognition'),
      import('@main/mcpServers/subtitle-template'),
      import('@main/mcpServers/system'),
      import('@main/mcpServers/video-generate'),
      import('@main/mcpServers/video-understand'),
      import('@main/mcpServers/voice-conversion'),
      import('@main/mcpServers/workspaceMemory'),
      import('@main/mcpServers/claw'),
      import('@main/mcpServers/zhipu-search')
    ])

    const imageGenerateServer = new ImageGenerateServer()
    const videoGenerateServer = new VideoGenerateServer()

    const entries: AggregateServerEntry[] = [
      {
        serverId: 'filesystem-server',
        serverName: 'filesystem-server',
        createInstance: () => new FileSystemServer(workspacePath).mcpServer
      },
      {
        serverId: 'materials',
        serverName: 'materials',
        createInstance: () => new MaterialsServer(workspacePath).mcpServer
      },
      {
        serverId: 'browser',
        serverName: 'browser',
        createInstance: () => new BrowserServer().mcpServer
      },
      {
        serverId: 'search',
        serverName: 'search',
        createInstance: () => new ZhipuSearchServer().mcpServer
      },
      {
        serverId: 'file-upload',
        serverName: 'file-upload',
        createInstance: () => new FileUploadServer().mcpServer
      },
      {
        serverId: 'image-understand',
        serverName: 'image-understand',
        createInstance: () => new ImageUnderstandServer(workspacePath).mcpServer
      },
      {
        serverId: 'image',
        serverName: 'image',
        createInstance: () => imageGenerateServer.createMcpServer()
      },
      {
        serverId: 'video',
        serverName: 'video',
        createInstance: () => videoGenerateServer.createMcpServer()
      },
      {
        serverId: 'speech',
        serverName: 'speech',
        createInstance: () => new SpeechGenerateServer().mcpServer
      },
      {
        serverId: 'voice-conversion',
        serverName: 'voice-conversion',
        createInstance: () => new VoiceConversionServer().mcpServer
      },
      {
        serverId: 'seed-audio',
        serverName: 'seed-audio',
        createInstance: () => new SeedAudioServer().mcpServer
      },
      {
        serverId: 'ffmpeg-media',
        serverName: 'ffmpeg-media',
        createInstance: () => new FfmpegMediaServer().mcpServer
      },
      {
        serverId: 'draft-management',
        serverName: 'draft-management',
        createInstance: () => new DraftManagementServer(workspacePath).mcpServer
      },
      {
        serverId: 'draft-download',
        serverName: 'draft-download',
        createInstance: () => new DraftDownloadServer().mcpServer
      },
      {
        serverId: 'draft-elements',
        serverName: 'draft-elements',
        createInstance: () => new DraftElementsServer().mcpServer
      },
      {
        serverId: 'subtitle-recognition',
        serverName: 'subtitle-recognition',
        createInstance: () => new SubtitleRecognitionServer(workspacePath).mcpServer
      },
      {
        serverId: 'remove-bg',
        serverName: 'remove-bg',
        createInstance: () => new RemoveBgServer().mcpServer
      },
      {
        serverId: 'storyboard-editor',
        serverName: 'storyboard-editor',
        createInstance: () => new StoryboardEditorServer().mcpServer
      },
      {
        serverId: 'video-understand',
        serverName: 'video-understand',
        createInstance: () => new VideoUnderstandServer(workspacePath).mcpServer
      },
      {
        serverId: 'subtitle-template',
        serverName: 'subtitle-template',
        createInstance: () => new SubtitleTemplateServer().mcpServer
      },
      {
        serverId: 'cut-workflow',
        serverName: 'cut-workflow',
        createInstance: () => new CutWorkflowServer(workspacePath).mcpServer
      },
      {
        serverId: 'copylab',
        serverName: 'copylab',
        createInstance: () => new SocialCopywritingServer().mcpServer
      },
      {
        serverId: 'digital-human',
        serverName: 'digital-human',
        createInstance: () => new DigitalHumanServer().mcpServer
      },
      {
        serverId: 'koubo-template',
        serverName: 'koubo-template',
        createInstance: () => new KouboTemplateServer().mcpServer
      },
      {
        serverId: 'system',
        serverName: 'system',
        createInstance: () => new SystemServer().mcpServer
      },
      {
        serverId: 'skills',
        serverName: 'skills',
        createInstance: () => new SkillsServer(LOCAL_AGGREGATE_AGENT_ID, workspacePath).mcpServer
      },
      {
        serverId: 'agent-memory',
        serverName: 'agent-memory',
        createInstance: () => new WorkspaceMemoryServer(LOCAL_AGGREGATE_AGENT_ID).mcpServer
      },
      {
        serverId: 'claw',
        serverName: 'claw',
        createInstance: () => new ClawServer(LOCAL_AGGREGATE_AGENT_ID).mcpServer
      },
      {
        serverId: 'assistant',
        serverName: 'assistant',
        createInstance: () => new AssistantServer().mcpServer
      }
    ]

    setAggregateServerEntries(entries)
    logger.info('Initialized local aggregate MCP entries', { count: entries.length })
  })().catch((error) => {
    initializePromise = null
    logger.error('Failed to initialize local aggregate MCP entries', error as Error)
    throw error
  })

  return initializePromise
}
