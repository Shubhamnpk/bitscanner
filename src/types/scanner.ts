import type { OcrStructuredBlock } from '../utils/ocrLayoutParser';

export interface Point2D {
  x: number;
  y: number;
}

/** Normalized [0..1] quad corners ordered [topLeft, topRight, bottomRight, bottomLeft] */
export type QuadCorners = [Point2D, Point2D, Point2D, Point2D];

export type FilterPreset =
  | 'original'
  | 'magic_color'
  | 'lighten'
  | 'grayscale'
  | 'bw'
  | 'bw_sharp'
  | 'shadow_remove';

export interface ImageAdjustments {
  brightness: number; // -100 to 100
  contrast: number; // -100 to 100
  saturation: number; // -100 to 100
  sharpness: number; // 0 to 100
  shadowRemoval: number; // 0 to 100
}

export type AnnotationType = 'signature' | 'redaction' | 'text' | 'stroke' | 'shape';
export type ShapeKind = 'rect' | 'circle' | 'arrow' | 'line' | 'check';

export interface AnnotationItem {
  id: string;
  type: AnnotationType;
  /** Normalized coordinates [0..1] relative to processed page dimensions */
  x: number;
  y: number;
  width: number;
  height: number;
  /** For signature: dataURL image */
  imageDataUrl?: string;
  /** For text: string content */
  text?: string;
  color?: string;
  fontSize?: number; // normalized fraction of page height (e.g. 0.025)
  /** For geometric shape annotations */
  shapeKind?: ShapeKind;
  fillColor?: string;
  /** For freehand stroke / highlighter */
  points?: Point2D[];
  strokeWidth?: number; // normalized fraction of page width
  opacity?: number;
}

export interface WatermarkConfig {
  enabled: boolean;
  text: string;
  opacity: number; // 0.05 to 0.7
  angle: number; // -60 to 60 degrees
  tiled: boolean;
  color: string;
}

export interface ScannedPage {
  id: string;
  /** Original uncropped photo dataURL (for re-cropping at any time) */
  originalDataUrl: string;
  /** Dewarped, cropped base image before filters */
  croppedDataUrl: string;
  /** Final enhanced thumbnail/preview dataURL */
  processedDataUrl: string;
  quad: QuadCorners;
  filter: FilterPreset;
  adjustments: ImageAdjustments;
  rotation: 0 | 90 | 180 | 270;
  flipH: boolean;
  annotations: AnnotationItem[];
  watermark: WatermarkConfig;
  /** Optional backdrop color/finish ('none' | 'transparent' | '#ffffff' | '#fef9ec' | hex) */
  backgroundColor?: string;
  /** Composited thumbnail dataURL showing filters, background, annotations, and watermark */
  thumbnailDataUrl?: string;
  ocrText: string;
  ocrConfidence?: number;
  ocrBlocks?: OcrStructuredBlock[];
  width: number;
  height: number;
  createdAt: number;
}

export type FolderId =
  | 'all'
  | 'documents'
  | 'id_cards'
  | 'receipts'
  | 'notes'
  | 'signatures'
  | 'starred';

export interface ScanDocument {
  id: string;
  title: string;
  folder: Exclude<FolderId, 'all' | 'starred'>;
  starred: boolean;
  pages: ScannedPage[];
  createdAt: number;
  updatedAt: number;
}

export interface SavedSignature {
  id: string;
  label: string;
  dataUrl: string;
  backgroundColor?: string;
  createdAt: number;
}

export type PdfPaperSize = 'a4' | 'letter' | 'fit';
export type PdfOrientation = 'auto' | 'portrait' | 'landscape';
export type PdfMargin = 'none' | 'narrow' | 'standard';
export type PdfQuality = 'high' | 'balanced' | 'compact';
export type ExportFormat = 'pdf' | 'image' | 'word';

export interface ExportOptions {
  format?: ExportFormat;
  paperSize: PdfPaperSize;
  orientation: PdfOrientation;
  margin: PdfMargin;
  quality: PdfQuality;
  includePageNumbers: boolean;
  searchablePdf?: boolean;
  imageFormat?: 'png' | 'jpeg';
  imageLayout?: 'individual' | 'stitched';
  wordIncludeImages?: boolean;
  wordIncludeOcrText?: boolean;
  selectedPageIndices?: number[];
  filename: string;
}

export type ActiveWorkspaceView =
  | 'library'
  | 'project'
  | 'editor'
  | 'id_studio'
  | 'tools'
  | 'profile'
  | 'settings'
  | 'about'
  | 'release_notes'
  | 'privacy'
  | 'help';

export const DEFAULT_ADJUSTMENTS: ImageAdjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  sharpness: 15,
  shadowRemoval: 0,
};

export const DEFAULT_WATERMARK: WatermarkConfig = {
  enabled: false,
  text: 'CONFIDENTIAL',
  opacity: 0.22,
  angle: -32,
  tiled: true,
  color: '#0f172a',
};
