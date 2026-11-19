export type OcrStructuredBlock =
  | {
      kind: 'heading';
      text: string;
      align?: 'left' | 'center';
    }
  | {
      kind: 'key_value';
      pairs: Array<{ key: string; value: string }>;
    }
  | {
      kind: 'table';
      headers?: string[];
      rows: string[][];
      alignments?: Array<'left' | 'right'>;
    }
  | {
      kind: 'list';
      items: string[];
    }
  | {
      kind: 'paragraph';
      text: string;
    };

export interface OcrWordBox {
  text: string;
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
}

export interface OcrLineBox {
  text: string;
  bbox?: {
    x0: number;
    y0: number;
    y1: number;
    x1: number;
  };
  words: OcrWordBox[];
}

const CURRENCY_OR_NUM_RE = /^([$€£¥₹]?\s*-?\d[\d,.]*(?:\s*%|\s*(?:hrs?|mths?|mos?|yrs?|pcs?|qty|units?))?)$/i;

function isNumericCell(val: string): boolean {
  const trimmed = val.trim();
  if (!trimmed) return false;
  return (
    CURRENCY_OR_NUM_RE.test(trimmed) ||
    /^[$€£¥₹]\s*\d/.test(trimmed) ||
    /^\d+(?:\.\d+)?$/.test(trimmed)
  );
}

function inferTableAlignments(rows: string[][], colCount: number): Array<'left' | 'right'> {
  return Array.from({ length: colCount }, (_, colIdx) => {
    const cells = rows.map((r) => r[colIdx] || '').filter((c) => c.trim().length > 0);
    if (cells.length === 0) return 'left';
    const numericCount = cells.filter(isNumericCell).length;
    return numericCount / cells.length >= 0.55 ? 'right' : 'left';
  });
}

function maybeInferTableHeaders(
  firstRow: string[],
  dataRows: string[][],
  colCount: number
): { headers?: string[]; rows: string[][] } {
  const firstIsHeader =
    dataRows.length >= 1 &&
    firstRow.every((c) => !isNumericCell(c) && !/[$€£¥₹]\d/.test(c)) &&
    firstRow.some((c) =>
      /^(item|description|service|product|qty|quantity|hours?|hrs?|rate|unit|price|amount|total|date|name|tax|category)$/i.test(
        c.trim()
      )
    );

  if (firstIsHeader) {
    return { headers: firstRow, rows: dataRows };
  }

  const allRows = [firstRow, ...dataRows];
  const lastColMoney =
    allRows.filter((r) => /[$€£¥₹]\s*\d/.test(r[colCount - 1] || '')).length >=
    Math.ceil(allRows.length / 2);

  if (colCount === 3 && lastColMoney) {
    return {
      headers: ['Description', 'Qty / Unit', 'Amount'],
      rows: allRows,
    };
  }
  if (colCount === 2 && lastColMoney) {
    return {
      headers: ['Item', 'Amount'],
      rows: allRows,
    };
  }
  if (colCount === 4 && lastColMoney) {
    return {
      headers: ['Description', 'Qty', 'Rate', 'Amount'],
      rows: allRows,
    };
  }

  return { rows: allRows };
}

function splitDelimitedColumns(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // 1. Explicit pipe-delimited table row
  if (trimmed.includes('|')) {
    const parts = trimmed
      .replace(/^\|+|\|+$/g, '')
      .split('|')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.length >= 2) return parts;
  }

  // 2. Tab-delimited
  if (trimmed.includes('\t')) {
    const parts = trimmed
      .split(/\t+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.length >= 2) return parts;
  }

  // 3. Multi-space visual columns (3+ spaces separating chunks)
  if (/\s{3,}/.test(trimmed)) {
    const parts = trimmed
      .split(/\s{3,}/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.length >= 2) return parts;
  }

  // 4. Structured dash/en-dash separated item lines ("Service - 40 hrs - $6,000.00")
  const dashParts = trimmed.split(/\s+[-–\u2014]\s+/).map((s) => s.trim());
  if (
    dashParts.length >= 3 ||
    (dashParts.length === 2 && /[$€£¥₹]\s*\d/.test(dashParts[1]))
  ) {
    return dashParts;
  }

  return null;
}

function parseKeyValueLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  // Exclude URLs & times (http://, 12:30)
  const match = /^([A-Za-z][A-Za-z0-9 &/#().-]{1,34}):\s+(.+)$/.exec(trimmed);
  if (!match) return null;
  const key = match[1].trim();
  const value = match[2].trim();
  if (!key || !value) return null;
  // Don't treat a full sentence ending in punctuation with long clause as a metadata key unless short
  if (key.split(/\s+/).length > 5) return null;
  return { key, value };
}

function isHeadingLine(line: string, index: number): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 68) return false;
  if (parseKeyValueLine(trimmed)) return false;
  if (splitDelimitedColumns(trimmed)) return false;
  const letters = trimmed.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return false;
  const uppercaseRatio =
    letters.replace(/[^A-Z]/g, '').length / Math.max(1, letters.length);
  if (uppercaseRatio >= 0.82) return true;
  // First line short title without sentence punctuation
  if (index === 0 && trimmed.split(/\s+/).length <= 6 && !/[.!?]$/.test(trimmed)) {
    return true;
  }
  return false;
}

