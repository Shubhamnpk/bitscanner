import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Crop,
  Download,
  Eraser,
  Eye,
  FileDown,
  FlipHorizontal,
  GripVertical,
  Highlighter,
  Layers,
  Pencil,
  PenTool,
  Plus,
  RotateCcw,
  RotateCw,
  ScanText,
  Search,
  SlidersHorizontal,
  Square,
  Stamp,
  Trash2,
  Type,
  Undo2,
  Wand2,
  X,
} from 'lucide-react';
import type {
  AnnotationItem,
  FilterPreset,
  ImageAdjustments,
  Point2D,
  QuadCorners,
  SavedSignature,
  ScanDocument,
  ScannedPage,
  WatermarkConfig,
} from '../types/scanner';
import { DEFAULT_ADJUSTMENTS } from '../types/scanner';
import { useHaptics } from '../hooks/useHaptics';
import { clamp } from '../utils/cvGeometry';
import { reorderPageInList } from '../utils/projectHelpers';
import {
  clampPanOffset,
  computePinchZoomScale,
  resizeAnnotationByDelta,
  type ResizeHandle,
} from '../utils/annotationHelpers';
import {
  detectCornersFromDataUrl,
  perspectiveDewarp,
  processPagePipeline,
  renderPageThumbnail,
} from '../utils/imageProcessor';
import {
  countOcrWords,
  extractStructuredOcrEntities,
  runFreeOcr,
  searchOcrTextMatches,
  type OcrLayoutMode,
} from '../utils/ocrEngine';
import { exportOcrTextFile } from '../utils/pdfExporter';
import { OverlayPropertiesBar } from './OverlayPropertiesBar';
import { PerspectiveCropCanvas } from './PerspectiveCropCanvas';
import { SignatureModal, type SignatureDocPayload } from './SignatureModal';

interface DocumentEditorProps {
  document: ScanDocument;
  initialMode?: 'view' | 'edit';
  initialPageIndex?: number;
  defaultOcrLang?: string;
  isDraftScan?: boolean;
  onDiscardDraft?: () => void;
  onEditorModeChange?: (mode: 'view' | 'edit') => void;
  savedSignatures: SavedSignature[];
  onSaveNewSignature: (sig: SavedSignature) => void;
  onSaveSignatureAsDocument?: (payload: SignatureDocPayload) => void;
  onDeleteSavedSignature: (id: string) => void;
  onUpdateDocument: (nextDoc: ScanDocument) => void;
  onCommitDocument?: (nextDoc: ScanDocument) => void;
  onAddPagesToDoc: () => void;
  onOpenExport: (pageIndex: number) => void;
  onBackToProject?: () => void;
  onBackToLibrary: () => void;
}

const FILTER_PRESETS: Array<{ id: FilterPreset; label: string; desc: string }> = [
  { id: 'original', label: 'Original', desc: 'Natural unadjusted photo' },
  { id: 'magic_color', label: 'Magic Color', desc: 'White paper + vivid ink' },
  { id: 'lighten', label: 'Lighten', desc: 'Soft exposure boost' },
  { id: 'grayscale', label: 'Grayscale', desc: 'Clean neutral monochrome' },
  { id: 'bw', label: 'B&W', desc: 'Adaptive photocopy' },
  { id: 'bw_sharp', label: 'B&W Sharp', desc: 'Crisp high-contrast text' },
  { id: 'shadow_remove', label: 'No Shadow', desc: 'Even illumination lift' },
];

const WATERMARK_COLORS = ['#0f172a', '#0f766e', '#b91c1c', '#1d4ed8', '#64748b'];
const STROKE_SIZE_MAP = {
  thin: { hl: 0.012, pen: 0.003 },
  med: { hl: 0.024, pen: 0.006 },
  thick: { hl: 0.04, pen: 0.011 },
};

const BACKGROUND_FINISHES = [
  { id: 'none', label: 'Paper White', value: '#ffffff' },
  { id: 'cream', label: 'Warm Cream', value: '#fef9ec' },
  { id: 'cool', label: 'Cool Paper', value: '#f1f5f9' },
  { id: 'transparent', label: 'Transparent', value: 'transparent' },
];

type InspectorTab = 'enhance' | 'markup' | 'watermark';
type DrawTool = 'none' | 'highlighter' | 'pen';

type PointerDragState =
  | {
      kind: 'move';
      id: string;
      startX: number;
      startY: number;
      origX: number;
      origY: number;
      moved: boolean;
    }
  | {
      kind: 'resize';
      handle: ResizeHandle;
      id: string;
      startX: number;
      startY: number;
      origAnn: AnnotationItem;
    };

