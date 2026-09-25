import Dexie from 'dexie';
import { snapshotPresetSettings, snapshotPresetTypography } from './textPresets';

// Separate from chat history: clearing conversations must not remove saved styles.
const db = new Dexie('VectCutTextPresets', { chromeTransactionDurability: 'strict' });
db.version(1).stores({ presets: '&id, createdAt' });
db.version(2).stores({ presets: '&id, createdAt', metadata: '&id' });
const presets = db.table('presets');
const metadata = db.table('metadata');

function validatePreset(row) {
  if (!row || typeof row.id !== 'string' || !row.id.startsWith('custom-')
    || typeof row.name !== 'string' || !row.name.trim() || row.name.trim().length > 40
    || typeof row.createdAt !== 'number' || !Number.isFinite(row.createdAt)) {
    throw new Error('Invalid custom text preset');
  }
  return {
    id: row.id, name: row.name.trim(), createdAt: row.createdAt,
    typography: snapshotPresetTypography(row.typography),
    ...(row.settings ? { settings: snapshotPresetSettings(row.settings) } : {}),
  };
}

export async function listCustomTextPresets() {
  const rows = await presets.orderBy('createdAt').reverse().toArray();
  return rows.map(validatePreset);
}

export async function saveCustomTextPreset(name, typography, settings) {
  return db.transaction('rw', presets, metadata, async () => {
    if (name == null) {
      const counter = await metadata.get('sequence');
      const rows = await presets.toArray();
      const highest = rows.reduce((max, row) => {
        const match = /^预设(\d+)$/.exec(row.name);
        const value = match ? Number(match[1]) : 0;
        return Number.isSafeInteger(value) ? Math.max(max, value) : max;
      }, Number.isSafeInteger(counter?.value) ? counter.value : 0);
      const next = highest + 1;
      if (!Number.isSafeInteger(next)) throw new Error('Preset sequence exhausted');
      name = `预设${next}`;
      await metadata.put({ id: 'sequence', value: next });
    }
    const row = validatePreset({
      id: `custom-${crypto.randomUUID()}`, name, typography, settings, createdAt: Date.now(),
    });
    await presets.add(row);
    return row;
  });
}

export async function renameCustomTextPreset(id, name) {
  return db.transaction('rw', presets, async () => {
    const current = await presets.get(id);
    if (!current) throw new Error('Preset no longer exists');
    const row = validatePreset({ ...current, name });
    await presets.put(row);
    return row;
  });
}

export async function deleteCustomTextPreset(id) {
  if (typeof id !== 'string' || !id.startsWith('custom-')) throw new Error('Invalid custom text preset ID');
  await presets.delete(id);
}
