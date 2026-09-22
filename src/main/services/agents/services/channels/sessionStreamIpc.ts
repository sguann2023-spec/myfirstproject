import { modelsService } from '@main/apiServer/services/models'
import DraftDownloadServer from '@main/mcpServers/draft-download'
import DraftElementsServer from '@main/mcpServers/draft-elements'
import DraftManagementServer from '@main/mcpServers/draft-management'
import SocialCopywritingServer from '@main/mcpServers/social-copywriting'
import SubtitleRecognitionServer from '@main/mcpServers/subtitle-recognition'
import { loggerService } from '@logger'
import { getDataPath } from '@main/utils'
import { IpcChannel } from '@shared/IpcChannel'
import { validateTextStyleRanges } from '../../../../../shared/textTypography'
import { normalizeTextEffectParams } from '../../../../../shared/textEffects'
import { buildReversePromptBlocks, normalizeReversePromptRequest, parseReversePromptResult } from '../../../../../shared/reversePrompt'
import { buildSubtitleRecognitionBlocks, normalizeSubtitleRecognitionRequest, parseSubtitleRecognitionResult } from '../../../../../shared/subtitleRecognition'
import { sql } from 'drizzle-orm'
import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { EOL } from 'node:os'
import path from 'node:path'

import { windowService } from '../../../WindowService'
import { agentsTable } from '../../database/schema'
import { agentMessageRepository } from '../../database/sessionMessageRepository'
import { agentTurnRepository } from '../../database/repositories/agentTurnRepository'
import { sessionService } from '../SessionService'
import { CHERRY_CLAW_AGENT_ID } from '../builtin/BuiltinAgentIds'
import { conversationSegmentService } from '../claudecode/session-architecture/ConversationSegmentService'
import { sessionStreamBus, type SessionStreamChunk } from './SessionStreamBus'

const activeSubscriptions = new Map<string, () => void>()
const activeAbortControllers = new Map<string, { controller: AbortController; requestId: string }>()
const cancelledRequestIds = new Set<string>()
let sessionStreamIpcRegistered = false
let sessionMessageServicePromise: Promise<import('../SessionMessageService').SessionMessageService | null> | null = null
let channelMessageHandlerPromise: Promise<import('./ChannelMessageHandler').ChannelMessageHandler | null> | null = null
let agentServicePromise: Promise<import('../AgentService').AgentService | null> | null = null
const providerModelIdCache = new Map<string, string>()
const logger = loggerService.withContext('SessionStreamIpc')
const DEFAULT_RUNTIME_AGENT_ID = CHERRY_CLAW_AGENT_ID
const SESSION_MESSAGE_START_RETRY_LIMIT = 5
const SESSION_MESSAGE_START_RETRY_BASE_DELAY_MS = 800
const SESSION_MESSAGE_START_TIMEOUT_MS = 15_000
const DIRECT_DRAFT_SYSTEM_PROMPT_VERSION = 'draft-request-v1'
const DIRECT_DRAFT_SYSTEM_PROMPT_HASH = 'draft-request'

type DirectDraftRequestPayload = {
  sessionId: string
  agent_id?: string
  requestId?: string
  createdAt?: number
  userMessageId?: string
  assistantMessageId?: string
  userContent?: string
  model?: string
  reversePromptRequest?: { shareText?: string }
  subtitleRecognitionRequest?: { url?: string; effectMode?: string; maxSentenceLength?: number; content?: string }
  draftRequest?: {
    action?: 'create'
    width?: number
    height?: number
    name?: string
    cover?: string
  }
  draftDownloadRequest?: {
    draftId?: string
    draftName?: string
    cover?: string
    drafts?: Array<{
      draftId?: string
      draftName?: string
      cover?: string
    }>
  }
  draftExportRequest?: {
    draftId?: string
    draftName?: string
    cover?: string
    drafts?: Array<{
      draftId?: string
      draftName?: string
      cover?: string
    }>
  }
  draftModifyRequest?: {
    draftId?: string
    draft_id?: string
    name?: string
    cover?: string
  }
  textAddRequest?: {
    draftId?: string
    draft_id?: string
    text?: string
    start?: number
    end?: number
    font?: string
    font_color?: string
    fontColor?: string
    font_size?: number
    fontSize?: number
    textStyles?: Array<Record<string, unknown>>
    text_styles?: Array<Record<string, unknown>>
    font_alpha?: number
    border_alpha?: number
    border_color?: string
    border_width?: number
    background_color?: string
    background_style?: number
    background_alpha?: number
    background_round_radius?: number
    background_height?: number
    background_width?: number
    background_vertical_offset?: number
    background_horizontal_offset?: number
    shadow_enabled?: boolean
    shadow_alpha?: number
    shadow_angle?: number
    shadow_color?: string
    shadow_distance?: number
    shadow_smoothing?: number
    effect_effect_id?: string
    intro_animation?: string
    intro_duration?: number
    outro_animation?: string
    outro_duration?: number
    loop_animation?: string
    loop_duration?: number
    letter_spacing?: number
    letterSpacing?: number
    line_spacing?: number
    lineSpacing?: number
    bold?: boolean
    italic?: boolean
    underline?: boolean
    vertical?: boolean
    align?: number
    scale_x?: number
    scaleX?: number
    scale_y?: number
    scaleY?: number
    transform_x_px?: number
    transformXPx?: number
    transform_y_px?: number
    transformYPx?: number
    fixed_width_px?: number
    fixedWidthPx?: number
    fixed_height_px?: number
    fixedHeightPx?: number
    rotation?: number
    track_name?: string
    trackName?: string
    relative_index?: number
    relativeIndex?: number
  }
  draftInspectRequest?: {
    requestId?: string
    draftId?: string
    draft_id?: string
    requirement?: string
    inspectRequirement?: string
    query?: string
  }
}

function parseDraftResultText(result: any): Record<string, any> {
  const text = Array.isArray(result?.content)
    ? result.content
      .filter((item: any) => item?.type === 'text' && typeof item?.text === 'string')
      .map((item: any) => item.text)
      .join('\n')
      .trim()
    : ''
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { rawText: text }
  }
}

async function callDraftManagementTool(toolName: string, args: Record<string, unknown>) {
  const server = new DraftManagementServer(getDefaultAgentWorkspacePath(DEFAULT_RUNTIME_AGENT_ID))
  const handlers = (server.mcpServer.server as any)?._requestHandlers
  const callToolHandler = handlers?.get('tools/call')
  if (typeof callToolHandler !== 'function') {
    throw new Error('Draft management server did not register tools/call handler')
  }
  return callToolHandler(
    {
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args
      }
    },
    {}
  )
}

async function callDraftDownloadTool(toolName: string, args: Record<string, unknown>) {
  const server = new DraftDownloadServer()
  const handlers = (server.mcpServer.server as any)?._requestHandlers
  const callToolHandler = handlers?.get('tools/call')
  if (typeof callToolHandler !== 'function') {
    throw new Error('Draft download server did not register tools/call handler')
  }
  return callToolHandler(
    {
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args
      }
    },
    {}
  )
}

async function callDraftElementsTool(toolName: string, args: Record<string, unknown>) {
  const server = new DraftElementsServer()
  const handlers = (server.mcpServer.server as any)?._requestHandlers
  const callToolHandler = handlers?.get('tools/call')
  if (typeof callToolHandler !== 'function') {
    throw new Error('Draft elements server did not register tools/call handler')
  }
  return callToolHandler(
    {
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args
      }
    },
    {}
  )
}

function normalizeDirectDraftDimension(value: unknown): number | undefined {
  const numericValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numericValue) || numericValue <= 0) return undefined
  return Math.trunc(numericValue)
}

function getDirectDraftOrientation(width?: number, height?: number): string {
  if (!width || !height) return ''
  if (width === height) return '方屏'
  return height > width ? '竖屏' : '横屏'
}

function buildDirectDraftAssistantText(input: {
  action: 'create'
  width?: number
  height?: number
  name?: string
  cover?: string
  toolResponse: Record<string, any>
}): string {
  const { width, height, name, cover, toolResponse } = input
  const output = toolResponse?.output && typeof toolResponse.output === 'object' ? toolResponse.output : {}
  const draftId = String(output?.draft_id || '').trim()
  const orientation = getDirectDraftOrientation(width, height)
  const resolutionText = width && height
    ? `${width} × ${height}${orientation ? `（${orientation}）` : ''}`
    : ''

  return [
    '草稿已创建成功！',
    '',
    draftId ? `- 草稿 ID：${draftId}` : '',
    name ? `- 草稿名：${name}` : '',
    resolutionText ? `- 分辨率：${resolutionText}` : '',
    cover ? '- 封面图：已设置' : '',
    '',
    '你可以继续往这个草稿中添加视频、图片、文字、音频等素材。需要我帮你做些什么吗？'
  ].filter((line) => line !== null && line !== undefined).join(EOL)
}

function buildDirectDraftAssistantBlocks(input: {
  assistantMessageId: string
  modelId: string
  toolCallId: string
  toolArgs: Record<string, unknown>
  toolResponse: Record<string, unknown>
  assistantText: string
  createdAtIso: string
}) {
  const { assistantMessageId, modelId, toolCallId, toolArgs, toolResponse, assistantText, createdAtIso } = input
  return [
    {
      id: randomUUID(),
      messageId: assistantMessageId,
      type: 'tool',
      createdAt: createdAtIso,
      updatedAt: createdAtIso,
      status: 'success',
      model: modelId,
      toolId: toolCallId,
      toolName: 'mcp__vectcut__draft-management__create_draft',
      arguments: toolArgs,
      content: toolResponse,
      metadata: {
        rawMcpToolResponse: {
          id: toolCallId,
          tool: {
            id: 'mcp__vectcut__draft-management__create_draft',
            name: 'mcp__vectcut__draft-management__create_draft',
            serverName: 'vectcut',
            serverId: 'vectcut',
            type: 'mcp'
          },
          arguments: toolArgs,
          status: 'done',
          response: toolResponse,
          responseRaw: toolResponse,
          truncated: false
        }
      }
    },
    {
      id: randomUUID(),
      messageId: assistantMessageId,
      type: 'main_text',
      createdAt: createdAtIso,
      updatedAt: createdAtIso,
      status: 'success',
      modelId,
      content: assistantText
    }
  ]
}

