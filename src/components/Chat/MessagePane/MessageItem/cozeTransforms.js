import { normalizeTextEffectParams } from '../../../../shared/textEffects';

const COZE_WORKFLOW_SOURCE = {
  workflowId: '7668682150007488554',
  flowMode: 0,
  spaceId: '7472683780642258985',
  isDouyin: false,
  host: 'www.coze.cn'
};

const COZE_CREATE_DRAFT_PLUGIN_META = {
  apiID: '7579582015465537536',
  apiName: 'create_draft',
  pluginID: '7579582015465340928',
  pluginName: '流光剪辑_剪映草稿助手(会员版)',
  pluginVersion: '',
  tips: '',
  outDocLink: ''
};

const COZE_CREATE_DRAFT_NODE_META = {
  title: 'create_draft',
  icon: 'https://p3-flow-product-sign.byteimg.com/tos-cn-i-13w3uml6bg/f9322fc2b09d43909b6cf1d9af1fd4c4~tplv-13w3uml6bg-resize:128:128.image?rk3s=2e2596fd&x-expires=1791638762&x-signature=qWXAQDZ7A1uUbERLe9BSCpaXHpc%3D',
  subtitle: '流光剪辑_剪映草稿助手(会员版):create_draft',
  description: '创建一个剪映草稿'
};

const COZE_CREATE_DRAFT_EXTERNAL_DATA = {
  icon: '`https://lf9-appstore-sign.oceancloudapi.com/ocean-cloud-tos/plugin_icon/332473957890636_1747190144847346721_ZtIC02VX5J.png?lk3s=cd508e2b&x-expires=1791639443&x-signature=hXnFhPi4f1BdMaWjzHSE4zSpjR8%3D`',
  apiName: 'create_draft',
  pluginID: '7579582015465340928',
  pluginProductStatus: 1,
  pluginProductUnlistType: 0,
  pluginType: 1,
  spaceID: '7579577910332457012',
  inputs: [
    { description: '封面图', input: {}, name: 'cover', required: false, type: 'string' },
    { defaultValue: 1920, description: '画布高度，像素值, default value is 1920', input: {}, name: 'height', required: false, type: 'integer' },
    { description: '草稿名称', input: {}, name: 'name', required: false, type: 'string' },
    { defaultValue: 1080, description: '画布宽度，像素值, default value is 1080', input: {}, name: 'width', required: false, type: 'integer' }
  ],
  outputs: [
    {
      input: {},
      name: 'output',
      required: false,
      schema: [
        { description: '草稿id，基于这个草稿继续编辑', input: {}, name: 'draft_id', required: false, type: 'string' },
        { description: '草稿链接，复制到浏览器里打开可以预览', input: {}, name: 'draft_url', required: false, type: 'string' }
      ],
      type: 'object'
    },
    { input: {}, name: 'purchase_link', required: false, type: 'string' },
    { input: {}, name: 'success', required: false, type: 'boolean' },
    { input: {}, name: 'error', required: false, type: 'string' }
  ],
  updateTime: 1788775427,
  channel_id: 2,
  commercial_setting: {},
  latestVersionTs: '0',
  latestVersionName: '',
  versionName: '',
  description: '创建一个剪映草稿',
  title: 'create_draft',
  mainColor: '#CA61FF'
};

const COZE_MODIFY_DRAFT_PLUGIN_META = {
  apiID: '7647446239436423204',
  apiName: 'modify_draft',
  pluginID: '7579582015465340928',
  pluginName: '流光剪辑_剪映草稿助手(会员版)',
  pluginVersion: '',
  tips: '',
  outDocLink: ''
};

const COZE_MODIFY_DRAFT_NODE_META = {
  title: 'modify_draft',
  icon: '`https://p3-flow-product-sign.byteimg.com/tos-cn-i-13w3uml6bg/f9322fc2b09d43909b6cf1d9af1fd4c4~tplv-13w3uml6bg-resize:128:128.image?rk3s=2e2596fd&x-expires=1791638762&x-signature=qWXAQDZ7A1uUbERLe9BSCpaXHpc%3D`',
  subtitle: '流光剪辑_剪映草稿助手(会员版):modify_draft',
  description: '修改已有草稿'
};

const COZE_MODIFY_DRAFT_EXTERNAL_DATA = {
  icon: '`https://lf26-appstore-sign.oceancloudapi.com/ocean-cloud-tos/plugin_icon/332473957890636_1747190144847346721_ZtIC02VX5J.png?lk3s=cd508e2b&x-expires=1791640107&x-signature=pEYSsx8omskxrL2vd2DIH8y2%2FWo%3D`',
  apiName: 'modify_draft',
  pluginID: '7579582015465340928',
  pluginProductStatus: 1,
  pluginProductUnlistType: 0,
  pluginType: 1,
  spaceID: '7579577910332457012',
  inputs: [
    { description: '草稿名', input: {}, name: 'name', required: false, type: 'string' },
    { description: '封面图', input: {}, name: 'cover', required: false, type: 'string' },
    { description: '草稿id', input: {}, name: 'draft_id', required: true, type: 'string' }
  ],
  outputs: [
    { input: {}, name: 'error', required: false, type: 'string' },
    {
      input: {},
      name: 'output',
      required: false,
      schema: [
        { input: {}, name: 'draft_url', required: false, type: 'string' },
        { input: {}, name: 'draft_id', required: false, type: 'string' }
      ],
      type: 'object'
    },
    { input: {}, name: 'purchase_link', required: false, type: 'string' },
    { input: {}, name: 'success', required: false, type: 'boolean' }
  ],
  updateTime: 1788775427,
  channel_id: 2,
  commercial_setting: {},
  latestVersionTs: '0',
  latestVersionName: '',
  versionName: '',
  description: '修改已有草稿',
  title: 'modify_draft',
  mainColor: '#CA61FF'
};

const COZE_ADD_TEXT_PLUGIN_META = {
  apiID: '7579582015465472000',
  apiName: 'add_text',
  pluginID: '7579582015465340928',
  pluginName: '流光剪辑_剪映草稿助手(会员版)',
  pluginVersion: '',
  tips: '',
  outDocLink: ''
};

const COZE_ADD_TEXT_NODE_META = {
  title: 'add_text',
  icon: '`https://p6-flow-product-sign.byteimg.com/tos-cn-i-13w3uml6bg/f9322fc2b09d43909b6cf1d9af1fd4c4~tplv-13w3uml6bg-resize:128:128.image?rk3s=2e2596fd&x-expires=1792118381&x-signature=s0yOYPrnva15unvuNjypf4tacwc%3D`',
  subtitle: '流光剪辑_剪映草稿助手(会员版):add_text',
  description: '添加文字'
};

const COZE_ADD_TEXT_EXTERNAL_DATA = {
  icon: '`https://lf9-appstore-sign.oceancloudapi.com/ocean-cloud-tos/plugin_icon/332473957890636_1747190144847346721_ZtIC02VX5J.png?lk3s=cd508e2b&x-expires=1792119479&x-signature=x5Gdzmeygetf0b6mMVtJB6N%2BrAI%3D`',
  apiName: 'add_text',
  pluginID: '7579582015465340928',
  pluginProductStatus: 1,
  pluginProductUnlistType: 0,
  pluginType: 1,
  spaceID: '7579577910332457012',
  inputs: [
    { description: '草稿id，可以继续编辑', input: {}, name: 'draft_id', required: false, type: 'string' },
    { description: '文本', input: {}, name: 'text', required: true, type: 'string' },
    { description: '开始时间', input: {}, name: 'start', required: true, type: 'float' },
    { description: '结束时间', input: {}, name: 'end', required: true, type: 'float' },
    { description: '字体', input: {}, name: 'font', required: false, type: 'string' },
    { description: '字体大小', input: {}, name: 'font_size', required: false, type: 'float' },
    { description: '字体颜色', input: {}, name: 'font_color', required: false, type: 'string' },
    { description: '字间距', input: {}, name: 'letter_spacing', required: false, type: 'float' },
    { description: '行间距', input: {}, name: 'line_spacing', required: false, type: 'float' },
    { description: '是否加粗', input: {}, name: 'bold', required: false, type: 'boolean' },
    { description: '是否斜体', input: {}, name: 'italic', required: false, type: 'boolean' },
    { description: '是否下划线', input: {}, name: 'underline', required: false, type: 'boolean' },
    { description: '是否竖排', input: {}, name: 'vertical', required: false, type: 'boolean' },
    { description: '对齐方式', input: {}, name: 'align', required: false, type: 'integer' },
    { description: 'X 方向缩放', input: {}, name: 'scale_x', required: false, type: 'float' },
    { description: 'Y 方向缩放', input: {}, name: 'scale_y', required: false, type: 'float' },
    { description: 'X 方向像素位移', input: {}, name: 'transform_x_px', required: false, type: 'integer' },
    { description: 'Y 方向像素位移', input: {}, name: 'transform_y_px', required: false, type: 'integer' },
    { description: '固定宽度像素值', input: {}, name: 'fixed_width_px', required: false, type: 'integer' },
    { description: '固定高度像素值', input: {}, name: 'fixed_height_px', required: false, type: 'integer' },
    { description: '旋转角度', input: {}, name: 'rotation', required: false, type: 'float' },
    { description: '轨道名', input: {}, name: 'track_name', required: false, type: 'string' },
    { description: '轨道层级', input: {}, name: 'relative_index', required: false, type: 'integer' }
  ],
  outputs: [
    { input: {}, name: 'success', required: false, type: 'boolean' },
    { input: {}, name: 'error', required: false, type: 'string' },
    {
      input: {},
      name: 'output',
      required: false,
      schema: [
        { description: '草稿id，可以继续编辑', input: {}, name: 'draft_id', required: false, type: 'string' },
        { description: '草稿链接，在浏览器里打开可以预览', input: {}, name: 'draft_url', required: false, type: 'string' }
      ],
      type: 'object'
    },
    { input: {}, name: 'purchase_link', required: false, type: 'string' }
  ],
  updateTime: 1789520259,
  channel_id: 2,
  commercial_setting: {},
  latestVersionTs: '0',
  latestVersionName: '',
  versionName: '',
  description: '添加文字',
  title: 'add_text',
  mainColor: '#CA61FF'
};

const COZE_ADD_PRESET_PLUGIN_META = {
  apiID: '7579582015465422848',
  apiName: 'add_preset',
  pluginID: '7579582015465340928',
  pluginName: '流光剪辑_剪映草稿助手(会员版)',
  pluginVersion: '',
  tips: '',
  outDocLink: '',
  pluginAuthMode: 0
};

const COZE_ADD_PRESET_NODE_META = {
  title: 'add_preset',
  icon: '`https://p9-flow-product-sign.byteimg.com/tos-cn-i-13w3uml6bg/dc54eb2e65d4419aaf6461c015d52b31~tplv-13w3uml6bg-resize:128:128.image?rk3s=2e2596fd&x-expires=1792934308&x-signature=AUg6DYALXGrBgIgvRAn82zVVS0g%3D`',
  subtitle: '流光剪辑_剪映草稿助手(会员版):add_preset',
  description: '添加剪映的模版/预设片段。需要提前在剪映里编辑好，然后上传到后台，并获取到preset_id'
};

const COZE_ADD_PRESET_EXTERNAL_DATA = {
  icon: '`https://lf3-appstore-sign.oceancloudapi.com/ocean-cloud-tos/plugin_icon/332473957890636_1747190144847346721_ZtIC02VX5J.png?lk3s=cd508e2b&x-expires=1792934311&x-signature=JVMggZpBDPNMHoyAHGVA2qVrLrY%3D`',
  apiName: 'add_preset',
  pluginID: '7579582015465340928',
  pluginProductStatus: 1,
  pluginProductUnlistType: 0,
  pluginType: 1,
  spaceID: '7579577910332457012',
  inputs: [
    { description: '水平偏移，像素值', input: {}, name: 'transform_x_px', required: false, type: 'float' },
    { description: '垂直偏移，相对值。0表示位于中心，垂直移动像素 = transform_y * 视频高度', input: {}, name: 'transform_y', required: false, type: 'float' },
    { description: '画布高度', input: {}, name: 'height', required: false, type: 'integer' },
    { defaultValue: 'b795a680-a581-4965-84b1-9e9ad313b522', description: '预设片段id, default value is b795a680-a581-4965-84b1-9e9ad313b522', input: {}, name: 'preset_id', required: true, type: 'string' },
    { description: '替换元素', input: {}, name: 'replacements', required: false, schema: { assistType: 0, type: 'string' }, type: 'list' },
    { description: '旋转角度', input: {}, name: 'rotation', required: false, type: 'float' },
    { description: '原始片段截取开始时间', input: {}, name: 'start', required: false, type: 'float' },
    { description: '目标轨道的开始时间', input: {}, name: 'target_start', required: false, type: 'float' },
    { description: '轨道名，默认preset_track', input: {}, name: 'track_name', required: false, type: 'string' },
    { description: '垂直偏移，像素值', input: {}, name: 'transform_y_px', required: false, type: 'float' },
    { description: '草稿id，不填默认创建新草稿', input: {}, name: 'draft_id', required: false, type: 'string' },
    { description: '入场动画，和add_video一致', input: {}, name: 'intro_animation', required: false, type: 'string' },
    { description: '出场动画持续时间', input: {}, name: 'outro_animation_duration', required: false, type: 'float' },
    { description: '相对轨道位置，越大越靠上', input: {}, name: 'relative_index', required: false, type: 'integer' },
    { description: '水平方向缩放', input: {}, name: 'scale_x', required: false, type: 'float' },
    { description: '垂直方向缩放', input: {}, name: 'scale_y', required: false, type: 'float' },
    { description: '原始片段截取结束时间', input: {}, name: 'end', required: false, type: 'float' },
    { description: '水平偏移，相对值。0表示位于中心，水平移动像素 = transform_x * 草稿宽度', input: {}, name: 'transform_x', required: false, type: 'float' },
    { description: '入场动画持续时间', input: {}, name: 'intro_animation_duration', required: false, type: 'float' },
    { description: '出场动画，和add_video一致', input: {}, name: 'outro_animation', required: false, type: 'string' },
    { description: '转场动画，和add_video一致', input: {}, name: 'transition', required: false, type: 'string' },
    { description: '转场动画持续时间', input: {}, name: 'transition_duration', required: false, type: 'float' },
    { description: '画布宽度', input: {}, name: 'width', required: false, type: 'integer' }
  ],
  outputs: [
    { input: {}, name: 'error', required: false, type: 'string' },
    {
      input: {},
      name: 'output',
      required: false,
      schema: [
        { description: '草稿id, 可以继续编辑', input: {}, name: 'draft_id', required: false, type: 'string' },
        { description: '草稿链接，复制到浏览器里可以打开预览', input: {}, name: 'draft_url', required: false, type: 'string' }
      ],
      type: 'object'
    },
    { input: {}, name: 'purchase_link', required: false, type: 'string' },
    { input: {}, name: 'success', required: false, type: 'boolean' }
  ],
  updateTime: 1790232153,
  channel_id: 2,
  commercial_setting: {},
  latestVersionTs: '0',
  latestVersionName: '',
  versionName: '',
  description: '添加剪映的模版/预设片段。需要提前在剪映里编辑好，然后上传到后台，并获取到preset_id',
  title: 'add_preset',
  mainColor: '#CA61FF'
};

