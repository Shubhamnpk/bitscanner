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
import { TopBar } from './components/TopBar';
import { MobileBottomBar } from './components/MobileBottomBar';
import { LibraryView } from './components/LibraryView';
import { ProjectDetailsView } from './components/ProjectDetailsView';
import { DocumentEditor } from './components/DocumentEditor';
import { CameraScanner, type CameraScanMode } from './components/CameraScanner';
import { IdCardStudio } from './components/IdCardStudio';
import { ExportModal } from './components/ExportModal';
import { KotlinBlueprintModal } from './components/KotlinBlueprintModal';
import { SignatureModal, type SignatureDocPayload } from './components/SignatureModal';
import { ToolsView } from './components/ToolsView';
import { ProfileView } from './components/ProfileView';
import { SettingsView } from './components/SettingsView';
import {
  loadImage,
  perspectiveDewarp,
  processPagePipeline,
  renderPageThumbnail,
} from './utils/imageProcessor';

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

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerInitialMode, setScannerInitialMode] = useState<CameraScanMode>('docs');
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

  const [librarySignatureModalOpen, setLibrarySignatureModalOpen] = useState(false);
  const [kotlinModalOpen, setKotlinModalOpen] = useState(false);

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
    setScannerInitialMode(opts?.mode ?? (opts?.batch ? 'batch' : 'docs'));
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
    folder: ScanDocument['folder'] = 'documents'
  ) => {
    if (imageUrls.length === 0) return;
    const now = Date.now();
    const builtPages: ScannedPage[] = [];
    for (const url of imageUrls) {
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
        ocrText: '',
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

  const hideMainChrome =
    activeView === 'editor' || activeView === 'project' || activeView === 'settings';

  return (
    <div
      className={
        activeView === 'editor'
          ? 'flex h-[100dvh] flex-col overflow-hidden bg-slate-50 text-slate-900'
          : 'flex min-h-[100dvh] flex-col bg-slate-50 text-slate-900'
      }
    >
      <TopBar
        activeView={activeView}
        hideAll={hideMainChrome}
        onNavigate={navigateTopOrBottom}
        onOpenNewScan={() => openScanner({ batch: false })}
      />

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
      ) : activeView === 'tools' ? (
        <ToolsView
          key={`tools-${toolsInitialId || 'hub'}`}
          documents={documents}
          favoriteTools={appSettings.favoriteTools}
          initialToolId={toolsInitialId}
          onToggleFavoriteTool={handleToggleFavoriteTool}
          onLaunchIdStudio={() => setActiveView('id_studio')}
          onLaunchSignatureStudio={() => setLibrarySignatureModalOpen(true)}
          onSaveImagesAsProject={handleSaveImagesAsProject}
          onBackToLibrary={() => setActiveView('library')}
        />
      ) : activeView === 'profile' ? (
        <ProfileView
          settings={appSettings}
          documents={documents}
          savedSignatures={savedSignatures}
          onUpdateSettings={handleUpdateSettings}
          onOpenSettings={() => setActiveView('settings')}
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
          onUpdateSettings={handleUpdateSettings}
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
          onToggleStar={handleToggleStar}
          onRenameDocument={handleRenameDocument}
          onDeleteDocument={handleDeleteDocument}
          onStartNewScan={() => openScanner({ mode: 'docs' })}
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
        onOpenNewScan={() => openScanner({ mode: 'docs' })}
      />

      <CameraScanner
        isOpen={scannerOpen}
        initialMode={scannerInitialMode}
        initialSource={scannerInitialSource}
        initialFiles={scannerInitialFiles}
        appendTargetDocId={appendTargetDocId}
        defaultFilter={appSettings.defaultFilter}
        onClose={() => {
          setScannerOpen(false);
          setScannerInitialFiles(null);
          setAppendTargetDocId(null);
        }}
        onCompletePages={handleCompleteScannedPages}
        onCompleteIdPair={handleCompleteIdPair}
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
        defaultSearchablePdf={appSettings.searchablePdfByDefault}
        onClose={() => setExportState(null)}
      />

      <KotlinBlueprintModal
        isOpen={kotlinModalOpen}
        onClose={() => setKotlinModalOpen(false)}
      />
    </div>
  );
}
