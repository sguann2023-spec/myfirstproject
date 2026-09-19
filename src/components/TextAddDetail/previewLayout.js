import Konva from 'konva';

export const PREVIEW_TEXT_PADDING = 8;
export const PREVIEW_FONT_FAMILY = 'Arial, sans-serif';
export const PREVIEW_BASE_LINE_HEIGHT = 1.2;

const getExtraLineSpacing = (fontSize, lineHeight) => (
  fontSize * (lineHeight - PREVIEW_BASE_LINE_HEIGHT)
);

// Keep Konva's wrapping, alignment and decorations on the same no-trailing-gap metric.
// This override is local to the preview; ordinary Konva.Text instances are unchanged.
export class PreviewText extends Konva.Text {
  _getTextWidth(text, graphemes) {
    return super._getTextWidth(text, graphemes) - (text.length ? this.letterSpacing() : 0);
  }

  getHeight() {
    const height = super.getHeight();
    const isAuto = this.attrs.height === undefined || this.attrs.height === 'auto';
    return isAuto && this.textArr.length
      ? height - getExtraLineSpacing(this.fontSize(), this.lineHeight())
      : height;
  }

  _setTextData() {
    // Konva's line-fitting calculation reserves a full line box for every row.
    // Supply its trailing half-leading on each side only while calculating fits.
    const height = this.attrs.height;
    if (typeof height === 'number' && Number.isFinite(height)) {
      // Avoid dropping the last row due to floating-point error at an exact fit.
      this.attrs.height = height + getExtraLineSpacing(this.fontSize(), this.lineHeight()) + 1e-6;
    }
    try {
      super._setTextData();
    } finally {
      this.attrs.height = height;
    }
  }

  _sceneFunc(context) {
    const align = this.verticalAlign();
    const factor = align === 'bottom' ? 0.5 : align === 'middle' ? 0 : -0.5;
    context.save();
    context.translate(0, factor * getExtraLineSpacing(this.fontSize(), this.lineHeight()));
    try {
      super._sceneFunc(context);
    } finally {
      context.restore();
    }
  }
}
Konva.PreviewText = PreviewText;
export const PreviewTextNode = 'PreviewText';

const isFixed = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;
const graphemeSegmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;
const verticalAdvanceCache = new Map();

const getVerticalGlyphAdvance = (text, fontSize, fontStyle) => {
  const key = `${fontStyle}:${fontSize}:${text}`;
  if (verticalAdvanceCache.has(key)) return verticalAdvanceCache.get(key);
  let advance = fontSize;
  if (typeof document !== 'undefined' && document.body) {
    // Upright Latin glyphs use the font's vertical metrics, not necessarily one em.
    const probe = document.createElement('span');
    probe.style.cssText = 'all:initial;position:absolute;visibility:hidden;pointer-events:none;left:-10000px;top:0;writing-mode:vertical-rl;text-orientation:upright;white-space:pre;';
    probe.style.font = `${fontStyle || 'normal'} ${fontSize}px ${PREVIEW_FONT_FAMILY}`;
    probe.textContent = text;
    document.body.appendChild(probe);
    advance = probe.getBoundingClientRect().height || fontSize;
    probe.remove();
  }
  if (verticalAdvanceCache.size > 1000) verticalAdvanceCache.clear();
  verticalAdvanceCache.set(key, advance);
  return advance;
};

export const measureVerticalPreviewText = ({
  text, fontSize, fontStyle, letterSpacing, lineHeight,
  availableHeight, fixedWidth, fixedHeight, verticalAlign,
}) => {
  const padding = PREVIEW_TEXT_PADDING;
  const columnWidth = fontSize * lineHeight;
  const baseColumnWidth = fontSize * PREVIEW_BASE_LINE_HEIGHT;
  const maxHeight = isFixed(fixedHeight) ? fixedHeight : availableHeight;
  const columns = String(text).split('\n').flatMap((line) => {
    const characters = graphemeSegmenter
      ? Array.from(graphemeSegmenter.segment(line), ({ segment }) => segment)
      : Array.from(line);
    if (!characters.length) return [[]];
    const wrapped = [];
    let column = [];
    let height = 0;
    for (const character of characters) {
      const advance = getVerticalGlyphAdvance(character, fontSize, fontStyle);
      if (column.length && height + letterSpacing + advance > maxHeight - padding * 2) {
        wrapped.push(column);
        column = [];
        height = 0;
      }
      height += (column.length ? letterSpacing : 0) + advance;
      column.push({ text: character, advance });
    }
    wrapped.push(column);
    return wrapped;
  });
  const columnHeights = columns.map((column) => (
    column.reduce((height, glyph) => height + glyph.advance, 0)
    + Math.max(0, column.length - 1) * letterSpacing
  ));
  const contentHeight = Math.max(fontSize, ...columnHeights) + padding * 2;
  const width = isFixed(fixedWidth)
    ? Math.max(padding * 2 + 1, fixedWidth)
    : (columns.length - 1) * columnWidth + baseColumnWidth + padding * 2;
  const height = isFixed(fixedHeight) ? Math.max(padding * 2 + 1, fixedHeight) : contentHeight;
  // Upright glyphs flow downwards; new columns flow from right to left, like vertical-rl.
  const glyphs = columns.flatMap((column, columnIndex) => {
    const freeSpace = Math.max(0, height - padding * 2 - columnHeights[columnIndex]);
    const offset = verticalAlign === 'bottom' ? freeSpace : verticalAlign === 'middle' ? freeSpace / 2 : 0;
    let y = padding + offset;
    return column.map((glyph) => {
      const position = {
        ...glyph,
        x: width - padding - baseColumnWidth / 2 - columnIndex * columnWidth,
        y: y + glyph.advance / 2,
      };
      y += glyph.advance + letterSpacing;
      return position;
    });
  });
  return { width, height, contentHeight, glyphs };
};

