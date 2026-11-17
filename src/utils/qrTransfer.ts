import jsQR from 'jsqr';
import type { ScanDocument } from '../types/scanner';

export const BSQ_PREFIX = 'BSQ1';
export const MAX_QR_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

export type QrChunkDensity = 'fast' | 'balanced' | 'dense';

export const QR_DENSITY_CHUNK_BYTES: Record<QrChunkDensity, number> = {
  fast: 420,
  balanced: 840,
  dense: 1350,
};

export interface QrDocPagePayload {
  mime: string;
  dataB64: string;
  ocrText?: string;
}

export interface DecodedQrPayload {
  v: 1;
  kind: 'bitscan_doc' | 'raw_file' | 'text';
  title: string;
  filename: string;
  mime: string;
  byteLength: number;
  pages?: QrDocPagePayload[];
  fileBytes?: Uint8Array;
  text?: string;
}

export interface QrStreamCollectorState {
  transferId: string | null;
  total: number;
  receivedCount: number;
  received: Record<number, string>;
  duplicateCount: number;
  errorCount: number;
  startedAt: number;
  lastChunkAt: number;
}

export type QrIngestResult =
  | { kind: 'empty'; state: QrStreamCollectorState }
  | { kind: 'plain_text'; text: string; state: QrStreamCollectorState }
  | { kind: 'invalid'; reason: string; state: QrStreamCollectorState }
  | {
      kind: 'progress';
      state: QrStreamCollectorState;
      isNewChunk: boolean;
      chunkIndex: number;
      receivedCount: number;
      totalCount: number;
    }
  | {
      kind: 'complete';
      state: QrStreamCollectorState;
      payload: DecodedQrPayload;
    };

export function createCollectorState(): QrStreamCollectorState {
  return {
    transferId: null,
    total: 0,
    receivedCount: 0,
    received: {},
    duplicateCount: 0,
    errorCount: 0,
    startedAt: 0,
    lastChunkAt: 0,
  };
}

/** Deterministic 16-bit CCITT CRC for QR optical frame verification */
export function computeCrc16Hex(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).padStart(4, '0');
}

export function uint8ToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToUint8(b64Url: string): Uint8Array {
  const padded = b64Url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64Url.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function dataUrlToUint8(dataUrl: string): { mime: string; bytes: Uint8Array } {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) {
    return { mime: 'application/octet-stream', bytes: new Uint8Array() };
  }
  const header = dataUrl.slice(0, comma);
  const mimeMatch = header.match(/data:([^;]+)/);
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  const rawB64 = dataUrl.slice(comma + 1);
  const binary = atob(rawB64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { mime, bytes };
}

export function uint8ToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

async function compressPayloadEnvelope(
  bytes: Uint8Array,
  rawFlag = 0x00,
  deflateFlag = 0x01
): Promise<Uint8Array> {
  const wrapRaw = () => {
    const out = new Uint8Array(bytes.length + 1);
    out[0] = rawFlag;
    out.set(bytes, 1);
    return out;
  };

  if (typeof CompressionStream === 'undefined' || bytes.length < 96) {
    return wrapRaw();
  }

  try {
    const cs = new CompressionStream('deflate-raw');
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    const readPromise = new Response(cs.readable).arrayBuffer();
    const writer = cs.writable.getWriter();
    const writePromise = writer.write(copy).then(() => writer.close());
    const [compressedBuf] = await Promise.all([readPromise, writePromise]);
    const compressed = new Uint8Array(compressedBuf);
    if (compressed.length + 1 < bytes.length) {
      const out = new Uint8Array(compressed.length + 1);
      out[0] = deflateFlag;
      out.set(compressed, 1);
      return out;
    }
  } catch {
    // Fallback to raw envelope
  }
  return wrapRaw();
}

async function decompressEnvelopeBytes(
  packed: Uint8Array
): Promise<{ format: 'json' | 'binary_file'; bytes: Uint8Array }> {
  if (packed.length === 0) return { format: 'json', bytes: packed };
  const flag = packed[0];
  const body = packed.subarray(1);
  if (flag === 0x00) return { format: 'json', bytes: body };
  if (flag === 0x02) return { format: 'binary_file', bytes: body };
  if ((flag === 0x01 || flag === 0x03) && typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('deflate-raw');
    const copy = new Uint8Array(body.length);
    copy.set(body);
    const readPromise = new Response(ds.readable).arrayBuffer();
    const writer = ds.writable.getWriter();
    const writePromise = writer.write(copy).then(() => writer.close());
    const [outBuf] = await Promise.all([readPromise, writePromise]);
    return {
      format: flag === 0x03 ? 'binary_file' : 'json',
      bytes: new Uint8Array(outBuf),
    };
  }
  throw new Error('Unsupported compression envelope');
}

function randomTransferId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 4; i++) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return id;
}