const COZE_GENERATE_SPEECH_PLUGIN_META = {
  apiID: '7579582015465603072',
  apiName: 'generate_speech',
  pluginID: '7579582015465340928',
  pluginName: '流光剪辑_剪映草稿助手(会员版)',
  pluginVersion: '',
  tips: '',
  outDocLink: '',
  pluginAuthMode: 0
};

const COZE_GENERATE_SPEECH_NODE_META = {
  title: 'generate_speech',
  icon: '`https://p26-flow-product-sign.byteimg.com/tos-cn-i-13w3uml6bg/dc54eb2e65d4419aaf6461c015d52b31~tplv-13w3uml6bg-resize:128:128.image?rk3s=2e2596fd&x-expires=1792725944&x-signature=77%2FPKhfB5c66v1YsGG%2FF3wbCCFo%3D`',
  subtitle: '流光剪辑_剪映草稿助手(会员版):generate_speech',
  description: '语音合成聚合接口。目前支持微软/豆包/minimax的语音合成接口。可以把生成的音频直接添加到草稿里。'
};

const COZE_GENERATE_SPEECH_EXTERNAL_DATA = {
  icon: '`https://lf26-appstore-sign.oceancloudapi.com/ocean-cloud-tos/plugin_icon/332473957890636_1747190144847346721_ZtIC02VX5J.png?lk3s=cd508e2b&x-expires=1792726527&x-signature=J3d1cpzHsz7vl9z8is329xA0%2FXk%3D`',
  apiName: 'generate_speech',
  pluginID: '7579582015465340928',
  pluginProductStatus: 1,
  pluginProductUnlistType: 0,
  pluginType: 1,
  spaceID: '7579577910332457012',
  inputs: [
    { description: '音效类型', input: {}, name: 'effect_type', required: false, type: 'string' },
    { description: '视频高度（默认1920）', input: {}, name: 'height', required: false, type: 'integer' },
    { defaultValue: 'azure', description: '厂商。可选：azure, volc, minimax。', input: {}, name: 'provider', required: true, type: 'string' },
    { description: '音频素材的结束截取时间（秒，可选，默认取完整音频长度）', input: {}, name: 'end', required: false, type: 'float' },
    { description: '淡入时间，单位秒', input: {}, name: 'fade_in_duration', required: false, type: 'float' },
    { description: '配音语速，可选范围[0.7,1.3]，大于1表示加速', input: {}, name: 'speech_speed', required: false, type: 'float' },
    { description: '音频在时间线上的起始位置（秒，默认0）', input: {}, name: 'target_start', required: false, type: 'float' },
    { description: '音量（选填，单位db，默认0.0，-100表示静音）', input: {}, name: 'volume', required: false, type: 'float' },
    { description: '视频宽度（默认1080）', input: {}, name: 'width', required: false, type: 'integer' },
    { description: '模型，部分厂商支持多种模型。', input: {}, name: 'model', required: false, type: 'string' },
    { defaultValue: 'audio_speech', description: '轨道名，默认audio_speech', input: {}, name: 'track_name', required: false, type: 'string' },
    { defaultValue: 'zh-CN-XiaoxiaoNeural', description: '音色id，注意选择不同厂商，不同模型，支持的音色id不同，不能互通。', input: {}, name: 'voice_id', required: true, type: 'string' },
    { defaultValue: '你好，今天给大家带来一个福利', description: '文案', input: {}, name: 'text', required: true, type: 'string' },
    { description: '草稿id，基于已有草稿继续编辑，为空则创建新草稿', input: {}, name: 'draft_id', required: false, type: 'string' },
    { description: '音效参数（可选，根据effect_type设置）', input: {}, name: 'effect_params', required: false, schema: { type: 'integer' }, type: 'list' },
    { description: '淡出时间，单位秒', input: {}, name: 'fade_out_duration', required: false, type: 'float' },
    { description: '只生成音频,没有草稿', input: {}, name: 'only_tts', required: false, type: 'boolean' },
    { description: '音频速度（默认1.0，>1加速，<1减速）', input: {}, name: 'speed', required: false, type: 'float' },
    { description: '音频素材的起始截取时间（秒，默认0）', input: {}, name: 'start', required: false, type: 'float' }
  ],
  outputs: [
    { type: 'string', name: 'purchase_link', required: false },
    { type: 'boolean', name: 'success', required: false },
    { type: 'string', name: 'error', required: false },
    {
      type: 'object',
      name: 'output',
      schema: [
        { type: 'string', name: 'draft_id', required: false },
        { type: 'string', name: 'draft_url', required: false },
        { type: 'string', name: 'audio_url', required: false }
      ],
      required: false
    }
  ],
  updateTime: 1790093279,
  channel_id: 2,
  commercial_setting: {},
  latestVersionTs: '0',
  latestVersionName: '',
  versionName: '',
  description: '语音合成聚合接口。目前支持微软/豆包/minimax的语音合成接口。可以把生成的音频直接添加到草稿里。',
  title: 'generate_speech',
  mainColor: '#CA61FF'
};

const COZE_GENERATE_AI_VIDEO_PLUGIN_META = {
  apiID: '7594008880368304143',
  apiName: 'generate_ai_video',
  pluginID: '7579582015465340928',
  pluginName: '流光剪辑_剪映草稿助手(会员版)',
  pluginVersion: '',
  tips: '',
  outDocLink: '',
  pluginAuthMode: 0
};

const COZE_GENERATE_AI_VIDEO_NODE_META = {
  title: 'generate_ai_video',
  icon: 'https://p6-flow-product-sign.byteimg.com/tos-cn-i-13w3uml6bg/dc54eb2e65d4419aaf6461c015d52b31~tplv-13w3uml6bg-resize:128:128.image?rk3s=2e2596fd&x-expires=1793346809&x-signature=bePUSpxfuxBBs0c7htWwEpDAHmM%3D',
  subtitle: '流光剪辑_剪映草稿助手(会员版):generate_ai_video',
  description: 'AI视频生成聚合接口，集成了常见的AI视频生成模型。异步接口，发起任务后，用ai_video_task_status查询任务结果。'
};

const COZE_GENERATE_AI_VIDEO_EXTERNAL_DATA = {
  icon: 'https://lf3-appstore-sign.oceancloudapi.com/ocean-cloud-tos/plugin_icon/332473957890636_1747190144847346721_ZtIC02VX5J.png?lk3s=cd508e2b&x-expires=1793347727&x-signature=r6xW8Q3f1xK6ua0dzhoZUaATIzQ%3D',
  apiName: 'generate_ai_video',
  pluginID: '7579582015465340928',
  pluginProductStatus: 1,
  pluginProductUnlistType: 0,
  pluginType: 1,
  spaceID: '7579577910332457012',
  inputs: [
    { description: '提示词', input: {}, name: 'prompt', required: true, type: 'string' },
    { defaultValue: 'veo3.1', description: '模型', input: {}, name: 'model', required: true, type: 'string' },
    { description: '分辨率，例如1080x1920', input: {}, name: 'resolution', required: true, type: 'string' },
    { description: 'AI生成视频的时长', input: {}, name: 'gen_duration', required: false, type: 'integer' },
    { description: '是否生成同步音频', input: {}, name: 'generate_audio', required: false, type: 'boolean' },
    { description: '是否开启超分', input: {}, name: 'super_resolve', required: false, type: 'boolean' },
    { description: '是否开启闲时seedance生成', input: {}, name: 'enable_seedance_offline', required: false, type: 'boolean' },
    { description: 'seedance2.0兼容字段，用来做多模态参考输入', input: {}, name: 'content', required: false, type: 'string' }
  ],
  outputs: [
    { type: 'string', name: 'status', required: false },
    { type: 'string', name: 'task_id', required: false }
  ],
  updateTime: 1790737041,
  channel_id: 2,
  commercial_setting: {},
  latestVersionTs: '0',
  latestVersionName: '',
  versionName: '',
  description: 'AI视频生成聚合接口，集成了常见的AI视频生成模型。异步接口，发起任务后，用ai_video_task_status查询任务结果。',
  title: 'generate_ai_video',
  mainColor: '#CA61FF'
};

const COZE_AI_VIDEO_STATUS_PLUGIN_META = {
  apiID: '7594008880368320527',
  apiName: 'ai_video_task_status',
  pluginID: '7579582015465340928',
  pluginName: '流光剪辑_剪映草稿助手(会员版)',
  pluginVersion: '',
  tips: '',
  outDocLink: '',
  pluginAuthMode: 0
};

const COZE_AI_VIDEO_STATUS_NODE_META = {
  title: 'ai_video_task_status',
  icon: 'https://p6-flow-product-sign.byteimg.com/tos-cn-i-13w3uml6bg/dc54eb2e65d4419aaf6461c015d52b31~tplv-13w3uml6bg-resize:128:128.image?rk3s=2e2596fd&x-expires=1793346809&x-signature=bePUSpxfuxBBs0c7htWwEpDAHmM%3D',
  subtitle: '流光剪辑_剪映草稿助手(会员版):ai_video_task_status',
  description: '查询AI视频生成聚合接口的生成状态\n'
};

const COZE_AI_VIDEO_STATUS_EXTERNAL_DATA = {
  icon: 'https://lf3-appstore-sign.oceancloudapi.com/ocean-cloud-tos/plugin_icon/332473957890636_1747190144847346721_ZtIC02VX5J.png?lk3s=cd508e2b&x-expires=1793347758&x-signature=9QqaniVNszxZE7HMq3qGiuhcYw8%3D',
  apiName: 'ai_video_task_status',
  pluginID: '7579582015465340928',
  pluginProductStatus: 1,
  pluginProductUnlistType: 0,
  pluginType: 1,
  spaceID: '7579577910332457012',
  inputs: [
    { description: '任务id', input: {}, name: 'task_id', required: true, type: 'string' }
  ],
  outputs: [
    { input: {}, name: 'progress', required: false, type: 'float' },
    { input: {}, name: 'draft_error', required: false, type: 'string' },
    { input: {}, name: 'draft_id', required: false, type: 'string' },
    { input: {}, name: 'id', required: false, type: 'string' },
    { input: {}, name: 'message', required: false, type: 'string' },
    { input: {}, name: 'draft_url', required: false, type: 'string' },
    { input: {}, name: 'status', required: false, type: 'string' },
    { input: {}, name: 'video_url', required: false, type: 'string' }
  ],
  updateTime: 1790737041,
  channel_id: 2,
  commercial_setting: {},
  latestVersionTs: '0',
  latestVersionName: '',
  versionName: '',
  description: '查询AI视频生成聚合接口的生成状态\n',
  title: 'ai_video_task_status',
  mainColor: '#CA61FF'
};

const COZE_GENERATE_IMAGE_PLUGIN_META = {
  apiID: '7629747589998739475',
  apiName: 'generate_image_sync',
  pluginID: '7579582015465340928',
  pluginName: '流光剪辑_剪映草稿助手(会员版)',
  pluginVersion: '',
  tips: '',
  outDocLink: '',
  pluginAuthMode: 0
};

const COZE_GENERATE_IMAGE_NODE_META = {
  title: 'generate_image_sync',
  icon: 'https://p3-flow-product-sign.byteimg.com/tos-cn-i-13w3uml6bg/dc54eb2e65d4419aaf6461c015d52b31~tplv-13w3uml6bg-resize:128:128.image?rk3s=2e2596fd&x-expires=1795071933&x-signature=%2BQHrA2JOU2Kgrlh7suOyUkL%2BXXY%3D',
  subtitle: '流光剪辑_剪映草稿助手(会员版):generate_image_sync',
  description: '提交异步生图任务\n'
};

