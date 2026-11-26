export function normalizeAttachmentPurpose(value) {
  const purpose = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return purpose === 'reference' || purpose === 'material' ? purpose : '';
}

export function getAttachmentPurposeLabel(value) {
  const purpose = normalizeAttachmentPurpose(value);
  return purpose === 'reference' ? '参考' : purpose === 'material' ? '素材' : '';
}

export function buildAttachmentPurposeGroups(files = []) {
  if (!files.some((file) => normalizeAttachmentPurpose(file?.purpose))) return null;
  return ['reference', 'material'].map((purpose) => {
    const groupFiles = files.filter((file) => normalizeAttachmentPurpose(file?.purpose) === purpose);
    const label = getAttachmentPurposeLabel(purpose);
    return {
      key: `attachment-purpose:${purpose}`,
      label,
      count: groupFiles.length,
      files: groupFiles,
      placeholder: { key: `attachment-purpose:${purpose}`, purpose, label: `添加${label}` },
    };
  });
}

const normalizeUid = (value) => String(value ?? '').trim();

// Keep reference serialization (including images and pending #filename placeholders)
// with the caller. This helper only adds purpose context to the final prompt.
export function buildPurposeAttachmentReferences(files, {
  referencedFileUids = new Set(),
  buildReference = () => '',
} = {}) {
  const referenced = new Set(Array.from(referencedFileUids || [], normalizeUid).filter(Boolean));
  const seen = new Set();
  const references = [];
  const groups = { reference: [], material: [] };

  for (const file of Array.isArray(files) ? files : []) {
    if (!file || typeof file !== 'object' || Array.isArray(file)) continue;
    if (String(file.kind || '').trim() === 'voice_id') continue;

    const uid = normalizeUid(file.uid);
    if (uid && seen.has(uid)) continue;
    const purpose = normalizeAttachmentPurpose(file.purpose);
    const alreadyReferenced = uid && referenced.has(uid);
    if (alreadyReferenced && !purpose) continue;

    const reference = alreadyReferenced
      ? `${String(file.name || '').trim() || '附件'}（已在正文中引用）`
      : typeof buildReference === 'function' ? buildReference(file) : '';
    if (typeof reference !== 'string' || !reference.trim()) continue;

    if (uid) seen.add(uid);
    if (purpose) groups[purpose].push(`- ${reference}`);
    else references.push(reference);
  }

  if (groups.reference.length) {
    references.push(`【参考】\n以下文件用于参考风格、结构或内容：\n${groups.reference.join('\n')}`);
  }
  if (groups.material.length) {
    references.push(`【素材】\n以下文件用于实际制作或编辑：\n${groups.material.join('\n')}`);
  }
  return references;
}
