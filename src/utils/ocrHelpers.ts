import { clamp } from './cvGeometry';

export type OcrLayoutMode = 'auto' | 'block' | 'sparse';

export interface OcrStructuredEntities {
  emails: string[];
  phones: string[];
  urls: string[];
  dates: string[];
  amounts: string[];
}

/**
 * Computes optimal upscaled OCR canvas dimensions (ideal x-height 24-36px for LSTM)
 * plus a crisp white quiet-zone border margin so edge characters are never clipped.
 */
export function computeOcrTargetSize(
  srcWidth: number,
  srcHeight: number
): { width: number; height: number; padding: number } {
  const sw = Math.max(1, Math.round(srcWidth));
  const sh = Math.max(1, Math.round(srcHeight));
  const shortSide = Math.min(sw, sh);
  const longSide = Math.max(sw, sh);

  let scale = 1;
  if (shortSide < 1200) {
    scale = 1400 / shortSide;
  }
  if (longSide * scale > 2400) {
    scale = 2400 / longSide;
  }
  scale = Math.max(0.5, scale);

  return {
    width: Math.max(64, Math.round(sw * scale)),
    height: Math.max(64, Math.round(sh * scale)),
    padding: 24,
  };
}

/**
 * Enhances a grayscale byte array for Tesseract LSTM recognition by:
 * 1. Estimating uneven paper illumination on an 8x8 block grid (88th percentile paper white),
 * 2. Dividing out shadows to normalize background luminance to bright clean paper (248),
 * 3. Stretching ink-vs-paper contrast while preserving smooth anti-aliased glyph edges.
 */
export function preprocessGrayscaleForOcr(
  gray: Uint8Array,
  width: number,
  height: number
): Uint8ClampedArray {
  const total = width * height;
  const rgba = new Uint8ClampedArray(total * 4);
  if (width < 8 || height < 8 || gray.length !== total) {
    for (let i = 0; i < total; i++) {
      const v = gray[i] ?? 255;
      rgba[i * 4] = v;
      rgba[i * 4 + 1] = v;
      rgba[i * 4 + 2] = v;
      rgba[i * 4 + 3] = 255;
    }
    return rgba;
  }

  // 1. Estimate smooth local paper white across an coarse grid (ignoring dark ink)
  const gridW = Math.max(8, Math.min(28, Math.floor(width / 32)));
  const gridH = Math.max(8, Math.min(28, Math.floor(height / 32)));
  const cellW = width / gridW;
  const cellH = height / gridH;
  const bgGrid = new Float32Array(gridW * gridH);

  for (let gy = 0; gy < gridH; gy++) {
    const y0 = Math.floor(gy * cellH);
    const y1 = Math.min(height, Math.ceil((gy + 1) * cellH));
    for (let gx = 0; gx < gridW; gx++) {
      const x0 = Math.floor(gx * cellW);
      const x1 = Math.min(width, Math.ceil((gx + 1) * cellW));
      const syStep = Math.max(1, Math.floor((y1 - y0) / 5));
      const sxStep = Math.max(1, Math.floor((x1 - x0) / 5));

      let sumTop = 0;
      let cntTop = 0;
      let maxVal = 110;
      for (let y = y0; y < y1; y += syStep) {
        for (let x = x0; x < x1; x += sxStep) {
          const val = gray[y * width + x];
          if (val > maxVal) maxVal = val;
        }
      }
      // Average samples within 24 levels of cell max to avoid bright specular outliers
      for (let y = y0; y < y1; y += syStep) {
        for (let x = x0; x < x1; x += sxStep) {
          const val = gray[y * width + x];
          if (val >= maxVal - 24) {
            sumTop += val;
            cntTop++;
          }
        }
      }
      bgGrid[gy * gridW + gx] = cntTop > 0 ? sumTop / cntTop : maxVal;
    }
  }

  // 3x3 box smooth background grid to eliminate block transitions
  const smoothedGrid = new Float32Array(bgGrid.length);
  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      let s = 0;
      let c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ny = clamp(gy + dy, 0, gridH - 1);
          const nx = clamp(gx + dx, 0, gridW - 1);
          s += bgGrid[ny * gridW + nx];
          c++;
        }
      }
      smoothedGrid[gy * gridW + gx] = s / c;
    }
  }

  // 2. Normalize every pixel against bilinearly interpolated background paper tone
  const normalized = new Float32Array(total);
  for (let y = 0; y < height; y++) {
    const gy = clamp((y / height) * (gridH - 1), 0, gridH - 1.001);
    const y0 = Math.floor(gy);
    const fy = gy - y0;
    for (let x = 0; x < width; x++) {
      const gx = clamp((x / width) * (gridW - 1), 0, gridW - 1.001);
      const x0 = Math.floor(gx);
      const fx = gx - x0;

      const i00 = y0 * gridW + x0;
      const bg =
        smoothedGrid[i00] * (1 - fx) * (1 - fy) +
        smoothedGrid[i00 + 1] * fx * (1 - fy) +
        smoothedGrid[i00 + gridW] * (1 - fx) * fy +
        smoothedGrid[i00 + gridW + 1] * fx * fy;

      const idx = y * width + x;
      const safeBg = Math.max(70, bg);
      const ratio = (gray[idx] / safeBg) * 248;

      // Soft sigmoid-like tone curve preserves glyph anti-aliasing while whitening paper noise
      let outVal: number;
      if (ratio >= 216) {
        outVal = 255;
      } else if (ratio <= 110) {
        outVal = clamp(Math.round(ratio * 0.45), 0, 50);
      } else {
        const t = (ratio - 110) / (216 - 110);
        // Smooth S-curve transition
        const s = t * t * (3 - 2 * t);
        outVal = Math.round(50 + s * 205);
      }
      normalized[idx] = outVal;
    }
  }

  // 3. Light 3x3 unsharp sharpening + isolated speck cleanup
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      let v = normalized[idx];
      if (y > 0 && y < height - 1 && x > 0 && x < width - 1) {
        const nL = normalized[idx - 1];
        const nR = normalized[idx + 1];
        const nT = normalized[idx - width];
        const nB = normalized[idx + width];
        const avgNeighbors = (nL + nR + nT + nB) * 0.25;
        // Suppress single-pixel dust specks completely isolated from bright paper or dark ink
        if (Math.abs(v - avgNeighbors) > 85 && Math.max(nL, nR, nT, nB) - Math.min(nL, nR, nT, nB) < 28) {
          v = avgNeighbors;
        } else {
          v = clamp(Math.round(v + (v - avgNeighbors) * 0.38), 0, 255);
        }
      }
      const o = idx * 4;
      rgba[o] = v;
      rgba[o + 1] = v;
      rgba[o + 2] = v;
      rgba[o + 3] = 255;
    }
  }

  return rgba;
}

