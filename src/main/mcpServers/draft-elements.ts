import { randomUUID } from 'node:crypto'
import fsPromises from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import { windowService } from '@main/services/WindowService'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import Store from 'electron-store'
import { net } from 'electron'

import { renderTextPositionPreview, renderTextStylePreview } from './preview/textStyle'
import { renderFontSprite, type FontSpriteItem } from './preview/textFontSprite'
import { fetchTextAnimationPreviewImages, type TextAnimationPreviewItem, type TextAnimationPreviewKind } from './preview/textAnimationPreviewImages'

const logger = loggerService.withContext('MCPServer:DraftElements')

const API_HOST = 'https://open.vectcut.com'
const OAUTH_TOKEN_URL = 'https://mlbd8l6vgi13-demo.authing.cn/oidc/token'
const OAUTH_CLIENT_ID = '6901dd145dafc6f1f3143938'
const OAUTH_CLIENT_SECRET = '16a94e467e927cc09b3c8dc7ec92d420'

const ENDPOINTS = {
  add_text: '/cut_jianying/add_text',
  add_batch_text: '/cut_jianying/add_batch_text',
  remove_text: '/cut_jianying/remove_text',
  modify_text: '/cut_jianying/modify_text',
  add_subtitle: '/cut_jianying/add_subtitle',
  add_text_template: '/cut_jianying/add_text_template',
  get_text_intro_types: '/cut_jianying/get_text_intro_types',
  get_text_outro_types: '/cut_jianying/get_text_outro_types',
  get_text_loop_anim_types: '/cut_jianying/get_text_loop_anim_types',
  get_text_intro_previews: '/cut_jianying/get_text_intro_previews',
  get_text_outro_previews: '/cut_jianying/get_text_outro_previews',
  get_text_loop_anim_previews: '/cut_jianying/get_text_loop_anim_previews',
  get_font_previews: '/cut_jianying/get_font_previews',
  get_text_template_previews: '/cut_jianying/get_text_template_previews',
  add_image: '/cut_jianying/add_image',
  add_batch_image: '/cut_jianying/add_batch_image',
  add_preset: '/cut_jianying/add_preset',
  add_batch_preset: '/cut_jianying/add_batch_preset',
  modify_image: '/cut_jianying/modify_image',
  remove_image: '/cut_jianying/remove_image',
  add_video: '/cut_jianying/add_video',
  add_batch_video: '/cut_jianying/add_batch_video',
  modify_video: '/cut_jianying/modify_video',
  remove_video: '/cut_jianying/remove_video',
  get_transition_types: '/cut_jianying/get_transition_types',
  add_audio: '/cut_jianying/add_audio',
  add_batch_audio: '/cut_jianying/add_batch_audio',
  modify_audio: '/cut_jianying/modify_audio',
  remove_audio: '/cut_jianying/remove_audio',
  get_audio_effect_types: '/cut_jianying/get_audio_effect_types',
  add_video_keyframe: '/cut_jianying/add_video_keyframe',
  add_effect: '/cut_jianying/add_effect',
  modify_effect: '/cut_jianying/modify_effect',
  remove_effect: '/cut_jianying/remove_effect',
  get_video_character_effect_types: '/cut_jianying/get_video_character_effect_types',
  get_video_scene_effect_types: '/cut_jianying/get_video_scene_effect_types',
  add_filter: '/cut_jianying/add_filter',
  modify_filter: '/cut_jianying/modify_filter',
  remove_filter: '/cut_jianying/remove_filter',
  get_filter_types: '/cut_jianying/get_filter_types',
  get_intro_animation_types: '/cut_jianying/get_intro_animation_types',
  get_outro_animation_types: '/cut_jianying/get_outro_animation_types',
  get_combo_animation_types: '/cut_jianying/get_combo_animation_types'
} as const

const toolWithArgs = (name: string, description: string, properties: Record<string, object>, required: string[] = []): Tool => ({
  name,
  description,
  inputSchema: {
    type: 'object',
    properties,
    required,
    additionalProperties: true
  }
})

const readonlyTool = (name: string, description: string): Tool => ({
  name,
  description,
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false
  }
})

