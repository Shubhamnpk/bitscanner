import type { ExportFormat, PdfQuality, ScannedPage } from '../types/scanner';

/**
 * Validates and resolves selected 0-based page indices into ordered unique page selections.
 * Defaults to all pages if selection is empty or omitted.
 */
export function resolveSelectedPageIndices(
  totalPages: number,
  selectedIndices?: number[]
): number[] {
  if (totalPages <= 0) return [];
  if (!selectedIndices || selectedIndices.length === 0) {
    return Array.from({ length: totalPages }, (_, i) => i);
  }
  const seen = new Set<number>();
  const valid: number[] = [];
  for (const idx of selectedIndices) {
    if (Number.isInteger(idx) && idx >= 0 && idx < totalPages && !seen.has(idx)) {
      seen.add(idx);
      valid.push(idx);
    }
  }
  valid.sort((a, b) => a - b);
  return valid.length > 0 ? valid : Array.from({ length: totalPages }, (_, i) => i);
}

export function getSelectedPages(pages: ScannedPage[], selectedIndices?: number[]): ScannedPage[] {
  const indices = resolveSelectedPageIndices(pages.length, selectedIndices);
  return indices.map((i) => pages[i]);
}

export function sanitizeExportFilename(name: string, fallback = 'scanned-document'): string {
  const cleaned = (name || '')
    .trim()
    .replace(/[^a-zA-Z0-9_\-. ]/g, '_')
    .replace(/\s+/g, ' ');
  return cleaned || fallback;
}

export function estimateExportSizeKb(
  pageCount: number,
  format: ExportFormat,
  quality: PdfQuality,
  options?: { wordIncludeImages?: boolean }
): number {
  const count = Math.max(1, pageCount);
  if (format === 'image') {
    const perPage = quality === 'high' ? 620 : quality === 'balanced' ? 320 : 150;
    return Math.max(30, count * perPage);
  }
  if (format === 'word') {
    if (options?.wordIncludeImages === false) {
      return Math.max(8, count * 6);
    }
    const perPage = quality === 'high' ? 420 : quality === 'balanced' ? 230 : 115;
    return Math.max(18, count * perPage);
  }
  const perPagePdf = quality === 'high' ? 380 : quality === 'balanced' ? 195 : 95;
  return Math.max(24, count * perPagePdf);
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface WordPagePayload {
  pageNumber: number;
  ocrText: string;
  imageDataUrl?: string;
}

/**
 * Generates a clean Word-compatible (.doc HTML) document combining selected pages,
 * embedded high-contrast scan images, and/or recognized OCR text paragraphs.
 */
export function buildWordExportHtml(
  docTitle: string,
  pages: WordPagePayload[],
  options: { includeImages: boolean; includeOcrText: boolean }
): string {
  const safeTitle = escapeHtml(docTitle || 'Scanned Document');
  const sections = pages
    .map((p, idx) => {
      const breakStyle = idx < pages.length - 1 ? 'page-break-after: always;' : '';
      const imgBlock =
        options.includeImages && p.imageDataUrl
          ? `<div style="margin: 12px 0;"><img src="${p.imageDataUrl}" alt="Page ${p.pageNumber}" style="max-width: 100%; height: auto; border: 1px solid #e2e8f0;" /></div>`
          : '';
      const rawText = (p.ocrText || '').trim();
      const textBlock = options.includeOcrText
        ? rawText
          ? `<div style="margin-top: 10px; font-size: 11pt; line-height: 1.6; color: #1e293b;">${escapeHtml(rawText).replace(/\n/g, '<br/>')}</div>`
          : `<p style="color: #64748b; font-style: italic; font-size: 10pt;">No OCR text extracted for Page ${p.pageNumber}.</p>`
        : '';

      return `<section style="${breakStyle} margin-bottom: 24px;">
  <h3 style="font-size: 11pt; color: #0f766e; margin-bottom: 6px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px;">Page ${p.pageNumber}</h3>
  ${imgBlock}
  ${textBlock}
</section>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8" />
  <title>${safeTitle}</title>
</head>
<body style="font-family: Calibri, Arial, sans-serif; color: #0f172a; padding: 28px; max-width: 780px; margin: 0 auto;">
  <h1 style="font-size: 18pt; margin-bottom: 4px;">${safeTitle}</h1>
  <p style="font-size: 9.5pt; color: #64748b; margin-top: 0; margin-bottom: 20px;">${pages.length} ${pages.length === 1 ? 'page' : 'pages'}</p>
  ${sections}
</body>
</html>`;
}
