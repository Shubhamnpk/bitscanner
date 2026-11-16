import test from 'node:test';
import assert from 'node:assert/strict';
import {
  binarizeOcrAdaptive,
  cleanOcrText,
  computeOcrTargetSize,
  countOcrWords,
  estimateTextSkewDegrees,
  extractStructuredOcrEntities,
  preprocessGrayscaleForOcr,
  searchOcrTextMatches,
} from './ocrHelpers';

test('computeOcrTargetSize upscales small phone scans and caps extreme dimensions', () => {
  const small = computeOcrTargetSize(700, 950);
  assert.equal(small.width, 1400);
  assert.equal(small.height, 1900);
  assert.equal(small.padding, 24);

  const large = computeOcrTargetSize(3000, 4000);
  assert.equal(large.height, 2400);
  assert.equal(large.width, 1800);
});

test('preprocessGrayscaleForOcr normalizes uneven shadow across paper while keeping dark ink crisp', () => {
  const w = 128;
  const h = 128;
  const gray = new Uint8Array(w * h);

  // Simulate heavy left-to-right shadow gradient (235 -> 120 paper) with dark text ink bars
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const paper = Math.round(235 - (x / w) * 110);
      const isInk = y >= 48 && y <= 58 && ((x >= 20 && x <= 38) || (x >= 88 && x <= 108));
      gray[y * w + x] = isInk ? Math.round(paper * 0.28) : paper;
    }
  }

  const rgba = preprocessGrayscaleForOcr(gray, w, h);
  assert.equal(rgba.length, w * h * 4);

  // Paper on both bright left and shadowed right should normalize near pure white (>= 235)
  const leftPaper = rgba[(20 * w + 18) * 4];
  const rightPaper = rgba[(20 * w + 110) * 4];
  assert.ok(leftPaper >= 235, `Expected bright left paper >= 235, got ${leftPaper}`);
  assert.ok(rightPaper >= 235, `Expected shadowed right paper >= 235, got ${rightPaper}`);

  // Dark text ink inside shadowed half should remain deeply dark (<= 45)
  const rightInk = rgba[(53 * w + 98) * 4];
  assert.ok(rightInk <= 45, `Expected crisp dark ink <= 45, got ${rightInk}`);
});

test('binarizeOcrAdaptive separates faded dark strokes cleanly even under heavy uneven stain', () => {
  const w = 96;
  const h = 96;
  const gray = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const bg = y < h / 2 ? 230 : 115;
      const isStroke = Math.abs(y - 72) <= 2 && x >= 24 && x <= 72;
      gray[y * w + x] = isStroke ? 60 : bg;
    }
  }

  const rgba = binarizeOcrAdaptive(gray, w, h);
  const paperPixel = rgba[(60 * w + 14) * 4];
  const inkPixel = rgba[(72 * w + 48) * 4];
  assert.equal(paperPixel, 255);
  assert.equal(inkPixel, 10);
});

test('estimateTextSkewDegrees detects tilted horizontal text lines within tolerance', () => {
  const w = 160;
  const h = 160;
  const gray = new Uint8Array(w * h).fill(245);

  // Draw 4 parallel text lines tilted at +3.0 degrees
  const trueAngleDeg = 3.0;
  const slope = Math.tan((trueAngleDeg * Math.PI) / 180);
  const ys = [36, 62, 88, 114];
  for (const baseY of ys) {
    for (let x = 22; x < 138; x++) {
      const yCenter = Math.round(baseY + (x - w / 2) * slope);
      for (let dy = -1; dy <= 1; dy++) {
        const y = yCenter + dy;
        if (y >= 0 && y < h) gray[y * w + x] = 28;
      }
    }
  }

  const est = estimateTextSkewDegrees(gray, w, h);
  assert.ok(Math.abs(est - trueAngleDeg) <= 1.0, `Expected skew near +3.0 deg, got ${est}`);
});

test('cleanOcrText rejoins line-wrap hyphenations and normalizes whitespace', () => {
  const raw = '  Invoice Summary   \r\n\r\n\r\nPlease remit pay-\nment via elec-\ntronic transfer.\n  ';
  const cleaned = cleanOcrText(raw);
  assert.equal(cleaned, 'Invoice Summary\n\nPlease remit payment via electronic transfer.');
  assert.equal(countOcrWords(cleaned), 8);
});

test('extractStructuredOcrEntities pulls emails, phones, URLs, dates, and currency amounts', () => {
  const sample = `
    Acme Consulting LLC
    Date: 2026-04-18 | Due: 05/18/2026
    Billing Contact: billing@acme-studio.io
    Support: +1 (415) 890-4421
    Portal: https://billing.acme-studio.io/pay
    Total Amount Due: $1,245.50
  `;
  const entities = extractStructuredOcrEntities(sample);
  assert.deepEqual(entities.emails, ['billing@acme-studio.io']);
  assert.deepEqual(entities.phones, ['+1 (415) 890-4421']);
  assert.deepEqual(entities.urls, ['https://billing.acme-studio.io/pay']);
  assert.deepEqual(entities.dates, ['2026-04-18', '05/18/2026']);
  assert.deepEqual(entities.amounts, ['$1,245.50']);
});

test('searchOcrTextMatches finds case-insensitive multi-line matches with accurate counts', () => {
  const text = 'Invoice Total: $420.00\nTax exempt status confirmed\nFinal total due: $420.00';
  const res = searchOcrTextMatches(text, 'total');
  assert.equal(res.totalMatches, 2);
  assert.equal(res.matchingLines.length, 2);
  assert.equal(res.matchingLines[0].lineNumber, 1);
  assert.equal(res.matchingLines[1].lineNumber, 3);
  assert.equal(searchOcrTextMatches(text, 'missing-term').totalMatches, 0);
});
