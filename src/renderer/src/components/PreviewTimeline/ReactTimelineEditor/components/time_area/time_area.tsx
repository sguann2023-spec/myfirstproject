// @ts-nocheck
import { parserPixelToTime, parserTimeToPixel } from '../../utils/deal_data';
import React, { FC, useEffect, useRef } from 'react';
import { AutoSizer, Grid, GridCellRenderer, OnScrollParams } from 'react-virtualized';
import { CommonProp } from '../../interface/common_prop';
import { prefix } from '../../utils/deal_class_prefix';
import './time_area.less';

/** 动画时间轴组件参数 */
export type TimeAreaProps = CommonProp & {
  /** 左侧滚动距离 */
  scrollLeft: number;
  /** 滚动回调，用于同步滚动 */
  onScroll: (params: OnScrollParams) => void;
  /** 设置光标位置 */
  setCursor: (param: { left?: number; time?: number }) => void;
  /** 缩放时间刻度宽度 */
  onZoom?: (deltaY: number) => void;
  /** 时间轴总宽度（用于填充右侧空白） */
  timelineWidth: number;
  // 新增悬浮相关参数
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
  hoverInfo: { x: number; time: number } | null;
  formatHoverTime: (seconds: number) => string;
};

/** 动画时间轴组件 */
export const TimeArea: FC<TimeAreaProps> = ({ 
  setCursor, 
  maxScaleCount, 
  hideCursor, 
  scale, 
  scaleWidth, 
  scaleCount, 
  scaleSplitCount, 
  startLeft, 
  scrollLeft, 
  onClickTimeArea, 
  getScaleRender, 
  onZoom, 
  timelineWidth,
  onMouseMove, 
  onMouseLeave, 
  editorData,
  hoverInfo, 
  formatHoverTime }) => {
  const gridRef = useRef<Grid>();
  const interactRef = useRef<HTMLDivElement>(null);
  const lastScaleRef = useRef(1);
  /** 是否显示细分刻度 */
  const showUnit = scaleSplitCount > 0;
  const unitWidth = showUnit ? scaleWidth / scaleSplitCount : scaleWidth;
  // 1. 基础刻度列数
  const baseColumns = showUnit ? scaleCount * scaleSplitCount : scaleCount;
  
  // 2. 这里的 totalColumns 设为 baseColumns + 缓冲列（不再需要额外的末尾填充列）
  const totalColumns = baseColumns + 1;

  const gridKey = `grid-${scaleCount}-${scaleWidth}-${scaleSplitCount}`;

  const selectedRange = React.useMemo(() => {
    const rows = editorData || [];
    let action: any = null;
    for (let i = 0; i < rows.length && !action; i++) {
      action = rows[i].actions.find((a) => a.selected);
    }
    if (!action) return null;
    const leftAbs = parserTimeToPixel(action.start, { startLeft, scale, scaleWidth });
    const rightAbs = parserTimeToPixel(action.end, { startLeft, scale, scaleWidth });
    const visibleLeft = leftAbs - scrollLeft;
    const widthPx = Math.max(0, rightAbs - leftAbs);
    const durationSec = Math.max(0, action.end - action.start);
    return { left: visibleLeft, width: widthPx, durationSec };
  }, [editorData, startLeft, scale, scaleWidth, scrollLeft]);

  const formatSel = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const sWhole = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const pad3 = (n: number) => String(n).padStart(3, '0');
    return h > 0
      ? `${pad2(h)}:${pad2(m)}:${pad2(sWhole)}.${pad3(ms)}`
      : `${pad2(m)}:${pad2(sWhole)}.${pad3(ms)}`;
  };

  /** 获取每个cell渲染内容 */
  const cellRenderer: GridCellRenderer = ({ columnIndex, key, style }) => {
    if (columnIndex === 0) return <div key={key} style={style} />;

    const actualIndex = columnIndex - 1;
    // 只要不超过当前 baseColumns，就正常渲染刻度
    if (actualIndex >= baseColumns) return <div key={key} style={style} />;

    const majorIndex = showUnit ? Math.floor(actualIndex / scaleSplitCount) : actualIndex;
    const isShowScale = showUnit ? (actualIndex % scaleSplitCount === 0) : true;

    // 步长：建议固定一个合理的数字，比如 5 或 10，或者根据 scaleWidth 阶梯式变化
    const step = Math.max(1, Math.ceil(150 / scaleWidth));
    const showLabel = isShowScale && (majorIndex % step === 0);
    const item = majorIndex * scale;

    /** 核心变量：总细分数量 = 步长 * 每个大刻度的细分数 */
    const totalSubUnitsInStep = step * scaleSplitCount;

    /** 当前格子在整个“显示循环（Step）”中的相对位置 (0 ~ totalSubUnitsInStep - 1) */
    const indexInStep = (actualIndex) % totalSubUnitsInStep;

    // Dot 逻辑：也基于 actualIndex 计算
    let showDot = false;
    if (!showLabel) {
      const p1 = Math.round(totalSubUnitsInStep * 0.25);
      const p2 = Math.round(totalSubUnitsInStep * 0.5);
      const p3 = Math.round(totalSubUnitsInStep * 0.75);

      // 这里的判断不再受 !isShowScale 限制
      // 即使这一格是 Major Scale，只要它没标签，且符合 25/50/75% 的位置，就显示 Dot
      showDot = indexInStep === p1 || indexInStep === p2 || indexInStep === p3;
    }

    const classNames = ['time-unit'];
    if (isShowScale) classNames.push('time-unit-big');

    return (
      <div key={key} style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center'}} className={prefix(...classNames)}>
        {showLabel && <div className={prefix('time-unit-scale')}>{getScaleRender ? getScaleRender(item) : item}</div>}
        {showDot && <div className={prefix('time-unit-dot')} />}
      </div>
    );
  };

  useEffect(() => {
    gridRef.current?.recomputeGridSize();
  }, [scaleWidth, startLeft, timelineWidth]);

  useEffect(() => {
    const el = interactRef.current;
    if (!el) return;
    const handleGestureStart = (ev: any) => {
      try { ev.preventDefault(); } catch {}
      lastScaleRef.current = ev.scale || 1;
    };
    const handleGestureChange = (ev: any) => {
      try { ev.preventDefault(); } catch {}
      const prev = lastScaleRef.current || 1;
      const curr = ev.scale || 1;
      const delta = curr - prev;
      if (Math.abs(delta) > 0.03) onZoom && onZoom(delta < 0 ? 1 : -1);
      lastScaleRef.current = curr;
    };
    const handleGestureEnd = () => { lastScaleRef.current = 1; };
    el.addEventListener('gesturestart', handleGestureStart, { passive: false } as any);
    el.addEventListener('gesturechange', handleGestureChange, { passive: false } as any);
    el.addEventListener('gestureend', handleGestureEnd, { passive: false } as any);
    return () => {
      el.removeEventListener('gesturestart', handleGestureStart);
      el.removeEventListener('gesturechange', handleGestureChange);
      el.removeEventListener('gestureend', handleGestureEnd);
    };
  }, [onZoom]);


  /** 获取列宽 */
  const getColumnWidth = (data: { index: number }) => {
    if (data.index === 0) return startLeft;
    return unitWidth;
  };

  return (
    <div className={prefix('time-area')}>
      <AutoSizer>
        {({ width, height }) => {
          return (
            <>
              <Grid
                ref={gridRef}
                columnCount={totalColumns}
                columnWidth={getColumnWidth}
                rowCount={1}
                rowHeight={height}
                width={width}
                height={height}
                overscanRowCount={0}
                overscanColumnCount={30}
                cellRenderer={cellRenderer}
                scrollLeft={scrollLeft}
              ></Grid>
              <div
                ref={interactRef}
                style={{ width, height }}
                onMouseMove={onMouseMove}
                onMouseLeave={onMouseLeave}
                onWheel={(e) => {
                  // 仅在捏合缩放时（Chrome/Edge：wheel.ctrlKey为true）拦截并缩放；普通两指滚动保留滚动
                  if (e.ctrlKey && typeof onZoom === 'function') {
                    e.preventDefault();
                    onZoom(e.deltaY);
                  }
                }}
                onClick={(e) => {
                  if (hideCursor) return;
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const position = e.clientX - rect.x;
                  const left = Math.max(position + scrollLeft, startLeft);
                  
                  // 限制点击范围：不能超过实际刻度区域
                  const maxLeft = scaleCount * scaleWidth + startLeft;
                  if (left < startLeft || left > maxLeft) return;

                  const time = parserPixelToTime(left, { startLeft, scale, scaleWidth });
                  const result = onClickTimeArea && onClickTimeArea(time, e);
                  if (result === false) return; // 返回false时阻止设置时间
                  setCursor({ time });
                }}
                className={prefix('time-area-interact')}
              >
                {selectedRange && (
                  <div
                    className={prefix('time-selected-range')}
                    style={{ left: Math.max(selectedRange.left, 0), width: selectedRange.width }}
                  >
                    <div className={prefix('time-selected-range-label')}>{formatSel(selectedRange.durationSec)}</div>
                  </div>
                )}
                {/* 预览时间戳 */}
                {hoverInfo && (
                <div 
                  className={prefix('time-hover-tooltip-inline')}
                  style={{ 
                    // 保持现有的 left 计算
                    left: hoverInfo.x - (interactRef.current?.getBoundingClientRect().left || 0),
                    top: '4px',
                    // 核心设置：居中对齐
                    transform: 'translateX(-50%)', 
                    position: 'absolute',
                    pointerEvents: 'none',
                    zIndex: 10,
                  }}
                >
                  {formatHoverTime(hoverInfo.time)}
                </div>
                )}
              </div>
            </>
          );
        }}
      </AutoSizer>
    </div>
  );
};
