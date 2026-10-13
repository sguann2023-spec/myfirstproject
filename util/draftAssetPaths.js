const path = require('path');

// Jianying's draft-root marker is fixed, independent of each draft's ID.
const DRAFT_PATH_PLACEHOLDER = '##_draftpath_placeholder_0E685133-18CE-45ED-8CB8-2904A212EC80_##';

function createDraftAssetPathReplacer(draftPath) {
  const assetsPath = `${path.resolve(draftPath).replace(/\\/g, '/')}/assets/`;
  const compare = process.platform === 'win32'
    ? (value) => value.toLowerCase()
    : (value) => value;

  return (key, value) => {
    if (typeof value !== 'string' || !/(?:^|_)path$|^(?:image|album_image)$/.test(key)) {
      return value;
    }
    const normalized = value.replace(/\\/g, '/');
    if (!compare(normalized).startsWith(compare(assetsPath))) {
      return value;
    }
    // Reject paths that escape assets after normalization.
    const resolved = path.resolve(normalized).replace(/\\/g, '/');
    if (!compare(resolved).startsWith(compare(assetsPath))) {
      return value;
    }
    return `${DRAFT_PATH_PLACEHOLDER}/assets/${resolved.slice(assetsPath.length)}`;
  };
}

module.exports = { DRAFT_PATH_PLACEHOLDER, createDraftAssetPathReplacer };
