import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Cpu,
  Download,
  FileText,
  HelpCircle,
  History,
  Info,
  Keyboard,
  Lock,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import type { ActiveWorkspaceView } from '../types/scanner';
import { APP_VERSION } from '../utils/settingsStore';
import { RELEASES, type ReleaseEntry } from '../utils/releaseNotes';
import { fetchGithubReleases } from '../utils/githubReleases';
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

const ABOUT_FEATURES = [
  {
    title: 'On-device computer vision',
    body: 'Edge detection, perspective dewarping, glare and shadow correction, and crisp B&W thresholding run locally with zero server round-trips.',
    icon: Cpu,
    accent: 'bg-teal-50 text-teal-700',
  },
  {
    title: 'Offline PWA architecture',
    body: 'Install on Android, iOS, macOS or Windows. Projects live in IndexedDB and a service worker caches the app shell.',
    icon: ShieldCheck,
    accent: 'bg-emerald-50 text-emerald-700',
  },
  {
    title: 'Layout-aware OCR',
    body: 'Text recognition keeps headings, tables and columns intact, so extracted text stays readable and searchable.',
    icon: FileText,
    accent: 'bg-sky-50 text-sky-700',
  },
  {
    title: 'Multi-format export',
    body: 'Export searchable PDFs, stitched or single PNG/JPEG pages, and editable Word documents without leaving the browser.',
    icon: Download,
    accent: 'bg-amber-50 text-amber-700',
  },
];