export async function encodePayloadToQrFrames(
  payload:
    | {
        kind: 'bitscan_doc';
        title: string;
        filename: string;
        pages: QrDocPagePayload[];
      }
    | {
        kind: 'raw_file';
        title: string;
        filename: string;
        mime: string;
        fileBytes: Uint8Array;
      }
    | {
        kind: 'text';
        title: string;
        filename: string;
        text: string;
      },
  opts?: { density?: QrChunkDensity; transferId?: string }
): Promise<{ frames: string[]; totalBytes: number; encodedChars: number; transferId: string }> {
  let packed: Uint8Array;

  if (payload.kind === 'raw_file') {
    // Compact binary header + fileBytes avoids 33% JSON-base64 inflation on files up to 5 MB
    const metaBytes = new TextEncoder().encode(
      JSON.stringify({
        v: 1,
        title: payload.title,
        filename: payload.filename,
        mime: payload.mime,
      })
    );
    const combined = new Uint8Array(2 + metaBytes.length + payload.fileBytes.byteLength);
    combined[0] = (metaBytes.length >> 8) & 0xff;
    combined[1] = metaBytes.length & 0xff;
    combined.set(metaBytes, 2);
    combined.set(payload.fileBytes, 2 + metaBytes.length);
    packed = await compressPayloadEnvelope(combined, 0x02, 0x03);
  } else {
    const serializable =
      payload.kind === 'bitscan_doc'
        ? {
            v: 1 as const,
            kind: 'bitscan_doc' as const,
            title: payload.title,
            filename: payload.filename,
            mime: 'application/x-bitscan-doc',
            pages: payload.pages,
          }
        : {
            v: 1 as const,
            kind: 'text' as const,
            title: payload.title,
            filename: payload.filename,
            mime: 'text/plain',
            text: payload.text,
          };

    const jsonBytes = new TextEncoder().encode(JSON.stringify(serializable));
    packed = await compressPayloadEnvelope(jsonBytes, 0x00, 0x01);
  }

  const fullB64 = uint8ToBase64Url(packed);

  const chunkSize = QR_DENSITY_CHUNK_BYTES[opts?.density || 'balanced'];
  const total = Math.max(1, Math.ceil(fullB64.length / chunkSize));
  const transferId = (opts?.transferId || randomTransferId()).replace(/[^a-zA-Z0-9]/g, '').slice(0, 6) || 'bsq1';

  const frames: string[] = [];
  for (let i = 0; i < total; i++) {
    const chunk = fullB64.slice(i * chunkSize, (i + 1) * chunkSize);
    const unsigned = `${transferId}|${i}|${total}|${chunk}`;
    const crc = computeCrc16Hex(unsigned);
    frames.push(`${BSQ_PREFIX}|${transferId}|${i}|${total}|${crc}|${chunk}`);
  }

  return {
    frames,
    totalBytes: packed.length,
    encodedChars: fullB64.length,
    transferId,
  };
}

/** Downscale and recompress a dataURL cleanly to keep QR frame counts fast and practical */
export async function compressImageDataUrlForQr(
  dataUrl: string,
  maxDim: number,
  quality: number
): Promise<{ mime: string; dataB64: string; approxBytes: number }> {
  if (typeof document === 'undefined') {
    const raw = dataUrlToUint8(dataUrl);
    return {
      mime: raw.mime,
      dataB64: uint8ToBase64Url(raw.bytes),
      approxBytes: raw.bytes.byteLength,
    };
  }

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Failed to load page image for QR encoding'));
    el.src = dataUrl;
  });

  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
  const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const raw = dataUrlToUint8(dataUrl);
    return { mime: raw.mime, dataB64: uint8ToBase64Url(raw.bytes), approxBytes: raw.bytes.byteLength };
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  // Prefer WebP if supported cleanly, fall back to JPEG
  let outUrl = canvas.toDataURL('image/webp', quality);
  if (!outUrl.startsWith('data:image/webp')) {
    outUrl = canvas.toDataURL('image/jpeg', quality);
  }
  const parsed = dataUrlToUint8(outUrl);
  return {
    mime: parsed.mime,
    dataB64: uint8ToBase64Url(parsed.bytes),
    approxBytes: parsed.bytes.byteLength,
  };
}

