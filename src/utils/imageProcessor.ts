import type {
  AnnotationItem,
  FilterPreset,
  ImageAdjustments,
  QuadCorners,
  ScannedPage,
  WatermarkConfig,
} from '../types/scanner';
import {
  applyHomography,
  clamp,
  computeHomography,
  computeIdCardLayout,
  computeVisibleFeedCropRect,
  detectDocumentQuadDetailed,
  detectDocumentQuadFromRgba,
  estimateOutputDimensions,
  type ScanCornerHint,
} from './cvGeometry';
import { applyPaperFinish, estimatePaperGains } from './magicColor';

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image asset'));
    img.src = src;
  });
}

export function drawToCanvas(
  source: HTMLImageElement | HTMLCanvasElement,
  maxDim = 1600
): HTMLCanvasElement {
  const sw = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const sh = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  const scale = Math.min(1, maxDim / Math.max(sw, sh, 1));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx) {
    ctx.drawImage(source, 0, 0, w, h);
  }
  return canvas;
}

/**
 * Automatically detects the 4 corners of a document in an image using multi-channel
 * RGBA color contrast + Sobel edges + convex hull 4-vertex fitting.
 */
export async function detectCornersFromDataUrl(
  src: string,
  options?: { scanHint?: ScanCornerHint }
): Promise<QuadCorners> {
  const img = await loadImage(src);
  const small = drawToCanvas(img, 220);
  const ctx = small.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return [
      { x: 0.08, y: 0.08 },
      { x: 0.92, y: 0.08 },
      { x: 0.92, y: 0.92 },
      { x: 0.08, y: 0.92 },
    ];
  }
  const { data, width, height } = ctx.getImageData(0, 0, small.width, small.height);
  return detectDocumentQuadFromRgba(data, width, height, { scanHint: options?.scanHint });
}

export function detectCornersDetailedFromVideoOrImage(
  source: HTMLVideoElement | HTMLImageElement,
  scratchCanvas: HTMLCanvasElement,
  options?: {
    zoom?: number;
    viewportWidth?: number;
    viewportHeight?: number;
    viewportAspect?: number;
    scanHint?: ScanCornerHint;
  }
): { quad: QuadCorners; confidence: number; aspectRatio: number } | null {
  const sw = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
  const sh = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
  if (!sw || !sh) return null;

  const vw =
    options?.viewportWidth ??
    (options?.viewportAspect && options.viewportAspect > 0 ? options.viewportAspect * 100 : sw);
  const vh = options?.viewportHeight ?? (options?.viewportAspect ? 100 : sh);
  const crop = computeVisibleFeedCropRect(sw, sh, vw, vh, options?.zoom ?? 1);

  const maxLiveDim = 220;
  const aspect = Math.max(0.25, crop.viewAspect);
  const w = aspect >= 1 ? maxLiveDim : Math.max(40, Math.round(maxLiveDim * aspect));
  const h = aspect >= 1 ? Math.max(40, Math.round(maxLiveDim / aspect)) : maxLiveDim;

  scratchCanvas.width = w;
  scratchCanvas.height = h;
  const ctx = scratchCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, crop.sx, crop.sy, crop.sWidth, crop.sHeight, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const result = detectDocumentQuadDetailed(data, w, h, { scanHint: options?.scanHint });
  if (result.confidence < 0.22) return null;
  return { quad: result.quad, confidence: result.confidence, aspectRatio: w / Math.max(1, h) };
}

/**
 * Fast synchronous frame edge detector for live camera viewfinder quad overlay.
 * Accounts for CSS `object-cover` aspect cropping and digital `zoom` so the overlay
 * tracks the exact visible corners at any gesture zoom level.
 */
export function detectCornersFromVideoOrImage(
  source: HTMLVideoElement | HTMLImageElement,
  scratchCanvas: HTMLCanvasElement,
  options?: {
    zoom?: number;
    viewportWidth?: number;
    viewportHeight?: number;
    viewportAspect?: number;
    scanHint?: ScanCornerHint;
  }
): QuadCorners | null {
  return detectCornersDetailedFromVideoOrImage(source, scratchCanvas, options)?.quad ?? null;
}

