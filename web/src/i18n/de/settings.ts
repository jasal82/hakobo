// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Texte (Deutsch): settings
//
// In längeren Texten markieren `{…}` eine Taste (<kbd>) und `…` (Backticks)
// Code (<code>), siehe `rich()` in SettingsDialog.tsx.

import { plural } from '..';

const p = (n: number) => String(n).padStart(2, '0');

export const settings = {
  title: 'Einstellungen',
  tabs: {
    general: 'Allgemein',
    capture: 'Schnellerfassung',
    reminders: 'Erinnerungen',
    sync: 'Versionen & Sync',
    vault: 'Notizbuch',
    updates: 'Updates',
    about: 'Über Hakobo',
  },
  newVersionDot: 'Neue Version verfügbar',
  saving: 'Speichert …',
  savedInstantly: 'Änderungen werden sofort gespeichert',

  zoom: {
    label: 'Schriftgröße',
    note: 'Vergrößert Text und Bedienelemente der ganzen App, auch das Erfassungsfenster. Schneller geht es mit {Strg} {+} / {−}, {Strg} {0} oder {Strg} + Mausrad.',
    reset: 'Auf 100 % zurücksetzen',
    smaller: 'Kleiner',
    larger: 'Größer',
    percent: (n: number) => `${n} %`,
    defaultSuffix: ' (Standard)',
  },

  general: {
    appearance: 'Darstellung',
    language: 'Sprache',
    languageSystem: 'Systemsprache',
    /** `name`: Sprache, die „Systemsprache“ gerade ergibt (Deutsch/English). */
    /** Sprachnamen für den Hinweis (in der Auswahl stehen die Eigenbezeichnungen). */
    languageNames: { de: 'Deutsch', en: 'Englisch' },
    languageHint: (name: string) => `„Systemsprache“ folgt Windows – derzeit ${name}.`,
    theme: 'Farbschema',
    themeHint: '„System“ folgt der Einstellung von Windows.',
    themeSystem: 'System',
    themeLight: 'Hell',
    themeDark: 'Dunkel',
    program: 'Programm',
    closeToTray: 'Beim Schließen im Infobereich weiterlaufen',
    closeToTrayHint: 'Nötig, damit Tastenkürzel und Erinnerungen auch bei geschlossenem Fenster funktionieren.',
    autostart: 'Mit Windows starten',
    autostartHint: 'Hakobo startet unsichtbar im Infobereich, damit die Schnellerfassung sofort bereitsteht.',
  },

  capture: {
    globalHotkey: 'Globales Tastenkürzel',
    intro: 'Öffnet von überall ein kleines Fenster, in das du eine Idee, ein Todo oder einen Termin tippst. Der Eintrag landet in der Inbox – einsortieren kannst du ihn später.',
    hotkey: 'Tastenkürzel',
    hotkeyHint: 'Klicken und die gewünschte Kombination drücken. Esc bricht ab.',
    /** `keys`: Standardkürzel in Anzeigeform („Strg+Umschalt+Leertaste“). */
    restoreDefault: (keys: string) => `Standard wiederherstellen (${keys})`,
    desktopOnly: 'Das Tastenkürzel wirkt nur in der Desktop-App, nicht im Browser.',
    howTo: 'So schreibst du schnell',
    examples: [
      ['Zahnarzt /morgen 14 uhr', 'Termin morgen um 14 Uhr'],
      ['[] Bericht /fällig fr #arbeit', 'Todo, fällig Freitag, mit Tag'],
      ['Jour fixe /jeden montag 9 uhr', 'Wiederkehrender Termin'],
      ['Anruf /fr 10 uhr /erinnerung 15m', 'Mit Erinnerung 15 Minuten vorher'],
      ['Feedback an @Anna', 'Erwähnung einer Person'],
    ] as [string, string][],
    fromCli: 'Von der Kommandozeile',
    cliExample: 'hakobo add "Zahnarzt /morgen 14 uhr"\nhakobo add --to Projekte "Idee für später"',
    cliNote: 'Läuft die App, landet der Eintrag sofort in der geöffneten Inbox; sonst schreibt der Befehl direkt ins Notizbuch.',
  },

  hotkey: {
    /** Tastennamen in der Anzeige eines Kürzels (gespeichert wird englisch, z. B. `Ctrl+Shift+Space`). */
    keys: {
      Ctrl: 'Strg',
      Shift: 'Umschalt',
      Space: 'Leertaste',
      Backspace: 'Rück',
      Delete: 'Entf',
      Insert: 'Einfg',
      Home: 'Pos1',
      End: 'Ende',
      PageUp: 'Bild↑',
      PageDown: 'Bild↓',
    },
    needsModifier: 'Bitte mit Strg, Alt oder Win kombinieren.',
    record: 'Tastenkürzel aufnehmen',
    prompt: 'Tastenkombination drücken …',
    none: 'Kein Kürzel',
  },

  reminders: {
    defaults: 'Standard-Erinnerungen',
    events: 'Termine mit Uhrzeit',
    eventsHint: 'Gilt, wenn ein Termin keine eigene Erinnerung hat.',
    off: 'Keine Erinnerung',
    hourBefore: '1 Stunde vorher',
    minutesBefore: (n: number) => plural(n, { one: '# Minute vorher', other: '# Minuten vorher' }),
    allDay: 'Ganztägige Todos und Termine',
    allDayHint: 'Erinnert am Morgen des Tages, z. B. an fällige Todos ohne Uhrzeit.',
    allDayTime: 'Uhrzeit der Morgenerinnerung',
    perEntry: 'Pro Eintrag',
    perEntryText: 'Eine eigene Erinnerung setzt du mit `/erinnerung 15m`, `/erinnerung 1h` oder `/erinnerung morgen 8 uhr`. Sie steht dann als Feld `remind::` im Eintrag und ersetzt den Standard.',
    notifications: 'Erinnerungen erscheinen als Windows-Benachrichtigung, solange Hakobo läuft (auch im Infobereich). Ein Klick öffnet den Eintrag.',
  },

  sync: {
    versions: 'Versionen',
    autoVersions: 'Jede Änderung wird automatisch als Version gesichert',
    lastVersion: (when: string) => `Letzte Version: ${when}`,
    noVersionYet: 'in dieser Sitzung noch keine',
    pending: (n: number) => plural(n, { one: ' · # Seite wartet auf die nächste Version', other: ' · # Seiten warten auf die nächste Version' }),
    commitAfter: 'Version anlegen nach',
    commitAfterHint: 'So lange wartet Hakobo nach der letzten Änderung. Spätestens nach 5 Minuten wird immer gesichert.',
    seconds: (n: number) => plural(n, { one: '# Sekunde', other: '# Sekunden' }),
    minutes: (n: number) => plural(n, { one: '# Minute', other: '# Minuten' }),
    olderVersions: 'Ältere Fassungen einer Seite findest du über das Menü der Seite → „Versionen“.',
    sync: 'Synchronisation',
    gitMissingBefore: 'Für die Synchronisation muss Git installiert sein (',
    gitMissingAfter: '). Die lokalen Versionen funktionieren auch ohne.',
    syncing: 'Synchronisiere …',
    connected: 'Mit Remote verbunden',
    localOnly: 'Nur auf diesem Rechner',
    lastSync: (when: string) => `Zuletzt synchronisiert: ${when}`,
    never: 'noch nie',
    noRemote: 'Trage ein Git-Repository ein, um das Notizbuch mit anderen Rechnern abzugleichen.',
    merged: 'Automatisch zusammengeführt: ',
    syncNow: 'Jetzt synchronisieren',
    remote: 'Remote-Adresse',
    remotePlaceholder: 'z. B. git@github.com:name/notizen.git',
    connecting: 'Verbinde …',
    change: 'Ändern',
    connect: 'Verbinden',
    disconnectConfirm: 'Verbindung zum Remote trennen? Die Notizen und Versionen auf diesem Rechner bleiben erhalten.',
    disconnect: 'Trennen',
    remoteHint:
      'Hakobo nutzt die installierte Git-Kommandozeile mit deinen vorhandenen Anmeldedaten (SSH-Schlüssel oder Git Credential Manager für HTTPS). Beim ersten Verbinden werden die Notizen von hier und vom Remote zusammengeführt.',
    auto: 'Automatisch synchronisieren',
    autoHint: 'Holt und überträgt Änderungen regelmäßig und kurz nach jeder neuen Version.',
    everyMinutes: (n: number) => plural(n, { one: 'jede Minute', other: 'alle # Minuten' }),
    hourly: 'stündlich',
    secondDevice: 'Zweites Gerät einrichten',
    secondDeviceText: 'Auf dem anderen Rechner entweder in einem neuen, leeren Notizbuch hier dieselbe Remote-Adresse eintragen – oder im Terminal:',
    cloneExample: 'hakobo clone git@github.com:name/notizen.git',
    mergeNote: 'Gleichzeitige Änderungen an derselben Seite werden zeilenweise zusammengeführt, ohne Konfliktmarker. Im ungünstigsten Fall stehen beide Fassungen einer Zeile untereinander.',
  },

  vault: {
    current: 'Aktuelles Notizbuch',
    currentHint: 'Ein normaler Ordner mit Markdown-Dateien und Git-Verlauf. Du kannst ihn auch mit einem Editor oder Obsidian öffnen.',
    openFolder: 'Im Explorer öffnen',
    other: 'Anderen Ordner verwenden',
    folder: 'Ordner',
    apply: 'Übernehmen',
    /** Hinweis um den Standardordner herum: vorher + Pfad + nachher. */
    defaultBefore: 'Leer lassen für den Standardordner ',
    defaultAfter: '. Ein neuer Ordner wird beim nächsten Start angelegt; er wird automatisch versioniert.',
    restart: 'Wirksam nach einem Neustart von Hakobo.',
  },

  updates: {
    version: 'Version',
    checkFailed: (msg: string) => `Prüfung fehlgeschlagen: ${msg}`,
    installFailed: (msg: string) => `Update nicht möglich: ${msg}`,
    installConfirm: (v: string) => `Hakobo ${v} installieren?\n\nHakobo wird für das Update beendet und startet danach von selbst neu. Deine Notizen bleiben, wie sie sind.`,
    checkedAgo: (rel: string) => `Zuletzt geprüft ${rel}`,
    neverChecked: 'Noch nicht nach Updates gesucht',
    checkNow: 'Jetzt prüfen',
    upToDate: 'Hakobo ist auf dem neuesten Stand.',
    newVersion: (v: string) => `Neue Version ${v}`,
    publishedOn: (d: Date) => `veröffentlicht am ${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`,
    /** `err` kommt vom Server (endet mit Punkt). */
    failed: (err: string) => `Das Update ist fehlgeschlagen: ${err} Die bisherige Version ist unverändert.`,
    /** `note` kommt vom Server. */
    installNoteWithSize: (note: string, size: string) => `${note} Download: ${size}.`,
    installNow: 'Jetzt aktualisieren',
    viewOnGithub: 'Auf GitHub ansehen',
    downloadOnGithub: 'Zum Download auf GitHub',
    skip: 'Diese Version überspringen',
    skipped: 'An diese Version wird nicht mehr erinnert.',
    remindAgain: 'Wieder erinnern',
    automatic: 'Automatisch',
    autoCheck: 'Automatisch nach Updates suchen',
    autoCheckHint: 'Hakobo fragt beim Start und danach täglich bei GitHub nach der neuesten Version. Dabei werden keine Daten aus deinen Notizen übertragen.',
  },

  /** Fortschritt und Hinweis außerhalb der Einstellungen (UpdateProgress.tsx). */
  progress: {
    title: (v: string) => `Update auf Hakobo ${v}`,
    downloading: 'Die neue Version wird heruntergeladen und geprüft …',
    percentOf: (pct: number, size: string) => `${pct} % von ${size}`,
    installing: 'Wird installiert …',
    stuck: 'Hakobo wurde beendet, meldet sich aber noch nicht zurück. Falls es nicht von selbst startet, bitte Hakobo neu starten.',
    restarting: 'Hakobo wird neu gestartet – gleich geht es mit der neuen Version weiter.',
    available: (latest: string, current: string) => `Hakobo ${latest} ist verfügbar (installiert: ${current}).`,
    view: 'Ansehen',
  },

  about: {
    tagline: 'Notizen, Todos und Termine als Outline – lokal als Markdown, versioniert mit Git.',
    host: 'Rechner',
    vault: 'Notizbuch',
    git: 'Git',
    gitInstalled: 'installiert – Synchronisation möglich',
    gitMissing: 'nicht gefunden – nur lokale Versionen',
    license: 'Lizenz',
    licenseText: 'Freie Software unter der GNU Affero General Public License, Version 3 oder später',
    source: 'Quellcode',
    shortcuts: 'Tastenkürzel',
    cli: 'Kommandozeile',
    cliCommands: {
      add: 'In die Inbox erfassen (mit /Befehlen)',
      agenda: 'Termine und fällige Todos',
      search: 'Fuzzy-Suche mit Filtern',
      inbox: 'Inbox anzeigen',
      sync: 'Jetzt synchronisieren',
      clone: 'Notizbuch auf ein weiteres Gerät holen',
      serve: 'Als Server für den Browser starten',
    },
  },
};
