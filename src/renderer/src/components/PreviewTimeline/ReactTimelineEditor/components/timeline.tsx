// @ts-nocheck
import React, { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, useMemo, useCallback } from 'react';
import { ScrollSync } from 'react-virtualized';
import { ITimelineEngine, TimelineEngine } from '../engine/engine';
import { MIN_SCALE_COUNT, PREFIX, START_CURSOR_TIME, ADD_SCALE_COUNT } from '../interface/const';
import { TimelineEditor, TimelineRow, TimelineState } from '../interface/timeline';
import { checkProps } from '../utils/check_props';
import { getScaleCountByRows, parserPixelToTime, parserTimeToPixel } from '../utils/deal_data';
import { Cursor } from './cursor/cursor';
import { EditArea } from './edit_area/edit_area';
import './timeline.less';
import { TimeArea } from './time_area/time_area';

const SCALE_STEP = 0.1;
const MIN_SCALE = 0.1;
const MAX_SCALE = 300;

const getAdjacentScale = (currentScale: number, deltaY: number) => {
  const current = Math.min(MAX_SCALE, Math.max(MIN_SCALE, currentScale));
  const next = deltaY < 0 ? current - SCALE_STEP : current + SCALE_STEP;
  const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
  return Math.round(clamped * 10) / 10;
};

