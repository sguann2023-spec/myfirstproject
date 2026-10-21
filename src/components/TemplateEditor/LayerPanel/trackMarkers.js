export function layerTrackMarkers(visible, index, selectedId) {
  const selected = index.get(selectedId);
  const sceneId = selected?.sceneId ?? null;
  const groupId = node => node.type === 'track'
    ? `track:${node.id}` : node.trackId ? `track:${node.trackId}` : `scenes:${sceneId ?? 'root'}`;
  const activeGroup = selected ? groupId(selected) : null;
  const depths = new Map(visible.map(node => [node.id, node.depth]));
  const rows = visible.map(node => {
    const current = index.get(node.id);
    // Descendants inherit the outer row's track marker in the selected scene scope.
    const owner = [...(current?.ancestors ?? []), node.id]
      .map(id => index.get(id))
      .find(ancestor => ancestor && ancestor.type !== 'track' && ancestor.sceneId === sceneId);
    return owner ? { group: groupId(owner), depth: depths.get(owner.id), active: groupId(owner) === activeGroup } : null;
  });
  return new Map(visible.flatMap((node, position) => {
    const marker = rows[position];
    return marker ? [[node.id, {
      ...marker,
      first: rows[position - 1]?.group !== marker.group,
      last: rows[position + 1]?.group !== marker.group
    }]] : [];
  }));
}
