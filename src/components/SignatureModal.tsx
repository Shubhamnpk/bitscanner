import React, { useEffect, useRef, useState } from 'react';
import { Download, Eraser, FileText, PenTool, Type, X } from 'lucide-react';
import type { SavedSignature } from '../types/scanner';
import { useHaptics } from '../hooks/useHaptics';

export interface SignatureDocPayload {
  label: string;
  transparentDataUrl: string;
  compositedDataUrl: string;
  backgroundColor: string;
  width: number;
  height: number;
}

interface SignatureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveSignature: (sig: SavedSignature) => void;
  onSaveAsDocument?: (payload: SignatureDocPayload) => void;
  primaryButtonLabel?: string;
}

const INK_COLORS = [
  { id: 'black', label: 'Ink Black', hex: '#0f172a' },
  { id: 'blue', label: 'Royal Blue', hex: '#1d4ed8' },
  { id: 'red', label: 'Crimson', hex: '#b91c1c' },
  { id: 'teal', label: 'Deep Teal', hex: '#0f766e' },
];

const BG_PRESETS = [
  { id: 'transparent', label: 'Transparent', value: 'transparent' },
  { id: 'white', label: 'White', value: '#ffffff' },
  { id: 'cream', label: 'Warm Cream', value: '#fef9ec' },
  { id: 'slate', label: 'Cool Paper', value: '#f1f5f9' },
];