export async function prepareDocumentForQrShare(
  doc: ScanDocument,
  selectedPageIndices: number[],
  preset: 'fast_image' | 'crisp_image' | 'ocr_only',
  density: QrChunkDensity = 'balanced'
): Promise<{
  frames: string[];
  totalBytes: number;
  transferId: string;
  summaryLabel: string;
}> {
  const safeIndices =
    selectedPageIndices.length > 0
      ? selectedPageIndices.filter((i) => i >= 0 && i < doc.pages.length)
      : doc.pages.map((_, idx) => idx);

  if (preset === 'ocr_only') {
    const textBody = safeIndices
      .map((idx) => {
        const pg = doc.pages[idx];
        const header = safeIndices.length > 1 ? `--- Page ${idx + 1} ---\n` : '';
        return `${header}${(pg?.ocrText || '').trim()}`;
      })
      .filter(Boolean)
      .join('\n\n')
      .trim();

    const finalText = textBody || `${doc.title}\n(No extracted OCR text on selected page(s))`;
    const res = await encodePayloadToQrFrames(
      {
        kind: 'text',
        title: doc.title,
        filename: `${doc.title.replace(/[^\w.-]+/g, '_') || 'scan'}_ocr.txt`,
        text: finalText,
      },
      { density }
    );
    return {
      ...res,
      summaryLabel: `OCR Text · ${safeIndices.length} ${safeIndices.length === 1 ? 'page' : 'pages'}`,
    };
  }

  const maxDim = preset === 'fast_image' ? 540 : 880;
  const quality = preset === 'fast_image' ? 0.48 : 0.7;

  const pages: QrDocPagePayload[] = [];
  for (const idx of safeIndices) {
    const pg = doc.pages[idx];
    if (!pg) continue;
    const compressed = await compressImageDataUrlForQr(pg.processedDataUrl, maxDim, quality);
    pages.push({
      mime: compressed.mime,
      dataB64: compressed.dataB64,
      ocrText: pg.ocrText || undefined,
    });
  }

  const res = await encodePayloadToQrFrames(
    {
      kind: 'bitscan_doc',
      title: doc.title,
      filename: `${doc.title.replace(/[^\w.-]+/g, '_') || 'scan'}.bitscan`,
      pages,
    },
    { density }
  );

  return {
    ...res,
    summaryLabel: `${pages.length} ${pages.length === 1 ? 'page' : 'pages'} (${preset === 'fast_image' ? 'Fast Scan' : 'Crisp Scan'})`,
  };
}

export async function decodeCompleteQrEnvelope(packedB64: string): Promise<DecodedQrPayload> {
  const packedBytes = base64UrlToUint8(packedB64);
  const { format, bytes } = await decompressEnvelopeBytes(packedBytes);

  if (format === 'binary_file') {
    if (bytes.length < 2) {
      throw new Error('Malformed binary QR envelope');
    }
    const metaLen = (bytes[0] << 8) | bytes[1];
    if (bytes.length < 2 + metaLen) {
      throw new Error('Truncated binary QR header');
    }
    const metaJson = new TextDecoder().decode(bytes.subarray(2, 2 + metaLen));
    const meta = JSON.parse(metaJson) as {
      title?: string;
      filename?: string;
      mime?: string;
    };
    const fileBytes = bytes.slice(2 + metaLen);
    return {
      v: 1,
      kind: 'raw_file',
      title: meta.title || meta.filename || 'Shared File',
      filename: meta.filename || 'shared-file.bin',
      mime: meta.mime || 'application/octet-stream',
      byteLength: fileBytes.byteLength,
      fileBytes,
    };
  }

  const text = new TextDecoder().decode(bytes);
  const parsed = JSON.parse(text) as {
    v: 1;
    kind: 'bitscan_doc' | 'raw_file' | 'text';
    title?: string;
    filename?: string;
    mime?: string;
    byteLength?: number;
    pages?: QrDocPagePayload[];
    fileB64?: string;
    text?: string;
  };

  if (parsed.kind === 'raw_file' && parsed.fileB64) {
    const fileBytes = base64UrlToUint8(parsed.fileB64);
    return {
      v: 1,
      kind: 'raw_file',
      title: parsed.title || parsed.filename || 'Shared File',
      filename: parsed.filename || 'shared-file.bin',
      mime: parsed.mime || 'application/octet-stream',
      byteLength: fileBytes.byteLength,
      fileBytes,
    };
  }

  if (parsed.kind === 'bitscan_doc' && Array.isArray(parsed.pages)) {
    const approxBytes = parsed.pages.reduce(
      (sum, p) => sum + Math.floor((p.dataB64?.length || 0) * 0.75),
      0
    );
    return {
      v: 1,
      kind: 'bitscan_doc',
      title: parsed.title || 'Shared Document',
      filename: parsed.filename || 'shared-document.jpg',
      mime: parsed.mime || 'application/x-bitscan-doc',
      byteLength: approxBytes,
      pages: parsed.pages,
    };
  }

  const noteText = parsed.text || '';
  return {
    v: 1,
    kind: 'text',
    title: parsed.title || 'QR Shared Note',
    filename: parsed.filename || 'qr-note.txt',
    mime: 'text/plain',
    byteLength: new TextEncoder().encode(noteText).byteLength,
    text: noteText,
  };
}

