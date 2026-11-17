import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Camera,
  Check,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  FileText,
  FolderPlus,
  Globe,
  Grid3x3,
  ImagePlus,
  Layers,
  Maximize2,
  QrCode,
  Radio,
  RotateCcw,
  RotateCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  SwitchCamera,
  Trash2,
  X,
  Zap,
  ZapOff,
} from 'lucide-react';
import QRCode from 'qrcode';
import type { FilterPreset, QuadCorners, ScanDocument, ScannedPage } from '../types/scanner';
import { DEFAULT_ADJUSTMENTS, DEFAULT_WATERMARK } from '../types/scanner';
import { useHaptics } from '../hooks/useHaptics';
import { clamp, classifyScannedSceneHint, quadsAreClose, smoothQuadCorners, type AutoDetectedScene, type ScanCornerHint } from '../utils/cvGeometry';
import {
  captureVisibleFeedFrame,
  detectCornersDetailedFromVideoOrImage,
  detectCornersFromDataUrl,
  loadImage,
  perspectiveDewarp,
  processPagePipeline,
} from '../utils/imageProcessor';
import {
  createCollectorState,
  decodeQrDetailedFromMediaSource,
  ingestQrPayload,
  summarizeCollectorProgress,
  type DecodedQrPayload,
  type QrMediaDecodeResult,
  type QrStreamCollectorState,
} from '../utils/qrTransfer';
import { formatByteSize } from '../utils/settingsStore';
import { SAMPLE_SOURCES } from '../utils/storage';
import { PerspectiveCropCanvas } from './PerspectiveCropCanvas';

export type CameraScanMode = 'auto' | 'docs' | 'id_card' | 'book' | 'qr' | 'batch';

interface QueuedCapture {
  id: string;
  label: string;
  originalDataUrl: string;
  quad: QuadCorners;
}

interface CameraScannerProps {
  isOpen: boolean;
  initialMode?: CameraScanMode;
  initialSource?: 'camera' | 'samples';
  initialFiles?: File[] | null;
  appendTargetDocId?: string | null;
  defaultFilter?: FilterPreset;
  autoEdgeDetect?: boolean;
  defaultFilenamePrefix?: string;
  onClose: () => void;
  onCompletePages: (
    pages: ScannedPage[],
    meta: { title: string; folder: ScanDocument['folder']; appendToDocId?: string | null }
  ) => void;
  onCompleteIdPair?: (frontOriginalUrl: string, frontQuad: QuadCorners, backOriginalUrl: string, backQuad: QuadCorners) => void;
  onQrFileReceived?: (payload: DecodedQrPayload, action: 'save_to_library' | 'save_note') => void;
}

const MODE_ITEMS: Array<{ id: 'auto' | 'docs' | 'id_card' | 'book' | 'qr'; label: string; icon: React.FC<{ className?: string }> }> = [
  { id: 'auto', label: 'Auto', icon: Sparkles },
  { id: 'docs', label: 'Docs', icon: FileText },
  { id: 'id_card', label: 'ID Card', icon: CreditCard },
  { id: 'book', label: 'Book', icon: BookOpen },
  { id: 'qr', label: 'QR Code', icon: QrCode },
];

const DEMO_SCENES: Array<{ id: string; label: string; url: string; modeHint?: CameraScanMode }> = [
  { id: 'invoice', label: 'Desk Invoice', url: SAMPLE_SOURCES.invoice, modeHint: 'docs' },
  { id: 'notes', label: 'Notebook Notes', url: SAMPLE_SOURCES.notes, modeHint: 'book' },
  { id: 'id', label: 'ID Card', url: SAMPLE_SOURCES.idCard, modeHint: 'id_card' },
];

async function splitHorizontalSpread(dataUrl: string): Promise<[string, string]> {
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const half = Math.max(10, Math.floor(w / 2));

  const renderHalf = (sx: number, sw: number) => {
    const c = document.createElement('canvas');
    c.width = sw;
    c.height = h;
    const ctx = c.getContext('2d');
    if (ctx) ctx.drawImage(img, sx, 0, sw, h, 0, 0, sw, h);
    return c.toDataURL('image/jpeg', 0.93);
  };

  return [renderHalf(0, half), renderHalf(half, w - half)];
}

