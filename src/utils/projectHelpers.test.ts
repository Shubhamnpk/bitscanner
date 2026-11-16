import test from 'node:test';
import assert from 'node:assert/strict';
import type { ScannedPage } from '../types/scanner';
import { DEFAULT_ADJUSTMENTS, DEFAULT_WATERMARK } from '../types/scanner';
import {
  getSelectedPageIndices,
  removeSelectedPages,
  reorderPageInList,
  togglePageSelection,
} from './projectHelpers';

function makeStubPage(id: string): ScannedPage {
  return {
    id,
    originalDataUrl: '',
    croppedDataUrl: '',
    processedDataUrl: '',
    quad: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    filter: 'magic_color',
    adjustments: { ...DEFAULT_ADJUSTMENTS },
    rotation: 0,
    flipH: false,
    annotations: [],
    watermark: { ...DEFAULT_WATERMARK },
    ocrText: '',
    width: 800,
    height: 1100,
    createdAt: 1,
  };
}

test('reorderPageInList moves pages immutably and handles out-of-bounds safely', () => {
  const pages = [makeStubPage('p1'), makeStubPage('p2'), makeStubPage('p3')];
  const moved = reorderPageInList(pages, 0, 2);
  assert.deepEqual(
    moved.map((p) => p.id),
    ['p2', 'p3', 'p1']
  );
  assert.deepEqual(
    pages.map((p) => p.id),
    ['p1', 'p2', 'p3']
  );
  assert.equal(reorderPageInList(pages, -1, 1), pages);
});

test('togglePageSelection adds and removes IDs cleanly', () => {
  const s1 = togglePageSelection([], 'p1');
  assert.deepEqual(s1, ['p1']);
  const s2 = togglePageSelection(s1, 'p2');
  assert.deepEqual(s2, ['p1', 'p2']);
  const s3 = togglePageSelection(s2, 'p1');
  assert.deepEqual(s3, ['p2']);
});

test('getSelectedPageIndices maps selected IDs in document order and falls back to all', () => {
  const pages = [makeStubPage('p1'), makeStubPage('p2'), makeStubPage('p3')];
  assert.deepEqual(getSelectedPageIndices(pages, ['p3', 'p1']), [0, 2]);
  assert.deepEqual(getSelectedPageIndices(pages, []), [0, 1, 2]);
});

test('removeSelectedPages keeps at least one page unless allowEmpty is set', () => {
  const pages = [makeStubPage('p1'), makeStubPage('p2'), makeStubPage('p3')];
  const pruned = removeSelectedPages(pages, ['p2']);
  assert.deepEqual(
    pruned.map((p) => p.id),
    ['p1', 'p3']
  );
  const blocked = removeSelectedPages(pages, ['p1', 'p2', 'p3']);
  assert.equal(blocked.length, 3);
  const allowedEmpty = removeSelectedPages(pages, ['p1', 'p2', 'p3'], true);
  assert.equal(allowedEmpty.length, 0);
});
