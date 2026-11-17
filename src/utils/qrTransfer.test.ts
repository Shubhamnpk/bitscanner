import test from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import {
  createCollectorState,
  encodePayloadToQrFrames,
  estimateQrTransferMetrics,
  ingestQrPayload,
  MAX_QR_FILE_BYTES,
  summarizeCollectorProgress,
  uint8ToBase64Url,
} from './qrTransfer';

test('encodes and reconstructs raw binary file out of order with duplicate resilience', async () => {
  const rawBytes = new Uint8Array(2048);
  for (let i = 0; i < rawBytes.length; i++) {
    rawBytes[i] = (i * 37 + 11) % 256;
  }

  const encoded = await encodePayloadToQrFrames(
    {
      kind: 'raw_file',
      title: 'Test Binary Spec',
      filename: 'spec.bin',
      mime: 'application/octet-stream',
      fileBytes: rawBytes,
    },
    { density: 'fast', transferId: 'tst1' }
  );

  assert.ok(encoded.frames.length >= 2, 'Expected multiple QR frames for 2KB binary payload');

  // Reverse frame order + inject duplicates + verify final exact byte equality
  const shuffled = [...encoded.frames].reverse();
  shuffled.splice(1, 0, encoded.frames[0]);

  let state = createCollectorState();
  let completedPayload = null;

  for (const frame of shuffled) {
    const res = await ingestQrPayload(state, frame);
    if (res.kind === 'progress') {
      state = res.state;
    } else if (res.kind === 'complete') {
      state = res.state;
      completedPayload = res.payload;
      break;
    } else {
      assert.fail(`Unexpected ingest result: ${res.kind}`);
    }
  }

  assert.ok(completedPayload, 'Expected completed payload');
  assert.equal(completedPayload.kind, 'raw_file');
  assert.equal(completedPayload.filename, 'spec.bin');
  assert.deepEqual(completedPayload.fileBytes, rawBytes);
});

test('rejects corrupted CRC frames cleanly without poisoning collector state', async () => {
  const randomWords = Array.from({ length: 120 }, (_, i) => `${((i * 7919 + 13) % 997).toString(36)}-${i}`).join(' ');
  const encoded = await encodePayloadToQrFrames(
    {
      kind: 'text',
      title: 'Note',
      filename: 'note.txt',
      text: randomWords,
    },
    { density: 'fast', transferId: 'crc1' }
  );

  assert.ok(encoded.frames.length >= 2);
  let state = createCollectorState();

  const corrupted = `${encoded.frames[0].slice(0, -1)}${encoded.frames[0].endsWith('A') ? 'B' : 'A'}`;
  const badRes = await ingestQrPayload(state, corrupted);
  assert.equal(badRes.kind, 'invalid');
  state = badRes.state;
  assert.equal(state.errorCount, 1);

  // Valid frames still assemble properly after corrupted frame
  let done = null;
  for (const f of encoded.frames) {
    const r = await ingestQrPayload(state, f);
    if (r.kind === 'progress') state = r.state;
    if (r.kind === 'complete') {
      done = r.payload;
      break;
    }
  }
  assert.ok(done && done.kind === 'text');
  assert.equal(done.text, randomWords);
});

test('handles standard non-BSQ1 URLs cleanly and resets on new transferId', async () => {
  const initial = createCollectorState();
  const plainRes = await ingestQrPayload(initial, 'https://example.com/invoice/123');
  assert.equal(plainRes.kind, 'plain_text');
  if (plainRes.kind === 'plain_text') {
    assert.equal(plainRes.text, 'https://example.com/invoice/123');
  }

  const entropyA = Array.from({ length: 260 }, (_, i) => ((i * 104729 + 7) % 1009).toString(36)).join('-');
  const streamA = await encodePayloadToQrFrames(
    { kind: 'text', title: 'A', filename: 'a.txt', text: entropyA },
    { density: 'fast', transferId: 'aaaa' }
  );
  const streamB = await encodePayloadToQrFrames(
    { kind: 'text', title: 'B', filename: 'b.txt', text: 'Stream B payload' },
    { density: 'dense', transferId: 'bbbb' }
  );

  assert.ok(streamA.frames.length >= 2);
  const r1 = await ingestQrPayload(initial, streamA.frames[0]);
  assert.equal(r1.kind, 'progress');
  const nextState = r1.kind === 'progress' ? r1.state : initial;

  const r2 = await ingestQrPayload(nextState, streamB.frames[0]);
  assert.equal(r2.kind, 'complete');
  if (r2.kind === 'complete') {
    assert.equal(r2.payload.title, 'B');
  }

  // Also ensure bitscan_doc payload roundtrips cleanly
  const sampleB64 = uint8ToBase64Url(new Uint8Array([1, 2, 3, 4]));
  const docFrames = await encodePayloadToQrFrames({
    kind: 'bitscan_doc',
    title: 'Invoice 101',
    filename: 'invoice.bitscan',
    pages: [{ mime: 'image/webp', dataB64: sampleB64, ocrText: 'Total $42' }],
  });
  let docState = createCollectorState();
  let docOut = null;
  for (const f of docFrames.frames) {
    const r = await ingestQrPayload(docState, f);
    if (r.kind === 'progress') docState = r.state;
    if (r.kind === 'complete') docOut = r.payload;
  }
  assert.ok(docOut && docOut.kind === 'bitscan_doc');
  assert.equal(docOut.pages?.[0].ocrText, 'Total $42');
});

