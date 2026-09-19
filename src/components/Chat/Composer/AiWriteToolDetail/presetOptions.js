import AiWriteIcon from '../../../../../public/ai_write.svg';
import TagIcon from '../../../../../public/tag_icon.svg';
import TitleIcon from '../../../../../public/title_icon.svg';

export const AI_WRITE_PRESET_OPTIONS = [
  {
    id: 'add-text',
    label: '添加文本',
    icon: AiWriteIcon,
    placeholder: '主题：[请输入] 风格：[请输入] 用途：[请输入]',
    template: '主题：[请输入]\n风格：[请输入]\n用途：[请输入]',
    fields: ['主题', '风格', '用途'],
    description: '适合生成可直接添加到视频里的文字内容',
    instruction: '你是一名视频文字助手，请根据我的需求输出可直接添加到视频里的文字内容，语言精炼自然，必要时提供多版备选。',
  },
  {
    id: 'add-keyframe',
    label: '添加关键帧',
    iconName: 'control',
    placeholder: '草稿ID：[请输入] 轨道名：[请输入] 属性：[请输入] 时间点：[请输入] 数值：[请输入]',
    template: '草稿ID：[请输入]\n轨道名：[请输入]\n属性：[请输入]\n时间点：[请输入]\n数值：[请输入]\n补充要求：[请输入]',
    fields: ['草稿ID', '轨道名', '属性', '时间点', '数值', '补充要求'],
    description: '适合给视频轨道添加缩放、位移、旋转等关键帧',
    instruction: '你是一名剪映草稿助手，请根据我的需求整理出清晰的关键帧添加要求，必要时补齐时间点、属性和值的表达。',
  },
  {
    id: 'batch-add',
    label: '批量添加',
    iconName: 'snippets',
    placeholder: '添加类型：[请输入] 素材/内容列表：[请输入] 时间规则：[请输入]',
    template: '添加类型：[请输入]\n素材/内容列表：[请输入]\n时间规则：[请输入]\n轨道要求：[请输入]\n补充要求：[请输入]',
    fields: ['添加类型', '素材/内容列表', '时间规则', '轨道要求', '补充要求'],
    description: '适合一次性批量添加多个文本、预设或素材片段',
    instruction: '你是一名剪映批量编排助手，请根据我的需求整理批量添加方案，明确每个元素的内容、顺序、时间和轨道要求。',
  },
  {
    id: 'text-template',
    label: '文字模版',
    iconName: 'file-text',
    placeholder: '主题：[请输入] 风格：[请输入] 关键词：[请输入] 用途：[请输入]',
    template: '主题：[请输入]\n风格：[请输入]\n关键词：[请输入]\n用途：[请输入]\n补充要求：[请输入]',
    fields: ['主题', '风格', '关键词', '用途', '补充要求'],
    description: '适合生成可复用的文字模版或花字样式需求',
    instruction: '你是一名视频包装文案助手，请根据我的需求生成适合剪辑场景的文字模版方案，兼顾风格、层级和上屏效果。',
  },
  {
    id: 'import-srt-subtitle',
    label: '导入SRT字幕',
    iconName: 'upload',
    placeholder: '草稿ID：[请输入] SRT文件路径/链接：[请输入] 样式要求：[请输入]',
    template: '草稿ID：[请输入]\nSRT文件路径/链接：[请输入]\n样式要求：[请输入]\n轨道要求：[请输入]\n补充要求：[请输入]',
    fields: ['草稿ID', 'SRT文件路径/链接', '样式要求', '轨道要求', '补充要求'],
    description: '适合把现成的 SRT 字幕文件导入到草稿里',
    instruction: '你是一名字幕导入助手，请根据我的需求整理 SRT 导入信息，并明确草稿、文件来源、样式和轨道要求。',
  },
  {
    id: 'recognize-subtitle',
    label: '识别字幕',
    iconName: 'file-search',
    placeholder: '音视频路径/链接：[请输入] 识别档位：[basic/nlp/llm/llm_vad] 输出要求：[请输入]',
    template: '音视频路径/链接：[请输入]\n识别档位：[basic/nlp/llm/llm_vad]\n输出要求：[请输入]\n补充要求：[请输入]',
    fields: ['音视频路径/链接', '识别档位', '输出要求', '补充要求'],
    description: '适合提取视频或音频里的字幕文本与时间轴',
    instruction: '你是一名字幕识别助手，请根据我的需求整理字幕识别任务，明确输入媒体、识别档位和期望输出。',
  },
  {
    id: 'remove-filler',
    label: '去气口',
    iconName: 'scissor',
    placeholder: '音视频路径/链接：[请输入] 去气口要求：[请输入] 输出目标：[请输入]',
    template: '音视频路径/链接：[请输入]\n去气口要求：[请输入]\n输出目标：[请输入]\n补充要求：[请输入]',
    fields: ['音视频路径/链接', '去气口要求', '输出目标', '补充要求'],
    description: '适合处理口播视频的停顿、气口和节奏压缩需求',
    instruction: '你是一名口播剪辑助手，请根据我的需求整理去气口任务，明确输入素材、处理要求和输出目标。',
  },
  {
    id: 'extract-highlights',
    label: '截取高光片段',
    iconName: 'star',
    placeholder: '音视频路径/链接：[请输入] 截取要求：[请输入] 输出目标：[请输入]',
    template: '音视频路径/链接：[请输入]\n截取要求：[请输入]\n输出目标：[请输入]\n补充要求：[请输入]',
    fields: ['音视频路径/链接', '截取要求', '输出目标', '补充要求'],
    description: '适合从音视频中筛选并截取精彩片段',
    instruction: '你是一名视频剪辑助手，请根据我的需求筛选并截取音视频中的高光片段，结合截取要求和输出目标，保留内容完整、重点突出且衔接自然的精彩片段。',
  },
  {
    id: 'reverse-prompt',
    label: '反推提示词',
    iconName: 'undo-2',
    placeholder: '粘贴视频分享链接或分享文案',
    template: '',
    fields: [],
    description: '适合模仿已有视频反推提示词',
  },
  {
    id: 'summarize-title',
    label: '总结标题',
    icon: TitleIcon,
    placeholder: '内容：[请输入] 风格：[请输入]',
    template: '内容：[请输入]\n风格：[请输入]',
    fields: ['内容', '风格'],
    description: '适合提炼视频或文案标题',
    instruction: '你是一名标题策划，请根据我的需求总结出适合传播的标题，输出多版可选结果。',
  },
  {
    id: 'summarize-tag',
    label: '总结标签',
    icon: TagIcon,
    placeholder: '内容：[请输入] 平台：[请输入]',
    template: '内容：[请输入]\n平台：[请输入]',
    fields: ['内容', '平台'],
    description: '适合提炼发布内容的标签',
    instruction: '你是一名内容运营，请根据我的需求总结出适合发布内容的标签，覆盖核心主题和流量词，并输出多组备选。',
  },
];

const DEFAULT_AI_WRITE_PRESET_ID = AI_WRITE_PRESET_OPTIONS[0].id;

export const getDefaultAiWritePresetId = () => DEFAULT_AI_WRITE_PRESET_ID;

export const getAiWritePresetById = (presetId) => (
  AI_WRITE_PRESET_OPTIONS.find((item) => item.id === presetId) || AI_WRITE_PRESET_OPTIONS[0]
);

export const getAiWritePlaceholder = (presetId) => getAiWritePresetById(presetId).placeholder;

export const getAiWriteTemplate = (presetId) => getAiWritePresetById(presetId).template || '';

export const getAiWriteFields = (presetId) => {
  const preset = getAiWritePresetById(presetId);
  return Array.isArray(preset.fields) ? preset.fields : [];
};
