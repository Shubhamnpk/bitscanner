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
    version: '0.0.1',
    date: 'Oct 12',
    title: 'Sectors, global stocks, yields and compare tools',
    summary:
      'v0.0.1 is the first public release. It sets the foundation for the scanner workspace and documents the release history for future versions.',
    sections: [
      {
        title: 'Highlights',
        tone: 'new',
        items: [
          'Initial public release of the offline document scanner and PDF workspace.',
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
    comments: ['The first public release focuses on the core scanning workflow, local privacy, and reliable exports.'],
  },
];

export const RELEASE_REPOSITORY_URL = 'https://github.com/Shubhamnpk/bitscanner';
export const RELEASE_TAG_URL = `${RELEASE_REPOSITORY_URL}/releases/tag`;