import test from 'node:test';
import assert from 'node:assert/strict';
import type { SavedSignature, ScanDocument, ScannedPage } from '../types/scanner';
import { DEFAULT_ADJUSTMENTS, DEFAULT_WATERMARK } from '../types/scanner';
import { DEFAULT_APP_SETTINGS } from './settingsStore';
import {
  buildDocumentsCsv,
  buildWorkspaceBackup,
  parseWorkspaceBackup,
} from './workspaceBackup';

function makePage(overrides: Partial<ScannedPage> = {}): ScannedPage {
  return {
    id: 'page-1',
    originalDataUrl: 'data:image/jpeg;base64,AAA',
    croppedDataUrl: 'data:image/jpeg;base64,BBB',
    processedDataUrl: 'data:image/jpeg;base64,CCC',
    quad: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    filter: 'magic_color',
    adjustments: DEFAULT_ADJUSTMENTS,
    rotation: 0,
    flipH: false,
    annotations: [],
    watermark: DEFAULT_WATERMARK,
    ocrText: '',
    width: 100,
    height: 140,
    createdAt: 1,
    ...overrides,
  };
}

function makeDocument(overrides: Partial<ScanDocument> = {}): ScanDocument {
  return {
    id: 'doc-1',
    title: 'Invoice',
    folder: 'documents',
    starred: false,
    pages: [makePage()],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

test('buildWorkspaceBackup wraps settings, documents and signatures', () => {
  const signature: SavedSignature = {
    id: 'sig-1',
    label: 'Sign',
    dataUrl: 'data:image/png;base64,DDD',
    createdAt: 3,
  };

  const backup = buildWorkspaceBackup(DEFAULT_APP_SETTINGS, [makeDocument()], [signature]);

  assert.equal(backup.app, 'bitscanner');
  assert.equal(typeof backup.version, 'string');
  assert.match(backup.exportedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(backup.account.displayName, DEFAULT_APP_SETTINGS.displayName);
  assert.equal(backup.documents.length, 1);
  assert.equal(backup.savedSignatures.length, 1);
  assert.deepEqual(backup.settings, DEFAULT_APP_SETTINGS);
});

test('parseWorkspaceBackup round-trips a full backup', () => {
  const original = buildWorkspaceBackup(DEFAULT_APP_SETTINGS, [makeDocument()], []);
  const parsed = parseWorkspaceBackup(JSON.stringify(original));

  assert.equal(parsed.documents.length, 1);
  assert.equal(parsed.documents[0]?.title, 'Invoice');
  assert.equal(parsed.savedSignatures.length, 0);
  assert.equal(parsed.version, original.version);
});

test('parseWorkspaceBackup accepts a bare document array', () => {
  const parsed = parseWorkspaceBackup(JSON.stringify([makeDocument({ id: 'doc-9' })]));

  assert.equal(parsed.documents.length, 1);
  assert.equal(parsed.documents[0]?.id, 'doc-9');
  assert.deepEqual(parsed.savedSignatures, []);
});

test('parseWorkspaceBackup drops documents that cannot be rendered', () => {
  const payload = {
    documents: [
      makeDocument({ id: 'good' }),
      { id: 'no-title', pages: [] },
      makeDocument({ id: 'no-pages', pages: [] }),
      { ...makeDocument({ id: 'bad-page' }), pages: [{ id: 'x', quad: [] }] },
    ],
    savedSignatures: [
      { id: 'sig-ok', label: '', dataUrl: 'data:image/png;base64,EEE' },
      { id: 'sig-bad' },
      null,
    ],
  };

  const parsed = parseWorkspaceBackup(JSON.stringify(payload));

  assert.deepEqual(
    parsed.documents.map((doc) => doc.id),
    ['good']
  );
  assert.equal(parsed.savedSignatures.length, 1);
  assert.equal(parsed.savedSignatures[0]?.label, 'Signature');
});

test('parseWorkspaceBackup rejects unusable files with readable messages', () => {
  assert.throws(() => parseWorkspaceBackup('not json'), /not valid JSON/);
  assert.throws(() => parseWorkspaceBackup(JSON.stringify({ documents: [] })), /No projects/);
  assert.throws(() => parseWorkspaceBackup(JSON.stringify([])), /No projects/);
});

test('buildDocumentsCsv writes a header and escapes unsafe cells', () => {
  const csv = buildDocumentsCsv([
    makeDocument({
      title: 'Invoice, "March"',
      folder: 'receipts',
      starred: true,
      pages: [makePage({ ocrText: 'abcde' }), makePage({ id: 'page-2', ocrText: 'fg' })],
    }),
  ]);

  const [header, row] = csv.trimEnd().split('\r\n');
  assert.equal(
    header,
    'Title,Folder,Pages,Starred,Created,Updated,OCR characters'
  );
  assert.match(row ?? '', /^"Invoice, ""March""",receipts,2,yes,/);
  assert.match(row ?? '', /,7$/);
});

test('buildDocumentsCsv still returns a header when the library is empty', () => {
  const csv = buildDocumentsCsv([]);
  assert.equal(csv.trimEnd().split('\r\n').length, 1);
});