function isListLine(line: string): string | null {
  const trimmed = line.trim();
  const m = /^(?:[-*•▪◦]|\d{1,2}[.)])\s+(.+)$/.exec(trimmed);
  return m ? m[1].trim() : null;
}

/**
 * Reconstructs clean document layout blocks (headings, key-value metadata grids, aligned tables,
 * lists, and paragraphs) from OCR plain text when geometric boxes are unavailable or edited.
 */
export function parseOcrDocumentLayout(
  plainText: string,
  existingBlocks?: OcrStructuredBlock[]
): OcrStructuredBlock[] {
  if (existingBlocks && existingBlocks.length > 0) {
    return existingBlocks;
  }

  const rawLines = (plainText || '').split(/\r?\n/);
  const lines = rawLines.map((l) => l.trimEnd());
  const blocks: OcrStructuredBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i++;
      continue;
    }

    // Ignore Markdown table separator rows like | --- | --- |
    if (/^\|?[\s:-]+(?:\|[\s:-]+)+\|?$/.test(line)) {
      i++;
      continue;
    }

    // 1. Check multi-row table sequence
    const cols = splitDelimitedColumns(line);
    if (cols) {
      const tableRows: string[][] = [cols];
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j].trim();
        if (!nextLine) break;
        if (/^\|?[\s:-]+(?:\|[\s:-]+)+\|?$/.test(nextLine)) {
          j++;
          continue;
        }
        const nextCols = splitDelimitedColumns(nextLine);
        if (!nextCols) break;
        tableRows.push(nextCols);
        j++;
      }

      if (tableRows.length >= 2 || cols.length >= 3) {
        const maxCols = Math.max(...tableRows.map((r) => r.length));
        const padded = tableRows.map((r) =>
          Array.from({ length: maxCols }, (_, k) => r[k] ?? '')
        );
        const { headers, rows } = maybeInferTableHeaders(
          padded[0],
          padded.slice(1),
          maxCols
        );
        blocks.push({
          kind: 'table',
          headers,
          rows,
          alignments: inferTableAlignments(rows, maxCols),
        });
        i = j;
        continue;
      }
    }

    // 2. Check Heading
    if (isHeadingLine(line, i)) {
      blocks.push({
        kind: 'heading',
        text: line,
        align: line === line.toUpperCase() ? 'center' : 'left',
      });
      i++;
      continue;
    }

    // 3. Check Key-Value metadata group
    const kv = parseKeyValueLine(line);
    if (kv) {
      const pairs: Array<{ key: string; value: string }> = [kv];
      let j = i + 1;
      while (j < lines.length) {
        const nextTrimmed = lines[j].trim();
        if (!nextTrimmed) break;
        if (splitDelimitedColumns(nextTrimmed)) break;
        const nextKv = parseKeyValueLine(nextTrimmed);
        if (!nextKv) break;
        pairs.push(nextKv);
        j++;
      }
      blocks.push({ kind: 'key_value', pairs });
      i = j;
      continue;
    }

    // 4. Check Bullet/Numbered List
    const listItem = isListLine(line);
    if (listItem) {
      const items: string[] = [listItem];
      let j = i + 1;
      while (j < lines.length) {
        const nextTrimmed = lines[j].trim();
        if (!nextTrimmed) break;
        const nextItem = isListLine(nextTrimmed);
        if (!nextItem) break;
        items.push(nextItem);
        j++;
      }
      blocks.push({ kind: 'list', items });
      i = j;
      continue;
    }

    // 5. Paragraph block (accumulate plain prose lines until a structural break)
    const paraLines: string[] = [line];
    let j = i + 1;
    while (j < lines.length) {
      const nextTrimmed = lines[j].trim();
      if (
        !nextTrimmed ||
        splitDelimitedColumns(nextTrimmed) ||
        parseKeyValueLine(nextTrimmed) ||
        isListLine(nextTrimmed) ||
        isHeadingLine(nextTrimmed, j)
      ) {
        break;
      }
      paraLines.push(nextTrimmed);
      j++;
    }
    blocks.push({ kind: 'paragraph', text: paraLines.join(' ') });
    i = j;
  }

  return blocks;
}

interface SegmentChunk {
  text: string;
  x0: number;
  x1: number;
}

