import type { FilterPreset } from '../types/scanner';

export interface FilterPresetMeta {
  id: FilterPreset;
  /** Label used in the editor's filter rail. */
  label: string;
  /** One-line explanation shown under the label. */
  desc: string;
}

/**
 * Every document filter in one place. The editor renders this list, and the
 * settings screen derives its options from it, so a new preset only needs to
 * be added here plus `imageProcessor.ts`.
 */
export const FILTER_PRESETS: readonly FilterPresetMeta[] = [
  { id: 'original', label: 'Original', desc: 'Natural unadjusted photo' },
  { id: 'magic_color', label: 'Magic Color', desc: 'White paper + vivid ink' },
  { id: 'magic_hd', label: 'Magic HD', desc: 'Flattens glare & colour cast' },
  { id: 'lighten', label: 'Lighten', desc: 'Soft exposure boost' },
  { id: 'grayscale', label: 'Grayscale', desc: 'Clean neutral monochrome' },
  { id: 'bw', label: 'B&W', desc: 'Adaptive photocopy' },
  { id: 'bw_sharp', label: 'B&W Sharp', desc: 'Crisp high-contrast text' },
  { id: 'shadow_remove', label: 'No Shadow', desc: 'Even illumination lift' },
];

/** Settings screen wording, ordered by how often it is picked. */
export const FILTER_SETTINGS_OPTIONS: ReadonlyArray<{
  value: FilterPreset;
  label: string;
  hint?: string;
}> = [
  { value: 'magic_color', label: 'Magic Color', hint: 'Recommended · clean paper, rich ink' },
  { value: 'magic_hd', label: 'Magic Color HD', hint: 'Beta · flattens uneven light' },
  { value: 'original', label: 'Original Unadjusted' },
  { value: 'lighten', label: 'Lighten Lift' },
  { value: 'bw_sharp', label: 'B&W Crisp Text' },
  { value: 'grayscale', label: 'Grayscale' },
  { value: 'shadow_remove', label: 'Shadow Removal' },
];
