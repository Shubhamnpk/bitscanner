import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Check,
  ChevronRight,
  Copy,
  CreditCard,
  Download,
  FileImage,
  FilePlus2,
  FileText,
  Film,
  GripVertical,
  ImagePlus,
  Layers,
  Loader2,
  PenTool,
  Plus,
  QrCode,
  Scan,
  ScanText,
  Search,
  Sparkles,
  Star,
  Trash2,
  Upload,
  UserCheck,
  X,
} from 'lucide-react';
import type { ScanDocument } from '../types/scanner';
import { useHaptics } from '../hooks/useHaptics';
import {
  TOOLS_CATALOG,
  type ToolCatalogItem,
  type ToolId,
} from '../utils/settingsStore';
import {
  imagesToPdfAndDownload,
  imagesToVideoWebm,
  mergePdfFilesAndDownload,
  renderPdfFileToImages,
  type RenderedPdfPageImage,
} from '../utils/pdfTools';
import {
  computePassportFraming,
  detectFaceRegion,
  PASSPORT_PRESETS,
  SHEET_DIMENSIONS_MM,
  renderPassportPhotoTile,
  renderPassportPrintSheet,
  type FaceDetectionResult,
  type PassportPresetId,
  type SheetSizeId,
} from '../utils/ppPhotoHelper';
import { runFreeOcr } from '../utils/ocrEngine';

interface ToolsViewProps {
  documents: ScanDocument[];
  favoriteTools: ToolId[];
  initialToolId?: ToolId | null;
  onToggleFavoriteTool: (toolId: ToolId) => void;
  onLaunchIdStudio: () => void;
  onLaunchSignatureStudio: () => void;
  onLaunchQrShare?: () => void;
  onLaunchQrScan?: () => void;
  onSaveImagesAsProject: (title: string, imageUrls: string[], folder?: ScanDocument['folder']) => void;
  onBackToLibrary: () => void;
}

const TOOL_ICON_MAP: Record<ToolId, React.FC<{ className?: string }>> = {
  images_to_pdf: FilePlus2,
  pdf_to_images: FileImage,
  pp_size: Camera,
  id_card: CreditCard,
  merge_pdf: Layers,
  ocr_extract: ScanText,
  sign_doc: PenTool,
  images_to_video: Film,
  qr_share: QrCode,
  qr_scan: Scan,
};

