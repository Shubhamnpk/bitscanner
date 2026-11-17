import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  Database,
  Download,
  FileJson,
  FileSpreadsheet,
  FlaskConical,
  FolderDown,
  HardDrive,
  Monitor,
  Moon,
  Palette,
  RotateCcw,
  ScanLine,
  Search,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Sun,
  Trash2,
  Type,
  Upload,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type {
  ExportFormat,
  FilterPreset,
  PdfPaperSize,
  PdfQuality,
  SavedSignature,
  ScanDocument,
} from '../types/scanner';
import {
  APP_VERSION,
  DEFAULT_APP_SETTINGS,
  formatByteSize,
  sanitizeFilenamePrefix,
  type AppSettings,
  type ThemeMode,
} from '../utils/settingsStore';
import {
  buildDocumentsCsv,
  buildWorkspaceBackup,
  estimateWorkspaceBytes,
  parseWorkspaceBackup,
} from '../utils/workspaceBackup';
import { Modal } from './ui/Modal';
import { PWAInstallButton } from './PWAInstallBanner';
import { SelectField, ToggleSwitch } from './ui/FormControls';
import { useHaptics } from '../hooks/useHaptics';

interface SettingsViewProps {
  settings: AppSettings;
  documents: ScanDocument[];
  savedSignatures: SavedSignature[];
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onImportWorkspace: (
    documents: ScanDocument[],
    signatures: SavedSignature[]
  ) => Promise<void>;
  onResetLocalWorkspace: () => void;
  onReplayOnboarding: () => void;
  onBackToProfile: () => void;
}

const FILTER_OPTIONS: Array<{ value: FilterPreset; label: string; hint?: string }> = [
  { value: 'magic_color', label: 'Magic Color', hint: 'Recommended · clean paper, rich ink' },
  { value: 'magic_hd', label: 'Magic Color HD', hint: 'Beta · flattens uneven light' },
  { value: 'original', label: 'Original Unadjusted' },
  { value: 'lighten', label: 'Lighten Lift' },
  { value: 'bw_sharp', label: 'B&W Crisp Text' },
  { value: 'grayscale', label: 'Grayscale' },
  { value: 'shadow_remove', label: 'Shadow Removal' },
];

const OCR_LANG_OPTIONS = [
  { value: 'eng', label: 'English' },
  { value: 'spa', label: 'Spanish' },
  { value: 'fra', label: 'French' },
  { value: 'deu', label: 'German' },
  { value: 'hin', label: 'Hindi' },
];

const PAPER_OPTIONS: Array<{ value: PdfPaperSize; label: string; hint?: string }> = [
  { value: 'a4', label: 'A4 (Standard)', hint: '210 × 297 mm' },
  { value: 'letter', label: 'US Letter', hint: '8.5 × 11 in' },
  { value: 'fit', label: 'Fit to Scan', hint: 'No fixed page size' },
];

const THEME_OPTIONS: Array<{
  value: ThemeMode;
  label: string;
  hint: string;
  icon: LucideIcon;
}> = [
  { value: 'system', label: 'System', hint: 'Follow device', icon: Monitor },
  { value: 'light', label: 'Light', hint: 'Bright paper', icon: Sun },
  { value: 'dark', label: 'Dark', hint: 'Low light', icon: Moon },
];

