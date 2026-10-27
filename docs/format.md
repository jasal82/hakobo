# Hakobo – Datenmodell und Dateiformat

Hakobo speichert alles als lesbare Markdown-Dateien in einem Ordner, dem
**Notizbuch** (Vault). Der Ordner ist zugleich ein Git-Arbeitsverzeichnis: Jede
Änderung wird automatisch als Version festgehalten und auf Wunsch mit anderen
Rechnern synchronisiert. Die Dateien lassen sich jederzeit mit einem normalen
Editor, mit Obsidian oder auf GitHub lesen und bearbeiten.

## Grundbegriffe

| Begriff | Bedeutung |
| --- | --- |
| **Knoten** | Eine Zeile in der Gliederung. Hat Text, optional Notiz (Markdown), Felder und Kinder. |
| **Seite** | Eine Datei `*.md`. Auch ein Knoten: ihre Kinder sind die Knoten der Datei und ihre Unterseiten. |
| **Todo** | Ein Knoten mit Kästchen (`- [ ]`). |
| **Datum** | Feld `date::`. Bei einem Todo die Fälligkeit, sonst ein Termin. |
| **Tag** | `#wort` im Text, verschachtelt mit `/`: `#projekte/sorobo/milestone1`. |
| **Typ** | Ein Tag mit Feldern (z. B. `#meeting` mit Datum, Teilnehmern, Projekt). |
| **Link / Erwähnung** | `[[Seite]]`, `[[Seite#^id\|Text]]`. Erwähnungen (`@` in der Oberfläche) sind Links auf Personen. |
| **Inbox** | Die Seite `Inbox.md`. Schnellerfassung landet hier; einsortiert wird später. |

Alles ist ein Baum: Wurzel → Seiten (Dateien/Ordner) → Knoten → Unterknoten. In
jeden Knoten kann man hineinzoomen (Drill-down), egal ob Seite oder Zeile.

## Ordnerstruktur

```
Notizbuch/
  Inbox.md                 Schnellerfassung (wird bei Bedarf angelegt)
  Projekte.md              Seite „Projekte“
  Projekte/                Unterseiten von „Projekte“
    Sorobo.md
  Personen/                Ordner ohne eigene Datei = leere Seite
    Anna Schmidt.md
  assets/                  Bilder und Anhänge (keine Seiten)
  .hakobo/types.toml       Typdefinitionen (werden mitsynchronisiert)
  .gitattributes           *.md merge=union (konfliktfreies Zusammenführen)
```

- Seitentitel = Dateiname ohne `.md`.
- Unterseiten einer Seite `X.md` liegen im Ordner `X/`. Ein Ordner ohne
  gleichnamige Datei ist eine Seite ohne Inhalt; sobald sie Inhalt bekommt,
  entsteht die Datei.
- Unterseiten erscheinen nach den Knoten der Seite, alphabetisch sortiert.
- Ignoriert werden versteckte Dateien und Ordner (`.git`, `.hakobo`, …), der
  Ordner `assets/` und alle Dateien, die nicht auf `.md` enden.
- Notizbücher aus der Zeit, als Hakobo noch Sqizzo hieß, haben `.sqizzo/`
  statt `.hakobo/`. Hakobo benennt den Ordner beim Öffnen um und committet
  das zusammen mit der angepassten `.gitignore`.

## Aufbau einer Seite

```markdown
---
tags: [person]
email: anna@example.com
---

Freier Markdown-Text der Seite (die „Notiz“ der Seite).

- Erster Knoten
- [ ] Ein Todo #projekte/sorobo ^k3j9a2
  date:: 2026-10-30
  remind:: 1h
  Notiz zum Todo, beliebiger Markdown-Text,
  auch über mehrere Absätze.

  ```rust
  fn main() {}
  ```
  - Kindknoten
    - Enkel
- Kickoff mit [[Anna Schmidt]] #meeting
  date:: 2026-10-28 10:00-11:00
  teilnehmer:: [[Anna Schmidt]], [[Ben]]
```

1. **Frontmatter** (optional): YAML zwischen `---`-Zeilen am Dateianfang.
   `tags:` sind die Tags der Seite (Liste `[a, b]`, Blockliste oder einzelner
   Wert, mit oder ohne `#`). Alle anderen Schlüssel sind Felder der Seite.
   Unbekannte oder komplexe Einträge bleiben beim Speichern unverändert.
2. **Notiz der Seite**: aller Text vor dem ersten Aufzählungspunkt in Spalte 0.
3. **Knoten**: eine Aufzählung (`- `, auch `* ` und `+ ` werden gelesen).

### Knoten

```
- [ ] Text mit #tag und [[Link]] ^abc123
  key:: wert
  Notiz …
  - Kind
```

- **Aufzählungszeichen**: `-` (gelesen werden auch `*` und `+`). Ein leerer
  Knoten ist `-` allein.
- **Kästchen** (optional): `[ ]` offen, `[x]` erledigt, `[/]` in Arbeit,
  `[-]` abgebrochen.
- **Text**: Rest der Zeile, Inline-Markdown (fett, kursiv, Code, Links, Tags).
  Überschriften-Knoten beginnen mit `# `, `## ` oder `### `.
