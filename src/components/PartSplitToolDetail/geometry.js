const legacyZoomByDocument = new WeakMap();

// Older embedded Chromium returns DOMRects in pre-zoom coordinates, while
// pointer clientX/clientY are viewport pixels. Modern Chromium already scales.
export const viewportRect = (element) => {
  const rect = element.getBoundingClientRect();
  const doc = element.ownerDocument;
  if (!legacyZoomByDocument.has(doc)) {
    const probe = doc.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:100px;height:1px;zoom:2;visibility:hidden;pointer-events:none';
    doc.documentElement.appendChild(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    legacyZoomByDocument.set(doc, width > 0 && width < 150);
  }
  let zoom = 1;
  if (legacyZoomByDocument.get(doc)) {
    for (let node = element; node; node = node.parentElement) {
      const value = doc.defaultView.getComputedStyle(node).zoom;
      const number = parseFloat(value);
      if (number > 0) zoom *= value.endsWith('%') ? number / 100 : number;
    }
  }
  return {
    left: rect.left * zoom, top: rect.top * zoom,
    width: rect.width * zoom, height: rect.height * zoom,
  };
};