export async function ingestQrPayload(
  prevState: QrStreamCollectorState,
  rawText: string,
  now = Date.now()
): Promise<QrIngestResult> {
  const trimmed = (rawText || '').trim();
  if (!trimmed) {
    return { kind: 'empty', state: prevState };
  }

  if (!trimmed.startsWith(`${BSQ_PREFIX}|`)) {
    return { kind: 'plain_text', text: trimmed, state: prevState };
  }

  const parts = trimmed.split('|');
  if (parts.length < 6) {
    return {
      kind: 'invalid',
      reason: 'Malformed BSQ1 frame header',
      state: { ...prevState, errorCount: prevState.errorCount + 1 },
    };
  }

  const [, transferId, idxStr, totalStr, crcHex, ...rest] = parts;
  const chunk = rest.join('|');
  const idx = Number.parseInt(idxStr, 10);
  const total = Number.parseInt(totalStr, 10);

  if (
    !transferId ||
    !Number.isInteger(idx) ||
    !Number.isInteger(total) ||
    total <= 0 ||
    idx < 0 ||
    idx >= total
  ) {
    return {
      kind: 'invalid',
      reason: 'Invalid frame index or total',
      state: { ...prevState, errorCount: prevState.errorCount + 1 },
    };
  }

  const expectedCrc = computeCrc16Hex(`${transferId}|${idx}|${total}|${chunk}`);
  if (expectedCrc !== crcHex.toLowerCase()) {
    return {
      kind: 'invalid',
      reason: 'Frame CRC mismatch',
      state: { ...prevState, errorCount: prevState.errorCount + 1 },
    };
  }

  // Reset collector seamlessly if a different transferId begins beaming
  const isSameStream = prevState.transferId === transferId && prevState.total === total;
  const baseState: QrStreamCollectorState = isSameStream
    ? prevState
    : {
        transferId,
        total,
        receivedCount: 0,
        received: {},
        duplicateCount: 0,
        errorCount: 0,
        startedAt: now,
        lastChunkAt: now,
      };

  const alreadyHad = Object.prototype.hasOwnProperty.call(baseState.received, idx);
  if (!alreadyHad) {
    // Update backing chunk dictionary cleanly in O(1) so 5 MB (4,000+ frame) streams stay 60fps
    baseState.received[idx] = chunk;
  }

  const receivedCount = alreadyHad ? baseState.receivedCount : baseState.receivedCount + 1;
  const nextState: QrStreamCollectorState = {
    ...baseState,
    receivedCount,
    duplicateCount: alreadyHad ? baseState.duplicateCount + 1 : baseState.duplicateCount,
    lastChunkAt: now,
  };

  if (receivedCount === total) {
    const orderedChunks: string[] = new Array(total);
    for (let i = 0; i < total; i++) {
      orderedChunks[i] = baseState.received[i] || '';
    }
    const combinedB64 = orderedChunks.join('');
    try {
      const payload = await decodeCompleteQrEnvelope(combinedB64);
      return { kind: 'complete', state: nextState, payload };
    } catch {
      return {
        kind: 'invalid',
        reason: 'Failed to reconstruct payload',
        state: { ...nextState, errorCount: nextState.errorCount + 1 },
      };
    }
  }

  return {
    kind: 'progress',
    state: nextState,
    isNewChunk: !alreadyHad,
    chunkIndex: idx,
    receivedCount,
    totalCount: total,
  };
}

