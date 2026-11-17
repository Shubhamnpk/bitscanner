import React, { useEffect, useState } from 'react';
import {
  Check,
  ChevronRight,
  CreditCard,
  Download,
  FileImage,
  FilePlus2,
  FileText,
  Film,
  FolderOpen,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  PenTool,
  Receipt,
  ScanLine,
  ScanText,
  Search,
  Sparkles,
  Star,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import type { FolderId, SavedSignature, ScanDocument } from '../types/scanner';
import { useHaptics } from '../hooks/useHaptics';
import { filterAndSortDocuments, type SortMode } from '../utils/cvGeometry';
import { TOOLS_CATALOG, type ToolId } from '../utils/settingsStore';

const HOME_TOOL_ICON_MAP: Record<ToolId, React.FC<{ className?: string }>> = {
  images_to_pdf: FileImage,
  pdf_to_images: Download,
  pp_size: Sparkles,
  id_card: CreditCard,
  merge_pdf: FilePlus2,
  ocr_extract: ScanText,
  sign_doc: PenTool,
  images_to_video: Film,
};

interface LibraryViewProps {
  documents: ScanDocument[];
  savedSignatures?: SavedSignature[];
  favoriteTools?: ToolId[];
  defaultViewMode?: 'grid' | 'list';
  initialFolder?: FolderId;
  onOpenDocument: (docId: string) => void;
  onExportDocument: (doc: ScanDocument) => void;
  onToggleStar: (docId: string) => void;
  onRenameDocument: (docId: string, nextTitle: string) => void;
  onEditProject?: (doc: ScanDocument) => void;
  onDeleteDocument: (docId: string) => void;
  onStartNewScan: () => void;
  onOpenIdStudio: () => void;
  onOpenToolsSpace?: (toolId?: ToolId) => void;
  onCreateSignature?: () => void;
  onOpenSignatureAsDoc?: (sig: SavedSignature) => void;
  onDeleteSignature?: (id: string) => void;
}

const FOLDERS: Array<{ id: FolderId; label: string; icon: React.FC<{ className?: string }> }> = [
  { id: 'all', label: 'All Docs', icon: FolderOpen },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'id_cards', label: 'ID Cards', icon: CreditCard },
  { id: 'receipts', label: 'Receipts', icon: Receipt },
  { id: 'notes', label: 'Notes', icon: StickyNote },
  { id: 'signatures', label: 'Signatures', icon: PenTool },
  { id: 'starred', label: 'Starred', icon: Star },
];

const FOLDER_LABEL: Record<ScanDocument['folder'], string> = {
  documents: 'Document',
  id_cards: 'ID Card',
  receipts: 'Receipt',
  notes: 'Notes',
  signatures: 'Signature',
};