export const SignatureModal: React.FC<SignatureModalProps> = ({
  isOpen,
  onClose,
  onSaveSignature,
  onSaveAsDocument,
  primaryButtonLabel = 'Save & Place Signature',
}) => {
  const haptics = useHaptics();
  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const [inkColor, setInkColor] = useState('#0f172a');
  const [backgroundColor, setBackgroundColor] = useState('transparent');
  const [strokeWidth, setStrokeWidth] = useState(3.5);
  const [typedName, setTypedName] = useState('');
  const [label, setLabel] = useState('My Signature');
  const [hasDrawn, setHasDrawn] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPtRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setHasDrawn(false);
      setTypedName('');
      return;
    }
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [isOpen, mode]);

  if (!isOpen) return null;

  const isReady = mode === 'draw' ? hasDrawn : typedName.trim().length > 0;

  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    lastPtRef.current = getCanvasPoint(e);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || !lastPtRef.current || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    const pt = getCanvasPoint(e);
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(lastPtRef.current.x, lastPtRef.current.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    lastPtRef.current = pt;
    setHasDrawn(true);
  };

  const handlePointerUp = () => {
    drawingRef.current = false;
    lastPtRef.current = null;
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const buildRenderedOutputs = (): {
    transparentDataUrl: string;
    compositedDataUrl: string;
    width: number;
    height: number;
  } | null => {
    if (!isReady) return null;

    const width = 720;
    const height = 260;

    // 1. Source transparent signature layer
    const fgCanvas = document.createElement('canvas');
    fgCanvas.width = width;
    fgCanvas.height = height;
    const fgCtx = fgCanvas.getContext('2d');
    if (!fgCtx) return null;

    if (mode === 'draw') {
      if (!canvasRef.current) return null;
      fgCtx.drawImage(canvasRef.current, 0, 0, width, height);
    } else {
      const text = typedName.trim();
      fgCtx.fillStyle = inkColor;
      fgCtx.font = '600 92px "Caveat", cursive';
      fgCtx.textAlign = 'center';
      fgCtx.textBaseline = 'middle';
      fgCtx.fillText(text, width / 2, height / 2);
    }

    const transparentDataUrl = fgCanvas.toDataURL('image/png');
    if (backgroundColor === 'transparent') {
      return {
        transparentDataUrl,
        compositedDataUrl: transparentDataUrl,
        width,
        height,
      };
    }

    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = width;
    bgCanvas.height = height;
    const bgCtx = bgCanvas.getContext('2d');
    if (!bgCtx) {
      return {
        transparentDataUrl,
        compositedDataUrl: transparentDataUrl,
        width,
        height,
      };
    }

    bgCtx.fillStyle = backgroundColor;
    bgCtx.fillRect(0, 0, width, height);
    bgCtx.drawImage(fgCanvas, 0, 0);

    return {
      transparentDataUrl,
      compositedDataUrl: bgCanvas.toDataURL('image/png'),
      width,
      height,
    };
  };

  const resolvedLabel = label.trim() || (mode === 'type' ? typedName.trim() : 'Signature');

  const handleSaveAsset = () => {
    const rendered = buildRenderedOutputs();
    if (!rendered) return;
    haptics.success();
    onSaveSignature({
      id: crypto.randomUUID(),
      label: resolvedLabel,
      dataUrl: rendered.compositedDataUrl,
      backgroundColor,
      createdAt: Date.now(),
    });
    onClose();
  };

  const handleSaveDoc = () => {
    if (!onSaveAsDocument) return;
    const rendered = buildRenderedOutputs();
    if (!rendered) return;
    haptics.success();
    onSaveAsDocument({
      label: resolvedLabel,
      transparentDataUrl: rendered.transparentDataUrl,
      compositedDataUrl: rendered.compositedDataUrl,
      backgroundColor,
      width: rendered.width,
      height: rendered.height,
    });
    onClose();
  };

  const handleDownloadPng = () => {
    const rendered = buildRenderedOutputs();
    if (!rendered) return;
    haptics.tap();
    const safeName = resolvedLabel.replace(/[^a-zA-Z0-9_\-. ]/g, '_');
    const a = document.createElement('a');
    a.href = rendered.compositedDataUrl;
    a.download = `${safeName}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const padStyle: React.CSSProperties =
    backgroundColor === 'transparent'
      ? {
          backgroundImage:
            'linear-gradient(45deg, #f1f5f9 25%, transparent 25%), linear-gradient(-45deg, #f1f5f9 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f1f5f9 75%), linear-gradient(-45deg, transparent 75%, #f1f5f9 75%)',
          backgroundSize: '16px 16px',
          backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
          backgroundColor: '#ffffff',
        }
      : { backgroundColor };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="signature-modal-title"
      data-testid="signature-modal"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 p-0 sm:p-4 backdrop-blur-xs"
    >
      <div className="w-full max-w-xl rounded-t-3xl sm:rounded-2xl border border-line bg-surface shadow-xl overflow-hidden animate-sheet-up pb-safe max-h-[94dvh] flex flex-col">
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-line-strong sm:hidden" />
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5 sm:py-4 shrink-0">
          <h2 id="signature-modal-title" className="text-base font-bold text-ink">
            Signature Studio
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close signature dialog"
            className="flex h-11 w-11 sm:h-8 sm:w-8 items-center justify-center rounded-xl text-ink-faint hover:bg-surface-subtle hover:text-ink-soft cursor-pointer"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4 overflow-y-auto">
          {/* Mode + Ink Color Row */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 rounded-lg bg-surface-subtle p-1">
              <button
                type="button"
                onClick={() => setMode('draw')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer ${
                  mode === 'draw' ? 'bg-surface text-ink shadow-xs' : 'text-ink-muted'
                }`}
              >
                <PenTool className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Draw</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('type')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer ${
                  mode === 'type' ? 'bg-surface text-ink shadow-xs' : 'text-ink-muted'
                }`}
              >
                <Type className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Type</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-ink-muted">Ink</span>
              {INK_COLORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-label={c.label}
                  onClick={() => setInkColor(c.hex)}
                  style={{ backgroundColor: c.hex }}
                  className={`h-6 w-6 rounded-full border-2 cursor-pointer ${
                    inkColor === c.hex ? 'border-teal-500 scale-110' : 'border-white shadow-xs'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Background Finish Selector */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface-muted/70 px-3 py-2">
            <span className="text-xs font-medium text-ink-muted">Background</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {BG_PRESETS.map((bg) => (
                <button
                  key={bg.id}
                  type="button"
                  data-testid={`sig-bg-${bg.id}`}
                  onClick={() => setBackgroundColor(bg.value)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors ${
                    backgroundColor === bg.value
                      ? 'border-accent bg-accent-soft text-accent-text'
                      : 'border-line bg-surface text-ink-soft hover:bg-surface-muted'
                  }`}
                >
                  <span
                    className="h-3 w-3 rounded-sm border border-line-strong"
                    style={
                      bg.value === 'transparent'
                        ? {
                            backgroundImage:
                              'linear-gradient(45deg, #cbd5e1 25%, transparent 25%), linear-gradient(-45deg, #cbd5e1 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #cbd5e1 75%), linear-gradient(-45deg, transparent 75%, #cbd5e1 75%)',
                            backgroundSize: '6px 6px',
                          }
                        : { backgroundColor: bg.value }
                    }
                  />
                  <span>{bg.label}</span>
                </button>
              ))}
              <label
                title="Custom background color"
                className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs font-medium text-ink-muted cursor-pointer"
              >
                <span>Custom</span>
                <input
                  type="color"
                  aria-label="Custom signature background color"
                  value={backgroundColor === 'transparent' ? '#ffffff' : backgroundColor}
                  onChange={(e) => setBackgroundColor(e.target.value)}
                  className="h-4 w-5 cursor-pointer border-0 bg-transparent p-0"
                />
              </label>
            </div>
          </div>

          {mode === 'draw' ? (
            <div>
              <div
                style={padStyle}
                className="relative rounded-xl border border-line overflow-hidden"
              >
                <canvas
                  ref={canvasRef}
                  width={540}
                  height={200}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  className="w-full h-44 touch-none cursor-crosshair block"
                />
                {!hasDrawn && (
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-ink-faint">
                    Sign here with mouse or touch
                  </span>
                )}
                <div className="pointer-events-none absolute bottom-6 left-8 right-8 border-b border-dashed border-line-strong" />
              </div>
              <div className="mt-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink-muted">Thickness</span>
                  <input
                    type="range"
                    min={1.5}
                    max={8}
                    step={0.5}
                    value={strokeWidth}
                    onChange={(e) => setStrokeWidth(Number(e.target.value))}
                    aria-label="Stroke thickness"
                    className="studio-slider w-28"
                  />
                </div>
                <button
                  type="button"
                  onClick={clearCanvas}
                  className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink cursor-pointer"
                >
                  <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Clear</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <input
                type="text"
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                placeholder="Type your full name..."
                aria-label="Signature text"
                className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
              />
              <div
                style={{ ...padStyle, fontFamily: 'var(--font-script)', color: inkColor }}
                className="flex h-36 items-center justify-center rounded-xl border border-line px-4 text-5xl"
              >
                {typedName || 'Evelyn Thorne'}
              </div>
            </div>
          )}

          <div>
            <label htmlFor="sig-label-input" className="block text-xs font-medium text-ink-muted mb-1">
              Signature Name
            </label>
            <input
              id="sig-label-input"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full rounded-lg border border-line px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-muted px-5 py-3.5 shrink-0">
          <button
            type="button"
            disabled={!isReady}
            onClick={handleDownloadPng}
            data-testid="sig-download-png-btn"
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink-soft hover:bg-surface-subtle disabled:opacity-45 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Download PNG</span>
          </button>

          <div className="flex flex-wrap items-center gap-2 ml-auto">
            {onSaveAsDocument && (
              <button
                type="button"
                disabled={!isReady}
                onClick={handleSaveDoc}
                data-testid="sig-save-as-doc-btn"
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-teal-600/30 bg-accent-soft px-3.5 py-2 text-xs font-semibold text-accent-text hover:bg-accent-soft disabled:opacity-45 cursor-pointer"
              >
                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Save as Document</span>
              </button>
            )}
            <button
              type="button"
              disabled={!isReady}
              onClick={handleSaveAsset}
              data-testid="sig-save-asset-btn"
              className="min-h-[40px] rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-strong disabled:opacity-45 cursor-pointer"
            >
              {primaryButtonLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

