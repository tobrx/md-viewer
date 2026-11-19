# Newsdesk – Plan

Ziel: Google-News-artige Übersicht als Web-App und Handy-App (PWA), aus selbst gewählten Quellen. Kein Blackbox-Algorithmus.

## Entscheidungen

| Thema | Entscheidung | Warum |
|---|---|---|
| Datenzugang | RSS/Atom-Feeds der Medien | Legal, kostenlos, stabil. Scraping und Google-News-API entfallen (keine offizielle API). |
| Backend | Kein Server. Geplantes Skript (Cron) schreibt `data/news.json` | Browser dürfen fremde Feeds wegen CORS nicht direkt laden. Statische Datei ist billig und schnell. |
| App | PWA (installierbar, offline lesbar) | Eine Codebasis für Web, iOS, Android. Native App erst, wenn Push nötig wird. |
| Ranking | Transparent: Quellenzahl + Quellenqualität + Frische | „Was sollte man wissen“ = viele unabhängige Medien berichten darüber. Erklärbar, kein Filter-Bubble-Risiko. |
| Zusammenfassung | Phase 1: Teaser aus dem Feed. Phase 2: optional LLM-Kurzfassung je Geschichte im Fetch-Skript | Kosten und Qualität erst messen. |
| Personalisierung | Nur lokal (Themen, Stichwörter wie „RB Leipzig“, Gelesen-Status) | Kein Login, keine Tracking-Daten. |

## Struktur der Startseite

1. **Heute**: Top 4 + Rest, bundesweit/international, nach Ranking.
2. **Sachsen & Leipzig**: regionale Feeds (MDR, LVZ, später L-IZ, sachsen.de).
3. **Meine Themen**: Tech, Wirtschaft, Wissenschaft, Gesundheit, Sport, Kultur.
4. **Ich folge**: Stichwörter, z. B. Teams.

## Roadmap

- [x] Prototyp: UI, Ranking, Clustering, Parser (getestet mit Fixture), Demo-Daten
- [ ] Feeds live prüfen: `node scripts/fetch-feeds.mjs --check` (URLs mit `verified:false` sind ungeprüft)
- [ ] Hosting + Cron (alle 30 Min): Cloudflare Pages + GitHub Action oder Worker-Cron
- [ ] Quellen-Verwaltung in der App (eigene Feed-URL hinzufügen, braucht kleinen Proxy-Worker)
- [ ] LLM-Kurzfassungen (Haiku-Klasse), nur für Top-Geschichten
- [ ] Feintuning Clustering (Schwelle 0,4 ist geraten; mit echten Daten kalibrieren)
- [ ] Optional: Push für „Ich folge“, Einordnung Quellenvielfalt

## Risiken

- **Paywall/Teaser**: Feeds liefern nur Anrisse; wir verlinken, wir kopieren keine Volltexte (Urheberrecht).
- **Feed-Stabilität**: Medien ändern URLs. Der `--check`-Lauf gehört in CI.
- **Clustering**: Wortüberlappung auf Titeln ist simpel. Fehlzuordnungen möglich, Embeddings wären Phase 3.
- **Geschmack ≠ Wichtigkeit**: Mehrfach-Berichterstattung bevorzugt Politik/Boulevard-Themen; Regionales hat deshalb eigenen Tab.
