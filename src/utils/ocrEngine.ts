import { createWorker, PSM, type Block, type Worker } from 'tesseract.js';
import { loadImage } from './imageProcessor';
import {
  binarizeOcrAdaptive,
  cleanOcrText,
  computeOcrTargetSize,
  countOcrWords,
  estimateTextSkewDegrees,
  extractStructuredOcrEntities,
  preprocessGrayscaleForOcr,
  searchOcrTextMatches,
  type OcrLayoutMode,
  type OcrSearchResult,
  type OcrStructuredEntities,
} from './ocrHelpers';
import {
  parseOcrBlocksFromGeometry,
  parseOcrDocumentLayout,
  type OcrLineBox,
  type OcrStructuredBlock,
} from './ocrLayoutParser';

export type { OcrLayoutMode, OcrSearchResult, OcrStructuredBlock, OcrStructuredEntities };
export { countOcrWords, extractStructuredOcrEntities, parseOcrDocumentLayout, searchOcrTextMatches };

export interface OcrResult {
  text: string;
  confidence: number;
  wordCount: number;
  entities: OcrStructuredEntities;
  blocks: OcrStructuredBlock[];
  skewCorrectedDeg?: number;
}

function extractLineBoxesFromTesseractBlocks(blocks: Block[] | null | undefined): OcrLineBox[] {
  if (!blocks || blocks.length === 0) return [];
  const lines: OcrLineBox[] = [];
  for (const block of blocks) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        const cleaned = cleanOcrText(line.text || '');
        if (!cleaned) continue;
        lines.push({
          text: cleaned,
          bbox: line.bbox,
          words: (line.words || []).map((w) => ({
            text: w.text,
            bbox: w.bbox,
          })),
        });
      }
    }
  }
  return lines;
}

const PSM_BY_LAYOUT: Record<OcrLayoutMode, PSM> = {
  auto: PSM.AUTO_OSD,
  block: PSM.SINGLE_BLOCK,
  sparse: PSM.SPARSE_TEXT,
};

let cachedWorker: Worker | null = null;
let cachedLang: string | null = null;
let progressSink: ((pct: number, status: string) => void) | null = null;
let workerQueue: Promise<unknown> = Promise.resolve();

async function getOrCreateOcrWorker(lang: string): Promise<Worker> {
  if (cachedWorker && cachedLang === lang) {
    return cachedWorker;
  }
  if (cachedWorker) {
    try {
      await cachedWorker.terminate();
    } catch {
      // Ignore cleanup errors
    }
    cachedWorker = null;
    cachedLang = null;
  }

  const worker = await createWorker(lang, 1, {
    logger: (m) => {
      if (typeof m.progress === 'number') {
        const pct = Math.min(94, Math.max(15, Math.round(25 + m.progress * 68)));
        progressSink?.(pct, m.status || 'Recognizing characters...');
      }
    },
  });
  cachedWorker = worker;
  cachedLang = lang;
  return worker;
}

function addQuietMarginBorder(workCanvas: HTMLCanvasElement, padding: number): string {
  const outCanvas = document.createElement('canvas');
  outCanvas.width = workCanvas.width + padding * 2;
  outCanvas.height = workCanvas.height + padding * 2;
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) return workCanvas.toDataURL('image/png');

  outCtx.fillStyle = '#ffffff';
  outCtx.fillRect(0, 0, outCanvas.width, outCanvas.height);
  outCtx.drawImage(workCanvas, padding, padding);
  return outCanvas.toDataURL('image/png');
}

/**
 * Prepares upscaled grayscale pixels, auto-deskews subtle rotational tilt (+/- 5 deg),
 * and returns both shadow-normalized smooth preprocessing (primary) plus an adaptive
 * local binarization variant (fallback for faded thermal receipts or uneven lighting).
 */
