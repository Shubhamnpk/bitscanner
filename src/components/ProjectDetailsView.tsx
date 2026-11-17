import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  Check,
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
  Share2,
  SlidersHorizontal,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import type { ScanDocument, ScannedPage } from '../types/scanner';
import { useHaptics } from '../hooks/useHaptics';
import {
  getSelectedPageIndices,
  removeSelectedPages,
  reorderPageInList,
  togglePageSelection,
} from '../utils/projectHelpers';
import { searchOcrTextMatches } from '../utils/ocrHelpers';
import { runFreeOcr } from '../utils/ocrEngine';
import { PROJECT_FOLDER_OPTIONS, ProjectEditModal } from './ProjectEditModal';

interface ProjectDetailsViewProps {
  document: ScanDocument;
  onUpdateDocument: (doc: ScanDocument) => void;
  onOpenPage: (pageIndex: number, mode: 'view' | 'edit') => void;
  onAddPagesWithCamera: () => void;
  onImportFilesToProject: (files: FileList) => void;
  onShareProject?: () => void;
  onOpenExport: (pageIndices?: number[]) => void;
  onToggleStar: () => void;
  onDeleteProject: () => void;
  onBackToLibrary: () => void;
}

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
  onShareProject,
  onOpenExport,
  onToggleStar,
  onDeleteProject,
  onBackToLibrary,
}) => {
  const haptics = useHaptics();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(document.title);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [projectEditOpen, setProjectEditOpen] = useState(false);

  const [ocrDrawerOpen, setOcrDrawerOpen] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrSearchQuery, setOcrSearchQuery] = useState('');
  const [copiedOcr, setCopiedOcr] = useState(false);

  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Long-press / long-hover selection timers
  const pressTimerRef = useRef<number | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const pressStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressNextClickRef = useRef(false);

  const isSelecting = selectedIds.length > 0;

  useEffect(() => {
    setTitleDraft(document.title);
  }, [document.id, document.title]);

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => document.pages.some((p) => p.id === id)));
  }, [document.pages]);

  useEffect(() => {
    return () => {
      if (pressTimerRef.current) window.clearTimeout(pressTimerRef.current);
      if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
    };
  }, []);

  const clearSelectionTimers = () => {
    if (pressTimerRef.current) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    pressStartRef.current = null;
  };

  const triggerLongSelect = (pageId: string) => {
    clearSelectionTimers();
    suppressNextClickRef.current = true;
    haptics.tap();
    setSelectedIds((prev) => (prev.includes(pageId) ? prev : [...prev, pageId]));
    window.setTimeout(() => {
      suppressNextClickRef.current = false;
    }, 350);
  };

  const commitTitle = () => {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== document.title) {
      onUpdateDocument({ ...document, title: trimmed, updatedAt: Date.now() });
    } else {
      setTitleDraft(document.title);
    }
    setEditingTitle(false);
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

      {/* Sticky Project Top Bar — Back, Editable Title, Favorite Star, Project Edit & Icon-Only Export */}
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
                  {PROJECT_FOLDER_OPTIONS.find((f) => f.id === document.folder)?.label ?? 'Documents'}
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

          {/* Right: Star Favorite, Project Options, Icon-Only Download Export */}
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => {
                haptics.tap();
                onToggleStar();
              }}
              data-testid="project-star-btn"
              aria-label={document.starred ? 'Remove project star' : 'Star project'}
              aria-pressed={document.starred}
              className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border transition-colors cursor-pointer ${
                document.starred
                  ? 'border-amber-200 bg-amber-50 text-amber-500'
                  : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-amber-500'
              }`}
            >
              <Star
                className={`h-4.5 w-4.5 ${document.starred ? 'fill-amber-400 text-amber-500' : ''}`}
                aria-hidden="true"
              />
            </button>

            <button
              type="button"
              onClick={() => {
                haptics.tap();
                setProjectEditOpen(true);
              }}
              data-testid="project-edit-btn"
              aria-label="Edit project options"
              title="Project options"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>

            {onShareProject && (
              <button
                type="button"
                onClick={() => {
                  haptics.tap();
                  onShareProject();
                }}
                data-testid="project-share-btn"
                aria-label="Share project via QR or device"
                title="Share"
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <Share2 className="h-4 w-4" aria-hidden="true" />
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                haptics.tap();
                onOpenExport();
              }}
              data-testid="project-export-btn"
              aria-label="Export project"
              title="Export"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-teal-600 text-white hover:bg-teal-700 active:scale-[0.98] transition-colors cursor-pointer shrink-0"
            >
              <Download className="h-4.5 w-4.5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Contextual Selection Bar — Appears automatically on Long-Hover or Long-Press */}
        {isSelecting && (
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
                  onClick={handleExportSelected}
                  aria-label="Export selected pages"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600 text-white hover:bg-teal-500 cursor-pointer"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={handleDeleteSelected}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-red-600/90 px-3 text-xs font-semibold text-white hover:bg-red-500 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    {selectedIds.length >= document.pages.length ? 'Delete Project' : 'Delete'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedIds([])}
                  aria-label="Exit selection"
                  className="inline-flex h-8 items-center rounded-lg border border-white/20 px-2.5 text-xs font-semibold text-white/90 hover:bg-white/10 cursor-pointer"
                >
                  Done
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
                draggable={!isSelecting && document.pages.length > 1}
                onMouseEnter={() => {
                  if (isSelecting || draggedIdx !== null) return;
                  if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
                  hoverTimerRef.current = window.setTimeout(() => {
                    triggerLongSelect(page.id);
                  }, 680);
                }}
                onMouseLeave={() => {
                  if (hoverTimerRef.current) {
                    window.clearTimeout(hoverTimerRef.current);
                    hoverTimerRef.current = null;
                  }
                }}
                onPointerDown={(e) => {
                  if (isSelecting) return;
                  pressStartRef.current = { x: e.clientX, y: e.clientY };
                  if (pressTimerRef.current) window.clearTimeout(pressTimerRef.current);
                  pressTimerRef.current = window.setTimeout(() => {
                    triggerLongSelect(page.id);
                  }, 440);
                }}
                onPointerMove={(e) => {
                  if (!pressStartRef.current || !pressTimerRef.current) return;
                  const dist = Math.hypot(
                    e.clientX - pressStartRef.current.x,
                    e.clientY - pressStartRef.current.y
                  );
                  if (dist > 8) {
                    window.clearTimeout(pressTimerRef.current);
                    pressTimerRef.current = null;
                  }
                }}
                onPointerUp={() => {
                  if (pressTimerRef.current) {
                    window.clearTimeout(pressTimerRef.current);
                    pressTimerRef.current = null;
                  }
                }}
                onPointerCancel={() => {
                  if (pressTimerRef.current) {
                    window.clearTimeout(pressTimerRef.current);
                    pressTimerRef.current = null;
                  }
                }}
                onDragStart={(e) => {
                  clearSelectionTimers();
                  if (isSelecting || document.pages.length <= 1) return;
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
                      ? 'border-teal-600 ring-2 ring-teal-500/30'
                      : 'border-slate-200/90 hover:border-teal-500/50'
                } ${isDragging ? 'opacity-50' : ''}`}
              >
                {/* Framed Document Sheet Preview */}
                <div className="relative aspect-[3/4] w-full bg-slate-100/90 p-2 sm:p-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (suppressNextClickRef.current) return;
                      clearSelectionTimers();
                      haptics.tap();
                      if (isSelecting) {
                        setSelectedIds((prev) => togglePageSelection(prev, page.id));
                      } else {
                        onOpenPage(idx, 'view');
                      }
                    }}
                    aria-label={
                      isSelecting
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
                        draggable={false}
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

                  {/* Top-Right Selection Badge when selecting */}
                  {isSelecting && (
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none absolute right-3.5 top-3.5 flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors ${
                        isSelected
                          ? 'border-teal-600 bg-teal-600 text-white'
                          : 'border-slate-400 bg-white/95 text-transparent'
                      }`}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  )}
                </div>

                {/* Minimal Card Footer: Drag Grip + Page Number + Page Edit / Delete */}
                <div className="flex items-center justify-between gap-1 border-t border-slate-100 px-2.5 py-1.5">
                  <div className="flex items-center gap-1 min-w-0">
                    {!isSelecting && document.pages.length > 1 && (
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

                  {!isSelecting && (
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          clearSelectionTimers();
                          haptics.tap();
                          onOpenPage(idx, 'edit');
                        }}
                        aria-label={`Edit page ${idx + 1}`}
                        data-testid={`project-page-edit-${idx}`}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-teal-50 hover:text-teal-700 cursor-pointer"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>

                      {document.pages.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleDeleteSinglePage(page.id)}
                          aria-label={`Delete page ${idx + 1}`}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 cursor-pointer"
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

          {/* Add Page Tile */}
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
                <div className="mt-0.5 text-xs text-slate-500">Tap to scan</div>
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

      {/* Compact Bottom Action Dock: OCR, Project Options, Import Photo, Scan Page */}
      {!isSelecting && (
        <div
          data-testid="project-bottom-bar"
          className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur-md pb-safe"
        >
          <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-2 px-3 sm:px-6">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={() => {
                  haptics.tap();
                  setOcrDrawerOpen(true);
                }}
                data-testid="project-ocr-btn"
                aria-pressed={ocrDrawerOpen}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50 active:scale-[0.98] cursor-pointer"
              >
                <ScanText className="h-4 w-4 text-teal-700" aria-hidden="true" />
                <span>OCR</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  haptics.tap();
                  fileInputRef.current?.click();
                }}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 active:scale-[0.98] cursor-pointer"
              >
                <ImagePlus className="h-4 w-4 text-slate-600" aria-hidden="true" />
                <span className="hidden sm:inline">Import Photo</span>
                <span className="sm:hidden">Import</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  haptics.tap();
                  setProjectEditOpen(true);
                }}
                className="hidden sm:inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <SlidersHorizontal className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
                <span>Project Options</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                haptics.shutter();
                onAddPagesWithCamera();
              }}
              data-testid="project-fab-scan"
              aria-label="Scan new page"
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-teal-600 px-4 text-xs font-bold text-white hover:bg-teal-700 active:scale-[0.98] transition-all cursor-pointer shrink-0"
            >
              <Camera className="h-4 w-4" aria-hidden="true" />
              <span>Scan Page</span>
            </button>
          </div>
        </div>
      )}

      {/* Project Edit Modal */}
      <ProjectEditModal
        document={projectEditOpen ? document : null}
        onClose={() => setProjectEditOpen(false)}
        onSaveChanges={onUpdateDocument}
        onDeleteProject={() => onDeleteProject()}
      />

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
