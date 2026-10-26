# Sqizzo

Notizen, Todos und Termine als Outline – lokal gespeichert als lesbares Markdown, automatisch versioniert mit Git und auf Wunsch zwischen Rechnern synchronisiert.

Sqizzo verbindet den Drill-down von Workflowy (in jeden Punkt hineinzoomen) mit Docs-as-Code (jede Seite ist eine `.md`-Datei, jede Änderung eine Git-Version), echten Todos und Terminen, verschachtelten Tags und eigenen Typen mit Feldern – ohne Cloud-Zwang und ohne schwerfälliges Datenmodell.

## Das Konzept in fünf Sätzen

1. **Alles ist ein Knoten** in einem Baum: Notizbuch → Seiten (Dateien) → Zeilen → Unterzeilen. Ein Klick auf den Aufzählungspunkt zoomt hinein.
2. **Jeder Knoten** hat eine Textzeile, optional eine Notiz in Markdown (mit Codeblöcken und Syntax-Hervorhebung) und Kinder.
3. **Todos und Termine** entstehen aus dem Text heraus: `[ ]` macht ein Todo, `/morgen 14 uhr` einen Termin, `/fällig fr` eine Fälligkeit, `/jeden montag` eine Wiederholung, `/erinnerung 15m` eine Erinnerung.
4. **Tags** (`#projekte/sqonto/milestone1`) ordnen zu, ohne zu verschieben; ein Tag mit Feldern ist ein **Typ** (Meeting, Projekt, Person, Snippet oder eigene).
5. **Die Inbox** nimmt alles Neue auf – per globalem Tastenkürzel, Kommandozeile oder `Strg+N`. Einsortiert (`Strg+M`) oder zugeordnet (`#`, `@`) wird später.

## Starten und bauen

Voraussetzungen: Node.js 24, Rust (stable), unter Windows die WebView2-Laufzeit (in Windows 11 enthalten). Für die Synchronisation die Git-Kommandozeile; lokale Versionen funktionieren auch ohne.

```powershell
build.cmd        # baut Oberfläche und Programm → dist\Sqizzo.exe
start.cmd        # startet Sqizzo (baut beim ersten Mal)
```

Unter Linux und macOS `./build.sh`. Das Notizbuch liegt standardmäßig in `Dokumente/Sqizzo` (in den Einstellungen änderbar). Sqizzo läuft beim Schließen im Infobereich weiter, damit Schnellerfassung und Erinnerungen funktionieren; „Beenden“ im Tray-Menü beendet es ganz.

## Bedienung

### Schreiben im Outliner

| Taste | Wirkung |
| --- | --- |
| `Enter` | neue Zeile (teilt am Cursor) |
| `Tab` / `Umschalt+Tab` | einrücken / ausrücken |
| `Strg+Enter` | Todo erledigen bzw. wieder öffnen (macht eine Zeile zum Todo) |
| `Strg+Umschalt+Enter` | Kästchen entfernen/hinzufügen |
| `Umschalt+Enter` | Notiz (Markdown) bearbeiten, `Esc` zurück |
| `Alt+→` / `Alt+←` | hineinzoomen / herauszoomen |
| `Strg+↑` / `Strg+↓` | zuklappen / aufklappen |
| `Alt+Umschalt+↑/↓` | Zeile verschieben |
| `Umschalt+↑/↓` am Zeilenrand | mehrere Zeilen auswählen (dann `Tab`, `Entf`, `Strg+M`, `Strg+C`) |
| `Strg+M` | einsortieren (an einen anderen Ort verschieben) |
| `Strg+L` | Link auf die Zeile kopieren |
| `Strg+B` / `Strg+I` | fett / kursiv |
| `Strg+Z` / `Strg+Y` | rückgängig / wiederholen |
| `Strg+K` | Suche mit Vorschau |
| `Strg+N` | schnell erfassen |
| `Strg+Umschalt+Leertaste` | Schnellerfassung systemweit (einstellbar) |

Beim Tippen helfen Vorschläge: `/` für Befehle und Daten, `#` für Tags, `@` für Personen, `[[` für Links auf Seiten und Zeilen. Mehrzeilig eingefügter Text (z. B. eine Markdown-Liste) wird zu einzelnen Zeilen.

### Slash-Befehle

| Eingabe | Ergebnis |
| --- | --- |
| `/morgen`, `/fr`, `/27.10.`, `/in 3 tagen` | Datum (Termin bzw. Fälligkeit bei Todos) |
| `/termin do 10-11 uhr`, `/morgen 14:30` | Termin mit Uhrzeit(spanne) |
| `/fällig fr` | macht ein Todo, fällig am Freitag |
| `/jeden montag 9 uhr`, `/wdh alle 2 wochen`, `/werktags` | Wiederholung (mit Startdatum) |
| `/erinnerung 15m`, `/erinnerung morgen 8 uhr` | Erinnerung (Desktop-Benachrichtigung) |
| `/todo` | Kästchen |
| `/h1`, `/notiz`, `/code`, `/einsortieren` | Überschrift, Notiz, Codeblock, verschieben |

Deutsch und Englisch werden verstanden (`/tomorrow 2pm`, `/every monday`).

