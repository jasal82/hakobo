# Hakobo

Notizen, Todos und Termine als Outline – lokal gespeichert als lesbares Markdown, automatisch versioniert mit Git und auf Wunsch zwischen Rechnern synchronisiert.

Hakobo verbindet den Drill-down von Workflowy (in jeden Punkt hineinzoomen) mit Docs-as-Code (jede Seite ist eine `.md`-Datei, jede Änderung eine Git-Version), echten Todos und Terminen, verschachtelten Tags und eigenen Typen mit Feldern – ohne Cloud-Zwang und ohne schwerfälliges Datenmodell.

## Das Konzept in fünf Sätzen

1. **Alles ist ein Knoten** in einem Baum: Notizbuch → Seiten (Dateien) → Zeilen → Unterzeilen. Ein Klick auf den Aufzählungspunkt zoomt hinein.
2. **Jeder Knoten** hat eine Textzeile, optional eine Notiz in Markdown (mit Codeblöcken und Syntax-Hervorhebung) und Kinder.
3. **Todos und Termine** entstehen aus dem Text heraus: `[ ]` macht ein Todo, `/morgen 14 uhr` einen Termin, `/fällig fr` eine Fälligkeit, `/jeden montag` eine Wiederholung, `/erinnerung 15m` eine Erinnerung.
4. **Tags** (`#projekte/sorobo/milestone1`) ordnen zu, ohne zu verschieben; ein Tag mit Feldern ist ein **Typ** (Meeting, Projekt, Person, Snippet oder eigene).
5. **Die Inbox** nimmt alles Neue auf – per globalem Tastenkürzel, Kommandozeile oder `Strg+N`. Einsortiert (`Strg+M`) oder zugeordnet (`#`, `@`) wird später.

## Installieren

