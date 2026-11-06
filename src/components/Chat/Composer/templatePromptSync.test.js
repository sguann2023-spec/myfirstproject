import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// Execute the Composer synchronization effect to reproduce a template event
// arriving before React commits the new controlled input value.
const source = readFileSync(`${process.cwd()}/src/components/Chat/Composer/Composer.js`, 'utf8');
const end = source.indexOf('  }, [editor, input, mentionHighlightRegex]);');
const start = source.lastIndexOf('  React.useEffect(() => {', end);
const effect = new Function('editor', 'input', 'pendingSkillExamplePromptRef', 'getEditorPlainText',
  source.slice(start + '  React.useEffect(() => {'.length, end));

describe('template prompt synchronization', () => {
  it('does not overwrite the new template editor with the previous render input', () => {
    const editor = { isDestroyed: false, commands: { setContent: vi.fn() } };
    const pending = { current: 'new template prompt' };
    effect(editor, 'previous template prompt', pending, () => 'new template prompt');
    expect(editor.commands.setContent).not.toHaveBeenCalled();
    expect(pending.current).toBe('new template prompt');
    effect(editor, 'new template prompt', pending, () => 'new template prompt');
    expect(pending.current).toBeNull();
  });
  it('allows restoring the original draft after switching templates', () => {
    const editor = { isDestroyed: false, commands: { setContent: vi.fn() } };
    const pending = { current: 'original draft' };
    effect(editor, 'last template prompt', pending, () => 'original draft');
    expect(pending.current).toBe('original draft');
    effect(editor, 'original draft', pending, () => 'original draft');
    expect(pending.current).toBeNull();
  });
});

describe('switching from template use to skill modification', () => {
  it('discards template state and invalidates outstanding attachment loads without restoring the old draft', () => {
    const start = source.indexOf('    const reset = () => {');
    const end = source.indexOf('    };', start);
    const context = {
      skillExampleGenerationRef: { current: 1 },
      skillExampleUploadReservationsRef: { current: new Map([['slot', 1]]) },
      latestUploadedFileMetaRef: { current: [{ localThumbUrl: 'blob:template' }] },
      skillExampleSnapshotRef: { current: { input: 'original draft', files: [{ localThumbUrl: 'blob:original' }] } },
      skillExampleDetailRef: { current: { prompt: 'template' } },
      pendingSkillExampleModelRef: { current: 'model' },
      pendingSkillExamplePromptRef: { current: 'template' },
      pendingTemplateSlotAutoReferenceRef: { current: 'slot' },
      latestInputRef: { current: 'template' },
      editor: { isDestroyed: false, commands: { setContent: vi.fn() } },
      revokeLocalObjectUrl: vi.fn(), clearPendingSkillExample: vi.fn(), closeMentionPanel: vi.fn(),
    };
    const setters = ['setSkillExample', 'setSkillExampleGroups', 'setActiveSkillExampleSlot',
      'setSkillExampleLoading', 'setSkillExampleUploadsPending', 'setSkillExampleError',
      'setUploadFileList', 'setUploadedFileMeta', 'setActiveTool', 'setInput'];
    setters.forEach((name) => { context[name] = vi.fn(); });
    const reset = new Function('context', `const { ${Object.keys(context).join(',')} } = context;` +
      source.slice(start + '    const reset = () => {'.length, end));
    reset(context);
    expect(context.skillExampleGenerationRef.current).toBe(2);
    expect(context.skillExampleSnapshotRef.current).toBeNull();
    expect(context.skillExampleDetailRef.current).toBeNull();
    expect(context.pendingSkillExamplePromptRef.current).toBeNull();
    expect(context.setSkillExample).toHaveBeenCalledWith(null);
    expect(context.setSkillExampleGroups).toHaveBeenCalledWith([]);
    expect(context.setUploadedFileMeta).toHaveBeenCalledWith([]);
    expect(context.setInput).toHaveBeenCalledExactlyOnceWith('');
    expect(context.clearPendingSkillExample).toHaveBeenCalledOnce();
    expect(context.closeMentionPanel).toHaveBeenCalledOnce();
  });
});


describe('workspace file reference controller', () => {
  const start = source.indexOf('      insertLocalFileReference: (entry) => {');
  const end = source.indexOf('      },', start);
  const invoke = new Function('editor', 'entry', 'insertFileReferenceAtView', 'createLocalReferenceFile',
    source.slice(start + '      insertLocalFileReference: (entry) => {'.length, end));

  it('uses the current document selection, never a stale mention range, and only inserts', () => {
    const editor = { state: { selection: { from: 7, to: 12 } }, view: {} };
    const entry = { rootPath: '/workspace', node: { path: 'a.txt' } };
    const file = { uid: 'local:/workspace/a.txt' };
    const insert = vi.fn(() => true);
    const create = vi.fn(() => file);
    expect(invoke(editor, entry, insert, create)).toBe(true);
    expect(create).toHaveBeenCalledWith(entry);
    expect(insert).toHaveBeenCalledWith(editor.view, { start: 7, end: 12 }, file);
    editor.state.selection = { from: 3, to: 3 };
    invoke(editor, entry, insert, create);
    expect(insert).toHaveBeenLastCalledWith(editor.view, { start: 3, end: 3 }, file);
  });

  it('ignores unavailable editors and malformed entries', () => {
    const insert = vi.fn();
    for (const editor of [null, { isDestroyed: true }, {}]) {
      expect(invoke(editor, {}, insert, vi.fn())).toBe(false);
    }
    expect(insert).not.toHaveBeenCalled();
  });
});