/**
 * Captures ONLY the visible region inside the camera viewport (matching `object-cover` + gesture zoom)
 * so the scanned output contains exactly what the user framed in the feed, never hidden sensor margins.
 */
export function captureVisibleFeedFrame(
  source: HTMLVideoElement | HTMLImageElement,
  options?: {
    zoom?: number;
    viewportWidth?: number;
    viewportHeight?: number;
    mirrorHorizontal?: boolean;
    maxDim?: number;
  }
): string {
  const sw = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
  const sh = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
  if (!sw || !sh) return '';

  const crop = computeVisibleFeedCropRect(
    sw,
    sh,
    options?.viewportWidth,
    options?.viewportHeight,
    options?.zoom ?? 1
  );

  const maxDim = options?.maxDim ?? 1800;
  const longSide = Math.max(crop.sWidth, crop.sHeight, 1);
  const scale = longSide > maxDim ? maxDim / longSide : 1;
  const outW = Math.max(1, Math.round(crop.sWidth * scale));
  const outH = Math.max(1, Math.round(crop.sHeight * scale));

  const c = document.createElement('canvas');
  c.width = outW;
  c.height = outH;
  const ctx = c.getContext('2d');
  if (!ctx) return '';

  if (options?.mirrorHorizontal) {
    ctx.translate(outW, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, crop.sx, crop.sy, crop.sWidth, crop.sHeight, 0, 0, outW, outH);
  return c.toDataURL('image/jpeg', 0.93);
}

/**
 * Performs exact projective perspective dewarp using inverse 3x3 homography + bilinear sampling.
 */
export async function perspectiveDewarp(
  src: string,
  quad: QuadCorners,
  maxDim = 1500
): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = await loadImage(src);
  const srcCanvas = drawToCanvas(img, 1800);
  const sw = srcCanvas.width;
  const sh = srcCanvas.height;

  const srcQuadPx: QuadCorners = [
    { x: quad[0].x * sw, y: quad[0].y * sh },
    { x: quad[1].x * sw, y: quad[1].y * sh },
    { x: quad[2].x * sw, y: quad[2].y * sh },
    { x: quad[3].x * sw, y: quad[3].y * sh },
  ];

  const { width: dw, height: dh } = estimateOutputDimensions(srcQuadPx, maxDim);
  const dstRect: QuadCorners = [
    { x: 0, y: 0 },
    { x: dw - 1, y: 0 },
    { x: dw - 1, y: dh - 1 },
    { x: 0, y: dh - 1 },
  ];

  // Inverse homography: destination (rectified) -> source (skewed photo)
  const H = computeHomography(dstRect, srcQuadPx);

  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
  const dstCanvas = document.createElement('canvas');
  dstCanvas.width = dw;
  dstCanvas.height = dh;
  const dstCtx = dstCanvas.getContext('2d', { willReadFrequently: true });

  if (!srcCtx || !dstCtx) {
    return { dataUrl: src, width: sw, height: sh };
  }

  const srcData = srcCtx.getImageData(0, 0, sw, sh).data;
  const outImg = dstCtx.createImageData(dw, dh);
  const out = outImg.data;

  const maxSx = sw - 2;
  const maxSy = sh - 2;

  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const p = applyHomography(H, x, y);
      const sx = clamp(p.x, 0, maxSx);
      const sy = clamp(p.y, 0, maxSy);

      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;

      const idx00 = (y0 * sw + x0) * 4;
      const idx10 = idx00 + 4;
      const idx01 = idx00 + sw * 4;
      const idx11 = idx01 + 4;

      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;

      const outIdx = (y * dw + x) * 4;
      out[outIdx] =
        srcData[idx00] * w00 +
        srcData[idx10] * w10 +
        srcData[idx01] * w01 +
        srcData[idx11] * w11;
      out[outIdx + 1] =
        srcData[idx00 + 1] * w00 +
        srcData[idx10 + 1] * w10 +
        srcData[idx01 + 1] * w01 +
        srcData[idx11 + 1] * w11;
      out[outIdx + 2] =
        srcData[idx00 + 2] * w00 +
        srcData[idx10 + 2] * w10 +
        srcData[idx01 + 2] * w01 +
        srcData[idx11 + 2] * w11;
      out[outIdx + 3] = 255;
    }
  }

  dstCtx.putImageData(outImg, 0, 0);
  return {
    dataUrl: dstCanvas.toDataURL('image/jpeg', 0.93),
    width: dw,
    height: dh,
  };
}