const COZE_GENERATE_IMAGE_EXTERNAL_DATA = {
  icon: 'https://lf9-appstore-sign.oceancloudapi.com/ocean-cloud-tos/plugin_icon/332473957890636_1747190144847346721_ZtIC02VX5J.png?lk3s=cd508e2b&x-expires=1795072745&x-signature=%2BMbGS743hdjAXJnJFQqCaLMtgms%3D',
  apiName: 'generate_image_sync',
  pluginID: '7579582015465340928',
  pluginProductStatus: 1,
  pluginProductUnlistType: 0,
  pluginType: 1,
  spaceID: '7579577910332457012',
  inputs: [
    { description: '提示词', input: {}, name: 'prompt', required: true, type: 'string' },
    { description: '选择一个模型，从这里查看https://www.coze.cn/store/project/7580292052165443618?entity_id=1', input: {}, name: 'model', required: true, type: 'string' },
    { description: '分辨率，不同模型支持的分辨率不同，注意查看文档。默认1024x1024', input: {}, name: 'size', required: true, type: 'string' },
    { description: '是否将生成的图片添加进草稿，默认true。', input: {}, name: 'compose_draft', required: false, type: 'boolean' },
    { description: '参考图片url', input: {}, name: 'reference_image', required: false, type: 'string' },
    { description: '多图参考', input: {}, name: 'reference_images', required: false, schema: { assistType: 0, type: 'string' }, type: 'list' },
    { description: '目标草稿的草稿id，如果不提供，或者云端不存在，则会自动创建一个新的草稿', input: {}, name: 'draft_id', required: false, type: 'string' },
    { description: '添加的轨道名称，默认image_main。设置为main则位于主轨道', input: {}, name: 'track_name', required: false, type: 'string' },
    { description: '在目标轨道上的开始时间，单位秒，默认0', input: {}, name: 'start', required: false, type: 'float' },
    { description: '在目标轨道上的结束时间，单位秒', input: {}, name: 'end', required: false, type: 'float' }
  ],
  outputs: [
    { input: {}, name: 'queue_name', required: false, type: 'string' },
    { input: {}, name: 'status', required: false, type: 'string' },
    { input: {}, name: 'success', required: false, type: 'boolean' },
    { description: '任务ID', input: {}, name: 'task_id', required: false, type: 'string' },
    { input: {}, name: 'error', required: false, type: 'string' },
    { input: {}, name: 'message_id', required: false, type: 'string' }
  ],
  updateTime: 1792400491,
  channel_id: 2,
  commercial_setting: {},
  latestVersionTs: '0',
  latestVersionName: '',
  versionName: '',
  description: '提交异步生图任务\n',
  title: 'generate_image_sync',
  mainColor: '#CA61FF'
};

const COZE_IMAGE_STATUS_PLUGIN_META = {
  apiID: '7629747589998755859',
  apiName: 'generate_image_task_status',
  pluginID: '7579582015465340928',
  pluginName: '流光剪辑_剪映草稿助手(会员版)',
  pluginVersion: '',
  tips: '',
  outDocLink: '',
  pluginAuthMode: 0
};

const COZE_IMAGE_STATUS_NODE_META = {
  title: 'generate_image_task_status',
  icon: COZE_GENERATE_IMAGE_NODE_META.icon,
  subtitle: '流光剪辑_剪映草稿助手(会员版):generate_image_task_status',
  description: '查看异步生成图片任务的状态'
};

const COZE_IMAGE_STATUS_EXTERNAL_DATA = {
  icon: 'https://lf6-appstore-sign.oceancloudapi.com/ocean-cloud-tos/plugin_icon/332473957890636_1747190144847346721_ZtIC02VX5J.png?lk3s=cd508e2b&x-expires=1795072791&x-signature=%2F8dTFoFTmrw2RkNr0wLHfX9gyBs%3D',
  apiName: 'generate_image_task_status',
  pluginID: '7579582015465340928',
  pluginProductStatus: 1,
  pluginProductUnlistType: 0,
  pluginType: 1,
  spaceID: '7579577910332457012',
  inputs: [
    { description: '任务id', input: {}, name: 'task_id', required: true, type: 'string' }
  ],
  outputs: [
    { input: {}, name: 'error', required: false, type: 'string' },
    { input: {}, name: 'message', required: false, type: 'string' },
    { input: {}, name: 'progress', required: false, type: 'float' },
    { input: {}, name: 'status', required: false, type: 'string' },
    { input: {}, name: 'task_id', required: false, type: 'string' },
    { input: {}, name: 'id', required: false, type: 'string' },
    { input: {}, name: 'model', required: false, type: 'string' },
    { input: {}, name: 'prompt', required: false, type: 'string' },
    {
      input: {},
      name: 'result',
      required: false,
      schema: [
        { input: {}, name: 'error', required: false, type: 'string' },
        { input: {}, name: 'image', required: false, type: 'string' },
        { input: {}, name: 'purchase_link', required: false, type: 'string' },
        { input: {}, name: 'reused_from_history', required: false, type: 'boolean' },
        { input: {}, name: 'draft_id', required: false, type: 'string' },
        { input: {}, name: 'draft_url', required: false, type: 'string' }
      ],
      type: 'object'
    },
    { input: {}, name: 'success', required: false, type: 'boolean' }
  ],
  updateTime: 1792400491,
  channel_id: 2,
  commercial_setting: {},
  latestVersionTs: '0',
  latestVersionName: '',
  versionName: '',
  description: '查看异步生成图片任务的状态',
  title: 'generate_image_task_status',
  mainColor: '#CA61FF'
};

const COZE_CREATE_DIGITAL_HUMAN_PLUGIN_META = {
  apiID: '7594783961818349611',
  apiName: 'create_digital_human',
  pluginID: '7579582015465340928',
  pluginName: '流光剪辑_剪映草稿助手(会员版)',
  pluginVersion: '',
  tips: '',
  outDocLink: ''
};

const COZE_CREATE_DIGITAL_HUMAN_NODE_META = {
  title: 'create_digital_human',
  icon: '`https://p26-flow-product-sign.byteimg.com/tos-cn-i-13w3uml6bg/dc54eb2e65d4419aaf6461c015d52b31~tplv-13w3uml6bg-resize:128:128.image?rk3s=2e2596fd&x-expires=1794046330&x-signature=A6H7FBhjrZvTJUaId3%2FlYW8AvQc%3D`',
  subtitle: '流光剪辑_剪映草稿助手(会员版):create_digital_human',
  description: '创建数字人，音频驱动的对口型策略\n'
};

const COZE_CREATE_DIGITAL_HUMAN_EXTERNAL_DATA = {
  icon: '`https://lf3-appstore-sign.oceancloudapi.com/ocean-cloud-tos/plugin_icon/332473957890636_1747190144847346721_ZtIC02VX5J.png?lk3s=cd508e2b&x-expires=1794046550&x-signature=6zbXyFskxf84GN%2B5lcLQBT1fNHw%3D`',
  apiName: 'create_digital_human',
  pluginID: '7579582015465340928',
  pluginProductStatus: 1,
  pluginProductUnlistType: 0,
  pluginType: 1,
  spaceID: '7579577910332457012',
  inputs: [
    { description: '音频链接', input: {}, name: 'audio_url', required: true, type: 'string' },
    { description: '视频链接', input: {}, name: 'video_url', required: true, type: 'string' }
  ],
  outputs: [
    { input: {}, name: 'message', required: false, type: 'string' },
    { input: {}, name: 'task_id', required: false, type: 'string' }
  ],
  updateTime: 1790737041,
  channel_id: 2,
  commercial_setting: {},
  latestVersionTs: '0',
  latestVersionName: '',
  versionName: '',
  description: '创建数字人，音频驱动的对口型策略\n',
  title: 'create_digital_human',
  mainColor: '#CA61FF'
};

const COZE_DIGITAL_HUMAN_STATUS_PLUGIN_META = {
  apiID: '7594783961818365995',
  apiName: 'digital_human_task_status',
  pluginID: '7579582015465340928',
  pluginName: '流光剪辑_剪映草稿助手(会员版)',
  pluginVersion: '',
  tips: '',
  outDocLink: ''
};

const COZE_DIGITAL_HUMAN_STATUS_NODE_META = {
  title: 'digital_human_task_status',
  icon: '`https://p26-flow-product-sign.byteimg.com/tos-cn-i-13w3uml6bg/dc54eb2e65d4419aaf6461c015d52b31~tplv-13w3uml6bg-resize:128:128.image?rk3s=2e2596fd&x-expires=1794046330&x-signature=A6H7FBhjrZvTJUaId3%2FlYW8AvQc%3D`',
  subtitle: '流光剪辑_剪映草稿助手(会员版):digital_human_task_status',
  description: '查看数字人生成状态\n'
};

const COZE_DIGITAL_HUMAN_STATUS_EXTERNAL_DATA = {
  icon: '`https://lf9-appstore-sign.oceancloudapi.com/ocean-cloud-tos/plugin_icon/332473957890636_1747190144847346721_ZtIC02VX5J.png?lk3s=cd508e2b&x-expires=1794069746&x-signature=VQ8Sstvshz3LZMlpLkS6eoJmH9g%3D`',
  apiName: 'digital_human_task_status',
  pluginID: '7579582015465340928',
  pluginProductStatus: 1,
  pluginProductUnlistType: 0,
  pluginType: 1,
  spaceID: '7579577910332457012',
  inputs: [
    { description: '任务id', input: {}, name: 'task_id', required: true, type: 'string' }
  ],
  outputs: [
    { input: {}, name: 'digital_human_url', required: false, type: 'string' },
    { input: {}, name: 'message', required: false, type: 'string' }
  ],
  updateTime: 1790737041,
  channel_id: 2,
  commercial_setting: {},
  latestVersionTs: '0',
  latestVersionName: '',
  versionName: '',
  description: '查看数字人生成状态\n',
  title: 'digital_human_task_status',
  mainColor: '#CA61FF'
};

const COZE_TIME_DELAY_PLUGIN_META = {
  apiID: '7492383327479988233',
  apiName: 'time_delay',
  pluginID: '7492383327479971849',
  pluginName: '时间延迟',
  pluginVersion: '',
  tips: '',
  outDocLink: ''
};

const COZE_TIME_DELAY_NODE_META = {
  title: 'time_delay_1',
  icon: 'https://p3-flow-product-sign.byteimg.com/tos-cn-i-13w3uml6bg/de96ea4cda1b4deebe35069a9f9e1370~tplv-13w3uml6bg-resize:128:128.image?rk3s=2e2596fd&x-expires=1774753320&x-signature=pKqYGF2YcR4VQ6rWn6xs8%2Fyb19M%3D',
  subtitle: '时间延迟:time_delay',
  description: '时间延迟插件，以秒为单位。支持时长0-59秒。'
};

const COZE_TIME_DELAY_EXTERNAL_DATA = {
  icon: 'https://lf26-appstore-sign.oceancloudapi.com/ocean-cloud-tos/plugin_icon/1986185754052569_1743861713842683049_xXHJg8NwwV.jpg?lk3s=cd508e2b&x-expires=1793347727&x-signature=r5cNmIeR6QgI9cCEcOtm8U4OZ1E%3D',
  apiName: 'time_delay',
  pluginID: '7492383327479971849',
  pluginProductStatus: 1,
  pluginProductUnlistType: 0,
  pluginType: 1,
  spaceID: '7480062106935951360',
  inputs: [
    { description: '延迟秒数', input: {}, name: 'seconds', required: true, type: 'integer' }
  ],
  outputs: [
    { description: '提示信息', input: {}, name: 'message', required: true, type: 'string' },
    { description: '延迟秒数', input: {}, name: 'seconds', required: false, type: 'integer' }
  ],
  updateTime: 1787217009,
  channel_id: 2,
  commercial_setting: {},
  latestVersionTs: '0',
  latestVersionName: '',
  versionName: '',
  description: '时间延迟插件，以秒为单位。支持时长0-59秒。',
  title: 'time_delay',
  mainColor: '#CA61FF'
};

const COZE_LOOP_NODE_META = {
  title: '循环_1',
  icon: 'https://lf3-static.bytednsdoc.com/obj/eden-cn/dvsmryvd_avi_dvsm/ljhwZthlaukjlkulzlp/icon/icon-Loop-v2.jpg',
  description: '用于通过设定循环次数和逻辑，重复执行一系列任务',
  mainColor: '#00B2B2',
  subTitle: '循环'
};

const COZE_CONDITION_NODE_META = {
  title: '选择器',
  icon: 'https://lf3-static.bytednsdoc.com/obj/eden-cn/dvsmryvd_avi_dvsm/ljhwZthlaukjlkulzlp/icon/icon-Condition-v2.jpg',
  description: '连接多个下游分支，若设定的条件成立则仅运行对应的分支，若均不成立则只运行“否则”分支',
  mainColor: '#00B2B2',
  subTitle: '选择器'
};

const COZE_LOOP_SET_VARIABLE_NODE_META = {
  title: '设置变量',
  icon: 'https://lf3-static.bytednsdoc.com/obj/eden-cn/dvsmryvd_avi_dvsm/ljhwZthlaukjlkulzlp/icon/icon-LoopSetVariable-v2.jpg',
  description: '用于重置循环变量的值，使其下次循环使用重置后的值',
  mainColor: '#00B2B2',
  subTitle: '设置变量'
};

const COZE_ADD_AUDIO_PLUGIN_META = {
  apiID: '7579582015465357312',
  apiName: 'add_audio',
  pluginID: '7579582015465340928',
  pluginName: '流光剪辑_剪映草稿助手(会员版)',
  pluginVersion: '',
  tips: '',
  outDocLink: '',
  pluginAuthMode: 0
};

const COZE_ADD_AUDIO_NODE_META = {
  title: 'add_audio',
  icon: '`https://p9-flow-product-sign.byteimg.com/tos-cn-i-13w3uml6bg/dc54eb2e65d4419aaf6461c015d52b31~tplv-13w3uml6bg-resize:128:128.image?rk3s=2e2596fd&x-expires=1793282304&x-signature=kH9xAsizQQtRwg7H%2BmnQMxYpD6A%3D`',
  subtitle: '流光剪辑_剪映草稿助手(会员版):add_audio',
  description: '添加音频'
};

