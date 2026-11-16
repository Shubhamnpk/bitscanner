import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_APP_SETTINGS,
  TOOLS_CATALOG,
  mergeSettingsPatch,
  toggleFavoriteToolInList,
} from './settingsStore';

test('toggleFavoriteToolInList toggles tool IDs cleanly without mutation', () => {
  const start = ['images_to_pdf', 'pp_size'] as const;
  const added = toggleFavoriteToolInList([...start], 'merge_pdf');
  assert.deepEqual(added, ['images_to_pdf', 'pp_size', 'merge_pdf']);
  const removed = toggleFavoriteToolInList(added, 'pp_size');
  assert.deepEqual(removed, ['images_to_pdf', 'merge_pdf']);
  assert.equal(start.length, 2);
});

test('mergeSettingsPatch updates settings and strips unknown favorite tool IDs', () => {
  const next = mergeSettingsPatch(DEFAULT_APP_SETTINGS, {
    hapticsEnabled: false,
    defaultPaperSize: 'letter',
    favoriteTools: ['pp_size', 'unknown_tool' as never],
  });
  assert.equal(next.hapticsEnabled, false);
  assert.equal(next.defaultPaperSize, 'letter');
  assert.deepEqual(next.favoriteTools, ['pp_size']);
  assert.ok(TOOLS_CATALOG.length >= 8);
});
