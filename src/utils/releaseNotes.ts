export interface ReleaseSection {
  title: string;
  items: string[];
  tone?: 'new' | 'improvement' | 'fix';
}

export interface ReleaseEntry {
  version: string;
  date: string;
  title: string;
  summary: string;
  sections: ReleaseSection[];
  comments: string[];
}

export const RELEASES: ReleaseEntry[] = [
  {
    version: '0.1.0',
    date: 'Nov 17, 2026',
    title: 'Offline Camera Scanner, Studio Editor, OCR & Optical QR Beam',
    summary:
      'v0.1.0 is headlined by real-time edge detection camera scanning, client-side studio document editing, browser-based OCR with table extraction, and an optical QR Beam protocol for zero-network, screen-to-camera file transfer. Capture receipts, multi-page contracts, ID cards, and books directly in your browser, apply smart filters and annotations, and export to searchable PDF, Word, or images without a single byte leaving your machine.',
    sections: [
      {
        title: 'Live Camera Scanner',
        tone: 'new',
        items: [
          'Real-time quadrilateral corner detection and perspective correction.',
          'Auto-shutter trigger on stable document detection with manual capture fallback.',
          'Multi-page batch capture, two-sided ID card mode, and book dual-page split.',
          'Torch/flashlight support, camera device selection, and resolution controls.',
        ],
      },
      {
        title: 'Studio Document Editor',
        tone: 'new',
        items: [
          'Smart image enhancement filters: B&W Document, Grayscale, Magic Color, and High Contrast.',
          'Full markup and annotation suite: freehand pen, highlighter, redaction boxes, vector shapes, and arrows.',
          'Digital signature pad with pen smoothing, saved signatures, and transparency blending.',
          'Drag-and-drop page reordering, 90-degree rotations, page duplication, and deletion.',
        ],
      },
      {
        title: 'Client-Side OCR & Extraction',
        tone: 'new',
        items: [
          'In-browser Optical Character Recognition powered by client-side WebAssembly.',
          'Structural layout analysis with automated table and paragraph detection.',
          'Searchable PDF generation with selectable text layers.',
          'Instant export to plain text, Markdown, and Word (.docx).',
        ],
      },
      {
        title: 'Optical QR File Beam',
        tone: 'new',
        items: [
          'Zero-network, offline screen-to-camera file transfer protocol.',
          'Animated high-density QR code streaming with adjustable frame rates (5 to 15 FPS).',
          'Optical chunk density controls and payload size optimization (up to 5 MB per payload).',
          'Built-in camera receiver with live chunk assembly progress and file reconstruction.',
        ],
      },
      {
        title: 'PDF & Image Studio Tools',
        tone: 'new',
        items: [
          'Multi-image to PDF converter with paper size presets (A4, Letter, Legal) and compression quality.',
          'PDF to image extractor, PDF merger, and document splitter.',
          'Biometric Passport Photo Maker with country-specific passport/visa presets and DPI controls.',
          'Native OS share sheet integration (AirDrop, Nearby Share, WhatsApp, Email).',
        ],
      },
      {
        title: 'Privacy, PWA & Polish',
        tone: 'improvement',
        items: [
          '100% offline-first architecture with persistent local storage via IndexedDB.',
          'Zero server telemetry, zero analytics tracking, and zero remote data uploads.',
          'Workspace backup, JSON snapshot export, and instant data wipe controls.',
          'Responsive dark and light theme system with adaptive accent contrast and clean 3-dot project menus.',
        ],
      },
    ],
    comments: [
      'Initial public release establishing the zero-telemetry, on-device document scanner and offline optical QR transfer protocol.',
    ],
  },
  {
    version: '0.0.1',
    date: 'Oct 12, 2026',
    title: 'Initial Scanner Prototype & Architecture Foundation',
    summary:
      'v0.0.1 is the initial prototype foundation. It established the core client-side camera capture pipeline, local storage in IndexedDB, and baseline PDF generation.',
    sections: [
      {
        title: 'Highlights',
        tone: 'new',
        items: [
          'Initial prototype of the offline document scanner and PDF workspace.',
          'Camera capture with live document edge detection and perspective correction.',
          'Local OCR, searchable PDF export, image export, and Word document export.',
          'Project library, ID card studio, passport photo sheets, and local-only storage.',
        ],
      },
      {
        title: 'Improvements',
        tone: 'improvement',
        items: [
          'Projects and reusable signatures are stored in IndexedDB on this device.',
          'Scans, OCR, signatures, and exports stay inside the browser.',
          'Responsive layout for phone, tablet, and desktop.',
        ],
      },
      {
        title: 'Fixes',
        tone: 'fix',
        items: [
          'Stabilized document geometry for captures taken at an angle.',
          'Improved filter previews and page thumbnails.',
          'Fixed export filenames and multi-page PDF ordering.',
        ],
      },
    ],
    comments: ['Prototype release focusing on the core scanning workflow, local privacy, and reliable exports.'],
  },
];

export const RELEASE_REPOSITORY_URL = 'https://github.com/Shubhamnpk/bitscanner';
export const RELEASE_TAG_URL = `${RELEASE_REPOSITORY_URL}/releases/tag`;