# MD Viewer

Kleine Mac-App zum Lesen und Bearbeiten von Markdown-Dateien. Offline, ohne Vault: Dateien öffnen, wo sie liegen.

## Funktionen

- Lesen ist Standard, Bearbeiten (⌘E) mit Live-Vorschau direkt in Markdown
- Tabs, Zuletzt geöffnet, Merkliste und frei sortierbare Orte (Ordner) in der Seitenleiste
- Datei oder Ordner per Drag and Drop, ⌘O oder Plus
- Wikilinks `[[Notiz]]` mit Auswahl, Backlinks, Gliederung, Suche im Dokument und Schnellwechsler (⌘P)
- Bilder einfügen und anzeigen, Callouts, Frontmatter, Aufgabenlisten
- Neue Notiz, Umbenennen, Löschen (nur in den Papierkorb)
- Hell und Dunkel, Fokusmodus

Gespeichert wird nur in bestehende Markdown-Dateien. Ändert sich eine Datei außerhalb der App, warnt sie vor dem Überschreiben.

## Installation

1. ZIP unter *Releases* laden, entpacken, **MD Viewer** nach *Programme* ziehen.
2. Die App ist nicht notarisiert. Einmalig die Sperre entfernen:

```bash
xattr -dr com.apple.quarantine "/Applications/MD Viewer.app"
```

Alternativ: Systemeinstellungen, Datenschutz & Sicherheit, *Trotzdem öffnen*.

Voraussetzung: macOS 13 oder neuer, Apple Silicon oder Intel.

## Selbst bauen

Es genügen die Xcode Command Line Tools (`xcode-select --install`), kein Xcode.

```bash
./build.sh
```

Ergebnis: `build/MD Viewer.app` und `build/MD-Viewer.zip`.

Den Editor (CodeMirror) baust du nur neu, wenn du `editor/src/editor.js` änderst:

```bash
cd editor && npm install && npx esbuild src/editor.js --bundle --minify --format=iife --global-name=MDEditor --outfile=../web/vendor/editor.js
```

## Aufbau

- `app/` native Hülle in Swift (AppKit, WKWebView), Icons, Info.plist
- `web/` Oberfläche in HTML, CSS und JavaScript, Bibliotheken in `web/vendor/`
- `editor/` Quellen des Markdown-Editors

## Lizenz

MIT, siehe [LICENSE](LICENSE). Drittkomponenten: [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
