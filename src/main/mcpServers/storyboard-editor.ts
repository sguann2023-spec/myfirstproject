import fs from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'

// Reuse the same pure functions the renderer uses to guarantee behavior parity
// with PartSplitToolDetail's mergeParts / splitPart / validateParts pipeline.
import {
  DRAFT_VERSION,
  activeParts,
  canMergeParts,
  labelParts,
  mergeParts as mergePartsFn,
  partDuration,
  partOffset,
  partRanges,
  splitPart as splitPartFn,
  validateParts,
  withTimeranges
  // @ts-expect-error - JS module without types, resolved by rollup/vite at build time
} from '../../components/PartSplitToolDetail/model.js'
// @ts-expect-error - JS module without types
import { clipCaption } from '../../components/PartSplitToolDetail/wordTiming.js'

const logger = loggerService.withContext('MCPServer:StoryboardEditor')

type StoryboardCaptionWord = {
  start: number
  end: number
  from: number
  to: number
  text: string
}

type StoryboardCaption = {
  start: number
  end: number
  text: string
  words?: StoryboardCaptionWord[]
}

type StoryboardRange = {
  start: number
  end: number
}

type StoryboardPart = {
  id: string
  sourceIndex: number
  blank: boolean
  deleted?: boolean
  label?: string
  start: number
  end: number
  text: string
  ranges?: StoryboardRange[]
  captions?: StoryboardCaption[]
}

type StoryboardSegment = {
  start: number
  end: number
  text: string
  sourceIndex?: number
  words?: unknown[]
}

type StoryboardDocument = {
  type: 'subtitle_storyboard'
  version: number
  time_unit: 'ms'
  source_file: string
  media_source?: string
  updated_at?: string
  segments: StoryboardSegment[]
  parts: StoryboardPart[]
}

const INSPECT_STORYBOARD_TOOL: Tool = {
  name: 'inspect_storyboard',
  description:
    'Read-only. Return a compact, structured summary of the current subtitle storyboard file (parts, ranges, caption summaries, duration statistics). Use this FIRST before any modification tool to know current part ids/ranges/text. IMPORTANT for token budget: a full storyboard can be huge (10+ MB for a 3-minute video), so PREFER passing "around_part_id" together with an optional "neighbor_radius" (default 5) to only fetch the ±N neighbours around the part you are about to modify. Only fall back to a full dump when you truly need a global view (e.g. first pass planning).',
  inputSchema: {
    type: 'object',
    properties: {
      storyboard_path: {
        type: 'string',
        description: 'Absolute path to the storyboard JSON file (typically <workspace>/part_*.json).'
      },
      part_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional. Only return these part ids instead of all active parts. Mutually helpful with around_part_id when you want an explicit hand-picked set.'
      },
      around_part_id: {
        type: 'string',
        description: 'Optional. Center the response on this part id and only return it plus its ±neighbor_radius neighbours (default 5). Use this for local editing decisions to keep the response small.'
      },
      neighbor_radius: {
        type: 'integer',
        minimum: 0,
        description: 'Optional. Neighbour window radius used together with around_part_id. Defaults to 5 (returns up to 11 parts: 5 before, the center, 5 after). Ignored if around_part_id is not provided.'
      },
      include_words: {
        type: 'boolean',
        description: 'Optional. When true, include per-word timestamps for each caption. Defaults to false to save tokens.'
      }
    },
    required: ['storyboard_path'],
    additionalProperties: false
  }
}

const UPDATE_PART_TEXT_TOOL: Tool = {
  name: 'update_part_text',
  description:
    'Rewrite the display text of a single non-blank part without changing its time range or ranges. The caption boundaries (start/end) stay the same, so overall duration is preserved. The new text length may differ from the original: (1) equal-length rewrite (e.g. "ABC" → "DEF"), (2) grow (e.g. "区里" → "去市里"), (3) shrink (e.g. "你嗯好" → "你好"), (4) empty ("ABC" → "") to keep the画面照播 but drop the caption text entirely. When per-word timestamps exist and newText is non-empty the tool evenly redistributes the caption duration across the new characters (one word per character); when newText is empty the caption keeps its start/end but its text becomes "" and words are cleared. Use this whenever you want to fix ASR mistakes / drop filler / silence the caption but keep total time. If you want to shorten/lengthen the time too, use delete_range or split_part instead.',
  inputSchema: {
    type: 'object',
    properties: {
      storyboard_path: { type: 'string' },
      part_id: { type: 'string', description: 'Target part id to modify.' },
      text: {
        type: 'string',
        description: 'New full text for the part. Multiple captions are joined by "\\n" in the source of truth; splitting by "\\n" must yield exactly the same number of lines as the existing caption count.'
      },
      captions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional. New per-caption text list. When provided, overrides text; length must match existing captions count.'
      }
    },
    required: ['storyboard_path', 'part_id'],
    additionalProperties: false
  }
}

const SPLIT_PART_TOOL: Tool = {
  name: 'split_part',
  description:
    'Split a single part into two parts. Use for "keep each part under N characters" or "re-split by full semantic units". You can split by source_time_ms (absolute media time inside the part\'s current ranges) or by char_index (character offset into part.text).',
  inputSchema: {
    type: 'object',
    properties: {
      storyboard_path: { type: 'string' },
      part_id: { type: 'string' },
      split_at: {
        type: 'object',
        description: 'Where to split.',
        properties: {
          type: { type: 'string', enum: ['source_time_ms', 'char_index'] },
          value: { type: 'number' }
        },
        required: ['type', 'value']
      },
      next_id: {
        type: 'string',
        description: 'Optional id for the newly created right-hand part. Auto-generated when omitted.'
      }
    },
    required: ['storyboard_path', 'part_id', 'split_at'],
    additionalProperties: false
  }
}

const MERGE_PARTS_TOOL: Tool = {
  name: 'merge_parts',
  description:
    'Merge 2 or more adjacent, non-blank parts (in current track order). Fails when the ids are not adjacent, not in source-time order or include a blank. Handles ranges / captions / words concatenation internally — the model must NOT write ranges by hand.',
  inputSchema: {
    type: 'object',
    properties: {
      storyboard_path: { type: 'string' },
      part_ids: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        description: 'Adjacent part ids in track order.'
      }
    },
    required: ['storyboard_path', 'part_ids'],
    additionalProperties: false
  }
}

const DELETE_PARTS_TOOL: Tool = {
  name: 'delete_parts',
  description:
    'Delete one or more parts entirely from the storyboard (they are removed from parts[], not marked as deleted). Labels are re-assigned automatically.',
  inputSchema: {
    type: 'object',
    properties: {
      storyboard_path: { type: 'string' },
      part_ids: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1
      }
    },
    required: ['storyboard_path', 'part_ids'],
    additionalProperties: false
  }
}

const DELETE_RANGE_TOOL: Tool = {
  name: 'delete_range',
  description:
    'Delete a target-timeline interval that may span one or multiple parts. Used to drop filler words (嗯/啊), shorten pauses, or cut a stretch across several parts in one call. The range is expressed on the final track (target) timeline; the tool maps it to each intersecting part\'s source-time internally. When a single part is hollowed out in the middle, it is split into two independent parts (source-time discontinuous, captions split, target-times contiguous). Fully-consumed parts are removed. All following parts auto-shift forward on target.',
  inputSchema: {
    type: 'object',
    properties: {
      storyboard_path: { type: 'string' },
      range: {
        type: 'object',
        description: 'Target-timeline range to delete. May span multiple parts.',
        properties: {
          start_target_ms: { type: 'number' },
          end_target_ms: { type: 'number' }
        },
        required: ['start_target_ms', 'end_target_ms']
      }
    },
    required: ['storyboard_path', 'range'],
    additionalProperties: false
  }
}

