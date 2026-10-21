import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Sparkles, Pencil, Trash2, ArrowRight, LayersPlus } from 'lucide-react';
import { elementIcons } from '../elementIcons';
import { layerDrop } from './layerDrop';
import { layerTrackMarkers } from './trackMarkers';

export default function LayerPanel({ model, index, nativeIndex, selectedId, collapsed, onToggle, onSelect, onEnter, onReveal, onAction, isLocked = () => false, disabled }) {
  const [renaming, setRenaming] = useState(null);
  const [name, setName] = useState('');
  const [menu, setMenu] = useState(null);
  const [drop, setDrop] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const dragRef = useRef(null);
  const expandRef = useRef(null);
  const panelRef = useRef(null);
  const clearExpand = () => {
    if (expandRef.current) clearTimeout(expandRef.current.timer);
    expandRef.current = null;
  };
  const clearDrag = () => {
    dragRef.current = null; setDraggingId(null); setDrop(null); clearExpand();
  };
  useEffect(() => () => clearExpand(), []);
  useEffect(() => { if (disabled) clearDrag(); }, [disabled]);
  const dropAction = (event, id) => {
    if (disabled || isLocked(dragRef.current) || isLocked(id)) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    return layerDrop(index, dragRef.current, id, rect.height ? (event.clientY - rect.top) / rect.height : .5);
  };
  useEffect(() => {
    const panel = panelRef.current;
    const item = panel?.querySelector('[aria-selected="true"]');
    if (!item) return;
    const bounds = panel.getBoundingClientRect();
    const position = item.getBoundingClientRect();
    if (position.top < bounds.top + 45) panel.scrollTop += position.top - bounds.top - 45;
    else if (position.bottom > bounds.bottom) panel.scrollTop += position.bottom - bounds.bottom;
  }, [selectedId, collapsed]);
  const visible = useMemo(() => {
    const result = [];
    function walk(nodes, depth = 0) {
      for (const node of nodes) {
        if (node.type === 'track') { walk(node.children, depth); continue; }
        result.push({ ...node, depth });
        if (!collapsed.has(node.id)) walk(node.children, depth + 1);
      }
    }
    walk(model?.tree ?? []);
    return result;
  }, [model, collapsed]);
  const trackMarkers = useMemo(() => layerTrackMarkers(visible, index, selectedId), [visible, index, selectedId]);
  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('blur', close); };
  }, [menu]);
  const rename = (node) => { setMenu(null); setName(node.name); setRenaming(node.id); };
  const finishRename = () => {
    const id = renaming;
    setRenaming(null);
    if (name.trim() && name.trim() !== index.get(id)?.name) onAction({ type: 'rename', id, name });
  };
  const select = (id, element) => {
    onSelect(id);
    element?.focus();
  };
  return <aside ref={panelRef} className="template-edit-layers" aria-label="素材层级"
    onDragOver={event => {
      if (!dragRef.current || disabled) return;
      const panel = panelRef.current;
      const bounds = panel.getBoundingClientRect();
      if (event.clientY < bounds.top + 28) panel.scrollTop -= 14;
      else if (event.clientY > bounds.bottom - 28) panel.scrollTop += 14;
    }}>
    <div role="tree" aria-label="分镜层级树" className="template-element-tree">
      {visible.map((node, position) => {
        const scene = node.type === 'composition';
        const current = index.get(node.id);
        const native = nativeIndex.get(node.id);
        const marker = trackMarkers.get(node.id);
        const Icon = scene && native?.batch_scene ? LayersPlus : elementIcons[node.type] || Sparkles;
        const revealable = Boolean(current);
        return <div key={node.id} role="treeitem" aria-level={node.depth + 1} aria-selected={selectedId === node.id}
          aria-expanded={scene ? !collapsed.has(node.id) : undefined}
          tabIndex={selectedId === node.id || (!selectedId && position === 0) ? 0 : -1}
          data-element-id={node.id}
          className={`template-layer ${selectedId === node.id ? 'is-selected' : ''} ${draggingId === node.id ? 'is-layer-dragging' : ''} ${drop?.targetId === node.id ? `is-layer-drop-${drop.placement}` : ''}`}
          style={{ paddingLeft: 8, marginLeft: 12 + node.depth * 18 }}
          draggable={!disabled && !renaming && !isLocked(node.id)}
          onDragStart={(event) => {
            if (disabled || renaming || isLocked(node.id) || event.target.closest('button, input')) {
              event.preventDefault(); return;
            }
            dragRef.current = node.id;
            setDraggingId(node.id); setMenu(null); onSelect(node.id);
            event.dataTransfer.setData('text/plain', node.id);
            event.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(event) => {
            const action = dropAction(event, node.id);
            if (!action) { setDrop(null); clearExpand(); return; }
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            setDrop(previous => previous?.targetId === action.targetId && previous?.placement === action.placement ? previous : action);
            if (action.placement === 'inside' && collapsed.has(node.id)) {
              if (expandRef.current?.id !== node.id) {
                clearExpand();
                expandRef.current = { id: node.id, timer: setTimeout(() => {
                  expandRef.current = null; onToggle(node.id);
                }, 550) };
              }
            } else clearExpand();
          }}
          onDragLeave={event => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setDrop(previous => previous?.targetId === node.id ? null : previous); clearExpand();
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            const action = dropAction(event, node.id);
            clearDrag();
            if (action) onAction(action);
          }}
          onDragEnd={clearDrag}
          onClick={(event) => { if (!renaming) select(node.id, event.currentTarget); }}
          onDoubleClick={() => { if (scene) onEnter(node.id); else if (!disabled) rename(node); }}
          onContextMenu={(event) => {
            event.preventDefault(); onSelect(node.id);
            setMenu({ node, x: Math.min(event.clientX, window.innerWidth - 190), y: Math.min(event.clientY, window.innerHeight - 140) });
          }}
          onKeyDown={(event) => {
            if (renaming) return;
            const row = event.currentTarget;
            if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter', 'F2', 'Escape'].includes(event.key)) event.preventDefault();
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              const next = visible[position + (event.key === 'ArrowDown' ? 1 : -1)];
              if (next) select(next.id, [...row.parentElement.children].find(element => element.dataset.elementId === next.id));
            }
            if (event.key === 'ArrowRight' && scene && collapsed.has(node.id)) onToggle(node.id);
            if (event.key === 'ArrowLeft' && scene && !collapsed.has(node.id)) onToggle(node.id);
            if (event.key === 'Enter') scene ? onEnter(node.id) : onReveal(node.id);
            if (event.key === 'F2' && !disabled) rename(node);
            if (event.key === 'Escape') setMenu(null);
          }}>
          {marker && <span aria-hidden="true" data-track-group={marker.group} data-active={marker.active}
            className={`template-layer-track-rail ${marker.active ? 'is-active' : ''} ${marker.first ? 'is-first' : ''} ${marker.last ? 'is-last' : ''}`}
            style={{ left: (marker.depth - node.depth) * 18 - 10 }} />}
          {scene ? <button className="template-disclosure" tabIndex={-1} aria-label={`${collapsed.has(node.id) ? '展开' : '折叠'} ${node.name}`}
            onDoubleClick={event => event.stopPropagation()}
            onClick={event => { event.stopPropagation(); onToggle(node.id); }}>
            {collapsed.has(node.id) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          </button> : <span className="template-disclosure"><Icon size={14} /></span>}
          {scene && <span className="template-layer-icon" aria-label={native?.batch_scene ? '批量分镜' : '分镜'}><Icon size={14} /></span>}
          {renaming === node.id ? <input autoFocus className="template-rename-input" aria-label="元素名称" value={name}
            onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
            onChange={event => setName(event.target.value)} onBlur={finishRename}
            onKeyDown={event => {
              event.stopPropagation();
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') setRenaming(null);
            }} /> : <><strong onDoubleClick={event => {
              event.stopPropagation();
              if (!disabled) rename(node);
            }}>{node.name}</strong>{node.text && <span className="template-element-text">{node.text}</span>}</>}
          {revealable && <button type="button" className="template-layer-reveal" aria-label={`在时间轴中定位 ${node.name}`} title="在时间轴中定位"
            onDoubleClick={event => event.stopPropagation()}
            onPointerDown={event => event.stopPropagation()}
            onClick={event => { event.stopPropagation(); onReveal(node.id); }}>
            <ArrowRight size={13} />
          </button>}
        </div>;
      })}
    </div>
    {menu && <div role="menu" className="template-context-menu" style={{ left: menu.x, top: menu.y }}
      onPointerDown={event => event.stopPropagation()}>
      <button role="menuitem" onClick={() => { onReveal(menu.node.id); setMenu(null); }}><ArrowRight size={14} />在时间轴中显示</button>
      <button role="menuitem" disabled={disabled} onClick={() => rename(menu.node)}><Pencil size={14} />重命名 <small>F2</small></button>
      <button role="menuitem" disabled={disabled} onClick={() => { onAction({ type: 'delete', id: menu.node.id }); setMenu(null); }}><Trash2 size={14} />删除 <small>Del</small></button>
    </div>}
  </aside>;
}