test('supports multi-hundred-KB binary payloads under 5 MB limit with bucketed progress and ETA metrics', async () => {
  assert.equal(MAX_QR_FILE_BYTES, 5 * 1024 * 1024);

  // Simulate 256 KB incompressible binary file across ~260 dense frames
  const big = new Uint8Array(256 * 1024);
  let seed = 0x12345678;
  for (let i = 0; i < big.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    big[i] = (seed >>> 24) & 0xff;
  }

  const encoded = await encodePayloadToQrFrames(
    {
      kind: 'raw_file',
      title: 'Archive',
      filename: 'archive.dat',
      mime: 'application/octet-stream',
      fileBytes: big,
    },
    { density: 'dense', transferId: 'big5' }
  );

  assert.ok(encoded.frames.length > 200);
  const eta = estimateQrTransferMetrics(encoded.totalBytes, encoded.frames.length, 12);
  assert.ok(eta.loopSeconds > 15);
  assert.ok(eta.throughputLabel.includes('KB/s'));

  let state = createCollectorState();
  let finalPayload = null;
  for (let i = 0; i < encoded.frames.length; i++) {
    const res = await ingestQrPayload(state, encoded.frames[i]);
    if (res.kind === 'progress') {
      state = res.state;
      if (i === Math.floor(encoded.frames.length / 2)) {
        const buckets = summarizeCollectorProgress(state, 40);
        assert.equal(buckets.length, 40);
        assert.ok(buckets.some((b) => b === 'done'));
        assert.ok(buckets.some((b) => b === 'empty'));
      }
    } else if (res.kind === 'complete') {
      finalPayload = res.payload;
    }
  }

  assert.ok(finalPayload && finalPayload.kind === 'raw_file');
  assert.equal(finalPayload.fileBytes?.byteLength, big.byteLength);
  assert.deepEqual(finalPayload.fileBytes, big);
});

test('handles standard plain text, URLs, and calculates accurate progress percentage', async () => {
  // Test plain URL detection
  const plainUrl = 'https://bitscanner.app/docs';
  const urlRes = await ingestQrPayload(createCollectorState(), plainUrl);
  assert.equal(urlRes.kind, 'plain_text');
  if (urlRes.kind === 'plain_text') {
    assert.equal(urlRes.text, plainUrl);
  }

  // Test multi-frame progress reporting percentage
  const randomContent = Array.from({ length: 80 }, (_, i) => `chunk-item-${i}-${((i * 997 + 13) % 1009).toString(36)}`).join(' ');
  const encoded = await encodePayloadToQrFrames(
    {
      kind: 'text',
      title: 'Progress Test Note',
      filename: 'note.txt',
      text: randomContent,
    },
    { density: 'fast', transferId: 'pct1' }
  );

  assert.ok(encoded.frames.length >= 2);
  let state = createCollectorState();
  const firstFrameRes = await ingestQrPayload(state, encoded.frames[0]);
  assert.equal(firstFrameRes.kind, 'progress');
  if (firstFrameRes.kind === 'progress') {
    assert.equal(firstFrameRes.receivedCount, 1);
    assert.equal(firstFrameRes.totalCount, encoded.frames.length);
    assert.equal(firstFrameRes.isNewChunk, true);
    const pct = Math.round((firstFrameRes.receivedCount / firstFrameRes.totalCount) * 100);
    assert.ok(pct > 0 && pct < 100);
  }
});

