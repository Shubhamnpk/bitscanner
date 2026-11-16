import type { AnnotationItem } from '../types/scanner';
import { clamp } from './cvGeometry';

export type ResizeHandle = 'se' | 'e' | 's';

/**
 * Resizes an annotation item from a corner ('se') or edge ('e' | 's') pointer delta
 * expressed in normalized [0..1] stage coordinates.
 * - Signatures keep proportional aspect ratio on 'se' corner drag, and allow independent
 *   width stretching on 'e' edge drag (or height on 's').
 * - Text boxes scale fontSize proportionally on 'se' corner drag and reflow width on 'e'.
 * - Redactions resize freely across both axes.
 */
export function resizeAnnotationByDelta(
  orig: AnnotationItem,
  dxNorm: number,
  dyNorm: number,
  handle: ResizeHandle
): Partial<AnnotationItem> {
  const minW = 0.08;
  const minH = 0.03;
  const maxW = Math.max(minW, 0.98 - orig.x);
  const maxH = Math.max(minH, 0.98 - orig.y);

  if (handle === 'e') {
    const nextW = clamp(orig.width + dxNorm, minW, maxW);
    return { width: Number(nextW.toFixed(4)) };
  }

  if (handle === 's') {
    const nextH = clamp(orig.height + dyNorm, minH, maxH);
    if (orig.type === 'text') {
      const ratio = nextH / Math.max(0.02, orig.height);
      const nextFont = clamp((orig.fontSize ?? 0.032) * ratio, 0.014, 0.14);
      return {
        height: Number(nextH.toFixed(4)),
        fontSize: Number(nextFont.toFixed(4)),
      };
    }
    return { height: Number(nextH.toFixed(4)) };
  }

  // Bottom-right ('se') handle
  const rawW = clamp(orig.width + dxNorm, minW, maxW);
  if (orig.type === 'signature') {
    const aspect = orig.width / Math.max(0.015, orig.height);
    let nextW = rawW;
    let nextH = nextW / aspect;
    if (nextH > maxH) {
      nextH = maxH;
      nextW = clamp(nextH * aspect, minW, maxW);
    }
    if (nextH < minH) {
      nextH = minH;
      nextW = clamp(nextH * aspect, minW, maxW);
    }
    return {
      width: Number(nextW.toFixed(4)),
      height: Number(nextH.toFixed(4)),
    };
  }

  if (orig.type === 'text') {
    const scale = rawW / Math.max(minW, orig.width);
    const nextFont = clamp((orig.fontSize ?? 0.032) * scale, 0.014, 0.14);
    const nextH = clamp(orig.height * scale, minH, maxH);
    return {
      width: Number(rawW.toFixed(4)),
      height: Number(nextH.toFixed(4)),
      fontSize: Number(nextFont.toFixed(4)),
    };
  }

  const nextH = clamp(orig.height + dyNorm, minH, maxH);
  return {
    width: Number(rawW.toFixed(4)),
    height: Number(nextH.toFixed(4)),
  };
}

/**
 * Scales a selected annotation to a target normalized width (for slider / +/- controls),
 * keeping its center or left edge within bounds and proportionally scaling height/fontSize.
 */
export function scaleAnnotationToWidth(
  ann: AnnotationItem,
  targetWidth: number,
  preserveAspect = true
): Partial<AnnotationItem> {
  const minW = 0.08;
  const maxW = Math.max(minW, 0.98 - ann.x);
  const nextW = clamp(targetWidth, minW, maxW);

  if (!preserveAspect) {
    return { width: Number(nextW.toFixed(4)) };
  }

  const ratio = nextW / Math.max(0.02, ann.width);
  const maxH = Math.max(0.03, 0.98 - ann.y);
  const nextH = clamp(ann.height * ratio, 0.03, maxH);

  if (ann.type === 'text') {
    const nextFont = clamp((ann.fontSize ?? 0.032) * ratio, 0.014, 0.14);
    return {
      width: Number(nextW.toFixed(4)),
      height: Number(nextH.toFixed(4)),
      fontSize: Number(nextFont.toFixed(4)),
    };
  }

  return {
    width: Number(nextW.toFixed(4)),
    height: Number(nextH.toFixed(4)),
  };
}

/**
 * Computes the next pinch-zoom scale factor given initial zoom and two-finger distances.
 */
export function computePinchZoomScale(
  startZoom: number,
  startDist: number,
  currentDist: number,
  minZoom = 0.75,
  maxZoom = 3.0
): number {
  const safeStartDist = Math.max(10, startDist);
  const next = startZoom * (currentDist / safeStartDist);
  return Number(clamp(next, minZoom, maxZoom).toFixed(3));
}

/**
 * Clamps pan offset so zoomed document stays reachable within the stage viewport.
 */
export function clampPanOffset(
  panX: number,
  panY: number,
  zoomScale: number,
  stageWidth: number,
  stageHeight: number
): { x: number; y: number } {
  if (zoomScale <= 1.02) {
    return { x: 0, y: 0 };
  }
  const maxX = Math.max(60, ((zoomScale - 1) * stageWidth) / 2 + 40);
  const maxY = Math.max(60, ((zoomScale - 1) * stageHeight) / 2 + 40);
  return {
    x: Math.round(clamp(panX, -maxX, maxX)),
    y: Math.round(clamp(panY, -maxY, maxY)),
  };
}

