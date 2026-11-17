import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyHomography,
  classifyScannedSceneHint,
  computeHomography,
  computeIdCardLayout,
  computeVisibleFeedCropRect,
  detectDocumentQuadDetailed,
  detectDocumentQuadFromLuma,
  detectDocumentQuadFromRgba,
  estimateOutputDimensions,
  filterAndSortDocuments,
  hasReasonableQuadAngles,
  isFullFrameQuad,
  isValidDocumentQuad,
  orderCorners,
  quadArea,
  quadsAreClose,
  smoothQuadCorners,
} from './cvGeometry';
import type { QuadCorners, ScanDocument } from '../types/scanner';

test('orderCorners normalizes scrambled points to [TL, TR, BR, BL]', () => {
  const ordered = orderCorners([
    { x: 0.9, y: 0.85 },
    { x: 0.12, y: 0.1 },
    { x: 0.15, y: 0.88 },
    { x: 0.85, y: 0.15 },
  ]);

  assert.deepEqual(ordered, [
    { x: 0.12, y: 0.1 },
    { x: 0.85, y: 0.15 },
    { x: 0.9, y: 0.85 },
    { x: 0.15, y: 0.88 },
  ]);
});

test('computeHomography maps skewed quadrilateral accurately to target rectangle', () => {
  const src: QuadCorners = [
    { x: 120, y: 80 },
    { x: 740, y: 110 },
    { x: 820, y: 1020 },
    { x: 60, y: 980 },
  ];
  const dst: QuadCorners = [
    { x: 0, y: 0 },
    { x: 600, y: 0 },
    { x: 600, y: 800 },
    { x: 0, y: 800 },
  ];

  const H = computeHomography(dst, src);

  const pTL = applyHomography(H, 0, 0);
  const pTR = applyHomography(H, 600, 0);
  const pBR = applyHomography(H, 600, 800);
  const pBL = applyHomography(H, 0, 800);

  assert.ok(Math.abs(pTL.x - 120) < 1e-4);
  assert.ok(Math.abs(pTL.y - 80) < 1e-4);
  assert.ok(Math.abs(pTR.x - 740) < 1e-4);
  assert.ok(Math.abs(pTR.y - 110) < 1e-4);
  assert.ok(Math.abs(pBR.x - 820) < 1e-4);
  assert.ok(Math.abs(pBR.y - 1020) < 1e-4);
  assert.ok(Math.abs(pBL.x - 60) < 1e-4);
  assert.ok(Math.abs(pBL.y - 980) < 1e-4);
});

test('estimateOutputDimensions preserves quad aspect ratio within maxDim', () => {
  const dims = estimateOutputDimensions(
    [
      { x: 100, y: 100 },
      { x: 900, y: 100 },
      { x: 900, y: 1300 },
      { x: 100, y: 1300 },
    ],
    1000
  );
  assert.equal(dims.height, 1000);
  assert.equal(dims.width, 667);
});

test('quadArea & isValidDocumentQuad validate convex reasonable quads', () => {
  const valid: QuadCorners = [
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.9 },
    { x: 0.1, y: 0.9 },
  ];
  assert.ok(Math.abs(quadArea(valid) - 0.64) < 1e-6);
  assert.equal(isValidDocumentQuad(valid), true);

  const tiny: QuadCorners = [
    { x: 0.48, y: 0.48 },
    { x: 0.52, y: 0.48 },
    { x: 0.52, y: 0.52 },
    { x: 0.48, y: 0.52 },
  ];
  assert.equal(isValidDocumentQuad(tiny), false);
});

test('detectDocumentQuadFromLuma detects a bright slanted document on a dark background', () => {
  const w = 160;
  const h = 160;
  const luma = new Uint8Array(w * h).fill(35); // dark walnut desk

  // Add distracting bright sunlit windowsill in top-left corner (0..32, 0..20)
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 34; x++) {
      luma[y * w + x] = 245;
    }
  }

  // Draw a bright white sheet inside skewed quad:
  // TL=(28,36), TR=(128,32), BR=(136,132), BL=(22,126)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = (y - 36) / 96;
      if (t >= 0 && t <= 1) {
        const leftX = 28 + (22 - 28) * t;
        const rightX = 128 + (136 - 128) * t;
        const topY = 36 + (32 - 36) * ((x - leftX) / Math.max(1, rightX - leftX));
        const botY = 126 + (132 - 126) * ((x - leftX) / Math.max(1, rightX - leftX));
        if (x >= leftX && x <= rightX && y >= topY && y <= botY) {
          luma[y * w + x] = 235;
        }
      }
    }
  }

  const detected = detectDocumentQuadFromLuma(luma, w, h);
  assert.equal(isValidDocumentQuad(detected), true);
  assert.equal(hasReasonableQuadAngles(detected), true);
  // Must lock onto the central document TL (28,36), NOT the windowsill at (0,0)!
  assert.ok(Math.abs(detected[0].x - 28 / w) < 0.08);
  assert.ok(Math.abs(detected[0].y - 36 / h) < 0.08);
  assert.ok(Math.abs(detected[2].x - 136 / w) < 0.08);
  assert.ok(Math.abs(detected[2].y - 132 / h) < 0.08);
});

