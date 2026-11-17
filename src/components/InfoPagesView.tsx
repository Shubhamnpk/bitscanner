import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Cpu,
  Download,
  ExternalLink,
  FileText,
  HelpCircle,
  History,
  Info,
  Keyboard,
  Lock,
  RefreshCw,
  ShieldCheck,
  Sparkles,
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
  { id: 'release_notes', label: 'Release Notes', icon: History },
  { id: 'privacy', label: 'Privacy', icon: Lock },
  { id: 'help', label: 'Help', icon: HelpCircle },
];

const ABOUT_FEATURES = [
  {
    title: 'On-device computer vision',
    body: 'Edge detection, perspective dewarping, glare and shadow correction, and crisp B&W thresholding run locally with zero server round-trips.',
    icon: Cpu,
    accent: 'bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300',
  },
  {
    title: 'Offline PWA architecture',
    body: 'Install on Android, iOS, macOS or Windows. Projects live in IndexedDB and a service worker caches the app shell.',
    icon: ShieldCheck,
    accent: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
  },
  {
    title: 'Layout-aware OCR',
    body: 'Text recognition keeps headings, tables and columns intact, so extracted text stays readable and searchable.',
    icon: FileText,
    accent: 'bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
  },
  {
    title: 'Multi-format export',
    body: 'Export searchable PDFs, stitched or single PNG/JPEG pages, and editable Word documents without leaving the browser.',
    icon: Download,
    accent: 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
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

  const isLatestRelease = activeRelease.version === releases[0]?.version;

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
      className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-5 px-4 py-4 pb-28 sm:px-6 sm:py-6 lg:px-8 lg:py-8"
    >
      {/* Top Header Bar */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => {
              haptics.tap();
              onBackToProfile();
            }}
            data-testid="info-back-profile-btn"
            aria-label="Back to profile"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-xs transition-colors hover:bg-slate-50 dark:border-slate-700/80 dark:bg-slate-800/90 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold text-slate-900 dark:text-white sm:text-xl">
              {page === 'about'
                ? 'About BitScanner'
                : page === 'release_notes'
                  ? 'Release Notes & Changelog'
                  : page === 'privacy'
                    ? 'Privacy & Local Storage'
                    : 'Help & Shortcuts'}
            </h1>
            <p className="hidden text-xs text-slate-500 dark:text-slate-400 sm:block">
              {page === 'release_notes'
                ? 'Track new features, improvements, and updates across BitScanner versions'
                : page === 'about'
                  ? 'Architecture, features, and on-device capabilities'
                  : page === 'privacy'
                    ? 'Zero-telemetry client-side privacy and storage model'
                    : 'Workflow tips, touch gestures, and keyboard controls'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="font-mono-tabular shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 shadow-xs dark:border-slate-700/80 dark:bg-slate-800/90 dark:text-slate-300">
            v{APP_VERSION}
          </span>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <nav aria-label="App information sections" className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
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
              className={`inline-flex min-h-[40px] shrink-0 items-center gap-2 rounded-xl px-4 text-xs font-semibold cursor-pointer transition-all active:scale-95 ${
                active
                  ? 'bg-slate-900 text-white shadow-sm dark:bg-teal-600 dark:text-white dark:shadow-teal-900/40'
                  : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700/80 dark:bg-slate-800/80 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>

      {/* RELEASE NOTES TAB */}
      {page === 'release_notes' && (
        <div className="flex flex-col gap-4">
          {/* Top Release Status & Feed Toolbar */}
          <div className="flex flex-col gap-2.5 rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-xs dark:border-slate-800 dark:bg-[#0d1527] sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200">
                <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin text-teal-600 dark:text-teal-400' : ''}`} aria-hidden="true" />
                {isLoading ? 'Checking releases...' : 'Changelog Feed'}
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300">
                {sourceLabel}
              </span>
              <span className="hidden sm:inline text-slate-400 dark:text-slate-600">•</span>
              <span className="hidden sm:inline text-[11px] text-slate-500 dark:text-slate-400">
                {releases.length} {releases.length === 1 ? 'version' : 'versions'} logged
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={refreshFromGithub}
                disabled={isLoading}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-xs transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700/80 dark:bg-slate-800/90 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
              >
                <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
                <span>Refresh</span>
              </button>

              <a
                href={`https://github.com/Shubhamnpk/bitscanner/releases/tag/v${activeRelease.version}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-8 items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-3 text-xs font-semibold text-teal-800 transition-colors hover:bg-teal-100 dark:border-teal-500/30 dark:bg-teal-950/60 dark:text-teal-300 dark:hover:bg-teal-950 cursor-pointer"
              >
                <span>GitHub</span>
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            </div>
          </div>

          {/* Master-Detail Full-Page Grid */}
          <div className="grid gap-5 md:grid-cols-[240px_minmax(0,1fr)] lg:grid-cols-[280px_minmax(0,1fr)] items-start">
            {/* Version Selector Sidebar */}
            <aside className="flex flex-col gap-2.5 rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-xs dark:border-slate-800 dark:bg-[#0d1527] md:sticky md:top-4">
              <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-1 pt-1">
                <span className="flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5" aria-hidden="true" />
                  Versions
                </span>
                <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-1.5 py-0.2 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                  {releases.length}
                </span>
              </div>

              <div className="flex flex-col gap-2">
                {releases.map((release, index) => {
                  const active = release.version === activeRelease.version;
                  const isLatest = index === 0;
                  return (
                    <button
                      key={release.version}
                      type="button"
                      onClick={() => {
                        haptics.tap();
                        setSelectedVersion(release.version);
                      }}
                      className={`group relative flex flex-col rounded-xl border p-3 text-left transition-all cursor-pointer ${
                        active
                          ? 'border-teal-500/60 bg-teal-50/80 text-teal-950 shadow-xs ring-1 ring-teal-500/20 dark:border-teal-400/50 dark:bg-teal-950/50 dark:text-teal-100 dark:ring-teal-400/30'
                          : 'border-slate-200/80 bg-slate-50/70 text-slate-700 hover:border-slate-300 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-850/60 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-white'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="font-mono-tabular font-bold text-sm tracking-tight">
                          v{release.version}
                        </span>
                        {isLatest && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white dark:bg-teal-500 dark:text-slate-950">
                            <Sparkles className="h-2.5 w-2.5" aria-hidden="true" />
                            Latest
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                        <Calendar className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span>{release.date}</span>
                      </div>
                      <div className="mt-1 line-clamp-1 text-[11px] font-medium text-slate-600 dark:text-slate-400/90">
                        {release.title}
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>

            {/* Active Release Detail Panel */}
            <section className="flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs dark:border-slate-800 dark:bg-[#0d1527]">
              {/* Release Header Banner */}
              <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 via-teal-50/25 to-white p-5 dark:border-slate-800 dark:bg-gradient-to-r dark:from-slate-900 dark:via-teal-950/20 dark:to-slate-900 sm:p-6 lg:p-7">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-full border border-teal-200 bg-teal-50 px-3 py-1 font-mono-tabular text-xs font-bold text-teal-800 dark:border-teal-500/30 dark:bg-teal-950/70 dark:text-teal-300">
                      v{activeRelease.version}
                    </span>
                    {isLatestRelease && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-xs dark:bg-teal-500 dark:text-slate-950">
                        <Sparkles className="h-3 w-3" aria-hidden="true" />
                        Latest Release
                      </span>
                    )}
                    <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                      <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                      {activeRelease.date}
                    </span>
                  </div>

                  <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
                    {activeRelease.title}
                  </h2>

                  <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300 max-w-none">
                    {activeRelease.summary}
                  </p>
                </div>
              </div>

              {/* Release Highlights & Feature Sections */}
              <div className="p-5 sm:p-6 lg:p-7">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
                  {activeRelease.sections.map((section) => {
                    const isNew = section.tone === 'new';
                    const isFix = section.tone === 'fix';
                    const isImprov = section.tone === 'improvement';

                    const badgeClass = isFix
                      ? 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-950/60 dark:text-sky-300'
                      : isImprov
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/60 dark:text-emerald-300'
                        : 'border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-500/30 dark:bg-teal-950/60 dark:text-teal-300';

                    const iconColor = isFix
                      ? 'text-sky-600 dark:text-sky-400'
                      : isImprov
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-teal-600 dark:text-teal-400';

                    return (
                      <div
                        key={section.title}
                        className="flex flex-col rounded-xl border border-slate-200/80 bg-slate-50/60 p-4 transition-colors hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/50 dark:hover:border-slate-700"
                      >
                        <div className="flex items-center justify-between gap-2 border-b border-slate-200/60 pb-2.5 dark:border-slate-800">
                          <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                            {section.title}
                          </h3>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${badgeClass}`}
                          >
                            {isFix ? 'Fix' : isImprov ? 'Improvement' : 'Feature'}
                          </span>
                        </div>

                        <ul className="mt-3 flex flex-1 flex-col gap-2.5">
                          {section.items.map((item, idx) => (
                            <li
                              key={idx}
                              className="flex items-start gap-2.5 text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-slate-300"
                            >
                              <CheckCircle2
                                className={`mt-0.5 h-4 w-4 shrink-0 ${iconColor}`}
                                aria-hidden="true"
                              />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>

                {/* Release Notes & Comments Footer */}
                {activeRelease.comments && activeRelease.comments.length > 0 && (
                  <div className="mt-6 border-t border-slate-100 pt-5 dark:border-slate-800">
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                        Release Notes &amp; Verification
                      </h3>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                        {activeRelease.comments.length}
                      </span>
                    </div>

                    <div className="flex flex-col gap-3">
                      {activeRelease.comments.map((comment, idx) => (
                        <div
                          key={idx}
                          className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/50"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white dark:bg-teal-600">
                              B
                            </span>
                            <div>
                              <div className="text-xs font-semibold text-slate-900 dark:text-white">
                                BitScanner Team
                              </div>
                              <div className="text-[10px] text-slate-500 dark:text-slate-400">
                                Verified Release Note
                              </div>
                            </div>
                          </div>
                          <p className="mt-2.5 text-xs sm:text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                            {comment}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      )}

      {/* ABOUT TAB */}
      {page === 'about' && (
        <div className="flex flex-col gap-5">
          {/* Hero Banner */}
          <section className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-xs dark:border-slate-800 dark:bg-[#0d1527]">
            <div
              className="pointer-events-none absolute inset-0 bg-gradient-to-br from-teal-50/80 via-white to-sky-50/60 dark:from-teal-950/30 dark:via-[#0d1527] dark:to-slate-900/50"
              aria-hidden="true"
            />
            <div
              className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-teal-200/25 blur-3xl dark:bg-teal-500/10"
              aria-hidden="true"
            />

            <div className="relative p-5 sm:p-7 lg:p-8">
              <div className="flex flex-col sm:flex-row items-start gap-4 sm:gap-5">
                <img
                  src="/icon.svg"
                  alt="BitScanner Icon"
                  aria-hidden="true"
                  className="h-16 w-16 shrink-0 rounded-2xl shadow-md ring-4 ring-white/80 dark:ring-slate-800"
                />
                <div className="min-w-0">
                  <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                    BitScanner
                  </h2>
                  <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                    Offline document scanner, studio editor &amp; optical QR file transfer
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="font-mono-tabular inline-flex items-center rounded-full border border-slate-200 bg-white/80 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      v{APP_VERSION}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50/90 px-2.5 py-0.5 text-[11px] font-semibold text-teal-800 dark:border-teal-500/30 dark:bg-teal-950/70 dark:text-teal-300">
                      <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                      100% On-Device
                    </span>
                    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white/80 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      Zero Telemetry
                    </span>
                    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white/80 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      MIT License
                    </span>
                  </div>
                </div>
              </div>

              <p className="mt-4 text-sm sm:text-base leading-relaxed text-slate-600 dark:text-slate-300 max-w-4xl">
                BitScanner turns your phone camera or uploaded images into crisp, perspective-corrected,
                searchable documents. On-device edge detection, Magic Color enhancements, layout-aware OCR,
                vector annotations, and multi-format PDF/Word export all execute locally in your browser sandbox
                without ever connecting to a remote server.
              </p>

              <div className="mt-5 flex flex-wrap gap-2">
                {['React 19', 'TypeScript', 'Vite', 'Tailwind CSS 4', 'Tesseract.js WASM', 'IndexedDB (Dexie)', 'PDF-Lib'].map(
                  (tech) => (
                    <span
                      key={tech}
                      className="rounded-lg border border-slate-200/80 bg-white/80 px-2.5 py-1 text-xs font-medium text-slate-700 dark:border-slate-700/80 dark:bg-slate-800/80 dark:text-slate-300"
                    >
                      {tech}
                    </span>
                  )
                )}
              </div>
            </div>
          </section>

          {/* Core Feature Cards in 4-column responsive grid */}
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {ABOUT_FEATURES.map((feature) => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.title}
                  className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-[#0d1527]"
                >
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${feature.accent}`}>
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="text-sm font-bold text-slate-900 dark:text-white">{feature.title}</div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{feature.body}</p>
                  </div>
                </div>
              );
            })}
          </section>

          {/* Privacy Guarantee Card */}
          <div className="flex items-start gap-3 rounded-2xl border border-teal-200 bg-teal-50/70 p-4 dark:border-teal-500/30 dark:bg-teal-950/40">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-teal-700 dark:text-teal-400" aria-hidden="true" />
            <p className="text-xs sm:text-sm leading-relaxed text-teal-950 dark:text-teal-200">
              No account. No cloud. No tracking. Every scan, signature, OCR extraction, and optical QR beam transfer stays completely inside your local browser.
            </p>
          </div>
        </div>
      )}

      {/* PRIVACY TAB */}
      {page === 'privacy' && (
        <section className="flex flex-col gap-5 rounded-2xl border border-slate-200/80 bg-white p-5 sm:p-7 shadow-xs dark:border-slate-800 dark:bg-[#0d1527]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-400">
              <Lock className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">Local-Only Privacy Architecture</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Zero data collection, zero network transmission</p>
            </div>
          </div>

          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            BitScanner stores all scanned pages, cropped images, annotations, signatures, and OCR
            results inside your browser&apos;s private <strong>IndexedDB</strong> and{' '}
            <strong>localStorage</strong>. Your files never leave your device unless you explicitly
            download or share an exported PDF, image, Word file, or JSON backup.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-300">
              <strong className="block text-sm font-semibold text-slate-900 dark:text-white mb-1">Camera Permissions</strong>
              Used strictly while the live scanner viewfinder is open. Video frames are analyzed in-memory and discarded immediately unless you capture a photo.
            </div>

            <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-300">
              <strong className="block text-sm font-semibold text-slate-900 dark:text-white mb-1">OCR Processing</strong>
              Text recognition executes client-side inside a Web Worker; once language models are cached by your PWA service worker, OCR works completely offline.
            </div>

            <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-300">
              <strong className="block text-sm font-semibold text-slate-900 dark:text-white mb-1">Clearing Data</strong>
              You can delete individual projects at any time, or completely erase the entire local workspace from Profile &rarr; Danger zone &rarr; Erase local workspace.
            </div>
          </div>
        </section>
      )}

      {/* HELP TAB */}
      {page === 'help' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <section className="flex flex-col rounded-2xl border border-slate-200/80 bg-white p-5 sm:p-6 shadow-xs dark:border-slate-800 dark:bg-[#0d1527] space-y-3">
            <div className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-teal-600 dark:text-teal-400" aria-hidden="true" />
              <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">Workflow Guide</h2>
            </div>
            <ol className="list-decimal pl-5 space-y-2.5 text-xs sm:text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              <li>
                <strong className="text-slate-900 dark:text-white">Scan or Import:</strong> Tap Scan on the bottom bar or top header to capture pages or import images/PDFs into a new or existing project.
              </li>
              <li>
                <strong className="text-slate-900 dark:text-white">Organize in Project Details:</strong> Drag page cards to reorder, or long-press / long-hover (~0.5s) on any card to select multiple pages for bulk export or deletion.
              </li>
              <li>
                <strong className="text-slate-900 dark:text-white">Edit &amp; Swipe:</strong> Open any page to view full-screen, extract OCR text, or switch to Edit mode to swipe between pages, apply filters, rotate, sign, watermark, or crop.
              </li>
              <li>
                <strong className="text-slate-900 dark:text-white">Export &amp; QR Beam:</strong> Tap Export to choose searchable PDF, image, or Word file, or use QR Beam to transmit files optically to another camera-enabled phone.
              </li>
            </ol>
          </section>

          <section className="flex flex-col rounded-2xl border border-slate-200/80 bg-white p-5 sm:p-6 shadow-xs dark:border-slate-800 dark:bg-[#0d1527]">
            <div className="mb-4 flex items-center gap-2">
              <Keyboard className="h-5 w-5 text-teal-600 dark:text-teal-400" aria-hidden="true" />
              <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">Gestures &amp; Shortcuts</h2>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs sm:text-sm">
              <div className="flex items-center justify-between py-2.5">
                <span className="text-slate-600 dark:text-slate-400">Swipe Left / Right (View &amp; Edit)</span>
                <span className="font-semibold text-slate-900 dark:text-white">Previous / Next Page</span>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <span className="text-slate-600 dark:text-slate-400">Long-Press / Long-Hover Card</span>
                <span className="font-semibold text-slate-900 dark:text-white">Activate Multi-Select</span>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <span className="text-slate-600 dark:text-slate-400">Drag Page Card (Project Details)</span>
                <span className="font-semibold text-slate-900 dark:text-white">Reorder Pages</span>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <span className="text-slate-600 dark:text-slate-400">Pinch or Scroll (View &amp; Edit)</span>
                <span className="font-semibold text-slate-900 dark:text-white">Zoom In / Out</span>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
