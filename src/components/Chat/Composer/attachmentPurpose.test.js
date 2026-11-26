import { describe, expect, it, vi } from 'vitest';
import {
  buildAttachmentPurposeGroups,
  buildPurposeAttachmentReferences,
  getAttachmentPurposeLabel,
  normalizeAttachmentPurpose,
} from './attachmentPurpose';

const headers = {
  reference: '【参考】\n以下文件用于参考风格、结构或内容：',
  material: '【素材】\n以下文件用于实际制作或编辑：',
};
const section = (purpose, ...entries) => `${headers[purpose]}\n${entries.map(entry => `- ${entry}`).join('\n')}`;
const buildReference = file => file.url ? `[${file.name}](${file.url})` : file.name ? `#${file.name}` : '';
const attachment = (uid, purpose) => ({ uid, name: `${uid}.mp4`, url: `file:///${uid}.mp4`, purpose });

describe('purpose attachment preview groups', () => {
  it('keeps upload cards when no classified attachments remain', () => {
    expect(buildAttachmentPurposeGroups()).toBeNull();
    expect(buildAttachmentPurposeGroups([{ name: '普通附件' }])).toBeNull();
  });
  it.each(['reference', 'material'])('renders both group tabs and an add action after a %s upload', (purpose) => {
    const file = attachment('one', purpose);
    const groups = buildAttachmentPurposeGroups([file, { name: '普通附件' }]);
    expect(groups.map((group) => [group.label, group.count])).toEqual(purpose === 'reference'
      ? [['参考', 1], ['素材', 0]] : [['参考', 0], ['素材', 1]]);
    expect(groups.flatMap((group) => group.files)).toEqual([file]);
    for (const group of groups) {
      expect(group.placeholder.purpose).toBe(group.key.split(':')[1]);
      expect(group.placeholder.label).toBe(`添加${group.label}`);
    }
  });
  it('groups multiple files without reclassifying them or changing identity', () => {
    const files = [attachment('r', 'reference'), attachment('m', 'material'), attachment('r2', 'reference')];
    const groups = buildAttachmentPurposeGroups(files);
    expect(groups.map((group) => group.count)).toEqual([2, 1]);
    expect(groups[0].files[0]).toBe(files[0]);
  });
});

// All combinations include legacy attachments with no purpose field.
describe('attachment purpose normalization', () => {
  it.each([
    ['reference', 'reference', '参考'],
    ['material', 'material', '素材'],
    [' REFERENCE ', 'reference', '参考'],
    [' Material\n', 'material', '素材'],
    ['', '', ''],
    ['unknown', '', ''],
    ['参考', '', ''],
    ['素材', '', ''],
    [undefined, '', ''],
    [null, '', ''],
    [0, '', ''],
    [false, '', ''],
    [{ purpose: 'reference' }, '', ''],
    [['material'], '', ''],
  ])('normalizes %j to %j and label %j', (value, purpose, label) => {
    expect(normalizeAttachmentPurpose(value)).toBe(purpose);
    expect(getAttachmentPurposeLabel(value)).toBe(label);
  });
});

