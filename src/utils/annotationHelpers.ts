import type { AnnotationItem } from '../types/scanner';
import { clamp } from './cvGeometry';

export type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se' | 'e' | 's';

/**
 * Computes centered normalized [x, y] coordinates for spawning new overlays cleanly on page.
 */
export function computeCenteredPlacement(width: number, height: number): { x: number; y: number } {
  const x = clamp((1 - width) * 0.5, 0.02, Math.max(0.02, 0.98 - width));
  const y = clamp((1 - height) * 0.5, 0.02, Math.max(0.02, 0.98 - height));
  return {
    x: Number(x.toFixed(4)),
    y: Number(y.toFixed(4)),
  };
}

/**
 * Clamps a move drag strictly so box position changes never mutate box dimensions.
 */
export function clampAnnotationMove(
  origX: number,
  origY: number,
  width: number,
  height: number,
  dxNorm: number,
  dyNorm: number
): { x: number; y: number } {
  const maxX = Math.max(0.01, 0.99 - width);
  const maxY = Math.max(0.01, 0.99 - height);
  return {
    x: Number(clamp(origX + dxNorm, 0.01, maxX).toFixed(4)),
    y: Number(clamp(origY + dyNorm, 0.01, maxY).toFixed(4)),
  };
}

/**
 * Resizes an annotation item from any corner ('nw' | 'ne' | 'sw' | 'se') or edge ('e' | 's')
 * pointer delta expressed in normalized [0..1] stage coordinates.
 * - Left-side corners ('nw', 'sw') anchor the right edge and expand/shrink leftward cleanly.
 * - Top corners ('nw', 'ne') anchor the bottom edge cleanly.
 * - Signatures keep proportional aspect ratio on all 4 corner drags.
 * - Text boxes scale fontSize proportionally on all 4 corner drags and on 's'.
 */
export function resizeAnnotationByDelta(
  orig: AnnotationItem,
  dxNorm: number,
  dyNorm: number,
  handle: ResizeHandle
): Partial<AnnotationItem> {
  const minW = 0.08;
  const minH = 0.03;

  if (handle === 'e') {
    const maxW = Math.max(minW, 0.99 - orig.x);
    const nextW = clamp(orig.width + dxNorm, minW, maxW);
    return { width: Number(nextW.toFixed(4)) };
  }

  if (handle === 's') {
    const maxH = Math.max(minH, 0.99 - orig.y);
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

  const anchorsLeft = handle === 'ne' || handle === 'se';
  const anchorsTop = handle === 'sw' || handle === 'se';
  const rightEdge = orig.x + orig.width;
  const bottomEdge = orig.y + orig.height;

  const maxAllowedW = anchorsLeft ? Math.max(minW, 0.99 - orig.x) : Math.max(minW, rightEdge - 0.01);
  const maxAllowedH = anchorsTop ? Math.max(minH, 0.99 - orig.y) : Math.max(minH, bottomEdge - 0.01);

  const deltaW = anchorsLeft ? dxNorm : -dxNorm;
  const deltaH = anchorsTop ? dyNorm : -dyNorm;

  const rawW = clamp(orig.width + deltaW, minW, maxAllowedW);

  let nextW = rawW;
  let nextH = clamp(orig.height + deltaH, minH, maxAllowedH);
  let extraFontSize: number | undefined;

  if (orig.type === 'signature') {
    const aspect = orig.width / Math.max(0.015, orig.height);
    nextH = nextW / aspect;
    if (nextH > maxAllowedH) {
      nextH = maxAllowedH;
      nextW = clamp(nextH * aspect, minW, maxAllowedW);
    }
    if (nextH < minH) {
      nextH = minH;
      nextW = clamp(nextH * aspect, minW, maxAllowedW);
    }
  } else if (orig.type === 'text') {
    const scale = rawW / Math.max(minW, orig.width);
    nextH = clamp(orig.height * scale, minH, maxAllowedH);
    extraFontSize = Number(clamp((orig.fontSize ?? 0.032) * scale, 0.014, 0.14).toFixed(4));
  }

  const nextX = anchorsLeft ? orig.x : clamp(rightEdge - nextW, 0.01, rightEdge - minW);
  const nextY = anchorsTop ? orig.y : clamp(bottomEdge - nextH, 0.01, bottomEdge - minH);

  const result: Partial<AnnotationItem> = {
    x: Number(nextX.toFixed(4)),
    y: Number(nextY.toFixed(4)),
    width: Number(nextW.toFixed(4)),
    height: Number(nextH.toFixed(4)),
  };
  if (extraFontSize !== undefined) {
    result.fontSize = extraFontSize;
  }
  return result;
}

/**
 * Scales a selected annotation to a target normalized width (for slider / +/- controls),
 * keeping its bounds inside the page by nudging x/y cleanly rather than changing slider max.
 */
export function scaleAnnotationToWidth(
  ann: AnnotationItem,
  targetWidth: number,
  preserveAspect = true
): Partial<AnnotationItem> {
  const minW = 0.08;
  const nextW = clamp(targetWidth, minW, 0.92);
  const nextX = clamp(ann.x, 0.01, Math.max(0.01, 0.99 - nextW));

  if (!preserveAspect) {
    return {
      x: Number(nextX.toFixed(4)),
      width: Number(nextW.toFixed(4)),
    };
  }

  const ratio = nextW / Math.max(0.02, ann.width);
  const nextH = clamp(ann.height * ratio, 0.03, 0.92);
  const nextY = clamp(ann.y, 0.01, Math.max(0.01, 0.99 - nextH));

  if (ann.type === 'text') {
    const nextFont = clamp((ann.fontSize ?? 0.032) * ratio, 0.014, 0.14);
    return {
      x: Number(nextX.toFixed(4)),
      y: Number(nextY.toFixed(4)),
      width: Number(nextW.toFixed(4)),
      height: Number(nextH.toFixed(4)),
      fontSize: Number(nextFont.toFixed(4)),
    };
  }

  return {
    x: Number(nextX.toFixed(4)),
    y: Number(nextY.toFixed(4)),
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

/**
 * Evaluates a completed swipe gesture and returns -1 (previous page), +1 (next page),
 * or 0 (stay on current page), enforcing horizontal directional dominance and page bounds.
 */
export function computeSwipePageDelta(
  dx: number,
  dy: number,
  elapsedMs: number,
  currentIdx: number,
  totalPages: number
): -1 | 0 | 1 {
  if (totalPages <= 1) return 0;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (absX < 22 || absX < absY * 1.2) return 0;

  const velocity = absX / Math.max(16, elapsedMs);
  const triggered = absX >= 54 || velocity >= 0.35;
  if (!triggered) return 0;

  if (dx < 0) {
    return currentIdx < totalPages - 1 ? 1 : 0;
  }
  return currentIdx > 0 ? -1 : 0;
}

/**
 * Computes live horizontal translation during a swipe drag with gentle edge rubber-banding.
 */
export function computeRubberBandSwipeOffset(
  dx: number,
  currentIdx: number,
  totalPages: number
): number {
  if (totalPages <= 1) return 0;
  const hittingStartEdge = currentIdx <= 0 && dx > 0;
  const hittingEndEdge = currentIdx >= totalPages - 1 && dx < 0;
  if (hittingStartEdge || hittingEndEdge) {
    return Math.round(clamp(dx * 0.25, -48, 48));
  }
  return Math.round(clamp(dx, -180, 180));
}