export function summarizeCollectorProgress(
  state: QrStreamCollectorState,
  maxSegments = 40
): Array<'empty' | 'partial' | 'done'> {
  if (state.total <= 0) return [];
  const segCount = Math.min(state.total, Math.max(1, maxSegments));
  const out: Array<'empty' | 'partial' | 'done'> = [];

  for (let s = 0; s < segCount; s++) {
    const start = Math.floor((s * state.total) / segCount);
    const end = Math.max(start + 1, Math.floor(((s + 1) * state.total) / segCount));
    let hit = 0;
    for (let i = start; i < end; i++) {
      if (Object.prototype.hasOwnProperty.call(state.received, i)) hit++;
    }
    const span = end - start;
    out.push(hit === 0 ? 'empty' : hit >= span ? 'done' : 'partial');
  }
  return out;
}

export function estimateQrTransferMetrics(
  totalBytes: number,
  frameCount: number,
  fps: number
): {
  loopSeconds: number;
  formattedDuration: string;
  throughputLabel: string;
  isLargeTransfer: boolean;
} {
  if (frameCount <= 1) {
    return {
      loopSeconds: 0,
      formattedDuration: 'Instant',
      throughputLabel: `${Math.max(1, Math.round(totalBytes / 1024))} KB/s`,
      isLargeTransfer: false,
    };
  }
  const safeFps = Math.max(1, fps);
  const loopSeconds = frameCount / safeFps;
  const roundedSec = Math.max(1, Math.round(loopSeconds));
  const formattedDuration =
    roundedSec >= 60
      ? `~${Math.floor(roundedSec / 60)}m ${roundedSec % 60}s`
      : `~${loopSeconds.toFixed(1)}s`;
  const kbPerSec = totalBytes / 1024 / Math.max(0.2, loopSeconds);
  const throughputLabel = kbPerSec >= 1 ? `${kbPerSec.toFixed(1)} KB/s` : `${Math.round(totalBytes / Math.max(0.2, loopSeconds))} B/s`;

  return {
    loopSeconds,
    formattedDuration,
    throughputLabel,
    isLargeTransfer: loopSeconds >= 45 || frameCount >= 400,
  };
}

export interface QrMediaDecodeResult {
  text: string;
  areaFraction: number;
}

/**
 * Decode a single QR code from a live <video> frame or loaded <img> using jsQR,
 * returning both the text payload and the QR bounding area fraction of the frame.
 */
export function decodeQrDetailedFromMediaSource(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  scratchCanvas: HTMLCanvasElement
): QrMediaDecodeResult | null {
  const srcW =
    source instanceof HTMLVideoElement
      ? source.videoWidth
      : source instanceof HTMLImageElement
        ? source.naturalWidth
        : source.width;
  const srcH =
    source instanceof HTMLVideoElement
      ? source.videoHeight
      : source instanceof HTMLImageElement
        ? source.naturalHeight
        : source.height;

  if (!srcW || !srcH) return null;

  const tryDecode = (targetW: number, targetH: number, pad: number): QrMediaDecodeResult | null => {
    const cw = targetW + pad * 2;
    const ch = targetH + pad * 2;
    if (scratchCanvas.width !== cw) scratchCanvas.width = cw;
    if (scratchCanvas.height !== ch) scratchCanvas.height = ch;

    const ctx = scratchCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(source, pad, pad, targetW, targetH);
    const imageData = ctx.getImageData(0, 0, cw, ch);
    const code = jsQR(imageData.data, cw, ch, {
      inversionAttempts: 'attemptBoth',
    });
    if (!code?.data) return null;

    let areaFraction = 0.25;
    if (code.location) {
      const pts = [
        code.location.topLeftCorner,
        code.location.topRightCorner,
        code.location.bottomRightCorner,
        code.location.bottomLeftCorner,
      ];
      let shoelace = 0;
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        shoelace += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
      }
      areaFraction = Math.min(1, Math.abs(shoelace) / 2 / Math.max(1, targetW * targetH));
    }

    return { text: code.data, areaFraction };
  };

  const maxSide = 720;
  const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const primary = tryDecode(w, h, 0);
  if (primary) return primary;

  // Fallback for static QR PNGs or tight crops without a quiet zone (skipped during fast live video)
  if (!(source instanceof HTMLVideoElement)) {
    const upScale = Math.max(1, Math.min(2, 640 / Math.max(srcW, srcH)));
    return tryDecode(Math.round(srcW * upScale), Math.round(srcH * upScale), 24);
  }
  return null;
}

/**
 * Decode a single QR code string from a live <video> frame or loaded <img> using jsQR.
 */
export function decodeQrFromMediaSource(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  scratchCanvas: HTMLCanvasElement
): string | null {
  return decodeQrDetailedFromMediaSource(source, scratchCanvas)?.text ?? null;
}
