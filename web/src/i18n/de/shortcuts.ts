// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Texte (Deutsch): shortcuts

export type ShortcutGroup = { title: string; keys: [string, string][] };

export const shortcuts = {
  title: 'Tastenkürzel',
  list: 'Liste der Tastenkürzel',
  /** Gruppen aus [Tasten, Beschreibung]; Alternativen sind mit „ / “ getrennt. */
  groups: [
    {
      title: 'Überall',
      keys: [
        ['Strg+K', 'Suchen'],
        ['Strg+N', 'Schnell erfassen'],
        ['Strg+1 … Strg+5', 'Inbox, Agenda, Todos, Kalender, Notizbuch'],
        ['F6 / Umschalt+F6', 'Zwischen Titelleiste, Seitenleiste und Inhalt wechseln'],
        ['Alt+← / Alt+→', 'Zurück / Vor (außerhalb des Editors)'],
        ['Strg+\\', 'Seitenleiste ein- oder ausblenden'],
        ['Strg+,', 'Einstellungen'],
        ['Strg++ / Strg+- / Strg+0', 'Schrift größer / kleiner / zurücksetzen'],
        ['Esc', 'Dialog, Menü oder Bearbeitung schließen'],
        ['F1', 'Diese Übersicht'],
      ],
    },
    {
      title: 'Gliederung',
      keys: [
        ['↑ / ↓', 'Vorheriger / nächster Eintrag (auch: zurück in die Gliederung)'],
        ['Enter', 'Neuer Eintrag / Zeile teilen'],
        ['Tab / Umschalt+Tab', 'Einrücken / Ausrücken'],
        ['Strg+Enter', 'Todo erledigen (oder zum Todo machen)'],
        ['Strg+Umschalt+Enter', 'Todo an / aus'],
        ['Umschalt+Enter', 'Notiz bearbeiten (Esc oder Umschalt+Enter zurück)'],
        ['Alt+→ / Alt+Enter / Strg+.', 'Hineinzoomen'],
        ['Alt+←', 'Herauszoomen'],
        ['Strg+↑ / Strg+↓', 'Zuklappen / aufklappen'],
        ['Alt+Umschalt+↑ / Alt+Umschalt+↓', 'Eintrag verschieben'],
        ['Umschalt+↑ / Umschalt+↓', 'Am Zeilenrand: Einträge auswählen'],
        ['Strg+M', 'Einsortieren'],
        ['Strg+O', 'Link, Tag oder Webadresse am Cursor öffnen'],
        ['Strg+L', 'Link auf den Eintrag kopieren'],
        ['Strg+B / Strg+I', 'Fett / kursiv'],
        ['Strg+Umschalt+Entf', 'Eintrag löschen'],
        ['Umschalt+F10 / Menütaste', 'Aktionsmenü des Eintrags'],
        ['Strg+Z / Strg+Y', 'Rückgängig / Wiederholen'],
        ['/', 'Befehle: Termin, Fällig, Wiederholung, Erinnerung …'],
        ['@ / # / [[', 'Person erwähnen, Tag, Link'],
      ],
    },
    {
      title: 'Ausgewählte Einträge',
      keys: [
        ['Umschalt+↑ / Umschalt+↓', 'Auswahl erweitern'],
        ['Tab / Umschalt+Tab', 'Einrücken / Ausrücken'],
        ['Strg+Enter', 'Erledigen'],
        ['Strg+M', 'Einsortieren'],
        ['Strg+C / Strg+X', 'Kopieren / Ausschneiden (als Markdown)'],
        ['Entf', 'Löschen'],
        ['Enter / Esc', 'Bearbeiten / Auswahl aufheben'],
      ],
    },
    {
      title: 'Listen, Menüs und Tabellen',
      keys: [
        ['↑ / ↓ / Pos1 / Ende', 'Durch Seitenleiste, Listen und Menüs gehen'],
        ['→ / ←', 'Seitenleiste: Unterseiten und Tags auf- und zuklappen'],
        ['Enter / Leertaste', 'Öffnen oder auslösen'],
        ['Pfeiltasten', 'Typ-Tabelle: Zelle wählen'],
        ['Enter / F2', 'Typ-Tabelle: Zelle bearbeiten oder Eintrag öffnen'],
      ],
    },
    {
      title: 'Tabellen',
      keys: [
        ['/tabelle', 'Eintrag als Tabelle zeigen (noch einmal: als Liste)'],
        ['Tab / Umschalt+Tab', 'Nächste / vorige Zelle (hinter der letzten: neue Zeile)'],
        ['Enter', 'Neue Zeile darunter'],
        ['Pfeiltasten', 'Am Textrand: Nachbarzelle'],
        ['Alt+Umschalt+↑ / Alt+Umschalt+↓', 'Zeile verschieben'],
        ['Strg+Umschalt+Entf', 'Zeile löschen'],
        ['Umschalt+F10', 'Menü: Zeilen und Spalten einfügen, duplizieren, verschieben, sortieren, löschen; als Markdown, TSV oder HTML kopieren'],
        ['Strg+V', 'Aus Excel, TSV oder Markdown-Tabelle einfügen'],
        ['Strg+Enter', 'Zelle als Todo erledigen (oder zum Todo machen)'],
      ],
    },
    {
      title: 'Ausgewählte Zellen',
      keys: [
        ['Umschalt+Pfeiltasten', 'Am Textrand: Zellen auswählen, danach Auswahl ändern (Maus: ziehen, Umschalt+Klick, Griffe)'],
        ['Strg+A (zweimal)', 'Ganze Tabelle auswählen'],
        ['Strg+C / Strg+X / Strg+V', 'Kopieren, ausschneiden, einfügen (ein Wert füllt alle Zellen)'],
        ['Entf', 'Inhalt löschen'],
        ['Strg+Umschalt+Entf', 'Zeilen löschen (ganze Spalten ausgewählt: Spalten)'],
        ['Alt+Umschalt+↑ / Alt+Umschalt+↓', 'Zeilen verschieben'],
        ['Strg+Enter', 'Erledigen'],
        ['Enter / Esc', 'Auswahl aufheben und in der Zelle weiterschreiben'],
      ],
    },
    {
      title: 'Bilder',
      keys: [
        ['Strg+V', 'Bild aus der Zwischenablage an den Eintrag hängen (in der Notiz: an der Cursorstelle)'],
        ['/bild', 'Bild aus einer Datei einfügen (auch im Aktionsmenü: Umschalt+F10)'],
        ['Enter / Leertaste', 'Ausgewähltes Bild groß anzeigen (Tab springt zu den Bildern einer Notiz)'],
      ],
    },
    {
      title: 'Kalender',
      keys: [
        ['Pfeiltasten', 'Monat: Tag wählen · Woche: Tagesköpfe (← →) und Termine (↑ ↓)'],
        ['Umschalt+Pfeiltasten', 'Mehrere Tage wählen'],
        ['Enter', 'Neuer Termin am gewählten Tag oder Zeitraum'],
        ['Bild↑ / Bild↓', 'Voriger / nächster Monat bzw. Woche'],
        ['Esc', 'Auswahl aufheben'],
      ],
    },
  ] as ShortcutGroup[],
};
