export type ToolId =
  | 'images_to_pdf'
  | 'pdf_to_images'
  | 'pp_size'
  | 'id_card'
  | 'merge_pdf'
  | 'ocr_extract'
  | 'sign_doc'
  | 'images_to_video'
  | 'qr_share'
  | 'qr_scan';

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
    accentClass: 'bg-teal-500/10 text-teal-400 border-transparent',
  },
  {
    id: 'pdf_to_images',
    title: 'PDF to Images',
    shortLabel: 'PDF to Img',
    description: 'Extract every page of any PDF file into crisp PNG or JPEG images.',
    category: 'pdf',
    accentClass: 'bg-sky-500/10 text-sky-400 border-transparent',
  },
  {
    id: 'pp_size',
    title: 'Passport Photo',
    shortLabel: 'PP Size',
    description: 'Create standard 35x45mm or 2x2in portrait photos & cut-ready sheets.',
    category: 'photo',
    accentClass: 'bg-indigo-500/10 text-indigo-400 border-transparent',
  },
  {
    id: 'id_card',
    title: 'ID Card Maker',
    shortLabel: 'ID Card',
    description: 'Align Front & Back card photos onto an ISO A4 printable sheet.',
    category: 'photo',
    accentClass: 'bg-emerald-500/10 text-emerald-400 border-transparent',
  },
  {
    id: 'merge_pdf',
    title: 'Merge PDFs',
    shortLabel: 'Merge PDF',
    description: 'Combine multiple PDF documents cleanly into one unified file.',
    category: 'pdf',
    accentClass: 'bg-amber-500/10 text-amber-400 border-transparent',
  },
  {
    id: 'ocr_extract',
    title: 'Extract Text (OCR)',
    shortLabel: 'OCR Text',
    description: 'Recognize, search, and copy printed text from any photo or scan.',
    category: 'smart',
    accentClass: 'bg-cyan-500/10 text-cyan-400 border-transparent',
  },
  {
    id: 'sign_doc',
    title: 'Signature Studio',
    shortLabel: 'Sign Doc',
    description: 'Draw or type reusable signatures with custom paper backgrounds.',
    category: 'smart',
    accentClass: 'bg-violet-500/10 text-violet-400 border-transparent',
  },
  {
    id: 'images_to_video',
    title: 'Scan Slideshow Video',
    shortLabel: 'Make Video',
    description: 'Turn multi-page scans or photos into a smooth playable video clip.',
    category: 'smart',
    accentClass: 'bg-rose-500/10 text-rose-400 border-transparent',
  },
  {
    id: 'qr_share',
    title: 'QR File Share',
    shortLabel: 'QR Share',
    description: 'Beam documents or any file offline using animated multi-frame QR codes.',
    category: 'smart',
    accentClass: 'bg-teal-500/10 text-teal-400 border-transparent',
  },
  {
    id: 'qr_scan',
    title: 'QR Continuous Scanner',
    shortLabel: 'QR Scan',
    description: 'Receive files & scans offline using our camera’s continuous QR reader.',
    category: 'smart',
    accentClass: 'bg-emerald-500/10 text-emerald-400 border-transparent',
  },
];