test('detectDocumentQuadFromRgba recovers rotated 35-deg colored card even with dark text lines inside', () => {
  const w = 160;
  const h = 160;
  const rgba = new Uint8ClampedArray(w * h * 4);
  // Light warm beige desk (same luminance range as card, different chroma!)
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = 205;
    rgba[i * 4 + 1] = 195;
    rgba[i * 4 + 2] = 175;
    rgba[i * 4 + 3] = 255;
  }

  // Draw a teal/blue ID card rotated by ~35 degrees centered at (80, 80), halfW=46, halfH=30
  const theta = (35 * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - 80;
      const dy = y - 80;
      const rx = dx * cos + dy * sin;
      const ry = -dx * sin + dy * cos;
      if (Math.abs(rx) <= 46 && Math.abs(ry) <= 30) {
        const idx = (y * w + x) * 4;
        // Simulate dark printed barcode/text lines inside card
        const isText = Math.abs(ry) < 5 && Math.abs(rx) < 30;
        rgba[idx] = isText ? 25 : 42;
        rgba[idx + 1] = isText ? 30 : 148;
        rgba[idx + 2] = isText ? 40 : 196;
      }
    }
  }

  const detected = detectDocumentQuadFromRgba(rgba, w, h);
  assert.equal(isValidDocumentQuad(detected), true);
  assert.equal(hasReasonableQuadAngles(detected), true);
  const area = quadArea(detected);
  // True card area = (92 * 60) / (160 * 160) ~= 0.2156
  assert.ok(area > 0.16 && area < 0.28, `Expected card area ~0.215, got ${area}`);
});

test('computeIdCardLayout centers Front and Back cards vertically with ISO aspect ratio', () => {
  const layout = computeIdCardLayout(1240, 1754, 0.68, 0.06);
  assert.equal(layout.frontRect.width, layout.backRect.width);
  assert.equal(layout.frontRect.height, layout.backRect.height);
  assert.ok(layout.frontRect.y < layout.dividerY);
  assert.ok(layout.dividerY < layout.backRect.y);
  const ratio = layout.frontRect.width / layout.frontRect.height;
  assert.ok(Math.abs(ratio - 85.6 / 53.98) < 0.02);
});

test('filterAndSortDocuments filters by folder, OCR text, and sorts properly', () => {
  const makeDoc = (
    id: string,
    title: string,
    folder: ScanDocument['folder'],
    starred: boolean,
    ocrText: string,
    pageCount: number,
    updatedAt: number
  ): ScanDocument => ({
    id,
    title,
    folder,
    starred,
    createdAt: updatedAt,
    updatedAt,
    pages: Array.from({ length: pageCount }, (_, i) => ({
      id: `${id}-p${i}`,
      originalDataUrl: '',
      croppedDataUrl: '',
      processedDataUrl: '',
      quad: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      filter: 'original',
      adjustments: { brightness: 0, contrast: 0, saturation: 0, sharpness: 0, shadowRemoval: 0 },
      rotation: 0,
      flipH: false,
      annotations: [],
      watermark: { enabled: false, text: '', opacity: 0.2, angle: -30, tiled: true, color: '#000' },
      ocrText: i === 0 ? ocrText : '',
      width: 800,
      height: 1100,
      createdAt: updatedAt,
    })),
  });

  const docs = [
    makeDoc('1', 'Alpha Contract', 'documents', true, 'NDA Agreement 2026', 3, 100),
    makeDoc('2', 'National ID', 'id_cards', false, 'Aethel Citizen Evelyn Thorne', 1, 300),
    makeDoc('3', 'Apex Invoice', 'receipts', false, 'Total Amount Due $9,990.00', 2, 200),
  ];

  assert.equal(filterAndSortDocuments(docs, '', 'starred', 'updated_desc').length, 1);
  assert.equal(filterAndSortDocuments(docs, 'evelyn', 'all', 'updated_desc')[0].id, '2');
  assert.equal(filterAndSortDocuments(docs, '', 'all', 'pages_desc')[0].id, '1');
  assert.equal(filterAndSortDocuments(docs, '', 'all', 'title_asc')[0].id, '1');
});

