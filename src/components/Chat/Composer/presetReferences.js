export const PRESET_PAGE_SIZE = 10;

export function getPresetReferenceRoot(folder, path) {
  if (typeof folder !== 'string' || !folder.trim() || !path.isAbsolute(folder)) return '';
  return path.join(folder, 'Combination', 'Presets');
}

export async function loadPresetReferencePage(listDirectory, rootPath, query = '', offset = 0) {
  const entries = await listDirectory(rootPath, {
    typed: true,
    recursive: false,
    includeHidden: false,
    includeFiles: false,
    includeDirectories: true,
    nameQuery: query.trim(),
    offset,
    maxEntries: PRESET_PAGE_SIZE + 1,
  });
  const directories = entries.filter((entry) => entry.type === 'directory');
  return {
    items: directories.slice(0, PRESET_PAGE_SIZE),
    hasMore: directories.length > PRESET_PAGE_SIZE,
  };
}
