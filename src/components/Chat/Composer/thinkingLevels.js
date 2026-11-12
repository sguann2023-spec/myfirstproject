export const normalizeThinkingLevels = (levels) => [...new Set((Array.isArray(levels) ? levels : [])
  .filter((level) => typeof level === 'string')
  .map((level) => level.trim().toLowerCase()).filter(Boolean))];

export const resolveThinkingLevel = (option, preference) => {
  const levels = normalizeThinkingLevels(option?.thinking_levels);
  if (!levels.length) return undefined;
  if (levels.includes(preference)) return preference;
  return levels.includes(option?.thinking_default) ? option.thinking_default : levels[0];
};

export const thinkingLevelLabel = (level) => ({
  off: '关闭', none: '关闭', on: '开启', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最高',
}[level] || level);

// Queue restoration is an exact snapshot, including the absence of a setting.
export const thinkingSendOptions = (option, preference, restoredOptions) => restoredOptions
  ? {}
  : { thinkingLevel: resolveThinkingLevel(option, preference) };
