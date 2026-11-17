import { useEffect, useState } from 'react';
import type {
  ActiveWorkspaceView,
  FolderId,
  QuadCorners,
  SavedSignature,
  ScanDocument,
  ScannedPage,
} from './types/scanner';
import { DEFAULT_ADJUSTMENTS, DEFAULT_WATERMARK } from './types/scanner';
import {
  deleteDocumentFromDb,
  deleteSignatureFromDb,
  ensureSeedDocuments,
  loadAllSignatures,
  resetWorkspaceDb,
  saveDocumentToDb,
  saveSignatureToDb,
} from './utils/storage';
import {
  loadAppSettings,
  mergeSettingsPatch,
  saveAppSettings,
  toggleFavoriteToolInList,
  type AppSettings,
  type ToolId,
} from './utils/settingsStore';
import { applyBrowserThemeColor, applyThemeClass, resolveTheme } from './utils/theme';
import {
  base64UrlToUint8,
  uint8ToDataUrl,
  type DecodedQrPayload,
} from './utils/qrTransfer';
import { renderPdfFileToImages } from './utils/pdfTools';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TopBar } from './components/TopBar';
import { MobileBottomBar } from './components/MobileBottomBar';
import { LibraryView } from './components/LibraryView';
import { ProjectDetailsView } from './components/ProjectDetailsView';
import { ProjectEditModal } from './components/ProjectEditModal';
import { DocumentEditor } from './components/DocumentEditor';
import { CameraScanner, type CameraScanMode } from './components/CameraScanner';
import { IdCardStudio } from './components/IdCardStudio';
import { ExportModal } from './components/ExportModal';
import { QrShareModal } from './components/QrShareModal';
import { KotlinBlueprintModal } from './components/KotlinBlueprintModal';
import { SignatureModal, type SignatureDocPayload } from './components/SignatureModal';
import { ToolsView } from './components/ToolsView';
import { ProfileView } from './components/ProfileView';
import { SettingsView } from './components/SettingsView';
import { OnboardingFlow } from './components/OnboardingFlow';
import { InfoPagesView, type InfoPageId } from './components/InfoPagesView';
import { OfflineIndicator } from './components/PWAInstallBanner';
import {
  loadImage,
  perspectiveDewarp,
  processPagePipeline,
  renderPageThumbnail,
} from './utils/imageProcessor';

function renderTextToDocumentPageDataUrl(title: string, bodyText: string): string {
  const c = window.document.createElement('canvas');
  c.width = 1000;
  c.height = 1350;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);

  ctx.fillStyle = '#0f766e';
  ctx.fillRect(0, 0, c.width, 16);

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 34px system-ui, -apple-system, sans-serif';
  ctx.fillText(title.slice(0, 48) || 'QR Received Note', 64, 96);

  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(64, 126);
  ctx.lineTo(936, 126);
  ctx.stroke();

  ctx.fillStyle = '#1e293b';
  ctx.font = '24px ui-monospace, SFMono-Regular, monospace';

  const lines: string[] = [];
  for (const rawLine of bodyText.split(/\r?\n/)) {
    const words = rawLine.split(' ');
    let cur = '';
    for (const w of words) {
      const cand = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(cand).width > 860 && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = cand;
      }
    }
    lines.push(cur);
  }

  let y = 180;
  for (const line of lines.slice(0, 34)) {
    ctx.fillText(line, 64, y);
    y += 34;
  }

  return c.toDataURL('image/jpeg', 0.9);
}