test('computeVisibleFeedCropRect matches object-cover + centered gesture zoom', () => {
  // Landscape 1920x1080 sensor displayed inside portrait 390x650 viewport (aspect 0.6)
  const rect1x = computeVisibleFeedCropRect(1920, 1080, 390, 650, 1);
  assert.equal(Math.round(rect1x.sWidth), 648); // 1080 * 0.6
  assert.equal(Math.round(rect1x.sHeight), 1080);
  assert.equal(Math.round(rect1x.sx), (1920 - 648) / 2);
  assert.equal(rect1x.sy, 0);

  // At 2x gesture zoom, visible crop halves in both dimensions around center
  const rect2x = computeVisibleFeedCropRect(1920, 1080, 390, 650, 2);
  assert.equal(Math.round(rect2x.sWidth), 324);
  assert.equal(Math.round(rect2x.sHeight), 540);
  assert.equal(Math.round(rect2x.sx), (1920 - 324) / 2);
  assert.equal(Math.round(rect2x.sy), 270);
});

test('detectDocumentQuadFromRgba recovers low-contrast white document on off-white desk with shadow gradient', () => {
  const w = 180;
  const h = 180;
  const rgba = new Uint8ClampedArray(w * h * 4);

  // Desk with horizontal directional shadow gradient (195 -> 160 RGB warm off-white)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const shade = Math.round((x / w) * 35);
      const idx = (y * w + x) * 4;
      rgba[idx] = 200 - shade;
      rgba[idx + 1] = 192 - shade;
      rgba[idx + 2] = 178 - shade;
      rgba[idx + 3] = 255;
    }
  }

  // White/cream skewed receipt/document: TL=(30,26), TR=(148,34), BR=(142,152), BL=(26,144)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = (y - 26) / 122;
      if (t >= 0 && t <= 1) {
        const leftX = 30 + (26 - 30) * t;
        const rightX = 148 + (142 - 148) * t;
        const u = (x - leftX) / Math.max(1, rightX - leftX);
        if (u >= 0 && u <= 1) {
          const topY = 26 + (34 - 26) * u;
          const botY = 144 + (152 - 144) * u;
          if (y >= topY && y <= botY) {
            const idx = (y * w + x) * 4;
            const shade = Math.round((x / w) * 28);
            rgba[idx] = 248 - shade;
            rgba[idx + 1] = 248 - shade;
            rgba[idx + 2] = 246 - shade;
          }
        }
      }
    }
  }

  const res = detectDocumentQuadDetailed(rgba, w, h);
  assert.equal(isValidDocumentQuad(res.quad), true);
  assert.ok(res.confidence > 0.35, `Expected confidence > 0.35, got ${res.confidence}`);
  assert.ok(Math.abs(res.quad[0].x - 30 / w) < 0.06, `TL x expected ~${30 / w}, got ${res.quad[0].x}`);
  assert.ok(Math.abs(res.quad[0].y - 26 / h) < 0.06, `TL y expected ~${26 / h}, got ${res.quad[0].y}`);
  assert.ok(Math.abs(res.quad[2].x - 142 / w) < 0.06, `BR x expected ~${142 / w}, got ${res.quad[2].x}`);
  assert.ok(Math.abs(res.quad[2].y - 152 / h) < 0.06, `BR y expected ~${152 / h}, got ${res.quad[2].y}`);
});