function normalizeDirectDraftDownloadItem(input: Record<string, unknown>, index?: number) {
  const draftIdRaw = typeof input?.draftId === 'string' ? input.draftId : input?.draft_id
  const draftNameRaw = typeof input?.draftName === 'string' ? input.draftName : input?.draft_name
  const coverRaw = typeof input?.cover === 'string' ? input.cover : undefined
  const draftId = typeof draftIdRaw === 'string' ? draftIdRaw.trim() : ''
  if (!draftId) {
    const suffix = typeof index === 'number' ? ` at drafts[${index}]` : ''
    throw new Error(`draftId is required for draft download request${suffix}`)
  }
  const draftName = typeof draftNameRaw === 'string' && draftNameRaw.trim() ? draftNameRaw.trim() : draftId
  const cover = typeof coverRaw === 'string' && coverRaw.trim() ? coverRaw.trim() : undefined
  return {
    draftId,
    draftName,
    ...(cover ? { cover } : {})
  }
}

function normalizeDirectDraftDownloadRequest(input: Record<string, unknown> = {}) {
  const drafts = Array.isArray(input?.drafts) && input.drafts.length > 0
    ? input.drafts.map((item, index) => normalizeDirectDraftDownloadItem(item as Record<string, unknown>, index))
    : [normalizeDirectDraftDownloadItem(input)];
  return {
    drafts
  }
}

function normalizeDirectDraftExportRequest(input: Record<string, unknown> = {}) {
  return normalizeDirectDraftDownloadRequest(input)
}

function normalizeDirectDraftModifyRequest(input: Record<string, unknown> = {}) {
  const draftIdRaw = typeof input?.draftId === 'string' ? input.draftId : input?.draft_id
  const nameRaw = typeof input?.name === 'string' ? input.name : ''
  const coverRaw = typeof input?.cover === 'string' ? input.cover : ''
  const draftId = typeof draftIdRaw === 'string' ? draftIdRaw.trim() : ''
  if (!draftId) {
    throw new Error('draftId is required for draft modify request')
  }
  const name = typeof nameRaw === 'string' && nameRaw.trim() ? nameRaw.trim() : undefined
  const cover = typeof coverRaw === 'string' && coverRaw.trim() ? coverRaw.trim() : undefined
  return {
    draftId,
    ...(name ? { name } : {}),
    ...(cover ? { cover } : {})
  }
}

function normalizeDirectTextAddRequest(input: Record<string, unknown> = {}, fallbackText = '') {
  const draftIdRaw = typeof input?.draftId === 'string' ? input.draftId : input?.draft_id
  const draftId = typeof draftIdRaw === 'string' ? draftIdRaw.trim() : ''
  if (!draftId) {
    throw new Error('draftId is required for text add request')
  }

  const textRaw = typeof input?.text === 'string' ? input.text : fallbackText
  const text = String(textRaw || '')
  if (!text.trim()) {
    throw new Error('text is required for text add request')
  }
  const textStyles = validateTextStyleRanges(text, input?.text_styles ?? input?.textStyles)

  const startValue = typeof input?.start === 'number' ? input.start : Number(input?.start)
  const normalizedStart = Number.isFinite(startValue) ? Number(startValue) : 0
  const endValue = typeof input?.end === 'number' ? input.end : Number(input?.end)
  const normalizedEnd = Number.isFinite(endValue) && Number(endValue) > normalizedStart
    ? Number(endValue)
    : normalizedStart + 3
  const font = typeof input?.font === 'string' && input.font.trim() ? input.font.trim() : undefined
  const fontColorRaw = typeof input?.font_color === 'string'
    ? input.font_color
    : (typeof input?.fontColor === 'string' ? input.fontColor : '')
  const fontColor = typeof fontColorRaw === 'string' && fontColorRaw.trim() ? fontColorRaw.trim() : undefined
  const fontSizeRaw = Number(input?.font_size ?? input?.fontSize)
  const fontSize = Number.isFinite(fontSizeRaw) && fontSizeRaw > 0 ? fontSizeRaw : undefined
  const letterSpacingRaw = Number(input?.letter_spacing ?? input?.letterSpacing)
  const letterSpacing = Number.isFinite(letterSpacingRaw) ? letterSpacingRaw : undefined
  const lineSpacingRaw = Number(input?.line_spacing ?? input?.lineSpacing)
  const lineSpacing = Number.isFinite(lineSpacingRaw) ? lineSpacingRaw : undefined
  const bold = typeof input?.bold === 'boolean' ? input.bold : undefined
  const italic = typeof input?.italic === 'boolean' ? input.italic : undefined
  const underline = typeof input?.underline === 'boolean' ? input.underline : undefined
  const vertical = typeof input?.vertical === 'boolean' ? input.vertical : undefined
  const alignRaw = Number(input?.align)
  const align = Number.isInteger(alignRaw) ? alignRaw : undefined
  const scaleXRaw = Number(input?.scale_x ?? input?.scaleX)
  const scaleX = Number.isFinite(scaleXRaw) ? scaleXRaw : undefined
  const scaleYRaw = Number(input?.scale_y ?? input?.scaleY)
  const scaleY = Number.isFinite(scaleYRaw) ? scaleYRaw : undefined
  const transformXPxRaw = Number(input?.transform_x_px ?? input?.transformXPx)
  const transformXPx = Number.isFinite(transformXPxRaw) ? transformXPxRaw : undefined
  const transformYPxRaw = Number(input?.transform_y_px ?? input?.transformYPx)
  const transformYPx = Number.isFinite(transformYPxRaw) ? transformYPxRaw : undefined
  const fixedWidthPxRaw = Number(input?.fixed_width_px ?? input?.fixedWidthPx ?? input?.fixed_width ?? input?.fixedWidth)
  const fixedWidthPx = Number.isFinite(fixedWidthPxRaw) ? fixedWidthPxRaw : undefined
  const fixedHeightPxRaw = Number(input?.fixed_height_px ?? input?.fixedHeightPx ?? input?.fixed_height ?? input?.fixedHeight)
  const fixedHeightPx = Number.isFinite(fixedHeightPxRaw) ? fixedHeightPxRaw : undefined
  const rotationRaw = Number(input?.rotation)
  const rotation = Number.isFinite(rotationRaw) ? rotationRaw : undefined
  const trackNameRaw = typeof input?.track_name === 'string'
    ? input.track_name
    : (typeof input?.trackName === 'string' ? input.trackName : '')
  const trackName = typeof trackNameRaw === 'string' && trackNameRaw.trim() ? trackNameRaw.trim() : undefined
  const relativeIndex = Number(input?.relative_index ?? input?.relativeIndex)

  return {
    draft_id: draftId,
    text,
    start: normalizedStart,
    end: normalizedEnd,
    ...(font ? { font } : {}),
    ...(fontColor ? { font_color: fontColor } : {}),
    ...(fontSize ? { font_size: fontSize } : {}),
    ...(textStyles.length ? { text_styles: textStyles } : {}),
    ...normalizeTextEffectParams(input),
    ...(typeof letterSpacing === 'number' ? { letter_spacing: letterSpacing } : {}),
    ...(typeof lineSpacing === 'number' ? { line_spacing: lineSpacing } : {}),
    ...(typeof bold === 'boolean' ? { bold } : {}),
    ...(typeof italic === 'boolean' ? { italic } : {}),
    ...(typeof underline === 'boolean' ? { underline } : {}),
    ...(typeof vertical === 'boolean' ? { vertical } : {}),
    ...(typeof align === 'number' ? { align } : {}),
    ...(typeof scaleX === 'number' ? { scale_x: scaleX } : {}),
    ...(typeof scaleY === 'number' ? { scale_y: scaleY } : {}),
    ...(typeof transformXPx === 'number' ? { transform_x_px: transformXPx } : {}),
    ...(typeof transformYPx === 'number' ? { transform_y_px: transformYPx } : {}),
    ...(typeof fixedWidthPx === 'number' ? { fixed_width_px: fixedWidthPx } : {}),
    ...(typeof fixedHeightPx === 'number' ? { fixed_height_px: fixedHeightPx } : {}),
    ...(typeof rotation === 'number' ? { rotation } : {}),
    ...(trackName ? { track_name: trackName } : {}),
    ...(Number.isInteger(relativeIndex) ? { relative_index: relativeIndex } : {}),
  }
}

function buildDirectDraftDownloadAssistantText(input: {
  drafts: Array<{
    draftId: string
    draftName?: string
  }>
}): string {
  const drafts = Array.isArray(input?.drafts) ? input.drafts : []
  return [
    '草稿下载任务已提交成功！',
    '',
    ...drafts.map((item, index) => {
      const draftId = String(item?.draftId || '').trim()
      const draftName = String(item?.draftName || '').trim()
      const primaryText = draftName && draftName !== draftId ? `${draftName}（${draftId}）` : draftId
      return `- 草稿${index + 1}：${primaryText}`
    }),
    '',
    `共 ${drafts.length} 个草稿已加入下载队列，下载完成后会自动打开剪映，您可以在剪映里继续编辑。`
  ].filter((line) => line !== null && line !== undefined).join(EOL)
}

function buildDirectDraftExportAssistantText(input: {
  drafts: Array<{
    draftId: string
    draftName?: string
  }>
}): string {
  const drafts = Array.isArray(input?.drafts) ? input.drafts : []
  return [
    '草稿导出任务已提交成功！',
    '',
    ...drafts.map((item, index) => {
      const draftId = String(item?.draftId || '').trim()
      const draftName = String(item?.draftName || '').trim()
      const primaryText = draftName && draftName !== draftId ? `${draftName}（${draftId}）` : draftId
      return `- 草稿${index + 1}：${primaryText}`
    }),
    '',
    `共 ${drafts.length} 个草稿已加入导出队列，导出完成后，您可以在桌面端查看导出的文件。`
  ].filter((line) => line !== null && line !== undefined).join(EOL)
}

function buildDirectDraftDownloadAssistantBlocks(input: {
  assistantMessageId: string
  modelId: string
  toolCallId: string
  toolArgs: Record<string, unknown>
  toolResponse: Record<string, unknown>
  assistantText: string
  createdAtIso: string
}) {
  const { assistantMessageId, modelId, toolCallId, toolArgs, toolResponse, assistantText, createdAtIso } = input
  return [
    {
      id: randomUUID(),
      messageId: assistantMessageId,
      type: 'tool',
      createdAt: createdAtIso,
      updatedAt: createdAtIso,
      status: 'success',
      model: modelId,
      toolId: toolCallId,
      toolName: 'mcp__vectcut__draft-download__download_draft',
      arguments: toolArgs,
      content: toolResponse,
      metadata: {
        rawMcpToolResponse: {
          id: toolCallId,
          tool: {
            id: 'mcp__vectcut__draft-download__download_draft',
            name: 'mcp__vectcut__draft-download__download_draft',
            serverName: 'vectcut',
            serverId: 'vectcut',
            type: 'mcp'
          },
          arguments: toolArgs,
          status: 'done',
          response: toolResponse,
          responseRaw: toolResponse,
          truncated: false
        }
      }
    },
    {
      id: randomUUID(),
      messageId: assistantMessageId,
      type: 'main_text',
      createdAt: createdAtIso,
      updatedAt: createdAtIso,
      status: 'success',
      modelId,
      content: assistantText
    }
  ]
}