/**
 * Estimates local background illumination map on a downsampled grid to remove desk/hand shadows.
 */
function computeIlluminationMap(
  data: Uint8ClampedArray,
  width: number,
  height: number
): Float32Array {
  const gridW = Math.max(16, Math.min(64, Math.floor(width / 12)));
  const gridH = Math.max(16, Math.min(64, Math.floor(height / 12)));
  const cellW = width / gridW;
  const cellH = height / gridH;

  const grid = new Float32Array(gridW * gridH * 3);

  for (let gy = 0; gy < gridH; gy++) {
    const yStart = Math.floor(gy * cellH);
    const yEnd = Math.min(height, Math.ceil((gy + 1) * cellH));
    for (let gx = 0; gx < gridW; gx++) {
      const xStart = Math.floor(gx * cellW);
      const xEnd = Math.min(width, Math.ceil((gx + 1) * cellW));

      // Take the 88th-percentile-like bright sample (max of sampled pixels, clamped)
      let maxR = 140;
      let maxG = 140;
      let maxB = 140;
      const stepY = Math.max(1, Math.floor((yEnd - yStart) / 4));
      const stepX = Math.max(1, Math.floor((xEnd - xStart) / 4));

      for (let y = yStart; y < yEnd; y += stepY) {
        for (let x = xStart; x < xEnd; x += stepX) {
          const idx = (y * width + x) * 4;
          const l = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
          if (l > 0.299 * maxR + 0.587 * maxG + 0.114 * maxB) {
            maxR = data[idx];
            maxG = data[idx + 1];
            maxB = data[idx + 2];
          }
        }
      }

      const gIdx = (gy * gridW + gx) * 3;
      grid[gIdx] = maxR;
      grid[gIdx + 1] = maxG;
      grid[gIdx + 2] = maxB;
    }
  }

  // Smooth the grid twice with a 3x3 box pass to prevent block seams
  const smooth = new Float32Array(grid.length);
  for (let pass = 0; pass < 2; pass++) {
    const src = pass === 0 ? grid : smooth;
    const dst = pass === 0 ? smooth : grid;
    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const ny = clamp(gy + dy, 0, gridH - 1);
            const nx = clamp(gx + dx, 0, gridW - 1);
            const i = (ny * gridW + nx) * 3;
            sr += src[i];
            sg += src[i + 1];
            sb += src[i + 2];
            cnt++;
          }
        }
        const o = (gy * gridW + gx) * 3;
        dst[o] = sr / cnt;
        dst[o + 1] = sg / cnt;
        dst[o + 2] = sb / cnt;
      }
    }
  }

  // Bilinearly upsample to full image
  const bg = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const gy = clamp((y / height) * (gridH - 1), 0, gridH - 1.001);
    const y0 = Math.floor(gy);
    const fy = gy - y0;
    for (let x = 0; x < width; x++) {
      const gx = clamp((x / width) * (gridW - 1), 0, gridW - 1.001);
      const x0 = Math.floor(gx);
      const fx = gx - x0;

      const i00 = (y0 * gridW + x0) * 3;
      const i10 = i00 + 3;
      const i01 = i00 + gridW * 3;
      const i11 = i01 + 3;

      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;

      const o = (y * width + x) * 3;
      bg[o] = Math.max(90, grid[i00] * w00 + grid[i10] * w10 + grid[i01] * w01 + grid[i11] * w11);
      bg[o + 1] = Math.max(
        90,
        grid[i00 + 1] * w00 + grid[i10 + 1] * w10 + grid[i01 + 1] * w01 + grid[i11 + 1] * w11
      );
      bg[o + 2] = Math.max(
        90,
        grid[i00 + 2] * w00 + grid[i10 + 2] * w10 + grid[i01 + 2] * w01 + grid[i11 + 2] * w11
      );
    }
  }

  return bg;
}

