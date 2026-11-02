// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Texte (Deutsch): types (Typen, Tabellenansicht eines Typs, Tag-Ansicht)

import { plural } from '..';

export const types = {
  /** Eintrag ohne Text. */
  empty: '(leer)',
  filter: 'Filtern …',

  // Tabellenansicht eines Typs (views/TypeView.tsx)
  view: {
    notFound: (type: string) => `Den Typ „${type}“ gibt es nicht (mehr)`,
    entriesWith: (tag: string) => `Einträge mit #${tag}`,
    create: 'Typ anlegen',
    asList: 'Als Liste',
    edit: 'Typ bearbeiten',
    title: 'Titel',
    whereTitle: 'Wo der Eintrag steht',
    yes: 'ja',
    no: 'nein',
    created: (text: string, where: string) => `„${text}“ angelegt unter ${where}`,
    newPlaceholder: (label: string, where: string) => `Neu: ${label} … (landet in ${where})`,
    // Hinweis ohne Einträge: [A] #tag [B] / [C]
    hintA: (label: string) => `Noch keine Einträge vom Typ ${label}. Schreibe `,
    hintB: ' in einen beliebigen Eintrag, wähle im Editor ',
    hintC: (label: string) => ` → „Typ: ${label}“ oder lege oben direkt einen an.`,
  },

  // Alle Einträge mit einem Tag (views/TagView.tsx)
  tag: {
    count: (n: number) => plural(n, { one: '# Eintrag', other: '# Einträge' }),
    asTable: 'Als Tabelle',
    makeTypeTitle: 'Felder für diesen Tag festlegen',
    makeType: 'Zum Typ machen …',
    all: 'Alle',
    open: 'Offen',
    nothing: (tag: string) => `Noch nichts mit #${tag}`,
    help: (tag: string) => `Tags schreibst du direkt in den Text, z. B. „Idee #${tag}“ – nach dem # schlägt Hakobo vorhandene Tags vor. Verschachteln mit „/“: #${tag}/unterthema.`,
    noMatches: 'Keine Treffer für diesen Filter',
    noPage: 'Ohne Seite',
  },

  // Dialog zum Anlegen und Bearbeiten eines Typs (views/parts/TypeEditor.tsx)
  editor: {
    labelMissing: 'Bitte eine Bezeichnung angeben.',
    fieldN: (n: number) => `Feld ${n}`,
    keyMissing: (field: string) => `${field}: Schlüssel fehlt.`,
    keyInvalid: (field: string, key: string) => `${field}: Schlüssel „${key}“ darf nur Buchstaben, Ziffern, _ und - enthalten.`,
    keyReserved: (field: string, key: string) => `${field}: „${key}“ ist für eingebaute Felder reserviert.`,
    keyDuplicate: (field: string, key: string) => `${field}: Schlüssel „${key}“ kommt doppelt vor.`,
    selectNeedsOption: (field: string) => `${field}: Auswahl braucht mindestens eine Option.`,
    created: (label: string) => `Typ „${label}“ angelegt`,
    saved: (label: string) => `Typ „${label}“ gespeichert`,
    deleted: 'Typ gelöscht',
    confirmDelete: (label: string, tag: string) => `Typ „${label}“ löschen? Die Tags #${tag} und alle Feldwerte in den Notizen bleiben erhalten.`,
    createTitle: (tag: string) => `Typ für #${tag} anlegen`,
    editTitle: (label: string) => `Typ „${label}“ bearbeiten`,
    deleteType: 'Typ löschen',
    create: 'Anlegen',
    // Einleitung: [A] #tag [B] date [C]
    introA: 'Jeder Eintrag mit ',
    introB: ' bekommt diese Felder. Ein Feld mit dem Schlüssel ',
    introC: ' ist das eingebaute Datum und erscheint in der Agenda.',
    label: 'Bezeichnung',
    defaultPage: 'Standardseite',
    defaultPagePlaceholder: 'z. B. Personen',
    defaultPageHint: 'Hier landen neue Einträge dieses Typs.',
    color: 'Farbe',
    fields: 'Felder',
    addField: 'Feld hinzufügen',
    noFields: 'Noch keine Felder. Auch ohne Felder färbt ein Typ die Aufzählungspunkte und bekommt eine Tabellenansicht.',
    key: 'Schlüssel',
    kind: 'Art',
    options: 'Optionen',
    keyPlaceholder: 'z. B. kunde',
    optionsPlaceholder: 'offen, aktiv, fertig',
    targetTitle: 'Nur Einträge dieses Typs vorschlagen',
    anyTarget: 'beliebig',
    thisType: (name: string) => `${name} (dieser)`,
    multipleTitle: 'Mehrere Verweise erlauben',
    multiple: 'mehrere',
    dateTip: 'Tipp: Schlüssel „date“ erscheint in der Agenda',
    moveUp: 'Nach oben',
    moveDown: 'Nach unten',
    removeField: 'Feld entfernen',
  },

  /** Farben eines Typs (gespeichert wird der Schlüssel). */
  colors: {
    violet: 'Violett',
    blue: 'Blau',
    green: 'Grün',
    orange: 'Orange',
    red: 'Rot',
    pink: 'Pink',
    teal: 'Petrol',
    yellow: 'Gelb',
    gray: 'Grau',
  } as Record<string, string>,

  /** Feldarten (gespeichert wird der Schlüssel). */
  kinds: {
    text: 'Text',
    number: 'Zahl',
    date: 'Datum',
    select: 'Auswahl',
    ref: 'Verweis',
    url: 'Link (URL)',
    email: 'E-Mail',
    phone: 'Telefon',
    checkbox: 'Ja/Nein',
  },
};
