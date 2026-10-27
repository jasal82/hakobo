// Anbindung an die Desktop-Hülle (WebView mit `window.ipc`).

declare global {
  interface Window {
    __HAKOBO_DESKTOP__?: { platform: string; window: 'main' | 'capture' };
    __hakoboWindow?: (s: { maximized: boolean }) => void;
    __hakoboCapture?: { show: () => void };
    ipc?: { postMessage: (msg: string) => void };
  }
}

export const desktop = window.__HAKOBO_DESKTOP__ ?? null;

export function ipc(msg: string): boolean {
  if (window.ipc) {
    window.ipc.postMessage(msg);
    return true;
  }
  return false;
}

export const isMac = /Mac/.test(navigator.platform);
export const mod = isMac ? '⌘' : 'Strg';
