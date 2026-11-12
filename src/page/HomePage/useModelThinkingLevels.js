import { useCallback, useMemo } from 'react';

// Legacy global key; only read once by HomePage to migrate old installs into
// per-session preferences. Thinking levels now live on the chat session object.
export const MODEL_THINKING_LEVELS_KEY = 'capcut-helper-chat-model-thinking-levels-v1';

const levelsFor = (option) => (Array.isArray(option?.thinking_levels)
  ? option.thinking_levels.filter((level) => typeof level === 'string' && level.length > 0) : []);

const asSavedMap = (saved) => (saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {});

export function resolveModelThinkingLevels(saved, options) {
  const source = asSavedMap(saved);
  const result = {};
  for (const option of options) {
    const levels = levelsFor(option);
    if (!levels.length) continue;
    result[option.value] = levels.includes(source[option.value]) ? source[option.value]
      : levels.includes(option.thinking_default) ? option.thinking_default : levels[0];
  }
  return result;
}

// Session-bound thinking levels: raw per-model choices are stored on the active
// session; catalog defaults are resolved at render time so a changed catalog
// never leaves an invalid level selected.
export function useModelThinkingLevels({ options, savedLevels, onLevelsChange }) {
  const levels = useMemo(() => resolveModelThinkingLevels(savedLevels, options), [savedLevels, options]);
  const selectLevel = useCallback((modelId, level) => {
    const option = options.find((item) => item.value === modelId);
    if (!levelsFor(option).includes(level)) return;
    onLevelsChange?.(modelId, level);
  }, [options, onLevelsChange]);
  return [levels, selectLevel];
}