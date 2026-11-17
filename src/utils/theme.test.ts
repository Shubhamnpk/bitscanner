import test from 'node:test';
import assert from 'node:assert/strict';
import { applyThemeClass, resolveTheme } from './theme';
import { DEFAULT_APP_SETTINGS, mergeSettingsPatch } from './settingsStore';

function fakeRoot() {
  const classes = new Set<string>();
  return {
    classList: {
      toggle: (name: string, force: boolean) => {
        if (force) classes.add(name);
        else classes.delete(name);
      },
    },
    dataset: {} as Record<string, string>,
    style: {} as Record<string, string>,
    has: (name: string) => classes.has(name),
  };
}

test('resolveTheme follows the OS only in system mode', () => {
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(resolveTheme('light', true), 'light');
});

test('applyThemeClass toggles the dark class, dataset and color-scheme', () => {
  const root = fakeRoot();
  const element = root as unknown as HTMLElement;

  applyThemeClass('dark', element);
  assert.equal(root.has('dark'), true);
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(root.style.colorScheme, 'dark');

  applyThemeClass('light', element);
  assert.equal(root.has('dark'), false);
  assert.equal(root.dataset.theme, 'light');
  assert.equal(root.style.colorScheme, 'light');
});

test('theme defaults to system and survives invalid stored values', () => {
  assert.equal(DEFAULT_APP_SETTINGS.theme, 'system');
  assert.equal(mergeSettingsPatch(DEFAULT_APP_SETTINGS, { theme: 'dark' }).theme, 'dark');
  assert.equal(
    mergeSettingsPatch(DEFAULT_APP_SETTINGS, { theme: 'neon' as never }).theme,
    'system'
  );
});
