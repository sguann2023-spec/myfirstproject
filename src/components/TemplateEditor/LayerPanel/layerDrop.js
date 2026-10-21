export function layerDrop(index, sourceId, targetId, ratio) {
  const source = index.get(sourceId);
  const target = index.get(targetId);
  if (!source || !target || sourceId === targetId || target.ancestors.includes(sourceId)) return null;
  const placement = target.type === 'composition' && ratio > .25 && ratio < .75
    ? 'inside' : ratio < .5 ? 'before' : 'after';
  if (placement !== 'inside' && !target.sceneId && source.type !== 'composition') return null;
  return { type: 'move-layer', id: sourceId, targetId, placement };
}
