import test from 'node:test';
import assert from 'node:assert/strict';
import { HAPTIC_PATTERNS, triggerHapticPattern } from './useHaptics';

test('triggerHapticPattern dispatches named vibration patterns via navigator.vibrate', () => {
  const calls: Array<number | number[]> = [];
  const mockNav = {
    vibrate: (pattern: Iterable<number> | number) => {
      calls.push(Array.isArray(pattern) ? [...pattern] : (pattern as number));
      return true;
    },
  };

  assert.equal(triggerHapticPattern('tap', mockNav as unknown as Pick<Navigator, 'vibrate'>), true);
  assert.equal(triggerHapticPattern('shutter', mockNav as unknown as Pick<Navigator, 'vibrate'>), true);
  assert.equal(triggerHapticPattern('success', mockNav as unknown as Pick<Navigator, 'vibrate'>), true);
  assert.equal(triggerHapticPattern('warning', mockNav as unknown as Pick<Navigator, 'vibrate'>), true);

  assert.deepEqual(calls, [
    HAPTIC_PATTERNS.tap,
    HAPTIC_PATTERNS.shutter,
    HAPTIC_PATTERNS.success,
    HAPTIC_PATTERNS.warning,
  ]);
});

test('triggerHapticPattern fails gracefully when navigator.vibrate is missing', () => {
  assert.equal(triggerHapticPattern('tap', undefined), false);
  assert.equal(triggerHapticPattern('success', {} as Pick<Navigator, 'vibrate'>), false);
});
