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