### Ansichten

- **Inbox**: alles Neue; jede Zeile lässt sich einsortieren (`Strg+M`) oder zuordnen (Tag oder Link vergeben).
- **Agenda** und **Woche**: Termine und fällige Todos (Wiederholungen aufgelöst), Überfälliges oben, neue Einträge direkt per Doppelklick ins Zeitraster.
- **Todos**: alle offenen Todos nach Fälligkeit (überfällig, heute, morgen, nächste 7 Tage, später), undatierte nach Seite; Filter nach `#tag` und Text.
- **Tags**: verschachtelter Tag-Baum in der Seitenleiste; ein Tag zeigt alle Einträge mit ihm und seinen Unter-Tags.
- **Typen**: Tabelle je Typ mit bearbeitbaren Feldern, Typ-Editor für eigene Typen.
- **Versionen**: je Seite der Verlauf mit Vergleich und Wiederherstellen.

Todos im Format von Obsidian Tasks (`- [ ] Aufgabe 📅 2026-10-30`) erscheinen ebenfalls in Agenda und Erinnerungen.

### Suche

`Strg+K` sucht unscharf (Tippfehler werden toleriert) in Titeln, Notizen, Pfaden, Tags und Feldern und zeigt rechts eine Vorschau. Filter lassen sich kombinieren:

`#tag` (inklusive Unter-Tags) · `-#tag` · `is:open` · `is:done` · `is:todo` · `is:page` · `has:date` · `in:Seite` · `date:heute` · `date:woche` · `date:überfällig` · `"genaue Phrase"`

### Typen

Ein Typ ist ein Tag mit Feldern, definiert in `.sqizzo/types.toml` oder über die Typen in der Seitenleiste. Mitgeliefert: **Meeting** (Datum, Teilnehmer, Projekt, Ort), **Projekt** (Status, Ziel, Deadline), **Person** (E-Mail, Telefon, Firma, Rolle), **Snippet** (Sprache, Quelle). Jeder Typ hat eine Tabellenansicht; Felder mit dem Schlüssel `date` erscheinen in der Agenda.

## Speicherung, Versionen, Synchronisation

Jede Seite ist eine Markdown-Datei, Unterseiten liegen im gleichnamigen Ordner. Das Format ist in [docs/format.md](docs/format.md) beschrieben und bleibt in jedem Editor, in Obsidian und auf GitHub lesbar. Änderungen von außen (anderer Editor, `git pull`) übernimmt Sqizzo sofort.

- **Versionen**: Nach kurzer Ruhepause (Standard 30 s) wird automatisch committet. Für jede Seite gibt es einen Versionsverlauf mit Vergleich und Wiederherstellen.
- **Synchronisation**: In den Einstellungen ein Remote eintragen (z. B. ein privates GitHub-Repository). Sqizzo holt, führt zusammen und überträgt regelmäßig und kurz nach jeder Änderung. Es nutzt die installierte Git-Kommandozeile mit deinen vorhandenen Anmeldedaten (SSH oder HTTPS).
- **Konflikte**: Markdown-Dateien werden zeilenweise vereinigt (`merge=union`), es entstehen nie Konfliktmarker. Im ungünstigsten Fall stehen beide Fassungen einer Zeile untereinander.
- **Zweites Gerät**: `sqizzo clone <url>` holt das Notizbuch und trägt es als Standard ein. Alternativ in einem leeren Notizbuch die Remote-URL eintragen.

## Kommandozeile

```bash
sqizzo add "Zahnarzt /morgen 14 uhr /erinnerung 1h"
sqizzo add "[] Steuererklärung /fällig 31.12. #privat/finanzen"
sqizzo add --to Projekte "Idee für den Bankimport"
echo "Notiz aus der Pipeline" | sqizzo add -
sqizzo agenda --days 14
sqizzo search "rechnung #kunde is:open"
sqizzo inbox
sqizzo sync
sqizzo clone git@github.com:name/notizen.git
sqizzo serve --port 8090          # Oberfläche im Browser, z. B. im Heimnetz
```

Läuft die App, sprechen die Befehle mit ihr (Fenster und Dateien bleiben synchron); sonst arbeiten sie direkt auf dem Notizbuch und legen eine Version an.

## Entwicklung

```bash
npm install
npm run build                      # Oberfläche nach web/dist (wird in die EXE eingebettet)
cargo test                         # Parser, Notizbuch, Git-Sync, Datum, Suche, Agenda
bash scripts/dev-server.sh         # Backend mit Demo-Notizbuch, Token "dev", Port 4519
npm run dev                        # Vite mit Hot-Reload auf Port 5174 (spricht mit dem Backend)
```

Aufbau: `src/vault` (Datenmodell, Markdown-Parser/-Writer, Typen), `src/dates.rs` (natürlichsprachliche Daten, Wiederholungen, Erinnerungen), `src/search.rs` (Fuzzy-Suche), `src/capture.rs` (Slash-Befehle), `src/git.rs` (Versionen, Sync), `src/app.rs` (Hintergrundaufgaben), `src/server` (REST-API, Ereignisstrom), `src/desktop.rs` (Fenster, Tray, globaler Hotkey), `web/` (React-Oberfläche).
