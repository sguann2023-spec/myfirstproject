import VideoScript from '../../../../../public/video_script.svg';
import AuthorCommentIcon from '../../../../../public/auth_comment.svg';
import RevertPromptIcon from '../../../../../public/revert_prompt.svg';
import KouboIcon from '../../../../../public/koubo_icon.svg';
import TagIcon from '../../../../../public/tag_icon.svg';
import TitleIcon from '../../../../../public/title_icon.svg';
import ZhongcaoIcon from '../../../../../public/zhongcao.svg';

export const AI_WRITE_PRESET_OPTIONS = [
  {
    id: 'short-video-script',
    label: '短视频脚本',
    icon: VideoScript,
    placeholder: '主题：[请输入] 受众：[请输入] 时长：[请输入] 风格：[请输入]',
    template: '主题：[请输入]\n受众：[请输入]\n时长：[请输入]\n风格：[请输入]',
    fields: ['主题', '受众', '时长', '风格'],
    description: '适合生成完整的视频脚本结构',
    instruction: '你是一名短视频文案策划，请根据我的需求输出一版可直接使用的短视频脚本，包含标题建议、开场钩子、正文分段和结尾行动引导。',
  },
  {
    id: 'voiceover-copy',
    label: '口播文案',
    icon: KouboIcon,
    placeholder: '行业：[请输入] 产品：[请输入] 时长：[请输入]',
    template: '行业：[请输入]\n产品：[请输入]\n时长：[请输入]',
    fields: ['行业', '产品', '时长'],
    description: '适合生成真人出镜或配音朗读的口播文案',
    instruction: '你是一名口播文案策划，请根据我的需求输出一版自然顺口、适合真人出镜或配音朗读的口播文案，包含开场吸引、中段表达和结尾收束。',
  },
  {
    id: 'social-post',
    label: '种草文案',
    icon: ZhongcaoIcon,
    placeholder: '产品：[请输入] 卖点：[请输入] 目标人群：[请输入]',
    template: '产品：[请输入]\n卖点：[请输入]\n目标人群：[请输入]',
    fields: ['产品', '卖点', '目标人群'],
    description: '适合商品推荐和品牌种草',
    instruction: '你是一名擅长转化的种草文案作者，请根据我的需求输出一版有吸引力、强调利益点和场景感的种草文案，语言自然，避免空话。',
  },
  {
    id: 'headline-hooks',
    label: '爆款标题',
    icon: TitleIcon,
    placeholder: '主题：[请输入] 内容方向：[请输入]',
    template: '主题：[请输入]\n内容方向：[请输入]',
    fields: ['主题', '内容方向'],
    description: '适合生成标题和开场金句',
    instruction: '你是一名新媒体标题策划，请根据我的需求生成一组高点击率标题，并补充 3 句可直接开场使用的钩子文案。',
  },
  {
    id: 'author-comment',
    label: '作者评价',
    icon: AuthorCommentIcon,
    placeholder: '内容主题：[请输入] 作者人设：[请输入] 语气：[请输入]',
    template: '内容主题：[请输入]\n作者人设：[请输入]\n语气：[请输入]',
    fields: ['内容主题', '作者人设', '语气'],
    description: '适合生成作者在评论区里的评论',
    instruction: '你是一名擅长评论区运营的内容作者，请根据我的需求生成适合作者发布在评论区的评论文案，要求自然、真实，能强化互动和观点表达。',
  },
  {
    id: 'content-tag',
    label: '标签',
    icon: TagIcon,
    placeholder: '主题：[请输入] 内容类型：[请输入] 平台：[请输入]',
    template: '主题：[请输入]\n内容类型：[请输入]\n平台：[请输入]',
    fields: ['主题', '内容类型', '平台'],
    description: '适合生成内容标签',
    instruction: '你是一名内容运营，请根据我的需求生成一组适合发布内容时使用的标签，要求覆盖核心主题、内容类型和潜在流量词，并输出多档可选组合。',
  },
  {
    id: 'reverse-prompt',
    label: '反推提示词',
    icon: RevertPromptIcon,
    placeholder: '视频分享链接：[请输入]',
    template: '视频分享链接：[请输入]',
    fields: ['视频分享链接'],
    description: '适合模仿已有视频反推提示词',
    instruction: '根据下面信息生成反推提示词：',
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
