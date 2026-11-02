// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Texte (Deutsch): views

import { plural } from '..';

export const views = {
  agenda: {
    /** Mehrtägiger Termin: „bis Fr 30.10. 14:00“ */
    until: (day: string) => `bis ${day}`,
    allDay: 'ganztägig',
    /** Toast nach der Schnelleingabe: „In der Inbox: Zahnarzt · Termin: Morgen 14:00“ */
    addedToInbox: (text: string) => `In der Inbox: ${text}`,
    todoChip: 'Todo',
    repeat: 'Wiederholung',
    days: (n: number) => plural(n, { one: '# Tag', other: '# Tage' }),
    showDone: 'Erledigte',
    quickPlaceholder: 'Neuer Termin oder Todo … z. B. „Zahnarzt /morgen 14 uhr“ oder „[] Bericht /fällig fr“',
    overdue: 'Überfällig',
    nothingPlanned: 'Nichts geplant',
    emptyTitle: 'Keine Termine und fälligen Todos',
    /** Leerer Zustand, mit Beispielen als <kbd> dazwischen. */
    emptyBefore: 'Termine entstehen, sobald ein Eintrag ein Datum bekommt – im Text mit',
    emptyExamples: ['/morgen 14 uhr', '/fällig fr', '/jeden montag'],
    /** Zwischen dem vorletzten und letzten Beispiel (mit Leerzeichen). */
    emptyOr: ' oder ',
  },
  calendar: {
    switchLabel: 'Kalenderansicht',
    dateNotRecognized: 'Datum oder Uhrzeit nicht erkannt',
    eventCreated: (text: string) => `Termin angelegt (Inbox): ${text}`,
    newEvent: 'Neuer Termin',
    titlePlaceholder: 'Titel, z. B. Abstimmung mit @Anna',
    title: 'Titel',
    time: 'Uhrzeit',
    timePlaceholder: 'ganztägig',
    timeHint: 'z. B. 14:00, 9-10:30 oder leer für ganztägig',
    from: 'Von',
    to: 'Bis',
    dateFromText: 'Datum aus dem Text',
    notRecognized: 'Nicht erkannt',
    landsInInbox: 'Landet in der Inbox.',
    create: 'Anlegen',
    /** Kopf der Spalte mit den Kalenderwochen */
    weekShort: 'KW',
    /** „KW 44“ */
    weekNo: (n: number) => `KW ${n}`,
    clickOrDrag: 'Klicken oder über mehrere Tage ziehen: neuer Termin',
    prevMonth: 'Voriger Monat',
    nextMonth: 'Nächster Monat',
    prevWeek: 'Vorige Woche',
    nextWeek: 'Nächste Woche',
    /** Tooltip mit Tastenkürzel: „Voriger Monat (Bild↑)“ */
    withKey: (label: string, up: boolean) => `${label} (${up ? 'Bild↑' : 'Bild↓'})`,
    gridLabel: (title: string) => `${title}: Pfeiltasten wählen einen Tag, Umschalt mehrere, Enter legt einen Termin an`,
    viewWeek: 'Diese Woche ansehen',
    more: (n: number) => `+${n} weitere`,
    newEventOn: (day: string) => `Neuer Termin am ${day} (ziehen: mehrere Tage)`,
    allDay: 'ganztägig',
    dragOrDoubleClick: 'Ziehen oder Doppelklick: neuer Termin',
  },
  todo: {
    noText: '(ohne Text)',
    doneRecent: 'Erledigt (letzte 14 Tage)',
    overdue: 'Überfällig',
    doing: 'In Arbeit',
    next7: 'Nächste 7 Tage',
    later: 'Später',
    noPage: 'Ohne Seite',
    undated: (page: string) => `Ohne Datum · ${page}`,
    created: 'Todo in der Inbox angelegt',
    open: 'Offen',
    newPlaceholder: 'Neues Todo … /fällig fr #tag',
    filterPlaceholder: 'Filtern … #tag oder Text',
    nothingOpen: 'Nichts offen',
    nothingDone: 'Noch nichts erledigt',
    emptyHint: 'Todos entstehen mit „[ ]“, Strg+Enter oder „/todo“ in jeder Zeile.',
  },
  node: {
    path: 'Pfad',
    notebook: 'Notizbuch',
    backlinks: 'Verweise',
    empty: '(leer)',
    copied: (n: number) => plural(n, { one: '# Eintrag kopiert', other: '# Einträge kopiert' }),
    gone: 'Diesen Eintrag gibt es nicht mehr.',
    toNotebook: 'Zum Notizbuch',
    onlyImages: 'Nur Bilder lassen sich hier ablegen',
    editTitle: 'Titel bearbeiten',
    pageTitle: 'Seitentitel',
    codeBlock: 'Codeblock',
    actions: 'Aktionen',
    actionsHint: 'Aktionen (Umschalt+F10)',
    note: 'Notiz',
    subpage: 'Unterseite',
    versions: 'Versionen',
    move: 'Einsortieren',
    assign: 'Zuordnen',
    /** Hinweis in der Inbox: „Alles Neue landet hier. Einsortieren verschiebt … (Strg M), Zuordnen vergibt … (# @), / setzt Termine.“ */
    inboxIntro: 'Alles Neue landet hier.',
    inboxMoveDesc: 'verschiebt einen Eintrag an seinen Platz',
    inboxAssignDesc: 'vergibt Tags oder Links',
    inboxSlashDesc: 'setzt Termine.',
    ctrl: 'Strg',
    emptyInbox: 'Die Inbox ist leer. Neue Ideen mit Strg+Umschalt+Leertaste, Strg+N oder hier.',
    emptyRoot: 'Noch keine Seiten. Klicke hier, um die erste anzulegen.',
    emptyPage: 'Leer. Klicke hier oder drücke Enter im Titel, um zu schreiben.',
    newPage: 'Neue Seite',
    newEntry: 'Neuer Eintrag',
  },
};
