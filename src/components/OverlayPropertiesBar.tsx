import React from 'react';
import {
  CopyPlus,
  Lock,
  Minus,
  Plus,
  Trash2,
  Unlock,
} from 'lucide-react';
import type { AnnotationItem } from '../types/scanner';
import { clamp } from '../utils/cvGeometry';
import { scaleAnnotationToWidth } from '../utils/annotationHelpers';

interface OverlayPropertiesBarProps {
  annotation: AnnotationItem;
  aspectLocked: boolean;
  onToggleAspectLock: () => void;
  onUpdate: (patch: Partial<AnnotationItem>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  compact?: boolean;
}

const STAMP_COLORS = ['#b91c1c', '#0f172a', '#1d4ed8', '#047857', '#7c3aed'];

export const OverlayPropertiesBar: React.FC<OverlayPropertiesBarProps> = ({
  annotation,
  aspectLocked,
  onToggleAspectLock,
  onUpdate,
  onDuplicate,
  onDelete,
  compact = false,
}) => {
  const widthPct = Math.round(annotation.width * 100);
  const heightPct = Math.round(annotation.height * 100);
  const opacityPct = Math.round((annotation.opacity ?? 1) * 100);
  const fontScalePct = Math.round(((annotation.fontSize ?? 0.032) / 0.032) * 100);

  const nudgeSize = (deltaWidth: number) => {
    const patch = scaleAnnotationToWidth(
      annotation,
      annotation.width + deltaWidth,
      annotation.type === 'signature' ? aspectLocked : true
    );
    onUpdate(patch);
  };

  return (
    <div
      data-testid="selected-overlay-controls"
      className={`rounded-xl border border-teal-500/35 bg-teal-50/60 ${
        compact ? 'p-2.5' : 'p-3'
      } flex flex-col gap-2.5`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold capitalize text-teal-950">
          Selected {annotation.type === 'redaction' ? 'Redaction Box' : annotation.type}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onDuplicate}
            aria-label="Duplicate selected overlay"
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <CopyPlus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Copy</span>
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label="Remove selected overlay"
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-red-200 bg-white px-2 text-[11px] font-medium text-red-600 hover:bg-red-50 cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Text Content & Color Editor */}
      {annotation.type === 'text' && (
        <>
          <div>
            <label
              htmlFor={`edit-ann-text-${annotation.id}`}
              className="block text-[11px] font-medium text-slate-600 mb-1"
            >
              Edit Text
            </label>
            <input
              id={`edit-ann-text-${annotation.id}`}
              type="text"
              value={annotation.text || ''}
              onChange={(e) => onUpdate({ text: e.target.value })}
              placeholder="Enter text..."
              aria-label="Edit selected text"
              className="w-full min-h-[38px] rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-900 focus:border-teal-600 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-600 mr-0.5">Ink</span>
              {STAMP_COLORS.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => onUpdate({ color: hex })}
                  aria-label={`Set text color ${hex}`}
                  style={{ backgroundColor: hex }}
                  className={`h-6 w-6 rounded-full border-2 cursor-pointer transition-transform ${
                    (annotation.color || '#b91c1c') === hex
                      ? 'border-slate-900 scale-110'
                      : 'border-white'
                  }`}
                />
              ))}
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Decrease text size"
                onClick={() =>
                  onUpdate({
                    fontSize: clamp((annotation.fontSize ?? 0.032) - 0.005, 0.014, 0.14),
                  })
                }
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <Minus className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <span className="min-w-[40px] text-center font-mono-tabular text-[11px] font-semibold text-slate-800">
                {fontScalePct}%
              </span>
              <button
                type="button"
                aria-label="Increase text size"
                onClick={() =>
                  onUpdate({
                    fontSize: clamp((annotation.fontSize ?? 0.032) + 0.005, 0.014, 0.14),
                  })
                }
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* Width / Size Slider + Stepper (All non-stroke overlays) */}
      <div>
        <div className="mb-1 flex items-center justify-between text-[11px] text-slate-700">
          <div className="flex items-center gap-1.5">
            <span>{annotation.type === 'signature' ? 'Signature Width' : 'Box Width'}</span>
            {annotation.type === 'signature' && (
              <button
                type="button"
                onClick={onToggleAspectLock}
                aria-label={aspectLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
                className="inline-flex items-center gap-0.5 rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 border border-slate-200 cursor-pointer"
              >
                {aspectLocked ? (
                  <Lock className="h-2.5 w-2.5 text-teal-600" aria-hidden="true" />
                ) : (
                  <Unlock className="h-2.5 w-2.5 text-amber-600" aria-hidden="true" />
                )}
                <span>{aspectLocked ? 'Ratio' : 'Free'}</span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Decrease overlay width"
              onClick={() => nudgeSize(-0.06)}
              className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <Minus className="h-3 w-3" aria-hidden="true" />
            </button>
            <span className="min-w-[34px] text-center font-mono-tabular font-semibold text-slate-900">
              {widthPct}%
            </span>
            <button
              type="button"
              aria-label="Increase overlay width"
              onClick={() => nudgeSize(0.06)}
              className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <Plus className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        </div>
        <input
          type="range"
          min={8}
          max={Math.min(95, Math.round((0.98 - annotation.x) * 100))}
          value={widthPct}
          aria-label="Selected overlay width percentage"
          onChange={(e) => {
            const targetW = Number(e.target.value) / 100;
            onUpdate(
              scaleAnnotationToWidth(
                annotation,
                targetW,
                annotation.type === 'signature' ? aspectLocked : annotation.type === 'text'
              )
            );
          }}
          className="studio-slider w-full"
        />
      </div>

      {/* Signature height (when unlocked) & Opacity */}
      {annotation.type === 'signature' && (
        <div className={aspectLocked ? '' : 'grid grid-cols-2 gap-2.5'}>
          {!aspectLocked && (
            <div>
              <div className="mb-1 flex justify-between text-[11px] text-slate-600">
                <span>Height</span>
                <span className="font-mono-tabular">{heightPct}%</span>
              </div>
              <input
                type="range"
                min={4}
                max={Math.min(70, Math.round((0.98 - annotation.y) * 100))}
                value={heightPct}
                aria-label="Signature height percentage"
                onChange={(e) =>
                  onUpdate({
                    height: clamp(Number(e.target.value) / 100, 0.03, 0.98 - annotation.y),
                  })
                }
                className="studio-slider w-full"
              />
            </div>
          )}
          <div>
            <div className="mb-1 flex justify-between text-[11px] text-slate-600">
              <span>Ink Opacity</span>
              <span className="font-mono-tabular">{opacityPct}%</span>
            </div>
            <input
              type="range"
              min={35}
              max={100}
              value={opacityPct}
              aria-label="Signature opacity"
              onChange={(e) => onUpdate({ opacity: Number(e.target.value) / 100 })}
              className="studio-slider w-full"
            />
          </div>
        </div>
      )}

      {/* Redaction Height & Blackout/White-out toggle */}
      {annotation.type === 'redaction' && (
        <div className="flex flex-col gap-2">
          <div>
            <div className="mb-1 flex justify-between text-[11px] text-slate-600">
              <span>Height</span>
              <span className="font-mono-tabular">{heightPct}%</span>
            </div>
            <input
              type="range"
              min={3}
              max={Math.min(60, Math.round((0.98 - annotation.y) * 100))}
              value={heightPct}
              aria-label="Redaction height percentage"
              onChange={(e) =>
                onUpdate({
                  height: clamp(Number(e.target.value) / 100, 0.03, 0.98 - annotation.y),
                })
              }
              className="studio-slider w-full"
            />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => onUpdate({ color: '#09090b' })}
              className={`rounded-lg border py-1.5 text-[11px] font-semibold cursor-pointer ${
                (annotation.color || '#09090b') === '#09090b'
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              Blackout Redact
            </button>
            <button
              type="button"
              onClick={() => onUpdate({ color: '#ffffff' })}
              className={`rounded-lg border py-1.5 text-[11px] font-semibold cursor-pointer ${
                annotation.color === '#ffffff'
                  ? 'border-teal-600 bg-teal-50 text-teal-900'
                  : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              White-Out Eraser
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
