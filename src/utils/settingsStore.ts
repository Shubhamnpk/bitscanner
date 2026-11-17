import type { FilterPreset, PdfPaperSize, PdfQuality } from '../types/scanner';

export type ToolId =
  | 'images_to_pdf'
  | 'pdf_to_images'
  | 'pp_size'
  | 'id_card'
  | 'merge_pdf'
  | 'ocr_extract'
  | 'sign_doc'
  | 'images_to_video';

export interface ToolCatalogItem {
  id: ToolId;
  title: string;
  shortLabel: string;
  description: string;
  category: 'pdf' | 'photo' | 'smart';
  accentClass: string;
}

export const TOOLS_CATALOG: ToolCatalogItem[] = [
  {
    id: 'images_to_pdf',
    title: 'Images to PDF',
    shortLabel: 'Img to PDF',
    description: 'Combine photos or scans into one multi-page PDF with drag reorder.',
    category: 'pdf',
    accentClass: 'bg-teal-500/10 text-teal-400 border-transparent',
  },
  {
    id: 'pdf_to_images',
    title: 'PDF to Images',
    shortLabel: 'PDF to Img',
    description: 'Extract every page of any PDF file into crisp PNG or JPEG images.',
    category: 'pdf',
    accentClass: 'bg-sky-500/10 text-sky-400 border-transparent',
  },
  {
    id: 'pp_size',
    title: 'Passport Photo',
    shortLabel: 'PP Size',
    description: 'Create standard 35x45mm or 2x2in portrait photos & cut-ready sheets.',
    category: 'photo',
    accentClass: 'bg-indigo-500/10 text-indigo-400 border-transparent',
  },
  {
    id: 'id_card',
    title: 'ID Card Maker',
    shortLabel: 'ID Card',
    description: 'Align Front & Back card photos onto an ISO A4 printable sheet.',
    category: 'photo',
    accentClass: 'bg-emerald-500/10 text-emerald-400 border-transparent',
  },
  {
    id: 'merge_pdf',
    title: 'Merge PDFs',
    shortLabel: 'Merge PDF',
    description: 'Combine multiple PDF documents cleanly into one unified file.',
    category: 'pdf',
    accentClass: 'bg-amber-500/10 text-amber-400 border-transparent',
  },
  {
    id: 'ocr_extract',
    title: 'Extract Text (OCR)',
    shortLabel: 'OCR Text',
    description: 'Recognize, search, and copy printed text from any photo or scan.',
    category: 'smart',
    accentClass: 'bg-cyan-500/10 text-cyan-400 border-transparent',
  },
  {
    id: 'sign_doc',
    title: 'Signature Studio',
    shortLabel: 'Sign Doc',
    description: 'Draw or type reusable signatures with custom paper backgrounds.',
    category: 'smart',
    accentClass: 'bg-violet-500/10 text-violet-400 border-transparent',
  },
  {
    id: 'images_to_video',
    title: 'Scan Slideshow Video',
    shortLabel: 'Make Video',
    description: 'Turn multi-page scans or photos into a smooth playable video clip.',
    category: 'smart',
    accentClass: 'bg-rose-500/10 text-rose-400 border-transparent',
  },
];

export type ThemeMode = 'system' | 'light' | 'dark';

export const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark'];

export interface AppSettings {
  theme: ThemeMode;
  displayName: string;
  email: string;
  accountHandle: string;
  avatarColor: string;
  accountCreatedAt: number;
  hasCompletedOnboarding: boolean;
  defaultFilter: FilterPreset;
  defaultPaperSize: PdfPaperSize;
  defaultPdfQuality: PdfQuality;
  defaultExportFormat: 'pdf' | 'image' | 'word';
  defaultFilenamePrefix: string;
  searchablePdfByDefault: boolean;
  defaultOcrLang: string;
  autoEdgeDetect: boolean;
  autoRunOcr: boolean;
  autoSaveOriginal: boolean;
  confirmBeforeDelete: boolean;
  reduceMotion: boolean;
  hapticsEnabled: boolean;
  defaultLibraryView: 'grid' | 'list';
  favoriteTools: ToolId[];
}

export const AVATAR_COLOR_OPTIONS = [
  { id: '#0d9488', label: 'Teal' },
  { id: '#0f172a', label: 'Slate' },
  { id: '#2563eb', label: 'Blue' },
  { id: '#7c3aed', label: 'Violet' },
  { id: '#d97706', label: 'Amber' },
  { id: '#e11d48', label: 'Rose' },
] as const;

export const APP_VERSION = '0.0.1';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'system',
  displayName: 'Local Workspace',
  email: 'offline@bitscan.local',
  accountHandle: '@bitscan_user',
  avatarColor: '#0d9488',
  accountCreatedAt: Date.now(),
  hasCompletedOnboarding: false,
  defaultFilter: 'magic_color',
  defaultPaperSize: 'a4',
  defaultPdfQuality: 'high',
  defaultExportFormat: 'pdf',
  defaultFilenamePrefix: 'Scan_',
  searchablePdfByDefault: true,
  defaultOcrLang: 'eng',
  autoEdgeDetect: true,
  autoRunOcr: false,
  autoSaveOriginal: true,
  confirmBeforeDelete: true,
  reduceMotion: false,
  hapticsEnabled: true,
  defaultLibraryView: 'grid',
  favoriteTools: ['images_to_pdf', 'pdf_to_images', 'pp_size', 'id_card'],
};

const STORAGE_KEY = 'camscan_studio_settings_v1';

export function sanitizeAccountHandle(raw: string): string {
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9._-]/g, '').toLowerCase();
  if (!cleaned) return '@bitscan_user';
  return `@${cleaned.slice(0, 24)}`;
}

export function sanitizeFilenamePrefix(raw: string): string {
  const cleaned = raw.replace(/[^\w-]/g, '').slice(0, 24);
  return cleaned || 'Scan_';
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function mergeSettingsPatch(
  current: AppSettings,
  patch: Partial<AppSettings>
): AppSettings {
  const mergedFavs = Array.isArray(patch.favoriteTools)
    ? patch.favoriteTools.filter((id) => TOOLS_CATALOG.some((t) => t.id === id))
    : current.favoriteTools;

  return {
    ...current,
    ...patch,
    theme:
      patch.theme !== undefined && THEME_MODES.includes(patch.theme)
        ? patch.theme
        : current.theme,
    accountHandle:
      patch.accountHandle !== undefined
        ? sanitizeAccountHandle(patch.accountHandle)
        : current.accountHandle,
    defaultFilenamePrefix:
      patch.defaultFilenamePrefix !== undefined
        ? sanitizeFilenamePrefix(patch.defaultFilenamePrefix)
        : current.defaultFilenamePrefix,
    favoriteTools: mergedFavs,
  };
}

export function toggleFavoriteToolInList(favorites: ToolId[], toolId: ToolId): ToolId[] {
  if (favorites.includes(toolId)) {
    return favorites.filter((id) => id !== toolId);
  }
  return [...favorites, toolId];
}

export function loadAppSettings(): AppSettings {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { ...DEFAULT_APP_SETTINGS };
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_APP_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return mergeSettingsPatch(DEFAULT_APP_SETTINGS, parsed);
  } catch {
    return { ...DEFAULT_APP_SETTINGS };
  }
}

export function saveAppSettings(next: AppSettings): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // Ignore storage quota errors gracefully
  }
}