/**
 * Integral-image adaptive local thresholding for crisp shadow-free B&W photocopy output.
 */
function applyAdaptiveThreshold(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  sensitivity: number
) {
  const n = width * height;
  const luma = new Float32Array(n);
  const sat = new Float64Array((width + 1) * (height + 1));

  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      luma[y * width + x] = lum;
      rowSum += lum;
      sat[(y + 1) * (width + 1) + (x + 1)] = sat[y * (width + 1) + (x + 1)] + rowSum;
    }
  }

  const radius = clamp(Math.round(Math.min(width, height) / 36), 10, 28);
  const w1 = width + 1;

  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);

      const count = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        sat[(y1 + 1) * w1 + (x1 + 1)] -
        sat[y0 * w1 + (x1 + 1)] -
        sat[(y1 + 1) * w1 + x0] +
        sat[y0 * w1 + x0];

      const localMean = sum / count;
      const pix = luma[y * width + x];

      // Soft anti-aliased ramp around adaptive threshold for crisp readable edges
      const thresh = localMean * (1 - sensitivity);
      let val: number;
      if (pix < thresh - 10) {
        val = 12;
      } else if (pix > thresh + 8) {
        val = 255;
      } else {
        const t = (pix - (thresh - 10)) / 18;
        val = Math.round(12 + t * 243);
      }

      const idx = (y * width + x) * 4;
      data[idx] = val;
      data[idx + 1] = val;
      data[idx + 2] = val;
    }
  }
}

/**
 * 3x3 unsharp mask sharpening pass.
 */
function applySharpen(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  amount: number
) {
  if (amount <= 0) return;
  const strength = (amount / 100) * 0.75;
  const copy = new Uint8ClampedArray(data);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const center = copy[idx + c];
        const neighbors =
          (copy[idx - 4 + c] +
            copy[idx + 4 + c] +
            copy[idx - width * 4 + c] +
            copy[idx + width * 4 + c]) *
          0.25;
        const sharpened = center + (center - neighbors) * strength;
        data[idx + c] = clamp(Math.round(sharpened), 0, 255);
      }
    }
  }
}

