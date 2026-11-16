import React from 'react';
import { ArrowLeft, Check, Sparkles } from 'lucide-react';
import type {
  ExportFormat,
  FilterPreset,
  PdfPaperSize,
  PdfQuality,
} from '../types/scanner';
import {
  DEFAULT_APP_SETTINGS,
  sanitizeFilenamePrefix,
  type AppSettings,
} from '../utils/settingsStore';
import { PWAInstallButton } from './PWAInstallBanner';
import { useHaptics } from '../hooks/useHaptics';

interface SettingsViewProps {
  settings: AppSettings;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onReplayOnboarding: () => void;
  onBackToProfile: () => void;
}

const FILTER_OPTIONS: Array<{ id: FilterPreset; label: string }> = [
  { id: 'magic_color', label: 'Magic Color (Recommended)' },
  { id: 'original', label: 'Original Unadjusted' },
  { id: 'lighten', label: 'Lighten Lift' },
  { id: 'bw_sharp', label: 'B&W Crisp Text' },
  { id: 'grayscale', label: 'Grayscale' },
  { id: 'shadow_remove', label: 'Shadow Removal' },
];

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onUpdateSettings,
  onReplayOnboarding,
  onBackToProfile,
}) => {
  const haptics = useHaptics();

  return (
    <div
      data-testid="settings-view"
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-4 pb-24 sm:p-6 lg:p-8"
    >
      {/* Header with Back to Profile */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-3.5">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              haptics.tap();
              onBackToProfile();
            }}
            data-testid="settings-back-profile-btn"
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Profile</span>
          </button>
          <h1 className="text-lg font-bold text-slate-900">App &amp; Scan Settings</h1>
        </div>

        <button
          type="button"
          onClick={() => {
            haptics.tap();
            onUpdateSettings({
              ...DEFAULT_APP_SETTINGS,
              hasCompletedOnboarding: settings.hasCompletedOnboarding,
              displayName: settings.displayName,
              accountHandle: settings.accountHandle,
              email: settings.email,
              avatarColor: settings.avatarColor,
            });
          }}
          data-testid="settings-restore-defaults-btn"
          className="text-xs font-semibold text-teal-700 hover:underline cursor-pointer"
        >
          Restore Defaults
        </button>
      </div>

      {/* Section 1: Capture & Auto-Crop */}
      <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="text-sm font-bold text-slate-900">Capture &amp; Auto-Edge Detection</h2>

        <label className="flex min-h-[44px] items-center justify-between gap-3 cursor-pointer">
          <div>
            <div className="text-sm font-semibold text-slate-900">
              Auto-Detect Document Edges
            </div>
            <div className="text-xs text-slate-500">
              Automatically snap perspective corners after capturing or importing pages
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.autoEdgeDetect}
            onChange={(e) => onUpdateSettings({ autoEdgeDetect: e.target.checked })}
            data-testid="settings-auto-edge-toggle"
            className="h-5 w-5 accent-teal-600 cursor-pointer"
          />
        </label>

        <div className="flex flex-col gap-1.5 border-t border-slate-100 pt-3">
          <label className="text-xs font-semibold text-slate-700">
            Default Auto-Filter After Capture
          </label>
          <select
            value={settings.defaultFilter}
            onChange={(e) => onUpdateSettings({ defaultFilter: e.target.value as FilterPreset })}
            aria-label="Default scan filter"
            className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:border-teal-600 focus:outline-none"
          >
            {FILTER_OPTIONS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        <label className="flex min-h-[44px] items-center justify-between gap-3 border-t border-slate-100 pt-3 cursor-pointer">
          <div>
            <div className="text-sm font-semibold text-slate-900">Keep Original Capture Layer</div>
            <div className="text-xs text-slate-500">
              Preserve uncropped source frame so you can re-adjust corners anytime
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.autoSaveOriginal}
            onChange={(e) => onUpdateSettings({ autoSaveOriginal: e.target.checked })}
            className="h-5 w-5 accent-teal-600 cursor-pointer"
          />
        </label>

        <label className="flex min-h-[44px] items-center justify-between gap-3 border-t border-slate-100 pt-3 cursor-pointer">
          <div>
            <div className="text-sm font-semibold text-slate-900">Prompt Auto-OCR Index</div>
            <div className="text-xs text-slate-500">
              Automatically extract text when opening new single-page scans
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.autoRunOcr}
            onChange={(e) => onUpdateSettings({ autoRunOcr: e.target.checked })}
            className="h-5 w-5 accent-teal-600 cursor-pointer"
          />
        </label>
      </section>

      {/* Section 2: OCR & Export Defaults */}
      <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="text-sm font-bold text-slate-900">OCR &amp; Export Defaults</h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">
              Preferred Export Format
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  { id: 'pdf', label: 'PDF' },
                  { id: 'image', label: 'Image' },
                  { id: 'word', label: 'Word' },
                ] as Array<{ id: ExportFormat; label: string }>
              ).map((fmt) => (
                <button
                  key={fmt.id}
                  type="button"
                  onClick={() => {
                    haptics.tap();
                    onUpdateSettings({ defaultExportFormat: fmt.id });
                  }}
                  className={`min-h-[42px] rounded-xl border text-xs font-semibold cursor-pointer ${
                    settings.defaultExportFormat === fmt.id
                      ? 'border-teal-600 bg-teal-50 text-teal-900'
                      : 'border-slate-200 text-slate-700'
                  }`}
                >
                  {fmt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">
              Default Filename Prefix
            </label>
            <input
              type="text"
              value={settings.defaultFilenamePrefix}
              onChange={(e) =>
                onUpdateSettings({
                  defaultFilenamePrefix: sanitizeFilenamePrefix(e.target.value),
                })
              }
              aria-label="Default filename prefix"
              className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-sm text-slate-900 focus:border-teal-600 focus:outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">
              Default OCR Language
            </label>
            <select
              value={settings.defaultOcrLang}
              onChange={(e) => onUpdateSettings({ defaultOcrLang: e.target.value })}
              aria-label="Default OCR language"
              className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:border-teal-600 focus:outline-none"
            >
              <option value="eng">English</option>
              <option value="spa">Spanish</option>
              <option value="fra">French</option>
              <option value="deu">German</option>
              <option value="hin">Hindi</option>
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">
              Default PDF Paper Size
            </label>
            <select
              value={settings.defaultPaperSize}
              onChange={(e) =>
                onUpdateSettings({ defaultPaperSize: e.target.value as PdfPaperSize })
              }
              aria-label="Default PDF paper size"
              className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:border-teal-600 focus:outline-none"
            >
              <option value="a4">A4 (Standard)</option>
              <option value="letter">US Letter</option>
              <option value="fit">Fit to Scan</option>
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-700">
            Default Export Quality
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(['high', 'balanced', 'compact'] as PdfQuality[]).map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => {
                  haptics.tap();
                  onUpdateSettings({ defaultPdfQuality: q });
                }}
                className={`min-h-[40px] rounded-xl border text-xs font-semibold capitalize cursor-pointer ${
                  settings.defaultPdfQuality === q
                    ? 'border-teal-600 bg-teal-50 text-teal-900'
                    : 'border-slate-200 text-slate-700'
                }`}
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        <label className="flex min-h-[44px] items-center justify-between gap-3 border-t border-slate-100 pt-3 cursor-pointer">
          <div>
            <div className="text-sm font-semibold text-slate-900">Searchable PDF Text Layer</div>
            <div className="text-xs text-slate-500">
              Embed recognized OCR text invisibly inside exported PDFs by default
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.searchablePdfByDefault}
            onChange={(e) => onUpdateSettings({ searchablePdfByDefault: e.target.checked })}
            className="h-5 w-5 accent-teal-600 cursor-pointer"
          />
        </label>
      </section>

      {/* Section 3: Interface & Confirmations */}
      <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="text-sm font-bold text-slate-900">Interface &amp; Safety</h2>

        <div>
          <div className="mb-2 text-xs font-semibold text-slate-700">Default Library Layout</div>
          <div className="grid grid-cols-2 gap-2">
            {(['grid', 'list'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  haptics.tap();
                  onUpdateSettings({ defaultLibraryView: mode });
                }}
                className={`flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border text-xs font-semibold capitalize cursor-pointer ${
                  settings.defaultLibraryView === mode
                    ? 'border-teal-600 bg-teal-50 text-teal-900'
                    : 'border-slate-200 text-slate-700'
                }`}
              >
                {settings.defaultLibraryView === mode && <Check className="h-3.5 w-3.5" />}
                <span>{mode} View</span>
              </button>
            ))}
          </div>
        </div>

        <label className="flex min-h-[44px] items-center justify-between gap-3 border-t border-slate-100 pt-3 cursor-pointer">
          <div>
            <div className="text-sm font-semibold text-slate-900">Haptic Feedback</div>
            <div className="text-xs text-slate-500">
              Subtle vibration patterns on shutter capture, button taps &amp; saves
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.hapticsEnabled}
            onChange={(e) => onUpdateSettings({ hapticsEnabled: e.target.checked })}
            data-testid="settings-haptics-toggle"
            className="h-5 w-5 accent-teal-600 cursor-pointer"
          />
        </label>

        <label className="flex min-h-[44px] items-center justify-between gap-3 border-t border-slate-100 pt-3 cursor-pointer">
          <div>
            <div className="text-sm font-semibold text-slate-900">Reduced UI Motion</div>
            <div className="text-xs text-slate-500">
              Minimize slide transitions and animations across sheets &amp; modals
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.reduceMotion}
            onChange={(e) => onUpdateSettings({ reduceMotion: e.target.checked })}
            className="h-5 w-5 accent-teal-600 cursor-pointer"
          />
        </label>
      </section>

      {/* Section 4: App Install & Onboarding */}
      <section className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Offline PWA &amp; Onboarding</h2>
            <p className="text-xs text-slate-500">
              Install bitscanner on your home screen or replay the initial setup tour.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <PWAInstallButton variant="compact" />
            <button
              type="button"
              onClick={() => {
                haptics.tap();
                onReplayOnboarding();
              }}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5 text-teal-600" aria-hidden="true" />
              <span>Setup Tour</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
