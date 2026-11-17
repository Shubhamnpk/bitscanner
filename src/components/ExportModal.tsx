import React, { useEffect, useState } from 'react';
import { Check, Download, FileImage, FileSpreadsheet, FileText, X } from 'lucide-react';
import type {
  ExportFormat,
  ExportOptions,
  PdfMargin,
  PdfOrientation,
  PdfPaperSize,
  PdfQuality,
  ScanDocument,
} from '../types/scanner';
import {
  estimateExportSizeKb,
  resolveSelectedPageIndices,
} from '../utils/exportHelpers';
import {
  exportDocumentAsPdf,
  exportDocumentAsWord,
  exportPagesAsImages,
} from '../utils/pdfExporter';
import { useHaptics } from '../hooks/useHaptics';

interface ExportModalProps {
  document: ScanDocument | null;
  activePageIndex?: number;
  initialSelectedPages?: number[];
  defaultPaperSize?: PdfPaperSize;
  defaultQuality?: PdfQuality;
  defaultExportFormat?: ExportFormat;
  defaultFilenamePrefix?: string;
  defaultSearchablePdf?: boolean;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  document,
  activePageIndex = 0,
  initialSelectedPages,
  defaultPaperSize = 'a4',
  defaultQuality = 'high',
  defaultExportFormat = 'pdf',
  defaultFilenamePrefix = '',
  defaultSearchablePdf = true,
  onClose,
}) => {
  const haptics = useHaptics();
  const [format, setFormat] = useState<ExportFormat>(defaultExportFormat);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [paperSize, setPaperSize] = useState<PdfPaperSize>(defaultPaperSize);
  const [orientation, setOrientation] = useState<PdfOrientation>('auto');
  const [margin, setMargin] = useState<PdfMargin>('narrow');
  const [quality, setQuality] = useState<PdfQuality>(defaultQuality);
  const [includePageNumbers, setIncludePageNumbers] = useState(true);
  const [searchablePdf, setSearchablePdf] = useState(defaultSearchablePdf);
  const [imageFormat, setImageFormat] = useState<'png' | 'jpeg'>('png');
  const [imageLayout, setImageLayout] = useState<'individual' | 'stitched'>('stitched');
  const [wordIncludeImages, setWordIncludeImages] = useState(true);
  const [wordIncludeOcrText, setWordIncludeOcrText] = useState(true);
  const [filename, setFilename] = useState(document?.title || 'scanned-document');
  const [exporting, setExporting] = useState(false);
  const [progressText, setProgressText] = useState('');

  useEffect(() => {
    if (!document) return;
    const baseName = document.title || `${defaultFilenamePrefix}document`;
    setFilename(baseName);
    setPaperSize(defaultPaperSize);
    setQuality(defaultQuality);
    setSearchablePdf(defaultSearchablePdf);
    if (initialSelectedPages && initialSelectedPages.length > 0) {
      setSelectedIndices(initialSelectedPages);
    } else {
      setSelectedIndices(document.pages.map((_, idx) => idx));
    }
    setFormat(document.folder === 'signatures' ? 'image' : defaultExportFormat);
  }, [
    document,
    initialSelectedPages,
    defaultPaperSize,
    defaultQuality,
    defaultExportFormat,
    defaultFilenamePrefix,
    defaultSearchablePdf,
  ]);

  if (!document) return null;

  const totalPages = document.pages.length;
  const resolvedSelected = resolveSelectedPageIndices(totalPages, selectedIndices);
  const estKb = estimateExportSizeKb(resolvedSelected.length, format, quality, {
    wordIncludeImages,
  });
  const estLabel = estKb > 1024 ? `~${(estKb / 1024).toFixed(1)} MB` : `~${estKb} KB`;

  const togglePageSelection = (idx: number) => {
    haptics.tap();
    setSelectedIndices((prev) => {
      const current = resolveSelectedPageIndices(totalPages, prev);
      if (current.includes(idx)) {
        if (current.length <= 1) return current;
        return current.filter((i) => i !== idx);
      }
      return [...current, idx].sort((a, b) => a - b);
    });
  };

  const handleSelectAll = () => {
    haptics.tap();
    setSelectedIndices(document.pages.map((_, idx) => idx));
  };

  const handleSelectCurrent = () => {
    haptics.tap();
    const safeCurrent = Math.min(Math.max(0, activePageIndex), Math.max(0, totalPages - 1));
    setSelectedIndices([safeCurrent]);
  };

  const wordInvalid = format === 'word' && !wordIncludeImages && !wordIncludeOcrText;

  const handleExport = async () => {
    if (wordInvalid) return;
    haptics.tap();
    setExporting(true);
    try {
      const opts: ExportOptions = {
        format,
        paperSize,
        orientation,
        margin,
        quality,
        includePageNumbers,
        searchablePdf,
        imageFormat,
        imageLayout: resolvedSelected.length > 1 ? imageLayout : 'individual',
        wordIncludeImages,
        wordIncludeOcrText,
        selectedPageIndices: resolvedSelected,
        filename: filename.trim() || document.title,
      };

      const onProgress = (curr: number, total: number) => {
        setProgressText(`Rendering page ${curr} of ${total}...`);
      };

      if (format === 'pdf') {
        await exportDocumentAsPdf(document, opts, onProgress);
      } else if (format === 'image') {
        await exportPagesAsImages(document, opts, onProgress);
      } else {
        await exportDocumentAsWord(document, opts, onProgress);
      }
      haptics.success();
      onClose();
    } finally {
      setExporting(false);
      setProgressText('');
    }
  };

  const primaryCtaLabel =
    format === 'pdf'
      ? 'Download PDF'
      : format === 'image'
        ? imageFormat === 'png'
          ? 'Download PNG'
          : 'Download JPEG'
        : 'Download Word .DOC';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
      data-testid="export-modal"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 p-0 sm:p-4 backdrop-blur-xs"
    >
      <div className="w-full max-w-xl rounded-t-3xl sm:rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden animate-sheet-up pb-safe max-h-[92dvh] flex flex-col">
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-slate-300 sm:hidden" />
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 sm:py-4 shrink-0">
          <div>
            <h2 id="export-modal-title" className="text-base font-bold text-slate-900">
              Export Studio
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              <span className="tabular-nums">
                {resolvedSelected.length} of {totalPages}
              </span>{' '}
              {totalPages === 1 ? 'page' : 'pages'} selected · Est.{' '}
              <span className="font-mono-tabular text-slate-700">{estLabel}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close export modal"
            className="flex h-11 w-11 sm:h-8 sm:w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4 overflow-y-auto">
          {/* Format Switcher: PDF / Image / Word */}
          <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-slate-100 p-1">
            {(
              [
                { id: 'pdf', label: 'PDF', icon: FileText },
                { id: 'image', label: 'Image', icon: FileImage },
                { id: 'word', label: 'Word (.doc)', icon: FileSpreadsheet },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const active = format === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  data-testid={`export-format-${tab.id}`}
                  onClick={() => {
                    haptics.tap();
                    setFormat(tab.id);
                  }}
                  className={`flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    active
                      ? 'bg-white text-teal-800 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Page Picker */}
          {totalPages > 1 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-700">
                  Select Pages ({resolvedSelected.length}/{totalPages})
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    className={`rounded-md px-2 py-1 text-[11px] font-semibold cursor-pointer transition-colors ${
                      resolvedSelected.length === totalPages
                        ? 'bg-slate-900 text-white dark:bg-teal-600 dark:text-white'
                        : 'bg-white border border-slate-200 text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300'
                    }`}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={handleSelectCurrent}
                    className={`rounded-md px-2 py-1 text-[11px] font-semibold cursor-pointer transition-colors ${
                      resolvedSelected.length === 1 &&
                      resolvedSelected[0] === Math.min(activePageIndex, totalPages - 1)
                        ? 'bg-slate-900 text-white dark:bg-teal-600 dark:text-white'
                        : 'bg-white border border-slate-200 text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300'
                    }`}
                  >
                    Current (P{Math.min(activePageIndex, totalPages - 1) + 1})
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {document.pages.map((p, idx) => {
                  const isSelected = resolvedSelected.includes(idx);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      data-testid={`export-page-toggle-${idx}`}
                      onClick={() => togglePageSelection(idx)}
                      aria-pressed={isSelected}
                      className={`relative shrink-0 rounded-lg border-2 p-1 transition-all cursor-pointer ${
                        isSelected
                          ? 'border-teal-600 bg-white'
                          : 'border-slate-200 bg-slate-100 opacity-60 hover:opacity-100'
                      }`}
                    >
                      <img
                        src={p.thumbnailDataUrl || p.processedDataUrl}
                        alt={`Page ${idx + 1}`}
                        className="h-16 w-12 rounded object-cover"
                      />
                      <span className="mt-0.5 block text-[10px] font-mono-tabular font-semibold text-slate-700">
                        P{idx + 1}
                      </span>
                      {isSelected && (
                        <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-teal-600 text-white shadow-xs">
                          <Check className="h-2.5 w-2.5" aria-hidden="true" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Output Filename */}
          <div>
            <label htmlFor="export-filename" className="block text-xs font-medium text-slate-600 mb-1">
              Output Filename
            </label>
            <input
              id="export-filename"
              type="text"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-teal-600 focus:outline-none"
            />
          </div>

          {/* PDF-specific options */}
          {format === 'pdf' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="export-paper" className="block text-xs font-medium text-slate-600 mb-1">
                    Paper Size
                  </label>
                  <select
                    id="export-paper"
                    value={paperSize}
                    onChange={(e) => setPaperSize(e.target.value as PdfPaperSize)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-teal-600 focus:outline-none"
                  >
                    <option value="a4">A4 (210 × 297 mm)</option>
                    <option value="letter">US Letter (8.5 × 11 in)</option>
                    <option value="fit">Fit to Scan Aspect</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="export-orient" className="block text-xs font-medium text-slate-600 mb-1">
                    Orientation
                  </label>
                  <select
                    id="export-orient"
                    value={orientation}
                    onChange={(e) => setOrientation(e.target.value as PdfOrientation)}
                    disabled={paperSize === 'fit'}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 disabled:opacity-50 focus:border-teal-600 focus:outline-none"
                  >
                    <option value="auto">Auto per Page</option>
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="export-margin" className="block text-xs font-medium text-slate-600 mb-1">
                    Page Margins
                  </label>
                  <select
                    id="export-margin"
                    value={margin}
                    onChange={(e) => setMargin(e.target.value as PdfMargin)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-teal-600 focus:outline-none"
                  >
                    <option value="none">Borderless (0 mm)</option>
                    <option value="narrow">Narrow (8 mm)</option>
                    <option value="standard">Standard (16 mm)</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="export-quality" className="block text-xs font-medium text-slate-600 mb-1">
                    Compression Quality
                  </label>
                  <select
                    id="export-quality"
                    value={quality}
                    onChange={(e) => setQuality(e.target.value as PdfQuality)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-teal-600 focus:outline-none"
                  >
                    <option value="high">High Resolution (HD)</option>
                    <option value="balanced">Balanced</option>
                    <option value="compact">Compact Email Size</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="flex items-center justify-between rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-slate-700 cursor-pointer">
                  <span>Include Page Numbers Footer</span>
                  <input
                    type="checkbox"
                    checked={includePageNumbers}
                    onChange={(e) => setIncludePageNumbers(e.target.checked)}
                    className="h-4 w-4 accent-teal-600"
                  />
                </label>

                <label className="flex items-center justify-between rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-slate-700 cursor-pointer">
                  <span>Searchable OCR Text Layer</span>
                  <input
                    type="checkbox"
                    checked={searchablePdf}
                    onChange={(e) => setSearchablePdf(e.target.checked)}
                    className="h-4 w-4 accent-teal-600"
                  />
                </label>
              </div>
            </>
          )}

          {/* Image-specific options */}
          {format === 'image' && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="export-img-format" className="block text-xs font-medium text-slate-600 mb-1">
                    Image Format
                  </label>
                  <select
                    id="export-img-format"
                    value={imageFormat}
                    onChange={(e) => setImageFormat(e.target.value as 'png' | 'jpeg')}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-teal-600 focus:outline-none"
                  >
                    <option value="png">PNG (Sharp + Transparency)</option>
                    <option value="jpeg">JPEG (Compact Photo)</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="export-img-quality" className="block text-xs font-medium text-slate-600 mb-1">
                    Resolution / Quality
                  </label>
                  <select
                    id="export-img-quality"
                    value={quality}
                    onChange={(e) => setQuality(e.target.value as PdfQuality)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-teal-600 focus:outline-none"
                  >
                    <option value="high">High Resolution (HD)</option>
                    <option value="balanced">Balanced</option>
                    <option value="compact">Compact</option>
                  </select>
                </div>
              </div>

              {resolvedSelected.length > 1 && (
                <div>
                  <div className="mb-1 text-xs font-medium text-slate-600">Multi-Page Image Layout</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setImageLayout('stitched')}
                      className={`rounded-lg border px-3 py-2 text-xs font-semibold cursor-pointer ${
                        imageLayout === 'stitched'
                          ? 'border-teal-600 bg-teal-50 text-teal-900'
                          : 'border-slate-200 text-slate-700'
                      }`}
                    >
                      Single Long Image
                    </button>
                    <button
                      type="button"
                      onClick={() => setImageLayout('individual')}
                      className={`rounded-lg border px-3 py-2 text-xs font-semibold cursor-pointer ${
                        imageLayout === 'individual'
                          ? 'border-teal-600 bg-teal-50 text-teal-900'
                          : 'border-slate-200 text-slate-700'
                      }`}
                    >
                      Separate Files ({resolvedSelected.length})
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Word-specific options */}
          {format === 'word' && (
            <div className="flex flex-col gap-2.5">
              <label className="flex items-center justify-between rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-slate-700 cursor-pointer">
                <span>Include Scanned Page Images</span>
                <input
                  type="checkbox"
                  checked={wordIncludeImages}
                  onChange={(e) => setWordIncludeImages(e.target.checked)}
                  className="h-4 w-4 accent-teal-600"
                />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-slate-700 cursor-pointer">
                <span>Include Extracted OCR Text</span>
                <input
                  type="checkbox"
                  checked={wordIncludeOcrText}
                  onChange={(e) => setWordIncludeOcrText(e.target.checked)}
                  className="h-4 w-4 accent-teal-600"
                />
              </label>
              {wordInvalid && (
                <p className="text-xs font-medium text-red-600">
                  Select at least one content source (Page Images or OCR Text).
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3.5 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={exporting || wordInvalid}
            onClick={handleExport}
            data-testid="export-confirm-btn"
            className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-45 cursor-pointer"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            <span>{exporting ? progressText || 'Exporting...' : primaryCtaLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
