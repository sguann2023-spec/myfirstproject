export { buildBackgroundRects } from '../../shared/textBackgroundLayout';

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
