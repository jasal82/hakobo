// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Texte (Deutsch): dialogs – Suche, Einsortieren, Zuordnen, Versionen, Bildansicht.

import { fmtNum, plural } from '..';

export const dialogs = {
  /** Titel der Wurzel (wie ihn die Suche zeigt). */
  notebook: 'Notizbuch',
  keyCtrl: 'Strg',
  keyShift: 'Umschalt',
  search: {
    /** Filter-Chips: [eingefügter Text, Beschriftung, Tooltip]. */
    hints: [
      ['#', '#tag', 'mit Tag (auch Unter-Tags)'],
      ['-#', '-#tag', 'ohne Tag'],
      ['is:open ', 'is:open', 'offene Todos'],
      ['is:done ', 'is:done', 'erledigte Todos'],
      ['has:date ', 'has:date', 'mit Datum'],
      ['date:heute ', 'date:heute', 'heute fällig'],
      ['date:woche ', 'date:woche', 'nächste 7 Tage'],
      ['in:', 'in:Seite', 'unterhalb einer Seite'],
      ['"', '"genaue Phrase"', 'wörtlich'],
    ] as [string, string, string][],
    placeholder: 'Suchen … z. B. rechnung #kunde is:open',
    recent: 'Zuletzt geöffnet',
    noHits: 'Keine Treffer.',
    noHitsTip: 'Tipp: Wörter dürfen unvollständig sein („rech kund“), Tippfehler werden toleriert, Filter wie #tag oder is:open grenzen ein.',
    prompt: 'Tippen, um Seiten, Einträge, Notizen und Code zu durchsuchen.',
    keySelect: 'wählen',
    keyOpen: 'öffnen',
    keyZoom: 'hineinzoomen',
    keyCopyLink: 'Link kopieren',
    /** Anzahl Treffer; `capped`: es gibt mehr als angezeigt („60+ Treffer“). */
    results: (n: number, capped: boolean) => (capped ? `${fmtNum(n)}+ Treffer` : plural(n, { one: '# Treffer', other: '# Treffer' })),
    noPreview: 'Keine Vorschau',
    empty: '(leer)',
    codeBlock: 'Codeblock',
    moreEntries: '… weitere Einträge',
    noContent: 'Keine Notiz und keine Unterpunkte.',
    backlinks: (n: number) => plural(n, { one: '# Verweis', other: '# Verweise' }),
    zoomIn: 'Hineinzoomen',
    linkCopied: (link: string) => `Link kopiert: ${link}`,
  },
  move: {
    title: 'Einsortieren:',
    /** Hinter dem ersten Titel, mit führendem Leerzeichen. */
    more: (n: number) => ` und ${fmtNum(n)} weitere`,
    placeholder: 'Ziel suchen: Seite oder Eintrag …',
    section: 'Seiten und zuletzt genutzte Ziele',
    currentPlace: 'aktueller Ort',
    newPage: (name: string) => `Neue Seite „${name}“`,
    newPageHint: 'in der obersten Ebene anlegen und hineinschieben',
    noTarget: 'Kein passendes Ziel.',
    keyMove: 'verschieben',
    keyMoveJump: 'verschieben und hinspringen',
    keyCancel: 'abbrechen',
  },
  assign: {
    title: 'Zuordnen:',
    done: 'Fertig',
    none: 'Noch keine Tags oder Links.',
    placeholder: 'Tag, Projekt, Person oder Seite … (# nur Tags, @ nur Personen)',
    newTag: (tag: string) => `Neuer Tag #${tag}`,
    type: (label: string) => `Typ ${label}`,
    nothing: 'Nichts gefunden.',
    prompt: 'Tippen, um Tags (auch verschachtelt wie projekte/sqonto) oder Seiten zu finden.',
    keyAssign: 'zuordnen',
    keyLinkMove: 'verlinken und dorthin einsortieren',
    keyDone: 'fertig',
  },
  history: {
    edited: 'Bearbeitet',
    together: (list: string) => `zusammen mit ${list}`,
    synced: 'Von anderem Gerät übernommen',
    restored: 'Ältere Fassung wiederhergestellt',
    version: 'Version',
    same: 'Diese Version stimmt mit dem aktuellen Stand überein.',
    unchanged: (n: number) => plural(n, { one: '# unveränderte Zeile', other: '# unveränderte Zeilen' }),
    confirmRestore: (when: string) => `Die Fassung vom ${when} wiederherstellen? Der aktuelle Stand bleibt als Version erhalten.`,
    title: (name: string) => `Versionen von „${name}“`,
    noVersions: 'Noch keine Versionen',
    noVersionsHint: 'Versionen entstehen automatisch kurz nach dem Bearbeiten. Schau gleich noch einmal vorbei.',
    versions: 'Versionen',
    current: 'Aktueller Stand',
    currentHint: 'so wie die Seite jetzt ist',
    tabDiff: 'Änderungen bis heute',
    tabText: 'Inhalt damals',
    restoring: 'Stelle wieder her …',
    restore: 'Diese Version wiederherstellen',
    pick: 'Wähle links eine Version, um zu sehen, was sich seitdem geändert hat.',
    missing: 'In dieser Version gab es die Seite noch nicht (oder sie hieß anders).',
    legendDel: (when: string) => `− nur in der Version vom ${when}`,
    legendAdd: '+ seitdem hinzugekommen',
  },
  image: {
    fallback: 'Bild',
    openDefault: 'Mit Standard-App öffnen',
    openOriginal: 'Original öffnen',
  },
};