function buildDirectDraftExportAssistantBlocks(input: {
  assistantMessageId: string
  modelId: string
  toolCallId: string
  toolArgs: Record<string, unknown>
  toolResponse: Record<string, unknown>
  assistantText: string
  createdAtIso: string
}) {
  const { assistantMessageId, modelId, toolCallId, toolArgs, toolResponse, assistantText, createdAtIso } = input
  return [
    {
      id: randomUUID(),
      messageId: assistantMessageId,
      type: 'tool',
      createdAt: createdAtIso,
      updatedAt: createdAtIso,
      status: 'success',
      model: modelId,
      toolId: toolCallId,
      toolName: 'mcp__vectcut__draft-download__export_draft',
      arguments: toolArgs,
      content: toolResponse,
      metadata: {
        rawMcpToolResponse: {
          id: toolCallId,
          tool: {
            id: 'mcp__vectcut__draft-download__export_draft',
            name: 'mcp__vectcut__draft-download__export_draft',
            serverName: 'vectcut',
            serverId: 'vectcut',
            type: 'mcp'
          },
          arguments: toolArgs,
          status: 'done',
          response: toolResponse,
          responseRaw: toolResponse,
          truncated: false
        }
      }
    },
    {
      id: randomUUID(),
      messageId: assistantMessageId,
      type: 'main_text',
      createdAt: createdAtIso,
      updatedAt: createdAtIso,
      status: 'success',
      modelId,
      content: assistantText
    }
  ]
}

function buildDirectDraftModifyAssistantText(input: {
  draftId: string
  name?: string
  cover?: string
}): string {
  const draftId = String(input?.draftId || '').trim()
  const name = String(input?.name || '').trim()
  const cover = String(input?.cover || '').trim()
  const headline = name && cover
    ? '草稿信息已修改成功！'
    : name
      ? '草稿名已修改成功！'
      : cover
        ? '草稿封面已修改成功！'
        : '草稿已修改成功！'

  return [
    headline,
    '',
    draftId ? `- 草稿 ID：${draftId}` : '',
    name ? `- 新草稿名：${name}` : '',
    cover ? '- 新封面：已设置' : '',
    '',
    '还需要对这个草稿做其他修改吗？'
  ].filter((line) => line !== null && line !== undefined).join(EOL)
}

function buildDirectTextAddAssistantText(input: {
  draftId: string
  text: string
  start: number
  end: number
}): string {
  const draftId = String(input?.draftId || '').trim()
  const text = String(input?.text || '').trim()
  const start = Number(input?.start || 0)
  const end = Number(input?.end || 0)
  const durationText = Number.isFinite(start) && Number.isFinite(end) && end > start
    ? `${start}s - ${end}s`
    : ''
  return [
    '文本已添加成功！',
    '',
    draftId ? `- 草稿 ID：${draftId}` : '',
    text ? `- 文本内容：${text}` : '',
    durationText ? `- 时间范围：${durationText}` : '',
    '',
    '还需要继续添加其他文本，或者继续调整这个草稿吗？'
  ].filter((line) => line !== null && line !== undefined).join(EOL)
}

function buildDirectTextAddErrorAssistantText(input: {
  draftId: string
  text: string
  errorCode?: string
}): string {
  const draftId = String(input?.draftId || '').trim()
  const text = String(input?.text || '').trim()
  const errorCode = String(input?.errorCode || '').trim()
  const errorHint = (() => {
    switch (errorCode) {
      case 'SEGMENT_OVERLAP':
        return '当前时间段和现有文本片段发生了重叠。可以调整时间范围，或者换一个不同的轨道 track_name 再试。'
      case 'UNSUPPORTED_FONT':
        return '当前字体不被后端服务支持。请换一个受支持的字体名称后重试。'
      case 'MISSING_REQUIRED_PARAM':
        return '请求缺少必要参数。请确认草稿 ID、文本内容、开始时间和结束时间都已正确传入。'
      case 'INVALID_PARAMETER':
        return '请求参数不合法。请检查字号、颜色、对齐方式、字间距、行间距等设置是否超出允许范围。'
      case 'DRAFT_NOT_FOUND':
        return '目标草稿不存在，或者当前环境拿不到这个草稿。请重新选择草稿后再试。'
      case 'TRACK_NOT_FOUND':
        return '指定的轨道不存在。请改用已有轨道名，或者不要传自定义 track_name。'
      case 'INVALID_TRACK_TYPE':
        return '指定轨道类型不正确。请确认文本被添加到文本轨道，而不是视频或音频轨道。'
      case 'MATERIAL_NOT_FOUND':
        return '依赖的素材没有找到。请确认草稿资源完整，或重新选择目标草稿后再试。'
      case 'UNKNOWN_ERROR':
        return '后端返回了未知错误。建议先保留当前参数，再换一个 track_name 或稍后重试。'
      default:
        return '当前请求执行失败。请检查文本参数和草稿状态后重试。'
    }
  })()

  return [
    '文本添加失败。',
    '',
    draftId ? `- 草稿 ID：${draftId}` : '',
    text ? `- 文本内容：${text}` : '',
    errorCode ? `- 错误码：${errorCode}` : '',
    '',
    errorHint
  ].filter((line) => line !== null && line !== undefined).join(EOL)
}

function buildDirectDraftModifyAssistantBlocks(input: {
  assistantMessageId: string
  modelId: string
  toolCallId: string
  toolArgs: Record<string, unknown>
  toolResponse: Record<string, unknown>
  assistantText: string
  createdAtIso: string
}) {
  const { assistantMessageId, modelId, toolCallId, toolArgs, toolResponse, assistantText, createdAtIso } = input
  return [
    {
      id: randomUUID(),
      messageId: assistantMessageId,
      type: 'tool',
      createdAt: createdAtIso,
      updatedAt: createdAtIso,
      status: 'success',
      model: modelId,
      toolId: toolCallId,
      toolName: 'mcp__vectcut__draft-management__modify_draft',
      arguments: toolArgs,
      content: toolResponse,
      metadata: {
        rawMcpToolResponse: {
          id: toolCallId,
          tool: {
            id: 'mcp__vectcut__draft-management__modify_draft',
            name: 'mcp__vectcut__draft-management__modify_draft',
            serverName: 'vectcut',
            serverId: 'vectcut',
            type: 'mcp'
          },
          arguments: toolArgs,
          status: 'done',
          response: toolResponse,
          responseRaw: toolResponse,
          truncated: false
        }
      }
    },
    {
      id: randomUUID(),
      messageId: assistantMessageId,
      type: 'main_text',
      createdAt: createdAtIso,
      updatedAt: createdAtIso,
      status: 'success',
      modelId,
      content: assistantText
    }
  ]
}

function buildDirectTextAddAssistantBlocks(input: {
  assistantMessageId: string
  modelId: string
  toolCallId: string
  toolArgs: Record<string, unknown>
  toolResponse: Record<string, unknown>
  assistantText: string
  createdAtIso: string
  status?: 'success' | 'error'
}) {
  const {
    assistantMessageId,
    modelId,
    toolCallId,
    toolArgs,
    toolResponse,
    assistantText,
    createdAtIso,
    status = 'success'
  } = input
  return [
    {
      id: randomUUID(),
      messageId: assistantMessageId,
      type: 'tool',
      createdAt: createdAtIso,
      updatedAt: createdAtIso,
      status,
      model: modelId,
      toolId: toolCallId,
      toolName: 'mcp__vectcut__draft-elements__add_text',
      arguments: toolArgs,
      content: toolResponse,
      metadata: {
        rawMcpToolResponse: {
          id: toolCallId,
          tool: {
            id: 'mcp__vectcut__draft-elements__add_text',
            name: 'mcp__vectcut__draft-elements__add_text',
            serverName: 'vectcut',
            serverId: 'vectcut',
            type: 'mcp'
          },
          arguments: toolArgs,
          status: 'done',
          response: toolResponse,
          responseRaw: toolResponse,
          truncated: false
        }
      }
    },
    {
      id: randomUUID(),
      messageId: assistantMessageId,
      type: 'main_text',
      createdAt: createdAtIso,
      updatedAt: createdAtIso,
      status,
      modelId,
      content: assistantText
    }
  ]
}

async function ensureDirectRequestSegment(session: any): Promise<any> {
  let activeSegment = await conversationSegmentService.getActiveSegment(session.id)
  if (!activeSegment) {
    activeSegment = await conversationSegmentService.createRootSegment({
      topicId: session.id,
      sdkSessionId: '',
      systemPromptVersion: DIRECT_DRAFT_SYSTEM_PROMPT_VERSION,
      systemPromptHash: DIRECT_DRAFT_SYSTEM_PROMPT_HASH,
      basePromptSnapshot: String(session?.instructions || '')
    })
  }
  return activeSegment
}

function getDefaultAgentWorkspacePath(agentId: string): string {
  return path.join(getDataPath(), 'Agents', agentId)
}

function createSessionMessageStartTimeoutError(timeoutMs: number): Error {
  const error = new Error(`Session message stream did not start within ${timeoutMs}ms`)
  error.name = 'SessionMessageStartTimeoutError'
  return error
}

function isRetriableSessionStartError(error: Error): boolean {
  const name = String(error.name || '').trim()
  const message = String(error.message || '').trim()
  const normalized = `${name} ${message}`.toLowerCase()

  return (
    name === 'SessionMessageStartTimeoutError'
    || /\b502\b|\b503\b|\b504\b/.test(message)
    || normalized.includes('connection error')
    || normalized.includes('socket hang up')
    || normalized.includes('econnreset')
    || normalized.includes('ecconnreset')
    || normalized.includes('connection reset')
    || normalized.includes('network error')
    || normalized.includes('fetch failed')
    || normalized.includes('enotfound')
    || normalized.includes('getaddrinfo')
    || normalized.includes('upstream request failed')
    || normalized.includes('上游请求失败')
    || normalized.includes('timed out')
    || normalized.includes('timeout')
  )
}

function buildRetryStatusText(attempt: number, maxRetries: number): string {
  return `第${attempt}/${maxRetries}次重试`
}

async function waitForRetryDelay(delayMs: number, abortSignal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) return
  if (abortSignal?.aborted) {
    throw new DOMException('Request was aborted', 'AbortError')
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      abortSignal?.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)

    const onAbort = () => {
      clearTimeout(timeoutHandle)
      abortSignal?.removeEventListener('abort', onAbort)
      reject(new DOMException('Request was aborted', 'AbortError'))
    }

    abortSignal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function createSessionMessageWithTimeout<T>(
  factory: Promise<T>,
  timeoutMs: number,
  abortSignal?: AbortSignal
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined
  try {
    return await Promise.race<T>([
      factory,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(createSessionMessageStartTimeoutError(timeoutMs))
        }, timeoutMs)
        abortSignal?.addEventListener(
          'abort',
          () => {
            reject(new DOMException('Request was aborted', 'AbortError'))
          },
          { once: true }
        )
      })
    ])
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}

