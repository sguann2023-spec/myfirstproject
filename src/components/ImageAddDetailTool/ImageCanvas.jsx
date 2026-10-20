import React from 'react';
import { Stage, Layer, Group, Rect, Image as CanvasImage, Transformer } from 'react-konva';
import { previewGeometry, transformSettings } from '../PresetAddDetail/presetModel';

const VISUAL_SETTINGS = [
  'positionX', 'positionY', 'scaleXPercent', 'scaleYPercent',
  'rotation', 'alphaPercent', 'uniformScale',
];

function ImageCanvas({ source, canvas, settings, disabled, onChange, onChoose }) {
  const nodeRef = React.useRef(null);
  const transformerRef = React.useRef(null);
  const [loaded, setLoaded] = React.useState(null);
  const [error, setError] = React.useState('');
  const image = loaded?.source === source ? loaded.image : null;
  React.useEffect(() => {
    let cancelled = false;
    setError('');
    const next = new window.Image();
    next.onload = () => { if (!cancelled) setLoaded({ source, image: next }); };
    next.onerror = () => { if (!cancelled) setError('图片预览加载失败，请重新选择图片'); };
    next.src = source;
    return () => { cancelled = true; };
  }, [source]);

  const geometry = previewGeometry(canvas, image && { width: image.naturalWidth, height: image.naturalHeight });
  const { width, height, ratio } = geometry;
  // Jianying fits media to the canvas before scale, and maps transform pixels
  // through normalized coordinates spanning half the canvas dimension.
  const fit = Math.min(width / geometry.presetWidth, height / geometry.presetHeight);
  const presetWidth = geometry.presetWidth * fit;
  const presetHeight = geometry.presetHeight * fit;
  const positionRatio = ratio / 2;
  React.useLayoutEffect(() => {
    transformerRef.current?.nodes(disabled || !image || !nodeRef.current ? [] : [nodeRef.current]);
    transformerRef.current?.getLayer()?.batchDraw();
  }, [disabled, image, presetWidth, presetHeight]);
  const commit = () => {
    const node = nodeRef.current;
    if (!node || disabled) return;
    const patch = transformSettings(node, { ...geometry, ratio: positionRatio });
    node.position({ x: width / 2 + patch.positionX * positionRatio, y: height / 2 - patch.positionY * positionRatio });
    node.scale({ x: patch.scaleXPercent / 100, y: patch.scaleYPercent / 100 });
    node.rotation(patch.rotation);
    onChange(patch);
  };

  return <>
    <div className="chat-panel__preset-canvas" aria-label="图片画布">
      <Stage width={width + 24} height={height + 24}>
        <Layer x={12} y={12}>
          <Rect width={width} height={height} fill="#111111" listening={false} />
          <Group clipX={0} clipY={0} clipWidth={width} clipHeight={height}>
            <Group ref={nodeRef} name="image-object"
              x={width / 2 + settings.positionX * positionRatio} y={height / 2 - settings.positionY * positionRatio}
              offsetX={presetWidth / 2} offsetY={presetHeight / 2} width={presetWidth} height={presetHeight}
              scaleX={settings.scaleXPercent / 100} scaleY={settings.scaleYPercent / 100}
              rotation={settings.rotation} opacity={settings.alphaPercent / 100}
              draggable={!disabled && Boolean(image)} onDragEnd={commit} onTransformEnd={commit}
              onDblClick={onChoose} onDblTap={onChoose}>
              {image && <CanvasImage image={image} width={presetWidth} height={presetHeight} />}
            </Group>
          </Group>
          <Transformer ref={transformerRef} rotateEnabled={!disabled} resizeEnabled={!disabled}
            flipEnabled={false} keepRatio={settings.uniformScale} centeredScaling rotateAnchorOffset={8}
            enabledAnchors={settings.uniformScale ? ['top-left', 'top-right', 'bottom-left', 'bottom-right'] : undefined}
            boundBoxFunc={(oldBox, nextBox) => Math.abs(nextBox.width) < 2 || Math.abs(nextBox.height) < 2 ? oldBox : nextBox} />
        </Layer>
      </Stage>
    </div>
    {error ? <div className="chat-panel__text-preset-error" role="alert">{error}</div> : !image ? <div role="status">正在加载图片...</div> : null}
  </>;
}

// Timing and track edits do not affect this static image preview.
export default React.memo(ImageCanvas, (prev, next) => (
  prev.source === next.source &&
  prev.canvas?.width === next.canvas?.width &&
  prev.canvas?.height === next.canvas?.height &&
  prev.disabled === next.disabled &&
  prev.onChange === next.onChange &&
  prev.onChoose === next.onChoose &&
  VISUAL_SETTINGS.every((key) => Object.is(prev.settings[key], next.settings[key]))
));