export const ToolsView: React.FC<ToolsViewProps> = ({
  documents,
  favoriteTools,
  initialToolId = null,
  onToggleFavoriteTool,
  onLaunchIdStudio,
  onLaunchSignatureStudio,
  onLaunchQrShare,
  onLaunchQrScan,
  onSaveImagesAsProject,
  onBackToLibrary,
}) => {
  const haptics = useHaptics();
  const [activeTool, setActiveTool] = useState<ToolId | null>(initialToolId);
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'pdf' | 'photo' | 'smart'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Shared Project Page Picker Modal state for picking existing scans into any tool
  const [projectPickerTarget, setProjectPickerTarget] = useState<
    'images_to_pdf' | 'pp_size' | 'ocr_extract' | 'images_to_video' | null
  >(null);

  // 1. Images -> PDF state
  const [imgPdfList, setImgPdfList] = useState<Array<{ id: string; url: string; label: string }>>([]);
  const [imgPdfPaper, setImgPdfPaper] = useState<'a4' | 'letter' | 'fit'>('a4');
  const [imgPdfName, setImgPdfName] = useState('Merged Scans');
  const [imgPdfBusy, setImgPdfBusy] = useState(false);
  const [dragImgIdx, setDragImgIdx] = useState<number | null>(null);

  // 2. PDF -> Images state
  const [pdfToImgPages, setPdfToImgPages] = useState<RenderedPdfPageImage[]>([]);
  const [pdfToImgName, setPdfToImgName] = useState('converted_pdf');
  const [pdfToImgFormat, setPdfToImgFormat] = useState<'png' | 'jpeg'>('png');
  const [pdfToImgBusy, setPdfToImgBusy] = useState(false);
  const [pdfToImgProgress, setPdfToImgProgress] = useState('');

  // 3. Passport / PP Size state
  const [ppSourceUrl, setPpSourceUrl] = useState<string>('');
  const [ppPreset, setPpPreset] = useState<PassportPresetId>('35x45mm');
  const [ppSheet, setPpSheet] = useState<SheetSizeId>('4x6in');
  const [ppBg, setPpBg] = useState('#ffffff');
  const [ppZoom, setPpZoom] = useState(1.1);
  const [ppOffsetY, setPpOffsetY] = useState(0);
  const [ppPreviewTile, setPpPreviewTile] = useState<string>('');
  const [ppPreviewSheet, setPpPreviewSheet] = useState<string>('');
  const [ppSheetInfo, setPpSheetInfo] = useState<string>('');
  const [ppBusy, setPpBusy] = useState(false);
  // Face detection state
  const [ppFaceResult, setPpFaceResult] = useState<FaceDetectionResult | null>(null);
  const [ppFaceDetecting, setPpFaceDetecting] = useState(false);

  // 4. Merge PDFs state
  const [mergeFiles, setMergeFiles] = useState<Array<{ id: string; file: File }>>([]);
  const [mergeFilename, setMergeFilename] = useState('Merged_Documents');
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeStatus, setMergeStatus] = useState('');
  const [dragPdfIdx, setDragPdfIdx] = useState<number | null>(null);

  // 5. OCR Extract state
  const [ocrSrcUrl, setOcrSrcUrl] = useState('');
  const [ocrText, setOcrText] = useState('');
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrPct, setOcrPct] = useState(0);
  const [ocrCopied, setOcrCopied] = useState(false);

  // 6. Slideshow Video state
  const [videoImages, setVideoImages] = useState<Array<{ id: string; url: string; label: string }>>([]);
  const [videoDurationSec, setVideoDurationSec] = useState(2);
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoPct, setVideoPct] = useState(0);
  const [videoResult, setVideoResult] = useState<{ blobUrl: string; filename: string } | null>(null);

  const imgPdfInputRef = useRef<HTMLInputElement | null>(null);
  const pdfToImgInputRef = useRef<HTMLInputElement | null>(null);
  const ppInputRef = useRef<HTMLInputElement | null>(null);
  const mergePdfInputRef = useRef<HTMLInputElement | null>(null);
  const ocrInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  const pinnedTools = useMemo(
    () => TOOLS_CATALOG.filter((t) => favoriteTools.includes(t.id)),
    [favoriteTools]
  );

  const filteredTools = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return TOOLS_CATALOG.filter((t) => {
      if (categoryFilter !== 'all' && t.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        t.shortLabel.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q)
      );
    });
  }, [categoryFilter, searchQuery]);

  const openTool = (id: ToolId) => {
    haptics.tap();
    if (id === 'id_card') {
      onLaunchIdStudio();
      return;
    }
    if (id === 'sign_doc') {
      onLaunchSignatureStudio();
      return;
    }
    if (id === 'qr_share' && onLaunchQrShare) {
      onLaunchQrShare();
      return;
    }
    if (id === 'qr_scan' && onLaunchQrScan) {
      onLaunchQrScan();
      return;
    }
    setActiveTool(id);
  };

  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(file);
    });

  // Handlers for Passport Photo generation
  const generatePassportOutputs = async (
    srcUrl = ppSourceUrl,
    preset = ppPreset,
    sheet = ppSheet,
    bg = ppBg,
    zoom = ppZoom,
    offsetY = ppOffsetY
  ) => {
    if (!srcUrl) return;
    setPpBusy(true);
    try {
      const tile = await renderPassportPhotoTile(srcUrl, preset, {
        backgroundColor: bg,
        zoom,
        offsetY,
      });
      const sheetOut = await renderPassportPrintSheet(tile, preset, sheet);
      setPpPreviewTile(tile);
      setPpPreviewSheet(sheetOut.dataUrl);
      setPpSheetInfo(
        `${sheetOut.copiesPlaced} photos (${sheetOut.layout.cols} × ${sheetOut.layout.rows}) on ${SHEET_DIMENSIONS_MM[sheet].label}`
      );
      haptics.success();
    } finally {
      setPpBusy(false);
    }
  };

  /** Runs face detection on the loaded portrait, then auto-frames and regenerates outputs. */
  const handleAutoFrameFace = async (srcUrl = ppSourceUrl, preset = ppPreset) => {
    if (!srcUrl) return;
    setPpFaceDetecting(true);
    try {
      const result = await detectFaceRegion(srcUrl);
      setPpFaceResult(result);
      if (result.faceBox && result.confidence >= 0.4) {
        const { zoom, offsetY } = computePassportFraming(result.faceBox, preset);
        setPpZoom(zoom);
        setPpOffsetY(offsetY);
        await generatePassportOutputs(srcUrl, preset, ppSheet, ppBg, zoom, offsetY);
        haptics.success();
      } else {
        // No face found — just regenerate with current settings
        await generatePassportOutputs(srcUrl, preset, ppSheet, ppBg, ppZoom, ppOffsetY);
      }
    } finally {
      setPpFaceDetecting(false);
    }
  };

  const handleDownloadDataUrl = (dataUrl: string, filename: string) => {
    const a = window.document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    window.document.body.appendChild(a);
    a.click();
    window.document.body.removeChild(a);
  };

  const renderDesktopToolCard = (tool: ToolCatalogItem) => {
    const Icon = TOOL_ICON_MAP[tool.id];
    const isFav = favoriteTools.includes(tool.id);

    return (
      <article
        key={tool.id}
        data-testid={`tool-card-${tool.id}`}
        className="group relative flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 transition-all hover:border-teal-500/60 hover:shadow-sm"
      >
        <button
          type="button"
          onClick={() => openTool(tool.id)}
          className="flex flex-1 flex-col items-start text-left cursor-pointer"
        >
          <div className="flex w-full items-start justify-between gap-2">
            <span
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${tool.accentClass}`}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
          </div>
          <h3 className="mt-3 text-sm font-bold text-slate-900 group-hover:text-teal-700">
            {tool.title}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-500 line-clamp-2">
            {tool.description}
          </p>
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            haptics.tap();
            onToggleFavoriteTool(tool.id);
          }}
          data-testid={`tool-fav-${tool.id}`}
          aria-label={isFav ? `Unfavorite ${tool.title}` : `Favorite ${tool.title}`}
          aria-pressed={isFav}
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-amber-500 cursor-pointer"
        >
          <Star
            className={`h-4 w-4 ${isFav ? 'fill-amber-400 text-amber-500' : ''}`}
            aria-hidden="true"
          />
        </button>
      </article>
    );
  };

  const renderMobileToolRow = (tool: ToolCatalogItem) => {
    const Icon = TOOL_ICON_MAP[tool.id];
    const isFav = favoriteTools.includes(tool.id);

    return (
      <div
        key={tool.id}
        data-testid={`tool-mobile-row-${tool.id}`}
        className="flex min-h-[68px] items-center gap-2 px-3 py-2.5 transition-colors active:bg-slate-50"
      >
        <button
          type="button"
          onClick={() => openTool(tool.id)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left cursor-pointer"
        >
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${tool.accentClass}`}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold text-slate-900">{tool.title}</div>
            <div className="truncate text-xs text-slate-500">{tool.description}</div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            haptics.tap();
            onToggleFavoriteTool(tool.id);
          }}
          data-testid={`tool-mobile-fav-${tool.id}`}
          aria-label={isFav ? `Unfavorite ${tool.title}` : `Favorite ${tool.title}`}
          aria-pressed={isFav}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 active:scale-95 cursor-pointer"
        >
          <Star
            className={`h-4 w-4 ${isFav ? 'fill-amber-400 text-amber-500' : ''}`}
            aria-hidden="true"
          />
        </button>

        <button
          type="button"
          onClick={() => openTool(tool.id)}
          aria-label={`Open ${tool.title}`}
          className="flex h-11 w-7 shrink-0 items-center justify-center text-slate-400 cursor-pointer"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    );
  };

  return (
    <div
      data-testid="tools-space-view"
      className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col px-4 py-4 pb-24 sm:p-6 lg:p-8"
    >
      {/* Hidden File Inputs for individual tools */}
      <input
        ref={imgPdfInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={async (e) => {
          const files = Array.from(e.target.files || []);
          const added: Array<{ id: string; url: string; label: string }> = [];
          for (const f of files) {
            const url = await readFileAsDataUrl(f);
            if (url) added.push({ id: crypto.randomUUID(), url, label: f.name });
          }
          setImgPdfList((prev) => [...prev, ...added]);
          e.target.value = '';
        }}
      />

      <input
        ref={pdfToImgInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setPdfToImgBusy(true);
          setPdfToImgName(file.name.replace(/\.pdf$/i, '') || 'pdf_pages');
          setPdfToImgProgress('Loading PDF...');
          try {
            const pages = await renderPdfFileToImages(file, {
              scale: 2.0,
              format: pdfToImgFormat,
              onProgress: (cur, tot) => setPdfToImgProgress(`Rendering page ${cur} of ${tot}...`),
            });
            setPdfToImgPages(pages);
            haptics.success();
          } finally {
            setPdfToImgBusy(false);
            setPdfToImgProgress('');
          }
        }}
      />

      <input
        ref={ppInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          const url = await readFileAsDataUrl(file);
          setPpSourceUrl(url);
          setPpFaceResult(null);
          // Auto-run face detection + framing on upload
          await handleAutoFrameFace(url, ppPreset);
        }}
      />

      <input
        ref={mergePdfInputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []).map((file) => ({
            id: crypto.randomUUID(),
            file,
          }));
          setMergeFiles((prev) => [...prev, ...files]);
          e.target.value = '';
        }}
      />

      <input
        ref={ocrInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          const url = await readFileAsDataUrl(file);
          setOcrSrcUrl(url);
          setOcrBusy(true);
          setOcrPct(0);
          try {
            const res = await runFreeOcr(url, 'eng', (pct) => setOcrPct(pct), 'auto');
            setOcrText(res.text);
            haptics.success();
          } finally {
            setOcrBusy(false);
          }
        }}
      />

      <input
        ref={videoInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={async (e) => {
          const files = Array.from(e.target.files || []);
          const added: Array<{ id: string; url: string; label: string }> = [];
          for (const f of files) {
            const url = await readFileAsDataUrl(f);
            if (url) added.push({ id: crypto.randomUUID(), url, label: f.name });
          }
          setVideoImages((prev) => [...prev, ...added]);
          setVideoResult(null);
          e.target.value = '';
        }}
      />

      {activeTool === null ? (
        /* REDESIGNED MOBILE-FIRST TOOLS HUB DIRECTORY */
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
                Document Tools
              </h1>
              <p className="mt-0.5 text-xs sm:text-sm text-slate-500">
                Fast on-device converters, ID makers, OCR, signatures &amp; slideshows.
              </p>
            </div>

            <button
              type="button"
              onClick={onBackToLibrary}
              className="hidden sm:inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Back to Docs</span>
            </button>
          </div>

          {/* Search & Segmented Category Filter */}
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-xs">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Find PDF, ID, OCR, video..."
                aria-label="Search tools"
                data-testid="tools-search-input"
                className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-white pl-9 pr-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear tool search"
                  className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'pdf', label: 'PDF' },
                  { id: 'photo', label: 'Photo & ID' },
                  { id: 'smart', label: 'Smart Tools' },
                ] as const
              ).map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    haptics.tap();
                    setCategoryFilter(cat.id);
                  }}
                  className={`min-h-[40px] rounded-xl px-3.5 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-all active:scale-95 ${
                    categoryFilter === cat.id
                      ? 'bg-slate-900 text-white dark:bg-teal-600 dark:text-white dark:shadow-sm'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Pinned Favorites Quick-Access Dock (Compact Horizontal Rail) */}
          {pinnedTools.length > 0 && categoryFilter === 'all' && !searchQuery.trim() && (
            <section aria-label="Pinned tools" className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Pinned Quick Access
                </h2>
                <span className="text-[11px] font-medium text-slate-400">
                  Tap star to pin/unpin
                </span>
              </div>
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {pinnedTools.map((tool) => {
                  const Icon = TOOL_ICON_MAP[tool.id];
                  return (
                    <button
                      key={tool.id}
                      type="button"
                      onClick={() => openTool(tool.id)}
                      className="flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left hover:border-teal-500 active:scale-[0.98] transition-all cursor-pointer"
                    >
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${tool.accentClass}`}
                      >
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                      <span className="text-xs font-semibold text-slate-800 whitespace-nowrap">
                        {tool.shortLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {filteredTools.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white py-12 text-center px-4">
              <Search className="h-8 w-8 text-slate-300 mb-2" aria-hidden="true" />
              <p className="text-sm font-semibold text-slate-700">No matching tools</p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setCategoryFilter('all');
                }}
                className="mt-2 text-xs font-semibold text-teal-700 hover:underline cursor-pointer"
              >
                Show all tools
              </button>
            </div>
          ) : (
            <>
              {/* Native Mobile Compact Action List */}
              <div
                data-testid="tools-mobile-list"
                className="flex flex-col divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white sm:hidden"
              >
                {filteredTools.map(renderMobileToolRow)}
              </div>

              {/* Desktop Multi-Column Grid */}
              <div className="hidden sm:grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 sm:gap-4">
                {filteredTools.map(renderDesktopToolCard)}
              </div>
            </>
          )}
        </div>
      ) : (
        /* FOCUSED TOOL WORKSPACE */
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-3.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                type="button"
                onClick={() => {
                  haptics.tap();
                  setActiveTool(null);
                }}
                data-testid="tools-back-hub-btn"
                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                <span>All Tools</span>
              </button>
              <h1 className="truncate text-base sm:text-lg font-bold text-slate-900">
                {TOOLS_CATALOG.find((t) => t.id === activeTool)?.title}
              </h1>
            </div>

            <button
              type="button"
              onClick={() => {
                haptics.tap();
                onToggleFavoriteTool(activeTool);
              }}
              aria-label="Toggle favorite tool"
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <Star
                className={`h-4 w-4 ${
                  favoriteTools.includes(activeTool) ? 'fill-amber-400 text-amber-500' : 'text-slate-400'
                }`}
                aria-hidden="true"
              />
              <span className="hidden sm:inline">
                {favoriteTools.includes(activeTool) ? 'Favorited' : 'Favorite'}
              </span>
            </button>
          </div>

          {/* TOOL 1: IMAGES -> PDF */}
          {activeTool === 'images_to_pdf' && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
              <div className="lg:col-span-2 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-bold text-slate-900">
                    Selected Images ({imgPdfList.length})
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => imgPdfInputRef.current?.click()}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-teal-600 px-3.5 text-xs font-semibold text-white hover:bg-teal-700 cursor-pointer"
                    >
                      <ImagePlus className="h-4 w-4" aria-hidden="true" />
                      <span>Upload Images</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setProjectPickerTarget('images_to_pdf')}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      <span>From Library</span>
                    </button>
                  </div>
                </div>

                {imgPdfList.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 py-14 text-center px-4">
                    <FilePlus2 className="h-9 w-9 text-slate-300 mb-2" aria-hidden="true" />
                    <p className="text-sm font-semibold text-slate-700">No images added yet</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Upload photos or pull existing scanned pages from your Library, then drag to reorder.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {imgPdfList.map((item, idx) => (
                      <div
                        key={item.id}
                        draggable
                        onDragStart={() => setDragImgIdx(idx)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (dragImgIdx === null || dragImgIdx === idx) return;
                          const next = [...imgPdfList];
                          const [moved] = next.splice(dragImgIdx, 1);
                          next.splice(idx, 0, moved);
                          setImgPdfList(next);
                          setDragImgIdx(null);
                        }}
                        onDragEnd={() => setDragImgIdx(null)}
                        className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-1.5 cursor-grab active:cursor-grabbing"
                      >
                        <img
                          src={item.url}
                          alt={item.label}
                          className="h-32 w-full rounded-lg bg-white object-contain"
                        />
                        <div className="mt-1.5 flex items-center justify-between px-1">
                          <span className="inline-flex items-center gap-1 text-[11px] font-mono-tabular font-semibold text-slate-600">
                            <GripVertical className="h-3 w-3 text-slate-400" aria-hidden="true" />
                            <span>{idx + 1}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setImgPdfList((prev) => prev.filter((x) => x.id !== item.id))
                            }
                            aria-label={`Remove image ${idx + 1}`}
                            className="rounded p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                <h2 className="text-sm font-bold text-slate-900">PDF Output Options</h2>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">File Name</label>
                  <input
                    type="text"
                    value={imgPdfName}
                    onChange={(e) => setImgPdfName(e.target.value)}
                    className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-sm text-slate-900 focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Paper Size</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['a4', 'letter', 'fit'] as const).map((sz) => (
                      <button
                        key={sz}
                        type="button"
                        onClick={() => setImgPdfPaper(sz)}
                        className={`min-h-[40px] rounded-xl border text-xs font-semibold uppercase cursor-pointer ${
                          imgPdfPaper === sz
                            ? 'border-teal-600 bg-teal-50 text-teal-900'
                            : 'border-slate-200 text-slate-700'
                        }`}
                      >
                        {sz}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={imgPdfList.length === 0 || imgPdfBusy}
                  onClick={async () => {
                    setImgPdfBusy(true);
                    try {
                      await imagesToPdfAndDownload(
                        imgPdfList.map((i) => i.url),
                        { paperSize: imgPdfPaper, filename: imgPdfName }
                      );
                      haptics.success();
                    } finally {
                      setImgPdfBusy(false);
                    }
                  }}
                  className="inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 text-xs font-bold text-white hover:bg-teal-700 disabled:opacity-50 cursor-pointer"
                >
                  {imgPdfBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Download className="h-4 w-4" aria-hidden="true" />
                  )}
                  <span>Convert &amp; Download PDF</span>
                </button>
                <button
                  type="button"
                  disabled={imgPdfList.length === 0}
                  onClick={() =>
                    onSaveImagesAsProject(
                      imgPdfName || 'Images Project',
                      imgPdfList.map((i) => i.url)
                    )
                  }
                  className="inline-flex min-h-[42px] w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  <span>Save as New Scan Project</span>
                </button>
              </div>
            </div>
          )}

          {/* TOOL 2: PDF -> IMAGES */}
          {activeTool === 'pdf_to_images' && (
            <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => pdfToImgInputRef.current?.click()}
                    disabled={pdfToImgBusy}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-teal-600 px-4 text-xs font-bold text-white hover:bg-teal-700 disabled:opacity-50 cursor-pointer"
                  >
                    {pdfToImgBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Upload className="h-4 w-4" aria-hidden="true" />
                    )}
                    <span>{pdfToImgBusy ? pdfToImgProgress || 'Converting...' : 'Choose PDF File'}</span>
                  </button>

                  <div className="flex items-center rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800/80 p-0.5">
                    {(['png', 'jpeg'] as const).map((fmt) => (
                      <button
                        key={fmt}
                        type="button"
                        onClick={() => setPdfToImgFormat(fmt)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold uppercase cursor-pointer transition-colors ${
                          pdfToImgFormat === fmt
                            ? 'bg-slate-900 text-white dark:bg-teal-600 dark:text-white'
                            : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                        }`}
                      >
                        {fmt}
                      </button>
                    ))}
                  </div>
                </div>

                {pdfToImgPages.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      onSaveImagesAsProject(
                        pdfToImgName,
                        pdfToImgPages.map((p) => p.dataUrl)
                      )
                    }
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-teal-600 bg-teal-50 px-3.5 text-xs font-semibold text-teal-800 hover:bg-teal-100 cursor-pointer"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    <span>Import {pdfToImgPages.length} Pages to Library</span>
                  </button>
                )}
              </div>

              {pdfToImgPages.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 py-14 text-center px-4">
                  <FileImage className="h-9 w-9 text-slate-300 mb-2" aria-hidden="true" />
                  <p className="text-sm font-semibold text-slate-700">
                    Upload any PDF to render crisp high-res images
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Download individual pages or import them directly into bitscanner for editing &amp; OCR.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {pdfToImgPages.map((pg) => (
                    <div
                      key={pg.pageNumber}
                      className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-2"
                    >
                      <img
                        src={pg.dataUrl}
                        alt={`Page ${pg.pageNumber}`}
                        className="h-44 w-full rounded-lg bg-white object-contain"
                      />
                      <div className="mt-2 flex items-center justify-between">
                        <span className="font-mono-tabular text-xs font-semibold text-slate-600">
                          Page {pg.pageNumber}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            handleDownloadDataUrl(
                              pg.dataUrl,
                              `${pdfToImgName}_p${pg.pageNumber}.${pdfToImgFormat === 'jpeg' ? 'jpg' : 'png'}`
                            )
                          }
                          className="inline-flex items-center gap-1 rounded-lg bg-white border border-slate-200 px-2.5 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-50 cursor-pointer"
                        >
                          <Download className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Save</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TOOL 3: PASSPORT / PP SIZE PHOTO MAKER */}
          {activeTool === 'pp_size' && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
              {/* Preview Panel */}
              <div className="lg:col-span-2 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">Cut-Ready Passport Print Sheet</h2>
                    {ppSheetInfo && <p className="text-xs text-slate-500">{ppSheetInfo}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => ppInputRef.current?.click()}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-teal-600 px-3.5 text-xs font-semibold text-white hover:bg-teal-700 cursor-pointer"
                    >
                      <Upload className="h-4 w-4" aria-hidden="true" />
                      <span>Upload Portrait</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setProjectPickerTarget('pp_size')}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      <span>From Library</span>
                    </button>
                    {ppSourceUrl && (
                      <button
                        type="button"
                        disabled={ppFaceDetecting || ppBusy}
                        onClick={() => handleAutoFrameFace(ppSourceUrl, ppPreset)}
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-3 text-xs font-semibold text-teal-700 hover:bg-teal-100 disabled:opacity-50 cursor-pointer"
                      >
                        {ppFaceDetecting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        <span>{ppFaceDetecting ? 'Detecting...' : 'Auto-Frame Face'}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Face detection status badge */}
                {ppFaceResult !== null && (
                  <div className="flex items-center">
                    {ppFaceResult.faceBox && ppFaceResult.confidence >= 0.4 ? (
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                        <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        Face detected — auto-framed to ICAO passport standards
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                        No face found — adjust zoom &amp; position manually
                      </span>
                    )}
                  </div>
                )}

                {!ppPreviewSheet ? (
                  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 py-16 text-center px-4">
                    <Camera className="h-9 w-9 text-slate-300 mb-2" aria-hidden="true" />
                    <p className="text-sm font-semibold text-slate-700">
                      Upload a portrait photo to create standard PP-size copies
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Face is detected automatically and framed to ICAO passport photo standards.
                      Supports 35×45mm, 2×2in US Passport, 33×48mm Visa, and 4×6 or A4 cut-guide sheets.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4 sm:flex-row items-start">
                    {/* Single tile preview with face guide overlay */}
                    <div className="w-36 shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-2 text-center">
                      <div className="relative">
                        <img
                          src={ppPreviewTile}
                          alt="Single passport tile"
                          className="w-full rounded-lg border border-slate-200 object-contain"
                        />
                        {/* ICAO face guide overlay — dashed oval showing expected face zone */}
                        {ppFaceResult?.faceBox && ppFaceResult.confidence >= 0.4 && (
                          <svg
                            className="pointer-events-none absolute inset-0 h-full w-full"
                            viewBox="0 0 100 100"
                            preserveAspectRatio="none"
                            aria-hidden="true"
                          >
                            {/* Head zone guide: face should sit in ~10-85% vertically, centered */}
                            <ellipse
                              cx="50"
                              cy="47"
                              rx="28"
                              ry="38"
                              fill="none"
                              stroke="#14b8a6"
                              strokeWidth="1.5"
                              strokeDasharray="4 3"
                              opacity="0.7"
                            />
                          </svg>
                        )}
                      </div>
                      <span className="mt-1.5 block text-[11px] font-medium text-slate-600">
                        Single Tile
                      </span>
                    </div>
                    <div className="flex-1 rounded-xl border border-slate-200 bg-slate-100 p-3">
                      <img
                        src={ppPreviewSheet}
                        alt="Passport print sheet"
                        className="max-h-[420px] w-full rounded-lg bg-white object-contain shadow-xs"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Settings Panel */}
              <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                <h2 className="text-sm font-bold text-slate-900">Photo &amp; Sheet Setup</h2>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-600">Photo Standard</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {PASSPORT_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setPpPreset(p.id);
                          if (ppSourceUrl) generatePassportOutputs(ppSourceUrl, p.id, ppSheet, ppBg, ppZoom, ppOffsetY);
                        }}
                        className={`rounded-xl border p-2 text-left cursor-pointer ${
                          ppPreset === p.id
                            ? 'border-teal-600 bg-teal-50 text-teal-900'
                            : 'border-slate-200 text-slate-700'
                        }`}
                      >
                        <div className="text-xs font-bold">{p.label}</div>
                        <div className="text-[10px] text-slate-500">{p.subtitle}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-600">Print Sheet Size</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(['4x6in', 'a4'] as const).map((sid) => (
                      <button
                        key={sid}
                        type="button"
                        onClick={() => {
                          setPpSheet(sid);
                          if (ppSourceUrl) generatePassportOutputs(ppSourceUrl, ppPreset, sid, ppBg, ppZoom, ppOffsetY);
                        }}
                        className={`min-h-[40px] rounded-xl border text-xs font-semibold cursor-pointer ${
                          ppSheet === sid
                            ? 'border-teal-600 bg-teal-50 text-teal-900'
                            : 'border-slate-200 text-slate-700'
                        }`}
                      >
                        {SHEET_DIMENSIONS_MM[sid].label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-600">Background</label>
                  <div className="flex items-center gap-2">
                    {[
                      { id: '#ffffff', label: 'White' },
                      { id: '#dbeafe', label: 'Sky Blue' },
                      { id: '#f1f5f9', label: 'Light Gray' },
                    ].map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => {
                          setPpBg(b.id);
                          if (ppSourceUrl) generatePassportOutputs(ppSourceUrl, ppPreset, ppSheet, b.id, ppZoom, ppOffsetY);
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium cursor-pointer ${
                          ppBg === b.id ? 'border-teal-600 bg-teal-50' : 'border-slate-200'
                        }`}
                      >
                        <span className="h-3 w-3 rounded-sm border border-slate-300" style={{ backgroundColor: b.id }} />
                        <span>{b.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex justify-between text-xs text-slate-600">
                    <span>Zoom Crop</span>
                    <span className="font-mono-tabular">{ppZoom.toFixed(2)}×</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={2.2}
                    step={0.05}
                    value={ppZoom}
                    onChange={(e) => setPpZoom(Number(e.target.value))}
                    onMouseUp={() => {
                      if (ppSourceUrl) generatePassportOutputs(ppSourceUrl, ppPreset, ppSheet, ppBg, ppZoom, ppOffsetY);
                    }}
                    onTouchEnd={() => {
                      if (ppSourceUrl) generatePassportOutputs(ppSourceUrl, ppPreset, ppSheet, ppBg, ppZoom, ppOffsetY);
                    }}
                    className="studio-slider w-full"
                  />
                </div>

                <div>
                  <div className="mb-1 flex justify-between text-xs text-slate-600">
                    <span>Vertical Head Position</span>
                    <span className="font-mono-tabular">{Math.round(ppOffsetY * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={-0.25}
                    max={0.25}
                    step={0.02}
                    value={ppOffsetY}
                    onChange={(e) => setPpOffsetY(Number(e.target.value))}
                    onMouseUp={() => {
                      if (ppSourceUrl) generatePassportOutputs(ppSourceUrl, ppPreset, ppSheet, ppBg, ppZoom, ppOffsetY);
                    }}
                    onTouchEnd={() => {
                      if (ppSourceUrl) generatePassportOutputs(ppSourceUrl, ppPreset, ppSheet, ppBg, ppZoom, ppOffsetY);
                    }}
                    className="studio-slider w-full"
                  />
                </div>

                <div className="flex flex-col gap-2 pt-1">
                  <button
                    type="button"
                    disabled={!ppPreviewSheet || ppBusy}
                    onClick={() => handleDownloadDataUrl(ppPreviewSheet, `passport_sheet_${ppPreset}.jpg`)}
                    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 text-xs font-bold text-white hover:bg-teal-700 disabled:opacity-50 cursor-pointer"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    <span>Download Print Sheet</span>
                  </button>
                  <button
                    type="button"
                    disabled={!ppPreviewTile || ppBusy}
                    onClick={() => handleDownloadDataUrl(ppPreviewTile, `passport_single_${ppPreset}.png`)}
                    className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Download Single Photo PNG</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TOOL 4: MERGE PDFS */}
          {activeTool === 'merge_pdf' && (
            <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => mergePdfInputRef.current?.click()}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-teal-600 px-4 text-xs font-bold text-white hover:bg-teal-700 cursor-pointer"
                >
                  <Upload className="h-4 w-4" aria-hidden="true" />
                  <span>Add PDF Files</span>
                </button>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={mergeFilename}
                    onChange={(e) => setMergeFilename(e.target.value)}
                    aria-label="Merged PDF filename"
                    className="min-h-[40px] rounded-xl border border-slate-200 px-3 text-xs font-medium text-slate-900"
                  />
                  <button
                    type="button"
                    disabled={mergeFiles.length < 2 || mergeBusy}
                    onClick={async () => {
                      setMergeBusy(true);
                      try {
                        await mergePdfFilesAndDownload(
                          mergeFiles.map((m) => m.file),
                          mergeFilename,
                          (msg) => setMergeStatus(msg)
                        );
                        haptics.success();
                      } finally {
                        setMergeBusy(false);
                        setMergeStatus('');
                      }
                    }}
                    className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-slate-900 px-4 text-xs font-bold text-white hover:bg-slate-800 dark:bg-teal-600 dark:hover:bg-teal-700 disabled:opacity-50 cursor-pointer transition-colors"
                  >
                    {mergeBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Download className="h-4 w-4" aria-hidden="true" />
                    )}
                    <span>{mergeBusy ? mergeStatus || 'Merging...' : 'Merge & Download'}</span>
                  </button>
                </div>
              </div>

              {mergeFiles.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 py-14 text-center px-4">
                  <Layers className="h-9 w-9 text-slate-300 mb-2" aria-hidden="true" />
                  <p className="text-sm font-semibold text-slate-700">Select 2 or more PDFs to merge</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Drag items in the queue below to set exact page order before merging.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {mergeFiles.map((item, idx) => (
                    <div
                      key={item.id}
                      draggable
                      onDragStart={() => setDragPdfIdx(idx)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (dragPdfIdx === null || dragPdfIdx === idx) return;
                        const next = [...mergeFiles];
                        const [moved] = next.splice(dragPdfIdx, 1);
                        next.splice(idx, 0, moved);
                        setMergeFiles(next);
                        setDragPdfIdx(null);
                      }}
                      onDragEnd={() => setDragPdfIdx(null)}
                      className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 cursor-grab active:cursor-grabbing"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <GripVertical className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
                        <span className="font-mono-tabular text-xs font-bold text-slate-500">
                          {idx + 1}.
                        </span>
                        <span className="truncate text-sm font-medium text-slate-900">
                          {item.file.name}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setMergeFiles((prev) => prev.filter((x) => x.id !== item.id))
                        }
                        aria-label={`Remove ${item.file.name}`}
                        className="rounded-lg p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TOOL 5: OCR EXTRACT */}
          {activeTool === 'ocr_extract' && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => ocrInputRef.current?.click()}
                    disabled={ocrBusy}
                    className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-teal-600 px-4 text-xs font-bold text-white hover:bg-teal-700 disabled:opacity-50 cursor-pointer"
                  >
                    <Upload className="h-4 w-4" aria-hidden="true" />
                    <span>Upload Image</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setProjectPickerTarget('ocr_extract')}
                    className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    <span>From Library</span>
                  </button>
                </div>

                {ocrSrcUrl ? (
                  <img
                    src={ocrSrcUrl}
                    alt="OCR source preview"
                    className="max-h-[420px] w-full rounded-xl border border-slate-200 bg-slate-50 object-contain p-2"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 py-20 text-center px-4">
                    <ScanText className="h-9 w-9 text-slate-300 mb-2" aria-hidden="true" />
                    <p className="text-sm font-semibold text-slate-700">
                      Upload a photo or pick a document page to extract text
                    </p>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-900">
                    {ocrBusy ? `Recognizing Text (${ocrPct}%)...` : 'Recognized Text'}
                  </span>
                  <button
                    type="button"
                    disabled={!ocrText}
                    onClick={async () => {
                      await navigator.clipboard?.writeText(ocrText).catch(() => {});
                      setOcrCopied(true);
                      window.setTimeout(() => setOcrCopied(false), 1500);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40 cursor-pointer"
                  >
                    {ocrCopied ? <Check className="h-3.5 w-3.5 text-teal-600" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{ocrCopied ? 'Copied' : 'Copy Text'}</span>
                  </button>
                </div>
                <textarea
                  value={ocrText}
                  onChange={(e) => setOcrText(e.target.value)}
                  placeholder="Recognized text will appear here..."
                  className="min-h-[300px] flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-800 focus:border-teal-600 focus:bg-white focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* TOOL 6: SLIDESHOW VIDEO MAKER */}
          {activeTool === 'images_to_video' && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
              <div className="lg:col-span-2 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-bold text-slate-900">
                    Video Slides ({videoImages.length})
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => videoInputRef.current?.click()}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-teal-600 px-3.5 text-xs font-semibold text-white hover:bg-teal-700 cursor-pointer"
                    >
                      <ImagePlus className="h-4 w-4" aria-hidden="true" />
                      <span>Upload Photos</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setProjectPickerTarget('images_to_video')}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      <span>From Library</span>
                    </button>
                  </div>
                </div>

                {videoImages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 py-14 text-center px-4">
                    <Film className="h-9 w-9 text-slate-300 mb-2" aria-hidden="true" />
                    <p className="text-sm font-semibold text-slate-700">
                      Add scanned pages or photos to build a slideshow video
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {videoImages.map((item, idx) => (
                      <div
                        key={item.id}
                        className="relative flex flex-col rounded-xl border border-slate-200 bg-slate-50 p-1.5"
                      >
                        <img
                          src={item.url}
                          alt={item.label}
                          className="h-28 w-full rounded-lg bg-white object-contain"
                        />
                        <div className="mt-1 flex items-center justify-between px-1">
                          <span className="font-mono-tabular text-[11px] font-semibold text-slate-600">
                            Slide {idx + 1}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setVideoImages((prev) => prev.filter((x) => x.id !== item.id))
                            }
                            aria-label={`Remove slide ${idx + 1}`}
                            className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {videoResult && (
                  <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-3">
                    <video
                      src={videoResult.blobUrl}
                      controls
                      className="max-h-80 w-full rounded-lg bg-slate-950"
                    />
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                <h2 className="text-sm font-bold text-slate-900">Video Timing</h2>
                <div>
                  <div className="mb-1 flex justify-between text-xs text-slate-600">
                    <span>Seconds per Page</span>
                    <span className="font-mono-tabular">{videoDurationSec}s</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    step={0.5}
                    value={videoDurationSec}
                    onChange={(e) => setVideoDurationSec(Number(e.target.value))}
                    className="studio-slider w-full"
                  />
                </div>
                <button
                  type="button"
                  disabled={videoImages.length === 0 || videoBusy}
                  onClick={async () => {
                    setVideoBusy(true);
                    setVideoPct(0);
                    try {
                      const res = await imagesToVideoWebm(
                        videoImages.map((v) => v.url),
                        videoDurationSec,
                        (p) => setVideoPct(p)
                      );
                      setVideoResult({ blobUrl: res.blobUrl, filename: res.filename });
                      haptics.success();
                    } finally {
                      setVideoBusy(false);
                    }
                  }}
                  className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 text-xs font-bold text-white hover:bg-teal-700 disabled:opacity-50 cursor-pointer"
                >
                  {videoBusy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      <span>Rendering ({videoPct}%)...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" aria-hidden="true" />
                      <span>Create Slideshow Video</span>
                    </>
                  )}
                </button>
                {videoResult && (
                  <button
                    type="button"
                    onClick={() => handleDownloadDataUrl(videoResult.blobUrl, videoResult.filename)}
                    className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    <span>Download .WEBM Video</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Library Document Page Picker Modal for Tools */}
      {projectPickerTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Pick scan from Library"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/50 p-0 sm:p-4 backdrop-blur-xs"
          onClick={() => setProjectPickerTarget(null)}
        >
          <div
            className="flex max-h-[82dvh] w-full max-w-lg flex-col rounded-t-3xl sm:rounded-2xl bg-white shadow-2xl overflow-hidden animate-sheet-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <h2 className="text-sm font-bold text-slate-900">Select from Library Scans</h2>
              <button
                type="button"
                onClick={() => setProjectPickerTarget(null)}
                className="text-xs font-semibold text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                Close
              </button>
            </div>
            <div className="flex flex-col gap-2 overflow-y-auto p-4">
              {documents.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={async () => {
                    haptics.tap();
                    const urls = doc.pages.map((p) => p.processedDataUrl);
                    const target = projectPickerTarget;
                    setProjectPickerTarget(null);

                    if (target === 'images_to_pdf') {
                      setImgPdfList((prev) => [
                        ...prev,
                        ...urls.map((url, idx) => ({
                          id: crypto.randomUUID(),
                          url,
                          label: `${doc.title} P${idx + 1}`,
                        })),
                      ]);
                    } else if (target === 'images_to_video') {
                      setVideoImages((prev) => [
                        ...prev,
                        ...urls.map((url, idx) => ({
                          id: crypto.randomUUID(),
                          url,
                          label: `${doc.title} P${idx + 1}`,
                        })),
                      ]);
                    } else if (target === 'pp_size' && urls[0]) {
                      setPpSourceUrl(urls[0]);
                      setPpFaceResult(null);
                      // Auto-run face detection + framing when picking from library
                      await handleAutoFrameFace(urls[0], ppPreset);
                    } else if (target === 'ocr_extract' && urls[0]) {
                      setOcrSrcUrl(urls[0]);
                      setOcrBusy(true);
                      try {
                        const res = await runFreeOcr(urls[0], 'eng', (p) => setOcrPct(p), 'auto');
                        setOcrText(res.text);
                      } finally {
                        setOcrBusy(false);
                      }
                    }
                  }}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 p-2.5 text-left hover:border-teal-500 hover:bg-teal-50/40 cursor-pointer"
                >
                  <img
                    src={doc.pages[0]?.thumbnailDataUrl || doc.pages[0]?.processedDataUrl}
                    alt=""
                    className="h-14 w-11 shrink-0 rounded-lg border border-slate-200 object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-slate-900">{doc.title}</div>
                    <div className="text-xs text-slate-500">
                      {doc.pages.length} {doc.pages.length === 1 ? 'page' : 'pages'}
                    </div>
                  </div>
                  <FileText className="h-4 w-4 text-slate-400" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