async function getSessionMessageService() {
  if (!sessionMessageServicePromise) {
    sessionMessageServicePromise = import('../SessionMessageService')
      .then((mod) => {
        if (!mod?.sessionMessageService) {
          throw new Error('SessionMessageService export not found')
        }
        return mod.sessionMessageService
      })
  }
  return await sessionMessageServicePromise
}

async function getChannelMessageHandler() {
  if (!channelMessageHandlerPromise) {
    channelMessageHandlerPromise = import('./ChannelMessageHandler')
      .then((mod) => mod.channelMessageHandler)
      .catch(() => null)
  }
  return await channelMessageHandlerPromise
}

async function getAgentService() {
  if (!agentServicePromise) {
    agentServicePromise = import('../AgentService')
      .then((mod) => mod.agentService)
      .catch(() => null)
  }
  return await agentServicePromise
}

async function normalizeProviderModelId(model: unknown): Promise<string> {
  const startedAt = Date.now()
  const raw = String(model || '').trim()
  if (!raw) return ''
  if (raw.includes(':')) {
    logger.info('[SessionStreamIpc][ModelNormalize] already normalized', {
      raw,
      elapsedMs: Date.now() - startedAt
    })
    return raw
  }

  const cached = providerModelIdCache.get(raw)
  if (cached) {
    logger.info('[SessionStreamIpc][ModelNormalize] cache hit', {
      raw,
      normalized: cached,
      cacheSize: providerModelIdCache.size,
      elapsedMs: Date.now() - startedAt
    })
    return cached
  }

  try {
    const listed = await modelsService.getModels({})
    const rows = Array.isArray(listed?.data) ? listed.data : []
    const sample = rows.slice(0, 5).map((item: any) => ({
      id: String(item?.id || '').trim(),
      provider_model_id: String(item?.provider_model_id || '').trim(),
      provider: String(item?.provider || '').trim()
    }))
    const hit = rows.find((item: any) => {
      const id = String(item?.id || '').trim()
      if (!id) return false
      return id === raw || id.endsWith(`:${raw}`)
    })
    const normalized = String(hit?.id || '').trim()
    if (normalized.includes(':')) {
      providerModelIdCache.set(raw, normalized)
      logger.info('[SessionStreamIpc][ModelNormalize] normalized', {
        raw,
        normalized,
        rowsCount: rows.length,
        sample,
        elapsedMs: Date.now() - startedAt
      })
      return normalized
    }
    logger.warn('[SessionStreamIpc][ModelNormalize] unable to normalize model', {
      raw,
      rowsCount: rows.length,
      sample,
      elapsedMs: Date.now() - startedAt
    })
  } catch (error) {
    logger.error('[SessionStreamIpc][ModelNormalize] getModels failed', error as Error, {
      raw,
      elapsedMs: Date.now() - startedAt
    })
  }

  return ''
}

async function ensureDefaultAgentExists(modelHint?: string): Promise<boolean> {
  const agentService = await getAgentService()
  if (!agentService) return false

  const workspacePath = getDefaultAgentWorkspacePath(DEFAULT_RUNTIME_AGENT_ID)
  try {
    fs.mkdirSync(workspacePath, { recursive: true })
  } catch {
    // best effort, DB write below still proceeds
  }

  const existing = await agentService.getAgent(DEFAULT_RUNTIME_AGENT_ID)
  if (existing) {
    const hasPath = Array.isArray((existing as any).accessible_paths) && (existing as any).accessible_paths.length > 0
    const normalizedHintModel = await normalizeProviderModelId(String(modelHint || '').trim())
    const existingModel = String((existing as any).model || '').trim()
    const shouldBackfillModel = !existingModel && !!normalizedHintModel

    if (!hasPath || shouldBackfillModel) {
      try {
        const database = await (agentService as any).getDatabase()
        const updatePayload: Record<string, unknown> = {
          updated_at: new Date().toISOString()
        }
        if (!hasPath) {
          updatePayload.accessible_paths = JSON.stringify([workspacePath])
        }
        if (shouldBackfillModel) {
          updatePayload.model = normalizedHintModel
        }
        await database
          .update(agentsTable)
          .set(updatePayload)
          .where(sql`${agentsTable.id} = ${DEFAULT_RUNTIME_AGENT_ID}`)
      } catch {
        // ignore race / transient DB issues
      }
    }
    return true
  }

  let modelId = await normalizeProviderModelId(modelHint)
  if (!modelId) {
    const preferred = await modelsService.getModels({ providerType: 'anthropic', limit: 1 })
    modelId = String(preferred?.data?.[0]?.id || '').trim()
  }
  if (!modelId) {
    const fallback = await modelsService.getModels({ limit: 1 })
    modelId = String(fallback?.data?.[0]?.id || '').trim()
  }
  if (!modelId) return false

  const now = new Date().toISOString()

  try {
    const database = await (agentService as any).getDatabase()
    await database.transaction(async (tx: any) => {
      await tx.update(agentsTable).set({ sort_order: sql`${agentsTable.sort_order} + 1` })
      await tx.insert(agentsTable).values({
        id: DEFAULT_RUNTIME_AGENT_ID,
        type: 'claude-code',
        name: 'Default Agent',
        description: 'Default agent for chat runtime',
        instructions: 'You are a helpful assistant.',
        model: modelId,
        accessible_paths: JSON.stringify([workspacePath]),
        configuration: JSON.stringify({
          permission_mode: 'bypassPermissions',
          max_turns: 100,
          soul_enabled: true,
          env_vars: {}
        }),
        sort_order: 0,
        created_at: now,
        updated_at: now
      })
    })
  } catch {
    // ignore duplicate/parallel insert races
  }

  return Boolean(await agentService.getAgent(DEFAULT_RUNTIME_AGENT_ID))
}

const LegacyChannels = Object.freeze({
  SessionCreate: 'agent:session:create',
  SessionGet: 'agent:session:get',
  SessionList: 'agent:session:list',
  SessionMessageCreate: 'agent:session:message:create',
  SessionMessageList: 'agent:session:message:list',
  SessionAbort: 'agent:session:abort'
})

const CherryChannels = Object.freeze({
  SessionCreate: IpcChannel.CherryChatStream_SessionCreate,
  SessionGet: IpcChannel.CherryChatStream_SessionGet,
  SessionUpdate: IpcChannel.CherryChatStream_SessionUpdate,
  SessionList: IpcChannel.CherryChatStream_SessionList,
  SessionMessageCreate: IpcChannel.CherryChatStream_MessageCreate,
  SessionMessageList: IpcChannel.CherryChatStream_MessageList,
  SessionAbort: IpcChannel.CherryChatStream_Abort,
  SessionStreamSubscribe: IpcChannel.CherryChatStream_Subscribe,
  SessionStreamUnsubscribe: IpcChannel.CherryChatStream_Unsubscribe,
  SessionStreamChunk: IpcChannel.CherryChatStream_Chunk
})

function buildSubscriptionKey(channel: string, sessionId: string): string {
  return `${channel}::${sessionId}`
}

function isRequestCancelled(requestId: string): boolean {
  return cancelledRequestIds.has(requestId)
}

function markRequestCancelled(requestId: string): void {
  cancelledRequestIds.add(requestId)
}

function clearCancelledRequest(requestId: string): void {
  setTimeout(() => {
    cancelledRequestIds.delete(requestId)
  }, 30_000)
}

async function resolveSessionById(sessionId: string, preferredAgentId?: string) {
  const candidateAgentId = String(preferredAgentId || '').trim()
  if (candidateAgentId) {
    const direct = await sessionService.getSession(candidateAgentId, sessionId)
    if (direct) return direct
  }
  const listed = await sessionService.listSessions(undefined, { limit: 2000 })
  const matched = listed.sessions.find((item) => item.id === sessionId)
  if (!matched) return null
  return await sessionService.getSession(matched.agent_id, sessionId)
}

