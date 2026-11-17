import type { ThemeMode } from './settingsStore';

export type ResolvedTheme = 'light' | 'dark';

/** Turns the stored preference into the theme that should actually be painted. */
export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return prefersDark ? 'dark' : 'light';
  return mode;
}

/**
 * Applies the resolved theme to the document root. `index.css` keys its dark
 * surface overrides off the `dark` class, so this is the single switch for the
 * whole app.
 */
export function applyThemeClass(
  theme: ResolvedTheme,
  root: HTMLElement = document.documentElement
): void {
  root.classList.toggle('dark', theme === 'dark');
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

/** Keeps the Android/iOS browser chrome in step with the app background. */
export function applyBrowserThemeColor(
  theme: ResolvedTheme,
  doc: Document = document
): void {
  const meta = doc.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', theme === 'dark' ? '#080e18' : '#0d9488');
}
