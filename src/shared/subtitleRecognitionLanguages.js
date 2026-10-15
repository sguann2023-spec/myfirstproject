export const SUBTITLE_RECOGNITION_LANGUAGE_OPTIONS = [
  { value: 'zh-CN', label: '中文普通话' },
  { value: 'en-US', label: '英语' },
  { value: 'ja-JP', label: '日语' },
  { value: 'id-ID', label: '印尼语' },
  { value: 'es-MX', label: '西班牙语' },
  { value: 'pt-BR', label: '葡萄牙语' },
  { value: 'de-DE', label: '德语' },
  { value: 'fr-FR', label: '法语' },
  { value: 'ko-KR', label: '韩语' },
  { value: 'fil-PH', label: '菲律宾语' },
  { value: 'ms-MY', label: '马来语' },
  { value: 'th-TH', label: '泰语' },
  { value: 'ar-SA', label: '阿拉伯语' },
  { value: 'it-IT', label: '意大利语' },
  { value: 'bn-BD', label: '孟加拉语' },
  { value: 'el-GR', label: '希腊语' },
  { value: 'nl-NL', label: '荷兰语' },
  { value: 'ru-RU', label: '俄语' },
  { value: 'tr-TR', label: '土耳其语' },
  { value: 'vi-VN', label: '越南语' },
  { value: 'pl-PL', label: '波兰语' },
  { value: 'ro-RO', label: '罗马尼亚语' },
  { value: 'ne-NP', label: '尼泊尔语' },
  { value: 'uk-UA', label: '乌克兰语' },
  { value: 'yue-CN', label: '粤语' },
];

export const SUBTITLE_RECOGNITION_LANGUAGES = SUBTITLE_RECOGNITION_LANGUAGE_OPTIONS.map(({ value }) => value);

export const normalizeSubtitleRecognitionLanguage = (value) => {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new Error('语言必须是字符串');
  const language = value.trim();
  if (language && !SUBTITLE_RECOGNITION_LANGUAGES.includes(language)) {
    throw new Error('请选择支持的识别语言');
  }
  return language;
};
