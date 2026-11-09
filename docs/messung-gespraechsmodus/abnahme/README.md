# Abnahme des Moduls team-modus in der Probe-Instanz (2026-11-09)

Wegwerf-Treiber, kein Teil des Pakets. Die Probe-Instanz ist ein Prozess `dsh --profile probe` ohne Webserver und ohne Port, `DSH_HOME=/tmp/teams_plus_umbau/probe_home`, Attrappen-Modell `fake-llm.mjs`. Das Modul wird über `abnahme.patch.yml` aus dem Worktree geladen, nicht aus dem Profil. Pfade unter /tmp sind fest eingetragen.

| Lauf | Ergebnis (Datei) |
|---|---|
| a: Team-Modus an, 3 Gänge des Menschen | `abnahme_a.json`: Lead-Züge 0, nichts im Eingangskorb; vier Zeilen `verworfen` im Protokoll |
| b: Notschalter `aus:true` | `abnahme_b_notschalter.json`: 4 Meldungen, 4 Lead-Züge, Protokoll ohne `verworfen` (= Grundlinie M0) |
| c: Absturz im Kind | `abnahme_c.json`: die Meldung „failed before it finished“ kommt beim Lead an |
| f: Ziel mit Bericht | `abnahme_f.json`: `complete` ohne Bericht abgelehnt, `goal_report` gespeichert, `complete` ok, Bericht genau einmal beim Lead |
