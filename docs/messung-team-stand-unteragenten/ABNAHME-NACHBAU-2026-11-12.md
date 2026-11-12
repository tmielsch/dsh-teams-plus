# Abnahme-Messung nach dem Bau: team_stand für Unteragenten (2026-11-12)

Erwartung vorher aufgeschrieben: Plan `docs/PLAN-TEAM-STAND-UNTERAGENTEN.md` Abschnitt 7 Nr. 1–9; Zielbrief `docs/ZIELBRIEF-BAU-TEAM-STAND-2026-11-10.md`. Verglichen wird hier, nicht im Nachhinein umformuliert.

**Ort aller Messungen:** Wegwerf-Probeinstanz `DSH_HOME=/tmp/teams_plus_umbau/probe_home`, Profil `probe`, Attrappen-Modell `fake-llm.mjs` (Provider `probe`, Modell `m`). Das laufende `dsh web` wurde nicht angefasst; nach jedem Lauf Prozesszähler 0. Das gemessene Modul ist **dieser Worktree** (`/Users/tmielsch/dsh-teams-plus/.worktrees/umsetzung-team-stand-unteragenten/patches/team-modus.mjs`).

**Treiber:** `abnahme_treiber.mjs` (Wegwerf, in diesem Ordner gespiegelt), Startskript `abnahme.sh [Alarmsekunden]`, Auswerter `abnahme_auswerten.mjs`. Kinder wurden über denselben Kernweg wie `delegate_task` angelegt (`ctx.subagents.startContinuable({ provider: "spawn", … })`), Mitglieder über `ctx.agentTeams.spawnTeammate`. Aufruf von `team_stand` am Lead über den echten Cordis-Werkzeugweg (Nachricht `Rufe [[TOOL:team_stand:{}]]`, Attrappe ruft das eingetragene Werkzeug auf; gemessen aus dem Sitzungsereignis `tool/result`).

## MESSUNG A1 — die neun Abnahmen aus Plan Abschnitt 7

Ergebnis-Läufe: `ergebnis_abnahme_v3.json` und `ergebnis_abnahme_notschalter_v3.json`. **Korrektur (Prüfer-Fund 1):** `ergebnis_abnahme_v3.json` wurde mit `teamModus: false` und `notschalter: true` abgelegt (der Notschalter war gesetzt, weil eine `team-modus.json` vom vorherigen Lauf stehen geblieben war); er ist daher **kein** Beleg für den Team-Modus an. Ein Lauf mit Team-Modus an und lebendem Kind ist **nicht abgelegt** (siehe „Offen“ unten). Beide mit dem Auswerter gegen die Werte geprüft; der Auswerter druckt je Planzeile PASS/FAIL und schreibt `abnahme_auswertung.json` in die Probe. Kennungen: Lead `414292`, exp1 `8e8e65`, exp2 `e4c929`, fachA `40af98`, fachB `79d95a`, blockedKind `745905`, Enkel `17e067`, eigenes Leadkind `9fd389`.

