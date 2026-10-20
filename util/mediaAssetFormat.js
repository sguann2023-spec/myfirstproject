const path = require('node:path');

const MEDIA_EXTENSIONS = new Set([
  '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif', '.heic', '.tif', '.tiff',
  '.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v', '.mpg', '.mpeg', '.ts', '.mts', '.m2ts',
  '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.aiff', '.aif', '.wma'
]);

function preserveMediaAssetFormat(type, material, source, targetPath) {
  if (!['image', 'video', 'audio'].includes(type) || !source || !targetPath) return targetPath;
  let sourcePath = source;
  if (/^(https?:|file:)/i.test(source)) {
    try {
      sourcePath = decodeURIComponent(new URL(source).pathname);
    } catch {
      return targetPath;
    }
  }
  const extension = path.posix.extname(sourcePath.replace(/\\/g, '/'));
  if (!MEDIA_EXTENSIONS.has(extension.toLowerCase())) return targetPath;
  const targetExtension = path.extname(targetPath);
  if (targetExtension === extension) return targetPath;
  const correctedPath = `${targetExtension ? targetPath.slice(0, -targetExtension.length) : targetPath}${extension}`;
  for (const key of ['name', 'material_name']) {
    if (typeof material?.[key] !== 'string' || !material[key]) continue;
    const oldExtension = path.extname(material[key]);
    material[key] = `${oldExtension ? material[key].slice(0, -oldExtension.length) : material[key]}${extension}`;
  }
  material.path = correctedPath;
  material.replace_path = correctedPath;
  return correctedPath;
}

module.exports = { preserveMediaAssetFormat };