export const CameraScanner: React.FC<CameraScannerProps> = ({
  isOpen,
  initialMode = 'auto',
  initialSource = 'camera',
  initialFiles = null,
  appendTargetDocId = null,
  defaultFilter = 'magic_color',
  autoEdgeDetect = true,
  defaultFilenamePrefix = 'Scan_',
  onClose,
  onCompletePages,
  onCompleteIdPair,
  onQrFileReceived,
}) => {
  const haptics = useHaptics();

  const [scanMode, setScanMode] = useState<'auto' | 'docs' | 'id_card' | 'book' | 'qr'>(
    initialMode === 'docs' || initialMode === 'id_card' || initialMode === 'book' || initialMode === 'qr'
      ? initialMode
      : 'auto'
  );
  const [autoDetectedScene, setAutoDetectedScene] = useState<AutoDetectedScene>('document');
  const [splitAutoSpread, setSplitAutoSpread] = useState(false);
  const [isMultiMode, setIsMultiMode] = useState(initialMode === 'batch');
  const [stage, setStage] = useState<'viewfinder' | 'crop_review'>('viewfinder');

  const activeCornerHint: ScanCornerHint =
    scanMode === 'id_card' ? 'id_card' : scanMode === 'book' ? 'book' : scanMode === 'auto' ? 'auto' : 'docs';

  // QR continuous scanning state
  const [qrCollector, setQrCollector] = useState<QrStreamCollectorState>(() => createCollectorState());
  const qrCollectorRef = useRef<QrStreamCollectorState>(qrCollector);
  qrCollectorRef.current = qrCollector;
  const [qrCompletedPayload, setQrCompletedPayload] = useState<DecodedQrPayload | null>(null);
  const [qrPlainText, setQrPlainText] = useState<string | null>(null);
  const [qrScanNotice, setQrScanNotice] = useState<string>('');
  const [qrChunkFlash, setQrChunkFlash] = useState(false);
  const [qrCopied, setQrCopied] = useState(false);
  const qrScratchCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const qrBusyRef = useRef(false);
  const [autoQrPill, setAutoQrPill] = useState<string | null>(null);
  const [demoQrUrl, setDemoQrUrl] = useState<string>('');

  useEffect(() => {
    QRCode.toDataURL('https://bitscanner.app/scan-preview', {
      margin: 2,
      width: 480,
      color: { dark: '#022c22', light: '#ffffff' },
    })
      .then(setDemoQrUrl)
      .catch(() => {});
  }, []);

  // Viewfinder controls (gesture zoom + top-right Flash & Options HUD)
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [flashMode, setFlashMode] = useState<'off' | 'on' | 'auto'>('off');
  const [gridEnabled, setGridEnabled] = useState(true);
  const [liveEdgeOn, setLiveEdgeOn] = useState(autoEdgeDetect);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [shutterFlash, setShutterFlash] = useState(false);

  // Gesture zoom refs (pinch-to-zoom & double-tap)
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartRef = useRef<{ dist: number; zoom: number } | null>(null);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);

  // Camera hardware stream + fallback state
  const viewfinderStageRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const demoImgRef = useRef<HTMLImageElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestSeqRef = useRef(0);
  const scratchCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [activeStream, setActiveStream] = useState<MediaStream | null>(null);
  const [preferDemoLens, setPreferDemoLens] = useState<boolean>(initialSource === 'samples');
  const [cameraStatus, setCameraStatus] = useState<'requesting' | 'active' | 'blocked' | 'demo'>('requesting');
  const [cameraErrorMsg, setCameraErrorMsg] = useState<string | null>(null);
  const [demoSceneIdx, setDemoSceneIdx] = useState(0);
  const [liveQuad, setLiveQuad] = useState<QuadCorners | null>(null);
  const [edgeLocked, setEdgeLocked] = useState(false);
  const lastRawQuadRef = useRef<QuadCorners | null>(null);
  const stableFramesRef = useRef(0);

  const cameraActive = cameraStatus === 'active' && activeStream !== null;

  // Captured queue & crop review state
  const [queue, setQueue] = useState<QueuedCapture[]>([]);
  const queueRef = useRef<QueuedCapture[]>([]);
  const [selectedQueueIdx, setSelectedQueueIdx] = useState(0);
  const [retakeTargetIdx, setRetakeTargetIdx] = useState<number | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [processing, setProcessing] = useState(false);

  const commitQueue = useCallback((next: QueuedCapture[]) => {
    queueRef.current = next;
    setQueue(next);
  }, []);

  const stopCamera = useCallback(() => {
    requestSeqRef.current += 1;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setActiveStream(null);
  }, []);

  const requestCameraStream = useCallback(
    async (preferredFacing: 'environment' | 'user') => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      setActiveStream(null);
      setCameraStatus('requesting');
      setCameraErrorMsg(null);

      const reqId = ++requestSeqRef.current;

      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraStatus('blocked');
        setCameraErrorMsg(
          'Live browser camera requires HTTPS or camera permissions. Use "Open Device Camera App" below to take a photo directly.'
        );
        return;
      }

      const constraintCandidates: MediaStreamConstraints[] = [
        {
          video: {
            facingMode: { ideal: preferredFacing },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        },
        {
          video: {
            facingMode: preferredFacing,
          },
          audio: false,
        },
        {
          video: true,
          audio: false,
        },
      ];

      let acquired: MediaStream | null = null;
      let lastErr: unknown = null;

      for (const constraints of constraintCandidates) {
        try {
          acquired = await navigator.mediaDevices.getUserMedia(constraints);
          break;
        } catch (err) {
          lastErr = err;
          const errName = err instanceof Error ? err.name : '';
          if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError' || errName === 'SecurityError') {
            break;
          }
        }
      }

      if (reqId !== requestSeqRef.current) {
        if (acquired) {
          acquired.getTracks().forEach((t) => t.stop());
        }
        return;
      }

      if (acquired) {
        streamRef.current = acquired;
        setActiveStream(acquired);
        setCameraStatus('active');
        setCameraErrorMsg(null);
        if (videoRef.current) {
          videoRef.current.srcObject = acquired;
          videoRef.current.play().catch(() => {
            // Handled via muted + playsInline + user tap
          });
        }
      } else {
        setActiveStream(null);
        setCameraStatus('blocked');
        const errName = lastErr instanceof Error ? lastErr.name : '';
        if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
          setCameraErrorMsg(
            'Camera permission was denied or blocked in this preview frame. Tap "Allow Live Camera", or use "Open Device Camera App".'
          );
        } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
          setCameraErrorMsg(
            'No camera hardware was detected by this browser. Upload a photo or use the Interactive Demo Lens.'
          );
        } else {
          setCameraErrorMsg(
            'Could not access the live camera stream. Tap "Allow Live Camera", or open your device camera app.'
          );
        }
      }
    },
    []
  );

  // Reset when opened/closed
  useEffect(() => {
    if (isOpen) {
      const nextMode =
        initialMode === 'docs' || initialMode === 'id_card' || initialMode === 'book' || initialMode === 'qr'
          ? initialMode
          : 'auto';
      setScanMode(nextMode);
      setAutoDetectedScene('document');
      setSplitAutoSpread(false);
      setIsMultiMode(initialMode === 'batch');
      setPreferDemoLens(initialSource === 'samples');
      setStage(initialFiles && initialFiles.length > 0 ? 'crop_review' : 'viewfinder');
      commitQueue([]);
      setSelectedQueueIdx(0);
      setRetakeTargetIdx(null);
      setZoomLevel(1.0);
      pointersRef.current.clear();
      pinchStartRef.current = null;
      setOptionsOpen(false);
      setDemoSceneIdx(initialSource === 'samples' ? 0 : initialMode === 'id_card' ? 2 : 0);
      setQrCollector(createCollectorState());
      setQrCompletedPayload(null);
      setQrPlainText(null);
      setQrScanNotice('');
      setQrCopied(false);

      if (initialFiles && initialFiles.length > 0) {
        let cancelled = false;
        setDetecting(true);
        (async () => {
          try {
            const added: QueuedCapture[] = [];
            for (const file of initialFiles) {
              const dataUrl = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(String(reader.result || ''));
                reader.readAsDataURL(file);
              });
              if (!dataUrl || cancelled) continue;
              const hint: ScanCornerHint =
                nextMode === 'id_card' ? 'id_card' : nextMode === 'book' ? 'book' : nextMode === 'auto' ? 'auto' : 'docs';
              const quad: QuadCorners = autoEdgeDetect
                ? await detectCornersFromDataUrl(dataUrl, { scanHint: hint })
                : [
                    { x: 0.04, y: 0.04 },
                    { x: 0.96, y: 0.04 },
                    { x: 0.96, y: 0.96 },
                    { x: 0.04, y: 0.96 },
                  ];
              if (cancelled) return;
              added.push({
                id: crypto.randomUUID(),
                label: file.name.replace(/\.[^.]+$/, '') || 'Uploaded Scan',
                originalDataUrl: dataUrl,
                quad,
              });
            }
            if (!cancelled && added.length > 0) {
              commitQueue(added);
              setSelectedQueueIdx(added.length - 1);
              setStage('crop_review');
            }
          } finally {
            if (!cancelled) setDetecting(false);
          }
        })();
        return () => {
          cancelled = true;
        };
      }
    } else {
      stopCamera();
      commitQueue([]);
      setPreferDemoLens(initialSource === 'samples');
      setLiveQuad(null);
      setEdgeLocked(false);
      lastRawQuadRef.current = null;
      stableFramesRef.current = 0;
    }
  }, [isOpen, initialMode, initialSource, initialFiles, stopCamera, commitQueue]);

  // Acquire live camera stream whenever viewfinder is active (unless launched or switched to Demo Lens)
  useEffect(() => {
    if (!isOpen || stage !== 'viewfinder' || (initialFiles && initialFiles.length > 0)) {
      stopCamera();
      return;
    }

    if (initialSource === 'samples' || preferDemoLens) {
      stopCamera();
      setCameraStatus('demo');
      return;
    }

    void requestCameraStream(facingMode);

    return () => {
      stopCamera();
    };
  }, [isOpen, stage, facingMode, initialSource, preferDemoLens, initialFiles, requestCameraStream, stopCamera]);

  // Ensure always-mounted <video> attaches activeStream as soon as ready
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    if (activeStream && cameraStatus === 'active' && stage === 'viewfinder') {
      if (videoEl.srcObject !== activeStream) {
        videoEl.srcObject = activeStream;
      }
      videoEl.play().catch(() => {
        // Autoplay fallback handled by muted + playsInline
      });
    } else if (!activeStream && videoEl.srcObject) {
      videoEl.srcObject = null;
    }
  }, [activeStream, cameraStatus, stage]);

  // Apply hardware camera torch when supported (digital zoom handled consistently in viewport + capture)
  useEffect(() => {
    const track = streamRef.current?.getVideoTracks()?.[0];
    if (!track || typeof track.applyConstraints !== 'function') return;
    const caps = (typeof track.getCapabilities === 'function' ? track.getCapabilities() : {}) as Record<
      string,
      unknown
    >;
    if (caps.torch) {
      track
        .applyConstraints({ advanced: [{ torch: flashMode === 'on' } as MediaTrackConstraintSet] })
        .catch(() => {
          // Ignore unsupported runtime torch constraint errors gracefully
        });
    }
  }, [flashMode, cameraActive]);

  // Real-time live document corner tracking overlay (paused during explicit QR mode or active QR overlay in Auto mode)
  useEffect(() => {
    const qrOverlayActive = Boolean(qrCompletedPayload || qrPlainText || qrCollector.total > 0);
    if (
      !isOpen ||
      stage !== 'viewfinder' ||
      scanMode === 'qr' ||
      (scanMode === 'auto' && qrOverlayActive) ||
      !liveEdgeOn ||
      (cameraStatus !== 'active' && cameraStatus !== 'demo')
    ) {
      setLiveQuad(null);
      setEdgeLocked(false);
      lastRawQuadRef.current = null;
      stableFramesRef.current = 0;
      return;
    }

    if (!scratchCanvasRef.current) {
      scratchCanvasRef.current = document.createElement('canvas');
    }

    const runLiveDetect = () => {
      const canvas = scratchCanvasRef.current;
      const stageEl = viewfinderStageRef.current;
      if (!canvas) return;
      const srcEl = cameraActive ? videoRef.current : demoImgRef.current;
      if (!srcEl) return;
      const detailed = detectCornersDetailedFromVideoOrImage(srcEl, canvas, {
        zoom: zoomLevel,
        viewportWidth: stageEl?.clientWidth,
        viewportHeight: stageEl?.clientHeight,
        scanHint: activeCornerHint,
      });
      if (!detailed) {
        stableFramesRef.current = 0;
        lastRawQuadRef.current = null;
        setEdgeLocked(false);
        setLiveQuad(null);
        if (scanMode === 'auto') setAutoDetectedScene('document');
        return;
      }

      const detected = detailed.quad;
      if (lastRawQuadRef.current && quadsAreClose(lastRawQuadRef.current, detected, 0.02)) {
        stableFramesRef.current += 1;
      } else {
        stableFramesRef.current = 0;
      }
      lastRawQuadRef.current = detected;
      setEdgeLocked(stableFramesRef.current >= 2);
      setLiveQuad((prev) => smoothQuadCorners(prev, detected, 0.42));
      if (scanMode === 'auto') {
        setAutoDetectedScene(
          classifyScannedSceneHint({
            quad: detected,
            quadConfidence: detailed.confidence,
            aspectRatio: detailed.aspectRatio,
          })
        );
      }
    };

    const timer = window.setInterval(runLiveDetect, 240);
    const initial = window.setTimeout(runLiveDetect, 100);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(initial);
    };
  }, [
    isOpen,
    stage,
    scanMode,
    activeCornerHint,
    liveEdgeOn,
    cameraActive,
    cameraStatus,
    demoSceneIdx,
    zoomLevel,
    qrCompletedPayload,
    qrPlainText,
    qrCollector.total,
  ]);

  const processDecodedQrText = useCallback(
    async (rawText: string) => {
      if (!rawText || qrBusyRef.current) return;
      qrBusyRef.current = true;
      try {
        const res = await ingestQrPayload(qrCollectorRef.current, rawText);
        if (res.kind === 'plain_text') {
          haptics.success();
          setAutoDetectedScene('qr_code');
          setQrPlainText(res.text);
          setQrScanNotice('QR code detected');
          setAutoQrPill(null);
        } else if (res.kind === 'progress') {
          setAutoDetectedScene('qr_transfer');
          setQrCollector(res.state);
          qrCollectorRef.current = res.state;
          setQrPlainText(null);
          setAutoQrPill(null);
          if (res.isNewChunk) {
            haptics.tap();
            setQrChunkFlash(true);
            window.setTimeout(() => setQrChunkFlash(false), 120);
            setQrScanNotice(`Receiving stream: ${res.receivedCount} of ${res.totalCount} chunks`);
          }
        } else if (res.kind === 'complete') {
          setAutoDetectedScene('qr_transfer');
          setQrCollector(res.state);
          qrCollectorRef.current = res.state;
          setQrPlainText(null);
          setAutoQrPill(null);
          setQrCompletedPayload(res.payload);
          setQrScanNotice('File transfer complete!');
          haptics.success();
        } else if (res.kind === 'invalid') {
          setQrCollector(res.state);
          qrCollectorRef.current = res.state;
        }
      } finally {
        qrBusyRef.current = false;
      }
    },
    [haptics]
  );

  // Continuous live QR decoding loop (active in both 'qr' mode and 'auto' mode)
  useEffect(() => {
    if (
      !isOpen ||
      stage !== 'viewfinder' ||
      (scanMode !== 'qr' && scanMode !== 'auto') ||
      (!cameraActive && cameraStatus !== 'demo') ||
      qrCompletedPayload
    ) {
      return;
    }

    if (!qrScratchCanvasRef.current) {
      qrScratchCanvasRef.current = document.createElement('canvas');
    }

    const intervalMs = scanMode === 'qr' ? 80 : 160;
    const timer = window.setInterval(() => {
      const scratch = qrScratchCanvasRef.current;
      if (!scratch || qrBusyRef.current) return;

      let decoded: QrMediaDecodeResult | null = null;
      if (cameraActive && videoRef.current && videoRef.current.readyState >= 2) {
        decoded = decodeQrDetailedFromMediaSource(videoRef.current, scratch);
      } else if (cameraStatus === 'demo' && demoImgRef.current && demoImgRef.current.naturalWidth > 0) {
        decoded = decodeQrDetailedFromMediaSource(demoImgRef.current, scratch);
      }

      if (!decoded) {
        return;
      }

      const rawText = decoded.text.trim();
      const isBsq = rawText.startsWith('BSQ1|');

      if (scanMode === 'qr') {
        void processDecodedQrText(decoded.text);
      } else if (scanMode === 'auto') {
        if (isBsq) {
          void processDecodedQrText(decoded.text);
        } else {
          // Standard URL / text QR seen during Auto mode
          setAutoQrPill(decoded.text);
        }
      }
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [isOpen, stage, scanMode, cameraActive, cameraStatus, qrCompletedPayload, processDecodedQrText]);

  const allDemoScenes = useMemo(() => {
    const list = [...DEMO_SCENES];
    if (demoQrUrl) {
      list.push({ id: 'qr_demo', label: 'QR Code', url: demoQrUrl, modeHint: 'qr' });
    }
    return list;
  }, [demoQrUrl]);

  if (!isOpen) return null;

  const activeDemo = allDemoScenes[demoSceneIdx] || allDemoScenes[0];

  const handleModeSwitch = (mode: 'auto' | 'docs' | 'id_card' | 'book' | 'qr') => {
    haptics.tap();
    setScanMode(mode);
    setSplitAutoSpread(false);
    setAutoQrPill(null);
    if (mode === 'qr') {
      setIsMultiMode(false);
      setQrCollector(createCollectorState());
      setQrCompletedPayload(null);
      setQrPlainText(null);
      setQrScanNotice('Scanning active · Align QR code inside frame');
      if (demoQrUrl && cameraStatus === 'demo') {
        setDemoSceneIdx(3);
      }
    } else if (mode === 'auto') {
      setAutoDetectedScene('document');
      setQrCollector(createCollectorState());
      setQrCompletedPayload(null);
      setQrPlainText(null);
      setQrScanNotice('');
      setDemoSceneIdx(0);
    } else if (mode === 'id_card') {
      setIsMultiMode(false);
      setDemoSceneIdx(2);
    } else if (mode === 'book') {
      setDemoSceneIdx(1);
    } else {
      setDemoSceneIdx(0);
    }
  };

  // Multi-touch pinch + double-tap + wheel gesture zoom handlers on viewfinder
  const handleViewfinderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (cameraStatus === 'blocked') return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      pinchStartRef.current = { dist: Math.max(10, dist), zoom: zoomLevel };
      lastTapRef.current = null;
    } else if (pointersRef.current.size === 1) {
      const now = Date.now();
      const prev = lastTapRef.current;
      if (
        prev &&
        now - prev.time < 280 &&
        Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 28
      ) {
        haptics.tap();
        setZoomLevel((z) => (z > 1.15 ? 1.0 : 2.0));
        lastTapRef.current = null;
      } else {
        lastTapRef.current = { time: now, x: e.clientX, y: e.clientY };
      }
    }
  };

  const handleViewfinderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 2 && pinchStartRef.current) {
      const pts = Array.from(pointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const nextZoom = clamp(
        Math.round((pinchStartRef.current.zoom * (dist / pinchStartRef.current.dist)) * 100) / 100,
        1.0,
        4.0
      );
      setZoomLevel(nextZoom);
    }
  };

  const handleViewfinderPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) {
      pinchStartRef.current = null;
    }
  };

  const handleViewfinderWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (cameraStatus === 'blocked') return;
    const step = -e.deltaY * 0.0025;
    if (Math.abs(step) < 0.01) return;
    setZoomLevel((prev) => clamp(Math.round((prev + step) * 100) / 100, 1.0, 4.0));
  };

  const cycleFlash = () => {
    haptics.tap();
    setFlashMode((prev) => (prev === 'off' ? 'on' : prev === 'on' ? 'auto' : 'off'));
  };

  // Core capture handler (used by shutter, gallery upload, and demo lens capture)
  const ingestCapturedUrl = async (dataUrl: string, label: string, stayInCameraIfMulti: boolean) => {
    setDetecting(true);
    try {
      // In Auto mode, check first whether the captured frame contains a QR code (standard URL/text or QR Beam frame)
      if (scanMode === 'auto' && retakeTargetIdx === null) {
        if (!qrScratchCanvasRef.current) {
          qrScratchCanvasRef.current = document.createElement('canvas');
        }
        const img = await loadImage(dataUrl).catch(() => null);
        if (img) {
          const decoded = decodeQrDetailedFromMediaSource(img, qrScratchCanvasRef.current);
          if (decoded?.text) {
            await processDecodedQrText(decoded.text);
            return;
          }
        }
      }

      const detectedQuad: QuadCorners = autoEdgeDetect
        ? await detectCornersFromDataUrl(dataUrl, { scanHint: activeCornerHint })
        : [
            { x: 0.04, y: 0.04 },
            { x: 0.96, y: 0.04 },
            { x: 0.96, y: 0.96 },
            { x: 0.04, y: 0.96 },
          ];
      const item: QueuedCapture = {
        id: crypto.randomUUID(),
        label,
        originalDataUrl: dataUrl,
        quad: detectedQuad,
      };

      const prev = queueRef.current;
      const targetReplace = retakeTargetIdx;

      if (targetReplace !== null && targetReplace >= 0 && targetReplace < prev.length) {
        const next = prev.map((existing, idx) => (idx === targetReplace ? item : existing));
        commitQueue(next);
        setSelectedQueueIdx(targetReplace);
        setRetakeTargetIdx(null);
        setStage('crop_review');
        return;
      }

      const next = [...prev, item];
      commitQueue(next);
      setSelectedQueueIdx(next.length - 1);

      if (scanMode === 'id_card') {
        if (next.length >= 2) {
          setStage('crop_review');
        }
      } else if (!stayInCameraIfMulti) {
        setStage('crop_review');
      }
    } finally {
      setDetecting(false);
    }
  };

  const handleShutterPress = async () => {
    if (!cameraActive && cameraStatus !== 'demo') {
      // If camera is not active yet, request camera access directly on click
      haptics.tap();
      setPreferDemoLens(false);
      requestCameraStream(facingMode);
      return;
    }

    // In QR scan mode, tapping the shutter immediately captures & decodes the frame with tactile feedback
    if (scanMode === 'qr') {
      haptics.shutter();
      setShutterFlash(true);
      window.setTimeout(() => setShutterFlash(false), 140);

      let capturedUrl = '';
      const stageEl = viewfinderStageRef.current;
      const vw = stageEl?.clientWidth;
      const vh = stageEl?.clientHeight;

      if (cameraActive && videoRef.current && videoRef.current.videoWidth > 0) {
        capturedUrl = captureVisibleFeedFrame(videoRef.current, {
          zoom: zoomLevel,
          viewportWidth: vw,
          viewportHeight: vh,
          mirrorHorizontal: facingMode === 'user',
          maxDim: 1800,
        });
      } else if (cameraStatus === 'demo') {
        try {
          const srcImg =
            demoImgRef.current && demoImgRef.current.naturalWidth > 0
              ? demoImgRef.current
              : await loadImage(activeDemo.url);
          capturedUrl = captureVisibleFeedFrame(srcImg, {
            zoom: zoomLevel,
            viewportWidth: vw,
            viewportHeight: vh,
            maxDim: 1800,
          });
        } catch {
          capturedUrl = activeDemo.url;
        }
      }

      if (!capturedUrl) return;

      if (!qrScratchCanvasRef.current) {
        qrScratchCanvasRef.current = document.createElement('canvas');
      }
      const img = await loadImage(capturedUrl).catch(() => null);
      if (img) {
        const decoded = decodeQrDetailedFromMediaSource(img, qrScratchCanvasRef.current);
        if (decoded?.text) {
          haptics.success();
          await processDecodedQrText(decoded.text);
          return;
        }
      }

      haptics.warning();
      setQrScanNotice('No QR code detected — align code inside box and hold steady');
      return;
    }

    haptics.shutter();
    setShutterFlash(true);
    window.setTimeout(() => setShutterFlash(false), 140);

    let capturedUrl = '';
    let label = `Scan ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const stageEl = viewfinderStageRef.current;
    const vw = stageEl?.clientWidth;
    const vh = stageEl?.clientHeight;

    if (cameraActive && videoRef.current && videoRef.current.videoWidth > 0) {
      capturedUrl = captureVisibleFeedFrame(videoRef.current, {
        zoom: zoomLevel,
        viewportWidth: vw,
        viewportHeight: vh,
        mirrorHorizontal: facingMode === 'user',
        maxDim: 1800,
      });
    } else if (cameraStatus === 'demo') {
      // Demo lens capture matching exact visible viewport + gesture zoom
      try {
        const srcImg =
          demoImgRef.current && demoImgRef.current.naturalWidth > 0
            ? demoImgRef.current
            : await loadImage(activeDemo.url);
        capturedUrl = captureVisibleFeedFrame(srcImg, {
          zoom: zoomLevel,
          viewportWidth: vw,
          viewportHeight: vh,
          maxDim: 1800,
        });
        label = activeDemo.label;
      } catch {
        capturedUrl = activeDemo.url;
      }
    }

    if (!capturedUrl) return;
    await ingestCapturedUrl(capturedUrl, label, isMultiMode);
  };

  const handleGalleryUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    haptics.tap();
    const list = Array.from(files);

    // If in QR File scan mode, decode QR codes from the uploaded image(s) directly
    if (scanMode === 'qr') {
      if (!qrScratchCanvasRef.current) {
        qrScratchCanvasRef.current = document.createElement('canvas');
      }
      let decodedAny = false;
      for (const file of list) {
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result || ''));
          reader.readAsDataURL(file);
        });
        if (!dataUrl) continue;
        const img = await loadImage(dataUrl).catch(() => null);
        if (!img) continue;
        const decoded = decodeQrDetailedFromMediaSource(img, qrScratchCanvasRef.current);
        if (decoded?.text) {
          decodedAny = true;
          await processDecodedQrText(decoded.text);
        }
      }
      if (!decodedAny) {
        setQrScanNotice('No QR code detected in selected image');
      }
      return;
    }

    const keepShooting = list.length > 1 ? false : isMultiMode;

    setDetecting(true);
    try {
      // In Auto mode with a single upload, check for QR code before cropping as paper
      if (scanMode === 'auto' && list.length === 1 && retakeTargetIdx === null) {
        if (!qrScratchCanvasRef.current) {
          qrScratchCanvasRef.current = document.createElement('canvas');
        }
        const singleUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result || ''));
          reader.readAsDataURL(list[0]);
        });
        if (singleUrl) {
          const img = await loadImage(singleUrl).catch(() => null);
          if (img) {
            const decoded = decodeQrDetailedFromMediaSource(img, qrScratchCanvasRef.current);
            if (decoded?.text) {
              await processDecodedQrText(decoded.text);
              return;
            }
          }
        }
      }

      const added: QueuedCapture[] = [];
      for (const file of list) {
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result || ''));
          reader.readAsDataURL(file);
        });
        if (!dataUrl) continue;
        const quad: QuadCorners = autoEdgeDetect
          ? await detectCornersFromDataUrl(dataUrl, { scanHint: activeCornerHint })
          : [
              { x: 0.04, y: 0.04 },
              { x: 0.96, y: 0.04 },
              { x: 0.96, y: 0.96 },
              { x: 0.04, y: 0.96 },
            ];
        added.push({
          id: crypto.randomUUID(),
          label: file.name.replace(/\.[^.]+$/, '') || 'Uploaded Scan',
          originalDataUrl: dataUrl,
          quad,
        });
      }

      if (added.length === 0) return;
      const prev = queueRef.current;
      const targetReplace = retakeTargetIdx;

      if (
        added.length === 1 &&
        targetReplace !== null &&
        targetReplace >= 0 &&
        targetReplace < prev.length
      ) {
        const next = prev.map((existing, idx) => (idx === targetReplace ? added[0] : existing));
        commitQueue(next);
        setSelectedQueueIdx(targetReplace);
        setRetakeTargetIdx(null);
        setStage('crop_review');
        return;
      }

      const next = [...prev, ...added];
      commitQueue(next);
      setSelectedQueueIdx(next.length - 1);
      if (!keepShooting && (scanMode !== 'id_card' || next.length >= 2)) {
        setStage('crop_review');
      }
    } finally {
      setDetecting(false);
    }
  };

  const handleRemoveQueueItem = (idx: number) => {
    haptics.warning();
    const filtered = queueRef.current.filter((_, i) => i !== idx);
    commitQueue(filtered);
    if (filtered.length === 0) {
      setRetakeTargetIdx(null);
      setSelectedQueueIdx(0);
      setStage('viewfinder');
    } else {
      setSelectedQueueIdx((cur) => Math.max(0, Math.min(cur, filtered.length - 1)));
    }
  };

  const activeItem = queue[selectedQueueIdx] || null;

  const handleAutoDetectCurrent = async () => {
    if (!activeItem) return;
    haptics.tap();
    setDetecting(true);
    try {
      const nextQuad = await detectCornersFromDataUrl(activeItem.originalDataUrl, {
        scanHint: activeCornerHint,
      });
      const next = queueRef.current.map((item, i) =>
        i === selectedQueueIdx ? { ...item, quad: nextQuad } : item
      );
      commitQueue(next);
    } finally {
      setDetecting(false);
    }
  };

  const handleRotateSource90 = async () => {
    if (!activeItem) return;
    haptics.tap();
    const img = await loadImage(activeItem.originalDataUrl);
    const c = document.createElement('canvas');
    c.width = img.naturalHeight;
    c.height = img.naturalWidth;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    const rotatedUrl = c.toDataURL('image/jpeg', 0.92);
    const nextQuad = await detectCornersFromDataUrl(rotatedUrl, { scanHint: activeCornerHint });
    const next = queueRef.current.map((item, i) =>
      i === selectedQueueIdx ? { ...item, originalDataUrl: rotatedUrl, quad: nextQuad } : item
    );
    commitQueue(next);
  };

  const handleProcessAndShowResult = async () => {
    if (queue.length === 0) return;
    setProcessing(true);
    try {
      // ID Card 2-page workflow -> route directly to IdCardStudio with dewarped pair
      if (scanMode === 'id_card' && queue.length >= 2 && onCompleteIdPair) {
        haptics.success();
        onCompleteIdPair(
          queue[0].originalDataUrl,
          queue[0].quad,
          queue[1].originalDataUrl,
          queue[1].quad
        );
        onClose();
        return;
      }

      const builtPages: ScannedPage[] = [];
      for (const item of queue) {
        const dewarped = await perspectiveDewarp(item.originalDataUrl, item.quad, 1450);

        // Book mode (or Auto with user book-spread split toggle enabled) splits wide spread into Left & Right pages
        const shouldSplitBook =
          (scanMode === 'book' || (scanMode === 'auto' && splitAutoSpread)) &&
          dewarped.width > dewarped.height * 1.12;
        const pageSources = shouldSplitBook
          ? await splitHorizontalSpread(dewarped.dataUrl)
          : [dewarped.dataUrl];

        for (const srcUrl of pageSources) {
          const processed = await processPagePipeline(
            srcUrl,
            defaultFilter,
            { ...DEFAULT_ADJUSTMENTS },
            0,
            false,
            { maxDim: 1450 }
          );
          builtPages.push({
            id: crypto.randomUUID(),
            originalDataUrl: item.originalDataUrl,
            croppedDataUrl: srcUrl,
            processedDataUrl: processed.dataUrl,
            thumbnailDataUrl: processed.dataUrl,
            quad: item.quad,
            filter: defaultFilter,
            adjustments: { ...DEFAULT_ADJUSTMENTS },
            rotation: 0,
            flipH: false,
            annotations: [],
            watermark: { ...DEFAULT_WATERMARK },
            ocrText: '',
            width: processed.width,
            height: processed.height,
            createdAt: Date.now(),
          });
        }
      }

      const autoTitle =
        queue[0].label ||
        `${defaultFilenamePrefix}${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).replace(/\s+/g, '_')}`;
      const autoFolder: ScanDocument['folder'] =
        scanMode === 'book' ? 'notes' : scanMode === 'id_card' ? 'id_cards' : 'documents';

      haptics.success();
      onCompletePages(builtPages, {
        title: autoTitle,
        folder: autoFolder,
        appendToDocId: appendTargetDocId,
      });
      onClose();
    } finally {
      setProcessing(false);
    }
  };

  const livePolygonPts = liveQuad ? liveQuad.map((p) => `${p.x * 100},${p.y * 100}`).join(' ') : '';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Native Document Camera Scanner"
      data-testid="native-camera-scanner"
      className="fixed inset-0 z-50 flex flex-col bg-black text-white select-none"
    >
      {stage === 'viewfinder' ? (
        <>
          {/* Top Native Android Camera Bar: Close on left, Zoom / Flash / Options on top-right */}
          <header className="relative z-20 flex h-14 shrink-0 items-center justify-between gap-2 bg-gradient-to-b from-black/85 via-black/50 to-transparent px-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  haptics.tap();
                  if (retakeTargetIdx !== null && queue.length > 0) {
                    setRetakeTargetIdx(null);
                    setStage('crop_review');
                  } else {
                    onClose();
                  }
                }}
                aria-label="Close camera"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60 active:scale-95 transition-transform cursor-pointer"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>

              <span
                data-testid="camera-mode-status-pill"
                className="inline-flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1 text-xs font-medium text-white/90 whitespace-nowrap"
              >
                {scanMode === 'auto' && retakeTargetIdx === null && (
                  <Sparkles className="h-3 w-3 text-teal-300" aria-hidden="true" />
                )}
                <span>
                  {retakeTargetIdx !== null
                    ? `Retaking Page ${retakeTargetIdx + 1}`
                    : scanMode === 'auto'
                      ? autoDetectedScene === 'qr_transfer'
                        ? 'Auto · QR File Beam'
                        : autoDetectedScene === 'qr_code'
                          ? 'Auto · QR Code'
                          : autoDetectedScene === 'book_spread'
                            ? 'Auto · Book Spread'
                            : autoDetectedScene === 'id_card'
                              ? 'Auto · ID Card'
                              : isMultiMode
                                ? 'Auto · Batch'
                                : 'Auto · Doc & QR'
                      : scanMode === 'id_card'
                        ? queue.length === 0
                          ? 'ID Card · Front'
                          : 'ID Card · Back'
                        : scanMode === 'book'
                          ? 'Book Spread · Split'
                          : scanMode === 'qr'
                            ? qrCollector.total > 0 && !qrCompletedPayload
                              ? `QR Beam · ${Math.round((qrCollector.receivedCount / qrCollector.total) * 100)}% (${qrCollector.receivedCount}/${qrCollector.total})`
                              : 'QR Code · Live Scanner'
                            : isMultiMode
                              ? 'Batch Multi-Page'
                              : 'Document Auto-Crop'}
                </span>
              </span>
            </div>

            {/* Top-Right Camera Controls: Flash & Options (Zoom handled via pinch/wheel/double-tap gestures) */}
            <div className="flex items-center gap-1.5">
              {/* Flash Toggle */}
              <button
                type="button"
                onClick={cycleFlash}
                aria-label={`Flash ${flashMode}`}
                className={`flex h-11 min-w-[44px] items-center justify-center gap-1 rounded-full px-2.5 text-xs font-semibold transition-colors cursor-pointer ${
                  flashMode === 'on'
                    ? 'bg-amber-400 text-slate-950'
                    : flashMode === 'auto'
                      ? 'bg-black/65 border border-amber-400/70 text-amber-300'
                      : 'bg-black/55 border border-white/15 text-white'
                }`}
              >
                {flashMode === 'off' ? (
                  <ZapOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Zap className="h-4 w-4" aria-hidden="true" />
                )}
                {flashMode === 'auto' && <span className="text-[10px]">A</span>}
              </button>

              {/* Camera Options */}
              <button
                type="button"
                onClick={() => {
                  haptics.tap();
                  setOptionsOpen((o) => !o);
                }}
                aria-label="Camera options"
                aria-expanded={optionsOpen}
                className={`flex h-11 w-11 items-center justify-center rounded-full border transition-colors cursor-pointer ${
                  optionsOpen
                    ? 'border-teal-400 bg-teal-500/25 text-teal-300'
                    : 'border-white/15 bg-black/55 text-white'
                }`}
              >
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </header>

          {/* Top-right Options Popover */}
          {optionsOpen && (
            <div className="absolute right-3 top-16 z-30 w-60 rounded-2xl border border-white/15 bg-zinc-900/95 p-2 shadow-2xl backdrop-blur-md">
              <button
                type="button"
                onClick={() => {
                  haptics.tap();
                  setGridEnabled((g) => !g);
                }}
                className="flex min-h-[44px] w-full items-center justify-between rounded-xl px-3 text-xs font-medium text-white hover:bg-white/10 cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Grid3x3 className="h-4 w-4 text-teal-400" aria-hidden="true" />
                  <span>Framing Grid</span>
                </span>
                <span className="text-teal-400 font-mono-tabular">{gridEnabled ? 'ON' : 'OFF'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  haptics.tap();
                  setLiveEdgeOn((e) => !e);
                }}
                className="flex min-h-[44px] w-full items-center justify-between rounded-xl px-3 text-xs font-medium text-white hover:bg-white/10 cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-teal-400" aria-hidden="true" />
                  <span>Live Edge Overlay</span>
                </span>
                <span className="text-teal-400 font-mono-tabular">{liveEdgeOn ? 'ON' : 'OFF'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  haptics.tap();
                  setFacingMode((f) => (f === 'environment' ? 'user' : 'environment'));
                  setOptionsOpen(false);
                }}
                className="flex min-h-[44px] w-full items-center justify-between rounded-xl px-3 text-xs font-medium text-white hover:bg-white/10 cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <SwitchCamera className="h-4 w-4 text-teal-400" aria-hidden="true" />
                  <span>Switch Camera</span>
                </span>
                <span className="text-white/60 capitalize">{facingMode === 'environment' ? 'Rear' : 'Front'}</span>
              </button>

              <div className="mt-1 border-t border-white/10 pt-1.5">
                {cameraStatus !== 'active' ? (
                  <button
                    type="button"
                    onClick={() => {
                      haptics.tap();
                      setOptionsOpen(false);
                      setPreferDemoLens(false);
                      requestCameraStream(facingMode);
                    }}
                    className="flex min-h-[40px] w-full items-center justify-between rounded-xl px-3 text-xs font-medium text-teal-300 hover:bg-white/10 cursor-pointer"
                  >
                    <span>Switch to Live Camera</span>
                    <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      haptics.tap();
                      stopCamera();
                      setPreferDemoLens(true);
                      setCameraStatus('demo');
                      setOptionsOpen(false);
                    }}
                    className="flex min-h-[40px] w-full items-center justify-between rounded-xl px-3 text-xs font-medium text-white/80 hover:bg-white/10 cursor-pointer"
                  >
                    <span>Use Demo Lens</span>
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}

                {cameraStatus === 'demo' && (
                  <>
                    <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/45">
                      Demo Lens Scene
                    </div>
                    {allDemoScenes.map((scene, idx) => (
                      <button
                        key={scene.id}
                        type="button"
                        onClick={() => {
                          haptics.tap();
                          setDemoSceneIdx(idx);
                          setOptionsOpen(false);
                        }}
                        className={`flex min-h-[40px] w-full items-center justify-between rounded-xl px-3 text-xs font-medium cursor-pointer ${
                          demoSceneIdx === idx ? 'bg-teal-500/20 text-teal-300' : 'text-white/80 hover:bg-white/10'
                        }`}
                      >
                        <span>{scene.label}</span>
                        {demoSceneIdx === idx && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                      </button>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Center Live Camera Video Feed Viewport (Pinch / Wheel / Double-Tap Gesture Zoom) */}
          <div
            ref={viewfinderStageRef}
            onPointerDown={handleViewfinderPointerDown}
            onPointerMove={handleViewfinderPointerMove}
            onPointerUp={handleViewfinderPointerUp}
            onPointerCancel={handleViewfinderPointerUp}
            onWheel={handleViewfinderWheel}
            data-testid="camera-viewfinder-stage"
            className="relative flex flex-1 min-h-0 items-center justify-center overflow-hidden bg-zinc-950 touch-none"
          >
            <div className="relative h-full w-full flex items-center justify-center overflow-hidden">
              {/* Always keep <video> mounted so ref is ready the instant getUserMedia resolves */}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                data-testid="live-camera-video"
                style={{
                  transform: `scale(${zoomLevel}) ${facingMode === 'user' ? 'scaleX(-1)' : ''}`,
                  filter: flashMode === 'on' ? 'brightness(1.12)' : undefined,
                }}
                className={`h-full w-full object-cover transition-transform duration-75 ${
                  cameraActive ? 'block' : 'hidden'
                }`}
              />

              {cameraStatus === 'requesting' && (
                <div className="flex flex-col items-center justify-center gap-3 px-6 text-center">
                  <Camera className="h-10 w-10 text-teal-400 animate-pulse" aria-hidden="true" />
                  <p className="text-sm font-medium text-white/90">Starting live camera feed...</p>
                  <p className="text-xs text-white/55">Allow camera permission if prompted by your browser.</p>
                </div>
              )}

              {cameraStatus === 'blocked' && (
                <div className="flex max-w-sm flex-col items-center justify-center gap-3 px-6 text-center z-10">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-teal-400">
                    <Camera className="h-7 w-7" aria-hidden="true" />
                  </div>
                  <h3 className="text-base font-bold text-white">Camera Permission Needed</h3>
                  <p className="text-xs leading-relaxed text-white/75">
                    {cameraErrorMsg || 'Tap Allow Live Camera below, or open your phone’s native camera app directly.'}
                  </p>
                  <div className="mt-1 flex w-full flex-col gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        haptics.tap();
                        setPreferDemoLens(false);
                        requestCameraStream(facingMode);
                      }}
                      className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-2xl bg-teal-500 px-4 text-sm font-bold text-slate-950 active:scale-[0.98] cursor-pointer"
                    >
                      <Camera className="h-4 w-4" aria-hidden="true" />
                      <span>Allow Live Camera</span>
                    </button>

                    <label className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-2xl border border-white/25 bg-white/10 px-4 text-sm font-semibold text-white active:scale-[0.98] cursor-pointer">
                      <Camera className="h-4 w-4 text-teal-300" aria-hidden="true" />
                      <span>Open Device Camera App</span>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        aria-label="Open device native camera"
                        onChange={(e) => handleGalleryUpload(e.target.files)}
                        className="sr-only"
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() => {
                        haptics.tap();
                        setPreferDemoLens(true);
                        setCameraStatus('demo');
                      }}
                      className="flex min-h-[42px] w-full items-center justify-center gap-1.5 rounded-xl text-xs font-medium text-white/70 hover:text-white cursor-pointer"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-teal-400" aria-hidden="true" />
                      <span>Try Interactive Demo Lens Instead</span>
                    </button>
                  </div>
                </div>
              )}

              {cameraStatus === 'demo' && (
                <div className="relative h-full w-full flex items-center justify-center bg-zinc-950">
                  <img
                    ref={demoImgRef}
                    src={activeDemo.url}
                    alt={`Live camera lens preview (${activeDemo.label})`}
                    referrerPolicy="no-referrer"
                    style={{
                      transform: `scale(${zoomLevel})`,
                      filter: flashMode === 'on' ? 'brightness(1.15)' : undefined,
                    }}
                    className="h-full w-full object-cover opacity-95 transition-transform duration-75"
                  />
                  <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[11px] font-medium text-white/85 backdrop-blur-xs whitespace-nowrap">
                    Demo Lens · {activeDemo.label}
                  </div>
                </div>
              )}

              {/* 3x3 Framing Grid */}
              {gridEnabled && (
                <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                  {Array.from({ length: 9 }).map((_, idx) => (
                    <div key={idx} className="border border-white/10" />
                  ))}
                </div>
              )}

              {/* Mode-Specific Guides */}
              {scanMode === 'book' && (
                <div className="pointer-events-none absolute inset-y-6 left-1/2 -translate-x-1/2 border-l-2 border-dashed border-amber-300/80 flex items-end pb-4">
                  <span className="ml-2 rounded bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
                    Book Spine Split
                  </span>
                </div>
              )}

              {scanMode === 'id_card' && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
                  <div className="w-full max-w-sm aspect-[85.6/53.98] rounded-2xl border-2 border-dashed border-teal-400/85 bg-teal-400/5 flex items-end justify-center pb-2">
                    <span className="rounded-full bg-black/65 px-3 py-0.5 text-[11px] font-semibold text-teal-200">
                      {queue.length === 0 ? 'Align ID Front Side' : 'Align ID Back Side'}
                    </span>
                  </div>
                </div>
              )}

              {/* Continuous QR Scanner Targeting Reticle + Live Chunk Matrix */}
              {scanMode === 'qr' && (
                <div
                  data-testid="qr-scanner-overlay"
                  className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-6"
                >
                  {/* Active Scanning Status Pill */}
                  <div className="mb-3 flex items-center gap-2 rounded-full border border-white/20 bg-black/70 px-3.5 py-1 text-xs font-medium text-white/95 backdrop-blur-md">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        qrCompletedPayload
                          ? 'bg-emerald-400'
                          : qrChunkFlash
                            ? 'bg-emerald-300 scale-125'
                            : 'bg-teal-400 animate-ping'
                      }`}
                    />
                    <span>{qrScanNotice || 'Scanning active · Align QR code inside frame'}</span>
                  </div>

                  <div
                    className={`relative h-60 w-60 sm:h-68 sm:w-68 rounded-3xl border-2 transition-all duration-200 overflow-hidden ${
                      qrCompletedPayload
                        ? 'border-emerald-400 bg-emerald-500/10 shadow-[0_0_30px_rgba(52,211,153,0.35)]'
                        : qrChunkFlash
                          ? 'border-emerald-300 bg-teal-400/20 shadow-[0_0_25px_rgba(45,212,191,0.45)]'
                          : 'border-teal-400/85 bg-black/15 shadow-[0_0_15px_rgba(20,184,166,0.2)]'
                    }`}
                  >
                    {/* Corner Accent Brackets */}
                    <span className="absolute -top-0.5 -left-0.5 h-7 w-7 rounded-tl-2xl border-t-4 border-l-4 border-teal-400" />
                    <span className="absolute -top-0.5 -right-0.5 h-7 w-7 rounded-tr-2xl border-t-4 border-r-4 border-teal-400" />
                    <span className="absolute -bottom-0.5 -left-0.5 h-7 w-7 rounded-bl-2xl border-b-4 border-l-4 border-teal-400" />
                    <span className="absolute -bottom-0.5 -right-0.5 h-7 w-7 rounded-br-2xl border-b-4 border-r-4 border-teal-400" />

                    {/* Animated Scanning Laser Line moving vertically */}
                    {!qrCompletedPayload && (
                      <div className="pointer-events-none absolute inset-x-2 h-0.5 bg-gradient-to-r from-transparent via-teal-300 to-transparent shadow-[0_0_8px_#2dd4bf] animate-qr-laser" />
                    )}

                    <div className="flex h-full flex-col items-center justify-end pb-3 px-3 text-center">
                      <span className="rounded-full bg-black/75 px-3 py-1 text-[11px] font-semibold text-white/90 backdrop-blur-xs">
                        {qrCollector.total > 0
                          ? `Receiving: ${qrCollector.receivedCount}/${qrCollector.total}`
                          : 'Standard QR or File Beam'}
                      </span>
                    </div>
                  </div>

                  {/* Prominent File Transfer Live Progress Report (in QR mode) */}
                  {qrCollector.total > 0 && !qrCompletedPayload && (
                    <div
                      data-testid="qr-scanner-progress"
                      onPointerDown={(e) => e.stopPropagation()}
                      className="pointer-events-auto mt-4 w-full max-w-sm rounded-2xl border border-teal-400/30 bg-zinc-950/90 p-4 text-white shadow-2xl backdrop-blur-md animate-sheet-up"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-teal-500/20 text-teal-300 animate-pulse">
                            <Radio className="h-4 w-4" aria-hidden="true" />
                          </span>
                          <div>
                            <h4 className="text-xs font-bold text-white">Receiving File Beam</h4>
                            <p className="text-[10px] text-teal-300/80">Keep camera pointed at sender screen</p>
                          </div>
                        </div>
                        <span className="text-sm font-mono-tabular font-bold text-teal-300">
                          {Math.round((qrCollector.receivedCount / qrCollector.total) * 100)}%
                        </span>
                      </div>

                      {/* Smooth Progress Bar */}
                      <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-white/15">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-teal-400 to-emerald-400 transition-all duration-150"
                          style={{
                            width: `${Math.round((qrCollector.receivedCount / qrCollector.total) * 100)}%`,
                          }}
                        />
                      </div>

                      <div className="mt-2 flex items-center justify-between text-[11px] text-white/70">
                        <span>
                          Chunks: <strong className="text-white font-mono-tabular">{qrCollector.receivedCount}</strong> / {qrCollector.total}
                        </span>
                        {qrCollector.duplicateCount > 0 ? (
                          <span className="text-amber-300/90 text-[10px]">
                            {qrCollector.duplicateCount} dupes (sender looping)
                          </span>
                        ) : (
                          <span className="text-emerald-300/90 text-[10px]">In sync</span>
                        )}
                      </div>

                      {/* Visual Chunk Matrix */}
                      <div className="mt-2 grid grid-cols-10 gap-1 rounded-xl bg-black/40 p-2 border border-white/5">
                        {summarizeCollectorProgress(qrCollector, 40).map((status, idx) => (
                          <span
                            key={idx}
                            className={`h-1.5 rounded-full transition-colors ${
                              status === 'done'
                                ? 'bg-emerald-400 shadow-[0_0_4px_#34d399]'
                                : status === 'partial'
                                  ? 'bg-teal-400/70'
                                  : 'bg-white/15'
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Auto-Mode Live QR Progress Toast (when receiving file beam chunks in auto mode) */}
              {scanMode === 'auto' && qrCollector.total > 0 && !qrCompletedPayload && (
                <div
                  data-testid="qr-scanner-progress"
                  onPointerDown={(e) => e.stopPropagation()}
                  className="absolute inset-x-3 bottom-3 z-30 mx-auto max-w-sm rounded-2xl border border-teal-400/30 bg-zinc-950/90 p-4 text-white shadow-2xl backdrop-blur-md animate-sheet-up"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-500/20 text-teal-300 animate-pulse">
                        <Radio className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <div>
                        <h4 className="text-xs font-bold text-white">QR File Transfer</h4>
                        <p className="text-[10px] text-teal-300/80">Keep camera pointed at sender</p>
                      </div>
                    </div>
                    <span className="text-sm font-mono-tabular font-bold text-teal-300">
                      {Math.round((qrCollector.receivedCount / qrCollector.total) * 100)}%
                    </span>
                  </div>

                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/15">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-teal-400 to-emerald-400 transition-all duration-150"
                      style={{
                        width: `${Math.round((qrCollector.receivedCount / qrCollector.total) * 100)}%`,
                      }}
                    />
                  </div>

                  <div className="mt-2 flex items-center justify-between text-[11px] text-white/70">
                    <span>
                      Chunks: <strong className="text-white font-mono-tabular">{qrCollector.receivedCount}</strong> / {qrCollector.total}
                    </span>
                  </div>

                  <div className="mt-2 grid grid-cols-10 gap-1">
                    {summarizeCollectorProgress(qrCollector, 40).map((status, idx) => (
                      <span
                        key={idx}
                        className={`h-1.5 rounded-full ${
                          status === 'done'
                            ? 'bg-emerald-400'
                            : status === 'partial'
                              ? 'bg-teal-400/70'
                              : 'bg-white/20'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Auto Mode Quick QR Chip (Tap to open or click shutter to scan) */}
              {scanMode === 'auto' && autoQrPill && !qrPlainText && !qrCompletedPayload && (
                <div
                  onPointerDown={(e) => e.stopPropagation()}
                  className="absolute bottom-24 left-1/2 -translate-x-1/2 z-30 max-w-sm px-4 w-full flex justify-center animate-sheet-up"
                >
                  <button
                    type="button"
                    onClick={() => {
                      haptics.tap();
                      void processDecodedQrText(autoQrPill);
                    }}
                    className="flex items-center gap-2.5 rounded-full border border-teal-400/50 bg-black/85 px-4 py-2 text-xs font-semibold text-white shadow-2xl backdrop-blur-md hover:bg-black/95 active:scale-95 cursor-pointer"
                  >
                    <QrCode className="h-4 w-4 text-teal-300" aria-hidden="true" />
                    <span className="truncate max-w-[200px]">{autoQrPill}</span>
                    <span className="rounded-full bg-teal-500/25 px-2 py-0.5 text-[10px] font-bold text-teal-300 uppercase">
                      View
                    </span>
                  </button>
                </div>
              )}

              {/* QR Transfer Complete Sheet (works in both QR & Auto modes) */}
              {(scanMode === 'qr' || scanMode === 'auto') && qrCompletedPayload && (
                <div
                  data-testid="qr-completed-card"
                  onPointerDown={(e) => e.stopPropagation()}
                  className="absolute inset-x-3 bottom-3 z-30 mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-2xl animate-sheet-up"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700">
                        <Check className="h-4 w-4" aria-hidden="true" />
                        <span>Received via QR Beam</span>
                      </div>
                      <h3 className="mt-0.5 truncate text-sm font-bold text-slate-900">
                        {qrCompletedPayload.title}
                      </h3>
                      <p className="text-xs text-slate-500">
                        {qrCompletedPayload.filename} · {formatByteSize(qrCompletedPayload.byteLength)}
                        {qrCompletedPayload.pages ? ` · ${qrCompletedPayload.pages.length} page(s)` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setQrCompletedPayload(null);
                        setQrCollector(createCollectorState());
                        setQrScanNotice('Scanning active · Align QR code inside frame');
                      }}
                      aria-label="Scan another QR file"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 cursor-pointer"
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {onQrFileReceived && (
                      <button
                        type="button"
                        onClick={() => {
                          haptics.success();
                          onQrFileReceived(qrCompletedPayload, 'save_to_library');
                          onClose();
                        }}
                        data-testid="qr-save-to-library-btn"
                        className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-teal-600 px-3 text-xs font-bold text-white hover:bg-teal-700 cursor-pointer"
                      >
                        <FolderPlus className="h-4 w-4" aria-hidden="true" />
                        <span>Save to Library</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        haptics.tap();
                        let blob: Blob;
                        if (qrCompletedPayload.fileBytes) {
                          const copy = new Uint8Array(qrCompletedPayload.fileBytes.byteLength);
                          copy.set(qrCompletedPayload.fileBytes);
                          blob = new Blob([copy.buffer], { type: qrCompletedPayload.mime });
                        } else if (qrCompletedPayload.text !== undefined) {
                          blob = new Blob([qrCompletedPayload.text], { type: 'text/plain;charset=utf-8' });
                        } else if (qrCompletedPayload.pages?.[0]) {
                          const rawB64 = qrCompletedPayload.pages[0].dataB64
                            .replace(/-/g, '+')
                            .replace(/_/g, '/');
                          const bin = atob(rawB64);
                          const bytes = new Uint8Array(bin.length);
                          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                          blob = new Blob([bytes.buffer], { type: qrCompletedPayload.pages[0].mime });
                        } else {
                          blob = new Blob([JSON.stringify(qrCompletedPayload)], { type: 'application/json' });
                        }
                        const dlUrl = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = dlUrl;
                        a.download = qrCompletedPayload.filename;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        window.setTimeout(() => URL.revokeObjectURL(dlUrl), 1000);
                      }}
                      data-testid="qr-download-received-btn"
                      className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
                    >
                      <Download className="h-4 w-4" aria-hidden="true" />
                      <span>Download File</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Standard Single Plain-Text / URL QR Result Card (works in both QR & Auto modes) */}
              {(scanMode === 'qr' || scanMode === 'auto') && qrPlainText && !qrCompletedPayload && (
                <div
                  data-testid="qr-plain-text-card"
                  onPointerDown={(e) => e.stopPropagation()}
                  className="absolute inset-x-3 bottom-3 z-30 mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-2xl animate-sheet-up"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-teal-700">
                        <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{/^https?:\/\//i.test(qrPlainText.trim()) ? 'Web Link QR' : 'QR Code Content'}</span>
                      </div>
                      <p className="mt-1 break-all text-xs font-medium text-slate-800 line-clamp-3 select-text">
                        {qrPlainText}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setQrPlainText(null)}
                      aria-label="Dismiss scanned QR text"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 cursor-pointer"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {/* Open URL directly if link */}
                    {/^https?:\/\//i.test(qrPlainText.trim()) ? (
                      <button
                        type="button"
                        onClick={() => {
                          haptics.tap();
                          window.open(qrPlainText.trim(), '_blank', 'noopener,noreferrer');
                        }}
                        className="inline-flex min-h-[38px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-teal-600 px-3 text-xs font-bold text-white hover:bg-teal-700 cursor-pointer"
                      >
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Open Link</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          haptics.tap();
                          window.open(`https://www.google.com/search?q=${encodeURIComponent(qrPlainText.trim())}`, '_blank', 'noopener,noreferrer');
                        }}
                        className="inline-flex min-h-[38px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
                      >
                        <Search className="h-3.5 w-3.5 text-teal-600" aria-hidden="true" />
                        <span>Search Web</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={async () => {
                        await navigator.clipboard?.writeText(qrPlainText).catch(() => {});
                        setQrCopied(true);
                        window.setTimeout(() => setQrCopied(false), 1500);
                      }}
                      className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
                    >
                      {qrCopied ? <Check className="h-3.5 w-3.5 text-teal-600" /> : <Copy className="h-3.5 w-3.5" />}
                      <span>{qrCopied ? 'Copied' : 'Copy'}</span>
                    </button>

                    {onQrFileReceived && (
                      <button
                        type="button"
                        onClick={() => {
                          haptics.success();
                          onQrFileReceived(
                            {
                              v: 1,
                              kind: 'text',
                              title: 'QR Note',
                              filename: 'qr-note.txt',
                              mime: 'text/plain',
                              byteLength: new TextEncoder().encode(qrPlainText).byteLength,
                              text: qrPlainText,
                            },
                            'save_note'
                          );
                          onClose();
                        }}
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-teal-600 px-3 text-xs font-bold text-white hover:bg-teal-700 cursor-pointer"
                      >
                        <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Save as Note</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        haptics.tap();
                        setQrPlainText(null);
                        setQrScanNotice('Scanning active · Align QR code inside frame');
                      }}
                      className="inline-flex min-h-[38px] items-center gap-1 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Scan Another</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Real-time Auto-Edge Tracking Polygon + Corner Lock Anchors */}
              {liveEdgeOn && liveQuad && livePolygonPts && scanMode !== 'id_card' && scanMode !== 'qr' && (
                <>
                  <svg
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    className="pointer-events-none absolute inset-0 h-full w-full"
                  >
                    <polygon
                      points={livePolygonPts}
                      fill={edgeLocked ? 'rgba(16, 185, 129, 0.16)' : 'rgba(20, 184, 166, 0.12)'}
                      stroke={edgeLocked ? '#34d399' : '#2dd4bf'}
                      strokeWidth={edgeLocked ? '0.8' : '0.6'}
                      vectorEffect="non-scaling-stroke"
                      className="transition-all duration-150"
                    />
                    {liveQuad.map((corner, idx) => (
                      <circle
                        key={idx}
                        cx={corner.x * 100}
                        cy={corner.y * 100}
                        r={edgeLocked ? 1.45 : 1.15}
                        fill={edgeLocked ? '#10b981' : '#2dd4bf'}
                        stroke="#ffffff"
                        strokeWidth="0.4"
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                  </svg>
                  {edgeLocked && (
                    <div
                      data-testid="live-edge-lock-badge"
                      className="pointer-events-none absolute top-11 left-1/2 z-10 -translate-x-1/2 rounded-full bg-emerald-500/90 px-2.5 py-0.5 text-[10px] font-semibold text-slate-950 shadow-sm backdrop-blur-xs whitespace-nowrap"
                    >
                      Edges Locked
                    </div>
                  )}
                </>
              )}

              {/* Gesture Zoom Level Reset Indicator (only visible when zoomed > 1.0x) */}
              {zoomLevel > 1.02 && (
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    haptics.tap();
                    setZoomLevel(1.0);
                  }}
                  data-testid="gesture-zoom-badge"
                  aria-label={`Reset zoom from ${zoomLevel.toFixed(1)}x to 1.0x`}
                  className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full border border-white/20 bg-black/65 px-3 py-1 text-xs font-mono-tabular font-semibold text-teal-300 backdrop-blur-xs active:scale-95 cursor-pointer"
                >
                  {zoomLevel.toFixed(1)}×
                </button>
              )}

              {/* Shutter Flash Burst */}
              {shutterFlash && (
                <div className="pointer-events-none absolute inset-0 bg-white/85 transition-opacity" />
              )}
            </div>
          </div>

          {/* Bottom Android Camera Controls: Mode Carousel + Upload / Shutter / Multi-Toggle & Stack */}
          <footer className="relative z-20 shrink-0 bg-gradient-to-t from-black via-black/95 to-black/80 pt-2.5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            {/* Scan Mode Switcher (Auto / Docs / ID Card / Book / QR File) */}
            <div
              role="tablist"
              aria-label="Scan mode"
              className="mx-auto mb-3 flex max-w-lg items-center justify-center gap-1 sm:gap-1.5 overflow-x-auto px-2.5"
            >
              {MODE_ITEMS.map((m) => {
                const Icon = m.icon;
                const active = scanMode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => handleModeSwitch(m.id)}
                    className={`inline-flex min-h-[36px] items-center gap-1 rounded-full px-2.5 sm:px-3.5 text-[11px] sm:text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer active:scale-95 ${
                      active
                        ? 'bg-teal-500 text-slate-950 shadow-sm'
                        : 'bg-white/10 text-white/80 hover:bg-white/20'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>{m.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Bottom 3-Slot Action Row: Gallery Upload | Center Shutter | Mode Action (Done / Multi / QR Reset) */}
            <div className="mx-auto flex max-w-lg items-center justify-between px-5">
              {/* Left: Gallery / QR Picture Upload */}
              <label className="flex min-w-[72px] flex-col items-center gap-1 cursor-pointer active:scale-95 transition-transform">
                <span className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl border border-white/25 bg-white/10 hover:bg-white/20">
                  {scanMode !== 'qr' && queue.length > 0 ? (
                    <img
                      src={queue[queue.length - 1].originalDataUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <ImagePlus className="h-5 w-5 text-white" aria-hidden="true" />
                  )}
                </span>
                <span className="text-[11px] font-medium text-white/85">
                  {scanMode === 'qr' ? 'Upload QR' : 'Upload'}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  multiple={scanMode !== 'qr'}
                  aria-label={scanMode === 'qr' ? 'Upload QR code image' : 'Upload photos from device'}
                  onChange={(e) => handleGalleryUpload(e.target.files)}
                  className="sr-only"
                />
              </label>

              {/* Center: Camera Shutter Trigger (works in all modes including QR Code!) */}
              <button
                type="button"
                disabled={detecting}
                onClick={handleShutterPress}
                aria-label={scanMode === 'qr' ? 'Scan QR frame' : 'Capture photo'}
                data-testid="camera-shutter-button"
                className="relative flex h-[76px] w-[76px] items-center justify-center rounded-full border-4 border-white/90 bg-white/15 active:scale-92 transition-transform disabled:opacity-60 cursor-pointer"
              >
                <span className="flex h-[58px] w-[58px] items-center justify-center rounded-full bg-white text-slate-950 shadow-lg">
                  {scanMode === 'qr' ? (
                    <QrCode className="h-6 w-6 text-teal-700" aria-hidden="true" />
                  ) : (
                    <Camera className="h-6 w-6 text-teal-700" aria-hidden="true" />
                  )}
                </span>
              </button>

              {/* Right: Mode-Specific Action (QR: Reset / Clear | Docs: Done(N) or Multi Toggle) */}
              <div className="flex min-w-[84px] flex-col items-end gap-1.5">
                {scanMode === 'qr' ? (
                  <button
                    type="button"
                    onClick={() => {
                      haptics.tap();
                      setQrCollector(createCollectorState());
                      setQrCompletedPayload(null);
                      setQrPlainText(null);
                      setQrScanNotice('Scanning active · Align QR code inside frame');
                    }}
                    aria-label="Reset QR scanner"
                    className="flex min-h-[44px] items-center gap-1.5 rounded-2xl border border-white/20 bg-white/10 px-3.5 text-xs font-semibold text-white/90 hover:bg-white/20 active:scale-95 transition-colors cursor-pointer"
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    <span>Reset</span>
                  </button>
                ) : queue.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      haptics.tap();
                      setStage('crop_review');
                    }}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-2xl bg-teal-500 px-3.5 text-xs font-bold text-slate-950 shadow-lg active:scale-95 cursor-pointer"
                  >
                    <Check className="h-4 w-4" aria-hidden="true" />
                    <span>Done ({queue.length})</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      haptics.tap();
                      setIsMultiMode((m) => !m);
                    }}
                    aria-pressed={isMultiMode}
                    aria-label="Toggle multiple page mode"
                    className={`flex min-h-[44px] items-center gap-1.5 rounded-2xl border px-3 text-xs font-semibold active:scale-95 transition-colors cursor-pointer ${
                      isMultiMode
                        ? 'border-teal-400 bg-teal-500/20 text-teal-300'
                        : 'border-white/20 bg-white/10 text-white/80'
                    }`}
                  >
                    <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{isMultiMode ? 'Multi' : 'Single'}</span>
                  </button>
                )}
              </div>
            </div>
          </footer>
        </>
      ) : (
        /* STAGE B: Redesigned Cohesive Light-Theme Crop Verification */
        <div
          data-testid="crop-review-stage"
          className="flex h-full flex-col bg-slate-100 text-slate-900"
        >
          {/* Clean Header */}
          <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3 sm:px-5">
            <button
              type="button"
              onClick={() => {
                haptics.tap();
                onClose();
              }}
              aria-label="Cancel scan"
              className="inline-flex h-10 items-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Cancel</span>
            </button>

            <div className="text-center">
              <span className="text-sm font-bold tracking-tight text-slate-900">
                {scanMode === 'id_card'
                  ? selectedQueueIdx === 0
                    ? 'Verify Front Crop'
                    : 'Verify Back Crop'
                  : queue.length > 1
                    ? `Verify Page ${selectedQueueIdx + 1} of ${queue.length}`
                    : 'Verify Auto-Crop'}
              </span>
            </div>

            {scanMode !== 'id_card' ? (
              <button
                type="button"
                onClick={() => {
                  haptics.tap();
                  setRetakeTargetIdx(null);
                  setIsMultiMode(true);
                  setStage('viewfinder');
                }}
                className="inline-flex h-10 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-teal-700 hover:bg-teal-50 cursor-pointer"
              >
                <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Add Page</span>
              </button>
            ) : (
              <div className="w-10 sm:w-16" aria-hidden="true" />
            )}
          </header>

          {/* Clean Multi-Page Switcher Strip (Non-overlapping thumbs) */}
          {queue.length > 1 && (
            <div className="flex shrink-0 items-center justify-center gap-2 overflow-x-auto border-b border-slate-200 bg-white/90 px-4 py-2">
              {queue.map((item, idx) => {
                const active = idx === selectedQueueIdx;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      haptics.tap();
                      setSelectedQueueIdx(idx);
                    }}
                    className={`flex shrink-0 items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left transition-all cursor-pointer ${
                      active
                        ? 'border-teal-600 bg-teal-50 ring-2 ring-teal-500/20'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <img
                      src={item.originalDataUrl}
                      alt={`Captured page ${idx + 1}`}
                      className="h-8 w-8 rounded-lg object-cover border border-slate-200"
                    />
                    <span
                      className={`text-xs font-bold ${
                        active ? 'text-teal-900' : 'text-slate-700'
                      }`}
                    >
                      {scanMode === 'id_card' ? (idx === 0 ? 'Front' : 'Back') : `P${idx + 1}`}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Perspective Corner Verification Canvas */}
          <div className="flex flex-1 min-h-0 items-center justify-center overflow-y-auto p-3 sm:p-6">
            {activeItem && (
              <div className="mx-auto w-full max-w-3xl">
                <PerspectiveCropCanvas
                  hideTopActions
                  imageSrc={activeItem.originalDataUrl}
                  quad={activeItem.quad}
                  onChange={(nextQuad) => {
                    const next = queueRef.current.map((item, i) =>
                      i === selectedQueueIdx ? { ...item, quad: nextQuad } : item
                    );
                    commitQueue(next);
                  }}
                  onAutoDetect={handleAutoDetectCurrent}
                  detecting={detecting}
                />
              </div>
            )}
          </div>

          {/* Unified Action Toolbar + Safe Bottom Primary Footer */}
          <footer className="shrink-0 border-t border-slate-200 bg-white px-4 pt-2.5 pb-[max(1.15rem,env(safe-area-inset-bottom))] sm:pb-5 shadow-[0_-6px_24px_-12px_rgba(15,23,42,0.1)]">
            <div className="mx-auto flex max-w-2xl flex-col gap-3">
              {/* Tool Strip: Per-page Retake, Auto-Detect, Full Frame, Rotate 90°, Delete */}
              <div className="grid grid-cols-5 gap-1.5">
                <button
                  type="button"
                  data-testid="crop-retake-btn"
                  onClick={() => {
                    haptics.tap();
                    if (queue.length <= 1) {
                      commitQueue([]);
                      setRetakeTargetIdx(null);
                    } else {
                      setRetakeTargetIdx(selectedQueueIdx);
                    }
                    setStage('viewfinder');
                  }}
                  className="flex min-h-[46px] flex-col items-center justify-center gap-0.5 rounded-xl border border-slate-200 bg-slate-50/70 px-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 active:scale-95 transition cursor-pointer"
                >
                  <Camera className="h-4 w-4 text-slate-700" aria-hidden="true" />
                  <span className="truncate max-w-full">
                    {queue.length > 1
                      ? `Retake P${selectedQueueIdx + 1}`
                      : 'Retake'}
                  </span>
                </button>

                <button
                  type="button"
                  data-testid="crop-auto-detect-btn"
                  disabled={detecting}
                  onClick={handleAutoDetectCurrent}
                  className="flex min-h-[46px] flex-col items-center justify-center gap-0.5 rounded-xl border border-slate-200 bg-slate-50/70 px-1 text-[11px] font-semibold text-teal-800 hover:bg-teal-50 disabled:opacity-50 active:scale-95 transition cursor-pointer"
                >
                  <Sparkles className="h-4 w-4 text-teal-600" aria-hidden="true" />
                  <span>{detecting ? 'Scan...' : 'Auto'}</span>
                </button>

                <button
                  type="button"
                  data-testid="crop-full-frame-btn"
                  onClick={() => {
                    haptics.tap();
                    if (!activeItem) return;
                    const full: QuadCorners = [
                      { x: 0.01, y: 0.01 },
                      { x: 0.99, y: 0.01 },
                      { x: 0.99, y: 0.99 },
                      { x: 0.01, y: 0.99 },
                    ];
                    const next = queueRef.current.map((item, i) =>
                      i === selectedQueueIdx ? { ...item, quad: full } : item
                    );
                    commitQueue(next);
                  }}
                  className="flex min-h-[46px] flex-col items-center justify-center gap-0.5 rounded-xl border border-slate-200 bg-slate-50/70 px-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 active:scale-95 transition cursor-pointer"
                >
                  <Maximize2 className="h-4 w-4 text-slate-600" aria-hidden="true" />
                  <span>Full</span>
                </button>

                <button
                  type="button"
                  data-testid="crop-rotate-btn"
                  onClick={handleRotateSource90}
                  className="flex min-h-[46px] flex-col items-center justify-center gap-0.5 rounded-xl border border-slate-200 bg-slate-50/70 px-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 active:scale-95 transition cursor-pointer"
                >
                  <RotateCw className="h-4 w-4 text-slate-700" aria-hidden="true" />
                  <span>Rotate</span>
                </button>

                <button
                  type="button"
                  data-testid="crop-delete-btn"
                  onClick={() => handleRemoveQueueItem(selectedQueueIdx)}
                  className="flex min-h-[46px] flex-col items-center justify-center gap-0.5 rounded-xl border border-red-200/80 bg-red-50/60 px-1 text-[11px] font-semibold text-red-700 hover:bg-red-100 active:scale-95 transition cursor-pointer"
                >
                  <Trash2 className="h-4 w-4 text-red-600" aria-hidden="true" />
                  <span>Delete</span>
                </button>
              </div>

              {scanMode === 'auto' && activeItem && Math.hypot(activeItem.quad[1].x - activeItem.quad[0].x, activeItem.quad[1].y - activeItem.quad[0].y) > Math.hypot(activeItem.quad[3].x - activeItem.quad[0].x, activeItem.quad[3].y - activeItem.quad[0].y) * 1.24 && (
                <button
                  type="button"
                  onClick={() => {
                    haptics.tap();
                    setSplitAutoSpread((v) => !v);
                  }}
                  aria-pressed={splitAutoSpread}
                  className={`flex items-center justify-between rounded-xl border px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                    splitAutoSpread
                      ? 'border-teal-500 bg-teal-50 text-teal-800'
                      : 'border-slate-200 bg-slate-50/70 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    <BookOpen className="h-3.5 w-3.5 text-teal-600" aria-hidden="true" />
                    <span>Wide 2-page spread detected — split down spine</span>
                  </span>
                  <span className="font-mono-tabular text-[11px] font-bold">
                    {splitAutoSpread ? 'ON' : 'OFF'}
                  </span>
                </button>
              )}

              {/* Prominent Primary CTA with comfortable breathing room */}
              <button
                type="button"
                disabled={queue.length === 0 || processing}
                onClick={handleProcessAndShowResult}
                data-testid="apply-crop-result-btn"
                className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-teal-600 px-6 text-sm font-bold text-white shadow-md shadow-teal-600/20 hover:bg-teal-700 active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer"
              >
                <Check className="h-4 w-4" aria-hidden="true" />
                <span>
                  {processing
                    ? 'Enhancing Scan...'
                    : scanMode === 'id_card'
                      ? 'Make 2-Up ID Sheet'
                      : queue.length > 1
                        ? `Process ${queue.length} Pages`
                        : 'View Result'}
                </span>
              </button>
            </div>
          </footer>
        </div>
      )}
    </div>
  );
};