const INSERT_AT_SCHEMA = {
  type: 'object',
  description:
    'Where the new/moved part should be inserted in parts[]. One of: {type:"start"} | {type:"end"} | {type:"index", value:number} | {type:"before", part_id:string} | {type:"after", part_id:string}.',
  properties: {
    type: { type: 'string', enum: ['start', 'end', 'index', 'before', 'after'] },
    value: { type: 'number', description: 'Only for type="index" (0-based, clamped into range).' },
    part_id: { type: 'string', description: 'Only for type="before" | "after".' }
  },
  required: ['type']
}

const DUPLICATE_PART_TOOL: Tool = {
  name: 'duplicate_part',
  description:
    'Deep-copy an existing non-blank part (including ranges/captions/words/text) and insert the copy at another position in parts[]. Use this to lift a highlight sentence to the beginning as a hook or to keep a backup copy of a segment. The original part is left untouched. The copy keeps the original sourceIndex and source-time ranges, so the same source-media audio/video segment will be played twice at the new track position.',
  inputSchema: {
    type: 'object',
    properties: {
      storyboard_path: { type: 'string' },
      part_id: { type: 'string', description: 'Id of the part to copy.' },
      insert_at: INSERT_AT_SCHEMA,
      new_id: { type: 'string', description: 'Optional. Custom id for the new copy. Auto-generated when omitted.' },
      text: {
        type: 'string',
        description: 'Optional. If provided, overwrite the copied part text via the same logic as update_part_text (single caption).'
      }
    },
    required: ['storyboard_path', 'part_id', 'insert_at'],
    additionalProperties: false
  }
}

const MOVE_PART_TOOL: Tool = {
  name: 'move_part',
  description:
    'Move an existing part to another position in parts[] without changing its contents. Use this to reorder shots (e.g. pull the highlight sentence from the end to the beginning). sourceIndex / ranges / captions / words / text all stay the same; only the position in parts[] (and therefore label) changes.',
  inputSchema: {
    type: 'object',
    properties: {
      storyboard_path: { type: 'string' },
      part_id: { type: 'string', description: 'Id of the part to move.' },
      insert_at: INSERT_AT_SCHEMA
    },
    required: ['storyboard_path', 'part_id', 'insert_at'],
    additionalProperties: false
  }
}

const CLEAR_PART_TEXT_TOOL: Tool = {
  name: 'clear_part_text',
  description:
    'Strip all display text from a non-blank part while keeping its video/audio time range. After this the part still plays the same source-media segment but shows no subtitle. Use for shots where the picture matters and captions should disappear (e.g. a montage). Different from insert_blank_part, which creates a purely empty spacer without any picture.',
  inputSchema: {
    type: 'object',
    properties: {
      storyboard_path: { type: 'string' },
      part_id: { type: 'string', description: 'Target part id whose captions will be cleared.' }
    },
    required: ['storyboard_path', 'part_id'],
    additionalProperties: false
  }
}

const INSERT_BLANK_PART_TOOL: Tool = {
  name: 'insert_blank_part',
  description:
    'Insert a new blank (empty) part into parts[]. A blank part has no picture, no text, no captions, no ranges; it only occupies a slot in the timeline. Use for adding a pause / spacer on the track. duration_ms is the placeholder duration in milliseconds and is stored as end-start; insert_at chooses the position in parts[].',
  inputSchema: {
    type: 'object',
    properties: {
      storyboard_path: { type: 'string' },
      duration_ms: {
        type: 'number',
        description: 'Placeholder duration in milliseconds. Must be a positive integer.'
      },
      insert_at: INSERT_AT_SCHEMA,
      new_id: { type: 'string', description: 'Optional. Custom id for the new blank part. Auto-generated when omitted.' }
    },
    required: ['storyboard_path', 'duration_ms', 'insert_at'],
    additionalProperties: false
  }
}

const ADJUST_PART_BOUNDS_TOOL: Tool = {
  name: 'adjust_part_bounds',
  description:
    'Fine-tune a part\'s source-time start/end boundaries — useful when the ASR cut is too abrupt or clipped a filler word in half. Provide EITHER "delta" (relative offsets in ms: negatives extend outward, positives shrink inward for start; the reverse for end) OR "absolute" (absolute source-time ms). Cannot cross the boundary of the underlying source segment; cannot overlap adjacent parts on the same sourceIndex; captions/words falling outside the new bounds are trimmed automatically. If the adjustment would consume the whole part, an error is returned — use delete_parts instead.',
  inputSchema: {
    type: 'object',
    properties: {
      storyboard_path: { type: 'string' },
      part_id: { type: 'string' },
      delta: {
        type: 'object',
        description: 'Relative offset in ms. start_delta_ms<0 extends start earlier; end_delta_ms>0 extends end later.',
        properties: {
          start_delta_ms: { type: 'number' },
          end_delta_ms: { type: 'number' }
        },
        additionalProperties: false
      },
      absolute: {
        type: 'object',
        description: 'Absolute new bounds in source-time ms. Provide either or both.',
        properties: {
          start_ms: { type: 'number' },
          end_ms: { type: 'number' }
        },
        additionalProperties: false
      }
    },
    required: ['storyboard_path', 'part_id'],
    additionalProperties: false
  }
}

const APPLY_OPERATIONS_TOOL: Tool = {
  name: 'apply_operations',
  description:
    "Apply a sequence of storyboard edits atomically in a single call. Each op is applied on top of the previous op's resulting state (so a split_part's next_id can be referenced by a later op). Any failure rolls back the ENTIRE batch — the file is never left half-written. Nesting apply_operations inside itself is rejected. Recommended when you know >=2 edits up-front. Each op is an object with a required `type` field plus that op's other fields. Field cheatsheet: (1) type='update_part_text' → part_id (required), text or captions[]. (2) type='split_part' → part_id, split_at={type:'source_time_ms'|'char_index', value:number}, optional next_id. (3) type='merge_parts' → part_ids[] (>=2, adjacent). (4) type='delete_parts' → part_ids[] (>=1). (5) type='delete_range' → range={start_target_ms, end_target_ms} (on the CURRENT post-previous-ops target timeline). (6) type='adjust_part_bounds' → part_id, plus EITHER delta={start_delta_ms?, end_delta_ms?} OR absolute={start_ms?, end_ms?}; you may ALSO pass the four numeric fields flat on the op itself (e.g. {type:'adjust_part_bounds', part_id:'p2', end_delta_ms:-500}) — the server accepts both nested and flat forms. Example call: [{\"type\":\"delete_parts\",\"part_ids\":[\"p3\"]},{\"type\":\"adjust_part_bounds\",\"part_id\":\"p2\",\"end_delta_ms\":-200},{\"type\":\"update_part_text\",\"part_id\":\"p1\",\"text\":\"新文案\"}].",
  inputSchema: {
    type: 'object',
    properties: {
      storyboard_path: { type: 'string' },
      operations: {
        type: 'array',
        minItems: 1,
        description:
          'Ordered list of edits. Each item MUST include type plus that op\'s required fields (see tool description). Server enforces per-op validation.',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['update_part_text', 'split_part', 'merge_parts', 'delete_parts', 'delete_range', 'adjust_part_bounds'],
              description: 'Op discriminator.'
            },
            part_id: { type: 'string', description: 'Target part id. Required for update_part_text / split_part / adjust_part_bounds.' },
            part_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Required for merge_parts (>=2 adjacent) and delete_parts (>=1).'
            },
            text: { type: 'string', description: 'update_part_text: new full text.' },
            captions: {
              type: 'array',
              items: { type: 'string' },
              description: 'update_part_text: per-caption override; length must match existing captions count.'
            },
            split_at: {
              type: 'object',
              description: 'split_part: where to split.',
              properties: {
                type: { type: 'string', enum: ['source_time_ms', 'char_index'] },
                value: { type: 'number' }
              },
              required: ['type', 'value']
            },
            next_id: { type: 'string', description: 'split_part: optional id for the new right-hand part.' },
            range: {
              type: 'object',
              description: 'delete_range: target-timeline interval on the CURRENT (post-previous-ops) target.',
              properties: {
                start_target_ms: { type: 'number' },
                end_target_ms: { type: 'number' }
              },
              required: ['start_target_ms', 'end_target_ms']
            },
            delta: {
              type: 'object',
              description: 'adjust_part_bounds: relative offsets in source-time ms. Negative start extends earlier; positive end extends later.',
              properties: {
                start_delta_ms: { type: 'number' },
                end_delta_ms: { type: 'number' }
              }
            },
            absolute: {
              type: 'object',
              description: 'adjust_part_bounds: absolute source-time ms.',
              properties: {
                start_ms: { type: 'number' },
                end_ms: { type: 'number' }
              }
            },
            start_delta_ms: { type: 'number', description: 'adjust_part_bounds flat form: same as delta.start_delta_ms.' },
            end_delta_ms: { type: 'number', description: 'adjust_part_bounds flat form: same as delta.end_delta_ms.' },
            start_ms: { type: 'number', description: 'adjust_part_bounds flat form: same as absolute.start_ms.' },
            end_ms: { type: 'number', description: 'adjust_part_bounds flat form: same as absolute.end_ms.' }
          },
          required: ['type']
        }
      }
    },
    required: ['storyboard_path', 'operations'],
    additionalProperties: false
  }
}

