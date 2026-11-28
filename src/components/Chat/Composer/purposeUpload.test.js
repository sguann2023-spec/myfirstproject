import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const sourceText = readFileSync(resolve(process.cwd(), 'src/components/Chat/Composer/Composer.js'), 'utf8');
const source = ts.createSourceFile('Composer.jsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const find = (predicate) => {
  let result;
  const visit = (node) => {
    if (!result && predicate(node)) result = node;
    if (!result) ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
};
const handler = find((node) => ts.isVariableDeclaration(node) && node.name.getText(source) === 'handleBeforeUpload');
const callback = handler.initializer.arguments[0].getText(source);
const createHandler = (queueFilesForUpload) => runInNewContext(`(${callback})`, {
  queueFilesForUpload,
  AntUpload: { LIST_IGNORE: 'ignore' },
});

describe('purpose upload batch integration', () => {
  it.each(['reference', 'material'])('captures %s for a whole multi-file selection exactly once', (purpose) => {
    const queue = vi.fn();
    const beforeUpload = createHandler(queue);
    const files = [{ uid: 'a', name: 'a.png' }, { uid: 'b', name: 'b.mp4' }];
    for (const file of files) expect(beforeUpload(file, files, purpose)).toBe('ignore');
    expect(queue).toHaveBeenCalledExactlyOnceWith(files, { purpose });
  });

  it('does not leak the previous purpose into the next ordinary upload', () => {
    const queue = vi.fn();
    const beforeUpload = createHandler(queue);
    const reference = { uid: 'r' }, material = { uid: 'm' }, ordinary = { uid: 'o' };
    beforeUpload(reference, [reference], 'reference');
    beforeUpload(material, [material], 'material');
    beforeUpload(ordinary);
    expect(queue.mock.calls).toEqual([
      [[reference], { purpose: 'reference' }],
      [[material], { purpose: 'material' }],
      [[ordinary], { purpose: '' }],
    ]);
  });

  it('binds separate file pickers without storing purpose in a shared pending slot', () => {
    expect(sourceText).toContain("['reference', referenceUploadTriggerRef]");
    expect(sourceText).toContain("['material', materialUploadTriggerRef]");
    expect(sourceText).toContain('handleBeforeUpload(file, batch, purpose)');
    expect(sourceText).toContain("const isDefaultAttachmentMode = !activeTool && !skillExample && skillExampleGroups.length === 0");
    expect(sourceText).toContain('const showAttachmentUploadCards = uploadCardsEligible && isDefaultAttachmentMode && !attachmentPurposeGroups');
    expect(sourceText).toContain('fileGroups={attachmentPurposeGroups || skillExampleFileGroups}');
    expect(sourceText).toContain('enabled: isDefaultAttachmentMode && attachmentPromptSessionReady');
    expect(sourceText).toContain("const pendingSlotId = attachmentPurpose ? '' : String(pendingTemplateSlotAutoReferenceRef.current || '').trim()");
    expect(sourceText).not.toMatch(/pendingTemplateSlotAutoReferenceRef\.current\s*=\s*purpose/);
  });

  const uploadCardsCondition = find((node) => ts.isVariableDeclaration(node) && node.name.getText(source) === 'showAttachmentUploadCards').initializer.getText(source);
  const showUploadCards = (overrides = {}) => runInNewContext(uploadCardsCondition, {
    uploadCardsEligible: true,
    isDefaultAttachmentMode: true,
    attachmentPurposeGroups: null,
    uploadFileList: [],
    uploadedFileMeta: [],
    templatePickerOpen: false,
    partSplitDialogOpen: false,
    ...overrides,
  });

  it.each(['image/png', 'video/mp4', 'audio/mpeg', 'application/pdf', 'text/plain'])('hides upload cards for an ordinary %s attachment without a purpose', (fileType) => {
    expect(showUploadCards({ uploadedFileMeta: [{ uid: 'ordinary', fileType }] })).toBe(false);
  });

  it('hides upload cards as soon as a local upload item exists', () => {
    expect(showUploadCards({ uploadFileList: [{ uid: 'pending', status: 'uploading' }] })).toBe(false);
  });

  it('restores upload cards after removing all attachments only while still eligible', () => {
    const attachments = { uploadedFileMeta: [{ uid: 'ordinary', fileType: 'image/png' }] };
    expect(showUploadCards()).toBe(true);
    expect(showUploadCards(attachments)).toBe(false);
    expect(showUploadCards()).toBe(true);
    expect(showUploadCards({ uploadCardsEligible: false })).toBe(false);
  });

  it('keeps purpose in reference nodes, multimodal previews and deferred uploads', () => {
    expect(sourceText).toContain('purpose: normalizeAttachmentPurpose(overrides.purpose ?? file.purpose)');
    expect(sourceText).toContain("purpose: { default: '' }");
    expect(sourceText).toContain('purpose: normalizeAttachmentPurpose(item?.purpose)');
    const homepage = readFileSync(resolve(process.cwd(), 'src/page/HomePage/HomePage.jsx'), 'utf8');
    expect(homepage).toContain('purpose: normalizeAttachmentPurpose(item?.purpose)');
    expect(homepage).toContain('purpose: normalizeAttachmentPurpose(item.purpose || persisted.purpose)');
  });
});