- **ID** (optional): ` ^id` am Zeilenende (Obsidian-Blockverweis), 6 Zeichen
  `[a-z0-9]`. Wird nur geschrieben, wenn der Knoten verlinkt ist.
- **Felder**: Zeilen `schlüssel:: wert` direkt unter der Textzeile (vor der
  Notiz), eingerückt auf Textspalte. Schlüssel: Buchstaben, Ziffern, `_`, `-`.
- **Notiz**: weitere Zeilen auf Textspalte (oder tiefer). Markdown inklusive
  Codeblöcke, Zitate, Tabellen, nummerierte Listen. Eine Notizzeile, die wie ein
  Aufzählungspunkt aussieht, wird beim Schreiben als `\- …` maskiert, damit sie
  nicht zum Kind wird. Innerhalb von Codeblöcken wird nichts maskiert oder
  als Knoten gelesen.
- **Kinder**: Aufzählungspunkte, die tiefer eingerückt sind als der Knoten.
- Beim Schreiben: 2 Leerzeichen pro Ebene, keine Leerzeilen zwischen Knoten,
  Leerzeilen innerhalb der Notiz bleiben erhalten. Gelesen werden auch Tabs und
  andere Einrückungsbreiten.

Toleranz beim Lesen fremder Dateien: Text in Spalte 0 nach dem ersten
Aufzählungspunkt (Absätze, Überschriften, Codeblöcke) wird zu eigenen Knoten.
Hakobo schreibt eine Datei nur neu, wenn sie in der App geändert wurde.

## Eingebaute Felder

| Feld | Werte | Bedeutung |
| --- | --- | --- |
| `date` | `2026-10-27`, `2026-10-27 14:00`, `2026-10-27 14:00-15:30`, `2026-10-27 - 2026-10-29`, `2026-10-27 22:00 - 2026-10-28 02:00` | Fälligkeit (Todo) oder Termin (sonst). Erscheint in der Agenda. Gelesen wird auch `due::`. |
| `repeat` | `daily`, `weekdays`, `weekly`, `every 2 weeks`, `weekly on mon,thu`, `monthly`, `yearly`, `every 3 days`, jeweils optional `until 2026-12-31` | Wiederholung. Erledigen eines wiederkehrenden Todos verschiebt `date` auf den nächsten Termin. |
| `remind` | `15m`, `1h`, `1d`, `1h30m`, `0`, `2026-10-27 08:00`, mehrere mit Komma | Erinnerung vor Beginn bzw. zu einem festen Zeitpunkt. Ganztägige Einträge rechnen ab der eingestellten Morgenzeit (Standard 09:00). |
| `done` | `2026-10-26 18:04` | Wann das Todo erledigt wurde (setzt Hakobo). |

## Tags und Typen

- Tag: `#` am Wortanfang, gefolgt von Buchstaben, Ziffern, `_`, `-`, `/`.
  Mindestens ein Zeichen ist keine Ziffer (`#1` ist kein Tag). Groß-/Kleinschreibung
  spielt beim Suchen keine Rolle.
- Verschachtelte Tags: `#projekte/sorobo/milestone1` gehört auch zu
  `#projekte/sorobo` und `#projekte`.
- Tags zählen in Text und Notiz eines Knotens sowie im Frontmatter einer Seite.
- Ein **Typ** ist ein Tag mit Definition in `.hakobo/types.toml`:

```toml
[types.meeting]
label = "Meeting"
color = "violet"
fields = [
  { key = "date", label = "Datum", kind = "date" },
  { key = "teilnehmer", label = "Teilnehmer", kind = "ref", target = "person", multiple = true },
  { key = "projekt", label = "Projekt", kind = "ref", target = "projekt" },
]
```

Feldarten (`kind`): `text`, `number`, `date`, `select` (mit `options = [..]`),
`ref` (Link, optional `target` = Typ, `multiple`), `url`, `email`, `phone`,
`checkbox` (`true`/`false`). Mehrere Werte werden mit `, ` getrennt.

## Links, Erwähnungen, IDs

- `[[Titel]]` verweist auf eine Seite (Titel ohne Groß-/Kleinschreibung; bei
  gleichen Titeln gewinnt der kürzeste Pfad, eindeutig mit `[[Ordner/Titel]]`).
- `[[Titel#^id|Anzeigetext]]` verweist auf einen Knoten innerhalb einer Seite.
  Die App zeigt immer den aktuellen Text des Ziels; der Anzeigetext in der Datei
  wird beim nächsten Speichern der Seite aufgefrischt.
- Erwähnungen sind Links auf Knoten oder Seiten mit dem Typ `person`.
- Wird eine Seite umbenannt oder verschoben, passt Hakobo alle Links an.

## Versionierung und Synchronisation

- Das Notizbuch ist ein Git-Repository (wird bei Bedarf angelegt).
- Änderungen werden nach kurzer Ruhepause automatisch committet.
- Mit einem Remote (`origin`) holt und überträgt Hakobo Änderungen regelmäßig
  (`git fetch`, `merge`, `push` über die installierte Git-Kommandozeile, damit
  vorhandene Anmeldedaten greifen).
- `.gitattributes` setzt `*.md merge=union`: Gleichzeitige Änderungen an
  derselben Datei werden ohne Konfliktmarker zusammengeführt; im
  ungünstigsten Fall stehen beide Fassungen einer Zeile untereinander.
