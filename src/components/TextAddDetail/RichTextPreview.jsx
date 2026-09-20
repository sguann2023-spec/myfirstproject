import React from 'react';
import { Extension, Mark, Node } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { history, undo, redo } from '@tiptap/pm/history';
import { typographyRuns } from '../../shared/textTypography';
import { PREVIEW_TEXT_PADDING } from './previewLayout';
import { buildTextEffectParams, DEFAULT_TEXT_EFFECTS, getShadowPreview, getTextShadowCss, resolveTextEffects } from '../../shared/textEffects';
import { buildBackgroundRects, measureBackgroundGlyphs } from './backgroundLayout';

const Typography = Mark.create({
  name: 'typography',
  addAttributes: () => ({
    font: { default: '', parseHTML: (element) => element.getAttribute('data-font') || '' },
    fontSize: { default: 24, parseHTML: (element) => Number(element.getAttribute('data-size')) || 24 },
    color: { default: '#FFFFFF', parseHTML: (element) => element.getAttribute('data-color') || '#FFFFFF' },
    ...Object.fromEntries(['border', 'shadow'].map((key) => [key, {
      default: DEFAULT_TEXT_EFFECTS[key],
      parseHTML: (element) => {
        try { return resolveTextEffects({ [key]: JSON.parse(element.getAttribute(`data-${key}`)) })[key]; }
        catch { return DEFAULT_TEXT_EFFECTS[key]; }
      },
    }])),
    ...Object.fromEntries(['bold', 'italic', 'underline'].map((key) => [
      key, { default: false, parseHTML: (element) => element.getAttribute(`data-${key}`) === 'true' },
    ])),
  }),
  parseHTML: () => [{ tag: 'span[data-size]' }],
  renderHTML: ({ mark }) => ['span', {
    'data-font': mark.attrs.font,
    'data-size': mark.attrs.fontSize,
    'data-bold': String(mark.attrs.bold),
    'data-italic': String(mark.attrs.italic),
    'data-underline': String(mark.attrs.underline),
    'data-color': mark.attrs.color,
    'data-border': JSON.stringify(mark.attrs.border),
    'data-shadow': JSON.stringify(mark.attrs.shadow),
    style: `font-size:calc(var(--type-unit) * ${mark.attrs.fontSize});line-height:calc(var(--type-unit) * ${mark.attrs.fontSize * 1.2} + var(--line-gap));font-weight:${mark.attrs.bold ? 700 : 400};font-style:${mark.attrs.italic ? 'italic' : 'normal'};text-decoration:${mark.attrs.underline ? 'underline' : 'none'};color:${mark.attrs.color};-webkit-text-stroke:${mark.attrs.border.enabled ? mark.attrs.border.width / 100 * 0.2 : 0}em ${mark.attrs.border.color};paint-order:stroke fill;text-shadow:${getTextShadowCss(mark.attrs.shadow, mark.attrs.fontSize, 'var(--type-unit)')}`,
  }, 0],
});
const extensions = [
  Node.create({ name: 'doc', topNode: true, content: 'paragraph' }),
  Node.create({
    name: 'paragraph', group: 'block', content: 'inline*',
    parseHTML: () => [{ tag: 'p' }], renderHTML: () => ['p', 0],
  }),
  Node.create({ name: 'text', group: 'inline' }),
  Node.create({
    name: 'hardBreak', group: 'inline', inline: true, selectable: false,
    parseHTML: () => [{ tag: 'br' }], renderHTML: () => ['br'],
    addKeyboardShortcuts() {
      return {
        Enter: () => this.editor.commands.insertContent({ type: 'hardBreak', marks: this.editor.state.storedMarks?.map((mark) => mark.toJSON()) }),
        'Shift-Enter': () => this.editor.commands.insertContent({ type: 'hardBreak' }),
      };
    },
  }),
  Typography,
  Extension.create({
    name: 'previewHistory',
    addProseMirrorPlugins: () => [history()],
    addKeyboardShortcuts() {
      return {
        'Mod-z': () => undo(this.editor.state, this.editor.view.dispatch),
        'Mod-Shift-z': () => redo(this.editor.state, this.editor.view.dispatch),
      };
    },
  }),
];

export function toRichDocument(text, runs, defaults) {
  const content = typographyRuns(text, runs, defaults).flatMap((run) => {
    const { start: _start, end: _end, ...attrs } = run;
    const marks = [{ type: 'typography', attrs }];
    return text.slice(run.start, run.end).split('\n').flatMap((part, index) => [
      ...(index ? [{ type: 'hardBreak', marks }] : []),
      ...(part ? [{ type: 'text', text: part, marks }] : []),
    ]);
  });
  return { type: 'doc', content: [{ type: 'paragraph', content }] };
}

export function fromRichDocument(doc, defaults) {
  let text = '';
  const runs = [];
  doc.descendants((node) => {
    if (!node.isText && node.type.name !== 'hardBreak') return;
    const value = node.isText ? node.text : '\n';
    const typography = node.marks.find((mark) => mark.type.name === 'typography')?.attrs || defaults;
    runs.push({ start: text.length, end: text.length + value.length, ...typography });
    text += value;
  });
  return { text, runs: typographyRuns(text, runs, defaults) };
}