export const drawVerticalPreviewText = (context, shape, layout) => {
  context.save();
  context.beginPath();
  context.rect(0, 0, shape.width(), shape.height());
  context.clip();
  context.setAttr('font', `${shape.getAttr('fontStyle')} ${shape.getAttr('fontSize')}px ${PREVIEW_FONT_FAMILY}`);
  context.setAttr('fillStyle', shape.fill());
  context.setAttr('strokeStyle', shape.stroke());
  context.setAttr('lineWidth', shape.strokeWidth());
  context.setAttr('lineJoin', 'round');
  context.setAttr('textAlign', 'center');
  context.setAttr('textBaseline', 'middle');
  for (const glyph of layout.glyphs) {
    if (shape.strokeWidth() > 0) context.strokeText(glyph.text, glyph.x, glyph.y);
    context.fillText(glyph.text, glyph.x, glyph.y);
    if (shape.getAttr('textDecoration') === 'underline') {
      context.fillRect(glyph.x + shape.getAttr('fontSize') / 2, glyph.y - glyph.advance / 2, 1, glyph.advance);
    }
  }
  context.restore();
};

export const measurePreviewText = ({
  text, fontSize, fontStyle, letterSpacing, lineHeight,
  availableWidth, fixedWidth, fixedHeight,
}) => {
  // Use the renderer's own wrapping and metrics for the selection and editor.
  const node = new PreviewText({
    text,
    fontFamily: PREVIEW_FONT_FAMILY,
    fontSize,
    fontStyle,
    letterSpacing,
    lineHeight,
    padding: PREVIEW_TEXT_PADDING,
    wrap: 'char',
  });
  const width = isFixed(fixedWidth)
    ? Math.max(PREVIEW_TEXT_PADDING * 2 + 1, fixedWidth)
    : Math.min(Math.max(40, Math.ceil(node.width()) + 1), Math.max(1, availableWidth));
  node.width(width);
  const contentHeight = node.height();
  const height = isFixed(fixedHeight)
    ? Math.max(PREVIEW_TEXT_PADDING * 2 + 1, fixedHeight)
    : contentHeight;
  node.destroy();
  return { width, height, contentHeight };
};

export const getPreviewEditorStyle = ({ box, rotation, scaleX, scaleY, contentHeight, verticalAlign, vertical = false }) => {
  const freeSpace = Math.max(0, box.height - contentHeight);
  const topInset = verticalAlign === 'bottom' ? freeSpace : verticalAlign === 'middle' ? freeSpace / 2 : 0;
  return {
    left: box.x,
    top: box.y,
    width: box.width,
    height: box.height,
    padding: vertical ? `${PREVIEW_TEXT_PADDING}px` : `${PREVIEW_TEXT_PADDING + topInset}px ${PREVIEW_TEXT_PADDING}px ${PREVIEW_TEXT_PADDING}px`,
    writingMode: vertical ? 'vertical-rl' : 'horizontal-tb',
    textOrientation: vertical ? 'upright' : 'mixed',
    // Matches Konva's center offset, including non-uniform scale and rotation.
    transform: `translate(-50%, -50%) rotate(${rotation}deg) scale(${scaleX}, ${scaleY})`,
    transformOrigin: 'center center',
  };
};

export const getPreviewEditorContentStyle = (style, letterSpacing, vertical) => {
  // Native textarea includes a trailing gap. Give it that extra inline space
  // while keeping the visible frame and the transformed text origin unchanged.
  const dx = vertical ? 0 : letterSpacing;
  const dy = vertical ? letterSpacing : 0;
  const fontSize = parseFloat(style.fontSize);
  const lineHeight = parseFloat(style.lineHeight);
  const extraLeading = Number.isFinite(fontSize) && Number.isFinite(lineHeight)
    ? lineHeight - fontSize * PREVIEW_BASE_LINE_HEIGHT
    : 0;
  const halfLeading = Math.max(0, extraLeading / 2);
  return {
    ...style,
    // Center the native block's extra leading outside the unchanged visible frame.
    width: style.width + dx + (vertical ? extraLeading : 0),
    height: style.height + dy + (vertical ? 0 : extraLeading),
    transform: `${style.transform} translate(${dx / 2}px, ${dy / 2}px)`,
    clipPath: vertical
      ? `inset(0px ${halfLeading}px ${Math.max(0, dy)}px ${halfLeading}px)`
      : `inset(${halfLeading}px ${Math.max(0, dx)}px ${halfLeading}px 0px)`,
  };
};
