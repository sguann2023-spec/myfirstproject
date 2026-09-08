// @ts-nocheck
import React, { useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { AutoSizer, Grid, GridCellRenderer, OnScrollParams } from 'react-virtualized';
import { TimelineRow } from '../../interface/action';
import { CommonProp } from '../../interface/common_prop';
import { EditData } from '../../interface/timeline';
import { prefix } from '../../utils/deal_class_prefix';
import { parserTimeToPixel } from '../../utils/deal_data';
import { DragLines } from './drag_lines';
import './edit_area.less';
import { EditRow } from './edit_row';
import { useDragLine } from './hooks/use_drag_line';

export type EditAreaProps = CommonProp & {
  /** 距离左侧滚动距离 */
  scrollLeft: number;
  /** 距离顶部滚动距离 */
  scrollTop: number;
  /** 滚动回调，用于同步滚动 */
  onScroll: (params: OnScrollParams) => void;
  /** 设置编辑器数据 */
  setEditorData: (params: TimelineRow[]) => void;
  /** 设置scroll left */
  deltaScrollLeft: (scrollLeft: number) => void;
  /** 缩放时间刻度宽度（触摸板/滚轮） */
  onZoom?: (delta: number) => void;
  hoverInfo: { x: number; y: number; time: number } | null; // 新增此行
};

/** edit area ref数据 */
export interface EditAreaState {
  domRef: React.MutableRefObject<HTMLDivElement>;
}

export const EditArea = React.forwardRef<EditAreaState, EditAreaProps>((props, ref) => {
  const {
    editorData,
    rowHeight,
    scaleWidth,
    scaleCount,
    startLeft,
    hoverInfo,
    scrollLeft,
    scrollTop,
    scale,
    hideCursor,
    cursorTime,
    onScroll,
    dragLine,
    getAssistDragLineActionIds,
    onActionMoveEnd,
    onActionMoveStart,
    onActionMoving,
    onActionResizeEnd,
    onActionResizeStart,
    onActionResizing,
  } = props;
  const { dragLineData, initDragLine, updateDragLine, disposeDragLine, defaultGetAssistPosition, defaultGetMovePosition } = useDragLine();
  const editAreaRef = useRef<HTMLDivElement>(null!);
  const gridRef = useRef<Grid>(null!);
  const heightRef = useRef(-1);

  useEffect(() => {
    const el = editAreaRef.current;
    if (!el) return;
    let gestureScale = 1;
    const handleWheel = (e: WheelEvent) => {
      // 仅在触摸板捏合（Chrome/Edge：wheel.ctrlKey为true）时缩放；普通两指滚动不拦截
      if (e.ctrlKey && typeof props.onZoom === 'function') {
        e.preventDefault();
        props.onZoom(e.deltaY);
      }
    };
    const handleGestureStart = (ev: any) => {
      try { ev.preventDefault(); } catch {}
      gestureScale = ev.scale || 1;
    };
    const handleGestureChange = (ev: any) => {
      try { ev.preventDefault(); } catch {}
      const prev = gestureScale || 1;
      const curr = ev.scale || 1;
      const delta = curr - prev;
      if (typeof props.onZoom === 'function' && Math.abs(delta) > 0.01) props.onZoom(delta < 0 ? 1 : -1);
      gestureScale = curr;
    };
    const handleGestureEnd = () => { gestureScale = 1; };
    el.addEventListener('wheel', handleWheel as any, { passive: false } as any);
    el.addEventListener('gesturestart', handleGestureStart as any, { passive: false } as any);
    el.addEventListener('gesturechange', handleGestureChange as any, { passive: false } as any);
    el.addEventListener('gestureend', handleGestureEnd as any, { passive: false } as any);
    return () => {
      el.removeEventListener('wheel', handleWheel as any);
      el.removeEventListener('gesturestart', handleGestureStart as any);
      el.removeEventListener('gesturechange', handleGestureChange as any);
      el.removeEventListener('gestureend', handleGestureEnd as any);
    };
  }, [props.onZoom]);

  // ref 数据
  useImperativeHandle(ref, () => ({
    get domRef() {
      return editAreaRef;
    },
  }));

  const handleInitDragLine: EditData['onActionMoveStart'] = (data) => {
    if (dragLine) {
      const assistActionIds =
        getAssistDragLineActionIds &&
        getAssistDragLineActionIds({
          action: data.action,
          row: data.row,
          editorData,
        });
      const cursorLeft = parserTimeToPixel(cursorTime, { scaleWidth, scale, startLeft });
      const assistPositions = defaultGetAssistPosition({
        editorData,
        assistActionIds,
        action: data.action,
        row: data.row,
        scale,
        scaleWidth,
        startLeft,
        hideCursor,
        cursorLeft,
      });
      initDragLine({ assistPositions });
    }
  };

  const handleUpdateDragLine: EditData['onActionMoving'] = (data) => {
    if (dragLine) {
      const movePositions = defaultGetMovePosition({
        ...data,
        startLeft,
        scaleWidth,
        scale,
      });
      updateDragLine({ movePositions });
    }
  };

  /** 获取每个cell渲染内容 */
  const cellRenderer: GridCellRenderer = ({ rowIndex, key, style }) => {
    const row = editorData[rowIndex];
    if (!row && rowIndex >= editorData.length) return <div key={key} style={style} />;

    const currentRowHeight = row?.rowHeight || rowHeight;
    const gap = 4; // 轨道之间的视觉间距
    
    return (
      <div 
        key={key} 
        style={{
          ...style,
          // 这里的背景色会填满整个 Grid 单元格宽度（从 0 开始）
          backgroundColor: 'transparent', 
          height: currentRowHeight - gap,
          marginBottom: `${gap}px`,
          overflow: 'hidden',
        }}
      >
        <div style={{
          position: 'absolute',
          left: startLeft,      // 从 startLeft 开始显示背景
          right: 0,
          top: 0,
          bottom: 0,
          backgroundColor: 'rgba(255, 255, 255, 0.05)', // 轨道背景色
          borderRadius: '8px',
          zIndex: 0             // 确保在内容之下
        }} />
        
        <EditRow
          {...props}
          style={{
            width: '100%',
            height: '100%',
            // 去掉这里的 backgroundColor，由外层 div 控制
            backgroundPositionX: `0, ${startLeft}px`,
            backgroundSize: `${startLeft}px, ${scaleWidth}px`,
          }}
          areaRef={editAreaRef}
          rowHeight={currentRowHeight}
          rowData={row}
          dragLineData={dragLineData}
          onActionMoveStart={(data) => {
            handleInitDragLine(data);
            return onActionMoveStart && onActionMoveStart(data);
          }}
          onActionResizeStart={(data) => {
            handleInitDragLine(data);

            return onActionResizeStart && onActionResizeStart(data);
          }}
          onActionMoving={(data) => {
            handleUpdateDragLine(data);
            return onActionMoving && onActionMoving(data);
          }}
          onActionResizing={(data) => {
            handleUpdateDragLine(data);
            return onActionResizing && onActionResizing(data);
          }}
          onActionResizeEnd={(data) => {
            disposeDragLine();
            return onActionResizeEnd && onActionResizeEnd(data);
          }}
          onActionMoveEnd={(data) => {
            disposeDragLine();
            return onActionMoveEnd && onActionMoveEnd(data);
          }}
        />
      </div>
    );
  };

  useLayoutEffect(() => {
    gridRef.current?.scrollToPosition({ scrollTop, scrollLeft });
  }, [scrollTop, scrollLeft]);

  useEffect(() => {
    gridRef.current.recomputeGridSize();
  }, [editorData]);

  return (
    <div ref={editAreaRef} className={prefix('edit-area')}>
      <AutoSizer>
        {({ width, height }) => {
          // 获取全部高度
          let totalHeight = 0;
          // 高度列表
          const heights = editorData.map((row) => {
            const itemHeight = row.rowHeight || rowHeight;
            totalHeight += itemHeight;
            return itemHeight;
          });
          if (totalHeight < height) {
            heights.push(height - totalHeight);
            if (heightRef.current !== height && heightRef.current >= 0) {
              setTimeout(() =>
                gridRef.current?.recomputeGridSize({
                  rowIndex: heights.length - 1,
                }),
              );
            }
          }
          heightRef.current = height;

          return (
            <>
              <Grid
                columnCount={1}
                rowCount={heights.length}
                ref={gridRef}
                cellRenderer={cellRenderer}
                columnWidth={Math.max(scaleCount * scaleWidth + startLeft, width)}
                width={width}
                height={height}
                rowHeight={({ index }) => heights[index] || rowHeight}
                overscanRowCount={10}
                overscanColumnCount={0}
                onScroll={(param) => {
                  onScroll(param);
                }}
              />
              {hoverInfo && (
                <div 
                  className={prefix('edit-area-hover-line')}
                  style={{ 
                    // 计算方式：鼠标视口位置 - 容器左侧偏移
                    // 这样线条就能精确对准 TimeArea 的预览标签中心
                    left: hoverInfo.x - (editAreaRef.current?.getBoundingClientRect().left || 0),
                    height: '100%',
                    position: 'absolute',
                    top: 0,
                    pointerEvents: 'none', // 确保不干扰拖拽操作
                    zIndex: 20, // 确保在 DragLines 之上
                    transform: 'translateX(-50%)'
                  }}
                />
              )}
            </>
          );
        }}
      </AutoSizer>
      {dragLine && <DragLines scrollLeft={scrollLeft} {...dragLineData} />}
    </div>
  );
});