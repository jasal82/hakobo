// Einstellungen: Allgemein, Schnellerfassung, Erinnerungen, Versionen & Sync, Notizbuch, Über.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Bell, Cloud, CloudOff, FolderOpen, GitBranch, Info, Keyboard, Minus, Monitor, Moon, Notebook, Plus, RefreshCw, RotateCcw, Sun, TriangleAlert } from 'lucide-react';
import { getZoom, setZoom, stepZoom, useZoom, ZOOM_STEPS } from '../lib/zoom';
import { api, type Info as AppInfo } from '../lib/api';
import { formatDateTime, relativeTime } from '../lib/dates';
import { store, useStore } from '../lib/store';
import type { Settings } from '../lib/types';
import { Dialog } from './ui';
import { HotkeyInput } from './settings/HotkeyInput';
import { applyTheme, type Theme } from './settings/theme';

type Tab = 'general' | 'capture' | 'reminders' | 'sync' | 'vault' | 'about';

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'general', label: 'Allgemein', icon: <Monitor size={15} /> },
  { id: 'capture', label: 'Schnellerfassung', icon: <Keyboard size={15} /> },
  { id: 'reminders', label: 'Erinnerungen', icon: <Bell size={15} /> },
  { id: 'sync', label: 'Versionen & Sync', icon: <GitBranch size={15} /> },
  { id: 'vault', label: 'Notizbuch', icon: <Notebook size={15} /> },
  { id: 'about', label: 'Über Hakobo', icon: <Info size={15} /> },
];

