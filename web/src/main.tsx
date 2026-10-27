// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

import './lib/legacyStorage';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter/wght.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/ui.css';
import './styles/app.css';
import './styles/outline.css';
import './styles/search.css';
import './styles/views.css';
import './styles/dialogs.css';
import './styles/capture.css';
import './styles/todos.css';
import { App } from './App';
import { CaptureApp } from './capture/CaptureApp';

const isCapture = location.pathname.startsWith('/capture');

createRoot(document.getElementById('root')!).render(<StrictMode>{isCapture ? <CaptureApp /> : <App />}</StrictMode>);
