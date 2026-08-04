import { loggerService } from '@logger'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import Store from 'electron-store'
import { net } from 'electron'

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
  get_text_intro_types: '/cut_jianying/get_text_intro_types',
  get_text_outro_types: '/cut_jianying/get_text_outro_types',
  get_text_loop_anim_types: '/cut_jianying/get_text_loop_anim_types',
  get_font_types: '/cut_jianying/get_font_types',
  add_image: '/cut_jianying/add_image',
  add_batch_image: '/cut_jianying/add_batch_image',
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
    'Add a single text layer into a VectCut draft. Use this for one text block with optional font, color, position, and animations.',
    {
      text: { type: 'string', description: 'Required text content.' },
      start: { type: 'number', description: 'Required start time in seconds.' },
      end: { type: 'number', description: 'Required end time in seconds.' },
      draftId: { type: 'string', description: 'Optional draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Optional draft ID.' },
      transform_y: { type: 'number', description: 'Optional Y transform ratio.' },
      transform_x: { type: 'number', description: 'Optional X transform ratio.' },
      font: { type: 'string', description: 'Optional font name.' },
      font_color: { type: 'string', description: 'Optional font color.' },
      font_size: { type: 'number', description: 'Optional font size.' },
      trackName: { type: 'string', description: 'Optional track name alias of track_name.' },
      track_name: { type: 'string', description: 'Optional track name.' },
      vertical: { type: 'boolean', description: 'Optional vertical text mode.' },
      font_alpha: { type: 'number', description: 'Optional font alpha.' },
      fixed_width: { type: 'number', description: 'Optional fixed layout width.' },
      fixed_height: { type: 'number', description: 'Optional fixed layout height.' },
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
      align: { type: 'string', description: 'Optional text alignment.' },
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
    'Add multiple text layers into a VectCut draft in one request. Use this when the user wants batch text insertion or multiple caption segments.',
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
      align: { type: 'integer', description: 'Optional text alignment enum.' },
      rotation: { type: 'number', description: 'Optional rotation in degrees.' },
      font_color: { type: 'string', description: 'Optional font color.' },
      font_size: { type: 'integer', description: 'Optional font size.' },
      bold: { type: 'boolean', description: 'Optional bold flag.' },
      italic: { type: 'boolean', description: 'Optional italic flag.' },
      underline: { type: 'boolean', description: 'Optional underline flag.' },
      track_name: { type: 'string', description: 'Optional track name.' },
      relative_index: { type: 'integer', description: 'Optional relative track index.' },
      vertical: { type: 'boolean', description: 'Optional vertical text mode.' },
      font_alpha: { type: 'number', description: 'Optional font alpha.' },
      fixed_width: { type: 'number', description: 'Optional fixed layout width.' },
      fixed_height: { type: 'number', description: 'Optional fixed layout height.' },
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
    'Modify an existing text material in a VectCut draft by material ID.',
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
      vertical: { type: 'boolean', description: 'Optional vertical text mode.' },
      font_alpha: { type: 'number', description: 'Optional font alpha.' },
      letter_spacing: { type: 'number', description: 'Optional letter spacing.' },
      line_spacing: { type: 'number', description: 'Optional line spacing.' },
      align: { type: 'string', description: 'Optional text alignment.' },
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
      fixed_width: { type: 'number', description: 'Optional fixed layout width.' },
      fixed_height: { type: 'number', description: 'Optional fixed layout height.' },
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
    'Add SRT subtitles into a VectCut draft. Supports raw SRT content or an SRT file URL.',
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
  readonlyTool('get_font_types', 'List supported font names for text and subtitle tools.'),
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
      transform_y_px: { type: 'string', description: 'Optional Y transform in pixels.' },
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
      transform_y_px: { type: 'string', description: 'Optional Y transform in pixels.' },
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
      starts: { type: 'array', items: { type: 'number' }, description: 'Optional source start times in seconds.' },
      ends: { type: 'array', items: { type: 'number' }, description: 'Optional source end times in seconds.' },
      durations: { type: 'array', items: { type: 'number' }, description: 'Optional source durations.' },
      targetStarts: { type: 'array', items: { type: 'number' }, description: 'Optional timeline start times alias of target_starts.' },
      target_starts: { type: 'array', items: { type: 'number' }, description: 'Optional timeline start times in seconds.' },
      targetEnds: { type: 'array', items: { type: 'number' }, description: 'Optional timeline end times alias of target_ends.' },
      target_ends: { type: 'array', items: { type: 'number' }, description: 'Optional timeline end times in seconds.' },
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
      audioUrl: { type: 'string', description: 'Required audio URL or local file path alias of audio_url.' },
      audio_url: { type: 'string', description: 'Required audio URL or local file path.' },
      start: { type: 'number', description: 'Optional source start time in seconds.' },
      end: { type: 'number', description: 'Optional source end time in seconds.' },
      targetStart: { type: 'number', description: 'Optional timeline start alias of target_start.' },
      target_start: { type: 'number', description: 'Optional timeline start time in seconds.' },
      draftId: { type: 'string', description: 'Optional draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Optional draft ID.' },
      volume: { type: 'number', description: 'Optional volume.' },
      speed: { type: 'number', description: 'Optional playback speed.' },
      track_name: { type: 'string', description: 'Optional track name.' },
      duration: { type: 'number', description: 'Optional target duration in seconds.' },
      effect_type: { type: 'string', description: 'Optional audio effect type.' },
      effect_params: { type: 'object', description: 'Optional audio effect params.' },
      width: { type: 'number', description: 'Optional canvas width.' },
      height: { type: 'number', description: 'Optional canvas height.' },
      fade_in_duration: { type: 'number', description: 'Optional fade-in duration.' },
      fade_out_duratioin: { type: 'number', description: 'Optional fade-out duration.' }
    },
    ['audio_url']
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
      effect_params: { type: 'object', description: 'Optional audio effect params.' },
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
  )
]