const TOOLS: Tool[] = [
  toolWithArgs(
    'add_text',
    'Add a single text layer into a VectCut draft. Use this for one text block with optional font, color, position, and animations. For short phrases, calls to action, labels, or any text that should be emphasized or visually prominent, consider add_text_template and inspect candidate looks with get_text_template_previews instead of relying on plain text alone. For ordinary text, use text_styles proactively to emphasize important words or phrases with per-range size, color, bold, border, or shadow; highlighting key information with text_styles is an important default, not merely an edge case. Preview uncertain text_styles runs with get_text_style_preview, which accepts the same text_styles shape. If you are unsure what the text position, size, or font will actually look like, check get_text_style_preview (position/size/color/border/shadow snapshot) and get_font_previews (real font glyph previews) first. For animations, preview the actual motion with get_text_intro_animation_previews, get_text_outro_animation_previews, and get_text_loop_animation_previews before picking intro_animation/outro_animation/loop_animation names. Verification is recommended, not mandatory, when values look extreme: font_size below 3 or above 20; pixel position offsets transform_x_px/transform_y_px beyond -2000 or 2000; or the font is a guessed generic family name such as 系统, 思源, 鸿蒙/HarmonyOS Sans, Source Han, or system default fonts. Such values are not rejected, but preview them to confirm the visual effect. Prefer the lightweight preview tools first; use render_draft (草稿渲染 / 云渲染 / 预渲染) as a last resort when they cannot verify the actual result: 字幕验收、动画时序、轨道层叠、声音效果、声音大小、字体效果、转场效果、组合画面. If the working draft exceeds the render limits, create a separate cloud test draft <=5 seconds that reproduces the relevant layers, timing, styles and audio, then render that test draft without changing the working draft. Use cloud-accessible assets with full video/audio sources <=20 seconds and images <=20 MiB; trimming a long source on the timeline alone does not satisfy the source limit. These limits guide test-draft preparation, not abandoning render verification.',
    {
      text: { type: 'string', description: 'Required text content.' },
      start: { type: 'number', description: 'Required start time in seconds.' },
      end: { type: 'number', description: 'Required end time in seconds.' },
      draftId: { type: 'string', description: 'Optional draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Optional draft ID.' },
      clientRequestId: {
        type: 'string',
        description: 'Optional client request ID used to correlate pending and completed UI updates.'
      },
      transform_y: { type: 'number', description: 'Optional Y transform ratio.' },
      transform_x: { type: 'number', description: 'Optional X transform ratio.' },
      font: { type: 'string', description: 'Optional font name.' },
      font_color: { type: 'string', description: 'Optional font color.' },
      font_size: { type: 'number', description: 'Optional font size.' },
      trackName: { type: 'string', description: 'Optional track name alias of track_name.' },
      track_name: { type: 'string', description: 'Optional track name.' },
      vertical: { type: 'boolean', description: 'Optional vertical text mode. false means horizontal alignment, true means vertical alignment.' },
      font_alpha: { type: 'number', description: 'Optional font alpha.' },
      fixed_width_px: { type: 'number', description: 'Optional fixed layout width in pixels.' },
      fixed_height_px: { type: 'number', description: 'Optional fixed layout height in pixels.' },
      border_alpha: { type: 'number', description: 'Optional border alpha.' },
      border_color: { type: 'string', description: 'Optional border color.' },
      border_width: { type: 'number', description: 'Optional border width.' },
      background_color: { type: 'string', description: 'Optional background color.' },
      background_style: { type: 'integer', enum: [1, 2], description: 'Optional background style: 1 for a whole text block, 2 for individual lines.' },
      background_alpha: { type: 'number', description: 'Optional background alpha.' },
      background_round_radius: { type: 'number', description: 'Optional background round radius.' },
      background_height: { type: 'number', description: 'Optional background height.' },
      background_width: { type: 'number', description: 'Optional background width.' },
      background_horizontal_offset: { type: 'number', description: 'Optional background horizontal offset.' },
      background_vertical_offset: { type: 'number', description: 'Optional background vertical offset.' },
      shadow_enabled: { type: 'boolean', description: 'Optional shadow enabled flag.' },
      shadow_alpha: { type: 'number', description: 'Optional shadow alpha.' },
      shadow_angle: { type: 'number', description: 'Optional shadow angle.' },
      shadow_color: { type: 'string', description: 'Optional shadow color.' },
      shadow_distance: { type: 'number', description: 'Optional shadow distance.' },
      shadow_smoothing: { type: 'number', description: 'Optional shadow smoothing.' },
      intro_animation: { type: 'string', description: 'Optional intro animation name.' },
      intro_duration: { type: 'number', description: 'Optional intro animation duration.' },
      outro_animation: { type: 'string', description: 'Optional outro animation name.' },
      outro_duration: { type: 'number', description: 'Optional outro animation duration.' },
      width: { type: 'number', description: 'Optional canvas width.' },
      height: { type: 'number', description: 'Optional canvas height.' },
      text_styles: {
        type: 'array',
        items: { type: 'object' },
        description: 'Optional multi-style text configuration list.'
      },
      bubble_effect_id: { type: 'string', description: 'Optional bubble effect ID.' },
      bubble_resource_id: { type: 'string', description: 'Optional bubble resource ID.' },
      effect_effect_id: { type: 'string', description: 'Optional artist/effect ID.' },
      letter_spacing: { type: 'number', description: 'Optional letter spacing.' },
      line_spacing: { type: 'number', description: 'Optional line spacing.' },
      loop_animation: { type: 'string', description: 'Optional loop animation name.' },
      loop_duration: { type: 'number', description: 'Optional loop animation duration.' },
      scale_x: { type: 'number', description: 'Optional X scale.' },
      scale_y: { type: 'number', description: 'Optional Y scale.' },
      relative_index: { type: 'number', description: 'Optional relative track index.' },
      align: { type: 'integer', description: 'Optional text alignment enum. When vertical=false use 0/1/2 for left/center/right; when vertical=true use 3/1/4 for top/center/bottom.' },
      rotation: { type: 'number', description: 'Optional rotation in degrees.' },
      transform_y_px: { type: 'number', description: 'Optional Y transform in pixels.' },
      transform_x_px: { type: 'number', description: 'Optional X transform in pixels.' },
      bold: { type: 'boolean', description: 'Optional bold flag.' },
      italic: { type: 'boolean', description: 'Optional italic flag.' },
      underline: { type: 'boolean', description: 'Optional underline flag.' }
    },
    ['text', 'start', 'end']
  ),
  toolWithArgs(
    'add_batch_text',
    'Add multiple text layers into a VectCut draft in one request. Use this when the user wants batch text insertion or multiple caption segments. If you are unsure what the text position, size, or font will actually look like, check get_text_style_preview (position/size/color/border/shadow snapshot) and get_font_previews (real font glyph previews) first. For rich text styles, if unsure how text_styles keyword runs (per-range size/color/bold/border/shadow) will render, preview them with get_text_style_preview — it accepts the same text_styles shape. For animations, preview the actual motion with get_text_intro_animation_previews, get_text_outro_animation_previews, and get_text_loop_animation_previews before picking intro_animation/outro_animation/loop_animation names. Verification is recommended, not mandatory, when values look extreme: font_size below 3 or above 20; pixel position offsets transform_x_px/transform_y_px beyond -2000 or 2000; or the font is a guessed generic family name such as 系统, 思源, 鸿蒙/HarmonyOS Sans, Source Han, or system default fonts. Such values are not rejected, but preview them to confirm the visual effect. Prefer the lightweight preview tools first; use render_draft (草稿渲染 / 云渲染 / 预渲染) as a last resort when they cannot verify the actual result: 字幕验收、动画时序、轨道层叠、声音效果、声音大小、字体效果、转场效果、组合画面. If the working draft exceeds the render limits, create a separate cloud test draft <=5 seconds that reproduces the relevant layers, timing, styles and audio, then render that test draft without changing the working draft. Use cloud-accessible assets with full video/audio sources <=20 seconds and images <=20 MiB; trimming a long source on the timeline alone does not satisfy the source limit. These limits guide test-draft preparation, not abandoning render verification.',
    {
      texts: { type: 'array', items: { type: 'string' }, description: 'Required text contents.' },
      starts: { type: 'array', items: { type: 'number' }, description: 'Required start times in seconds.' },
      end: { type: 'array', items: { type: 'number' }, description: 'Official doc variant of batch end times.' },
      ends: { type: 'array', items: { type: 'number' }, description: 'Required end times in seconds.' },
      draftId: { type: 'string', description: 'Optional draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Optional draft ID.' },
      transform_y: { type: 'number', description: 'Optional Y transform ratio.' },
      transform_y_px: { type: 'number', description: 'Optional Y transform in pixels.' },
      transform_x: { type: 'number', description: 'Optional X transform ratio.' },
      transform_x_px: { type: 'number', description: 'Optional X transform in pixels.' },
      scale_x: { type: 'number', description: 'Optional X scale.' },
      scale_y: { type: 'number', description: 'Optional Y scale.' },
      font: { type: 'string', description: 'Optional font name.' },
      align: { type: 'integer', description: 'Optional text alignment enum. When vertical=false use 0/1/2 for left/center/right; when vertical=true use 3/1/4 for top/center/bottom.' },
      rotation: { type: 'number', description: 'Optional rotation in degrees.' },
      font_color: { type: 'string', description: 'Optional font color.' },
      font_size: { type: 'integer', description: 'Optional font size.' },
      bold: { type: 'boolean', description: 'Optional bold flag.' },
      italic: { type: 'boolean', description: 'Optional italic flag.' },
      underline: { type: 'boolean', description: 'Optional underline flag.' },
      track_name: { type: 'string', description: 'Optional track name.' },
      relative_index: { type: 'integer', description: 'Optional relative track index.' },
      vertical: { type: 'boolean', description: 'Optional vertical text mode. false means horizontal alignment, true means vertical alignment.' },
      font_alpha: { type: 'number', description: 'Optional font alpha.' },
      fixed_width_px: { type: 'number', description: 'Optional fixed layout width in pixels.' },
      fixed_height_px: { type: 'number', description: 'Optional fixed layout height in pixels.' },
      border_alpha: { type: 'number', description: 'Optional border alpha.' },
      border_color: { type: 'string', description: 'Optional border color.' },
      border_width: { type: 'integer', description: 'Optional border width.' },
      background_color: { type: 'string', description: 'Optional background color.' },
      background_style: { type: 'integer', description: 'Optional background style.' },
      background_alpha: { type: 'number', description: 'Optional background alpha.' },
      background_round_radius: { type: 'number', description: 'Optional background round radius.' },
      background_height: { type: 'number', description: 'Optional background height.' },
      background_width: { type: 'number', description: 'Optional background width.' },
      background_horizontal_offset: { type: 'number', description: 'Optional background horizontal offset.' },
      background_vertical_offset: { type: 'number', description: 'Optional background vertical offset.' },
      shadow_enabled: { type: 'boolean', description: 'Optional shadow enabled flag.' },
      shadow_alpha: { type: 'number', description: 'Optional shadow alpha.' },
      shadow_angle: { type: 'number', description: 'Optional shadow angle.' },
      shadow_color: { type: 'string', description: 'Optional shadow color.' },
      shadow_distance: { type: 'integer', description: 'Optional shadow distance.' },
      shadow_smoothing: { type: 'number', description: 'Optional shadow smoothing.' },
      intro_animation: { type: 'string', description: 'Optional intro animation name.' },
      intro_duration: { type: 'number', description: 'Optional intro animation duration.' },
      outro_animation: { type: 'string', description: 'Optional outro animation name.' },
      outro_duration: { type: 'number', description: 'Optional outro animation duration.' },
      loop_animation: { type: 'string', description: 'Optional loop animation name.' },
      loop_duration: { type: 'number', description: 'Optional loop animation duration.' },
      width: { type: 'integer', description: 'Optional canvas width.' },
      height: { type: 'integer', description: 'Optional canvas height.' },
      text_styles: {
        type: 'array',
        items: { type: 'object' },
        description: 'Optional multi-style text configuration list.'
      },
      bubble_effect_id: { type: 'string', description: 'Optional bubble effect ID.' },
      bubble_resource_id: { type: 'string', description: 'Optional bubble resource ID.' },
      effect_effect_id: { type: 'string', description: 'Optional artist/effect ID.' },
      letter_spacing: { type: 'integer', description: 'Optional letter spacing.' },
      line_spacing: { type: 'integer', description: 'Optional line spacing.' }
    },
    ['texts', 'starts', 'ends']
  ),
  toolWithArgs(
    'remove_text',
    'Remove an existing text material from a VectCut draft by material ID.',
    {
      draftId: { type: 'string', description: 'Required draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Required draft ID.' },
      materialId: { type: 'string', description: 'Required material ID alias of material_id.' },
      material_id: { type: 'string', description: 'Required material ID.' }
    },
    ['draft_id', 'material_id']
  ),
  toolWithArgs(
    'modify_text',
    'Modify an existing text material in a VectCut draft by material ID. If you are unsure what the resulting text position, size, or font will look like, check get_text_style_preview (position/size/color/border/shadow snapshot) and get_font_previews (real font glyph previews) first. For rich text styles, if unsure how text_styles keyword runs (per-range size/color/bold/border/shadow) will render, preview them with get_text_style_preview — it accepts the same text_styles shape. For animations, preview the actual motion with get_text_intro_animation_previews, get_text_outro_animation_previews, and get_text_loop_animation_previews before picking intro_animation/outro_animation/loop_animation names. Verification is recommended, not mandatory, when values look extreme: font_size below 3 or above 20; pixel position offsets transform_x_px/transform_y_px beyond -2000 or 2000; or the font is a guessed generic family name such as 系统, 思源, 鸿蒙/HarmonyOS Sans, Source Han, or system default fonts. Such values are not rejected, but preview them to confirm the visual effect. Prefer the lightweight preview tools first; use render_draft (草稿渲染 / 云渲染 / 预渲染) as a last resort when they cannot verify the actual result: 字幕验收、动画时序、轨道层叠、声音效果、声音大小、字体效果、转场效果、组合画面. If the working draft exceeds the render limits, create a separate cloud test draft <=5 seconds that reproduces the relevant layers, timing, styles and audio, then render that test draft without changing the working draft. Use cloud-accessible assets with full video/audio sources <=20 seconds and images <=20 MiB; trimming a long source on the timeline alone does not satisfy the source limit. These limits guide test-draft preparation, not abandoning render verification.',
    {
      draftId: { type: 'string', description: 'Required draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Required draft ID.' },
      materialId: { type: 'string', description: 'Required material ID alias of material_id.' },
      material_id: { type: 'string', description: 'Required material ID.' },
      text: { type: 'string', description: 'Optional updated text content.' },
      start: { type: 'number', description: 'Optional start time in seconds.' },
      end: { type: 'number', description: 'Optional end time in seconds.' },
      transform_y: { type: 'number', description: 'Optional Y transform ratio.' },
      transform_x: { type: 'number', description: 'Optional X transform ratio.' },
      transform_y_px: { type: 'number', description: 'Optional Y transform in pixels.' },
      transform_x_px: { type: 'number', description: 'Optional X transform in pixels.' },
      scale_x: { type: 'number', description: 'Optional X scale.' },
      scale_y: { type: 'number', description: 'Optional Y scale.' },
      font: { type: 'string', description: 'Optional font name.' },
      font_color: { type: 'string', description: 'Optional font color.' },
      font_size: { type: 'number', description: 'Optional font size.' },
      bold: { type: 'boolean', description: 'Optional bold flag.' },
      italic: { type: 'boolean', description: 'Optional italic flag.' },
      underline: { type: 'boolean', description: 'Optional underline flag.' },
      track_name: { type: 'string', description: 'Optional track name.' },
      relative_index: { type: 'number', description: 'Optional relative track index.' },
      vertical: { type: 'boolean', description: 'Optional vertical text mode. false means horizontal alignment, true means vertical alignment.' },
      font_alpha: { type: 'number', description: 'Optional font alpha.' },
      letter_spacing: { type: 'number', description: 'Optional letter spacing.' },
      line_spacing: { type: 'number', description: 'Optional line spacing.' },
      align: { type: 'integer', description: 'Optional text alignment enum. When vertical=false use 0/1/2 for left/center/right; when vertical=true use 3/1/4 for top/center/bottom.' },
      rotation: { type: 'number', description: 'Optional rotation in degrees.' },
      border_alpha: { type: 'number', description: 'Optional border alpha.' },
      border_color: { type: 'string', description: 'Optional border color.' },
      border_width: { type: 'number', description: 'Optional border width.' },
      background_color: { type: 'string', description: 'Optional background color.' },
      background_style: { type: 'string', description: 'Optional background style.' },
      background_alpha: { type: 'number', description: 'Optional background alpha.' },
      background_round_radius: { type: 'number', description: 'Optional background round radius.' },
      background_height: { type: 'number', description: 'Optional background height.' },
      background_width: { type: 'number', description: 'Optional background width.' },
      background_horizontal_offset: { type: 'number', description: 'Optional background horizontal offset.' },
      background_vertical_offset: { type: 'number', description: 'Optional background vertical offset.' },
      shadow_enabled: { type: 'boolean', description: 'Optional shadow enabled flag.' },
      shadow_alpha: { type: 'number', description: 'Optional shadow alpha.' },
      shadow_angle: { type: 'number', description: 'Optional shadow angle.' },
      shadow_color: { type: 'string', description: 'Optional shadow color.' },
      shadow_distance: { type: 'number', description: 'Optional shadow distance.' },
      shadow_smoothing: { type: 'number', description: 'Optional shadow smoothing.' },
      bubble_effect_id: { type: 'string', description: 'Optional bubble effect ID.' },
      bubble_resource_id: { type: 'string', description: 'Optional bubble resource ID.' },
      effect_effect_id: { type: 'string', description: 'Optional artist/effect ID.' },
      intro_animation: { type: 'string', description: 'Optional intro animation name.' },
      intro_duration: { type: 'number', description: 'Optional intro animation duration.' },
      outro_animation: { type: 'string', description: 'Optional outro animation name.' },
      outro_duration: { type: 'number', description: 'Optional outro animation duration.' },
      loop_animation: { type: 'string', description: 'Optional loop animation name.' },
      loop_duration: { type: 'number', description: 'Optional loop animation duration.' },
      fixed_width_px: { type: 'number', description: 'Optional fixed layout width in pixels.' },
      fixed_height_px: { type: 'number', description: 'Optional fixed layout height in pixels.' },
      text_styles: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional multi-style text configuration list.'
      }
    },
    ['draft_id', 'material_id']
  ),
  toolWithArgs(
    'add_subtitle',
    'Add SRT subtitles into a VectCut draft. Supports raw SRT content or an SRT file URL. If you are unsure what the subtitle font, size, or position will actually look like, check get_text_style_preview (position/size/color/border/shadow snapshot) and get_font_previews (real font glyph previews) first. Verification is recommended, not mandatory, when values look extreme: font_size below 3 or above 20; pixel position offsets transform_x_px/transform_y_px beyond -2000 or 2000; or the font is a guessed generic family name such as 系统, 思源, 鸿蒙/HarmonyOS Sans, Source Han, or system default fonts. Such values are not rejected, but preview them to confirm the visual effect. Prefer the lightweight preview tools first; use render_draft (草稿渲染 / 云渲染 / 预渲染) as a last resort when they cannot verify the actual result: 字幕验收、动画时序、轨道层叠、声音效果、声音大小、字体效果、转场效果、组合画面. If the working draft exceeds the render limits, create a separate cloud test draft <=5 seconds that reproduces the relevant layers, timing, styles and audio, then render that test draft without changing the working draft. Use cloud-accessible assets with full video/audio sources <=20 seconds and images <=20 MiB; trimming a long source on the timeline alone does not satisfy the source limit. These limits guide test-draft preparation, not abandoning render verification.',
    {
      srt: { type: 'string', description: 'Required SRT content or URL.' },
      draftId: { type: 'string', description: 'Optional draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Optional draft ID.' },
      timeOffset: { type: 'number', description: 'Optional subtitle time offset alias of time_offset.' },
      time_offset: { type: 'number', description: 'Optional subtitle time offset in seconds.' },
      font_size: { type: 'number', description: 'Optional font size.' },
      font: { type: 'string', description: 'Optional font name.' },
      bold: { type: 'boolean', description: 'Optional bold flag.' },
      italic: { type: 'boolean', description: 'Optional italic flag.' },
      underline: { type: 'boolean', description: 'Optional underline flag.' },
      font_color: { type: 'string', description: 'Optional font color.' },
      vertical: { type: 'boolean', description: 'Optional vertical text mode.' },
      alpha: { type: 'number', description: 'Optional subtitle alpha.' },
      border_alpha: { type: 'number', description: 'Optional border alpha.' },
      border_color: { type: 'string', description: 'Optional border color.' },
      border_width: { type: 'number', description: 'Optional border width.' },
      background_color: { type: 'string', description: 'Optional background color.' },
      background_style: { type: 'string', description: 'Optional background style.' },
      background_alpha: { type: 'number', description: 'Optional background alpha.' },
      transform_x: { type: 'number', description: 'Optional X transform ratio.' },
      transform_y: { type: 'number', description: 'Optional Y transform ratio.' },
      scale_x: { type: 'number', description: 'Optional X scale.' },
      scale_y: { type: 'number', description: 'Optional Y scale.' },
      rotation: { type: 'number', description: 'Optional rotation in degrees.' },
      track_name: { type: 'string', description: 'Optional track name.' },
      width: { type: 'number', description: 'Optional canvas width.' },
      height: { type: 'number', description: 'Optional canvas height.' },
      transform_y_px: { type: 'number', description: 'Optional Y transform in pixels.' },
      transform_x_px: { type: 'number', description: 'Optional X transform in pixels.' }
    },
    ['srt']
  ),
  toolWithArgs(
    'add_text_template',
    'Add a JianYing text template (文字模版) effect into a VectCut draft. Use this to quickly create styled titles, 花字, or card-style text; when the user asks to 使用剪映文字模版, prefer this tool over hand-assembling styles. Before adding a template, check its look with get_text_template_previews first (browse the sprite previews, note orientation and texts_count, and pass the chosen id as template_id). Prefer lightweight sprite previews first; use render_draft (草稿渲染 / 预渲染) as a last resort when they cannot verify the real text, font effects, position, size, animation timing or track compositing. Create a separate cloud test draft <=5 seconds reproducing the relevant template and layers if the working draft exceeds the limits; render the test draft without changing the working draft. Use cloud-accessible assets with full video/audio sources <=20 seconds and images <=20 MiB; timeline trimming alone does not satisfy the source limit. Prepare an eligible test draft rather than skipping render verification.',
    {
      template_id: { type: 'string', description: 'Required text template id from get_text_template_previews.' },
      texts: { type: 'array', items: { type: 'string' }, description: 'Optional text array for the template slots; length should match the template texts_count.' },
      draftId: { type: 'string', description: 'Optional draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Optional draft ID. Empty means create a new draft.' },
      start: { type: 'number', description: 'Optional target track start time in seconds. Default 0.' },
      end: { type: 'number', description: 'Optional target track end time in seconds. Default is the template duration.' },
      transform_y: { type: 'number', description: 'Optional Y transform ratio.' },
      transform_x: { type: 'number', description: 'Optional X transform ratio.' },
      rotation: { type: 'number', description: 'Optional rotation in degrees.' },
      scale_x: { type: 'number', description: 'Optional X scale.' },
      scale_y: { type: 'number', description: 'Optional Y scale.' },
      track_name: { type: 'string', description: 'Optional track name.' },
      width: { type: 'integer', description: 'Optional canvas width in pixels.' },
      height: { type: 'integer', description: 'Optional canvas height in pixels.' },
      transform_y_px: { type: 'integer', description: 'Optional Y transform in pixels.' },
      transform_x_px: { type: 'integer', description: 'Optional X transform in pixels.' }
    },
    ['template_id']
  ),
  readonlyTool(
    'get_text_intro_types',
    'List supported text intro animations. Use this before setting intro_animation on text tools.'
  ),
  readonlyTool(
    'get_text_outro_types',
    'List supported text outro animations. Use this before setting outro_animation on text tools.'
  ),
  readonlyTool(
    'get_text_loop_anim_types',
    'List supported text loop animations. Use this before setting loop_animation on text tools.'
  ),
  toolWithArgs(
    'get_text_intro_animation_previews',
    'Browse available text intro animations with visual previews. Each returned image is one animation preview_url from the backend and is already a 3x3 frame contact sheet. Do not stitch previews together. Returns inline PNG image content and saves each same PNG to the workspace when possible. Treat each rendered preview image as the source of truth for animation motion and timing; do not choose an intro_animation from name/metadata alone. Use q for keyword search and page to turn pages. Use the animation name as intro_animation in add_text/modify_text.',
    {
      page: { type: 'integer', description: 'Optional 1-based page index. Default 1.' },
      page_size: { type: 'integer', description: 'Optional page size (1-4). Default 4. Hard-capped at 4 because each item is already a 3x3 preview image.' },
      q: { type: 'string', description: 'Optional keyword search.' },
      category: { type: 'string', description: 'Optional category filter if supported by the backend.' }
    }
  ),
  toolWithArgs(
    'get_text_outro_animation_previews',
    'Browse available text outro animations with visual previews. Each returned image is one animation preview_url from the backend and is already a 3x3 frame contact sheet. Do not stitch previews together. Returns inline PNG image content and saves each same PNG to the workspace when possible. Treat each rendered preview image as the source of truth for animation motion and timing; do not choose an outro_animation from name/metadata alone. Use q for keyword search and page to turn pages. Use the animation name as outro_animation in add_text/modify_text.',
    {
      page: { type: 'integer', description: 'Optional 1-based page index. Default 1.' },
      page_size: { type: 'integer', description: 'Optional page size (1-4). Default 4. Hard-capped at 4 because each item is already a 3x3 preview image.' },
      q: { type: 'string', description: 'Optional keyword search.' },
      category: { type: 'string', description: 'Optional category filter if supported by the backend.' }
    }
  ),
  toolWithArgs(
    'get_text_loop_animation_previews',
    'Browse available text loop animations with visual previews. Each returned image is one animation preview_url from the backend and is already a 3x3 frame contact sheet. Do not stitch previews together. Returns inline PNG image content and saves each same PNG to the workspace when possible. Treat each rendered preview image as the source of truth for animation motion and timing; do not choose a loop_animation from name/metadata alone. Use q for keyword search and page to turn pages. Use the animation name as loop_animation in add_text/modify_text.',
    {
      page: { type: 'integer', description: 'Optional 1-based page index. Default 1.' },
      page_size: { type: 'integer', description: 'Optional page size (1-4). Default 4. Hard-capped at 4 because each item is already a 3x3 preview image.' },
      q: { type: 'string', description: 'Optional keyword search.' },
      category: { type: 'string', description: 'Optional category filter if supported by the backend.' }
    }
  ),
  toolWithArgs(
    'add_image',
    'Add a single image layer into a VectCut draft.',
    {
      imageUrl: { type: 'string', description: 'Required image URL or local file path alias of image_url.' },
      image_url: { type: 'string', description: 'Required image URL or local file path.' },
      start: { type: 'number', description: 'Optional start time in seconds.' },
      end: { type: 'number', description: 'Required end time in seconds.' },
      width: { type: 'number', description: 'Optional canvas width.' },
      height: { type: 'number', description: 'Optional canvas height.' },
      draftId: { type: 'string', description: 'Optional draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Optional draft ID.' },
      transform_x: { type: 'number', description: 'Optional X transform ratio.' },
      transform_y: { type: 'number', description: 'Optional Y transform ratio.' },
      scale_x: { type: 'number', description: 'Optional X scale.' },
      scale_y: { type: 'number', description: 'Optional Y scale.' },
      track_name: { type: 'string', description: 'Optional track name.' },
      relative_index: { type: 'number', description: 'Optional relative track index.' },
      intro_animation: { type: 'string', description: 'Optional intro animation name.' },
      intro_animation_duration: { type: 'number', description: 'Optional intro animation duration.' },
      outro_animation: { type: 'string', description: 'Optional outro animation name.' },
      outro_animation_duration: { type: 'number', description: 'Optional outro animation duration.' },
      combo_animation: { type: 'string', description: 'Optional combo animation name.' },
      combo_animation_duration: { type: 'number', description: 'Optional combo animation duration.' },
      transition: { type: 'string', description: 'Optional transition name.' },
      transition_duration: { type: 'number', description: 'Optional transition duration.' },
      mask_type: { type: 'string', description: 'Optional mask type.' },
      mask_center_x: { type: 'number', description: 'Optional mask center X.' },
      mask_center_y: { type: 'number', description: 'Optional mask center Y.' },
      mask_size: { type: 'number', description: 'Optional mask size.' },
      mask_rotation: { type: 'number', description: 'Optional mask rotation.' },
      mask_feather: { type: 'number', description: 'Optional mask feather.' },
      mask_invert: { type: 'boolean', description: 'Optional mask invert flag.' },
      mask_rect_width: { type: 'number', description: 'Optional mask rect width.' },
      mask_round_corner: { type: 'number', description: 'Optional mask round corner.' },
      background_blur: { type: 'number', description: 'Optional background blur amount.' },
      alpha: { type: 'number', description: 'Optional layer alpha.' },
      flip_horizontal: { type: 'boolean', description: 'Optional horizontal flip flag.' },
      rotation: { type: 'number', description: 'Optional rotation in degrees.' },
      transform_x_px: { type: 'number', description: 'Optional X transform in pixels.' },
      transform_y_px: { type: 'number', description: 'Optional Y transform in pixels.' },
      mix_type: { type: 'string', description: 'Optional blend mode.' }
    },
    ['image_url', 'end']
  ),
  toolWithArgs(
    'add_batch_image',
    'Add multiple image layers into a VectCut draft in one request.',
    {
      imageUrls: { type: 'array', items: { type: 'string' }, description: 'Required image URLs alias of image_urls.' },
      image_urls: { type: 'array', items: { type: 'string' }, description: 'Required image URLs.' },
      starts: { type: 'array', items: { type: 'number' }, description: 'Optional start times in seconds.' },
      ends: { type: 'array', items: { type: 'number' }, description: 'Required end times in seconds.' },
      width: { type: 'integer', description: 'Optional canvas width.' },
      height: { type: 'integer', description: 'Optional canvas height.' },
      draftId: { type: 'string', description: 'Optional draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Optional draft ID.' },
      transform_x: { type: 'number', description: 'Optional X transform ratio.' },
      transform_x_px: { type: 'integer', description: 'Optional X transform in pixels.' },
      transform_y: { type: 'number', description: 'Optional Y transform ratio.' },
      transform_y_px: { type: 'integer', description: 'Optional Y transform in pixels.' },
      scale_x: { type: 'number', description: 'Optional X scale.' },
      scale_y: { type: 'number', description: 'Optional Y scale.' },
      track_name: { type: 'string', description: 'Optional track name.' },
      relative_index: { type: 'integer', description: 'Optional relative track index.' },
      intro_animation: { type: 'string', description: 'Optional intro animation name.' },
      intro_animation_duration: { type: 'number', description: 'Optional intro animation duration.' },
      outro_animation: { type: 'string', description: 'Optional outro animation name.' },
      outro_animation_duration: { type: 'number', description: 'Optional outro animation duration.' },
      combo_animation: { type: 'string', description: 'Optional combo animation name.' },
      combo_animation_duration: { type: 'number', description: 'Optional combo animation duration.' },
      transition: { type: 'string', description: 'Optional transition name.' },
      transition_duration: { type: 'number', description: 'Optional transition duration.' },
      mask_type: { type: 'string', description: 'Optional mask type.' },
      mask_center_x: { type: 'number', description: 'Optional mask center X.' },
      mask_center_y: { type: 'number', description: 'Optional mask center Y.' },
      mask_size: { type: 'number', description: 'Optional mask size.' },
      mask_rotation: { type: 'number', description: 'Optional mask rotation.' },
      mask_feather: { type: 'number', description: 'Optional mask feather.' },
      mask_invert: { type: 'boolean', description: 'Optional mask invert flag.' },
      mask_rect_width: { type: 'number', description: 'Optional mask rect width.' },
      mask_round_corner: { type: 'number', description: 'Optional mask round corner.' },
      background_blur: { type: 'integer', description: 'Optional background blur amount.' },
      alpha: { type: 'number', description: 'Optional layer alpha.' },
      flip_horizontal: { type: 'boolean', description: 'Optional horizontal flip flag.' },
      rotation: { type: 'number', description: 'Optional rotation in degrees.' },
      mix_type: { type: 'string', description: 'Optional blend mode.' }
    },
    ['image_urls', 'ends']
  ),
  toolWithArgs(
    'add_preset',
    'Add a preset segment to a draft, optionally replacing its text, image, video, or audio placeholders. Omitting draft_id creates a new draft; use track_name if the target track overlaps existing segments.',
    {
      presetId: { type: 'string', description: 'Required preset ID alias of preset_id.' },
      preset_id: { type: 'string', description: 'Required preset ID.' },
      replacements: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: { type: 'string' }
        },
        description: 'Optional key-value replacements, e.g. [{ "text1": "New title" }, { "image1": "https://example.com/image.png" }, { "video1": "https://example.com/video.mp4" }, { "audio1": "https://example.com/audio.mp3" }]. Use preset placeholder names as keys; text values are literal strings, media values are resource URLs.'
      },
      targetStart: { type: 'number', description: 'Optional timeline start alias of target_start.' },
      target_start: { type: 'number', description: 'Optional start time on the target track, in seconds.' },
      start: { type: 'number', description: 'Optional start time in the original preset, in seconds.' },
      end: { type: 'number', description: 'Optional end time in the original preset, in seconds.' },
      draftId: { type: 'string', description: 'Optional draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Optional existing draft ID; omit to create a new draft.' },
      transform_x: { type: 'number', description: 'Optional horizontal offset relative to canvas width; 0 is centered.' },
      transform_y: { type: 'number', description: 'Optional vertical offset relative to canvas height; 0 is centered.' },
      transform_x_px: { type: 'integer', description: 'Optional horizontal offset in pixels.' },
      transform_y_px: { type: 'integer', description: 'Optional vertical offset in pixels.' },
      rotation: { type: 'number', description: 'Optional rotation angle in degrees.' },
      scale_x: { type: 'number', description: 'Optional horizontal scale multiplier (1 means 100%).' },
      scale_y: { type: 'number', description: 'Optional vertical scale multiplier (1 means 100%).' },
      trackName: { type: 'string', description: 'Optional track name alias of track_name.' },
      track_name: { type: 'string', description: 'Optional target track name; defaults to preset_track. Change it if the current track overlaps.' },
      width: { type: 'integer', description: 'Optional canvas width in pixels; defaults to 1080.' },
      height: { type: 'integer', description: 'Optional canvas height in pixels; defaults to 1920.' },
      relative_index: { type: 'integer', description: 'Optional relative track index; higher values are layered above lower ones.' },
      mask_type: { type: 'string', description: 'Optional mask type, e.g. circle or rectangle.' },
      mask_center_x: { type: 'number', description: 'Optional mask center X; 0 is centered, 0.5 moves right by half the width.' },
      mask_center_y: { type: 'number', description: 'Optional mask center Y; 0 is centered, 0.5 moves down by half the height.' },
      mask_size: { type: 'number', description: 'Optional primary mask size as a fraction of draft height; defaults to 0.5.' },
      mask_rotation: { type: 'number', description: 'Optional mask rotation in degrees; defaults to 0.' },
      mask_feather: { type: 'integer', description: 'Optional mask feathering; larger values soften the edges.' },
      mask_invert: { type: 'boolean', description: 'Optional mask inversion; defaults to false.' },
      mask_rect_width: { type: 'number', description: 'Optional rectangular mask width as a fraction of material width.' },
      mask_round_corner: { type: 'integer', minimum: 0, maximum: 100, description: 'Optional rectangular mask corner rounding (0-100).' },
      intro_animation: { type: 'string', description: 'Optional intro animation name.' },
      intro_animation_duration: { type: 'number', description: 'Optional intro animation duration in seconds.' },
      outro_animation: { type: 'string', description: 'Optional outro animation name.' },
      outro_animation_duration: { type: 'number', description: 'Optional outro animation duration in seconds.' },
      combo_animation: { type: 'string', description: 'Optional combo animation name. Use get_combo_animation_types to list supported names.' },
      combo_animation_duration: { type: 'number', description: 'Optional combo animation duration in seconds.' },
      transition: { type: 'string', description: 'Optional transition name.' },
      transition_duration: { type: 'number', description: 'Optional transition duration in seconds.' },
      volume: { type: 'number', description: 'Optional preset volume.' }
    },
    ['preset_id']
  ),
  toolWithArgs(
    'add_batch_preset',
    'Add multiple preset segments into a VectCut draft in one request. Use this for batch preset insertion with optional per-segment replacements and target ranges.',
    {
      presetIds: { type: 'array', items: { type: 'string' }, description: 'Required preset IDs alias of preset_ids.' },
      preset_ids: { type: 'array', items: { type: 'string' }, description: 'Required preset IDs.' },
      replacements: {
        type: 'array',
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: { type: 'string' }
          }
        },
        description: 'Optional nested replacement list. Each preset segment receives one replacement list, and each replacement item maps placeholder keys such as text1/image1/video1/audio1 to replacement string values.'
      },
      starts: { type: 'array', items: { type: 'number' }, description: 'Required source start times in seconds.' },
      ends: { type: 'array', items: { type: 'number' }, description: 'Required source end times in seconds.' },
      targetStarts: { type: 'array', items: { type: 'number' }, description: 'Optional timeline start times alias of target_starts.' },
      target_starts: { type: 'array', items: { type: 'number' }, description: 'Optional timeline start times in seconds.' },
      targetEnds: { type: 'array', items: { type: 'number' }, description: 'Optional timeline end times alias of target_ends.' },
      target_ends: { type: 'array', items: { type: 'number' }, description: 'Optional timeline end times in seconds.' },
      draftId: { type: 'string', description: 'Optional draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Optional draft ID.' },
      transform_x: { type: 'number', description: 'Optional X transform ratio.' },
      transform_y: { type: 'number', description: 'Optional Y transform ratio.' },
      transform_x_px: { type: 'integer', description: 'Optional X transform in pixels.' },
      transform_y_px: { type: 'integer', description: 'Optional Y transform in pixels.' },
      rotation: { type: 'number', description: 'Optional rotation in degrees.' },
      scale_x: { type: 'number', description: 'Optional X scale.' },
      scale_y: { type: 'number', description: 'Optional Y scale.' },
      trackName: { type: 'string', description: 'Optional track name alias of track_name.' },
      track_name: { type: 'string', description: 'Optional track name.' },
      width: { type: 'integer', description: 'Optional canvas width.' },
      height: { type: 'integer', description: 'Optional canvas height.' },
      relative_index: { type: 'integer', description: 'Optional relative track index.' },
      mask_type: { type: 'string', description: 'Optional mask type.' },
      mask_center_x: { type: 'number', description: 'Optional mask center X.' },
      mask_center_y: { type: 'number', description: 'Optional mask center Y.' },
      mask_size: { type: 'number', description: 'Optional mask size.' },
      mask_rotation: { type: 'number', description: 'Optional mask rotation.' },
      mask_feather: { type: 'integer', description: 'Optional mask feather.' },
      mask_invert: { type: 'boolean', description: 'Optional mask invert flag.' },
      mask_rect_width: { type: 'number', description: 'Optional mask rect width.' },
      mask_round_corner: { type: 'integer', description: 'Optional mask round corner.' },
      intro_animation: { type: 'string', description: 'Optional intro animation name.' },
      intro_animation_duration: { type: 'number', description: 'Optional intro animation duration.' },
      outro_animation: { type: 'string', description: 'Optional outro animation name.' },
      outro_animation_duration: { type: 'number', description: 'Optional outro animation duration.' },
      transition: { type: 'string', description: 'Optional transition name.' },
      transition_duration: { type: 'number', description: 'Optional transition duration.' },
      transitions: { type: 'array', items: { type: 'string' }, description: 'Optional transition names per preset segment.' },
      transition_durations: { type: 'array', items: { type: 'number' }, description: 'Optional transition durations per preset segment.' },
      volume: { type: 'number', description: 'Optional volume.' }
    },
    ['preset_ids', 'starts', 'ends']
  ),
  toolWithArgs(
    'modify_image',
    'Modify an existing image material in a VectCut draft by material ID.',
    {
      draftId: { type: 'string', description: 'Required draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Required draft ID.' },
      materialId: { type: 'string', description: 'Required material ID alias of material_id.' },
      material_id: { type: 'string', description: 'Required material ID.' },
      imageUrl: { type: 'string', description: 'Optional image URL alias of image_url.' },
      image_url: { type: 'string', description: 'Optional image URL.' },
      start: { type: 'number', description: 'Optional start time in seconds.' },
      end: { type: 'number', description: 'Optional end time in seconds.' },
      transform_y: { type: 'number', description: 'Optional Y transform ratio.' },
      scale_x: { type: 'number', description: 'Optional X scale.' },
      scale_y: { type: 'number', description: 'Optional Y scale.' },
      transform_x: { type: 'number', description: 'Optional X transform ratio.' },
      transform_x_px: { type: 'number', description: 'Optional X transform in pixels.' },
      transform_y_px: { type: 'number', description: 'Optional Y transform in pixels.' },
      track_name: { type: 'string', description: 'Optional track name.' },
      relative_index: { type: 'number', description: 'Optional relative track index.' },
      intro_animation: { type: 'string', description: 'Optional intro animation name.' },
      intro_animation_duration: { type: 'number', description: 'Optional intro animation duration.' },
      outro_animation: { type: 'string', description: 'Optional outro animation name.' },
      outro_animation_duration: { type: 'number', description: 'Optional outro animation duration.' },
      combo_animation: { type: 'string', description: 'Optional combo animation name.' },
      combo_animation_duration: { type: 'number', description: 'Optional combo animation duration.' },
      transition: { type: 'string', description: 'Optional transition name.' },
      transition_duration: { type: 'number', description: 'Optional transition duration.' },
      mask_type: { type: 'string', description: 'Optional mask type.' },
      mask_center_x: { type: 'number', description: 'Optional mask center X.' },
      mask_center_y: { type: 'number', description: 'Optional mask center Y.' },
      mask_size: { type: 'number', description: 'Optional mask size.' },
      mask_rotation: { type: 'number', description: 'Optional mask rotation.' },
      mask_feather: { type: 'number', description: 'Optional mask feather.' },
      mask_invert: { type: 'boolean', description: 'Optional mask invert flag.' },
      mask_rect_width: { type: 'number', description: 'Optional mask rect width.' },
      mask_round_corner: { type: 'number', description: 'Optional mask round corner.' },
      background_blur: { type: 'number', description: 'Optional background blur amount.' },
      alpha: { type: 'number', description: 'Optional layer alpha.' },
      flip_horizontal: { type: 'boolean', description: 'Optional horizontal flip flag.' },
      rotation: { type: 'number', description: 'Optional rotation in degrees.' },
      mix_type: { type: 'string', description: 'Optional blend mode.' }
    },
    ['draft_id', 'material_id']
  ),
  toolWithArgs(
    'remove_image',
    'Remove an existing image material from a VectCut draft by material ID.',
    {
      draftId: { type: 'string', description: 'Required draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Required draft ID.' },
      materialId: { type: 'string', description: 'Required material ID alias of material_id.' },
      material_id: { type: 'string', description: 'Required material ID.' }
    },
    ['draft_id', 'material_id']
  ),
  toolWithArgs(
    'add_video',
    'Add a single video layer into a VectCut draft.',
    {
      videoUrl: { type: 'string', description: 'Required video URL or local file path alias of video_url.' },
      video_url: { type: 'string', description: 'Required video URL or local file path.' },
      start: { type: 'number', description: 'Optional source start time in seconds.' },
      end: { type: 'number', description: 'Optional source end time in seconds.' },
      width: { type: 'number', description: 'Optional canvas width.' },
      height: { type: 'number', description: 'Optional canvas height.' },
      transform_y: { type: 'number', description: 'Optional Y transform ratio.' },
      transform_y_px: { type: 'number', description: 'Optional Y transform in pixels.' },
      scale_x: { type: 'number', description: 'Optional X scale.' },
      scale_y: { type: 'number', description: 'Optional Y scale.' },
      transform_x: { type: 'number', description: 'Optional X transform ratio.' },
      transform_x_px: { type: 'number', description: 'Optional X transform in pixels.' },
      speed: { type: 'number', description: 'Optional playback speed.' },
      targetStart: { type: 'number', description: 'Optional timeline start alias of target_start.' },
      target_start: { type: 'number', description: 'Optional timeline start time in seconds.' },
      draftId: { type: 'string', description: 'Optional draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Optional draft ID.' },
      track_name: { type: 'string', description: 'Optional track name.' },
      relative_index: { type: 'number', description: 'Optional relative track index.' },
      intro_animation: { type: 'string', description: 'Optional intro animation name.' },
      intro_animation_duration: { type: 'number', description: 'Optional intro animation duration.' },
      outro_animation: { type: 'string', description: 'Optional outro animation name.' },
      outro_animation_duration: { type: 'number', description: 'Optional outro animation duration.' },
      duration: { type: 'number', description: 'Optional target duration in seconds.' },
      transition: { type: 'string', description: 'Optional transition name.' },
      transition_duration: { type: 'number', description: 'Optional transition duration.' },
      volume: { type: 'number', description: 'Optional volume.' },
      mask_type: { type: 'string', description: 'Optional mask type.' },
      mask_center_x: { type: 'number', description: 'Optional mask center X.' },
      mask_center_y: { type: 'number', description: 'Optional mask center Y.' },
      mask_size: { type: 'number', description: 'Optional mask size.' },
      mask_rotation: { type: 'number', description: 'Optional mask rotation.' },
      mask_feather: { type: 'number', description: 'Optional mask feather.' },
      mask_invert: { type: 'boolean', description: 'Optional mask invert flag.' },
      mask_rect_width: { type: 'number', description: 'Optional mask rect width.' },
      mask_round_corner: { type: 'number', description: 'Optional mask round corner.' },
      background_blur: { type: 'number', description: 'Optional background blur amount.' },
      alpha: { type: 'number', description: 'Optional layer alpha.' },
      flip_horizontal: { type: 'boolean', description: 'Optional horizontal flip flag.' },
      mix_type: { type: 'string', description: 'Optional blend mode.' }
    },
    ['video_url']
  ),
  toolWithArgs(
    'add_batch_video',
    'Add multiple video layers into a VectCut draft in one request.',
    {
      videoUrls: { type: 'array', items: { type: 'string' }, description: 'Required video URLs alias of video_urls.' },
      video_urls: { type: 'array', items: { type: 'string' }, description: 'Required video URLs.' },
      starts: { type: 'array', items: { type: 'number' }, description: 'Required source start times in seconds.' },
      ends: { type: 'array', items: { type: 'number' }, description: 'Required source end times in seconds.' },
      durations: { type: 'array', items: { type: 'number' }, description: 'Required source durations.' },
      targetStarts: { type: 'array', items: { type: 'number' }, description: 'Required timeline start times alias of target_starts.' },
      target_starts: { type: 'array', items: { type: 'number' }, description: 'Required timeline start times in seconds.' },
      targetEnds: { type: 'array', items: { type: 'number' }, description: 'Required timeline end times alias of target_ends.' },
      target_ends: { type: 'array', items: { type: 'number' }, description: 'Required timeline end times in seconds.' },
      width: { type: 'integer', description: 'Optional canvas width.' },
      height: { type: 'integer', description: 'Optional canvas height.' },
      draftId: { type: 'string', description: 'Optional draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Optional draft ID.' },
      transform_y: { type: 'number', description: 'Optional Y transform ratio.' },
      transform_y_px: { type: 'integer', description: 'Optional Y transform in pixels.' },
      scale_x: { type: 'number', description: 'Optional X scale.' },
      scale_y: { type: 'number', description: 'Optional Y scale.' },
      transform_x: { type: 'number', description: 'Optional X transform ratio.' },
      transform_x_px: { type: 'integer', description: 'Optional X transform in pixels.' },
      speed: { type: 'number', description: 'Optional playback speed.' },
      track_name: { type: 'string', description: 'Optional track name.' },
      relative_index: { type: 'integer', description: 'Optional relative track index.' },
      intro_animation: { type: 'string', description: 'Optional intro animation name.' },
      intro_animation_duration: { type: 'number', description: 'Optional intro animation duration.' },
      outro_animation: { type: 'string', description: 'Optional outro animation name.' },
      outro_animation_duration: { type: 'number', description: 'Optional outro animation duration.' },
      transition: { type: 'string', description: 'Optional transition name.' },
      transition_duration: { type: 'number', description: 'Optional transition duration.' },
      volume: { type: 'number', description: 'Optional volume.' },
      mask_type: { type: 'string', description: 'Optional mask type.' },
      mask_center_x: { type: 'number', description: 'Optional mask center X.' },
      mask_center_y: { type: 'number', description: 'Optional mask center Y.' },
      mask_size: { type: 'number', description: 'Optional mask size.' },
      mask_rotation: { type: 'number', description: 'Optional mask rotation.' },
      mask_feather: { type: 'number', description: 'Optional mask feather.' },
      mask_invert: { type: 'boolean', description: 'Optional mask invert flag.' },
      mask_rect_width: { type: 'number', description: 'Optional mask rect width.' },
      mask_round_corner: { type: 'number', description: 'Optional mask round corner.' },
      background_blur: { type: 'number', description: 'Optional background blur amount.' },
      alpha: { type: 'number', description: 'Optional layer alpha.' },
      flip_horizontal: { type: 'boolean', description: 'Optional horizontal flip flag.' },
      mix_type: { type: 'string', description: 'Optional blend mode.' }
    },
    ['video_urls']
  ),
  toolWithArgs(
    'modify_video',
    'Modify an existing video material in a VectCut draft by material ID.',
    {
      draftId: { type: 'string', description: 'Required draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Required draft ID.' },
      materialId: { type: 'string', description: 'Required material ID alias of material_id.' },
      material_id: { type: 'string', description: 'Required material ID.' },
      videoUrl: { type: 'string', description: 'Optional video URL alias of video_url.' },
      video_url: { type: 'string', description: 'Optional video URL.' },
      start: { type: 'number', description: 'Optional source start time in seconds.' },
      end: { type: 'number', description: 'Optional source end time in seconds.' },
      target_start: { type: 'number', description: 'Optional timeline start time in seconds.' },
      transform_y: { type: 'number', description: 'Optional Y transform ratio.' },
      scale_x: { type: 'number', description: 'Optional X scale.' },
      scale_y: { type: 'number', description: 'Optional Y scale.' },
      transform_x: { type: 'number', description: 'Optional X transform ratio.' },
      transform_x_px: { type: 'number', description: 'Optional X transform in pixels.' },
      transform_y_px: { type: 'number', description: 'Optional Y transform in pixels.' },
      speed: { type: 'number', description: 'Optional playback speed.' },
      track_name: { type: 'string', description: 'Optional track name.' },
      relative_index: { type: 'number', description: 'Optional relative track index.' },
      intro_animation: { type: 'string', description: 'Optional intro animation name.' },
      intro_animation_duration: { type: 'number', description: 'Optional intro animation duration.' },
      outro_animation: { type: 'string', description: 'Optional outro animation name.' },
      outro_animation_duration: { type: 'number', description: 'Optional outro animation duration.' },
      duration: { type: 'number', description: 'Optional target duration in seconds.' },
      transition: { type: 'string', description: 'Optional transition name.' },
      transition_duration: { type: 'number', description: 'Optional transition duration.' },
      mask_type: { type: 'string', description: 'Optional mask type.' },
      mask_center_x: { type: 'number', description: 'Optional mask center X.' },
      mask_center_y: { type: 'number', description: 'Optional mask center Y.' },
      mask_size: { type: 'number', description: 'Optional mask size.' },
      mask_rotation: { type: 'number', description: 'Optional mask rotation.' },
      mask_feather: { type: 'number', description: 'Optional mask feather.' },
      mask_invert: { type: 'boolean', description: 'Optional mask invert flag.' },
      mask_rect_width: { type: 'number', description: 'Optional mask rect width.' },
      mask_round_corner: { type: 'number', description: 'Optional mask round corner.' },
      volume: { type: 'number', description: 'Optional volume.' },
      background_blur: { type: 'number', description: 'Optional background blur amount.' },
      alpha: { type: 'number', description: 'Optional layer alpha.' },
      flip_horizontal: { type: 'boolean', description: 'Optional horizontal flip flag.' },
      rotation: { type: 'number', description: 'Optional rotation in degrees.' },
      mix_type: { type: 'string', description: 'Optional blend mode.' }
    },
    ['draft_id', 'material_id']
  ),
  toolWithArgs(
    'remove_video',
    'Remove an existing video material from a VectCut draft by material ID.',
    {
      draftId: { type: 'string', description: 'Required draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Required draft ID.' },
      materialId: { type: 'string', description: 'Required material ID alias of material_id.' },
      material_id: { type: 'string', description: 'Required material ID.' }
    },
    ['draft_id', 'material_id']
  ),
  readonlyTool('get_transition_types', 'List supported transition types for visual tracks such as image and video.'),
  toolWithArgs(
    'add_audio',
    'Add a single audio layer into a VectCut draft.',
    {
      audioUrl: { type: 'string', description: 'Optional audio URL or local file path alias of audio_url. Required when music_id is not provided.' },
      audio_url: { type: 'string', description: 'Optional audio URL or local file path. Required when music_id is not provided.' },
      musicId: { type: 'string', description: 'Optional music or sound effect material ID alias of music_id.' },
      music_id: { type: 'string', description: 'Optional music or sound effect material ID. Use this for built-in music/effect library assets.' },
      start: { type: 'number', description: 'Optional source start time in seconds.' },
      end: { type: 'number', description: 'Optional source end time in seconds.' },
      targetStart: { type: 'number', description: 'Optional timeline start alias of target_start.' },
      target_start: { type: 'number', description: 'Optional timeline start time in seconds.' },
      draftId: { type: 'string', description: 'Optional draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Optional draft ID.' },
      clientRequestId: {
        type: 'string',
        description: 'Optional client request ID used to correlate pending and completed UI updates.'
      },
      volume: { type: 'number', description: 'Optional volume.' },
      speed: { type: 'number', description: 'Optional playback speed.' },
      track_name: { type: 'string', description: 'Optional track name.' },
      duration: { type: 'number', description: 'Optional original source duration in seconds.' },
      effect_type: { type: 'string', description: 'Optional audio effect type.' },
      effect_params: {
        type: 'array',
        items: { type: 'number' },
        description: 'Optional audio effect params.'
      },
      width: { type: 'number', description: 'Optional canvas width.' },
      height: { type: 'number', description: 'Optional canvas height.' },
      fade_in_duration: { type: 'number', description: 'Optional fade-in duration.' },
      fade_out_duratioin: { type: 'number', description: 'Optional fade-out duration.' }
    },
    []
  ),
  toolWithArgs(
    'add_batch_audio',
    'Add multiple audio layers into a VectCut draft in one request.',
    {
      audioUrls: { type: 'array', items: { type: 'string' }, description: 'Required audio URLs alias of audio_urls.' },
      audio_urls: { type: 'array', items: { type: 'string' }, description: 'Required audio URLs.' },
      starts: { type: 'array', items: { type: 'number' }, description: 'Optional source start times in seconds.' },
      ends: { type: 'array', items: { type: 'number' }, description: 'Optional source end times in seconds.' },
      targetStarts: { type: 'array', items: { type: 'number' }, description: 'Optional timeline start times alias of target_starts.' },
      target_starts: { type: 'array', items: { type: 'number' }, description: 'Optional timeline start times in seconds.' },
      targetEnds: { type: 'array', items: { type: 'number' }, description: 'Optional timeline end times alias of target_ends.' },
      target_ends: { type: 'array', items: { type: 'number' }, description: 'Optional timeline end times in seconds.' },
      durations: { type: 'array', items: { type: 'number' }, description: 'Optional source durations.' },
      draftId: { type: 'string', description: 'Optional draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Optional draft ID.' },
      volume: { type: 'number', description: 'Optional volume.' },
      speed: { type: 'number', description: 'Optional playback speed.' },
      track_name: { type: 'string', description: 'Optional track name.' },
      effect_type: { type: 'string', description: 'Optional audio effect type.' },
      effect_params: {
        type: 'array',
        items: { type: 'integer' },
        description: 'Optional audio effect params.'
      },
      width: { type: 'integer', description: 'Optional canvas width.' },
      height: { type: 'integer', description: 'Optional canvas height.' },
      fade_in_duration: { type: 'number', description: 'Optional fade-in duration.' },
      fade_out_duratioin: { type: 'number', description: 'Optional fade-out duration.' }
    },
    ['audio_urls']
  ),
  toolWithArgs(
    'modify_audio',
    'Modify an existing audio material in a VectCut draft by material ID.',
    {
      draftId: { type: 'string', description: 'Required draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Required draft ID.' },
      materialId: { type: 'string', description: 'Required material ID alias of material_id.' },
      material_id: { type: 'string', description: 'Required material ID.' },
      audioUrl: { type: 'string', description: 'Optional audio URL alias of audio_url.' },
      audio_url: { type: 'string', description: 'Optional audio URL.' },
      start: { type: 'number', description: 'Optional source start time in seconds.' },
      end: { type: 'number', description: 'Optional source end time in seconds.' },
      volume: { type: 'number', description: 'Optional volume.' },
      target_start: { type: 'number', description: 'Optional timeline start time in seconds.' },
      speed: { type: 'number', description: 'Optional playback speed.' },
      track_name: { type: 'string', description: 'Optional track name.' },
      duration: { type: 'number', description: 'Optional target duration in seconds.' },
      effect_type: { type: 'string', description: 'Optional audio effect type.' },
      effect_params: {
        type: 'array',
        items: { type: 'number' },
        description: 'Optional audio effect params.'
      },
      fade_in_duration: { type: 'number', description: 'Optional fade-in duration.' },
      fade_out_duratioin: { type: 'number', description: 'Optional fade-out duration.' }
    },
    ['draft_id', 'material_id']
  ),
  toolWithArgs(
    'remove_audio',
    'Remove an existing audio material from a VectCut draft by material ID.',
    {
      draftId: { type: 'string', description: 'Required draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Required draft ID.' },
      materialId: { type: 'string', description: 'Required material ID alias of material_id.' },
      material_id: { type: 'string', description: 'Required material ID.' }
    },
    ['draft_id', 'material_id']
  ),
  readonlyTool('get_audio_effect_types', 'List supported audio effect types and configurable params for audio tools.'),
  toolWithArgs(
    'add_video_keyframe',
    'Add one or more keyframes to a target draft track. Supports video and other supported tracks.',
    {
      draftId: { type: 'string', description: 'Required draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Required draft ID.' },
      trackName: { type: 'string', description: 'Optional track name alias of track_name.' },
      track_name: { type: 'string', description: 'Optional track name.' },
      propertyTypes: {
        type: 'array',
        items: {
          type: 'string',
          enum: [
            'position_x_px',
            'position_y_px',
            'mask_position_x',
            'mask_position_y',
            'mask_position_x_px',
            'mask_position_y_px',
            'mask_size_x',
            'mask_size_y',
            'rotation',
            'scale_x',
            'scale_y',
            'uniform_scale',
            'alpha',
            'saturation',
            'contrast',
            'brightness',
            'volume',
            'mask_rotation',
            'text_color'
          ]
        },
        description:
          'Optional keyframe property type list alias of property_types. Enum values: position_x_px, position_y_px, mask_position_x, mask_position_y, mask_position_x_px, mask_position_y_px, mask_size_x, mask_size_y, rotation, scale_x, scale_y, uniform_scale, alpha, saturation, contrast, brightness, volume, mask_rotation, text_color.'
      },
      property_types: {
        type: 'array',
        items: {
          type: 'string',
          enum: [
            'position_x_px',
            'position_y_px',
            'mask_position_x',
            'mask_position_y',
            'mask_position_x_px',
            'mask_position_y_px',
            'mask_size_x',
            'mask_size_y',
            'rotation',
            'scale_x',
            'scale_y',
            'uniform_scale',
            'alpha',
            'saturation',
            'contrast',
            'brightness',
            'volume',
            'mask_rotation',
            'text_color'
          ]
        },
        description:
          'Optional keyframe property type list. Enum values: position_x_px, position_y_px, mask_position_x, mask_position_y, mask_position_x_px, mask_position_y_px, mask_size_x, mask_size_y, rotation, scale_x, scale_y, uniform_scale, alpha, saturation, contrast, brightness, volume, mask_rotation, text_color.'
      },
      times: { type: 'array', items: { type: 'number' }, description: 'Optional batch times in seconds.' },
      values: { type: 'array', items: { type: 'string' }, description: 'Optional batch values.' }
    },
    ['draft_id']
  ),
  toolWithArgs(
    'add_effect',
    'Add a character or scene effect into a VectCut draft.',
    {
      effectType: { type: 'string', description: 'Required effect name alias of effect_type.' },
      effect_type: { type: 'string', description: 'Required effect name.' },
      effectCategory: { type: 'string', description: 'Optional effect category alias of effect_category.' },
      effect_category: { type: 'string', description: 'Optional effect category.' },
      start: { type: 'number', description: 'Optional start time in seconds.' },
      end: { type: 'number', description: 'Optional end time in seconds.' },
      draftId: { type: 'string', description: 'Optional draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Optional draft ID.' },
      track_name: { type: 'string', description: 'Optional track name.' },
      relative_index: { type: 'number', description: 'Optional relative track index.' },
      params: {
        type: 'array',
        items: { type: 'number' },
        description: 'Optional effect params.'
      },
      width: { type: 'number', description: 'Optional canvas width.' },
      height: { type: 'number', description: 'Optional canvas height.' }
    },
    ['effect_type', 'effect_category']
  ),
  toolWithArgs(
    'modify_effect',
    'Modify an existing effect material in a VectCut draft by material ID.',
    {
      draftId: { type: 'string', description: 'Required draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Required draft ID.' },
      materialId: { type: 'string', description: 'Required material ID alias of material_id.' },
      material_id: { type: 'string', description: 'Required material ID.' },
      effectType: { type: 'string', description: 'Optional effect name alias of effect_type.' },
      effect_type: { type: 'string', description: 'Optional effect name.' },
      effectCategory: { type: 'string', description: 'Optional effect category alias of effect_category.' },
      effect_category: { type: 'string', description: 'Optional effect category.' },
      start: { type: 'number', description: 'Optional start time in seconds.' },
      end: { type: 'number', description: 'Optional end time in seconds.' },
      track_name: { type: 'string', description: 'Optional track name.' },
      relative_index: { type: 'number', description: 'Optional relative track index.' },
      params: {
        type: 'array',
        items: { type: 'number' },
        description: 'Optional effect params.'
      }
    },
    ['draft_id', 'material_id']
  ),
  toolWithArgs(
    'remove_effect',
    'Remove an existing effect material from a VectCut draft by material ID.',
    {
      draftId: { type: 'string', description: 'Required draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Required draft ID.' },
      materialId: { type: 'string', description: 'Required material ID alias of material_id.' },
      material_id: { type: 'string', description: 'Required material ID.' }
    },
    ['draft_id', 'material_id']
  ),
  readonlyTool('get_video_character_effect_types', 'List supported character effect types for visual effect tools.'),
  readonlyTool('get_video_scene_effect_types', 'List supported scene effect types for visual effect tools.'),
  toolWithArgs(
    'add_filter',
    'Add a filter into a VectCut draft.',
    {
      filterType: { type: 'string', description: 'Required filter name alias of filter_type.' },
      filter_type: { type: 'string', description: 'Required filter name.' },
      start: { type: 'number', description: 'Required start time in seconds.' },
      end: { type: 'number', description: 'Required end time in seconds.' },
      draftId: { type: 'string', description: 'Optional draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Optional draft ID.' },
      track_name: { type: 'string', description: 'Optional track name.' },
      relative_index: { type: 'number', description: 'Optional relative track index.' },
      intensity: { type: 'number', description: 'Optional filter intensity.' },
      width: { type: 'number', description: 'Optional canvas width.' },
      height: { type: 'number', description: 'Optional canvas height.' }
    },
    ['filter_type', 'start', 'end']
  ),
  toolWithArgs(
    'modify_filter',
    'Modify an existing filter material in a VectCut draft by material ID.',
    {
      draftId: { type: 'string', description: 'Required draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Required draft ID.' },
      materialId: { type: 'string', description: 'Required material ID alias of material_id.' },
      material_id: { type: 'string', description: 'Required material ID.' },
      filterType: { type: 'string', description: 'Optional filter name alias of filter_type.' },
      filter_type: { type: 'string', description: 'Optional filter name.' },
      start: { type: 'number', description: 'Optional start time in seconds.' },
      end: { type: 'number', description: 'Optional end time in seconds.' },
      track_name: { type: 'string', description: 'Optional track name.' },
      relative_index: { type: 'number', description: 'Optional relative track index.' },
      intensity: { type: 'number', description: 'Optional filter intensity.' }
    },
    ['material_id']
  ),
  toolWithArgs(
    'remove_filter',
    'Remove an existing filter material from a VectCut draft by material ID.',
    {
      draftId: { type: 'string', description: 'Required draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Required draft ID.' },
      materialId: { type: 'string', description: 'Required material ID alias of material_id.' },
      material_id: { type: 'string', description: 'Required material ID.' }
    },
    ['draft_id', 'material_id']
  ),
  readonlyTool('get_filter_types', 'List supported filter types for filter tools.'),
  readonlyTool(
    'get_intro_animation_types',
    'List supported intro animations shared by image and video tools. Use this before setting intro_animation on image or video tools.'
  ),
  readonlyTool(
    'get_outro_animation_types',
    'List supported outro animations shared by image and video tools. Use this before setting outro_animation on image or video tools.'
  ),
  readonlyTool(
    'get_combo_animation_types',
    'List supported combo or loop animations shared by image and video tools. Use this before setting combo_animation on image or video tools.'
  ),
  toolWithArgs(
    'get_text_position_preview',
    'Render a visual preview of one text layer position on the draft canvas. Returns inline PNG image content and also saves the same PNG to the workspace when possible. The image shows the canvas bounding box, center guides, and the text box after applying transform_x_px/transform_y_px (center-origin, +Y up), scale_x/scale_y (percent), rotation, align, vertical, bold/italic/underline, and fixed_width_px/fixed_height_px. Treat the rendered PNG as the source of truth for every visual judgment, including size, position, scale, rotation, and layout. Parameters are generation inputs for reproducibility, not a substitute for looking at the PNG.',
    {
      width: { type: 'number', description: 'Required draft canvas width in pixels.' },
      height: { type: 'number', description: 'Required draft canvas height in pixels.' },
      transform_x_px: { type: 'number', description: 'Optional X offset from canvas center in pixels. Positive moves right.' },
      transform_y_px: { type: 'number', description: 'Optional Y offset from canvas center in pixels. Positive moves UP (editor convention).' },
      scale_x: { type: 'number', description: 'Optional X scale in percent (default 100).' },
      scale_y: { type: 'number', description: 'Optional Y scale in percent (default 100).' },
      align: { type: 'integer', description: 'Optional text alignment enum. When vertical=false use 0/1/2 for left/center/right; when vertical=true use 3/1/4 for top/center/bottom.' },
      rotation: { type: 'number', description: 'Optional rotation in degrees (clockwise).' },
      bold: { type: 'boolean', description: 'Optional bold flag.' },
      italic: { type: 'boolean', description: 'Optional italic flag.' },
      underline: { type: 'boolean', description: 'Optional underline flag.' },
      vertical: { type: 'boolean', description: 'Optional vertical text mode. false means horizontal, true means vertical.' },
      fixed_width_px: { type: 'number', description: 'Optional fixed box width in draft-canvas pixels. If omitted a default is used.' },
      fixed_height_px: { type: 'number', description: 'Optional fixed box height in draft-canvas pixels. If omitted a default is used.' },
      text: { type: 'string', description: 'Optional placeholder text content to render inside the box.' },
      font_size: { type: 'number', description: 'Optional source text font size, matching add_text font_size. It is scaled for preview the same way as TextAddDetail.' },
      letter_spacing: { type: 'number', description: 'Optional letter spacing, matching add_text letter_spacing. Range -100 to 100.' },
      line_spacing: { type: 'number', description: 'Optional line spacing, matching add_text line_spacing. Range -100 to 100.' }
    },
    ['width', 'height']
  ),
  toolWithArgs(
    'get_text_style_preview',
    'Render a PNG snapshot for the provided text style parameters on a checkerboard color-test background. Returns inline PNG image content and also saves the same PNG to the workspace when possible. Preview the user-supplied values for font_color/font_alpha, rich text text_styles keyword runs, border, background, shadow, position, scale, and rotation. Treat the rendered PNG as the source of truth for every visual judgment, including color, opacity, stroke, background, shadow, size, position, scale, rotation, and layout. Parameters are generation inputs for reproducibility, not a substitute for looking at the PNG. For a normal request like "preview" or "see the effect", call once with the given parameters; call multiple times only when the user asks to compare variants, try alternatives, or tune the effect.',
    {
      width: { type: 'number', description: 'Required draft canvas width in pixels. Position and font-size preview use the same scaling as TextAddDetail.' },
      height: { type: 'number', description: 'Required draft canvas height in pixels. Position and font-size preview use the same scaling as TextAddDetail.' },
      transform_x_px: { type: 'number', description: 'Optional X offset from canvas center in pixels. Positive moves right.' },
      transform_y_px: { type: 'number', description: 'Optional Y offset from canvas center in pixels. Positive moves UP (editor convention).' },
      scale_x: { type: 'number', description: 'Optional X scale in percent (default 100).' },
      scale_y: { type: 'number', description: 'Optional Y scale in percent (default 100).' },
      align: { type: 'integer', description: 'Optional text alignment enum. When vertical=false use 0/1/2 for left/center/right; when vertical=true use 3/1/4 for top/center/bottom.' },
      rotation: { type: 'number', description: 'Optional rotation in degrees (clockwise).' },
      fixed_width_px: { type: 'number', description: 'Optional fixed text box width in draft-canvas pixels.' },
      fixed_height_px: { type: 'number', description: 'Optional fixed text box height in draft-canvas pixels.' },
      text: { type: 'string', description: 'Optional preview text content.' },
      text_styles: {
        type: 'array',
        items: { type: 'object' },
        description: 'Optional rich text keyword style ranges, same shape as add_text text_styles. Ranges use Unicode code-point offsets: start inclusive, end exclusive. Supports per-range style.size/bold/italic/underline/color, border width/color/alpha, and shadow enabled/angle/alpha/color/distance/smoothing.'
      },
      font_size: { type: 'number', description: 'Optional source text font size, matching add_text font_size. Default 54.' },
      letter_spacing: { type: 'number', description: 'Optional letter spacing, matching add_text letter_spacing. Range -100 to 100.' },
      line_spacing: { type: 'number', description: 'Optional line spacing, matching add_text line_spacing. Range -100 to 100.' },
      font_color: { type: 'string', description: 'Optional text color, hex #RRGGBB. Default #FFFFFF.' },
      font_alpha: { type: 'number', description: 'Optional font opacity alpha from 0 to 1. Default 1.' },
      bold: { type: 'boolean', description: 'Optional bold flag.' },
      italic: { type: 'boolean', description: 'Optional italic flag.' },
      underline: { type: 'boolean', description: 'Optional underline flag.' },
      vertical: { type: 'boolean', description: 'Optional vertical text mode.' },
      border_alpha: { type: 'number', description: 'Optional border opacity alpha from 0 to 1. Defaults to font_alpha.' },
      border_color: { type: 'string', description: 'Optional border color, hex #RRGGBB. Default #000000.' },
      border_width: { type: 'number', description: 'Optional border width from 0 to 100, matching add_text border_width.' },
      background_color: { type: 'string', description: 'Optional background color, hex #RRGGBB. Default #000000.' },
      background_style: { type: 'integer', enum: [1, 2], description: 'Optional background style: 1 for whole text block, 2 for individual lines.' },
      background_alpha: { type: 'number', description: 'Optional background alpha from 0 to 1. Default 0.' },
      background_round_radius: { type: 'number', description: 'Optional background radius from 0 to 1.' },
      background_height: { type: 'number', description: 'Optional background vertical padding from 0 to 1.' },
      background_width: { type: 'number', description: 'Optional background horizontal padding from 0 to 1.' },
      background_horizontal_offset: { type: 'number', description: 'Optional background horizontal offset from 0 to 1.' },
      background_vertical_offset: { type: 'number', description: 'Optional background vertical offset from 0 to 1.' },
      shadow_enabled: { type: 'boolean', description: 'Optional shadow enabled flag.' },
      shadow_alpha: { type: 'number', description: 'Optional shadow alpha from 0 to 1. Defaults to font_alpha.' },
      shadow_angle: { type: 'number', description: 'Optional shadow angle in degrees, -180 to 180.' },
      shadow_color: { type: 'string', description: 'Optional shadow color, hex #RRGGBB. Default #000000.' },
      shadow_distance: { type: 'number', description: 'Optional shadow distance from 0 to 100.' },
      shadow_smoothing: { type: 'number', description: 'Optional shadow smoothing from 0 to 1.' }
    },
    ['width', 'height']
  ),
  toolWithArgs(
    'get_font_previews',
    'Browse available text fonts with a visual 3x3 sprite preview. Each page returns inline PNG image content, saves the same sprite PNG to the workspace when possible, and includes the list of font names. The sprite contains up to 9 fonts rendered as a grid. Treat the rendered sprite PNG as the source of truth for font appearance and readability; choose fonts by looking at the glyph preview, not by guessing from font names, category, or metadata alone. Supports keyword search via `q` and category filter via `category`. Use `page` to turn pages. The font name should be passed to add_text / modify_text as the `font` field. NOTE: this tool only shows which fonts exist and what each glyph looks like. It cannot preview text style effects (font color, opacity, border, background, shadow, position, scale, rotation). Use get_text_style_preview for that.',
    {
      page: { type: 'integer', description: 'Optional 1-based page index. Default 1.' },
      page_size: { type: 'integer', description: 'Optional page size (1-9). Default 9. Hard-capped at 9 so the sprite stays at most 3x3.' },
      q: { type: 'string', description: 'Optional keyword to filter fonts by name.' },
      category: {
        type: 'string',
        enum: ['cn', 'jp', 'kr', 'en', 'other'],
        description: 'Optional category filter: cn=Chinese, jp=Japanese, kr=Korean, en=English, other=Other.'
      }
    },
    []
  ),
  toolWithArgs(
    'get_text_template_previews',
    'Browse the text template library (文字模版) with visual sprite previews. Each returned image is one template\'s preview sprite from the backend; treat the sprite as the source of truth for the template look and do not pick a template by id alone. Each item reports text_template_id, orientation (portrait for vertical 竖屏 drafts, landscape for horizontal 横屏 drafts) and texts_count (how many text slots the template holds); preview_video_url links an animated mp4 preview of the same template. Filter by orientation to match the draft aspect ratio. Use text_template_id when applying a text template effect (see add_text_template). Supports page and page_size (1-8, default 8; each item returns one inline sprite image). Prefer lightweight sprite previews first; use render_draft (草稿渲染 / 预渲染) as a last resort when they cannot verify the real text, font effects, animation timing or track compositing. If the working draft exceeds the limits, create a separate cloud test draft <=5 seconds reproducing the relevant template and layers, then render it without changing the working draft. Use cloud-accessible assets with full video/audio sources <=20 seconds and images <=20 MiB; timeline trimming alone does not satisfy the source limit. Prepare an eligible test draft rather than skipping render verification.',
    {
      page: { type: 'integer', description: 'Optional 1-based page index. Default 1.' },
      page_size: { type: 'integer', description: 'Optional page size (1-8). Default 8. Hard-capped at 8 inline sprite images per call.' },
      text_template_id: { type: 'string', description: 'Optional text template id to fetch and confirm a single known template.' },
      orientation: {
        type: 'string',
        enum: ['portrait', 'landscape'],
        description: 'Optional orientation filter: portrait for vertical 竖屏 drafts, landscape for horizontal 横屏 drafts.'
      }
    },
    []
  )
]

