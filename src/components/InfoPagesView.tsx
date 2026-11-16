import React from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Cpu,
  HelpCircle,
  History,
  Info,
  Keyboard,
  Lock,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { ActiveWorkspaceView } from '../types/scanner';
import { APP_VERSION } from '../utils/settingsStore';
import { useHaptics } from '../hooks/useHaptics';

export type InfoPageId = Extract<
  ActiveWorkspaceView,
  'about' | 'release_notes' | 'privacy' | 'help'
>;

interface InfoPagesViewProps {
  page: InfoPageId;
  onNavigatePage: (page: InfoPageId) => void;
  onBackToProfile: () => void;
}

const INFO_TABS: Array<{ id: InfoPageId; label: string; icon: React.FC<{ className?: string }> }> = [
  { id: 'about', label: 'About', icon: Info },
  { id: 'release_notes', label: 'Releases', icon: History },
  { id: 'privacy', label: 'Privacy', icon: Lock },
  { id: 'help', label: 'Help', icon: HelpCircle },
];

const RELEASE_HISTORY = [
  {
    version: '0.0.3',
    date: 'Latest Studio Release',
    highlights: [
      'Progressive Web App (PWA) installable offline workspace with Workbox caching & status indicator.',
      'Project Details overhaul: drag-and-drop page reordering, long-press/long-hover multi-select, header Favorite Star & bottom-bar OCR.',
      'Icon-only Download Export buttons across Project Details, View Mode & Edit Mode.',
      'Redesigned mobile-first Tools hub, customizable local account profiles, Onboarding wizard & Release Notes.',
    ],
  },
  {
    version: '0.0.2',
    date: 'Document Studio Update',
    highlights: [
      'Touch-friendly signature, text & shape markup dragging without accidental box resize.',
      'Swipe navigation across pages in View & Edit modes with clean page indicators.',
      'Passport Photo Print Sheet creator & WebM Slideshow Video builder inside Tools.',
    ],
  },
  {
    version: '0.0.1',
    date: 'OCR & Export Engine',
    highlights: [
      'Layout-preserving OCR table & structured block extraction with multi-language packs.',
      'Unified PDF, PNG/JPEG (stitched or individual), and Word (.doc) multi-page export.',
      'ID Card Studio A4 front/back alignment & dual-crop pipeline.',
    ],
  },
];