const COZE_ADD_AUDIO_EXTERNAL_DATA = {
  icon: '`https://lf3-appstore-sign.oceancloudapi.com/ocean-cloud-tos/plugin_icon/332473957890636_1747190144847346721_ZtIC02VX5J.png?lk3s=cd508e2b&x-expires=1793283278&x-signature=VF3umFwv42cMO5FZ84zVfI%2FvN0M%3D`',
  apiName: 'add_audio',
  pluginID: '7579582015465340928',
  pluginProductStatus: 1,
  pluginProductUnlistType: 0,
  pluginType: 1,
  spaceID: '7579577910332457012',
  inputs: [
    { defaultValue: '`https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20240830/dzkngm/%E9%BE%99%E5%A9%89.mp3`', description: '音频链接，和music_id二选一', input: {}, name: 'audio_url', required: false, type: 'string' },
    { description: '剪映音乐/音效素材ID，和audio_url二选一', input: {}, name: 'music_id', required: false, type: 'string' },
    { description: '目标轨道开始时间', input: {}, name: 'target_start', required: false, type: 'float' },
    { description: '原始素材的时长，单位秒，精确到小数点后6位。正确设置可以提升运行速度，但是设置错误可能带来不可预知的错误。', input: {}, name: 'duration', required: false, type: 'float' },
    { description: '淡入时间，单位秒', input: {}, name: 'fade_in_duration', required: false, type: 'float' },
    { description: '轨道名称，默认audio_main', input: {}, name: 'track_name', required: false, type: 'string' },
    { description: '草稿宽度', input: {}, name: 'width', required: false, type: 'integer' },
    { description: '如果想基于已有的草稿继续编辑，这里填上次的草稿id', input: {}, name: 'draft_id', required: false, type: 'string' },
    { description: '音效，用get_audio_effect_types工具查看支持的音效', input: {}, name: 'effect_type', required: false, type: 'string' },
    { description: '截取原始素材结束时间', input: {}, name: 'end', required: false, type: 'float' },
    { description: '草稿高度', input: {}, name: 'height', required: false, type: 'integer' },
    { defaultValue: 0, description: '截取原始素材开始时间。注意！不是在目标轨道的开始时间，在目标轨道的开始时间使用target_start', input: {}, name: 'start', required: false, type: 'float' },
    { description: '音效参数列表', input: {}, name: 'effect_params', required: false, schema: { type: 'float' }, type: 'list' },
    { description: '淡出时间，单位秒', input: {}, name: 'fade_out_duration', required: false, type: 'float' },
    { defaultValue: 1, description: '音频速度（默认1.0，>1加速，<1减速）', input: {}, name: 'speed', required: false, type: 'float' },
    { defaultValue: 0, description: '音量，单位db。默认0，小于-60表示静音', input: {}, name: 'volume', required: false, type: 'float' }
  ],
  outputs: [
    { type: 'string', name: 'error', required: false },
    {
      type: 'object',
      name: 'output',
      schema: [
        { type: 'string', name: 'draft_id', required: false, description: '草稿id，可以继续编辑' },
        { type: 'string', name: 'draft_url', required: false, description: '草稿链接，复制到浏览器里打开可以预览' }
      ],
      required: false
    },
    { type: 'string', name: 'purchase_link', required: false },
    { type: 'boolean', name: 'success', required: false }
  ],
  updateTime: 1790611026,
  channel_id: 2,
  commercial_setting: {},
  latestVersionTs: '0',
  latestVersionName: '',
  versionName: '',
  description: '添加音频',
  title: 'add_audio',
  mainColor: '#CA61FF'
};

const COZE_ADD_IMAGE_PLUGIN_META = {
  apiID: '7579582015465406464',
  apiName: 'add_image',
  pluginID: '7579582015465340928',
  pluginName: '流光剪辑_剪映草稿助手(会员版)',
  pluginVersion: '',
  tips: '',
  outDocLink: '',
  pluginAuthMode: 0
};

const COZE_ADD_IMAGE_NODE_META = {
  title: 'add_image',
  icon: '`https://p26-flow-product-sign.byteimg.com/tos-cn-i-13w3uml6bg/3737d249215d4ba9b7b60668366eb4c9~tplv-13w3uml6bg-resize:128:128.image?rk3s=2e2596fd&x-expires=1795093969&x-signature=NsKJQSHv%2Fnrij0lAWHIwZOlwBcI%3D`',
  subtitle: '流光剪辑_剪映草稿助手(会员版):add_image',
  description: '向草稿中添加图片'
};

const COZE_ADD_IMAGE_EXTERNAL_DATA = {
  icon: '`https://lf3-appstore-sign.oceancloudapi.com/ocean-cloud-tos/plugin_icon/332473957890636_1747190144847346721_ZtIC02VX5J.png?lk3s=cd508e2b&x-expires=1795095167&x-signature=sNd1tJhV0WspzYSRuT2i%2FnAQivg%3D`',
  apiName: 'add_image',
  pluginID: '7579582015465340928',
  pluginProductStatus: 1,
  pluginProductUnlistType: 0,
  pluginType: 1,
  spaceID: '7579577910332457012',
  inputs: [
    { defaultValue: '`https://cdn.wanx.aliyuncs.com/wanx/1719234057367822001/text_to_image_v2/d6e33c84d7554146a25b1093b012838b_0.png`', description: '图片链接', input: {}, name: 'image_url', required: true, type: 'string' },
    { defaultValue: 0, description: '开始时间，单位秒', input: {}, name: 'start', required: true, type: 'float' },
    { defaultValue: 3, description: '结束时间，单位秒', input: {}, name: 'end', required: true, type: 'float' },
    { description: '如果想基于已有的草稿继续编辑，这里填上次的草稿id，否则将创建新草稿', input: {}, name: 'draft_id', required: false, type: 'string' },
    { description: '轨道名称，默认image_main。设置为main则位于主轨道', input: {}, name: 'track_name', required: false, type: 'string' },
    { description: '草稿画布的宽度，非当前图片的宽度。如果之前已经设置过，则不能重复设置', input: {}, name: 'width', required: false, type: 'float' },
    { description: '草稿画布的高度，非当前图片的高度。如果之前已经设置过，则不能重复设置', input: {}, name: 'height', required: false, type: 'float' },
    { description: '水平移动，相对值。0表示位于中心，水平移动像素 = transform_x * 草稿宽度', input: {}, name: 'transform_x', required: false, type: 'float' },
    { description: '垂直移动，相对值。0表示位于中心，垂直移动像素 = transform_y * 视频高度', input: {}, name: 'transform_y', required: false, type: 'float' },
    { description: '水平偏移，像素值', input: {}, name: 'transform_x_px', required: false, type: 'integer' },
    { description: '垂直偏移，像素值', input: {}, name: 'transform_y_px', required: false, type: 'integer' },
    { description: '水平方向缩放，1.5表示放大到原始图片的1.5倍', input: {}, name: 'scale_x', required: false, type: 'float' },
    { description: '垂直方向缩放，1.5表示放大到原始图片的1.5倍', input: {}, name: 'scale_y', required: false, type: 'float' },
    { description: '旋转角度', input: {}, name: 'rotation', required: false, type: 'float' },
    { description: '透明度，0-1', input: {}, name: 'alpha', required: false, type: 'float' },
    { description: '轨道相对位置，越大越靠上', input: {}, name: 'relative_index', required: false, type: 'integer' },
    { description: '背景高斯模糊，可选1，2，3，4四档，越大越模糊，只有当track_name=main的时候才会生效', input: {}, name: 'background_blur', required: false, type: 'integer' },
    { description: '是否镜像翻转，默认false', input: {}, name: 'flip_horizontal', required: false, type: 'boolean' },
    { description: '混合模式，目前只支持“正片叠底”', input: {}, name: 'mix_type', required: false, type: 'string' },
    { description: '入场动画，用get_intro_animation_types查看支持的入场动画', input: {}, name: 'intro_animation', required: false, type: 'string' },
    { description: '入场动画持续时间，单位秒', input: {}, name: 'intro_animation_duration', required: false, type: 'float' },
    { description: '出场动画，用get_outro_animation_types查看支持的出场动画', input: {}, name: 'outro_animation', required: false, type: 'string' },
    { description: '出场动画持续时间，单位秒', input: {}, name: 'outro_animation_duration', required: false, type: 'float' },
    { description: '组合动画，用get_combo_animation_types查看支持的组合动画', input: {}, name: 'combo_animation', required: false, type: 'string' },
    { description: '组合动画持续时间，单位秒', input: {}, name: 'combo_animation_duration', required: false, type: 'float' },
    { description: '转场效果，使用get_transition_types工具，查看支持的转场动画', input: {}, name: 'transition', required: false, type: 'string' },
    { description: '转场持续时间，单位秒', input: {}, name: 'transition_duration', required: false, type: 'float' },
    { description: '蒙版类型，支持：线性、镜面、圆形、矩形、爱心、星形', input: {}, name: 'mask_type', required: false, type: 'string' },
    { description: '蒙版中心点X坐标(以素材的像素为单位)，默认设置在素材中心，0.5表示向右移动0.5个宽度', input: {}, name: 'mask_center_x', required: false, type: 'float' },
    { description: '蒙版中心点Y坐标(以素材的像素为单位)，默认设置在素材中心，0.5表示向下移动0.5个高度', input: {}, name: 'mask_center_y', required: false, type: 'float' },
    { description: '蒙版的主要尺寸，以草稿高度的比例表示，默认为0.5', input: {}, name: 'mask_size', required: false, type: 'float' },
    { description: '蒙版顺时针旋转的角度，默认不旋转', input: {}, name: 'mask_rotation', required: false, type: 'float' },
    { description: '蒙版的羽化参数，取值范围0~100，默认无羽化', input: {}, name: 'mask_feather', required: false, type: 'float' },
    { description: '是否反转蒙版，默认不反转', input: {}, name: 'mask_invert', required: false, type: 'boolean' },
    { description: '矩形蒙版的宽度，仅在蒙版类型为矩形时允许设置，以占素材宽度的比例表示', input: {}, name: 'mask_rect_width', required: false, type: 'float' },
    { description: '矩形蒙版的圆角参数，仅在蒙版类型为矩形时允许设置，取值范围0~100', input: {}, name: 'mask_round_corner', required: false, type: 'float' }
  ],
  outputs: [
    { type: 'string', name: 'error', required: false },
    { type: 'string', name: 'error_code', required: false },
    {
      type: 'object',
      name: 'output',
      schema: [
        { type: 'string', name: 'draft_id', required: false, description: '草稿id，可以继续编辑' },
        { type: 'string', name: 'draft_url', required: false, description: '草稿链接，可以在浏览器里预览' },
        { type: 'string', name: 'material_id', required: false, description: '图片素材在草稿里的唯一ID' }
      ],
      required: false
    },
    { type: 'string', name: 'purchase_link', required: false },
    { type: 'boolean', name: 'success', required: false }
  ],
  updateTime: 1792485185,
  channel_id: 2,
  commercial_setting: {},
  latestVersionTs: '0',
  latestVersionName: '',
  versionName: '',
  description: '向草稿中添加图片',
  title: 'add_image',
  mainColor: '#CA61FF'
};

const createLiteralValue = (content) => ({
  type: 'literal',
  content,
  rawMeta: {
    type: 1
  }
});

const createInputParameter = (name, type, content) => ({
  name,
  input: {
    type,
    value: createLiteralValue(content)
  }
});

const createRefValue = (blockID, name, type = 'string') => ({
  type,
  value: {
    type: 'ref',
    content: {
      source: 'block-output',
      blockID,
      name
    },
    rawMeta: {
      type: 1
    }
  }
});

const createRefInputParameter = (name, blockID, outputName, type = 'string') => ({
  name,
  input: createRefValue(blockID, outputName, type)
});

const createPresetReplacementsInputParameter = (replacements) => ({
  name: 'replacements',
  input: {
    type: 'list',
    value: {
      type: 'literal',
      content: JSON.stringify(replacements.map((item) => JSON.stringify(item)), null, 2),
      rawMeta: {
        type: 99
      }
    },
    schema: {
      type: 'string'
    }
  }
});

const createApiParamEntries = (pluginMeta) => (
  Object.entries(pluginMeta).map(([name, content]) => {
    if (name === 'pluginAuthMode') {
      return {
        input: {
          type: 'integer',
          value: {
            content: Number(content) || 0,
            type: 'literal'
          }
        },
        name
      };
    }
    return createInputParameter(name, 'string', content);
  })
);

const createDraftRequestInputParameters = (draftRequest = {}) => {
  const width = Number(draftRequest?.width || 1080) || 1080;
  const height = Number(draftRequest?.height || 1920) || 1920;
  const name = String(draftRequest?.name || '').trim();
  const cover = String(draftRequest?.cover || '').trim();

  return [
    createInputParameter('cover', 'string', cover),
    createInputParameter('height', 'integer', height),
    createInputParameter('name', 'string', name),
    createInputParameter('width', 'integer', width)
  ];
};

