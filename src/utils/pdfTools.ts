import { jsPDF } from 'jspdf';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { loadImage } from './imageProcessor';
import { sanitizeExportFilename } from './exportHelpers';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface RenderedPdfPageImage {
  pageNumber: number;
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Converts every page of an uploaded PDF File into crisp PNG or JPEG image data URLs.
 */
export async function renderPdfFileToImages(
  file: File,
  options?: {
    scale?: number;
    format?: 'png' | 'jpeg';
    onProgress?: (current: number, total: number) => void;
  }
): Promise<RenderedPdfPageImage[]> {
  const scale = options?.scale ?? 2.0;
  const format = options?.format ?? 'png';
  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
  const pdf = await loadingTask.promise;
  const total = pdf.numPages;
  const results: RenderedPdfPageImage[] = [];

  for (let p = 1; p <= total; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    results.push({
      pageNumber: p,
      dataUrl: canvas.toDataURL(mime, format === 'jpeg' ? 0.92 : undefined),
      width: canvas.width,
      height: canvas.height,
    });
    options?.onProgress?.(p, total);
  }

  return results;
}

/**
 * Combines an ordered array of image data URLs into one downloadable PDF file.
 */
export async function imagesToPdfAndDownload(
  imageDataUrls: string[],
  options: {
    paperSize?: 'a4' | 'letter' | 'fit';
    marginMm?: number;
    filename?: string;
    onProgress?: (current: number, total: number) => void;
  } = {}
): Promise<void> {
  if (imageDataUrls.length === 0) return;

  const paperSize = options.paperSize ?? 'a4';
  const margin = options.marginMm ?? 8;
  let pdf: jsPDF | null = null;

  for (let i = 0; i < imageDataUrls.length; i++) {
    const url = imageDataUrls[i];
    const img = await loadImage(url);
    const iw = Math.max(1, img.naturalWidth);
    const ih = Math.max(1, img.naturalHeight);
    const isLandscape = iw > ih;

    let pageW = 210;
    let pageH = 297;
    let formatArg: string | [number, number] = paperSize === 'letter' ? 'letter' : 'a4';
    const orient: 'p' | 'l' = isLandscape ? 'l' : 'p';

    if (paperSize === 'fit') {
      const targetW = 210;
      const targetH = Math.max(60, Math.round((targetW * ih) / iw));
      pageW = targetW;
      pageH = targetH;
      formatArg = [pageW, pageH];
    } else if (paperSize === 'letter') {
      pageW = orient === 'l' ? 279.4 : 215.9;
      pageH = orient === 'l' ? 215.9 : 279.4;
    } else {
      pageW = orient === 'l' ? 297 : 210;
      pageH = orient === 'l' ? 210 : 297;
    }

    if (i === 0) {
      pdf = new jsPDF({ orientation: orient, unit: 'mm', format: formatArg });
    } else if (pdf) {
      pdf.addPage(formatArg, orient);
    }

    if (!pdf) continue;
    const availW = Math.max(20, pageW - margin * 2);
    const availH = Math.max(20, pageH - margin * 2);
    const scale = Math.min(availW / iw, availH / ih);
    const drawW = iw * scale;
    const drawH = ih * scale;
    const dx = (pageW - drawW) / 2;
    const dy = (pageH - drawH) / 2;

    const c = document.createElement('canvas');
    c.width = iw;
    c.height = ih;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, iw, ih);
      ctx.drawImage(img, 0, 0);
      pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', dx, dy, drawW, drawH, undefined, 'FAST');
    }

    options.onProgress?.(i + 1, imageDataUrls.length);
  }

  if (pdf) {
    const safeName = sanitizeExportFilename(options.filename || 'combined_images');
    pdf.save(`${safeName}.pdf`);
  }
}

/**
 * Merges 2+ uploaded PDF files by rendering each page cleanly and combining into a single PDF.
 */
export async function mergePdfFilesAndDownload(
  files: File[],
  filename = 'merged_document',
  onProgress?: (label: string) => void
): Promise<number> {
  const allImages: string[] = [];
  for (let f = 0; f < files.length; f++) {
    onProgress?.(`Reading PDF ${f + 1} of ${files.length}...`);
    const pages = await renderPdfFileToImages(files[f], { scale: 1.75, format: 'jpeg' });
    pages.forEach((p) => allImages.push(p.dataUrl));
  }
  if (allImages.length === 0) return 0;

  onProgress?.('Building unified PDF...');
  await imagesToPdfAndDownload(allImages, {
    paperSize: 'fit',
    marginMm: 0,
    filename,
  });
  return allImages.length;
}

/**
 * Generates a playable WebM slideshow video from an ordered list of image data URLs.
 */
export async function imagesToVideoWebm(
  imageDataUrls: string[],
  secondsPerSlide = 2.5,
  onProgress?: (pct: number) => void
): Promise<{ blobUrl: string; filename: string; mimeType: string }> {
  if (imageDataUrls.length === 0) {
    throw new Error('Add at least one image to generate a video.');
  }
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('Video recording is not supported in this browser.');
  }

  const width = 960;
  const height = 1280;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable.');

  const loadedImgs = await Promise.all(imageDataUrls.map((u) => loadImage(u)));

  const mimeCandidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  const chosenMime =
    mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm';

  const stream = canvas.captureStream(24);
  const recorder = new MediaRecorder(stream, {
    mimeType: chosenMime,
    videoBitsPerSecond: 2_500_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) chunks.push(ev.data);
  };

  const donePromise = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: chosenMime }));
  });

  const drawSlide = (img: HTMLImageElement, pageNum: number, total: number) => {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);

    const pad = 48;
    const maxW = width - pad * 2;
    const maxH = height - pad * 2 - 44;
    const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    const dx = (width - dw) / 2;
    const dy = (height - dh - 28) / 2;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(dx - 8, dy - 8, dw + 16, dh + 16);
    ctx.drawImage(img, dx, dy, dw, dh);

    ctx.fillStyle = 'rgba(241, 245, 249, 0.85)';
    ctx.font = '600 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Page ${pageNum} of ${total}`, width / 2, height - 28);
  };

  recorder.start(100);
  const msPerSlide = Math.max(800, Math.round(secondsPerSlide * 1000));

  for (let i = 0; i < loadedImgs.length; i++) {
    drawSlide(loadedImgs[i], i + 1, loadedImgs.length);
    onProgress?.(Math.round(((i + 1) / loadedImgs.length) * 90));
    await new Promise((r) => window.setTimeout(r, msPerSlide));
  }

  recorder.stop();
  const blob = await donePromise;
  onProgress?.(100);

  return {
    blobUrl: URL.createObjectURL(blob),
    filename: `camscan_reel_${Date.now()}.webm`,
    mimeType: chosenMime,
  };
}