const ALL_TOOLS: Tool[] = [
  INSPECT_STORYBOARD_TOOL,
  UPDATE_PART_TEXT_TOOL,
  SPLIT_PART_TOOL,
  MERGE_PARTS_TOOL,
  DELETE_PARTS_TOOL,
  DELETE_RANGE_TOOL,
  DUPLICATE_PART_TOOL,
  MOVE_PART_TOOL,
  CLEAR_PART_TEXT_TOOL,
  INSERT_BLANK_PART_TOOL,
  ADJUST_PART_BOUNDS_TOOL,
  APPLY_OPERATIONS_TOOL
]

type ComputeResult = {
  parts: StoryboardPart[]
  segments?: StoryboardSegment[]
  meta: Record<string, unknown>
}

class StoryboardEditorServer {
  public mcpServer: McpServer

  constructor() {
    this.mcpServer = new McpServer(
      {
        name: 'storyboard-editor',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    )
    this.setupHandlers()
  }

  private setupHandlers() {
    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: ALL_TOOLS
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = (request.params.arguments ?? {}) as Record<string, unknown>

      try {
        switch (toolName) {
          case 'inspect_storyboard':
            return await this.inspectStoryboard(args)
          case 'update_part_text':
            return await this.updatePartText(args)
          case 'split_part':
            return await this.splitPart(args)
          case 'merge_parts':
            return await this.mergeParts(args)
          case 'delete_parts':
            return await this.deleteParts(args)
          case 'delete_range':
            return await this.deleteRange(args)
          case 'duplicate_part':
            return await this.duplicatePart(args)
          case 'move_part':
            return await this.movePart(args)
          case 'clear_part_text':
            return await this.clearPartText(args)
          case 'insert_blank_part':
            return await this.insertBlankPart(args)
          case 'adjust_part_bounds':
            return await this.adjustPartBounds(args)
          case 'apply_operations':
            return await this.applyOperations(args)
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`Tool error: ${toolName}`, { error: message })
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true
        }
      }
    })
  }

  private resolveStoryboardPath(args: Record<string, unknown>): string {
    const raw = args.storyboard_path
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new McpError(ErrorCode.InvalidParams, "'storyboard_path' is required")
    }
    if (!path.isAbsolute(raw)) {
      throw new McpError(ErrorCode.InvalidParams, "'storyboard_path' must be an absolute path")
    }
    return raw
  }

  private async loadStoryboard(storyboardPath: string): Promise<StoryboardDocument> {
    let raw: string
    try {
      raw = await fs.readFile(storyboardPath, 'utf8')
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to read storyboard file: ${reason}`)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw.replace(/^\uFEFF/, ''))
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`Storyboard file is not valid JSON: ${reason}`)
    }

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      (parsed as StoryboardDocument).type !== 'subtitle_storyboard' ||
      (parsed as StoryboardDocument).version !== DRAFT_VERSION ||
      (parsed as StoryboardDocument).time_unit !== 'ms' ||
      typeof (parsed as StoryboardDocument).source_file !== 'string' ||
      !Array.isArray((parsed as StoryboardDocument).parts) ||
      !Array.isArray((parsed as StoryboardDocument).segments)
    ) {
      throw new Error('Storyboard file schema is incompatible (expected subtitle_storyboard v1 in ms).')
    }

    return parsed as StoryboardDocument
  }

  private async writeStoryboard(storyboardPath: string, document: StoryboardDocument): Promise<void> {
    // Re-validate the parts array through the shared validator to ensure invariants hold.
    validateParts(document.parts)
    const nextDocument: StoryboardDocument = {
      ...document,
      parts: withTimeranges(labelParts(activeParts(document.parts))),
      updated_at: new Date().toISOString()
    }
    const tempPath = `${storyboardPath}.tmp-${process.pid}-${Date.now()}`
    const payload = JSON.stringify(nextDocument, null, 2)
    await fs.writeFile(tempPath, payload, 'utf8')
    try {
      await fs.rename(tempPath, storyboardPath)
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined)
      throw error
    }
  }

  private summarizePart(part: StoryboardPart, includeWords: boolean, targetStartMs: number) {
    const ranges = partRanges(part) as StoryboardRange[]
    const duration = partDuration(part) as number
    const captions = (part.captions || []).map((cue) => ({
      start: cue.start,
      end: cue.end,
      text: cue.text,
      word_count: cue.words?.length ?? 0,
      ...(includeWords && cue.words?.length
        ? { words: cue.words.map((word) => ({ start: word.start, end: word.end, from: word.from, to: word.to, text: word.text })) }
        : {})
    }))
    return {
      id: part.id,
      label: part.label,
      source_index: part.sourceIndex,
      blank: part.blank,
      // Explicit dual-timeline view. source_timerange = which slice of the
      // original media this part references. target_timerange = where this
      // part sits on the final concatenated track (derived from parts array
      // ordering + each part's source duration).
      source_timerange: {
        start_ms: part.start,
        end_ms: part.end,
        ranges
      },
      target_timerange: {
        start_ms: targetStartMs,
        end_ms: targetStartMs + duration,
        duration_ms: duration
      },
      // Legacy flat fields (kept for backward compatibility with existing prompts / clients).
      start_ms: part.start,
      end_ms: part.end,
      duration_ms: duration,
      text: part.text,
      char_count: Array.from(part.text || '').length,
      ranges,
      captions
    }
  }

  private async inspectStoryboard(args: Record<string, unknown>) {
    const storyboardPath = this.resolveStoryboardPath(args)
    const document = await this.loadStoryboard(storyboardPath)
    const includeWords = args.include_words === true
    const filterIds = Array.isArray(args.part_ids) ? new Set(args.part_ids as string[]) : null
    const aroundPartId = typeof args.around_part_id === 'string' && args.around_part_id.trim() ? args.around_part_id.trim() : null
    const neighborRadius = Number.isFinite(args.neighbor_radius as number) ? Math.max(0, Math.trunc(args.neighbor_radius as number)) : 5

    const parts = activeParts(document.parts) as StoryboardPart[]
    let selectedParts = parts
    let windowInfo: null | { around_part_id: string; neighbor_radius: number; window_start_index: number; window_end_index: number; truncated: boolean } = null
    if (aroundPartId) {
      const centerIndex = parts.findIndex((part) => part.id === aroundPartId)
      if (centerIndex === -1) {
        throw new Error(`Part not found for around_part_id: ${aroundPartId}`)
      }
      const startIndex = Math.max(0, centerIndex - neighborRadius)
      const endIndex = Math.min(parts.length - 1, centerIndex + neighborRadius)
      selectedParts = parts.slice(startIndex, endIndex + 1)
      windowInfo = {
        around_part_id: aroundPartId,
        neighbor_radius: neighborRadius,
        window_start_index: startIndex,
        window_end_index: endIndex,
        truncated: startIndex > 0 || endIndex < parts.length - 1
      }
    }
    if (filterIds) {
      selectedParts = selectedParts.filter((part) => filterIds.has(part.id))
    }

    const totalDurationMs = parts.reduce((sum, part) => sum + (part.blank ? 0 : (partDuration(part) as number)), 0)
    const blankCount = parts.filter((part) => part.blank).length
    const durations = parts
      .filter((part) => !part.blank)
      .map((part) => ({ id: part.id, duration_ms: partDuration(part) as number, char_count: Array.from(part.text || '').length }))
    const longestPart = durations.reduce<null | (typeof durations)[number]>((max, item) => (max && max.duration_ms >= item.duration_ms ? max : item), null)
    const shortestPart = durations.reduce<null | (typeof durations)[number]>((min, item) => (min && min.duration_ms <= item.duration_ms ? min : item), null)
    const longCharParts = durations.filter((item) => item.char_count > 12).map((item) => item.id)

    // Compute each active part's target-timeline start (accumulated part
    // durations, including blank spacers which also occupy target time). Do
    // this over the FULL active list so parts inside a neighbour window still
    // report their true absolute target position.
    const targetStartById = new Map<string, number>()
    {
      let cursor = 0
      for (const p of parts) {
        targetStartById.set(p.id, cursor)
        cursor += partDuration(p) as number
      }
    }

    const responsePayload = {
      meta: {
        storyboard_path: storyboardPath,
        source_file: document.source_file,
        media_source: document.media_source ?? '',
        updated_at: document.updated_at ?? '',
        segment_count: document.segments.length,
        ...(windowInfo ? { window: windowInfo } : {})
      },
      stats: {
        part_count: parts.length,
        blank_count: blankCount,
        non_blank_count: parts.length - blankCount,
        total_duration_ms: totalDurationMs,
        longest_part_id: longestPart?.id ?? null,
        shortest_part_id: shortestPart?.id ?? null,
        long_char_part_ids: longCharParts
      },
      parts: selectedParts.map((part) => this.summarizePart(part, includeWords, targetStartById.get(part.id) ?? 0))
    }

    return {
      structuredContent: responsePayload,
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(responsePayload, null, 2)
        }
      ]
    }
  }

  private async updatePartText(args: Record<string, unknown>) {
    const storyboardPath = this.resolveStoryboardPath(args)
    const document = await this.loadStoryboard(storyboardPath)
    const { parts, meta } = this.computeUpdatePartText(document, args)
    await this.writeStoryboard(storyboardPath, { ...document, parts })
    return this.successResponse(storyboardPath, `Updated text of part ${meta.part_id}`, meta)
  }

  private computeUpdatePartText(document: StoryboardDocument, args: Record<string, unknown>): ComputeResult {
    const partId = String(args.part_id || '').trim()
    if (!partId) throw new McpError(ErrorCode.InvalidParams, "'part_id' is required")

    const target = document.parts.find((part) => part.id === partId) as StoryboardPart | undefined
    if (!target || target.deleted) throw new Error(`Part not found: ${partId}`)
    if (target.blank) throw new Error(`Cannot update text on a blank part: ${partId}`)

    const captionsInput = Array.isArray(args.captions) ? (args.captions as unknown[]).map((item) => String(item ?? '')) : null
    const existingCaptions: StoryboardCaption[] = target.captions || []
    if (!existingCaptions.length) throw new Error(`Part ${partId} has no captions to update`)

    let nextCaptions: StoryboardCaption[]
    if (captionsInput) {
      if (captionsInput.length !== existingCaptions.length) {
        throw new Error(
          `captions length mismatch: expected ${existingCaptions.length}, received ${captionsInput.length}. Use split_part or delete_range to change caption count.`
        )
      }
      nextCaptions = existingCaptions.map((cue, index) => this.replaceCaptionText(cue, captionsInput[index]))
    } else {
      if (typeof args.text !== 'string') throw new McpError(ErrorCode.InvalidParams, "'text' or 'captions' is required")
      const parts = String(args.text).split('\n')
      if (parts.length !== existingCaptions.length) {
        throw new Error(
          `text lines mismatch: expected ${existingCaptions.length}, received ${parts.length}. Use split_part to change caption count.`
        )
      }
      nextCaptions = existingCaptions.map((cue, index) => this.replaceCaptionText(cue, parts[index]))
    }

    const nextText = nextCaptions.map((cue) => cue.text).join('\n')
    const nextParts = document.parts.map((part) =>
      part.id === partId ? { ...part, captions: nextCaptions, text: nextText } : part
    )

    return {
      parts: nextParts,
      meta: { part_id: partId, new_text: nextText }
    }
  }

  private replaceCaptionText(cue: StoryboardCaption, newText: string): StoryboardCaption {
    if (cue.text === newText) return cue
    // When per-word timestamps exist, we rebuild them by evenly distributing the caption
    // duration across the new characters (one word per character). This lets the model
    // do arbitrary-length rewrites (e.g. "你嗯好" -> "你好") while keeping caption.start/end
    // fixed so the whole part's total time never changes.
    // Empty newText is allowed: the caption keeps its start/end (画面时间保留) but shows
    // no text and carries no words — 想让"画面照播但整段字幕消失"就用它。
    if (cue.words?.length) {
      const nextChars = Array.from(newText)
      if (!nextChars.length) {
        return { ...cue, text: '', words: [] }
      }
      const duration = cue.end - cue.start
      const nextWords: StoryboardCaptionWord[] = nextChars.map((char, index) => {
        const start = cue.start + Math.round((duration * index) / nextChars.length)
        const rawEnd = cue.start + Math.round((duration * (index + 1)) / nextChars.length)
        const end = index === nextChars.length - 1 ? cue.end : Math.max(start + 1, rawEnd)
        // UTF-16 offsets used by cue.text
        const from = nextChars.slice(0, index).join('').length
        const to = from + char.length
        return { start, end, from, to, text: char }
      })
      return { ...cue, text: newText, words: nextWords }
    }
    return { ...cue, text: newText }
  }

  private async splitPart(args: Record<string, unknown>) {
    const storyboardPath = this.resolveStoryboardPath(args)
    const document = await this.loadStoryboard(storyboardPath)
    const { parts, meta } = this.computeSplitPart(document, args)
    await this.writeStoryboard(storyboardPath, { ...document, parts })
    return this.successResponse(
      storyboardPath,
      `Split part ${meta.original_part_id} at ${meta.split_source_time_ms}ms`,
      meta
    )
  }

  private computeSplitPart(document: StoryboardDocument, args: Record<string, unknown>): ComputeResult {
    const partId = String(args.part_id || '').trim()
    if (!partId) throw new McpError(ErrorCode.InvalidParams, "'part_id' is required")

    const splitAt = args.split_at as { type?: string; value?: number } | undefined
    if (!splitAt || (splitAt.type !== 'source_time_ms' && splitAt.type !== 'char_index') || typeof splitAt.value !== 'number') {
      throw new McpError(ErrorCode.InvalidParams, "'split_at.type' must be 'source_time_ms' or 'char_index' with numeric 'value'")
    }

    const target = document.parts.find((part) => part.id === partId) as StoryboardPart | undefined
    if (!target || target.deleted) throw new Error(`Part not found: ${partId}`)
    if (target.blank) throw new Error(`Cannot split a blank part: ${partId}`)

    let sourceTime: number
    if (splitAt.type === 'source_time_ms') {
      sourceTime = splitAt.value
    } else {
      const chars = Array.from(target.text || '')
      const charIndex = Math.max(0, Math.min(chars.length, Math.round(splitAt.value)))
      if (charIndex <= 0 || charIndex >= chars.length) {
        throw new Error(`char_index must be strictly between 1 and text length - 1 (got ${charIndex} of ${chars.length}).`)
      }
      const duration = partDuration(target) as number
      const offset = Math.round((duration * charIndex) / chars.length)
      const point = partPoint(target, offset) as { sourceTime: number } | undefined
      if (!point) throw new Error('Failed to resolve source time for split')
      sourceTime = point.sourceTime
    }

    const nextId = typeof args.next_id === 'string' && args.next_id.trim() ? args.next_id.trim() : this.generateNextId(document.parts, partId)
    const nextParts = splitPartFn(document.parts as StoryboardPart[], partId, sourceTime, nextId) as StoryboardPart[]
    if (nextParts === document.parts) throw new Error('Split had no effect (part duration too short or position out of range).')

    return {
      parts: nextParts,
      meta: {
        original_part_id: partId,
        new_part_id: nextId,
        split_source_time_ms: sourceTime
      }
    }
  }

  private async mergeParts(args: Record<string, unknown>) {
    const storyboardPath = this.resolveStoryboardPath(args)
    const document = await this.loadStoryboard(storyboardPath)
    const { parts, meta } = this.computeMergeParts(document, args)
    await this.writeStoryboard(storyboardPath, { ...document, parts })
    return this.successResponse(
      storyboardPath,
      `Merged parts ${(meta.merged_ids as string[]).join(', ')} into ${meta.result_part_id}`,
      meta
    )
  }

  private computeMergeParts(document: StoryboardDocument, args: Record<string, unknown>): ComputeResult {
    const partIds = Array.isArray(args.part_ids)
      ? (args.part_ids as unknown[]).map((item) => String(item ?? '').trim()).filter(Boolean)
      : []
    if (partIds.length < 2) throw new McpError(ErrorCode.InvalidParams, "'part_ids' must contain at least 2 ids")

    if (!canMergeParts(document.parts as StoryboardPart[], partIds)) {
      throw new Error('Selected parts are not adjacent, contain a blank part, or are not in source-time order.')
    }
    const nextParts = mergePartsFn(document.parts as StoryboardPart[], partIds) as StoryboardPart[]
    const mergedId = partIds[0]
    return {
      parts: nextParts,
      meta: { merged_ids: partIds, result_part_id: mergedId }
    }
  }

  private async deleteParts(args: Record<string, unknown>) {
    const storyboardPath = this.resolveStoryboardPath(args)
    const document = await this.loadStoryboard(storyboardPath)
    const { parts, meta } = this.computeDeleteParts(document, args)
    await this.writeStoryboard(storyboardPath, { ...document, parts })
    return this.successResponse(
      storyboardPath,
      `Deleted parts ${(meta.deleted_ids as string[]).join(', ')}`,
      meta
    )
  }

  private computeDeleteParts(document: StoryboardDocument, args: Record<string, unknown>): ComputeResult {
    const partIds = new Set(
      Array.isArray(args.part_ids)
        ? (args.part_ids as unknown[]).map((item) => String(item ?? '').trim()).filter(Boolean)
        : []
    )
    if (!partIds.size) throw new McpError(ErrorCode.InvalidParams, "'part_ids' must be a non-empty array")

    const missing = Array.from(partIds).filter((id) => !document.parts.some((part) => part.id === id))
    if (missing.length) throw new Error(`Unknown part ids: ${missing.join(', ')}`)

    const nextParts = (document.parts as StoryboardPart[]).filter((part) => !partIds.has(part.id))
    if (nextParts.length === document.parts.length) throw new Error('No parts were removed')

    return {
      parts: nextParts,
      meta: {
        deleted_ids: Array.from(partIds),
        remaining_part_count: nextParts.length
      }
    }
  }

  private async deleteRange(args: Record<string, unknown>) {
    const storyboardPath = this.resolveStoryboardPath(args)
    const document = await this.loadStoryboard(storyboardPath)
    const { parts, meta } = this.computeDeleteRange(document, args)
    await this.writeStoryboard(storyboardPath, { ...document, parts })

    const range = meta.deleted_target_range_ms as { start: number; end: number }
    return this.successResponse(
      storyboardPath,
      `Deleted target range [${range.start}, ${range.end}) across ${(meta.parts_before as number) - (meta.parts_after as number)} removed / ${meta.parts_before} original parts`,
      meta
    )
  }

  private computeDeleteRange(document: StoryboardDocument, args: Record<string, unknown>): ComputeResult {
    const range = args.range as { start_target_ms?: number; end_target_ms?: number } | undefined
    if (
      !range ||
      typeof range.start_target_ms !== 'number' ||
      typeof range.end_target_ms !== 'number' ||
      range.end_target_ms <= range.start_target_ms ||
      range.start_target_ms < 0
    ) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "'range' must have numeric 0 <= start_target_ms < end_target_ms (target timeline in ms)"
      )
    }

    const originalParts = document.parts as StoryboardPart[]

    // Build target-timeline windows for each part (blank parts also occupy target space).
    type Window = { part: StoryboardPart; targetStart: number; targetEnd: number }
    const windows: Window[] = []
    let cursor = 0
    for (const part of originalParts) {
      const duration = partDuration(part) as number
      windows.push({ part, targetStart: cursor, targetEnd: cursor + duration })
      cursor += duration
    }
    const totalTarget = cursor
    const cutStart = range.start_target_ms
    const cutEnd = Math.min(range.end_target_ms, totalTarget)
    if (cutStart >= totalTarget) {
      throw new Error(
        `range start_target_ms=${cutStart} is beyond total target duration ${totalTarget}ms`
      )
    }
    if (cutEnd <= cutStart) {
      throw new Error(
        `range [${cutStart}, ${range.end_target_ms}) does not overlap any part on the target timeline`
      )
    }

    const usedIds = new Set(originalParts.map((p) => p.id))
    const allocateTailId = (baseId: string): string => {
      let index = 1
      while (usedIds.has(`${baseId}-cut-${index}`)) index += 1
      const next = `${baseId}-cut-${index}`
      usedIds.add(next)
      return next
    }

    const outputParts: StoryboardPart[] = []

    for (const win of windows) {
      const { part, targetStart, targetEnd } = win

      // Whole part outside the cut range: keep as-is.
      if (cutEnd <= targetStart || cutStart >= targetEnd) {
        outputParts.push(part)
        continue
      }

      // Blank parts cannot be internally split; if cut fully covers, drop it; if partial, shrink it.
      if (part.blank) {
        const remaining = Math.max(0, targetStart - cutStart) + Math.max(0, targetEnd - cutEnd)
        // Actually: how much of this blank survives.
        const surviveBefore = Math.max(0, cutStart - targetStart)
        const surviveAfter = Math.max(0, targetEnd - cutEnd)
        const nextDur = surviveBefore + surviveAfter
        void remaining
        if (nextDur <= 0) continue
        outputParts.push({ ...part, start: 0, end: nextDur })
        continue
      }

      // Non-blank: map cut range to this part's target window → source-time window.
      const localCutStart = Math.max(cutStart, targetStart) - targetStart
      const localCutEnd = Math.min(cutEnd, targetEnd) - targetStart
      const partDur = targetEnd - targetStart

      const partStartSrc = part.start
      const partEndSrc = part.end
      // Multi-range parts: convert local target offset → source time via partPoint.
      const srcCutStart = partPoint(part, localCutStart)?.sourceTime ?? partStartSrc + localCutStart
      const srcCutEnd = partPoint(part, localCutEnd)?.sourceTime ?? partStartSrc + localCutEnd

      const leftDur = localCutStart
      const rightDur = partDur - localCutEnd

      const makeSlice = (
        srcStart: number,
        srcEnd: number,
        idOverride?: string
      ): StoryboardPart | null => {
        if (srcEnd <= srcStart) return null
        const captions = (part.captions || []).flatMap((cue) => {
          const s = Math.max(cue.start, srcStart)
          const e = Math.min(cue.end, srcEnd)
          if (e <= s) return []
          if (cue.words?.length) {
            const clipped = clipCaption(cue, s, e)
            return clipped ? [clipped as StoryboardCaption] : []
          }
          const chars = Array.from(cue.text)
          const from = Math.round((chars.length * (s - cue.start)) / (cue.end - cue.start))
          const to = Math.round((chars.length * (e - cue.start)) / (cue.end - cue.start))
          return [{ start: s, end: e, text: chars.slice(from, to).join('') }]
        })
        const slice: StoryboardPart = {
          ...part,
          id: idOverride ?? part.id,
          start: srcStart,
          end: srcEnd,
          text: captions.map((c) => c.text).join('\n'),
          captions
        }
        // A slice never carries multi-range remnants; simple parts use start/end only.
        delete slice.ranges
        return slice
      }

      if (leftDur > 0 && rightDur > 0) {
        // Middle hollowed out → split into two independent parts.
        // Left keeps original id; right gets a fresh id derived from the original.
        const leftPart = makeSlice(partStartSrc, srcCutStart)
        const rightPart = makeSlice(srcCutEnd, partEndSrc, allocateTailId(part.id))
        if (leftPart) outputParts.push(leftPart)
        if (rightPart) outputParts.push(rightPart)
      } else if (leftDur > 0) {
        // Only the left survives (cut extends to or beyond part end).
        const leftPart = makeSlice(partStartSrc, srcCutStart)
        if (leftPart) outputParts.push(leftPart)
      } else if (rightDur > 0) {
        // Only the right survives (cut starts at or before part start).
        const rightPart = makeSlice(srcCutEnd, partEndSrc)
        if (rightPart) outputParts.push(rightPart)
      }
      // else: whole part consumed → drop.
    }

    return {
      parts: outputParts,
      meta: {
        deleted_target_range_ms: { start: cutStart, end: cutEnd },
        parts_before: originalParts.length,
        parts_after: outputParts.length
      }
    }
  }

  private async duplicatePart(args: Record<string, unknown>) {
    const storyboardPath = this.resolveStoryboardPath(args)
    const partId = String(args.part_id || '').trim()
    if (!partId) throw new McpError(ErrorCode.InvalidParams, "'part_id' is required")

    const document = await this.loadStoryboard(storyboardPath)
    const parts = document.parts as StoryboardPart[]
    const sourceIndex = parts.findIndex((part) => part.id === partId)
    if (sourceIndex < 0) throw new Error(`Part not found: ${partId}`)
    const source = parts[sourceIndex]
    if (source.deleted) throw new Error(`Part not found: ${partId}`)
    if (source.blank) throw new Error(`Cannot duplicate a blank part: ${partId}`)

    const rawNewId = typeof args.new_id === 'string' ? args.new_id.trim() : ''
    const newId = rawNewId || this.generateCopyId(parts, partId)
    if (parts.some((part) => part.id === newId)) throw new Error(`new_id "${newId}" already exists`)

    // Deep-clone via JSON to avoid sharing nested captions/words references.
    let copy: StoryboardPart = JSON.parse(JSON.stringify(source))
    copy.id = newId
    if (typeof args.text === 'string' && args.text !== source.text) {
      copy = this.applyTextRewrite(copy, args.text)
    }

    const targetIndex = this.resolveInsertIndex(parts, args.insert_at, { referenceId: partId })
    const nextParts = [...parts]
    // Insert without removing the source.
    const clampedIndex = Math.max(0, Math.min(nextParts.length, targetIndex))
    nextParts.splice(clampedIndex, 0, copy)

    await this.writeStoryboard(storyboardPath, { ...document, parts: nextParts })

    return this.successResponse(storyboardPath, `Duplicated part ${partId} as ${newId}`, {
      source_part_id: partId,
      new_part_id: newId,
      inserted_at_index: clampedIndex
    })
  }

  private async movePart(args: Record<string, unknown>) {
    const storyboardPath = this.resolveStoryboardPath(args)
    const partId = String(args.part_id || '').trim()
    if (!partId) throw new McpError(ErrorCode.InvalidParams, "'part_id' is required")

    const document = await this.loadStoryboard(storyboardPath)
    const parts = document.parts as StoryboardPart[]
    const fromIndex = parts.findIndex((part) => part.id === partId)
    if (fromIndex < 0) throw new Error(`Part not found: ${partId}`)

    // Compute target on the array with the source part removed, so the target
    // index refers to the final position after the move.
    const without = parts.filter((_, index) => index !== fromIndex)
    const targetIndex = this.resolveInsertIndex(without, args.insert_at, { referenceId: partId })
    const clampedIndex = Math.max(0, Math.min(without.length, targetIndex))
    if (clampedIndex === fromIndex) {
      throw new Error(`Move had no effect: part ${partId} is already at index ${fromIndex}`)
    }
    const nextParts = [...without]
    nextParts.splice(clampedIndex, 0, parts[fromIndex])

    await this.writeStoryboard(storyboardPath, { ...document, parts: nextParts })

    return this.successResponse(storyboardPath, `Moved part ${partId} from ${fromIndex} to ${clampedIndex}`, {
      part_id: partId,
      from_index: fromIndex,
      to_index: clampedIndex
    })
  }

  private async clearPartText(args: Record<string, unknown>) {
    const storyboardPath = this.resolveStoryboardPath(args)
    const partId = String(args.part_id || '').trim()
    if (!partId) throw new McpError(ErrorCode.InvalidParams, "'part_id' is required")

    const document = await this.loadStoryboard(storyboardPath)
    const target = document.parts.find((part) => part.id === partId) as StoryboardPart | undefined
    if (!target || target.deleted) throw new Error(`Part not found: ${partId}`)
    if (target.blank) throw new Error(`Cannot clear text on a blank part: ${partId}`)
    if (!target.text && !(target.captions?.length)) {
      throw new Error(`Part ${partId} already has no text/captions`)
    }

    const nextPart: StoryboardPart = { ...target, text: '', captions: [] }
    const nextParts = (document.parts as StoryboardPart[]).map((part) =>
      part.id === partId ? nextPart : part
    )
    await this.writeStoryboard(storyboardPath, { ...document, parts: nextParts })

    return this.successResponse(storyboardPath, `Cleared text/captions on part ${partId}`, {
      part_id: partId
    })
  }

  private async insertBlankPart(args: Record<string, unknown>) {
    const storyboardPath = this.resolveStoryboardPath(args)
    const rawDuration = args.duration_ms
    if (typeof rawDuration !== 'number' || !Number.isFinite(rawDuration) || rawDuration <= 0) {
      throw new McpError(ErrorCode.InvalidParams, "'duration_ms' must be a positive number")
    }
    const durationMs = Math.max(1, Math.round(rawDuration))

    const document = await this.loadStoryboard(storyboardPath)
    const parts = document.parts as StoryboardPart[]

    const rawNewId = typeof args.new_id === 'string' ? args.new_id.trim() : ''
    const newId = rawNewId || this.generateBlankId(parts)
    if (parts.some((part) => part.id === newId)) throw new Error(`new_id "${newId}" already exists`)

    const targetIndex = this.resolveInsertIndex(parts, args.insert_at)
    const clampedIndex = Math.max(0, Math.min(parts.length, targetIndex))

    // Inherit sourceIndex from the neighbouring part so labelParts can still
    // group by original source segment; fall back to 0 when the track is empty.
    const neighbour = parts[clampedIndex - 1] ?? parts[clampedIndex] ?? null
    const sourceIndex = neighbour ? neighbour.sourceIndex : 0

    const blankPart: StoryboardPart = {
      id: newId,
      sourceIndex,
      blank: true,
      start: 0,
      end: durationMs,
      text: '',
      captions: []
    }

    const nextParts = [...parts]
    nextParts.splice(clampedIndex, 0, blankPart)

    await this.writeStoryboard(storyboardPath, { ...document, parts: nextParts })

    return this.successResponse(storyboardPath, `Inserted blank part ${newId} at index ${clampedIndex}`, {
      new_part_id: newId,
      duration_ms: durationMs,
      inserted_at_index: clampedIndex
    })
  }

  private async adjustPartBounds(args: Record<string, unknown>) {
    const storyboardPath = this.resolveStoryboardPath(args)
    const document = await this.loadStoryboard(storyboardPath)
    const { parts, segments, meta } = this.computeAdjustPartBounds(document, args)
    await this.writeStoryboard(storyboardPath, {
      ...document,
      parts,
      segments: segments ?? document.segments
    })
    return this.successResponse(
      storyboardPath,
      `Adjusted bounds of part ${meta.part_id} to [${(meta.new_bounds as { start_ms: number }).start_ms}, ${(meta.new_bounds as { end_ms: number }).end_ms})`,
      meta
    )
  }

  private computeAdjustPartBounds(document: StoryboardDocument, args: Record<string, unknown>): ComputeResult {
    const partId = String(args.part_id || '').trim()
    if (!partId) throw new McpError(ErrorCode.InvalidParams, "'part_id' is required")

    const delta = args.delta as { start_delta_ms?: number; end_delta_ms?: number } | undefined
    const absolute = args.absolute as { start_ms?: number; end_ms?: number } | undefined
    let hasDelta = delta && typeof delta === 'object' &&
      (typeof delta.start_delta_ms === 'number' || typeof delta.end_delta_ms === 'number')
    let hasAbsolute = absolute && typeof absolute === 'object' &&
      (typeof absolute.start_ms === 'number' || typeof absolute.end_ms === 'number')

    // Fallback: accept flat form (start_delta_ms/end_delta_ms/start_ms/end_ms directly on args)
    // — some MCP clients strip nested objects inside array items when serialising batch ops.
    const flatDelta = {
      start_delta_ms: typeof args.start_delta_ms === 'number' ? (args.start_delta_ms as number) : undefined,
      end_delta_ms: typeof args.end_delta_ms === 'number' ? (args.end_delta_ms as number) : undefined
    }
    const flatAbsolute = {
      start_ms: typeof args.start_ms === 'number' ? (args.start_ms as number) : undefined,
      end_ms: typeof args.end_ms === 'number' ? (args.end_ms as number) : undefined
    }
    const hasFlatDelta = flatDelta.start_delta_ms !== undefined || flatDelta.end_delta_ms !== undefined
    const hasFlatAbsolute = flatAbsolute.start_ms !== undefined || flatAbsolute.end_ms !== undefined

    let resolvedDelta = delta
    let resolvedAbsolute = absolute
    if (!hasDelta && hasFlatDelta) {
      resolvedDelta = flatDelta
      hasDelta = true
    }
    if (!hasAbsolute && hasFlatAbsolute) {
      resolvedAbsolute = flatAbsolute
      hasAbsolute = true
    }

    if (hasDelta && hasAbsolute) {
      throw new McpError(ErrorCode.InvalidParams, "Provide either 'delta' or 'absolute', not both")
    }
    if (!hasDelta && !hasAbsolute) {
      throw new McpError(ErrorCode.InvalidParams, "Provide 'delta' or 'absolute' with at least one numeric field")
    }

    const parts = document.parts as StoryboardPart[]
    const target = parts.find((part) => part.id === partId)
    if (!target || target.deleted) throw new Error(`Part not found: ${partId}`)
    if (target.blank) throw new Error(`Cannot adjust bounds on a blank part: ${partId}`)

    const currentRanges = partRanges(target) as StoryboardRange[]
    const currentStart = currentRanges[0].start
    const currentEnd = currentRanges[currentRanges.length - 1].end

    let newStart = currentStart
    let newEnd = currentEnd
    if (hasAbsolute) {
      if (typeof resolvedAbsolute!.start_ms === 'number') newStart = Math.round(resolvedAbsolute!.start_ms)
      if (typeof resolvedAbsolute!.end_ms === 'number') newEnd = Math.round(resolvedAbsolute!.end_ms)
    } else {
      if (typeof resolvedDelta!.start_delta_ms === 'number') newStart = currentStart + Math.round(resolvedDelta!.start_delta_ms)
      if (typeof resolvedDelta!.end_delta_ms === 'number') newEnd = currentEnd + Math.round(resolvedDelta!.end_delta_ms)
    }

    if (newStart < 0) throw new Error(`new start (${newStart}ms) must be >= 0`)
    if (newEnd <= newStart) {
      throw new Error(`new bounds [${newStart}, ${newEnd}) are empty — use delete_parts to remove the part instead`)
    }

    // Clip existing ranges into the new outer bounds; drop ranges that fall completely outside.
    const nextRanges: StoryboardRange[] = currentRanges
      .map((r) => ({ start: Math.max(r.start, newStart), end: Math.min(r.end, newEnd) }))
      .filter((r) => r.end > r.start)
    // Extend the first/last range so the new bounds are honoured (delta may extend outward).
    if (!nextRanges.length) {
      nextRanges.push({ start: newStart, end: newEnd })
    } else {
      nextRanges[0].start = Math.min(nextRanges[0].start, newStart)
      nextRanges[nextRanges.length - 1].end = Math.max(nextRanges[nextRanges.length - 1].end, newEnd)
    }

    const previousCaptions: StoryboardCaption[] = target.captions || []
    const nextCaptions: StoryboardCaption[] = previousCaptions.flatMap((cue) => {
      const start = Math.max(cue.start, newStart)
      const end = Math.min(cue.end, newEnd)
      if (end <= start) return []
      if (cue.words?.length) {
        const clipped = clipCaption(cue, start, end)
        return clipped ? [clipped as StoryboardCaption] : []
      }
      const chars = Array.from(cue.text)
      const from = Math.round((chars.length * (start - cue.start)) / Math.max(1, cue.end - cue.start))
      const to = Math.round((chars.length * (end - cue.start)) / Math.max(1, cue.end - cue.start))
      return [{ start, end, text: chars.slice(from, to).join('') }]
    })

    const nextText = nextCaptions.map((cue) => cue.text).join('\n')
    const nextPart: StoryboardPart = {
      ...target,
      start: newStart,
      end: newEnd,
      text: nextText,
      captions: nextCaptions
    }
    delete nextPart.ranges
    if (nextRanges.length > 1 || nextRanges[0].start !== newStart || nextRanges[nextRanges.length - 1].end !== newEnd) {
      nextPart.ranges = nextRanges
    }

    const nextParts = parts.map((part) => (part.id === partId ? nextPart : part))

    // If the new source range extends outside the union of existing ASR
    // segments, auto-append a placeholder segment so document.segments still
    // fully covers every part's source_timerange.
    const nextSegments = this.extendSegmentsIfNeeded(
      document.segments as StoryboardSegment[],
      newStart,
      newEnd
    )

    return {
      parts: nextParts,
      segments: nextSegments,
      meta: {
        part_id: partId,
        previous_bounds: { start_ms: currentStart, end_ms: currentEnd },
        new_bounds: { start_ms: newStart, end_ms: newEnd },
        segments_extended: nextSegments.length !== (document.segments as StoryboardSegment[]).length
      }
    }
  }

  // Extend document.segments so their union covers [newStart, newEnd).
  // Uncovered gaps are inserted as placeholder segments (empty text, no words,
  // fresh sourceIndex). Existing segments are never modified.
  private extendSegmentsIfNeeded(
    segments: StoryboardSegment[],
    newStart: number,
    newEnd: number
  ): StoryboardSegment[] {
    if (!(newEnd > newStart)) return segments
    // Merge existing segment coverage into ordered non-overlapping intervals.
    const sorted = [...segments]
      .map((seg) => ({ start: seg.start, end: seg.end }))
      .sort((a, b) => a.start - b.start)
    const merged: { start: number; end: number }[] = []
    for (const iv of sorted) {
      const last = merged[merged.length - 1]
      if (last && iv.start <= last.end) {
        last.end = Math.max(last.end, iv.end)
      } else {
        merged.push({ start: iv.start, end: iv.end })
      }
    }
    // Subtract merged coverage from [newStart, newEnd) to find gaps.
    const gaps: { start: number; end: number }[] = []
    let cursor = newStart
    for (const iv of merged) {
      if (iv.end <= cursor) continue
      if (iv.start >= newEnd) break
      if (iv.start > cursor) gaps.push({ start: cursor, end: iv.start })
      cursor = Math.max(cursor, iv.end)
      if (cursor >= newEnd) break
    }
    if (cursor < newEnd) gaps.push({ start: cursor, end: newEnd })
    if (!gaps.length) return segments
    let nextSourceIndex = segments.reduce(
      (max, seg) => Math.max(max, typeof seg.sourceIndex === 'number' ? seg.sourceIndex : -1),
      -1
    )
    const additions: StoryboardSegment[] = gaps.map((gap) => {
      nextSourceIndex += 1
      return { start: gap.start, end: gap.end, text: '', sourceIndex: nextSourceIndex }
    })
    return [...segments, ...additions].sort((a, b) => a.start - b.start)
  }

  private generateBlankId(parts: StoryboardPart[]): string {
    const existing = new Set(parts.map((part) => part.id))
    let index = 1
    while (existing.has(`blank-${index}`)) index += 1
    return `blank-${index}`
  }

  private resolveInsertIndex(
    parts: StoryboardPart[],
    raw: unknown,
    context: { referenceId?: string } = {}
  ): number {
    if (!raw || typeof raw !== 'object') {
      throw new McpError(ErrorCode.InvalidParams, "'insert_at' is required")
    }
    const spec = raw as { type?: string; value?: number; part_id?: string }
    switch (spec.type) {
      case 'start':
        return 0
      case 'end':
        return parts.length
      case 'index': {
        if (typeof spec.value !== 'number' || !Number.isFinite(spec.value)) {
          throw new McpError(ErrorCode.InvalidParams, "'insert_at.value' must be a finite number when type='index'")
        }
        return Math.max(0, Math.min(parts.length, Math.round(spec.value)))
      }
      case 'before':
      case 'after': {
        const anchor = typeof spec.part_id === 'string' ? spec.part_id.trim() : ''
        if (!anchor) throw new McpError(ErrorCode.InvalidParams, `'insert_at.part_id' is required when type='${spec.type}'`)
        if (anchor === context.referenceId) {
          throw new Error(`'insert_at.part_id' cannot reference the same part being duplicated/moved`)
        }
        const anchorIndex = parts.findIndex((part) => part.id === anchor)
        if (anchorIndex < 0) throw new Error(`insert_at anchor part not found: ${anchor}`)
        return spec.type === 'before' ? anchorIndex : anchorIndex + 1
      }
      default:
        throw new McpError(
          ErrorCode.InvalidParams,
          "'insert_at.type' must be one of 'start' | 'end' | 'index' | 'before' | 'after'"
        )
    }
  }

  private generateCopyId(parts: StoryboardPart[], baseId: string): string {
    const existing = new Set(parts.map((part) => part.id))
    let index = 1
    while (existing.has(`${baseId}-copy-${index}`)) index += 1
    return `${baseId}-copy-${index}`
  }

  private applyTextRewrite(part: StoryboardPart, nextText: string): StoryboardPart {
    const captions = part.captions ?? []
    const lines = nextText.split('\n')
    if (!captions.length) {
      return { ...part, text: nextText, captions: [{ start: part.start, end: part.end, text: nextText }] }
    }
    if (lines.length !== captions.length) {
      throw new Error(
        `text must produce exactly ${captions.length} caption line(s) (split by "\\n"); got ${lines.length}. Use update_part_text on the copy after duplicating if you need advanced multi-caption rewriting.`
      )
    }
    const nextCaptions = captions.map((cue, index) => this.replaceCaptionText(cue, lines[index]))
    return { ...part, text: nextCaptions.map((cue) => cue.text).join('\n'), captions: nextCaptions }
  }

  private successResponse(storyboardPath: string, message: string, extras: Record<string, unknown>) {
    const payload = {
      ok: true,
      message,
      storyboard_path: storyboardPath,
      ...extras
    }
    return {
      structuredContent: payload,
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(payload, null, 2)
        }
      ]
    }
  }

  private generateNextId(parts: StoryboardPart[], baseId: string): string {
    const existing = new Set(parts.map((part) => part.id))
    let index = 1
    while (existing.has(`${baseId}-split-${index}`)) index += 1
    return `${baseId}-split-${index}`
  }

  private async applyOperations(args: Record<string, unknown>) {
    const storyboardPath = this.resolveStoryboardPath(args)
    const operations = args.operations
    if (!Array.isArray(operations) || operations.length === 0) {
      throw new McpError(ErrorCode.InvalidParams, "'operations' must be a non-empty array")
    }

    const document = await this.loadStoryboard(storyboardPath)
    let currentDocument: StoryboardDocument = document
    const operationSummaries: Array<Record<string, unknown>> = []

    for (let i = 0; i < operations.length; i += 1) {
      const op = operations[i]
      if (!op || typeof op !== 'object') {
        throw new McpError(ErrorCode.InvalidParams, `operations[${i}] must be an object`)
      }
      const opRecord = op as Record<string, unknown>
      const opType = typeof opRecord.type === 'string' ? opRecord.type : ''
      if (!opType) {
        throw new McpError(ErrorCode.InvalidParams, `operations[${i}].type is required`)
      }

      let result: ComputeResult
      switch (opType) {
        case 'update_part_text':
          result = this.computeUpdatePartText(currentDocument, opRecord)
          break
        case 'split_part':
          result = this.computeSplitPart(currentDocument, opRecord)
          break
        case 'merge_parts':
          result = this.computeMergeParts(currentDocument, opRecord)
          break
        case 'delete_parts':
          result = this.computeDeleteParts(currentDocument, opRecord)
          break
        case 'delete_range':
          result = this.computeDeleteRange(currentDocument, opRecord)
          break
        case 'adjust_part_bounds':
          result = this.computeAdjustPartBounds(currentDocument, opRecord)
          break
        case 'apply_operations':
          throw new Error(`operations[${i}]: nesting apply_operations inside apply_operations is not allowed`)
        default:
          throw new McpError(
            ErrorCode.InvalidParams,
            `operations[${i}]: unsupported op type '${opType}'. Supported types: update_part_text, split_part, merge_parts, delete_parts, delete_range, adjust_part_bounds.`
          )
      }

      currentDocument = {
        ...currentDocument,
        parts: result.parts,
        segments: result.segments ?? currentDocument.segments
      }
      operationSummaries.push({ op_index: i, type: opType, ...result.meta })
    }

    await this.writeStoryboard(storyboardPath, currentDocument)

    return this.successResponse(storyboardPath, `Applied ${operations.length} operations`, {
      operations_applied: operations.length,
      operation_summaries: operationSummaries
    })
  }
}

// Local helpers ---------------------------------------------------------------

// Mirror of model.partPoint (used only for char_index → source_time conversion)
function partPoint(part: StoryboardPart, offset: number): { sourceTime: number } | undefined {
  const ranges = partRanges(part) as StoryboardRange[]
  const total = partDuration(part) as number
  const position = Math.max(0, Math.min(offset, total))
  let start = 0
  for (let i = 0; i < ranges.length; i += 1) {
    const range = ranges[i]
    const end = start + range.end - range.start
    if (position < end || i === ranges.length - 1) {
      return { sourceTime: range.start + position - start }
    }
    start = end
  }
  return undefined
}

// Suppress unused-import warnings for helpers used indirectly via model.js.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _keepModelReference = { activeParts, labelParts, validateParts, partOffset }

export default StoryboardEditorServer