export function drawAnnotationsAndWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  annotations: AnnotationItem[],
  watermark: WatermarkConfig,
  loadedSignatures: Map<string, HTMLImageElement>
) {
  for (const item of annotations) {
    ctx.save();
    if (item.type === 'redaction') {
      ctx.fillStyle = item.color || '#09090b';
      ctx.fillRect(item.x * width, item.y * height, item.width * width, item.height * height);
    } else if (item.type === 'text' && item.text) {
      const pxSize = Math.max(12, Math.round((item.fontSize || 0.032) * height));
      ctx.font = `700 ${pxSize}px "DM Sans", sans-serif`;
      ctx.fillStyle = item.color || '#b91c1c';
      ctx.globalAlpha = item.opacity ?? 1;
      ctx.textBaseline = 'top';
      const lines = item.text.split('\n');
      lines.forEach((line, idx) => {
        ctx.fillText(line, item.x * width, item.y * height + idx * pxSize * 1.25);
      });
    } else if (item.type === 'signature' && item.imageDataUrl) {
      const sigImg = loadedSignatures.get(item.imageDataUrl);
      if (sigImg) {
        ctx.globalAlpha = item.opacity ?? 1;
        ctx.drawImage(
          sigImg,
          item.x * width,
          item.y * height,
          item.width * width,
          item.height * height
        );
      }
    } else if (item.type === 'shape') {
      const sx = item.x * width;
      const sy = item.y * height;
      const sw = item.width * width;
      const sh = item.height * height;
      const strokePx = Math.max(2, (item.strokeWidth || 0.006) * Math.min(width, height));
      ctx.globalAlpha = item.opacity ?? 1;
      ctx.strokeStyle = item.color || '#0f766e';
      ctx.lineWidth = strokePx;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const kind = item.shapeKind || 'rect';
      if (kind === 'rect') {
        if (item.fillColor && item.fillColor !== 'transparent') {
          ctx.fillStyle = item.fillColor;
          ctx.fillRect(sx, sy, sw, sh);
        }
        ctx.strokeRect(sx, sy, sw, sh);
      } else if (kind === 'circle') {
        ctx.beginPath();
        ctx.ellipse(sx + sw / 2, sy + sh / 2, Math.max(2, sw / 2), Math.max(2, sh / 2), 0, 0, Math.PI * 2);
        if (item.fillColor && item.fillColor !== 'transparent') {
          ctx.fillStyle = item.fillColor;
          ctx.fill();
        }
        ctx.stroke();
      } else if (kind === 'line') {
        ctx.beginPath();
        ctx.moveTo(sx, sy + sh / 2);
        ctx.lineTo(sx + sw, sy + sh / 2);
        ctx.stroke();
      } else if (kind === 'arrow') {
        const yMid = sy + sh / 2;
        const head = Math.min(sw * 0.35, Math.max(10, sh * 0.45));
        ctx.beginPath();
        ctx.moveTo(sx, yMid);
        ctx.lineTo(sx + sw - strokePx, yMid);
        ctx.moveTo(sx + sw - head, yMid - head * 0.65);
        ctx.lineTo(sx + sw, yMid);
        ctx.lineTo(sx + sw - head, yMid + head * 0.65);
        ctx.stroke();
      } else if (kind === 'check') {
        ctx.beginPath();
        ctx.moveTo(sx + sw * 0.14, sy + sh * 0.54);
        ctx.lineTo(sx + sw * 0.4, sy + sh * 0.82);
        ctx.lineTo(sx + sw * 0.86, sy + sh * 0.2);
        ctx.stroke();
      }
    } else if (item.type === 'stroke' && item.points && item.points.length > 1) {
      ctx.strokeStyle = item.color || '#facc15';
      ctx.globalAlpha = item.opacity ?? 0.42;
      ctx.lineWidth = Math.max(2, (item.strokeWidth || 0.014) * width);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(item.points[0].x * width, item.points[0].y * height);
      for (let i = 1; i < item.points.length; i++) {
        ctx.lineTo(item.points[i].x * width, item.points[i].y * height);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  if (watermark.enabled && watermark.text.trim()) {
    ctx.save();
    ctx.globalAlpha = clamp(watermark.opacity, 0.04, 0.85);
    ctx.fillStyle = watermark.color || '#0f172a';
    const fontSize = Math.max(18, Math.round(width * (watermark.tiled ? 0.036 : 0.058)));
    ctx.font = `700 ${fontSize}px "Plus Jakarta Sans", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const rad = (watermark.angle * Math.PI) / 180;

    if (watermark.tiled) {
      const stepX = Math.max(220, Math.round(width * 0.36));
      const stepY = Math.max(160, Math.round(height * 0.22));
      for (let y = -height * 0.2; y < height * 1.2; y += stepY) {
        for (let x = -width * 0.2; x < width * 1.2; x += stepX) {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(rad);
          ctx.fillText(watermark.text, 0, 0);
          ctx.restore();
        }
      }
    } else {
      ctx.translate(width / 2, height / 2);
      ctx.rotate(rad);
      ctx.fillText(watermark.text, 0, 0);
    }
    ctx.restore();
  }
}

/**
 * Applies CamScanner filter preset, shadow removal, manual adjustments, rotation/flip,
 * and optional annotations/watermarks.
 */
export async function processPagePipeline(
  croppedDataUrl: string,
  filter: FilterPreset,
  adjustments: ImageAdjustments,
  rotation: 0 | 90 | 180 | 270,
  flipH: boolean,
  options?: {
    maxDim?: number;
    annotations?: AnnotationItem[];
    watermark?: WatermarkConfig;
    includeOverlays?: boolean;
    backgroundColor?: string;
  }
): Promise<{ dataUrl: string; width: number; height: number }> {
  const maxDim = options?.maxDim ?? 1400;
  const img = await loadImage(croppedDataUrl);
  const baseCanvas = drawToCanvas(img, maxDim);

  // Rotate & flip first into working canvas
  const isRotated90 = rotation === 90 || rotation === 270;
  const w = isRotated90 ? baseCanvas.height : baseCanvas.width;
  const h = isRotated90 ? baseCanvas.width : baseCanvas.height;

  const workCanvas = document.createElement('canvas');
  workCanvas.width = w;
  workCanvas.height = h;
  const ctx = workCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return { dataUrl: croppedDataUrl, width: w, height: h };
  }

  const wantsTransparent = options?.backgroundColor === 'transparent';
  const solidBg =
    !wantsTransparent && options?.backgroundColor && options.backgroundColor !== 'none'
      ? options.backgroundColor
      : !wantsTransparent
        ? '#ffffff'
        : null;

  if (solidBg) {
    ctx.fillStyle = solidBg;
    ctx.fillRect(0, 0, w, h);
  }

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  if (flipH) ctx.scale(-1, 1);
  ctx.drawImage(baseCanvas, -baseCanvas.width / 2, -baseCanvas.height / 2);
  ctx.restore();

  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  // Shadow removal map (used by shadow_remove, magic_color, or explicit slider)
  const effectiveShadowStrength =
    filter === 'magic_hd'
      ? 100
      : filter === 'shadow_remove'
        ? Math.max(85, adjustments.shadowRemoval)
        : filter === 'magic_color'
          ? Math.max(72, adjustments.shadowRemoval)
          : adjustments.shadowRemoval;

  if (effectiveShadowStrength > 0) {
    const bg = computeIlluminationMap(data, w, h);
    const alpha = clamp(effectiveShadowStrength / 100, 0, 1);
    for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
      const nr = clamp((data[i] / bg[j]) * 250, 0, 255);
      const ng = clamp((data[i + 1] / bg[j + 1]) * 250, 0, 255);
      const nb = clamp((data[i + 2] / bg[j + 2]) * 250, 0, 255);
      data[i] = data[i] * (1 - alpha) + nr * alpha;
      data[i + 1] = data[i + 1] * (1 - alpha) + ng * alpha;
      data[i + 2] = data[i + 2] * (1 - alpha) + nb * alpha;
    }
  }

  // Preset-specific color tone & contrast curve
  let presetContrast = 0;
  let presetSaturation = 0;
  let presetGamma = 1.0;

  if (filter === 'magic_color') {
    presetContrast = 28;
    presetSaturation = 24;
    presetGamma = 0.92;
  } else if (filter === 'magic_hd') {
    // The paper finish below does the heavy lifting, so keep this gentle.
    presetContrast = 16;
    presetSaturation = 18;
    presetGamma = 0.98;
  } else if (filter === 'lighten') {
    presetContrast = 12;
    presetGamma = 0.72;
  } else if (filter === 'grayscale') {
    presetContrast = 18;
    presetSaturation = -100;
  } else if (filter === 'shadow_remove') {
    presetContrast = 16;
    presetSaturation = 8;
  }

  const totalBrightness = adjustments.brightness * 1.4;
  const totalContrast = clamp(adjustments.contrast + presetContrast, -100, 120);
  const contrastFactor = (259 * (totalContrast + 255)) / (255 * (259 - totalContrast));
  const totalSat = clamp((adjustments.saturation + presetSaturation) / 100, -1, 1);

  if (
    presetGamma !== 1.0 ||
    totalBrightness !== 0 ||
    totalContrast !== 0 ||
    totalSat !== 0
  ) {
    for (let i = 0; i < data.length; i += 4) {
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      if (presetGamma !== 1.0) {
        r = 255 * Math.pow(r / 255, presetGamma);
        g = 255 * Math.pow(g / 255, presetGamma);
        b = 255 * Math.pow(b / 255, presetGamma);
      }

      if (totalBrightness !== 0 || totalContrast !== 0) {
        r = contrastFactor * (r + totalBrightness - 128) + 128;
        g = contrastFactor * (g + totalBrightness - 128) + 128;
        b = contrastFactor * (b + totalBrightness - 128) + 128;
      }

      if (totalSat !== 0) {
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        const satMult = 1 + totalSat;
        r = gray + (r - gray) * satMult;
        g = gray + (g - gray) * satMult;
        b = gray + (b - gray) * satMult;
      }

      data[i] = clamp(Math.round(r), 0, 255);
      data[i + 1] = clamp(Math.round(g), 0, 255);
      data[i + 2] = clamp(Math.round(b), 0, 255);
    }
  }

  // Magic Color HD: neutralise the paper cast and separate ink from paper.
  if (filter === 'magic_hd') {
    applyPaperFinish(data, estimatePaperGains(data), 0.62);
  }

  // Sharpening
  const effectiveSharpness =
    filter === 'magic_color' || filter === 'magic_hd' || filter === 'bw_sharp'
      ? Math.max(30, adjustments.sharpness)
      : adjustments.sharpness;
  applySharpen(data, w, h, effectiveSharpness);

  // Adaptive B&W thresholding
  if (filter === 'bw') {
    applyAdaptiveThreshold(data, w, h, 0.12);
  } else if (filter === 'bw_sharp') {
    applyAdaptiveThreshold(data, w, h, 0.08);
  }

  ctx.putImageData(imgData, 0, 0);

  // Optionally composite annotations & watermark directly into rendered image
  if (options?.includeOverlays) {
    const annotations = options.annotations || [];
    const watermark = options.watermark || {
      enabled: false,
      text: '',
      opacity: 0.2,
      angle: -30,
      tiled: true,
      color: '#0f172a',
    };
    const sigMap = new Map<string, HTMLImageElement>();
    await Promise.all(
      annotations
        .filter((a) => a.type === 'signature' && a.imageDataUrl)
        .map(async (a) => {
          if (a.imageDataUrl && !sigMap.has(a.imageDataUrl)) {
            try {
              sigMap.set(a.imageDataUrl, await loadImage(a.imageDataUrl));
            } catch {
              // ignore broken signature image
            }
          }
        })
    );
    drawAnnotationsAndWatermark(ctx, w, h, annotations, watermark, sigMap);
  }

  return {
    dataUrl: wantsTransparent
      ? workCanvas.toDataURL('image/png')
      : workCanvas.toDataURL('image/jpeg', 0.92),
    width: w,
    height: h,
  };
}

/**
 * Generates a compact composited thumbnail dataURL reflecting filters, background color,
 * rotation/flip, signatures, text stamps, redactions, freehand strokes, and watermarks.
 */
export async function renderPageThumbnail(
  page: ScannedPage,
  maxDim = 420
): Promise<string> {
  const result = await processPagePipeline(
    page.croppedDataUrl,
    page.filter,
    page.adjustments,
    page.rotation,
    page.flipH,
    {
      maxDim,
      annotations: page.annotations,
      watermark: page.watermark,
      includeOverlays: true,
      backgroundColor: page.backgroundColor,
    }
  );
  return result.dataUrl;
}

/**
 * Generates a realistic A4 2-up composited ID Card sheet from Front & Back dataUrls.
 */
export async function composeIdCardSheet(
  frontDataUrl: string,
  backDataUrl: string,
  options: {
    showCutGuides: boolean;
    cardScale: number;
    watermarkText: string;
    showWatermark: boolean;
  }
): Promise<{ dataUrl: string; width: number; height: number }> {
  const pageW = 1240;
  const pageH = 1754;
  const canvas = document.createElement('canvas');
  canvas.width = pageW;
  canvas.height = pageH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { dataUrl: frontDataUrl, width: pageW, height: pageH };
  }

  // Crisp pure white A4 paper background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, pageW, pageH);

  const layout = computeIdCardLayout(pageW, pageH, options.cardScale, 0.065);
  const [frontImg, backImg] = await Promise.all([loadImage(frontDataUrl), loadImage(backDataUrl)]);

  const drawCard = (img: HTMLImageElement, rect: { x: number; y: number; width: number; height: number }, label: string) => {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.width, rect.height, 14);
    ctx.clip();
    ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height);
    ctx.restore();

    // Subtle hairline border
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.16)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.width, rect.height, 14);
    ctx.stroke();

    if (options.showCutGuides) {
      ctx.fillStyle = '#64748b';
      ctx.font = '500 20px "JetBrains Mono", monospace';
      ctx.fillText(label, rect.x, rect.y - 12);
    }
  };

  drawCard(frontImg, layout.frontRect, 'FRONT SIDE');
  drawCard(backImg, layout.backRect, 'BACK SIDE');

  if (options.showCutGuides) {
    ctx.save();
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 10]);
    ctx.beginPath();
    ctx.moveTo(80, layout.dividerY);
    ctx.lineTo(pageW - 80, layout.dividerY);
    ctx.stroke();
    ctx.restore();
  }

  if (options.showWatermark && options.watermarkText.trim()) {
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#0f172a';
    ctx.font = '700 42px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const drawMarks = (rect: { x: number; y: number; width: number; height: number }) => {
      ctx.save();
      ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
      ctx.rotate(-0.42);
      ctx.fillText(options.watermarkText.trim(), 0, 0);
      ctx.restore();
    };
    drawMarks(layout.frontRect);
    drawMarks(layout.backRect);
    ctx.restore();
  }

  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.93),
    width: pageW,
    height: pageH,
  };
}

/**
 * Generates a realistic synthetic Back of ID Card image for immediate 1-click ID Card testing.
 */
export function createSampleIdBackDataUrl(): string {
  const w = 960;
  const h = 605;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // Soft security card gradient
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#f1f5f9');
  grad.addColorStop(0.5, '#e2e8f0');
  grad.addColorStop(1, '#dbeafe');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Magnetic stripe
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, 48, w, 86);

  // Address & issuing metadata
  ctx.fillStyle = '#0f172a';
  ctx.font = '700 22px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('REPUBLIC OF AETHEL — CIVIL REGISTRY', 48, 190);

  ctx.fillStyle = '#334155';
  ctx.font = '500 20px "DM Sans", sans-serif';
  ctx.fillText('RESIDENCE: 418 MERIDIAN TERRACE, NORTH DISTRICT', 48, 240);
  ctx.fillText('BLOOD GROUP: O+   |   SEX: F   |   HEIGHT: 170 CM', 48, 278);
  ctx.fillText('AUTHORITY: NATIONAL IDENTITY BUREAU', 48, 316);

  // Emergency notice
  ctx.fillStyle = '#475569';
  ctx.font = '400 17px "DM Sans", sans-serif';
  ctx.fillText('If found, please return to any Aethel Municipal Post Office or Civil Registry.', 48, 376);

  // Machine-readable zone (MRZ)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(36, 430, w - 72, 130);
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 2;
  ctx.strokeRect(36, 430, w - 72, 130);

  ctx.fillStyle = '#0f172a';
  ctx.font = '600 24px "JetBrains Mono", monospace';
  ctx.fillText('IDAET8849302170<<<<<<<<<<<<<<<', 58, 480);
  ctx.fillText('9310145F2902018AET<<<<<<<<<<<6', 58, 518);
  ctx.fillText('THORNE<<EVELYN<<<<<<<<<<<<<<<<', 58, 552);

  return canvas.toDataURL('image/jpeg', 0.92);
}
