import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PreviewEngine } from '../engine/PreviewEngine';
import { useEditor } from '../store/editorStore';
import { PlaybackBar } from './PlaybackBar';
import { PreviewOverlay } from './PreviewOverlay';

const MAX_BACKING_WIDTH = 2560;

export function PreviewPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<PreviewEngine | null>(null);
  const width = useEditor((s) => s.doc.settings.width);
  const height = useEditor((s) => s.doc.settings.height);
  const [stage, setStage] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const engine = new PreviewEngine(canvasRef.current!);
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const fit = () => {
      const padding = 24;
      const availableW = Math.max(40, container.clientWidth - padding * 2);
      const availableH = Math.max(40, container.clientHeight - padding * 2);
      const scale = Math.min(availableW / width, availableH / height);
      const w = Math.floor(width * scale);
      const h = Math.floor(height * scale);
      setStage({ width: w, height: h });
      const dpr = window.devicePixelRatio || 1;
      const backingScale = Math.min((w * dpr) / width, MAX_BACKING_WIDTH / width, 1);
      engineRef.current?.resize(
        Math.round(width * backingScale),
        Math.round(height * backingScale),
      );
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
  }, [width, height]);

  const toggleFullscreen = () => {
    const el = containerRef.current?.parentElement;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-bg">
      <div
        ref={containerRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
      >
        <div
          ref={stageRef}
          className="relative shadow-2xl shadow-black/60"
          style={{ width: stage.width, height: stage.height }}
          data-testid="preview-stage"
        >
          <canvas ref={canvasRef} className="block h-full w-full" />
          <PreviewOverlay stageRef={stageRef} stageWidth={stage.width} stageHeight={stage.height} />
        </div>
      </div>
      <PlaybackBar onToggleFullscreen={toggleFullscreen} />
    </div>
  );
}
