import React from 'react';
import { Plus } from 'lucide-react';
import { getTextShadowCss } from '../../shared/textEffects';
import { matchesTextPreset, snapshotPresetSettings, snapshotPresetTypography, TEXT_STYLE_PRESETS } from './textPresets';
import { deleteCustomTextPreset, listCustomTextPresets, renameCustomTextPreset, saveCustomTextPreset } from './textPresetStore';

export default function TextPresetPanel({ disabled, typography, settings, onPresetSelect }) {
  const [customPresets, setCustomPresets] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [reload, setReload] = React.useState(0);
  const [error, setError] = React.useState('');
  const [renaming, setRenaming] = React.useState(null);
  const [menu, setMenu] = React.useState(null);
  const menuRef = React.useRef(null);
  const [name, setName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const writing = React.useRef(false);

  React.useEffect(() => {
    if (!menu) return undefined;
    menuRef.current?.querySelector('button')?.focus();
    const closeOutside = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenu(null);
    };
    const escape = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setMenu(null);
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [menu]);

  React.useEffect(() => {
    let current = true;
    setLoading(true);
    setLoadFailed(false);
    listCustomTextPresets().then((rows) => {
      if (current) setCustomPresets(rows);
    }).catch(() => {
      if (current) {
        setLoadFailed(true);
        setError('读取自定义预设失败，请重试。内置预设仍可使用。');
      }
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [reload]);

  const startAdding = async () => {
    if (disabled || loading || loadFailed || writing.current) return;
    let snapshot;
    let settingsSnapshot;
    try {
      snapshot = snapshotPresetTypography(typography);
      settingsSnapshot = snapshotPresetSettings(settings);
    } catch (failure) {
      setError(failure.message);
      return;
    }
    writing.current = true;
    setBusy(true);
    setError('');
    setMenu(null);
    setRenaming(null);
    try {
      const row = await saveCustomTextPreset(undefined, snapshot, settingsSnapshot);
      setCustomPresets((previous) => [row, ...previous]);
    } catch {
      setError('保存失败，预设尚未保存，请点击加号重试。');
    } finally {
      writing.current = false;
      setBusy(false);
    }
  };

  const save = async () => {
    if (disabled || writing.current || !renaming) return;
    if (!name.trim()) { setError('请输入预设名称'); return; }
    writing.current = true;
    setBusy(true);
    setError('');
    try {
      const row = await renameCustomTextPreset(renaming.id, name.trim());
      setCustomPresets((previous) => previous.map((item) => item.id === row.id ? row : item));
      setRenaming(null);
    } catch {
      setError('重命名失败，请重试。');
    } finally {
      writing.current = false;
      setBusy(false);
    }
  };

  const remove = async (preset) => {
    if (disabled || writing.current) return;
    writing.current = true;
    setBusy(true);
    setError('');
    setMenu(null);
    setRenaming(null);
    try {
      await deleteCustomTextPreset(preset.id);
      setCustomPresets((previous) => previous.filter((item) => item.id !== preset.id));
    } catch {
      setError('删除失败，请重试。');
    } finally {
      writing.current = false;
      setBusy(false);
    }
  };

  return <>
    {error ? <div role="alert" className="chat-panel__text-preset-error">{error}
      {loadFailed ? <button type="button" disabled={disabled || loading} onClick={() => {
        setError(''); setReload((value) => value + 1);
      }}>重试读取</button> : null}
    </div> : null}
    {renaming ? <div className="chat-panel__text-preset-form">
      <div className="chat-panel__text-settings-row">
        <label htmlFor="text-preset-name" className="chat-panel__text-settings-label">预设名称</label>
        <input id="text-preset-name" autoFocus maxLength={40} value={name} disabled={disabled || busy}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault(); event.stopPropagation(); save();
            }
          }} />
      </div>
      <div className="chat-panel__text-preset-actions">
        <button type="button" disabled={disabled || busy} onClick={() => { setRenaming(null); setError(''); }}>取消</button>
        <button type="button" disabled={disabled || busy} onClick={save}>{busy ? '保存中...' : '保存名称'}</button>
      </div>
    </div> : null}
    <div className="chat-panel__text-preset-grid">
      <button type="button" className="chat-panel__text-preset-card chat-panel__text-preset-add"
        aria-label="添加自定义预设" title="保存当前文字样式、动画、排版和变换，不包含时间线设置"
        disabled={disabled || loading || loadFailed || busy}
        onMouseDown={(event) => event.preventDefault()} onClick={startAdding}>
        <span className="chat-panel__text-preset-sample"><Plus size={28} aria-hidden="true" /></span>
        <span className="chat-panel__text-preset-name">{loading ? '读取中...' : '添加预设'}</span>
      </button>
      {[...customPresets, ...TEXT_STYLE_PRESETS].map((preset) => {
        const { color, bold, italic, underline, border, shadow } = preset.typography;
        return <div className="chat-panel__text-preset-entry" key={preset.id}>
          <button type="button" className="chat-panel__text-preset-card"
            aria-label={`应用预设：${preset.name}`} aria-pressed={matchesTextPreset(typography, preset, settings)}
            title={preset.id.startsWith('custom-') ? `${preset.name}（右键重命名或删除）` : preset.name} disabled={disabled}
            aria-haspopup={preset.id.startsWith('custom-') ? 'menu' : undefined}
            onContextMenu={(event) => {
              if (!preset.id.startsWith('custom-')) return;
              event.preventDefault();
              event.stopPropagation();
              if (!disabled && !busy) setMenu(preset.id);
            }}
            onKeyDown={(event) => {
              if (preset.id.startsWith('custom-') && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
                event.preventDefault();
                if (!disabled && !busy) setMenu(preset.id);
              }
            }}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPresetSelect?.({
              ...preset.typography, border: { ...border }, shadow: { ...shadow },
            }, snapshotPresetSettings(preset.settings))}>
            <span className="chat-panel__text-preset-sample" aria-hidden="true" style={{
              color, fontWeight: bold ? 700 : 400, fontStyle: italic ? 'italic' : 'normal',
              textDecoration: underline ? 'underline' : 'none',
              WebkitTextStroke: `${border.enabled ? border.width / 100 * 0.2 * 24 : 0}px ${border.color}`,
              textShadow: getTextShadowCss(shadow, 24),
            }}>文字</span>
            <span className="chat-panel__text-preset-name">{preset.name}</span>
          </button>
          {menu === preset.id ? <div ref={menuRef} role="menu" aria-label={`${preset.name}操作`}
            className="chat-panel__text-preset-menu"
            onKeyDown={(event) => {
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const buttons = [...event.currentTarget.querySelectorAll('button')];
              const index = buttons.indexOf(document.activeElement);
              buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
                : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus();
            }}>
            <button type="button" role="menuitem" disabled={disabled || busy} onClick={() => {
              setRenaming(preset); setName(preset.name); setMenu(null); setError('');
            }}>重命名</button>
            <button type="button" role="menuitem" disabled={disabled || busy} onClick={() => remove(preset)}>删除</button>
          </div> : null}
        </div>;
      })}
    </div>
  </>;
}