Fertige Pakete gibt es unter [Releases](https://github.com/jasal82/hakobo/releases):

- **Windows**: `Hakobo-X.Y.Z-windows-x64-setup.exe` (Installation pro Benutzer, ohne Administratorrechte) oder `…-portable.zip` zum Entpacken an einen beliebigen Ort.
- **macOS** (Apple Silicon) und **Linux** (x64): `Hakobo-X.Y.Z-macos-arm64.tar.gz` bzw. `…-linux-x64.tar.gz`. Unter Linux öffnet sich die Oberfläche im Browser.

Das Notizbuch liegt standardmäßig in `Dokumente/Hakobo` (in den Einstellungen änderbar). Hakobo läuft beim Schließen im Infobereich weiter, damit Schnellerfassung und Erinnerungen funktionieren; „Beenden“ im Tray-Menü beendet es ganz.

### Updates

Hakobo fragt beim Start und danach täglich bei GitHub nach der neuesten Version (abschaltbar unter Einstellungen → Updates; dabei werden keine Daten aus den Notizen übertragen). Eine neue Version meldet ein Hinweis, das Zahnrad in der Seitenleiste bekommt einen Punkt. „Jetzt aktualisieren“ lädt das passende Paket, prüft seine SHA-256-Prüfsumme und

- führt bei einer Installation per Setup das neue Setup aus, das Hakobo ersetzt und wieder startet,
- ersetzt bei der portablen Version und unter macOS/Linux die Programmdatei und startet sie neu.

Die neue Version übernimmt Port und Zugangstoken der alten: Offene Browser-Tabs laden sich nur neu, die Kommandozeile findet die App unter derselben Adresse. Eine Version lässt sich überspringen; im Server-Modus (`hakobo serve`) und bei selbst gebauten Entwicklungsversionen gibt es keine Selbst-Updates.

## Selbst bauen

Voraussetzungen: Node.js 24, Rust (stable), unter Windows die WebView2-Laufzeit (in Windows 11 enthalten). Für die Synchronisation die Git-Kommandozeile; lokale Versionen funktionieren auch ohne.

```powershell
build.cmd        # baut Oberfläche und Programm → dist\Hakobo.exe (mit Inno Setup 6 auch den Installer)
start.cmd        # startet Hakobo (baut beim ersten Mal)
```

Unter Linux und macOS `./build.sh` (→ `dist/hakobo` und das Archiv unter `dist/packages/`). `build.cmd --no-installer` überspringt den Installer, `build.cmd --installer` verlangt ihn.

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
| `Strg+Plus` / `Strg+Minus` / `Strg+0` | Schriftgröße der ganzen App (auch Strg+Mausrad, Einstellungen → Allgemein) |

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

Ein Typ ist ein Tag mit Feldern, definiert in `.hakobo/types.toml` oder über die Typen in der Seitenleiste. Mitgeliefert: **Meeting** (Datum, Teilnehmer, Projekt, Ort), **Projekt** (Status, Ziel, Deadline), **Person** (E-Mail, Telefon, Firma, Rolle), **Snippet** (Sprache, Quelle). Jeder Typ hat eine Tabellenansicht; Felder mit dem Schlüssel `date` erscheinen in der Agenda.

## Speicherung, Versionen, Synchronisation

Jede Seite ist eine Markdown-Datei, Unterseiten liegen im gleichnamigen Ordner. Das Format ist in [docs/format.md](docs/format.md) beschrieben und bleibt in jedem Editor, in Obsidian und auf GitHub lesbar. Änderungen von außen (anderer Editor, `git pull`) übernimmt Hakobo sofort.

- **Versionen**: Nach kurzer Ruhepause (Standard 30 s) wird automatisch committet. Für jede Seite gibt es einen Versionsverlauf mit Vergleich und Wiederherstellen.
- **Synchronisation**: In den Einstellungen ein Remote eintragen (z. B. ein privates GitHub-Repository). Hakobo holt, führt zusammen und überträgt regelmäßig und kurz nach jeder Änderung. Es nutzt die installierte Git-Kommandozeile mit deinen vorhandenen Anmeldedaten (SSH oder HTTPS).
- **Konflikte**: Markdown-Dateien werden zeilenweise vereinigt (`merge=union`), es entstehen nie Konfliktmarker. Im ungünstigsten Fall stehen beide Fassungen einer Zeile untereinander.
- **Zweites Gerät**: `hakobo clone <url>` holt das Notizbuch und trägt es als Standard ein. Alternativ in einem leeren Notizbuch die Remote-URL eintragen.

## Kommandozeile

```bash
hakobo add "Zahnarzt /morgen 14 uhr /erinnerung 1h"
hakobo add "[] Steuererklärung /fällig 31.12. #privat/finanzen"
hakobo add --to Projekte "Idee für den Bankimport"
echo "Notiz aus der Pipeline" | hakobo add -
hakobo agenda --days 14
hakobo search "rechnung #kunde is:open"
hakobo inbox
hakobo sync
hakobo clone git@github.com:name/notizen.git
hakobo serve --port 8090          # Oberfläche im Browser, z. B. im Heimnetz
```

Läuft die App, sprechen die Befehle mit ihr (Fenster und Dateien bleiben synchron); sonst arbeiten sie direkt auf dem Notizbuch und legen eine Version an.

## Umstieg von Sqizzo

Bis Oktober 2026 hieß Hakobo *Sqizzo*. Beim ersten Start übernimmt Hakobo alles Vorhandene:

- Die Einstellungen (`%APPDATA%\sqizzo` bzw. der Einstellungsordner des Systems) werden zu `hakobo`, samt Fensterposition, Erinnerungen und Ansichtseinstellungen. Läuft Sqizzo noch, bricht Hakobo mit einem Hinweis ab – Sqizzo zuerst über den Infobereich beenden.
- Ein Notizbuch im Standardordner `Dokumente/Sqizzo` wird nach `Dokumente/Hakobo` verschoben. Gelingt das nicht (z. B. weil eine Datei darin geöffnet ist), bleibt es am alten Ort und wird als Ordner eingetragen. Ein selbst gewählter Ordner bleibt unverändert.
- Im Notizbuch wird `.sqizzo/` zu `.hakobo/`, die `.gitignore` wird angepasst und beides als eigene Version committet. Auf weiteren Geräten sollte ebenfalls Hakobo laufen.
- Autostart und Benachrichtigungen werden unter dem neuen Namen eingerichtet.
- Die Kommandozeile heißt jetzt `hakobo`, die Umgebungsvariablen `HAKOBO_…`.

## Entwicklung

```bash
npm install
npm run build                      # Oberfläche nach web/dist (wird in die EXE eingebettet)
cargo test                         # Parser, Notizbuch, Git-Sync, Datum, Suche, Agenda
bash scripts/dev-server.sh         # Backend mit Demo-Notizbuch, Token "dev", Port 4590
npm run dev                        # Vite mit Hot-Reload auf Port 5174 (spricht mit dem Backend)
node scripts/smoke-test.mjs dist/Hakobo.exe   # fertiges Programm von außen prüfen
```

Aufbau: `src/vault` (Datenmodell, Markdown-Parser/-Writer, Typen), `src/dates.rs` (natürlichsprachliche Daten, Wiederholungen, Erinnerungen), `src/search.rs` (Fuzzy-Suche), `src/capture.rs` (Slash-Befehle), `src/git.rs` (Versionen, Sync), `src/app.rs` (Hintergrundaufgaben), `src/server` (REST-API, Ereignisstrom), `src/desktop.rs` (Fenster, Tray, globaler Hotkey), `src/update.rs` (Selbst-Update aus den GitHub-Releases), `web/` (React-Oberfläche), `installer/` und `scripts/` (Windows-Setup, Versionen, Lizenzen, Tests der Pakete).

### Neue Version veröffentlichen

```bash
node scripts/version.mjs set 0.2.0   # Cargo.toml, web/package.json und Lockdateien
git commit -am "Release 0.2.0"
git tag v0.2.0
git push origin main v0.2.0
```

Der Workflow `.github/workflows/build.yml` testet und baut jeden Push für Windows, Linux und macOS. Bei einem Tag `vX.Y.Z` (muss zur Version passen) veröffentlicht er das Release mit Setup, portablem ZIP, den Archiven und `SHA256SUMS.txt` – daraus holen sich laufende Installationen das Update. Unter Windows prüft `scripts/test-installer.ps1` dabei Installation, Update, Neustart nach dem Selbst-Update und Deinstallation.

## Lizenz

Copyright © 2026 Johannes Asal

Hakobo ist freie Software unter der [GNU Affero General Public License, Version 3 oder später](LICENSE) (AGPL-3.0-or-later). Du darfst Hakobo nutzen, untersuchen, verändern und weitergeben – auch kommerziell. Wer Hakobo weitergibt oder eine veränderte Fassung als Dienst über ein Netzwerk anbietet (etwa mit `hakobo serve`), muss den Quellcode dieser Fassung unter derselben Lizenz zugänglich machen.

Deine Notizen, Todos und Termine gehören dir und unterliegen nicht der AGPL.

Hakobo enthält Bibliotheken, Schriften und Icons anderer Projekte unter deren eigenen freien Lizenzen (u. a. MIT, Apache-2.0, BSD, MPL-2.0, SIL Open Font License). Die vollständige Übersicht erzeugt der Build als `dist/THIRD-PARTY-LICENSES.txt` (`node scripts/third-party-licenses.mjs`); sie liegt jedem Paket bei.
