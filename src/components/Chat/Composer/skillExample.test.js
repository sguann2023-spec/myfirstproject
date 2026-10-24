import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SKILL_EXAMPLE_APPLY_EVENT,
  SKILL_EXAMPLE_FILENAME,
  buildSkillExampleApplyDetail,
  clearPendingSkillExample,
  consumePendingSkillExample,
  dispatchSkillExampleApply,
  formatSkillExampleCountHint,
  formatSkillExampleDuration,
  loadSkillExample,
  parseSkillExample,
  stashPendingSkillExample
} from './skillExample.js';

const buildExamplePayload = (overrides = {}) => ({
  schema_version: '1.0.0',
  skill_name: 'food-short-video-replication',
  title: '新鲜天麻炖排骨',
  display_info: { title: '新鲜天麻炖排骨', followers_count: '27.9万' },
  parameters: {
    model: { type: 'string', label: '执行模型', default: 'gpt-5.6-sol' },
    prompt: { type: 'string', label: '示例提示词', default: '参数默认提示词' },
    videos: {
      type: 'video_groups',
      groups: [
        { id: 'finished_food', label: '成品特写', type: 'array', item_type: 'video', required: true, min_count: 1, max_count: 4 },
        { id: 'cooking', label: '下锅揭盖', type: 'array', item_type: 'video', required: false, min_count: 0, max_count: 1 }
      ]
    }
  },
  inputs: {
    model: 'gpt-5.6-sol',
    prompt: '帮我剪一条竖屏美食短视频',
    videos: {
      finished_food: [
        {
          id: 'soup_a_01',
          label: '成品特写',
          filename: 'soup_a_01.mp4',
          uri: 'https://example.com/soup_a_01.mp4',
          duration_seconds: 5.066667,
          continuity_group: 'soup_a',
          description: '用于开场和收尾'
        },
        {
          id: 'soup_b_01',
          filename: 'soup_b_01.mp4',
          uri: 'https://example.com/soup_b_01.mp4'
        }
      ],
      cooking: [
        {
          id: 'soup_a_04',
          filename: 'soup_a_04.mp4',
          uri: 'https://example.com/soup_a_04.mp4',
          duration_seconds: 5
        }
      ]
    }
  },
  ...overrides
});

beforeEach(() => {
  clearPendingSkillExample();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.api;
});