const DEFAULT_HOTKEY = 'Ctrl+Shift+Space';

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

  const load = useCallback(async () => {
    try {
      const r = await api.settings();
      saved.current = r.settings;
      setSettings(r.settings);
      setVaultPath(r.vault);
      setDefaultVault(r.defaultVault);
      // Gespeichertes Farbschema dieses Rechners gilt auch für die Oberfläche.
      if (r.settings.theme) applyTheme(r.settings.theme);
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
    <Dialog title="Einstellungen" onClose={close} width={760} className="settings-dialog">
      <div className="set-layout">
        <nav className="set-nav">
          {TABS.map((t) => (
            <button key={t.id} className={`set-nav-item${tab === t.id ? ' is-active' : ''}`} onClick={() => setTab(t.id)}>
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
          <div className="set-status">{saving ? 'Speichert …' : settings ? 'Änderungen werden sofort gespeichert' : ''}</div>
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
              {tab === 'general' && <GeneralTab settings={settings} update={update} />}
              {tab === 'capture' && <CaptureTab settings={settings} setHotkey={setHotkey} />}
              {tab === 'reminders' && <RemindersTab settings={settings} update={update} />}
              {tab === 'sync' && <SyncTab settings={settings} update={update} />}
              {tab === 'vault' && <VaultTab settings={settings} vaultPath={vaultPath} defaultVault={defaultVault} restart={restart} update={update} />}
              {tab === 'about' && <AboutTab />}
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
  return (
    <Row
      label="Schriftgröße"
      note={
        <>
          Vergrößert Text und Bedienelemente der ganzen App, auch das Erfassungsfenster. Schneller geht es mit <kbd>Strg</kbd> <kbd>+</kbd> / <kbd>−</kbd>, <kbd>Strg</kbd> <kbd>0</kbd> oder <kbd>Strg</kbd> + Mausrad.
        </>
      }
    >
      <div className="zoom-ctl">
        <ResetButton show={zoom !== 1} onClick={() => setZoom(1)} title="Auf 100 % zurücksetzen" />
        <button className="btn btn-icon btn-sm" onClick={() => stepZoom(-1)} disabled={zoom <= ZOOM_STEPS[0] + 0.001} aria-label="Kleiner">
          <Minus size={14} />
        </button>
        <select className="select zoom-select" value={ZOOM_STEPS.includes(zoom) ? String(zoom) : 'custom'} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Schriftgröße">
          {!ZOOM_STEPS.includes(zoom) && <option value="custom">{pct} %</option>}
          {ZOOM_STEPS.map((s) => (
            <option key={s} value={String(s)}>
              {Math.round(s * 100)} %{s === 1 ? ' (Standard)' : ''}
            </option>
          ))}
        </select>
        <button className="btn btn-icon btn-sm" onClick={() => stepZoom(1)} disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1] - 0.001} aria-label="Größer">
          <Plus size={14} />
        </button>
      </div>
    </Row>
  );
}

function GeneralTab({ settings, update }: TabProps) {
  const choose = (t: Theme) => {
    applyTheme(t);
    update({ theme: t });
  };
  const options: { id: Theme; label: string; icon: ReactNode }[] = [
    { id: 'system', label: 'System', icon: <Monitor size={16} /> },
    { id: 'light', label: 'Hell', icon: <Sun size={16} /> },
    { id: 'dark', label: 'Dunkel', icon: <Moon size={16} /> },
  ];
  return (
    <section className="set-section">
      <h3>Darstellung</h3>
      <Row label="Farbschema" hint="„System“ folgt der Einstellung von Windows.">
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
      <h3>Programm</h3>
      <Row label="Beim Schließen im Infobereich weiterlaufen" hint="Nötig, damit Tastenkürzel und Erinnerungen auch bei geschlossenem Fenster funktionieren.">
        <Toggle checked={settings.closeToTray} onChange={(v) => update({ closeToTray: v })} />
      </Row>
      <Row label="Mit Windows starten" hint="Hakobo startet unsichtbar im Infobereich, damit die Schnellerfassung sofort bereitsteht.">
        <Toggle checked={settings.autostart} onChange={(v) => update({ autostart: v }, true)} />
      </Row>
    </section>
  );
}

function CaptureTab({ settings, setHotkey }: { settings: Settings; setHotkey: (hk: string) => void }) {
  const desktop = useDesktop();
  return (
    <section className="set-section">
      <h3>Globales Tastenkürzel</h3>
      <p className="set-text">Öffnet von überall ein kleines Fenster, in das du eine Idee, ein Todo oder einen Termin tippst. Der Eintrag landet in der Inbox – einsortieren kannst du ihn später.</p>
      <Row label="Tastenkürzel" hint="Klicken und die gewünschte Kombination drücken. Esc bricht ab.">
        <div className="set-inline">
          <ResetButton show={settings.hotkey !== DEFAULT_HOTKEY} onClick={() => setHotkey(DEFAULT_HOTKEY)} title="Standard wiederherstellen (Strg+Umschalt+Leertaste)" />
          <HotkeyInput value={settings.hotkey} onChange={setHotkey} />
        </div>
      </Row>
      {desktop === false && <Notice kind="warning">Das Tastenkürzel wirkt nur in der Desktop-App, nicht im Browser.</Notice>}
      <h3>So schreibst du schnell</h3>
      <div className="set-examples">
        <div>
          <code>Zahnarzt /morgen 14 uhr</code>
          <span>Termin morgen um 14 Uhr</span>
        </div>
        <div>
          <code>[] Bericht /fällig fr #arbeit</code>
          <span>Todo, fällig Freitag, mit Tag</span>
        </div>
        <div>
          <code>Jour fixe /jeden montag 9 uhr</code>
          <span>Wiederkehrender Termin</span>
        </div>
        <div>
          <code>Anruf /fr 10 uhr /erinnerung 15m</code>
          <span>Mit Erinnerung 15 Minuten vorher</span>
        </div>
        <div>
          <code>Feedback an @Anna</code>
          <span>Erwähnung einer Person</span>
        </div>
      </div>
      <h3>Von der Kommandozeile</h3>
      <pre className="set-code">hakobo add "Zahnarzt /morgen 14 uhr"{'\n'}hakobo add --to Projekte "Idee für später"</pre>
      <p className="set-text subtle">Läuft die App, landet der Eintrag sofort in der geöffneten Inbox; sonst schreibt der Befehl direkt ins Notizbuch.</p>
    </section>
  );
}

function RemindersTab({ settings, update }: TabProps) {
  const minutes = [5, 10, 15, 30, 60];
  return (
    <section className="set-section">
      <h3>Standard-Erinnerungen</h3>
      <Row label="Termine mit Uhrzeit" hint="Gilt, wenn ein Termin keine eigene Erinnerung hat.">
        <select
          className="select set-select"
          value={settings.eventReminderMinutes ?? 'off'}
          onChange={(e) => update({ eventReminderMinutes: e.target.value === 'off' ? null : Number(e.target.value) })}
        >
          <option value="off">Keine Erinnerung</option>
          {minutes.map((m) => (
            <option key={m} value={m}>
              {m === 60 ? '1 Stunde vorher' : `${m} Minuten vorher`}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Ganztägige Todos und Termine" hint="Erinnert am Morgen des Tages, z. B. an fällige Todos ohne Uhrzeit.">
        <div className="set-inline">
          <Toggle checked={settings.allDayReminders} onChange={(v) => update({ allDayReminders: v })} />
          <input
            className="input set-time"
            type="time"
            value={settings.allDayTime}
            disabled={!settings.allDayReminders}
            onChange={(e) => e.target.value && update({ allDayTime: e.target.value })}
            aria-label="Uhrzeit der Morgenerinnerung"
          />
        </div>
      </Row>
      <h3>Pro Eintrag</h3>
      <p className="set-text">
        Eine eigene Erinnerung setzt du mit <code>/erinnerung 15m</code>, <code>/erinnerung 1h</code> oder <code>/erinnerung morgen 8 uhr</code>. Sie steht dann als Feld <code>remind::</code> im Eintrag und ersetzt den Standard.
      </p>
      <p className="set-text subtle">Erinnerungen erscheinen als Windows-Benachrichtigung, solange Hakobo läuft (auch im Infobereich). Ein Klick öffnet den Eintrag.</p>
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

  const delays: [number, string][] = [
    [10, '10 Sekunden'],
    [30, '30 Sekunden'],
    [60, '1 Minute'],
    [300, '5 Minuten'],
  ];
  const intervals: [number, string][] = [
    [1, 'jede Minute'],
    [5, 'alle 5 Minuten'],
    [15, 'alle 15 Minuten'],
    [60, 'stündlich'],
  ];
  const running = !!sync?.running || busy !== null;

  return (
    <section className="set-section">
      <h3>Versionen</h3>
      <div className="set-card">
        <GitBranch size={18} className="set-card-icon" />
        <div>
          <div className="set-card-title">Jede Änderung wird automatisch als Version gesichert</div>
          <div className="set-row-hint">
            Letzte Version: {sync?.lastCommit ? `${relativeTime(sync.lastCommit)} (${formatDateTime(sync.lastCommit)})` : 'in dieser Sitzung noch keine'}
            {sync && sync.pending > 0 && ` · ${sync.pending} ${sync.pending === 1 ? 'Seite wartet' : 'Seiten warten'} auf die nächste Version`}
          </div>
        </div>
      </div>
      <Row label="Version anlegen nach" hint="So lange wartet Hakobo nach der letzten Änderung. Spätestens nach 5 Minuten wird immer gesichert.">
        <select className="select set-select" value={settings.commitDelaySecs} onChange={(e) => update({ commitDelaySecs: Number(e.target.value) })}>
          {delays.some(([v]) => v === settings.commitDelaySecs) ? null : <option value={settings.commitDelaySecs}>{settings.commitDelaySecs} Sekunden</option>}
          {delays.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Row>
      <p className="set-text subtle">Ältere Fassungen einer Seite findest du über das Menü der Seite → „Versionen“.</p>

      <h3>Synchronisation</h3>
      {gitCli === false && (
        <Notice kind="warning">
          <TriangleAlert size={15} /> Für die Synchronisation muss Git installiert sein (
          <a href="https://git-scm.com" target="_blank" rel="noreferrer">
            git-scm.com
          </a>
          ). Die lokalen Versionen funktionieren auch ohne.
        </Notice>
      )}
      <div className={`set-card${sync?.lastError ? ' is-error' : ''}`}>
        {remote ? <Cloud size={18} className="set-card-icon" /> : <CloudOff size={18} className="set-card-icon" />}
        <div className="set-card-main">
          <div className="set-card-title">{running ? 'Synchronisiere …' : remote ? 'Mit Remote verbunden' : 'Nur auf diesem Rechner'}</div>
          <div className="set-row-hint">
            {remote ? (
              <>
                <span className="mono">{remote}</span>
                <br />
                Zuletzt synchronisiert: {sync?.lastSync ? `${relativeTime(sync.lastSync)} (${formatDateTime(sync.lastSync)})` : 'noch nie'}
              </>
            ) : (
              'Trage ein Git-Repository ein, um das Notizbuch mit anderen Rechnern abzugleichen.'
            )}
          </div>
          {sync?.lastError && !running && <div className="set-card-error">{sync.lastError}</div>}
          {sync && sync.resolved.length > 0 && (
            <div className="set-row-hint">
              Automatisch zusammengeführt: <span className="mono">{sync.resolved.join(', ')}</span>
            </div>
          )}
        </div>
        {remote && (
          <button className="btn btn-sm" disabled={running} onClick={() => void run('sync', api.syncNow)}>
            <RefreshCw size={14} className={running ? 'spin' : undefined} /> Jetzt synchronisieren
          </button>
        )}
      </div>

      <label className="field set-field">
        Remote-Adresse
        <div className="set-inline">
          <input
            className="input mono"
            placeholder="z. B. git@github.com:name/notizen.git"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && url.trim() && url.trim() !== remote) void run('connect', () => api.setRemote(url.trim()));
            }}
            spellCheck={false}
          />
          <button className="btn btn-primary" disabled={!url.trim() || url.trim() === remote || running} onClick={() => void run('connect', () => api.setRemote(url.trim()))}>
            {busy === 'connect' ? 'Verbinde …' : remote ? 'Ändern' : 'Verbinden'}
          </button>
          {remote && (
            <button
              className="btn btn-danger"
              disabled={running}
              onClick={() => {
                if (confirm('Verbindung zum Remote trennen? Die Notizen und Versionen auf diesem Rechner bleiben erhalten.'))
                  void run('disconnect', async () => {
                    const s = await api.setRemote(null);
                    setUrl('');
                    return s;
                  });
              }}
            >
              Trennen
            </button>
          )}
        </div>
        <span className="field-hint">
          Hakobo nutzt die installierte Git-Kommandozeile mit deinen vorhandenen Anmeldedaten (SSH-Schlüssel oder Git Credential Manager für HTTPS). Beim ersten Verbinden werden die Notizen von hier und vom Remote zusammengeführt.
        </span>
      </label>
      {err && (
        <Notice kind="error">
          <TriangleAlert size={15} /> {err}
        </Notice>
      )}

      <Row label="Automatisch synchronisieren" hint="Holt und überträgt Änderungen regelmäßig und kurz nach jeder neuen Version.">
        <div className="set-inline">
          <Toggle checked={settings.syncEnabled} onChange={(v) => update({ syncEnabled: v })} />
          <select className="select set-select" value={settings.syncIntervalMinutes} disabled={!settings.syncEnabled} onChange={(e) => update({ syncIntervalMinutes: Number(e.target.value) })}>
            {intervals.some(([v]) => v === settings.syncIntervalMinutes) ? null : <option value={settings.syncIntervalMinutes}>alle {settings.syncIntervalMinutes} Minuten</option>}
            {intervals.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </Row>

      <h3>Zweites Gerät einrichten</h3>
      <p className="set-text">
        Auf dem anderen Rechner entweder in einem neuen, leeren Notizbuch hier dieselbe Remote-Adresse eintragen – oder im Terminal:
      </p>
      <pre className="set-code">hakobo clone git@github.com:name/notizen.git</pre>
      <p className="set-text subtle">Gleichzeitige Änderungen an derselben Seite werden zeilenweise zusammengeführt, ohne Konfliktmarker. Im ungünstigsten Fall stehen beide Fassungen einer Zeile untereinander.</p>
    </section>
  );
}

function VaultTab({ settings, vaultPath, defaultVault, restart, update }: TabProps & { vaultPath: string; defaultVault: string; restart: boolean }) {
  const [path, setPath] = useState(settings.vault ?? '');
  const [err, setErr] = useState<string | null>(null);
  const configured = settings.vault ?? '';
  return (
    <section className="set-section">
      <h3>Aktuelles Notizbuch</h3>
      <div className="set-card">
        <FolderOpen size={18} className="set-card-icon" />
        <div className="set-card-main">
          <div className="set-card-title mono set-path">{vaultPath}</div>
          <div className="set-row-hint">Ein normaler Ordner mit Markdown-Dateien und Git-Verlauf. Du kannst ihn auch mit einem Editor oder Obsidian öffnen.</div>
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
          Im Explorer öffnen
        </button>
      </div>
      {err && <Notice kind="error">{err}</Notice>}

      <h3>Anderen Ordner verwenden</h3>
      <label className="field set-field">
        Ordner
        <div className="set-inline">
          <input className="input mono" placeholder={defaultVault} value={path} onChange={(e) => setPath(e.target.value)} spellCheck={false} />
          <button className="btn" disabled={path.trim() === configured} onClick={() => update({ vault: path.trim() || null }, true)}>
            Übernehmen
          </button>
        </div>
        <span className="field-hint">
          Leer lassen für den Standardordner <span className="mono">{defaultVault}</span>. Ein neuer Ordner wird beim nächsten Start angelegt; er wird automatisch versioniert.
        </span>
      </label>
      {restart && <Notice kind="info">Wirksam nach einem Neustart von Hakobo.</Notice>}
    </section>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Enter', 'Neuer Eintrag / Zeile teilen'],
  ['Tab / Umschalt+Tab', 'Einrücken / Ausrücken'],
  ['Strg+Enter', 'Todo erledigen (oder zum Todo machen)'],
  ['Umschalt+Enter', 'Notiz bearbeiten'],
  ['Alt+→ / Alt+←', 'Hinein- / herauszoomen'],
  ['Strg+↑ / Strg+↓', 'Zuklappen / aufklappen'],
  ['Alt+Umschalt+↑ / ↓', 'Eintrag verschieben'],
  ['Strg+M', 'Einsortieren'],
  ['Strg+K', 'Suchen'],
  ['Strg+N', 'Schnell erfassen'],
  ['Strg+Z / Strg+Y', 'Rückgängig / Wiederholen'],
  ['/', 'Befehle: Termin, Fällig, Wiederholung, Erinnerung …'],
  ['@  #  [[', 'Person erwähnen, Tag, Link'],
];

const CLI: [string, string][] = [
  ['hakobo add "…"', 'In die Inbox erfassen (mit /Befehlen)'],
  ['hakobo agenda', 'Termine und fällige Todos'],
  ['hakobo search "…"', 'Fuzzy-Suche mit Filtern'],
  ['hakobo inbox', 'Inbox anzeigen'],
  ['hakobo sync', 'Jetzt synchronisieren'],
  ['hakobo clone <url>', 'Notizbuch auf ein weiteres Gerät holen'],
  ['hakobo serve', 'Als Server für den Browser starten'],
];

function AboutTab() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    api.info().then(setInfo, () => undefined);
  }, []);
  return (
    <section className="set-section">
      <div className="set-about">
        <img src="/favicon.svg" alt="" width={44} height={44} />
        <div>
          <div className="set-about-name">Hakobo {info?.version ?? ''}</div>
          <div className="set-row-hint">Notizen, Todos und Termine als Outline – lokal als Markdown, versioniert mit Git.</div>
        </div>
      </div>
      {info && (
        <dl className="set-facts">
          <dt>Rechner</dt>
          <dd>{info.host}</dd>
          <dt>Notizbuch</dt>
          <dd className="mono">{info.vault}</dd>
          <dt>Git</dt>
          <dd>{info.gitCli ? 'installiert – Synchronisation möglich' : 'nicht gefunden – nur lokale Versionen'}</dd>
        </dl>
      )}
      <h3>Tastenkürzel</h3>
      <table className="set-table">
        <tbody>
          {SHORTCUTS.map(([k, d]) => (
            <tr key={k}>
              <td>
                {k.split(' / ').map((part, i) => (
                  <span key={i}>
                    {i > 0 && ' / '}
                    <kbd>{part}</kbd>
                  </span>
                ))}
              </td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Kommandozeile</h3>
      <table className="set-table">
        <tbody>
          {CLI.map(([c, d]) => (
            <tr key={c}>
              <td>
                <code>{c}</code>
              </td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
