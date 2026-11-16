import { jsPDF } from 'jspdf';
import type { ExportOptions, ScanDocument, ScannedPage } from '../types/scanner';
import { loadImage, processPagePipeline } from './imageProcessor';
import {
  buildOcrMarkdownText,
  buildWordExportHtml,
  getSelectedPages,
  resolveSelectedPageIndices,
  sanitizeExportFilename,
  type WordPagePayload,
} from './exportHelpers';

const PAPER_DIMENSIONS_MM = {
  a4: { width: 210, height: 297 },
  letter: { width: 215.9, height: 279.4 },
};

const MARGIN_MM = {
  none: 0,
  narrow: 8,
  standard: 16,
};

const QUALITY_SCALE = {
  high: { jpeg: 0.92, maxDim: 1600 },
  balanced: { jpeg: 0.78, maxDim: 1300 },
  compact: { jpeg: 0.56, maxDim: 1000 },
};

export function estimatePdfSizeKb(pages: ScannedPage[], quality: ExportOptions['quality']): number {
  const perPageKb = quality === 'high' ? 380 : quality === 'balanced' ? 195 : 95;
  return Math.max(24, pages.length * perPageKb);
}

function triggerDownload(href: string, filename: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function renderFinalPageDataUrl(
  page: ScannedPage,
  maxDim: number,
  jpegQuality: number,
  preserveTransparentPng = false
): Promise<{ dataUrl: string; width: number; height: number; isPng: boolean }> {
  const wantsPng = preserveTransparentPng && page.backgroundColor === 'transparent';
  const rendered = await processPagePipeline(
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
      backgroundColor: wantsPng ? 'transparent' : page.backgroundColor || '#ffffff',
    }
  );

  if (wantsPng) {
    return { ...rendered, isPng: true };
  }

  // Re-encode at requested quality if needed
  if (jpegQuality < 0.9) {
    const img = await loadImage(rendered.dataUrl);
    const c = document.createElement('canvas');
    c.width = rendered.width;
    c.height = rendered.height;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
      return {
        dataUrl: c.toDataURL('image/jpeg', jpegQuality),
        width: rendered.width,
        height: rendered.height,
        isPng: false,
      };
    }
  }
  return { ...rendered, isPng: false };
}

/**
 * Generates and downloads a multi-page (optionally OCR-searchable) PDF for selected pages.
 */
