import React, { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileText,
  FileUp,
  FolderOpen,
  Pause,
  Play,
  QrCode,
  RotateCcw,
  Share2,
  X,
} from 'lucide-react';
import type { ScanDocument } from '../types/scanner';
import {
  encodePayloadToQrFrames,
  estimateQrTransferMetrics,
  MAX_QR_FILE_BYTES,
  prepareDocumentForQrShare,
  type QrChunkDensity,
} from '../utils/qrTransfer';
import { formatByteSize } from '../utils/settingsStore';
import { useHaptics } from '../hooks/useHaptics';

interface QrShareModalProps {
  isOpen: boolean;
  document: ScanDocument | null;
  availableDocuments?: ScanDocument[];
  initialPageIndex?: number;
  initialMode?: 'qr' | 'share';
  defaultShareMode?: 'qr' | 'share';
  onClose: () => void;
  onOpenExport?: (doc: ScanDocument, pageIndex: number) => void;
  onOpenQrScanner?: () => void;
}

type DocSharePreset = 'fast_image' | 'crisp_image' | 'ocr_only';

export const QrShareModal: React.FC<QrShareModalProps> = ({
  isOpen,
  document,
  availableDocuments = [],
  initialPageIndex = 0,
  initialMode = 'qr',
  defaultShareMode = 'share',
  onClose,
  onOpenExport,
  onOpenQrScanner,
}) => {
  const haptics = useHaptics();
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const customFileInputRef = useRef<HTMLInputElement | null>(null);

  const effectiveInitialTab = initialMode || defaultShareMode || 'qr';
  const [tab, setTab] = useState<'qr' | 'share'>(effectiveInitialTab);
  const [selectedDocId, setSelectedDocId] = useState<string>(document?.id || '');
  const [sourceKind, setSourceKind] = useState<'doc' | 'custom_file'>(
    document ? 'doc' : availableDocuments.length > 0 ? 'doc' : 'custom_file'
  );

  const activeDoc = useMemo(() => {
    if (document && (!selectedDocId || selectedDocId === document.id)) return document;
    return availableDocuments.find((d) => d.id === selectedDocId) || document || availableDocuments[0] || null;
  }, [document, availableDocuments, selectedDocId]);

  const [pageScope, setPageScope] = useState<'active' | 'all'>(
    document && document.pages.length > 1 ? 'active' : 'all'
  );
  const [docPreset, setDocPreset] = useState<DocSharePreset>('fast_image');
  const [density, setDensity] = useState<QrChunkDensity>('balanced');
  const [fps, setFps] = useState<number>(8);
  const [isPlaying, setIsPlaying] = useState(true);
  const [frameIdx, setFrameIdx] = useState(0);

  const [customFile, setCustomFile] = useState<File | null>(null);
  const [customFileError, setCustomFileError] = useState('');
  const [dragActive, setDragActive] = useState(false);

  const [frames, setFrames] = useState<string[]>([]);
  const [totalBytes, setTotalBytes] = useState(0);
  const [transferId, setTransferId] = useState('');
  const [summaryLabel, setSummaryLabel] = useState('');
  const [encodingBusy, setEncodingBusy] = useState(false);

  const [sysShareBusy, setSysShareBusy] = useState(false);
  const [sysShareStatus, setSysShareStatus] = useState('');
  const [copyImageStatus, setCopyImageStatus] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setTab(initialMode || defaultShareMode || 'qr');
    if (document) {
      setSelectedDocId(document.id);
      setSourceKind('doc');
      setPageScope(document.pages.length > 1 ? 'active' : 'all');
    } else if (availableDocuments.length > 0) {
      setSelectedDocId(availableDocuments[0].id);
      setSourceKind('doc');
    } else {
      setSourceKind('custom_file');
    }
    setIsPlaying(true);
    setFrameIdx(0);
    setSysShareStatus('');
    setCopyImageStatus('');
    setCustomFileError('');
  }, [isOpen, document, initialMode, defaultShareMode, availableDocuments]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const acceptCustomFile = (file: File | null) => {
    if (!file) return;
    setCustomFile(file);
    setSourceKind('custom_file');
    if (file.size > 250 * 1024) {
      setDensity('dense');
      setFps((prev) => (prev < 12 ? 12 : prev));
    }
  };

  // Encode payload into QR frames whenever source/preset/density changes
  useEffect(() => {
    if (!isOpen || tab !== 'qr') return;
    let cancelled = false;

    const runEncode = async () => {
      setEncodingBusy(true);
      try {
        if (sourceKind === 'custom_file') {
          if (!customFile) {
            if (!cancelled) {
              setFrames([]);
              setTotalBytes(0);
              setSummaryLabel('Pick or drop any file up to 5 MB');
            }
            return;
          }
          if (customFile.size > MAX_QR_FILE_BYTES) {
            if (!cancelled) {
              setCustomFileError(
                `File is ${formatByteSize(customFile.size)}, above the 5 MB QR transfer cap. Use Share & Export for instant system transfer.`
              );
              setFrames([]);
              setTotalBytes(0);
            }
            return;
          }
          setCustomFileError('');
          const buf = new Uint8Array(await customFile.arrayBuffer());
          if (cancelled) return;
          const res = await encodePayloadToQrFrames(
            {
              kind: 'raw_file',
              title: customFile.name.replace(/\.[^.]+$/, '') || 'Shared File',
              filename: customFile.name,
              mime: customFile.type || 'application/octet-stream',
              fileBytes: buf,
            },
            { density }
          );
          if (!cancelled) {
            setFrames(res.frames);
            setTotalBytes(res.totalBytes);
            setTransferId(res.transferId);
            setSummaryLabel(customFile.name);
            setFrameIdx(0);
          }
          return;
        }

        if (!activeDoc || activeDoc.pages.length === 0) {
          if (!cancelled) setFrames([]);
          return;
        }

        const clampedActiveIdx = Math.min(initialPageIndex, Math.max(0, activeDoc.pages.length - 1));
        const selectedIndices =
          pageScope === 'active' ? [clampedActiveIdx] : activeDoc.pages.map((_, idx) => idx);

        const res = await prepareDocumentForQrShare(activeDoc, selectedIndices, docPreset, density);
        if (!cancelled) {
          setCustomFileError('');
          setFrames(res.frames);
          setTotalBytes(res.totalBytes);
          setTransferId(res.transferId);
          setSummaryLabel(res.summaryLabel);
          setFrameIdx(0);
        }
      } catch (err) {
        if (!cancelled) {
          setFrames([]);
          setCustomFileError(err instanceof Error ? err.message : 'Unable to encode QR frames.');
        }
      } finally {
        if (!cancelled) setEncodingBusy(false);
      }
    };

    runEncode();
    return () => {
      cancelled = true;
    };
  }, [isOpen, tab, sourceKind, activeDoc, customFile, pageScope, initialPageIndex, docPreset, density]);

  // Animate continuous QR playback loop
  useEffect(() => {
    if (!isOpen || tab !== 'qr' || !isPlaying || frames.length <= 1) return;
    const intervalMs = Math.max(55, Math.round(1000 / Math.max(1, fps)));
    const timer = window.setInterval(() => {
      setFrameIdx((prev) => (prev + 1) % frames.length);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [isOpen, tab, isPlaying, frames.length, fps]);

  // Draw active QR frame onto high-resolution 560px canvas
  useEffect(() => {
    if (!isOpen || tab !== 'qr' || frames.length === 0) return;
    const canvas = qrCanvasRef.current;
    const text = frames[frameIdx % frames.length];
    if (!canvas || !text) return;

    let cancelled = false;
    QRCode.toCanvas(canvas, text, {
      errorCorrectionLevel: frames.length === 1 ? 'M' : 'L',
      margin: 4,
      width: 560,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    })
      .then(() => {
        if (cancelled) return;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [isOpen, tab, frames, frameIdx]);

  if (!isOpen) return null;

  const safeFrameIdx = frames.length > 0 ? frameIdx % frames.length : 0;
  const metrics = estimateQrTransferMetrics(totalBytes, frames.length, fps);
  const clampedIdx = activeDoc
    ? Math.min(initialPageIndex, Math.max(0, activeDoc.pages.length - 1))
    : 0;
  const activePage = activeDoc?.pages[clampedIdx] || null;

  const activeSourceTitle =
    sourceKind === 'custom_file' && customFile
      ? customFile.name
      : activeDoc?.title || 'Select file';

  const handleDownloadQrPng = () => {
    const canvas = qrCanvasRef.current;
    if (!canvas) return;
    haptics.tap();
    const url = canvas.toDataURL('image/png');
    const a = window.document.createElement('a');
    a.href = url;
    a.download = `${(activeDoc?.title || customFile?.name || 'bitscanner-qr').replace(/[^\w.-]+/g, '_')}_qr_f${safeFrameIdx + 1}.png`;
    window.document.body.appendChild(a);
    a.click();
    window.document.body.removeChild(a);
  };

  const handleDeviceSystemShare = async () => {
    if (!activeDoc || sysShareBusy) return;
    haptics.tap();
    setSysShareBusy(true);
    setSysShareStatus('');
    try {
      const pg = activeDoc.pages[clampedIdx];
      if (!pg) return;

      const resp = await fetch(pg.processedDataUrl);
      const blob = await resp.blob();
      const safeName = (activeDoc.title || 'scan').replace(/[^\w\s-]/g, '').trim() || 'scan';
      const file = new File([blob], `${safeName}_page_${clampedIdx + 1}.jpg`, {
        type: blob.type || 'image/jpeg',
      });

      const nav = navigator as Navigator & { canShare?: (data?: ShareData) => boolean };
      if (typeof nav.share === 'function') {
        const shareData: ShareData = {
          title: activeDoc.title,
          text: pg.ocrText
            ? `${activeDoc.title}\n\n${pg.ocrText.slice(0, 280)}`
            : `${activeDoc.title} · Page ${clampedIdx + 1}`,
          files: [file],
        };
        if (!nav.canShare || nav.canShare({ files: [file] })) {
          await nav.share(shareData);
        } else {
          await nav.share({ title: activeDoc.title, text: shareData.text });
        }
        setSysShareStatus('Shared successfully');
        haptics.success();
      } else {
        const dlUrl = URL.createObjectURL(blob);
        const a = window.document.createElement('a');
        a.href = dlUrl;
        a.download = file.name;
        window.document.body.appendChild(a);
        a.click();
        window.document.body.removeChild(a);
        URL.revokeObjectURL(dlUrl);
        setSysShareStatus('Saved image to device');
      }
    } catch {
      setSysShareStatus('');
    } finally {
      setSysShareBusy(false);
    }
  };

  const handleCopyImageToClipboard = async () => {
    if (!activeDoc) return;
    haptics.tap();
    try {
      const pg = activeDoc.pages[clampedIdx];
      if (!pg) return;
      const resp = await fetch(pg.processedDataUrl);
      const blob = await resp.blob();

      // Convert to PNG for clipboard compatibility
      const img = new Image();
      img.src = pg.processedDataUrl;
      await new Promise((resolve) => {
        img.onload = resolve;
      });
      const canvas = window.document.createElement('canvas');
      canvas.width = img.naturalWidth || 800;
      canvas.height = img.naturalHeight || 1100;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
      }
      const pngBlob = await new Promise<Blob | null>((res) =>
        canvas.toBlob((b) => res(b), 'image/png')
      );

      if (navigator.clipboard && typeof navigator.clipboard.write === 'function' && pngBlob) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': pngBlob }),
        ]);
        setCopyImageStatus('Copied to clipboard!');
        haptics.success();
        window.setTimeout(() => setCopyImageStatus(''), 2500);
      } else {
        // Fallback: download image
        const dlUrl = URL.createObjectURL(blob);
        const a = window.document.createElement('a');
        a.href = dlUrl;
        a.download = `${activeDoc.title || 'scan'}_page_${clampedIdx + 1}.jpg`;
        window.document.body.appendChild(a);
        a.click();
        window.document.body.removeChild(a);
        URL.revokeObjectURL(dlUrl);
        setCopyImageStatus('Saved image to device');
        window.setTimeout(() => setCopyImageStatus(''), 2500);
      }
    } catch {
      setCopyImageStatus('Unable to copy image');
      window.setTimeout(() => setCopyImageStatus(''), 2500);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Full-screen QR File Beam and Share"
      data-testid="qr-share-modal"
      className="fixed inset-0 z-50 flex flex-col bg-surface-muted text-ink dark:bg-[#070b14] dark:text-white overflow-hidden"
    >
      {/* Hidden custom file picker (up to 5 MB) */}
      <input
        ref={customFileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0] || null;
          e.target.value = '';
          acceptCustomFile(file);
        }}
      />

      {/* Top Full-Screen Navigation Bar */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line bg-surface px-3 sm:px-6 dark:border-white/10 dark:bg-[#090e1a]">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close share screen"
            data-testid="qr-close-btn"
            className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-xl text-ink-muted hover:bg-surface-subtle hover:text-ink dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white cursor-pointer transition-colors"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>

          <div className="min-w-0">
            <h2
              data-testid="qr-modal-title"
              className="truncate text-sm sm:text-base font-bold tracking-tight text-ink dark:text-white"
            >
              {tab === 'qr' ? 'QR File Beam' : 'Share & Export'}
            </h2>
            <p className="truncate text-[11px] sm:text-xs text-ink-muted dark:text-ink-faint">
              {activeSourceTitle}
              {totalBytes > 0 ? ` · ${formatByteSize(totalBytes)}` : ''}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {activeDoc && (
            <div className="flex items-center rounded-xl bg-surface-subtle p-1 border border-line dark:bg-white/[0.08] dark:border-white/10">
              <button
                type="button"
                onClick={() => setTab('qr')}
                data-testid="qr-share-tab-qr"
                className={`min-h-[30px] sm:min-h-[32px] rounded-lg px-2.5 sm:px-3 text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  tab === 'qr'
                    ? 'bg-accent text-white font-bold shadow-xs dark:bg-teal-500 dark:text-slate-950'
                    : 'text-ink-muted hover:text-ink dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                <span className="sm:hidden">Beam</span>
                <span className="hidden sm:inline">Beam QR</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('share')}
                data-testid="qr-share-tab-system"
                className={`min-h-[30px] sm:min-h-[32px] rounded-lg px-2.5 sm:px-3 text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  tab === 'share'
                    ? 'bg-accent text-white font-bold shadow-xs dark:bg-teal-500 dark:text-slate-950'
                    : 'text-ink-muted hover:text-ink dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                <span className="sm:hidden">Share</span>
                <span className="hidden sm:inline">Share &amp; Export</span>
              </button>
            </div>
          )}

          {onOpenQrScanner && (
            <button
              type="button"
              onClick={() => {
                haptics.tap();
                onClose();
                onOpenQrScanner();
              }}
              aria-label="Receive QR via Camera"
              data-testid="qr-open-scanner-btn"
              className="inline-flex h-9 sm:h-9.5 items-center justify-center gap-1.5 rounded-xl border border-accent-line bg-accent-soft px-2.5 sm:px-3 text-xs font-bold text-accent-text hover:bg-accent-soft dark:border-teal-500/40 dark:bg-teal-500/15 dark:text-teal-300 dark:hover:bg-teal-500/25 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
            >
              <Camera className="h-4 w-4" aria-hidden="true" />
              <span className="hidden md:inline">Receive QR</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      {tab === 'qr' ? (
        /* ================= QR BEAM VIEW (Light & Dark Theme Compatible) ================= */
        <div className="flex flex-1 min-h-0 flex-col overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_420px] lg:overflow-hidden bg-slate-100/60 dark:bg-[#070b14]">
          {/* Optical Emitter Stage */}
          <section className="flex flex-col items-center justify-center p-3.5 sm:p-6 lg:p-8 lg:h-full lg:overflow-y-auto bg-slate-100/60 dark:bg-[#070b14]">
            {frames.length > 0 ? (
              <div className="flex w-full max-w-[480px] flex-col items-center">
                {/* Clean Container Plate framing the white optical scan canvas */}
                <div className="rounded-3xl bg-surface border border-line/90 p-3 sm:p-4 shadow-xl dark:bg-[#0d1527] dark:border-white/10 max-w-full">
                  <div className="relative rounded-2xl overflow-hidden bg-surface p-2 border border-line-soft dark:border-transparent h-[min(64vw,250px)] w-[min(64vw,250px)] sm:h-[320px] sm:w-[320px] lg:h-[380px] lg:w-[380px]">
                    <canvas
                      ref={qrCanvasRef}
                      data-testid="qr-beam-canvas"
                      width={560}
                      height={560}
                      className="block h-full w-full"
                    />
                  </div>
                </div>

                {/* Scrubber & Telemetry */}
                <div className="mt-3.5 w-full max-w-[400px] space-y-2">
                  {frames.length > 1 && (
                    <input
                      type="range"
                      min={0}
                      max={frames.length - 1}
                      value={safeFrameIdx}
                      onChange={(e) => {
                        setIsPlaying(false);
                        setFrameIdx(Number(e.target.value));
                      }}
                      aria-label="Scrub QR stream frame"
                      data-testid="qr-frame-scrubber"
                      className="studio-slider w-full cursor-pointer appearance-none rounded-full bg-surface-subtle accent-teal-600 dark:bg-white/15 dark:accent-teal-400"
                    />
                  )}

                  {/* Clean Telemetry Line */}
                  <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-xs font-mono-tabular text-ink-muted dark:text-slate-300">
                    <span data-testid="qr-frame-counter" className="font-bold text-ink dark:text-white">
                      {frames.length === 1
                        ? 'Single QR · Instant'
                        : `Frame ${safeFrameIdx + 1} / ${frames.length}`}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{formatByteSize(totalBytes)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{metrics.formattedDuration}</span>
                    {frames.length > 1 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-accent dark:text-teal-400 font-semibold">{metrics.throughputLabel}</span>
                      </>
                    )}
                  </div>

                  {/* Playback Transport Controls */}
                  {frames.length > 1 && (
                    <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          haptics.tap();
                          setFrameIdx(0);
                        }}
                        aria-label="Restart stream from frame 1"
                        className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl border border-line bg-surface text-ink-soft shadow-xs hover:bg-surface-subtle hover:text-ink dark:border-white/10 dark:bg-[#0e1628] dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white cursor-pointer transition-colors"
                      >
                        <RotateCcw className="h-4 w-4" aria-hidden="true" />
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setIsPlaying(false);
                          setFrameIdx((i) => (i - 1 + frames.length) % frames.length);
                        }}
                        aria-label="Previous QR frame"
                        className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl border border-line bg-surface text-ink-soft shadow-xs hover:bg-surface-subtle hover:text-ink dark:border-white/10 dark:bg-[#0e1628] dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white cursor-pointer transition-colors"
                      >
                        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                      </button>

                      <button
                        type="button"
                        onClick={() => setIsPlaying((p) => !p)}
                        data-testid="qr-play-pause-btn"
                        className="inline-flex h-9 sm:h-10 items-center gap-2 rounded-xl bg-accent px-4 sm:px-5 text-xs sm:text-sm font-bold text-white hover:bg-accent-strong dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400 active:scale-95 cursor-pointer shadow-md transition-all"
                      >
                        {isPlaying ? (
                          <>
                            <Pause className="h-4 w-4" aria-hidden="true" />
                            <span>Pause</span>
                          </>
                        ) : (
                          <>
                            <Play className="h-4 w-4" aria-hidden="true" />
                            <span>Play Loop</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setIsPlaying(false);
                          setFrameIdx((i) => (i + 1) % frames.length);
                        }}
                        aria-label="Next QR frame"
                        className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl border border-line bg-surface text-ink-soft shadow-xs hover:bg-surface-subtle hover:text-ink dark:border-white/10 dark:bg-[#0e1628] dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white cursor-pointer transition-colors"
                      >
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      </button>

                      <div className="flex items-center rounded-xl border border-line bg-surface shadow-xs p-0.5 dark:border-white/10 dark:bg-[#0e1628]">
                        {[5, 8, 12, 15].map((speed) => (
                          <button
                            key={speed}
                            type="button"
                            onClick={() => setFps(speed)}
                            className={`min-h-[30px] rounded-lg px-2 sm:px-2.5 text-[11px] sm:text-xs font-semibold cursor-pointer transition-colors ${
                              fps === speed
                                ? 'bg-accent text-white font-bold dark:bg-teal-500 dark:text-slate-950'
                                : 'text-ink-muted hover:text-ink dark:text-ink-faint dark:hover:text-white'
                            }`}
                          >
                            {speed}fps
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex max-w-sm flex-col items-center justify-center py-10 text-center">
                <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent-strong border border-accent-line dark:bg-teal-500/15 dark:text-teal-400 dark:border-teal-500/30">
                  <QrCode className="h-7 w-7" aria-hidden="true" />
                </div>
                <p className="text-sm font-bold text-ink dark:text-white">
                  {encodingBusy ? 'Generating optical QR stream...' : 'Ready to beam a file'}
                </p>
                <p className="mt-1 text-xs text-ink-muted dark:text-ink-faint">
                  {summaryLabel || 'Select a document or pick any file up to 5 MB.'}
                </p>
              </div>
            )}
          </section>

          {/* Configuration Panel */}
          <aside className="flex flex-col gap-4 border-t border-line bg-surface p-4 sm:p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:border-t-0 lg:border-l dark:border-white/10 dark:bg-[#0a0f1d] lg:overflow-y-auto">
            {/* 1. Source Selection & File Picker Card */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-ink-soft dark:text-slate-300">Source File</h3>
                <span className="text-[11px] text-accent dark:text-teal-400 font-semibold">Up to 5 MB offline</span>
              </div>

              {availableDocuments.length > 0 && !document && (
                <select
                  value={activeDoc?.id || ''}
                  onChange={(e) => {
                    setSelectedDocId(e.target.value);
                    setSourceKind('doc');
                  }}
                  aria-label="Choose document to share via QR"
                  className="min-h-[42px] w-full rounded-xl border border-line bg-surface-muted px-3 text-xs font-semibold text-ink focus:outline-none dark:border-white/10 dark:bg-[#0e1628] dark:text-white"
                >
                  {availableDocuments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title} ({d.pages.length}p)
                    </option>
                  ))}
                </select>
              )}

              {/* File Drop Target Card */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragActive(false);
                  const dropped = e.dataTransfer.files?.[0] || null;
                  acceptCustomFile(dropped);
                }}
                className={`rounded-2xl border p-3.5 transition-colors ${
                  dragActive
                    ? 'border-teal-500 bg-accent-soft dark:border-teal-400 dark:bg-teal-500/15'
                    : sourceKind === 'custom_file' && customFile
                      ? 'border-teal-400/50 bg-accent-soft/50 dark:border-teal-400/40 dark:bg-[#0e1628]'
                      : 'border-line/90 bg-surface-muted/70 dark:border-white/10 dark:bg-[#0e1628]'
                }`}
              >
                {sourceKind === 'custom_file' && customFile ? (
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-bold text-ink dark:text-white">{customFile.name}</div>
                      <div className="text-[11px] text-ink-muted dark:text-ink-faint">
                        {formatByteSize(customFile.size)} · Device file
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => customFileInputRef.current?.click()}
                        data-testid="qr-pick-custom-file-btn"
                        className="min-h-[34px] rounded-lg border border-line bg-surface px-2.5 text-xs font-semibold text-ink-soft shadow-xs hover:bg-surface-muted dark:border-white/15 dark:bg-white/10 dark:text-white dark:hover:bg-white/15 cursor-pointer"
                      >
                        Replace
                      </button>
                      {activeDoc && (
                        <button
                          type="button"
                          onClick={() => setSourceKind('doc')}
                          className="min-h-[34px] rounded-lg px-2.5 text-xs font-semibold text-accent-strong hover:underline dark:text-teal-300 cursor-pointer"
                        >
                          Use Scan
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-strong border border-accent-line dark:bg-teal-500/15 dark:text-teal-300 dark:border-teal-500/30">
                        <FileText className="h-4.5 w-4.5" aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-xs font-bold text-ink dark:text-white">
                          {activeDoc ? activeDoc.title : 'No scan selected'}
                        </div>
                        <div className="text-[11px] text-ink-muted dark:text-ink-faint truncate">
                          Or drop any PDF, ZIP, image, or file (max 5 MB)
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => customFileInputRef.current?.click()}
                      data-testid="qr-pick-custom-file-btn"
                      className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-xs font-semibold text-ink-soft shadow-xs hover:bg-surface-muted dark:border-white/15 dark:bg-white/10 dark:text-white dark:hover:bg-white/15 cursor-pointer"
                    >
                      <FileUp className="h-3.5 w-3.5 text-accent dark:text-teal-300" aria-hidden="true" />
                      <span>Pick File</span>
                    </button>
                  </div>
                )}
              </div>

              {customFileError && (
                <div className="rounded-xl border border-danger-line bg-danger-soft p-2.5 text-xs text-danger-text dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                  {customFileError}
                </div>
              )}
            </div>

            {/* 2. Document Payload (Quality & Page Scope) */}
            {sourceKind === 'doc' && activeDoc && (
              <div className="space-y-2.5 border-t border-line pt-3.5 dark:border-white/10">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-ink-soft dark:text-slate-300">Document Payload</h3>
                  {activeDoc.pages.length > 1 && (
                    <div className="flex items-center gap-1 rounded-lg bg-surface-subtle p-0.5 border border-line dark:bg-white/10 dark:border-white/10">
                      <button
                        type="button"
                        onClick={() => setPageScope('active')}
                        className={`rounded-md px-2 py-0.5 text-[11px] font-semibold cursor-pointer ${
                          pageScope === 'active'
                            ? 'bg-accent text-white font-bold dark:bg-teal-500 dark:text-slate-950'
                            : 'text-ink-muted dark:text-slate-300'
                        }`}
                      >
                        Page {Math.min(initialPageIndex + 1, activeDoc.pages.length)}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPageScope('all')}
                        className={`rounded-md px-2 py-0.5 text-[11px] font-semibold cursor-pointer ${
                          pageScope === 'all'
                            ? 'bg-accent text-white font-bold dark:bg-teal-500 dark:text-slate-950'
                            : 'text-ink-muted dark:text-slate-300'
                        }`}
                      >
                        All {activeDoc.pages.length}p
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { id: 'fast_image', label: 'Fast Image' },
                      { id: 'crisp_image', label: 'Crisp Image' },
                      { id: 'ocr_only', label: 'Text Only' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        haptics.tap();
                        setDocPreset(opt.id);
                      }}
                      data-testid={`qr-preset-${opt.id}`}
                      className={`min-h-[38px] rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                        docPreset === opt.id
                          ? 'border-teal-500 bg-accent-soft text-accent-text font-bold dark:border-teal-400 dark:bg-teal-500/20 dark:text-teal-200'
                          : 'border-line bg-surface-muted text-ink-muted hover:bg-surface-subtle hover:text-ink dark:border-white/10 dark:bg-[#0e1628] dark:text-ink-faint dark:hover:text-white dark:hover:bg-white/5'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 3. Optical Chunk Density */}
            <div className="space-y-2.5 border-t border-line pt-3.5 dark:border-white/10">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-ink-soft dark:text-slate-300">Optical Chunk Density</h3>
                <span className="text-[11px] text-accent-strong dark:text-teal-400 font-mono-tabular font-semibold">
                  {density === 'fast'
                    ? '420 B/frame'
                    : density === 'balanced'
                      ? '840 B/frame'
                      : '1,350 B/frame'}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: 'fast', label: 'Compatible' },
                    { id: 'balanced', label: 'Balanced' },
                    { id: 'dense', label: 'Max · 5 MB' },
                  ] as const
                ).map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setDensity(d.id)}
                    data-testid={`qr-density-${d.id}`}
                    className={`min-h-[38px] rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                      density === d.id
                        ? 'border-teal-500 bg-accent-soft text-accent-text font-bold dark:border-teal-400 dark:bg-teal-500/20 dark:text-teal-200'
                        : 'border-line bg-surface-muted text-ink-muted hover:bg-surface-subtle hover:text-ink dark:border-white/10 dark:bg-[#0e1628] dark:text-ink-faint dark:hover:text-white dark:hover:bg-white/5'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>

              {metrics.isLargeTransfer && (
                <p className="rounded-xl border border-warning-line bg-warning-soft p-2.5 text-[11px] leading-relaxed text-warning-text dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-200">
                  Large stream ({frames.length} frames, {metrics.formattedDuration} per loop). Turn screen brightness to max. For instant multi-MB transfer, use Share &amp; Export.
                </p>
              )}

              {frames.length > 0 && (
                <button
                  type="button"
                  onClick={handleDownloadQrPng}
                  className="mt-1 inline-flex min-h-[40px] w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface text-xs font-semibold text-ink-soft shadow-xs hover:bg-surface-muted dark:border-white/10 dark:bg-[#0e1628] dark:text-white dark:hover:bg-white/10 cursor-pointer transition-colors"
                >
                  <Download className="h-4 w-4 text-accent dark:text-teal-300" aria-hidden="true" />
                  <span>Save Current Frame as PNG</span>
                </button>
              )}
            </div>
          </aside>
        </div>
      ) : (
        /* ================= SHARE & EXPORT VIEW (Clean, High-Contrast Light & Dark Theme) ================= */
        <div className="flex flex-1 items-center justify-center overflow-y-auto p-4 sm:p-8 bg-surface-muted dark:bg-[#070b14]">
          <div className="w-full max-w-lg space-y-3.5">
            {/* Header info */}
            <div className="text-center mb-1">
              <h3 className="text-lg sm:text-xl font-bold tracking-tight text-ink dark:text-white">Device Share &amp; File Export</h3>
              <p className="mt-1 text-xs text-ink-muted dark:text-ink-faint">
                Use native OS sharing (AirDrop / Nearby Share) or generate PDF, Image &amp; Word files.
              </p>
            </div>

            {/* Compact Document Preview Card */}
            {activeDoc && (
              <div className="flex items-center gap-3.5 rounded-2xl border border-line bg-surface p-3.5 shadow-sm dark:border-white/10 dark:bg-[#0e1628]">
                {activePage && (
                  <div className="relative h-18 w-14 shrink-0 overflow-hidden rounded-xl border border-line bg-surface shadow-xs dark:border-white/20">
                    <img
                      src={activePage.processedDataUrl}
                      alt={activeDoc.title}
                      className="h-full w-full object-cover"
                    />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h4 className="truncate text-sm sm:text-base font-bold text-ink dark:text-white">
                    {activeDoc.title}
                  </h4>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-muted dark:text-ink-faint">
                    <span className="font-semibold text-accent-strong dark:text-teal-300">
                      {activeDoc.pages.length} {activeDoc.pages.length === 1 ? 'page' : 'pages'}
                    </span>
                    <span>·</span>
                    <span>
                      {new Date(activeDoc.updatedAt || activeDoc.createdAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                    {activeDoc.folder && (
                      <>
                        <span>·</span>
                        <span className="capitalize">{activeDoc.folder}</span>
                      </>
                    )}
                  </div>
                </div>

                {activeDoc.pages.length > 1 && (
                  <div className="flex shrink-0 items-center gap-1 rounded-xl bg-surface-subtle p-1 border border-line dark:bg-white/10 dark:border-white/10">
                    <button
                      type="button"
                      onClick={() => setPageScope('active')}
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                        pageScope === 'active'
                          ? 'bg-accent text-white font-bold dark:bg-teal-500 dark:text-slate-950'
                          : 'text-ink-muted hover:text-ink dark:text-slate-300 dark:hover:text-white'
                      }`}
                    >
                      Page {clampedIdx + 1}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPageScope('all')}
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                        pageScope === 'all'
                          ? 'bg-accent text-white font-bold dark:bg-teal-500 dark:text-slate-950'
                          : 'text-ink-muted hover:text-ink dark:text-slate-300 dark:hover:text-white'
                      }`}
                    >
                      All {activeDoc.pages.length}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Notification alert on share or copy */}
            {(sysShareStatus || copyImageStatus) && (
              <div className="flex items-center justify-center gap-1.5 rounded-xl border border-accent-line bg-accent-soft py-2 px-3 text-xs font-semibold text-accent-text dark:border-teal-500/40 dark:bg-teal-500/15 dark:text-teal-300">
                <Check className="h-4 w-4" aria-hidden="true" />
                <span>{sysShareStatus || copyImageStatus}</span>
              </div>
            )}

            {/* Tactile Action Cards */}
            <div className="space-y-2.5">
              {/* 1. Share Image via System Sheet */}
              <button
                type="button"
                disabled={sysShareBusy || !activeDoc}
                onClick={handleDeviceSystemShare}
                data-testid="qr-modal-system-share-btn"
                className="flex min-h-[66px] w-full items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3 text-left hover:border-teal-500/50 hover:bg-surface-muted shadow-xs dark:border-white/10 dark:bg-[#0e1628] dark:hover:border-teal-400/50 dark:hover:bg-[#121c32] cursor-pointer transition-colors disabled:opacity-40"
              >
                <div className="flex items-center gap-3.5">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-strong border border-accent-line dark:bg-teal-500/15 dark:text-teal-300 dark:border-teal-500/30">
                    <Share2 className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="text-sm font-bold text-ink dark:text-white">Share Image via System Sheet</div>
                    <div className="text-xs text-ink-muted dark:text-ink-faint">
                      Send immediately via AirDrop, Nearby Share, WhatsApp, or save JPG
                    </div>
                  </div>
                </div>
                {sysShareStatus && <Check className="h-4 w-4 text-accent dark:text-teal-400" aria-hidden="true" />}
              </button>

              {/* 2. Export as PDF, Image or Word */}
              {activeDoc && onOpenExport && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenExport(activeDoc, initialPageIndex);
                  }}
                  className="flex min-h-[66px] w-full items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3 text-left hover:border-teal-500/50 hover:bg-surface-muted shadow-xs dark:border-white/10 dark:bg-[#0e1628] dark:hover:border-teal-400/50 dark:hover:bg-[#121c32] cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-3.5">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-subtle text-ink-soft border border-line dark:bg-white/10 dark:text-slate-200 dark:border-white/10">
                      <FolderOpen className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div>
                      <div className="text-sm font-bold text-ink dark:text-white">Export as PDF, Image or Word</div>
                      <div className="text-xs text-ink-muted dark:text-ink-faint">
                        Select pages, A4 paper layout, compression quality &amp; searchable OCR PDF
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-ink-faint" aria-hidden="true" />
                </button>
              )}

              {/* 3. Copy Image to Clipboard */}
              {activeDoc && (
                <button
                  type="button"
                  onClick={handleCopyImageToClipboard}
                  className="flex min-h-[66px] w-full items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3 text-left hover:border-teal-500/50 hover:bg-surface-muted shadow-xs dark:border-white/10 dark:bg-[#0e1628] dark:hover:border-teal-400/50 dark:hover:bg-[#121c32] cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-3.5">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-subtle text-ink-soft border border-line dark:bg-white/10 dark:text-slate-200 dark:border-white/10">
                      <Copy className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div>
                      <div className="text-sm font-bold text-ink dark:text-white">Copy Page Image to Clipboard</div>
                      <div className="text-xs text-ink-muted dark:text-ink-faint">
                        Copy high-resolution scan image to paste in Slack, WhatsApp, or docs
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-ink-faint" aria-hidden="true" />
                </button>
              )}

              {/* 4. Switch to QR Beam */}
              <button
                type="button"
                onClick={() => setTab('qr')}
                data-testid="qr-share-to-beam-btn"
                className="flex min-h-[66px] w-full items-center justify-between rounded-2xl border border-accent-line bg-accent-soft/70 px-4 py-3 text-left hover:border-accent-line hover:bg-accent-soft shadow-xs dark:border-teal-500/30 dark:bg-teal-500/10 dark:hover:border-teal-400 dark:hover:bg-teal-500/20 cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-3.5">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-500/20 text-accent-strong border border-accent-line dark:bg-teal-500/20 dark:text-teal-300 dark:border-teal-500/40">
                    <QrCode className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="text-sm font-bold text-ink dark:text-white">QR File Beam (Offline Transfer)</div>
                    <div className="text-xs text-accent-text/80 dark:text-teal-300/80">
                      Beam scans or any file up to 5 MB directly to another device camera
                    </div>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-accent dark:text-teal-400" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden tiny metadata for debugging */}
      {transferId && (
        <span className="sr-only" data-qr-transfer-id={transferId}>
          Transfer {transferId}
        </span>
      )}
    </div>
  );
};
