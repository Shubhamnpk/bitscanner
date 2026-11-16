import { useCallback } from 'react';
import { loadAppSettings } from '../utils/settingsStore';

export type HapticPatternName = 'tap' | 'shutter' | 'success' | 'warning';

export const HAPTIC_PATTERNS: Record<HapticPatternName, number | number[]> = {
  tap: 10,
  shutter: [18, 24, 12],
  success: [15, 40, 30],
  warning: [24, 30, 24],
};

/**
 * Safely triggers device vibration via `window.navigator.vibrate` when supported.
 * Returns `true` if a vibration pattern was dispatched, `false` otherwise.
 */
export function triggerHapticPattern(
  pattern: HapticPatternName | number | number[],
  nav: Pick<Navigator, 'vibrate'> | undefined =
    typeof window !== 'undefined' ? window.navigator : undefined
): boolean {
  if (!nav || typeof nav.vibrate !== 'function') {
    return false;
  }
  const resolved = typeof pattern === 'string' ? HAPTIC_PATTERNS[pattern] : pattern;
  try {
    return Boolean(nav.vibrate(resolved));
  } catch {
    return false;
  }
}

export function useHaptics(enabled = true) {
  const vibrate = useCallback(
    (pattern: HapticPatternName | number | number[]) => {
      if (!enabled || !loadAppSettings().hapticsEnabled) return false;
      return triggerHapticPattern(pattern);
    },
    [enabled]
  );

  const tap = useCallback(() => vibrate('tap'), [vibrate]);
  const shutter = useCallback(() => vibrate('shutter'), [vibrate]);
  const success = useCallback(() => vibrate('success'), [vibrate]);
  const warning = useCallback(() => vibrate('warning'), [vibrate]);

  return {
    vibrate,
    tap,
    shutter,
    success,
    warning,
  };
}
