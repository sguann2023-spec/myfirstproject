import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const composer = postcss.parse(read('./Composer.css'));
const declarations = (selector) => {
  const values = {};
  composer.walkRules(selector, (rule) => rule.walkDecls((decl) => {
    values[decl.prop] = decl.value;
  }));
  return values;
};

describe('composer secondary layout contract', () => {
  it('limits text height independently of ordinary and grouped attachments', () => {
    const host = declarations('.chat-panel__composer');
    expect(host['--composer-min-height']).toBe('145px');
    expect(host['--composer-input-max-height']).toBe('177px');
    expect(host['max-height']).toBeUndefined();
    expect(host.padding).toBe('16px');
    expect(declarations('.chat-panel__composer:has(.chat-panel__local-file-preview-list)')['padding-top']).toBe('8px');
    expect(declarations('.chat-panel__editor')['max-height']).toBeUndefined();
    expect(declarations('.chat-panel__input-wrap')['max-height']).toBe('var(--composer-input-max-height)');
    expect(declarations('.chat-panel__input-wrap')['min-height']).toBe('calc(var(--composer-min-height) - 40px - 8px)');
    expect(declarations('.chat-panel__input-wrap--hidden')['min-height']).toBe('0');
  });

  it('sizes secondary controls independently of the chat model and send button', () => {
    expect(declarations('.chat-panel__model-picker').height).toBe('var(--composer-control-height, 32px)');
    expect(declarations('.chat-panel__model-picker--chat').height).toBe('20px');
    expect(declarations('.chat-panel__send-btn')).toMatchObject({ width: '30px', height: '30px', flex: '0 0 30px', 'align-items': 'center' });
    expect(declarations('.chat-panel__send-icon')).toMatchObject({ width: '21px', height: '21px' });
    expect(declarations('.chat-panel__tool-bar')).toMatchObject({ 'min-height': '40px', 'align-items': 'flex-end' });
    expect(declarations('.chat-panel__tool-right')['align-items']).toBe('flex-end');
    expect(declarations('.chat-panel__tool-content-scroll')['overflow-x']).toBe('auto');
  });

  it('keeps the first tool background padded while aligning its icon with the input', () => {
    expect(declarations('.chat-panel__tool-button').padding).toBe('6px 6px');
    expect(declarations('.chat-panel__tool-content-shell')['margin-left']).toBe('-6px');
    expect(read('./Composer.css')).not.toContain('padding-left: 0 !important');
  });

  it('keeps the visible editor in flow and only hides dedicated settings modes', () => {
    expect(declarations('.chat-panel__input-editor').position).toBe('relative');
    expect(declarations('.chat-panel__input-editor--hidden').position).toBe('absolute');
    const source = read('./Composer.js');
    expect(source).toContain("const inputEditorHidden = ['text-add', 'recognize-subtitle', 'audio-add', 'image-add', 'voice-conversion'].includes(activeTool)");
    expect(source).toContain('chat-panel__input-wrap--hidden');
    expect(source).toContain('chat-panel__model-picker chat-panel__model-picker--chat');
    expect(source).not.toContain('chat-panel__tool-bar--with-attachments');
    expect(declarations('.chat-panel__drag-upload-overlay').background).toBe('transparent');
  });

  it.each([
    '../../DraftToolDetail/index.css',
    '../../DraftDownloadToolDetail/index.css',
    '../../DraftInspectToolDetail/index.css',
    '../../DraftModifyToolDetail/index.css',
    '../../TextAddDetail/index.css',
    './AiWriteToolDetail/index.css',
    './DigitalHumanToolDetail/index.css',
    './VoiceSquareToolDetail/index.css',
  ])('does not redefine common secondary layout in %s', (path) => {
    const css = postcss.parse(read(path));
    const shared = [];
    css.walkRules((rule) => {
      if (rule.selectors.some((selector) => [
        '.chat-panel__tool-detail-area',
        '.chat-panel__tool-detail-content',
        '.chat-panel__tool-tooltip-trigger',
        '.chat-panel__tool-close-icon',
      ].includes(selector))) shared.push(rule.selector);
    });
    expect(shared).toEqual([]);
  });
});