test('detectDocumentQuadFromRgba reconstructs sharp corners despite rounded card corners and thumb notch', () => {
  const w = 180;
  const h = 180;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = 32;
    rgba[i * 4 + 1] = 36;
    rgba[i * 4 + 2] = 44;
    rgba[i * 4 + 3] = 255;
  }

  // Document box [28..152] x [34..146] with rounded corners (r=14) and a thumb notch on right edge
  const left = 28;
  const right = 152;
  const top = 34;
  const bot = 146;
  const r = 14;
  for (let y = top; y <= bot; y++) {
    for (let x = left; x <= right; x++) {
      // Clip 4 rounded corners
      const cx = x < left + r ? left + r : x > right - r ? right - r : x;
      const cy = y < top + r ? top + r : y > bot - r ? bot - r : y;
      if (Math.hypot(x - cx, y - cy) > r) continue;
      // Thumb occlusion notch along middle of right edge
      if (Math.hypot(x - right, y - 90) < 12) continue;
      const idx = (y * w + x) * 4;
      rgba[idx] = 242;
      rgba[idx + 1] = 244;
      rgba[idx + 2] = 248;
    }
  }

  const detected = detectDocumentQuadFromRgba(rgba, w, h);
  assert.equal(isValidDocumentQuad(detected), true);
  // Straight-line IRLS intersections should recover close to true sharp corner (28/180=0.155, 152/180=0.844)
  assert.ok(Math.abs(detected[0].x - left / w) < 0.045, `TL x expected ~${left / w}, got ${detected[0].x}`);
  assert.ok(Math.abs(detected[0].y - top / h) < 0.045, `TL y expected ~${top / h}, got ${detected[0].y}`);
  assert.ok(Math.abs(detected[2].x - right / w) < 0.045, `BR x expected ~${right / w}, got ${detected[2].x}`);
  assert.ok(Math.abs(detected[2].y - bot / h) < 0.045, `BR y expected ~${bot / h}, got ${detected[2].y}`);
});

test('detectDocumentQuadDetailed reports low confidence on empty uniform frame', () => {
  const w = 120;
  const h = 120;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = 110;
    rgba[i * 4 + 1] = 114;
    rgba[i * 4 + 2] = 118;
    rgba[i * 4 + 3] = 255;
  }
  const res = detectDocumentQuadDetailed(rgba, w, h);
  assert.ok(res.confidence < 0.22, `Expected low confidence < 0.22 on flat frame, got ${res.confidence}`);
});

test('smoothQuadCorners blends smoothly and quadsAreClose measures corner stability', () => {
  const a: QuadCorners = [
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.9 },
    { x: 0.1, y: 0.9 },
  ];
  const b: QuadCorners = [
    { x: 0.2, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.9 },
    { x: 0.1, y: 0.9 },
  ];
  const blended = smoothQuadCorners(a, b, 0.5);
  assert.ok(Math.abs(blended[0].x - 0.15) < 1e-6);
  assert.equal(quadsAreClose(a, b, 0.02), false);
  assert.equal(quadsAreClose(a, smoothQuadCorners(a, b, 0.1), 0.02), true);
});

test('detectDocumentQuadFromRgba does not leak into bright sunlit glare touching paper edge', () => {
  const w = 180;
  const h = 220;
  const rgba = new Uint8ClampedArray(w * h * 4);

  // Desk background: mid-gray (110, 114, 110) with bright sunlit glare patch at top-left (y < 60, x < 110)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const glare = y < 58 && x < 115 ? Math.max(0, 1 - (y / 58) * 0.35 - (x / 115) * 0.25) : 0;
      rgba[idx] = Math.round(108 + glare * 128);
      rgba[idx + 1] = Math.round(112 + glare * 124);
      rgba[idx + 2] = Math.round(108 + glare * 110);
      rgba[idx + 3] = 255;
    }
  }

  // Skewed cream notebook sheet: TL=(22,52), TR=(134,42), BR=(156,170), BL=(52,188)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = (y - 52) / 136;
      if (t >= 0 && t <= 1) {
        const leftX = 22 + (52 - 22) * t;
        const rightX = 134 + (156 - 134) * t;
        const u = (x - leftX) / Math.max(1, rightX - leftX);
        if (u >= 0 && u <= 1) {
          const topY = 52 + (42 - 52) * u;
          const botY = 188 + (170 - 188) * u;
          if (y >= topY && y <= botY) {
            const idx = (y * w + x) * 4;
            // Thin darker paper edge shadow seam on top border + dense ruled/ink strokes inside
            const onEdgeSeam = y - topY < 2.2;
            const hasInk = !onEdgeSeam && y % 11 === 0 && u > 0.12 && u < 0.88;
            rgba[idx] = onEdgeSeam ? 145 : hasInk ? 35 : 236;
            rgba[idx + 1] = onEdgeSeam ? 148 : hasInk ? 38 : 238;
            rgba[idx + 2] = onEdgeSeam ? 144 : hasInk ? 42 : 234;
          }
        }
      }
    }
  }

  const detected = detectDocumentQuadFromRgba(rgba, w, h);
  assert.equal(isValidDocumentQuad(detected), true);
  // Top-left & Top-right must stay near true notebook top edge (~0.23, ~0.19), NOT shoot to (0.01, 0.01)
  assert.ok(detected[0].y > 0.14 && detected[0].y < 0.34, `TL y leaked to ${detected[0].y}`);
  assert.ok(detected[1].y > 0.10 && detected[1].y < 0.30, `TR y leaked to ${detected[1].y}`);
});

