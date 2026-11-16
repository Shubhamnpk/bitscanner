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
    accentClass: 'bg-teal-50 text-teal-700 border-teal-200',
  },
  {
    id: 'pdf_to_images',
    title: 'PDF to Images',
    shortLabel: 'PDF to Img',
    description: 'Extract every page of any PDF file into crisp PNG or JPEG images.',
    category: 'pdf',
    accentClass: 'bg-sky-50 text-sky-700 border-sky-200',
  },
  {
    id: 'pp_size',
    title: 'Passport Photo',
    shortLabel: 'PP Size',
    description: 'Create standard 35x45mm or 2x2in portrait photos & cut-ready sheets.',
    category: 'photo',
    accentClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  },
  {
    id: 'id_card',
    title: 'ID Card Maker',
    shortLabel: 'ID Card',
    description: 'Align Front & Back card photos onto an ISO A4 printable sheet.',
    category: 'photo',
    accentClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  {
    id: 'merge_pdf',
    title: 'Merge PDFs',
    shortLabel: 'Merge PDF',
    description: 'Combine multiple PDF documents cleanly into one unified file.',
    category: 'pdf',
    accentClass: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  {
    id: 'ocr_extract',
    title: 'Extract Text (OCR)',
    shortLabel: 'OCR Text',
    description: 'Recognize, search, and copy printed text from any photo or scan.',
    category: 'smart',
    accentClass: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  },
  {
    id: 'sign_doc',
    title: 'Signature Studio',
    shortLabel: 'Sign Doc',
    description: 'Draw or type reusable signatures with custom paper backgrounds.',
    category: 'smart',
    accentClass: 'bg-violet-50 text-violet-700 border-violet-200',
  },
  {
    id: 'images_to_video',
    title: 'Scan Slideshow Video',
    shortLabel: 'Make Video',
    description: 'Turn multi-page scans or photos into a smooth playable video clip.',
    category: 'smart',
    accentClass: 'bg-rose-50 text-rose-700 border-rose-200',
  },
];

export interface AppSettings {
  displayName: string;
  email: string;
  defaultFilter: FilterPreset;
  defaultPaperSize: PdfPaperSize;
  defaultPdfQuality: PdfQuality;
  searchablePdfByDefault: boolean;
  defaultOcrLang: string;
  hapticsEnabled: boolean;
  defaultLibraryView: 'grid' | 'list';
  favoriteTools: ToolId[];
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  displayName: 'user',
  email: 'user@gmail.com',
  defaultFilter: 'magic_color',
  defaultPaperSize: 'a4',
  defaultPdfQuality: 'high',
  searchablePdfByDefault: true,
  defaultOcrLang: 'eng',
  hapticsEnabled: true,
  defaultLibraryView: 'grid',
  favoriteTools: ['images_to_pdf', 'pdf_to_images', 'pp_size', 'id_card'],
};

const STORAGE_KEY = 'camscan_studio_settings_v1';

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
