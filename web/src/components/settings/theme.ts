// Farbschema anwenden (System/Hell/Dunkel) und Systemwechsel verfolgen.

export type Theme = 'system' | 'light' | 'dark';

const KEY = 'sqizzo-theme';
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

export function storedTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(t: Theme) {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* Speicher gesperrt */
  }
  const dark = t === 'dark' || (t === 'system' && !!media?.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

// Bei „System“ dem Betriebssystem folgen (gilt app-weit, sobald dieses Modul geladen ist).
media?.addEventListener('change', () => {
  if (storedTheme() === 'system') applyTheme('system');
});