test('detectDocumentQuadFromRgba survives heavy diagonal hand shadow across half the paper', () => {
  const w = 180;
  const h = 220;
  const rgba = new Uint8ClampedArray(w * h * 4);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Heavy diagonal shadow attenuating light below (y > 0.55*h + 0.35*(x - w/2))
      const inShadow = y > h * 0.45 + (x - w * 0.5) * 0.45;
      const shade = inShadow ? 0.48 : 1.0;

      // Dark matte slate desk
      let r = 52 * shade;
      let g = 58 * shade;
      let b = 68 * shade;

      // Tilted paper sheet TL=(24,28), TR=(154,36), BR=(148,192), BL=(32,184)
      const t = (y - 28) / 160;
      if (t >= 0 && t <= 1) {
        const leftX = 24 + (32 - 24) * t;
        const rightX = 154 + (148 - 154) * t;
        const u = (x - leftX) / Math.max(1, rightX - leftX);
        if (u >= 0 && u <= 1) {
          const topY = 28 + (36 - 28) * u;
          const botY = 184 + (192 - 184) * u;
          if (y >= topY && y <= botY) {
            r = 242 * shade;
            g = 240 * shade;
            b = 236 * shade;
          }
        }
      }

      const idx = (y * w + x) * 4;
      rgba[idx] = Math.round(r);
      rgba[idx + 1] = Math.round(g);
      rgba[idx + 2] = Math.round(b);
      rgba[idx + 3] = 255;
    }
  }

  const detected = detectDocumentQuadFromRgba(rgba, w, h);
  assert.equal(isValidDocumentQuad(detected), true);
  // Bottom corners lie inside heavy shadow (148,192) & (32,184) — must NOT cut off at shadow line!
  assert.ok(detected[2].y > 0.78, `Shadow cut BR corner short at y=${detected[2].y}`);
  assert.ok(detected[3].y > 0.76, `Shadow cut BL corner short at y=${detected[3].y}`);
});

test('detectDocumentQuadFromRgba recognizes colorful illustrated book cover without splitting across colors', () => {
  const w = 180;
  const h = 220;
  const rgba = new Uint8ClampedArray(w * h * 4);

  // Neutral slate desk background
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = 176;
    rgba[i * 4 + 1] = 172;
    rgba[i * 4 + 2] = 164;
    rgba[i * 4 + 3] = 255;
  }

  // Book cover [30..150] x [24..196] with 4 contrasting color bands + dark spine + white emblem
  for (let y = 24; y <= 196; y++) {
    for (let x = 30; x <= 150; x++) {
      const idx = (y * w + x) * 4;
      if (y < 76) {
        // Bold crimson header
        rgba[idx] = 198;
        rgba[idx + 1] = 42;
        rgba[idx + 2] = 52;
      } else if (y < 142) {
        // Deep cobalt artwork band with dark illustration box
        const inDarkCenter = x > 58 && x < 122 && y > 86 && y < 130;
        rgba[idx] = inDarkCenter ? 22 : 28;
        rgba[idx + 1] = inDarkCenter ? 26 : 92;
        rgba[idx + 2] = inDarkCenter ? 36 : 184;
      } else {
        // Warm goldenrod lower half
        rgba[idx] = 228;
        rgba[idx + 1] = 178;
        rgba[idx + 2] = 44;
      }
    }
  }

  const detected = detectDocumentQuadFromRgba(rgba, w, h, { scanHint: 'book' });
  assert.equal(isValidDocumentQuad(detected), true);
  // True book bounds: left=30/180=0.167, right=150/180=0.833, top=24/220=0.109, bot=196/220=0.891
  assert.ok(detected[0].x < 0.23 && detected[0].y < 0.17, `Book TL clipped: ${JSON.stringify(detected[0])}`);
  assert.ok(detected[2].x > 0.77 && detected[2].y > 0.83, `Book BR clipped: ${JSON.stringify(detected[2])}`);
});

