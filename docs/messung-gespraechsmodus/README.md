# Messbelege zum Konzept Gesprächsmodus (2026-11-09)

Wegwerf-Proben, **kein Teil des Plugins** und nicht im Paket (`package.json` "files" nennt docs/ nicht).
Sie liefen in einer eigenen Probe-Instanz von DSH ohne Webserver und ohne Port:
`DSH_HOME=/tmp/teams_plus_umbau/probe_home dsh --profile probe --patch probe.patch.yml`
(Profil `probe`: Vorlage headless plus Bündel experimental-agent-team-profile, Attrappen-Modell `fake-llm.mjs`).

- `driver.mjs`: Treiber-Plugin; Szenarien über PROBE_SZENARIO (grundlinie, abfangen, fehler, abbruch, briefkasten, ziel, zielsteer, stopp, stopp2, fork, sperre).
- `lauf.sh <szenario> [N]`: startet einen Lauf, höchstens 90 s.
- `ergebnis_<szenario>.json`: der jeweils letzte Lauf. Die Ergebnisse stehen im Konzept, Abschnitt 3.
- Pfade unter /tmp sind fest eingetragen; wer es wiederholt, passt sie an. Der Lauf `grundlinie` (M0) wurde mit einer früheren Fassung des Treibers gemessen (N=2) und hat keine Ergebnisdatei.
