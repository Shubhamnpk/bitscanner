import type {
  QuadCorners,
  SavedSignature,
  ScanDocument,
  ScannedPage,
} from '../types/scanner';
import { DEFAULT_ADJUSTMENTS, DEFAULT_WATERMARK } from '../types/scanner';
import { perspectiveDewarp, processPagePipeline } from './imageProcessor';

import sampleInvoiceUrl from '../assets/images/sample_skewed_invoice_1794662640014.jpg';
import sampleIdCardUrl from '../assets/images/sample_id_card_front_1794662640415.jpg';
import sampleNotesUrl from '../assets/images/sample_study_notes_1794662640687.jpg';

export const SAMPLE_SOURCES = {
  invoice: sampleInvoiceUrl,
  idCard: sampleIdCardUrl,
  notes: sampleNotesUrl,
};

const DB_NAME = 'camscan_studio_db';
const DB_VERSION = 1;
const STORE_DOCS = 'documents';
const STORE_SIGS = 'signatures';
const SEED_FLAG = 'camscan_studio_seeded_v1';

/**
 * Demo mode flips this off so a visitor can scan, edit and delete freely while
 * the real IndexedDB workspace stays untouched. It is memory-only by design.
 */
let persistenceEnabled = true;

export function setPersistenceEnabled(enabled: boolean): void {
  persistenceEnabled = enabled;
}


function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DOCS)) {
        db.createObjectStore(STORE_DOCS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SIGS)) {
        db.createObjectStore(STORE_SIGS, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadAllDocuments(): Promise<ScanDocument[]> {
  try {
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DOCS, 'readonly');
      const store = tx.objectStore(STORE_DOCS);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as ScanDocument[]) || []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function saveDocumentToDb(doc: ScanDocument): Promise<void> {
  if (!persistenceEnabled) return;
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_DOCS, 'readwrite');
      tx.objectStore(STORE_DOCS).put(doc);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Graceful fallback if IndexedDB unavailable
  }
}

export async function deleteDocumentFromDb(id: string): Promise<void> {
  if (!persistenceEnabled) return;
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_DOCS, 'readwrite');
      tx.objectStore(STORE_DOCS).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore
  }
}

export async function loadAllSignatures(): Promise<SavedSignature[]> {
  try {
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SIGS, 'readonly');
      const req = tx.objectStore(STORE_SIGS).getAll();
      req.onsuccess = () => resolve((req.result as SavedSignature[]) || []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function saveSignatureToDb(sig: SavedSignature): Promise<void> {
  if (!persistenceEnabled) return;
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SIGS, 'readwrite');
      tx.objectStore(STORE_SIGS).put(sig);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore
  }
}

export async function deleteSignatureFromDb(id: string): Promise<void> {
  if (!persistenceEnabled) return;
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SIGS, 'readwrite');
      tx.objectStore(STORE_SIGS).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore
  }
}

async function createSeedPage(
  sourceUrl: string,
  quad: QuadCorners,
  filter: ScannedPage['filter'],
  ocrText: string
): Promise<ScannedPage> {
  // Fetch & convert asset to dataUrl so it's self-contained in IndexedDB
  let originalDataUrl = sourceUrl;
  try {
    const resp = await fetch(sourceUrl);
    const blob = await resp.blob();
    originalDataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || sourceUrl));
      reader.readAsDataURL(blob);
    });
  } catch {
    originalDataUrl = sourceUrl;
  }

  const dewarped = await perspectiveDewarp(originalDataUrl, quad, 1200);
  const processed = await processPagePipeline(
    dewarped.dataUrl,
    filter,
    { ...DEFAULT_ADJUSTMENTS },
    0,
    false,
    { maxDim: 1200 }
  );

  return {
    id: crypto.randomUUID(),
    originalDataUrl,
    croppedDataUrl: dewarped.dataUrl,
    processedDataUrl: processed.dataUrl,
    quad,
    filter,
    adjustments: { ...DEFAULT_ADJUSTMENTS },
    rotation: 0,
    flipH: false,
    annotations: [],
    watermark: { ...DEFAULT_WATERMARK },
    ocrText,
    ocrConfidence: 96,
    width: processed.width,
    height: processed.height,
    createdAt: Date.now(),
  };
}

/**
 * Seeds realistic scanned documents on first visit so the user has an immediately working workspace.
 */