function formatRelativeDate(ts: number): string {
  const diffMin = Math.round((Date.now() - ts) / 60_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const LibraryView: React.FC<LibraryViewProps> = ({
  documents,
  savedSignatures = [],
  favoriteTools = ['images_to_pdf', 'pdf_to_images', 'pp_size', 'id_card'],
  defaultViewMode = 'grid',
  initialFolder = 'all',
  onOpenDocument,
  onExportDocument,
  onToggleStar,
  onRenameDocument,
  onEditProject,
  onDeleteDocument,
  onStartNewScan,
  onOpenIdStudio,
  onOpenToolsSpace,
  onCreateSignature,
  onOpenSignatureAsDoc,
  onDeleteSignature,
}) => {
  const haptics = useHaptics();
  const [activeFolder, setActiveFolder] = useState<FolderId>(initialFolder);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortMode>('updated_desc');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(defaultViewMode);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [actionSheetDoc, setActionSheetDoc] = useState<ScanDocument | null>(null);
  const [sheetRenaming, setSheetRenaming] = useState(false);

  useEffect(() => {
    setViewMode(defaultViewMode);
  }, [defaultViewMode]);

  useEffect(() => {
    setActiveFolder(initialFolder);
  }, [initialFolder]);

  const homeToolItems = TOOLS_CATALOG.filter((t) => favoriteTools.includes(t.id));

  const visibleDocs = filterAndSortDocuments(documents, searchQuery, activeFolder, sortBy);
  const totalPages = documents.reduce((acc, d) => acc + d.pages.length, 0);

  const countForFolder = (id: FolderId) => {
    if (id === 'all') return documents.length;
    if (id === 'starred') return documents.filter((d) => d.starred).length;
    return documents.filter((d) => d.folder === id).length;
  };

  const commitRename = (docId: string) => {
    const trimmed = draftTitle.trim();
    if (trimmed) {
      onRenameDocument(docId, trimmed);
    }
    setEditingId(null);
    setSheetRenaming(false);
  };

  const openActionSheet = (doc: ScanDocument) => {
    setActionSheetDoc(doc);
    setDraftTitle(doc.title);
    setSheetRenaming(false);
  };

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col pb-24 md:pb-0 lg:flex-row">
      {/* Desktop Left Sidebar Folder Rail */}
      <aside className="hidden lg:block w-64 shrink-0 border-r border-slate-200 bg-white p-5">
        <div className="mb-3 px-2 text-xs font-semibold text-slate-500">Workspace Folders</div>
        <nav aria-label="Document Folders" className="flex flex-col gap-1">
          {FOLDERS.map((folder) => {
            const Icon = folder.icon;
            const active = activeFolder === folder.id;
            const count = countForFolder(folder.id);
            return (
              <button
                key={folder.id}
                type="button"
                onClick={() => setActiveFolder(folder.id)}
                className={`flex items-center justify-between gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-teal-50 text-teal-900'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon
                    className={`h-4 w-4 ${active ? 'text-teal-600' : 'text-slate-400'}`}
                    aria-hidden="true"
                  />
                  <span>{folder.label}</span>
                </span>
                <span className="text-xs font-mono-tabular text-slate-500">{count}</span>
              </button>
            );
          })}
        </nav>

        <div className="mt-6 border-t border-slate-200 pt-5">
          <div className="mb-2.5 px-2 text-xs font-semibold text-slate-500">Quick Workflows</div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={onStartNewScan}
              className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-sm font-medium text-slate-700 hover:border-teal-500/50 hover:bg-teal-50/40 transition-colors cursor-pointer"
            >
              <ScanLine className="h-4 w-4 text-teal-600 shrink-0" aria-hidden="true" />
              <span>Scan &amp; Auto-Crop</span>
            </button>
            <button
              type="button"
              onClick={onOpenIdStudio}
              className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-sm font-medium text-slate-700 hover:border-teal-500/50 hover:bg-teal-50/40 transition-colors cursor-pointer"
            >
              <CreditCard className="h-4 w-4 text-teal-600 shrink-0" aria-hidden="true" />
              <span>2-Sided ID Card PDF</span>
            </button>
            {onCreateSignature && (
              <button
                type="button"
                data-testid="library-create-signature-btn"
                onClick={onCreateSignature}
                className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-sm font-medium text-slate-700 hover:border-teal-500/50 hover:bg-teal-50/40 transition-colors cursor-pointer"
              >
                <PenTool className="h-4 w-4 text-teal-600 shrink-0" aria-hidden="true" />
                <span>Create E-Signature</span>
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Workspace Dashboard */}
      <main className="flex-1 min-w-0 px-3.5 py-4 sm:p-6 lg:p-8">
        {/* CamScanner-Style Home Favorite Tools Strip */}
        {onOpenToolsSpace && (
          <section
            data-testid="home-tools-section"
            aria-label="Quick Document Tools"
            className="mb-4 rounded-2xl border border-slate-200/80 bg-white p-3 sm:p-4"
          >
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Favorite Tools
                </h2>
              </div>
              <button
                type="button"
                data-testid="home-all-tools-btn"
                onClick={() => {
                  haptics.tap();
                  onOpenToolsSpace();
                }}
                className="inline-flex items-center gap-0.5 text-xs font-semibold text-teal-700 hover:underline cursor-pointer"
              >
                <span>All Tools</span>
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>

            {homeToolItems.length === 0 ? (
              <button
                type="button"
                onClick={() => {
                  haptics.tap();
                  onOpenToolsSpace();
                }}
                className="flex w-full items-center justify-between rounded-xl border border-dashed border-slate-300 px-3.5 py-2.5 text-xs font-medium text-slate-600 hover:border-teal-600 hover:text-teal-700 cursor-pointer"
              >
                <span>Star favorite tools in the Tools space to pin shortcuts here</span>
                <span className="font-semibold text-teal-700">Explore</span>
              </button>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
                {homeToolItems.slice(0, 8).map((tool) => {
                  const Icon = HOME_TOOL_ICON_MAP[tool.id];
                  return (
                    <button
                      key={tool.id}
                      type="button"
                      data-testid={`home-tool-shortcut-${tool.id}`}
                      onClick={() => {
                        haptics.tap();
                        onOpenToolsSpace(tool.id);
                      }}
                      className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-slate-100 bg-slate-50/70 px-1.5 py-2.5 text-center hover:border-teal-500/40 hover:bg-teal-50/40 active:scale-95 transition-all cursor-pointer"
                    >
                      <span
                        className={`flex h-9 w-9 items-center justify-center rounded-xl border ${tool.accentClass}`}
                      >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <span className="w-full truncate text-[11px] font-semibold text-slate-800">
                        {tool.shortLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Mobile/Tablet Horizontal Folder Tabs */}
        <div className="mb-4 flex items-center gap-1.5 overflow-x-auto pb-1 lg:hidden">
          {FOLDERS.map((folder) => {
            const active = activeFolder === folder.id;
            const count = countForFolder(folder.id);
            return (
              <button
                key={folder.id}
                type="button"
                onClick={() => {
                  haptics.tap();
                  setActiveFolder(folder.id);
                }}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 min-h-[40px] text-xs font-semibold transition-colors whitespace-nowrap shrink-0 active:scale-95 cursor-pointer ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-200 bg-white text-slate-600'
                }`}
              >
                <span>{folder.label}</span>
                <span className={`font-mono-tabular ${active ? 'text-slate-300' : 'text-slate-400'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Title + Search + Sort + View Mode Strip */}
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 text-balance">
              {FOLDERS.find((f) => f.id === activeFolder)?.label ?? 'All Docs'}
            </h1>
            <p className="mt-0.5 text-xs sm:text-sm text-slate-500">
              <span className="tabular-nums">{visibleDocs.length}</span>{' '}
              {visibleDocs.length === 1 ? 'document' : 'documents'}
              <span className="mx-1.5" aria-hidden="true">
                ·
              </span>
              <span className="tabular-nums">{totalPages}</span>{' '}
              {totalPages === 1 ? 'page' : 'pages'} total
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative basis-full sm:basis-auto sm:w-64">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search title or OCR text..."
                aria-label="Search documents"
                className="w-full min-h-[44px] sm:min-h-[40px] rounded-xl border border-slate-200 bg-white py-2 pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none"
              />
            </div>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortMode)}
              aria-label="Sort documents"
              className="flex-1 sm:flex-initial min-h-[44px] sm:min-h-[40px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-teal-600 focus:outline-none"
            >
              <option value="updated_desc">Recently Modified</option>
              <option value="title_asc">Title A–Z</option>
              <option value="pages_desc">Most Pages</option>
            </select>

            <div className="flex items-center rounded-xl border border-slate-200 bg-white p-0.5">
              <button
                type="button"
                aria-label="Grid view"
                aria-pressed={viewMode === 'grid'}
                onClick={() => {
                  haptics.tap();
                  setViewMode('grid');
                }}
                className={`flex h-9 w-9 items-center justify-center rounded-lg cursor-pointer transition-colors ${
                  viewMode === 'grid' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <LayoutGrid className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="List view"
                aria-pressed={viewMode === 'list'}
                onClick={() => {
                  haptics.tap();
                  setViewMode('list');
                }}
                className={`flex h-9 w-9 items-center justify-center rounded-lg cursor-pointer transition-colors ${
                  viewMode === 'list' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <List className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Create Signature Action Row */}
        {activeFolder === 'signatures' && onCreateSignature && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-teal-200 bg-teal-50/60 px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-teal-950">E-Signature Studio</div>
              <div className="text-xs text-teal-800/80">
                Draw or type signatures with custom backgrounds &amp; download as PNG or editable document.
              </div>
            </div>
            <button
              type="button"
              data-testid="signatures-folder-create-btn"
              onClick={() => {
                haptics.tap();
                onCreateSignature();
              }}
              className="shrink-0 inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-teal-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-teal-700 cursor-pointer"
            >
              <PenTool className="h-3.5 w-3.5" aria-hidden="true" />
              <span>New Signature</span>
            </button>
          </div>
        )}

        {/* Saved Signature Stamps (shown in Signatures folder if any saved overlay stamps exist) */}
        {activeFolder === 'signatures' && savedSignatures.length > 0 && (
          <div className="mb-5">
            <div className="mb-2 text-xs font-semibold text-slate-500">
              Reusable Signature Stamps ({savedSignatures.length})
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {savedSignatures.map((sig) => (
                <div
                  key={sig.id}
                  data-testid="saved-signature-stamp-card"
                  className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5"
                >
                  <img
                    src={sig.dataUrl}
                    alt={sig.label}
                    className="h-12 w-24 shrink-0 rounded-lg border border-slate-200 bg-slate-50 object-contain p-1"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-slate-900">{sig.label}</div>
                    <div className="mt-1 flex items-center gap-1.5">
                      <a
                        href={sig.dataUrl}
                        download={`${sig.label.replace(/[^a-zA-Z0-9_\-. ]/g, '_')}.png`}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <Download className="h-3 w-3" aria-hidden="true" />
                        <span>PNG</span>
                      </a>
                      {onOpenSignatureAsDoc && (
                        <button
                          type="button"
                          onClick={() => onOpenSignatureAsDoc(sig)}
                          className="rounded-md bg-teal-50 px-2 py-1 text-[11px] font-semibold text-teal-800 hover:bg-teal-100 cursor-pointer"
                        >
                          Edit Doc
                        </button>
                      )}
                      {onDeleteSignature && (
                        <button
                          type="button"
                          onClick={() => onDeleteSignature(sig.id)}
                          aria-label={`Delete signature ${sig.label}`}
                          className="ml-auto rounded p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {visibleDocs.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white py-14 px-6 text-center">
            <FileText className="h-10 w-10 text-slate-300 mb-3" aria-hidden="true" />
            <h2 className="text-base font-semibold text-slate-900">
              {searchQuery
                ? 'No matching scans found'
                : activeFolder === 'signatures'
                  ? 'No signature documents yet'
                  : 'This folder is empty'}
            </h2>
            <p className="mt-1 max-w-sm text-sm text-slate-500">
              {searchQuery
                ? 'Try clearing your search filter or scan a new document.'
                : activeFolder === 'signatures'
                  ? 'Create a drawn or typed signature, customize its background, and save it as a document or PNG.'
                  : 'Scan a document with your camera, upload an image, or create a 2-sided ID card sheet.'}
            </p>
            <div className="mt-5 flex items-center gap-3">
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Clear Search
                </button>
              ) : activeFolder === 'signatures' && onCreateSignature ? (
                <button
                  type="button"
                  onClick={onCreateSignature}
                  className="min-h-[44px] rounded-xl bg-teal-600 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-700 active:scale-[0.98] transition-transform cursor-pointer"
                >
                  Create Signature
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onStartNewScan}
                  className="min-h-[44px] rounded-xl bg-teal-600 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-700 active:scale-[0.98] transition-transform cursor-pointer"
                >
                  Scan First Document
                </button>
              )}
            </div>
          </div>
        ) : viewMode === 'grid' ? (
          /* CamScanner-Inspired Clean Responsive Card Grid */
          <div
            data-testid="document-grid"
            className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(204px,1fr))] gap-3 sm:gap-5"
          >
            {visibleDocs.map((doc) => {
              const firstPage = doc.pages[0];
              const cover = firstPage?.thumbnailDataUrl || firstPage?.processedDataUrl;
              const fitContain =
                doc.folder === 'signatures' ||
                Boolean(firstPage && firstPage.width > firstPage.height * 1.15);
              return (
                <article
                  key={doc.id}
                  data-testid="document-preview-card"
                  className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white transition-all hover:border-teal-500/40"
                >
                  {/* Crisp Full-Bleed Thumbnail Sheet Preview (Zero Heavy Gray Border on Mobile) */}
                  <div className="relative aspect-[4/5] w-full overflow-hidden bg-slate-100/90">
                    <button
                      type="button"
                      onClick={() => {
                        haptics.tap();
                        onOpenDocument(doc.id);
                      }}
                      aria-label={`Open ${doc.title}`}
                      className="block h-full w-full text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-teal-600"
                    >
                      {cover ? (
                        <img
                          src={cover}
                          alt={doc.title}
                          referrerPolicy="no-referrer"
                          className={
                            fitContain
                              ? 'h-full w-full object-contain bg-white p-2.5 transition-transform duration-200 group-hover:scale-[1.02]'
                              : 'h-full w-full object-cover object-top transition-transform duration-200 group-hover:scale-[1.02]'
                          }
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-slate-300">
                          <FileText className="h-10 w-10" aria-hidden="true" />
                        </div>
                      )}
                    </button>

                    {/* Subtle Page Count Badge for multi-page docs */}
                    {doc.pages.length > 1 && (
                      <span className="pointer-events-none absolute left-2 top-2 rounded-md bg-slate-900/75 px-1.5 py-0.5 text-[10px] font-mono-tabular font-semibold text-white backdrop-blur-xs">
                        {doc.pages.length}p
                      </span>
                    )}

                    {/* Desktop Hover Star Toggle */}
                    <button
                      type="button"
                      onClick={() => {
                        haptics.tap();
                        onToggleStar(doc.id);
                      }}
                      aria-label={doc.starred ? `Unstar ${doc.title}` : `Star ${doc.title}`}
                      className={`hidden sm:flex absolute right-2 top-2 h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white/90 text-slate-400 shadow-xs backdrop-blur-xs hover:text-amber-500 transition-opacity cursor-pointer ${
                        doc.starred ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      <Star
                        className={`h-4 w-4 ${doc.starred ? 'fill-amber-400 text-amber-500' : ''}`}
                        aria-hidden="true"
                      />
                    </button>
                  </div>

                  {/* Clean Compact 2-Line CamScanner Footer + Native Overflow Sheet Trigger */}
                  <div className="flex flex-col gap-0.5 border-t border-slate-200 px-2.5 py-2 sm:px-3 sm:py-2.5 bg-slate-50/90">
                    <div className="flex items-center justify-between gap-1">
                      {editingId === doc.id ? (
                        <input
                          type="text"
                          value={draftTitle}
                          onChange={(e) => setDraftTitle(e.target.value)}
                          onBlur={() => commitRename(doc.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename(doc.id);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          autoFocus
                          aria-label="Rename document"
                          className="w-full rounded-lg border border-teal-600 px-2 py-0.5 text-xs sm:text-sm font-semibold text-slate-900 focus:outline-none"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            haptics.tap();
                            onOpenDocument(doc.id);
                          }}
                          className="min-w-0 flex-1 truncate text-left text-xs sm:text-sm font-semibold text-slate-900 hover:text-teal-700 cursor-pointer"
                        >
                          {doc.title}
                        </button>
                      )}

                      {/* Mobile Native Bottom Sheet Trigger */}
                      <button
                        type="button"
                        onClick={() => {
                          haptics.tap();
                          openActionSheet(doc);
                        }}
                        aria-label={`More actions for ${doc.title}`}
                        className="flex sm:hidden h-8 w-8 shrink-0 -mr-1 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 active:scale-95 cursor-pointer"
                      >
                        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                      </button>

                      {/* Desktop Compact Quick Actions */}
                      <div className="hidden sm:flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            haptics.tap();
                            onExportDocument(doc);
                          }}
                          aria-label={`Export ${doc.title}`}
                          title="Export"
                          className="rounded-lg p-1 text-teal-700 hover:bg-teal-50 cursor-pointer"
                        >
                          <Download className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (onEditProject) {
                              onEditProject(doc);
                            } else {
                              setEditingId(doc.id);
                              setDraftTitle(doc.title);
                            }
                          }}
                          aria-label={`Edit project ${doc.title}`}
                          title="Edit project"
                          className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteDocument(doc.id)}
                          aria-label={`Delete ${doc.title}`}
                          title="Delete"
                          className="rounded-lg p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-1 text-[11px] text-slate-500">
                      <div className="flex items-center gap-1 truncate">
                        <span className="truncate">{formatRelativeDate(doc.updatedAt)}</span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums shrink-0">
                          {doc.pages.length} {doc.pages.length === 1 ? 'pg' : 'pgs'}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          haptics.tap();
                          onToggleStar(doc.id);
                        }}
                        aria-label={doc.starred ? `Unstar ${doc.title}` : `Star ${doc.title}`}
                        className="flex sm:hidden h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 cursor-pointer"
                      >
                        <Star
                          className={`h-3.5 w-3.5 ${
                            doc.starred ? 'fill-amber-400 text-amber-500' : ''
                          }`}
                          aria-hidden="true"
                        />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          /* List View (Responsive Mobile Tap Rows + Desktop Table) */
          <>
            <div className="flex flex-col gap-2.5 sm:hidden" data-testid="mobile-document-list">
              {visibleDocs.map((doc) => {
                const cover = doc.pages[0]?.thumbnailDataUrl || doc.pages[0]?.processedDataUrl;
                return (
                  <article
                    key={doc.id}
                    className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-2.5 active:bg-slate-50 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        haptics.tap();
                        onOpenDocument(doc.id);
                      }}
                      aria-label={`Open ${doc.title}`}
                      className="flex flex-1 min-w-0 items-center gap-3 text-left cursor-pointer"
                    >
                      <div className="h-16 w-12 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                        {cover ? (
                          <img
                            src={cover}
                            alt=""
                            referrerPolicy="no-referrer"
                            className={
                              doc.folder === 'signatures'
                                ? 'h-full w-full object-contain p-1'
                                : 'h-full w-full object-cover object-top'
                            }
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-slate-400">
                            <FileText className="h-5 w-5" aria-hidden="true" />
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-semibold text-slate-900">
                            {doc.title}
                          </span>
                          {doc.starred && (
                            <Star
                              className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-500"
                              aria-label="Starred"
                            />
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                          <span>{FOLDER_LABEL[doc.folder]}</span>
                          <span aria-hidden="true">·</span>
                          <span className="tabular-nums">
                            {doc.pages.length} {doc.pages.length === 1 ? 'pg' : 'pgs'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{formatRelativeDate(doc.updatedAt)}</span>
                        </div>
                      </div>
                    </button>

                    <div className="flex items-center shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          haptics.tap();
                          onExportDocument(doc);
                        }}
                        aria-label={`Export ${doc.title} as PDF`}
                        className="flex h-11 w-11 items-center justify-center rounded-xl text-teal-700 hover:bg-teal-50 active:scale-95 cursor-pointer"
                      >
                        <Download className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          haptics.tap();
                          openActionSheet(doc);
                        }}
                        aria-label={`More actions for ${doc.title}`}
                        className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 active:scale-95 cursor-pointer"
                      >
                        <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="hidden sm:block overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500">
                  <tr>
                    <th className="py-3 px-4">Document</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4 text-right">Pages</th>
                    <th className="py-3 px-4 text-right">Modified</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleDocs.map((doc) => (
                    <tr key={doc.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 font-medium text-slate-900">
                        <button
                          type="button"
                          onClick={() => onOpenDocument(doc.id)}
                          className="text-left hover:text-teal-700 cursor-pointer"
                        >
                          {doc.title}
                        </button>
                      </td>
                      <td className="py-2.5 px-4 text-slate-500">{FOLDER_LABEL[doc.folder]}</td>
                      <td className="py-2.5 px-4 text-right font-mono-tabular text-slate-700">
                        {doc.pages.length}
                      </td>
                      <td className="py-2.5 px-4 text-right text-slate-500">
                        {formatRelativeDate(doc.updatedAt)}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onExportDocument(doc)}
                            aria-label={`Export ${doc.title}`}
                            className="rounded-lg px-2.5 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-50 cursor-pointer"
                          >
                            Export
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteDocument(doc.id)}
                            aria-label={`Delete ${doc.title}`}
                            className="rounded-lg p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>

      {/* Native Mobile Bottom Sheet Action Menu */}
      {actionSheetDoc && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Actions for ${actionSheetDoc.title}`}
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 backdrop-blur-xs"
          onClick={() => setActionSheetDoc(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-t-3xl bg-white pb-safe shadow-2xl animate-sheet-up"
          >
            <div className="mx-auto my-3 h-1.5 w-10 rounded-full bg-slate-300" />
            <div className="flex items-center justify-between border-b border-slate-100 px-5 pb-3">
              <div className="min-w-0 flex-1 pr-4">
                {sheetRenaming ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          commitRename(actionSheetDoc.id);
                          setActionSheetDoc(null);
                        }
                        if (e.key === 'Escape') setSheetRenaming(false);
                      }}
                      autoFocus
                      aria-label="New document title"
                      className="w-full rounded-xl border border-teal-600 px-3 py-1.5 text-sm font-semibold text-slate-900 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        commitRename(actionSheetDoc.id);
                        setActionSheetDoc(null);
                      }}
                      aria-label="Save title"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-600 text-white"
                    >
                      <Check className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="truncate text-base font-bold text-slate-900">
                      {actionSheetDoc.title}
                    </div>
                    <div className="text-xs text-slate-500">
                      {FOLDER_LABEL[actionSheetDoc.folder]} · {actionSheetDoc.pages.length}{' '}
                      {actionSheetDoc.pages.length === 1 ? 'page' : 'pages'}
                    </div>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => setActionSheetDoc(null)}
                aria-label="Close document actions"
                className="flex h-11 w-11 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="flex flex-col p-3 gap-1">
              <button
                type="button"
                onClick={() => {
                  haptics.tap();
                  const id = actionSheetDoc.id;
                  setActionSheetDoc(null);
                  onOpenDocument(id);
                }}
                className="flex min-h-[50px] items-center gap-3.5 rounded-xl px-4 text-left text-sm font-medium text-slate-900 active:bg-slate-100"
              >
                <ScanLine className="h-5 w-5 text-teal-600" aria-hidden="true" />
                <span>Open Project Pages</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  haptics.tap();
                  if (onEditProject) {
                    const target = actionSheetDoc;
                    setActionSheetDoc(null);
                    onEditProject(target);
                  } else {
                    setSheetRenaming(true);
                  }
                }}
                className="flex min-h-[50px] items-center gap-3.5 rounded-xl px-4 text-left text-sm font-medium text-slate-900 active:bg-slate-100"
              >
                <Pencil className="h-5 w-5 text-slate-600" aria-hidden="true" />
                <span>{onEditProject ? 'Edit Project Options' : 'Rename Document'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  haptics.tap();
                  const target = actionSheetDoc;
                  setActionSheetDoc(null);
                  onExportDocument(target);
                }}
                className="flex min-h-[50px] items-center gap-3.5 rounded-xl px-4 text-left text-sm font-medium text-slate-900 active:bg-slate-100"
              >
                <Download className="h-5 w-5 text-teal-600" aria-hidden="true" />
                <span>Export (PDF, Image, Word)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  haptics.tap();
                  onToggleStar(actionSheetDoc.id);
                  setActionSheetDoc(null);
                }}
                className="flex min-h-[50px] items-center gap-3.5 rounded-xl px-4 text-left text-sm font-medium text-slate-900 active:bg-slate-100"
              >
                <Star
                  className={`h-5 w-5 ${
                    actionSheetDoc.starred ? 'fill-amber-400 text-amber-500' : 'text-slate-400'
                  }`}
                  aria-hidden="true"
                />
                <span>{actionSheetDoc.starred ? 'Remove from Starred' : 'Add to Starred'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  haptics.warning();
                  const target = actionSheetDoc;
                  setActionSheetDoc(null);
                  onDeleteDocument(target.id);
                }}
                className="flex min-h-[50px] items-center gap-3.5 rounded-xl px-4 text-left text-sm font-medium text-red-600 active:bg-red-50"
              >
                <Trash2 className="h-5 w-5" aria-hidden="true" />
                <span>Delete Document</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
