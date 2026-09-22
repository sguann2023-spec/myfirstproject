import React from 'react';
import { Sparkles } from 'lucide-react';
import { subtitleRows } from './subtitles';
import { partOffset } from './model';

const SubtitlePanel = ({
  clips, segments, selectedIds, activeId, hoverId, disabled,
  onSeek, onHover, onEdit, onDelete, onAiAssist, aiDisabled,
  units = [], pendingKeys = [], onPendingChange,
}) => {
  const rows = React.useMemo(() => subtitleRows(clips, segments), [clips, segments]);
  const [selectedToken, setSelectedToken] = React.useState(null);
  const [editing, setEditing] = React.useState(null);
  const inputRef = React.useRef(null);
  const listRef = React.useRef(null);
  const rowRefs = React.useRef(new Map());
  const editingRef = React.useRef(null);
  const anchorRef = React.useRef(null);
  const choose = (key, time, event) => {
    if (disabled) return;
    onSeek(time, true);
    setSelectedToken(null);
    if (event.shiftKey && anchorRef.current) {
      const from = units.findIndex((unit) => unit.key === anchorRef.current);
      const to = units.findIndex((unit) => unit.key === key);
      if (from >= 0 && to >= 0) {
        onPendingChange?.([...new Set([...pendingKeys, ...units.slice(Math.min(from, to), Math.max(from, to) + 1).map((unit) => unit.key)])]);
        return;
      }
    }
    anchorRef.current = key;
    onPendingChange?.(pendingKeys.includes(key) ? pendingKeys.filter((item) => item !== key) : [...pendingKeys, key]);
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
    onHover(null);
    const edit = { ...token, id: clip.id, cueIndex, key, originalText: cue.text, value: token.text };
    editingRef.current = edit;
    setSelectedToken({ id: clip.id, key });
    setEditing(edit);
  };

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
    }}
    onMouseLeave={() => onHover(null)}>
    <header className="storyboard-subtitles__toolbar">
        <button type="button" className="storyboard-subtitles__ai" disabled={disabled || aiDisabled || !onAiAssist}
          onClick={onAiAssist} title={aiDisabled ? '当前对话未就绪或正在执行任务' : 'AI辅助处理字幕分镜'}>
          <Sparkles size={16} aria-hidden="true" />AI辅助
        </button>
    </header>
    <div ref={listRef} className="storyboard-subtitles__list">
      {!rows.length ? <div className="storyboard-subtitles__empty">暂无字幕分镜</div> : null}
      {rows.map(({ clip, cues, items }, index) => {
        const selected = selectedIds.includes(clip.id) || units.some((unit) => unit.id === clip.id && pendingKeys.includes(unit.key));
        return <div key={clip.id} data-part-id={clip.id}
          ref={(node) => { if (node) rowRefs.current.set(clip.id, node); else rowRefs.current.delete(clip.id); }}
          className={`storyboard-subtitles__row${selected ? ' is-selected' : ''}${hoverId === clip.id ? ' is-hovered' : ''}`}
          onMouseEnter={() => { if (!disabled && !editingRef.current) onHover(clip.timelineStart); }}
          onClick={(event) => {
            if (disabled || event.target.closest('button, input')) return;
            onSeek(clip.timelineStart);
          }}>
          <button type="button" className="storyboard-subtitles__number" disabled={disabled}
            aria-label={`定位第 ${index + 1} 个分镜`} aria-pressed={selected}
            onClick={() => { setSelectedToken(null); onSeek(clip.timelineStart); }}>{index + 1}</button>
          <div className="storyboard-subtitles__words">
            {clip.blank ? <button type="button" className="storyboard-subtitles__empty-chip"
              disabled={disabled} onClick={() => onSeek(clip.timelineStart)}>空分镜</button> : null}
            {items.map((item, itemIndex) => item.kind === 'pause'
              ? <button key={`pause-${itemIndex}`} type="button"
                className={`storyboard-subtitles__pause${pendingKeys.includes(`${clip.id}-pause-${itemIndex}`) ? ' is-pending' : ''}`}
                aria-pressed={pendingKeys.includes(`${clip.id}-pause-${itemIndex}`)}
                disabled={disabled} aria-label={`停顿 ${((item.end - item.start) / 1000).toFixed(2)} 秒`}
                onMouseEnter={() => { if (!disabled && !editingRef.current) onHover(item.time); }}
                onClick={(event) => choose(`${clip.id}-pause-${itemIndex}`, item.time, event)}>
                <span>停顿</span><span>[{((item.end - item.start) / 1000).toFixed(2)}s]</span>
              </button>
              : item.tokens.filter((token) => token.text.trim())
                .map((token) => {
                  const key = `${clip.id}-${item.cueIndex}-${token.start}`;
                  const pending = pendingKeys.includes(key);
                  const tokenSelected = pending || (selected && selectedToken?.key === key);
                  const time = Number.isFinite(token.sourceStart)
                    ? clip.timelineStart + partOffset(clip, token.sourceStart) : item.time;
                  if (validEdit && editing.key === key) return <input key={key} ref={inputRef}
                    className="storyboard-subtitles__input" aria-label="编辑字幕"
                    value={editing.value} maxLength={500}
                    style={{ width: `${Math.max(2, Math.min(18, Array.from(editing.value).length + 1))}em` }}
                    onChange={(event) => {
                      const next = { ...editing, value: event.target.value };
                      editingRef.current = next;
                      setEditing(next);
                    }}
                    onBlur={() => finish(true)}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                      if (event.key === 'Enter' || event.key === 'Escape') {
                        event.preventDefault();
                        finish(event.key === 'Enter');
                      }
                    }} />;
                  return <button key={key} type="button" disabled={disabled}
                    className={`storyboard-subtitles__word${tokenSelected ? ' is-selected' : ''}${pending ? ' is-pending' : ''}`}
                    aria-label={`字幕 ${token.text}`} aria-pressed={tokenSelected}
                    title={Number.isFinite(token.sourceStart) ? '单击切换待删除，Shift 连选，双击编辑' : '无匹配逐字时间戳，仅支持定位和编辑'}
                    onMouseEnter={() => { if (!disabled && !editingRef.current) onHover(time); }}
                    onClick={(event) => {
                      if (Number.isFinite(token.sourceStart)) { choose(key, time, event); return; }
                      onPendingChange?.([]);
                      setSelectedToken({ id: clip.id, key });
                      onSeek(time);
                    }}
                    onDoubleClick={() => beginEdit(clip, item.cue, item.cueIndex, token, key, time)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === 'F2') {
                        event.preventDefault();
                        beginEdit(clip, item.cue, item.cueIndex, token, key, time);
                      }
                    }}>{token.text}</button>;
                }))}
            {!clip.blank && !cues.length && !items.length ? <span className="storyboard-subtitles__empty-label">无字幕</span> : null}
          </div>
        </div>;
      })}
    </div>
    <footer className="storyboard-subtitles__footer">
      <button type="button" className="storyboard-subtitles__delete" aria-label="删除所选字幕分镜"
        disabled={disabled || !pendingKeys.length} onClick={() => { onHover(null); onDelete(); }}>删除</button>
    </footer>
  </aside>;
};

export default SubtitlePanel;
