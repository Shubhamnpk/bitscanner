import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampAnnotationMove,
  clampPanOffset,
  computeCenteredPlacement,
  computePinchZoomScale,
  resizeAnnotationByDelta,
  scaleAnnotationToWidth,
} from './annotationHelpers';
import type { AnnotationItem } from '../types/scanner';

test('computeCenteredPlacement spawns overlays in the exact center of the sheet', () => {
  assert.deepEqual(computeCenteredPlacement(0.34, 0.14), { x: 0.33, y: 0.43 });
  assert.deepEqual(computeCenteredPlacement(0.36, 0.06), { x: 0.32, y: 0.47 });
});

test('clampAnnotationMove moves position strictly inside page without altering size', () => {
  const moved = clampAnnotationMove(0.32, 0.47, 0.36, 0.06, 0.8, 0.8);
  assert.ok(Math.abs(moved.x - 0.63) < 1e-3);
  assert.ok(Math.abs(moved.y - 0.93) < 1e-3);
  const topLeft = clampAnnotationMove(0.32, 0.47, 0.36, 0.06, -0.9, -0.9);
  assert.equal(topLeft.x, 0.01);
  assert.equal(topLeft.y, 0.01);
});

test('resizeAnnotationByDelta keeps signature aspect on SE & NW corner drags and allows width-only stretch on E edge', () => {
  const sig: AnnotationItem = {
    id: 'sig-1',
    type: 'signature',
    x: 0.2,
    y: 0.2,
    width: 0.3,
    height: 0.15,
    imageDataUrl: 'data:image/png;base64,test',
  };

  // SE drag wider by +0.15 -> 0.30 -> 0.45, so height scales proportionally 0.15 -> 0.225
  const sePatch = resizeAnnotationByDelta(sig, 0.15, 0.04, 'se');
  assert.ok(Math.abs((sePatch.width ?? 0) - 0.45) < 1e-3);
  assert.ok(Math.abs((sePatch.height ?? 0) - 0.225) < 1e-3);
  assert.equal(sePatch.x, 0.2);

  // NW drag left & up (-0.1, -0.05) -> anchors right edge (0.5) & bottom edge (0.35), widens to 0.40
  const nwPatch = resizeAnnotationByDelta(sig, -0.1, -0.05, 'nw');
  assert.ok(Math.abs((nwPatch.width ?? 0) - 0.4) < 1e-3);
  assert.ok(Math.abs((nwPatch.height ?? 0) - 0.2) < 1e-3);
  assert.ok(Math.abs((nwPatch.x ?? 0) - 0.1) < 1e-3);
  assert.ok(Math.abs((nwPatch.y ?? 0) - 0.15) < 1e-3);

  // SW drag left (-0.1) -> anchors top-right (right=0.5, y=0.2), widens leftward
  const swPatch = resizeAnnotationByDelta(sig, -0.1, 0.05, 'sw');
  assert.ok(Math.abs((swPatch.width ?? 0) - 0.4) < 1e-3);
  assert.ok(Math.abs((swPatch.x ?? 0) - 0.1) < 1e-3);
  assert.equal(swPatch.y, 0.2);

  // E edge drag widens signature without forcing height change
  const ePatch = resizeAnnotationByDelta(sig, 0.2, 0.09, 'e');
  assert.ok(Math.abs((ePatch.width ?? 0) - 0.5) < 1e-3);
  assert.equal(ePatch.height, undefined);
});

test('resizeAnnotationByDelta scales text fontSize proportionally on left-side NW/SW and SE drags', () => {
  const txt: AnnotationItem = {
    id: 'txt-1',
    type: 'text',
    x: 0.3,
    y: 0.4,
    width: 0.2,
    height: 0.05,
    text: 'APPROVED',
    fontSize: 0.03,
  };

  const seBigger = resizeAnnotationByDelta(txt, 0.2, 0.05, 'se');
  assert.ok(Math.abs((seBigger.width ?? 0) - 0.4) < 1e-3);
  assert.ok(Math.abs((seBigger.fontSize ?? 0) - 0.06) < 1e-3);

  // Dragging bottom-left corner leftward (-0.2) doubles width from 0.2 -> 0.4 and fontSize 0.03 -> 0.06
  const swBigger = resizeAnnotationByDelta(txt, -0.2, 0.04, 'sw');
  assert.ok(Math.abs((swBigger.width ?? 0) - 0.4) < 1e-3);
  assert.ok(Math.abs((swBigger.x ?? 0) - 0.1) < 1e-3);
  assert.ok(Math.abs((swBigger.fontSize ?? 0) - 0.06) < 1e-3);
});

test('scaleAnnotationToWidth allows full slider width up to 0.92 and shifts x inward cleanly', () => {
  const box: AnnotationItem = {
    id: 'sig-2',
    type: 'signature',
    x: 0.65,
    y: 0.7,
    width: 0.2,
    height: 0.1,
  };

  const scaled = scaleAnnotationToWidth(box, 0.5, true);
  assert.ok(Math.abs((scaled.width ?? 0) - 0.5) < 1e-3);
  assert.ok(Math.abs((scaled.x ?? 0) - 0.49) < 1e-3);
  assert.ok((scaled.y ?? 0) + (scaled.height ?? 0) <= 0.9901);
});

test('computePinchZoomScale scales smoothly on pinch out/in and clamps to bounds', () => {
  assert.equal(computePinchZoomScale(1.0, 100, 175), 1.75);
  assert.equal(computePinchZoomScale(2.0, 100, 40), 0.8);
  assert.equal(computePinchZoomScale(2.5, 100, 300), 3.0);
  assert.equal(computePinchZoomScale(1.0, 100, 20), 0.75);
});

test('clampPanOffset resets at 1x zoom and bounds panning when zoomed in', () => {
  assert.deepEqual(clampPanOffset(120, -90, 1.0, 360, 500), { x: 0, y: 0 });
  const zoomed = clampPanOffset(500, -600, 2.0, 360, 500);
  assert.ok(zoomed.x <= 220 && zoomed.x > 0);
  assert.ok(zoomed.y >= -290 && zoomed.y < 0);
});