const TOOL_NAMES = new Set(TOOLS.map((tool) => tool.name))

const ARG_ALIASES: Record<string, string> = {
  draftId: 'draft_id',
  materialId: 'material_id',
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
  fixedWidth: 'fixed_width',
  fixedHeight: 'fixed_height',
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
  videoUrl: 'video_url',
  videoUrls: 'video_urls',
  audioUrl: 'audio_url',
  audioUrls: 'audio_urls',
  targetStart: 'target_start',
  targetStarts: 'target_starts',
  targetEnds: 'target_ends',
  introAnimationDuration: 'intro_animation_duration',
  outroAnimationDuration: 'outro_animation_duration',
  comboAnimation: 'combo_animation',
  comboAnimationDuration: 'combo_animation_duration',
  transitionDuration: 'transition_duration',
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
  modify_image: ['draft_id', 'material_id'],
  remove_image: ['draft_id', 'material_id'],
  add_video: ['video_url'],
  add_batch_video: ['video_urls'],
  modify_video: ['draft_id', 'material_id'],
  remove_video: ['draft_id', 'material_id'],
  add_audio: ['audio_url'],
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
  'get_font_types',
  'get_audio_effect_types',
  'get_video_character_effect_types',
  'get_video_scene_effect_types',
  'get_filter_types',
  'get_intro_animation_types',
  'get_outro_animation_types',
  'get_combo_animation_types'
])

type PendingToken = {
  accessToken: string
  expiresAt: number
}

type VectCutResponse = {
  error?: string
  output?: unknown
  purchase_link?: string
  success?: boolean
  [key: string]: unknown
}

class DraftElementsServer {
  public mcpServer: McpServer
  private readonly store = new Store({ name: 'vectcut' })
  private accessToken: PendingToken | null = null
  private refreshPromise: Promise<string> | null = null

  constructor() {
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
    }
  ): Promise<Response> {
    const token = await this.ensureValidAccessToken()

    const doFetch = async (accessToken: string): Promise<Response> =>
      net.fetch(`${API_HOST}${path}`, {
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

  private async callMutationTool(toolName: string, args: Record<string, unknown>) {
    const body = this.normalizeArgs(toolName, args)
    this.ensureRequiredFields(toolName, body)

    const response = await this.requestWithAuth(ENDPOINTS[toolName as keyof typeof ENDPOINTS], {
      method: 'POST',
      body
    })
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
}

export default DraftElementsServer
