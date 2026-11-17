import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPaperFinish, estimatePaperGains } from './magicColor';

function fill(r: number, g: number, b: number, pixels = 64): Uint8ClampedArray {
  const data = new Uint8ClampedArray(pixels * 4);
  for (let i = 0; i < pixels; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return data;
}

test('estimatePaperGains leaves neutral paper alone', () => {
  const gains = estimatePaperGains(fill(246, 246, 246));

  assert.ok(Math.abs(gains.r - 1) < 0.02, `r gain ${gains.r}`);
  assert.ok(Math.abs(gains.g - 1) < 0.02, `g gain ${gains.g}`);
  assert.ok(Math.abs(gains.b - 1) < 0.02, `b gain ${gains.b}`);
});

test('estimatePaperGains corrects a warm cast', () => {
  const gains = estimatePaperGains(fill(250, 238, 220));

  assert.ok(gains.b > 1, `blue should be boosted, got ${gains.b}`);
  assert.ok(gains.r < 1, `red should be pulled back, got ${gains.r}`);
  assert.ok(gains.b > gains.r);
});

test('estimatePaperGains is bounded and safe on empty data', () => {
  const empty = estimatePaperGains(new Uint8ClampedArray(0));
  assert.deepEqual(empty, { r: 1, g: 1, b: 1 });

  const flat = estimatePaperGains(fill(0, 0, 0));
  for (const gain of [flat.r, flat.g, flat.b]) {
    assert.ok(gain >= 0.86 && gain <= 1.16);
  }
});

test('applyPaperFinish with zero strength changes nothing', () => {
  const data = fill(180, 170, 160, 4);
  const before = Array.from(data);

  applyPaperFinish(data, { r: 1.1, g: 1.0, b: 0.9 }, 0);

  assert.deepEqual(Array.from(data), before);
});

test('applyPaperFinish lifts paper, deepens ink and protects the ends', () => {
  const paper = fill(238, 238, 238, 4);
  const ink = fill(40, 40, 40, 4);
  const black = fill(0, 0, 0, 4);
  const white = fill(255, 255, 255, 4);

  applyPaperFinish(paper, { r: 1, g: 1, b: 1 }, 0.62);
  applyPaperFinish(ink, { r: 1, g: 1, b: 1 }, 0.62);
  applyPaperFinish(black, { r: 1, g: 1, b: 1 }, 0.62);
  applyPaperFinish(white, { r: 1, g: 1, b: 1 }, 0.62);

  assert.ok(paper[0] > 238, `paper should get brighter, got ${paper[0]}`);
  assert.ok(ink[0] < 40, `ink should get darker, got ${ink[0]}`);
  assert.equal(black[0], 0);
  assert.equal(white[0], 255);
});

test('applyPaperFinish neutralises a cast and keeps alpha intact', () => {
  const data = fill(250, 238, 220, 4);
  applyPaperFinish(data, estimatePaperGains(data), 1);

  const r = data[0];
  const g = data[1];
  const b = data[2];
  assert.ok(Math.abs(r - b) <= 4, `channels should converge, got ${r}/${g}/${b}`);
  assert.equal(data[3], 255);
});