async function prepareImageForOcr(imageDataUrl: string): Promise<{
  primaryUrl: string;
  adaptiveUrl: string;
  skewCorrectedDeg: number;
}> {
  const img = await loadImage(imageDataUrl);
  const { width, height, padding } = computeOcrTargetSize(img.naturalWidth, img.naturalHeight);

  // First draw to detect & auto-correct subtle text-line skew before running OCR
  const stageCanvas = document.createElement('canvas');
  stageCanvas.width = width;
  stageCanvas.height = height;
  const stageCtx = stageCanvas.getContext('2d', { willReadFrequently: true });
  if (!stageCtx) {
    return { primaryUrl: imageDataUrl, adaptiveUrl: imageDataUrl, skewCorrectedDeg: 0 };
  }

  stageCtx.fillStyle = '#ffffff';
  stageCtx.fillRect(0, 0, width, height);
  stageCtx.imageSmoothingEnabled = true;
  stageCtx.imageSmoothingQuality = 'high';
  stageCtx.drawImage(img, 0, 0, width, height);

  const rawData = stageCtx.getImageData(0, 0, width, height).data;
  const rawGray = new Uint8Array(width * height);
  for (let i = 0, j = 0; j < rawGray.length; i += 4, j++) {
    rawGray[j] = Math.round(0.299 * rawData[i] + 0.587 * rawData[i + 1] + 0.114 * rawData[i + 2]);
  }

  const skewDeg = estimateTextSkewDegrees(rawGray, width, height);
  let activeCanvas = stageCanvas;

  if (Math.abs(skewDeg) >= 0.6) {
    const deskewCanvas = document.createElement('canvas');
    deskewCanvas.width = width;
    deskewCanvas.height = height;
    const dCtx = deskewCanvas.getContext('2d', { willReadFrequently: true });
    if (dCtx) {
      dCtx.fillStyle = '#ffffff';
      dCtx.fillRect(0, 0, width, height);
      dCtx.save();
      dCtx.translate(width / 2, height / 2);
      dCtx.rotate((-skewDeg * Math.PI) / 180);
      dCtx.drawImage(stageCanvas, -width / 2, -height / 2);
      dCtx.restore();
      activeCanvas = deskewCanvas;
    }
  }

  const ctx = activeCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return { primaryUrl: imageDataUrl, adaptiveUrl: imageDataUrl, skewCorrectedDeg: skewDeg };
  }

  const imgData = ctx.getImageData(0, 0, width, height);
  const src = imgData.data;
  const gray = new Uint8Array(width * height);
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) {
    gray[j] = Math.round(0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]);
  }

  const primaryRgba = preprocessGrayscaleForOcr(gray, width, height);
  imgData.data.set(primaryRgba);
  ctx.putImageData(imgData, 0, 0);
  const primaryUrl = addQuietMarginBorder(activeCanvas, padding);

  // Also prepare adaptive Sauvola-like binary variant in case primary pass hits low confidence
  const adaptCanvas = document.createElement('canvas');
  adaptCanvas.width = width;
  adaptCanvas.height = height;
  const adaptCtx = adaptCanvas.getContext('2d');
  let adaptiveUrl = primaryUrl;
  if (adaptCtx) {
    const adaptImg = adaptCtx.createImageData(width, height);
    adaptImg.data.set(binarizeOcrAdaptive(gray, width, height));
    adaptCtx.putImageData(adaptImg, 0, 0);
    adaptiveUrl = addQuietMarginBorder(adaptCanvas, padding);
  }

  return { primaryUrl, adaptiveUrl, skewCorrectedDeg: skewDeg };
}

/**
 * High-accuracy client-side Tesseract OCR with:
 * - Automatic subtle skew detection & deskew rotation (+/- 5 deg)
 * - 300 DPI normalization & shadow-removing contrast enhancement + dust speck filtering
 * - Dual-pass adaptive binarization fallback when initial confidence is low (< 52%)
 * - Geometric table / key-value / heading structure reconstruction
 * - Entity extraction & cached WebAssembly worker reuse
 */
export async function runFreeOcr(
  imageDataUrl: string,
  lang = 'eng',
  onProgress?: (progressPct: number, statusLabel: string) => void,
  layoutMode: OcrLayoutMode = 'auto'
): Promise<OcrResult> {
  const task = workerQueue.then(async () => {
    progressSink = onProgress ?? null;
    onProgress?.(6, 'Auto-deskewing & enhancing text contrast...');
    const { primaryUrl, adaptiveUrl, skewCorrectedDeg } = await prepareImageForOcr(imageDataUrl);

    onProgress?.(18, 'Preparing Tesseract OCR engine...');
    const worker = await getOrCreateOcrWorker(lang);

    await worker.setParameters({
      tessedit_pageseg_mode: PSM_BY_LAYOUT[layoutMode] ?? PSM.AUTO_OSD,
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    });

    const primaryRes = await worker.recognize(primaryUrl, {}, { text: true, blocks: true });
    let bestText = cleanOcrText(primaryRes.data.text || '');
    let bestConf = Math.round(primaryRes.data.confidence || 0);
    let bestLineBoxes = extractLineBoxesFromTesseractBlocks(primaryRes.data.blocks);

    // If low confidence or empty text on challenging stained/faded paper, retry with adaptive binarization
    if ((bestConf < 52 || countOcrWords(bestText) === 0) && adaptiveUrl !== primaryUrl) {
      onProgress?.(82, 'Running adaptive threshold recovery pass...');
      const altRes = await worker.recognize(adaptiveUrl, {}, { text: true, blocks: true });
      const altText = cleanOcrText(altRes.data.text || '');
      const altConf = Math.round(altRes.data.confidence || 0);

      const primaryScore = bestConf * 2 + Math.min(40, countOcrWords(bestText));
      const altScore = altConf * 2 + Math.min(40, countOcrWords(altText));
      if (altScore > primaryScore) {
        bestText = altText;
        bestConf = altConf;
        bestLineBoxes = extractLineBoxesFromTesseractBlocks(altRes.data.blocks);
      }
    }

    const blocks = parseOcrBlocksFromGeometry(bestLineBoxes, bestText);
    const entities = extractStructuredOcrEntities(bestText);
    onProgress?.(100, 'Completed');
    progressSink = null;

    return {
      text: bestText,
      confidence: bestConf,
      wordCount: countOcrWords(bestText),
      entities,
      blocks,
      skewCorrectedDeg,
    };
  });

  workerQueue = task.catch(() => undefined);
  return task;
}