const TOOL_NAMES = new Set(TOOLS.map((tool) => tool.name))

const ARG_ALIASES: Record<string, string> = {
  draftId: 'draft_id',
  materialId: 'material_id',
  pageSize: 'page_size',
  templateId: 'template_id',
  textTemplateId: 'text_template_id',
  timeOffset: 'time_offset',
  trackName: 'track_name',
  relativeIndex: 'relative_index',
  transformX: 'transform_x',
  transformXPx: 'transform_x_px',
  transformY: 'transform_y',
  transformYPx: 'transform_y_px',
  scaleX: 'scale_x',
  scaleY: 'scale_y',
  fontColor: 'font_color',
  fontSize: 'font_size',
  fontAlpha: 'font_alpha',
  fixedWidth: 'fixed_width_px',
  fixedHeight: 'fixed_height_px',
  fixedWidthPx: 'fixed_width_px',
  fixedHeightPx: 'fixed_height_px',
  borderAlpha: 'border_alpha',
  borderColor: 'border_color',
  borderWidth: 'border_width',
  backgroundColor: 'background_color',
  backgroundStyle: 'background_style',
  backgroundAlpha: 'background_alpha',
  backgroundRoundRadius: 'background_round_radius',
  backgroundHeight: 'background_height',
  backgroundWidth: 'background_width',
  backgroundHorizontalOffset: 'background_horizontal_offset',
  backgroundVerticalOffset: 'background_vertical_offset',
  shadowEnabled: 'shadow_enabled',
  shadowAlpha: 'shadow_alpha',
  shadowAngle: 'shadow_angle',
  shadowColor: 'shadow_color',
  shadowDistance: 'shadow_distance',
  shadowSmoothing: 'shadow_smoothing',
  introAnimation: 'intro_animation',
  introDuration: 'intro_duration',
  outroAnimation: 'outro_animation',
  outroDuration: 'outro_duration',
  loopAnimation: 'loop_animation',
  loopDuration: 'loop_duration',
  textStyles: 'text_styles',
  bubbleEffectId: 'bubble_effect_id',
  bubbleResourceId: 'bubble_resource_id',
  effectEffectId: 'effect_effect_id',
  letterSpacing: 'letter_spacing',
  lineSpacing: 'line_spacing',
  imageUrl: 'image_url',
  imageUrls: 'image_urls',
  presetId: 'preset_id',
  presetIds: 'preset_ids',
  videoUrl: 'video_url',
  videoUrls: 'video_urls',
  audioUrl: 'audio_url',
  audioUrls: 'audio_urls',
  musicId: 'music_id',
  targetStart: 'target_start',
  targetStarts: 'target_starts',
  targetEnds: 'target_ends',
  introAnimationDuration: 'intro_animation_duration',
  outroAnimationDuration: 'outro_animation_duration',
  comboAnimation: 'combo_animation',
  comboAnimationDuration: 'combo_animation_duration',
  transitionDuration: 'transition_duration',
  transitionDurations: 'transition_durations',
  duration: 'duration',
  durations: 'durations',
  volume: 'volume',
  effectType: 'effect_type',
  effectTypes: 'effect_types',
  effectParams: 'effect_params',
  effectCategory: 'effect_category',
  filterType: 'filter_type',
  intensity: 'intensity',
  fadeInDuration: 'fade_in_duration',
  fadeOutDuration: 'fade_out_duratioin',
  propertyTypes: 'property_types',
  maskType: 'mask_type',
  maskCenterX: 'mask_center_x',
  maskCenterY: 'mask_center_y',
  maskSize: 'mask_size',
  maskRotation: 'mask_rotation',
  maskFeather: 'mask_feather',
  maskInvert: 'mask_invert',
  maskRectWidth: 'mask_rect_width',
  maskRoundCorner: 'mask_round_corner',
  backgroundBlur: 'background_blur',
  flipHorizontal: 'flip_horizontal',
  mixType: 'mix_type'
}