| Plan Nr. | Frage | Ergebnis (MESSUNG) |
|---|---|---|
| 1 | Stehen die Kinder und Enkel gruppiert je Mitarbeiter? | **Ja [MESSUNG].** Zwei Gruppen `gruppe: "mitglied"` (Kopfexperten als `id`) plus eine eigene Gruppe `gruppe: "eigeneUnteragenten"`. In der exp1-Gruppe: fachA und fachB bei `depth: 1` (parentId = exp1), Enkel bei `depth: 2` und `parentId = 40af98` (= fachA, dasselbe direkte Kind). exp2 hat die leere Kinderliste; das eigene Leadkind steht nur in der eigenen Gruppe. Quelle: `ergebnis_abnahme_v3.json`, Feld `standNeu[0]`. |
| 2 | Letzte lebende Phase eines abgebauten Kindes stimmt mit der Datei-Phase überein? | **Ja [MESSUNG], beide geforderten Lagen gemessen.** Das pausiert abgebaute Kind fachA: `phase: "paused"`; das abgebaute Kind mit Rundenlimit 1: `phase: "blocked"`. Die Phasen stammen aus der Sitzungsdatei (Agent nicht im Speicher), dieselbe Weglänge wie Messung U-a. Quelle: `ergebnis_abnahme_v3.json`, Zeilen mit den Labels `Abnahme fachA` und `Abnahme blockedKind`. |
| 3 | Ist „kein Ziel“ (`null`) von „nicht lesbar“ unterscheidbar? | **Ja [MESSUNG].** fachB ohne je ein Ziel: `ziel: null`, `gelesenAus: "gespeicherte Sitzung"`. eigenesLeadkind, dessen Sitzungsordner vor dem Aufruf gelöscht wurde (Protokoll-Eintrag `sitzungsordner-zerstoert`): `gelesenAus: "nicht lesbar"`. Beide Werte sind klar getrennt. Quelle: dasselbe JSON. |
| 4 | Weckt das Lesen jemanden? | **Nein.** In beiden Fenstern (Katalog/Baum-Lesung und Stand-Aufruf) waren `neueAgentenImFenster: []` und `zugenommeneZuegeProKennung: []`; Kinder liefen in den Fenstern ohne eigenen Zielbetrieb. Zähler je Sitzungskennung, wie von Plan Nr. 4 gefordert (der Vorbehalt aus T4d gilt so nicht mehr). Quelle: Felder `fensterKatalog` und `fensterStand` beider JSONs. |
| 5 | Doppelung weg? | **Ja [MESSUNG].** Die Kennungen der beiden Teammitglieder erscheinen ausschließlich als Gruppenköpfe (`untergruppen[i].id`), nie als Kinderzeile, obwohl exp1 im Kinderkatalog des Lead steht (gemessen in `kinderVonLead`). Das eigene Leadkind steht nur in der eigenen Gruppe. Bereinigt über die Sitzungskennung (Test 2 belegt zusätzlich: den Katalog des Experten lesen wir genau einmal). Quelle: dasselbe JSON, Felder `kinderVonLead` gegen `untergruppen`. |
| 6 | Ohne diese Änderung fehlt es — Gegenprobe? | **Erfüllt im Node-Test 9** (`test/team-stand-unteragenten.test.mjs`): mit dem Git-Alten Modul aus Commit `de28469` fehlt auf derselben Szene das Feld `untergruppen` ganz und es bleibt nur die Mitgliederzeile; mit dem gebauten Modul stehen beide Gruppen. In der Probe: dieselbe Szene mit dem Bau liefert jetzt die Kindergruppen. Quelle: `test/team-stand-unteragenten.test.mjs` Test 9 + `ergebnis_abnahme_v3.json`. |
| 7 | Berichtsweg für Unteragenten (bericht=true, lebend wie abgebaut)? | **Ja [MESSUNG (nur abgebaut)].** fachA mit angelegtem Ziel und geschriebener Berichtsdatei unter dem Probe-Berichtsordner (`.../state/berichte/<zielId>.json`): `bericht: true`, obwohl die Ziel- und Zeilenlesung über die gespeicherte Sitzung lief — die Zielkennung überlebt die Dateilesung. Quelle: `ergebnis_abnahme_v3.json`. |
| 8 | Aktivierung bei Abgebauten ehrlich „unbekannt“ (O1)? | **Ja [MESSUNG].** fachA (abgebaut, Ziel lesbar mit Phase): `aktivierung: "unbekannt (sitzt nicht in der Datei)"` — genau der Wortlaut der Menschenentscheidung O1; die Phase ist trotzdem vorhanden. Quelle: dasselbe JSON. |
| 9 | Angehaltenseit unabhängig von `pauseOffen`, für Mitglieder **und** Kinder, ohne Eintrag `null`? | **Ja [MESSUNG].** exp1 (Eintrag mit `pauseOffen: false`): `angehaltenSeit` gleich dem Zeitstempel aus `uebernahmen.json` des Laufs (im abgelegten Lauf `ergebnis_abnahme_v3.json` mit dem Wert aus dem Eintrag gegengeprueft). fachB (Eintrag mit `pauseOffen: true`): `angehaltenSeit` gleich dem eigenen Eintrag-Zeitstempel. **Korrektur:** die im früheren Text genannten Zeitstempel (05:29:14, 05:28:44) stehen in keiner abgelegten Datei und wurden entfernt. — beide Nachbarn zeigen denselben Zeitstempel ihres Eintrags. eigenLeadkind ohne Eintrag: `angehaltenSeit: null`, ausdrücklich nicht „unbekannt“. Quelle: dasselbe JSON; beide Felder an Mitglieds- und Kinderzeilen gemessen. |

