import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWordExportHtml,
  estimateExportSizeKb,
  resolveSelectedPageIndices,
  sanitizeExportFilename,
} from './exportHelpers';

test('resolveSelectedPageIndices deduplicates, sorts, and falls back to all pages safely', () => {
  assert.deepEqual(resolveSelectedPageIndices(4, undefined), [0, 1, 2, 3]);
  assert.deepEqual(resolveSelectedPageIndices(4, []), [0, 1, 2, 3]);
  assert.deepEqual(resolveSelectedPageIndices(4, [2, 0, 2, 9, -1]), [0, 2]);
  assert.deepEqual(resolveSelectedPageIndices(0, [0]), []);
});

test('sanitizeExportFilename strips unsafe filesystem characters cleanly', () => {
  assert.equal(sanitizeExportFilename('  Invoice #08/15: Final* '), 'Invoice _08_15_ Final_');
  assert.equal(sanitizeExportFilename('   ', 'doc'), 'doc');
});

test('estimateExportSizeKb scales realistically by format and options', () => {
  const textOnlyWord = estimateExportSizeKb(3, 'word', 'high', { wordIncludeImages: false });
  const richWord = estimateExportSizeKb(3, 'word', 'high', { wordIncludeImages: true });
  const pngExport = estimateExportSizeKb(3, 'image', 'high');
  assert.ok(richWord > textOnlyWord * 10);
  assert.ok(pngExport > richWord);
});

test('buildWordExportHtml builds valid Word-compatible HTML respecting toggles', () => {
  const htmlBoth = buildWordExportHtml(
    'Tax <Report>',
    [
      { pageNumber: 1, ocrText: 'Line 1\nLine 2', imageDataUrl: 'data:image/jpeg;base64,abc' },
      { pageNumber: 2, ocrText: '', imageDataUrl: 'data:image/jpeg;base64,def' },
    ],
    { includeImages: true, includeOcrText: true }
  );
  assert.ok(htmlBoth.includes('Tax &lt;Report&gt;'));
  assert.ok(htmlBoth.includes('data:image/jpeg;base64,abc'));
  assert.ok(htmlBoth.includes('Line 1<br/>Line 2'));
  assert.ok(htmlBoth.includes('page-break-after: always;'));

  const htmlTextOnly = buildWordExportHtml(
    'Notes',
    [{ pageNumber: 1, ocrText: 'Clean notes', imageDataUrl: 'data:image/jpeg;base64,abc' }],
    { includeImages: false, includeOcrText: true }
  );
  assert.ok(!htmlTextOnly.includes('<img '));
  assert.ok(htmlTextOnly.includes('Clean notes'));
});
