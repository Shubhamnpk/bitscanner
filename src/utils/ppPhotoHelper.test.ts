import test from 'node:test';
import assert from 'node:assert/strict';
import { computePassportSheetGrid } from './ppPhotoHelper';

test('computePassportSheetGrid lays out 35x45mm photos cleanly on 4x6 and A4 sheets', () => {
  const sheet4x6 = computePassportSheetGrid('35x45mm', '4x6in', 300, 3);
  assert.ok(sheet4x6.cols >= 3 && sheet4x6.rows >= 2);
  assert.equal(sheet4x6.totalPhotos, sheet4x6.cols * sheet4x6.rows);
  assert.ok(sheet4x6.marginX >= 0 && sheet4x6.marginY >= 0);

  const sheetA4 = computePassportSheetGrid('2x2in', 'a4', 300, 3);
  assert.ok(sheetA4.totalPhotos >= 12);
});