export async function exportDocumentAsPdf(
  doc: ScanDocument,
  options: ExportOptions,
  onProgress?: (current: number, total: number) => void
): Promise<void> {
  const selectedPages = getSelectedPages(doc.pages, options.selectedPageIndices);
  if (selectedPages.length === 0) return;

  const { jpeg, maxDim } = QUALITY_SCALE[options.quality];
  const margin = MARGIN_MM[options.margin];
  const embedSearchableText = options.searchablePdf !== false;

  let pdf: jsPDF | null = null;

  for (let i = 0; i < selectedPages.length; i++) {
    onProgress?.(i + 1, selectedPages.length);
    const page = selectedPages[i];
    const rendered = await renderFinalPageDataUrl(page, maxDim, jpeg, false);
    const isImgLandscape = rendered.width > rendered.height;

    let pageW: number;
    let pageH: number;
    let orient: 'p' | 'l';

    if (options.paperSize === 'fit') {
      const pxToMm = 210 / Math.max(rendered.width, 600);
      pageW = Math.max(60, rendered.width * pxToMm) + margin * 2;
      pageH = Math.max(60, rendered.height * pxToMm) + margin * 2;
      orient = pageW > pageH ? 'l' : 'p';
    } else {
      const base = PAPER_DIMENSIONS_MM[options.paperSize];
      if (options.orientation === 'portrait') {
        orient = 'p';
      } else if (options.orientation === 'landscape') {
        orient = 'l';
      } else {
        orient = isImgLandscape ? 'l' : 'p';
      }
      pageW = orient === 'l' ? base.height : base.width;
      pageH = orient === 'l' ? base.width : base.height;
    }

    if (!pdf) {
      pdf = new jsPDF({
        orientation: orient,
        unit: 'mm',
        format: [pageW, pageH],
        compress: true,
      });
    } else {
      pdf.addPage([pageW, pageH], orient);
    }

    const availW = Math.max(10, pageW - margin * 2);
    const availH = Math.max(10, pageH - margin * 2 - (options.includePageNumbers ? 6 : 0));

    const imgAspect = rendered.width / rendered.height;
    const boxAspect = availW / availH;

    let drawW = availW;
    let drawH = availH;
    if (imgAspect > boxAspect) {
      drawH = availW / imgAspect;
    } else {
      drawW = availH * imgAspect;
    }

    const drawX = margin + (availW - drawW) / 2;
    const drawY = margin + (availH - drawH) / 2;

    pdf.addImage(rendered.dataUrl, 'JPEG', drawX, drawY, drawW, drawH, undefined, 'FAST');

    // Invisible searchable OCR text overlay so PDF viewers allow Ctrl+F & text selection
    if (embedSearchableText && page.ocrText.trim()) {
      const lines = page.ocrText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length > 0) {
        const lineStep = Math.min(6.5, (drawH - 8) / Math.max(lines.length, 1));
        pdf.setFontSize(9);
        lines.forEach((line, lineIdx) => {
          const yPos = drawY + 6 + lineIdx * lineStep;
          if (yPos < drawY + drawH - 2) {
            pdf!.text(line, drawX + 3, yPos, {
              renderingMode: 'invisible',
              maxWidth: Math.max(20, drawW - 6),
            });
          }
        });
      }
    }

    if (options.includePageNumbers) {
      pdf.setFontSize(8);
      pdf.setTextColor(120, 130, 145);
      pdf.text(
        `${doc.title} — Page ${i + 1} of ${selectedPages.length}`,
        pageW / 2,
        pageH - 4,
        { align: 'center' }
      );
    }
  }

  if (pdf) {
    const safeName = sanitizeExportFilename(options.filename || doc.title);
    pdf.save(safeName.endsWith('.pdf') ? safeName : `${safeName}.pdf`);
  }
}

/**
 * Exports selected pages as PNG or JPEG — either individual page files or a single stitched long image.
 */
export async function exportPagesAsImages(
  doc: ScanDocument,
  options: ExportOptions,
  onProgress?: (current: number, total: number) => void
): Promise<void> {
  const indices = resolveSelectedPageIndices(doc.pages.length, options.selectedPageIndices);
  if (indices.length === 0) return;

  const format = options.imageFormat || 'png';
  const layout = options.imageLayout || (indices.length > 1 ? 'stitched' : 'individual');
  const { jpeg, maxDim } = QUALITY_SCALE[options.quality];
  const safeName = sanitizeExportFilename(options.filename || doc.title);

  if (layout === 'stitched' && indices.length > 1) {
    const renderedList: Array<{ img: HTMLImageElement; width: number; height: number }> = [];
    for (let i = 0; i < indices.length; i++) {
      onProgress?.(i + 1, indices.length);
      const page = doc.pages[indices[i]];
      const rendered = await renderFinalPageDataUrl(page, Math.min(maxDim, 1400), jpeg, format === 'png');
      const img = await loadImage(rendered.dataUrl);
      renderedList.push({ img, width: rendered.width, height: rendered.height });
    }

    const gapPx = 18;
    const targetW = Math.max(...renderedList.map((r) => r.width));
    const scaledHeights = renderedList.map((r) => Math.round((r.height * targetW) / r.width));
    const totalH =
      scaledHeights.reduce((acc, h) => acc + h, 0) + gapPx * (renderedList.length - 1);

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = totalH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(0, 0, targetW, totalH);

    let y = 0;
    renderedList.forEach((r, idx) => {
      const h = scaledHeights[idx];
      ctx.drawImage(r.img, 0, y, targetW, h);
      y += h + gapPx;
    });

    const dataUrl =
      format === 'png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', jpeg);
    triggerDownload(dataUrl, `${safeName}_combined.${format === 'png' ? 'png' : 'jpg'}`);
    return;
  }

  // Individual page files
  for (let i = 0; i < indices.length; i++) {
    onProgress?.(i + 1, indices.length);
    const pageIdx = indices[i];
    const page = doc.pages[pageIdx];
    const rendered = await renderFinalPageDataUrl(page, maxDim, jpeg, format === 'png');
    let href = rendered.dataUrl;

    if (format === 'png' && !rendered.isPng) {
      const img = await loadImage(rendered.dataUrl);
      const c = document.createElement('canvas');
      c.width = rendered.width;
      c.height = rendered.height;
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        href = c.toDataURL('image/png');
      }
    }

    const suffix = indices.length > 1 ? `_p${pageIdx + 1}` : '';
    const ext = format === 'png' ? 'png' : 'jpg';
    triggerDownload(href, `${safeName}${suffix}.${ext}`);
  }
}

