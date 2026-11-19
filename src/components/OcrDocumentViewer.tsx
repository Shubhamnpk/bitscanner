import React, { useMemo, useState } from 'react';
import {
  Check,
  Code2,
  Copy,
  FileDown,
  FileText,
  Layers,
  PencilLine,
  RefreshCw,
  ScanText,
  Search,
  Sparkles,
  Table2,
  X,
} from 'lucide-react';
import type { OcrLayoutMode } from '../utils/ocrEngine';
import {
  countOcrWords,
  extractStructuredOcrEntities,
  parseOcrDocumentLayout,
  searchOcrTextMatches,
  type OcrStructuredBlock,
} from '../utils/ocrEngine';
import { exportOcrTextFile } from '../utils/pdfExporter';

interface OcrDocumentViewerProps {
  docTitle: string;
  pageNumber: number;
  totalPages: number;
  ocrText: string;
  ocrConfidence?: number;
  ocrBlocks?: OcrStructuredBlock[];
  ocrLang: string;
  onChangeLang: (lang: string) => void;
  ocrLayoutMode: OcrLayoutMode;
  onChangeLayoutMode: (mode: OcrLayoutMode) => void;
  ocrRunning: boolean;
  ocrProgress: number;
  ocrStatus: string;
  ocrBatchStatus: string | null;
  ocrError: string | null;
  onRunOcr: () => void;
  onRunOcrAllPages?: () => void;
  onChangeOcrText: (nextText: string) => void;
  onOpenExport?: () => void;
  onClose: () => void;
}

type ReaderTab = 'layout' | 'plain' | 'fields';

