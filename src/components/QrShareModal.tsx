import React, { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
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
  onClose,
  onOpenExport,
  onOpenQrScanner,
}) => {
  const haptics = useHaptics();
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const customFileInputRef = useRef<HTMLInputElement | null>(null);

  const [tab, setTab] = useState<'qr' | 'share'>(initialMode);
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

  useEffect(() => {
    if (!isOpen) return;
    setTab(initialMode);
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
    setCustomFileError('');
  }, [isOpen, document, initialMode, availableDocuments]);

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
    // For larger files (> 250 KB), automatically select high-throughput defaults
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
                `File is ${formatByteSize(customFile.size)}, above the 5 MB QR transfer cap. Use Share / Export for instant system transfer.`
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
        // Reset qrcode's explicit inline px styles so responsive CSS controls rendered dimensions
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
      const clampedIdx = Math.min(initialPageIndex, Math.max(0, activeDoc.pages.length - 1));
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
            : `${activeDoc.title} — Page ${clampedIdx + 1}`,
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Full-screen QR File Beam"
      data-testid="qr-share-modal"
      className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white overflow-hidden"
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

      {/* Top Full-Screen Bar */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-slate-950/95 px-2.5 sm:px-6">
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2.5">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close QR File Beam"
            data-testid="qr-close-btn"
            className="flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-xl text-slate-300 hover:bg-white/10 hover:text-white cursor-pointer"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>

          <div className="min-w-0">
            <h2
              data-testid="qr-modal-title"
              className="truncate text-sm sm:text-base font-bold tracking-tight text-white"
            >
              QR File Beam
            </h2>
            <p className="truncate text-[11px] sm:text-xs text-slate-400">
              {activeSourceTitle}
              {totalBytes > 0 ? ` · ${formatByteSize(totalBytes)}` : ''}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {activeDoc && (
            <div className="flex items-center rounded-xl bg-white/10 p-1">
              <button
                type="button"
                onClick={() => setTab('qr')}
                data-testid="qr-share-tab-qr"
                className={`min-h-[34px] rounded-lg px-2.5 sm:px-3 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  tab === 'qr' ? 'bg-white text-slate-950 shadow-xs' : 'text-slate-300 hover:text-white'
                }`}
              >
                <span className="sm:hidden">Beam</span>
                <span className="hidden sm:inline">Beam QR</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('share')}
                data-testid="qr-share-tab-system"
                className={`min-h-[34px] rounded-lg px-2.5 sm:px-3 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  tab === 'share'
                    ? 'bg-white text-slate-950 shadow-xs'
                    : 'text-slate-300 hover:text-white'
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
              className="inline-flex h-10 w-10 sm:w-auto items-center justify-center gap-1.5 rounded-xl bg-teal-500 px-0 sm:px-3 text-xs font-bold text-slate-950 hover:bg-teal-400 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Camera className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Receive via Camera</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      {tab === 'qr' ? (
        <div className="flex flex-1 min-h-0 flex-col overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:overflow-hidden">
          {/* Center Full-Scale Optical Emitter Stage */}
          <section className="flex flex-col items-center justify-center px-4 py-4 sm:p-8 lg:h-full lg:overflow-y-auto">
            {frames.length > 0 ? (
              <div className="flex w-full max-w-[520px] flex-col items-center">
                {/* Crisp Pure-White Optical Plate */}
                <div className="rounded-3xl bg-white p-3 sm:p-5 shadow-2xl max-w-full">
                  <div className="relative h-[min(76vw,320px)] w-[min(76vw,320px)] sm:h-[min(54vh,440px)] sm:w-[min(54vh,440px)]">
                    <canvas
                      ref={qrCanvasRef}
                      data-testid="qr-beam-canvas"
                      width={560}
                      height={560}
                      className="block h-full w-full"
                    />
                  </div>
                </div>

                {/* Progress & Frame Scrubber */}
                <div className="mt-4 sm:mt-5 w-full max-w-[440px] space-y-2.5 sm:space-y-3">
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
                      className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-teal-400"
                    />
                  )}

                  {/* Clean Unboxed Telemetry Line */}
                  <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-xs sm:text-sm text-slate-300 font-mono-tabular">
                    <span data-testid="qr-frame-counter" className="font-bold text-white">
                      {frames.length === 1
                        ? 'Single QR · Instant Scan'
                        : `Frame ${safeFrameIdx + 1} / ${frames.length}`}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{formatByteSize(totalBytes)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{metrics.formattedDuration}</span>
                    {frames.length > 1 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{metrics.throughputLabel}</span>
                      </>
                    )}
                  </div>

                  {/* Playback Transport Controls */}
                  {frames.length > 1 && (
                    <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          haptics.tap();
                          setFrameIdx(0);
                        }}
                        aria-label="Restart stream from frame 1"
                        className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-slate-200 hover:bg-white/20 cursor-pointer"
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
                        className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-white/10 hover:bg-white/20 cursor-pointer"
                      >
                        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                      </button>

                      <button
                        type="button"
                        onClick={() => setIsPlaying((p) => !p)}
                        data-testid="qr-play-pause-btn"
                        className="inline-flex h-11 items-center gap-2 rounded-xl bg-teal-500 px-5 text-xs sm:text-sm font-bold text-slate-950 hover:bg-teal-400 cursor-pointer"
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
                        className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-white/10 hover:bg-white/20 cursor-pointer"
                      >
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      </button>

                      <div className="flex items-center rounded-xl border border-white/15 bg-white/5 p-1">
                        {[5, 8, 12, 15].map((speed) => (
                          <button
                            key={speed}
                            type="button"
                            onClick={() => setFps(speed)}
                            className={`min-h-[34px] rounded-lg px-2.5 text-xs font-semibold cursor-pointer ${
                              fps === speed ? 'bg-white text-slate-950' : 'text-slate-300 hover:text-white'
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
              <div className="flex max-w-sm flex-col items-center justify-center py-12 text-center">
                <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 text-teal-400">
                  <QrCode className="h-8 w-8" aria-hidden="true" />
                </div>
                <p className="text-sm font-semibold text-white">
                  {encodingBusy ? 'Generating optical QR stream...' : 'Ready to beam a file'}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {summaryLabel || 'Select a document or pick any file up to 5 MB from your device.'}
                </p>
              </div>
            )}
          </section>

          {/* Right / Bottom Configuration Panel */}
          <aside className="flex flex-col gap-5 border-t border-white/10 bg-slate-900/75 p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:p-6 lg:border-t-0 lg:border-l lg:overflow-y-auto">
            {/* 1. Source Selection + Drag-and-Drop up to 5 MB */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-300">Source File</h3>
                <span className="text-xs text-slate-400">Up to 5 MB offline</span>
              </div>

              {availableDocuments.length > 0 && !document && (
                <select
                  value={activeDoc?.id || ''}
                  onChange={(e) => {
                    setSelectedDocId(e.target.value);
                    setSourceKind('doc');
                  }}
                  aria-label="Choose document to share via QR"
                  className="min-h-[44px] w-full rounded-xl border border-white/15 bg-slate-950 px-3 text-xs font-semibold text-white"
                >
                  {availableDocuments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title} ({d.pages.length}p)
                    </option>
                  ))}
                </select>
              )}

              {/* File Picker / Drop Target */}
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
                className={`rounded-2xl border border-dashed p-3.5 transition-colors ${
                  dragActive
                    ? 'border-teal-400 bg-teal-500/10'
                    : sourceKind === 'custom_file' && customFile
                      ? 'border-teal-500/50 bg-white/5'
                      : 'border-white/15 bg-white/[0.03]'
                }`}
              >
                {sourceKind === 'custom_file' && customFile ? (
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-bold text-white">{customFile.name}</div>
                      <div className="text-[11px] text-slate-400">
                        {formatByteSize(customFile.size)} · Local file
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => customFileInputRef.current?.click()}
                        data-testid="qr-pick-custom-file-btn"
                        className="min-h-[36px] rounded-lg border border-white/15 bg-white/10 px-2.5 text-xs font-semibold text-white hover:bg-white/15 cursor-pointer"
                      >
                        Replace
                      </button>
                      {activeDoc && (
                        <button
                          type="button"
                          onClick={() => setSourceKind('doc')}
                          className="min-h-[36px] rounded-lg px-2.5 text-xs font-semibold text-teal-300 hover:bg-white/10 cursor-pointer"
                        >
                          Use Scan
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <FileText className="h-4.5 w-4.5 shrink-0 text-teal-400" aria-hidden="true" />
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold text-white">
                          {activeDoc ? activeDoc.title : 'No scan selected'}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          Or drop any PDF, ZIP, image, or file (max 5 MB)
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => customFileInputRef.current?.click()}
                      data-testid="qr-pick-custom-file-btn"
                      className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl border border-white/15 bg-white/10 px-3 text-xs font-semibold text-white hover:bg-white/15 cursor-pointer"
                    >
                      <FileUp className="h-3.5 w-3.5 text-teal-300" aria-hidden="true" />
                      <span>Pick File</span>
                    </button>
                  </div>
                )}
              </div>

              {customFileError && (
                <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                  {customFileError}
                </div>
              )}
            </div>

            {/* 2. Document Preset & Page Scope */}
            {sourceKind === 'doc' && activeDoc && (
              <div className="space-y-3 border-t border-white/10 pt-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-300">Document Payload</h3>
                  {activeDoc.pages.length > 1 && (
                    <div className="flex items-center gap-1 rounded-lg bg-white/10 p-0.5">
                      <button
                        type="button"
                        onClick={() => setPageScope('active')}
                        className={`rounded-md px-2 py-1 text-[11px] font-semibold cursor-pointer ${
                          pageScope === 'active' ? 'bg-white text-slate-950' : 'text-slate-300'
                        }`}
                      >
                        Page {Math.min(initialPageIndex + 1, activeDoc.pages.length)}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPageScope('all')}
                        className={`rounded-md px-2 py-1 text-[11px] font-semibold cursor-pointer ${
                          pageScope === 'all' ? 'bg-white text-slate-950' : 'text-slate-300'
                        }`}
                      >
                        All {activeDoc.pages.length}
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
                      className={`min-h-[40px] rounded-xl border text-xs font-semibold transition-colors cursor-pointer ${
                        docPreset === opt.id
                          ? 'border-teal-400 bg-teal-500/20 text-teal-200'
                          : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 3. Optical Chunk Density & Export PNG */}
            <div className="space-y-3 border-t border-white/10 pt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-300">Optical Chunk Density</h3>
                <span className="text-[11px] text-slate-400">
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
                    className={`min-h-[40px] rounded-xl border text-xs font-semibold transition-colors cursor-pointer ${
                      density === d.id
                        ? 'border-teal-400 bg-teal-500/20 text-teal-200'
                        : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>

              {metrics.isLargeTransfer && (
                <p className="rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-200">
                  Large stream ({frames.length} frames, {metrics.formattedDuration} per loop). Turn screen brightness to max and hold cameras steady ~15 cm apart. For instant multi-MB transfer, use Share &amp; Export.
                </p>
              )}

              {frames.length > 0 && (
                <button
                  type="button"
                  onClick={handleDownloadQrPng}
                  className="inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 text-xs font-semibold text-white hover:bg-white/15 cursor-pointer"
                >
                  <Download className="h-4 w-4 text-teal-300" aria-hidden="true" />
                  <span>Save Current Frame as PNG</span>
                </button>
              )}
            </div>
          </aside>
        </div>
      ) : (
        /* Full-Screen Centered Share & Export Tab */
        <div className="flex flex-1 items-center justify-center overflow-y-auto p-4 sm:p-8">
          <div className="w-full max-w-lg space-y-3">
            <div className="mb-4 text-center">
              <h3 className="text-lg font-bold text-white">Device Share &amp; File Export</h3>
              <p className="mt-1 text-xs text-slate-400">
                Use native OS sharing (AirDrop / Nearby Share) or generate PDF, Image &amp; Word files.
              </p>
            </div>

            <button
              type="button"
              disabled={sysShareBusy}
              onClick={handleDeviceSystemShare}
              data-testid="qr-modal-system-share-btn"
              className="flex min-h-[64px] w-full items-center justify-between rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-left hover:border-teal-400/50 hover:bg-slate-800/80 cursor-pointer"
            >
              <div className="flex items-center gap-3.5">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-500/15 text-teal-300">
                  <Share2 className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <div className="text-sm font-bold text-white">Share Image via System Sheet</div>
                  <div className="text-xs text-slate-400">
                    {sysShareStatus || 'Send immediately via AirDrop, Nearby Share, WhatsApp, or save JPG'}
                  </div>
                </div>
              </div>
              {sysShareStatus && <Check className="h-4 w-4 text-teal-400" aria-hidden="true" />}
            </button>

            {activeDoc && onOpenExport && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenExport(activeDoc, initialPageIndex);
                }}
                className="flex min-h-[64px] w-full items-center justify-between rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-left hover:border-teal-400/50 hover:bg-slate-800/80 cursor-pointer"
              >
                <div className="flex items-center gap-3.5">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-slate-200">
                    <FolderOpen className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="text-sm font-bold text-white">Export as PDF, Image or Word</div>
                    <div className="text-xs text-slate-400">
                      Select pages, A4 paper layout, compression quality &amp; searchable OCR PDF
                    </div>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
              </button>
            )}
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
