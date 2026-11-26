import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import postcss from 'postcss';
import { describe, expect, it, vi } from 'vitest';

const tools = ['TextAddDetail', 'AudioAddToolDetail', 'ImageAddDetailTool', 'PresetAddDetail', 'RecognizationSubtitleToolDetail'];
const componentDirectory = dirname(fileURLToPath(import.meta.url));
const sourceFor = (tool, extension = 'js') => readFileSync(resolve(componentDirectory, '..', tool, `index.${extension}`), 'utf8');
const parse = (source) => ts.createSourceFile('index.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const findNodes = (root, predicate) => {
  const matches = [];
  const visit = (node) => {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return matches;
};
const rule = (css, selector) => {
  let match;
  postcss.parse(css).walkRules(selector, (node) => { match ||= node; });
  return match?.nodes.map((node) => node.toString()).join(';\n') || '';
};

describe('bottom toolbar settings popup layout contract', () => {
  it.each(tools)('%s keeps click dropdowns above the toolbar with AntD flip and shift enabled', (tool) => {
    const source = parse(sourceFor(tool));
    const dropdown = findNodes(source, (node) => ts.isJsxOpeningElement(node) && node.tagName.getText(source) === 'Dropdown')[0];
    const attribute = (name) => dropdown.attributes.properties.find((entry) => entry.name?.getText(source) === name)?.initializer;
    expect(attribute('placement').text).toBe('topLeft');
    expect(attribute('trigger').expression.getText(source)).toBe("['click']");
    expect(attribute('overlayClassName').text).toContain('chat-panel__tool-settings-dropdown');
    const overflow = runInNewContext(`(${attribute('autoAdjustOverflow').expression.getText(source)})`);
    expect(overflow).toEqual({ adjustX: true, adjustY: true, shiftX: true, shiftY: true });
    expect(sourceFor(tool)).toContain('chat-panel__tool-settings-popup');
  });

  it('bounds only external popups, leaves panel reuse alone, and gives settings content one scroll owner', () => {
    const css = sourceFor('TextAddDetail', 'css');
    const popup = rule(css, '.chat-panel__tool-settings-popup');
    expect(popup).toContain('calc(100dvh - 96px)');
    expect(popup).toContain('max-width: calc(100vw - 24px)');
    expect(rule(css, '.chat-panel__tool-settings-dropdown')).toContain('padding: 12px');
    expect(rule(css, '.chat-panel__tool-settings-popup .chat-panel__text-settings-layout')).toContain('min-height: 0');
    expect(rule(css, '.chat-panel__tool-settings-popup .chat-panel__text-settings-content')).toContain('overflow-y: auto');
    expect(rule(css, '.chat-panel__tool-settings-popup .chat-panel__text-settings-panel')).toContain('overflow: visible');
    expect(rule(css, '.chat-panel__tool-settings-popup .chat-panel__text-settings-panel')).toContain('height: auto');
    expect(rule(css, '.chat-panel__tool-settings-popup .chat-panel__text-settings-tabs')).toContain('flex: 0 0 auto');
    // TemplateEditor still gets the original panel sizing and scrolling.
    expect(rule(css, '.chat-panel__text-settings-panel')).toContain('height: 300px');
    expect(rule(css, '.chat-panel__text-settings-panel')).toContain('overflow-y: auto');
    expect(css).toMatch(/@media \(max-width: 600px\)[\s\S]*flex-direction: column/);
    const subtitle = sourceFor('RecognizationSubtitleToolDetail', 'css');
    expect(rule(subtitle, '.chat-panel__subtitle-popover')).toContain('overflow: hidden');
    expect(rule(subtitle, '.chat-panel__subtitle-popover .chat-panel__subtitle-settings-scroll')).toContain('overflow-y: auto');
    expect(rule(subtitle, '.chat-panel__subtitle-popover .chat-panel__subtitle-dialog-layout.is-split')).toContain('minmax(0, 1fr)');
    expect(rule(sourceFor('AudioAddToolDetail', 'css'), '.chat-panel__audio-add-source-panel')).toContain('align-self: stretch');
  });
});

describe.each(['TextAddDetail', 'ImageAddDetailTool', 'PresetAddDetail'])('%s preview fitting', (tool) => {
  const fitPreview = (ResizeObserver) => {
    const source = parse(sourceFor(tool));
    const declaration = findNodes(source, (node) => ts.isVariableDeclaration(node) && node.name.getText(source) === 'fitSettingsPreview')[0];
    const expression = ts.transpileModule(`(${declaration.initializer.getText(source)})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText;
    return runInNewContext(expression, { ResizeObserver });
  };

  it.each([[168, 94.5], [157.5, 280], [168, 304]])('uniformly fits %sx%s previews on resize and cleans up observers', (width, height) => {
    let resize;
    const observer = { observe: vi.fn(), disconnect: vi.fn() };
    const ResizeObserver = vi.fn(function (callback) { resize = callback; return observer; });
    const setProperty = vi.fn();
    const content = { offsetWidth: width, offsetHeight: height };
    const viewport = { clientWidth: 100, clientHeight: 80, firstElementChild: content, style: { setProperty } };
    const cleanup = fitPreview(ResizeObserver)(viewport);
    expect(observer.observe.mock.calls.map(([node]) => node)).toEqual([viewport, content]);
    expect(Number(setProperty.mock.lastCall[1])).toBeCloseTo(Math.min(1, 100 / width, 80 / height));
    viewport.clientWidth = 500;
    viewport.clientHeight = 500;
    resize();
    expect(Number(setProperty.mock.lastCall[1])).toBe(1);
    const calls = setProperty.mock.calls.length;
    viewport.clientHeight = 0;
    resize();
    expect(setProperty).toHaveBeenCalledTimes(calls);
    cleanup();
    expect(observer.disconnect).toHaveBeenCalledOnce();
  });

  it('tolerates unmounted or initially unmeasured previews', () => {
    expect(fitPreview(undefined)(null)).toBeUndefined();
    const setProperty = vi.fn();
    expect(fitPreview(undefined)({ clientWidth: 0, clientHeight: 0, firstElementChild: {}, style: { setProperty } })).toBeUndefined();
    expect(setProperty).not.toHaveBeenCalled();
  });
});
