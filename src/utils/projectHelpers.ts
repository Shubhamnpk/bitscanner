import type { ScannedPage } from '../types/scanner';

/** Move a page from `fromIndex` to `toIndex`, returning a new array without mutating input. */
export function reorderPageInList(
  pages: ScannedPage[],
  fromIndex: number,
  toIndex: number
): ScannedPage[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= pages.length ||
    toIndex >= pages.length ||
    fromIndex === toIndex
  ) {
    return pages;
  }
  const next = [...pages];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

/** Toggle a single page ID inside a selection array. */
export function togglePageSelection(selectedIds: string[], pageId: string): string[] {
  if (selectedIds.includes(pageId)) {
    return selectedIds.filter((id) => id !== pageId);
  }
  return [...selectedIds, pageId];
}

/** Resolve ordered 0-based page indices from selected page IDs (falls back to all indices if empty). */
export function getSelectedPageIndices(pages: ScannedPage[], selectedIds: string[]): number[] {
  if (selectedIds.length === 0) {
    return pages.map((_, idx) => idx);
  }
  const set = new Set(selectedIds);
  const indices: number[] = [];
  pages.forEach((p, idx) => {
    if (set.has(p.id)) indices.push(idx);
  });
  return indices.length > 0 ? indices : pages.map((_, idx) => idx);
}

/**
 * Remove selected page IDs from a project, always retaining at least one page
 * unless `allowEmpty` is explicitly true.
 */
export function removeSelectedPages(
  pages: ScannedPage[],
  selectedIds: string[],
  allowEmpty = false
): ScannedPage[] {
  const removeSet = new Set(selectedIds);
  const remaining = pages.filter((p) => !removeSet.has(p.id));
  if (!allowEmpty && remaining.length === 0) {
    return pages;
  }
  return remaining;
}