const downloadTextFile = (text: string, fileName: string, mime: string) => {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const dateStamp = () => new Date().toISOString().slice(0, 10);

type SectionId = 'capture' | 'export' | 'appearance' | 'interface' | 'data' | 'app';

/**
 * Search index for the settings page. Every row's wording lives here so a single
 * input can jump straight to the right section without a routing layer.
 */
const SECTION_SEARCH: Record<SectionId, { title: string; keywords: string[] }> = {
  capture: {
    title: 'Capture & auto-edge',
    keywords: [
      'auto detect edges',
      'crop',
      'perspective',
      'keep original',
      'capture layer',
      'auto ocr',
      'default filter',
      'magic color',
      'shadow removal',
      'grayscale',
      'black and white',
      'scan quality',
    ],
  },
  export: {
    title: 'OCR & export',
    keywords: [
      'ocr',
      'language',
      'text recognition',
      'paper size',
      'a4',
      'letter',
      'pdf quality',
      'filename prefix',
      'naming',
      'searchable pdf',
      'text layer',
      'word',
      'image',
      'jpeg',
      'png',
    ],
  },
  appearance: {
    title: 'Appearance',
    keywords: ['theme', 'dark mode', 'light mode', 'appearance', 'color scheme', 'night', 'amoled'],
  },
  interface: {
    title: 'Interface & safety',
    keywords: [
      'library layout',
      'grid',
      'list',
      'haptic',
      'vibration',
      'reduce motion',
      'animation',
      'accessibility',
      'motion',
    ],
  },
  data: {
    title: 'Data & backup',
    keywords: [
      'data',
      'backup',
      'export json',
      'csv',
      'import',
      'restore',
      'merge',
      'erase',
      'clear',
      'delete all',
      'reset',
      'storage',
      'download',
    ],
  },
  app: {
    title: 'App & onboarding',
    keywords: ['install', 'pwa', 'onboarding', 'tour', 'replay', 'setup', 'demo mode'],
  },
};

const matchesSearch = (query: string, section: SectionId): boolean => {
  if (!query) return true;
  const meta = SECTION_SEARCH[section];
  const haystack = `${meta.title} ${meta.keywords.join(' ')}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
};

interface SettingsSectionProps {
  icon: LucideIcon;
  title: string;
  description: string;
  summary?: string;
  forceOpen?: boolean;
  children: React.ReactNode;
}

const SettingsSection: React.FC<SettingsSectionProps> = ({
  icon: Icon,
  title,
  description,
  summary,
  forceOpen = false,
  children,
}) => {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const expanded = forceOpen || open;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={expanded}
        aria-controls={contentId}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal-600 cursor-pointer"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
          <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-slate-900">{title}</span>
          <span className="mt-0.5 block truncate text-xs text-slate-500">
            {!expanded && summary ? summary : description}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
            expanded ? 'rotate-180' : ''
          }`}
          aria-hidden="true"
        />
      </button>
      {expanded && (
        <div id={contentId} className="divide-y divide-slate-100 border-t border-slate-100">
          {children}
        </div>
      )}
    </section>
  );
};

const ToggleRow: React.FC<{
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  testId?: string;
}> = ({ title, description, checked, onChange, testId }) => (
  <div className="flex items-start justify-between gap-4 px-4 py-3.5">
    <div className="min-w-0">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <div className="mt-0.5 text-xs leading-relaxed text-slate-500">{description}</div>
    </div>
    <div className="pt-0.5">
      <ToggleSwitch checked={checked} onChange={onChange} ariaLabel={title} testId={testId} />
    </div>
  </div>
);

