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
    id: 'reverse-prompt',
    label: '反推提示词',
    iconName: 'undo-2',
    placeholder: '视频分享链接：[请输入]',
    template: '视频分享链接：[请输入]',
    fields: ['视频分享链接'],
    description: '适合模仿已有视频反推提示词',
    instruction: '根据下面信息生成反推提示词：',
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
