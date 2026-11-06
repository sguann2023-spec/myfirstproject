import React from 'react';
import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { Tooltip } from 'antd';
import { GripVertical, ArrowUp, Pencil, Trash2 } from 'lucide-react';
import './SendQueuePanel.css';
import { sendQueue } from './sendQueue';
function Row({
  item,
  sessionId,
  stop,
  busy,
  onEdit
}) {
  const [expanded, expand] = React.useState(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition
  } = useSortable({
    id: item.id
  });
  return <div ref={setNodeRef} className="send-queue__row" style={{
    transform: transform ? `translate3d(${transform.x}px,${transform.y}px,0)` : undefined,
    transition
  }}>
    <Tooltip title="拖动排序"><button className="send-queue__icon send-queue__grip" type="button" aria-label="拖动排序" {...attributes} {...listeners}><GripVertical size={15} /></button></Tooltip>
    {<button className="send-queue__text" type="button" onClick={() => expand(!expanded)} title={item.text} style={{
      flex: 1,
      minWidth: 0,
      textAlign: 'left',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: expanded ? 'pre-wrap' : 'nowrap',
      overflowWrap: 'anywhere'
    }}>{item.text}</button>}
    <Tooltip title="打断当前对话立即发送"><button className="send-queue__immediate" type="button" aria-label="立即发送" onClick={() => sendQueue.immediate(sessionId, item.id, stop, busy)}><ArrowUp size={15} /><span>立即</span></button></Tooltip>
    <Tooltip title="修改"><button className="send-queue__icon" type="button" aria-label="修改" disabled={!onEdit} onClick={() => sendQueue.restore(sessionId, item.id, onEdit)}><Pencil size={15} /></button></Tooltip>
    <Tooltip title="移出待发送消息"><button className="send-queue__icon" type="button" aria-label="删除" onClick={() => sendQueue.remove(sessionId, item.id)}><Trash2 size={15} /></button></Tooltip>
  </div>;
}
export default function SendQueuePanel({
  sessionId,
  stop,
  busy,
  onEdit
}) {
  const [, refresh] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => {
    sendQueue.listeners.add(refresh);
    return () => sendQueue.listeners.delete(refresh);
  }, []);
  const sensors = useSensors(useSensor(PointerSensor, {
    activationConstraint: {
      distance: 5
    }
  }), useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates
  }));
  const state = sendQueue.state(sessionId);
  if (!state.items.length) return null;
  return <section className="send-queue" aria-label="待发送队列">
    {state.paused && <div className="send-queue__paused">
      <span role="status">由于你中断了当前响应，队列已暂停</span>
      <button type="button" aria-label="继续发送队列" onClick={() => sendQueue.resume(sessionId)}>继续</button>
    </div>}
    <DndContext sensors={sensors} onDragEnd={({
      active,
      over
    }) => {
      if (over) sendQueue.move(sessionId, active.id, over.id);
    }}><SortableContext items={state.items.map(x => x.id)} strategy={verticalListSortingStrategy}>{state.items.map(item => <Row key={item.id} item={item} sessionId={sessionId} stop={stop} busy={busy} onEdit={onEdit} />)}</SortableContext></DndContext>
  </section>;
}