export const buildDraftRequestCozeClipboardData = (draftRequest = {}) => {
  const inputParameters = createDraftRequestInputParameters(draftRequest);

  return JSON.stringify({
    type: 'coze-workflow-clipboard-data',
    source: {
      ...COZE_WORKFLOW_SOURCE
    },
    json: {
      nodes: [
        {
          id: '127143',
          type: '4',
          meta: {
            position: {
              x: 340.53846153846155,
              y: -227.5
            }
          },
          data: {
            nodeMeta: {
              ...COZE_CREATE_DRAFT_NODE_META
            },
            inputs: {
              apiParam: createApiParamEntries(COZE_CREATE_DRAFT_PLUGIN_META),
              inputParameters,
              settingOnError: {
                processType: 1,
                timeoutMs: 180000,
                retryTimes: 0
              }
            },
            outputs: [
              {
                type: 'object',
                name: 'output',
                schema: [
                  { type: 'string', name: 'draft_id', required: false, description: '草稿id，基于这个草稿继续编辑' },
                  { type: 'string', name: 'draft_url', required: false, description: '草稿链接，复制到浏览器里打开可以预览' }
                ],
                required: false
              },
              { type: 'string', name: 'purchase_link', required: false },
              { type: 'boolean', name: 'success', required: false },
              { type: 'string', name: 'error', required: false }
            ]
          },
          _temp: {
            bounds: {
              x: 160.53846153846155,
              y: -227.5,
              width: 360,
              height: 112
            },
            externalData: {
              ...COZE_CREATE_DRAFT_EXTERNAL_DATA
            }
          }
        }
      ],
      edges: []
    },
    bounds: {
      x: 160.53846153846155,
      y: -227.5,
      width: 360,
      height: 112
    }
  }, null, 2);
};

const createDraftModifyRequestInputParameters = (draftModifyRequest = {}) => {
  const draftId = String(draftModifyRequest?.draftId || draftModifyRequest?.draft_id || '').trim();
  const name = String(draftModifyRequest?.name || '').trim();
  const cover = String(draftModifyRequest?.cover || '').trim();
  const parameters = [createInputParameter('draft_id', 'string', draftId)];

  if (name) {
    parameters.push(createInputParameter('name', 'string', name));
  }
  if (cover) {
    parameters.push(createInputParameter('cover', 'string', cover));
  }

  return parameters;
};

const createTextAddRequestInputParameters = (textAddRequest = {}) => {
  const draftId = String(textAddRequest?.draft_id || textAddRequest?.draftId || '').trim();
  const text = String(textAddRequest?.text || '');
  const start = Number(textAddRequest?.start || 0) || 0;
  const end = Number(textAddRequest?.end || 3) || 3;
  const font = String(textAddRequest?.font || '').trim();
  const fontSize = Number(textAddRequest?.font_size ?? textAddRequest?.fontSize);
  const fontColor = String(textAddRequest?.font_color || textAddRequest?.fontColor || '').trim();
  const letterSpacing = Number(textAddRequest?.letter_spacing ?? textAddRequest?.letterSpacing);
  const lineSpacing = Number(textAddRequest?.line_spacing ?? textAddRequest?.lineSpacing);
  const scaleX = Number(textAddRequest?.scale_x ?? textAddRequest?.scaleX);
  const scaleY = Number(textAddRequest?.scale_y ?? textAddRequest?.scaleY);
  const transformXPx = Number(textAddRequest?.transform_x_px ?? textAddRequest?.transformXPx);
  const transformYPx = Number(textAddRequest?.transform_y_px ?? textAddRequest?.transformYPx);
  const fixedWidthPx = Number(textAddRequest?.fixed_width_px ?? textAddRequest?.fixedWidthPx ?? textAddRequest?.fixed_width ?? textAddRequest?.fixedWidth);
  const fixedHeightPx = Number(textAddRequest?.fixed_height_px ?? textAddRequest?.fixedHeightPx ?? textAddRequest?.fixed_height ?? textAddRequest?.fixedHeight);
  const rotation = Number(textAddRequest?.rotation);
  const trackName = String(textAddRequest?.track_name || textAddRequest?.trackName || '').trim();
  const relativeIndex = Number(textAddRequest?.relative_index ?? textAddRequest?.relativeIndex);
  const parameters = [
    createInputParameter('draft_id', 'string', draftId),
    createInputParameter('text', 'string', text),
    createInputParameter('start', 'float', start),
    createInputParameter('end', 'float', end)
  ];
  if (font) parameters.push(createInputParameter('font', 'string', font));
  if (Number.isFinite(fontSize) && fontSize > 0) parameters.push(createInputParameter('font_size', 'float', fontSize));
  if (fontColor) parameters.push(createInputParameter('font_color', 'string', fontColor));
  const textStyles = textAddRequest?.text_styles ?? textAddRequest?.textStyles;
  if (Array.isArray(textStyles) && textStyles.length) parameters.push(createInputParameter('text_styles', 'list', textStyles));
  for (const [key, value] of Object.entries(normalizeTextEffectParams(textAddRequest))) {
    parameters.push(createInputParameter(key, typeof value === 'boolean' ? 'boolean'
      : typeof value === 'string' ? 'string' : key === 'background_style' ? 'integer' : 'float', value));
  }
  if (Number.isFinite(letterSpacing)) parameters.push(createInputParameter('letter_spacing', 'float', letterSpacing));
  if (Number.isFinite(lineSpacing)) parameters.push(createInputParameter('line_spacing', 'float', lineSpacing));
  if (typeof textAddRequest?.bold === 'boolean') parameters.push(createInputParameter('bold', 'boolean', textAddRequest.bold));
  if (typeof textAddRequest?.italic === 'boolean') parameters.push(createInputParameter('italic', 'boolean', textAddRequest.italic));
  if (typeof textAddRequest?.underline === 'boolean') parameters.push(createInputParameter('underline', 'boolean', textAddRequest.underline));
  if (typeof textAddRequest?.vertical === 'boolean') parameters.push(createInputParameter('vertical', 'boolean', textAddRequest.vertical));
  if (Number.isInteger(Number(textAddRequest?.align))) parameters.push(createInputParameter('align', 'integer', Number(textAddRequest.align)));
  if (Number.isFinite(scaleX)) parameters.push(createInputParameter('scale_x', 'float', scaleX));
  if (Number.isFinite(scaleY)) parameters.push(createInputParameter('scale_y', 'float', scaleY));
  if (Number.isFinite(transformXPx)) parameters.push(createInputParameter('transform_x_px', 'integer', transformXPx));
  if (Number.isFinite(transformYPx)) parameters.push(createInputParameter('transform_y_px', 'integer', transformYPx));
  if (Number.isFinite(fixedWidthPx)) parameters.push(createInputParameter('fixed_width_px', 'integer', fixedWidthPx));
  if (Number.isFinite(fixedHeightPx)) parameters.push(createInputParameter('fixed_height_px', 'integer', fixedHeightPx));
  if (Number.isFinite(rotation)) parameters.push(createInputParameter('rotation', 'float', rotation));
  if (trackName) parameters.push(createInputParameter('track_name', 'string', trackName));
  if (Number.isInteger(relativeIndex)) parameters.push(createInputParameter('relative_index', 'integer', relativeIndex));
  return parameters;
};

const createPresetAddRequestInputParameters = (presetAddRequest = {}) => {
  const parameters = [];
  const addString = (name, value) => {
    const normalized = String(value || '').trim();
    if (normalized) parameters.push(createInputParameter(name, 'string', normalized));
  };
  const addNumber = (name, value, type = 'float') => {
    const normalized = Number(value);
    if (Number.isFinite(normalized)) parameters.push(createInputParameter(name, type, normalized));
  };

  addString('preset_id', presetAddRequest?.preset_id || presetAddRequest?.presetId);
  addString('draft_id', presetAddRequest?.draft_id || presetAddRequest?.draftId);
  const replacements = Array.isArray(presetAddRequest?.replacements)
    ? presetAddRequest.replacements
      .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      .flatMap((item) => Object.entries(item).map(([key, value]) => {
        const normalizedKey = String(key || '').trim();
        const normalizedValue = String(value ?? '');
        return normalizedKey && normalizedValue.trim() ? { [normalizedKey]: normalizedValue } : null;
      }).filter(Boolean))
    : [];
  if (replacements.length) {
    parameters.push(createPresetReplacementsInputParameter(replacements));
  }
  addNumber('rotation', presetAddRequest?.rotation);
  addNumber('start', presetAddRequest?.start);
  addNumber('target_start', presetAddRequest?.target_start ?? presetAddRequest?.targetStart);
  addString('track_name', presetAddRequest?.track_name || presetAddRequest?.trackName);
  addNumber('transform_y_px', presetAddRequest?.transform_y_px ?? presetAddRequest?.transformYPx);
  addString('intro_animation', presetAddRequest?.intro_animation || presetAddRequest?.introAnimation);
  addNumber('outro_animation_duration', presetAddRequest?.outro_animation_duration ?? presetAddRequest?.outroAnimationDuration);
  addNumber('relative_index', presetAddRequest?.relative_index ?? presetAddRequest?.relativeIndex, 'integer');
  addNumber('scale_x', presetAddRequest?.scale_x ?? presetAddRequest?.scaleX);
  addNumber('scale_y', presetAddRequest?.scale_y ?? presetAddRequest?.scaleY);
  addNumber('end', presetAddRequest?.end);
  addNumber('transform_x', presetAddRequest?.transform_x ?? presetAddRequest?.transformX);
  addNumber('transform_x_px', presetAddRequest?.transform_x_px ?? presetAddRequest?.transformXPx);
  addNumber('transform_y', presetAddRequest?.transform_y ?? presetAddRequest?.transformY);
  addNumber('intro_animation_duration', presetAddRequest?.intro_animation_duration ?? presetAddRequest?.introAnimationDuration);
  addString('outro_animation', presetAddRequest?.outro_animation || presetAddRequest?.outroAnimation);
  addString('transition', presetAddRequest?.transition);
  addNumber('transition_duration', presetAddRequest?.transition_duration ?? presetAddRequest?.transitionDuration);
  addNumber('width', presetAddRequest?.width, 'integer');
  addNumber('height', presetAddRequest?.height, 'integer');
  return parameters;
};

const createSpeechRequestInputParameters = (speechRequest = {}) => {
  const parameters = [];
  const addString = (name, value) => {
    const normalized = String(value || '').trim();
    if (normalized) parameters.push(createInputParameter(name, 'string', normalized));
  };
  const addNumber = (name, value, type = 'float') => {
    const normalized = Number(value);
    if (Number.isFinite(normalized)) parameters.push(createInputParameter(name, type, normalized));
  };

  addString('provider', speechRequest?.provider);
  addString('text', speechRequest?.text);
  addString('voice_id', speechRequest?.voice_id || speechRequest?.voiceId);
  addString('model', speechRequest?.model);
  addString('draft_id', speechRequest?.draft_id || speechRequest?.draftId);
  addNumber('speech_speed', speechRequest?.speech_speed ?? speechRequest?.speechSpeed);
  addNumber('target_start', speechRequest?.target_start ?? speechRequest?.targetStart);
  addNumber('volume', speechRequest?.volume);
  addNumber('width', speechRequest?.width, 'integer');
  addNumber('height', speechRequest?.height, 'integer');
  addString('track_name', speechRequest?.track_name || speechRequest?.trackName);
  addString('effect_type', speechRequest?.effect_type || speechRequest?.effectType);
  const effectParams = Array.isArray(speechRequest?.effect_params)
    ? speechRequest.effect_params
    : (Array.isArray(speechRequest?.effectParams) ? speechRequest.effectParams : null);
  if (effectParams?.length) parameters.push(createInputParameter('effect_params', 'list', effectParams));
  addNumber('fade_in_duration', speechRequest?.fade_in_duration ?? speechRequest?.fadeInDuration);
  addNumber('fade_out_duration', speechRequest?.fade_out_duration ?? speechRequest?.fadeOutDuration);
  if (typeof speechRequest?.only_tts === 'boolean') {
    parameters.push(createInputParameter('only_tts', 'boolean', speechRequest.only_tts));
  } else if (typeof speechRequest?.onlyTts === 'boolean') {
    parameters.push(createInputParameter('only_tts', 'boolean', speechRequest.onlyTts));
  }
  addNumber('speed', speechRequest?.speed);
  addNumber('start', speechRequest?.start);
  addNumber('end', speechRequest?.end);
  return parameters;
};

const createAiVideoRequestInputParameters = (aiVideoRequest = {}) => {
  const content = Array.isArray(aiVideoRequest?.content) ? aiVideoRequest.content : [];
  const prompt = String(content.find((item) => item?.type === 'text')?.text || aiVideoRequest?.prompt || '').trim();
  const parameters = [
    createInputParameter('prompt', 'string', prompt),
    createInputParameter('model', 'string', String(aiVideoRequest?.model || '').trim()),
    createInputParameter('resolution', 'string', String(aiVideoRequest?.resolution || '').trim())
  ];
  const genDuration = Number(aiVideoRequest?.gen_duration ?? aiVideoRequest?.genDuration);
  if (Number.isFinite(genDuration)) parameters.push(createInputParameter('gen_duration', 'integer', genDuration));
  if (typeof aiVideoRequest?.generate_audio === 'boolean') {
    parameters.push(createInputParameter('generate_audio', 'boolean', aiVideoRequest.generate_audio));
  } else if (typeof aiVideoRequest?.generateAudio === 'boolean') {
    parameters.push(createInputParameter('generate_audio', 'boolean', aiVideoRequest.generateAudio));
  }
  if (typeof aiVideoRequest?.super_resolve === 'boolean') {
    parameters.push(createInputParameter('super_resolve', 'boolean', aiVideoRequest.super_resolve));
  } else if (typeof aiVideoRequest?.superResolve === 'boolean') {
    parameters.push(createInputParameter('super_resolve', 'boolean', aiVideoRequest.superResolve));
  }
  if (typeof aiVideoRequest?.enable_seedance_offline === 'boolean') {
    parameters.push(createInputParameter('enable_seedance_offline', 'boolean', aiVideoRequest.enable_seedance_offline));
  } else if (typeof aiVideoRequest?.enableSeedanceOffline === 'boolean') {
    parameters.push(createInputParameter('enable_seedance_offline', 'boolean', aiVideoRequest.enableSeedanceOffline));
  }
  if (content.length) parameters.push(createInputParameter('content', 'string', JSON.stringify(content)));
  return parameters;
};

