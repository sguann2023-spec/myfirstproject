import { normalizeAttachmentPurpose } from './attachmentPurpose';

export const ATTACHMENT_PROMPTS = {
  reference: '模仿参考视频的文案结构、字幕样式、画面风格、节奏、动画效果、配音、音效、背景音乐，制作一条新的视频，如果音频、视频、画面的素材不够，你可以通过向我索要、搜索、AI生成的方式获取所需要的剪辑素材。第一步是直出视频，我确认画面、字幕、音频效果没问题了，第二步是做个剪映草稿给我看看，第二步主要是模仿字幕样式和转场效果',
  material: '我要处理这些素材，你要正确的理解素材的内容，去搜索各个社媒、全网的类似的爆款视频，然后模仿他的剪辑制作风格，同时根据我的要求，正确的处理素材，如果音频、视频、画面的素材不够，你可以通过向我索要、搜索、AI生成的方式获取所需要的剪辑素材。你可以先不着急做草稿，先做好视频让我看看效果，我确认没问题会让你制作剪映草稿',
  both: '模仿参考视频的文案结构、字幕样式、画面风格、节奏、动画效果、配音、音效、背景音乐，制作一条新的视频。我的素材也给到你了，你要正确的查看我提供的素材，准确的理解素材的内容，如果音频、视频、画面的素材不够，你可以通过向我索要、搜索、AI生成的方式获取所需要的剪辑素材。第一步是直出视频，我确认画面、字幕、音频效果没问题了，第二步是做个剪映草稿给我看看，第二步主要是模仿字幕样式和转场效果',
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
