// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Einstellungen: Allgemein, Schnellerfassung, Erinnerungen, Versionen & Sync, Notizbuch, Über.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownToLine,
  Bell,
  CircleCheck,
  Cloud,
  CloudOff,
  ExternalLink,
  FolderOpen,
  GitBranch,
  Info,
  Keyboard,
  Minus,
  Monitor,
  Moon,
  Notebook,
  Plus,
  RefreshCw,
  RotateCcw,
  Sun,
  TriangleAlert,
} from 'lucide-react';
import { getZoom, setZoom, stepZoom, useZoom, ZOOM_STEPS } from '../lib/zoom';
import { renderMarkdown } from '../lib/markdown';
import { isBusy, pendingVersion, useUpdate } from '../lib/update';
import { fileSize } from './UpdateProgress';
import { openExternal } from './RichText';
import { api, type Info as AppInfo } from '../lib/api';
import { formatDateTime, relativeTime } from '../lib/dates';
import { L, setLangSetting, storedLangSetting, systemLang, useLang, type Lang, type Messages } from '../i18n';
import { store, useStore } from '../lib/store';
import type { Settings } from '../lib/types';
import { Dialog } from './ui';
import { HotkeyInput, hotkeyParts } from './settings/HotkeyInput';
import { ShortcutTable } from './Shortcuts';
import { applyTheme, type Theme } from './settings/theme';

type Tab = 'general' | 'capture' | 'reminders' | 'sync' | 'vault' | 'updates' | 'about';

/** Bereiche; die Beschriftung kommt beim Rendern aus `L.settings.tabs`. */
const TABS: { id: Tab; icon: ReactNode }[] = [
  { id: 'general', icon: <Monitor size={15} /> },
  { id: 'capture', icon: <Keyboard size={15} /> },
  { id: 'reminders', icon: <Bell size={15} /> },
  { id: 'sync', icon: <GitBranch size={15} /> },
  { id: 'vault', icon: <Notebook size={15} /> },
  { id: 'updates', icon: <ArrowDownToLine size={15} /> },
  { id: 'about', icon: <Info size={15} /> },
];

/** Namen der Sprachen in der eigenen Sprache (in jeder Oberflächensprache gleich). */
const LANG_NAMES: Record<Lang, string> = { de: 'Deutsch', en: 'English' };

