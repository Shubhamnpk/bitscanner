import { loadImage } from './imageProcessor';

// ─── Face Detection Types ──────────────────────────────────────────────────────

export interface FaceBox {
  /** Normalized [0..1] relative to image dimensions */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FaceDetectionResult {
  faceBox: FaceBox | null;
  /** 0 = no face / fallback, 0.5 = heuristic, 0.9+ = native API */
  confidence: number;
}

export interface PassportFraming {
  zoom: number;
  offsetY: number; // normalized -0.3..0.3
}

// ─── ICAO Passport Photo Framing Constants ─────────────────────────────────────
// Per ICAO Doc 9303 Part 3: face (chin to crown) = 70-80% of photo height,
// top of head ≈ 10% from top of frame, centered horizontally.
const ICAO_FACE_HEIGHT_FRACTION = 0.75; // target face height as fraction of photo
const ICAO_HEAD_TOP_FRACTION = 0.10;    // how far from top the crown should sit

// ─── Skin-tone Heuristic Face Detection (Canvas, no deps) ─────────────────────

/**
 * Counts how many pixels in an RGBA flat array look like skin tones
 * (broad HSV-approximation, works for all skin tones).
 */
function isSkinPixel(r: number, g: number, b: number): boolean {
  // Rule-of-thumb skin-tone ranges in RGB space (Peer et al.)
  if (r < 60 || g < 40 || b < 20) return false; // too dark
  if (r < g || r < b) return false;              // green/blue cast
  if (r - g < 15) return false;                  // desaturated
  if (Math.max(r, g, b) - Math.min(r, g, b) < 15) return false; // grey
  return r > 95 && g > 40 && b > 20 &&
    Math.abs(r - g) > 15 && r > g && r > b;
}

/**
 * Finds the bounding box of the largest skin-tone region in the upper 2/3
 * of the image. Returns normalized [0..1] coordinates.
 *
 * Uses a small canvas (160×200 max) for speed.
 */
function detectFaceBySkinTone(
  data: Uint8ClampedArray,
  width: number,
  height: number
): FaceBox | null {
  // Only look at the upper 2/3 of the frame (faces are rarely in the bottom)
  const searchHeight = Math.round(height * 0.75);

  // Build a skin mask and find min/max extents
  let minX = width, minY = height, maxX = 0, maxY = 0;
  let skinCount = 0;

  for (let y = 0; y < searchHeight; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (isSkinPixel(r, g, b)) {
        skinCount++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // Need at least 2% of the search area to be skin
  const minSkinPixels = Math.round(width * searchHeight * 0.02);
  if (skinCount < minSkinPixels || maxX <= minX || maxY <= minY) return null;

  // Expand the detected box by ~12% to include hair/forehead not detected as skin
  const rawW = maxX - minX;
  const rawH = maxY - minY;
  const expandX = rawW * 0.12;
  const expandY = rawH * 0.15; // more expansion at top for hair/crown

  const boxX = Math.max(0, minX - expandX) / width;
  const boxY = Math.max(0, minY - expandY * 1.5) / height; // extra top for crown
  const boxW = Math.min(width, maxX + expandX) / width - boxX;
  const boxH = Math.min(height, maxY + expandY) / height - boxY;

  return { x: boxX, y: boxY, width: boxW, height: boxH };
}

/**
 * Detects the dominant face in an image dataURL.
 *
 * Strategy:
 * 1. Try the browser's native FaceDetector API (Chrome/Edge, no extra deps).
 * 2. Fall back to a pure-Canvas skin-tone heuristic.
 *
 * Returns normalized [0..1] face box coordinates and a confidence score.
 */
export async function detectFaceRegion(imageDataUrl: string): Promise<FaceDetectionResult> {
  const img = await loadImage(imageDataUrl);
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;

  // ── Path 1: Native FaceDetector API (Chrome 70+, Edge 79+) ──────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const FD = (typeof window !== 'undefined' && (window as any).FaceDetector) as
    | (new (opts?: { fastMode?: boolean; maxDetectedFaces?: number }) => {
        detect(img: HTMLImageElement): Promise<Array<{ boundingBox: DOMRectReadOnly }>>;
      })
    | undefined;

  if (FD) {
    try {
      const fd = new FD({ fastMode: false, maxDetectedFaces: 3 });
      const faces = await fd.detect(img);
      if (faces.length > 0) {
        // Pick the largest face (most prominent)
        const best = faces.reduce((a, b) =>
          a.boundingBox.width * a.boundingBox.height >= b.boundingBox.width * b.boundingBox.height ? a : b
        );
        const bb = best.boundingBox;
        return {
          faceBox: {
            x: bb.left / iw,
            y: bb.top / ih,
            width: bb.width / iw,
            height: bb.height / ih,
          },
          confidence: 0.92,
        };
      }
    } catch {
      // FaceDetector failed — fall through to heuristic
    }
  }

  // ── Path 2: Canvas skin-tone heuristic ───────────────────────────────────────
  if (typeof document === 'undefined') {
    return { faceBox: null, confidence: 0 };
  }

  const MAX_DIM = 180;
  const scale = Math.min(1, MAX_DIM / Math.max(iw, ih));
  const cw = Math.max(1, Math.round(iw * scale));
  const ch = Math.max(1, Math.round(ih * scale));

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { faceBox: null, confidence: 0 };

  ctx.drawImage(img, 0, 0, cw, ch);
  const { data } = ctx.getImageData(0, 0, cw, ch);

  const faceBox = detectFaceBySkinTone(data, cw, ch);
  return {
    faceBox,
    confidence: faceBox ? 0.55 : 0,
  };
}

/**
 * Given a detected face bounding box (normalized [0..1]), computes the optimal
 * zoom + offsetY for the passport photo tile per ICAO Doc 9303 standards:
 * - Face (chin to crown) ≈ 70-80% of photo height
 * - Top of head ≈ 10% down from the top of the frame
 * - Face centered horizontally
 *
 * Returns zoom (1..2.5) and offsetY (-0.3..0.3) suitable for renderPassportPhotoTile.
 */
export function computePassportFraming(faceBox: FaceBox, presetId: PassportPresetId): PassportFraming {
  const preset = PASSPORT_PRESETS.find((p) => p.id === presetId) ?? PASSPORT_PRESETS[0];
  const photoAspect = preset.widthMm / preset.heightMm;

  // The face region (normalized in image space). We want faceBox.height to equal
  // ICAO_FACE_HEIGHT_FRACTION of the tile height after zoom.
  //
  // After zoom, the image is scaled by `coverScale * zoom` to fill the tile.
  // A `coverScale` such that image exactly fills tile at zoom=1:
  //   if image is portrait (ih > iw):  coverScale = photoAspect / (iw/ih) in height terms → 1 / imageAspect * photoAspect
  // We work in normalized image coordinates, so face.height in image = faceBox.height.
  // After the tile crop, the visible fraction of image height = 1 / (coverScale * zoom).
  // We want: faceBox.height / (1 / (coverScale * zoom)) = ICAO_FACE_HEIGHT_FRACTION
  // → faceBox.height * coverScale * zoom = ICAO_FACE_HEIGHT_FRACTION
  // → zoom = ICAO_FACE_HEIGHT_FRACTION / (faceBox.height * coverScale)
  //
  // coverScale in normalized terms: the tile always covers the image completely.
  // Since renderPassportPhotoTile uses `Math.max(tw/iw, th/ih) * zoom`, which in
  // normalized space means: for a portrait image with aspect < photoAspect,
  // coverScale = photoAspect / imageAspect (height-constrained).
  // For landscape, coverScale = 1/imageAspect * photoAspect... but we don't know imageAspect here.
  // We approximate: assume the user uploaded a portrait. Use 1.0 as approximation.
  // The actual computation inside renderPassportPhotoTile handles the real scaling.

  // Simpler approach: express zoom needed to make faceBox.height fill ICAO_FACE_HEIGHT_FRACTION
  // of the visible canvas. The visible fraction of image in Y after `coverScale * zoom` scale is
  // 1 / (coverScale_height * zoom). For a portrait image (most PP photos), coverScale ~ 1,
  // so visible fraction ≈ 1/zoom. We want: faceBox.height * zoom = ICAO_FACE_HEIGHT_FRACTION.
  const rawZoom = ICAO_FACE_HEIGHT_FRACTION / Math.max(0.05, faceBox.height);
  const zoom = Math.max(1.0, Math.min(2.4, rawZoom));

  // Vertical offset: we want the top of the head (faceBox.y) to be ICAO_HEAD_TOP_FRACTION
  // from the top of the tile. At scale 1/zoom, the image spans 1/zoom of the tile height.
  // The center of the image maps to the center of the tile (at zoom, offset=0).
  // The y position of faceBox.y in tile space (at zoom=1) = faceBox.y - 0.5 (relative to center).
  // After zoom, face center in tile = (faceBox.y + faceBox.height/2 - 0.5) / zoom + 0.5.
  // We want face top in tile = ICAO_HEAD_TOP_FRACTION:
  //   faceTop_tile = faceCenter_tile - faceBox.height/2 * (1/zoom) ≈ ICAO_HEAD_TOP_FRACTION
  // The offsetY shifts things by offsetY * tileHeight (in tile coords).
  // renderPassportPhotoTile: dy = (th - dh)/2 + offsetY * th
  // Which shifts the image up by offsetY (negative = image shifts up → face moves up).
  // faceCenterInImage_normalized = faceBox.y + faceBox.height/2
  // At zoom, the image is dh = ih * scale * zoom, centered at th/2 + offsetY*th.
  // Face center in tile = (faceCenterInImage_norm - 0.5) / zoom + 0.5 + offsetY
  // We want this to equal: ICAO_HEAD_TOP_FRACTION + ICAO_FACE_HEIGHT_FRACTION/2
  const targetFaceCenter = ICAO_HEAD_TOP_FRACTION + ICAO_FACE_HEIGHT_FRACTION / 2;
  const faceCenterInImage = faceBox.y + faceBox.height / 2;
  const predictedFaceCenter = (faceCenterInImage - 0.5) / zoom + 0.5;
  const offsetY = targetFaceCenter - predictedFaceCenter;
  const clampedOffsetY = Math.max(-0.3, Math.min(0.3, offsetY));

  return { zoom, offsetY: clampedOffsetY };
}

export type PassportPresetId = '35x45mm' | '2x2in' | '33x48mm' | '35x35mm';
export type SheetSizeId = '4x6in' | 'a4';

export interface PassportPreset {
  id: PassportPresetId;
  label: string;
  subtitle: string;
  widthMm: number;
  heightMm: number;
}

export const PASSPORT_PRESETS: PassportPreset[] = [
  {
    id: '35x45mm',
    label: '35 × 45 mm',
    subtitle: 'India / EU / UK Passport',
    widthMm: 35,
    heightMm: 45,
  },
  {
    id: '2x2in',
    label: '2 × 2 in (51 mm)',
    subtitle: 'US Passport & Visa',
    widthMm: 50.8,
    heightMm: 50.8,
  },
  {
    id: '33x48mm',
    label: '33 × 48 mm',
    subtitle: 'Standard Visa Photo',
    widthMm: 33,
    heightMm: 48,
  },
  {
    id: '35x35mm',
    label: '35 × 35 mm',
    subtitle: 'Square Official ID',
    widthMm: 35,
    heightMm: 35,
  },
];

export const SHEET_DIMENSIONS_MM: Record<SheetSizeId, { widthMm: number; heightMm: number; label: string }> = {
  '4x6in': { widthMm: 152.4, heightMm: 101.6, label: '4 × 6 in Print' },
  a4: { widthMm: 210, heightMm: 297, label: 'A4 Cut Sheet' },
};

export interface PassportSheetLayout {
  cols: number;
  rows: number;
  totalPhotos: number;
  sheetWidthPx: number;
  sheetHeightPx: number;
  photoWidthPx: number;
  photoHeightPx: number;
  gapPx: number;
  marginX: number;
  marginY: number;
}

/**
 * Computes how many passport/PP-size photos fit cleanly onto a print sheet at the chosen DPI.
 */
export function computePassportSheetGrid(
  presetId: PassportPresetId,
  sheetId: SheetSizeId,
  dpi = 300,
  gapMm = 3
): PassportSheetLayout {
  const preset = PASSPORT_PRESETS.find((p) => p.id === presetId) ?? PASSPORT_PRESETS[0];
  const sheet = SHEET_DIMENSIONS_MM[sheetId];
  const pxPerMm = dpi / 25.4;

  const sheetWidthPx = Math.round(sheet.widthMm * pxPerMm);
  const sheetHeightPx = Math.round(sheet.heightMm * pxPerMm);
  const photoWidthPx = Math.round(preset.widthMm * pxPerMm);
  const photoHeightPx = Math.round(preset.heightMm * pxPerMm);
  const gapPx = Math.round(gapMm * pxPerMm);
  const minMarginPx = Math.round(4 * pxPerMm);

  const availW = Math.max(photoWidthPx, sheetWidthPx - minMarginPx * 2);
  const availH = Math.max(photoHeightPx, sheetHeightPx - minMarginPx * 2);

  const cols = Math.max(1, Math.floor((availW + gapPx) / (photoWidthPx + gapPx)));
  const rows = Math.max(1, Math.floor((availH + gapPx) / (photoHeightPx + gapPx)));

  const gridW = cols * photoWidthPx + (cols - 1) * gapPx;
  const gridH = rows * photoHeightPx + (rows - 1) * gapPx;

  return {
    cols,
    rows,
    totalPhotos: cols * rows,
    sheetWidthPx,
    sheetHeightPx,
    photoWidthPx,
    photoHeightPx,
    gapPx,
    marginX: Math.round((sheetWidthPx - gridW) / 2),
    marginY: Math.round((sheetHeightPx - gridH) / 2),
  };
}

/**
 * Crops a portrait image to the exact passport aspect ratio with user zoom & offset,
 * fills the chosen backdrop color, and returns a crisp single tile PNG dataURL.
 */
export async function renderPassportPhotoTile(
  sourceDataUrl: string,
  presetId: PassportPresetId,
  options: {
    backgroundColor?: string;
    zoom?: number;
    offsetY?: number; // -0.3 to 0.3
  } = {}
): Promise<string> {
  const img = await loadImage(sourceDataUrl);
  const preset = PASSPORT_PRESETS.find((p) => p.id === presetId) ?? PASSPORT_PRESETS[0];
  const pxPerMm = 300 / 25.4;
  const tw = Math.round(preset.widthMm * pxPerMm);
  const th = Math.round(preset.heightMm * pxPerMm);

  const c = document.createElement('canvas');
  c.width = tw;
  c.height = th;
  const ctx = c.getContext('2d');
  if (!ctx) return sourceDataUrl;

  ctx.fillStyle = options.backgroundColor || '#ffffff';
  ctx.fillRect(0, 0, tw, th);

  const zoom = Math.max(1, Math.min(2.5, options.zoom ?? 1));
  const coverScale = Math.max(tw / img.naturalWidth, th / img.naturalHeight) * zoom;
  const dw = img.naturalWidth * coverScale;
  const dh = img.naturalHeight * coverScale;
  const dx = (tw - dw) / 2;
  const dy = (th - dh) / 2 + (options.offsetY ?? 0) * th;

  ctx.drawImage(img, dx, dy, dw, dh);
  return c.toDataURL('image/png');
}

/**
 * Generates a print-ready cut-guide sheet (4x6 in or A4) tiled with copies of the passport photo.
 */
export async function renderPassportPrintSheet(
  tileDataUrl: string,
  presetId: PassportPresetId,
  sheetId: SheetSizeId,
  maxCopies?: number
): Promise<{ dataUrl: string; layout: PassportSheetLayout; copiesPlaced: number }> {
  const layout = computePassportSheetGrid(presetId, sheetId, 300, 3);
  const tileImg = await loadImage(tileDataUrl);

  const c = document.createElement('canvas');
  c.width = layout.sheetWidthPx;
  c.height = layout.sheetHeightPx;
  const ctx = c.getContext('2d');
  if (!ctx) {
    return { dataUrl: tileDataUrl, layout, copiesPlaced: 1 };
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);

  const limit = maxCopies ? Math.min(maxCopies, layout.totalPhotos) : layout.totalPhotos;
  let placed = 0;

  for (let r = 0; r < layout.rows; r++) {
    for (let col = 0; col < layout.cols; col++) {
      if (placed >= limit) break;
      const x = layout.marginX + col * (layout.photoWidthPx + layout.gapPx);
      const y = layout.marginY + r * (layout.photoHeightPx + layout.gapPx);
      ctx.drawImage(tileImg, x, y, layout.photoWidthPx, layout.photoHeightPx);

      // Subtle hairline cut border around each PP photo
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, layout.photoWidthPx, layout.photoHeightPx);
      placed++;
    }
  }

  return {
    dataUrl: c.toDataURL('image/jpeg', 0.94),
    layout,
    copiesPlaced: placed,
  };
}
