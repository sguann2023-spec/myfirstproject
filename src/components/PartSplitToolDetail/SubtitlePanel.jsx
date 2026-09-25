import React from 'react';
import { Sparkles } from 'lucide-react';
import { subtitleRows } from './subtitles';
import { partOffset } from './model';

const SubtitleRow = React.memo(({
  row: { clip, cues, items }, index, selected, selectedToken, editing, pendingKeys,
  disabled, inputRef, rowRefs, actions,
}) => <div data-part-id={clip.id}
  ref={React.useCallback((node) => {
    if (node) rowRefs.current.set(clip.id, node);
    else rowRefs.current.delete(clip.id);
  }, [clip.id, rowRefs])}
  className={`storyboard-subtitles__row${selected ? ' is-selected' : ''}`}
  onClick={(event) => {
    if (disabled || event.target.closest('button, input')) return;
    actions.current.onSeek(clip.timelineStart);
  }}>
  <button type="button" className="storyboard-subtitles__number" disabled={disabled}
    aria-label={`定位第 ${index + 1} 个分镜`} aria-pressed={selected}
    onClick={() => { actions.current.setSelectedToken(null); actions.current.onSeek(clip.timelineStart); }}>{index + 1}</button>
  <div className="storyboard-subtitles__words">
    {clip.blank ? <button type="button" className="storyboard-subtitles__empty-chip"
      disabled={disabled} onClick={() => actions.current.onSeek(clip.timelineStart)}>空分镜</button> : null}
    {items.map((item, itemIndex) => item.kind === 'pause'
      ? <button key={`pause-${itemIndex}`} type="button"
        className={`storyboard-subtitles__pause${pendingKeys.includes(`${clip.id}-pause-${itemIndex}`) ? ' is-pending' : ''}`}
        aria-pressed={pendingKeys.includes(`${clip.id}-pause-${itemIndex}`)}
        disabled={disabled} aria-label={`停顿 ${((item.end - item.start) / 1000).toFixed(2)} 秒`}
        onClick={(event) => actions.current.choose(`${clip.id}-pause-${itemIndex}`, item.time, event)}>
        <span>停顿</span><span>[{((item.end - item.start) / 1000).toFixed(2)}s]</span>
      </button>
      : item.tokens.filter((token) => token.text.trim()).map((token) => {
        const key = `${clip.id}-${item.cueIndex}-${token.start}`;
        const pending = pendingKeys.includes(key);
        const tokenSelected = pending || (selected && selectedToken?.key === key);
        const time = Number.isFinite(token.sourceStart)
          ? clip.timelineStart + partOffset(clip, token.sourceStart) : item.time;
        if (editing?.key === key) return <input key={key} ref={inputRef}
          className="storyboard-subtitles__input" aria-label="编辑字幕"
          value={editing.value} maxLength={500}
          style={{ width: `${Math.max(2, Math.min(18, Array.from(editing.value).length + 1))}em` }}
          onChange={(event) => actions.current.changeEdit({ ...editing, value: event.target.value })}
          onBlur={() => actions.current.finish(true)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === 'Enter' || event.key === 'Escape') {
              event.preventDefault();
              actions.current.finish(event.key === 'Enter');
            }
          }} />;
        return <button key={key} type="button" disabled={disabled}
          className={`storyboard-subtitles__word${tokenSelected ? ' is-selected' : ''}${pending ? ' is-pending' : ''}`}
          aria-label={`字幕 ${token.text}`} aria-pressed={tokenSelected}
          title={Number.isFinite(token.sourceStart) ? '单击切换待删除，Shift 连选，双击编辑' : '无匹配逐字时间戳，仅支持定位和编辑'}
          onClick={(event) => {
            if (Number.isFinite(token.sourceStart)) { actions.current.choose(key, time, event); return; }
            actions.current.onPendingChange?.([]);
            actions.current.setSelectedToken({ id: clip.id, key });
            actions.current.onSeek(time);
          }}
          onContextMenu={(event) => {
            if (!Number.isFinite(token.sourceStart)) return;
            actions.current.openMenu(key, time, event);
          }}
          onDoubleClick={() => actions.current.beginEdit(clip, item.cue, item.cueIndex, token, key, time)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'F2') {
              event.preventDefault();
              actions.current.beginEdit(clip, item.cue, item.cueIndex, token, key, time);
            }
          }}>{token.text}</button>;
      }))}
    {!clip.blank && !cues.length && !items.length ? <span className="storyboard-subtitles__empty-label">无字幕</span> : null}
  </div>
</div>);

