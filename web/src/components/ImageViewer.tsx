// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Großansicht eines Bilds (Klick auf ein Bild in einer Notiz).

import { ExternalLink } from 'lucide-react';
import { api } from '../lib/api';
import { desktop } from '../lib/desktop';
import { vaultPath } from '../lib/images';
import { store, useStore } from '../lib/store';
import { openExternal } from './RichText';
import { Dialog } from './ui';
import { L } from '../i18n';

export function ImageViewer() {
  const view = useStore((s) => s.imageView);
  if (!view) return null;
  const close = () => store().set({ imageView: null });
  const path = vaultPath(view.href);
  const original = () => {
    // Bild aus dem Notizbuch: mit dem Standardprogramm (Desktop), sonst im Browser
    if (path && desktop) void api.openFile(path).catch((e: Error) => store().toast(e.message, 'error'));
    else openExternal(path ? view.url : view.href);
  };
  return (
    <Dialog
      title={view.alt || L.dialogs.image.fallback}
      onClose={close}
      width={1200}
      className="image-viewer"
      footer={
        <>
          {path && <span className="image-viewer-path mono">{path}</span>}
          <span className="spacer" />
          <button className="btn" onClick={original}>
            <ExternalLink size={14} /> {path && desktop ? L.dialogs.image.openDefault : L.dialogs.image.openOriginal}
          </button>
          <button className="btn btn-primary" onClick={close}>
            {L.common.close}
          </button>
        </>
      }
    >
      <div className="image-viewer-body" onClick={close}>
        <img src={view.url} alt={view.alt} onClick={(e) => e.stopPropagation()} />
      </div>
    </Dialog>
  );
}