function opticalSimulateQrScan(qrText: string): string | null {
  const qr = QRCode.create(qrText, { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;
  const scale = 6;
  const border = 4;
  const fullSize = (size + border * 2) * scale;
  const rgba = new Uint8ClampedArray(fullSize * fullSize * 4);
  rgba.fill(255);

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (qr.modules.get(r, c)) {
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const y = (r + border) * scale + dy;
            const x = (c + border) * scale + dx;
            const idx = (y * fullSize + x) * 4;
            rgba[idx] = 0;
            rgba[idx + 1] = 0;
            rgba[idx + 2] = 0;
            rgba[idx + 3] = 255;
          }
        }
      }
    }
  }

  const result = jsQR(rgba, fullSize, fullSize);
  return result?.data ?? null;
}

test('optical simulation: beams a multi-chunk document via rendered QR codes, tracks live progress reports, and reconstructs original payload', async () => {
  const sampleLines = Array.from({ length: 45 }, (_, i) =>
    `Entry-${i + 1}: Item-${((i * 7919 + 17) % 997).toString(36).toUpperCase()} | Qty: ${(i % 7) + 1} | Price: $${((i * 31 + 45) % 250).toFixed(2)} | Hash: ${crypto.randomUUID()}`
  );
  const sampleDocText = `=== BITSCANNER SECURE TRANSFER ===\n${sampleLines.join('\n')}\n=== END OF DOCUMENT ===`;

  // 1. Encode into real BSQ1 QR beam frames
  const beam = await encodePayloadToQrFrames(
    {
      kind: 'text',
      title: 'Invoice 2026-9941',
      filename: 'invoice-9941.txt',
      text: sampleDocText,
    },
    { density: 'fast', transferId: 'beam99' }
  );

  assert.ok(beam.frames.length >= 3, `Expected at least 3 frames, got ${beam.frames.length}`);

  let collector = createCollectorState();
  const progressReports: Array<{ received: number; total: number; pct: number }> = [];
  let completedDoc: any = null;

  // 2. Simulate camera pointing at sender screen showing each QR frame in sequence
  for (let i = 0; i < beam.frames.length; i++) {
    const rawFrame = beam.frames[i];

    // Optical detection: Render QR code to pixels and scan with jsQR (simulates camera viewfinder feed)
    const scannedText = opticalSimulateQrScan(rawFrame);
    assert.ok(scannedText, `Camera optical detection failed on frame ${i}`);
    assert.equal(scannedText, rawFrame);

    // Ingest into stream collector
    const ingestRes = await ingestQrPayload(collector, scannedText);
    if (ingestRes.kind === 'progress') {
      collector = ingestRes.state;
      const pct = Math.round((ingestRes.receivedCount / ingestRes.totalCount) * 100);
      progressReports.push({
        received: ingestRes.receivedCount,
        total: ingestRes.totalCount,
        pct,
      });
    } else if (ingestRes.kind === 'complete') {
      collector = ingestRes.state;
      completedDoc = ingestRes.payload;
      progressReports.push({
        received: ingestRes.state.receivedCount,
        total: ingestRes.state.total,
        pct: 100,
      });
    } else {
      assert.fail(`Unexpected ingest state: ${ingestRes.kind}`);
    }
  }

  // 3. Verify real-time progress reports were produced at every step
  assert.equal(progressReports.length, beam.frames.length);
  assert.equal(progressReports[0].received, 1);
  assert.equal(progressReports[progressReports.length - 1].pct, 100);

  // 4. Verify reconstructed payload integrity
  assert.ok(completedDoc, 'Expected completed document payload');
  assert.equal(completedDoc.kind, 'text');
  assert.equal(completedDoc.title, 'Invoice 2026-9941');
  assert.equal(completedDoc.filename, 'invoice-9941.txt');
  assert.equal(completedDoc.text, sampleDocText);
});

test('optical simulation: renders and detects standard URL QR code without frame headers', async () => {
  const targetUrl = 'https://bitscanner.app/library?folder=documents&id=test123';
  const scanned = opticalSimulateQrScan(targetUrl);
  assert.ok(scanned);
  assert.equal(scanned, targetUrl);

  const ingestRes = await ingestQrPayload(createCollectorState(), scanned);
  assert.equal(ingestRes.kind, 'plain_text');
  if (ingestRes.kind === 'plain_text') {
    assert.equal(ingestRes.text, targetUrl);
  }
});
