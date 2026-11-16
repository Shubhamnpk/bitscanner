import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileText,
  GripVertical,
  ImagePlus,
  Loader2,
  Pencil,
  Plus,
  ScanText,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import type { FolderId, ScanDocument, ScannedPage } from '../types/scanner';
import { useHaptics } from '../hooks/useHaptics';
import {
  getSelectedPageIndices,
  removeSelectedPages,
  reorderPageInList,
  togglePageSelection,
} from '../utils/projectHelpers';
import { searchOcrTextMatches } from '../utils/ocrHelpers';
import { runFreeOcr } from '../utils/ocrEngine';

interface ProjectDetailsViewProps {
  document: ScanDocument;
  onUpdateDocument: (doc: ScanDocument) => void;
  onOpenPage: (pageIndex: number, mode: 'view' | 'edit') => void;
  onAddPagesWithCamera: () => void;
  onImportFilesToProject: (files: FileList) => void;
  onOpenExport: (pageIndices?: number[]) => void;
  onToggleStar: () => void;
  onDeleteProject: () => void;
  onBackToLibrary: () => void;
}

const FOLDER_OPTIONS: Array<{ id: Exclude<FolderId, 'all' | 'starred'>; label: string }> = [
  { id: 'documents', label: 'Documents' },
  { id: 'id_cards', label: 'ID Cards' },
  { id: 'receipts', label: 'Receipts' },
  { id: 'notes', label: 'Notes' },
  { id: 'signatures', label: 'Signatures' },
];