const createImageGenerateRequestInputParameters = (imageGenerateRequest = {}) => {
  const parameters = [];
  const addString = (name, value) => {
    const normalized = String(value || '').trim();
    if (normalized) parameters.push(createInputParameter(name, 'string', normalized));
  };
  const addNumber = (name, value, type = 'float') => {
    const normalized = Number(value);
    if (Number.isFinite(normalized)) parameters.push(createInputParameter(name, type, normalized));
  };
  const addBoolean = (name, value) => {
    if (typeof value === 'boolean') parameters.push(createInputParameter(name, 'boolean', value));
  };

  const referenceImages = [
    ...(Array.isArray(imageGenerateRequest?.referenceImages) ? imageGenerateRequest.referenceImages : []),
    ...(Array.isArray(imageGenerateRequest?.reference_images) ? imageGenerateRequest.reference_images : []),
  ].map((item) => String(item || '').trim()).filter(Boolean);
  const composeDraft = imageGenerateRequest?.composeDraft ?? imageGenerateRequest?.compose_draft;

  addString('prompt', imageGenerateRequest?.prompt || imageGenerateRequest?.text);
  addString('model', imageGenerateRequest?.model);
  addString('size', imageGenerateRequest?.size || imageGenerateRequest?.resolution);
  addBoolean('compose_draft', typeof composeDraft === 'boolean' ? composeDraft : false);
  addString('reference_image', imageGenerateRequest?.referenceImage || imageGenerateRequest?.reference_image || imageGenerateRequest?.sourceImage || imageGenerateRequest?.source_image);
  if (referenceImages.length) parameters.push(createInputParameter('reference_images', 'list', referenceImages));
  addString('draft_id', imageGenerateRequest?.draftId || imageGenerateRequest?.draft_id);
  addString('track_name', imageGenerateRequest?.trackName || imageGenerateRequest?.track_name);
  addString('background', imageGenerateRequest?.background);
  addString('output_format', imageGenerateRequest?.outputFormat || imageGenerateRequest?.output_format);
  parameters.push(createInputParameter('start', 'float', 0.0));
  parameters.push(createInputParameter('end', 'float', 3.0));
  addNumber('transform_x', imageGenerateRequest?.transformX ?? imageGenerateRequest?.transform_x);
  addNumber('transform_y', imageGenerateRequest?.transformY ?? imageGenerateRequest?.transform_y);
  addNumber('scale_x', imageGenerateRequest?.scaleX ?? imageGenerateRequest?.scale_x);
  addNumber('scale_y', imageGenerateRequest?.scaleY ?? imageGenerateRequest?.scale_y);
  addNumber('rotation', imageGenerateRequest?.rotation);
  return parameters;
};

const createDigitalHumanRequestInputParameters = (digitalHumanRequest = {}) => {
  const audioUrl = String(
    digitalHumanRequest?.audio_url
    || digitalHumanRequest?.audioUrl
    || '<generated_audio_url>'
  ).trim();
  const videoUrl = String(
    digitalHumanRequest?.video_url
    || digitalHumanRequest?.videoUrl
    || ''
  ).trim();
  return [
    createInputParameter('audio_url', 'string', audioUrl),
    createInputParameter('video_url', 'string', videoUrl)
  ];
};

const createAudioAddRequestInputParameters = (audioAddRequest = {}) => {
  const parameters = [];
  const addString = (name, value) => {
    const normalized = String(value || '').trim();
    if (normalized) parameters.push(createInputParameter(name, 'string', normalized));
  };
  const addNumber = (name, value, type = 'float') => {
    const normalized = Number(value);
    if (Number.isFinite(normalized)) parameters.push(createInputParameter(name, type, normalized));
  };

  addString('audio_url', audioAddRequest?.audio_url || audioAddRequest?.audioUrl);
  addString('music_id', audioAddRequest?.music_id || audioAddRequest?.musicId);
  addString('draft_id', audioAddRequest?.draft_id || audioAddRequest?.draftId);
  addNumber('target_start', audioAddRequest?.target_start ?? audioAddRequest?.targetStart);
  addNumber('duration', audioAddRequest?.duration);
  addNumber('fade_in_duration', audioAddRequest?.fade_in_duration ?? audioAddRequest?.fadeInDuration);
  addString('track_name', audioAddRequest?.track_name || audioAddRequest?.trackName);
  addNumber('width', audioAddRequest?.width, 'integer');
  addString('effect_type', audioAddRequest?.effect_type || audioAddRequest?.effectType);
  addNumber('end', audioAddRequest?.end);
  addNumber('height', audioAddRequest?.height, 'integer');
  addNumber('start', audioAddRequest?.start);
  const effectParams = Array.isArray(audioAddRequest?.effect_params)
    ? audioAddRequest.effect_params
    : (Array.isArray(audioAddRequest?.effectParams) ? audioAddRequest.effectParams : null);
  if (effectParams?.length) parameters.push(createInputParameter('effect_params', 'list', effectParams));
  addNumber('fade_out_duration', audioAddRequest?.fade_out_duration ?? audioAddRequest?.fade_out_duratioin ?? audioAddRequest?.fadeOutDuration);
  addNumber('speed', audioAddRequest?.speed);
  addNumber('volume', audioAddRequest?.volume);
  return parameters;
};

const createImageAddRequestInputParameters = (imageAddRequest = {}) => {
  const parameters = [];
  const addString = (name, value) => {
    const normalized = String(value || '').trim();
    if (normalized) parameters.push(createInputParameter(name, 'string', normalized));
  };
  const addNumber = (name, value, type = 'float') => {
    const normalized = Number(value);
    if (Number.isFinite(normalized)) parameters.push(createInputParameter(name, type, normalized));
  };

  addString('image_url', imageAddRequest?.image_url || imageAddRequest?.imageUrl);
  addString('draft_id', imageAddRequest?.draft_id || imageAddRequest?.draftId);
  addNumber('start', imageAddRequest?.start ?? 0);
  addNumber('end', imageAddRequest?.end ?? 3);
  addString('track_name', imageAddRequest?.track_name || imageAddRequest?.trackName);
  addNumber('width', imageAddRequest?.width);
  addNumber('height', imageAddRequest?.height);
  addNumber('transform_x', imageAddRequest?.transform_x ?? imageAddRequest?.transformX);
  addNumber('transform_y', imageAddRequest?.transform_y ?? imageAddRequest?.transformY);
  addNumber('transform_x_px', imageAddRequest?.transform_x_px ?? imageAddRequest?.transformXPx, 'integer');
  addNumber('transform_y_px', imageAddRequest?.transform_y_px ?? imageAddRequest?.transformYPx, 'integer');
  addNumber('scale_x', imageAddRequest?.scale_x ?? imageAddRequest?.scaleX);
  addNumber('scale_y', imageAddRequest?.scale_y ?? imageAddRequest?.scaleY);
  addNumber('rotation', imageAddRequest?.rotation);
  addNumber('alpha', imageAddRequest?.alpha);
  addNumber('relative_index', imageAddRequest?.relative_index ?? imageAddRequest?.relativeIndex, 'integer');
  addString('intro_animation', imageAddRequest?.intro_animation || imageAddRequest?.introAnimation);
  addNumber('intro_animation_duration', imageAddRequest?.intro_animation_duration ?? imageAddRequest?.introAnimationDuration);
  addString('outro_animation', imageAddRequest?.outro_animation || imageAddRequest?.outroAnimation);
  addNumber('outro_animation_duration', imageAddRequest?.outro_animation_duration ?? imageAddRequest?.outroAnimationDuration);
  addString('combo_animation', imageAddRequest?.combo_animation || imageAddRequest?.comboAnimation);
  addNumber('combo_animation_duration', imageAddRequest?.combo_animation_duration ?? imageAddRequest?.comboAnimationDuration);
  addString('transition', imageAddRequest?.transition);
  addNumber('transition_duration', imageAddRequest?.transition_duration ?? imageAddRequest?.transitionDuration);
  return parameters;
};

export const buildDraftModifyRequestCozeClipboardData = (draftModifyRequest = {}) => {
  const inputParameters = createDraftModifyRequestInputParameters(draftModifyRequest);

  return JSON.stringify({
    type: 'coze-workflow-clipboard-data',
    source: {
      ...COZE_WORKFLOW_SOURCE
    },
    json: {
      nodes: [
        {
          id: '199017',
          type: '4',
          meta: {
            position: {
              x: 1020.0388069319126,
              y: 112.86787670007338
            }
          },
          data: {
            nodeMeta: {
              ...COZE_MODIFY_DRAFT_NODE_META
            },
            inputs: {
              apiParam: createApiParamEntries(COZE_MODIFY_DRAFT_PLUGIN_META),
              inputParameters,
              settingOnError: {
                processType: 1,
                timeoutMs: 180000,
                retryTimes: 0
              }
            },
            outputs: [
              { type: 'string', name: 'error', required: false },
              {
                type: 'object',
                name: 'output',
                schema: [
                  { type: 'string', name: 'draft_url', required: false },
                  { type: 'string', name: 'draft_id', required: false }
                ],
                required: false
              },
              { type: 'string', name: 'purchase_link', required: false },
              { type: 'boolean', name: 'success', required: false }
            ]
          },
          _temp: {
            bounds: {
              x: 840.0388069319126,
              y: 112.86787670007338,
              width: 360,
              height: 112
            },
            externalData: {
              ...COZE_MODIFY_DRAFT_EXTERNAL_DATA
            }
          }
        }
      ],
      edges: []
    },
    bounds: {
      x: 840.0388069319126,
      y: 112.86787670007338,
      width: 360,
      height: 112.00000000000001
    }
  }, null, 2);
};

export const buildTextAddRequestCozeClipboardData = (textAddRequest = {}) => {
  const inputParameters = createTextAddRequestInputParameters(textAddRequest);

  return JSON.stringify({
    type: 'coze-workflow-clipboard-data',
    source: {
      workflowId: '7684115562197712911',
      flowMode: 0,
      spaceId: '7472683780642258985',
      isDouyin: false,
      host: 'www.coze.cn'
    },
    json: {
      nodes: [
        {
          id: '197345',
          type: '4',
          meta: {
            position: {
              x: 1072.2094926350246,
              y: 143.43815504513285
            }
          },
          data: {
            nodeMeta: {
              ...COZE_ADD_TEXT_NODE_META
            },
            inputs: {
              apiParam: createApiParamEntries(COZE_ADD_TEXT_PLUGIN_META),
              inputParameters,
              settingOnError: {
                processType: 1,
                timeoutMs: 180000,
                retryTimes: 0
              }
            },
            outputs: [
              { type: 'boolean', name: 'success', required: false },
              { type: 'string', name: 'error', required: false },
              {
                type: 'object',
                name: 'output',
                schema: [
                  { type: 'string', name: 'draft_id', required: false, description: '草稿id，可以继续编辑' },
                  { type: 'string', name: 'draft_url', required: false, description: '草稿链接，在浏览器里打开可以预览' }
                ],
                required: false
              },
              { type: 'string', name: 'purchase_link', required: false }
            ]
          },
          _temp: {
            bounds: {
              x: 892.2094926350246,
              y: 143.43815504513285,
              width: 360,
              height: 112
            },
            externalData: {
              ...COZE_ADD_TEXT_EXTERNAL_DATA
            }
          }
        }
      ],
      edges: []
    },
    bounds: {
      x: 892.2094926350246,
      y: 143.43815504513285,
      width: 360,
      height: 112
    }
  }, null, 2);
};

export const buildPresetAddRequestCozeClipboardData = (presetAddRequest = {}) => {
  const inputParameters = createPresetAddRequestInputParameters(presetAddRequest);

  return JSON.stringify({
    type: 'coze-workflow-clipboard-data',
    source: {
      workflowId: '7582120367239004166',
      flowMode: 0,
      spaceId: '7472683780642258985',
      isDouyin: false,
      host: 'www.coze.cn'
    },
    json: {
      nodes: [
        {
          id: '168109',
          type: '4',
          meta: {
            position: {
              x: -228.26309482408212,
              y: -337.8172934143432
            }
          },
          data: {
            nodeMeta: {
              ...COZE_ADD_PRESET_NODE_META
            },
            inputs: {
              apiParam: createApiParamEntries(COZE_ADD_PRESET_PLUGIN_META),
              inputParameters,
              settingOnError: {
                processType: 1,
                timeoutMs: 180000,
                retryTimes: 0
              }
            },
            outputs: [
              { type: 'string', name: 'error', required: false },
              {
                type: 'object',
                name: 'output',
                schema: [
                  { type: 'string', name: 'draft_id', required: false, description: '草稿id, 可以继续编辑' },
                  { type: 'string', name: 'draft_url', required: false, description: '草稿链接，复制到浏览器里可以打开预览' }
                ],
                required: false
              },
              { type: 'string', name: 'purchase_link', required: false },
              { type: 'boolean', name: 'success', required: false }
            ]
          },
          _temp: {
            bounds: {
              x: -408.26309482408215,
              y: -337.8172934143432,
              width: 360,
              height: 112
            },
            externalData: {
              ...COZE_ADD_PRESET_EXTERNAL_DATA
            }
          }
        }
      ],
      edges: []
    },
    bounds: {
      x: -408.26309482408215,
      y: -337.8172934143432,
      width: 360,
      height: 112
    }
  }, null, 2);
};

