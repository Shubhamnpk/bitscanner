import { loadImage } from './imageProcessor';

// ─── Face Detection Types ──────────────────────────────────────────────────────

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FaceDetectionResult {
  faceBox: FaceBox | null;
  confidence: number;
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