export function registerSessionStreamIpc(): void {
  if (sessionStreamIpcRegistered) {
    logger.info('[SessionStreamIpc] Skip duplicate IPC registration')
    return
  }

  const registerStreamSubscribeHandler = (subscribeChannel: string, chunkChannel: string) => {
    ipcMain.handle(subscribeChannel, (_event, { sessionId }: { sessionId: string }) => {
      const key = buildSubscriptionKey(subscribeChannel, sessionId)
      if (activeSubscriptions.has(key)) return { success: true }

      const unsubscribe = sessionStreamBus.subscribe(sessionId, (chunk: SessionStreamChunk) => {
        const mainWindow = windowService.getMainWindow()
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(chunkChannel, chunk)
        }
      })

      activeSubscriptions.set(key, unsubscribe)
      logger.info('[SessionStreamIpc] Registered stream subscription', {
        sessionId,
        subscribeChannel,
        chunkChannel,
        hasSubscribers: sessionStreamBus.hasSubscribers(sessionId),
        subscriberCount: sessionStreamBus.subscriberCount(sessionId)
      })
      return { success: true }
    })
  }

  const registerStreamUnsubscribeHandler = (subscribeChannel: string, unsubscribeChannel: string) => {
    ipcMain.handle(unsubscribeChannel, (_event, { sessionId }: { sessionId: string }) => {
      const key = buildSubscriptionKey(subscribeChannel, sessionId)
      const unsub = activeSubscriptions.get(key)
      if (unsub) {
        unsub()
        activeSubscriptions.delete(key)
        logger.info('[SessionStreamIpc] Unregistered stream subscription', {
          sessionId,
          subscribeChannel,
          unsubscribeChannel,
          hasSubscribers: sessionStreamBus.hasSubscribers(sessionId),
          subscriberCount: sessionStreamBus.subscriberCount(sessionId)
        })
      }
      return { success: true }
    })
  }

  const registerAbortHandler = (abortChannel: string) => {
    ipcMain.handle(abortChannel, async (_event, { sessionId }: { sessionId: string }) => {
      const activeRequest = activeAbortControllers.get(sessionId)
      if (activeRequest) {
        logger.info('[SessionStreamIpc] Abort requested for active stream', {
          sessionId,
          requestId: activeRequest.requestId,
          hasSubscribers: sessionStreamBus.hasSubscribers(sessionId),
          subscriberCount: sessionStreamBus.subscriberCount(sessionId)
        })
        markRequestCancelled(activeRequest.requestId)
        activeRequest.controller.abort()
        activeAbortControllers.delete(sessionId)
        sessionStreamBus.publish(sessionId, {
          sessionId,
          agentId: '',
          requestId: activeRequest.requestId,
          type: 'cancelled',
          error: { message: 'Request aborted by user', code: 'ABORTED' }
        })
        return { success: true }
      }
      const handler = await getChannelMessageHandler()
      const aborted = handler ? handler.abortSession(sessionId) : false
      return { success: aborted }
    })
  }

  registerStreamSubscribeHandler(IpcChannel.AgentSessionStream_Subscribe, IpcChannel.AgentSessionStream_Chunk)
  registerStreamUnsubscribeHandler(IpcChannel.AgentSessionStream_Subscribe, IpcChannel.AgentSessionStream_Unsubscribe)
  registerAbortHandler(IpcChannel.AgentSessionStream_Abort)

  registerStreamSubscribeHandler(CherryChannels.SessionStreamSubscribe, CherryChannels.SessionStreamChunk)
  registerStreamUnsubscribeHandler(CherryChannels.SessionStreamSubscribe, CherryChannels.SessionStreamUnsubscribe)
  registerAbortHandler(CherryChannels.SessionAbort)

  ipcMain.handle(LegacyChannels.SessionAbort, async (_event, { sessionId }: { sessionId: string }) => {
    const handler = await getChannelMessageHandler()
    return { success: handler ? handler.abortSession(sessionId) : false }
  })

  const handleSessionGet = async (_event: unknown, payload: any = {}) => {
    try {
      const sessionId = String(payload?.sessionId || '').trim()
      if (!sessionId) return { ok: false, error: 'sessionId is required' }
      const session = await resolveSessionById(sessionId, payload?.agent_id)
      if (!session) return { ok: false, error: 'session not found' }
      return { ok: true, session }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  const handleSessionUpdate = async (_event: unknown, payload: any = {}) => {
    try {
      const sessionId = String(payload?.sessionId || payload?.id || '').trim()
      if (!sessionId) return { ok: false, error: 'sessionId is required' }
      const existing = await resolveSessionById(sessionId, payload?.agent_id)
      if (!existing) return { ok: false, error: 'session not found' }

      const { sessionId: _sessionId, id: _id, ...updates } = payload || {}
      if (existing.agent_id === DEFAULT_RUNTIME_AGENT_ID) {
        const ensured = await ensureDefaultAgentExists(String(updates?.model || '').trim())
        if (!ensured) return { ok: false, error: 'Agent not found' }
      }
      const session = await sessionService.updateSession(existing.agent_id, sessionId, updates)
      if (!session) return { ok: false, error: 'session not found' }
      broadcastSessionChanged(existing.agent_id, sessionId, true)
      return { ok: true, session }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  const handleSessionList = async (_event: unknown, payload: any = {}) => {
    try {
      const agentId = String(payload?.agent_id || '').trim() || undefined
      const { sessions, total } = await sessionService.listSessions(agentId)
      return { ok: true, sessions, total }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error), sessions: [] }
    }
  }

  const handleSessionMessageList = async (_event: unknown, payload: any = {}) => {
    try {
      const sessionId = String(payload?.sessionId || '').trim()
      if (!sessionId) return { ok: false, error: 'sessionId is required', messages: [] }
      const sessionMessageService = await getSessionMessageService()
      const { messages } = await sessionMessageService.listSessionMessages(sessionId)
      return { ok: true, messages }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error), messages: [] }
    }
  }

  const handleSessionMessageCreate = async (_event: unknown, payload: any = {}) => {
    try {
      const sessionId = String(payload?.sessionId || '').trim()
      const content = String(payload?.content || '').trim()
      const requestId = String(payload?.requestId || '').trim() || randomUUID()
      const createdAt =
        typeof payload?.createdAt === 'number' && Number.isFinite(payload.createdAt)
          ? Math.floor(payload.createdAt)
          : undefined
      const images = Array.isArray(payload?.images)
        ? payload.images.filter(
            (item: unknown): item is { data: string; media_type: string } =>
              !!item &&
              typeof item === 'object' &&
              typeof (item as { data?: unknown }).data === 'string' &&
              typeof (item as { media_type?: unknown }).media_type === 'string'
          )
        : undefined
      const draftInspectRequest =
        payload?.draftInspectRequest && typeof payload.draftInspectRequest === 'object'
          ? payload.draftInspectRequest as Record<string, unknown>
          : undefined
      const subtitleStoryboardRequest =
        payload?.subtitleStoryboardRequest && typeof payload.subtitleStoryboardRequest === 'object'
          ? { ...payload.subtitleStoryboardRequest, requestId }
          : undefined
      if (!sessionId) return { ok: false, error: 'sessionId is required' }
      if (!content) return { ok: false, error: 'content is required' }

      let session = await resolveSessionById(sessionId, payload?.agent_id)
      if (!session) return { ok: false, error: 'session not found' }
      const sessionMessageService = await getSessionMessageService()
      const rawModel = String(payload?.model || '').trim()
      if (session.agent_id === DEFAULT_RUNTIME_AGENT_ID) {
        const ensured = await ensureDefaultAgentExists(rawModel)
        if (!ensured) return { ok: false, error: 'Agent not found' }
      }
      const normalizedModel = await normalizeProviderModelId(rawModel)
      const effectiveModel = normalizedModel || rawModel
      logger.info('[SessionStreamIpc] SessionMessageCreate model resolved', {
        sessionId,
        rawModel,
        normalizedModel,
        effectiveModel,
        imageCount: images?.length ?? 0
      })
      if (effectiveModel && effectiveModel !== String(session.model || '').trim()) {
        const updatedSession = await sessionService.updateSession(session.agent_id, sessionId, {
          model: effectiveModel
        })
        if (updatedSession) {
          session = updatedSession
        }
      }

      sessionStreamBus.publish(sessionId, {
        sessionId,
        agentId: session.agent_id,
        requestId,
        type: 'started'
      })
      const streamStartedAt = Date.now()
      let stream: ReadableStream<any> | undefined
      let streamFinished: Promise<void> | undefined
      let completion: Promise<any> | undefined

      for (let attemptIndex = 0; attemptIndex <= SESSION_MESSAGE_START_RETRY_LIMIT; attemptIndex += 1) {
        if (isRequestCancelled(requestId)) {
          const activeRequest = activeAbortControllers.get(sessionId)
          if (activeRequest?.requestId === requestId) {
            activeAbortControllers.delete(sessionId)
          }
          return { ok: true, requestId }
        }
        const attemptNumber = attemptIndex + 1
        const abortController = new AbortController()
        activeAbortControllers.set(sessionId, { controller: abortController, requestId })

        try {
          const startedStream = await createSessionMessageWithTimeout(
            sessionMessageService.createSessionMessage(
              session,
              {
                content,
                model: effectiveModel || undefined,
                createdAt,
                effort: payload?.effort,
                thinking: payload?.thinking
              },
              abortController,
              {
                persist: true,
                displayContent: content,
                images,
                userMessageExtras: {
                  ...(draftInspectRequest ? { draftInspectRequest } : {}),
                  ...(subtitleStoryboardRequest ? { subtitleStoryboardRequest } : {})
                }
              }
            ),
            SESSION_MESSAGE_START_TIMEOUT_MS,
            abortController.signal
          )
          stream = startedStream.stream
          streamFinished = startedStream.streamFinished
          completion = startedStream.completion
          break
        } catch (error) {
          const errorObj = error instanceof Error ? error : new Error(String(error))
          const requestCancelled = isRequestCancelled(requestId) || abortController.signal.aborted
          if (requestCancelled) {
            const activeRequest = activeAbortControllers.get(sessionId)
            if (activeRequest?.requestId === requestId) {
              activeAbortControllers.delete(sessionId)
            }
            return { ok: true, requestId }
          }
          const shouldRetry =
            attemptIndex < SESSION_MESSAGE_START_RETRY_LIMIT
            && isRetriableSessionStartError(errorObj)

          if (!shouldRetry) {
            throw errorObj
          }

          if (!abortController.signal.aborted) {
            abortController.abort()
          }
          logger.warn('[SessionStreamIpc] createSessionMessage startup failed before first stream, scheduling retry', {
            sessionId,
            requestId,
            attempt: attemptNumber,
            maxRetries: SESSION_MESSAGE_START_RETRY_LIMIT,
            error: errorObj.message
          })
          sessionStreamBus.publish(sessionId, {
            sessionId,
            agentId: session.agent_id,
            requestId,
            type: 'chunk',
            chunk: {
              type: 'retry-status',
              attempt: attemptNumber,
              maxRetries: SESSION_MESSAGE_START_RETRY_LIMIT,
              text: buildRetryStatusText(attemptNumber, SESSION_MESSAGE_START_RETRY_LIMIT)
            } as any
          })
          await waitForRetryDelay(SESSION_MESSAGE_START_RETRY_BASE_DELAY_MS * attemptNumber)
          if (isRequestCancelled(requestId)) {
            const activeRequest = activeAbortControllers.get(sessionId)
            if (activeRequest?.requestId === requestId) {
              activeAbortControllers.delete(sessionId)
            }
            return { ok: true, requestId }
          }
        }
      }

      if (!stream || !streamFinished || !completion) {
        throw new Error('Session message stream did not initialize after retries')
      }
      logger.info('[SessionStreamIpc][TRACE] createSessionMessage resolved', {
        sessionId,
        elapsedMs: Date.now() - streamStartedAt
      })
      void streamFinished.then(() => {
        if (isRequestCancelled(requestId)) {
          return
        }
        logger.info('[SessionStreamIpc] Publishing stream-finished event to session stream bus', {
          sessionId,
          requestId,
          hasSubscribers: sessionStreamBus.hasSubscribers(sessionId),
          subscriberCount: sessionStreamBus.subscriberCount(sessionId)
        })
        sessionStreamBus.publish(sessionId, {
          sessionId,
          agentId: session.agent_id,
          requestId,
          type: 'stream-finished'
        })
      })

      void (async () => {
        try {
          const reader = stream.getReader()
          let chunkCount = 0
          let firstChunkLogged = false
          const firstChunkWarnTimer = setTimeout(() => {
            if (firstChunkLogged) return
            logger.warn('[SessionStreamIpc][TRACE] waiting too long for first chunk', {
              sessionId,
              requestId,
              waitMs: Date.now() - streamStartedAt,
              hasSubscribers: sessionStreamBus.hasSubscribers(sessionId),
              subscriberCount: sessionStreamBus.subscriberCount(sessionId)
            })
          }, 8000)
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (isRequestCancelled(requestId)) {
              break
            }
            chunkCount += 1
            if (!firstChunkLogged) {
              firstChunkLogged = true
              clearTimeout(firstChunkWarnTimer)
              logger.info('[SessionStreamIpc][TRACE] first chunk received', {
                sessionId,
                requestId,
                elapsedMs: Date.now() - streamStartedAt,
                chunkType: (value as any)?.type || '',
                hasSubscribers: sessionStreamBus.hasSubscribers(sessionId),
                subscriberCount: sessionStreamBus.subscriberCount(sessionId)
              })
            }
            sessionStreamBus.publish(sessionId, {
              sessionId,
              agentId: session.agent_id,
              requestId,
              type: 'chunk',
              chunk: value
            })
          }
          clearTimeout(firstChunkWarnTimer)
          if (isRequestCancelled(requestId)) {
            await completion.catch(() => undefined)
            return
          }
          logger.info('[SessionStreamIpc][TRACE] reader loop completed', {
            sessionId,
            requestId,
            chunkCount,
            elapsedMs: Date.now() - streamStartedAt
          })
          const completionResult = await completion
          const persistedAssistantBlocks = Array.isArray(
            (completionResult?.assistantMessage as any)?.content?.blocks
          )
            ? ((completionResult?.assistantMessage as any).content.blocks as unknown[])
            : []
          logger.info('[SessionStreamIpc] Headless completion persisted', {
            sessionId,
            requestId,
            userMessageId: completionResult?.userMessage?.id,
            assistantMessageId: completionResult?.assistantMessage?.id,
            persistedAssistantBlockCount: persistedAssistantBlocks.length,
            persistedAssistantBlockTypes: persistedAssistantBlocks.map((block: any) => String(block?.type || 'unknown')),
            persistedAssistantTextChars: persistedAssistantBlocks.reduce((total: number, block: any) => {
              return total + (typeof block?.content === 'string' ? block.content.length : 0)
            }, 0)
          })
          logger.info('[SessionStreamIpc] Publishing complete event to session stream bus', {
            sessionId,
            requestId,
            hasSubscribers: sessionStreamBus.hasSubscribers(sessionId),
            subscriberCount: sessionStreamBus.subscriberCount(sessionId)
          })
          // Persist runs in main process for this IPC route, so force renderer
          // to reload from DB to pick up non-text blocks (e.g. tool blocks).
          broadcastSessionChanged(session.agent_id, sessionId, true)
          sessionStreamBus.publish(sessionId, {
            sessionId,
            agentId: session.agent_id,
            requestId,
            type: 'complete'
          })
        } catch (error) {
          if (isRequestCancelled(requestId)) {
            return
          }
          sessionStreamBus.publish(sessionId, {
            sessionId,
            agentId: session.agent_id,
            requestId,
            type: 'error',
            error: { message: error instanceof Error ? error.message : String(error) }
          })
        } finally {
          const activeRequest = activeAbortControllers.get(sessionId)
          if (activeRequest?.requestId === requestId) {
            activeAbortControllers.delete(sessionId)
          }
          clearCancelledRequest(requestId)
        }
      })()

      return { ok: true, requestId }
    } catch (error) {
      const sessionId = String(payload?.sessionId || '').trim()
      const requestId = String(payload?.requestId || '').trim()
      const activeRequest = sessionId ? activeAbortControllers.get(sessionId) : undefined
      if (activeRequest && (!requestId || activeRequest.requestId === requestId)) {
        activeAbortControllers.delete(sessionId)
      }
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  const handleDraftRequest = async (_event: unknown, payload: DirectDraftRequestPayload = {} as DirectDraftRequestPayload) => {
    try {
      const sessionId = String(payload?.sessionId || '').trim()
      if (!sessionId) return { ok: false, error: 'sessionId is required' }

      const session = await resolveSessionById(sessionId, payload?.agent_id as string | undefined)
      if (!session) return { ok: false, error: 'session not found' }

      const draftRequest = payload?.draftRequest && typeof payload.draftRequest === 'object'
        ? payload.draftRequest
        : {}
      const action = draftRequest.action === 'create' ? 'create' : 'create'
      if (action !== 'create') {
        return { ok: false, error: 'unsupported draft request action' }
      }

      const width = normalizeDirectDraftDimension(draftRequest.width)
      const height = normalizeDirectDraftDimension(draftRequest.height)
      const name = String(draftRequest.name || '').trim()
      const cover = String(draftRequest.cover || '').trim()
      const userContent = String(payload?.userContent || '').trim()
      const createdAtMs =
        typeof payload?.createdAt === 'number' && Number.isFinite(payload.createdAt)
          ? Math.floor(payload.createdAt)
          : Date.now()
      const createdAtIso = new Date(createdAtMs).toISOString()
      const assistantMessageId = String(payload?.assistantMessageId || '').trim() || randomUUID()
      const userMessageId = String(payload?.userMessageId || '').trim() || randomUUID()
      const requestId = String(payload?.requestId || '').trim() || randomUUID()
      const modelId = String(payload?.model || session?.model || '').trim()

      const toolArgs: Record<string, unknown> = {}
      if (width) toolArgs.width = width
      if (height) toolArgs.height = height
      if (name) toolArgs.name = name
      if (cover) toolArgs.cover = cover
      const normalizedDraftRequest = {
        action: 'create',
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
        ...(name ? { name } : {}),
        ...(cover ? { cover } : {})
      }

      const toolCallId = `draft_request_${requestId}`
      const toolResult = await callDraftManagementTool('create_draft', toolArgs)
      const toolResponse = parseDraftResultText(toolResult)
      const assistantText = buildDirectDraftAssistantText({
        action,
        width,
        height,
        name,
        cover,
        toolResponse
      })
      const assistantBlocks = buildDirectDraftAssistantBlocks({
        assistantMessageId,
        modelId,
        toolCallId,
        toolArgs,
        toolResponse,
        assistantText,
        createdAtIso
      })

      const activeSegment = await ensureDirectRequestSegment(session)
      const turnId = `turn_${randomUUID()}`
      await agentTurnRepository.save({
        id: turnId,
        topicId: session.id,
        segmentId: activeSegment.id,
        userMessageId,
        assistantMessageId,
        userText: userContent,
        assistantText,
        startedAt: createdAtIso,
        completedAt: createdAtIso,
        status: 'completed'
      })

      const topicId = `agent-session:${session.id}`
      const persisted = await agentMessageRepository.persistExchange({
        sessionId: session.id,
        agentSessionId: session.id,
        user: {
          createdAt: createdAtIso,
          payload: {
            message: {
              id: userMessageId,
              role: 'user',
              assistantId: session.agent_id,
              topicId,
              createdAt: createdAtIso,
              status: 'success',
              draftRequest: normalizedDraftRequest,
              blocks: [
                `${userMessageId}-main`
              ]
            },
            blocks: [
              {
                id: `${userMessageId}-main`,
                messageId: userMessageId,
                type: 'main_text',
                createdAt: createdAtIso,
                status: 'success',
                content: userContent
              }
            ]
          } as any
        },
        assistant: {
          createdAt: createdAtIso,
          payload: {
            message: {
              id: assistantMessageId,
              role: 'assistant',
              assistantId: session.agent_id,
              topicId,
              createdAt: createdAtIso,
              updatedAt: createdAtIso,
              status: 'success',
              blocks: assistantBlocks.map((block) => block.id),
              modelId
            },
            blocks: assistantBlocks
          } as any
        }
      })

      broadcastSessionChanged(session.agent_id, session.id, true)

      return {
        ok: true,
        requestId,
        toolResponse,
        assistantText,
        assistantBlocks,
        persisted
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  const handleDraftExportRequest = async (_event: unknown, payload: DirectDraftRequestPayload = {} as DirectDraftRequestPayload) => {
    try {
      const sessionId = String(payload?.sessionId || '').trim()
      if (!sessionId) return { ok: false, error: 'sessionId is required' }

      const session = await resolveSessionById(sessionId, payload?.agent_id as string | undefined)
      if (!session) return { ok: false, error: 'session not found' }

      const normalizedDraftExportRequest = normalizeDirectDraftExportRequest(
        payload?.draftExportRequest && typeof payload.draftExportRequest === 'object'
          ? payload.draftExportRequest as Record<string, unknown>
          : {}
      )
      const drafts = normalizedDraftExportRequest.drafts
      const userContent = String(payload?.userContent || '').trim()
      const createdAtMs =
        typeof payload?.createdAt === 'number' && Number.isFinite(payload.createdAt)
          ? Math.floor(payload.createdAt)
          : Date.now()
      const createdAtIso = new Date(createdAtMs).toISOString()
      const assistantMessageId = String(payload?.assistantMessageId || '').trim() || randomUUID()
      const userMessageId = String(payload?.userMessageId || '').trim() || randomUUID()
      const requestId = String(payload?.requestId || '').trim() || randomUUID()
      const modelId = String(payload?.model || session?.model || '').trim()
      const toolCallId = `draft_export_request_${requestId}`
      const toolArgs: Record<string, unknown> = drafts.length === 1
        ? { ...drafts[0] }
        : { drafts: drafts.map((item) => ({ ...item })) }

      const toolResult = await callDraftDownloadTool('export_draft', toolArgs)
      const toolResponse = parseDraftResultText(toolResult)
      const assistantText = buildDirectDraftExportAssistantText({ drafts })
      const assistantBlocks = buildDirectDraftExportAssistantBlocks({
        assistantMessageId,
        modelId,
        toolCallId,
        toolArgs,
        toolResponse,
        assistantText,
        createdAtIso
      })

      const activeSegment = await ensureDirectRequestSegment(session)
      const turnId = `turn_${randomUUID()}`
      await agentTurnRepository.save({
        id: turnId,
        topicId: session.id,
        segmentId: activeSegment.id,
        userMessageId,
        assistantMessageId,
        userText: userContent,
        assistantText,
        startedAt: createdAtIso,
        completedAt: createdAtIso,
        status: 'completed'
      })

      const topicId = `agent-session:${session.id}`
      const persisted = await agentMessageRepository.persistExchange({
        sessionId: session.id,
        agentSessionId: session.id,
        user: {
          createdAt: createdAtIso,
          payload: {
            message: {
              id: userMessageId,
              role: 'user',
              assistantId: session.agent_id,
              topicId,
              createdAt: createdAtIso,
              status: 'success',
              draftExportRequest: normalizedDraftExportRequest,
              blocks: [
                `${userMessageId}-main`
              ]
            },
            blocks: [
              {
                id: `${userMessageId}-main`,
                messageId: userMessageId,
                type: 'main_text',
                createdAt: createdAtIso,
                status: 'success',
                content: userContent
              }
            ]
          } as any
        },
        assistant: {
          createdAt: createdAtIso,
          payload: {
            message: {
              id: assistantMessageId,
              role: 'assistant',
              assistantId: session.agent_id,
              topicId,
              createdAt: createdAtIso,
              updatedAt: createdAtIso,
              status: 'success',
              content: assistantText,
              blocks: assistantBlocks.map((block) => block.id)
            },
            blocks: assistantBlocks
          } as any
        }
      })

      broadcastSessionChanged(session.agent_id, session.id, true)
      return {
        ok: true,
        assistantText,
        assistantBlocks,
        persisted
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('handleDraftExportRequest failed', { error: message })
      return { ok: false, error: message }
    }
  }

  const handleDraftDownloadRequest = async (_event: unknown, payload: DirectDraftRequestPayload = {} as DirectDraftRequestPayload) => {
    try {
      const sessionId = String(payload?.sessionId || '').trim()
      if (!sessionId) return { ok: false, error: 'sessionId is required' }

      const session = await resolveSessionById(sessionId, payload?.agent_id as string | undefined)
      if (!session) return { ok: false, error: 'session not found' }

      const normalizedDraftDownloadRequest = normalizeDirectDraftDownloadRequest(
        payload?.draftDownloadRequest && typeof payload.draftDownloadRequest === 'object'
          ? payload.draftDownloadRequest as Record<string, unknown>
          : {}
      )
      const drafts = normalizedDraftDownloadRequest.drafts
      const userContent = String(payload?.userContent || '').trim()
      const createdAtMs =
        typeof payload?.createdAt === 'number' && Number.isFinite(payload.createdAt)
          ? Math.floor(payload.createdAt)
          : Date.now()
      const createdAtIso = new Date(createdAtMs).toISOString()
      const assistantMessageId = String(payload?.assistantMessageId || '').trim() || randomUUID()
      const userMessageId = String(payload?.userMessageId || '').trim() || randomUUID()
      const requestId = String(payload?.requestId || '').trim() || randomUUID()
      const modelId = String(payload?.model || session?.model || '').trim()
      const toolCallId = `draft_download_request_${requestId}`
      const toolArgs: Record<string, unknown> = drafts.length === 1
        ? { ...drafts[0] }
        : { drafts: drafts.map((item) => ({ ...item })) }

      const toolResult = await callDraftDownloadTool('download_draft', toolArgs)
      const toolResponse = parseDraftResultText(toolResult)
      const assistantText = buildDirectDraftDownloadAssistantText({ drafts })
      const assistantBlocks = buildDirectDraftDownloadAssistantBlocks({
        assistantMessageId,
        modelId,
        toolCallId,
        toolArgs,
        toolResponse,
        assistantText,
        createdAtIso
      })

      const activeSegment = await ensureDirectRequestSegment(session)
      const turnId = `turn_${randomUUID()}`
      await agentTurnRepository.save({
        id: turnId,
        topicId: session.id,
        segmentId: activeSegment.id,
        userMessageId,
        assistantMessageId,
        userText: userContent,
        assistantText,
        startedAt: createdAtIso,
        completedAt: createdAtIso,
        status: 'completed'
      })

      const topicId = `agent-session:${session.id}`
      const persisted = await agentMessageRepository.persistExchange({
        sessionId: session.id,
        agentSessionId: session.id,
        user: {
          createdAt: createdAtIso,
          payload: {
            message: {
              id: userMessageId,
              role: 'user',
              assistantId: session.agent_id,
              topicId,
              createdAt: createdAtIso,
              status: 'success',
              draftDownloadRequest: normalizedDraftDownloadRequest,
              blocks: [
                `${userMessageId}-main`
              ]
            },
            blocks: [
              {
                id: `${userMessageId}-main`,
                messageId: userMessageId,
                type: 'main_text',
                createdAt: createdAtIso,
                status: 'success',
                content: userContent
              }
            ]
          } as any
        },
        assistant: {
          createdAt: createdAtIso,
          payload: {
            message: {
              id: assistantMessageId,
              role: 'assistant',
              assistantId: session.agent_id,
              topicId,
              createdAt: createdAtIso,
              updatedAt: createdAtIso,
              status: 'success',
              blocks: assistantBlocks.map((block) => block.id),
              modelId
            },
            blocks: assistantBlocks
          } as any
        }
      })

      broadcastSessionChanged(session.agent_id, session.id, true)

      return {
        ok: true,
        requestId,
        toolResponse,
        assistantText,
        assistantBlocks,
        persisted
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  const handleDraftModifyRequest = async (_event: unknown, payload: DirectDraftRequestPayload = {} as DirectDraftRequestPayload) => {
    try {
      const sessionId = String(payload?.sessionId || '').trim()
      if (!sessionId) return { ok: false, error: 'sessionId is required' }

      const session = await resolveSessionById(sessionId, payload?.agent_id as string | undefined)
      if (!session) return { ok: false, error: 'session not found' }

      const normalizedDraftModifyRequest = normalizeDirectDraftModifyRequest(
        payload?.draftModifyRequest && typeof payload.draftModifyRequest === 'object'
          ? payload.draftModifyRequest as Record<string, unknown>
          : {}
      )
      const draftId = normalizedDraftModifyRequest.draftId
      const name = String(normalizedDraftModifyRequest.name || '').trim()
      const cover = String(normalizedDraftModifyRequest.cover || '').trim()
      const userContent = String(payload?.userContent || '').trim()
      const createdAtMs =
        typeof payload?.createdAt === 'number' && Number.isFinite(payload.createdAt)
          ? Math.floor(payload.createdAt)
          : Date.now()
      const createdAtIso = new Date(createdAtMs).toISOString()
      const assistantMessageId = String(payload?.assistantMessageId || '').trim() || randomUUID()
      const userMessageId = String(payload?.userMessageId || '').trim() || randomUUID()
      const requestId = String(payload?.requestId || '').trim() || randomUUID()
      const modelId = String(payload?.model || session?.model || '').trim()
      const toolCallId = `draft_modify_request_${requestId}`
      const toolArgs: Record<string, unknown> = {
        draftId,
        ...(name ? { name } : {}),
        ...(cover ? { cover } : {})
      }

      const toolResult = await callDraftManagementTool('modify_draft', toolArgs)
      const toolResponse = parseDraftResultText(toolResult)
      const assistantText = buildDirectDraftModifyAssistantText({
        draftId,
        name,
        cover
      })
      const assistantBlocks = buildDirectDraftModifyAssistantBlocks({
        assistantMessageId,
        modelId,
        toolCallId,
        toolArgs,
        toolResponse,
        assistantText,
        createdAtIso
      })

      const activeSegment = await ensureDirectRequestSegment(session)
      const turnId = `turn_${randomUUID()}`
      await agentTurnRepository.save({
        id: turnId,
        topicId: session.id,
        segmentId: activeSegment.id,
        userMessageId,
        assistantMessageId,
        userText: userContent,
        assistantText,
        startedAt: createdAtIso,
        completedAt: createdAtIso,
        status: 'completed'
      })

      const topicId = `agent-session:${session.id}`
      const persisted = await agentMessageRepository.persistExchange({
        sessionId: session.id,
        agentSessionId: session.id,
        user: {
          createdAt: createdAtIso,
          payload: {
            message: {
              id: userMessageId,
              role: 'user',
              assistantId: session.agent_id,
              topicId,
              createdAt: createdAtIso,
              status: 'success',
              draftModifyRequest: normalizedDraftModifyRequest,
              blocks: [
                `${userMessageId}-main`
              ]
            },
            blocks: [
              {
                id: `${userMessageId}-main`,
                messageId: userMessageId,
                type: 'main_text',
                createdAt: createdAtIso,
                status: 'success',
                content: userContent
              }
            ]
          } as any
        },
        assistant: {
          createdAt: createdAtIso,
          payload: {
            message: {
              id: assistantMessageId,
              role: 'assistant',
              assistantId: session.agent_id,
              topicId,
              createdAt: createdAtIso,
              updatedAt: createdAtIso,
              status: 'success',
              blocks: assistantBlocks.map((block) => block.id),
              modelId
            },
            blocks: assistantBlocks
          } as any
        }
      })

      broadcastSessionChanged(session.agent_id, session.id, true)

      return {
        ok: true,
        requestId,
        toolResponse,
        assistantText,
        assistantBlocks,
        persisted
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  const handleTextAddRequest = async (_event: unknown, payload: DirectDraftRequestPayload = {} as DirectDraftRequestPayload) => {
    try {
      const sessionId = String(payload?.sessionId || '').trim()
      if (!sessionId) return { ok: false, error: 'sessionId is required' }

      const session = await resolveSessionById(sessionId, payload?.agent_id as string | undefined)
      if (!session) return { ok: false, error: 'session not found' }

      const normalizedTextAddRequest = normalizeDirectTextAddRequest(
        payload?.textAddRequest && typeof payload.textAddRequest === 'object'
          ? payload.textAddRequest as Record<string, unknown>
          : {},
        String(payload?.userContent || '').trim()
      )
      const draftId = String(normalizedTextAddRequest?.draft_id || '').trim()
      const text = String(normalizedTextAddRequest?.text || '').trim()
      const start = Number(normalizedTextAddRequest?.start || 0)
      const end = Number(normalizedTextAddRequest?.end || 0)
      const userContent = String(payload?.userContent || '').trim()
      const createdAtMs =
        typeof payload?.createdAt === 'number' && Number.isFinite(payload.createdAt)
          ? Math.floor(payload.createdAt)
          : Date.now()
      const createdAtIso = new Date(createdAtMs).toISOString()
      const assistantMessageId = String(payload?.assistantMessageId || '').trim() || randomUUID()
      const userMessageId = String(payload?.userMessageId || '').trim() || randomUUID()
      const requestId = String(payload?.requestId || '').trim() || randomUUID()
      const modelId = String(payload?.model || session?.model || '').trim()
      const toolCallId = `text_add_request_${requestId}`
      const toolArgs: Record<string, unknown> = { ...normalizedTextAddRequest }

      const toolResult = await callDraftElementsTool('add_text', toolArgs)
      const toolResponse = parseDraftResultText(toolResult)
      const errorCode = String(toolResponse?.error_code || '').trim()
      const errorMessage = String(toolResponse?.error || '').trim()
      const responseSuccess = toolResponse?.success !== false && !errorCode
      const assistantText = responseSuccess
        ? buildDirectTextAddAssistantText({
            draftId,
            text,
            start,
            end
          })
        : buildDirectTextAddErrorAssistantText({
            draftId,
            text,
            errorCode
          })
      const assistantBlocks = buildDirectTextAddAssistantBlocks({
        assistantMessageId,
        modelId,
        toolCallId,
        toolArgs,
        toolResponse,
        assistantText,
        createdAtIso,
        status: responseSuccess ? 'success' : 'error'
      })

      const activeSegment = await ensureDirectRequestSegment(session)
      const turnId = `turn_${randomUUID()}`
      await agentTurnRepository.save({
        id: turnId,
        topicId: session.id,
        segmentId: activeSegment.id,
        userMessageId,
        assistantMessageId,
        userText: userContent,
        assistantText,
        startedAt: createdAtIso,
        completedAt: createdAtIso,
        status: 'completed'
      })

      const topicId = `agent-session:${session.id}`
      const persisted = await agentMessageRepository.persistExchange({
        sessionId: session.id,
        agentSessionId: session.id,
        user: {
          createdAt: createdAtIso,
          payload: {
            message: {
              id: userMessageId,
              role: 'user',
              assistantId: session.agent_id,
              topicId,
              createdAt: createdAtIso,
              status: 'success',
              textAddRequest: normalizedTextAddRequest,
              blocks: [
                `${userMessageId}-main`
              ]
            },
            blocks: [
              {
                id: `${userMessageId}-main`,
                messageId: userMessageId,
                type: 'main_text',
                createdAt: createdAtIso,
                status: 'success',
                content: userContent
              }
            ]
          } as any
        },
        assistant: {
          createdAt: createdAtIso,
          payload: {
            message: {
              id: assistantMessageId,
              role: 'assistant',
              assistantId: session.agent_id,
              topicId,
              createdAt: createdAtIso,
              updatedAt: createdAtIso,
              status: responseSuccess ? 'success' : 'error',
              blocks: assistantBlocks.map((block) => block.id),
              modelId
            },
            blocks: assistantBlocks
          } as any
        }
      })

      broadcastSessionChanged(session.agent_id, session.id, true)

      return {
        ok: true,
        requestId,
        toolResponse,
        assistantText,
        assistantBlocks,
        persisted
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  const handleReversePromptRequest = async (_event: unknown, payload: DirectDraftRequestPayload) => {
    const sessionId = String(payload?.sessionId || '').trim()
    const requestId = String(payload?.requestId || '').trim() || randomUUID()
    const controller = new AbortController()
    try {
      const isSubtitle = Boolean(payload?.subtitleRecognitionRequest)
      const request = isSubtitle
        ? normalizeSubtitleRecognitionRequest(payload.subtitleRecognitionRequest)
        : normalizeReversePromptRequest(payload?.reversePromptRequest)
      const session = await resolveSessionById(sessionId, payload?.agent_id)
      if (!session) throw new Error('session not found')
      if (activeAbortControllers.has(sessionId)) throw new Error('当前会话已有任务正在执行')
      activeAbortControllers.set(sessionId, { controller, requestId })
      const assistantMessageId = payload.assistantMessageId || randomUUID()
      const userMessageId = payload.userMessageId || randomUUID()
      const createdAt = new Date(payload.createdAt || Date.now()).toISOString()
      const modelId = String(payload.model || session.model || '')
      let workspacePath: string | undefined
      if (isSubtitle) {
        workspacePath = (session.configuration as any)?.selected_workspace_path || session.accessible_paths?.[0]
        if (!workspacePath) {
          workspacePath = path.join(getDefaultAgentWorkspacePath(session.agent_id), session.id)
          fs.mkdirSync(workspacePath, { recursive: true })
          await sessionService.updateSession(session.agent_id, session.id, {
            accessible_paths: [workspacePath],
            configuration: { ...session.configuration, selected_workspace_path: workspacePath } as any
          })
        }
      }
      const server = isSubtitle ? new SubtitleRecognitionServer(workspacePath) : new SocialCopywritingServer()
      let parsed
      let failure: string | undefined
      try {
        const callTool = (server.mcpServer.server as any)?._requestHandlers?.get('tools/call')
        if (typeof callTool !== 'function') throw new Error(isSubtitle ? '字幕识别工具未注册' : '反推提示词工具未注册')
        const result = isSubtitle ? await (server as SubtitleRecognitionServer).executeDirectRequest(request, {
          signal: controller.signal, requestId,
          _meta: { progressToken: `subtitle_recognition_request_${requestId}` },
          sendNotification: async (notification) => {
            windowService.getMainWindow()?.webContents.send(IpcChannel.Mcp_Progress, {
              callId: `subtitle_recognition_request_${requestId}`,
              progress: notification.params.progress / (notification.params.total || 100),
              message: notification.params.message
            })
          }
        }) : await callTool({
          method: 'tools/call',
          params: { name: 'derive_copy_prompt', arguments: request }
        }, {
          signal: controller.signal,
          requestId,
          toolCallId: `reverse_prompt_request_${requestId}`,
          sendNotification: async () => {}
        })
        if (controller.signal.aborted) return { ok: false, aborted: true }
        try {
          parsed = isSubtitle ? parseSubtitleRecognitionResult(result, request) : parseReversePromptResult(result)
        } catch (error) {
          const toolResponse = (error as Error & { toolResponse?: Record<string, unknown> }).toolResponse
          if (!toolResponse) throw error
          failure = error instanceof Error ? error.message : String(error)
          parsed = { response: toolResponse, assistantText: isSubtitle ? `字幕识别失败：${failure}` : '' }
        }
      } finally {
        await server.mcpServer.close()
      }
      const { response, assistantText } = parsed
      const assistantBlocks = (isSubtitle ? buildSubtitleRecognitionBlocks : buildReversePromptBlocks)({
        assistantMessageId, requestId, request, modelId, createdAt,
        status: failure ? 'error' : 'success', response, assistantText
      })
      const activeSegment = await ensureDirectRequestSegment(session)
      if (controller.signal.aborted) return { ok: false, aborted: true }
      const completedAt = new Date().toISOString()
      await agentTurnRepository.save({
        id: `turn_${randomUUID()}`, topicId: session.id, segmentId: activeSegment.id,
        userMessageId, assistantMessageId, userText: String(payload.userContent || ''),
        assistantText, startedAt: createdAt, completedAt, status: failure ? 'failed' : 'completed'
      })
      const topicId = `agent-session:${session.id}`
      await agentMessageRepository.persistExchange({
        sessionId: session.id,
        agentSessionId: session.id,
        user: {
          createdAt,
          payload: {
            message: {
              id: userMessageId, role: 'user', assistantId: session.agent_id, topicId,
              createdAt, status: 'success',
              [isSubtitle ? 'subtitleRecognitionRequest' : 'reversePromptRequest']: { ...request, requestId },
              blocks: [`${userMessageId}-main`]
            },
            blocks: [{
              id: `${userMessageId}-main`, messageId: userMessageId, type: 'main_text',
              createdAt, status: 'success', content: String(payload.userContent || '')
            }]
          } as any
        },
        assistant: {
          createdAt,
          payload: {
            message: {
              id: assistantMessageId, role: 'assistant', assistantId: session.agent_id, topicId,
              createdAt, updatedAt: completedAt, status: failure ? 'error' : 'success', modelId,
              ...(failure ? { error: { message: failure } } : {}),
              blocks: assistantBlocks.map((block) => block.id)
            },
            blocks: assistantBlocks
          } as any
        }
      })
      broadcastSessionChanged(session.agent_id, session.id, true)
      return { ok: !failure, ...(failure ? { error: failure } : {}), assistantText, assistantBlocks }
    } catch (error) {
      return { ok: false, aborted: controller.signal.aborted, error: error instanceof Error ? error.message : String(error) }
    } finally {
      if (activeAbortControllers.get(sessionId)?.controller === controller) {
        activeAbortControllers.delete(sessionId)
      }
    }
  }

  const handleSessionCreate = async (_event: unknown, payload: any = {}) => {
    try {
      const agentId = String(payload?.agent_id || DEFAULT_RUNTIME_AGENT_ID).trim() || DEFAULT_RUNTIME_AGENT_ID
      const { agent_id, ...req } = payload || {}
      const normalizedReq: any = { ...req }
      const rawModel = String(normalizedReq?.model || '').trim()
      const normalizedModel = await normalizeProviderModelId(rawModel)
      const effectiveModel = normalizedModel || rawModel
      if (effectiveModel) {
        normalizedReq.model = effectiveModel
      } else {
        delete normalizedReq.model
      }

      if (!Array.isArray(normalizedReq.accessible_paths)) {
        normalizedReq.accessible_paths = []
      }

      if (agentId === DEFAULT_RUNTIME_AGENT_ID) {
        const ensured = await ensureDefaultAgentExists(normalizedReq.model)
        if (!ensured) {
          return { ok: false, error: 'Agent not found' }
        }
      }

      const session = await sessionService.createSession(agentId, normalizedReq)
      return { ok: true, session }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  ipcMain.handle(LegacyChannels.SessionCreate, handleSessionCreate)
  ipcMain.handle(LegacyChannels.SessionGet, handleSessionGet)
  ipcMain.handle(LegacyChannels.SessionList, handleSessionList)
  ipcMain.handle(LegacyChannels.SessionMessageList, handleSessionMessageList)
  ipcMain.handle(LegacyChannels.SessionMessageCreate, handleSessionMessageCreate)

  ipcMain.handle(CherryChannels.SessionCreate, handleSessionCreate)
  ipcMain.handle(CherryChannels.SessionGet, handleSessionGet)
  ipcMain.handle(CherryChannels.SessionUpdate, handleSessionUpdate)
  ipcMain.handle(CherryChannels.SessionList, handleSessionList)
  ipcMain.handle(CherryChannels.SessionMessageList, handleSessionMessageList)
  ipcMain.handle(CherryChannels.SessionMessageCreate, handleSessionMessageCreate)
  ipcMain.handle(IpcChannel.CherryChatStream_DraftRequest, handleDraftRequest)
  ipcMain.handle(IpcChannel.CherryChatStream_DraftModifyRequest, handleDraftModifyRequest)
  ipcMain.handle(IpcChannel.CherryChatStream_TextAddRequest, handleTextAddRequest)
  ipcMain.handle(IpcChannel.CherryChatStream_ReversePromptRequest, handleReversePromptRequest)
  ipcMain.handle(IpcChannel.CherryChatStream_SubtitleRecognitionRequest, handleReversePromptRequest)
  ipcMain.handle(IpcChannel.CherryChatStream_DraftExportRequest, handleDraftExportRequest)
  ipcMain.handle(IpcChannel.CherryChatStream_DraftDownloadRequest, handleDraftDownloadRequest)

  sessionStreamIpcRegistered = true
  logger.info('[SessionStreamIpc] IPC registration completed')
}

export function broadcastSessionChanged(agentId: string, sessionId: string, headless?: boolean): void {
  const mainWindow = windowService.getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    logger.info('[SessionStreamIpc] Broadcasting AgentSession_Changed', {
      agentId,
      sessionId,
      headless: !!headless
    })
    mainWindow.webContents.send(IpcChannel.AgentSession_Changed, { agentId, sessionId, headless: !!headless })
  } else {
    logger.warn('[SessionStreamIpc] Skipped AgentSession_Changed broadcast: main window unavailable', {
      agentId,
      sessionId,
      headless: !!headless
    })
  }
}
