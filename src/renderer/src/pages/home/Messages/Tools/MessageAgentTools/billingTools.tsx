import { getMediaGenerationPointIconUrl } from './mediaGenerationBilling'
import { parseMcpToolName } from '../shared/mcpToolDisplay'

import { isKouboTemplateToolName } from './KouboTemplateTool'
import { isSubtitleRecognitionToolName } from './SubtitleRecognitionTool'
import { isMediaGenerationToolName } from './mediaGenerationShared'
import { isReversePromptToolName } from '../../../../../../../shared/reversePrompt'

const REMOVE_BG_TOOL_NAMES = [
  'submit_remove_bg_text_behind_task',
  'submit_remove_bg_pip_task',
  'submit_remove_bg_task'
]

// Single source of truth for which MCP tools render a media-generation billing
// badge in their header (see McpServerToolRenderer headerStats), so aggregate
// group headers can mirror exactly what each child tool displays.
export function isMediaGenerationBillingToolName(toolName?: string, serverName?: string): boolean {
  const name = String(toolName || '')
  const server = parseMcpToolName(name).serverName || serverName
  return (
    server === 'scrapt' ||
    server === 'audio-understand' ||
    isKouboTemplateToolName(name) ||
    isMediaGenerationToolName(name) ||
    isSubtitleRecognitionToolName(name) ||
    REMOVE_BG_TOOL_NAMES.some((tool) => name === tool || name.endsWith(`__remove-bg__${tool}`)) ||
    isReversePromptToolName(name)
  )
}

// Shared ✦ points badge so child tool headers and aggregate group headers render
// the exact same markup: same alignment offsets, font sizes and normal weight.
export function MediaGenBillingBadge({ displayText, title }: { displayText: string; title: string }) {
  return (
    <span
      className="tool-header-billing-badge"
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        paddingLeft: 4,
        paddingRight: 4,
        color: '#000000',
        fontSize: 14,
        fontWeight: 'normal',
        flex: '0 0 auto',
        whiteSpace: 'nowrap',
        lineHeight: 1,
        transform: 'translateY(2px)'
      }}>
      <img
        src={getMediaGenerationPointIconUrl()}
        alt=""
        aria-hidden="true"
        style={{
          width: 14,
          height: 14,
          display: 'block',
          flexShrink: 0,
          transform: 'translateY(0.5px)'
        }}
      />
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          fontSize: 12,
          fontWeight: 'normal',
          lineHeight: 1,
          transform: 'translateY(0.5px)'
        }}>
        {displayText}
      </span>
    </span>
  )
}