const MUTATION_REQUIRED_FIELDS: Record<string, string[]> = {
  add_text: ['text', 'start', 'end'],
  add_batch_text: ['texts', 'starts', 'ends'],
  remove_text: ['draft_id', 'material_id'],
  modify_text: ['draft_id', 'material_id'],
  add_subtitle: ['srt'],
  add_image: ['image_url', 'end'],
  add_batch_image: ['image_urls', 'ends'],
  add_preset: ['preset_id'],
  add_batch_preset: ['preset_ids', 'starts', 'ends'],
  modify_image: ['draft_id', 'material_id'],
  remove_image: ['draft_id', 'material_id'],
  add_video: ['video_url'],
  add_batch_video: ['video_urls'],
  modify_video: ['draft_id', 'material_id'],
  remove_video: ['draft_id', 'material_id'],
  add_audio: [],
  add_batch_audio: ['audio_urls'],
  modify_audio: ['draft_id', 'material_id'],
  remove_audio: ['draft_id', 'material_id'],
  add_video_keyframe: ['draft_id'],
  add_effect: ['effect_type', 'effect_category'],
  modify_effect: ['draft_id', 'material_id'],
  remove_effect: ['draft_id', 'material_id'],
  add_filter: ['filter_type', 'start', 'end'],
  modify_filter: ['material_id'],
  remove_filter: ['draft_id', 'material_id']
}

