export const normalizeThinkingLevels = (levels, preserveCase = false) => [...new Set((Array.isArray(levels) ? levels : [])
  .filter((level) => typeof level === 'string')
  .map((level) => preserveCase ? level.trim() : level.trim().toLowerCase()).filter(Boolean))];

export const resolveThinkingLevel = (option, preference) => {
  const levels = normalizeThinkingLevels(option?.thinking_levels, option?.isCustom);
  if (!levels.length) return undefined;
  if (levels.includes(preference)) return preference;
  return levels.includes(option?.thinking_default) ? option.thinking_default : levels[0];
};

export const thinkingLevelLabel = (level) => ({
  off: '关闭', none: '关闭', disabled: '关闭', false: '关闭', no: '关闭',
  nothink: '关闭', 'no-think': '关闭', no_think: '关闭',
  on: '开启', enabled: '开启', true: '开启', yes: '开启',
  minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最高', auto: '自动',
}[String(level || '').trim().toLowerCase()] || level);

// Queue restoration is an exact snapshot, including the absence of a setting.
export const thinkingSendOptions = (option, preference, restoredOptions) => restoredOptions
  ? {}
  : { thinkingLevel: resolveThinkingLevel(option, preference) };
