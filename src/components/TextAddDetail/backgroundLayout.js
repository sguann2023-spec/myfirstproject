// Background geometry follows the laid-out glyphs, never changes text wrapping.
export function buildBackgroundRects(glyphRects, background, fontSize, vertical = false) {
  if (!glyphRects.length) return [];
  const union = (rects) => {
    const x = Math.min(...rects.map((rect) => rect.x));
    const y = Math.min(...rects.map((rect) => rect.y));
    return {
      x, y,
      width: Math.max(...rects.map((rect) => rect.x + rect.width)) - x,
      height: Math.max(...rects.map((rect) => rect.y + rect.height)) - y,
    };
  };
  const lines = [];
  const axis = vertical ? 'x' : 'y';
  const size = vertical ? 'width' : 'height';
  for (const rect of glyphRects) {
    const line = lines.find((candidate) => {
      const bounds = union(candidate);
      const overlap = Math.min(bounds[axis] + bounds[size], rect[axis] + rect[size]) - Math.max(bounds[axis], rect[axis]);
      return overlap > Math.min(bounds[size], rect[size]) / 2;
    });
    if (line) line.push(rect);
    else lines.push([rect]);
  }
  const rects = background.style === 2 ? lines.map(union) : [union(glyphRects)];
  const paddingX = fontSize * background.width / 100;
  const paddingY = fontSize * background.height / 100;
  return rects.map((rect) => ({
    x: rect.x - paddingX + (background.horizontalOffset / 50 - 1) * fontSize,
    y: rect.y - paddingY + (background.verticalOffset / 50 - 1) * fontSize,
    width: rect.width + paddingX * 2,
    height: rect.height + paddingY * 2,
    radius: Math.min(rect.width + paddingX * 2, rect.height + paddingY * 2) / 2 * background.roundRadius / 100,
  }));
}

export function measureBackgroundGlyphs(mirror) {
  const bounds = mirror.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return [];
  const computed = getComputedStyle(mirror);
  const scaleX = parseFloat(computed.width) / bounds.width;
  const scaleY = parseFloat(computed.height) / bounds.height;
  const walker = document.createTreeWalker(mirror, NodeFilter.SHOW_TEXT);
  const rects = [];
  let node;
  while ((node = walker.nextNode())) {
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (rect.width && rect.height) rects.push({
        x: (rect.left - bounds.left) * scaleX,
        y: (rect.top - bounds.top) * scaleY,
        width: rect.width * scaleX,
        height: rect.height * scaleY,
      });
    }
  }
  return rects;
}
