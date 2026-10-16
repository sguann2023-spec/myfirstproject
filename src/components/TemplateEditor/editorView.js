export function indexEditorTree(tree = []) {
  const index = new Map();
  function walk(nodes, sceneId = null, trackId = null, ancestors = []) {
    for (const node of nodes) {
      index.set(node.id, { ...node, sceneId, trackId, ancestors });
      walk(node.children, node.type === 'composition' ? node.id : sceneId,
        node.type === 'track' ? node.id : node.type === 'composition' ? null : trackId,
        [...ancestors, node.id]);
    }
  }
  walk(tree);
  return index;
}

export function sceneTimeline(model, index, sceneId) {
  if (!model) return { rows: [], duration: 0, path: [] };
  const times = new Map(model.timeline.map(item => [item.id, item]));
  const scene = index.get(sceneId);
  const duration = scene ? times.get(scene.id)?.duration ?? 0 : model.duration;
  const clip = node => {
    const time = times.get(node.id);
    return time ? { id: node.id, name: node.name, type: node.type, text: node.text,
      start: time.localStart, end: time.localStart + time.duration, lane: 0 } : null;
  };
  const makeRow = (node, track) => ({
    id: node.id, name: node.name, track, lanes: 1,
    clips: node.children.map(clip).filter(Boolean)
  });
  const rows = scene
    ? scene.children.filter(node => node.type === 'track').map(node => makeRow(node, node.trackIndex))
    : [{ id: '__template_scenes__', name: '分镜', track: 0, lanes: 1, clips: model.tree.map(clip).filter(Boolean) }];
  // Keep older nested documents navigable without pretending they belong to a track.
  const loose = scene?.children.filter(node => node.type === 'composition') ?? [];
  if (loose.length) rows.push({ id: '__child_scenes__', name: '子分镜', track: 0, lanes: 1, clips: loose.map(clip).filter(Boolean) });
  const path = scene ? [...scene.ancestors, scene.id].map(id => index.get(id)).filter(node => node?.type === 'composition') : [];
  return { rows, duration, path };
}

export function snapTime(value, points, pixelsPerSecond, event = {}, enabled = true) {
  if (event.altKey) return Math.round(value * 10) / 10;
  if (!enabled || event.ctrlKey || event.metaKey) return value;
  const nearest = points.reduce((best, point) => Math.abs(point - value) < Math.abs(best - value) ? point : best, Infinity);
  return Math.abs(nearest - value) * pixelsPerSecond <= 7 ? nearest : value;
}

export function dragTiming(clip, delta, edge, points, pixelsPerSecond, event, snap) {
  const duration = clip.end - clip.start;
  if (edge === 'start') {
    const start = Math.max(0, Math.min(clip.end - .01, snapTime(clip.start + delta, points, pixelsPerSecond, event, snap)));
    return { start, duration: clip.end - start };
  }
  if (edge === 'end') {
    const end = Math.max(clip.start + .01, snapTime(clip.end + delta, points, pixelsPerSecond, event, snap));
    return { start: clip.start, duration: end - clip.start };
  }
  const proposed = clip.start + delta;
  const snappedStart = snapTime(proposed, points, pixelsPerSecond, event, snap);
  const snappedEnd = snapTime(proposed + duration, points, pixelsPerSecond, event, snap) - duration;
  const start = snappedStart !== proposed ? snappedStart : snappedEnd;
  return { start: Math.max(0, start), duration };
}
