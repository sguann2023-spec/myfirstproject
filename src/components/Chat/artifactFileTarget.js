// Derive a savable file source and a file name from pinned artifact items
// (videos / images / audios / documents) shared by the artifact context menu handlers.

const stripUrlSuffix = (value) => String(value || '').trim().split(/[?#]/)[0];

const getBaseName = (value) => {
  const normalized = stripUrlSuffix(value).replace(/[\\/]+$/, '');
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  try {
    return decodeURIComponent(segments[segments.length - 1] || '');
  } catch {
    return segments[segments.length - 1] || '';
  }
};

// Prefer the local downloaded file; fall back to the artifact URL for saving.
export const getArtifactFileSource = (item) => String(
  item?.filePath || item?.videoUrl || item?.imageUrl || item?.audioUrl || item?.url || ''
).trim();

export const getArtifactFileName = (item) => {
  // Media items always derive their file name from the path: a registered audio
  // artifact carries the speech copy as `name`, which is not a file name and
  // would break the chip's file-type guess. Documents keep their display name.
  const isMedia = Boolean(
    item?.audioUrl || item?.videoUrl || item?.imageUrl || item?.type === 'video' || item?.type === 'image'
  );
  const explicitName = isMedia ? '' : String(item?.name || '').trim();
  if (explicitName) return explicitName;
  return getBaseName(getArtifactFileSource(item)) || '生成文件';
};

export const isLocalFileSource = (source) => Boolean(source) && !/^(https?:|data:|blob:)/i.test(source);

// Resolve a local filesystem path for the artifact (file:// URLs decoded), or '' when
// the artifact has no usable local file — e.g. for reveal-in-folder actions.
export const getArtifactLocalPath = (item) => {
  const source = getArtifactFileSource(item);
  if (!isLocalFileSource(source)) return '';
  if (/^file:/i.test(source)) {
    try {
      return decodeURIComponent(new URL(source).pathname).replace(/^\/([a-zA-Z]:)/, '$1');
    } catch {
      return '';
    }
  }
  return source;
};

// Build a Composer workspace-style file reference entry ({ rootPath, node }) for a
// local artifact file, matching the shape expected by inputRef.insertLocalFileReference.
export const createArtifactChatReference = (item) => {
  const source = getArtifactFileSource(item);
  if (!isLocalFileSource(source)) return null;
  const separator = Math.max(source.lastIndexOf('/'), source.lastIndexOf('\\'));
  if (separator <= 0) return null;
  const fileName = getArtifactFileName(item);
  return {
    rootPath: source.slice(0, separator),
    node: { path: source.slice(separator + 1) || fileName, name: fileName, type: 'file' }
  };
};