/**
 * Local adaptive integral-image Sauvola/mean binarization pass for difficult stained receipts,
 * thermal paper fading, or sharp cast shadows where single-pass soft scaling loses thin strokes.
 */
export function binarizeOcrAdaptive(
  gray: Uint8Array,
  width: number,
  height: number
): Uint8ClampedArray {
  const total = width * height;
  const rgba = new Uint8ClampedArray(total * 4);
  if (width < 8 || height < 8 || gray.length !== total) {
    for (let i = 0; i < total; i++) {
      const v = gray[i] ?? 255;
      rgba[i * 4] = v;
      rgba[i * 4 + 1] = v;
      rgba[i * 4 + 2] = v;
      rgba[i * 4 + 3] = 255;
    }
    return rgba;
  }

  const w1 = width + 1;
  const sat = new Float64Array(w1 * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += gray[y * width + x];
      sat[(y + 1) * w1 + (x + 1)] = sat[y * w1 + (x + 1)] + rowSum;
    }
  }

  const r = clamp(Math.round(Math.min(width, height) / 28), 10, 32);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(height - 1, y + r);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(width - 1, x + r);
      const cnt = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        sat[(y1 + 1) * w1 + (x1 + 1)] -
        sat[y0 * w1 + (x1 + 1)] -
        sat[(y1 + 1) * w1 + x0] +
        sat[y0 * w1 + x0];
      const localMean = sum / cnt;
      const thresh = localMean * 0.87 - 4;
      const val = gray[y * width + x] <= thresh ? 10 : 255;
      const o = (y * width + x) * 4;
      rgba[o] = val;
      rgba[o + 1] = val;
      rgba[o + 2] = val;
      rgba[o + 3] = 255;
    }
  }
  return rgba;
}

/**
 * Estimates subtle text-line skew angle in degrees (within -5..+5 deg) using
 * horizontal projection variance across dark ink pixels. Returns 0 for unskewed or blank frames.
 */