## MESSUNG A2 — Notschalter gedrückt (Zielbrief-Abnahme 4 und Plan-A7/O2)

Aufbau wie v3, aber `team-modus.json` mit `{"aus": true}` vor dem Lauf. Ergebnis: `ergebnis_abnahme_notschalter_v3.json`. Das Modul meldet `teamModus: false`, `notschalter: true`, und liefert **trotzdem** beide Mitgliederzeilen und alle drei Gruppen mit allen Kinderzeilen. Das ist genau die T5-Messung, jetzt am gebauten Modul wiederholt: das reine Anzeigen von Unteragenten außerhalb des Team-Modus verletzt den Notschalter nicht (O2-Entscheidung), nur die Meldungsfilter sind aus. Quelle: dasselbe JSON.

## Prozesszähler danach (Grenze aus dem Zielbrief)

```
ps aux | grep -c "[d]sh --profile probe"   # alle Läufe, jeweils Perl-Alarm als Notaus
```

Nach jedem Lauf (v3 normal und v3 Notschalter): **0** (MESSUNG, direkt aus dem Startskript ausgedruckt: `probe_procs_nach=0`). Kein Dienst gestartet oder gestoppt. Das laufende `dsh web` wurde nicht angefasst; während der ersten Läufe lief es unter PID 35460 weiter (`ps -p 35460`), später existierte diese PID nicht mehr — ich habe an diesem Prozess nichts geändert und melde den Wechsel nur als Beobachtung.

## Offen (Prüfer-Funde 1 und 6)

- **Lauf mit Team-Modus an und lebendem Kind:** nicht abgelegt. Die Probe-Instanz `/tmp/teams_plus_umbau/probe` ist in dieser Sitzung nicht mehr vorhanden (Attrappe `fake-llm.mjs` und Probe-Heim fehlen); ein solcher Lauf kann hier nicht ausgeführt werden. Bis dahin gilt die Abnahme 4 nur für bereits abgebaute Kinder.
- **Abnahme 7 „lebend wie abgebaut“:** gemessen wurde nur das abgebaute Kind. Die lebende Variante ist ungemessen; die Aussage ist entsprechend auf „abgebaut“ eingeschränkt.
- **Abnahme 4:** Die Messung lief ausschließlich gegen abgebaute Kinder. Ein lebendes Kind, in dem der Zähler steigen müsste, ist nicht gemessen.

## Was aus dieser Messung NICHT folgt

- **(U-b, unverändert offen)** Die Kosten an einer großen Sitzung sind weiterhin ungemessen; der Treiber lief nur an kleinen Probesitzungen (Einzel-Lesungen 1–42 ms am Wegwerfszenario). Die Summenfrist von 120 s wurde im Test und am Algorithmus belegt, aber nicht an einer großen Lead-Sitzung.
- **(U-e, unverändert offen)** Ziel-Projektion eines abgebauten echten Teammitglieds, das zuvor ein Ziel **hatte**, bleibt ohne eigene Messung; die Probe-Mitglieder hatten hier kein angelegtes Ziel.
- **Kind ohne aktives Ziel in der Übernahme-Datei:** Fall (c) wurde an einem Kind ohne Eintrag gemessen; ob für Kinder überhaupt je ein Eintrag geschrieben wird, hängt an Issue „DSH-Verwaltung“ 133 — unverändert offen, im Plan ausdrücklich nicht als gelöst beschrieben.
