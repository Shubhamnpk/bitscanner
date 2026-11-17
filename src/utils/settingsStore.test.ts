import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_APP_SETTINGS,
  formatByteSize,
  mergeSettingsPatch,
  sanitizeAccountHandle,
  sanitizeFilenamePrefix,
  toggleFavoriteToolInList,
} from './settingsStore';

test('sanitizeAccountHandle normalizes handle safely', () => {
  assert.equal(sanitizeAccountHandle('  @Shubham_Nirula! '), '@shubham_nirula');
  assert.equal(sanitizeAccountHandle('   '), '@bitscan_user');
});

test('sanitizeFilenamePrefix strips unsafe filename characters', () => {
  assert.equal(sanitizeFilenamePrefix('Work/Scan: 2026'), 'WorkScan2026');
  assert.equal(sanitizeFilenamePrefix('***'), 'Scan_');
});

test('formatByteSize formats B, KB, and MB cleanly', () => {
  assert.equal(formatByteSize(0), '0 KB');
  assert.equal(formatByteSize(512), '512 B');
  assert.equal(formatByteSize(2048), '2.0 KB');
  assert.equal(formatByteSize(2 * 1024 * 1024), '2.00 MB');
});

test('mergeSettingsPatch updates local account & validates favoriteTools', () => {
  const next = mergeSettingsPatch(DEFAULT_APP_SETTINGS, {
    displayName: 'Alex Morgan',
    accountHandle: 'Alex_M',
    hasCompletedOnboarding: true,
    favoriteTools: ['images_to_pdf', 'invalid_tool' as never],
  });

  assert.equal(next.displayName, 'Alex Morgan');
  assert.equal(next.accountHandle, '@alex_m');
  assert.equal(next.hasCompletedOnboarding, true);
  assert.deepEqual(next.favoriteTools, ['images_to_pdf']);
});

test('toggleFavoriteToolInList toggles without duplicates', () => {
  const once = toggleFavoriteToolInList(['images_to_pdf'], 'merge_pdf');
  assert.deepEqual(once, ['images_to_pdf', 'merge_pdf']);
  const twice = toggleFavoriteToolInList(once, 'images_to_pdf');
  assert.deepEqual(twice, ['merge_pdf']);
});

test('mergeSettingsPatch handles defaultShareMode safely', () => {
  const next = mergeSettingsPatch(DEFAULT_APP_SETTINGS, {
    defaultShareMode: 'qr',
  });
  assert.equal(next.defaultShareMode, 'qr');

  const fallback = mergeSettingsPatch(DEFAULT_APP_SETTINGS, {
    defaultShareMode: 'invalid' as never,
  });
  assert.equal(fallback.defaultShareMode, 'share');
});