export const DocumentEditor: React.FC<DocumentEditorProps> = ({
  document,
  initialMode = 'view',
  initialPageIndex = 0,
  defaultOcrLang = 'eng',
  isDraftScan = false,
  onDiscardDraft,
  onEditorModeChange,
  savedSignatures,
  onSaveNewSignature,
  onSaveSignatureAsDocument,
  onDeleteSavedSignature,
  onUpdateDocument,
  onCommitDocument,
  onAddPagesToDoc,
  onOpenExport,
  onBackToProject,
  onBackToLibrary,
}) => {
  const haptics = useHaptics();
  const [editorMode, setEditorMode] = useState<'view' | 'edit'>(initialMode);
  const editSnapshotRef = useRef<ScanDocument | null>(
    initialMode === 'edit' ? structuredClone(document) : null
  );
  const [isDirty, setIsDirty] = useState(isDraftScan);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);

  useEffect(() => {
    onEditorModeChange?.(editorMode);
  }, [editorMode, onEditorModeChange]);

  const [activePageIdx, setActivePageIdx] = useState(initialPageIndex);
  const [draggedPageIdx, setDraggedPageIdx] = useState<number | null>(null);
  const [dragOverPageIdx, setDragOverPageIdx] = useState<number | null>(null);
  const [appliedAllNotice, setAppliedAllNotice] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('enhance');
  const [mobileTrayOpen, setMobileTrayOpen] = useState(initialMode === 'edit');
  const [mobileTab, setMobileTab] = useState<InspectorTab>('enhance');
  const [viewOcrOpen, setViewOcrOpen] = useState(false);
  const [viewPagesOpen, setViewPagesOpen] = useState(false);
  const [ocrSearchQuery, setOcrSearchQuery] = useState('');
  const [compareOriginal, setCompareOriginal] = useState(false);
  const [zoomScale, setZoomScale] = useState(1.0);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [processingPage, setProcessingPage] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  // Re-crop modal inside edit mode
  const [recropOpen, setRecropOpen] = useState(false);
  const [recropQuad, setRecropQuad] = useState<QuadCorners | null>(null);
  const [detectingQuad, setDetectingQuad] = useState(false);

  // Markup tools & overlay selection state
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);
  const [drawTool, setDrawTool] = useState<DrawTool>('none');
  const [strokeColor, setStrokeColor] = useState('#facc15');
  const [penColor, setPenColor] = useState('#0f172a');
  const [strokeSize, setStrokeSize] = useState<'thin' | 'med' | 'thick'>('med');
  const [newTextInput, setNewTextInput] = useState('APPROVED');
  const [selectedAnnId, setSelectedAnnId] = useState<string | null>(null);
  const [inlineTextEditId, setInlineTextEditId] = useState<string | null>(null);
  const [aspectLocked, setAspectLocked] = useState(true);

  // Stage geometry & multi-touch pinch-to-zoom / pan refs
  const stageViewportRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageDims, setStageDims] = useState<{ width: number; height: number }>({
    width: 520,
    height: 700,
  });
  const [activeStrokePoints, setActiveStrokePoints] = useState<Point2D[] | null>(null);
  const pointerDragRef = useRef<PointerDragState | null>(null);
  const stagePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartRef = useRef<{ dist: number; zoom: number } | null>(null);
  const panDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origPanX: number;
    origPanY: number;
  } | null>(null);
  const lastStageTapRef = useRef<{ time: number; x: number; y: number } | null>(null);

  useEffect(() => {
    setZoomScale(1.0);
    setPanOffset({ x: 0, y: 0 });
  }, [activePageIdx, document.id]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && rect.height > 0) {
        setStageDims({ width: rect.width, height: rect.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [activePageIdx, editorMode]);

  // OCR state
  const [ocrLang, setOcrLang] = useState(defaultOcrLang);
  const [ocrLayoutMode, setOcrLayoutMode] = useState<OcrLayoutMode>('auto');
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrStatus, setOcrStatus] = useState('');
  const [ocrBatchStatus, setOcrBatchStatus] = useState<string | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [copiedOcr, setCopiedOcr] = useState(false);
  const [copiedEntity, setCopiedEntity] = useState<string | null>(null);

  // Title edit
  const [titleDraft, setTitleDraft] = useState(document.title);
  useEffect(() => {
    setTitleDraft(document.title);
  }, [document.id, document.title]);

  const safeIdx = Math.min(activePageIdx, Math.max(0, document.pages.length - 1));
  const activePage = document.pages[safeIdx];
  const selectedAnn =
    activePage?.annotations.find((a) => a.id === selectedAnnId) || null;

  // Keep composited thumbnail (including annotations, strokes, watermark, background, filter) fresh
  const latestDocRef = useRef(document);
  latestDocRef.current = document;
  const thumbOverlaySig = activePage
    ? `${activePage.id}|${activePage.filter}|${activePage.rotation}|${activePage.flipH}|${activePage.backgroundColor || ''}|${JSON.stringify(activePage.adjustments)}|${JSON.stringify(activePage.annotations)}|${JSON.stringify(activePage.watermark)}`
    : '';

  useEffect(() => {
    if (!activePage) return;
    let cancelled = false;
    const targetPageId = activePage.id;
    const timer = window.setTimeout(async () => {
      try {
        const thumbUrl = await renderPageThumbnail(activePage, 420);
        if (cancelled) return;
        const curDoc = latestDocRef.current;
        const idx = curDoc.pages.findIndex((p) => p.id === targetPageId);
        if (idx === -1 || curDoc.pages[idx].thumbnailDataUrl === thumbUrl) return;
        const nextPages = curDoc.pages.map((p, i) =>
          i === idx ? { ...p, thumbnailDataUrl: thumbUrl } : p
        );
        onUpdateDocument({ ...curDoc, pages: nextPages });
      } catch {
        // Ignore thumbnail preview failures gracefully
      }
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [thumbOverlaySig]);

  const enterEditMode = () => {
    haptics.tap();
    editSnapshotRef.current = structuredClone(document);
    setIsDirty(false);
    setViewOcrOpen(false);
    setViewPagesOpen(false);
    setEditorMode('edit');
    setCompareOriginal(false);
    setSelectedAnnId(null);
    setInlineTextEditId(null);
  };

  const handleSaveEdits = async () => {
    const trimmedTitle = titleDraft.trim() || document.title;
    const refreshedPages = await Promise.all(
      document.pages.map(async (p) => ({
        ...p,
        thumbnailDataUrl: await renderPageThumbnail(p, 420),
      }))
    );
    const finalizedDoc: ScanDocument = {
      ...document,
      title: trimmedTitle,
      pages: refreshedPages,
      updatedAt: Date.now(),
    };
    if (onCommitDocument) {
      onCommitDocument(finalizedDoc);
    } else {
      onUpdateDocument(finalizedDoc);
    }
    haptics.success();
    editSnapshotRef.current = null;
    setIsDirty(false);
    setConfirmDiscardOpen(false);
    setSelectedAnnId(null);
    setInlineTextEditId(null);
    setDrawTool('none');
    setCompareOriginal(false);
    setMobileTrayOpen(false);
    setEditorMode('view');
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 1800);
  };

  const performDiscard = () => {
    setConfirmDiscardOpen(false);
    if (isDraftScan && onDiscardDraft) {
      onDiscardDraft();
      return;
    }
    if (editSnapshotRef.current) {
      onUpdateDocument(editSnapshotRef.current);
      setTitleDraft(editSnapshotRef.current.title);
    }
    editSnapshotRef.current = null;
    setIsDirty(false);
    setSelectedAnnId(null);
    setInlineTextEditId(null);
    setDrawTool('none');
    setCompareOriginal(false);
    setMobileTrayOpen(false);
    setEditorMode('view');
  };

  const handleCancelEdits = () => {
    haptics.tap();
    const titleChanged = titleDraft.trim() !== (editSnapshotRef.current?.title ?? document.title);
    if (isDraftScan || isDirty || titleChanged) {
      setConfirmDiscardOpen(true);
      return;
    }
    performDiscard();
  };

  const updateActivePage = (updater: (page: ScannedPage) => ScannedPage) => {
    setIsDirty(true);
    const nextPages = document.pages.map((p, idx) => (idx === safeIdx ? updater(p) : p));
    onUpdateDocument({
      ...document,
      pages: nextPages,
      updatedAt: Date.now(),
    });
  };

  const patchAnnotation = (id: string, patch: Partial<AnnotationItem>) => {
    updateActivePage((p) => ({
      ...p,
      annotations: p.annotations.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }));
  };

  const duplicateAnnotation = (ann: AnnotationItem) => {
    haptics.tap();
    const copy: AnnotationItem = {
      ...ann,
      id: crypto.randomUUID(),
      x: clamp(ann.x + 0.04, 0, Math.max(0, 0.96 - ann.width)),
      y: clamp(ann.y + 0.04, 0, Math.max(0, 0.96 - ann.height)),
    };
    updateActivePage((p) => ({
      ...p,
      annotations: [...p.annotations, copy],
    }));
    setSelectedAnnId(copy.id);
  };

  const reprocessAndUpdatePage = async (
    page: ScannedPage,
    nextFilter: FilterPreset,
    nextAdj: ImageAdjustments,
    nextRot: 0 | 90 | 180 | 270,
    nextFlip: boolean,
    nextBg: string | undefined = page.backgroundColor
  ) => {
    setProcessingPage(true);
    setIsDirty(true);
    try {
      const result = await processPagePipeline(
        page.croppedDataUrl,
        nextFilter,
        nextAdj,
        nextRot,
        nextFlip,
        { maxDim: 1400, backgroundColor: nextBg }
      );
      const updatedCandidate: ScannedPage = {
        ...page,
        filter: nextFilter,
        adjustments: nextAdj,
        rotation: nextRot,
        flipH: nextFlip,
        backgroundColor: nextBg,
        processedDataUrl: result.dataUrl,
        width: result.width,
        height: result.height,
      };
      const thumbUrl = await renderPageThumbnail(updatedCandidate, 420);
      updateActivePage(() => ({
        ...updatedCandidate,
        thumbnailDataUrl: thumbUrl,
      }));
    } finally {
      setProcessingPage(false);
    }
  };

  const handleFilterClick = (filter: FilterPreset) => {
    if (!activePage) return;
    haptics.tap();
    reprocessAndUpdatePage(
      activePage,
      filter,
      activePage.adjustments,
      activePage.rotation,
      activePage.flipH,
      activePage.backgroundColor
    );
  };

  const handleBackgroundChange = (bg: string) => {
    if (!activePage) return;
    haptics.tap();
    reprocessAndUpdatePage(
      activePage,
      activePage.filter,
      activePage.adjustments,
      activePage.rotation,
      activePage.flipH,
      bg
    );
  };

  const showAppliedNotice = (msg: string) => {
    setAppliedAllNotice(msg);
    window.setTimeout(() => setAppliedAllNotice(null), 1800);
  };

  const handleApplyFilterAllPages = async () => {
    if (!activePage) return;
    setProcessingPage(true);
    setIsDirty(true);
    try {
      const updatedPages: ScannedPage[] = [];
      for (const p of document.pages) {
        const res = await processPagePipeline(
          p.croppedDataUrl,
          activePage.filter,
          activePage.adjustments,
          p.rotation,
          p.flipH,
          { maxDim: 1400, backgroundColor: p.backgroundColor }
        );
        const candidate: ScannedPage = {
          ...p,
          filter: activePage.filter,
          adjustments: { ...activePage.adjustments },
          processedDataUrl: res.dataUrl,
          width: res.width,
          height: res.height,
        };
        candidate.thumbnailDataUrl = await renderPageThumbnail(candidate, 420);
        updatedPages.push(candidate);
      }
      onUpdateDocument({
        ...document,
        pages: updatedPages,
        updatedAt: Date.now(),
      });
      haptics.success();
      showAppliedNotice(`Filter applied to all ${document.pages.length} pages`);
    } finally {
      setProcessingPage(false);
    }
  };

  const handleApplyOrientationAllPages = async () => {
    if (!activePage) return;
    setProcessingPage(true);
    setIsDirty(true);
    try {
      const updatedPages: ScannedPage[] = [];
      for (const p of document.pages) {
        const res = await processPagePipeline(
          p.croppedDataUrl,
          p.filter,
          p.adjustments,
          activePage.rotation,
          activePage.flipH,
          { maxDim: 1400, backgroundColor: p.backgroundColor }
        );
        const candidate: ScannedPage = {
          ...p,
          rotation: activePage.rotation,
          flipH: activePage.flipH,
          processedDataUrl: res.dataUrl,
          width: res.width,
          height: res.height,
        };
        candidate.thumbnailDataUrl = await renderPageThumbnail(candidate, 420);
        updatedPages.push(candidate);
      }
      onUpdateDocument({ ...document, pages: updatedPages, updatedAt: Date.now() });
      haptics.success();
      showAppliedNotice(`Orientation (${activePage.rotation}°) applied to all pages`);
    } finally {
      setProcessingPage(false);
    }
  };

  const handleApplyBackgroundAllPages = async () => {
    if (!activePage) return;
    setProcessingPage(true);
    setIsDirty(true);
    try {
      const updatedPages: ScannedPage[] = [];
      for (const p of document.pages) {
        const res = await processPagePipeline(
          p.croppedDataUrl,
          p.filter,
          p.adjustments,
          p.rotation,
          p.flipH,
          { maxDim: 1400, backgroundColor: activePage.backgroundColor }
        );
        const candidate: ScannedPage = {
          ...p,
          backgroundColor: activePage.backgroundColor,
          processedDataUrl: res.dataUrl,
          width: res.width,
          height: res.height,
        };
        candidate.thumbnailDataUrl = await renderPageThumbnail(candidate, 420);
        updatedPages.push(candidate);
      }
      onUpdateDocument({ ...document, pages: updatedPages, updatedAt: Date.now() });
      haptics.success();
      showAppliedNotice('Paper background applied to all pages');
    } finally {
      setProcessingPage(false);
    }
  };

  const handleApplyWatermarkAllPages = async () => {
    if (!activePage) return;
    setProcessingPage(true);
    setIsDirty(true);
    try {
      const wm = { ...activePage.watermark };
      const updatedPages: ScannedPage[] = [];
      for (const p of document.pages) {
        const candidate: ScannedPage = { ...p, watermark: { ...wm } };
        candidate.thumbnailDataUrl = await renderPageThumbnail(candidate, 420);
        updatedPages.push(candidate);
      }
      onUpdateDocument({ ...document, pages: updatedPages, updatedAt: Date.now() });
      haptics.success();
      showAppliedNotice('Watermark applied to all pages');
    } finally {
      setProcessingPage(false);
    }
  };

  const handleRotate = (delta: 90 | -90) => {
    if (!activePage) return;
    haptics.tap();
    const nextRot = (((activePage.rotation + delta) % 360 + 360) % 360) as 0 | 90 | 180 | 270;
    reprocessAndUpdatePage(
      activePage,
      activePage.filter,
      activePage.adjustments,
      nextRot,
      activePage.flipH,
      activePage.backgroundColor
    );
  };

  const handleFlip = () => {
    if (!activePage) return;
    haptics.tap();
    reprocessAndUpdatePage(
      activePage,
      activePage.filter,
      activePage.adjustments,
      activePage.rotation,
      !activePage.flipH,
      activePage.backgroundColor
    );
  };

  const handleApplyRecrop = async () => {
    if (!activePage || !recropQuad) return;
    setProcessingPage(true);
    setIsDirty(true);
    try {
      const dewarped = await perspectiveDewarp(activePage.originalDataUrl, recropQuad, 1450);
      const processed = await processPagePipeline(
        dewarped.dataUrl,
        activePage.filter,
        activePage.adjustments,
        activePage.rotation,
        activePage.flipH,
        { maxDim: 1450, backgroundColor: activePage.backgroundColor }
      );
      const nextCandidate: ScannedPage = {
        ...activePage,
        quad: recropQuad,
        croppedDataUrl: dewarped.dataUrl,
        processedDataUrl: processed.dataUrl,
        width: processed.width,
        height: processed.height,
      };
      const thumbUrl = await renderPageThumbnail(nextCandidate, 420);
      updateActivePage(() => ({
        ...nextCandidate,
        thumbnailDataUrl: thumbUrl,
      }));
      haptics.success();
      setRecropOpen(false);
    } finally {
      setProcessingPage(false);
    }
  };

  const handleMovePage = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= document.pages.length) return;
    const next = reorderPageInList(document.pages, idx, target);
    onUpdateDocument({ ...document, pages: next, updatedAt: Date.now() });
    setActivePageIdx(target);
  };

  const handleReorderPage = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return;
    const activeId = document.pages[safeIdx]?.id;
    const next = reorderPageInList(document.pages, fromIdx, toIdx);
    onUpdateDocument({ ...document, pages: next, updatedAt: Date.now() });
    if (activeId) {
      const nextActiveIdx = next.findIndex((p) => p.id === activeId);
      if (nextActiveIdx >= 0) setActivePageIdx(nextActiveIdx);
    }
    haptics.tap();
  };

  const handleDeletePage = (idx: number) => {
    if (document.pages.length <= 1) return;
    const next = document.pages.filter((_, i) => i !== idx);
    onUpdateDocument({ ...document, pages: next, updatedAt: Date.now() });
    setActivePageIdx((prev) => Math.min(prev, next.length - 1));
  };

  // Annotation placement helpers
  const addAnnotation = (item: AnnotationItem) => {
    if (!activePage) return;
    haptics.tap();
    updateActivePage((p) => ({
      ...p,
      annotations: [...p.annotations, item],
    }));
    setSelectedAnnId(item.id);
    setDrawTool('none');
  };

  const placeSignature = (sig: SavedSignature) => {
    addAnnotation({
      id: crypto.randomUUID(),
      type: 'signature',
      x: 0.54,
      y: 0.72,
      width: 0.34,
      height: 0.14,
      opacity: 1,
      imageDataUrl: sig.dataUrl,
    });
  };

  const addRedactionBox = (color = '#09090b') => {
    addAnnotation({
      id: crypto.randomUUID(),
      type: 'redaction',
      x: 0.24,
      y: 0.42,
      width: 0.4,
      height: 0.065,
      color,
    });
  };

  const addTextStamp = () => {
    const txt = newTextInput.trim() || 'APPROVED';
    addAnnotation({
      id: crypto.randomUUID(),
      type: 'text',
      x: 0.14,
      y: 0.14,
      width: 0.36,
      height: 0.06,
      text: txt,
      color: '#b91c1c',
      fontSize: 0.032,
      opacity: 1,
    });
  };

  const undoLastAnnotation = () => {
    if (!activePage || activePage.annotations.length === 0) return;
    haptics.tap();
    updateActivePage((p) => ({
      ...p,
      annotations: p.annotations.slice(0, -1),
    }));
    setSelectedAnnId(null);
  };

  const removeAnnotation = (id: string) => {
    haptics.warning();
    updateActivePage((p) => ({
      ...p,
      annotations: p.annotations.filter((a) => a.id !== id),
    }));
    if (selectedAnnId === id) setSelectedAnnId(null);
    if (inlineTextEditId === id) setInlineTextEditId(null);
  };

  // Stage pointer handlers (drawing strokes + moving/resizing overlays)
  const toStageNormalized = (clientX: number, clientY: number): Point2D | null => {
    const el = stageRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: clamp((clientX - rect.left) / rect.width, 0, 1),
      y: clamp((clientY - rect.top) / rect.height, 0, 1),
    };
  };

  const applyZoomScale = (nextZoom: number) => {
    const clamped = Number(clamp(nextZoom, 0.75, 3.0).toFixed(3));
    setZoomScale(clamped);
    setPanOffset((prev) =>
      clampPanOffset(prev.x, prev.y, clamped, stageDims.width, stageDims.height)
    );
  };

  // Viewport capture-phase gesture zoom (2-finger pinch in/out, double-tap, wheel zoom, pan when zoomed)
  const handleViewportPointerDownCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    stagePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (stagePointersRef.current.size === 2) {
      // Two fingers active -> cancel single-finger drag/draw and initiate pinch zoom
      pointerDragRef.current = null;
      panDragRef.current = null;
      setActiveStrokePoints(null);
      const pts = Array.from(stagePointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      pinchStartRef.current = { dist: Math.max(10, dist), zoom: zoomScale };
      lastStageTapRef.current = null;
    }
  };

  const handleViewportPointerMoveCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!stagePointersRef.current.has(e.pointerId)) return;
    stagePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (stagePointersRef.current.size === 2 && pinchStartRef.current) {
      const pts = Array.from(stagePointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const next = computePinchZoomScale(pinchStartRef.current.zoom, pinchStartRef.current.dist, dist);
      applyZoomScale(next);
      return;
    }

    if (panDragRef.current && panDragRef.current.pointerId === e.pointerId) {
      const nextX = panDragRef.current.origPanX + (e.clientX - panDragRef.current.startX);
      const nextY = panDragRef.current.origPanY + (e.clientY - panDragRef.current.startY);
      setPanOffset(
        clampPanOffset(nextX, nextY, zoomScale, stageDims.width, stageDims.height)
      );
    }
  };

  const handleViewportPointerUpCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    stagePointersRef.current.delete(e.pointerId);
    if (stagePointersRef.current.size < 2) {
      pinchStartRef.current = null;
    }
    if (panDragRef.current && panDragRef.current.pointerId === e.pointerId) {
      panDragRef.current = null;
    }
  };

  const handleViewportPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (stagePointersRef.current.size >= 2) return;
    if (editorMode === 'edit' && drawTool !== 'none') return;

    // Double-tap anywhere on stage toggles zoom 1.0x <-> 1.85x
    const now = Date.now();
    const prevTap = lastStageTapRef.current;
    if (
      prevTap &&
      now - prevTap.time < 280 &&
      Math.hypot(e.clientX - prevTap.x, e.clientY - prevTap.y) < 28
    ) {
      haptics.tap();
      const targetZoom = zoomScale > 1.15 ? 1.0 : 1.85;
      applyZoomScale(targetZoom);
      lastStageTapRef.current = null;
      return;
    }
    lastStageTapRef.current = { time: now, x: e.clientX, y: e.clientY };

    // Single-finger pan when zoomed in (in View Mode, or bare canvas in Edit Mode)
    if (zoomScale > 1.02) {
      panDragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        origPanX: panOffset.x,
        origPanY: panOffset.y,
      };
    }
  };

  const handleViewportWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || Math.abs(e.deltaY) > 0) {
      const factor = e.ctrlKey ? -e.deltaY * 0.01 : -e.deltaY * 0.002;
      if (Math.abs(factor) < 0.005) return;
      applyZoomScale(zoomScale + factor);
    }
  };

  const handleStagePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (stagePointersRef.current.size >= 2) return;
    if (editorMode !== 'edit') return;
    if (drawTool === 'none') {
      // Tapping bare canvas deselects active overlay
      setSelectedAnnId(null);
      setInlineTextEditId(null);
      return;
    }
    e.stopPropagation();
    const pt = toStageNormalized(e.clientX, e.clientY);
    if (!pt) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setActiveStrokePoints([pt]);
  };

  const handleStagePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (stagePointersRef.current.size >= 2) return;
    if (editorMode !== 'edit') return;
    const drag = pointerDragRef.current;
    if (drag && stageRef.current) {
      const rect = stageRef.current.getBoundingClientRect();
      const dx = (e.clientX - drag.startX) / Math.max(1, rect.width);
      const dy = (e.clientY - drag.startY) / Math.max(1, rect.height);

      if (drag.kind === 'move') {
        if (Math.abs(dx) > 0.004 || Math.abs(dy) > 0.004) {
          drag.moved = true;
        }
        const nx = clamp(drag.origX + dx, 0, 0.92);
        const ny = clamp(drag.origY + dy, 0, 0.94);
        patchAnnotation(drag.id, { x: nx, y: ny });
      } else if (drag.kind === 'resize') {
        const patch = resizeAnnotationByDelta(drag.origAnn, dx, dy, drag.handle);
        patchAnnotation(drag.id, patch);
      }
      return;
    }

    if (drawTool !== 'none' && activeStrokePoints) {
      const pt = toStageNormalized(e.clientX, e.clientY);
      if (pt) {
        setActiveStrokePoints((prev) => (prev ? [...prev, pt] : [pt]));
      }
    }
  };

  const handleStagePointerUp = () => {
    pointerDragRef.current = null;
    if (
      editorMode === 'edit' &&
      drawTool !== 'none' &&
      activeStrokePoints &&
      activeStrokePoints.length > 1
    ) {
      const sz = STROKE_SIZE_MAP[strokeSize];
      updateActivePage((p) => ({
        ...p,
        annotations: [
          ...p.annotations,
          {
            id: crypto.randomUUID(),
            type: 'stroke',
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            points: activeStrokePoints,
            color: drawTool === 'highlighter' ? strokeColor : penColor,
            strokeWidth: drawTool === 'highlighter' ? sz.hl : sz.pen,
            opacity: drawTool === 'highlighter' ? 0.42 : 0.95,
          },
        ],
      }));
    }
    setActiveStrokePoints(null);
  };

  const selectOverlayForEdit = (ann: AnnotationItem) => {
    setSelectedAnnId(ann.id);
    setInspectorTab('markup');
    setMobileTab('markup');
    setMobileTrayOpen(true);
  };

  const handleRunOcr = async () => {
    if (!activePage) return;
    setOcrRunning(true);
    setOcrBatchStatus(null);
    setOcrError(null);
    setOcrProgress(5);
    setOcrStatus('Preparing high-contrast page...');
    try {
      const res = await runFreeOcr(
        activePage.processedDataUrl,
        ocrLang,
        (pct, status) => {
          setOcrProgress(pct);
          setOcrStatus(status);
        },
        ocrLayoutMode
      );
      updateActivePage((p) => ({
        ...p,
        ocrText: res.text || 'No readable text detected on this page.',
        ocrConfidence: res.confidence,
      }));
      haptics.success();
    } catch {
      setOcrError(
        'Could not load OCR language data offline. You can still type or edit notes manually below.'
      );
    } finally {
      setOcrRunning(false);
    }
  };

  const handleRunOcrAllPages = async () => {
    if (document.pages.length === 0) return;
    setOcrRunning(true);
    setOcrError(null);
    setOcrProgress(4);
    try {
      const nextPages = [...document.pages];
      for (let i = 0; i < nextPages.length; i++) {
        setOcrBatchStatus(`Scanning page ${i + 1} of ${nextPages.length}`);
        const res = await runFreeOcr(
          nextPages[i].processedDataUrl,
          ocrLang,
          (pct, status) => {
            const overallPct = Math.round(((i + pct / 100) / nextPages.length) * 100);
            setOcrProgress(overallPct);
            setOcrStatus(`P${i + 1}: ${status}`);
          },
          ocrLayoutMode
        );
        nextPages[i] = {
          ...nextPages[i],
          ocrText: res.text || 'No readable text detected on this page.',
          ocrConfidence: res.confidence,
        };
      }
      onUpdateDocument({
        ...document,
        pages: nextPages,
        updatedAt: Date.now(),
      });
      haptics.success();
    } catch {
      setOcrError(
        'Could not load OCR language data offline. You can still edit extracted text manually.'
      );
    } finally {
      setOcrRunning(false);
      setOcrBatchStatus(null);
    }
  };

  const handleCopyEntity = async (value: string) => {
    haptics.tap();
    try {
      await navigator.clipboard.writeText(value);
      setCopiedEntity(value);
      window.setTimeout(() => setCopiedEntity((cur) => (cur === value ? null : cur)), 1400);
    } catch {
      // Ignore clipboard permission errors
    }
  };

  const updateWatermark = (patch: Partial<WatermarkConfig>) => {
    if (!activePage) return;
    updateActivePage((p) => ({
      ...p,
      watermark: { ...p.watermark, ...patch },
    }));
  };

  if (!activePage) return null;

  const ocrWordCount = countOcrWords(activePage.ocrText);
  const ocrSearchMatches = searchOcrTextMatches(activePage.ocrText, ocrSearchQuery);
  const ocrEntities = extractStructuredOcrEntities(activePage.ocrText);
  const ocrEntityChips: Array<{ kind: string; value: string }> = [
    ...ocrEntities.emails.map((value) => ({ kind: 'Email', value })),
    ...ocrEntities.phones.map((value) => ({ kind: 'Phone', value })),
    ...ocrEntities.amounts.map((value) => ({ kind: 'Amount', value })),
    ...ocrEntities.dates.map((value) => ({ kind: 'Date', value })),
    ...ocrEntities.urls.map((value) => ({ kind: 'Link', value })),
  ];

  const displayImage =
    editorMode === 'edit' && compareOriginal
      ? activePage.originalDataUrl
      : activePage.processedDataUrl;

  return (
    <div
      className="flex flex-1 min-h-0 flex-col overflow-hidden bg-slate-100"
      data-testid="document-editor"
      data-editor-mode={editorMode}
      data-active-filter={activePage.filter}
      data-annotations-count={activePage.annotations.length}
    >
      {/* Contextual Top Header — Clean View Mode vs Rich Edit Mode */}
      <div className="flex shrink-0 h-12 lg:h-auto items-center justify-between gap-2 border-b border-slate-200 bg-white px-2.5 lg:px-5 lg:py-2.5">
        {editorMode === 'view' ? (
          <>
            <div className="flex items-center gap-1.5 lg:gap-3 min-w-0 flex-1">
              <button
                type="button"
                onClick={() => {
                  haptics.tap();
                  if (!isDraftScan && onBackToProject) {
                    onBackToProject();
                  } else {
                    onBackToLibrary();
                  }
                }}
                data-testid={!isDraftScan && onBackToProject ? 'view-back-project-btn' : 'view-back-library-btn'}
                aria-label={!isDraftScan && onBackToProject ? 'Back to project' : 'Back to library'}
                className="inline-flex h-11 lg:h-auto min-w-[44px] lg:min-w-0 items-center justify-center gap-1.5 rounded-xl lg:rounded-lg lg:border lg:border-slate-200 px-2.5 lg:px-3 lg:py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer shrink-0"
              >
                <ArrowLeft className="h-4 w-4 lg:h-3.5 lg:w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">
                  {!isDraftScan && onBackToProject ? 'Project' : 'Library'}
                </span>
              </button>

              <div className="min-w-0 flex-1">
                <h1 className="truncate text-sm font-bold text-slate-900">{document.title}</h1>
                <p className="text-[11px] font-mono-tabular text-slate-500">
                  Page {safeIdx + 1} of {document.pages.length}
                  <span className="hidden sm:inline">
                    {' '}
                    · {activePage.width}×{activePage.height}
                  </span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 lg:gap-2 shrink-0">
              {savedNotice && (
                <span
                  role="status"
                  className="hidden sm:inline-flex items-center gap-1 text-xs font-semibold text-teal-700 mr-1"
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Saved</span>
                </span>
              )}

              <button
                type="button"
                onClick={() => {
                  haptics.tap();
                  setViewOcrOpen((v) => !v);
                  if (!viewOcrOpen) setViewPagesOpen(false);
                }}
                data-testid="view-ocr-toggle-btn"
                aria-label="Open OCR text tools"
                aria-pressed={viewOcrOpen}
                className={`hidden lg:inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                  viewOcrOpen
                    ? 'border-teal-600 bg-teal-50 text-teal-800'
                    : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                }`}
              >
                <ScanText className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                <span>OCR</span>
              </button>

              <button
                type="button"
                onClick={enterEditMode}
                data-testid="enter-edit-mode-btn"
                className="hidden lg:inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 active:scale-[0.98] cursor-pointer"
              >
                <Pencil className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                <span>Edit</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  haptics.tap();
                  onOpenExport(safeIdx);
                }}
                data-testid="view-export-btn"
                aria-label="Export document"
                className="inline-flex h-9 lg:h-auto items-center gap-1.5 rounded-xl lg:rounded-lg bg-teal-600 px-3 lg:px-3.5 lg:py-1.5 text-xs font-semibold text-white hover:bg-teal-700 active:scale-[0.98] cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Export</span>
              </button>
            </div>
          </>
        ) : (
          /* EDIT MODE TOP BAR */
          <>
            <div className="flex items-center gap-1.5 lg:gap-3 min-w-0 flex-1">
              <button
                type="button"
                onClick={handleCancelEdits}
                data-testid="cancel-edits-btn"
                aria-label="Cancel editing"
                className="inline-flex h-10 lg:h-auto items-center justify-center gap-1 rounded-xl lg:rounded-lg lg:border lg:border-slate-200 px-2.5 lg:px-3 lg:py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 cursor-pointer shrink-0"
              >
                <X className="h-4 w-4 lg:h-3.5 lg:w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Cancel</span>
              </button>

              <input
                type="text"
                value={titleDraft}
                aria-label="Document title"
                onChange={(e) => {
                  setTitleDraft(e.target.value);
                  setIsDirty(true);
                }}
                onBlur={() => {
                  const trimmed = titleDraft.trim();
                  if (trimmed && trimmed !== document.title) {
                    onUpdateDocument({ ...document, title: trimmed, updatedAt: Date.now() });
                  }
                }}
                className="min-w-0 flex-1 max-w-xs truncate rounded-lg border border-slate-200 px-2 py-1 text-sm font-bold text-slate-900 focus:border-teal-600 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-1 lg:gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setCompareOriginal((v) => !v)}
                aria-label={compareOriginal ? 'Show enhanced scan' : 'Compare with original photo'}
                className={`inline-flex h-10 lg:h-auto min-w-[40px] lg:min-w-0 items-center justify-center gap-1.5 rounded-xl lg:rounded-lg lg:border px-2 lg:px-3 lg:py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  compareOriginal
                    ? 'lg:border-teal-600 bg-teal-50 text-teal-800'
                    : 'lg:border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Eye className="h-4 w-4 lg:h-3.5 lg:w-3.5" aria-hidden="true" />
                <span className="hidden lg:inline">
                  {compareOriginal ? 'Showing Original' : 'Compare'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleRotate(90)}
                aria-label="Rotate page 90 degrees"
                className="hidden sm:inline-flex h-10 lg:h-auto items-center justify-center gap-1.5 rounded-xl lg:rounded-lg lg:border lg:border-slate-200 bg-white px-2.5 lg:px-3 lg:py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <RotateCw className="h-4 w-4 lg:h-3.5 lg:w-3.5" aria-hidden="true" />
                <span className="hidden lg:inline">Rotate</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setRecropQuad(activePage.quad);
                  setRecropOpen(true);
                }}
                aria-label="Re-crop perspective corners"
                data-testid="edit-recrop-btn"
                className="inline-flex h-10 lg:h-auto min-w-[40px] lg:min-w-0 items-center justify-center gap-1.5 rounded-xl lg:rounded-lg lg:border lg:border-slate-200 bg-white px-2 lg:px-3 lg:py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <Crop className="h-4 w-4 lg:h-3.5 lg:w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Crop</span>
              </button>

              <button
                type="button"
                onClick={handleSaveEdits}
                data-testid="save-edits-btn"
                className="inline-flex h-10 lg:h-auto items-center gap-1.5 rounded-xl lg:rounded-lg bg-teal-600 px-3.5 lg:px-4 lg:py-1.5 text-xs font-bold text-white hover:bg-teal-700 active:scale-[0.98] transition-all cursor-pointer"
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Save</span>
              </button>
            </div>
          </>
        )}
      </div>

      {/* Main Content Stage */}
      <div className="relative flex flex-1 min-h-0 flex-col overflow-hidden lg:flex-row">
        {/* Desktop Left Page Thumbnail Rail — Shown in VIEW MODE only */}
        {editorMode === 'view' && (
          <aside
            data-testid="view-pages-rail"
            className="hidden lg:flex w-48 shrink-0 flex-col items-stretch gap-3 overflow-y-auto border-r border-slate-200 bg-white p-3"
          >
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-semibold text-slate-600">
                Pages ({document.pages.length})
              </span>
            </div>
            {document.pages.map((p, idx) => {
              const isDropTarget =
                dragOverPageIdx === idx && draggedPageIdx !== null && draggedPageIdx !== idx;
              return (
                <div
                  key={p.id}
                  draggable={document.pages.length > 1}
                  onDragStart={(e) => {
                    if (document.pages.length <= 1) return;
                    setDraggedPageIdx(idx);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', String(idx));
                  }}
                  onDragOver={(e) => {
                    if (draggedPageIdx === null) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (dragOverPageIdx !== idx) setDragOverPageIdx(idx);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const parsed = Number(e.dataTransfer.getData('text/plain'));
                    const fromIdx = draggedPageIdx !== null ? draggedPageIdx : parsed;
                    setDraggedPageIdx(null);
                    setDragOverPageIdx(null);
                    if (Number.isFinite(fromIdx)) handleReorderPage(fromIdx, idx);
                  }}
                  onDragEnd={() => {
                    setDraggedPageIdx(null);
                    setDragOverPageIdx(null);
                  }}
                  className={`group relative flex shrink-0 flex-col rounded-lg border p-1.5 transition-all ${
                    isDropTarget
                      ? 'border-teal-600 ring-2 ring-teal-500/35 bg-teal-50/70'
                      : idx === safeIdx
                        ? 'border-teal-600 bg-teal-50/40'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                  } ${draggedPageIdx === idx ? 'opacity-50' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => setActivePageIdx(idx)}
                    aria-label={`Select page ${idx + 1}`}
                    className="overflow-hidden rounded bg-slate-100 cursor-pointer"
                  >
                    <img
                      src={p.thumbnailDataUrl || p.processedDataUrl}
                      alt={`Page ${idx + 1}`}
                      referrerPolicy="no-referrer"
                      className="h-36 w-full object-cover"
                    />
                  </button>

                  <div className="mt-1.5 flex items-center justify-between px-1">
                    <span className="inline-flex items-center gap-1 text-[11px] font-mono-tabular font-medium text-slate-600">
                      {document.pages.length > 1 && (
                        <GripVertical className="h-3 w-3 text-slate-300 group-hover:text-slate-500 cursor-grab" aria-hidden="true" />
                      )}
                      <span>P{idx + 1}</span>
                    </span>
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => handleMovePage(idx, -1)}
                        aria-label={`Move page ${idx + 1} up`}
                        className="rounded p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowUp className="h-3 w-3" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === document.pages.length - 1}
                        onClick={() => handleMovePage(idx, 1)}
                        aria-label={`Move page ${idx + 1} down`}
                        className="rounded p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowDown className="h-3 w-3" aria-hidden="true" />
                      </button>
                      {document.pages.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleDeletePage(idx)}
                          aria-label={`Delete page ${idx + 1}`}
                          className="rounded p-0.5 text-slate-400 hover:text-red-600 cursor-pointer"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            <button
              type="button"
              data-testid="view-add-page-btn"
              onClick={onAddPagesToDoc}
              className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-3 text-xs font-medium text-slate-600 hover:border-teal-600 hover:text-teal-700 cursor-pointer"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Add Page</span>
            </button>
          </aside>
        )}

        {/* Center Dark-Mat Document Stage (Pinch-to-Zoom & Pan) */}
        <section className="relative flex flex-1 min-h-0 flex-col overflow-hidden editor-mat-bg">
          {/* Edit Mode Multi-Page Switcher Strip */}
          {editorMode === 'edit' && document.pages.length > 1 && (
            <div
              data-testid="edit-mode-page-switcher"
              className="shrink-0 flex items-center justify-center gap-1.5 border-b border-slate-800 bg-slate-950/80 px-3 py-1.5 text-white"
            >
              <button
                type="button"
                disabled={safeIdx === 0}
                onClick={() => {
                  haptics.tap();
                  setSelectedAnnId(null);
                  setActivePageIdx(Math.max(0, safeIdx - 1));
                }}
                aria-label="Edit previous page"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800 disabled:opacity-30 cursor-pointer"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>

              <div className="flex items-center gap-1 overflow-x-auto max-w-[75vw]">
                {document.pages.map((p, idx) => (
                  <button
                    key={p.id}
                    type="button"
                    data-testid={`edit-page-chip-${idx}`}
                    onClick={() => {
                      haptics.tap();
                      setSelectedAnnId(null);
                      setActivePageIdx(idx);
                    }}
                    className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-[11px] font-mono-tabular font-semibold transition-colors cursor-pointer ${
                      idx === safeIdx
                        ? 'border-teal-400 bg-teal-600 text-white'
                        : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    <img
                      src={p.thumbnailDataUrl || p.processedDataUrl}
                      alt=""
                      className="h-4 w-3 rounded-xs object-cover"
                    />
                    <span>P{idx + 1}</span>
                  </button>
                ))}
              </div>

              <button
                type="button"
                disabled={safeIdx >= document.pages.length - 1}
                onClick={() => {
                  haptics.tap();
                  setSelectedAnnId(null);
                  setActivePageIdx(Math.min(document.pages.length - 1, safeIdx + 1));
                }}
                aria-label="Edit next page"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800 disabled:opacity-30 cursor-pointer"
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          )}

          {/* Lightweight transient status / zoom reset / batch apply HUD */}
          {(processingPage ||
            Boolean(appliedAllNotice) ||
            (editorMode === 'edit' && drawTool !== 'none') ||
            Math.abs(zoomScale - 1) > 0.04) && (
            <div className="pointer-events-none absolute top-11 inset-x-0 z-20 flex justify-center px-3">
              <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-slate-700/80 bg-slate-900/90 px-3 py-1 text-xs text-slate-100 shadow-lg backdrop-blur-xs">
                {appliedAllNotice && !processingPage && (
                  <span className="inline-flex items-center gap-1 font-medium text-teal-300">
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{appliedAllNotice}</span>
                  </span>
                )}
                {processingPage && (
                  <span className="text-teal-300 font-medium">Applying enhancement...</span>
                )}
                {!processingPage && editorMode === 'edit' && drawTool !== 'none' && (
                  <span className="text-amber-300 font-medium">
                    Drawing ({drawTool}) — drag on page
                  </span>
                )}
                {Math.abs(zoomScale - 1) > 0.04 && (
                  <button
                    type="button"
                    data-testid="reset-stage-zoom-btn"
                    onClick={() => {
                      haptics.tap();
                      setZoomScale(1.0);
                      setPanOffset({ x: 0, y: 0 });
                    }}
                    className="inline-flex items-center gap-1.5 font-mono-tabular text-teal-300 hover:text-white cursor-pointer"
                  >
                    <span>{Math.round(zoomScale * 100)}%</span>
                    <span className="text-slate-400">· Reset</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* VIEW MODE: Previous & Next page buttons pinned to left and right edges of main stage */}
          {editorMode === 'view' && (
            <>
              <button
                type="button"
                data-testid="stage-prev-page-btn"
                disabled={safeIdx <= 0}
                onClick={() => {
                  haptics.tap();
                  setActivePageIdx((i) => Math.max(0, i - 1));
                }}
                aria-label="Previous page"
                className="absolute left-3 sm:left-5 top-1/2 -translate-y-1/2 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-slate-950/80 text-white shadow-xl backdrop-blur-md hover:bg-slate-900 active:scale-95 disabled:opacity-25 disabled:cursor-default transition-all cursor-pointer"
              >
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              </button>

              <button
                type="button"
                data-testid="stage-next-page-btn"
                disabled={safeIdx >= document.pages.length - 1}
                onClick={() => {
                  haptics.tap();
                  setActivePageIdx((i) => Math.min(document.pages.length - 1, i + 1));
                }}
                aria-label="Next page"
                className="absolute right-3 sm:right-5 top-1/2 -translate-y-1/2 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-slate-950/80 text-white shadow-xl backdrop-blur-md hover:bg-slate-900 active:scale-95 disabled:opacity-25 disabled:cursor-default transition-all cursor-pointer"
              >
                <ChevronRight className="h-5 w-5" aria-hidden="true" />
              </button>
            </>
          )}

          <div
            ref={stageViewportRef}
            data-testid="document-stage-viewport"
            onPointerDownCapture={handleViewportPointerDownCapture}
            onPointerMoveCapture={handleViewportPointerMoveCapture}
            onPointerUpCapture={handleViewportPointerUpCapture}
            onPointerCancelCapture={handleViewportPointerUpCapture}
            onPointerDown={handleViewportPointerDown}
            onWheel={handleViewportWheel}
            className={`flex flex-1 min-h-0 items-center justify-center overflow-hidden touch-none ${
              editorMode === 'view' ? 'px-16 py-4 sm:px-20 sm:py-6' : 'p-3 sm:p-6'
            }`}
          >
            <div
              ref={stageRef}
              data-testid="document-stage-sheet"
              data-zoom-scale={zoomScale.toFixed(2)}
              onPointerDown={handleStagePointerDown}
              onPointerMove={handleStagePointerMove}
              onPointerUp={handleStagePointerUp}
              style={{
                transform: `translate3d(${panOffset.x}px, ${panOffset.y}px, 0) scale(${zoomScale})`,
                transformOrigin: 'center center',
                ...(activePage.backgroundColor === 'transparent' &&
                !(editorMode === 'edit' && compareOriginal)
                  ? {
                      backgroundImage:
                        'linear-gradient(45deg, #f1f5f9 25%, transparent 25%), linear-gradient(-45deg, #f1f5f9 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f1f5f9 75%), linear-gradient(-45deg, transparent 75%, #f1f5f9 75%)',
                      backgroundSize: '18px 18px',
                      backgroundPosition: '0 0, 0 9px, 9px -9px, -9px 0px',
                      backgroundColor: '#ffffff',
                    }
                  : {}),
              }}
              className={`relative w-full max-w-[520px] bg-white shadow-2xl select-none transition-transform duration-75 ease-out ${
                editorMode === 'edit' && drawTool !== 'none'
                  ? 'cursor-crosshair touch-none'
                  : zoomScale > 1.02
                    ? 'cursor-grab active:cursor-grabbing'
                    : ''
              }`}
            >
              <img
                src={displayImage}
                alt={`${document.title} page ${safeIdx + 1}`}
                referrerPolicy="no-referrer"
                className="block w-full h-auto pointer-events-none"
              />

              {/* Freehand Strokes SVG Layer */}
              {!(editorMode === 'edit' && compareOriginal) && (
                <svg
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  className="pointer-events-none absolute inset-0 h-full w-full"
                >
                  {activePage.annotations
                    .filter((a) => a.type === 'stroke' && a.points && a.points.length > 1)
                    .map((a) => {
                      const d = a
                        .points!.map(
                          (pt, idx) =>
                            `${idx === 0 ? 'M' : 'L'} ${(pt.x * 100).toFixed(2)} ${(
                              pt.y * 100
                            ).toFixed(2)}`
                        )
                        .join(' ');
                      return (
                        <path
                          key={a.id}
                          d={d}
                          fill="none"
                          stroke={a.color || '#facc15'}
                          strokeOpacity={a.opacity ?? 0.42}
                          strokeWidth={(a.strokeWidth || 0.015) * 100}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      );
                    })}
                  {activeStrokePoints && activeStrokePoints.length > 1 && (
                    <path
                      d={activeStrokePoints
                        .map(
                          (pt, idx) =>
                            `${idx === 0 ? 'M' : 'L'} ${(pt.x * 100).toFixed(2)} ${(
                              pt.y * 100
                            ).toFixed(2)}`
                        )
                        .join(' ')}
                      fill="none"
                      stroke={drawTool === 'highlighter' ? strokeColor : penColor}
                      strokeOpacity={drawTool === 'highlighter' ? 0.42 : 0.95}
                      strokeWidth={
                        drawTool === 'highlighter'
                          ? STROKE_SIZE_MAP[strokeSize].hl * 100
                          : STROKE_SIZE_MAP[strokeSize].pen * 100
                      }
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                </svg>
              )}

              {/* Overlays: Interactive with Resize/Text Handles in EDIT MODE; Clean read-only in VIEW MODE */}
              {!(editorMode === 'edit' && compareOriginal) &&
                activePage.annotations
                  .filter((a) => a.type !== 'stroke')
                  .map((ann) => {
                    const isEditable = editorMode === 'edit';
                    const isSelected = isEditable && selectedAnnId === ann.id;
                    const isInlineEditing = isEditable && inlineTextEditId === ann.id;
                    const scaledFontPx = Math.max(
                      11,
                      Math.round((ann.fontSize ?? 0.032) * (stageDims.height || 680))
                    );

                    return (
                      <div
                        key={ann.id}
                        data-testid={`annotation-${ann.type}`}
                        onPointerDown={
                          isEditable
                            ? (e) => {
                                if (drawTool !== 'none' || isInlineEditing) return;
                                e.stopPropagation();
                                selectOverlayForEdit(ann);
                                pointerDragRef.current = {
                                  kind: 'move',
                                  id: ann.id,
                                  startX: e.clientX,
                                  startY: e.clientY,
                                  origX: ann.x,
                                  origY: ann.y,
                                  moved: false,
                                };
                                stageRef.current?.setPointerCapture(e.pointerId);
                              }
                            : undefined
                        }
                        onDoubleClick={
                          isEditable && ann.type === 'text'
                            ? (e) => {
                                e.stopPropagation();
                                setSelectedAnnId(ann.id);
                                setInlineTextEditId(ann.id);
                              }
                            : undefined
                        }
                        style={{
                          left: `${ann.x * 100}%`,
                          top: `${ann.y * 100}%`,
                          width: `${ann.width * 100}%`,
                          height: ann.type === 'text' ? 'auto' : `${ann.height * 100}%`,
                          opacity: ann.opacity ?? 1,
                        }}
                        className={`absolute ${
                          isEditable
                            ? isSelected
                              ? 'cursor-move ring-2 ring-teal-500 touch-none'
                              : 'cursor-move hover:ring-1 hover:ring-teal-400 touch-none'
                            : 'pointer-events-none'
                        }`}
                      >
                        {ann.type === 'redaction' && (
                          <div
                            style={{ backgroundColor: ann.color || '#09090b' }}
                            className="h-full w-full"
                          />
                        )}

                        {ann.type === 'signature' && ann.imageDataUrl && (
                          <img
                            src={ann.imageDataUrl}
                            alt="Signature overlay"
                            className="h-full w-full object-fill pointer-events-none"
                          />
                        )}

                        {ann.type === 'text' && (
                          <>
                            {isInlineEditing ? (
                              <input
                                type="text"
                                autoFocus
                                value={ann.text || ''}
                                onChange={(e) => patchAnnotation(ann.id, { text: e.target.value })}
                                onBlur={() => setInlineTextEditId(null)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === 'Escape') {
                                    setInlineTextEditId(null);
                                  }
                                }}
                                aria-label="Inline text annotation editor"
                                style={{
                                  color: ann.color || '#b91c1c',
                                  fontSize: `${scaledFontPx}px`,
                                }}
                                className="w-full rounded bg-white/95 px-1 font-bold leading-tight outline-2 outline-teal-500"
                              />
                            ) : (
                              <div
                                style={{
                                  color: ann.color || '#b91c1c',
                                  fontSize: `${scaledFontPx}px`,
                                }}
                                className="font-bold leading-tight whitespace-pre-wrap break-words px-0.5 pointer-events-none"
                              >
                                {ann.text}
                              </div>
                            )}
                          </>
                        )}

                        {/* Selection Resize & Action Handles (ONLY in Edit Mode when selected) */}
                        {isSelected && (
                          <>
                            {/* Delete button (top-right) */}
                            <button
                              type="button"
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                removeAnnotation(ann.id);
                              }}
                              aria-label="Delete selected annotation"
                              className="absolute -right-3 -top-3 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-white shadow cursor-pointer"
                            >
                              <X className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>

                            {/* Quick inline Edit Text button on selected text box */}
                            {ann.type === 'text' && !isInlineEditing && (
                              <button
                                type="button"
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setInlineTextEditId(ann.id);
                                }}
                                aria-label="Edit text content"
                                className="absolute -left-3 -top-3 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-white shadow cursor-pointer"
                              >
                                <Pencil className="h-3 w-3" aria-hidden="true" />
                              </button>
                            )}

                            {/* East Edge Width Handle — stretch signature/text/box width directly */}
                            <div
                              role="slider"
                              aria-label="Resize overlay width"
                              aria-valuenow={Math.round(ann.width * 100)}
                              data-testid="resize-handle-e"
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                pointerDragRef.current = {
                                  kind: 'resize',
                                  handle: 'e',
                                  id: ann.id,
                                  startX: e.clientX,
                                  startY: e.clientY,
                                  origAnn: { ...ann },
                                };
                                stageRef.current?.setPointerCapture(e.pointerId);
                              }}
                              className="absolute -right-2 top-1/2 -translate-y-1/2 flex h-7 w-4 items-center justify-center rounded-full border border-white bg-teal-600 shadow cursor-ew-resize touch-none"
                            >
                              <span className="h-3 w-0.5 rounded-full bg-white" />
                            </div>

                            {/* Bottom-Right Corner Scale Handle — proportionally increase/decrease size */}
                            <div
                              role="slider"
                              aria-label="Resize overlay size"
                              aria-valuenow={Math.round(ann.width * 100)}
                              data-testid="resize-handle-se"
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                pointerDragRef.current = {
                                  kind: 'resize',
                                  handle: 'se',
                                  id: ann.id,
                                  startX: e.clientX,
                                  startY: e.clientY,
                                  origAnn: { ...ann },
                                };
                                stageRef.current?.setPointerCapture(e.pointerId);
                              }}
                              className="absolute -bottom-3 -right-3 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-teal-600 shadow-md cursor-nwse-resize touch-none"
                            />
                          </>
                        )}
                      </div>
                    );
                  })}

              {/* Watermark Overlay Preview */}
              {!(editorMode === 'edit' && compareOriginal) &&
                activePage.watermark.enabled &&
                activePage.watermark.text.trim() && (
                  <div className="pointer-events-none absolute inset-0 overflow-hidden flex items-center justify-center">
                    {activePage.watermark.tiled ? (
                      <div className="grid grid-cols-3 gap-8 w-[140%] h-[140%] place-items-center">
                        {Array.from({ length: 9 }).map((_, idx) => (
                          <span
                            key={idx}
                            style={{
                              opacity: activePage.watermark.opacity,
                              color: activePage.watermark.color,
                              transform: `rotate(${activePage.watermark.angle}deg)`,
                            }}
                            className="font-display text-lg font-bold tracking-wider whitespace-nowrap"
                          >
                            {activePage.watermark.text}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span
                        style={{
                          opacity: activePage.watermark.opacity,
                          color: activePage.watermark.color,
                          transform: `rotate(${activePage.watermark.angle}deg)`,
                        }}
                        className="font-display text-3xl font-bold tracking-wider whitespace-nowrap"
                      >
                        {activePage.watermark.text}
                      </span>
                    )}
                  </div>
                )}
            </div>
          </div>

          {/* VIEW MODE: Floating Page Indicator & Thumbnails */}
          {editorMode === 'view' && (
            <div
              data-testid="view-mode-footer"
              className="mx-auto mb-2.5 lg:mb-5 shrink-0 inline-flex max-w-[calc(100%-2rem)] items-center gap-3 rounded-2xl border border-slate-700/80 bg-slate-950/90 px-3.5 py-1.5 lg:px-4 lg:py-2 text-white shadow-xl backdrop-blur-md"
            >
              {document.pages.length > 1 && (
                <div className="flex items-center gap-1.5 overflow-x-auto">
                  {document.pages.map((p, idx) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        haptics.tap();
                        setActivePageIdx(idx);
                      }}
                      aria-label={`View page ${idx + 1}`}
                      className={`relative shrink-0 overflow-hidden rounded-lg border-2 transition-all cursor-pointer ${
                        idx === safeIdx
                          ? 'border-teal-400 scale-105'
                          : 'border-slate-700 opacity-70 hover:opacity-100'
                      }`}
                    >
                      <img
                        src={p.thumbnailDataUrl || p.processedDataUrl}
                        alt={`Page ${idx + 1}`}
                        className="h-8 w-6 lg:h-9 lg:w-7 object-cover"
                      />
                      <span className="sr-only">Page {idx + 1}</span>
                    </button>
                  ))}
                </div>
              )}

              <span
                data-testid="view-mode-page-indicator"
                className="font-mono-tabular text-xs font-medium text-slate-200 whitespace-nowrap"
              >
                Page {safeIdx + 1} of {document.pages.length}
              </span>
            </div>
          )}

          {/* VIEW MODE MOBILE PAGES DRAWER (Supports Drag-and-Drop Reorder) */}
          {editorMode === 'view' && viewPagesOpen && (
            <div
              data-testid="view-mobile-pages-drawer"
              className="lg:hidden shrink-0 border-t border-slate-200 bg-white px-4 py-3 animate-sheet-up"
            >
              <div className="mb-2.5 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900">
                  Pages ({document.pages.length}) · Drag to reorder
                </span>
                <button
                  type="button"
                  onClick={() => setViewPagesOpen(false)}
                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 cursor-pointer"
                >
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  <span>Close</span>
                </button>
              </div>
              <div className="flex items-center gap-2.5 overflow-x-auto pb-1">
                {document.pages.map((p, idx) => (
                  <div
                    key={p.id}
                    draggable={document.pages.length > 1}
                    onDragStart={(e) => {
                      if (document.pages.length <= 1) return;
                      setDraggedPageIdx(idx);
                      e.dataTransfer.setData('text/plain', String(idx));
                    }}
                    onDragOver={(e) => {
                      if (draggedPageIdx === null) return;
                      e.preventDefault();
                      setDragOverPageIdx(idx);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const fromIdx = draggedPageIdx ?? Number(e.dataTransfer.getData('text/plain'));
                      setDraggedPageIdx(null);
                      setDragOverPageIdx(null);
                      if (Number.isFinite(fromIdx)) handleReorderPage(fromIdx, idx);
                    }}
                    onDragEnd={() => {
                      setDraggedPageIdx(null);
                      setDragOverPageIdx(null);
                    }}
                    className={`relative flex shrink-0 flex-col items-center rounded-xl border p-1.5 transition-all ${
                      dragOverPageIdx === idx && draggedPageIdx !== idx
                        ? 'border-teal-600 ring-2 ring-teal-500/35 bg-teal-50'
                        : idx === safeIdx
                          ? 'border-teal-600 bg-teal-50'
                          : 'border-slate-200'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setActivePageIdx(idx)}
                      className="cursor-pointer"
                    >
                      <img
                        src={p.thumbnailDataUrl || p.processedDataUrl}
                        alt={`Page ${idx + 1}`}
                        referrerPolicy="no-referrer"
                        className="h-20 w-16 rounded object-cover"
                      />
                      <span className="mt-1 block text-[11px] font-mono-tabular text-slate-700">
                        P{idx + 1}
                      </span>
                    </button>
                    {document.pages.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleDeletePage(idx)}
                        aria-label={`Delete page ${idx + 1}`}
                        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-white"
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={onAddPagesToDoc}
                  className="flex h-24 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 text-xs font-medium text-slate-600"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  <span>Add</span>
                </button>
              </div>
            </div>
          )}

          {/* CamScanner-Style Native Mobile Bottom Action Dock in View Mode */}
          {editorMode === 'view' && (
            <div
              data-testid="view-mobile-bottom-dock"
              className="lg:hidden shrink-0 border-t border-slate-200 bg-white/95 backdrop-blur-md pb-safe"
            >
              <div className="grid grid-cols-5 h-[58px] px-1">
                <button
                  type="button"
                  data-testid="mobile-view-add-page-btn"
                  onClick={() => {
                    haptics.tap();
                    onAddPagesToDoc();
                  }}
                  className="flex flex-col items-center justify-center min-h-[44px] text-slate-700 active:scale-95 transition-transform cursor-pointer"
                >
                  <Plus className="h-4 w-4 text-teal-700" aria-hidden="true" />
                  <span className="mt-0.5 text-[10px] font-semibold">Add Page</span>
                </button>

                <button
                  type="button"
                  data-testid="mobile-view-ocr-btn"
                  onClick={() => {
                    haptics.tap();
                    setViewOcrOpen((v) => !v);
                    if (!viewOcrOpen) setViewPagesOpen(false);
                  }}
                  aria-pressed={viewOcrOpen}
                  className={`flex flex-col items-center justify-center min-h-[44px] active:scale-95 transition-transform cursor-pointer ${
                    viewOcrOpen ? 'text-teal-700' : 'text-slate-700'
                  }`}
                >
                  <ScanText className="h-4 w-4" aria-hidden="true" />
                  <span className="mt-0.5 text-[10px] font-semibold">OCR</span>
                </button>

                <button
                  type="button"
                  data-testid="mobile-view-edit-btn"
                  onClick={enterEditMode}
                  className="flex flex-col items-center justify-center min-h-[44px] text-slate-900 active:scale-95 transition-transform cursor-pointer"
                >
                  <Pencil className="h-4 w-4 text-teal-700" aria-hidden="true" />
                  <span className="mt-0.5 text-[10px] font-bold">Edit</span>
                </button>

                <button
                  type="button"
                  data-testid="view-pages-toggle-btn"
                  onClick={() => {
                    haptics.tap();
                    setViewPagesOpen((v) => !v);
                    if (!viewPagesOpen) setViewOcrOpen(false);
                  }}
                  aria-pressed={viewPagesOpen}
                  className={`flex flex-col items-center justify-center min-h-[44px] active:scale-95 transition-transform cursor-pointer ${
                    viewPagesOpen ? 'text-teal-700' : 'text-slate-700'
                  }`}
                >
                  <Layers className="h-4 w-4" aria-hidden="true" />
                  <span className="mt-0.5 text-[10px] font-semibold">
                    Pages ({document.pages.length})
                  </span>
                </button>

                <button
                  type="button"
                  data-testid="mobile-view-export-btn"
                  onClick={() => {
                    haptics.tap();
                    onOpenExport(safeIdx);
                  }}
                  className="flex flex-col items-center justify-center min-h-[44px] text-teal-700 active:scale-95 transition-transform cursor-pointer"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  <span className="mt-0.5 text-[10px] font-bold">Export</span>
                </button>
              </div>
            </div>
          )}
        </section>

        {/* VIEW MODE RIGHT OCR PANEL (Desktop Sidebar + Mobile Bottom Sheet when toggled via OCR button) */}
        {editorMode === 'view' && viewOcrOpen && (
          <aside
            data-testid="view-ocr-panel"
            className="flex w-full lg:w-96 max-h-[54dvh] lg:max-h-none shrink-0 flex-col border-t lg:border-t-0 lg:border-l border-slate-200 bg-white overflow-hidden animate-sheet-up lg:animate-none"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="flex items-center gap-2">
                <ScanText className="h-4 w-4 text-teal-700" aria-hidden="true" />
                <span className="text-xs font-bold text-slate-900">OCR Text Studio</span>
              </div>
              <button
                type="button"
                onClick={() => setViewOcrOpen(false)}
                aria-label="Close OCR panel"
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3.5 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <select
                  value={ocrLang}
                  onChange={(e) => setOcrLang(e.target.value)}
                  aria-label="OCR Language"
                  className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs text-slate-800 focus:border-teal-600 focus:outline-none"
                >
                  <option value="eng">English</option>
                  <option value="spa">Spanish</option>
                  <option value="fra">French</option>
                  <option value="deu">German</option>
                </select>
                <button
                  type="button"
                  disabled={ocrRunning}
                  onClick={handleRunOcr}
                  data-testid="ocr-extract-btn"
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50 cursor-pointer"
                >
                  <ScanText className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{ocrRunning ? `${ocrProgress}%` : 'Extract Page Text'}</span>
                </button>
              </div>

              <div>
                <div className="mb-1 text-[11px] font-medium text-slate-600">Layout Mode</div>
                <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
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
                      onClick={() => setOcrLayoutMode(mode.id)}
                      className={`rounded-md py-1.5 text-[11px] font-semibold transition-colors cursor-pointer ${
                        ocrLayoutMode === mode.id
                          ? 'bg-white text-teal-800 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>

              {document.pages.length > 1 && (
                <button
                  type="button"
                  disabled={ocrRunning}
                  onClick={handleRunOcrAllPages}
                  data-testid="ocr-extract-all-btn"
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50/70 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-100 disabled:opacity-50 cursor-pointer"
                >
                  <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Scan All {document.pages.length} Pages</span>
                </button>
              )}

              {/* Search inside extracted OCR text */}
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={ocrSearchQuery}
                  onChange={(e) => setOcrSearchQuery(e.target.value)}
                  placeholder="Search inside recognized text..."
                  data-testid="ocr-search-input"
                  aria-label="Search extracted OCR text"
                  className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-3 text-xs text-slate-800 focus:border-teal-600 focus:outline-none"
                />
              </div>

              {ocrSearchQuery.trim() && (
                <div
                  data-testid="ocr-search-results"
                  className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs"
                >
                  <div className="font-semibold text-slate-700 mb-1">
                    {ocrSearchMatches.totalMatches}{' '}
                    {ocrSearchMatches.totalMatches === 1 ? 'match' : 'matches'} found
                  </div>
                  {ocrSearchMatches.matchingLines.length > 0 ? (
                    <ul className="flex flex-col gap-1 max-h-24 overflow-y-auto">
                      {ocrSearchMatches.matchingLines.map((m) => (
                        <li key={m.lineNumber} className="truncate text-[11px] text-slate-600">
                          <span className="font-mono-tabular text-teal-700 mr-1.5">
                            L{m.lineNumber}:
                          </span>
                          <span>{m.text}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[11px] text-slate-500">No matching lines on this page.</p>
                  )}
                </div>
              )}

              {ocrRunning && (
                <div className="rounded-lg bg-slate-50 p-2.5">
                  {ocrBatchStatus && (
                    <div className="mb-0.5 text-[11px] font-semibold text-teal-700">
                      {ocrBatchStatus}
                    </div>
                  )}
                  <div className="mb-1 flex justify-between text-[11px] text-slate-600">
                    <span className="truncate">{ocrStatus}</span>
                    <span className="font-mono-tabular">{ocrProgress}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full bg-teal-600 transition-all"
                      style={{ width: `${ocrProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {ocrError && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                  {ocrError}
                </div>
              )}

              <div>
                <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
                  <span>Extracted Text</span>
                  <span className="font-mono-tabular text-[11px] text-slate-500">
                    {ocrWordCount > 0 ? `${ocrWordCount}w` : ''}
                    {typeof activePage.ocrConfidence === 'number' && activePage.ocrText
                      ? `${ocrWordCount > 0 ? ' · ' : ''}${activePage.ocrConfidence}% conf.`
                      : ''}
                  </span>
                </div>
                <textarea
                  rows={8}
                  value={activePage.ocrText}
                  onChange={(e) => {
                    const val = e.target.value;
                    updateActivePage((p) => ({ ...p, ocrText: val }));
                  }}
                  placeholder="Click 'Extract Page Text' to recognize text from this scanned page..."
                  className="w-full rounded-lg border border-slate-200 p-3 text-xs leading-relaxed text-slate-800 focus:border-teal-600 focus:outline-none"
                />
              </div>

              {ocrEntityChips.length > 0 && (
                <div
                  data-testid="ocr-detected-entities"
                  className="rounded-lg border border-slate-200 bg-slate-50 p-2.5"
                >
                  <div className="mb-1.5 text-[11px] font-semibold text-slate-700">
                    Detected Fields (Tap to Copy)
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {ocrEntityChips.map((item) => {
                      const isCopied = copiedEntity === item.value;
                      return (
                        <button
                          key={`${item.kind}-${item.value}`}
                          type="button"
                          onClick={() => handleCopyEntity(item.value)}
                          className="inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-800 hover:border-teal-500 hover:text-teal-800 cursor-pointer"
                        >
                          <span className="font-semibold text-teal-700">{item.kind}:</span>
                          <span className="truncate max-w-[160px]">{item.value}</span>
                          {isCopied && (
                            <Check className="h-3 w-3 shrink-0 text-teal-600" aria-hidden="true" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  disabled={!activePage.ocrText}
                  onClick={async () => {
                    await navigator.clipboard.writeText(activePage.ocrText);
                    setCopiedOcr(true);
                    setTimeout(() => setCopiedOcr(false), 1500);
                  }}
                  className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                >
                  {copiedOcr ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-teal-600" aria-hidden="true" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  disabled={!activePage.ocrText}
                  onClick={() =>
                    exportOcrTextFile(`${document.title}_p${safeIdx + 1}`, activePage.ocrText, 'txt')
                  }
                  className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                >
                  <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>.TXT</span>
                </button>
                <button
                  type="button"
                  disabled={!activePage.ocrText}
                  onClick={() =>
                    exportOcrTextFile(`${document.title}_p${safeIdx + 1}`, activePage.ocrText, 'doc')
                  }
                  className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                >
                  <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>.DOC</span>
                </button>
              </div>
            </div>
          </aside>
        )}

        {/* Desktop Right Inspector Sidebar — ONLY shown in EDIT MODE (Enhance / Markup / Watermark) */}
        {editorMode === 'edit' && (
          <aside className="hidden lg:flex w-92 shrink-0 flex-col border-l border-slate-200 bg-white">
            {/* 3 Inspector Mode Tabs (NO OCR / Pages in Edit Mode) */}
            <div className="grid grid-cols-3 border-b border-slate-200 bg-slate-50 p-1 gap-1">
              {(
                [
                  { id: 'enhance', label: 'Enhance', icon: Wand2 },
                  { id: 'markup', label: 'Markup', icon: PenTool },
                  { id: 'watermark', label: 'Watermark', icon: Stamp },
                ] as const
              ).map((tab) => {
                const Icon = tab.icon;
                const active = inspectorTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setInspectorTab(tab.id);
                      if (tab.id !== 'markup') setDrawTool('none');
                    }}
                    className={`flex flex-col items-center justify-center gap-1 rounded-md py-2 text-[11px] font-semibold transition-colors cursor-pointer ${
                      active ? 'bg-white text-teal-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex-1 overflow-y-auto p-3.5">
              {/* ENHANCE TAB */}
              {inspectorTab === 'enhance' && (
                <div className="flex flex-col gap-3.5">
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-700">Enhancement Presets</span>
                      {document.pages.length > 1 && (
                        <button
                          type="button"
                          onClick={handleApplyFilterAllPages}
                          className="text-xs font-medium text-teal-700 hover:underline cursor-pointer"
                        >
                          Apply to All Pages
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {FILTER_PRESETS.map((preset) => {
                        const active = activePage.filter === preset.id;
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => handleFilterClick(preset.id)}
                            className={`flex flex-col rounded-lg border p-2 text-left transition-colors cursor-pointer ${
                              active
                                ? 'border-teal-600 bg-teal-50 text-teal-900'
                                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            <span className="text-xs font-semibold">{preset.label}</span>
                            <span className="mt-0.5 text-[10px] leading-tight text-slate-500">
                              {preset.desc}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Orientation */}
                  <div className="border-t border-slate-100 pt-3">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-700">Orientation</span>
                      {document.pages.length > 1 && (
                        <button
                          type="button"
                          data-testid="desktop-apply-orientation-all"
                          onClick={handleApplyOrientationAllPages}
                          className="text-xs font-medium text-teal-700 hover:underline cursor-pointer"
                        >
                          Apply to All Pages
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleRotate(-90)}
                        className="flex items-center justify-center gap-1 rounded-lg border border-slate-200 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>-90°</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRotate(90)}
                        className="flex items-center justify-center gap-1 rounded-lg border border-slate-200 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>+90°</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleFlip}
                        className="flex items-center justify-center gap-1 rounded-lg border border-slate-200 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        <FlipHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Flip</span>
                      </button>
                    </div>
                  </div>

                  {/* Background Finish */}
                  <div className="border-t border-slate-100 pt-3">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-700">Background Finish</span>
                      {document.pages.length > 1 && (
                        <button
                          type="button"
                          data-testid="desktop-apply-bg-all"
                          onClick={handleApplyBackgroundAllPages}
                          className="text-xs font-medium text-teal-700 hover:underline cursor-pointer"
                        >
                          Apply to All Pages
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {BACKGROUND_FINISHES.map((bg) => {
                        const activeBg = (activePage.backgroundColor || '#ffffff') === bg.value;
                        return (
                          <button
                            key={bg.id}
                            type="button"
                            data-testid={`editor-bg-${bg.id}`}
                            onClick={() => handleBackgroundChange(bg.value)}
                            className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-semibold cursor-pointer ${
                              activeBg
                                ? 'border-teal-600 bg-teal-50 text-teal-900'
                                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            <span
                              className="h-3 w-3 rounded-sm border border-slate-300"
                              style={
                                bg.value === 'transparent'
                                  ? {
                                      backgroundImage:
                                        'linear-gradient(45deg, #cbd5e1 25%, transparent 25%), linear-gradient(-45deg, #cbd5e1 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #cbd5e1 75%), linear-gradient(-45deg, transparent 75%, #cbd5e1 75%)',
                                      backgroundSize: '6px 6px',
                                    }
                                  : { backgroundColor: bg.value }
                              }
                            />
                            <span>{bg.label}</span>
                          </button>
                        );
                      })}
                      <label className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 cursor-pointer">
                        <span>Custom</span>
                        <input
                          type="color"
                          aria-label="Custom page background color"
                          value={
                            !activePage.backgroundColor ||
                            activePage.backgroundColor === 'transparent' ||
                            activePage.backgroundColor === 'none'
                              ? '#ffffff'
                              : activePage.backgroundColor
                          }
                          onChange={(e) => handleBackgroundChange(e.target.value)}
                          className="h-4 w-5 cursor-pointer border-0 bg-transparent p-0"
                        />
                      </label>
                    </div>
                  </div>

                  {/* Fine-Tune Sliders */}
                  <div className="border-t border-slate-100 pt-3 flex flex-col gap-2.5">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                        <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                        <span>Fine-Tune Adjustments</span>
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          reprocessAndUpdatePage(
                            activePage,
                            activePage.filter,
                            { ...DEFAULT_ADJUSTMENTS },
                            activePage.rotation,
                            activePage.flipH
                          )
                        }
                        className="text-xs text-slate-500 hover:text-slate-900 cursor-pointer"
                      >
                        Reset
                      </button>
                    </div>

                    {(
                      [
                        { key: 'brightness', label: 'Brightness', min: -60, max: 60 },
                        { key: 'contrast', label: 'Contrast', min: -60, max: 60 },
                        { key: 'saturation', label: 'Saturation', min: -100, max: 80 },
                        { key: 'sharpness', label: 'Sharpness', min: 0, max: 100 },
                        { key: 'shadowRemoval', label: 'Shadow Lift', min: 0, max: 100 },
                      ] as const
                    ).map((ctrl) => (
                      <div key={ctrl.key}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="text-slate-600">{ctrl.label}</span>
                          <span className="font-mono-tabular text-slate-800">
                            {activePage.adjustments[ctrl.key]}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={ctrl.min}
                          max={ctrl.max}
                          value={activePage.adjustments[ctrl.key]}
                          aria-label={ctrl.label}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            const nextAdj = { ...activePage.adjustments, [ctrl.key]: val };
                            updateActivePage((p) => ({ ...p, adjustments: nextAdj }));
                          }}
                          onMouseUp={(e) => {
                            const val = Number((e.target as HTMLInputElement).value);
                            const nextAdj = { ...activePage.adjustments, [ctrl.key]: val };
                            reprocessAndUpdatePage(
                              activePage,
                              activePage.filter,
                              nextAdj,
                              activePage.rotation,
                              activePage.flipH
                            );
                          }}
                          onTouchEnd={(e) => {
                            const val = Number((e.target as HTMLInputElement).value);
                            const nextAdj = { ...activePage.adjustments, [ctrl.key]: val };
                            reprocessAndUpdatePage(
                              activePage,
                              activePage.filter,
                              nextAdj,
                              activePage.rotation,
                              activePage.flipH
                            );
                          }}
                          className="studio-slider w-full"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* MARKUP TAB */}
              {inspectorTab === 'markup' && (
                <div className="flex flex-col gap-4">
                  {/* Contextual Selected Overlay Controls (Size, Width, Text Edit, Color, Opacity) */}
                  {selectedAnn && (
                    <OverlayPropertiesBar
                      annotation={selectedAnn}
                      aspectLocked={aspectLocked}
                      onToggleAspectLock={() => setAspectLocked((v) => !v)}
                      onUpdate={(patch) => patchAnnotation(selectedAnn.id, patch)}
                      onDuplicate={() => duplicateAnnotation(selectedAnn)}
                      onDelete={() => removeAnnotation(selectedAnn.id)}
                    />
                  )}

                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-700">E-Signature</span>
                      <button
                        type="button"
                        onClick={() => setSignatureModalOpen(true)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:underline cursor-pointer"
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>New Signature</span>
                      </button>
                    </div>

                    {savedSignatures.length === 0 ? (
                      <button
                        type="button"
                        onClick={() => setSignatureModalOpen(true)}
                        className="w-full rounded-lg border border-dashed border-slate-300 bg-slate-50 py-4 text-xs font-medium text-slate-600 hover:border-teal-600 hover:text-teal-700 cursor-pointer"
                      >
                        Draw or Type Your First Signature
                      </button>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {savedSignatures.map((sig) => (
                          <div
                            key={sig.id}
                            className="flex items-center justify-between rounded-lg border border-slate-200 p-2"
                          >
                            <button
                              type="button"
                              onClick={() => placeSignature(sig)}
                              className="flex flex-1 items-center gap-2.5 text-left cursor-pointer"
                            >
                              <img
                                src={sig.dataUrl}
                                alt={sig.label}
                                className="h-8 w-20 object-contain bg-slate-50 rounded border border-slate-100"
                              />
                              <span className="text-xs font-medium text-slate-800 truncate">
                                Place &ldquo;{sig.label}&rdquo;
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteSavedSignature(sig.id)}
                              aria-label={`Delete saved signature ${sig.label}`}
                              className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Text Stamps & Redaction / White-Out */}
                  <div className="border-t border-slate-100 pt-3.5 flex flex-col gap-2.5">
                    <span className="text-xs font-semibold text-slate-700">Text &amp; Redaction</span>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newTextInput}
                        onChange={(e) => setNewTextInput(e.target.value)}
                        aria-label="Stamp text"
                        className="flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-900 focus:border-teal-600 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={addTextStamp}
                        className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 cursor-pointer"
                      >
                        <Type className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Add Text</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => addRedactionBox('#09090b')}
                        className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 cursor-pointer"
                      >
                        <Square className="h-3.5 w-3.5 fill-zinc-900" aria-hidden="true" />
                        <span>Blackout</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => addRedactionBox('#ffffff')}
                        className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 cursor-pointer"
                      >
                        <Eraser className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
                        <span>White-Out</span>
                      </button>
                    </div>
                  </div>

                  {/* Freehand Draw Tools */}
                  <div className="border-t border-slate-100 pt-3.5 flex flex-col gap-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-700">Freehand Markup</span>
                      {activePage.annotations.length > 0 && (
                        <button
                          type="button"
                          onClick={undoLastAnnotation}
                          className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                        >
                          <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Undo</span>
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setDrawTool((t) => (t === 'highlighter' ? 'none' : 'highlighter'))
                        }
                        className={`flex items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-medium cursor-pointer ${
                          drawTool === 'highlighter'
                            ? 'border-teal-600 bg-teal-50 text-teal-900'
                            : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <Highlighter className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Highlighter</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setDrawTool((t) => (t === 'pen' ? 'none' : 'pen'))}
                        className={`flex items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-medium cursor-pointer ${
                          drawTool === 'pen'
                            ? 'border-teal-600 bg-teal-50 text-teal-900'
                            : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <PenTool className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Ink Pen</span>
                      </button>
                    </div>

                    {drawTool !== 'none' && (
                      <div className="flex flex-col gap-2 rounded-lg bg-slate-50 p-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-medium text-slate-600">Color</span>
                          <div className="flex items-center gap-1.5">
                            {(drawTool === 'highlighter'
                              ? ['#facc15', '#4ade80', '#38bdf8', '#f472b6']
                              : ['#0f172a', '#b91c1c', '#1d4ed8', '#047857']
                            ).map((hex) => {
                              const current = drawTool === 'highlighter' ? strokeColor : penColor;
                              return (
                                <button
                                  key={hex}
                                  type="button"
                                  aria-label={`Stroke color ${hex}`}
                                  onClick={() =>
                                    drawTool === 'highlighter'
                                      ? setStrokeColor(hex)
                                      : setPenColor(hex)
                                  }
                                  style={{ backgroundColor: hex }}
                                  className={`h-5 w-5 rounded-full border-2 cursor-pointer ${
                                    current === hex ? 'border-slate-900 scale-110' : 'border-white'
                                  }`}
                                />
                              );
                            })}
                          </div>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-medium text-slate-600">Thickness</span>
                          <div className="flex items-center gap-1">
                            {(['thin', 'med', 'thick'] as const).map((sz) => (
                              <button
                                key={sz}
                                type="button"
                                onClick={() => setStrokeSize(sz)}
                                className={`rounded px-2 py-0.5 text-[11px] font-medium capitalize cursor-pointer ${
                                  strokeSize === sz
                                    ? 'bg-slate-900 text-white'
                                    : 'bg-white text-slate-600 border border-slate-200'
                                }`}
                              >
                                {sz}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Active Overlays List */}
                  {activePage.annotations.length > 0 && (
                    <div className="border-t border-slate-100 pt-3.5">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-700">
                          Page Overlays ({activePage.annotations.length})
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            updateActivePage((p) => ({ ...p, annotations: [] }));
                            setSelectedAnnId(null);
                          }}
                          className="text-xs text-red-600 hover:underline cursor-pointer"
                        >
                          Clear All
                        </button>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {activePage.annotations.map((a, idx) => (
                          <div
                            key={a.id}
                            className={`flex items-center justify-between rounded px-2.5 py-1.5 text-xs ${
                              selectedAnnId === a.id
                                ? 'bg-teal-50 text-teal-950 font-semibold'
                                : 'bg-slate-50 text-slate-700'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                if (a.type !== 'stroke') setSelectedAnnId(a.id);
                              }}
                              className="flex-1 truncate text-left capitalize cursor-pointer"
                            >
                              {idx + 1}. {a.type}
                              {a.text ? `: ${a.text}` : ''}
                            </button>
                            <button
                              type="button"
                              onClick={() => removeAnnotation(a.id)}
                              aria-label={`Remove ${a.type}`}
                              className="text-slate-400 hover:text-red-600 cursor-pointer ml-2"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* WATERMARK TAB */}
              {inspectorTab === 'watermark' && (
                <div className="flex flex-col gap-4">
                  <label className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-800 cursor-pointer">
                    <span>Enable Page Watermark</span>
                    <input
                      type="checkbox"
                      checked={activePage.watermark.enabled}
                      onChange={(e) => updateWatermark({ enabled: e.target.checked })}
                      className="h-4 w-4 accent-teal-600"
                    />
                  </label>

                  <div>
                    <label htmlFor="wm-text" className="block text-xs font-medium text-slate-600 mb-1">
                      Watermark Text
                    </label>
                    <input
                      id="wm-text"
                      type="text"
                      value={activePage.watermark.text}
                      onChange={(e) => updateWatermark({ text: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-teal-600 focus:outline-none"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-700">Color</span>
                    <div className="flex items-center gap-1.5">
                      {WATERMARK_COLORS.map((hex) => (
                        <button
                          key={hex}
                          type="button"
                          onClick={() => updateWatermark({ color: hex })}
                          aria-label={`Watermark color ${hex}`}
                          style={{ backgroundColor: hex }}
                          className={`h-6 w-6 rounded-full border-2 cursor-pointer ${
                            activePage.watermark.color === hex
                              ? 'border-teal-600 scale-110'
                              : 'border-white'
                          }`}
                        />
                      ))}
                    </div>
                  </div>

                  <label className="flex items-center justify-between text-xs font-medium text-slate-700 cursor-pointer">
                    <span>Tiled Pattern Across Page</span>
                    <input
                      type="checkbox"
                      checked={activePage.watermark.tiled}
                      onChange={(e) => updateWatermark({ tiled: e.target.checked })}
                      className="h-4 w-4 accent-teal-600"
                    />
                  </label>

                  <div>
                    <div className="mb-1 flex justify-between text-xs text-slate-600">
                      <span>Opacity</span>
                      <span className="font-mono-tabular">
                        {Math.round(activePage.watermark.opacity * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.08}
                      max={0.65}
                      step={0.02}
                      value={activePage.watermark.opacity}
                      aria-label="Watermark opacity"
                      onChange={(e) => updateWatermark({ opacity: Number(e.target.value) })}
                      className="studio-slider w-full"
                    />
                  </div>

                  <div>
                    <div className="mb-1 flex justify-between text-xs text-slate-600">
                      <span>Rotation Angle</span>
                      <span className="font-mono-tabular">{activePage.watermark.angle}°</span>
                    </div>
                    <input
                      type="range"
                      min={-60}
                      max={60}
                      step={2}
                      value={activePage.watermark.angle}
                      aria-label="Watermark angle"
                      onChange={(e) => updateWatermark({ angle: Number(e.target.value) })}
                      className="studio-slider w-full"
                    />
                  </div>

                  {document.pages.length > 1 && (
                    <button
                      type="button"
                      data-testid="desktop-apply-watermark-all"
                      onClick={handleApplyWatermarkAllPages}
                      className="min-h-[38px] rounded-xl border border-teal-200 bg-teal-50/70 px-3 text-xs font-semibold text-teal-800 hover:bg-teal-100 cursor-pointer"
                    >
                      Apply Watermark to All {document.pages.length} Pages
                    </button>
                  )}
                </div>
              )}

            </div>
          </aside>
        )}
      </div>

      {/* MOBILE COLLAPSIBLE EDIT TOOL TRAY + 5-TAB EDIT DOCK — ONLY shown in EDIT MODE */}
      {editorMode === 'edit' && (
        <div
          data-testid="edit-mode-mobile-dock"
          className="lg:hidden shrink-0 border-t border-slate-200 bg-white pb-safe"
        >
          {mobileTrayOpen && (
            <div className="max-h-[42dvh] overflow-y-auto border-b border-slate-200 bg-white px-4 py-3 animate-sheet-up">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 capitalize">
                  {mobileTab}
                </span>
                <button
                  type="button"
                  onClick={() => setMobileTrayOpen(false)}
                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 cursor-pointer"
                >
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  <span>Hide</span>
                </button>
              </div>

              {mobileTab === 'enhance' && (
                <div className="flex flex-col gap-3">
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {FILTER_PRESETS.map((preset) => {
                      const active = activePage.filter === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => handleFilterClick(preset.id)}
                          className={`shrink-0 rounded-xl border px-3.5 py-2.5 text-xs font-semibold whitespace-nowrap active:scale-95 transition-transform cursor-pointer ${
                            active
                              ? 'border-teal-600 bg-teal-50 text-teal-900'
                              : 'border-slate-200 bg-white text-slate-700'
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => handleRotate(-90)}
                      className="flex min-h-[44px] items-center justify-center gap-1 rounded-xl border border-slate-200 text-xs font-medium text-slate-700"
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>-90°</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRotate(90)}
                      className="flex min-h-[44px] items-center justify-center gap-1 rounded-xl border border-slate-200 text-xs font-medium text-slate-700"
                    >
                      <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>+90°</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleFlip}
                      className="flex min-h-[44px] items-center justify-center gap-1 rounded-xl border border-slate-200 text-xs font-medium text-slate-700"
                    >
                      <FlipHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Flip</span>
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {BACKGROUND_FINISHES.map((bg) => (
                      <button
                        key={bg.id}
                        type="button"
                        onClick={() => handleBackgroundChange(bg.value)}
                        className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${
                          (activePage.backgroundColor || '#ffffff') === bg.value
                            ? 'border-teal-600 bg-teal-50 text-teal-900'
                            : 'border-slate-200 bg-white text-slate-700'
                        }`}
                      >
                        <span
                          className="h-3 w-3 rounded-sm border border-slate-300"
                          style={
                            bg.value === 'transparent'
                              ? {
                                  backgroundImage:
                                    'linear-gradient(45deg, #cbd5e1 25%, transparent 25%), linear-gradient(-45deg, #cbd5e1 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #cbd5e1 75%), linear-gradient(-45deg, transparent 75%, #cbd5e1 75%)',
                                  backgroundSize: '6px 6px',
                                }
                              : { backgroundColor: bg.value }
                          }
                        />
                        <span>{bg.label}</span>
                      </button>
                    ))}
                  </div>
                  {document.pages.length > 1 && (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        data-testid="mobile-apply-filter-all"
                        onClick={handleApplyFilterAllPages}
                        className="flex min-h-[40px] items-center justify-center rounded-xl border border-teal-200 bg-teal-50 px-2.5 text-[11px] font-semibold text-teal-800"
                      >
                        Apply Filter to All
                      </button>
                      <button
                        type="button"
                        data-testid="mobile-apply-orientation-all"
                        onClick={handleApplyOrientationAllPages}
                        className="flex min-h-[40px] items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-2.5 text-[11px] font-semibold text-slate-700"
                      >
                        Apply Rotation to All
                      </button>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    {(
                      [
                        { key: 'brightness', label: 'Brightness', min: -60, max: 60 },
                        { key: 'contrast', label: 'Contrast', min: -60, max: 60 },
                        { key: 'saturation', label: 'Saturation', min: -100, max: 80 },
                        { key: 'sharpness', label: 'Sharpness', min: 0, max: 100 },
                        { key: 'shadowRemoval', label: 'Shadow Lift', min: 0, max: 100 },
                      ] as const
                    ).map((ctrl) => (
                      <div key={ctrl.key}>
                        <div className="mb-1 flex justify-between text-[11px] text-slate-600">
                          <span>{ctrl.label}</span>
                          <span className="font-mono-tabular">{activePage.adjustments[ctrl.key]}</span>
                        </div>
                        <input
                          type="range"
                          min={ctrl.min}
                          max={ctrl.max}
                          value={activePage.adjustments[ctrl.key]}
                          aria-label={`Mobile ${ctrl.label}`}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            const nextAdj = { ...activePage.adjustments, [ctrl.key]: val };
                            updateActivePage((p) => ({ ...p, adjustments: nextAdj }));
                          }}
                          onMouseUp={(e) => {
                            const val = Number((e.target as HTMLInputElement).value);
                            const nextAdj = { ...activePage.adjustments, [ctrl.key]: val };
                            reprocessAndUpdatePage(
                              activePage,
                              activePage.filter,
                              nextAdj,
                              activePage.rotation,
                              activePage.flipH
                            );
                          }}
                          onTouchEnd={(e) => {
                            const val = Number((e.target as HTMLInputElement).value);
                            const nextAdj = { ...activePage.adjustments, [ctrl.key]: val };
                            reprocessAndUpdatePage(
                              activePage,
                              activePage.filter,
                              nextAdj,
                              activePage.rotation,
                              activePage.flipH
                            );
                          }}
                          className="studio-slider w-full"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {mobileTab === 'markup' && (
                <div className="flex flex-col gap-3">
                  {/* Contextual Selected Overlay Editor on Mobile */}
                  {selectedAnn && (
                    <OverlayPropertiesBar
                      compact
                      annotation={selectedAnn}
                      aspectLocked={aspectLocked}
                      onToggleAspectLock={() => setAspectLocked((v) => !v)}
                      onUpdate={(patch) => patchAnnotation(selectedAnn.id, patch)}
                      onDuplicate={() => duplicateAnnotation(selectedAnn)}
                      onDelete={() => removeAnnotation(selectedAnn.id)}
                    />
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setSignatureModalOpen(true)}
                      className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-teal-600 text-xs font-semibold text-white cursor-pointer"
                    >
                      <PenTool className="h-4 w-4" aria-hidden="true" />
                      <span>Add Signature</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => addTextStamp()}
                      className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-slate-900 text-xs font-semibold text-white cursor-pointer"
                    >
                      <Type className="h-4 w-4" aria-hidden="true" />
                      <span>Add Text</span>
                    </button>
                  </div>

                  {savedSignatures.length > 0 && (
                    <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
                      {savedSignatures.map((sig) => (
                        <button
                          key={sig.id}
                          type="button"
                          onClick={() => placeSignature(sig)}
                          className="flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-800"
                        >
                          <img src={sig.dataUrl} alt={sig.label} className="h-6 w-12 object-contain" />
                          <span>+ {sig.label}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-4 gap-1.5">
                    <button
                      type="button"
                      onClick={() => addRedactionBox('#09090b')}
                      className="flex min-h-[42px] items-center justify-center gap-1 rounded-xl border border-slate-200 text-[11px] font-medium text-slate-800"
                    >
                      <Square className="h-3 w-3 fill-zinc-900" aria-hidden="true" />
                      <span>Redact</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => addRedactionBox('#ffffff')}
                      className="flex min-h-[42px] items-center justify-center gap-1 rounded-xl border border-slate-200 text-[11px] font-medium text-slate-800"
                    >
                      <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Erase</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setDrawTool((t) => (t === 'highlighter' ? 'none' : 'highlighter'))
                      }
                      className={`flex min-h-[42px] items-center justify-center gap-1 rounded-xl border text-[11px] font-medium ${
                        drawTool === 'highlighter'
                          ? 'border-teal-600 bg-teal-50 text-teal-900'
                          : 'border-slate-200 text-slate-700'
                      }`}
                    >
                      <Highlighter className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Hi-lite</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDrawTool((t) => (t === 'pen' ? 'none' : 'pen'))}
                      className={`flex min-h-[42px] items-center justify-center gap-1 rounded-xl border text-[11px] font-medium ${
                        drawTool === 'pen'
                          ? 'border-teal-600 bg-teal-50 text-teal-900'
                          : 'border-slate-200 text-slate-700'
                      }`}
                    >
                      <PenTool className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Pen</span>
                    </button>
                  </div>

                  {activePage.annotations.length > 0 && (
                    <div className="flex items-center justify-between pt-0.5 text-xs">
                      <span className="text-slate-500">
                        {activePage.annotations.length} overlay(s)
                      </span>
                      <button
                        type="button"
                        onClick={undoLastAnnotation}
                        className="inline-flex items-center gap-1 font-medium text-slate-700"
                      >
                        <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Undo Last</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {mobileTab === 'watermark' && (
                <div className="flex flex-col gap-3">
                  <label className="flex min-h-[44px] items-center justify-between rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-800">
                    <span>Enable Watermark</span>
                    <input
                      type="checkbox"
                      checked={activePage.watermark.enabled}
                      onChange={(e) => updateWatermark({ enabled: e.target.checked })}
                      className="h-4 w-4 accent-teal-600"
                    />
                  </label>
                  <input
                    type="text"
                    value={activePage.watermark.text}
                    onChange={(e) => updateWatermark({ text: e.target.value })}
                    aria-label="Mobile watermark text"
                    className="min-h-[44px] w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-900"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-600">Color</span>
                    <div className="flex items-center gap-2">
                      {WATERMARK_COLORS.map((hex) => (
                        <button
                          key={hex}
                          type="button"
                          onClick={() => updateWatermark({ color: hex })}
                          aria-label={`Mobile watermark color ${hex}`}
                          style={{ backgroundColor: hex }}
                          className={`h-6 w-6 rounded-full border-2 ${
                            activePage.watermark.color === hex
                              ? 'border-teal-600'
                              : 'border-white'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                  {document.pages.length > 1 && (
                    <button
                      type="button"
                      data-testid="mobile-apply-watermark-all"
                      onClick={handleApplyWatermarkAllPages}
                      className="min-h-[42px] rounded-xl border border-teal-200 bg-teal-50 px-3 text-xs font-semibold text-teal-800"
                    >
                      Apply Watermark to All Pages
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 3-Tab Mobile Edit Dock (NO OCR or Pages in Edit Mode) */}
          <div className="grid grid-cols-3 h-[58px] px-2">
            {(
              [
                { id: 'enhance', label: 'Enhance', icon: Wand2 },
                { id: 'markup', label: 'Markup', icon: PenTool },
                { id: 'watermark', label: 'Watermark', icon: Stamp },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const active = mobileTrayOpen && mobileTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    haptics.tap();
                    if (mobileTrayOpen && mobileTab === tab.id) {
                      setMobileTrayOpen(false);
                    } else {
                      setMobileTab(tab.id);
                      setMobileTrayOpen(true);
                      if (tab.id !== 'markup') setDrawTool('none');
                    }
                  }}
                  className={`flex flex-col items-center justify-center min-h-[44px] active:scale-95 transition-transform cursor-pointer ${
                    active ? 'text-teal-700' : 'text-slate-600'
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  <span className="mt-0.5 text-[10px] font-semibold tracking-tight">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Inline Re-Crop Modal (ONLY accessible from Edit Mode) */}
      {recropOpen && recropQuad && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Re-crop perspective corners"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/65 p-0 sm:p-4 backdrop-blur-xs"
        >
          <div className="flex w-full max-w-4xl flex-col rounded-t-3xl sm:rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden animate-sheet-up pb-safe">
            <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-slate-300 sm:hidden" />
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <h2 className="text-base font-bold text-slate-900">Adjust Perspective Crop</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setRecropOpen(false)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleApplyRecrop}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 cursor-pointer"
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Apply Perspective Crop</span>
                </button>
              </div>
            </div>
            <div className="p-5">
              <PerspectiveCropCanvas
                imageSrc={activePage.originalDataUrl}
                quad={recropQuad}
                onChange={setRecropQuad}
                detecting={detectingQuad}
                onAutoDetect={async () => {
                  setDetectingQuad(true);
                  try {
                    const detected = await detectCornersFromDataUrl(activePage.originalDataUrl);
                    setRecropQuad(detected);
                  } finally {
                    setDetectingQuad(false);
                  }
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* E-Signature Creator Modal */}
      <SignatureModal
        isOpen={signatureModalOpen}
        onClose={() => setSignatureModalOpen(false)}
        onSaveSignature={(sig) => {
          onSaveNewSignature(sig);
          placeSignature(sig);
        }}
        onSaveAsDocument={onSaveSignatureAsDocument}
      />

      {/* Save or Discard Unsaved Scan / Edit Changes Dialog */}
      {confirmDiscardOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="save-discard-title"
          data-testid="save-discard-dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <h2 id="save-discard-title" className="text-base font-bold text-slate-900">
              {isDraftScan ? 'Save or Discard Scan?' : 'Save or Discard Changes?'}
            </h2>
            <p className="mt-1.5 text-sm text-slate-600">
              {isDraftScan
                ? 'Save this captured scan to your Library, or discard it without saving.'
                : 'You have unsaved edits on this document. Would you like to keep them or discard?'}
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                data-testid="confirm-save-btn"
                onClick={handleSaveEdits}
                className="min-h-[44px] w-full rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 cursor-pointer"
              >
                {isDraftScan ? 'Save to Library' : 'Save Changes'}
              </button>
              <button
                type="button"
                data-testid="confirm-discard-btn"
                onClick={() => {
                  haptics.warning();
                  performDiscard();
                }}
                className="min-h-[44px] w-full rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 cursor-pointer"
              >
                {isDraftScan ? 'Discard Scan' : 'Discard Changes'}
              </button>
              <button
                type="button"
                data-testid="keep-editing-btn"
                onClick={() => setConfirmDiscardOpen(false)}
                className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Keep Editing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
