import type { FilterPreset, PdfPaperSize, PdfQuality } from '../types/scanner';
import { TOOLS_CATALOG } from '../data/tools';
import type { ToolId } from '../data/tools';

export type { ToolCatalogItem, ToolId } from '../data/tools';
export { TOOLS_CATALOG };


export type ThemeMode = 'system' | 'light' | 'dark';

export const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark'];

export type DefaultShareMode = 'share' | 'qr';

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
  defaultShareMode: DefaultShareMode;
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

export const APP_VERSION = '0.1.0';

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
  defaultShareMode: 'share',
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
    defaultShareMode:
      patch.defaultShareMode === 'qr' || patch.defaultShareMode === 'share'
        ? patch.defaultShareMode
        : current.defaultShareMode || 'share',
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
