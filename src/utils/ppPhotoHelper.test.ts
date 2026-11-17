import test from 'node:test';
import assert from 'node:assert/strict';
import { computePassportFraming, computePassportSheetGrid } from './ppPhotoHelper';

test('computePassportSheetGrid lays out 35x45mm photos cleanly on 4x6 and A4 sheets', () => {
  const sheet4x6 = computePassportSheetGrid('35x45mm', '4x6in', 300, 3);
  assert.ok(sheet4x6.cols >= 3 && sheet4x6.rows >= 2);
  assert.equal(sheet4x6.totalPhotos, sheet4x6.cols * sheet4x6.rows);
  assert.ok(sheet4x6.marginX >= 0 && sheet4x6.marginY >= 0);

  const sheetA4 = computePassportSheetGrid('2x2in', 'a4', 300, 3);
  assert.ok(sheetA4.totalPhotos >= 12);
});

test('computePassportFraming calculates zoom and vertical offset per ICAO standards', () => {
  // A typical portrait face: normalized width 0.35, height 0.45, centered horizontally, near upper-middle
  const typicalFace = {
    x: 0.325,
    y: 0.20,
    width: 0.35,
    height: 0.45,
  };

  const framing = computePassportFraming(typicalFace, '35x45mm');
  // Zoom should be >= 1.0 and <= 2.4
  assert.ok(framing.zoom >= 1.0 && framing.zoom <= 2.4, `Zoom ${framing.zoom} should be in valid range`);
  // Offset should be within [-0.3, 0.3]
  assert.ok(framing.offsetY >= -0.3 && framing.offsetY <= 0.3, `Offset ${framing.offsetY} should be in valid range`);

  // Small/distant face: height 0.25 -> should yield higher zoom than larger face (height 0.55)
  const smallFace = { x: 0.35, y: 0.3, width: 0.25, height: 0.25 };
  const largeFace = { x: 0.2, y: 0.1, width: 0.55, height: 0.55 };

  const framingSmall = computePassportFraming(smallFace, '35x45mm');
  const framingLarge = computePassportFraming(largeFace, '35x45mm');
  assert.ok(framingSmall.zoom > framingLarge.zoom, 'Smaller face should receive higher zoom to achieve 70-80% height');
});