export default function App() {
  const [documents, setDocuments] = useState<ScanDocument[]>([]);
  const [draftDocument, setDraftDocument] = useState<ScanDocument | null>(null);
  const [savedSignatures, setSavedSignatures] = useState<SavedSignature[]>([]);
  const [loading, setLoading] = useState(true);
  const [appSettings, setAppSettings] = useState<AppSettings>(() => loadAppSettings());

  const [activeView, setActiveView] = useState<ActiveWorkspaceView>('library');
  const [libraryInitialFolder, setLibraryInitialFolder] = useState<FolderId>('all');
  const [toolsInitialId, setToolsInitialId] = useState<ToolId | null>(null);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [editorInitialMode, setEditorInitialMode] = useState<'view' | 'edit'>('view');
  const [editorInitialPageIdx, setEditorInitialPageIdx] = useState(0);
  const [editorSessionId, setEditorSessionId] = useState(0);
  const [returnToProjectOnCommit, setReturnToProjectOnCommit] = useState(false);

  const [editingProjectDoc, setEditingProjectDoc] = useState<ScanDocument | null>(null);
  const [onboardingReplayOpen, setOnboardingReplayOpen] = useState(false);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerInitialMode, setScannerInitialMode] = useState<CameraScanMode>('auto');
  const [scannerInitialSource, setScannerInitialSource] = useState<'camera' | 'samples'>('camera');
  const [scannerInitialFiles, setScannerInitialFiles] = useState<File[] | null>(null);
  const [appendTargetDocId, setAppendTargetDocId] = useState<string | null>(null);

  const [initialIdPair, setInitialIdPair] = useState<{
    front: { originalUrl: string; quad: QuadCorners; dewarpedUrl: string };
    back: { originalUrl: string; quad: QuadCorners; dewarpedUrl: string };
  } | null>(null);

  const [exportState, setExportState] = useState<{
    doc: ScanDocument;
    pageIndex: number;
    selectedPages?: number[];
  } | null>(null);

  const [qrShareState, setQrShareState] = useState<{
    isOpen: boolean;
    doc: ScanDocument | null;
    pageIndex: number;
  }>({ isOpen: false, doc: null, pageIndex: 0 });

  const [librarySignatureModalOpen, setLibrarySignatureModalOpen] = useState(false);
  const [kotlinModalOpen, setKotlinModalOpen] = useState(false);

  const isAutostartBypass =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('autostart') === '1';

  const shouldShowOnboarding =
    !loading &&
    (onboardingReplayOpen || (!appSettings.hasCompletedOnboarding && !isAutostartBypass));

  useEffect(() => {
    const mql =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;

    const apply = () => {
      const resolved = resolveTheme(appSettings.theme, Boolean(mql?.matches));
      applyThemeClass(resolved);
      applyBrowserThemeColor(resolved);
    };

    apply();
    if (!mql || appSettings.theme !== 'system') return;
    mql.addEventListener('change', apply);
    return () => mql.removeEventListener('change', apply);
  }, [appSettings.theme]);

  useEffect(() => {
    let mounted = true;
    Promise.all([ensureSeedDocuments(), loadAllSignatures()])
      .then(([docs, sigs]) => {
        if (!mounted) return;
        setDocuments(docs);
        setSavedSignatures(sigs);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleUpdateSettings = (patch: Partial<AppSettings>) => {
    setAppSettings((prev) => {
      const next = mergeSettingsPatch(prev, patch);
      saveAppSettings(next);
      return next;
    });
  };

  const handleToggleFavoriteTool = (toolId: ToolId) => {
    setAppSettings((prev) => {
      const next: AppSettings = {
        ...prev,
        favoriteTools: toggleFavoriteToolInList(prev.favoriteTools, toolId),
      };
      saveAppSettings(next);
      return next;
    });
  };

  const isDraftActive = Boolean(draftDocument && draftDocument.id === activeDocId);
  const activeDocument = isDraftActive
    ? draftDocument
    : documents.find((d) => d.id === activeDocId) || null;

  const openScanner = (opts?: {
    batch?: boolean;
    mode?: CameraScanMode;
    source?: 'camera' | 'samples';
    files?: File[] | null;
    appendToDocId?: string | null;
  }) => {
    setAppendTargetDocId(opts?.appendToDocId ?? null);
    setScannerInitialMode(opts?.mode ?? (opts?.batch ? 'batch' : 'auto'));
    setScannerInitialSource(opts?.source ?? 'camera');
    setScannerInitialFiles(opts?.files ?? null);
    setScannerOpen(true);
  };

  const handleUpdateDocument = (nextDoc: ScanDocument) => {
    if (draftDocument && draftDocument.id === nextDoc.id) {
      setDraftDocument(nextDoc);
      return;
    }
    setDocuments((prev) => prev.map((d) => (d.id === nextDoc.id ? nextDoc : d)));
    saveDocumentToDb(nextDoc);
  };

  const handleCommitDocument = (finalDoc: ScanDocument) => {
    const wasDraft = Boolean(draftDocument && draftDocument.id === finalDoc.id);
    if (wasDraft) {
      setDraftDocument(null);
      setDocuments((prev) => [finalDoc, ...prev]);
      saveDocumentToDb(finalDoc);
      setActiveDocId(finalDoc.id);
      setReturnToProjectOnCommit(false);
      setActiveView('project');
      return;
    }
    setDocuments((prev) => prev.map((d) => (d.id === finalDoc.id ? finalDoc : d)));
    saveDocumentToDb(finalDoc);
    if (returnToProjectOnCommit) {
      setReturnToProjectOnCommit(false);
      setActiveView('project');
    }
  };

  const handleDiscardDraft = () => {
    setDraftDocument(null);
    setReturnToProjectOnCommit(false);
    setActiveDocId(null);
    setActiveView('library');
  };

  const handleCompleteScannedPages = (
    pages: ScannedPage[],
    meta: { title: string; folder: ScanDocument['folder']; appendToDocId?: string | null }
  ) => {
    if (meta.appendToDocId) {
      const target =
        draftDocument && draftDocument.id === meta.appendToDocId
          ? draftDocument
          : documents.find((d) => d.id === meta.appendToDocId);
      if (target) {
        const firstNewIdx = target.pages.length;
        const updated: ScanDocument = {
          ...target,
          pages: [...target.pages, ...pages],
          updatedAt: Date.now(),
        };
        handleUpdateDocument(updated);
        setActiveDocId(updated.id);
        setEditorInitialMode('edit');
        setEditorInitialPageIdx(firstNewIdx);
        setReturnToProjectOnCommit(true);
        setEditorSessionId((s) => s + 1);
        setActiveView('editor');
        return;
      }
    }

    const now = Date.now();
    const newDraft: ScanDocument = {
      id: crypto.randomUUID(),
      title: meta.title,
      folder: meta.folder,
      starred: false,
      pages,
      createdAt: now,
      updatedAt: now,
    };
    setDraftDocument(newDraft);
    setActiveDocId(newDraft.id);
    setEditorInitialMode('edit');
    setEditorInitialPageIdx(0);
    setReturnToProjectOnCommit(true);
    setEditorSessionId((s) => s + 1);
    setActiveView('editor');
  };

  const handleCompleteIdPair = async (
    frontOriginalUrl: string,
    frontQuad: QuadCorners,
    backOriginalUrl: string,
    backQuad: QuadCorners
  ) => {
    const [frontDewarped, backDewarped] = await Promise.all([
      perspectiveDewarp(frontOriginalUrl, frontQuad, 1000),
      perspectiveDewarp(backOriginalUrl, backQuad, 1000),
    ]);
    setInitialIdPair({
      front: { originalUrl: frontOriginalUrl, quad: frontQuad, dewarpedUrl: frontDewarped.dataUrl },
      back: { originalUrl: backOriginalUrl, quad: backQuad, dewarpedUrl: backDewarped.dataUrl },
    });
    setActiveView('id_studio');
  };

  const handleSaveIdDocument = (doc: ScanDocument) => {
    setDocuments((prev) => [doc, ...prev]);
    saveDocumentToDb(doc);
    setActiveDocId(doc.id);
    setReturnToProjectOnCommit(false);
    setActiveView('project');
  };

  const handleSaveImagesAsProject = async (
    title: string,
    imageUrls: string[],
    folder: ScanDocument['folder'] = 'documents',
    ocrTexts?: string[]
  ) => {
    if (imageUrls.length === 0) return;
    const now = Date.now();
    const builtPages: ScannedPage[] = [];
    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i];
      const processed = await processPagePipeline(
        url,
        'original',
        { ...DEFAULT_ADJUSTMENTS, sharpness: 0 },
        0,
        false,
        { maxDim: 1600, backgroundColor: '#ffffff' }
      );
      const page: ScannedPage = {
        id: crypto.randomUUID(),
        originalDataUrl: url,
        croppedDataUrl: url,
        processedDataUrl: processed.dataUrl,
        thumbnailDataUrl: processed.dataUrl,
        quad: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
        filter: 'original',
        adjustments: { ...DEFAULT_ADJUSTMENTS, sharpness: 0 },
        rotation: 0,
        flipH: false,
        annotations: [],
        watermark: { ...DEFAULT_WATERMARK },
        ocrText: ocrTexts?.[i] || '',
        width: processed.width,
        height: processed.height,
        createdAt: now,
      };
      page.thumbnailDataUrl = await renderPageThumbnail(page, 420);
      builtPages.push(page);
    }

    const doc: ScanDocument = {
      id: crypto.randomUUID(),
      title: title.trim() || 'Tool Export',
      folder,
      starred: false,
      pages: builtPages,
      createdAt: now,
      updatedAt: now,
    };
    setDocuments((prev) => [doc, ...prev]);
    saveDocumentToDb(doc);
    setActiveDocId(doc.id);
    setReturnToProjectOnCommit(false);
    setActiveView('project');
  };

  const handleQrFileReceived = async (payload: DecodedQrPayload) => {
    if (payload.kind === 'bitscan_doc' && payload.pages && payload.pages.length > 0) {
      const urls = payload.pages.map((p) => uint8ToDataUrl(base64UrlToUint8(p.dataB64), p.mime));
      const ocrTexts = payload.pages.map((p) => p.ocrText || '');
      await handleSaveImagesAsProject(payload.title || 'QR Shared Scan', urls, 'documents', ocrTexts);
      return;
    }

    if (payload.kind === 'text' && payload.text !== undefined) {
      const pageImg = renderTextToDocumentPageDataUrl(payload.title || 'QR Note', payload.text);
      if (pageImg) {
        await handleSaveImagesAsProject(payload.title || 'QR Note', [pageImg], 'notes', [
          payload.text,
        ]);
      }
      return;
    }

    if (payload.kind === 'raw_file' && payload.fileBytes) {
      if (payload.mime.startsWith('image/')) {
        const url = uint8ToDataUrl(payload.fileBytes, payload.mime);
        await handleSaveImagesAsProject(payload.title || 'QR Image', [url], 'documents');
        return;
      }

      if (payload.mime === 'application/pdf' || /\.pdf$/i.test(payload.filename)) {
        const copy = new Uint8Array(payload.fileBytes.byteLength);
        copy.set(payload.fileBytes);
        const file = new File([copy.buffer], payload.filename, { type: 'application/pdf' });
        const rendered = await renderPdfFileToImages(file, { scale: 2, format: 'jpeg' });
        if (rendered.length > 0) {
          await handleSaveImagesAsProject(
            payload.title || 'QR PDF Document',
            rendered.map((r) => r.dataUrl),
            'documents'
          );
          return;
        }
      }

      if (payload.mime.startsWith('text/') || /\.(txt|json|csv|md)$/i.test(payload.filename)) {
        const text = new TextDecoder().decode(payload.fileBytes);
        const pageImg = renderTextToDocumentPageDataUrl(payload.title || payload.filename, text);
        if (pageImg) {
          await handleSaveImagesAsProject(payload.title || payload.filename, [pageImg], 'notes', [
            text,
          ]);
          return;
        }
      }

      // Trigger direct download for arbitrary binary file formats
      const copy = new Uint8Array(payload.fileBytes.byteLength);
      copy.set(payload.fileBytes);
      const blob = new Blob([copy.buffer], { type: payload.mime });
      const dlUrl = URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = dlUrl;
      a.download = payload.filename;
      window.document.body.appendChild(a);
      a.click();
      window.document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(dlUrl), 1000);
    }
  };

  const handleDeleteDocument = (docId: string) => {
    setDocuments((prev) => prev.filter((d) => d.id !== docId));
    deleteDocumentFromDb(docId);
    if (activeDocId === docId) {
      setActiveDocId(null);
      setActiveView('library');
    }
  };

  const handleToggleStar = (docId: string) => {
    const target = documents.find((d) => d.id === docId);
    if (!target) return;
    handleUpdateDocument({ ...target, starred: !target.starred, updatedAt: Date.now() });
  };

  const handleRenameDocument = (docId: string, nextTitle: string) => {
    const target = documents.find((d) => d.id === docId);
    if (!target) return;
    handleUpdateDocument({ ...target, title: nextTitle, updatedAt: Date.now() });
  };

  const handleSaveSignature = (sig: SavedSignature) => {
    setSavedSignatures((prev) => [sig, ...prev]);
    saveSignatureToDb(sig);
  };

  const handleDeleteSignature = (sigId: string) => {
    setSavedSignatures((prev) => prev.filter((s) => s.id !== sigId));
    deleteSignatureFromDb(sigId);
  };

  const handleSaveSignatureAsDocument = async (payload: SignatureDocPayload) => {
    handleSaveSignature({
      id: crypto.randomUUID(),
      label: payload.label,
      dataUrl: payload.compositedDataUrl,
      backgroundColor: payload.backgroundColor,
      createdAt: Date.now(),
    });

    const bgChoice = payload.backgroundColor || 'transparent';
    const processed = await processPagePipeline(
      payload.transparentDataUrl,
      'original',
      { ...DEFAULT_ADJUSTMENTS, sharpness: 0 },
      0,
      false,
      { maxDim: 1200, backgroundColor: bgChoice }
    );

    const now = Date.now();
    const sigPage: ScannedPage = {
      id: crypto.randomUUID(),
      originalDataUrl: payload.transparentDataUrl,
      croppedDataUrl: payload.transparentDataUrl,
      processedDataUrl: processed.dataUrl,
      thumbnailDataUrl: processed.dataUrl,
      quad: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      filter: 'original',
      adjustments: { ...DEFAULT_ADJUSTMENTS, sharpness: 0 },
      rotation: 0,
      flipH: false,
      annotations: [],
      watermark: { ...DEFAULT_WATERMARK },
      backgroundColor: bgChoice,
      ocrText: '',
      width: processed.width,
      height: processed.height,
      createdAt: now,
    };

    const sigDoc: ScanDocument = {
      id: crypto.randomUUID(),
      title: payload.label || 'Signature',
      folder: 'signatures',
      starred: false,
      pages: [sigPage],
      createdAt: now,
      updatedAt: now,
    };

    setDocuments((prev) => [sigDoc, ...prev]);
    saveDocumentToDb(sigDoc);
    setActiveDocId(sigDoc.id);
    setReturnToProjectOnCommit(false);
    setActiveView('project');
  };

  const handleOpenSavedSignatureAsDoc = async (sig: SavedSignature) => {
    const img = await loadImage(sig.dataUrl).catch(() => null);
    await handleSaveSignatureAsDocument({
      label: sig.label,
      transparentDataUrl: sig.dataUrl,
      compositedDataUrl: sig.dataUrl,
      backgroundColor: sig.backgroundColor || 'transparent',
      width: img?.naturalWidth || 720,
      height: img?.naturalHeight || 260,
    });
  };

  const handleOpenToolShortcut = (toolId?: ToolId) => {
    if (toolId === 'id_card') {
      setActiveView('id_studio');
      return;
    }
    if (toolId === 'sign_doc') {
      setLibrarySignatureModalOpen(true);
      return;
    }
    if (toolId === 'qr_share') {
      setQrShareState({ isOpen: true, doc: documents[0] || null, pageIndex: 0 });
      return;
    }
    if (toolId === 'qr_scan') {
      openScanner({ mode: 'qr' });
      return;
    }
    setToolsInitialId(toolId ?? null);
    setActiveView('tools');
  };

  const handleResetLocalWorkspace = async () => {
    const docs = await resetWorkspaceDb();
    setDocuments(docs);
    setSavedSignatures([]);
    setDraftDocument(null);
    setActiveDocId(null);
    setLibraryInitialFolder('all');
    setActiveView('library');
  };

  const handleImportWorkspace = async (
    importedDocs: ScanDocument[],
    importedSigs: SavedSignature[]
  ) => {
    for (const doc of importedDocs) {
      await saveDocumentToDb(doc);
    }
    for (const sig of importedSigs) {
      await saveSignatureToDb(sig);
    }
    setDocuments((prev) => {
      const map = new Map(prev.map((d) => [d.id, d]));
      for (const doc of importedDocs) map.set(doc.id, doc);
      return Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt);
    });
    setSavedSignatures((prev) => {
      const map = new Map(prev.map((s) => [s.id, s]));
      for (const sig of importedSigs) map.set(sig.id, sig);
      return Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);
    });
  };

  const navigateTopOrBottom = (view: ActiveWorkspaceView) => {
    if (view === 'tools') {
      setToolsInitialId(null);
    }
    if (view === 'library') {
      setLibraryInitialFolder('all');
    }
    setActiveView(view);
    if (view !== 'editor' && view !== 'project') {
      setDraftDocument(null);
      setActiveDocId(null);
    }
  };

  const isInfoView =
    activeView === 'about' ||
    activeView === 'release_notes' ||
    activeView === 'privacy' ||
    activeView === 'help';

  const hideMainChrome =
    activeView === 'editor' ||
    activeView === 'project' ||
    activeView === 'settings' ||
    isInfoView;

  return (
    <div
      className={`${
        activeView === 'editor'
          ? 'flex h-[100dvh] flex-col overflow-hidden bg-slate-50 text-slate-900'
          : 'flex min-h-[100dvh] flex-col bg-slate-50 text-slate-900'
      }${appSettings.reduceMotion ? ' motion-reduce' : ''}`}
    >
      <TopBar
        activeView={activeView}
        hideAll={hideMainChrome}
        onNavigate={navigateTopOrBottom}
        onOpenNewScan={() => openScanner({ mode: 'auto' })}
      />

      <OfflineIndicator />

      {loading ? (
        <div className="mx-auto w-full max-w-[1440px] p-4 sm:p-8">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(204px,1fr))] sm:gap-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-52 sm:h-64 animate-pulse rounded-2xl border border-slate-200 bg-white"
              />
            ))}
          </div>
        </div>
      ) : activeView === 'project' && activeDocument ? (
        <ProjectDetailsView
          document={activeDocument}
          onUpdateDocument={handleUpdateDocument}
          onOpenPage={(pageIndex, mode) => {
            setEditorInitialPageIdx(pageIndex);
            setEditorInitialMode(mode);
            setReturnToProjectOnCommit(false);
            setEditorSessionId((s) => s + 1);
            setActiveView('editor');
          }}
          onAddPagesWithCamera={() =>
            openScanner({ batch: false, mode: 'docs', appendToDocId: activeDocument.id })
          }
          onImportFilesToProject={(files) =>
            openScanner({
              batch: true,
              appendToDocId: activeDocument.id,
              files: Array.from(files),
            })
          }
          onShareProject={() =>
            setQrShareState({ isOpen: true, doc: activeDocument, pageIndex: 0 })
          }
          onOpenExport={(selectedPages) =>
            setExportState({
              doc: activeDocument,
              pageIndex: selectedPages?.[0] ?? 0,
              selectedPages,
            })
          }
          onToggleStar={() => handleToggleStar(activeDocument.id)}
          onDeleteProject={() => handleDeleteDocument(activeDocument.id)}
          onBackToLibrary={() => {
            setDraftDocument(null);
            setActiveDocId(null);
            setActiveView('library');
          }}
        />
      ) : activeView === 'editor' && activeDocument ? (
        <ErrorBoundary>
          <DocumentEditor
            key={`${activeDocument.id}-${editorSessionId}`}
            document={activeDocument}
            initialMode={editorInitialMode}
            initialPageIndex={editorInitialPageIdx}
            defaultOcrLang={appSettings.defaultOcrLang}
            isDraftScan={isDraftActive}
            onDiscardDraft={handleDiscardDraft}
            savedSignatures={savedSignatures}
            onSaveNewSignature={handleSaveSignature}
            onSaveSignatureAsDocument={handleSaveSignatureAsDocument}
            onDeleteSavedSignature={handleDeleteSignature}
            onUpdateDocument={handleUpdateDocument}
            onCommitDocument={handleCommitDocument}
            onAddPagesToDoc={() =>
              openScanner({ batch: false, mode: 'docs', appendToDocId: activeDocument.id })
            }
            onOpenShareModal={(pageIndex) =>
              setQrShareState({ isOpen: true, doc: activeDocument, pageIndex })
            }
            onOpenExport={(pageIndex) => setExportState({ doc: activeDocument, pageIndex })}
            onBackToProject={() => {
              setReturnToProjectOnCommit(false);
              setActiveView('project');
            }}
            onBackToLibrary={() => {
              setDraftDocument(null);
              setActiveView('library');
              setActiveDocId(null);
            }}
          />
        </ErrorBoundary>
      ) : activeView === 'tools' ? (
        <ToolsView
          key={`tools-${toolsInitialId || 'hub'}`}
          documents={documents}
          favoriteTools={appSettings.favoriteTools}
          initialToolId={toolsInitialId}
          onToggleFavoriteTool={handleToggleFavoriteTool}
          onLaunchIdStudio={() => setActiveView('id_studio')}
          onLaunchSignatureStudio={() => setLibrarySignatureModalOpen(true)}
          onLaunchQrShare={() =>
            setQrShareState({ isOpen: true, doc: documents[0] || null, pageIndex: 0 })
          }
          onLaunchQrScan={() => openScanner({ mode: 'qr' })}
          onSaveImagesAsProject={(title, urls, folder) =>
            handleSaveImagesAsProject(title, urls, folder)
          }
          onBackToLibrary={() => setActiveView('library')}
        />
      ) : activeView === 'profile' ? (
        <ProfileView
          settings={appSettings}
          documents={documents}
          savedSignatures={savedSignatures}
          onUpdateSettings={handleUpdateSettings}
          onOpenSettings={() => setActiveView('settings')}
          onOpenInfoPage={(page) => setActiveView(page)}
          onReplayOnboarding={() => setOnboardingReplayOpen(true)}
          onOpenSignatures={() => {
            setLibraryInitialFolder('signatures');
            setActiveView('library');
          }}
          onOpenKotlinModal={() => setKotlinModalOpen(true)}
          onResetLocalWorkspace={handleResetLocalWorkspace}
        />
      ) : activeView === 'settings' ? (
        <SettingsView
          settings={appSettings}
          documents={documents}
          savedSignatures={savedSignatures}
          onUpdateSettings={handleUpdateSettings}
          onImportWorkspace={handleImportWorkspace}
          onResetLocalWorkspace={handleResetLocalWorkspace}
          onReplayOnboarding={() => setOnboardingReplayOpen(true)}
          onBackToProfile={() => setActiveView('profile')}
        />
      ) : isInfoView ? (
        <InfoPagesView
          page={activeView as InfoPageId}
          onNavigatePage={(page) => setActiveView(page)}
          onBackToProfile={() => setActiveView('profile')}
        />
      ) : activeView === 'id_studio' ? (
        <IdCardStudio
          initialPair={initialIdPair}
          onSaveIdDocument={handleSaveIdDocument}
          onBackToLibrary={() => setActiveView('library')}
        />
      ) : (
        <LibraryView
          documents={documents}
          savedSignatures={savedSignatures}
          favoriteTools={appSettings.favoriteTools}
          defaultViewMode={appSettings.defaultLibraryView}
          initialFolder={libraryInitialFolder}
          onOpenDocument={(id) => {
            setDraftDocument(null);
            setReturnToProjectOnCommit(false);
            setActiveDocId(id);
            setActiveView('project');
          }}
          onExportDocument={(doc) => setExportState({ doc, pageIndex: 0 })}
          onShareDocument={(doc) =>
            setQrShareState({ isOpen: true, doc, pageIndex: 0 })
          }
          onOpenQrScanner={() => openScanner({ mode: 'qr' })}
          onToggleStar={handleToggleStar}
          onRenameDocument={handleRenameDocument}
          onEditProject={(doc) => setEditingProjectDoc(doc)}
          onDeleteDocument={handleDeleteDocument}
          onStartNewScan={() => openScanner({ mode: 'auto' })}
          onOpenIdStudio={() => setActiveView('id_studio')}
          onOpenToolsSpace={handleOpenToolShortcut}
          onCreateSignature={() => setLibrarySignatureModalOpen(true)}
          onOpenSignatureAsDoc={handleOpenSavedSignatureAsDoc}
          onDeleteSignature={handleDeleteSignature}
        />
      )}

      <MobileBottomBar
        activeView={activeView}
        onNavigate={navigateTopOrBottom}
        onOpenNewScan={() => openScanner({ mode: 'auto' })}
      />

      <CameraScanner
        isOpen={scannerOpen}
        initialMode={scannerInitialMode}
        initialSource={scannerInitialSource}
        initialFiles={scannerInitialFiles}
        appendTargetDocId={appendTargetDocId}
        defaultFilter={appSettings.defaultFilter}
        autoEdgeDetect={appSettings.autoEdgeDetect}
        defaultFilenamePrefix={appSettings.defaultFilenamePrefix}
        onClose={() => {
          setScannerOpen(false);
          setScannerInitialFiles(null);
          setAppendTargetDocId(null);
        }}
        onCompletePages={handleCompleteScannedPages}
        onCompleteIdPair={handleCompleteIdPair}
        onQrFileReceived={(payload) => {
          void handleQrFileReceived(payload);
        }}
      />

      <QrShareModal
        isOpen={qrShareState.isOpen}
        document={qrShareState.doc}
        availableDocuments={documents}
        initialPageIndex={qrShareState.pageIndex}
        onClose={() => setQrShareState({ isOpen: false, doc: null, pageIndex: 0 })}
        onOpenExport={(doc, pageIndex) => setExportState({ doc, pageIndex })}
        onOpenQrScanner={() => openScanner({ mode: 'qr' })}
      />

      <ProjectEditModal
        document={editingProjectDoc}
        onClose={() => setEditingProjectDoc(null)}
        onSaveChanges={(nextDoc) => {
          handleUpdateDocument(nextDoc);
          setEditingProjectDoc(nextDoc);
        }}
        onDeleteProject={handleDeleteDocument}
      />

      <SignatureModal
        isOpen={librarySignatureModalOpen}
        onClose={() => setLibrarySignatureModalOpen(false)}
        onSaveSignature={handleSaveSignature}
        onSaveAsDocument={handleSaveSignatureAsDocument}
        primaryButtonLabel="Save Signature Stamp"
      />

      <ExportModal
        document={exportState?.doc || null}
        activePageIndex={exportState?.pageIndex || 0}
        initialSelectedPages={exportState?.selectedPages}
        defaultPaperSize={appSettings.defaultPaperSize}
        defaultQuality={appSettings.defaultPdfQuality}
        defaultExportFormat={appSettings.defaultExportFormat}
        defaultFilenamePrefix={appSettings.defaultFilenamePrefix}
        defaultSearchablePdf={appSettings.searchablePdfByDefault}
        onClose={() => setExportState(null)}
      />

      <OnboardingFlow
        isOpen={shouldShowOnboarding}
        initialSettings={appSettings}
        isReplay={onboardingReplayOpen}
        onComplete={(patch) => {
          handleUpdateSettings(patch);
          setOnboardingReplayOpen(false);
        }}
        onSkip={() => {
          if (!appSettings.hasCompletedOnboarding) {
            handleUpdateSettings({ hasCompletedOnboarding: true });
          }
          setOnboardingReplayOpen(false);
        }}
      />

      <KotlinBlueprintModal
        isOpen={kotlinModalOpen}
        onClose={() => setKotlinModalOpen(false)}
      />
    </div>
  );
}
