import type { SavedSignature, ScanDocument } from '../types/scanner';
import type { AppSettings } from './settingsStore';
import { APP_VERSION } from './settingsStore';

export interface WorkspaceBackup {
  app: 'bitscanner';
  version: string;
  exportedAt: string;
  account: {
    displayName: string;
    accountHandle: string;
    email: string;
  };
  settings: AppSettings;
  documents: ScanDocument[];
  savedSignatures: SavedSignature[];
}

export interface ParsedWorkspaceBackup {
  documents: ScanDocument[];
  savedSignatures: SavedSignature[];
  version?: string;
  exportedAt?: string;
}

export function estimateWorkspaceBytes(
  documents: ScanDocument[],
  savedSignatures: SavedSignature[]
): number {
  let bytes = 0;
  for (const doc of documents) {
    for (const page of doc.pages) {
      bytes += (page.originalDataUrl?.length || 0) * 0.75;
      bytes += (page.croppedDataUrl?.length || 0) * 0.75;
      bytes += (page.processedDataUrl?.length || 0) * 0.75;
      bytes += (page.ocrText?.length || 0) * 2;
    }
  }
  for (const signature of savedSignatures) {
    bytes += (signature.dataUrl?.length || 0) * 0.75;
  }
  return bytes;
}

export function buildWorkspaceBackup(
  settings: AppSettings,
  documents: ScanDocument[],
  savedSignatures: SavedSignature[]
): WorkspaceBackup {
  return {
    app: 'bitscanner',
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    account: {
      displayName: settings.displayName,
      accountHandle: settings.accountHandle,
      email: settings.email,
    },
    settings,
    documents,
    savedSignatures,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isImportablePage(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string') return false;
  if (typeof value.processedDataUrl !== 'string' || value.processedDataUrl.length === 0) {
    return false;
  }
  return Array.isArray(value.quad) && value.quad.length === 4;
}

function isImportableDocument(value: unknown): value is ScanDocument {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || typeof value.title !== 'string') return false;
  if (!Array.isArray(value.pages) || value.pages.length === 0) return false;
  return value.pages.every(isImportablePage);
}

function toImportableSignature(value: unknown): SavedSignature | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.dataUrl !== 'string') return null;
  return {
    id: value.id,
    label: typeof value.label === 'string' && value.label ? value.label : 'Signature',
    dataUrl: value.dataUrl,
    backgroundColor:
      typeof value.backgroundColor === 'string' ? value.backgroundColor : undefined,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
  };
}

/**
 * Accepts a bitscanner JSON backup (or a bare document array) and returns only
 * the records that can safely be rendered. Throws a human-readable error when
 * the file is not a usable backup.
 */
export function parseWorkspaceBackup(raw: string): ParsedWorkspaceBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('That file is not valid JSON.');
  }

  const container: Record<string, unknown> = Array.isArray(parsed)
    ? { documents: parsed, savedSignatures: [] }
    : isRecord(parsed)
      ? parsed
      : {};

  const rawDocuments = Array.isArray(container.documents) ? container.documents : [];
  const rawSignatures = Array.isArray(container.savedSignatures)
    ? container.savedSignatures
    : Array.isArray(container.signatures)
      ? container.signatures
      : [];

  const documents = rawDocuments.filter(isImportableDocument);
  const savedSignatures = rawSignatures
    .map(toImportableSignature)
    .filter((signature): signature is SavedSignature => signature !== null);

  if (documents.length === 0 && savedSignatures.length === 0) {
    throw new Error('No projects or signatures found in that backup.');
  }

  return {
    documents,
    savedSignatures,
    version: typeof container.version === 'string' ? container.version : undefined,
    exportedAt: typeof container.exportedAt === 'string' ? container.exportedAt : undefined,
  };
}

const CSV_HEADERS = [
  'Title',
  'Folder',
  'Pages',
  'Starred',
  'Created',
  'Updated',
  'OCR characters',
];

function escapeCsvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Metadata-only CSV of the document library. Images are deliberately excluded;
 * use the JSON backup for a full restore.
 */
export function buildDocumentsCsv(documents: ScanDocument[]): string {
  const rows = documents.map((doc) => {
    const ocrCharacters = doc.pages.reduce((total, page) => total + (page.ocrText?.length || 0), 0);
    return [
      doc.title,
      doc.folder,
      String(doc.pages.length),
      doc.starred ? 'yes' : 'no',
      new Date(doc.createdAt).toISOString(),
      new Date(doc.updatedAt).toISOString(),
      String(ocrCharacters),
    ]
      .map(escapeCsvCell)
      .join(',');
  });

  return `${[CSV_HEADERS.join(','), ...rows].join('\r\n')}\r\n`;
}