/** Text mit Auszeichnungen aus den Sprachdateien: `{Taste}` → <kbd>, `Code` (Backticks) → <code>. */
function rich(text: string): ReactNode {
  return text.split(/(\{[^}]+\}|`[^`]+`)/).map((part, i) => {
    if (part.length > 2 && part[0] === '{' && part[part.length - 1] === '}') return <kbd key={i}>{part.slice(1, -1)}</kbd>;
    if (part.length > 2 && part[0] === '`' && part[part.length - 1] === '`') return <code key={i}>{part.slice(1, -1)}</code>;
    return part;
  });
}

const DEFAULT_HOTKEY = 'Ctrl+Shift+Space';

/** Öffentlicher Quellcode (AGPL: auch für Nutzer von `hakobo serve` erreichbar). */
const SOURCE_URL = 'https://github.com/jasal82/hakobo';

/** Einstellungszeile: Beschriftung links, Steuerelement rechts. `note` steht
 *  als eigene Zeile darunter über die ganze Breite (für längere Erklärungen). */
function Row({ label, hint, note, children }: { label: ReactNode; hint?: ReactNode; note?: ReactNode; children: ReactNode }) {
  return (
    <div className={`set-row${note ? ' has-note' : ''}`}>
      <div className="set-row-text">
        <div className="set-row-label">{label}</div>
        {hint && <div className="set-row-hint">{hint}</div>}
      </div>
      <div className="set-row-control">{children}</div>
      {note && <div className="set-row-note">{note}</div>}
    </div>
  );
}

/** Zurücksetzen-Knopf vor einem Steuerelement. Er belegt seinen Platz auch
 *  unsichtbar, damit nichts springt, wenn er erscheint. */
function ResetButton({ show, onClick, title }: { show: boolean; onClick: () => void; title: string }) {
  return (
    <button
      className={`btn btn-ghost btn-icon btn-sm set-reset${show ? '' : ' is-hidden'}`}
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-hidden={!show}
      tabIndex={show ? 0 : -1}
    >
      <RotateCcw size={14} />
    </button>
  );
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Notice({ kind = 'info', children }: { kind?: 'info' | 'warning' | 'error' | 'success'; children: ReactNode }) {
  return <div className={`set-notice is-${kind}`}>{children}</div>;
}

export function SettingsDialog() {
  // Der Dialog liegt außerhalb des Teils, den App.tsx beim Sprachwechsel neu
  // aufbaut; so bleibt er offen und rendert hier selbst in der neuen Sprache.
  useLang();
  const [tab, setTab] = useState<Tab>(() => (sessionStorage.getItem('hakobo-settings-tab') as Tab) || 'general');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [vaultPath, setVaultPath] = useState('');
  const [defaultVault, setDefaultVault] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [restart, setRestart] = useState(false);
  const [saving, setSaving] = useState(false);
  const saved = useRef<Settings | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const close = useCallback(() => store().set({ settingsOpen: false }), []);
  // Updates gibt es nur in der lokalen App; ein Punkt zeigt eine neue Version an.
  const updatesEnabled = useUpdate((s) => !!s.status?.enabled);
  const updatePending = useUpdate((s) => !!pendingVersion(s));
  const tabs = TABS.filter((t) => t.id !== 'updates' || updatesEnabled);
  const active: Tab = tab === 'updates' && !updatesEnabled ? 'general' : tab;
  const wanted = useStore((s) => s.settingsTab);
  useEffect(() => {
    if (!wanted) return;
    setTab(wanted as Tab);
    store().set({ settingsTab: null });
  }, [wanted]);

  const load = useCallback(async () => {
    try {
      const r = await api.settings();
      saved.current = r.settings;
      setSettings(r.settings);
      setVaultPath(r.vault);
      setDefaultVault(r.defaultVault);
      // Gespeichertes Farbschema dieses Rechners gilt auch für die Oberfläche.
      if (r.settings.theme) applyTheme(r.settings.theme);
      // Ebenso die Sprache – nur wenn sie von der zuletzt übernommenen abweicht.
      const language = r.settings.language ?? 'system';
      if (language !== storedLangSetting()) setLangSetting(language);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const onChange = () => {
      if (timer.current === undefined) void load();
    };
    window.addEventListener('hakobo-settings', onChange);
    return () => window.removeEventListener('hakobo-settings', onChange);
  }, [load]);

  useEffect(() => {
    try {
      sessionStorage.setItem('hakobo-settings-tab', tab);
    } catch {
      /* egal */
    }
  }, [tab]);

  const save = useCallback(async (next: Settings) => {
    setSaving(true);
    try {
      const r = await api.saveSettings(next);
      saved.current = r.settings;
      setWarnings(r.warnings);
      setError(null);
      if (r.restartRequired) setRestart(true);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  /** Ändert Einstellungen; gespeichert wird kurz danach (alle Felder auf einmal). */
  const update = (patch: Partial<Settings>, immediate = false) => {
    if (!settings) return;
    // Die Schriftgröße kann sich auch per Tastenkürzel geändert haben.
    const next = { ...settings, ...patch, uiScale: patch.uiScale ?? getZoom() };
    setSettings(next);
    window.clearTimeout(timer.current);
    if (immediate) {
      timer.current = undefined;
      void save(next);
      return;
    }
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      void save(next);
    }, 400);
  };

  // Ausstehendes Speichern beim Schließen nicht verlieren.
  const latest = useRef(settings);
  latest.current = settings;
  useEffect(
    () => () => {
      if (timer.current !== undefined && latest.current) {
        window.clearTimeout(timer.current);
        void api.saveSettings({ ...latest.current, uiScale: getZoom() }).catch(() => undefined);
      }
    },
    [],
  );

  const setHotkey = async (hk: string) => {
    if (!settings) return;
    window.clearTimeout(timer.current);
    timer.current = undefined;
    const prev = saved.current?.hotkey ?? settings.hotkey;
    const next = { ...settings, hotkey: hk, uiScale: getZoom() };
    setSettings(next);
    const ok = await save(next);
    if (!ok) {
      // Der Server hat nichts gespeichert: altes Kürzel wiederherstellen.
      setSettings((s) => (s ? { ...s, hotkey: prev } : s));
    }
  };

  return (
    <Dialog title={L.settings.title} onClose={close} width={760} className="settings-dialog">
      <div className="set-layout">
        <nav className="set-nav">
          {tabs.map((t) => (
            <button key={t.id} className={`set-nav-item${active === t.id ? ' is-active' : ''}`} onClick={() => setTab(t.id)}>
              {t.icon}
              <span>{L.settings.tabs[t.id]}</span>
              {t.id === 'updates' && updatePending && <i className="nav-dot" aria-label={L.settings.newVersionDot} />}
            </button>
          ))}
          <div className="set-status">{saving ? L.settings.saving : settings ? L.settings.savedInstantly : ''}</div>
        </nav>
        <div className="set-content">
          {error && (
            <Notice kind="error">
              <TriangleAlert size={15} /> {error}
            </Notice>
          )}
          {warnings.map((w) => (
            <Notice kind="warning" key={w}>
              <TriangleAlert size={15} /> {w}
            </Notice>
          ))}
          {!settings ? (
            !error && (
              <div className="set-loading">
                <div className="spinner" />
              </div>
            )
          ) : (
            <>
              {active === 'general' && <GeneralTab settings={settings} update={update} />}
              {active === 'capture' && <CaptureTab settings={settings} setHotkey={setHotkey} />}
              {active === 'reminders' && <RemindersTab settings={settings} update={update} />}
              {active === 'sync' && <SyncTab settings={settings} update={update} />}
              {active === 'vault' && <VaultTab settings={settings} vaultPath={vaultPath} defaultVault={defaultVault} restart={restart} update={update} />}
              {active === 'updates' && <UpdatesTab settings={settings} update={update} />}
              {active === 'about' && <AboutTab />}
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}

type TabProps = { settings: Settings; update: (p: Partial<Settings>, immediate?: boolean) => void };

/** Schriftgröße der ganzen Oberfläche (wirkt sofort, wird automatisch gespeichert). */
function ZoomRow() {
  const zoom = useZoom();
  const pct = Math.round(zoom * 100);
  const t = L.settings.zoom;
  return (
    <Row label={t.label} note={rich(t.note)}>
      <div className="zoom-ctl">
        <ResetButton show={zoom !== 1} onClick={() => setZoom(1)} title={t.reset} />
        <button className="btn btn-icon btn-sm" onClick={() => stepZoom(-1)} disabled={zoom <= ZOOM_STEPS[0] + 0.001} aria-label={t.smaller}>
          <Minus size={14} />
        </button>
        <select className="select zoom-select" value={ZOOM_STEPS.includes(zoom) ? String(zoom) : 'custom'} onChange={(e) => setZoom(Number(e.target.value))} aria-label={t.label}>
          {!ZOOM_STEPS.includes(zoom) && <option value="custom">{t.percent(pct)}</option>}
          {ZOOM_STEPS.map((s) => (
            <option key={s} value={String(s)}>
              {t.percent(Math.round(s * 100))}
              {s === 1 ? t.defaultSuffix : ''}
            </option>
          ))}
        </select>
        <button className="btn btn-icon btn-sm" onClick={() => stepZoom(1)} disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1] - 0.001} aria-label={t.larger}>
          <Plus size={14} />
        </button>
      </div>
    </Row>
  );
}

function GeneralTab({ settings, update }: TabProps) {
  const t = L.settings.general;
  const choose = (theme: Theme) => {
    applyTheme(theme);
    update({ theme });
  };
  const options: { id: Theme; label: string; icon: ReactNode }[] = [
    { id: 'system', label: t.themeSystem, icon: <Monitor size={16} /> },
    { id: 'light', label: t.themeLight, icon: <Sun size={16} /> },
    { id: 'dark', label: t.themeDark, icon: <Moon size={16} /> },
  ];
  const language = settings.language ?? 'system';
  const chooseLanguage = (l: Settings['language']) => {
    // Sofort speichern: Die App übernimmt bei jeder Einstellungsänderung (auch
    // aus anderen Fenstern) die gespeicherte Sprache – ein verzögertes Speichern
    // könnte die eben gewählte kurz zurückdrehen.
    update({ language: l }, true);
    setLangSetting(l);
  };
  const languages: { id: Settings['language']; label: string; lang?: Lang; icon?: ReactNode }[] = [
    { id: 'system', label: t.languageSystem, icon: <Monitor size={16} /> },
    { id: 'de', label: LANG_NAMES.de, lang: 'de' },
    { id: 'en', label: LANG_NAMES.en, lang: 'en' },
  ];
  return (
    <section className="set-section">
      <h3>{t.appearance}</h3>
      <Row label={t.language} hint={t.languageHint(t.languageNames[systemLang()])}>
        <div className="set-segment" role="radiogroup" aria-label={t.language}>
          {languages.map((o) => (
            <button key={o.id} role="radio" lang={o.lang} aria-checked={language === o.id} className={language === o.id ? 'is-active' : ''} onClick={() => chooseLanguage(o.id)}>
              {o.icon}
              {o.label}
            </button>
          ))}
        </div>
      </Row>
      <Row label={t.theme} hint={t.themeHint}>
        <div className="set-segment" role="radiogroup">
          {options.map((o) => (
            <button key={o.id} role="radio" aria-checked={settings.theme === o.id} className={settings.theme === o.id ? 'is-active' : ''} onClick={() => choose(o.id)}>
              {o.icon}
              {o.label}
            </button>
          ))}
        </div>
      </Row>
      <ZoomRow />
      <h3>{t.program}</h3>
      <Row label={t.closeToTray} hint={t.closeToTrayHint}>
        <Toggle checked={settings.closeToTray} onChange={(v) => update({ closeToTray: v })} />
      </Row>
      <Row label={t.autostart} hint={t.autostartHint}>
        <Toggle checked={settings.autostart} onChange={(v) => update({ autostart: v }, true)} />
      </Row>
    </section>
  );
}

function CaptureTab({ settings, setHotkey }: { settings: Settings; setHotkey: (hk: string) => void }) {
  const desktop = useDesktop();
  const t = L.settings.capture;
  return (
    <section className="set-section">
      <h3>{t.globalHotkey}</h3>
      <p className="set-text">{t.intro}</p>
      <Row label={t.hotkey} hint={t.hotkeyHint}>
        <div className="set-inline">
          <ResetButton show={settings.hotkey !== DEFAULT_HOTKEY} onClick={() => setHotkey(DEFAULT_HOTKEY)} title={t.restoreDefault(hotkeyParts(DEFAULT_HOTKEY).join('+'))} />
          <HotkeyInput value={settings.hotkey} onChange={setHotkey} />
        </div>
      </Row>
      {desktop === false && <Notice kind="warning">{t.desktopOnly}</Notice>}
      <h3>{t.howTo}</h3>
      <div className="set-examples">
        {t.examples.map(([code, what]) => (
          <div key={code}>
            <code>{code}</code>
            <span>{what}</span>
          </div>
        ))}
      </div>
      <h3>{t.fromCli}</h3>
      <pre className="set-code">{t.cliExample}</pre>
      <p className="set-text subtle">{t.cliNote}</p>
    </section>
  );
}

function RemindersTab({ settings, update }: TabProps) {
  const minutes = [5, 10, 15, 30, 60];
  const t = L.settings.reminders;
  return (
    <section className="set-section">
      <h3>{t.defaults}</h3>
      <Row label={t.events} hint={t.eventsHint}>
        <select
          className="select set-select"
          value={settings.eventReminderMinutes ?? 'off'}
          onChange={(e) => update({ eventReminderMinutes: e.target.value === 'off' ? null : Number(e.target.value) })}
        >
          <option value="off">{t.off}</option>
          {minutes.map((m) => (
            <option key={m} value={m}>
              {m === 60 ? t.hourBefore : t.minutesBefore(m)}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t.allDay} hint={t.allDayHint}>
        <div className="set-inline">
          <Toggle checked={settings.allDayReminders} onChange={(v) => update({ allDayReminders: v })} />
          <input
            className="input set-time"
            type="time"
            value={settings.allDayTime}
            disabled={!settings.allDayReminders}
            onChange={(e) => e.target.value && update({ allDayTime: e.target.value })}
            aria-label={t.allDayTime}
          />
        </div>
      </Row>
      <h3>{t.perEntry}</h3>
      <p className="set-text">{rich(t.perEntryText)}</p>
      <p className="set-text subtle">{t.notifications}</p>
    </section>
  );
}

function useDesktop(): boolean | null {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    api.info().then(setInfo, () => undefined);
  }, []);
  return info ? info.desktop : null;
}

function SyncTab({ settings, update }: TabProps) {
  const sync = useStore((s) => s.sync);
  const [url, setUrl] = useState(sync?.remote ?? '');
  const [busy, setBusy] = useState<'connect' | 'disconnect' | 'sync' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [gitCli, setGitCli] = useState<boolean | null>(null);
  const remote = sync?.remote ?? null;

  // Status regelmäßig auffrischen (ausstehende Änderungen zählen).
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      api.sync().then(
        (s) => alive && store().set({ sync: s }),
        () => undefined,
      );
    void refresh();
    const t = window.setInterval(refresh, 5000);
    api.info().then((i) => alive && setGitCli(i.gitCli), () => undefined);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (remote) setUrl(remote);
  }, [remote]);

  const run = async (kind: 'connect' | 'disconnect' | 'sync', f: () => Promise<unknown>) => {
    setBusy(kind);
    setErr(null);
    try {
      const s = (await f()) as typeof sync;
      if (s) store().set({ sync: s });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const t = L.settings.sync;
  const delays: [number, string][] = [
    [10, t.seconds(10)],
    [30, t.seconds(30)],
    [60, t.minutes(1)],
    [300, t.minutes(5)],
  ];
  const intervals: [number, string][] = [
    [1, t.everyMinutes(1)],
    [5, t.everyMinutes(5)],
    [15, t.everyMinutes(15)],
    [60, t.hourly],
  ];
  const running = !!sync?.running || busy !== null;

  return (
    <section className="set-section">
      <h3>{t.versions}</h3>
      <div className="set-card">
        <GitBranch size={18} className="set-card-icon" />
        <div>
          <div className="set-card-title">{t.autoVersions}</div>
          <div className="set-row-hint">
            {t.lastVersion(sync?.lastCommit ? `${relativeTime(sync.lastCommit)} (${formatDateTime(sync.lastCommit)})` : t.noVersionYet)}
            {sync && sync.pending > 0 && t.pending(sync.pending)}
          </div>
        </div>
      </div>
      <Row label={t.commitAfter} hint={t.commitAfterHint}>
        <select className="select set-select" value={settings.commitDelaySecs} onChange={(e) => update({ commitDelaySecs: Number(e.target.value) })}>
          {delays.some(([v]) => v === settings.commitDelaySecs) ? null : <option value={settings.commitDelaySecs}>{t.seconds(settings.commitDelaySecs)}</option>}
          {delays.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Row>
      <p className="set-text subtle">{t.olderVersions}</p>

      <h3>{t.sync}</h3>
      {gitCli === false && (
        <Notice kind="warning">
          <TriangleAlert size={15} /> {t.gitMissingBefore}
          <a href="https://git-scm.com" target="_blank" rel="noreferrer">
            git-scm.com
          </a>
          {t.gitMissingAfter}
        </Notice>
      )}
      <div className={`set-card${sync?.lastError ? ' is-error' : ''}`}>
        {remote ? <Cloud size={18} className="set-card-icon" /> : <CloudOff size={18} className="set-card-icon" />}
        <div className="set-card-main">
          <div className="set-card-title">{running ? t.syncing : remote ? t.connected : t.localOnly}</div>
          <div className="set-row-hint">
            {remote ? (
              <>
                <span className="mono">{remote}</span>
                <br />
                {t.lastSync(sync?.lastSync ? `${relativeTime(sync.lastSync)} (${formatDateTime(sync.lastSync)})` : t.never)}
              </>
            ) : (
              t.noRemote
            )}
          </div>
          {sync?.lastError && !running && <div className="set-card-error">{sync.lastError}</div>}
          {sync && sync.resolved.length > 0 && (
            <div className="set-row-hint">
              {t.merged}
              <span className="mono">{sync.resolved.join(', ')}</span>
            </div>
          )}
        </div>
        {remote && (
          <button className="btn btn-sm" disabled={running} onClick={() => void run('sync', api.syncNow)}>
            <RefreshCw size={14} className={running ? 'spin' : undefined} /> {t.syncNow}
          </button>
        )}
      </div>

      <label className="field set-field">
        {t.remote}
        <div className="set-inline">
          <input
            className="input mono"
            placeholder={t.remotePlaceholder}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && url.trim() && url.trim() !== remote) void run('connect', () => api.setRemote(url.trim()));
            }}
            spellCheck={false}
          />
          <button className="btn btn-primary" disabled={!url.trim() || url.trim() === remote || running} onClick={() => void run('connect', () => api.setRemote(url.trim()))}>
            {busy === 'connect' ? t.connecting : remote ? t.change : t.connect}
          </button>
          {remote && (
            <button
              className="btn btn-danger"
              disabled={running}
              onClick={() => {
                if (confirm(t.disconnectConfirm))
                  void run('disconnect', async () => {
                    const s = await api.setRemote(null);
                    setUrl('');
                    return s;
                  });
              }}
            >
              {t.disconnect}
            </button>
          )}
        </div>
        <span className="field-hint">{t.remoteHint}</span>
      </label>
      {err && (
        <Notice kind="error">
          <TriangleAlert size={15} /> {err}
        </Notice>
      )}

      <Row label={t.auto} hint={t.autoHint}>
        <div className="set-inline">
          <Toggle checked={settings.syncEnabled} onChange={(v) => update({ syncEnabled: v })} />
          <select className="select set-select" value={settings.syncIntervalMinutes} disabled={!settings.syncEnabled} onChange={(e) => update({ syncIntervalMinutes: Number(e.target.value) })}>
            {intervals.some(([v]) => v === settings.syncIntervalMinutes) ? null : <option value={settings.syncIntervalMinutes}>{t.everyMinutes(settings.syncIntervalMinutes)}</option>}
            {intervals.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </Row>

      <h3>{t.secondDevice}</h3>
      <p className="set-text">{t.secondDeviceText}</p>
      <pre className="set-code">{t.cloneExample}</pre>
      <p className="set-text subtle">{t.mergeNote}</p>
    </section>
  );
}

function VaultTab({ settings, vaultPath, defaultVault, restart, update }: TabProps & { vaultPath: string; defaultVault: string; restart: boolean }) {
  const [path, setPath] = useState(settings.vault ?? '');
  const [err, setErr] = useState<string | null>(null);
  const configured = settings.vault ?? '';
  const t = L.settings.vault;
  return (
    <section className="set-section">
      <h3>{t.current}</h3>
      <div className="set-card">
        <FolderOpen size={18} className="set-card-icon" />
        <div className="set-card-main">
          <div className="set-card-title mono set-path">{vaultPath}</div>
          <div className="set-row-hint">{t.currentHint}</div>
        </div>
        <button
          className="btn btn-sm"
          onClick={() =>
            api.openFolder().then(
              () => setErr(null),
              (e) => setErr((e as Error).message),
            )
          }
        >
          {t.openFolder}
        </button>
      </div>
      {err && <Notice kind="error">{err}</Notice>}

      <h3>{t.other}</h3>
      <label className="field set-field">
        {t.folder}
        <div className="set-inline">
          <input className="input mono" placeholder={defaultVault} value={path} onChange={(e) => setPath(e.target.value)} spellCheck={false} />
          <button className="btn" disabled={path.trim() === configured} onClick={() => update({ vault: path.trim() || null }, true)}>
            {t.apply}
          </button>
        </div>
        <span className="field-hint">
          {t.defaultBefore}
          <span className="mono">{defaultVault}</span>
          {t.defaultAfter}
        </span>
      </label>
      {restart && <Notice kind="info">{t.restart}</Notice>}
    </section>
  );
}

/** Befehle der Kommandozeile; die Beschreibung steht in `L.settings.about.cliCommands`. */
const CLI: [string, keyof Messages['settings']['about']['cliCommands']][] = [
  ['hakobo add "…"', 'add'],
  ['hakobo agenda', 'agenda'],
  ['hakobo search "…"', 'search'],
  ['hakobo inbox', 'inbox'],
  ['hakobo sync', 'sync'],
  ['hakobo clone <url>', 'clone'],
  ['hakobo serve', 'serve'],
];

/** Versionshinweise von GitHub (Markdown); Links öffnen im Browser. */
function ReleaseNotes({ text }: { text: string }) {
  return (
    <div
      className="md update-notes"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a');
        if (!a) return;
        e.preventDefault();
        if (a.href) openExternal(a.href);
      }}
    />
  );
}

const unix = (iso: string | null) => (iso ? Date.parse(iso) / 1000 : null);

function UpdatesTab({ settings, update }: TabProps) {
  const { status: u, checking, check, install } = useUpdate();
  const [actionError, setActionError] = useState<string | null>(null);
  if (!u) return null;
  const busy = isBusy(u);
  const skipped = !!u.latest && settings.skippedVersion === u.latest;
  const published = unix(u.publishedAt);
  const t = L.settings.updates;

  const runCheck = async () => {
    setActionError(null);
    try {
      await check();
    } catch (e) {
      setActionError(t.checkFailed((e as Error).message));
    }
  };
  const startInstall = async () => {
    if (!confirm(t.installConfirm(u.latest ?? ''))) return;
    setActionError(null);
    try {
      await install();
    } catch (e) {
      setActionError(t.installFailed((e as Error).message));
    }
  };

  return (
    <section className="set-section">
      <h3>{t.version}</h3>
      <Row
        label={`Hakobo ${u.current}`}
        hint={u.checkedAt ? t.checkedAgo(relativeTime(unix(u.checkedAt))) : t.neverChecked}
      >
        <button className="btn btn-sm" onClick={() => void runCheck()} disabled={checking || busy}>
          <RefreshCw size={14} className={checking ? 'spin' : undefined} /> {t.checkNow}
        </button>
      </Row>
      {actionError && (
        <Notice kind="error">
          <TriangleAlert size={15} /> {actionError}
        </Notice>
      )}
      {u.checkError && (
        <Notice kind="warning">
          <TriangleAlert size={15} /> {u.checkError}
        </Notice>
      )}
      {!u.checkError && u.latest && !u.available && (
        <Notice kind="success">
          <CircleCheck size={15} /> {t.upToDate}
        </Notice>
      )}
      {u.available && u.latest && (
        <div className="update-card">
          <div className="update-head">
            <span className="update-badge">
              <ArrowDownToLine size={14} /> {t.newVersion(u.latest)}
            </span>
            {published && <span className="subtle">{t.publishedOn(new Date(published * 1000))}</span>}
          </div>
          {u.notes && <ReleaseNotes text={u.notes} />}
          {u.phase === 'failed' && (
            <Notice kind="error">
              <TriangleAlert size={15} /> {t.failed(u.error ?? '')}
            </Notice>
          )}
          <p className="update-how">{u.canInstall ? t.installNoteWithSize(u.installNote, fileSize(u.downloadSize)) : u.installNote}</p>
          <div className="update-actions">
            {u.canInstall && (
              <button className="btn btn-accent" onClick={() => void startInstall()} disabled={busy}>
                <ArrowDownToLine size={15} /> {u.phase === 'failed' ? L.common.retry : t.installNow}
              </button>
            )}
            {u.releaseUrl && (
              <button className={u.canInstall ? 'btn' : 'btn btn-accent'} onClick={() => openExternal(u.releaseUrl)}>
                <ExternalLink size={14} /> {u.canInstall ? t.viewOnGithub : t.downloadOnGithub}
              </button>
            )}
            {!skipped && (
              <button className="btn btn-ghost" onClick={() => update({ skippedVersion: u.latest ?? '' }, true)} disabled={busy}>
                {t.skip}
              </button>
            )}
          </div>
          {skipped && (
            <p className="update-how">
              {t.skipped}{' '}
              <button className="link-btn" onClick={() => update({ skippedVersion: '' }, true)}>
                {t.remindAgain}
              </button>
            </p>
          )}
        </div>
      )}
      <h3>{t.automatic}</h3>
      <Row label={t.autoCheck} hint={t.autoCheckHint}>
        <Toggle checked={settings.updateCheck} onChange={(v) => update({ updateCheck: v })} />
      </Row>
    </section>
  );
}

function AboutTab() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    api.info().then(setInfo, () => undefined);
  }, []);
  const t = L.settings.about;
  return (
    <section className="set-section">
      <div className="set-about">
        <img src="/favicon.svg" alt="" width={44} height={44} />
        <div>
          <div className="set-about-name">Hakobo {info?.version ?? ''}</div>
          <div className="set-row-hint">{t.tagline}</div>
        </div>
      </div>
      <dl className="set-facts">
        {info && (
          <>
            <dt>{t.host}</dt>
            <dd>{info.host}</dd>
            <dt>{t.vault}</dt>
            <dd className="mono">{info.vault}</dd>
            <dt>{t.git}</dt>
            <dd>{info.gitCli ? t.gitInstalled : t.gitMissing}</dd>
          </>
        )}
        <dt>{t.license}</dt>
        <dd>{t.licenseText}</dd>
        <dt>{t.source}</dt>
        <dd>
          <a
            href={SOURCE_URL}
            onClick={(e) => {
              e.preventDefault();
              openExternal(SOURCE_URL);
            }}
          >
            {SOURCE_URL.replace('https://', '')}
          </a>
        </dd>
      </dl>
      <h3>{t.shortcuts}</h3>
      <ShortcutTable />
      <h3>{t.cli}</h3>
      <table className="set-table">
        <tbody>
          {CLI.map(([c, d]) => (
            <tr key={c}>
              <td>
                <code>{c}</code>
              </td>
              <td>{t.cliCommands[d]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
