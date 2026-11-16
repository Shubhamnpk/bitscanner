import React, { useEffect, useState } from 'react';
import {
  Check,
  CreditCard,
  Crop,
  Download,
  RefreshCw,
  Scissors,
  Sparkles,
  Upload,
} from 'lucide-react';
import type { QuadCorners, ScanDocument, ScannedPage } from '../types/scanner';
import { DEFAULT_ADJUSTMENTS, DEFAULT_WATERMARK } from '../types/scanner';
import { useHaptics } from '../hooks/useHaptics';
import {
  composeIdCardSheet,
  createSampleIdBackDataUrl,
  detectCornersFromDataUrl,
  perspectiveDewarp,
} from '../utils/imageProcessor';
import { exportDocumentAsPdf } from '../utils/pdfExporter';
import { SAMPLE_SOURCES } from '../utils/storage';
import { PerspectiveCropCanvas } from './PerspectiveCropCanvas';

interface IdSideState {
  originalUrl: string;
  quad: QuadCorners;
  dewarpedUrl: string;
}

interface IdCardStudioProps {
  initialPair?: {
    front: IdSideState;
    back: IdSideState;
  } | null;
  onSaveIdDocument: (doc: ScanDocument) => void;
  onBackToLibrary: () => void;
}

export const IdCardStudio: React.FC<IdCardStudioProps> = ({
  initialPair = null,
  onSaveIdDocument,
  onBackToLibrary,
}) => {
  const haptics = useHaptics();
  const [front, setFront] = useState<IdSideState | null>(initialPair?.front ?? null);
  const [back, setBack] = useState<IdSideState | null>(initialPair?.back ?? null);
  const [croppingSide, setCroppingSide] = useState<'front' | 'back' | null>(null);

  const [showCutGuides, setShowCutGuides] = useState(true);
  const [cardScale, setCardScale] = useState(0.68);
  const [showWatermark, setShowWatermark] = useState(false);
  const [watermarkText, setWatermarkText] = useState('FOR VERIFICATION ONLY');
  const [sheetTitle, setSheetTitle] = useState('National ID Card (Front & Back)');

  const [composedUrl, setComposedUrl] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  // Re-compose A4 2-up sheet whenever front, back, or layout options change
  useEffect(() => {
    if (!front || !back) {
      setComposedUrl(null);
      return;
    }
    let cancelled = false;
    setComposing(true);
    composeIdCardSheet(front.dewarpedUrl, back.dewarpedUrl, {
      showCutGuides,
      cardScale,
      showWatermark,
      watermarkText,
    })
      .then((res) => {
        if (!cancelled) setComposedUrl(res.dataUrl);
      })
      .finally(() => {
        if (!cancelled) setComposing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [front, back, showCutGuides, cardScale, showWatermark, watermarkText]);

  const loadSideFile = async (side: 'front' | 'back', file: File | undefined) => {
    if (!file) return;
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(file);
    });
    if (!dataUrl) return;
    const quad = await detectCornersFromDataUrl(dataUrl);
    const dewarped = await perspectiveDewarp(dataUrl, quad, 1000);
    const state: IdSideState = { originalUrl: dataUrl, quad, dewarpedUrl: dewarped.dataUrl };
    if (side === 'front') setFront(state);
    else setBack(state);
  };

  const handleLoadSampleIdPair = async () => {
    let frontUrl = SAMPLE_SOURCES.idCard;
    try {
      const resp = await fetch(SAMPLE_SOURCES.idCard);
      const blob = await resp.blob();
      frontUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result || frontUrl));
        reader.readAsDataURL(blob);
      });
    } catch {
      // keep url
    }

    const frontQuad: QuadCorners = [
      { x: 0.12, y: 0.34 },
      { x: 0.68, y: 0.12 },
      { x: 0.9, y: 0.56 },
      { x: 0.31, y: 0.88 },
    ];
    const frontDewarped = await perspectiveDewarp(frontUrl, frontQuad, 1000);
    setFront({ originalUrl: frontUrl, quad: frontQuad, dewarpedUrl: frontDewarped.dataUrl });

    const backUrl = createSampleIdBackDataUrl();
    const backQuad: QuadCorners = [
      { x: 0.01, y: 0.01 },
      { x: 0.99, y: 0.01 },
      { x: 0.99, y: 0.99 },
      { x: 0.01, y: 0.99 },
    ];
    setBack({ originalUrl: backUrl, quad: backQuad, dewarpedUrl: backUrl });
    setSheetTitle('Aethel Citizen ID — Evelyn Thorne (2-Up)');
  };

  const applySideCrop = async (side: 'front' | 'back') => {
    const target = side === 'front' ? front : back;
    if (!target) return;
    const dewarped = await perspectiveDewarp(target.originalUrl, target.quad, 1000);
    const updated = { ...target, dewarpedUrl: dewarped.dataUrl };
    if (side === 'front') setFront(updated);
    else setBack(updated);
    setCroppingSide(null);
  };

  const buildDocumentFromSheet = (): ScanDocument | null => {
    if (!composedUrl) return null;
    const now = Date.now();
    const page: ScannedPage = {
      id: crypto.randomUUID(),
      originalDataUrl: composedUrl,
      croppedDataUrl: composedUrl,
      processedDataUrl: composedUrl,
      quad: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      filter: 'original',
      adjustments: { ...DEFAULT_ADJUSTMENTS },
      rotation: 0,
      flipH: false,
      annotations: [],
      watermark: { ...DEFAULT_WATERMARK },
      ocrText: 'ID Card Front & Back 2-Up Composite Sheet',
      width: 1240,
      height: 1754,
      createdAt: now,
    };
    return {
      id: crypto.randomUUID(),
      title: sheetTitle.trim() || 'ID Card Sheet',
      folder: 'id_cards',
      starred: false,
      pages: [page],
      createdAt: now,
      updatedAt: now,
    };
  };

  const handleSave = () => {
    const doc = buildDocumentFromSheet();
    if (!doc) return;
    haptics.success();
    onSaveIdDocument(doc);
  };

  const handleDownloadPdf = async () => {
    const doc = buildDocumentFromSheet();
    if (!doc) return;
    await exportDocumentAsPdf(doc, {
      paperSize: 'a4',
      orientation: 'portrait',
      margin: 'none',
      quality: 'high',
      includePageNumbers: false,
      filename: doc.title,
    });
    haptics.success();
  };

  const activeCropState = croppingSide === 'front' ? front : croppingSide === 'back' ? back : null;

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col px-4 py-5 pb-24 md:p-6 md:pb-8 lg:p-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            ID Card &amp; Passport 2-Up Maker
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-500">
            Scan Front &amp; Back sides, auto-dewarp perspective, and align onto a single printable A4 sheet.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleLoadSampleIdPair}
            className="inline-flex min-h-[44px] sm:min-h-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs sm:text-sm font-medium text-slate-700 hover:bg-slate-50 active:scale-[0.98] transition-transform cursor-pointer"
          >
            <Sparkles className="h-4 w-4 text-teal-600" aria-hidden="true" />
            <span>Load Sample ID (Front &amp; Back)</span>
          </button>
          <button
            type="button"
            onClick={onBackToLibrary}
            className="hidden md:inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            Back to Library
          </button>
        </div>
      </div>

      {/* Perspective Crop Editor when refining Front or Back */}
      {croppingSide && activeCropState ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">
              Adjust {croppingSide === 'front' ? 'Front Side' : 'Back Side'} Perspective Corners
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCroppingSide(null)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => applySideCrop(croppingSide)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-teal-700 cursor-pointer"
              >
                <Check className="h-4 w-4" aria-hidden="true" />
                <span>Apply Crop</span>
              </button>
            </div>
          </div>

          <PerspectiveCropCanvas
            imageSrc={activeCropState.originalUrl}
            quad={activeCropState.quad}
            onChange={(nextQuad) => {
              if (croppingSide === 'front') {
                setFront((prev) => (prev ? { ...prev, quad: nextQuad } : prev));
              } else {
                setBack((prev) => (prev ? { ...prev, quad: nextQuad } : prev));
              }
            }}
            onAutoDetect={async () => {
              const detected = await detectCornersFromDataUrl(activeCropState.originalUrl);
              if (croppingSide === 'front') {
                setFront((prev) => (prev ? { ...prev, quad: detected } : prev));
              } else {
                setBack((prev) => (prev ? { ...prev, quad: detected } : prev));
              }
            }}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left Column: Front & Back Capture Slots + Sheet Settings */}
          <div className="flex flex-col gap-5 lg:col-span-5">
            {(['front', 'back'] as const).map((side) => {
              const state = side === 'front' ? front : back;
              const title = side === 'front' ? '1. Front Side' : '2. Back Side';
              return (
                <div
                  key={side}
                  className="rounded-xl border border-slate-200 bg-white p-4"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-900">{title}</span>
                    {state && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setCroppingSide(side)}
                          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 cursor-pointer"
                        >
                          <Crop className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Adjust Corners</span>
                        </button>
                        <label className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 cursor-pointer">
                          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Replace</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => loadSideFile(side, e.target.files?.[0])}
                            className="sr-only"
                          />
                        </label>
                      </div>
                    )}
                  </div>

                  {state ? (
                    <div className="flex items-center justify-center rounded-lg bg-slate-100 p-2">
                      <img
                        src={state.dewarpedUrl}
                        alt={`ID ${side} side`}
                        referrerPolicy="no-referrer"
                        className="max-h-28 rounded border border-slate-200 object-contain shadow-xs"
                      />
                    </div>
                  ) : (
                    <label className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 py-6 text-center hover:border-teal-500 hover:bg-teal-50/30 transition-colors cursor-pointer">
                      <Upload className="h-6 w-6 text-slate-400 mb-2" aria-hidden="true" />
                      <span className="text-sm font-medium text-slate-700">
                        Upload {side === 'front' ? 'Front' : 'Back'} Photo
                      </span>
                      <span className="mt-0.5 text-xs text-slate-500">
                        Auto-crops &amp; flattens ID perspective
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => loadSideFile(side, e.target.files?.[0])}
                        className="sr-only"
                      />
                    </label>
                  )}
                </div>
              );
            })}

            {/* Sheet Formatting Controls */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col gap-4">
              <div>
                <label htmlFor="id-sheet-title" className="block text-xs font-medium text-slate-600 mb-1">
                  Document Title
                </label>
                <input
                  id="id-sheet-title"
                  type="text"
                  value={sheetTitle}
                  onChange={(e) => setSheetTitle(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-teal-600 focus:outline-none"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-xs font-medium text-slate-600 mb-1.5">
                  <span>Card Print Size</span>
                  <span className="font-mono-tabular text-slate-900">{Math.round(cardScale * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0.45}
                  max={0.82}
                  step={0.01}
                  value={cardScale}
                  onChange={(e) => setCardScale(Number(e.target.value))}
                  aria-label="Card print size"
                  className="studio-slider w-full"
                />
              </div>

              <label className="flex items-center justify-between gap-2 text-sm text-slate-700 cursor-pointer">
                <span className="flex items-center gap-2">
                  <Scissors className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  <span>Show Dashed Cut Guide</span>
                </span>
                <input
                  type="checkbox"
                  checked={showCutGuides}
                  onChange={(e) => setShowCutGuides(e.target.checked)}
                  className="h-4 w-4 accent-teal-600"
                />
              </label>

              <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
                <label className="flex items-center justify-between gap-2 text-sm text-slate-700 cursor-pointer">
                  <span>Security Copy Watermark</span>
                  <input
                    type="checkbox"
                    checked={showWatermark}
                    onChange={(e) => setShowWatermark(e.target.checked)}
                    className="h-4 w-4 accent-teal-600"
                  />
                </label>
                {showWatermark && (
                  <input
                    type="text"
                    value={watermarkText}
                    onChange={(e) => setWatermarkText(e.target.value)}
                    aria-label="Security watermark text"
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-900 focus:border-teal-600 focus:outline-none"
                  />
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Live A4 2-Up Preview */}
          <div className="flex flex-col rounded-xl border border-slate-200 bg-white overflow-hidden lg:col-span-7">
            <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-200 px-4 sm:px-5 py-3.5">
              <span className="text-sm font-semibold text-slate-900">
                A4 2-Up Print Preview {composing ? '(Updating...)' : ''}
              </span>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!composedUrl}
                  onClick={handleDownloadPdf}
                  className="inline-flex min-h-[44px] sm:min-h-0 items-center gap-1.5 rounded-xl sm:rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs sm:text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-45 cursor-pointer"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  <span>Download PDF</span>
                </button>
                <button
                  type="button"
                  disabled={!composedUrl}
                  onClick={handleSave}
                  className="inline-flex min-h-[44px] sm:min-h-0 items-center gap-1.5 rounded-xl sm:rounded-lg bg-teal-600 px-4 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-45 cursor-pointer"
                >
                  <Check className="h-4 w-4" aria-hidden="true" />
                  <span>Save to Library</span>
                </button>
              </div>
            </div>

            <div className="flex flex-1 items-center justify-center editor-mat-bg p-4 sm:p-6 min-h-[340px] sm:min-h-[520px]">
              {composedUrl ? (
                <img
                  src={composedUrl}
                  alt="A4 2-up composited ID card sheet"
                  referrerPolicy="no-referrer"
                  className="max-h-[440px] sm:max-h-[600px] w-full sm:w-auto object-contain rounded shadow-2xl bg-white"
                />
              ) : (
                <div className="flex flex-col items-center text-center text-slate-400 max-w-xs">
                  <CreditCard className="h-10 w-10 mb-3 text-slate-500" aria-hidden="true" />
                  <p className="text-sm font-medium text-slate-200">
                    Upload both Front &amp; Back sides to preview your A4 ID sheet
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Or click &ldquo;Load Sample ID (Front &amp; Back)&rdquo; above to test immediately.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