function formatRelativeDate(ts: number): string {
  const diffMin = Math.floor((Date.now() - ts) / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return 'Yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(ts).toLocaleDateString();
}

export const ProjectDetailsView: React.FC<ProjectDetailsViewProps> = ({
  document,
  onUpdateDocument,
  onOpenPage,
  onAddPagesWithCamera,
  onImportFilesToProject,
  onOpenExport,
  onToggleStar,
  onDeleteProject,
  onBackToLibrary,
}) => {
  const haptics = useHaptics();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(document.title);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [ocrDrawerOpen, setOcrDrawerOpen] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrSearchQuery, setOcrSearchQuery] = useState('');
  const [copiedOcr, setCopiedOcr] = useState(false);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  useEffect(() => {
    setTitleDraft(document.title);
  }, [document.id, document.title]);

  useEffect(() => {
    // Prune stale selected IDs if pages were deleted/changed
    setSelectedIds((prev) => prev.filter((id) => document.pages.some((p) => p.id === id)));
  }, [document.pages]);

  const commitTitle = () => {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== document.title) {
      onUpdateDocument({ ...document, title: trimmed, updatedAt: Date.now() });
    } else {
      setTitleDraft(document.title);
    }
    setEditingTitle(false);
  };

  const handleMovePage = (idx: number, delta: -1 | 1) => {
    const target = idx + delta;
    if (target < 0 || target >= document.pages.length) return;
    haptics.tap();
    const nextPages = reorderPageInList(document.pages, idx, target);
    onUpdateDocument({ ...document, pages: nextPages, updatedAt: Date.now() });
  };

  const handleDropPage = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return;
    haptics.tap();
    const nextPages = reorderPageInList(document.pages, fromIdx, toIdx);
    onUpdateDocument({ ...document, pages: nextPages, updatedAt: Date.now() });
  };

  const handleDeleteSinglePage = (pageId: string) => {
    if (document.pages.length <= 1) return;
    haptics.warning();
    const nextPages = removeSelectedPages(document.pages, [pageId], false);
    onUpdateDocument({ ...document, pages: nextPages, updatedAt: Date.now() });
  };

  const handleDeleteSelected = () => {
    if (selectedIds.length === 0) return;
    haptics.warning();
    if (selectedIds.length >= document.pages.length) {
      onDeleteProject();
      return;
    }
    const nextPages = removeSelectedPages(document.pages, selectedIds, false);
    onUpdateDocument({ ...document, pages: nextPages, updatedAt: Date.now() });
    setSelectedIds([]);
    setSelectMode(false);
  };

  const handleExportSelected = () => {
    haptics.tap();
    const indices = getSelectedPageIndices(document.pages, selectedIds);
    onOpenExport(indices);
  };

  const combinedOcrText = useMemo(() => {
    return document.pages
      .map((p, i) => {
        const t = p.ocrText.trim();
        if (!t) return '';
        return document.pages.length > 1 ? `--- Page ${i + 1} ---\n${t}` : t;
      })
      .filter(Boolean)
      .join('\n\n');
  }, [document.pages]);

  const ocrSearchMatches = useMemo(
    () => searchOcrTextMatches(combinedOcrText, ocrSearchQuery),
    [combinedOcrText, ocrSearchQuery]
  );

  const handleRunProjectOcr = async () => {
    if (ocrRunning || document.pages.length === 0) return;
    haptics.tap();
    setOcrRunning(true);
    setOcrProgress(0);
    try {
      const updatedPages: ScannedPage[] = [...document.pages];
      for (let i = 0; i < updatedPages.length; i++) {
        const page = updatedPages[i];
        const res = await runFreeOcr(
          page.processedDataUrl,
          'eng',
          (pct) => {
            const overall = Math.round(((i + pct / 100) / updatedPages.length) * 100);
            setOcrProgress(overall);
          },
          'auto'
        );
        updatedPages[i] = {
          ...page,
          ocrText: res.text,
          ocrConfidence: res.confidence,
        };
      }
      onUpdateDocument({ ...document, pages: updatedPages, updatedAt: Date.now() });
      haptics.success();
    } finally {
      setOcrRunning(false);
      setOcrProgress(0);
    }
  };

  const handleCopyAllOcr = async () => {
    if (!combinedOcrText) return;
    haptics.tap();
    await navigator.clipboard?.writeText(combinedOcrText).catch(() => {});
    setCopiedOcr(true);
    window.setTimeout(() => setCopiedOcr(false), 1600);
  };

  const handleDownloadOcrTxt = () => {
    if (!combinedOcrText) return;
    haptics.tap();
    const blob = new Blob([combinedOcrText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = `${document.title.replace(/[^\w\s-]/g, '_') || 'scan'}_ocr.txt`;
    window.document.body.appendChild(a);
    a.click();
    window.document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const allSelected = document.pages.length > 0 && selectedIds.length === document.pages.length;

  return (
    <div
      data-testid="project-details-view"
      className="flex min-h-[100dvh] flex-col bg-slate-50 text-slate-900"
    >
      {/* Hidden multi-file picker for adding image files directly into the project */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onImportFilesToProject(e.target.files);
          }
          e.target.value = '';
        }}
      />

      {/* Sticky Project Top Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-2 px-3 sm:px-6">
          {/* Left: Back to Library + Editable Project Title + Unboxed Metadata */}
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => {
                haptics.tap();
                onBackToLibrary();
              }}
              data-testid="project-back-library-btn"
              aria-label="Back to library"
              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 sm:px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 active:scale-[0.98] cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Library</span>
            </button>

            <div className="min-w-0 flex-1">
              {editingTitle ? (
                <input
                  type="text"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitTitle();
                    if (e.key === 'Escape') {
                      setTitleDraft(document.title);
                      setEditingTitle(false);
                    }
                  }}
                  autoFocus
                  aria-label="Project title"
                  data-testid="project-title-input"
                  className="w-full max-w-xs rounded-lg border border-teal-600 bg-white px-2.5 py-1 text-sm font-bold text-slate-900 focus:outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingTitle(true)}
                  title="Rename project"
                  data-testid="project-title-btn"
                  className="group flex max-w-full items-center gap-1.5 text-left cursor-pointer"
                >
                  <h1 className="truncate text-sm sm:text-base font-bold tracking-tight text-slate-900">
                    {document.title}
                  </h1>
                  <Pencil
                    className="h-3.5 w-3.5 shrink-0 text-slate-400 opacity-70 group-hover:text-teal-700 group-hover:opacity-100"
                    aria-hidden="true"
                  />
                </button>
              )}

              <div className="flex items-center gap-1.5 text-[11px] text-slate-500 truncate">
                <span className="truncate">
                  {FOLDER_OPTIONS.find((f) => f.id === document.folder)?.label ?? 'Documents'}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-tabular shrink-0">
                  {document.pages.length} {document.pages.length === 1 ? 'page' : 'pages'}
                </span>
                <span className="hidden sm:inline" aria-hidden="true">
                  ·
                </span>
                <span className="hidden sm:inline shrink-0">
                  {formatRelativeDate(document.updatedAt)}
                </span>
              </div>
            </div>
          </div>

          {/* Right: OCR, Select Mode, Export */}
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => {
                haptics.tap();
                setOcrDrawerOpen((v) => !v);
              }}
              data-testid="project-ocr-btn"
              aria-pressed={ocrDrawerOpen}
              className={`inline-flex h-10 items-center gap-1.5 rounded-xl border px-2.5 sm:px-3 text-xs font-semibold transition-colors cursor-pointer ${
                ocrDrawerOpen
                  ? 'border-teal-600 bg-teal-50 text-teal-800'
                  : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
              }`}
            >
              <ScanText className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
              <span className="hidden sm:inline">OCR</span>
            </button>

            <button
              type="button"
              onClick={() => {
                haptics.tap();
                setSelectMode((v) => {
                  if (v) setSelectedIds([]);
                  return !v;
                });
              }}
              data-testid="project-select-mode-btn"
              aria-pressed={selectMode}
              className={`inline-flex h-10 items-center gap-1.5 rounded-xl border px-2.5 sm:px-3 text-xs font-semibold transition-colors cursor-pointer ${
                selectMode
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
              }`}
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{selectMode ? 'Done' : 'Select'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                haptics.tap();
                onOpenExport();
              }}
              data-testid="project-export-btn"
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-teal-600 px-3 sm:px-4 text-xs font-semibold text-white hover:bg-teal-700 active:scale-[0.98] transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Export</span>
            </button>
          </div>
        </div>

        {/* Sub-Bar: Bulk Select Toolbar OR Clean Folder / Star Strip */}
        {selectMode ? (
          <div
            data-testid="project-bulk-bar"
            className="border-t border-slate-200 bg-slate-900 text-white"
          >
            <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-6">
              <div className="flex items-center gap-3 text-xs">
                <span className="font-semibold tabular-nums">
                  {selectedIds.length} of {document.pages.length} selected
                </span>
                <button
                  type="button"
                  onClick={() => {
                    haptics.tap();
                    setSelectedIds(allSelected ? [] : document.pages.map((p) => p.id));
                  }}
                  className="font-medium text-teal-300 hover:text-teal-200 cursor-pointer"
                >
                  {allSelected ? 'Clear all' : 'Select all'}
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={selectedIds.length === 0}
                  onClick={handleExportSelected}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-teal-600 px-3 text-xs font-semibold text-white hover:bg-teal-500 disabled:opacity-40 cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Export Selected</span>
                </button>
                <button
                  type="button"
                  disabled={selectedIds.length === 0}
                  onClick={handleDeleteSelected}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-red-600/90 px-3 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-40 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    {selectedIds.length >= document.pages.length ? 'Delete Project' : 'Delete'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="border-t border-slate-100 bg-slate-50/80">
            <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3 px-3 py-1.5 sm:px-6">
              <p className="text-xs text-slate-500">
                Tap any page to view full screen, surf pages, or run OCR
              </p>

              <div className="flex items-center gap-2 shrink-0">
                <select
                  aria-label="Project folder"
                  value={document.folder}
                  onChange={(e) => {
                    haptics.tap();
                    onUpdateDocument({
                      ...document,
                      folder: e.target.value as ScanDocument['folder'],
                      updatedAt: Date.now(),
                    });
                  }}
                  className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 focus:border-teal-600 focus:outline-none cursor-pointer"
                >
                  {FOLDER_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => {
                    haptics.tap();
                    onToggleStar();
                  }}
                  aria-label={document.starred ? 'Remove project star' : 'Star project'}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-amber-500 cursor-pointer"
                >
                  <Star
                    className={`h-4 w-4 ${document.starred ? 'fill-amber-400 text-amber-500' : ''}`}
                    aria-hidden="true"
                  />
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Main Page Grid Container */}
      <main className="mx-auto w-full max-w-[1440px] flex-1 px-3 py-4 pb-24 sm:p-6 lg:p-8 lg:pb-24">
        <div
          data-testid="project-pages-grid"
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4 xl:grid-cols-5"
        >
          {document.pages.map((page, idx) => {
            const isSelected = selectedIds.includes(page.id);
            const cover = page.thumbnailDataUrl || page.processedDataUrl;
            const fitContain =
              document.folder === 'signatures' || page.width > page.height * 1.15;
            const isDragging = draggedIdx === idx;
            const isDropTarget = dragOverIdx === idx && draggedIdx !== null && draggedIdx !== idx;

            return (
              <article
                key={page.id}
                data-testid="project-page-card"
                data-page-index={idx}
                draggable={!selectMode && document.pages.length > 1}
                onDragStart={(e) => {
                  if (selectMode || document.pages.length <= 1) return;
                  setDraggedIdx(idx);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', String(idx));
                }}
                onDragOver={(e) => {
                  if (draggedIdx === null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dragOverIdx !== idx) setDragOverIdx(idx);
                }}
                onDragLeave={() => {
                  if (dragOverIdx === idx) setDragOverIdx(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const parsed = Number(e.dataTransfer.getData('text/plain'));
                  const fromIdx = draggedIdx !== null ? draggedIdx : parsed;
                  setDraggedIdx(null);
                  setDragOverIdx(null);
                  if (Number.isFinite(fromIdx)) {
                    handleDropPage(fromIdx, idx);
                  }
                }}
                onDragEnd={() => {
                  setDraggedIdx(null);
                  setDragOverIdx(null);
                }}
                className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-white transition-all ${
                  isDropTarget
                    ? 'border-teal-600 ring-2 ring-teal-500/35 scale-[1.01]'
                    : isSelected
                      ? 'border-teal-600 ring-2 ring-teal-500/25'
                      : 'border-slate-200/90 hover:border-teal-500/50'
                } ${isDragging ? 'opacity-50' : ''}`}
              >
                {/* Framed Document Sheet Preview */}
                <div className="relative aspect-[3/4] w-full bg-slate-100/90 p-2 sm:p-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      haptics.tap();
                      if (selectMode) {
                        setSelectedIds((prev) => togglePageSelection(prev, page.id));
                      } else {
                        onOpenPage(idx, 'view');
                      }
                    }}
                    aria-label={
                      selectMode
                        ? `${isSelected ? 'Deselect' : 'Select'} page ${idx + 1}`
                        : `View page ${idx + 1}`
                    }
                    data-testid={`project-page-open-${idx}`}
                    className="block h-full w-full overflow-hidden rounded-xl bg-white ring-1 ring-slate-900/5 shadow-xs cursor-pointer focus-visible:outline-2 focus-visible:outline-teal-600"
                  >
                    {cover ? (
                      <img
                        src={cover}
                        alt={`Page ${idx + 1}`}
                        referrerPolicy="no-referrer"
                        className={
                          fitContain
                            ? 'h-full w-full object-contain p-1.5 transition-transform duration-200 group-hover:scale-[1.02]'
                            : 'h-full w-full object-cover object-top transition-transform duration-200 group-hover:scale-[1.02]'
                        }
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-slate-300">
                        <FileText className="h-9 w-9" aria-hidden="true" />
                      </div>
                    )}
                  </button>

                  {/* Top-Right Selection Indicator in Select Mode */}
                  {selectMode && (
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none absolute right-4 top-4 flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors ${
                        isSelected
                          ? 'border-teal-600 bg-teal-600 text-white'
                          : 'border-slate-400 bg-white/90 text-transparent'
                      }`}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  )}
                </div>

                {/* Card Footer: Drag Handle + Page Number + OCR Indicator + Quick Actions */}
                <div className="flex items-center justify-between gap-1 border-t border-slate-100 px-2.5 py-2">
                  <div className="flex items-center gap-1 min-w-0">
                    {!selectMode && document.pages.length > 1 && (
                      <GripVertical
                        className="h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-slate-500 cursor-grab"
                        aria-hidden="true"
                      />
                    )}
                    <span className="font-mono-tabular text-xs font-bold text-slate-700">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    {page.ocrText.trim().length > 0 && (
                      <span className="text-[11px] font-medium text-teal-700">· Text</span>
                    )}
                  </div>

                  {!selectMode && (
                    <div className="flex items-center gap-0.5">
                      {document.pages.length > 1 && (
                        <>
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => handleMovePage(idx, -1)}
                            aria-label={`Move page ${idx + 1} earlier`}
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 cursor-pointer"
                          >
                            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === document.pages.length - 1}
                            onClick={() => handleMovePage(idx, 1)}
                            aria-label={`Move page ${idx + 1} later`}
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 cursor-pointer"
                          >
                            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          haptics.tap();
                          onOpenPage(idx, 'edit');
                        }}
                        aria-label={`Edit page ${idx + 1}`}
                        data-testid={`project-page-edit-${idx}`}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-teal-50 hover:text-teal-700 cursor-pointer"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>

                      {document.pages.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleDeleteSinglePage(page.id)}
                          aria-label={`Delete page ${idx + 1}`}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}

          <div
            data-testid="project-add-page-tile"
            className="flex flex-col overflow-hidden rounded-2xl border-2 border-dashed border-slate-300 bg-white/80 transition-colors hover:border-teal-500 hover:bg-teal-50/25"
          >
            <button
              type="button"
              onClick={() => {
                haptics.tap();
                onAddPagesWithCamera();
              }}
              aria-label="Scan new page into project"
              className="flex flex-1 min-h-[160px] aspect-[3/4] w-full flex-col items-center justify-center gap-2.5 p-4 text-center cursor-pointer"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-50 text-teal-700 ring-1 ring-teal-200">
                <Plus className="h-6 w-6" aria-hidden="true" />
              </span>
              <div>
                <div className="text-sm font-bold text-slate-800">Add Page</div>
                <div className="mt-0.5 text-xs text-slate-500">Tap to scan with camera</div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                haptics.tap();
                fileInputRef.current?.click();
              }}
              data-testid="project-import-image-btn"
              className="flex w-full items-center justify-center gap-1.5 border-t border-slate-200/80 bg-slate-50/90 px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-teal-50 hover:text-teal-800 cursor-pointer"
            >
              <ImagePlus className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
              <span>Import Photo</span>
            </button>
          </div>
        </div>
      </main>

      {/* Bottom-Right Floating Camera Quick-Scan Action */}
      {!selectMode && (
        <button
          type="button"
          onClick={() => {
            haptics.tap();
            onAddPagesWithCamera();
          }}
          data-testid="project-fab-scan"
          aria-label="Scan new page"
          className="fixed bottom-6 right-5 sm:right-7 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-teal-600 text-white shadow-lg shadow-teal-950/20 hover:bg-teal-700 active:scale-95 transition-all cursor-pointer"
        >
          <Camera className="h-6 w-6" aria-hidden="true" />
        </button>
      )}

      {/* Project-Wide OCR Slide-Over Drawer */}
      {ocrDrawerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Project OCR text"
          data-testid="project-ocr-drawer"
          className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 backdrop-blur-xs"
          onClick={() => setOcrDrawerOpen(false)}
        >
          <div
            className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3.5">
              <div className="flex items-center gap-2">
                <ScanText className="h-4 w-4 text-teal-700" aria-hidden="true" />
                <h2 className="text-sm font-bold text-slate-900">Project OCR &amp; Search</h2>
              </div>
              <button
                type="button"
                onClick={() => setOcrDrawerOpen(false)}
                aria-label="Close OCR drawer"
                className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
              <button
                type="button"
                disabled={ocrRunning}
                onClick={handleRunProjectOcr}
                data-testid="project-run-ocr-all-btn"
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 text-xs font-bold text-white hover:bg-teal-700 disabled:opacity-60 cursor-pointer"
              >
                {ocrRunning ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    <span>Recognizing Text ({ocrProgress}%)...</span>
                  </>
                ) : (
                  <>
                    <ScanText className="h-4 w-4" aria-hidden="true" />
                    <span>
                      Extract Text ({document.pages.length}{' '}
                      {document.pages.length === 1 ? 'Page' : 'Pages'})
                    </span>
                  </>
                )}
              </button>

              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={ocrSearchQuery}
                  onChange={(e) => setOcrSearchQuery(e.target.value)}
                  placeholder="Search recognized text across project..."
                  aria-label="Search project OCR text"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:bg-white focus:outline-none"
                />
              </div>

              {ocrSearchQuery.trim() && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs">
                  <div className="font-semibold text-slate-700">
                    {ocrSearchMatches.totalMatches}{' '}
                    {ocrSearchMatches.totalMatches === 1 ? 'match' : 'matches'} found
                  </div>
                  {ocrSearchMatches.matchingLines.slice(0, 5).map((m) => (
                    <div key={`${m.lineNumber}-${m.text}`} className="mt-1 truncate text-slate-600">
                      <span className="font-mono-tabular text-teal-700">L{m.lineNumber}:</span>{' '}
                      {m.text}
                    </div>
                  ))}
                </div>
              )}

              <textarea
                readOnly
                value={combinedOcrText}
                placeholder="No OCR text extracted yet. Click 'Extract Text' above or open any page to run OCR."
                aria-label="Combined project OCR text"
                className="min-h-[260px] flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-800 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <button
                type="button"
                disabled={!combinedOcrText}
                onClick={handleCopyAllOcr}
                className="inline-flex flex-1 min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
              >
                {copiedOcr ? <Check className="h-3.5 w-3.5 text-teal-600" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copiedOcr ? 'Copied' : 'Copy All'}</span>
              </button>
              <button
                type="button"
                disabled={!combinedOcrText}
                onClick={handleDownloadOcrTxt}
                className="inline-flex flex-1 min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Download .TXT</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