export async function ensureSeedDocuments(): Promise<ScanDocument[]> {
  const existing = await loadAllDocuments();
  if (existing.length > 0 || localStorage.getItem(SEED_FLAG)) {
    return existing;
  }

  const seeds = await buildSampleDocuments();

  try {
    for (const doc of seeds) {
      await saveDocumentToDb(doc);
    }
    localStorage.setItem(SEED_FLAG, '1');
  } catch {
    // If seeding fails (e.g., offline asset error), return whatever succeeded
  }

  return seeds;
}

/**
 * Builds the three demo documents in memory without touching IndexedDB.
 * Demo mode uses this so a visitor can explore real content and leave without
 * changing the local workspace.
 */
export async function buildSampleDocuments(): Promise<ScanDocument[]> {
  const now = Date.now();
  const seeds: ScanDocument[] = [];

  try {
    const invoiceQuad: QuadCorners = [
      { x: 0.12, y: 0.28 },
      { x: 0.69, y: 0.19 },
      { x: 0.89, y: 0.74 },
      { x: 0.3, y: 0.87 },
    ];
    const invoicePage = await createSeedPage(
      sampleInvoiceUrl,
      invoiceQuad,
      'magic_color',
      'BUSINESS INVOICE\nInvoice #: INV-2023-0815\nFROM: Apex Solutions Inc.\nTO: Johnson & Partners LLC\nProfessional Consulting Services - 40 hrs - $6,000.00\nWeb Development - 1 Project - $2,500.00\nSupport & Maintenance - 3 mths - $750.00\nTotal Amount Due: $9,990.00'
    );
    seeds.push({
      id: 'seed-invoice-01',
      title: 'Apex Solutions Invoice INV-0815',
      folder: 'receipts',
      starred: true,
      pages: [invoicePage],
      createdAt: now - 3600_000 * 5,
      updatedAt: now - 3600_000 * 2,
    });

    const idQuad: QuadCorners = [
      { x: 0.12, y: 0.34 },
      { x: 0.68, y: 0.12 },
      { x: 0.9, y: 0.56 },
      { x: 0.31, y: 0.88 },
    ];
    const idPage = await createSeedPage(
      sampleIdCardUrl,
      idQuad,
      'original',
      'REPUBLIC OF AETHEL IDENTIFICATION CARD\nCARD NO: 884-9302-17\nNAME: Evelyn Thorne\nID: 004781-B\nDOB: 14 OCT 1993\nEXPIRY: 01 FEB 2029'
    );
    seeds.push({
      id: 'seed-idcard-02',
      title: 'Aethel National ID · Evelyn Thorne',
      folder: 'id_cards',
      starred: false,
      pages: [idPage],
      createdAt: now - 3600_000 * 26,
      updatedAt: now - 3600_000 * 14,
    });

    const notesQuad: QuadCorners = [
      { x: 0.04, y: 0.31 },
      { x: 0.62, y: 0.15 },
      { x: 0.97, y: 0.72 },
      { x: 0.42, y: 0.94 },
    ];
    const notesPage = await createSeedPage(
      sampleNotesUrl,
      notesQuad,
      'bw',
      'ENGINEERING NOTES - WEEK 8\nTOPIC: TRUSS ANALYSIS & FORCES\n1. Identify support reactions (Ra, Rb).\n2. Method of Joints (Solve node A & B).\n3. Method of Sections (Through member CD).\nH = 4m, L = 6m, F_CD = -11.5 kN (C)'
    );
    seeds.push({
      id: 'seed-notes-03',
      title: 'Week 8 Structural Truss Notes',
      folder: 'notes',
      starred: false,
      pages: [notesPage],
      createdAt: now - 3600_000 * 52,
      updatedAt: now - 3600_000 * 48,
    });
  } catch {
    // If a sample asset fails to process, keep whatever succeeded
  }

  return seeds;
}

export async function resetWorkspaceDb(): Promise<ScanDocument[]> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_DOCS, STORE_SIGS], 'readwrite');
      tx.objectStore(STORE_DOCS).clear();
      tx.objectStore(STORE_SIGS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore IDB clear errors
  }
  try {
    localStorage.removeItem(SEED_FLAG);
  } catch {
    // Ignore storage access errors
  }
  return ensureSeedDocuments();
}

