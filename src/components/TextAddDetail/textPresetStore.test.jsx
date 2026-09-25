import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TEXT_EFFECTS } from '../../shared/textEffects';
import { snapshotPresetSettings, snapshotPresetTypography } from './textPresets';
import { deleteCustomTextPreset, listCustomTextPresets, renameCustomTextPreset, saveCustomTextPreset } from './textPresetStore';

const tables = vi.hoisted(() => ({ presets: new Map(), metadata: new Map() }));

// Exercise the store's validation and round trips across a cloned storage boundary.
vi.mock('dexie', () => ({
  default: class {
    version() { return { stores() {} }; }
    table(name) {
      const rows = tables[name];
      return {
        get: async (id) => structuredClone(rows.get(id)),
        add: async (row) => { rows.set(row.id, structuredClone(row)); },
        put: async (row) => { rows.set(row.id, structuredClone(row)); },
        delete: async (id) => { rows.delete(id); },
        toArray: async () => structuredClone([...rows.values()]),
        orderBy: () => ({ reverse: () => ({
          toArray: async () => structuredClone([...rows.values()].sort((a, b) => b.createdAt - a.createdAt)),
        }) }),
      };
    }
    transaction(_mode, ...args) { return args.at(-1)(); }
  },
}));

const typography = () => snapshotPresetTypography({
  font: '测试字体', fontSize: 36, color: '#FFFFFF', bold: true, italic: false, underline: true,
  border: DEFAULT_TEXT_EFFECTS.border, shadow: DEFAULT_TEXT_EFFECTS.shadow,
});

beforeEach(() => {
  tables.presets.clear();
  tables.metadata.clear();
});

describe('custom text preset storage', () => {
  it('retains non-timeline settings across save, read, rename and delete', async () => {
    const input = {
      ...DEFAULT_TEXT_EFFECTS,
      intro: { enabled: true, animation: '向下飞入', duration: 1.2 },
      outro: { enabled: true, animation: '向下滑动', duration: 0.5 },
      loop: { enabled: true, animation: '吹泡泡_II', duration: 3 },
      flower: { enabled: true, id: '123' },
      letterSpacing: 12, lineSpacing: 24, align: 'bottom', uniformScale: false,
      scaleXPercent: 110, scaleYPercent: 130, positionX: 300, positionY: -150,
      fixedWidth: null, fixedHeight: 600, rotation: 45,
      trackName: '不要保存', startTime: 5, endTime: 10, text: '不要保存',
    };
    const expected = snapshotPresetSettings(input);
    const saved = await saveCustomTextPreset(undefined, typography(), input);
    expect(saved.name).toBe('预设1');
    expect(saved.settings).toEqual(expected);
    expect(tables.presets.get(saved.id).settings).toEqual(expected);
    saved.settings.intro.duration = 3;
    input.loop.duration = 0.1;
    const [loaded] = await listCustomTextPresets();
    expect(loaded.settings).toEqual(expected);
    expect(loaded.settings).not.toHaveProperty('trackName');
    expect(loaded.settings).not.toHaveProperty('startTime');
    expect(loaded.settings).not.toHaveProperty('endTime');
    expect(loaded.settings).not.toHaveProperty('text');
    const renamed = await renameCustomTextPreset(saved.id, '完整动画');
    expect(renamed.settings).toEqual(expected);
    expect((await listCustomTextPresets())[0]).toEqual(renamed);
    await deleteCustomTextPreset(saved.id);
    expect(await listCustomTextPresets()).toEqual([]);
  });

  it('reads and renames legacy presets without inventing settings', async () => {
    tables.presets.set('custom-legacy', {
      id: 'custom-legacy', name: '旧版', createdAt: 1, typography: typography(),
    });
    expect((await listCustomTextPresets())[0]).not.toHaveProperty('settings');
    const renamed = await renameCustomTextPreset('custom-legacy', '旧版改名');
    expect(renamed.name).toBe('旧版改名');
    expect(renamed).not.toHaveProperty('settings');
    expect(tables.presets.get('custom-legacy')).not.toHaveProperty('settings');
  });
});
