const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('path');
const { DRAFT_PATH_PLACEHOLDER, createDraftAssetPathReplacer } = require('./draftAssetPaths');

const draftPath = path.resolve('fixtures', 'draft');
const placeholder = DRAFT_PATH_PLACEHOLDER;
const replacer = createDraftAssetPathReplacer(draftPath);
const asset = (...parts) => path.join(draftPath, 'assets', ...parts);
const serialize = (value) => JSON.parse(JSON.stringify(value, replacer));

test('uses the fixed Jianying marker for drafts with different IDs', () => {
  assert.equal(placeholder, '##_draftpath_placeholder_0E685133-18CE-45ED-8CB8-2904A212EC80_##');
  for (const id of ['DRAFT-A', 'DRAFT-B']) {
    const saved = serialize({ id, path: asset('audio', 'voice.mp3') });
    assert.equal(saved.id, id);
    assert.equal(saved.path, `${placeholder}/assets/audio/voice.mp3`);
  }
});

test('converts main and nested asset references without mutating source paths', () => {
  const audio = { path: asset('audio', 'voice.mp3'), replace_path: asset('audio', 'voice.mp3') };
  const script = {
    path: draftPath,
    materials: {
      audios: [audio],
      drafts: [{ draft: { materials: { videos: [{ path: asset('video', 'clip.mp4') }] } } }]
    }
  };
  const saved = serialize(script);
  assert.equal(saved.materials.audios[0].path, `${placeholder}/assets/audio/voice.mp3`);
  assert.equal(saved.materials.audios[0].replace_path, saved.materials.audios[0].path);
  assert.equal(saved.materials.drafts[0].draft.materials.videos[0].path, `${placeholder}/assets/video/clip.mp4`);
  assert.equal(saved.path, draftPath);
  assert.equal(audio.path, asset('audio', 'voice.mp3'));
});

test('preserves external paths, URLs, existing placeholders and non-path strings', () => {
  const values = {
    path: path.resolve('external', 'clip.mp4'),
    replace_path: `${draftPath}-other/assets/video/clip.mp4`,
    remote_url: 'https://example.com/video.mp4',
    media_path: `${placeholder}/assets/video/clip.mp4`,
    name: asset('audio', 'voice.mp3'),
    content: JSON.stringify({ path: asset('audio', 'voice.mp3') })
  };
  assert.deepEqual(serialize(values), values);
});

test('handles image and effect paths and prevents traversal outside assets', () => {
  const saved = serialize({
    image: asset('image', 'background.png'),
    resource_path: asset('textTemplate', '123', 'font.ttf'),
    path: `${draftPath}/assets/../outside.mp4`
  });
  assert.equal(saved.image, `${placeholder}/assets/image/background.png`);
  assert.equal(saved.resource_path, `${placeholder}/assets/textTemplate/123/font.ttf`);
  assert.equal(saved.path, `${draftPath}/assets/../outside.mp4`);
});