export const Timeline = React.forwardRef<TimelineState, TimelineEditor>((props, ref) => {
  const checkedProps = checkProps(props);
  const { style } = props;
  let {
    effects,
    editorData: data,
    scrollTop,
    autoScroll,
    hideCursor,
    disableDrag,
    scale,
    scaleWidth,
    maxTimeSec,
    startLeft,
    minScaleCount,
    maxScaleCount,
    onChange,
    engine,
    autoReRender = true,
    onScroll: onScrollVertical,
  } = checkedProps;

  const engineRef = useRef<ITimelineEngine>(engine || new TimelineEngine());
  const domRef = useRef<HTMLDivElement>();
  const areaRef = useRef<HTMLDivElement>();
  const scrollSync = useRef<ScrollSync>();

  // 编辑器数据
  const [editorData, setEditorData] = useState(data);
  // scale数量
  const [scaleCount, setScaleCount] = useState(MIN_SCALE_COUNT);
  // 光标距离
  const [cursorTime, setCursorTime] = useState(START_CURSOR_TIME);
  // 是否正在运行
  const [isPlaying, setIsPlaying] = useState(false);
  // 当前时间轴宽度
  const [width, setWidth] = useState(Number.MAX_SAFE_INTEGER);
  // 水平缩放：单个刻度的显示宽度
  const [scaleWidthState, setScaleWidthState] = useState(scaleWidth);
  // 每个大刻度对应的时间长度（秒），随缩放动态变化
  const [scaleState, setScaleState] = useState(scale);

  /** 监听数据变化 */
  useLayoutEffect(() => {
    // 核心逻辑：确保无论数据多少，刻度必须覆盖 maxTimeSec
    const byData = getScaleCountByRows(data, { scale });
    const byDuration = Math.ceil((maxTimeSec || 0) / scale) + ADD_SCALE_COUNT;
    
    // 强制设置一个新的 scaleCount
    handleSetScaleCount(Math.max(byData, byDuration));
    setEditorData(data);
    setCursorTime(START_CURSOR_TIME);
    engineRef.current.setTime(START_CURSOR_TIME);
    scrollSync.current && scrollSync.current.setState({ scrollLeft: 0 });
  }, [data, minScaleCount, maxScaleCount, scale, maxTimeSec]);

  useEffect(() => {
    engineRef.current.effects = effects;
  }, [effects]);

  useEffect(() => {
    setScaleWidthState(scaleWidth);
  }, [scaleWidth]);

  useEffect(() => {
    setScaleState(scale);
  }, [scale]);

  useEffect(() => {
    engineRef.current.data = editorData;
  }, [editorData]);

  useEffect(() => {
    autoReRender && engineRef.current.reRender();
  }, [editorData]);

  // deprecated
  useEffect(() => {
    scrollSync.current && scrollSync.current.setState({ scrollTop: scrollTop });
  }, [scrollTop]);

  /** 动态设置scale count */
  const handleSetScaleCount = (value: number) => {
    const data = Math.min(maxScaleCount, Math.max(minScaleCount, value));
    setScaleCount(data);
  };

  /** 格式化时间戳（不补零：hh/mm为0则不显示；秒始终显示并附带两位小数，按需补0） */
  const formatHoverTime = useCallback((seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);

    const parts: string[] = [];
    if (h > 0) parts.push(String(h));
    if (m > 0) parts.push(String(m));

    const showSeconds = s > 0 || parts.length === 0 || ms >= 0;
    if (showSeconds) parts.push(`${s}.${String(ms).padStart(3, '0')}`);

    return parts.join(':');
  }, []);

  const [hoverInfo, setHoverInfo] = useState<{ x: number; y: number; time: number } | null>(null);

  /** 处理鼠标移动 */
  const handleMouseMove = (e: React.MouseEvent) => {
    // 注意：这里要用 domRef 而不是 areaRef，因为 TimeArea 是相对于整个 Timeline 容器的
    const rect = domRef.current?.getBoundingClientRect();
    if (!rect) return;

    const scrollLeft = scrollSync.current?.state.scrollLeft || 0;
    
    // 计算相对于时间轴起点的 X
    const xInTimeline = e.clientX - rect.left + scrollLeft;
    
    if (xInTimeline < startLeft) {
      setHoverInfo(null);
      return;
    }

    const time = parserPixelToTime(xInTimeline, { 
      startLeft, 
      scale: scaleState, 
      scaleWidth: scaleWidthState 
    });
    
    // 必须同时记录 x 和 y 用于 fixed 定位
    setHoverInfo({ 
      x: e.clientX, 
      y: e.clientY, 
      time 
    }); 
  };

  const handleMouseLeave = () => setHoverInfo(null);

  /** 缩放时间刻度宽度与刻度时间 */
  const handleZoomScaleWidth = (deltaY: number) => {
    const nextScale = getAdjacentScale(scaleState, deltaY);
    if (nextScale === scaleState) return;
    
    // 2. 计算刻度总数
    const byData = getScaleCountByRows(editorData, { scale: nextScale });
    const byDuration = Math.ceil(((maxTimeSec || 0) / nextScale)) + ADD_SCALE_COUNT;
    
    // 3. 同步所有状态
    handleSetScaleCount(Math.max(byData, byDuration));
    setScaleState(nextScale);
    
    // 注意：这里我们不再手动操作 scrollSync.current.setState，
    // 让滚动条保持原位，虽然会有轻微视觉偏移，但绝对不会“飞走”或“离谱跳变”。
  };
  
  /** 计算最大可滚动距离 */
  const maxScrollLeft = useMemo(() => {
    const contentWidth = scaleCount * scaleWidthState;
    // 最大距离 = 刻度宽度 + 左侧偏移 - 视图宽度 (再加上一点点缓冲)
    return Math.max(0, contentWidth + startLeft - width + 100); 
  }, [scaleCount, scaleWidthState, startLeft, width]);

  useEffect(() => {
    const currentScrollLeft = scrollSync.current?.state?.scrollLeft || 0;
    if (currentScrollLeft > maxScrollLeft) {
      scrollSync.current && scrollSync.current.setState({ scrollLeft: maxScrollLeft });
    }
  }, [maxScrollLeft]);

  /** 处理主动数据变化 */
  const handleEditorDataChange = (editorData: TimelineRow[]) => {
    const result = onChange(editorData);
    if (result !== false) {
      engineRef.current.data = editorData;
      autoReRender && engineRef.current.reRender();
    }
  };

  /** 处理光标 */
  const handleSetCursor = (param: { left?: number; time?: number; updateTime?: boolean }) => {
    let { left, time, updateTime = true } = param;
    if (typeof left === 'undefined' && typeof time === 'undefined') return;

    if (typeof time === 'undefined') {
      if (typeof left === 'undefined') left = parserTimeToPixel(time, { startLeft, scale: scaleState, scaleWidth: scaleWidthState });
      time = parserPixelToTime(left, { startLeft, scale: scaleState, scaleWidth: scaleWidthState });
    }

    let result = true;
    if (updateTime) {
      result = engineRef.current.setTime(time);
      autoReRender && engineRef.current.reRender();
    }
    result && setCursorTime(time);
    return result;
  };

  /** 设置scrollLeft */
  const handleDeltaScrollLeft = (delta: number) => {
    const current = scrollSync.current.state.scrollLeft;
    const target = Math.min(maxScrollLeft, Math.max(0, current + delta));
    scrollSync.current && scrollSync.current.setState({ scrollLeft: target });
  };

  // 处理运行器相关数据
  useEffect(() => {
    const handleTime = ({ time }) => {
      handleSetCursor({ time, updateTime: false });
    };
    const handlePlay = () => setIsPlaying(true);
    const handlePaused = () => setIsPlaying(false);
    engineRef.current.on('setTimeByTick', handleTime);
    engineRef.current.on('play', handlePlay);
    engineRef.current.on('paused', handlePaused);
  }, []);

  // ref 数据
  useImperativeHandle(ref, () => ({
    get target() {
      return domRef.current;
    },
    get listener() {
      return engineRef.current;
    },
    get isPlaying() {
      return engineRef.current.isPlaying;
    },
    get isPaused() {
      return engineRef.current.isPaused;
    },
    setPlayRate: engineRef.current.setPlayRate.bind(engineRef.current),
    getPlayRate: engineRef.current.getPlayRate.bind(engineRef.current),
    setTime: (time: number) => handleSetCursor({ time }),
    getTime: engineRef.current.getTime.bind(engineRef.current),
    reRender: engineRef.current.reRender.bind(engineRef.current),
    play: (param: Parameters<TimelineState['play']>[0]) => engineRef.current.play({ ...param }),
    pause: engineRef.current.pause.bind(engineRef.current),
    setScrollLeft: (val) => {
      scrollSync.current && scrollSync.current.setState({ scrollLeft: Math.max(val, 0) });
    },
    setScrollTop: (val) => {
      scrollSync.current && scrollSync.current.setState({ scrollTop: Math.max(val, 0) });
    },
  }));

  // 监听timeline区域宽度变化
  useEffect(() => {
    if (areaRef.current) {
      const resizeObserver = new ResizeObserver(() => {
        if (!areaRef.current) return;
        setWidth(areaRef.current.getBoundingClientRect().width);
      });
      resizeObserver.observe(areaRef.current!);
      return () => {
        resizeObserver && resizeObserver.disconnect();
      };
    }
  }, []);

  return (
    <div 
      ref={domRef} 
      style={style} 
      className={`${PREFIX} ${disableDrag ? PREFIX + '-disable' : ''}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <ScrollSync ref={scrollSync}>
        {({ scrollLeft, scrollTop, onScroll }) => (
          <>
            <TimeArea
              {...checkedProps}
              timelineWidth={width}
              disableDrag={disableDrag || isPlaying}
              setCursor={handleSetCursor}
              cursorTime={cursorTime}
              editorData={editorData}
              scaleCount={scaleCount}
              setScaleCount={handleSetScaleCount}
              onScroll={onScroll}
              scrollLeft={scrollLeft}
              scaleWidth={scaleWidthState}
              scale={scaleState}
              onZoom={handleZoomScaleWidth}
              hoverInfo={hoverInfo}
              formatHoverTime={formatHoverTime}
            />
            <EditArea
              {...checkedProps}
              timelineWidth={width}
              ref={(ref) => ((areaRef.current as any) = ref?.domRef.current)}
              disableDrag={disableDrag || isPlaying}
              editorData={editorData}
              cursorTime={cursorTime}
              scaleCount={scaleCount}
              setScaleCount={handleSetScaleCount}
              scrollTop={scrollTop}
              scrollLeft={scrollLeft}
              setEditorData={handleEditorDataChange}
              deltaScrollLeft={autoScroll && handleDeltaScrollLeft}
              hoverInfo={hoverInfo}
              onScroll={(params) => {
                console.log('EditArea 正在滚动，当前位置:', params.scrollLeft);
                onScroll(params);
              }}
              scaleWidth={scaleWidthState}
              scale={scaleState}
              onZoom={handleZoomScaleWidth}
            />
            {!hideCursor && (
              <Cursor
                {...checkedProps}
                timelineWidth={width}
                disableDrag={isPlaying}
                scrollLeft={scrollLeft}
                scaleCount={scaleCount}
                setScaleCount={handleSetScaleCount}
                setCursor={handleSetCursor}
                cursorTime={cursorTime}
                editorData={editorData}
                areaRef={areaRef}
                scrollSync={scrollSync}
                deltaScrollLeft={autoScroll && handleDeltaScrollLeft}
              />
            )}
          </>
        )}
      </ScrollSync>
    </div>
  );
});