describe('parseSkillExample', () => {
  it('normalizes object payloads with grouped videos', () => {
    const example = parseSkillExample(buildExamplePayload());

    expect(example).not.toBeNull();
    expect(example.skillName).toBe('food-short-video-replication');
    expect(example.title).toBe('新鲜天麻炖排骨');
    expect(example.prompt).toBe('帮我剪一条竖屏美食短视频');
    expect(example.model).toBe('gpt-5.6-sol');
    expect(example.videos).toHaveLength(3);

    const firstVideo = example.videos[0];
    expect(firstVideo).toMatchObject({
      groupId: 'finished_food',
      groupLabel: '成品特写',
      id: 'soup_a_01',
      filename: 'soup_a_01.mp4',
      uri: 'https://example.com/soup_a_01.mp4',
      durationSeconds: 5.066667,
      continuityGroup: 'soup_a',
      description: '用于开场和收尾'
    });

    const secondVideo = example.videos[1];
    expect(secondVideo.groupLabel).toBe('成品特写');
    expect(secondVideo.label).toBe('成品特写');

    const cookingVideo = example.videos[2];
    expect(cookingVideo.groupLabel).toBe('下锅揭盖');
  });

  it('collects group constraints in parameter order', () => {
    const example = parseSkillExample(buildExamplePayload());

    expect(example.groups).toHaveLength(2);
    expect(example.groups[0]).toMatchObject({
      id: 'finished_food',
      label: '成品特写',
      required: true,
      minCount: 1,
      maxCount: 4
    });
    expect(example.groups[1]).toMatchObject({
      id: 'cooking',
      label: '下锅揭盖',
      required: false,
      minCount: 0,
      maxCount: 1
    });
  });

  it('keeps input-only groups with a fallback label', () => {
    const payload = buildExamplePayload();
    payload.inputs.videos.extra_group = [
      { id: 'extra', filename: 'extra.mp4', uri: 'https://example.com/extra.mp4' }
    ];

    const example = parseSkillExample(payload);
    expect(example.groups).toHaveLength(3);
    expect(example.groups[2]).toMatchObject({
      id: 'extra_group',
      label: 'extra_group',
      required: false,
      minCount: 0,
      maxCount: null
    });
  });

  it('parses raw JSON strings', () => {
    const example = parseSkillExample(JSON.stringify(buildExamplePayload()));
    expect(example).not.toBeNull();
    expect(example.videos).toHaveLength(3);
  });

  it('falls back to parameter defaults when inputs omit prompt or model', () => {
    const payload = buildExamplePayload();
    delete payload.inputs.prompt;
    delete payload.inputs.model;

    const example = parseSkillExample(payload);
    expect(example.prompt).toBe('参数默认提示词');
    expect(example.model).toBe('gpt-5.6-sol');
  });

  it('uses the group id as label when the group definition is missing', () => {
    const payload = buildExamplePayload();
    payload.inputs.videos = {
      unknown_group: [
        { id: 'clip', filename: 'clip.mp4', uri: 'https://example.com/clip.mp4' }
      ]
    };

    const example = parseSkillExample(payload);
    expect(example.videos[0].groupLabel).toBe('unknown_group');
  });

  it('returns null for invalid payloads', () => {
    expect(parseSkillExample('not json')).toBeNull();
    expect(parseSkillExample(null)).toBeNull();
    expect(parseSkillExample('[]')).toBeNull();
  });

  it('returns null when the prompt or all videos are missing', () => {
    const withoutPrompt = buildExamplePayload();
    delete withoutPrompt.inputs.prompt;
    delete withoutPrompt.parameters.prompt;
    expect(parseSkillExample(withoutPrompt)).toBeNull();

    const withoutVideos = buildExamplePayload();
    withoutVideos.inputs.videos = {};
    expect(parseSkillExample(withoutVideos)).toBeNull();

    const withUrilessVideos = buildExamplePayload();
    withUrilessVideos.inputs.videos = {
      finished_food: [{ id: 'no-uri', filename: 'a.mp4' }]
    };
    expect(parseSkillExample(withUrilessVideos)).toBeNull();
  });
});

describe('formatSkillExampleCountHint', () => {
  it('formats required range hints', () => {
    expect(formatSkillExampleCountHint({ minCount: 1, maxCount: 4, required: true })).toBe('1-4个');
    expect(formatSkillExampleCountHint({ minCount: 2, maxCount: 2, required: true })).toBe('2个');
    expect(formatSkillExampleCountHint({ minCount: 1, maxCount: null, required: true })).toBe('至少1个');
  });

  it('marks optional groups', () => {
    expect(formatSkillExampleCountHint({ minCount: 0, maxCount: 1, required: false })).toBe('最多1个·可选');
    expect(formatSkillExampleCountHint({ minCount: 1, maxCount: 3, required: false })).toBe('1-3个·可选');
    expect(formatSkillExampleCountHint({ minCount: 0, maxCount: null, required: false })).toBe('');
  });
});

describe('formatSkillExampleDuration', () => {
  it('formats seconds as mm:ss', () => {
    expect(formatSkillExampleDuration(5.066667)).toBe('00:05');
    expect(formatSkillExampleDuration(65)).toBe('01:05');
    expect(formatSkillExampleDuration(0)).toBe('00:00');
    expect(formatSkillExampleDuration(undefined)).toBe('00:00');
  });
});