export const InfoPagesView: React.FC<InfoPagesViewProps> = ({
  page,
  onNavigatePage,
  onBackToProfile,
}) => {
  const haptics = useHaptics();
  const [releases, setReleases] = useState<ReleaseEntry[]>(RELEASES);
  const [selectedVersion, setSelectedVersion] = useState(RELEASES[0].version);
  const [isLoading, setIsLoading] = useState(false);
  const [sourceLabel, setSourceLabel] = useState('Local release notes');

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setIsLoading(true);
      try {
        const fetched = await fetchGithubReleases(controller.signal);
        if (fetched.length > 0) {
          setReleases(fetched);
          setSelectedVersion(fetched[0].version);
          setSourceLabel('GitHub releases');
        }
      } catch {
        setSourceLabel('Local fallback');
      } finally {
        setIsLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, []);

  const activeRelease = useMemo(
    () => releases.find((release) => release.version === selectedVersion) ?? releases[0],
    [releases, selectedVersion],
  );

  const refreshFromGithub = async () => {
    haptics.tap();
    setIsLoading(true);
    try {
      const fetched = await fetchGithubReleases();
      if (fetched.length > 0) {
        setReleases(fetched);
        setSelectedVersion(fetched[0].version);
        setSourceLabel('GitHub releases');
      }
    } catch {
      setSourceLabel('Local fallback');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      data-testid={`info-page-${page}`}
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-4 pb-24 sm:p-6 lg:p-8"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => {
              haptics.tap();
              onBackToProfile();
            }}
            data-testid="info-back-profile-btn"
            aria-label="Back to profile"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-50 cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <h1 className="truncate text-base font-bold text-slate-900 sm:text-lg">
            {page === 'about'
              ? 'About bitscanner'
              : page === 'release_notes'
                ? 'Release Notes'
                : page === 'privacy'
                  ? 'Privacy & Local Storage'
                  : 'Help & Shortcuts'}
          </h1>
        </div>

        <span className="font-mono-tabular hidden shrink-0 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-500 sm:inline">
          v{APP_VERSION}
        </span>
      </div>

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

      {page === 'about' && (
        <div className="flex flex-col gap-3.5">
          <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xs">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-teal-50 via-white to-sky-50/70" aria-hidden="true" />
            <div className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-teal-200/25 blur-3xl" aria-hidden="true" />

            <div className="relative p-4 sm:p-5">
              <div className="flex items-start gap-3.5">
                <img
                  src="/icon.svg"
                  alt=""
                  aria-hidden="true"
                  className="h-14 w-14 shrink-0 rounded-2xl shadow-md ring-4 ring-white/80"
                />
                <div className="min-w-0">
                  <h2 className="text-lg font-bold tracking-tight text-slate-900">bitscanner</h2>
                  <p className="text-xs text-slate-500">
                    Offline document scanner &amp; PDF workspace
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="font-mono-tabular inline-flex items-center rounded-full border border-slate-200 bg-white/80 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                      v{APP_VERSION}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50/90 px-2 py-0.5 text-[11px] font-semibold text-teal-800">
                      <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                      On-device
                    </span>
                    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white/80 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                      No account
                    </span>
                  </div>
                </div>
              </div>

              <p className="mt-4 text-sm leading-relaxed text-slate-600">
                bitscanner turns phone cameras and uploaded images into sharp, flat, searchable
                documents. Perspective correction, Magic Color enhancement, layout-aware OCR,
                e-signatures, and multi-format PDF/Word export all execute directly in your browser.
              </p>

              <div className="mt-4 flex flex-wrap gap-1.5">
                {['React 19', 'Vite', 'Tailwind CSS 4', 'Tesseract.js', 'IndexedDB'].map(
                  (tech) => (
                    <span
                      key={tech}
                      className="rounded-lg border border-slate-200/80 bg-white/80 px-2 py-1 text-[11px] font-medium text-slate-600"
                    >
                      {tech}
                    </span>
                  )
                )}
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {ABOUT_FEATURES.map((feature) => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.title}
                  className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4"
                >
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${feature.accent}`}>
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900">{feature.title}</div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">{feature.body}</p>
                  </div>
                </div>
              );
            })}
          </section>

          <div className="flex items-start gap-2.5 rounded-2xl border border-teal-200 bg-teal-50/70 px-4 py-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" />
            <p className="text-xs leading-relaxed text-teal-900">
              No account. No cloud. No tracking. Every scan, signature and OCR result stays inside
              this browser.
            </p>
          </div>
        </div>
      )}

      {page === 'release_notes' && (
        <div className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
                <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
                {isLoading ? 'Refreshing...' : 'Release source'}
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                {sourceLabel}
              </span>
            </div>
            <button
              type="button"
              onClick={refreshFromGithub}
              className="min-h-8 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              Refresh
            </button>
          </div>

          <div className="grid gap-3.5 md:grid-cols-[180px_minmax(0,1fr)]">
            <aside className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <History className="h-3.5 w-3.5" aria-hidden="true" />
                Versions
              </div>
              <div className="flex flex-col gap-1.5">
                {releases.map((release) => {
                  const active = release.version === activeRelease.version;
                  return (
                    <button
                      key={release.version}
                      type="button"
                      onClick={() => {
                        haptics.tap();
                        setSelectedVersion(release.version);
                      }}
                      className={`min-h-9 rounded-xl border px-3 py-2 text-left text-xs font-semibold transition-colors ${
                        active
                          ? 'border-teal-200 bg-teal-50 text-teal-900'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <span className="font-mono-tabular block">v{release.version}</span>
                      <span className="mt-0.5 block text-[11px] font-medium text-slate-500">{release.date}</span>
                    </button>
                  );
                })}
              </div>
            </aside>

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="flex flex-col gap-2 border-b border-slate-100 bg-gradient-to-br from-slate-50 to-white p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-bold text-teal-800">
                      v{activeRelease.version}
                    </span>
                    {activeRelease.version === '0.0.1' && (
                      <span className="inline-flex items-center rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">Latest</span>
                    )}
                    <span className="text-xs font-medium text-slate-500">{activeRelease.date}</span>
                  </div>
                  <h2 className="mt-2 text-base font-bold text-slate-900">{activeRelease.title}</h2>
                  <p className="mt-2 max-w-2xl text-xs leading-relaxed text-slate-600">{activeRelease.summary}</p>
                </div>
                <a
                  href={`https://github.com/Shubhamnpk/bitscanner/releases/tag/v${activeRelease.version}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                >
                  GitHub release
                </a>
              </div>

              <div className="p-4 sm:p-5">
                <div className="flex flex-col gap-3">
                  {activeRelease.sections.map((section) => (
                    <div key={section.title} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                      <h3 className="text-xs font-bold text-slate-900">{section.title}</h3>
                      <ul className="mt-2 flex flex-col gap-2">
                        {section.items.map((item, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-xs leading-relaxed text-slate-700">
                            <CheckCircle2
                              className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${section.tone === 'fix' ? 'text-sky-600' : section.tone === 'improvement' ? 'text-emerald-600' : 'text-teal-600'}`}
                              aria-hidden="true"
                            />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>

                <div className="mt-4 border-t border-slate-100 pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-bold text-slate-900">Comments</h3>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                      {activeRelease.comments.length}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-col gap-2">
                    {activeRelease.comments.map((comment, idx) => (
                      <div key={idx} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                        <div className="flex items-center gap-2">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white">B</span>
                          <div>
                            <div className="text-[11px] font-semibold text-slate-900">bitscanner team</div>
                            <div className="text-[10px] text-slate-500">Release note</div>
                          </div>
                        </div>
                        <p className="mt-2 text-xs leading-relaxed text-slate-600">{comment}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      )}

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
              projects, or erase the entire local workspace from Profile &rarr; Danger zone →
              Erase local workspace.
            </p>
          </div>
        </section>
      )}

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