const FieldRow: React.FC<{
  label: string;
  hint?: string;
  children: React.ReactNode;
}> = ({ label, hint, children }) => (
  <div className="px-4 py-3.5">
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <span className="text-sm font-semibold text-slate-900">{label}</span>
      {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
    </div>
    {children}
  </div>
);

const Segmented: React.FC<{
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  ariaLabel: string;
}> = ({ value, options, onChange, ariaLabel }) => (
  <div role="radiogroup" aria-label={ariaLabel} className="flex gap-1.5">
    {options.map((option) => {
      const selected = value === option.value;
      return (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={selected}
          onClick={() => onChange(option.value)}
          className={`inline-flex min-h-[42px] flex-1 items-center justify-center gap-1.5 rounded-xl border px-2 text-xs font-semibold transition-colors cursor-pointer ${
            selected
              ? 'border-teal-600 bg-teal-50 text-teal-900'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          {selected && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          <span className="truncate">{option.label}</span>
        </button>
      );
    })}
  </div>
);

const ThemePicker: React.FC<{
  value: ThemeMode;
  onChange: (value: ThemeMode) => void;
}> = ({ value, onChange }) => (
  <div role="radiogroup" aria-label="App theme" className="grid grid-cols-3 gap-2">
    {THEME_OPTIONS.map((option) => {
      const Icon = option.icon;
      const selected = option.value === value;
      return (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={selected}
          onClick={() => onChange(option.value)}
          className={`flex min-h-[74px] flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2.5 transition-colors cursor-pointer ${
            selected
              ? 'border-teal-600 bg-teal-50 text-teal-900'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
          <span className="text-xs font-bold">{option.label}</span>
          <span className="text-[10px] font-medium text-slate-500">{option.hint}</span>
        </button>
      );
    })}
  </div>
);

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  documents,
  savedSignatures,
  onUpdateSettings,
  onImportWorkspace,
  onResetLocalWorkspace,
  onReplayOnboarding,
  onBackToProfile,
}) => {
  const haptics = useHaptics();
  const importInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [eraseOpen, setEraseOpen] = useState(false);
  const [exportChoice, setExportChoice] = useState<'json' | 'csv'>('json');
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<{
    fileName: string;
    documents: ScanDocument[];
    signatures: SavedSignature[];
    pageCount: number;
    version?: string;
  } | null>(null);

  const query = search.trim();
  const totalPages = useMemo(
    () => documents.reduce((total, doc) => total + doc.pages.length, 0),
    [documents]
  );
  const estimatedBytes = useMemo(
    () => estimateWorkspaceBytes(documents, savedSignatures),
    [documents, savedSignatures]
  );

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const showToast = (message: string) => setToast(message);

  const openExport = () => {
    haptics.tap();
    setExportChoice('json');
    setExportOpen(true);
  };

  const openImport = () => {
    haptics.tap();
    setImportError('');
    setImportPreview(null);
    setImportOpen(true);
  };

  const handleExport = () => {
    haptics.tap();
    if (exportChoice === 'json') {
      const payload = buildWorkspaceBackup(settings, documents, savedSignatures);
      downloadTextFile(
        JSON.stringify(payload),
        `bitscanner-backup-${dateStamp()}.json`,
        'application/json'
      );
      showToast('Full JSON backup downloaded.');
    } else {
      downloadTextFile(
        `\uFEFF${buildDocumentsCsv(documents)}`,
        `bitscanner-index-${dateStamp()}.csv`,
        'text/csv;charset=utf-8'
      );
      showToast('Document index CSV downloaded.');
    }
    setExportOpen(false);
  };

  const handleImportFile = async (file: File) => {
    setImportError('');
    if (!file.name.toLowerCase().endsWith('.json')) {
      setImportError('Choose a .json backup exported from bitscanner.');
      return;
    }
    try {
      const parsed = parseWorkspaceBackup(await file.text());
      setImportPreview({
        fileName: file.name,
        documents: parsed.documents,
        signatures: parsed.savedSignatures,
        pageCount: parsed.documents.reduce((total, doc) => total + doc.pages.length, 0),
        version: parsed.version,
      });
    } catch (error) {
      setImportPreview(null);
      setImportError(error instanceof Error ? error.message : 'Could not read that backup.');
    }
  };

  const handleConfirmImport = async () => {
    if (!importPreview || importing) return;
    setImporting(true);
    setImportError('');
    try {
      await onImportWorkspace(importPreview.documents, importPreview.signatures);
      haptics.success();
      const docCount = importPreview.documents.length;
      const sigCount = importPreview.signatures.length;
      setImportOpen(false);
      setImportPreview(null);
      showToast(
        `Imported ${docCount} project${docCount === 1 ? '' : 's'} and ${sigCount} signature${
          sigCount === 1 ? '' : 's'
        }.`
      );
    } catch {
      setImportError('Import failed. Your existing workspace was not changed.');
    } finally {
      setImporting(false);
    }
  };

  const handleErase = () => {
    haptics.warning();
    setEraseOpen(false);
    onResetLocalWorkspace();
    showToast('Local workspace erased and samples restored.');
  };

  const filterLabel =
    FILTER_OPTIONS.find((option) => option.value === settings.defaultFilter)?.label ||
    'Magic Color';
  const paperLabel =
    PAPER_OPTIONS.find((option) => option.value === settings.defaultPaperSize)?.label || 'A4';
  const ocrLangLabel =
    OCR_LANG_OPTIONS.find((option) => option.value === settings.defaultOcrLang)?.label ||
    settings.defaultOcrLang.toUpperCase();
  const themeLabel =
    THEME_OPTIONS.find((option) => option.value === settings.theme)?.label || 'System';

  const visibleSections = (Object.keys(SECTION_SEARCH) as SectionId[]).filter((id) =>
    matchesSearch(query, id)
  );
  const searching = query.length > 0;

  return (
    <div
      data-testid="settings-view"
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-4 pb-28 sm:gap-5 sm:p-6 lg:p-8"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => {
              haptics.tap();
              onBackToProfile();
            }}
            data-testid="settings-back-profile-btn"
            aria-label="Back to profile"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-50 cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold text-slate-900 sm:text-lg">Settings</h1>
            <p className="text-[11px] text-slate-500">Changes save automatically</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            haptics.tap();
            onUpdateSettings({
              ...DEFAULT_APP_SETTINGS,
              theme: settings.theme,
              accountCreatedAt: settings.accountCreatedAt,
              hasCompletedOnboarding: settings.hasCompletedOnboarding,
              displayName: settings.displayName,
              accountHandle: settings.accountHandle,
              email: settings.email,
              avatarColor: settings.avatarColor,
            });
            showToast('Preferences restored to defaults.');
          }}
          data-testid="settings-restore-defaults-btn"
          className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 cursor-pointer"
        >
          <RotateCcw className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
          <span className="hidden sm:inline">Restore defaults</span>
          <span className="sm:hidden">Reset</span>
        </button>
      </div>

      {/* Search */}
      <div className="sticky top-0 z-20 -mx-4 bg-slate-50/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="text"
            inputMode="search"
            enterKeyHint="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setSearch('');
            }}
            placeholder="Search settings — theme, OCR, backup…"
            aria-label="Search settings"
            data-testid="settings-search-input"
            className="min-h-[46px] w-full rounded-xl border border-slate-200 bg-white pl-9 pr-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/20"
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                haptics.tap();
                setSearch('');
              }}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
        {searching && (
          <p className="mt-1.5 px-1 text-[11px] font-medium text-slate-500" role="status">
            {visibleSections.length === 0
              ? 'No settings match that search'
              : `${visibleSections.length} section${visibleSections.length === 1 ? '' : 's'} match`}
          </p>
        )}
      </div>

      {toast && (
        <div
          role="status"
          className="animate-sheet-up rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-semibold text-emerald-800"
        >
          {toast}
        </div>
      )}

      {visibleSections.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center">
          <Search className="mx-auto h-6 w-6 text-slate-300" aria-hidden="true" />
          <p className="mt-2 text-sm font-semibold text-slate-800">Nothing found for “{query}”</p>
          <p className="mt-1 text-xs text-slate-500">
            Try “theme”, “OCR”, “backup” or “layout”.
          </p>
          <button
            type="button"
            onClick={() => {
              haptics.tap();
              setSearch('');
            }}
            className="mt-3 min-h-[38px] rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            Clear search
          </button>
        </div>
      )}

      {/* Capture & auto-edge */}
      {visibleSections.includes('capture') && (
        <SettingsSection
          icon={ScanLine}
          title="Capture &amp; auto-edge"
          description="How new scans are detected and processed"
          summary={`${filterLabel} · auto-edge ${
            settings.autoEdgeDetect ? 'on' : 'off'
          } · originals ${settings.autoSaveOriginal ? 'kept' : 'off'}`}
          forceOpen={searching}
        >
          <ToggleRow
            title="Auto-detect document edges"
            description="Snap perspective corners automatically after capture or import"
            checked={settings.autoEdgeDetect}
            onChange={(checked) => onUpdateSettings({ autoEdgeDetect: checked })}
            testId="settings-auto-edge-toggle"
          />
          <ToggleRow
            title="Keep original capture layer"
            description="Preserve the uncropped frame so corners can be re-adjusted later"
            checked={settings.autoSaveOriginal}
            onChange={(checked) => onUpdateSettings({ autoSaveOriginal: checked })}
          />
          <ToggleRow
            title="Prompt auto-OCR index"
            description="Extract text automatically when a new single-page scan opens"
            checked={settings.autoRunOcr}
            onChange={(checked) => onUpdateSettings({ autoRunOcr: checked })}
          />
          <FieldRow label="Default auto-filter" hint="Applied right after capture">
            <SelectField
              value={settings.defaultFilter}
              options={FILTER_OPTIONS}
              ariaLabel="Default scan filter"
              onChange={(value) => onUpdateSettings({ defaultFilter: value })}
              id="settings-filter-select"
            />
          </FieldRow>
        </SettingsSection>
      )}

      {/* OCR & export */}
      {visibleSections.includes('export') && (
        <SettingsSection
          icon={Download}
          title="OCR &amp; export"
          description="Defaults used by every PDF, image and Word export"
          summary={`${ocrLangLabel} · ${paperLabel} · ${settings.defaultPdfQuality} quality`}
          forceOpen={searching}
        >
          <FieldRow label="Preferred export format">
            <Segmented
              value={settings.defaultExportFormat}
              options={[
                { value: 'pdf', label: 'PDF' },
                { value: 'image', label: 'Image' },
                { value: 'word', label: 'Word' },
              ]}
              ariaLabel="Preferred export format"
              onChange={(value) =>
                onUpdateSettings({ defaultExportFormat: value as ExportFormat })
              }
            />
          </FieldRow>

          <FieldRow label="Default filename prefix" hint="Letters, numbers & dashes">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={settings.defaultFilenamePrefix}
                maxLength={24}
                onChange={(e) =>
                  onUpdateSettings({
                    defaultFilenamePrefix: sanitizeFilenamePrefix(e.target.value),
                  })
                }
                aria-label="Default filename prefix"
                className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 focus:border-teal-600 focus:outline-none"
              />
              <span className="shrink-0 rounded-lg bg-slate-100 px-2 py-1 font-mono-tabular text-[11px] text-slate-500">
                001.pdf
              </span>
            </div>
          </FieldRow>

          <FieldRow label="Default OCR language">
            <SelectField
              value={settings.defaultOcrLang}
              options={OCR_LANG_OPTIONS}
              ariaLabel="Default OCR language"
              onChange={(value) => onUpdateSettings({ defaultOcrLang: value })}
              id="settings-ocr-lang-select"
            />
          </FieldRow>

          <FieldRow label="PDF paper size">
            <SelectField
              value={settings.defaultPaperSize}
              options={PAPER_OPTIONS}
              ariaLabel="Default PDF paper size"
              onChange={(value) => onUpdateSettings({ defaultPaperSize: value })}
              id="settings-paper-select"
            />
          </FieldRow>

          <FieldRow label="Export quality">
            <Segmented
              value={settings.defaultPdfQuality}
              options={[
                { value: 'high', label: 'High' },
                { value: 'balanced', label: 'Balanced' },
                { value: 'compact', label: 'Compact' },
              ]}
              ariaLabel="Default export quality"
              onChange={(value) => onUpdateSettings({ defaultPdfQuality: value as PdfQuality })}
            />
          </FieldRow>

          <ToggleRow
            title="Searchable PDF text layer"
            description="Embed recognized OCR text invisibly inside exported PDFs"
            checked={settings.searchablePdfByDefault}
            onChange={(checked) => onUpdateSettings({ searchablePdfByDefault: checked })}
          />
        </SettingsSection>
      )}

      {/* Appearance */}
      {visibleSections.includes('appearance') && (
        <SettingsSection
          icon={Palette}
          title="Appearance"
          description="Theme, contrast and how the interface looks"
          summary={`${themeLabel} theme`}
          forceOpen={searching}
        >
          <FieldRow label="Theme" hint="Applies everywhere instantly">
            <ThemePicker
              value={settings.theme}
              onChange={(value) => {
                haptics.tap();
                onUpdateSettings({ theme: value });
              }}
            />
          </FieldRow>
          <ToggleRow
            title="Reduced UI motion"
            description="Minimize slide transitions and animations across sheets"
            checked={settings.reduceMotion}
            onChange={(checked) => onUpdateSettings({ reduceMotion: checked })}
          />
        </SettingsSection>
      )}

      {/* Interface & safety */}
      {visibleSections.includes('interface') && (
        <SettingsSection
          icon={SlidersHorizontal}
          title="Interface &amp; safety"
          description="Layout, motion and feedback preferences"
          summary={`${settings.defaultLibraryView === 'grid' ? 'Grid' : 'List'} library · haptics ${
            settings.hapticsEnabled ? 'on' : 'off'
          }`}
          forceOpen={searching}
        >
          <FieldRow label="Default library layout">
            <Segmented
              value={settings.defaultLibraryView}
              options={[
                { value: 'grid', label: 'Grid view' },
                { value: 'list', label: 'List view' },
              ]}
              ariaLabel="Default library layout"
              onChange={(value) =>
                onUpdateSettings({ defaultLibraryView: value as 'grid' | 'list' })
              }
            />
          </FieldRow>
          <ToggleRow
            title="Haptic feedback"
            description="Subtle vibration on capture, taps and saves"
            checked={settings.hapticsEnabled}
            onChange={(checked) => onUpdateSettings({ hapticsEnabled: checked })}
            testId="settings-haptics-toggle"
          />
          <ToggleRow
            title="Confirm before deleting"
            description="Ask before a project or page is permanently removed"
            checked={settings.confirmBeforeDelete}
            onChange={(checked) => onUpdateSettings({ confirmBeforeDelete: checked })}
          />
        </SettingsSection>
      )}

      {/* Data & backup */}
      {visibleSections.includes('data') && (
        <SettingsSection
          icon={Database}
          title="Data &amp; backup"
          description="Export, import or clear this local workspace"
          summary={`${documents.length} projects · ${formatByteSize(estimatedBytes)} · JSON & CSV`}
          forceOpen={searching}
        >
          <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                <FolderDown className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">Backup &amp; restore</div>
                <div className="mt-0.5 text-xs leading-relaxed text-slate-500">
                  {documents.length} projects · {totalPages} pages ·{' '}
                  {savedSignatures.length} signatures
                </div>
              </div>
            </div>
            <div className="flex w-full items-center gap-2 sm:w-auto sm:shrink-0">
              <button
                type="button"
                onClick={openImport}
                data-testid="settings-import-btn"
                className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 sm:flex-none cursor-pointer"
              >
                <Upload className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                Import
              </button>
              <button
                type="button"
                onClick={openExport}
                data-testid="settings-export-btn"
                className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-teal-600 px-3 text-xs font-bold text-white transition-colors hover:bg-teal-700 sm:flex-none cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                Export
              </button>
            </div>
          </div>

          <div className="flex items-start justify-between gap-3 px-4 py-3.5">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">Erase local data</div>
                <div className="mt-0.5 text-xs leading-relaxed text-slate-500">
                  Delete every project &amp; signature, then restore the samples
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                haptics.tap();
                setEraseOpen(true);
              }}
              data-testid="settings-erase-btn"
              className="min-h-[38px] shrink-0 self-center rounded-xl border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50 cursor-pointer"
            >
              Erase
            </button>
          </div>
        </SettingsSection>
      )}

      {/* App & onboarding */}
      {visibleSections.includes('app') && (
        <SettingsSection
          icon={Smartphone}
          title="App &amp; onboarding"
          description="Install bitscanner or replay the welcome tour"
          summary={`v${APP_VERSION} · install & guided tour`}
          forceOpen={searching}
        >
          <div className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center">
            <PWAInstallButton variant="compact" />
            <button
              type="button"
              onClick={() => {
                haptics.tap();
                onReplayOnboarding();
              }}
              className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5 text-teal-600" aria-hidden="true" />
              <span>Replay setup tour</span>
            </button>
          </div>
          <div className="flex items-start gap-2.5 px-4 py-3">
            <FlaskConical
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600"
              aria-hidden="true"
            />
            <p className="text-[11px] leading-relaxed text-slate-500">
              Press{' '}
              <span className="font-mono-tabular rounded-md border border-slate-200 bg-white px-1 py-0.5 text-[10px] font-semibold text-slate-600">
                Ctrl
              </span>{' '}
              +{' '}
              <span className="font-mono-tabular rounded-md border border-slate-200 bg-white px-1 py-0.5 text-[10px] font-semibold text-slate-600">
                Shift
              </span>{' '}
              +{' '}
              <span className="font-mono-tabular rounded-md border border-slate-200 bg-white px-1 py-0.5 text-[10px] font-semibold text-slate-600">
                D
              </span>{' '}
              to open the demo workspace. Sample files load without touching your scans.
            </p>
          </div>
        </SettingsSection>
      )}

      <p className="flex items-center justify-center gap-1.5 px-2 text-center text-[11px] text-slate-400">
        <Type className="h-3.5 w-3.5" aria-hidden="true" />
        bitscanner v{APP_VERSION} · every preference stays on this device
      </p>

      {/* Export dialog */}
      <Modal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export workspace"
        description="Pick a format. Both files download straight to this device."
        icon={Download}
        testId="settings-export-modal"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setExportOpen(false)}
              className="min-h-[40px] rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleExport}
              data-testid="settings-export-confirm-btn"
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-teal-600 px-4 text-xs font-bold text-white hover:bg-teal-700 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Export {exportChoice === 'json' ? 'JSON' : 'CSV'}
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => setExportChoice('json')}
            aria-pressed={exportChoice === 'json'}
            data-testid="settings-export-json-option"
            className={`flex items-start gap-3 rounded-2xl border p-3.5 text-left transition-colors cursor-pointer ${
              exportChoice === 'json'
                ? 'border-teal-600 bg-teal-50/70'
                : 'border-slate-200 bg-white hover:bg-slate-50'
            }`}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-100 text-teal-700">
              <FileJson className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-bold text-slate-900">
                JSON backup
                {exportChoice === 'json' && (
                  <Check className="h-3.5 w-3.5 text-teal-600" aria-hidden="true" />
                )}
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
                Full restore file — projects, pages, OCR, signatures and preferences.
              </span>
              <span className="mt-1 block text-[11px] font-semibold text-slate-500">
                {documents.length} projects · {totalPages} pages ·{' '}
                {formatByteSize(estimatedBytes)}
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => setExportChoice('csv')}
            aria-pressed={exportChoice === 'csv'}
            data-testid="settings-export-csv-option"
            className={`flex items-start gap-3 rounded-2xl border p-3.5 text-left transition-colors cursor-pointer ${
              exportChoice === 'csv'
                ? 'border-teal-600 bg-teal-50/70'
                : 'border-slate-200 bg-white hover:bg-slate-50'
            }`}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-bold text-slate-900">
                CSV index
                {exportChoice === 'csv' && (
                  <Check className="h-3.5 w-3.5 text-teal-600" aria-hidden="true" />
                )}
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
                One row per project — title, folder, pages, dates and OCR characters. No images,
                so it is not a restore file.
              </span>
              <span className="mt-1 block text-[11px] font-semibold text-slate-500">
                {documents.length} rows · opens in Excel or Sheets
              </span>
            </span>
          </button>
        </div>
      </Modal>

      {/* Import dialog */}
      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import a backup"
        description="Merge a bitscanner .json file into this workspace."
        icon={Upload}
        iconClassName="bg-violet-50 text-violet-700"
        testId="settings-import-modal"
        footer={
          importPreview ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-slate-500">Existing items are kept</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setImportPreview(null);
                    setImportError('');
                  }}
                  className="min-h-[40px] rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Choose another
                </button>
                <button
                  type="button"
                  onClick={handleConfirmImport}
                  disabled={importing}
                  data-testid="settings-import-confirm-btn"
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-teal-600 px-4 text-xs font-bold text-white transition-colors hover:bg-teal-700 disabled:opacity-60 cursor-pointer"
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  {importing ? 'Importing…' : 'Import now'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setImportOpen(false)}
                className="min-h-[40px] rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          )
        }
      >
        <input
          ref={importInputRef}
          type="file"
          accept=".json,application/json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void handleImportFile(file);
          }}
          className="sr-only"
          aria-label="Choose a bitscanner JSON backup"
          data-testid="settings-import-input"
        />

        {!importPreview ? (
          <div>
            <button
              type="button"
              onClick={() => {
                haptics.tap();
                importInputRef.current?.click();
              }}
              data-testid="settings-import-choose-btn"
              className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/70 px-4 py-8 text-center transition-colors hover:border-teal-300 hover:bg-teal-50/40 cursor-pointer"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-teal-700 shadow-xs">
                <Upload className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="text-sm font-bold text-slate-800">Choose a .json backup</span>
              <span className="text-[11px] text-slate-500">
                Exported from Settings → Data & backup
              </span>
            </button>
            <p className="mt-3 flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-[11px] leading-relaxed text-slate-500">
              <HardDrive className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
              Importing merges by ID: matching projects are replaced, everything else stays. Export
              a backup first if you want an undo point.
            </p>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2.5 rounded-xl border border-teal-200 bg-teal-50/70 px-3.5 py-3">
              <FileJson className="h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" />
              <div className="min-w-0">
                <div className="truncate text-xs font-bold text-teal-950">
                  {importPreview.fileName}
                </div>
                <div className="text-[11px] text-teal-900/80">
                  {importPreview.documents.length} projects · {importPreview.pageCount} pages ·{' '}
                  {importPreview.signatures.length} signatures
                  {importPreview.version ? ` · v${importPreview.version}` : ''}
                </div>
              </div>
            </div>
            <ul className="mt-3 space-y-1.5 text-[11px] leading-relaxed text-slate-500">
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-600" aria-hidden="true" />
                New projects and signatures are added to this device.
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-600" aria-hidden="true" />
                Items with the same ID are updated, never duplicated.
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-600" aria-hidden="true" />
                Nothing is uploaded anywhere.
              </li>
            </ul>
          </div>
        )}

        {importError && (
          <div
            role="alert"
            className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-[11px] font-medium leading-relaxed text-red-700"
          >
            {importError}
          </div>
        )}
      </Modal>

      {/* Erase dialog */}
      <Modal
        open={eraseOpen}
        onClose={() => setEraseOpen(false)}
        title="Erase local data?"
        description="This cannot be undone."
        icon={AlertTriangle}
        iconClassName="bg-red-50 text-red-600"
        testId="settings-erase-modal"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setEraseOpen(false)}
              className="min-h-[40px] rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              Keep my scans
            </button>
            <button
              type="button"
              onClick={handleErase}
              data-testid="settings-erase-confirm-btn"
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-red-600 px-4 text-xs font-bold text-white hover:bg-red-700 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Erase everything
            </button>
          </div>
        }
      >
        <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-xs leading-relaxed text-red-800">
          Every project, page, signature and OCR result in this browser is deleted. The three
          sample documents are restored afterwards. Preferences and your profile stay as they are.
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          Need to keep something? Cancel and export a JSON backup first.
        </p>
      </Modal>
    </div>
  );
};