export const buildSpeechRequestCozeClipboardData = (speechRequest = {}) => {
  const inputParameters = createSpeechRequestInputParameters(speechRequest);

  return JSON.stringify({
    type: 'coze-workflow-clipboard-data',
    source: {
      workflowId: '7582120367239004166',
      flowMode: 0,
      spaceId: '7472683780642258985',
      isDouyin: false,
      host: 'www.coze.cn'
    },
    json: {
      nodes: [
        {
          id: '110357',
          type: '4',
          meta: {
            position: {
              x: 330.5232910124702,
              y: -378.24777121709934
            }
          },
          data: {
            nodeMeta: {
              ...COZE_GENERATE_SPEECH_NODE_META
            },
            inputs: {
              apiParam: createApiParamEntries(COZE_GENERATE_SPEECH_PLUGIN_META),
              inputParameters,
              settingOnError: {
                processType: 1,
                timeoutMs: 180000,
                retryTimes: 0
              }
            },
            outputs: COZE_GENERATE_SPEECH_EXTERNAL_DATA.outputs
          },
          _temp: {
            bounds: {
              x: 150.52329101247022,
              y: -378.24777121709934,
              width: 360,
              height: 112
            },
            externalData: {
              ...COZE_GENERATE_SPEECH_EXTERNAL_DATA
            }
          }
        }
      ],
      edges: []
    },
    bounds: {
      x: 150.52329101247022,
      y: -378.24777121709934,
      width: 360,
      height: 112
    }
  }, null, 2);
};

export const buildImageGenerateRequestCozeClipboardData = (imageGenerateRequest = {}) => {
  const inputParameters = createImageGenerateRequestInputParameters(imageGenerateRequest);

  return JSON.stringify({
    type: 'coze-workflow-clipboard-data',
    source: {
      ...COZE_WORKFLOW_SOURCE
    },
    json: {
      nodes: [
        {
          id: '110594',
          type: '4',
          meta: {
            position: {
              x: -1282.4143011375581,
              y: -26.119569099011755
            }
          },
          data: {
            nodeMeta: {
              ...COZE_GENERATE_IMAGE_NODE_META
            },
            inputs: {
              apiParam: createApiParamEntries(COZE_GENERATE_IMAGE_PLUGIN_META),
              inputParameters,
              settingOnError: {
                processType: 1,
                timeoutMs: 180000,
                retryTimes: 0
              }
            },
            outputs: COZE_GENERATE_IMAGE_EXTERNAL_DATA.outputs
          },
          _temp: {
            bounds: {
              x: -1462.4143011375581,
              y: -26.119569099011755,
              width: 360,
              height: 112
            },
            externalData: {
              ...COZE_GENERATE_IMAGE_EXTERNAL_DATA
            }
          }
        },
        {
          id: '125756',
          type: '21',
          meta: {
            position: {
              x: -811.2866869705352,
              y: -26.119569099011755
            },
            canvasPosition: {
              x: -911.2866869705352,
              y: 194.8368010871914
            }
          },
          data: {
            nodeMeta: {
              ...COZE_LOOP_NODE_META
            },
            inputs: {
              loopType: 'count',
              loopCount: {
                type: 'integer',
                value: {
                  type: 'literal',
                  content: 100,
                  rawMeta: {
                    type: 2
                  }
                }
              },
              variableParameters: [
                {
                  name: 'image',
                  input: {
                    type: 'string',
                    value: createLiteralValue(' ')
                  }
                }
              ],
              inputParameters: []
            },
            outputs: [
              createRefInputParameter('output', '125756', 'image')
            ]
          },
          blocks: [
            {
              id: '151201',
              type: '4',
              meta: {
                position: {
                  x: 0,
                  y: 100
                }
              },
              data: {
                nodeMeta: {
                  ...COZE_IMAGE_STATUS_NODE_META
                },
                inputs: {
                  apiParam: createApiParamEntries(COZE_IMAGE_STATUS_PLUGIN_META),
                  inputParameters: [
                    createRefInputParameter('task_id', '110594', 'task_id')
                  ],
                  settingOnError: {
                    processType: 1,
                    timeoutMs: 180000,
                    retryTimes: 0
                  }
                },
                outputs: COZE_IMAGE_STATUS_EXTERNAL_DATA.outputs
              },
              _temp: {
                bounds: {
                  x: -1091.2866869705354,
                  y: 294.83680108719136,
                  width: 360,
                  height: 112
                },
                externalData: {
                  ...COZE_IMAGE_STATUS_EXTERNAL_DATA
                }
              }
            },
            {
              id: '134714',
              type: '8',
              meta: {
                position: {
                  x: 457.4998515039845,
                  y: 100
                }
              },
              data: {
                nodeMeta: {
                  ...COZE_CONDITION_NODE_META
                },
                inputs: {
                  branches: [
                    {
                      condition: {
                        logic: 2,
                        conditions: [
                          {
                            operator: 10,
                            left: {
                              input: createRefValue('151201', 'result.image')
                            }
                          }
                        ]
                      }
                    }
                  ]
                }
              },
              _temp: {
                bounds: {
                  x: -633.7868354665508,
                  y: 294.83680108719136,
                  width: 360,
                  height: 138
                },
                externalData: {
                  icon: COZE_CONDITION_NODE_META.icon,
                  description: COZE_CONDITION_NODE_META.description,
                  title: COZE_CONDITION_NODE_META.title,
                  mainColor: COZE_CONDITION_NODE_META.mainColor
                }
              }
            },
            {
              id: '140518',
              type: '20',
              meta: {
                position: {
                  x: 860.5103652258424,
                  y: 127.20287447659962
                }
              },
              data: {
                inputs: {
                  inputParameters: [
                    {
                      left: createRefValue('125756', 'image'),
                      right: createRefValue('151201', 'result.image')
                    }
                  ]
                },
                nodeMeta: {
                  ...COZE_LOOP_SET_VARIABLE_NODE_META
                }
              },
              _temp: {
                bounds: {
                  x: -230.77632174469284,
                  y: 322.039675563791,
                  width: 360,
                  height: 86
                },
                externalData: {
                  icon: COZE_LOOP_SET_VARIABLE_NODE_META.icon,
                  description: COZE_LOOP_SET_VARIABLE_NODE_META.description,
                  title: COZE_LOOP_SET_VARIABLE_NODE_META.title,
                  mainColor: COZE_LOOP_SET_VARIABLE_NODE_META.mainColor
                }
              }
            },
            {
              id: '127483',
              type: '19',
              meta: {
                position: {
                  x: 1257.0727107281505,
                  y: 134.6613324217122
                }
              },
              data: {
                nodeMeta: {
                  title: '终止循环',
                  icon: 'https://lf3-static.bytednsdoc.com/obj/eden-cn/dvsmryvd_avi_dvsm/ljhwZthlaukjlkulzlp/icon/icon-Break-v2.jpg',
                  description: '用于立即终止当前所在的循环，跳出循环体',
                  mainColor: '#00B2B2',
                  subTitle: '终止循环'
                }
              },
              _temp: {
                bounds: {
                  x: 165.78602375761523,
                  y: 329.4981335089036,
                  width: 360,
                  height: 66
                },
                externalData: {
                  icon: 'https://lf3-static.bytednsdoc.com/obj/eden-cn/dvsmryvd_avi_dvsm/ljhwZthlaukjlkulzlp/icon/icon-Break-v2.jpg',
                  description: '用于立即终止当前所在的循环，跳出循环体',
                  title: '终止循环',
                  mainColor: '#00B2B2'
                }
              }
            },
            {
              id: '146292',
              type: '4',
              meta: {
                position: {
                  x: 897.0727107281505,
                  y: 303.6479210630914
                }
              },
              data: {
                nodeMeta: {
                  ...COZE_TIME_DELAY_NODE_META
                },
                inputs: {
                  apiParam: createApiParamEntries(COZE_TIME_DELAY_PLUGIN_META),
                  inputParameters: [
                    createInputParameter('seconds', 'integer', 20)
                  ],
                  settingOnError: {
                    processType: 1,
                    timeoutMs: 180000,
                    retryTimes: 0
                  }
                },
                outputs: COZE_TIME_DELAY_EXTERNAL_DATA.outputs
              },
              _temp: {
                bounds: {
                  x: -194.21397624238477,
                  y: 498.4847221502828,
                  width: 360,
                  height: 136
                },
                externalData: {
                  ...COZE_TIME_DELAY_EXTERNAL_DATA
                }
              }
            }
          ],
          edges: [
            { sourceNodeID: '125756', targetNodeID: '151201', sourcePortID: 'loop-function-inline-output' },
            { sourceNodeID: '151201', targetNodeID: '134714' },
            { sourceNodeID: '134714', targetNodeID: '140518', sourcePortID: 'true' },
            { sourceNodeID: '134714', targetNodeID: '146292', sourcePortID: 'false' },
            { sourceNodeID: '140518', targetNodeID: '127483' },
            { sourceNodeID: '146292', targetNodeID: '125756', targetPortID: 'loop-function-inline-input' }
          ],
          _temp: {
            bounds: {
              x: -991.2866869705352,
              y: -26.119569099011755,
              width: 360,
              height: 112
            },
            externalData: {
              icon: COZE_LOOP_NODE_META.icon,
              description: COZE_LOOP_NODE_META.description,
              title: '循环',
              mainColor: COZE_LOOP_NODE_META.mainColor
            }
          }
        }
      ],
      edges: [
        { sourceNodeID: '110594', targetNodeID: '125756' }
      ]
    },
    bounds: {
      x: -1462.4143011375581,
      y: -26.119569099011755,
      width: 831.1276141670229,
      height: 112
    }
  }, null, 2);
};

export const buildAiVideoRequestCozeClipboardData = (aiVideoRequest = {}) => {
  const inputParameters = createAiVideoRequestInputParameters(aiVideoRequest);

  return JSON.stringify({
    type: 'coze-workflow-clipboard-data',
    source: {
      workflowId: '7668682150007488554',
      flowMode: 0,
      spaceId: '7472683780642258985',
      isDouyin: false,
      host: 'www.coze.cn'
    },
    json: {
      nodes: [
        {
          id: '101263',
          type: '21',
          meta: {
            position: {
              x: 287.84735062031314,
              y: -179.4738610729286
            },
            canvasPosition: {
              x: -320.9224882738878,
              y: 143.69107672696035
            }
          },
          data: {
            nodeMeta: {
              ...COZE_LOOP_NODE_META
            },
            inputs: {
              inputParameters: [],
              loopType: 'count',
              loopCount: {
                type: 'integer',
                value: {
                  type: 'literal',
                  content: 150,
                  rawMeta: {
                    type: 2
                  }
                }
              },
              variableParameters: [
                {
                  name: 'result',
                  input: {
                    type: 'string',
                    value: createLiteralValue(' ')
                  }
                }
              ]
            },
            outputs: [
              createRefInputParameter('output', '101263', 'result')
            ]
          },
          blocks: [
            {
              id: '1752177',
              type: '4',
              meta: {
                position: {
                  x: 0,
                  y: 100
                }
              },
              data: {
                nodeMeta: {
                  ...COZE_TIME_DELAY_NODE_META
                },
                inputs: {
                  apiParam: createApiParamEntries(COZE_TIME_DELAY_PLUGIN_META),
                  inputParameters: [
                    {
                      name: 'seconds',
                      input: {
                        type: 'integer',
                        value: {
                          type: 'literal',
                          content: 10,
                          rawMeta: {
                            type: 2
                          }
                        }
                      }
                    }
                  ],
                  settingOnError: {
                    processType: 1,
                    timeoutMs: 180000,
                    retryTimes: 0
                  }
                },
                outputs: COZE_TIME_DELAY_EXTERNAL_DATA.outputs
              },
              _temp: {
                bounds: {
                  x: -500.9224882738878,
                  y: 243.69107672696035,
                  width: 360,
                  height: 112
                },
                externalData: {
                  ...COZE_TIME_DELAY_EXTERNAL_DATA
                }
              }
            },
            {
              id: '125927',
              type: '4',
              meta: {
                position: {
                  x: 423.9478895979671,
                  y: 99.99999999999999
                }
              },
              data: {
                nodeMeta: {
                  ...COZE_AI_VIDEO_STATUS_NODE_META
                },
                inputs: {
                  apiParam: createApiParamEntries(COZE_AI_VIDEO_STATUS_PLUGIN_META),
                  inputParameters: [
                    createRefInputParameter('task_id', '177411', 'task_id')
                  ],
                  settingOnError: {
                    processType: 1,
                    timeoutMs: 180000,
                    retryTimes: 0
                  }
                },
                outputs: COZE_AI_VIDEO_STATUS_EXTERNAL_DATA.outputs
              },
              _temp: {
                bounds: {
                  x: -76.97459867592067,
                  y: 243.69107672696032,
                  width: 360,
                  height: 112
                },
                externalData: {
                  ...COZE_AI_VIDEO_STATUS_EXTERNAL_DATA
                }
              }
            },
            {
              id: '195103',
              type: '8',
              meta: {
                position: {
                  x: 909.9153392979259,
                  y: 88
                }
              },
              data: {
                nodeMeta: {
                  ...COZE_CONDITION_NODE_META
                },
                inputs: {
                  branches: [
                    {
                      condition: {
                        logic: 2,
                        conditions: [
                          {
                            operator: 1,
                            left: {
                              input: createRefValue('125927', 'status')
                            },
                            right: {
                              input: {
                                type: 'string',
                                value: createLiteralValue('succeeded')
                              }
                            }
                          }
                        ]
                      }
                    }
                  ]
                }
              },
              _temp: {
                bounds: {
                  x: 408.99285102403815,
                  y: 231.69107672696035,
                  width: 360,
                  height: 138
                },
                externalData: {
                  icon: COZE_CONDITION_NODE_META.icon,
                  description: COZE_CONDITION_NODE_META.description,
                  title: COZE_CONDITION_NODE_META.title,
                  mainColor: COZE_CONDITION_NODE_META.mainColor
                }
              }
            },
            {
              id: '113569',
              type: '20',
              meta: {
                position: {
                  x: 1395.8827889978845,
                  y: 99.99999999999999
                }
              },
              data: {
                inputs: {
                  inputParameters: [
                    {
                      left: createRefValue('101263', 'result'),
                      right: createRefValue('125927', 'video_url')
                    }
                  ]
                },
                nodeMeta: {
                  ...COZE_LOOP_SET_VARIABLE_NODE_META
                }
              },
              _temp: {
                bounds: {
                  x: 894.9603007239966,
                  y: 243.69107672696032,
                  width: 360,
                  height: 86
                },
                externalData: {
                  icon: COZE_LOOP_SET_VARIABLE_NODE_META.icon,
                  description: COZE_LOOP_SET_VARIABLE_NODE_META.description,
                  title: COZE_LOOP_SET_VARIABLE_NODE_META.title,
                  mainColor: COZE_LOOP_SET_VARIABLE_NODE_META.mainColor
                }
              }
            }
          ],
          edges: [
            { sourceNodeID: '101263', targetNodeID: '1752177', sourcePortID: 'loop-function-inline-output' },
            { sourceNodeID: '1752177', targetNodeID: '125927' },
            { sourceNodeID: '125927', targetNodeID: '195103' },
            { sourceNodeID: '195103', targetNodeID: '113569', sourcePortID: 'true' },
            { sourceNodeID: '195103', targetNodeID: '101263', sourcePortID: 'false', targetPortID: 'loop-function-inline-input' },
            { sourceNodeID: '113569', targetNodeID: '101263', targetPortID: 'loop-function-inline-input' }
          ],
          _temp: {
            bounds: {
              x: 107.84735062031314,
              y: -179.4738610729286,
              width: 360,
              height: 112
            },
            externalData: {
              icon: COZE_LOOP_NODE_META.icon,
              description: COZE_LOOP_NODE_META.description,
              title: '循环',
              mainColor: COZE_LOOP_NODE_META.mainColor
            }
          }
        },
        {
          id: '177411',
          type: '4',
          meta: {
            position: {
              x: -174.86671954832167,
              y: -179.4738610729286
            }
          },
          data: {
            nodeMeta: {
              ...COZE_GENERATE_AI_VIDEO_NODE_META
            },
            inputs: {
              apiParam: createApiParamEntries(COZE_GENERATE_AI_VIDEO_PLUGIN_META),
              inputParameters,
              settingOnError: {
                processType: 1,
                timeoutMs: 180000,
                retryTimes: 0
              }
            },
            outputs: COZE_GENERATE_AI_VIDEO_EXTERNAL_DATA.outputs
          },
          _temp: {
            bounds: {
              x: -354.86671954832167,
              y: -179.4738610729286,
              width: 360,
              height: 112
            },
            externalData: {
              ...COZE_GENERATE_AI_VIDEO_EXTERNAL_DATA
            }
          }
        }
      ],
      edges: [
        { sourceNodeID: '177411', targetNodeID: '101263' }
      ]
    },
    bounds: {
      x: -354.86671954832167,
      y: -179.4738610729286,
      width: 822.7140701686349,
      height: 112
    }
  }, null, 2);
};

