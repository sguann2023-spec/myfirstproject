// Shared helpers for the skill usage-template format (example.json).
//
// A skill folder may ship an example.json describing one runnable example:
// typed parameters (including grouped image/video inputs), the example prompt that
// should be auto-filled into the chat input, and the remote media assets that
// should be attached when the user clicks 去使用 in the skill store.

export const SKILL_EXAMPLE_FILENAME = 'example.json';
export const SKILL_EXAMPLE_APPLY_EVENT = 'chat-apply-skill-example';

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

let pendingSkillExampleDetail = null;

const normalizeDurationSeconds = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0;
};

export const formatSkillExampleDuration = (durationInSeconds) => {
  const totalSeconds = Math.max(0, Math.floor(Number(durationInSeconds) || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const collectMediaGroups = (parameters, kind) => {
  const mediaParameter = isPlainObject(parameters?.[kind]) ? parameters[kind] : {};
  const groups = Array.isArray(mediaParameter.groups) ? mediaParameter.groups : [];
  const groupsById = new Map();
  groups.filter(isPlainObject).forEach((group) => {
    const groupId = String(group.id || '').trim();
    if (groupId) groupsById.set(groupId, group);
  });
  return groupsById;
};

const collectExampleGroups = (parameters, videosInput, kind) => {
  const mediaParameter = isPlainObject(parameters?.[kind]) ? parameters[kind] : {};
  const groupDefinitions = Array.isArray(mediaParameter.groups) ? mediaParameter.groups : [];

  const groups = [];
  const seenIds = new Set();
  groupDefinitions.filter(isPlainObject).forEach((group) => {
    const id = String(group.id || '').trim();
    if (!id || seenIds.has(id)) return;
    seenIds.add(id);
    const minCount = Number(group.min_count);
    const maxCount = Number(group.max_count);
    groups.push({
      id,
      label: String(group.label || '').trim() || id,
      required: group.required === true,
      minCount: Number.isFinite(minCount) && minCount >= 0 ? minCount : 0,
      maxCount: Number.isFinite(maxCount) && maxCount > 0 ? maxCount : null,
      description: String(group.description || '').trim()
    });
  });

  // Groups that only appear in inputs still render with their id as label.
  Object.keys(isPlainObject(videosInput) ? videosInput : {}).forEach((groupId) => {
    const id = String(groupId || '').trim();
    if (!id || seenIds.has(id)) return;
    seenIds.add(id);
    groups.push({ id, label: id, required: false, minCount: 0, maxCount: null, description: '' });
  });

  return groups;
};

// "1-4个" / "2个" / "最多3个·可选" — shown next to the group label so the
// slot doubles as a fill-in hint for how many clips belong there.
export const formatSkillExampleCountHint = (group = {}) => {
  const minCount = Number(group?.minCount);
  const maxCount = Number(group?.maxCount);
  const hasMin = Number.isFinite(minCount) && minCount >= 0;
  const hasMax = Number.isFinite(maxCount) && maxCount > 0;
  let hint = '';
  if (hasMin && hasMax && minCount === 0) hint = `最多${maxCount}个`;
  else if (hasMin && hasMax) hint = minCount === maxCount ? `${minCount}个` : `${minCount}-${maxCount}个`;
  else if (hasMax) hint = `最多${maxCount}个`;
  else if (hasMin && minCount > 0) hint = `至少${minCount}个`;
  if (hint && group?.required !== true) hint += '·可选';
  return hint;
};

const collectExampleMedia = (inputs, groupsById, kind) => {
  const videosInput = isPlainObject(inputs?.[kind]) ? inputs[kind] : {};
  const videos = [];

  Object.entries(videosInput).forEach(([groupId, groupFiles]) => {
    if (!Array.isArray(groupFiles)) return;
    const normalizedGroupId = String(groupId || '').trim();
    const group = groupsById.get(normalizedGroupId);
    const groupLabel = String(group?.label || '').trim() || normalizedGroupId;

    groupFiles.filter(isPlainObject).forEach((file) => {
      const url = String(file.url || '').trim() || String(file.uri || '').trim();
      if (!url) return;
      const filename = String(file.filename || '').trim();
      videos.push({
        groupId: normalizedGroupId,
        groupLabel,
        id: String(file.id || '').trim() || filename,
        label: String(file.label || '').trim() || groupLabel,
        filename,
        url,
        durationSeconds: normalizeDurationSeconds(file.duration_seconds),
        continuityGroup: String(file.continuity_group || '').trim(),
        description: String(file.description || '').trim()
      });
    });
  });

  return videos;
};

// Returns a normalized example payload, or null when the skill does not ship a
// usable example (missing/invalid JSON or no prompt).
export const parseSkillExample = (raw) => {
  let payload = raw;
  if (typeof raw === 'string') {
    try {
      payload = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isPlainObject(payload)) return null;

  const inputs = isPlainObject(payload.inputs) ? payload.inputs : {};
  const parameters = isPlainObject(payload.parameters) ? payload.parameters : {};
  const prompt = String(inputs.prompt ?? parameters?.prompt?.default ?? '').trim();
  const model = String(inputs.model ?? parameters?.model?.default ?? '').trim();
  const videos = collectExampleMedia(inputs, collectMediaGroups(parameters, 'videos'), 'videos');

  const images = collectExampleMedia(inputs, collectMediaGroups(parameters, 'images'), 'images');
  const audios = collectExampleMedia(inputs, collectMediaGroups(parameters, 'audios'), 'audios');

  if (!prompt) return null;

  const displayInfo = isPlainObject(payload.display_info) ? payload.display_info : {};
  return {
    skillName: String(payload.skill_name || '').trim(),
    title: String(payload.title || displayInfo.title || '').trim(),
    prompt,
    model,
    groups: [
      ...collectExampleGroups(parameters, inputs?.videos, 'videos').map((group) => ({ ...group, kind: 'video' })),
      ...collectExampleGroups(parameters, inputs?.images, 'images').map((group) => ({ ...group, kind: 'image' })),
      ...collectExampleGroups(parameters, inputs?.audios, 'audios').map((group) => ({ ...group, kind: 'audio' }))
    ],
    displayInfo,
    audios,
    images,
    videos
  };
};

// Template metadata is optional for ordinary skills.
export const readOptionalSkillExampleText = async (directoryPath) => {
  const filePath = `${directoryPath}/${SKILL_EXAMPLE_FILENAME}`;
  if (typeof window.api?.fs?.exists === 'function' && !await window.api.fs.exists(filePath)) return null;
  return window.api.fs.readText(filePath);
};

// Reads example.json for an installed skill. Tries folder name, registry id
// and display name so both local and marketplace-installed skills resolve.
export const loadSkillExample = async (skill) => {
  const directoryPath = String(skill?.directoryPath || skill?.__skillRoot || '').trim();
  if (directoryPath) {
    try {
      if (skill?.directoryPath && skill?.storageRelativePath && skill?.version) {
        const installedVersion = await window.api.fs.readText(`${directoryPath}/.version`);
        if (String(installedVersion).trim() !== skill.version) throw new Error('模版版本不一致，请重启后重试');
      }
      const raw = await readOptionalSkillExampleText(directoryPath);
      const example = parseSkillExample(raw);
      if (example) return example;
      if (skill?.title) throw new Error('模版参数无效，请更新后重试');
    } catch (error) {
      if (skill?.directoryPath && skill?.title) throw new Error(error?.message || '读取模版失败');
    }
    // An explicit source must never fall back to an installed copy of another version.
    if (skill?.directoryPath) return null;
  }
  const readSkillFile = window.api?.skill?.readSkillFile;
  if (typeof readSkillFile !== 'function') return null;

  // Agent skill lists expose the folder as `filename`; store/registry skills
  // use `folderName` or `id`.
  const skillIds = [skill?.folderName, skill?.filename, skill?.id, skill?.name]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  for (const skillId of skillIds) {
    try {
      const result = await readSkillFile(skillId, SKILL_EXAMPLE_FILENAME);
      if (!result?.success) continue;
      const example = parseSkillExample(result?.data);
      if (example) return example;
    } catch {
      // Try the next identifier.
    }
  }
  return null;
};

export const buildSkillExampleApplyDetail = (example, skillName = '') => ({
  skillName: String(example?.skillName || skillName || '').trim(),
  prompt: String(example?.prompt || '').trim(),
  model: String(example?.model || '').trim(),
  displayInfo: isPlainObject(example?.displayInfo) ? { ...example.displayInfo } : {},
  audios: Array.isArray(example?.audios) ? example.audios : [],
  images: Array.isArray(example?.images) ? example.images : [],
  videos: Array.isArray(example?.videos) ? example.videos : [],
  groups: Array.isArray(example?.groups) ? example.groups : []
});

export const formatSkillExampleEstimatedUsage = (value) => {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return '';
  const points = Number(value);
  return Number.isFinite(points) && points >= 0 ? `预估 ${points}积分` : '';
};

export const stashPendingSkillExample = (detail) => {
  pendingSkillExampleDetail = detail;
};

export const clearPendingSkillExample = () => {
  pendingSkillExampleDetail = null;
};

// Consumed when the chat composer mounts; the skill store lives in a separate
// pane, so the apply event usually fires before the composer exists.
export const consumePendingSkillExample = () => {
  const detail = pendingSkillExampleDetail;
  pendingSkillExampleDetail = null;
  return detail;
};

export const dispatchSkillExampleApply = (detail) => {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent(SKILL_EXAMPLE_APPLY_EVENT, { detail }));
};

// Namespace both media kinds so identical or prefixed group ids never mix.
export const buildSkillExampleGroupSlotId = (groupId, kind = 'video') =>
  `skill-example-group:${kind}:${String(groupId || '').trim()}`;

export const getSkillExampleUploadAccept = (kind) => (
  ['image', 'video', 'audio'].includes(kind) ? `${kind}/*` : undefined
);

// Keep the exact source prompt unless a skill mention is missing (legacy examples).
export const buildSkillExamplePrompt = (prompt, skillName) => {
  const text = String(prompt || '').trim().replace(/<你的门店\/菜品图路径>/g, '所附主参考图');
  const name = String(skillName || '').trim();
  return !name || text.includes(`@${name}`) ? text : `使用@${name} 技能，${text}`;
};

export const getSkillExampleValidationError = (groups, files, loading = false) => {
  if (loading) return '';
  for (const group of groups || []) {
    const slotId = group.slotId || buildSkillExampleGroupSlotId(group.id, group.kind);
    const count = (files || []).filter((file) => file.slotId === slotId).length;
    const minimum = group.required ? Math.max(1, group.minCount || 0) : group.minCount || 0;
    if ((group.required || count > 0) && count < minimum) return `${group.label}最少需要${minimum}个文件`;
    if (group.maxCount && count > group.maxCount) return `${group.label}最多添加${group.maxCount}个文件`;
  }
  return '';
};

export const resolveSkillExampleModel = (requested, options, fallback) => {
  const available = (options || []).filter((item) => item.value && !item.disabled);
  const normalized = (value) => String(value || '').toLowerCase().replace(/[-_.\s]/g, '');
  const exact = available.find((item) => normalized(item.value) === normalized(requested));
  if (exact) return exact.value;
  const family = (value) => String(value || '').toLowerCase().match(/^[a-z]+/)?.[0];
  const candidates = requested ? available.filter((item) => family(item.value) === family(requested)) : [];
  candidates.sort((a, b) => String(b.value).localeCompare(String(a.value), undefined, { numeric: true }));
  return candidates[0]?.value || available.find((item) => item.isDefault || item.is_default)?.value
    || available.find((item) => item.value === fallback)?.value || available[0]?.value || '';
};