function HighlightMatchText({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return (
    <>
      {parts.map((part, idx) =>
        part.toLowerCase() === q.toLowerCase() ? (
          <mark
            key={idx}
            className="rounded-xs bg-amber-200/90 px-0.5 font-semibold text-slate-950"
          >
            {part}
          </mark>
        ) : (
          <React.Fragment key={idx}>{part}</React.Fragment>
        )
      )}
    </>
  );
}

export const OcrDocumentViewer: React.FC<OcrDocumentViewerProps> = ({
  docTitle,
  pageNumber,
  totalPages,
  ocrText,
  ocrConfidence,
  ocrBlocks,
  ocrLang,
  onChangeLang,
  ocrLayoutMode,
  onChangeLayoutMode,
  ocrRunning,
  ocrProgress,
  ocrStatus,
  ocrBatchStatus,
  ocrError,
  onRunOcr,
  onRunOcrAllPages,
  onChangeOcrText,
  onOpenExport,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<ReaderTab>('layout');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedEntity, setCopiedEntity] = useState<string | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  const structuredBlocks = useMemo(
    () => parseOcrDocumentLayout(ocrText, ocrBlocks),
    [ocrText, ocrBlocks]
  );

  const wordCount = useMemo(() => countOcrWords(ocrText), [ocrText]);
  const searchMatches = useMemo(
    () => searchOcrTextMatches(ocrText, searchQuery),
    [ocrText, searchQuery]
  );
  const entities = useMemo(() => extractStructuredOcrEntities(ocrText), [ocrText]);

  const entityChips = useMemo(
    () => [
      ...entities.emails.map((value) => ({ kind: 'Email', value })),
      ...entities.phones.map((value) => ({ kind: 'Phone', value })),
      ...entities.amounts.map((value) => ({ kind: 'Amount', value })),
      ...entities.dates.map((value) => ({ kind: 'Date', value })),
      ...entities.urls.map((value) => ({ kind: 'Link', value })),
    ],
    [entities]
  );

  const hasTables = structuredBlocks.some((b) => b.kind === 'table');

  const handleCopyEntity = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedEntity(value);
      window.setTimeout(() => setCopiedEntity((cur) => (cur === value ? null : cur)), 1400);
    } catch {
      // Ignore clipboard failures
    }
  };

  return (
    <aside
      role="region"
      aria-label="OCR Document Reader"
      data-testid="ocr-fullscreen-view"
      className="absolute inset-0 z-20 lg:static lg:z-auto flex w-full lg:w-[440px] shrink-0 flex-col bg-surface-muted lg:bg-surface lg:border-l lg:border-line overflow-hidden"
    >
      {/* Compact Engine Controls + Search + Reader Tabs (No redundant header) */}
      <div className="shrink-0 border-b border-line bg-surface px-3.5 py-2.5 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <select
            value={ocrLang}
            onChange={(e) => onChangeLang(e.target.value)}
            aria-label="OCR Language"
            className="h-9 rounded-xl border border-line bg-surface-muted px-2.5 text-xs font-medium text-ink-strong focus:border-accent focus:bg-surface focus:outline-none"
          >
            <option value="eng">English</option>
            <option value="spa">Spanish</option>
            <option value="fra">French</option>
            <option value="deu">German</option>
          </select>

          <div className="flex flex-1 rounded-xl bg-surface-subtle dark:bg-slate-800/80 p-0.5">
            {(
              [
                { id: 'auto', label: 'Auto' },
                { id: 'block', label: 'Dense Doc' },
                { id: 'sparse', label: 'Receipt / ID' },
              ] as const
            ).map((mode) => (
              <button
                key={mode.id}
                type="button"
                data-testid={`ocr-layout-${mode.id}`}
                onClick={() => onChangeLayoutMode(mode.id)}
                className={`flex-1 rounded-lg py-1.5 text-[11px] font-semibold transition-colors cursor-pointer ${
                  ocrLayoutMode === mode.id
                    ? 'bg-surface text-accent-text shadow-xs dark:bg-accent dark:text-white'
                    : 'text-ink-muted hover:text-ink dark:text-ink-faint dark:hover:text-white'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close OCR view"
            data-testid="ocr-close-btn"
            className="hidden lg:inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-ink-muted hover:bg-surface-muted hover:text-ink-strong cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search words, amounts, or table cells..."
              data-testid="ocr-search-input"
              aria-label="Search extracted OCR text"
              className="h-9 w-full rounded-xl border border-line bg-surface-muted pl-8 pr-3 text-xs text-ink-strong focus:border-accent focus:bg-surface focus:outline-none"
            />
          </div>

          {totalPages > 1 && onRunOcrAllPages && (
            <button
              type="button"
              disabled={ocrRunning}
              onClick={onRunOcrAllPages}
              data-testid="ocr-extract-all-btn"
              className="inline-flex h-9 shrink-0 items-center gap-1 rounded-xl border border-accent-line bg-accent-soft px-2.5 text-[11px] font-semibold text-accent-text hover:bg-accent-soft disabled:opacity-50 cursor-pointer"
            >
              <Layers className="h-3.5 w-3.5" aria-hidden="true" />
              <span>All {totalPages}p</span>
            </button>
          )}
        </div>

        {/* View Mode Switcher */}
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-surface-subtle dark:bg-slate-800/80 p-1">
          <button
            type="button"
            data-testid="ocr-tab-layout"
            onClick={() => setActiveTab('layout')}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'layout'
                ? 'bg-surface text-accent-text shadow-xs dark:bg-accent dark:text-white'
                : 'text-ink-muted hover:text-ink dark:text-ink-faint dark:hover:text-white'
            }`}
          >
            {hasTables ? (
              <Table2 className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>Document</span>
          </button>
          <button
            type="button"
            data-testid="ocr-tab-plain"
            onClick={() => setActiveTab('plain')}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'plain'
                ? 'bg-surface text-accent-text shadow-xs dark:bg-accent dark:text-white'
                : 'text-ink-muted hover:text-ink dark:text-ink-faint dark:hover:text-white'
            }`}
          >
            <PencilLine className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Edit Text</span>
          </button>
          <button
            type="button"
            data-testid="ocr-tab-fields"
            onClick={() => setActiveTab('fields')}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'fields'
                ? 'bg-surface text-accent-text shadow-xs dark:bg-accent dark:text-white'
                : 'text-ink-muted hover:text-ink dark:text-ink-faint dark:hover:text-white'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Fields ({entityChips.length})</span>
          </button>
        </div>
      </div>

      {/* Scrollable Main Reader Body */}
      <div className="flex-1 overflow-y-auto p-3.5 sm:p-5 flex flex-col gap-3">
        {ocrRunning && (
          <div className="rounded-xl border border-accent-line bg-accent-soft/70 p-3">
            {ocrBatchStatus && (
              <div className="mb-0.5 text-xs font-semibold text-accent-text">{ocrBatchStatus}</div>
            )}
            <div className="mb-1.5 flex justify-between text-xs text-ink-soft">
              <span className="truncate font-medium">{ocrStatus}</span>
              <span className="font-mono-tabular font-bold text-accent-text">{ocrProgress}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface border border-accent-line/70">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${ocrProgress}%` }}
              />
            </div>
          </div>
        )}

        {ocrError && (
          <div className="rounded-xl border border-warning-line bg-warning-soft p-3 text-xs text-warning-text">
            {ocrError}
          </div>
        )}

        {searchQuery.trim() && (
          <div
            data-testid="ocr-search-results"
            className="rounded-xl border border-accent-line bg-accent-soft/50 px-3 py-2 text-xs text-ink-soft flex items-center justify-between"
          >
            <span className="font-semibold">
              {searchMatches.totalMatches}{' '}
              {searchMatches.totalMatches === 1 ? 'match' : 'matches'} on Page {pageNumber}
            </span>
            <span className="text-[11px] text-ink-muted">
              {searchMatches.matchingLines.length} lines
            </span>
          </div>
        )}

        {/* TAB 1: STRUCTURED DOCUMENT & TABLE VIEW */}
        {activeTab === 'layout' && (
          <div
            data-testid="ocr-structured-sheet"
            className="mx-auto w-full max-w-2xl rounded-2xl border border-line/90 bg-surface p-4 sm:p-6 shadow-sm flex flex-col gap-4"
          >
            {!ocrText.trim() ? (
              <div className="py-10 text-center flex flex-col items-center gap-3">
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-strong ${
                    ocrRunning ? 'animate-pulse' : ''
                  }`}
                >
                  <ScanText className="h-6 w-6" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-bold text-ink">
                    {ocrRunning ? 'Recognizing Page Layout...' : 'Ready to Digitize Page'}
                  </p>
                  <p className="mt-1 max-w-xs text-xs text-ink-muted">
                    {ocrRunning
                      ? 'Extracting headings, aligned tables, amounts, and paragraphs from your scan.'
                      : 'Tap Extract Text to recognize headings, tables, amounts, and paragraphs in their exact document layout.'}
                  </p>
                </div>
              </div>
            ) : (
              structuredBlocks.map((block, bIdx) => {
                if (block.kind === 'heading') {
                  return (
                    <h3
                      key={bIdx}
                      className={`text-base sm:text-lg font-extrabold tracking-tight text-ink border-b border-line-soft pb-2 ${
                        block.align === 'center' ? 'text-center' : 'text-left'
                      }`}
                    >
                      <HighlightMatchText text={block.text} query={searchQuery} />
                    </h3>
                  );
                }

                if (block.kind === 'key_value') {
                  return (
                    <div
                      key={bIdx}
                      className="rounded-xl border border-line/80 bg-surface-muted/60 divide-y divide-slate-200/70"
                    >
                      {block.pairs.map((pair, pIdx) => (
                        <div
                          key={pIdx}
                          className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-xs sm:text-sm"
                        >
                          <span className="font-semibold text-ink-muted">
                            <HighlightMatchText text={pair.key} query={searchQuery} />
                          </span>
                          <span className="font-medium text-ink font-mono-tabular">
                            <HighlightMatchText text={pair.value} query={searchQuery} />
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                }

                if (block.kind === 'table') {
                  return (
                    <div
                      key={bIdx}
                      data-testid="ocr-detected-table"
                      className="overflow-x-auto rounded-xl border border-line bg-surface"
                    >
                      <table className="w-full border-collapse text-xs sm:text-[13px]">
                        {block.headers && block.headers.length > 0 && (
                          <thead className="bg-surface-subtle/90 border-b border-line">
                            <tr>
                              {block.headers.map((h, hIdx) => (
                                <th
                                  key={hIdx}
                                  className={`px-3 py-2 font-bold text-ink-strong whitespace-nowrap ${
                                    block.alignments?.[hIdx] === 'right'
                                      ? 'text-right'
                                      : 'text-left'
                                  }`}
                                >
                                  <HighlightMatchText text={h} query={searchQuery} />
                                </th>
                              ))}
                            </tr>
                          </thead>
                        )}
                        <tbody className="divide-y divide-line-soft">
                          {block.rows.map((row, rIdx) => (
                            <tr
                              key={rIdx}
                              className={rIdx % 2 === 1 ? 'bg-surface-muted/40' : 'bg-surface'}
                            >
                              {row.map((cell, cIdx) => (
                                <td
                                  key={cIdx}
                                  className={`px-3 py-2 text-ink-strong ${
                                    block.alignments?.[cIdx] === 'right'
                                      ? 'text-right font-mono-tabular font-semibold text-ink whitespace-nowrap'
                                      : 'text-left'
                                  }`}
                                >
                                  <HighlightMatchText text={cell} query={searchQuery} />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                }

                if (block.kind === 'list') {
                  return (
                    <ul
                      key={bIdx}
                      className="list-disc pl-5 flex flex-col gap-1.5 text-xs sm:text-sm text-ink-strong leading-relaxed"
                    >
                      {block.items.map((item, itIdx) => (
                        <li key={itIdx}>
                          <HighlightMatchText text={item} query={searchQuery} />
                        </li>
                      ))}
                    </ul>
                  );
                }

                return (
                  <p
                    key={bIdx}
                    className="text-xs sm:text-sm leading-relaxed text-ink-strong whitespace-pre-line"
                  >
                    <HighlightMatchText text={block.text} query={searchQuery} />
                  </p>
                );
              })
            )}
          </div>
        )}

        {/* TAB 2: EDITABLE PLAIN TEXT */}
        {activeTab === 'plain' && (
          <div className="mx-auto w-full max-w-2xl flex-1 flex flex-col gap-2">
            <textarea
              data-testid="ocr-plain-textarea"
              value={ocrText}
              onChange={(e) => onChangeOcrText(e.target.value)}
              placeholder="Extracted text appears here and updates Document View automatically as you edit..."
              className="flex-1 min-h-[320px] w-full rounded-2xl border border-line bg-surface p-4 text-xs sm:text-sm leading-relaxed text-ink-strong focus:border-accent focus:outline-none shadow-xs"
            />
          </div>
        )}

        {/* TAB 3: DETECTED SMART FIELDS */}
        {activeTab === 'fields' && (
          <div
            data-testid="ocr-detected-entities"
            className="mx-auto w-full max-w-2xl rounded-2xl border border-line bg-surface p-4 shadow-xs"
          >
            {entityChips.length === 0 ? (
              <p className="py-6 text-center text-xs text-ink-muted">
                No dates, monetary totals, phone numbers, emails, or URLs detected on this page yet.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold text-ink-muted mb-1">
                  Tap any recognized field to copy it to your clipboard
                </p>
                {entityChips.map((item) => {
                  const isCopied = copiedEntity === item.value;
                  return (
                    <button
                      key={`${item.kind}-${item.value}`}
                      type="button"
                      onClick={() => handleCopyEntity(item.value)}
                      className="flex min-h-[44px] items-center justify-between gap-3 rounded-xl border border-line bg-surface-muted/70 px-3.5 py-2 text-left text-xs hover:border-teal-500 hover:bg-accent-soft/40 transition cursor-pointer"
                    >
                      <div className="min-w-0">
                        <span className="block text-[10px] font-bold uppercase tracking-wider text-accent-strong">
                          {item.kind}
                        </span>
                        <span className="block truncate text-sm font-medium text-ink">
                          {item.value}
                        </span>
                      </div>
                      <span className="shrink-0 text-ink-faint">
                        {isCopied ? (
                          <Check className="h-4 w-4 text-accent" aria-hidden="true" />
                        ) : (
                          <Copy className="h-4 w-4" aria-hidden="true" />
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* OCR Export Format Sheet (Triggered from Export in Bottom Bar) */}
      {exportMenuOpen && (
        <div
          data-testid="ocr-export-format-sheet"
          className="shrink-0 border-t border-line bg-surface-muted/95 px-3.5 py-3 animate-sheet-up"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-bold text-ink">Export Extracted OCR</span>
            <button
              type="button"
              onClick={() => setExportMenuOpen(false)}
              aria-label="Close OCR export formats"
              className="rounded-lg p-1 text-ink-faint hover:bg-slate-200/70 hover:text-ink-soft cursor-pointer"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button
              type="button"
              disabled={!ocrText.trim()}
              data-testid="ocr-export-doc-btn"
              onClick={() => {
                exportOcrTextFile(`${docTitle}_p${pageNumber}`, ocrText, 'doc', structuredBlocks);
                setExportMenuOpen(false);
              }}
              className="flex min-h-[44px] items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2 text-left hover:border-teal-500 hover:bg-accent-soft/40 disabled:opacity-40 cursor-pointer"
            >
              <FileText className="h-4 w-4 text-accent-strong shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <span className="block text-xs font-bold text-ink">Word (.doc)</span>
                <span className="block text-[10px] text-ink-muted truncate">Tables &amp; layout</span>
              </div>
            </button>

            <button
              type="button"
              disabled={!ocrText.trim()}
              data-testid="ocr-export-txt-btn"
              onClick={() => {
                exportOcrTextFile(`${docTitle}_p${pageNumber}`, ocrText, 'txt', structuredBlocks);
                setExportMenuOpen(false);
              }}
              className="flex min-h-[44px] items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2 text-left hover:border-teal-500 hover:bg-accent-soft/40 disabled:opacity-40 cursor-pointer"
            >
              <FileDown className="h-4 w-4 text-ink-muted shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <span className="block text-xs font-bold text-ink">Plain Text (.txt)</span>
                <span className="block text-[10px] text-ink-muted truncate">Raw extracted text</span>
              </div>
            </button>

            <button
              type="button"
              disabled={!ocrText.trim()}
              data-testid="ocr-export-md-btn"
              onClick={() => {
                exportOcrTextFile(`${docTitle}_p${pageNumber}`, ocrText, 'md', structuredBlocks);
                setExportMenuOpen(false);
              }}
              className="flex min-h-[44px] items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2 text-left hover:border-teal-500 hover:bg-accent-soft/40 disabled:opacity-40 cursor-pointer"
            >
              <Code2 className="h-4 w-4 text-ink-muted shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <span className="block text-xs font-bold text-ink">Markdown (.md)</span>
                <span className="block text-[10px] text-ink-muted truncate">Formatted tables</span>
              </div>
            </button>
          </div>
          {onOpenExport && (
            <button
              type="button"
              data-testid="ocr-export-full-btn"
              onClick={() => {
                setExportMenuOpen(false);
                onOpenExport();
              }}
              className="mt-2 flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-xl border border-accent-line bg-accent-soft px-3 text-xs font-semibold text-accent-text hover:bg-accent-soft cursor-pointer"
            >
              <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Export Full Scan (PDF / Image / Word)</span>
            </button>
          )}
        </div>
      )}

      {/* Unified Bottom Action Bar: Re-Scan | Copy | Export */}
      <div className="shrink-0 border-t border-line bg-surface px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={ocrRunning}
            onClick={onRunOcr}
            data-testid="ocr-extract-btn"
            className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-line bg-surface px-2.5 text-xs font-semibold text-ink-strong hover:bg-surface-muted disabled:opacity-50 active:scale-[0.98] transition cursor-pointer whitespace-nowrap"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 text-accent-strong shrink-0 ${ocrRunning ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>{ocrRunning ? `${ocrProgress}%` : ocrText ? 'Re-Scan' : 'Extract'}</span>
          </button>

          <button
            type="button"
            disabled={!ocrText}
            onClick={async () => {
              await navigator.clipboard.writeText(ocrText);
              setCopiedAll(true);
              window.setTimeout(() => setCopiedAll(false), 1500);
            }}
            className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-line bg-surface px-2.5 text-xs font-semibold text-ink-strong hover:bg-surface-muted disabled:opacity-40 cursor-pointer whitespace-nowrap"
          >
            {copiedAll ? (
              <>
                <Check className="h-3.5 w-3.5 text-accent shrink-0" aria-hidden="true" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5 text-ink-muted shrink-0" aria-hidden="true" />
                <span>Copy</span>
              </>
            )}
          </button>

          <button
            type="button"
            data-testid="ocr-open-export-btn"
            onClick={() => setExportMenuOpen((v) => !v)}
            aria-expanded={exportMenuOpen}
            className="inline-flex min-h-[42px] flex-[1.2] items-center justify-center gap-1.5 rounded-xl bg-accent px-3 text-xs font-bold text-white hover:bg-accent-strong active:scale-[0.98] transition cursor-pointer whitespace-nowrap"
          >
            <FileDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              Export
              {wordCount > 0 && typeof ocrConfidence === 'number' && !ocrRunning
                ? ` · ${ocrConfidence}%`
                : ''}
            </span>
          </button>
        </div>
      </div>
    </aside>
  );
};