function splitLineIntoVisualColumns(line: OcrLineBox): SegmentChunk[] {
  const words = (line.words || [])
    .filter((w) => w.text.trim().length > 0)
    .slice()
    .sort((a, b) => a.bbox.x0 - b.bbox.x0);

  if (words.length === 0) {
    return line.text.trim() ? [{ text: line.text.trim(), x0: 0, x1: 100 }] : [];
  }

  // Average character height gives scale-invariant gutter threshold
  const avgHeight =
    words.reduce((acc, w) => acc + Math.max(8, w.bbox.y1 - w.bbox.y0), 0) / words.length;
  const colGapThreshold = Math.max(18, avgHeight * 1.45);

  const chunks: SegmentChunk[] = [];
  let curText = words[0].text.trim();
  let curX0 = words[0].bbox.x0;
  let curX1 = words[0].bbox.x1;

  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    const gap = w.bbox.x0 - curX1;
    if (gap >= colGapThreshold) {
      chunks.push({ text: curText, x0: curX0, x1: curX1 });
      curText = w.text.trim();
      curX0 = w.bbox.x0;
      curX1 = w.bbox.x1;
    } else {
      curText = `${curText} ${w.text.trim()}`;
      curX1 = Math.max(curX1, w.bbox.x1);
    }
  }
  chunks.push({ text: curText, x0: curX0, x1: curX1 });
  return chunks;
}

/**
 * Uses word bounding-box geometry returned by Tesseract OCR to detect multi-column tables,
 * key-value metadata rows, headings, and paragraphs with near-exact visual structure.
 */
export function parseOcrBlocksFromGeometry(
  rawLines: OcrLineBox[],
  fallbackText: string
): OcrStructuredBlock[] {
  const validLines = rawLines.filter((l) => l.text.trim().length > 0);
  if (validLines.length === 0) {
    return parseOcrDocumentLayout(fallbackText);
  }

  const lineChunks = validLines.map((line, idx) => ({
    idx,
    rawText: line.text.trim(),
    chunks: splitLineIntoVisualColumns(line),
  }));

  const blocks: OcrStructuredBlock[] = [];
  let i = 0;

  while (i < lineChunks.length) {
    const entry = lineChunks[i];

    // Multi-column table sequence from spatial gutters (2+ visual columns across consecutive rows)
    if (entry.chunks.length >= 2) {
      const group = [entry];
      let j = i + 1;
      while (j < lineChunks.length && lineChunks[j].chunks.length >= 2) {
        group.push(lineChunks[j]);
        j++;
      }

      if (group.length >= 2) {
        // Cluster X-start positions across all rows in group to align sparse columns accurately
        const allStarts = group
          .flatMap((g) => g.chunks.map((c) => c.x0))
          .sort((a, b) => a - b);
        const colAnchors: number[] = [];
        for (const x of allStarts) {
          if (
            colAnchors.length === 0 ||
            Math.abs(x - colAnchors[colAnchors.length - 1]) > 55
          ) {
            colAnchors.push(x);
          }
        }

        const colCount = Math.max(
          colAnchors.length,
          ...group.map((g) => g.chunks.length)
        );
        const rows = group.map((g) => {
          if (g.chunks.length === colCount) {
            return g.chunks.map((c) => c.text);
          }
          const row = Array.from({ length: colCount }, () => '');
          g.chunks.forEach((c) => {
            let bestCol = 0;
            let bestDist = Infinity;
            colAnchors.forEach((ax, colIdx) => {
              const d = Math.abs(c.x0 - ax);
              if (d < bestDist && colIdx < colCount) {
                bestDist = d;
                bestCol = colIdx;
              }
            });
            row[bestCol] = row[bestCol] ? `${row[bestCol]} ${c.text}` : c.text;
          });
          return row;
        });

        const { headers, rows: bodyRows } = maybeInferTableHeaders(
          rows[0],
          rows.slice(1),
          colCount
        );
        blocks.push({
          kind: 'table',
          headers,
          rows: bodyRows,
          alignments: inferTableAlignments(bodyRows, colCount),
        });
        i = j;
        continue;
      }
    }

    // Delegate non-table run to the text structure parser cleanly
    const singleLines: string[] = [];
    let j = i;
    while (j < lineChunks.length) {
      if (
        lineChunks[j].chunks.length >= 2 &&
        j + 1 < lineChunks.length &&
        lineChunks[j + 1].chunks.length >= 2
      ) {
        break;
      }
      // Preserve visual multi-space columns on isolated split rows
      const joined =
        lineChunks[j].chunks.length >= 2
          ? lineChunks[j].chunks.map((c) => c.text).join('   ')
          : lineChunks[j].rawText;
      singleLines.push(joined);
      j++;
    }

    const subBlocks = parseOcrDocumentLayout(singleLines.join('\n'));
    blocks.push(...subBlocks);
    i = j;
  }

  return blocks.length > 0 ? blocks : parseOcrDocumentLayout(fallbackText);
}