export const isDigitalHumanRequestCozeSupported = (digitalHumanRequest = {}) => (
  String(digitalHumanRequest?.mode || '').trim() === 'lip_sync'
);

export const buildDigitalHumanRequestCozeClipboardData = (digitalHumanRequest = {}) => {
  const inputParameters = createDigitalHumanRequestInputParameters(digitalHumanRequest);

  return JSON.stringify({
    type: 'coze-workflow-clipboard-data',
    source: {
      workflowId: '7668682150007488554',
      flowMode: 0,
      spaceId: '7472683780642258985',
      isDouyin: false,
      host: 'www.coze.cn'
    },
    json: {
      nodes: [
        {
          id: '101578',
          type: '4',
          meta: {
            position: {
              x: 888.6009912829397,
              y: -329.75263794564313
            }
          },
          data: {
            nodeMeta: {
              ...COZE_CREATE_DIGITAL_HUMAN_NODE_META
            },
            inputs: {
              apiParam: createApiParamEntries(COZE_CREATE_DIGITAL_HUMAN_PLUGIN_META),
              inputParameters,
              settingOnError: {
                processType: 1,
                timeoutMs: 180000,
                retryTimes: 0
              }
            },
            outputs: COZE_CREATE_DIGITAL_HUMAN_EXTERNAL_DATA.outputs
          },
          _temp: {
            bounds: {
              x: 708.6009912829397,
              y: -329.75263794564313,
              width: 360,
              height: 112
            },
            externalData: {
              ...COZE_CREATE_DIGITAL_HUMAN_EXTERNAL_DATA
            }
          }
        },
        {
          id: '101579',
          type: '21',
          meta: {
            position: {
              x: 1370.362559478161,
              y: -329.75263794564313
            },
            canvasPosition: {
              x: 1190.362559478161,
              y: -329.75263794564313
            }
          },
          data: {
            nodeMeta: {
              ...COZE_LOOP_NODE_META
            },
            inputs: {
              inputParameters: [],
              loopType: 'count',
              loopCount: {
                type: 'integer',
                value: {
                  type: 'literal',
                  content: 150,
                  rawMeta: {
                    type: 2
                  }
                }
              },
              variableParameters: [
                {
                  name: 'result',
                  input: {
                    type: 'string',
                    value: createLiteralValue(' ')
                  }
                }
              ]
            },
            outputs: [
              createRefInputParameter('output', '101579', 'result')
            ]
          },
          blocks: [
            {
              id: '134580',
              type: '4',
              meta: {
                position: {
                  x: 0,
                  y: 100
                }
              },
              data: {
                nodeMeta: {
                  ...COZE_TIME_DELAY_NODE_META
                },
                inputs: {
                  apiParam: createApiParamEntries(COZE_TIME_DELAY_PLUGIN_META),
                  inputParameters: [
                    {
                      name: 'seconds',
                      input: {
                        type: 'integer',
                        value: {
                          type: 'literal',
                          content: 10,
                          rawMeta: {
                            type: 2
                          }
                        }
                      }
                    }
                  ],
                  settingOnError: {
                    processType: 1,
                    timeoutMs: 180000,
                    retryTimes: 0
                  }
                },
                outputs: COZE_TIME_DELAY_EXTERNAL_DATA.outputs
              },
              _temp: {
                bounds: {
                  x: 1190.362559478161,
                  y: -229.75263794564313,
                  width: 360,
                  height: 112
                },
                externalData: {
                  ...COZE_TIME_DELAY_EXTERNAL_DATA
                }
              }
            },
            {
              id: '134581',
              type: '4',
              meta: {
                position: {
                  x: 423.9478895979671,
                  y: 99.99999999999999
                }
              },
              data: {
                nodeMeta: {
                  ...COZE_DIGITAL_HUMAN_STATUS_NODE_META
                },
                inputs: {
                  apiParam: createApiParamEntries(COZE_DIGITAL_HUMAN_STATUS_PLUGIN_META),
                  inputParameters: [
                    createRefInputParameter('task_id', '101578', 'task_id')
                  ],
                  settingOnError: {
                    processType: 1,
                    timeoutMs: 180000,
                    retryTimes: 0
                  }
                },
                outputs: COZE_DIGITAL_HUMAN_STATUS_EXTERNAL_DATA.outputs
              },
              _temp: {
                bounds: {
                  x: 1614.310449076128,
                  y: -229.75263794564313,
                  width: 360,
                  height: 112
                },
                externalData: {
                  ...COZE_DIGITAL_HUMAN_STATUS_EXTERNAL_DATA
                }
              }
            },
            {
              id: '134582',
              type: '8',
              meta: {
                position: {
                  x: 909.9153392979259,
                  y: 88
                }
              },
              data: {
                nodeMeta: {
                  ...COZE_CONDITION_NODE_META
                },
                inputs: {
                  branches: [
                    {
                      condition: {
                        logic: 2,
                        conditions: [
                          {
                            operator: 10,
                            left: {
                              input: createRefValue('134581', 'digital_human_url')
                            }
                          }
                        ]
                      }
                    }
                  ]
                }
              },
              _temp: {
                bounds: {
                  x: 2100.277898776087,
                  y: -241.75263794564313,
                  width: 360,
                  height: 138
                },
                externalData: {
                  icon: COZE_CONDITION_NODE_META.icon,
                  description: COZE_CONDITION_NODE_META.description,
                  title: COZE_CONDITION_NODE_META.title,
                  mainColor: COZE_CONDITION_NODE_META.mainColor
                }
              }
            },
            {
              id: '134583',
              type: '20',
              meta: {
                position: {
                  x: 1395.8827889978845,
                  y: 99.99999999999999
                }
              },
              data: {
                inputs: {
                  inputParameters: [
                    {
                      left: createRefValue('101579', 'result'),
                      right: createRefValue('134581', 'digital_human_url')
                    }
                  ]
                },
                nodeMeta: {
                  ...COZE_LOOP_SET_VARIABLE_NODE_META
                }
              },
              _temp: {
                bounds: {
                  x: 2586.2453484760455,
                  y: -229.75263794564313,
                  width: 360,
                  height: 86
                },
                externalData: {
                  icon: COZE_LOOP_SET_VARIABLE_NODE_META.icon,
                  description: COZE_LOOP_SET_VARIABLE_NODE_META.description,
                  title: COZE_LOOP_SET_VARIABLE_NODE_META.title,
                  mainColor: COZE_LOOP_SET_VARIABLE_NODE_META.mainColor
                }
              }
            }
          ],
          edges: [
            { sourceNodeID: '101579', targetNodeID: '134580', sourcePortID: 'loop-function-inline-output' },
            { sourceNodeID: '134580', targetNodeID: '134581' },
            { sourceNodeID: '134581', targetNodeID: '134582' },
            { sourceNodeID: '134582', targetNodeID: '134583', sourcePortID: 'true' },
            { sourceNodeID: '134582', targetNodeID: '101579', sourcePortID: 'false', targetPortID: 'loop-function-inline-input' },
            { sourceNodeID: '134583', targetNodeID: '101579', targetPortID: 'loop-function-inline-input' }
          ],
          _temp: {
            bounds: {
              x: 1190.362559478161,
              y: -329.75263794564313,
              width: 360,
              height: 112
            },
            externalData: {
              icon: COZE_LOOP_NODE_META.icon,
              description: COZE_LOOP_NODE_META.description,
              title: '循环',
              mainColor: COZE_LOOP_NODE_META.mainColor
            }
          }
        }
      ],
      edges: [
        { sourceNodeID: '101578', targetNodeID: '101579' }
      ]
    },
    bounds: {
      x: 708.6009912829397,
      y: -329.75263794564313,
      width: 1021.7615681952214,
      height: 112
    }
  }, null, 2);
};

export const buildAudioAddRequestCozeClipboardData = (audioAddRequest = {}) => {
  const inputParameters = createAudioAddRequestInputParameters(audioAddRequest);

  return JSON.stringify({
    type: 'coze-workflow-clipboard-data',
    source: {
      workflowId: '7582120367239004166',
      flowMode: 0,
      spaceId: '7472683780642258985',
      isDouyin: false,
      host: 'www.coze.cn'
    },
    json: {
      nodes: [
        {
          id: '197307',
          type: '4',
          meta: {
            position: {
              x: 848.2424768184158,
              y: -527.5775080344873
            }
          },
          data: {
            nodeMeta: {
              ...COZE_ADD_AUDIO_NODE_META
            },
            inputs: {
              apiParam: createApiParamEntries(COZE_ADD_AUDIO_PLUGIN_META),
              inputParameters,
              settingOnError: {
                processType: 1,
                timeoutMs: 180000,
                retryTimes: 0
              }
            },
            outputs: COZE_ADD_AUDIO_EXTERNAL_DATA.outputs
          },
          _temp: {
            bounds: {
              x: 668.2424768184158,
              y: -527.5775080344873,
              width: 360,
              height: 112
            },
            externalData: {
              ...COZE_ADD_AUDIO_EXTERNAL_DATA
            }
          }
        }
      ],
      edges: []
    },
    bounds: {
      x: 668.2424768184158,
      y: -527.5775080344873,
      width: 360,
      height: 112
    }
  }, null, 2);
};

export const buildImageAddRequestCozeClipboardData = (imageAddRequest = {}) => {
  const inputParameters = createImageAddRequestInputParameters(imageAddRequest);

  return JSON.stringify({
    type: 'coze-workflow-clipboard-data',
    source: {
      ...COZE_WORKFLOW_SOURCE
    },
    json: {
      nodes: [
        {
          id: '152017',
          type: '4',
          meta: {
            position: {
              x: 524.411698000885,
              y: -281.8481507072602
            }
          },
          data: {
            nodeMeta: {
              ...COZE_ADD_IMAGE_NODE_META
            },
            inputs: {
              apiParam: createApiParamEntries(COZE_ADD_IMAGE_PLUGIN_META),
              inputParameters,
              settingOnError: {
                processType: 1,
                timeoutMs: 180000,
                retryTimes: 0
              }
            },
            outputs: COZE_ADD_IMAGE_EXTERNAL_DATA.outputs
          },
          _temp: {
            bounds: {
              x: 344.41169800088505,
              y: -281.8481507072602,
              width: 360,
              height: 112
            },
            externalData: {
              ...COZE_ADD_IMAGE_EXTERNAL_DATA
            }
          }
        }
      ],
      edges: []
    },
    bounds: {
      x: 344.41169800088505,
      y: -281.8481507072602,
      width: 360,
      height: 112
    }
  }, null, 2);
};
