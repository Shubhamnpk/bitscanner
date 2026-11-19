import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {loadAppSettings} from './utils/settingsStore';
import {applyBrowserThemeColor, applyThemeClass, resolveTheme} from './utils/theme';

// index.html paints the theme from localStorage before this module runs; re-apply
// from the real settings source so both paths can never disagree.
const prefersDark =
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches;
const initialTheme = resolveTheme(loadAppSettings().theme, prefersDark);
applyThemeClass(initialTheme);
applyBrowserThemeColor(initialTheme);

createRoot(document.getElementById('root')!).render(<App />);
