import React from 'react';
import {
  ArrowRight,
  Check,
  Circle,
  CopyPlus,
  Lock,
  Minus,
  Plus,
  Slash,
  Square,
  Trash2,
  Unlock,
} from 'lucide-react';
import type { AnnotationItem, ShapeKind } from '../types/scanner';
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

const STAMP_COLORS = ['#b91c1c', '#0f172a', '#1d4ed8', '#047857', '#0f766e'];
const SHAPE_TYPES: Array<{ id: ShapeKind; label: string; icon: React.FC<{ className?: string }> }> = [
  { id: 'rect', label: 'Box', icon: Square },
  { id: 'circle', label: 'Circle', icon: Circle },
  { id: 'arrow', label: 'Arrow', icon: ArrowRight },
  { id: 'line', label: 'Line', icon: Slash },
  { id: 'check', label: 'Check', icon: Check },
];

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
      annotation.type === 'signature' ? aspectLocked : annotation.type === 'text'
    );
    onUpdate(patch);
  };

  return (
    <div
      data-testid="selected-overlay-controls"
      className={`rounded-xl border border-teal-500/35 bg-accent-soft/55 ${
        compact ? 'p-2.5 gap-2' : 'p-3 gap-2.5'
      } flex flex-col`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold capitalize text-accent-text">
          Edit{' '}
          {annotation.type === 'redaction'
            ? 'Redaction'
            : annotation.type === 'shape'
              ? `Shape (${annotation.shapeKind || 'rect'})`
              : annotation.type}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onDuplicate}
            aria-label="Duplicate selected overlay"
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-line bg-surface px-2 text-[11px] font-medium text-ink-soft hover:bg-surface-muted cursor-pointer"
          >
            <CopyPlus className="h-3 w-3" aria-hidden="true" />
            <span>Copy</span>
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label="Remove selected overlay"
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-danger-line bg-surface px-2 text-[11px] font-medium text-danger hover:bg-danger-soft cursor-pointer"
          >
            <Trash2 className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Text Content & Color Editor */}
      {annotation.type === 'text' && (
        <div className="flex flex-col gap-2">
          <input
            id={`edit-ann-text-${annotation.id}`}
            type="text"
            value={annotation.text || ''}
            onChange={(e) => onUpdate({ text: e.target.value })}
            placeholder="Enter text..."
            aria-label="Edit selected text"
            className="w-full min-h-[36px] rounded-lg border border-line-strong bg-surface px-2.5 py-1 text-sm font-medium text-ink focus:border-accent focus:outline-none"
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              {STAMP_COLORS.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => onUpdate({ color: hex })}
                  aria-label={`Set text color ${hex}`}
                  style={{ backgroundColor: hex }}
                  className={`h-5 w-5 rounded-full border-2 cursor-pointer transition-transform ${
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
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-line bg-surface text-ink-soft hover:bg-surface-muted cursor-pointer"
              >
                <Minus className="h-3 w-3" aria-hidden="true" />
              </button>
              <span className="min-w-[36px] text-center font-mono-tabular text-[11px] font-semibold text-ink-strong">
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
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-line bg-surface text-ink-soft hover:bg-surface-muted cursor-pointer"
              >
                <Plus className="h-3 w-3" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shape Controls: Kind + Stroke Color + Thickness */}
      {annotation.type === 'shape' && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-5 gap-1">
            {SHAPE_TYPES.map((s) => {
              const Icon = s.icon;
              const active = (annotation.shapeKind || 'rect') === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onUpdate({ shapeKind: s.id })}
                  className={`flex flex-col items-center justify-center gap-0.5 rounded-lg border py-1 text-[10px] font-semibold cursor-pointer ${
                    active
                      ? 'border-accent bg-surface text-accent-text shadow-2xs'
                      : 'border-line bg-white/70 text-ink-muted'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{s.label}</span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              {STAMP_COLORS.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => onUpdate({ color: hex })}
                  aria-label={`Set shape color ${hex}`}
                  style={{ backgroundColor: hex }}
                  className={`h-5 w-5 rounded-full border-2 cursor-pointer ${
                    (annotation.color || '#0f766e') === hex
                      ? 'border-slate-900 scale-110'
                      : 'border-white'
                  }`}
                />
              ))}
            </div>
            {(annotation.shapeKind === 'rect' || annotation.shapeKind === 'circle' || !annotation.shapeKind) && (
              <button
                type="button"
                onClick={() =>
                  onUpdate({
                    fillColor:
                      annotation.fillColor && annotation.fillColor !== 'transparent'
                        ? 'transparent'
                        : `${annotation.color || '#0f766e'}22`,
                  })
                }
                className={`rounded-lg border px-2 py-1 text-[10px] font-semibold cursor-pointer ${
                  annotation.fillColor && annotation.fillColor !== 'transparent'
                    ? 'border-accent bg-accent text-white'
                    : 'border-line bg-surface text-ink-soft'
                }`}
              >
                {annotation.fillColor && annotation.fillColor !== 'transparent' ? 'Filled' : 'Outline'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Static-bounds Width Slider + Stepper (fixed max=92 so moving x never shifts slider thumb!) */}
      <div>
        <div className="mb-1 flex items-center justify-between text-[11px] text-ink-soft">
          <div className="flex items-center gap-1.5">
            <span>{annotation.type === 'signature' ? 'Size' : 'Width'}</span>
            {annotation.type === 'signature' && (
              <button
                type="button"
                onClick={onToggleAspectLock}
                aria-label={aspectLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
                className="inline-flex items-center gap-0.5 rounded bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-ink-soft border border-line cursor-pointer"
              >
                {aspectLocked ? (
                  <Lock className="h-2.5 w-2.5 text-accent" aria-hidden="true" />
                ) : (
                  <Unlock className="h-2.5 w-2.5 text-warning" aria-hidden="true" />
                )}
                <span>{aspectLocked ? 'Lock' : 'Free'}</span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Decrease overlay width"
              onClick={() => nudgeSize(-0.06)}
              className="flex h-6 w-6 items-center justify-center rounded border border-line bg-surface text-ink-soft hover:bg-surface-muted cursor-pointer"
            >
              <Minus className="h-3 w-3" aria-hidden="true" />
            </button>
            <span className="min-w-[34px] text-center font-mono-tabular font-semibold text-ink">
              {widthPct}%
            </span>
            <button
              type="button"
              aria-label="Increase overlay width"
              onClick={() => nudgeSize(0.06)}
              className="flex h-6 w-6 items-center justify-center rounded border border-line bg-surface text-ink-soft hover:bg-surface-muted cursor-pointer"
            >
              <Plus className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        </div>
        <input
          type="range"
          min={8}
          max={92}
          value={clamp(widthPct, 8, 92)}
          aria-label="Selected overlay width percentage"
          data-testid="overlay-width-slider"
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
              <div className="mb-1 flex justify-between text-[11px] text-ink-muted">
                <span>Height</span>
                <span className="font-mono-tabular">{heightPct}%</span>
              </div>
              <input
                type="range"
                min={4}
                max={80}
                value={clamp(heightPct, 4, 80)}
                aria-label="Signature height percentage"
                onChange={(e) => {
                  const nextH = clamp(Number(e.target.value) / 100, 0.03, 0.8);
                  onUpdate({
                    height: nextH,
                    y: clamp(annotation.y, 0.01, Math.max(0.01, 0.99 - nextH)),
                  });
                }}
                className="studio-slider w-full"
              />
            </div>
          )}
          <div>
            <div className="mb-1 flex justify-between text-[11px] text-ink-muted">
              <span>Opacity</span>
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

      {/* Shape Height & Redaction Height + Toggle */}
      {(annotation.type === 'redaction' || annotation.type === 'shape') && (
        <div className="flex flex-col gap-2">
          <div>
            <div className="mb-1 flex justify-between text-[11px] text-ink-muted">
              <span>Height</span>
              <span className="font-mono-tabular">{heightPct}%</span>
            </div>
            <input
              type="range"
              min={3}
              max={75}
              value={clamp(heightPct, 3, 75)}
              aria-label="Box height percentage"
              onChange={(e) => {
                const nextH = clamp(Number(e.target.value) / 100, 0.03, 0.75);
                onUpdate({
                  height: nextH,
                  y: clamp(annotation.y, 0.01, Math.max(0.01, 0.99 - nextH)),
                });
              }}
              className="studio-slider w-full"
            />
          </div>
          {annotation.type === 'redaction' && (
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => onUpdate({ color: '#09090b' })}
                className={`rounded-lg border py-1.5 text-[11px] font-semibold cursor-pointer ${
                  (annotation.color || '#09090b') === '#09090b'
                    ? 'border-slate-900 bg-slate-900 text-white dark:border-teal-500 dark:bg-accent dark:text-white'
                    : 'border-line bg-surface text-ink-soft dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                Blackout
              </button>
              <button
                type="button"
                onClick={() => onUpdate({ color: '#ffffff' })}
                className={`rounded-lg border py-1.5 text-[11px] font-semibold cursor-pointer ${
                  annotation.color === '#ffffff'
                    ? 'border-accent bg-accent-soft text-accent-text dark:border-teal-400 dark:bg-teal-500/20 dark:text-teal-200'
                    : 'border-line bg-surface text-ink-soft dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                White-Out
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

