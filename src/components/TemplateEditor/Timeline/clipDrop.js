export function clipDropTarget(y, rows, lockedTracks) {
  if (!rows.length) return null;
  for (const row of rows) {
    if (Math.abs(y - row.top) <= 5) return { beforeTrackId: row.id, top: row.top };
    if (y > row.top && y < row.bottom) return { trackId: row.id, invalid: lockedTracks.has(row.id) || row.id.startsWith('__') };
  }
  const last = rows[rows.length - 1];
  if (y >= last.bottom) return { beforeTrackId: null, top: last.bottom };
  return { beforeTrackId: rows[0].id, top: rows[0].top };
}