const SubtitlePanel = ({
  clips, segments, selectedIds, activeId, disabled,
  onSeek, onEdit, onDelete, onAiAssist, aiDisabled,
  units = [], pendingKeys = [], onPendingChange, onDeleteText,
}) => {
  const rows = React.useMemo(() => subtitleRows(clips, segments), [clips, segments]);
  const [selectedToken, setSelectedToken] = React.useState(null);
  const [editing, setEditing] = React.useState(null);
  const inputRef = React.useRef(null);
  const listRef = React.useRef(null);
  const rowRefs = React.useRef(new Map());
  const editingRef = React.useRef(null);
  const anchorRef = React.useRef(null);
  const anchorBaseRef = React.useRef([]);
  const anchorModeRef = React.useRef('add');
  const [menu, setMenu] = React.useState(null);
  const actions = React.useRef(null);
  const highlightedIds = React.useMemo(() => {
    const pending = new Set(pendingKeys);
    return new Set([...selectedIds, ...units.filter((unit) => pending.has(unit.key)).map((unit) => unit.id)]);
  }, [selectedIds, units, pendingKeys]);
  const choose = (key, time, event) => {
    if (disabled) return;
    if (event.shiftKey) event.preventDefault();
    onSeek(time);
    setSelectedToken(null);
    if (event.shiftKey && anchorRef.current) {
      const from = units.findIndex((unit) => unit.key === anchorRef.current);
      const to = units.findIndex((unit) => unit.key === key);
      if (from >= 0 && to >= 0) {
        const rangeKeys = units.slice(Math.min(from, to), Math.max(from, to) + 1).map((unit) => unit.key);
        if (anchorModeRef.current === 'remove') {
          const removing = new Set(rangeKeys);
          onPendingChange?.(anchorBaseRef.current.filter((item) => !removing.has(item)));
        } else onPendingChange?.([...new Set([...anchorBaseRef.current, ...rangeKeys])]);
        return;
      }
    }
    anchorRef.current = key;
    const selected = pendingKeys.includes(key);
    anchorModeRef.current = selected ? 'remove' : 'add';
    anchorBaseRef.current = selected ? pendingKeys.filter((item) => item !== key) : pendingKeys;
    onPendingChange?.(selected ? pendingKeys.filter((item) => item !== key) : [...pendingKeys, key]);
  };
  const openMenu = (key, time, event) => {
    if (disabled || !onDeleteText) return;
    event.preventDefault();
    event.stopPropagation();
    if (!pendingKeys.includes(key)) {
      anchorRef.current = key;
      anchorModeRef.current = 'add';
      anchorBaseRef.current = [];
      onPendingChange?.([key]);
      onSeek(time);
    }
    setMenu({ x: event.clientX, y: event.clientY });
  };
  const validEdit = editing && !disabled && selectedIds.includes(editing.id)
    && rows.find((row) => row.clip.id === editing.id)?.cues[editing.cueIndex]?.text === editing.originalText;

  React.useEffect(() => {
    if (editing && !validEdit) {
      editingRef.current = null;
      setEditing(null);
    }
  }, [editing, validEdit]);
  React.useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing?.key]);
  React.useEffect(() => {
    if (pendingKeys.length) return;
    anchorBaseRef.current = [];
    setMenu(null);
  }, [pendingKeys]);
  React.useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [menu]);
  React.useEffect(() => {
    if (editingRef.current) return;
    const row = rowRefs.current.get(activeId);
    const list = listRef.current;
    if (!row || !list) return;
    // Scroll only this list, never the surrounding modal or the whole page.
    const top = row.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top + row.offsetHeight - list.clientHeight;
    }
  }, [activeId]);

  const finish = (save) => {
    const edit = editingRef.current;
    editingRef.current = null;
    setEditing(null);
    if (save && edit && !disabled) onEdit?.(edit.id, edit);
  };
  const beginEdit = (clip, cue, cueIndex, token, key, time) => {
    if (disabled || !onEdit) return;
    onPendingChange?.([]);
    onSeek(time);
    const edit = { ...token, id: clip.id, cueIndex, key, originalText: cue.text, value: token.text };
    editingRef.current = edit;
    setSelectedToken({ id: clip.id, key });
    setEditing(edit);
  };
  // 行组件共享稳定入口，读取最近一次提交的回调，避免播放选中变化重绘全部字块。
  React.useLayoutEffect(() => {
    actions.current = {
      onSeek, onPendingChange, setSelectedToken, choose, beginEdit, finish, openMenu,
      changeEdit: (next) => { editingRef.current = next; setEditing(next); },
    };
  });

  return <aside className="storyboard-subtitles" aria-label="字幕编辑"
    onKeyDown={(event) => {
      // Text editing must never bubble into the timeline's delete/fullscreen shortcuts.
      if (event.target.matches('input')) event.stopPropagation();
      else if (['Escape', 'Delete', 'Backspace'].includes(event.key)) {
        event.stopPropagation();
        event.preventDefault();
        if (event.key === 'Escape') {
          onPendingChange?.([]);
          setSelectedToken(null);
        } else if (!disabled && !event.repeat && !event.nativeEvent.isComposing
          && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && pendingKeys.length) onDelete();
      }
    }}>
    <header className="storyboard-subtitles__toolbar">
        <button type="button" className="storyboard-subtitles__ai" disabled={disabled || aiDisabled || !onAiAssist}
          onClick={onAiAssist} title={aiDisabled ? '当前对话未就绪或正在执行任务' : 'AI辅助处理字幕分镜'}>
          <Sparkles size={16} aria-hidden="true" />AI辅助
        </button>
    </header>
    <div ref={listRef} className="storyboard-subtitles__list">
      {!rows.length ? <div className="storyboard-subtitles__empty">暂无字幕分镜</div> : null}
      {rows.map((row, index) => <SubtitleRow key={row.clip.id} row={row} index={index}
        selected={highlightedIds.has(row.clip.id)}
        selectedToken={selectedToken?.id === row.clip.id ? selectedToken : null}
        editing={validEdit && editing.id === row.clip.id ? editing : null}
        pendingKeys={pendingKeys} disabled={disabled} inputRef={inputRef} rowRefs={rowRefs} actions={actions} />)}
    </div>
    <footer className="storyboard-subtitles__footer">
      <button type="button" className="storyboard-subtitles__delete" aria-label="删除所选字幕分镜"
        disabled={disabled || !pendingKeys.length} onClick={onDelete}>删除</button>
    </footer>
    {menu ? <div className="storyboard-subtitles__menu" style={{ left: menu.x, top: menu.y }} role="menu">
      <button type="button" role="menuitem" onPointerDown={(event) => event.stopPropagation()}
        onClick={() => { setMenu(null); onDeleteText?.(); }}>仅删除文字</button>
    </div> : null}
  </aside>;
};

export default React.memo(SubtitlePanel);