// The read-only overlay and editor use the same DOM renderer and measurement.
// Konva retains the hit area, drag handles and center-based transform.
export default function RichTextPreview({
  text, runs, defaults, editing, disabled, selection, style, effects,
  typographyScale, lineGap, letterSpacing, vertical, availableWidth, availableHeight,
  fixedWidth, fixedHeight, onMeasure, onChange, onSelection, onExit,
}) {
  const latest = React.useRef(null);
  latest.current = { defaults, onChange, onSelection, onExit, editing };
  const mirrorRef = React.useRef(null);
  const [backgroundGlyphs, setBackgroundGlyphs] = React.useState([]);
  const resolvedEffects = resolveTextEffects(effects);
  const effectParams = buildTextEffectParams(effects);
  const wasEditing = React.useRef(false);
  const editor = useEditor({
    extensions,
    content: toRichDocument(text, runs, defaults),
    editable: editing && !disabled,
    editorProps: {
      attributes: { role: 'textbox', 'aria-label': '预览文本内容', 'aria-multiline': 'true', spellcheck: 'false' },
      handleKeyDown: (_view, event) => {
        event.stopPropagation();
        if (!event.isComposing && (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey)))) {
          latest.current.onExit();
          return true;
        }
        return false;
      },
      handlePaste: (view, event) => {
        const value = event.clipboardData?.getData('text/plain');
        if (value == null) return false;
        const marks = view.state.storedMarks || view.state.selection.$from.marks();
        const nodes = value.replace(/\r\n?/g, '\n').split('\n').flatMap((part, index) => [
          ...(index ? [view.state.schema.nodes.hardBreak.create(null, null, marks)] : []),
          ...(part ? [view.state.schema.text(part, marks)] : []),
        ]);
        const { tr, selection: current } = view.state;
        tr.replaceWith(current.from, current.to, nodes);
        view.dispatch(tr);
        return true;
      },
      handleDrop: () => true,
    },
    onUpdate: ({ editor: instance }) => {
      latest.current.onChange(fromRichDocument(instance.state.doc, latest.current.defaults));
    },
    onSelectionUpdate: ({ editor: instance }) => {
      const { from, to } = instance.state.selection;
      latest.current.onSelection({ start: from - 1, end: to - 1 });
    },
    onBlur: () => latest.current.onExit(false),
  });
  React.useLayoutEffect(() => {
    if (!editor) return;
    const current = fromRichDocument(editor.state.doc, defaults);
    const normalized = typographyRuns(text, runs, defaults);
    if (current.text !== text) {
      const oldSelection = selection || { start: editor.state.selection.from - 1, end: editor.state.selection.to - 1 };
      editor.commands.setContent(toRichDocument(text, runs, defaults), { emitUpdate: false });
      editor.commands.setTextSelection({
        from: Math.min(text.length, oldSelection.start) + 1,
        to: Math.min(text.length, oldSelection.end) + 1,
      });
    } else if (JSON.stringify(current.runs) !== JSON.stringify(normalized)) {
      // A mark-only transaction preserves selection, IME state and undo history.
      const { tr, schema } = editor.state;
      tr.removeMark(1, text.length + 1, schema.marks.typography);
      for (const run of normalized) {
        tr.addMark(run.start + 1, run.end + 1, schema.marks.typography.create({
          font: run.font, fontSize: run.fontSize,
          bold: run.bold, italic: run.italic, underline: run.underline,
          color: run.color,
          border: run.border, shadow: run.shadow,
        }));
      }
      editor.view.dispatch(tr.setMeta('preventUpdate', true));
    }
    editor.setEditable(editing && !disabled, false);
    if (editing && !wasEditing.current) {
      if (selection) editor.commands.setTextSelection({ from: selection.start + 1, to: selection.end + 1 });
      editor.view.focus();
    }
    wasEditing.current = editing;
  }, [editor, text, runs, defaults, editing, disabled, selection]);

  const minimumSize = Math.min(defaults.fontSize, ...runs.map((run) => run.fontSize));
  // Keep the text box unchanged while allowing strokes/shadows beyond its edges.
  const effectOverflow = typographyRuns(text, runs, defaults).reduce((padding, run) => {
    const shadow = getShadowPreview(run.shadow, run.fontSize, typographyScale);
    const stroke = run.border.enabled ? run.border.width / 100 * 0.1 * run.fontSize * typographyScale : 0;
    const blur = shadow.enabled ? shadow.blur * 2 : 0;
    const x = shadow.enabled ? shadow.x : 0;
    const y = shadow.enabled ? shadow.y : 0;
    return [blur - y, blur + x, blur + y, blur - x].map((value, index) => Math.max(padding[index], value + stroke));
  }, [0, 0, 0, 0]);
  const baseInsets = style?.clipPath?.match(/-?[\d.]+(?=px)/g)?.map(Number) || [0, 0, 0, 0];
  const commonStyle = {
    ...style,
    overflow: 'visible',
    clipPath: `inset(${effectOverflow.map((value, index) => `${(baseInsets[index] || 0) - value}px`).join(' ')})`,
    // Decorations on an ancestor cannot be cancelled by a child span.
    fontWeight: 400,
    fontStyle: 'normal',
    textDecoration: 'none',
    WebkitTextStroke: '0px',
    textShadow: 'none',
    '--type-unit': `${typographyScale}px`,
    '--line-gap': `${lineGap}px`,
    fontSize: minimumSize * typographyScale,
    lineHeight: `${minimumSize * typographyScale * 1.2 + lineGap}px`,
  };
  const renderRun = (run) => (
    <span key={run.start} style={{
      fontSize: run.fontSize * typographyScale,
      fontWeight: run.bold ? 700 : 400,
      fontStyle: run.italic ? 'italic' : 'normal',
      textDecoration: run.underline ? 'underline' : 'none',
      color: run.color,
      WebkitTextStroke: `${run.border.enabled ? run.border.width / 100 * 0.2 * run.fontSize * typographyScale : 0}px ${run.border.color}`,
      textShadow: getTextShadowCss(run.shadow, run.fontSize, typographyScale),
      lineHeight: `${run.fontSize * typographyScale * 1.2 + lineGap}px`,
    }}>{text.slice(run.start, run.end).split('\n').map((part, index) => (
      <React.Fragment key={index}>{index > 0 ? <br /> : null}{part}</React.Fragment>
    ))}</span>
  );
  const mirrorStyle = {
    ...commonStyle,
    transform: 'none', clipPath: 'none', left: 0, top: 0,
    padding: PREVIEW_TEXT_PADDING,
    width: 'max-content',
    height: 'max-content',
    maxWidth: vertical ? 'none' : Math.max(1, (fixedWidth || availableWidth) + letterSpacing),
    maxHeight: vertical ? Math.max(1, (fixedHeight || availableHeight) + letterSpacing) : 'none',
    ...(fixedWidth && !vertical ? { width: fixedWidth + letterSpacing } : {}),
    ...(fixedHeight && vertical ? { height: fixedHeight + letterSpacing } : {}),
  };
  React.useLayoutEffect(() => {
    const mirror = mirrorRef.current;
    if (!mirror) return undefined;
    const measure = () => {
      // Layout sizes exclude the dropdown's opening scale animation.
      const computed = getComputedStyle(mirror);
      const measuredWidth = parseFloat(computed.width);
      const measuredHeight = parseFloat(computed.height);
      if (!Number.isFinite(measuredWidth) || !Number.isFinite(measuredHeight)) return;
      const width = Math.max(40, fixedWidth || measuredWidth - (vertical ? lineGap : letterSpacing));
      const contentHeight = Math.max(17, measuredHeight - (vertical ? letterSpacing : lineGap));
      const height = Math.max(17, fixedHeight || contentHeight);
      onMeasure({ width, height, contentHeight });
      if (resolvedEffects.background.enabled) {
        const next = measureBackgroundGlyphs(mirror);
        setBackgroundGlyphs((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
      }
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(mirror);
    return () => observer?.disconnect();
  }, [text, runs, defaults, typographyScale, lineGap, letterSpacing, vertical, fixedWidth, fixedHeight, availableWidth, availableHeight, onMeasure, effects, style?.fontWeight, style?.fontStyle, style?.textAlign]);

  const backgroundRects = buildBackgroundRects(backgroundGlyphs, resolvedEffects.background,
    Math.max(defaults.fontSize, ...runs.map((run) => run.fontSize)) * typographyScale, vertical);
  const topOffset = (parseFloat(style?.padding) || PREVIEW_TEXT_PADDING) - PREVIEW_TEXT_PADDING;

  return <>
    {resolvedEffects.background.enabled && text ? (
      <div className="chat-panel__text-background-preview" aria-hidden="true" style={{
        ...style, padding: 0, clipPath: 'none', overflow: 'visible', opacity: effectParams.background_alpha,
      }}>
        {backgroundRects.map((rect, index) => <div key={index} style={{
          position: 'absolute', left: rect.x, top: rect.y + topOffset, width: rect.width, height: rect.height,
          borderRadius: rect.radius, backgroundColor: resolvedEffects.background.color,
        }} />)}
      </div>
    ) : null}
    <div ref={mirrorRef} className="chat-panel__rich-preview chat-panel__rich-preview--measure" style={mirrorStyle} aria-hidden="true">
      <p>{typographyRuns(text, runs, defaults).map(renderRun)}{text.endsWith('\n') || !text ? <br /> : null}</p>
    </div>
    <EditorContent editor={editor}
      className="chat-panel__rich-preview"
      style={{ ...commonStyle, pointerEvents: editing ? 'auto' : 'none' }}
      aria-hidden={!editing}
    />
  </>;
}
