// Anbindung an die Desktop-Hülle (WebView mit `window.ipc`).

declare global {
  interface Window {
    __SQIZZO_DESKTOP__?: { platform: string; window: 'main' | 'capture' };
    __sqizzoWindow?: (s: { maximized: boolean }) => void;
    __sqizzoCapture?: { show: () => void };
    ipc?: { postMessage: (msg: string) => void };
  }
}

export const desktop = window.__SQIZZO_DESKTOP__ ?? null;

export function ipc(msg: string): boolean {
  if (window.ipc) {
    window.ipc.postMessage(msg);
    return true;
  }
  return false;
}

export const isMac = /Mac/.test(navigator.platform);
export const mod = isMac ? '⌘' : 'Strg';