/**
 * Exports a single page directly as PNG or JPEG download.
 */
export async function exportPageAsImage(
  page: ScannedPage,
  filename: string,
  format: 'png' | 'jpeg' = 'png'
): Promise<void> {
  const rendered = await renderFinalPageDataUrl(page, 1800, 0.94, format === 'png');
  let href = rendered.dataUrl;

  if (format === 'png' && !rendered.isPng) {
    const img = await loadImage(rendered.dataUrl);
    const c = document.createElement('canvas');
    c.width = rendered.width;
    c.height = rendered.height;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.drawImage(img, 0, 0);
      href = c.toDataURL('image/png');
    }
  }

  triggerDownload(
    href,
    `${sanitizeExportFilename(filename)}.${format === 'png' ? 'png' : 'jpg'}`
  );
}

/**
 * Exports selected document pages into a rich Word-compatible .doc file with scan images and/or OCR text.
 */
export async function exportDocumentAsWord(
  doc: ScanDocument,
  options: ExportOptions,
  onProgress?: (current: number, total: number) => void
): Promise<void> {
  const indices = resolveSelectedPageIndices(doc.pages.length, options.selectedPageIndices);
  if (indices.length === 0) return;

  const includeImages = options.wordIncludeImages !== false;
  const includeOcrText = options.wordIncludeOcrText !== false;
  const { jpeg, maxDim } = QUALITY_SCALE[options.quality];

  const payloads: WordPagePayload[] = [];
  for (let i = 0; i < indices.length; i++) {
    onProgress?.(i + 1, indices.length);
    const pageIdx = indices[i];
    const page = doc.pages[pageIdx];
    let imageDataUrl: string | undefined;
    if (includeImages) {
      const rendered = await renderFinalPageDataUrl(page, Math.min(maxDim, 1200), jpeg, false);
      imageDataUrl = rendered.dataUrl;
    }
    payloads.push({
      pageNumber: pageIdx + 1,
      ocrText: page.ocrText,
      ocrBlocks: page.ocrBlocks,
      imageDataUrl,
    });
  }

  const safeName = sanitizeExportFilename(options.filename || doc.title);
  const html = buildWordExportHtml(doc.title, payloads, { includeImages, includeOcrText });
  const blob = new Blob([html], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, safeName.endsWith('.doc') ? safeName : `${safeName}.doc`);
  URL.revokeObjectURL(url);
}

/**
 * Exports extracted OCR text (and structured tables) as a plain .txt or Word-compatible .doc file.
 */
export function exportOcrTextFile(
  title: string,
  text: string,
  format: 'txt' | 'doc' | 'md',
  ocrBlocks?: ScannedPage['ocrBlocks']
): void {
  const safeName = sanitizeExportFilename(title, 'extracted-text');
  let blob: Blob;

  if (format === 'doc') {
    const html = buildWordExportHtml(
      safeName,
      [{ pageNumber: 1, ocrText: text, ocrBlocks }],
      { includeImages: false, includeOcrText: true }
    );
    blob = new Blob([html], { type: 'application/msword;charset=utf-8' });
  } else if (format === 'md') {
    const md = buildOcrMarkdownText(safeName, text, ocrBlocks);
    blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  } else {
    blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  }

  const url = URL.createObjectURL(blob);
  triggerDownload(url, `${safeName}.${format}`);
  URL.revokeObjectURL(url);
}