const READONLY_TOOL_NAMES = new Set([
  'get_transition_types',
  'get_text_intro_types',
  'get_text_outro_types',
  'get_text_loop_anim_types',
  'get_audio_effect_types',
  'get_video_character_effect_types',
  'get_video_scene_effect_types',
  'get_filter_types',
  'get_intro_animation_types',
  'get_outro_animation_types',
  'get_combo_animation_types'
])

const DRAFT_PREVIEW_TOOL_NAMES = new Set(['add_text', 'add_text_template', 'add_image', 'add_audio'])

type PendingToken = {
  accessToken: string
  expiresAt: number
}

type VectCutResponse = {
  error?: string
  error_code?: string
  output?: unknown
  purchase_link?: string
  success?: boolean
  [key: string]: unknown
}

class DraftElementsServer {
  public mcpServer: McpServer
  private readonly store = new Store({ name: 'vectcut' })
  private readonly workspacePath?: string
  private accessToken: PendingToken | null = null
  private refreshPromise: Promise<string> | null = null

  constructor(workspacePath?: string) {
    this.workspacePath = workspacePath
    this.mcpServer = new McpServer(
      {
        name: 'draft-elements',
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
      tools: TOOLS
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = request.params.arguments ?? {}

      try {
        if (!TOOL_NAMES.has(toolName)) {
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`)
        }

        if (toolName === 'get_text_position_preview') {
          return await this.callTextPositionPreview(args as Record<string, unknown>)
        }

        if (toolName === 'get_text_style_preview') {
          return await this.callTextStylePreview(args as Record<string, unknown>)
        }

        if (toolName === 'get_font_previews') {
          return await this.callGetFontPreviews(args as Record<string, unknown>)
        }

        if (toolName === 'get_text_template_previews') {
          return await this.callGetTextTemplatePreviews(args as Record<string, unknown>)
        }

        if (
          toolName === 'get_text_intro_animation_previews' ||
          toolName === 'get_text_outro_animation_previews' ||
          toolName === 'get_text_loop_animation_previews'
        ) {
          return await this.callGetTextAnimationPreviews(toolName, args as Record<string, unknown>)
        }

        if (READONLY_TOOL_NAMES.has(toolName)) {
          return await this.callReadonlyTool(toolName)
        }

        return await this.callMutationTool(toolName, args as Record<string, unknown>)
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

  private async ensureValidAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.accessToken && Date.now() < this.accessToken.expiresAt - 30_000) {
      return this.accessToken.accessToken
    }

    if (!forceRefresh && this.refreshPromise) {
      return this.refreshPromise
    }

    const refreshToken = String(this.store.get('auth.refresh_token') || '').trim()
    if (!refreshToken) {
      throw new Error('No refresh token found, please sign in first')
    }

    this.refreshPromise = this.refreshAccessToken(refreshToken)

    try {
      return await this.refreshPromise
    } finally {
      this.refreshPromise = null
    }
  }

  private async refreshAccessToken(refreshToken: string): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: OAUTH_CLIENT_ID,
      client_secret: OAUTH_CLIENT_SECRET
    }).toString()

    const response = await net.fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Token refresh failed (${response.status}): ${text || 'unknown error'}`)
    }

    const payload = (await response.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
    }

    const accessToken = String(payload.access_token || '').trim()
    if (!accessToken) {
      throw new Error('Token refresh returned no access token')
    }

    const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 3600
    this.accessToken = {
      accessToken,
      expiresAt: Date.now() + expiresIn * 1000
    }

    if (typeof payload.refresh_token === 'string' && payload.refresh_token.trim()) {
      this.store.set('auth.refresh_token', payload.refresh_token.trim())
    }

    return accessToken
  }

  private async requestWithAuth(
    path: string,
    init: {
      method: 'GET' | 'POST'
      body?: Record<string, unknown>
      query?: URLSearchParams
    }
  ): Promise<Response> {
    const token = await this.ensureValidAccessToken()
    const query = init.query?.toString()
    const url = `${API_HOST}${path}${query ? `?${query}` : ''}`

    const doFetch = async (accessToken: string): Promise<Response> =>
      net.fetch(url, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: init.body ? JSON.stringify(init.body) : undefined
      })

    let response = await doFetch(token)
    if (response.status === 401) {
      const freshToken = await this.ensureValidAccessToken(true)
      response = await doFetch(freshToken)
    }

    return response
  }

  private normalizeArgs(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
    const body: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'undefined') continue

      const canonicalKey = ARG_ALIASES[key]
      if (canonicalKey) {
        if (typeof body[canonicalKey] === 'undefined') {
          body[canonicalKey] = value
        }
        continue
      }

      body[key] = value
    }