export function estimateTextSkewDegrees(
  gray: Uint8Array,
  width: number,
  height: number
): number {
  if (width < 24 || height < 24 || gray.length !== width * height) return 0;

  // Estimate paper mean and collect dark ink coordinates (downsampled for speed)
  let sum = 0;
  for (let i = 0; i < gray.length; i += 4) sum += gray[i];
  const mean = sum / Math.max(1, Math.ceil(gray.length / 4));
  const inkThresh = Math.min(mean * 0.72, 165);

  const inkX: number[] = [];
  const inkY: number[] = [];
  const stepY = Math.max(1, Math.floor(height / 140));
  const stepX = Math.max(1, Math.floor(width / 140));
  const cx = width * 0.5;
  const cy = height * 0.5;

  for (let y = Math.floor(height * 0.08); y < Math.floor(height * 0.92); y += stepY) {
    for (let x = Math.floor(width * 0.08); x < Math.floor(width * 0.92); x += stepX) {
      if (gray[y * width + x] < inkThresh) {
        inkX.push(x - cx);
        inkY.push(y - cy);
      }
    }
  }
  if (inkX.length < 30) return 0;

  const bins = 96;
  const halfH = height * 0.6;
  let bestAngle = 0;
  let bestEnergy = -1;

  for (let deg = -5.0; deg <= 5.001; deg += 0.5) {
    const rad = (-deg * Math.PI) / 180;
    const sin = Math.sin(rad);
    const cos = Math.cos(rad);
    const proj = new Int32Array(bins);
    for (let k = 0; k < inkX.length; k++) {
      const ry = inkX[k] * sin + inkY[k] * cos + halfH;
      const b = clamp(Math.floor((ry / (halfH * 2)) * bins), 0, bins - 1);
      proj[b]++;
    }
    let energy = 0;
    for (let b = 0; b < bins; b++) {
      energy += proj[b] * proj[b];
    }
    if (energy > bestEnergy) {
      bestEnergy = energy;
      bestAngle = deg;
    }
  }

  return Math.abs(bestAngle) < 0.5 ? 0 : bestAngle;
}

/**
 * Cleans raw OCR output: normalizes line endings, removes phantom trailing whitespace,
 * rejoins broken end-of-line hyphenation splits, and collapses excessive blank lines.
 */
export function cleanOcrText(raw: string): string {
  if (!raw) return '';
  let text = raw.replace(/\r\n?/g, '\n');
  // Trim trailing spaces/tabs per line and collapse runs of >2 blank lines
  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, '').replace(/^[ \t]+(?=\S)/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');

  // Rejoin clear word-wrap hyphenations like "electro-\nmechanical" -> "electromechanical"
  text = text.replace(/([a-z]{2,})-\n([a-z]{2,})/gi, '$1$2');

  return text.trim();
}

function dedupeMatches(matches: RegExpMatchArray | null, limit = 8): string[] {
  if (!matches) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    const clean = m.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Extracts clickable structured entities (emails, phones, URLs, dates, monetary totals)
 * from recognized OCR text for instant CamScanner-style copy actions.
 */
export function extractStructuredOcrEntities(text: string): OcrStructuredEntities {
  if (!text.trim()) {
    return { emails: [], phones: [], urls: [], dates: [], amounts: [] };
  }

  const emails = dedupeMatches(
    text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g)
  );
  const urls = dedupeMatches(
    text.match(/\bhttps?:\/\/[^\s<>"')]+|\bwww\.[^\s<>"')]+\.[A-Za-z]{2,}\b/gi)
  );
  const phones = dedupeMatches(
    text.match(/(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]\d{3,4}[\s.-]\d{3,4}\b/g)
  );
  const dates = dedupeMatches(
    text.match(
      /\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{2,4})\b/gi
    )
  );
  const amounts = dedupeMatches(
    text.match(/(?:[$€£¥₹]\s?\d[\d,]*(?:\.\d{1,2})?|\b(?:USD|EUR|GBP|INR|CAD|AUD)\s?\d[\d,]*(?:\.\d{2})?)/gi)
  );

  return { emails, phones, urls, dates, amounts };
}

export function countOcrWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export interface OcrSearchResult {
  totalMatches: number;
  matchingLines: Array<{ lineNumber: number; text: string }>;
}

/**
 * Searches extracted OCR text for a query string and returns matching lines and hit count.
 */
export function searchOcrTextMatches(text: string, query: string): OcrSearchResult {
  const q = query.trim().toLowerCase();
  if (!q || !text) return { totalMatches: 0, matchingLines: [] };

  const lines = text.split('\n');
  const matchingLines: Array<{ lineNumber: number; text: string }> = [];
  let totalMatches = 0;

  lines.forEach((line, idx) => {
    const lower = line.toLowerCase();
    if (!lower.includes(q)) return;
    let pos = 0;
    while (true) {
      const found = lower.indexOf(q, pos);
      if (found === -1) break;
      totalMatches++;
      pos = found + q.length;
    }
    matchingLines.push({ lineNumber: idx + 1, text: line.trim() });
  });

  return { totalMatches, matchingLines };
}
