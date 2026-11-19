import React, { useEffect, useRef, useState } from 'react';
import { Maximize2, Sparkles } from 'lucide-react';
import type { Point2D, QuadCorners } from '../types/scanner';
import { useHaptics } from '../hooks/useHaptics';
import { clamp } from '../utils/cvGeometry';

interface PerspectiveCropCanvasProps {
  imageSrc: string;
  quad: QuadCorners;
  onChange: (nextQuad: QuadCorners) => void;
  onAutoDetect?: () => void;
  detecting?: boolean;
  hideTopActions?: boolean;
}

const CORNER_LABELS = ['Top-left corner', 'Top-right corner', 'Bottom-right corner', 'Bottom-left corner'];
const EDGE_LABELS = ['Top edge', 'Right edge', 'Bottom edge', 'Left edge'];

export const PerspectiveCropCanvas: React.FC<PerspectiveCropCanvasProps> = ({
  imageSrc,
  quad,
  onChange,
  onAutoDetect,
  detecting = false,
  hideTopActions = false,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const loupeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const haptics = useHaptics();

  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [activeEdgeIdx, setActiveEdgeIdx] = useState<number | null>(null);
  const edgeDragStartRef = useRef<{
    startClient: Point2D;
    startQuad: QuadCorners;
  } | null>(null);
  const [dragPos, setDragPos] = useState<Point2D | null>(null);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
    };
    img.src = imageSrc;
  }, [imageSrc]);

  // Draw magnified precision loupe near dragged corner or edge midpoint
  useEffect(() => {
    if ((activeIdx === null && activeEdgeIdx === null) || !dragPos || !imgRef.current || !loupeCanvasRef.current) {
      return;
    }
    const ctx = loupeCanvasRef.current.getContext('2d');
    if (!ctx) return;
    const img = imgRef.current;
    const size = 92;
    const sampleRadius = Math.max(22, Math.min(img.naturalWidth, img.naturalHeight) * 0.055);
    const cx = dragPos.x * img.naturalWidth;
    const cy = dragPos.y * img.naturalHeight;

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(
      img,
      cx - sampleRadius,
      cy - sampleRadius,
      sampleRadius * 2,
      sampleRadius * 2,
      0,
      0,
      size,
      size
    );

    ctx.strokeStyle = '#14b8a6';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(size / 2, 0);
    ctx.lineTo(size / 2, size);
    ctx.moveTo(0, size / 2);
    ctx.lineTo(size, size / 2);
    ctx.stroke();
  }, [activeIdx, activeEdgeIdx, dragPos]);

  const updateCornerFromPointer = (clientX: number, clientY: number, idx: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nx = clamp((clientX - rect.left) / rect.width, 0, 1);
    const ny = clamp((clientY - rect.top) / rect.height, 0, 1);

    const next: QuadCorners = [
      { ...quad[0] },
      { ...quad[1] },
      { ...quad[2] },
      { ...quad[3] },
    ];
    next[idx] = { x: nx, y: ny };
    setDragPos({ x: nx, y: ny });
    onChange(next);
  };

  const updateEdgeFromPointer = (clientX: number, clientY: number, edgeIdx: number) => {
    const el = containerRef.current;
    const start = edgeDragStartRef.current;
    if (!el || !start) return;
    const rect = el.getBoundingClientRect();
    const dx = (clientX - start.startClient.x) / Math.max(1, rect.width);
    const dy = (clientY - start.startClient.y) / Math.max(1, rect.height);

    const i0 = edgeIdx;
    const i1 = (edgeIdx + 1) % 4;
    const base0 = start.startQuad[i0];
    const base1 = start.startQuad[i1];

    const next: QuadCorners = [
      { ...start.startQuad[0] },
      { ...start.startQuad[1] },
      { ...start.startQuad[2] },
      { ...start.startQuad[3] },
    ];
    next[i0] = {
      x: clamp(base0.x + dx, 0, 1),
      y: clamp(base0.y + dy, 0, 1),
    };
    next[i1] = {
      x: clamp(base1.x + dx, 0, 1),
      y: clamp(base1.y + dy, 0, 1),
    };
    setDragPos({
      x: (next[i0].x + next[i1].x) * 0.5,
      y: (next[i0].y + next[i1].y) * 0.5,
    });
    onChange(next);
  };

  const handleCornerPointerDown = (e: React.PointerEvent, idx: number) => {
    e.preventDefault();
    haptics.tap();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setActiveEdgeIdx(null);
    edgeDragStartRef.current = null;
    setActiveIdx(idx);
    setDragPos(quad[idx]);
  };

  const handleEdgePointerDown = (e: React.PointerEvent, edgeIdx: number) => {
    e.preventDefault();
    haptics.tap();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setActiveIdx(null);
    setActiveEdgeIdx(edgeIdx);
    edgeDragStartRef.current = {
      startClient: { x: e.clientX, y: e.clientY },
      startQuad: [
        { ...quad[0] },
        { ...quad[1] },
        { ...quad[2] },
        { ...quad[3] },
      ],
    };
    const i1 = (edgeIdx + 1) % 4;
    setDragPos({
      x: (quad[edgeIdx].x + quad[i1].x) * 0.5,
      y: (quad[edgeIdx].y + quad[i1].y) * 0.5,
    });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (activeIdx !== null) {
      updateCornerFromPointer(e.clientX, e.clientY, activeIdx);
    } else if (activeEdgeIdx !== null) {
      updateEdgeFromPointer(e.clientX, e.clientY, activeEdgeIdx);
    }
  };

  const handlePointerUp = () => {
    if (activeIdx !== null || activeEdgeIdx !== null) haptics.tap();
    setActiveIdx(null);
    setActiveEdgeIdx(null);
    edgeDragStartRef.current = null;
    setDragPos(null);
  };

  const setFullFrame = () => {
    haptics.tap();
    onChange([
      { x: 0.01, y: 0.01 },
      { x: 0.99, y: 0.01 },
      { x: 0.99, y: 0.99 },
      { x: 0.01, y: 0.99 },
    ]);
  };

  const polygonPoints = quad.map((p) => `${p.x * 100},${p.y * 100}`).join(' ');
  const scrimPath = `M 0,0 H 100 V 100 H 0 Z M ${quad[0].x * 100},${quad[0].y * 100} L ${quad[1].x * 100},${quad[1].y * 100} L ${quad[2].x * 100},${quad[2].y * 100} L ${quad[3].x * 100},${quad[3].y * 100} Z`;

  const isDragging = activeIdx !== null || activeEdgeIdx !== null;
  const lerpPt = (a: Point2D, b: Point2D, t: number): Point2D => ({
    x: (a.x + (b.x - a.x) * t) * 100,
    y: (a.y + (b.y - a.y) * t) * 100,
  });

  const loupeOnRight = dragPos ? dragPos.x < 0.38 && dragPos.y < 0.38 : false;

  return (
    <div className="flex flex-col gap-2.5">
      {!hideTopActions && (
        <div className="flex items-center justify-end gap-2">
          {onAutoDetect && (
            <button
              type="button"
              onClick={onAutoDetect}
              disabled={detecting}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-strong shadow-2xs hover:bg-surface-muted disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
              <span>{detecting ? 'Detecting...' : 'Auto-Detect'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={setFullFrame}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-soft shadow-2xs hover:bg-surface-muted whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Maximize2 className="h-3.5 w-3.5 text-ink-muted" aria-hidden="true" />
            <span>Full Frame</span>
          </button>
        </div>
      )}

      <div className="relative flex items-center justify-center rounded-2xl border border-line/80 editor-mat-bg p-3 sm:p-5 min-h-[260px] sm:min-h-[360px] max-h-[58dvh] sm:max-h-[480px] overflow-hidden select-none">
        <div
          ref={containerRef}
          className="relative inline-block max-h-[50dvh] sm:max-h-[430px] shadow-md"
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <img
            src={imageSrc}
            alt="Document source for perspective cropping"
            referrerPolicy="no-referrer"
            className="block max-h-[50dvh] sm:max-h-[430px] w-auto max-w-full rounded-sm object-contain pointer-events-none"
          />

          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full pointer-events-none"
          >
            <path d={scrimPath} fill="rgba(15, 23, 42, 0.42)" fillRule="evenodd" />
            {isDragging &&
              [1 / 3, 2 / 3].map((t, idx) => {
                const top = lerpPt(quad[0], quad[1], t);
                const bot = lerpPt(quad[3], quad[2], t);
                const left = lerpPt(quad[0], quad[3], t);
                const right = lerpPt(quad[1], quad[2], t);
                return (
                  <g key={idx} stroke="rgba(45, 212, 191, 0.55)" strokeWidth="0.35" vectorEffect="non-scaling-stroke">
                    <line x1={top.x} y1={top.y} x2={bot.x} y2={bot.y} />
                    <line x1={left.x} y1={left.y} x2={right.x} y2={right.y} />
                  </g>
                );
              })}
            <polygon
              points={polygonPoints}
              fill="rgba(20, 184, 166, 0.08)"
              stroke="#0d9488"
              strokeWidth="0.85"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {/* 4 draggable edge-midpoint bar handles */}
          {[0, 1, 2, 3].map((edgeIdx) => {
            const p0 = quad[edgeIdx];
            const p1 = quad[(edgeIdx + 1) % 4];
            const mx = ((p0.x + p1.x) * 0.5) * 100;
            const my = ((p0.y + p1.y) * 0.5) * 100;
            const angle = (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI;
            return (
              <button
                key={`edge-${edgeIdx}`}
                type="button"
                aria-label={EDGE_LABELS[edgeIdx]}
                data-testid={`crop-edge-handle-${edgeIdx}`}
                onPointerDown={(e) => handleEdgePointerDown(e, edgeIdx)}
                style={{
                  left: `${mx}%`,
                  top: `${my}%`,
                  transform: `translate(-50%, -50%) rotate(${angle}deg)`,
                }}
                className="absolute h-8 w-10 flex items-center justify-center touch-none cursor-grab active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-teal-500"
              >
                <span
                  className={`h-1.5 w-6 rounded-full border border-white shadow-md transition-colors ${
                    activeEdgeIdx === edgeIdx ? 'bg-teal-400 scale-110' : 'bg-accent'
                  }`}
                />
              </button>
            );
          })}

          {/* 4 draggable corner handles */}
          {quad.map((pt, idx) => (
            <button
              key={idx}
              type="button"
              aria-label={CORNER_LABELS[idx]}
              data-testid={`crop-corner-handle-${idx}`}
              onPointerDown={(e) => handleCornerPointerDown(e, idx)}
              style={{
                left: `${pt.x * 100}%`,
                top: `${pt.y * 100}%`,
              }}
              className={`absolute -translate-x-1/2 -translate-y-1/2 h-11 w-11 flex items-center justify-center rounded-full touch-none cursor-grab active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-teal-500 ${
                activeIdx === idx ? 'scale-115' : ''
              }`}
            >
              <span className="h-4.5 w-4.5 rounded-full bg-accent border-2 border-white shadow-md" />
            </button>
          ))}

          {/* Precision Loupe */}
          {isDragging && dragPos && (
            <div
              data-testid="crop-precision-loupe"
              className={`pointer-events-none absolute top-3 z-20 overflow-hidden rounded-full border-2 border-teal-500 shadow-lg bg-slate-900 ${
                loupeOnRight ? 'right-3' : 'left-3'
              }`}
              style={{ width: 92, height: 92 }}
            >
              <canvas ref={loupeCanvasRef} width={92} height={92} className="block" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