describe('loadSkillExample', () => {
  it('reads example.json by folder name first', async () => {
    const readSkillFile = vi.fn().mockResolvedValue({
      success: true,
      data: JSON.stringify(buildExamplePayload())
    });
    window.api = { skill: { readSkillFile } };

    const example = await loadSkillExample({ folderName: 'food-short-video-replication', id: 'skill-id', name: '美食短视频风格' });

    expect(example).not.toBeNull();
    expect(readSkillFile).toHaveBeenCalledTimes(1);
    expect(readSkillFile).toHaveBeenCalledWith('food-short-video-replication', SKILL_EXAMPLE_FILENAME);
  });

  it('resolves agent member skills that expose the folder as filename', async () => {
    const readSkillFile = vi.fn().mockResolvedValue({
      success: true,
      data: JSON.stringify(buildExamplePayload())
    });
    window.api = { skill: { readSkillFile } };

    const example = await loadSkillExample({ name: '美食短视频风格', filename: 'food-short-video-replication' });

    expect(example).not.toBeNull();
    expect(readSkillFile).toHaveBeenCalledTimes(1);
    expect(readSkillFile).toHaveBeenCalledWith('food-short-video-replication', SKILL_EXAMPLE_FILENAME);
  });

  it('falls back to the next identifier when a read fails', async () => {
    const readSkillFile = vi.fn()
      .mockRejectedValueOnce(new Error('missing'))
      .mockResolvedValueOnce({ success: true, data: null })
      .mockResolvedValueOnce({ success: true, data: JSON.stringify(buildExamplePayload()) });
    window.api = { skill: { readSkillFile } };

    const example = await loadSkillExample({ folderName: 'missing-folder', id: 'skill-id', name: '美食短视频风格' });

    expect(example).not.toBeNull();
    expect(readSkillFile).toHaveBeenCalledTimes(3);
    expect(readSkillFile).toHaveBeenNthCalledWith(1, 'missing-folder', SKILL_EXAMPLE_FILENAME);
    expect(readSkillFile).toHaveBeenNthCalledWith(2, 'skill-id', SKILL_EXAMPLE_FILENAME);
    expect(readSkillFile).toHaveBeenNthCalledWith(3, '美食短视频风格', SKILL_EXAMPLE_FILENAME);
  });

  it('returns null when no example resolves', async () => {
    window.api = { skill: { readSkillFile: vi.fn().mockResolvedValue({ success: true, data: null }) } };
    expect(await loadSkillExample({ folderName: 'plain-skill' })).toBeNull();
  });

  it('returns null without the skill api', async () => {
    expect(await loadSkillExample({ folderName: 'plain-skill' })).toBeNull();
  });
});

describe('apply detail lifecycle', () => {
  it('builds the detail payload from a parsed example', () => {
    const example = parseSkillExample(buildExamplePayload());
    const detail = buildSkillExampleApplyDetail(example, '美食短视频风格');

    expect(detail.skillName).toBe('food-short-video-replication');
    expect(detail.prompt).toBe('帮我剪一条竖屏美食短视频');
    expect(detail.model).toBe('gpt-5.6-sol');
    expect(detail.videos).toHaveLength(3);
    expect(detail.groups).toHaveLength(2);
    expect(detail.groups[0]).toMatchObject({ id: 'finished_food', label: '成品特写' });
  });

  it('falls back to the passed skill name', () => {
    const detail = buildSkillExampleApplyDetail({ prompt: 'p', model: 'm', videos: [] }, '美食短视频风格');
    expect(detail.skillName).toBe('美食短视频风格');
  });

  it('stashes and consumes the detail exactly once', () => {
    const detail = buildSkillExampleApplyDetail({ prompt: 'p', videos: [] });

    stashPendingSkillExample(detail);
    expect(consumePendingSkillExample()).toEqual(detail);
    expect(consumePendingSkillExample()).toBeNull();

    stashPendingSkillExample(detail);
    clearPendingSkillExample();
    expect(consumePendingSkillExample()).toBeNull();
  });

  it('dispatches the apply event and clears the stash when handled live', () => {
    const listener = vi.fn((event) => clearPendingSkillExample());
    window.addEventListener(SKILL_EXAMPLE_APPLY_EVENT, listener);

    const detail = buildSkillExampleApplyDetail({ prompt: 'p', videos: [] });
    stashPendingSkillExample(detail);
    dispatchSkillExampleApply(detail);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].detail).toEqual(detail);
    expect(consumePendingSkillExample()).toBeNull();

    window.removeEventListener(SKILL_EXAMPLE_APPLY_EVENT, listener);
  });
});
