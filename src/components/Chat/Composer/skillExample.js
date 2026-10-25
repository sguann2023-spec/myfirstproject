// Shared helpers for the skill usage-template format (example.json).
//
// A skill folder may ship an example.json describing one runnable example:
// typed parameters (including grouped video inputs), the example prompt that
// should be auto-filled into the chat input, and the remote video assets that
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

const collectVideoGroups = (parameters) => {
  const videoParameter = isPlainObject(parameters?.videos) ? parameters.videos : {};
  const groups = Array.isArray(videoParameter.groups) ? videoParameter.groups : [];
  const groupsById = new Map();
  groups.filter(isPlainObject).forEach((group) => {
    const groupId = String(group.id || '').trim();
    if (groupId) groupsById.set(groupId, group);
  });
  return groupsById;
};

const collectExampleGroups = (parameters, videosInput) => {
  const videoParameter = isPlainObject(parameters?.videos) ? parameters.videos : {};
  const groupDefinitions = Array.isArray(videoParameter.groups) ? videoParameter.groups : [];

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

const collectExampleVideos = (inputs, groupsById) => {
  const videosInput = isPlainObject(inputs?.videos) ? inputs.videos : {};
  const videos = [];

  Object.entries(videosInput).forEach(([groupId, groupFiles]) => {
    if (!Array.isArray(groupFiles)) return;
    const normalizedGroupId = String(groupId || '').trim();
    const group = groupsById.get(normalizedGroupId);
    const groupLabel = String(group?.label || '').trim() || normalizedGroupId;

    groupFiles.filter(isPlainObject).forEach((file) => {
      const uri = String(file.uri || '').trim();
      if (!uri) return;
      const filename = String(file.filename || '').trim();
      videos.push({
        groupId: normalizedGroupId,
        groupLabel,
        id: String(file.id || '').trim() || filename,
        label: String(file.label || '').trim() || groupLabel,
        filename,
        uri,
        durationSeconds: normalizeDurationSeconds(file.duration_seconds),
        continuityGroup: String(file.continuity_group || '').trim(),
        description: String(file.description || '').trim()
      });
    });
  });

  return videos;
};

// Returns a normalized example payload, or null when the skill does not ship a
// usable example (missing/invalid JSON, no prompt, or no video inputs).
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
  const videos = collectExampleVideos(inputs, collectVideoGroups(parameters));

  if (!prompt || videos.length === 0) return null;

  const displayInfo = isPlainObject(payload.display_info) ? payload.display_info : {};
  return {
    skillName: String(payload.skill_name || '').trim(),
    title: String(payload.title || displayInfo.title || '').trim(),
    prompt,
    model,
    groups: collectExampleGroups(parameters, inputs?.videos),
    videos
  };
};

// Reads example.json for an installed skill. Tries folder name, registry id
// and display name so both local and marketplace-installed skills resolve.
export const loadSkillExample = async (skill) => {
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
  videos: Array.isArray(example?.videos) ? example.videos : [],
  groups: Array.isArray(example?.groups) ? example.groups : []
});

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
