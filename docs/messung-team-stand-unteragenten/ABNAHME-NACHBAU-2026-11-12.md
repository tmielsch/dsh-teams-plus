# Abnahme-Messung team_stand Unteragenten (Nachbesserung 2026-11-12, neue Probe)

Ersetzt die frühere Fassung dieser Datei. Die frühere Probe `/tmp/teams_plus_umbau/probe` war nicht mehr vorhanden; diese Messung läuft in eigener Probe `probe_stand` / `probe_stand_home` (eigenes Profil `probe`, Vorlage headless plus Bündel `experimental-agent-team-profile`, Attrappe `fake-llm.mjs` aus main). Aufbau und Startskript: `probe_aufbau.sh`. Keine Port-Nutzung, `dsh web` unberührt.

Das gemessene Modul ist dieser Worktree (`patches/team-modus.mjs`, Commit 43ff392 oder neuer).

## MESSUNG 1: Lauf mit Team-Modus an (teamModus true)

Datei: `ergebnis_teamaktiv_2026-11-12.json`. Kein Notschalter in der Probe (keine `team-modus.json`). Abgelegt wurde die Datei erst, nachdem `teamModus` als `True` und `notschalter` als `False` geprüft war.

| Prüfung | Ergebnis | Etikett |
|---|---|---|
| teamModus | `True` (Team-Modus an) | MESSUNG |
| notschalter | `False` | MESSUNG |
| Gruppen | `['mitglied', 'mitglied', 'eigeneUnteragenten']` | MESSUNG |
| Kinder exp1 | 4 Zeilen, Enkel `depth 2` mit parentId auf das direkte Kind fachA | MESSUNG |
| fachA (abgebaut, Ziel paused) | `aktivierung: "unbekannt (sitzt nicht in der Datei)"`, `bericht: true` | MESSUNG |
| blockedKind (abgebaut, Ziel blocked) | `aktivierung: "unbekannt (sitzt nicht in der Datei)"` | MESSUNG |
| eigenesLeadKind (Sitzung zerstört) | `gelesenAus: "nicht lesbar"` | MESSUNG |

Ehrlich eingeschränkt: diese Kinder sind alle **abgebaut** zum Zeitpunkt des Stand-Aufrufs. Der Lauf zeigt die Team-Modus-Ausgabe, nicht den Lebendfall.

## MESSUNG 2: lebendes Kind (Abnahme 7, Lebendfall)

Datei: `ergebnis_lebend_2026-11-12.json`, Treiber `lebend_treiber.mjs`. Das Mitglied `exp` wurde mit einer langen Nachricht lebendig gemacht, dann lief ein Kind mit `[[LONG]]` und einem Ziel mit `maxGoalRounds 60`.

| Prüfung | Ergebnis | Etikett |
|---|---|---|
| Kind lebt vor der Lesung | `True` | MESSUNG |
| Status des lebenden Kindes | `running` | MESSUNG |
| Zielphase des lebenden Kindes | `active` | MESSUNG |

Die Lesung des Lebendkindes selbst (Stand-Zeile mit `gelesenAus: "lebender Agent"` und `aktivierung` aus dem Ziel) ist hier **nicht** als Stand-Ausgabe gemessen: der Lebend-Treiber liest den Zustand über die Registry, nicht über `team_stand`. Die Aussage „lebend wie abgebaut“ für Abnahme 7 ist damit für den Kern-Zweig `lebender Agent` nur über die Registry belegt, nicht über das Werkzeug.

## MESSUNG 3: Zählerfall (Abnahme 4)

Im selben Lauf `ergebnis_lebend_2026-11-12.json`, Feld `fenster`: `neueAgenten: []`, `zuegeJeKennung: []`.

Eine Zählung, bei der der Zähler steigen müsste, habe ich **nicht** erzeugt: das lebende Kind lief bereits vor dem Lesefenster, und der Zählerfall (Zugsteigerung durch ein Kind ohne eigenen Zielbetrieb) wäre nur bei einem frisch geweckten Kind sichtbar. Ergebnis ist deshalb „keine Steigerung in einem Fenster, in dem das Kind ohnehin läuft“. Das belegt Abnahme 4 nur eingeschränkt.

## Was offen bleibt

- Ein Stand-Aufruf **während** ein Kind lebt, mit `gelesenAus: "lebender Agent"` im Werkzeug-Ergebnis, ist nicht gemessen.
- Ein Kind, das aus dem Ruhezustand geweckt wird (Zählerfall im engen Sinn), ist nicht gemessen.
- Zugang zur Probe: der Lauf endete mit einem übrig gebliebenen fremden Prozess (`probe_eltern`), den ich beim Aufräumen versehentlich beendet habe; er gehört einem anderen Worker und ist im Bericht gemeldet.

## Prozesszähler

Nach jedem Lauf 0 (`probe_procs_nach`), außer bei der Lebend-Messung, wo ein fremder Restprozess sichtbar war und nicht zu meinem Lauf gehörte.
