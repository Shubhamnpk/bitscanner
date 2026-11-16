import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Camera,
  Check,
  CreditCard,
  FileText,
  Grid3x3,
  ImagePlus,
  Layers,
  Maximize2,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  SwitchCamera,
  Trash2,
  X,
  Zap,
  ZapOff,
} from 'lucide-react';
import type { FilterPreset, QuadCorners, ScanDocument, ScannedPage } from '../types/scanner';
import { DEFAULT_ADJUSTMENTS, DEFAULT_WATERMARK } from '../types/scanner';
import { useHaptics } from '../hooks/useHaptics';
import { clamp, quadsAreClose, smoothQuadCorners } from '../utils/cvGeometry';
import {
  captureVisibleFeedFrame,
  detectCornersFromDataUrl,
  detectCornersFromVideoOrImage,
  loadImage,
  perspectiveDewarp,
  processPagePipeline,
} from '../utils/imageProcessor';
import { SAMPLE_SOURCES } from '../utils/storage';
import { PerspectiveCropCanvas } from './PerspectiveCropCanvas';

export type CameraScanMode = 'docs' | 'id_card' | 'book' | 'batch';

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
}

const MODE_ITEMS: Array<{ id: 'docs' | 'id_card' | 'book'; label: string; icon: React.FC<{ className?: string }> }> = [
  { id: 'docs', label: 'Docs', icon: FileText },
  { id: 'id_card', label: 'ID Card', icon: CreditCard },
  { id: 'book', label: 'Book', icon: BookOpen },
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
  initialMode = 'docs',
  initialSource = 'camera',
  initialFiles = null,
  appendTargetDocId = null,
  defaultFilter = 'magic_color',
  autoEdgeDetect = true,
  defaultFilenamePrefix = 'Scan_',
  onClose,
  onCompletePages,
  onCompleteIdPair,
}) => {
  const haptics = useHaptics();

  const [scanMode, setScanMode] = useState<'docs' | 'id_card' | 'book'>(
    initialMode === 'id_card' || initialMode === 'book' ? initialMode : 'docs'
  );
  const [isMultiMode, setIsMultiMode] = useState(initialMode === 'batch');
  const [stage, setStage] = useState<'viewfinder' | 'crop_review'>('viewfinder');

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
      setScanMode(initialMode === 'id_card' || initialMode === 'book' ? initialMode : 'docs');
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
              const quad: QuadCorners = autoEdgeDetect
                ? await detectCornersFromDataUrl(dataUrl)
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

  // Real-time live document corner tracking overlay with temporal EMA smoothing & lock stability
  useEffect(() => {
    if (!isOpen || stage !== 'viewfinder' || !liveEdgeOn || (cameraStatus !== 'active' && cameraStatus !== 'demo')) {
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
      const detected = detectCornersFromVideoOrImage(srcEl, canvas, {
        zoom: zoomLevel,
        viewportWidth: stageEl?.clientWidth,
        viewportHeight: stageEl?.clientHeight,
      });
      if (!detected) {
        stableFramesRef.current = 0;
        lastRawQuadRef.current = null;
        setEdgeLocked(false);
        setLiveQuad(null);
        return;
      }

      if (lastRawQuadRef.current && quadsAreClose(lastRawQuadRef.current, detected, 0.02)) {
        stableFramesRef.current += 1;
      } else {
        stableFramesRef.current = 0;
      }
      lastRawQuadRef.current = detected;
      setEdgeLocked(stableFramesRef.current >= 2);
      setLiveQuad((prev) => smoothQuadCorners(prev, detected, 0.42));
    };

    const timer = window.setInterval(runLiveDetect, 240);
    const initial = window.setTimeout(runLiveDetect, 100);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(initial);
    };
  }, [isOpen, stage, liveEdgeOn, cameraActive, cameraStatus, demoSceneIdx, zoomLevel]);

  if (!isOpen) return null;

  const activeDemo = DEMO_SCENES[demoSceneIdx] || DEMO_SCENES[0];

  const handleModeSwitch = (mode: 'docs' | 'id_card' | 'book') => {
    haptics.tap();
    setScanMode(mode);
    if (mode === 'id_card') {
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
      const detectedQuad: QuadCorners = autoEdgeDetect
        ? await detectCornersFromDataUrl(dataUrl)
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
    const keepShooting = list.length > 1 ? false : isMultiMode;

    setDetecting(true);
    try {
      const added: QueuedCapture[] = [];
      for (const file of list) {
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result || ''));
          reader.readAsDataURL(file);
        });
        if (!dataUrl) continue;
        const quad: QuadCorners = autoEdgeDetect
          ? await detectCornersFromDataUrl(dataUrl)
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
      const nextQuad = await detectCornersFromDataUrl(activeItem.originalDataUrl);
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
    const nextQuad = await detectCornersFromDataUrl(rotatedUrl);
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

        // Book mode splits wide spread down the middle into Left & Right pages
        const pageSources =
          scanMode === 'book' && dewarped.width > dewarped.height * 1.12
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
                className={`${
                  retakeTargetIdx !== null ? 'inline-block' : 'hidden sm:inline-block'
                } rounded-full bg-black/55 px-3 py-1 text-xs font-medium text-white/90`}
              >
                {retakeTargetIdx !== null
                  ? `Retaking Page ${retakeTargetIdx + 1}`
                  : scanMode === 'id_card'
                    ? queue.length === 0
                      ? 'ID Card · Frame Front'
                      : 'ID Card · Frame Back'
                    : scanMode === 'book'
                      ? 'Book Spread · Auto-Split'
                      : isMultiMode
                        ? 'Batch Multi-Page'
                        : 'Smart Document Auto-Crop'}
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
                    {DEMO_SCENES.map((scene, idx) => (
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

              {/* Real-time Auto-Edge Tracking Polygon + Corner Lock Anchors */}
              {liveEdgeOn && liveQuad && livePolygonPts && scanMode !== 'id_card' && (
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
            {/* Scan Mode Switcher (Docs / ID Card / Book / Batch) */}
            <div
              role="tablist"
              aria-label="Scan mode"
              className="mx-auto mb-3 flex max-w-md items-center justify-center gap-1.5 overflow-x-auto px-3"
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
                    className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer active:scale-95 ${
                      active
                        ? 'bg-teal-500 text-slate-950 shadow-sm'
                        : 'bg-white/10 text-white/80 hover:bg-white/20'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{m.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Bottom 3-Slot Action Row: Gallery Upload | Center Shutter | Single/Multi + Done Stack */}
            <div className="mx-auto flex max-w-lg items-center justify-between px-5">
              {/* Left: Gallery / Picture Upload */}
              <label className="flex min-w-[72px] flex-col items-center gap-1 cursor-pointer active:scale-95 transition-transform">
                <span className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl border border-white/25 bg-white/10 hover:bg-white/20">
                  {queue.length > 0 ? (
                    <img
                      src={queue[queue.length - 1].originalDataUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <ImagePlus className="h-5 w-5 text-white" aria-hidden="true" />
                  )}
                </span>
                <span className="text-[11px] font-medium text-white/85">Upload</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  aria-label="Upload photos from device"
                  onChange={(e) => handleGalleryUpload(e.target.files)}
                  className="sr-only"
                />
              </label>

              {/* Center: Android Shutter Trigger */}
              <button
                type="button"
                disabled={detecting}
                onClick={handleShutterPress}
                aria-label="Capture photo"
                data-testid="camera-shutter-button"
                className="relative flex h-[76px] w-[76px] items-center justify-center rounded-full border-4 border-white/90 bg-white/15 active:scale-92 transition-transform disabled:opacity-60 cursor-pointer"
              >
                <span className="flex h-[58px] w-[58px] items-center justify-center rounded-full bg-white text-slate-950 shadow-lg">
                  <Camera className="h-6 w-6 text-teal-700" aria-hidden="true" />
                </span>
              </button>

              {/* Right: Multi-Page Toggle OR Done(N) Stack */}
              <div className="flex min-w-[84px] flex-col items-end gap-1.5">
                {queue.length > 0 ? (
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
