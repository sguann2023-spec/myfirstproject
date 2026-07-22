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
      trackName: { type: 'string', description: 'Optional track name alias of track_name.' },
      track_name: { type: 'string', description: 'Optional track name.' }
    },
    ['text', 'start', 'end']
  ),
  toolWithArgs(
    'add_batch_text',
    'Add multiple text layers into a VectCut draft in one request. Use this when the user wants batch text insertion or multiple caption segments.',
    {
      texts: { type: 'array', items: { type: 'string' }, description: 'Required text contents.' },
      starts: { type: 'array', items: { type: 'number' }, description: 'Required start times in seconds.' },
      ends: { type: 'array', items: { type: 'number' }, description: 'Required end times in seconds.' },
      draftId: { type: 'string', description: 'Optional draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Optional draft ID.' }
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
    }
  ),
  toolWithArgs(
    'modify_text',
    'Modify an existing text material in a VectCut draft by material ID.',
    {
      draftId: { type: 'string', description: 'Required draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Required draft ID.' },
      materialId: { type: 'string', description: 'Required material ID alias of material_id.' },
      material_id: { type: 'string', description: 'Required material ID.' },
      text: { type: 'string', description: 'Optional updated text content.' }
    }
  ),
  toolWithArgs(
    'add_subtitle',
    'Add SRT subtitles into a VectCut draft. Supports raw SRT content or an SRT file URL.',
    {
      srt: { type: 'string', description: 'Required SRT content or URL.' },
      draftId: { type: 'string', description: 'Optional draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Optional draft ID.' },
      timeOffset: { type: 'number', description: 'Optional subtitle time offset alias of time_offset.' },
      time_offset: { type: 'number', description: 'Optional subtitle time offset in seconds.' }
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
      imageUrl: { type: 'string', description: 'Required image URL alias of image_url.' },
      image_url: { type: 'string', description: 'Required image URL.' },
      start: { type: 'number', description: 'Optional start time in seconds.' },
      end: { type: 'number', description: 'Required end time in seconds.' },
      draftId: { type: 'string', description: 'Optional draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Optional draft ID.' }
    }
  ),
  toolWithArgs(
    'add_batch_image',
    'Add multiple image layers into a VectCut draft in one request.',
    {
      imageUrls: { type: 'array', items: { type: 'string' }, description: 'Required image URLs alias of image_urls.' },
      image_urls: { type: 'array', items: { type: 'string' }, description: 'Required image URLs.' },
      starts: { type: 'array', items: { type: 'number' }, description: 'Optional start times in seconds.' },
      ends: { type: 'array', items: { type: 'number' }, description: 'Required end times in seconds.' },
      draftId: { type: 'string', description: 'Optional draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Optional draft ID.' }
    }
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
      image_url: { type: 'string', description: 'Optional image URL.' }
    }
  ),
  toolWithArgs(
    'remove_image',
    'Remove an existing image material from a VectCut draft by material ID.',
    {
      draftId: { type: 'string', description: 'Required draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Required draft ID.' },
      materialId: { type: 'string', description: 'Required material ID alias of material_id.' },
      material_id: { type: 'string', description: 'Required material ID.' }
    }
  ),
  toolWithArgs(
    'add_video',
    'Add a single video layer into a VectCut draft.',
    {
      videoUrl: { type: 'string', description: 'Required video URL alias of video_url.' },
      video_url: { type: 'string', description: 'Required video URL.' },
      start: { type: 'number', description: 'Optional source start time in seconds.' },
      end: { type: 'number', description: 'Optional source end time in seconds.' },
      targetStart: { type: 'number', description: 'Optional timeline start alias of target_start.' },
      target_start: { type: 'number', description: 'Optional timeline start time in seconds.' },
      draftId: { type: 'string', description: 'Optional draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Optional draft ID.' }
    }
  ),
  toolWithArgs(
    'add_batch_video',
    'Add multiple video layers into a VectCut draft in one request.',
    {
      videoUrls: { type: 'array', items: { type: 'string' }, description: 'Required video URLs alias of video_urls.' },
      video_urls: { type: 'array', items: { type: 'string' }, description: 'Required video URLs.' },
      starts: { type: 'array', items: { type: 'number' }, description: 'Optional source start times in seconds.' },
      ends: { type: 'array', items: { type: 'number' }, description: 'Optional source end times in seconds.' },
      targetStarts: { type: 'array', items: { type: 'number' }, description: 'Optional timeline start times alias of target_starts.' },
      target_starts: { type: 'array', items: { type: 'number' }, description: 'Optional timeline start times in seconds.' },
      targetEnds: { type: 'array', items: { type: 'number' }, description: 'Optional timeline end times alias of target_ends.' },
      target_ends: { type: 'array', items: { type: 'number' }, description: 'Optional timeline end times in seconds.' },
      draftId: { type: 'string', description: 'Optional draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Optional draft ID.' }
    }
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
      video_url: { type: 'string', description: 'Optional video URL.' }
    }
  ),
  toolWithArgs(
    'remove_video',
    'Remove an existing video material from a VectCut draft by material ID.',
    {
      draftId: { type: 'string', description: 'Required draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Required draft ID.' },
      materialId: { type: 'string', description: 'Required material ID alias of material_id.' },
      material_id: { type: 'string', description: 'Required material ID.' }
    }
  ),
  readonlyTool('get_transition_types', 'List supported transition types for visual tracks such as image and video.'),
  toolWithArgs(
    'add_audio',
    'Add a single audio layer into a VectCut draft.',
    {
      audioUrl: { type: 'string', description: 'Required audio URL alias of audio_url.' },
      audio_url: { type: 'string', description: 'Required audio URL.' },
      start: { type: 'number', description: 'Optional source start time in seconds.' },
      end: { type: 'number', description: 'Optional source end time in seconds.' },
      targetStart: { type: 'number', description: 'Optional timeline start alias of target_start.' },
      target_start: { type: 'number', description: 'Optional timeline start time in seconds.' },
      draftId: { type: 'string', description: 'Optional draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Optional draft ID.' }
    }
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
      draftId: { type: 'string', description: 'Optional draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Optional draft ID.' }
    }
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
      audio_url: { type: 'string', description: 'Optional audio URL.' }
    }
  ),
  toolWithArgs(
    'remove_audio',
    'Remove an existing audio material from a VectCut draft by material ID.',
    {
      draftId: { type: 'string', description: 'Required draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Required draft ID.' },
      materialId: { type: 'string', description: 'Required material ID alias of material_id.' },
      material_id: { type: 'string', description: 'Required material ID.' }
    }
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
      propertyType: { type: 'string', description: 'Optional single keyframe property type alias of property_type.' },
      property_type: { type: 'string', description: 'Optional single keyframe property type.' },
      time: { type: 'number', description: 'Optional single keyframe time in seconds.' },
      value: { type: 'string', description: 'Optional single keyframe value.' },
      propertyTypes: { type: 'array', items: { type: 'string' }, description: 'Optional batch property types alias of property_types.' },
      property_types: { type: 'array', items: { type: 'string' }, description: 'Optional batch property types.' },
      times: { type: 'array', items: { type: 'number' }, description: 'Optional batch times in seconds.' },
      values: { type: 'array', items: { type: 'string' }, description: 'Optional batch values.' }
    }
  ),
  toolWithArgs(
    'add_effect',
    'Add a character or scene effect into a VectCut draft.',
    {
      effectType: { type: 'string', description: 'Required effect name alias of effect_type.' },
      effect_type: { type: 'string', description: 'Required effect name.' },
      effectCategory: { type: 'string', description: 'Optional effect category alias of effect_category.' },
      effect_category: { type: 'string', description: 'Optional effect category.' },
      draftId: { type: 'string', description: 'Optional draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Optional draft ID.' }
    }
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
      effect_category: { type: 'string', description: 'Optional effect category.' }
    }
  ),
  toolWithArgs(
    'remove_effect',
    'Remove an existing effect material from a VectCut draft by material ID.',
    {
      draftId: { type: 'string', description: 'Required draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Required draft ID.' },
      materialId: { type: 'string', description: 'Required material ID alias of material_id.' },
      material_id: { type: 'string', description: 'Required material ID.' }
    }
  ),
  readonlyTool('get_video_character_effect_types', 'List supported character effect types for visual effect tools.'),
  readonlyTool('get_video_scene_effect_types', 'List supported scene effect types for visual effect tools.'),
  toolWithArgs(
    'add_filter',
    'Add a filter into a VectCut draft.',
    {
      filterType: { type: 'string', description: 'Required filter name alias of filter_type.' },
      filter_type: { type: 'string', description: 'Required filter name.' },
      draftId: { type: 'string', description: 'Optional draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Optional draft ID.' }
    }
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
      filter_type: { type: 'string', description: 'Optional filter name.' }
    }
  ),
  toolWithArgs(
    'remove_filter',
    'Remove an existing filter material from a VectCut draft by material ID.',
    {
      draftId: { type: 'string', description: 'Required draft ID alias of draft_id.' },
      draft_id: { type: 'string', description: 'Required draft ID.' },
      materialId: { type: 'string', description: 'Required material ID alias of material_id.' },
      material_id: { type: 'string', description: 'Required material ID.' }
    }
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
  propertyType: 'property_type',
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
  add_effect: ['effect_type'],
  modify_effect: ['draft_id', 'material_id'],
  remove_effect: ['draft_id', 'material_id'],
  add_filter: ['filter_type'],
  modify_filter: ['draft_id', 'material_id'],
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

  private normalizeArgs(args: Record<string, unknown>): Record<string, unknown> {
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
    const body = this.normalizeArgs(args)
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