    for (const [alias, canonical] of Object.entries(ARG_ALIASES)) {
      if (typeof body[canonical] === 'undefined' && typeof args[alias] !== 'undefined') {
        body[canonical] = args[alias]
      }
    }

    // Official add_batch_text docs use `end`, while the example and runtime use `ends`.
    if (toolName === 'add_batch_text' && typeof body.ends === 'undefined' && typeof body.end !== 'undefined') {
      body.ends = body.end
    }

    return body
  }

  private ensureRequiredFields(toolName: string, body: Record<string, unknown>) {
    if (toolName === 'add_audio') {
      const audioUrl = body.audio_url
      const musicId = body.music_id
      const hasAudioUrl = typeof audioUrl === 'string' ? Boolean(audioUrl.trim()) : typeof audioUrl !== 'undefined' && audioUrl !== null
      const hasMusicId = typeof musicId === 'string' ? Boolean(musicId.trim()) : typeof musicId !== 'undefined' && musicId !== null
      if (!hasAudioUrl && !hasMusicId) {
        throw new McpError(ErrorCode.InvalidParams, `'audio_url' or 'music_id' is required for ${toolName}`)
      }
    }

    const required = MUTATION_REQUIRED_FIELDS[toolName] ?? []
    for (const key of required) {
      const value = body[key]
      const isMissing =
        typeof value === 'undefined' ||
        value === null ||
        (typeof value === 'string' && !value.trim()) ||
        (Array.isArray(value) && value.length === 0)
      if (isMissing) {
        throw new McpError(ErrorCode.InvalidParams, `'${key}' is required for ${toolName}`)
      }
    }
  }

  private normalizeResponsePayload(toolName: string, response: VectCutResponse) {
    const output =
      response.output && typeof response.output === 'object' && !Array.isArray(response.output)
        ? { ...(response.output as Record<string, unknown>) }
        : response.output

    if (output && typeof output === 'object' && !Array.isArray(output)) {
      const objectOutput = output as Record<string, unknown>
      if (typeof objectOutput.material_id === 'undefined' && typeof objectOutput.marterial_id !== 'undefined') {
        objectOutput.material_id = objectOutput.marterial_id
      }
    }

    const payload: Record<string, unknown> = {
      provider: 'vectcut',
      action: toolName,
      success: response.success,
      error: response.error,
      output
    }

    if (typeof response.error_code !== 'undefined') {
      payload.error_code = response.error_code
    }

    if (typeof response.purchase_link !== 'undefined') {
      payload.purchase_link = response.purchase_link
    }

    if (Array.isArray(output)) {
      payload.count = output.length
    }

    return payload
  }

  private async callReadonlyTool(toolName: string) {
    const response = await this.requestWithAuth(ENDPOINTS[toolName as keyof typeof ENDPOINTS], { method: 'GET' })
    const data = (await response.json()) as VectCutResponse

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(this.normalizeResponsePayload(toolName, data), null, 2)
        }
      ]
    }
  }

  private resolveWorkspaceRoot(): string {
    const workspaceRoot = String(this.workspacePath || process.env.WORKSPACE_ROOT || '').trim()
    if (!workspaceRoot || !path.isAbsolute(workspaceRoot)) return ''
    return path.normalize(path.resolve(workspaceRoot))
  }

  private async callTextPositionPreview(args: Record<string, unknown>) {
    const normalized = this.normalizeArgs('get_text_position_preview', args)
    const width = Number(normalized.width)
    const height = Number(normalized.height)
    if (!Number.isFinite(width) || width <= 0) {
      throw new McpError(ErrorCode.InvalidParams, "'width' must be a positive number for get_text_position_preview")
    }
    if (!Number.isFinite(height) || height <= 0) {
      throw new McpError(ErrorCode.InvalidParams, "'height' must be a positive number for get_text_position_preview")
    }

    const toOptionalNumber = (value: unknown) => {
      if (typeof value === 'undefined' || value === null || value === '') return undefined
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : undefined
    }
    const toOptionalBool = (value: unknown) => (typeof value === 'boolean' ? value : undefined)

    const preview = renderTextPositionPreview({
      width,
      height,
      transform_x_px: toOptionalNumber(normalized.transform_x_px),
      transform_y_px: toOptionalNumber(normalized.transform_y_px),
      scale_x: toOptionalNumber(normalized.scale_x),
      scale_y: toOptionalNumber(normalized.scale_y),
      align: toOptionalNumber(normalized.align),
      rotation: toOptionalNumber(normalized.rotation),
      bold: toOptionalBool(normalized.bold),
      italic: toOptionalBool(normalized.italic),
      underline: toOptionalBool(normalized.underline),
      vertical: toOptionalBool(normalized.vertical),
      fixed_width_px: toOptionalNumber(normalized.fixed_width_px) ?? null,
      fixed_height_px: toOptionalNumber(normalized.fixed_height_px) ?? null,
      text: typeof normalized.text === 'string' ? normalized.text : undefined,
      font_size: toOptionalNumber(normalized.font_size),
      letter_spacing: toOptionalNumber(normalized.letter_spacing),
      line_spacing: toOptionalNumber(normalized.line_spacing)
    })

    const summary = `Text position preview (${preview.width}x${preview.height}). Canvas is ${Math.round(width)}x${Math.round(height)}. Center-origin coords, +Y moves up. Use the rendered PNG as the source of truth for visual size, position, scale, rotation, and layout; do not infer the result from raw parameters alone.`
    const workspaceRoot = this.resolveWorkspaceRoot()

    // 预览图写到 workspace 方便复查，同时返回 ImageContent，确保 Agent 当前工具调用就能看图。
    if (workspaceRoot) {
      try {
        const artifactDir = path.join(workspaceRoot, 'get_text_position_preview')
        await fsPromises.mkdir(artifactDir, { recursive: true })
        const fileName = `preview-${Date.now()}-${randomUUID().slice(0, 8)}.png`
        const filePath = path.join(artifactDir, fileName)
        await fsPromises.writeFile(filePath, Buffer.from(preview.base64, 'base64'))
        const relativePath = path.relative(workspaceRoot, filePath) || path.basename(filePath)
        return {
          content: [
            {
              type: 'text' as const,
              text: `${summary}\nSaved to: ${filePath}\nRelative to workspace: ${relativePath}\nInline PNG is included below so the current model turn can inspect the rendered result directly.`
            },
            {
              type: 'image' as const,
              data: preview.base64,
              mimeType: 'image/png'
            }
          ]
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn('Failed to persist text position preview to workspace, fallback to inline image', {
          error: message
        })
      }
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: summary
        },
        {
          type: 'image' as const,
          data: preview.base64,
          mimeType: 'image/png'
        }
      ]
    }
  }

  private async callTextStylePreview(args: Record<string, unknown>) {
    const normalized = this.normalizeArgs('get_text_style_preview', args)
    const toOptionalNumber = (value: unknown) => {
      if (typeof value === 'undefined' || value === null || value === '') return undefined
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : undefined
    }
    const toOptionalBool = (value: unknown) => (typeof value === 'boolean' ? value : undefined)
    const width = Number(normalized.width)
    const height = Number(normalized.height)
    if (!Number.isFinite(width) || width <= 0) {
      throw new McpError(ErrorCode.InvalidParams, "'width' must be a positive number for get_text_style_preview")
    }
    if (!Number.isFinite(height) || height <= 0) {
      throw new McpError(ErrorCode.InvalidParams, "'height' must be a positive number for get_text_style_preview")
    }

    const preview = renderTextStylePreview({
      width,
      height,
      transform_x_px: toOptionalNumber(normalized.transform_x_px),
      transform_y_px: toOptionalNumber(normalized.transform_y_px),
      scale_x: toOptionalNumber(normalized.scale_x),
      scale_y: toOptionalNumber(normalized.scale_y),
      align: toOptionalNumber(normalized.align),
      rotation: toOptionalNumber(normalized.rotation),
      fixed_width_px: toOptionalNumber(normalized.fixed_width_px) ?? null,
      fixed_height_px: toOptionalNumber(normalized.fixed_height_px) ?? null,
      text: typeof normalized.text === 'string' ? normalized.text : undefined,
      text_styles: Array.isArray(normalized.text_styles) ? normalized.text_styles : undefined,
      font_size: toOptionalNumber(normalized.font_size),
      letter_spacing: toOptionalNumber(normalized.letter_spacing),
      line_spacing: toOptionalNumber(normalized.line_spacing),
      font_color: typeof normalized.font_color === 'string' ? normalized.font_color : undefined,
      font_alpha: toOptionalNumber(normalized.font_alpha),
      bold: toOptionalBool(normalized.bold),
      italic: toOptionalBool(normalized.italic),
      underline: toOptionalBool(normalized.underline),
      vertical: toOptionalBool(normalized.vertical),
      border_alpha: toOptionalNumber(normalized.border_alpha),
      border_color: typeof normalized.border_color === 'string' ? normalized.border_color : undefined,
      border_width: toOptionalNumber(normalized.border_width),
      background_color: typeof normalized.background_color === 'string' ? normalized.background_color : undefined,
      background_style: toOptionalNumber(normalized.background_style),
      background_alpha: toOptionalNumber(normalized.background_alpha),
      background_round_radius: toOptionalNumber(normalized.background_round_radius),
      background_height: toOptionalNumber(normalized.background_height),
      background_width: toOptionalNumber(normalized.background_width),
      background_horizontal_offset: toOptionalNumber(normalized.background_horizontal_offset),
      background_vertical_offset: toOptionalNumber(normalized.background_vertical_offset),
      shadow_enabled: toOptionalBool(normalized.shadow_enabled),
      shadow_alpha: toOptionalNumber(normalized.shadow_alpha),
      shadow_angle: toOptionalNumber(normalized.shadow_angle),
      shadow_color: typeof normalized.shadow_color === 'string' ? normalized.shadow_color : undefined,
      shadow_distance: toOptionalNumber(normalized.shadow_distance),
      shadow_smoothing: toOptionalNumber(normalized.shadow_smoothing)
    })

    const summary = `Text style preview (${preview.width}x${preview.height}). Checkerboard color-test background shows opacity, border, background, and shadow. Use the rendered PNG as the source of truth for all visual attributes; do not infer the result from raw parameters alone.`
    const workspaceRoot = this.resolveWorkspaceRoot()
    if (workspaceRoot) {
      try {
        const artifactDir = path.join(workspaceRoot, 'get_text_style_preview')
        await fsPromises.mkdir(artifactDir, { recursive: true })
        const fileName = `preview-${Date.now()}-${randomUUID().slice(0, 8)}.png`
        const filePath = path.join(artifactDir, fileName)
        await fsPromises.writeFile(filePath, Buffer.from(preview.base64, 'base64'))
        const relativePath = path.relative(workspaceRoot, filePath) || path.basename(filePath)
        return {
          content: [
            {
              type: 'text' as const,
              text: `${summary}\nSaved to: ${filePath}\nRelative to workspace: ${relativePath}\nInline PNG is included below so the current model turn can inspect the rendered result directly.`
            },
            {
              type: 'image' as const,
              data: preview.base64,
              mimeType: 'image/png'
            }
          ]
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn('Failed to persist text style preview to workspace, fallback to inline image', { error: message })
      }
    }

    return {
      content: [
        { type: 'text' as const, text: summary },
        { type: 'image' as const, data: preview.base64, mimeType: 'image/png' }
      ]
    }
  }

  private async callGetFontPreviews(args: Record<string, unknown>) {
    const normalized = this.normalizeArgs('get_font_previews', args)

    const toInt = (value: unknown, fallback: number, min: number, max: number) => {
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) return fallback
      return Math.max(min, Math.min(max, Math.round(parsed)))
    }

    // 3x3 封顶：page_size 硬限制 1~9；列数、cell 大小均不开放给调用方。
    const page = toInt(normalized.page, 1, 1, 10000)
    const pageSize = toInt(normalized.page_size, 9, 1, 9)
    const q = typeof normalized.q === 'string' ? normalized.q.trim() : ''
    const category = typeof normalized.category === 'string' ? normalized.category.trim() : ''

    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('page_size', String(pageSize))
    if (q) params.set('q', q)
    if (category) params.set('category', category)
    logger.info('get_font_previews: fetching', { path: ENDPOINTS.get_font_previews, query: params.toString() })

    let fontResponse: Response
    try {
      fontResponse = await this.requestWithAuth(ENDPOINTS.get_font_previews, { method: 'GET', query: params })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new McpError(ErrorCode.InternalError, `Failed to fetch fonts list: ${message}`)
    }
    if (!fontResponse.ok) {
      throw new McpError(ErrorCode.InternalError, `Fonts list request failed: HTTP ${fontResponse.status}`)
    }
    const fontPayload = (await fontResponse.json()) as {
      success?: boolean
      error?: string
      output?: {
        items?: FontSpriteItem[]
        page?: number
        page_size?: number
        total?: number
        total_pages?: number
      }
    }
    if (fontPayload.success === false) {
      throw new McpError(ErrorCode.InternalError, `Fonts API error: ${fontPayload.error || 'unknown'}`)
    }
    const items = Array.isArray(fontPayload.output?.items) ? fontPayload.output!.items : []
    logger.info('get_font_previews: items received', { count: items.length, page, pageSize, q, category })

    if (items.length === 0) {
      return {
        content: [
          { type: 'text' as const, text: `No fonts returned for page=${page} page_size=${pageSize}${q ? ` q=${q}` : ''}${category ? ` category=${category}` : ''}.` }
        ]
      }
    }

    // 列数自适应：N<3 时按 N 收窄，不留空格子；N>=3 固定 3 列。
    const columns = Math.min(3, items.length)
    const sprite = await renderFontSprite({
      items,
      columns,
      cellWidth: 810,
      cellPreviewHeight: 225
    })
    logger.info('get_font_previews: sprite rendered', {
      width: sprite.width,
      height: sprite.height,
      rendered: sprite.rendered.length,
      failed: sprite.failed.length
    })

    const names = items.map((it) => it.name)
    const total = fontPayload.output?.total ?? names.length
    const totalPages = fontPayload.output?.total_pages ?? 1
    const summary = [
      `Fonts page ${page}/${totalPages} (page_size=${pageSize}, total=${total}).`,
      `Sprite layout: ${Math.ceil(items.length / columns)}x${columns}, image size ${sprite.width}x${sprite.height}.`,
      'Use the rendered sprite PNG as the source of truth for font appearance and readability; do not choose a font from name/category/metadata alone.',
      `Font names (use as 'font' field in add_text/modify_text): ${names.join(', ')}`
    ]
    if (totalPages > page) {
      summary.push(`Call get_font_previews again with page=${page + 1} to see more fonts.`)
    }
    if (sprite.failed.length) {
      summary.push(`Failed previews: ${sprite.failed.map((f) => f.name).join(', ')}`)
    }

    const workspaceRoot = this.resolveWorkspaceRoot()
    if (workspaceRoot) {
      try {
        const artifactDir = path.join(workspaceRoot, 'get_font_previews')
        await fsPromises.mkdir(artifactDir, { recursive: true })
        const fileName = `fonts-p${page}-${Date.now()}-${randomUUID().slice(0, 8)}.png`
        const filePath = path.join(artifactDir, fileName)
        await fsPromises.writeFile(filePath, sprite.buffer)
        const relativePath = path.relative(workspaceRoot, filePath) || path.basename(filePath)
        return {
          content: [
            {
              type: 'text' as const,
              text: `${summary.join('\n')}\nSaved to: ${filePath}\nRelative to workspace: ${relativePath}\nInline PNG is included below so the current model turn can inspect the rendered result directly.`
            },
            {
              type: 'image' as const,
              data: sprite.base64,
              mimeType: 'image/png'
            }
          ]
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn('Failed to persist font sprite to workspace, fallback to inline image', { error: message })
      }
    }

    return {
      content: [
        { type: 'text' as const, text: summary.join('\n') },
        { type: 'image' as const, data: sprite.base64, mimeType: 'image/png' }
      ]
    }
  }

  private async callGetTextTemplatePreviews(args: Record<string, unknown>) {
    const normalized = this.normalizeArgs('get_text_template_previews', args)

    const toInt = (value: unknown, fallback: number, min: number, max: number) => {
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) return fallback
      return Math.max(min, Math.min(max, Math.round(parsed)))
    }

    const page = toInt(normalized.page, 1, 1, 10000)
    // 每个 preview_url 是单个模板的雪碧图，每页内嵌图片数量封顶 8，避免一次返回过多图片。
    const pageSize = toInt(normalized.page_size, 8, 1, 8)
    const textTemplateId = typeof normalized.text_template_id === 'string' ? normalized.text_template_id.trim() : ''
    const orientation = typeof normalized.orientation === 'string' ? normalized.orientation.trim() : ''
    if (orientation && orientation !== 'portrait' && orientation !== 'landscape') {
      throw new McpError(ErrorCode.InvalidParams, "'orientation' must be 'portrait' or 'landscape' for get_text_template_previews")
    }

    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('page_size', String(pageSize))
    if (textTemplateId) params.set('text_template_id', textTemplateId)
    if (orientation) params.set('orientation', orientation)
    logger.info('get_text_template_previews: fetching', { path: ENDPOINTS.get_text_template_previews, query: params.toString() })

    let response: Response
    try {
      response = await this.requestWithAuth(ENDPOINTS.get_text_template_previews, { method: 'GET', query: params })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new McpError(ErrorCode.InternalError, `Failed to fetch text template previews: ${message}`)
    }
    if (!response.ok) {
      throw new McpError(ErrorCode.InternalError, `Text template previews request failed: HTTP ${response.status}`)
    }

    const payload = (await response.json()) as {
      success?: boolean
      error?: string
      output?: {
        items?: Array<{
          orientation?: string
          preview_url?: string
          preview_video_url?: string
          text_template_id?: string
          texts_count?: number
        }>
        page?: number
        page_size?: number
        total?: number
        total_pages?: number
      }
    }
    if (payload.success === false) {
      throw new McpError(ErrorCode.InternalError, `Text template previews API error: ${payload.error || 'unknown'}`)
    }

    const items = Array.isArray(payload.output?.items) ? payload.output!.items : []
    logger.info('get_text_template_previews: items received', { count: items.length, page, pageSize, orientation, textTemplateId })
    if (items.length === 0) {
      return {
        content: [
          { type: 'text' as const, text: `No text templates returned for page=${page} page_size=${pageSize}${orientation ? ` orientation=${orientation}` : ''}${textTemplateId ? ` text_template_id=${textTemplateId}` : ''}.` }
        ]
      }
    }

    // 复用动画预览下载管线：preview_url 本身就是单模板雪碧图，不再二次拼接。
    const previews = await fetchTextAnimationPreviewImages(
      items
        .filter((it) => typeof it.text_template_id === 'string' && it.text_template_id && typeof it.preview_url === 'string' && it.preview_url)
        .map((it) => ({ name: it.text_template_id as string, preview_url: it.preview_url as string }))
    )
    const total = payload.output?.total ?? items.length
    const totalPages = payload.output?.total_pages ?? 1
    const summary = [
      `Text templates page ${page}/${totalPages} (page_size=${pageSize}, total=${total}).`,
      "Each image below is one template's backend preview sprite; treat the sprite as the source of truth for the template look and do not pick a template by id alone.",
      items
        .map((it) => `text_template_id=${it.text_template_id ?? ''} orientation=${it.orientation ?? ''} texts_count=${it.texts_count ?? ''}${it.preview_video_url ? ` motion_preview=${it.preview_video_url}` : ''}`)
        .join('\n')
    ]
    if (totalPages > page) {
      summary.push(`Call get_text_template_previews again with page=${page + 1} to see more templates.`)
    }
    if (previews.failed.length) {
      summary.push(`Failed previews: ${previews.failed.map((f) => f.name).join(', ')}`)
    }

    const imageContents = previews.rendered.map((preview) => ({
      type: 'image' as const,
      data: preview.base64,
      mimeType: preview.mimeType
    }))

    const workspaceRoot = this.resolveWorkspaceRoot()
    if (workspaceRoot) {
      try {
        const artifactDir = path.join(workspaceRoot, 'get_text_template_previews')
        await fsPromises.mkdir(artifactDir, { recursive: true })
        const savedLines: string[] = []
        for (const [index, preview] of previews.rendered.entries()) {
          const fileName = `template-p${page}-${index + 1}-${preview.item.name}-${Date.now()}-${randomUUID().slice(0, 8)}.png`
          const filePath = path.join(artifactDir, fileName)
          await fsPromises.writeFile(filePath, preview.buffer)
          savedLines.push(`${preview.item.name}: ${filePath}`)
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: `${summary.join('\n')}\nSaved files:\n${savedLines.join('\n')}\nInline PNG images are included below so the current model turn can inspect each template sprite directly.`
            },
            ...imageContents
          ]
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn('Failed to persist text template previews to workspace, fallback to inline images', { error: message })
      }
    }

    return {
      content: [
        { type: 'text' as const, text: summary.join('\n') },
        ...imageContents
      ]
    }
  }

  private async callGetTextAnimationPreviews(toolName: string, args: Record<string, unknown>) {
    const normalized = this.normalizeArgs(toolName, args)
    const config = {
      get_text_intro_animation_previews: {
        kind: 'intro' as TextAnimationPreviewKind,
        endpoint: ENDPOINTS.get_text_intro_previews,
        targetField: 'intro_animation',
        artifactDir: 'get_text_intro_animation_previews',
        label: 'Text intro animations'
      },
      get_text_outro_animation_previews: {
        kind: 'outro' as TextAnimationPreviewKind,
        endpoint: ENDPOINTS.get_text_outro_previews,
        targetField: 'outro_animation',
        artifactDir: 'get_text_outro_animation_previews',
        label: 'Text outro animations'
      },
      get_text_loop_animation_previews: {
        kind: 'loop' as TextAnimationPreviewKind,
        endpoint: ENDPOINTS.get_text_loop_anim_previews,
        targetField: 'loop_animation',
        artifactDir: 'get_text_loop_animation_previews',
        label: 'Text loop animations'
      }
    }[toolName]

    if (!config) {
      throw new McpError(ErrorCode.InvalidParams, `Unsupported text animation preview tool: ${toolName}`)
    }

    const toInt = (value: unknown, fallback: number, min: number, max: number) => {
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) return fallback
      return Math.max(min, Math.min(max, Math.round(parsed)))
    }

    // 每个 preview_url 本身已经是一个 3x3 动画帧图，返回多张独立图片，不再二次拼接。
    const page = toInt(normalized.page, 1, 1, 10000)
    const pageSize = toInt(normalized.page_size, 4, 1, 4)
    const q = typeof normalized.q === 'string' ? normalized.q.trim() : ''
    const category = typeof normalized.category === 'string' ? normalized.category.trim() : ''

    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('page_size', String(pageSize))
    if (q) params.set('q', q)
    if (category) params.set('category', category)
    logger.info(`${toolName}: fetching`, { path: config.endpoint, query: params.toString() })

    let response: Response
    try {
      response = await this.requestWithAuth(config.endpoint, { method: 'GET', query: params })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new McpError(ErrorCode.InternalError, `Failed to fetch ${config.kind} text animation previews: ${message}`)
    }
    if (!response.ok) {
      throw new McpError(ErrorCode.InternalError, `${config.label} request failed: HTTP ${response.status}`)
    }

    const payload = (await response.json()) as {
      success?: boolean
      error?: string
      output?: {
        items?: TextAnimationPreviewItem[]
        page?: number
        page_size?: number
        total?: number
        total_pages?: number
      }
    }
    if (payload.success === false) {
      throw new McpError(ErrorCode.InternalError, `${config.label} API error: ${payload.error || 'unknown'}`)
    }

    const items = Array.isArray(payload.output?.items) ? payload.output!.items : []
    logger.info(`${toolName}: items received`, { count: items.length, page, pageSize, q, category })
    if (items.length === 0) {
      return {
        content: [
          { type: 'text' as const, text: `No ${config.kind} text animation previews returned for page=${page} page_size=${pageSize}${q ? ` q=${q}` : ''}${category ? ` category=${category}` : ''}.` }
        ]
      }
    }

    const previews = await fetchTextAnimationPreviewImages(items)
    const names = items.map((it) => it.name)
    const total = payload.output?.total ?? names.length
    const totalPages = payload.output?.total_pages ?? 1
    const summary = [
      `${config.label} page ${page}/${totalPages} (page_size=${pageSize}, total=${total}).`,
      'Each image below is one backend preview_url and is already a 3x3 animation frame contact sheet; previews are intentionally not stitched together.',
      `Use the rendered preview image as the source of truth for animation motion/timing; do not choose ${config.targetField} from name/category/metadata alone.`,
      `Animation names (use as '${config.targetField}' in add_text/modify_text): ${names.join(', ')}`
    ]
    if (totalPages > page) {
      summary.push(`Call ${toolName} again with page=${page + 1} to see more animations.`)
    }
    if (previews.failed.length) {
      summary.push(`Failed previews: ${previews.failed.map((f) => f.name).join(', ')}`)
    }

    const imageContents = previews.rendered.map((preview) => ({
      type: 'image' as const,
      data: preview.base64,
      mimeType: preview.mimeType
    }))

    const workspaceRoot = this.resolveWorkspaceRoot()
    if (workspaceRoot) {
      try {
        const artifactDir = path.join(workspaceRoot, config.artifactDir)
        await fsPromises.mkdir(artifactDir, { recursive: true })
        const savedLines: string[] = []
        for (const [index, preview] of previews.rendered.entries()) {
          const safeName = preview.item.name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || `animation_${index + 1}`
          const fileName = `${config.kind}-p${page}-${index + 1}-${safeName}-${Date.now()}-${randomUUID().slice(0, 8)}.png`
          const filePath = path.join(artifactDir, fileName)
          await fsPromises.writeFile(filePath, preview.buffer)
          savedLines.push(`${preview.item.name}: ${filePath}`)
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: `${summary.join('\n')}\nSaved files:\n${savedLines.join('\n')}\nInline PNG images are included below so the current model turn can inspect each animation preview directly.`
            },
            ...imageContents
          ]
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn(`Failed to persist ${toolName} previews to workspace, fallback to inline images`, { error: message })
      }
    }

    return {
      content: [
        { type: 'text' as const, text: summary.join('\n') },
        ...imageContents
      ]
    }
  }

  private async callMutationTool(toolName: string, args: Record<string, unknown>) {
    const body = this.normalizeArgs(toolName, args)
    this.ensureRequiredFields(toolName, body)

    const preview = DRAFT_PREVIEW_TOOL_NAMES.has(toolName)
      ? {
          clientRequestId: typeof args.clientRequestId === 'string' && args.clientRequestId.trim()
            ? args.clientRequestId.trim()
            : randomUUID(),
          draftId: typeof body.draft_id === 'string' ? body.draft_id.trim() : '',
          width: typeof body.width === 'number' ? body.width : undefined,
          height: typeof body.height === 'number' ? body.height : undefined
        }
      : undefined

    if (preview) {
      // This ID correlates UI updates only; it is not a VectCut API parameter.
      delete body.clientRequestId
      this.emitDraftPreview({
        ...preview,
        action: preview.draftId ? 'modify' : 'create',
        draftId: preview.draftId || `pending:${preview.clientRequestId}`,
        status: 'in_progress'
      })
    }

    const response = await this.requestWithAuth(ENDPOINTS[toolName as keyof typeof ENDPOINTS], {
      method: 'POST',
      body
    })
    const data = (await response.json()) as VectCutResponse

    if (preview && response.ok && data.success !== false && !data.error) {
      const output = data.output && typeof data.output === 'object' && !Array.isArray(data.output)
        ? data.output as Record<string, unknown>
        : undefined
      const draftId = (typeof output?.draft_id === 'string' ? output.draft_id.trim() : '') || preview.draftId
      if (draftId) {
        this.emitDraftPreview({
          ...preview,
          action: preview.draftId ? 'modify' : 'create',
          draftId,
          status: 'completed'
        })
      }
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(this.normalizeResponsePayload(toolName, data), null, 2)
        }
      ]
    }
  }

  private emitDraftPreview(payload: {
    action: 'create' | 'modify'
    clientRequestId: string
    draftId: string
    width?: number
    height?: number
    status: 'in_progress' | 'completed'
  }) {
    const mainWindow = windowService.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) {
      logger.warn('Skip draft preview event because main window is unavailable', { draftId: payload.draftId })
      return
    }

    mainWindow.webContents.send('app:draft-created', {
      ...payload,
      createdAt: Date.now()
    })
  }
}

export default DraftElementsServer
