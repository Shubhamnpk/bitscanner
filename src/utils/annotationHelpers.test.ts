import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampPanOffset,
  computePinchZoomScale,
  resizeAnnotationByDelta,
  scaleAnnotationToWidth,
} from './annotationHelpers';
import type { AnnotationItem } from '../types/scanner';

test('resizeAnnotationByDelta keeps signature aspect on SE corner drag and allows width-only stretch on E edge', () => {
  const sig: AnnotationItem = {
    id: 'sig-1',
    type: 'signature',
    x: 0.2,
    y: 0.2,
    width: 0.3,
    height: 0.15,
    imageDataUrl: 'data:image/png;base64,test',
  };

  // SE drag wider by +0.15 -> doubles 0.30 -> 0.45, so height scales proportionally 0.15 -> 0.225
  const sePatch = resizeAnnotationByDelta(sig, 0.15, 0.04, 'se');
  assert.ok(Math.abs((sePatch.width ?? 0) - 0.45) < 1e-3);
  assert.ok(Math.abs((sePatch.height ?? 0) - 0.225) < 1e-3);

  // E edge drag widens signature without forcing height change
  const ePatch = resizeAnnotationByDelta(sig, 0.2, 0.09, 'e');
  assert.ok(Math.abs((ePatch.width ?? 0) - 0.5) < 1e-3);
  assert.equal(ePatch.height, undefined);
});

test('resizeAnnotationByDelta scales text fontSize proportionally on SE drag', () => {
  const txt: AnnotationItem = {
    id: 'txt-1',
    type: 'text',
    x: 0.1,
    y: 0.1,
    width: 0.2,
    height: 0.05,
    text: 'APPROVED',
    fontSize: 0.03,
  };

  const bigger = resizeAnnotationByDelta(txt, 0.2, 0.05, 'se');
  assert.ok(Math.abs((bigger.width ?? 0) - 0.4) < 1e-3);
  assert.ok(Math.abs((bigger.fontSize ?? 0) - 0.06) < 1e-3);
});

test('scaleAnnotationToWidth clamps inside page bounds and updates proportional size', () => {
  const box: AnnotationItem = {
    id: 'sig-2',
    type: 'signature',
    x: 0.65,
    y: 0.7,
    width: 0.2,
    height: 0.1,
  };

  const scaled = scaleAnnotationToWidth(box, 0.5, true);
  // Clamped to 0.98 - 0.65 = 0.33 max width
  assert.ok(Math.abs((scaled.width ?? 0) - 0.33) < 1e-3);
  assert.ok((scaled.height ?? 0) <= 0.28);
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

