import React from 'react';
import { Stage, Layer, Group, Rect, Image as CanvasImage, Transformer } from 'react-konva';
import { previewGeometry, transformSettings } from './presetModel';

function PresetCanvas({ preset, metadata, canvas, settings, disabled, onChange, onChoose }) {
  const nodeRef = React.useRef(null);
  const transformerRef = React.useRef(null);
  const [image, setImage] = React.useState(null);
  const cover = String(preset?.image_url || preset?.cover || '').trim().replace(/^[\s'"`]+|[\s'"`]+$/g, '');
  React.useEffect(() => {
    let cancelled = false;
    setImage(null);
    if (!cover) return undefined;
    const next = new window.Image();
    next.onload = () => { if (!cancelled) setImage(next); };
    next.src = cover;
    return () => { cancelled = true; };
  }, [cover]);
  const dimensions = metadata?.width && metadata?.height ? metadata :
    image ? { width: image.naturalWidth, height: image.naturalHeight } : metadata;
  const geometry = previewGeometry(canvas, dimensions);
  const { width, height, ratio } = geometry;
  // Match the fitted media size and normalized center offsets used by Jianying.
  const mediaFit = Math.min(width / geometry.presetWidth, height / geometry.presetHeight);
  const presetWidth = geometry.presetWidth * mediaFit;
  const presetHeight = geometry.presetHeight * mediaFit;
  const positionRatio = ratio / 2;
  React.useLayoutEffect(() => {
    transformerRef.current?.nodes(disabled || !nodeRef.current ? [] : [nodeRef.current]);
    transformerRef.current?.getLayer()?.batchDraw();
  }, [disabled, preset, presetWidth, presetHeight]);
  const commit = () => {
    const node = nodeRef.current;
    if (!node || disabled) return;
    const patch = transformSettings(node, { ...geometry, ratio: positionRatio });
    node.position({ x: width / 2 + patch.positionX * positionRatio, y: height / 2 - patch.positionY * positionRatio });
    node.scale({ x: patch.scaleXPercent / 100, y: patch.scaleYPercent / 100 });
    node.rotation(patch.rotation);
    onChange(patch);
  };
  // 保持封面完整，空余区域留黑，不使用裁剪填充。
  const fit = image ? Math.min(presetWidth / image.naturalWidth, presetHeight / image.naturalHeight) : 1;
  const imageWidth = image ? image.naturalWidth * fit : presetWidth;
  const imageHeight = image ? image.naturalHeight * fit : presetHeight;
  return <div className="chat-panel__preset-canvas" aria-label="预设画布">
    <Stage width={width + 24} height={height + 24}>
      <Layer x={12} y={12}>
        <Rect width={width} height={height} fill="#111111" listening={false} />
        <Group clipX={0} clipY={0} clipWidth={width} clipHeight={height}>
        <Group ref={nodeRef} name="preset-object" x={width / 2 + settings.positionX * positionRatio}
          y={height / 2 - settings.positionY * positionRatio}
          offsetX={presetWidth / 2} offsetY={presetHeight / 2}
          width={presetWidth} height={presetHeight}
          scaleX={settings.scaleXPercent / 100} scaleY={settings.scaleYPercent / 100}
          rotation={settings.rotation} draggable={!disabled}
          onDragEnd={commit} onTransformEnd={commit}
          onDblClick={onChoose} onDblTap={onChoose}>
          <Rect width={presetWidth} height={presetHeight} fill="#111111" />
          {image && <CanvasImage image={image} width={imageWidth} height={imageHeight}
            x={(presetWidth - imageWidth) / 2} y={(presetHeight - imageHeight) / 2} />}
        </Group>
        </Group>
        <Transformer ref={transformerRef} rotateEnabled={!disabled} resizeEnabled={!disabled}
          flipEnabled={false} keepRatio={settings.uniformScale} centeredScaling rotateAnchorOffset={8}
          enabledAnchors={settings.uniformScale ? ['top-left', 'top-right', 'bottom-left', 'bottom-right'] : undefined}
          boundBoxFunc={(oldBox, nextBox) => Math.abs(nextBox.width) < 2 || Math.abs(nextBox.height) < 2 ? oldBox : nextBox} />
      </Layer>
    </Stage>
  </div>;
}

export default React.memo(PresetCanvas, (prev, next) => (
  prev.preset === next.preset &&
  prev.metadata?.width === next.metadata?.width && prev.metadata?.height === next.metadata?.height &&
  prev.canvas?.width === next.canvas?.width && prev.canvas?.height === next.canvas?.height &&
  prev.disabled === next.disabled && prev.onChange === next.onChange && prev.onChoose === next.onChoose &&
  ['positionX', 'positionY', 'scaleXPercent', 'scaleYPercent', 'rotation', 'uniformScale']
    .every((key) => Object.is(prev.settings[key], next.settings[key]))
));