describe('buildPurposeAttachmentReferences', () => {
  it.each([undefined, null, [], {}, 'not files'])('handles missing or invalid files: %j', files => {
    expect(buildPurposeAttachmentReferences(files)).toEqual([]);
  });

  it('ignores missing entries without passing them to the serializer', () => {
    const serialize = vi.fn(() => '');
    expect(buildPurposeAttachmentReferences([undefined, null, false, 'file', [], {}], { buildReference: serialize })).toEqual([]);
    expect(serialize).toHaveBeenCalledTimes(1);
    expect(serialize).toHaveBeenCalledWith({});
  });

  it.each([undefined, null, 'not a function'])('omits unserialized attachments when buildReference is %j', serialize => {
    expect(buildPurposeAttachmentReferences([
      attachment('old'), attachment('ref', 'reference'), attachment('mat', 'material'),
    ], { buildReference: serialize })).toEqual([]);
  });

  for (const purposes of [[], [undefined], ['reference'], ['material'], [undefined, 'reference'], [undefined, 'material'], ['reference', 'material'], [undefined, 'reference', 'material']]) {
    it(`supports purpose combination ${JSON.stringify(purposes)}`, () => {
      const files = purposes.map((purpose, index) => attachment(String(index), purpose));
      const expected = files.filter(file => !file.purpose).map(buildReference);
      for (const purpose of ['reference', 'material']) {
        const entries = files.filter(file => file.purpose === purpose).map(buildReference);
        if (entries.length) expected.push(section(purpose, ...entries));
      }
      expect(buildPurposeAttachmentReferences(files, { buildReference })).toEqual(expected);
    });
  }

  it('preserves legacy outputs verbatim and groups classified entries in stable order', () => {
    const files = [attachment('mat1', 'material'), attachment('old1'), attachment('ref1', 'reference'), attachment('old2', 'invalid'), attachment('mat2', 'material'), attachment('ref2', ' REFERENCE ')];
    const serialize = vi.fn(file => `  ${buildReference(file)}\nextra metadata\n`);
    expect(buildPurposeAttachmentReferences(files, { buildReference: serialize })).toEqual([
      serialize(files[1]), serialize(files[3]),
      section('reference', serialize(files[2]), serialize(files[5])),
      section('material', serialize(files[0]), serialize(files[4])),
    ]);
    expect(serialize.mock.calls.slice(0, files.length).map(([file]) => file)).toEqual(files);
  });

  it.each([undefined, 'reference', 'material'])('preserves image serialization for purpose %j', purpose => {
    const file = { uid: 'image', purpose, name: 'image [1].png', fileType: 'image/png', url: 'https://example.test/image.png', previewUrl: 'blob:preview' };
    const serialized = '[image [1\\].png](https://example.test/image.png)\n图像信息保持不变';
    const serialize = vi.fn(() => serialized);
    expect(buildPurposeAttachmentReferences([file], { buildReference: serialize })).toEqual([
      purpose ? section(purpose, serialized) : serialized,
    ]);
    expect(serialize).toHaveBeenCalledExactlyOnceWith(file);
  });

  it.each([undefined, 'reference', 'material'])('keeps pending-local placeholders for purpose %j', purpose => {
    const file = { uid: 'pending', name: '本地视频.mp4', fileType: 'video/mp4', purpose, file: { arrayBuffer() {} } };
    expect(buildPurposeAttachmentReferences([file], { buildReference })).toEqual([
      purpose ? section(purpose, '#本地视频.mp4') : '#本地视频.mp4',
    ]);
  });

  it.each(['reference', 'material'])('adds only filename purpose association for # referenced %s', purpose => {
    const file = attachment('hash', purpose);
    const serialize = vi.fn(buildReference);
    expect(buildPurposeAttachmentReferences([file], {
      referencedFileUids: new Set(['hash']), buildReference: serialize,
    })).toEqual([section(purpose, 'hash.mp4（已在正文中引用）')]);
    expect(serialize).not.toHaveBeenCalled();
  });

  it('handles mixed legacy, referenced and unreferenced classified files without repeated URLs', () => {
    const files = [attachment('old'), attachment('oldHash'), attachment('refHash', 'reference'), attachment('mat', 'material'), attachment('ref', 'reference'), attachment('matHash', 'material')];
    const serialize = vi.fn(buildReference);
    expect(buildPurposeAttachmentReferences(files, {
      referencedFileUids: new Set(['oldHash', 'refHash', 'matHash']), buildReference: serialize,
    })).toEqual([
      buildReference(files[0]),
      section('reference', 'refHash.mp4（已在正文中引用）', buildReference(files[4])),
      section('material', buildReference(files[3]), 'matHash.mp4（已在正文中引用）'),
    ]);
    expect(serialize.mock.calls.map(([file]) => file.uid)).toEqual(['old', 'mat', 'ref']);
  });

  it('normalizes numeric, string and padded uids for body references and duplicate detection', () => {
    const files = [attachment(0, 'reference'), attachment(' 0 ', 'reference'), attachment(7, 'material'), attachment('7', 'material'), attachment(' 8 '), attachment(8), attachment(9)];
    const serialize = vi.fn(buildReference);
    expect(buildPurposeAttachmentReferences(files, {
      referencedFileUids: new Set([' 0 ', 7, '9']), buildReference: serialize,
    })).toEqual([
      buildReference(files[4]),
      section('reference', '0.mp4（已在正文中引用）'),
      section('material', '7.mp4（已在正文中引用）'),
    ]);
    expect(serialize).toHaveBeenCalledExactlyOnceWith(files[4]);
  });

  it.each([undefined, 'reference', 'material'].flatMap(first =>
    [undefined, 'reference', 'material'].map(second => [first, second])
  ))('emits one reference for duplicate uid across purposes %j and %j', (first, second) => {
    const file = attachment('same', first);
    const serialize = vi.fn(buildReference);
    expect(buildPurposeAttachmentReferences([file, attachment('same', second)], {
      buildReference: serialize,
    })).toEqual([first ? section(first, buildReference(file)) : buildReference(file)]);
    expect(serialize).toHaveBeenCalledExactlyOnceWith(file);
  });

  it('does not merge distinct files without uids or files with the same name', () => {
    const files = [attachment(null, 'reference'), attachment(undefined, 'reference'), { name: 'same.mp4', purpose: 'material' }, { name: 'same.mp4', uid: 'other', purpose: 'material' }];
    expect(buildPurposeAttachmentReferences(files, { referencedFileUids: new Set([null, undefined, '']), buildReference })).toEqual([
      section('reference', buildReference(files[0]), buildReference(files[1])),
      section('material', '#same.mp4', '#same.mp4'),
    ]);
  });

  it('uses a filename fallback for already referenced files without a name or serializer', () => {
    expect(buildPurposeAttachmentReferences([{ uid: 'missing', purpose: 'reference' }], {
      referencedFileUids: new Set(['missing']),
    })).toEqual([section('reference', '附件（已在正文中引用）')]);
  });

  it.each([undefined, 'reference', 'material'])('skips voice_id with purpose %j, even if body referenced', purpose => {
    const serialize = vi.fn(buildReference);
    expect(buildPurposeAttachmentReferences([
      { ...attachment('voice', purpose), kind: 'voice_id' },
      { ...attachment('paddedVoice', purpose), kind: ' voice_id ' },
    ], { referencedFileUids: new Set(['voice']), buildReference: serialize })).toEqual([]);
    expect(serialize).not.toHaveBeenCalled();
  });

  it('omits empty serializer outputs and empty sections without losing later valid duplicates', () => {
    const files = [
      { uid: 'ref', purpose: 'reference', serialized: '' },
      { uid: 'ref', purpose: 'reference', serialized: '[valid](file:///valid)' },
      { uid: 'ref', purpose: 'material', serialized: '[duplicate](file:///duplicate)' },
      { uid: 'mat', purpose: 'material', serialized: ' \n' },
      { uid: 'old', serialized: undefined },
      { uid: 'old2', serialized: null },
      { uid: 'invalid', purpose: 'material', serialized: false },
    ];
    expect(buildPurposeAttachmentReferences(files, {
      buildReference: file => file.serialized,
    })).toEqual([section('reference', '[valid](file:///valid)')]);
  });

  it('does not mutate attachments, options, or the referenced uid set', () => {
    const files = Object.freeze([
      Object.freeze(attachment('a', 'reference')),
      Object.freeze(attachment('b', 'material')),
    ]);
    const referencedFileUids = new Set(['a']);
    const options = Object.freeze({ referencedFileUids, buildReference });
    const before = JSON.stringify(files);
    const first = buildPurposeAttachmentReferences(files, options);
    expect(buildPurposeAttachmentReferences(files, options)).toEqual(first);
    expect(JSON.stringify(files)).toBe(before);
    expect([...referencedFileUids]).toEqual(['a']);
  });
});
