import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SKILL_EXAMPLE_APPLY_EVENT,
  SKILL_EXAMPLE_FILENAME,
  buildSkillExampleApplyDetail,
  buildSkillExampleGroupSlotId,
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
          url: 'https://example.com/soup_a_01.mp4',
          duration_seconds: 5.066667,
          continuity_group: 'soup_a',
          description: '用于开场和收尾'
        },
        {
          id: 'soup_b_01',
          filename: 'soup_b_01.mp4',
          url: 'https://example.com/soup_b_01.mp4'
        }
      ],
      cooking: [
        {
          id: 'soup_a_04',
          filename: 'soup_a_04.mp4',
          url: 'https://example.com/soup_a_04.mp4',
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
      url: 'https://example.com/soup_a_01.mp4',
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
      { id: 'extra', filename: 'extra.mp4', url: 'https://example.com/extra.mp4' }
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
        { id: 'clip', filename: 'clip.mp4', url: 'https://example.com/clip.mp4' }
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

  it('returns null when the prompt is missing', () => {
    const withoutPrompt = buildExamplePayload();
    delete withoutPrompt.inputs.prompt;
    delete withoutPrompt.parameters.prompt;
    expect(parseSkillExample(withoutPrompt)).toBeNull();
  });

  it('accepts prompt-only examples without media', () => {
    const example = parseSkillExample({ inputs: { prompt: '生成餐厅引流文案' } });
    expect(example).toMatchObject({ prompt: '生成餐厅引流文案', videos: [], groups: [] });
  });

  it('accepts empty video groups and preserves their constraints', () => {
    const payload = buildExamplePayload();
    payload.inputs.videos = {};
    const example = parseSkillExample(payload);
    expect(example.videos).toEqual([]);
    expect(example.groups).toHaveLength(2);
  });

  it('accepts image-only examples without requiring videos', () => {
    const example = parseSkillExample({
      inputs: {
        prompt: '用这张图生成餐厅视频',
        images: { hero: [{ url: 'https://example.com/hero.jpg' }] }
      }
    });
    expect(example).toMatchObject({ prompt: '用这张图生成餐厅视频', videos: [], images: [expect.objectContaining({ url: 'https://example.com/hero.jpg' })] });
  });

  it.each(['images', 'videos'])('normalizes legacy URI and prefers URL for %s', (kind) => {
    const example = parseSkillExample({ inputs: { prompt: '使用素材', [kind]: { hero: [
      { uri: 'https://example.com/legacy' },
      { url: ' https://example.com/preferred ', uri: 'https://example.com/ignored' },
      { url: '  ', uri: 'https://example.com/fallback' }
    ] } } });
    expect(example[kind].map((file) => file.url)).toEqual([
      'https://example.com/legacy', 'https://example.com/preferred', 'https://example.com/fallback'
    ]);
    expect(example[kind].every((file) => !Object.hasOwn(file, 'uri'))).toBe(true);
    expect(buildSkillExampleApplyDetail(example)[kind]).toEqual(example[kind]);
  });

  it('skips videos without a URL without rejecting the example', () => {
    const payload = buildExamplePayload();
    payload.inputs.videos = {
      finished_food: [{ id: 'no-uri', filename: 'a.mp4' }]
    };
    expect(parseSkillExample(payload).videos).toEqual([]);
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


describe('image example groups', () => {
  const payload = () => ({ parameters: { images: { type: 'image_groups', groups: [
    { id: 'hero', label: '主图', required: true, min_count: 1, max_count: 2 }
  ] } }, inputs: { prompt: '使用主图', images: { hero: [
    { id: 'cover', filename: 'hero.webp', url: 'https://example.com/hero.webp' }
  ] } } });
  it('parses image definitions, URLs and constraints through apply detail', () => {
    const example = parseSkillExample(JSON.stringify(payload()));
    expect(example.groups).toEqual([expect.objectContaining({ id: 'hero', kind: 'image', label: '主图', required: true, minCount: 1, maxCount: 2 })]);
    expect(example.images).toEqual([expect.objectContaining({ groupId: 'hero', groupLabel: '主图', filename: 'hero.webp', url: 'https://example.com/hero.webp' })]);
    expect(buildSkillExampleApplyDetail(example).images).toEqual(example.images);
    expect(example.videos).toEqual([]);
  });
  it('preserves empty groups and input-only groups, skipping invalid files', () => {
    const raw = payload();
    raw.inputs.images = { extra: [{ url: 'https://example.com/a.png' }, {}, null] };
    const example = parseSkillExample(raw);
    expect(example.groups.map(({ id, kind }) => [id, kind])).toEqual([['hero', 'image'], ['extra', 'image']]);
    expect(example.images).toHaveLength(1);
    expect(example.images[0].groupLabel).toBe('extra');
  });
  it('separates same-name image and video groups and unusual ids', () => {
    const raw = payload();
    raw.parameters.videos = { groups: [{ id: 'hero', label: '视频' }] };
    raw.inputs.videos = { hero: [{ url: 'https://example.com/v.mp4' }] };
    const example = parseSkillExample(raw);
    expect(example.groups).toHaveLength(2);
    expect(new Set(example.groups.map((g) => buildSkillExampleGroupSlotId(g.id, g.kind))).size).toBe(2);
    expect(buildSkillExampleGroupSlotId('hero', 'image')).not.toBe(buildSkillExampleGroupSlotId('image:hero', 'video'));
    expect(example.videos[0].groupLabel).toBe('视频');
  });
});


describe('Composer example attachment construction', () => {
  // Exercise the production helper without mounting the entire Electron editor.
  const source = readFileSync(`${process.cwd()}/src/components/Chat/Composer/Composer.js`, 'utf8');
  const helper = source.slice(source.indexOf('const createSkillExampleAttachmentEntries ='), source.indexOf('const renderFilePreviewContent ='));
  const create = new Function('buildSkillExampleGroupSlotId', 'createRemoteAttachmentEntry', 'guessFileTypeFromName', 'getRemoteMediaUrlFileName', 'formatSkillExampleDuration', `${helper}; return createSkillExampleAttachmentEntries;`)(
    buildSkillExampleGroupSlotId, async (entry) => ({ ...entry }),
    (name) => name.endsWith('.webp') ? 'image/webp' : 'text/plain',
    (url) => String(url).split('/').pop(), formatSkillExampleDuration
  );
  it('creates real image metadata and separates mixed group slots and identities', async () => {
    const entries = await create({ groups: [{ id: 'hero', kind: 'image' }, { id: 'hero', kind: 'video' }],
      images: [{ id: 'same', groupId: 'hero', url: 'https://example.com/a.webp' }],
      videos: [{ id: 'same', groupId: 'hero', url: 'https://example.com/a.mp4', durationSeconds: 3 }] });
    expect(entries.map((e) => e.fileType)).toEqual(['video/mp4', 'image/webp']);
    expect(new Set(entries.map((e) => e.uid)).size).toBe(2);
    expect(new Set(entries.map((e) => e.slotId)).size).toBe(2);
    expect(entries[0].durationLabel).toBe('00:03');
    expect(entries[1]).toMatchObject({ sourceType: 'skill_example', url: 'https://example.com/a.webp' });
  });
  it.each(['images', 'videos'])('accepts legacy URI and prefers URL when constructing %s', async (kind) => {
    const entries = await create({ [kind]: [
      { uri: 'https://example.com/legacy.webp' },
      { url: ' https://example.com/preferred.webp ', uri: 'https://example.com/ignored.png' },
      { url: ' ', uri: 'https://example.com/fallback.webp' }
    ] });
    expect(entries.map((entry) => entry.url)).toEqual([
      'https://example.com/legacy.webp', 'https://example.com/preferred.webp', 'https://example.com/fallback.webp'
    ]);
    expect(entries.map((entry) => entry.fileType)).toEqual(Array(3).fill(kind === 'images' ? 'image/webp' : 'video/mp4'));
  });
  it('handles prompt-only examples without creating attachments', async () => {
    expect(await create({ prompt: '只填文本' })).toEqual([]);
  });
});


describe('Composer typed group upload handling', () => {
  const source = readFileSync(`${process.cwd()}/src/components/Chat/Composer/Composer.js`, 'utf8');
  const branch = source.slice(source.indexOf('    if (skillExamplePendingGroup) {'), source.indexOf('    const uploadableFiles ='));
  const upload = new Function('skillExamplePendingGroup', 'resolvedAcceptedFiles', 'uploadedFileMeta', 'message',
    'pendingTemplateSlotAutoReferenceRef', 'getResolvedUploadFileType', 'createLocalAttachmentEntry', 'setUploadFileList', 'setUploadedFileMeta',
    `return (async () => { ${branch} })();`);
  const run = async (kind, files, existing = [], maxCount = 2) => {
    const message = { error: vi.fn() };
    let uploaded = [];
    let meta = [];
    await upload({ kind, slotId: 'target', label: '主图', maxCount }, files, existing, message, { current: 'target' },
      (file) => file.type, async (file) => ({ uploadItem: { uid: file.name }, fileMeta: { name: file.name, fileType: file.type } }),
      (update) => { uploaded = update([]); }, (update) => { meta = update([]); });
    return { message, uploaded, meta };
  };
  it('accepts images only and attaches them to their group', async () => {
    const result = await run('image', [{ name: 'a.png', type: 'image/png' }, { name: 'v.mp4', type: 'video/mp4' }]);
    expect(result.meta).toEqual([{ name: 'a.png', fileType: 'image/png', slotId: 'target', slotLabel: '主图', sourceType: 'skill_example' }]);
    expect(result.uploaded).toEqual([{ uid: 'a.png', slotId: 'target' }]);
  });
  it('rejects the wrong media type and preserves video upload support', async () => {
    const wrong = await run('image', [{ type: 'video/mp4' }]);
    expect(wrong.meta).toEqual([]);
    expect(wrong.message.error).toHaveBeenCalledWith('「主图」仅支持图片文件');
    const video = await run('video', [{ name: 'v.mp4', type: 'video/mp4' }, { type: 'image/png' }]);
    expect(video.meta).toHaveLength(1);
    expect(video.meta[0].fileType).toBe('video/mp4');
  });
  it('enforces max_count against existing group attachments', async () => {
    const files = [{ name: 'a.png', type: 'image/png' }, { name: 'b.png', type: 'image/png' }];
    const result = await run('image', files, [{ slotId: 'target' }]);
    expect(result.meta).toHaveLength(1);
    expect(result.message.error).toHaveBeenCalledWith('「主图」最多 2 个，已保留前 1 个');
    const full = await run('image', files, [{ slotId: 'target' }, { slotId: 'target' }]);
    expect(full.meta).toEqual([]);
    expect(full.message.error).toHaveBeenCalledWith('「主图」最多 2 个，请先移除后再添加');
  });
});