test('detectDocumentQuadFromRgba with id_card hint recovers full outer card perimeter without hard crop', () => {
  const w = 200;
  const h = 150;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = 212;
    rgba[i * 4 + 1] = 204;
    rgba[i * 4 + 2] = 192;
    rgba[i * 4 + 3] = 255;
  }

  // Light cream/white ID card [24..176] x [28..122] with dark top ribbon, portrait box, and inner text border
  for (let y = 28; y <= 122; y++) {
    for (let x = 24; x <= 176; x++) {
      const idx = (y * w + x) * 4;
      const inHeader = y < 44;
      const inPortrait = x >= 34 && x <= 74 && y >= 50 && y <= 104;
      const inInnerLine = x >= 82 && x <= 162 && (y === 64 || y === 82);
      if (inHeader) {
        rgba[idx] = 18;
        rgba[idx + 1] = 68;
        rgba[idx + 2] = 108;
      } else if (inPortrait) {
        rgba[idx] = 52;
        rgba[idx + 1] = 64;
        rgba[idx + 2] = 88;
      } else if (inInnerLine) {
        rgba[idx] = 30;
        rgba[idx + 1] = 34;
        rgba[idx + 2] = 42;
      } else {
        rgba[idx] = 248;
        rgba[idx + 1] = 250;
        rgba[idx + 2] = 252;
      }
    }
  }

  const detected = detectDocumentQuadFromRgba(rgba, w, h, { scanHint: 'id_card' });
  assert.equal(isValidDocumentQuad(detected), true);
  // True card bounds: left=0.12, top=0.187, right=0.88, bottom=0.813 — must include header & never clip inside!
  assert.ok(detected[0].x <= 0.145 && detected[0].y <= 0.215, `ID card TL hard-cropped: ${JSON.stringify(detected[0])}`);
  assert.ok(detected[2].x >= 0.855 && detected[2].y >= 0.785, `ID card BR hard-cropped: ${JSON.stringify(detected[2])}`);
});

test('classifyScannedSceneHint distinguishes QR transfer, QR code, ID card, book spread, and documents', () => {
  assert.equal(classifyScannedSceneHint({ isBsqTransfer: true }), 'qr_transfer');
  assert.equal(
    classifyScannedSceneHint({ qrDetected: true, qrAreaFraction: 0.14 }),
    'qr_code'
  );
  // Small incidental QR stamp on a full invoice sheet should classify as document, not QR
  assert.equal(
    classifyScannedSceneHint({
      qrDetected: true,
      qrAreaFraction: 0.012,
      quad: [
        { x: 0.1, y: 0.08 },
        { x: 0.9, y: 0.08 },
        { x: 0.9, y: 0.92 },
        { x: 0.1, y: 0.92 },
      ],
      quadConfidence: 0.8,
      aspectRatio: 0.75,
    }),
    'document'
  );
  assert.equal(
    classifyScannedSceneHint({
      quad: [
        { x: 0.15, y: 0.3 },
        { x: 0.85, y: 0.3 },
        { x: 0.85, y: 0.74 },
        { x: 0.15, y: 0.74 },
      ],
      quadConfidence: 0.85,
      aspectRatio: 1,
    }),
    'id_card'
  );
  assert.equal(
    classifyScannedSceneHint({
      quad: [
        { x: 0.08, y: 0.18 },
        { x: 0.92, y: 0.18 },
        { x: 0.92, y: 0.82 },
        { x: 0.08, y: 0.82 },
      ],
      quadConfidence: 0.85,
      aspectRatio: 1,
    }),
    'book_spread'
  );
});

test('isFullFrameQuad identifies full-frame corners and rejects cropped documents', () => {
  const full1: QuadCorners = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  assert.equal(isFullFrameQuad(full1), true);

  const fullWithSmallTolerance: QuadCorners = [
    { x: 0.01, y: 0.01 },
    { x: 0.99, y: 0.01 },
    { x: 0.99, y: 0.99 },
    { x: 0.01, y: 0.99 },
  ];
  assert.equal(isFullFrameQuad(fullWithSmallTolerance), true);

  const croppedDoc: QuadCorners = [
    { x: 0.15, y: 0.12 },
    { x: 0.85, y: 0.14 },
    { x: 0.82, y: 0.88 },
    { x: 0.12, y: 0.86 },
  ];
  assert.equal(isFullFrameQuad(croppedDoc), false);
});


