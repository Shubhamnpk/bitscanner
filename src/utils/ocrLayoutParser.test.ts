import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseOcrBlocksFromGeometry,
  parseOcrDocumentLayout,
  type OcrLineBox,
} from './ocrLayoutParser.ts';

describe('parseOcrDocumentLayout', () => {
  it('reconstructs heading, key-value metadata, and aligned invoice table from seeded invoice OCR text', () => {
    const invoiceText = [
      'BUSINESS INVOICE',
      'Invoice #: INV-2023-0815',
      'FROM: Apex Solutions Inc.',
      'TO: Johnson & Partners LLC',
      'Professional Consulting Services - 40 hrs - $6,000.00',
      'Web Development - 1 Project - $2,500.00',
      'Support & Maintenance - 3 mths - $750.00',
      'Total Amount Due: $9,990.00',
    ].join('\n');

    const blocks = parseOcrDocumentLayout(invoiceText);
    assert.equal(blocks[0].kind, 'heading');
    assert.equal(blocks[0].text, 'BUSINESS INVOICE');

    assert.equal(blocks[1].kind, 'key_value');
    if (blocks[1].kind === 'key_value') {
      assert.equal(blocks[1].pairs.length, 3);
      assert.equal(blocks[1].pairs[0].key, 'Invoice #');
      assert.equal(blocks[1].pairs[0].value, 'INV-2023-0815');
    }

    assert.equal(blocks[2].kind, 'table');
    if (blocks[2].kind === 'table') {
      assert.deepEqual(blocks[2].headers, ['Description', 'Qty / Unit', 'Amount']);
      assert.equal(blocks[2].rows.length, 3);
      assert.deepEqual(blocks[2].rows[0], [
        'Professional Consulting Services',
        '40 hrs',
        '$6,000.00',
      ]);
      assert.deepEqual(blocks[2].alignments, ['left', 'right', 'right']);
    }

    assert.equal(blocks[3].kind, 'key_value');
    if (blocks[3].kind === 'key_value') {
      assert.equal(blocks[3].pairs[0].key, 'Total Amount Due');
      assert.equal(blocks[3].pairs[0].value, '$9,990.00');
    }
  });

  it('parses pipe-delimited markdown tables with explicit headers', () => {
    const md = [
      '| Item | Qty | Price |',
      '| --- | --- | --- |',
      '| Paper A4 Ream | 5 | $25.00 |',
      '| Toner Cartridge | 2 | $120.00 |',
    ].join('\n');

    const blocks = parseOcrDocumentLayout(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].kind, 'table');
    if (blocks[0].kind === 'table') {
      assert.deepEqual(blocks[0].headers, ['Item', 'Qty', 'Price']);
      assert.equal(blocks[0].rows.length, 2);
      assert.deepEqual(blocks[0].alignments, ['left', 'right', 'right']);
    }
  });

  it('parses bullet lists and regular prose paragraphs accurately', () => {
    const doc = [
      'Meeting Summary',
      'We reviewed Q4 procurement goals with vendors.',
      '- Finalize pricing schedule',
      '- Sign MSA before Friday',
    ].join('\n');

    const blocks = parseOcrDocumentLayout(doc);
    assert.equal(blocks[0].kind, 'heading');
    assert.equal(blocks[1].kind, 'paragraph');
    assert.equal(blocks[2].kind, 'list');
    if (blocks[2].kind === 'list') {
      assert.deepEqual(blocks[2].items, [
        'Finalize pricing schedule',
        'Sign MSA before Friday',
      ]);
    }
  });
});

describe('parseOcrBlocksFromGeometry', () => {
  it('clusters wide horizontal gaps between word boxes into aligned table columns', () => {
    const lines: OcrLineBox[] = [
      {
        text: 'Service Qty Total',
        words: [
          { text: 'Service', bbox: { x0: 20, y0: 100, x1: 90, y1: 120 } },
          { text: 'Qty', bbox: { x0: 320, y0: 100, x1: 355, y1: 120 } },
          { text: 'Total', bbox: { x0: 480, y0: 100, x1: 530, y1: 120 } },
        ],
      },
      {
        text: 'Cloud Hosting 12 $1,200.00',
        words: [
          { text: 'Cloud', bbox: { x0: 20, y0: 140, x1: 72, y1: 160 } },
          { text: 'Hosting', bbox: { x0: 80, y0: 140, x1: 145, y1: 160 } },
          { text: '12', bbox: { x0: 322, y0: 140, x1: 344, y1: 160 } },
          { text: '$1,200.00', bbox: { x0: 472, y0: 140, x1: 550, y1: 160 } },
        ],
      },
    ];

    const blocks = parseOcrBlocksFromGeometry(lines, '');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].kind, 'table');
    if (blocks[0].kind === 'table') {
      assert.deepEqual(blocks[0].headers, ['Service', 'Qty', 'Total']);
      assert.deepEqual(blocks[0].rows, [['Cloud Hosting', '12', '$1,200.00']]);
      assert.deepEqual(blocks[0].alignments, ['left', 'right', 'right']);
    }
  });
});
