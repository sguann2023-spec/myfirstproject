import { normalizeAttachmentPurpose } from './attachmentPurpose';

export const ATTACHMENT_PROMPTS = {
  reference: '实际观看并拆解参考视频的文案结构、字幕样式、画面风格、节奏、动画效果、配音、音效、背景音乐，明确发布平台与受众，制作一条新的视频。先列素材缺口，按需实际向我要、搜索或AI生成，说明来源、使用条件和使用位置。无法获取时说明限制，不得假称完成。先出10—15秒样片并附对标画面对照，确认后做完整视频；保留可编辑素材和时间线，我满意并要求后再制作并导出剪映草稿，制作草稿这一步主要是模仿字幕样式和转场效果。',
  material: '完整理解素材、原声和时间戳，明确发布平台与受众。跨平台及全网搜索同类爆款，重点查抖音、视频号，并覆盖小红书、B站；按内容形式和受众匹配，让我确认一个主对标，本地文件或者链接都可以。实际观看对标，拆解镜头作用、切换、字幕、排版、构图、节奏、调性及声音设计。按成片叙事与声画节奏编排，不照搬原片或对标时间线。逐镜列缺口，向我索取、搜索或用AI生成补齐，注明来源、使用条件和位置。样片须呈现关键画面与切换；未经我确认不得删换，不以代码图卡代替。无法获取时说明限制，不得假称完成。先出10—15秒样片并附对标画面对照，确认后做完整视频；保留可编辑素材和时间线，我满意并要求后再制作并导出剪映草稿，制作草稿这一步主要是模仿字幕样式和转场效果。',
  both: '完整理解素材、原声和时间戳，明确发布平台与受众。以我提供的参考视频作为对标，实际观看对标，拆解镜头作用、切换、字幕、排版、构图、节奏、调性及声音设计。按成片叙事与声画节奏编排，不照搬原片或对标时间线。逐镜列缺口，向我索取、搜索或用AI生成补齐，注明来源、使用条件和位置。样片须呈现关键画面与切换；未经我确认不得删换，不以代码图卡代替。无法获取时说明限制，不得假称完成。无法获取时说明限制，不得假称完成。先出10—15秒样片并附对标画面对照，确认后做完整视频；保留可编辑素材和时间线，我满意并要求后再制作并导出剪映草稿，制作草稿这一步主要是模仿字幕样式和转场效果。',
};

export function getAttachmentPrompt(files = []) {
  const purposes = new Set(files.map((file) => normalizeAttachmentPurpose(file?.purpose)));
  if (purposes.has('reference') && purposes.has('material')) return ATTACHMENT_PROMPTS.both;
  if (purposes.has('reference')) return ATTACHMENT_PROMPTS.reference;
  if (purposes.has('material')) return ATTACHMENT_PROMPTS.material;
  return '';
}

export function shouldReplaceAttachmentPrompt(text, previousPrompt, hasInlineNodes = false) {
  if (hasInlineNodes) return false;
  return !text || Boolean(previousPrompt && text === previousPrompt);
}