export const InfoPagesView: React.FC<InfoPagesViewProps> = ({
  page,
  onNavigatePage,
  onBackToProfile,
}) => {
  const haptics = useHaptics();

  return (
    <div
      data-testid={`info-page-${page}`}
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-4 pb-24 sm:p-6 lg:p-8"
    >
      {/* Top Back Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3.5">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              haptics.tap();
              onBackToProfile();
            }}
            data-testid="info-back-profile-btn"
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Profile</span>
          </button>
          <h1 className="text-lg font-bold text-slate-900">
            {page === 'about'
              ? 'About bitscanner'
              : page === 'release_notes'
                ? 'Release Notes'
                : page === 'privacy'
                  ? 'Privacy & Local Storage'
                  : 'Help & Shortcuts'}
          </h1>
        </div>

        <span className="font-mono-tabular text-xs font-semibold text-teal-700">
          v{APP_VERSION}
        </span>
      </div>

      {/* Sub-page Switcher */}
      <nav aria-label="App information sections" className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
        {INFO_TABS.map((t) => {
          const Icon = t.icon;
          const active = page === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                haptics.tap();
                onNavigatePage(t.id);
              }}
              className={`inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold cursor-pointer transition-colors ${
                active
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>

      {/* PAGE: ABOUT */}
      {page === 'about' && (
        <div className="flex flex-col gap-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-3.5">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-600 text-white shadow-xs">
                <Sparkles className="h-6 w-6" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">bitscanner Studio</h2>
                <p className="text-xs text-slate-500">
                  Version {APP_VERSION} · Offline Document Scanner &amp; PDF Workspace
                </p>
              </div>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-slate-600">
              bitscanner turns phone cameras and uploaded images into sharp, flat, searchable
              documents. Perspective correction, Magic Color enhancement, layout-aware OCR,
              e-signatures, and multi-format PDF/Word export all execute directly in your browser.
            </p>
          </section>

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                <Cpu className="h-4 w-4 text-teal-600" aria-hidden="true" />
                <span>On-Device Computer Vision</span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                Edge detection, adaptive perspective dewarping, glare/shadow compensation, and crisp
                B&amp;W thresholding run locally with zero server round-trips.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                <ShieldCheck className="h-4 w-4 text-teal-600" aria-hidden="true" />
                <span>Offline PWA Architecture</span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                Installable on Android, iOS, macOS, and Windows with IndexedDB project storage and
                background service-worker caching.
              </p>
            </div>
          </section>
        </div>
      )}

      {/* PAGE: RELEASE NOTES */}
      {page === 'release_notes' && (
        <div className="flex flex-col gap-3.5">
          {RELEASE_HISTORY.map((rel) => (
            <section
              key={rel.version}
              className="rounded-2xl border border-slate-200 bg-white p-5"
            >
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <span className="font-mono-tabular text-sm font-bold text-teal-700">
                    v{rel.version}
                  </span>
                  <span className="text-xs font-semibold text-slate-500">· {rel.date}</span>
                </div>
              </div>
              <ul className="mt-3 flex flex-col gap-2">
                {rel.highlights.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2.5 text-xs leading-relaxed text-slate-700">
                    <CheckCircle2
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-600"
                      aria-hidden="true"
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/* PAGE: PRIVACY */}
      {page === 'privacy' && (
        <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2.5">
            <Lock className="h-5 w-5 text-teal-600" aria-hidden="true" />
            <h2 className="text-base font-bold text-slate-900">Local-Only Privacy Architecture</h2>
          </div>
          <p className="text-sm leading-relaxed text-slate-600">
            bitscanner stores all scanned pages, cropped images, annotations, signatures, and OCR
            results inside your browser&apos;s private <strong>IndexedDB</strong> and{' '}
            <strong>localStorage</strong>. Your files never leave your device unless you explicitly
            download or share an exported PDF, image, Word file, or JSON backup.
          </p>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-600 space-y-2">
            <p>
              <strong className="text-slate-900">Camera Permissions:</strong> Used strictly while
              the live scanner viewfinder is open. Video frames are discarded immediately unless you
              tap the shutter button.
            </p>
            <p>
              <strong className="text-slate-900">OCR Processing:</strong> Text recognition executes
              client-side inside a Web Worker; once language models are cached by your PWA service
              worker, OCR continues working completely offline.
            </p>
            <p>
              <strong className="text-slate-900">Clearing Data:</strong> You can delete individual
              projects, or reset the entire local workspace from Profile &rarr; Reset Sample
              Documents.
            </p>
          </div>
        </section>
      )}

      {/* PAGE: HELP */}
      {page === 'help' && (
        <div className="flex flex-col gap-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
            <h2 className="text-sm font-bold text-slate-900">Quick Workflow Guide</h2>
            <ol className="list-decimal pl-5 space-y-2 text-xs leading-relaxed text-slate-600">
              <li>
                <strong className="text-slate-900">Scan or Import:</strong> Tap Scan on the bottom
                bar or header to capture pages or import images/PDFs into a new or existing project.
              </li>
              <li>
                <strong className="text-slate-900">Organize in Project Details:</strong> Drag page
                cards to reorder, or long-press / long-hover (~0.5s) on any card to select multiple
                pages for bulk export or deletion.
              </li>
              <li>
                <strong className="text-slate-900">Edit &amp; Swipe:</strong> Open any page to view
                full-screen, extract OCR text, or switch to Edit mode to swipe between pages, apply
                filters, rotate, sign, watermark, or crop.
              </li>
              <li>
                <strong className="text-slate-900">Export Anywhere:</strong> Tap the download icon
                in Project Details, View Mode, or Edit Mode to choose PDF (with optional searchable
                OCR layer), stitched/single PNG/JPEG, or Word (.doc).
              </li>
            </ol>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900">
              <Keyboard className="h-4 w-4 text-teal-600" aria-hidden="true" />
              <span>Gestures &amp; Shortcuts</span>
            </div>
            <div className="divide-y divide-slate-100 text-xs">
              <div className="flex items-center justify-between py-2">
                <span className="text-slate-600">Swipe Left / Right (View &amp; Edit)</span>
                <span className="font-semibold text-slate-900">Previous / Next Page</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-slate-600">Long-Press or Long-Hover Page Card</span>
                <span className="font-semibold text-slate-900">Activate Multi-Select</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-slate-600">Drag Page Card (Project Details)</span>
                <span className="font-semibold text-slate-900">Reorder Pages</span>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
