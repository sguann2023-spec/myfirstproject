import React from 'react';

const VoiceCircularVisualizer = ({
  audioUrl,
  width = 40,
  height = 40,
  backgroundColor = 'rgba(0, 0, 0, 0)',
  gradientColors = ['#fc88af', '#3bffaf', '#3f9dff'],
  barWidth = 1,
  fftSize = 128,
  smoothingTimeConstant = 0.65,
  minDecibels = -90,
  maxDecibels = -10,
  animationSpeed = 1,
  onAudioEnd,
  onError,
}) => {
  const canvasRef = React.useRef(null);
  const animationFrameRef = React.useRef(null);
  const rotationRef = React.useRef(0);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audioUrl) return undefined;

    let cancelled = false;
    let audioContext = null;
    let analyser = null;
    let source = null;
    let endedByCleanup = false;
    let dataArray = null;

    const stopAnimation = () => {
      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };

    const cleanup = () => {
      endedByCleanup = true;
      stopAnimation();

      try {
        source?.stop?.(0);
      } catch (error) {
        // Source may already be stopped; ignore this cleanup error.
      }

      try {
        source?.disconnect?.();
      } catch (error) {
        // Ignore disconnect errors during teardown.
      }

      try {
        analyser?.disconnect?.();
      } catch (error) {
        // Ignore disconnect errors during teardown.
      }

      try {
        audioContext?.close?.();
      } catch (error) {
        // Ignore close errors during teardown.
      }
    };

    const createGradient = (ctx, radius) => {
      const gradient = ctx.createRadialGradient(width / 2, height / 2, radius * 0.2, width / 2, height / 2, radius);
      const safeColors = Array.isArray(gradientColors) && gradientColors.length > 0 ? gradientColors : ['#3f9dff'];
      const step = safeColors.length === 1 ? 1 : 1 / (safeColors.length - 1);
      safeColors.forEach((color, index) => {
        gradient.addColorStop(index * step, color);
      });
      return gradient;
    };

    const draw = () => {
      if (!canvas || !analyser || !dataArray) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      analyser.getByteFrequencyData(dataArray);
      ctx.clearRect(0, 0, width, height);

      const centerX = width / 2;
      const centerY = height / 2;
      const radius = Math.min(width, height) / 3;
      const bars = Math.min(dataArray.length, 64);
      const angleStep = (2 * Math.PI) / bars;

      rotationRef.current += 0.002 * animationSpeed;
      if (rotationRef.current >= 2 * Math.PI) {
        rotationRef.current = 0;
      }

      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(rotationRef.current);
      ctx.strokeStyle = createGradient(ctx, radius * 1.6);
      ctx.lineWidth = barWidth;

      for (let i = 0; i < bars; i += 1) {
        const angle = i * angleStep;
        const magnitude = dataArray[i] / 255;
        const barHeight = magnitude * radius;
        const x1 = Math.cos(angle) * radius;
        const y1 = Math.sin(angle) * radius;
        const x2 = Math.cos(angle) * (radius + barHeight);
        const y2 = Math.sin(angle) * (radius + barHeight);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      ctx.restore();
      animationFrameRef.current = window.requestAnimationFrame(draw);
    };

    const init = async () => {
      try {
        const AudioContextCtor = window.AudioContext || globalThis.webkitAudioContext;
        if (!AudioContextCtor) {
          throw new Error('AudioContext is not supported');
        }

        audioContext = new AudioContextCtor();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = fftSize;
        analyser.smoothingTimeConstant = smoothingTimeConstant;
        analyser.minDecibels = minDecibels;
        analyser.maxDecibels = maxDecibels;
        dataArray = new Uint8Array(analyser.frequencyBinCount);

        const response = await fetch(audioUrl);
        if (!response.ok) {
          throw new Error(`HTTP error ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        if (cancelled) {
          cleanup();
          return;
        }

        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        if (cancelled) {
          cleanup();
          return;
        }

        source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(analyser);
        analyser.connect(audioContext.destination);
        source.onended = () => {
          if (!endedByCleanup) {
            onAudioEnd?.();
          }
        };

        canvas.width = width;
        canvas.height = height;
        draw();
        source.start(0);
      } catch (error) {
        cleanup();
        if (!cancelled) {
          onError?.(error);
        }
      }
    };

    void init();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [
    animationSpeed,
    audioUrl,
    barWidth,
    fftSize,
    gradientColors,
    height,
    maxDecibels,
    minDecibels,
    onAudioEnd,
    onError,
    smoothingTimeConstant,
    width,
  ]);

  return (
    <div
      style={{
        width: `${width}px`,
        height: `${height}px`,
        background: backgroundColor,
        borderRadius: '50%',
        overflow: 'hidden',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          background: 'transparent',
        }}
      />
    </div>
  );
};

export default React.memo(VoiceCircularVisualizer);
