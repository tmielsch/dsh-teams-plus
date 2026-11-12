# Abnahme-Messung team_stand Unteragenten (zweite Nachbesserung, 2026-11-12)

Ersetzt die frühere Fassung. Messlauf in eigener Probe `probe_stand` / `probe_stand_home`, Startskript `probe_aufbau.sh` (PID-Datei `probe_pids.txt` während des Laufs, danach gelöscht). Keine Port-Nutzung, `dsh web` unberührt. Gemessenes Modul: `patches/team-modus.mjs` des Zweigs `umsetzung/team-stand-unteragenten`, Stand nach Commit c19fe84.

Massgeblich sind: `ergebnis_teamaktiv_2026-11-12.json` (Team-Modus an), `ergebnis_notschalter_2026-11-12.json` (Notschalter), `ergebnis_lebend_2026-11-12.json` (lebendes Kind). Die Altdateien `ergebnis_abnahme_v3.json` und `ergebnis_abnahme_notschalter_v3.json` gelten nicht als Beleg; siehe `LIES-MICH-ALTE-DATEIEN.md`.

## Tabelle der neun Plan-Abnahmen (Plan Abschnitt 7)

Ausgegeben vom Auswerter `abnahme_auswerten.mjs` gegen den Team-Modus-Lauf (`abnahme_auswertung_ergebnis_teamaktiv_2026-11-12.json`):

| Nr | Ergebnis | Etikett | Befund aus dem Lauf |
|---|---|---|---|
| 1 | PASS | MESSUNG | Gruppen mitglied=2, eigene=1; fachA depth 1; Enkel depth 2 parentId 72ab24; exp2 Kinder 0 |
| 2 | PASS | MESSUNG | fachA paused=paused; blockedKind=blocked (zwei Lagen je Phase) |
| 3 | PASS | MESSUNG | fachB ziel=null gelesenAus=gespeicherte Sitzung; eigenesLeadKind gelesenAus=nicht lesbar |
| 4 | PASS | MESSUNG (eingeschraenkt: abgebaute Kinder) | Fenster Stand: neue=[] Zuege=[]; Fenster Katalog: neue=[] Zuege=[] |
| 5 | PASS | MESSUNG | Teammitglieder als Kinderzeile: false; eigenesLeadKind in eigener Gruppe: true |
| 6 | PASS | MESSUNG (Gegenprobe Node-Test 9) | Mitglieder-Gruppen 2; Gruppen mit Kindern 2; Leadkind in eigener Gruppe: true. Der Vergleich mit dem Git-Stand steht im Node-Test. |
| 7 | PASS | MESSUNG (nur abgebaut) | fachA bericht=true; lebende Variante ungemessen (siehe Messblatt) |
| 8 | PASS | MESSUNG | fachA aktivierung="unbekannt (sitzt nicht in der Datei)" zustand=abgebaut |
| 9 | PASS | MESSUNG | exp1 angehaltenSeit=2026-11-12T21:31:28.970Z gleich Eintrag=2026-11-12T21:31:28.970Z; fachB=2026-11-12T21:30:58.970Z gleich Eintrag=2026-11-12T21:30:58.970Z; eigenes Kind ohne Eintrag=null |
| 7-lebend | PASS | MESSUNG (Registry, nicht Werkzeug) | kindLebtVorLesung=true status=running zielPhase=active |

## Prüfungen am Lauf (Antwort geprüft, bevor abgelegt)

| Lauf | teamModus | notschalter | Ergebnis-Datei |
|---|---|---|---|
| Team-Modus an (kein Notschalter in der Probe) | true | false | `ergebnis_teamaktiv_2026-11-12.json` |
| Notschalter (`{"aus": true}`, NOTSCHALTER=1), neu gemessen mit erweitertem Treiber (Feld `uebernahmen` im Ergebnis) | false | true | `ergebnis_notschalter_2026-11-12.json`; Auswertung `abnahme_auswertung_ergebnis_notschalter_2026-11-12.json`: alle neun Abnahmen PASS |

Im Notschalter-Lauf bleiben die drei Gruppen mit Kinderzeilen erhalten (Abnahme 4 des Zielbriefs).

## Lebendes Kind (Abnahme 7, eingeschränkt)

`ergebnis_lebend_2026-11-12.json`, Treiber `lebend_treiber.mjs`: das Kind läuft beim Lesen (`kindLebtVorLesung` true, Status running, Zielphase active). Der Stand-Aufruf während das Kind lebt (`gelesenAus: "lebender Agent"` im Werkzeug) ist NICHT gemessen; die Lebendlage ist nur über die Registry belegt.

## Zählerfenster (Abnahme 4, eingeschränkt)

Fenster im Team-Modus-Lauf: keine neuen Agenten, keine Zugsteigerung. Das Kind lief schon vor dem Fenster; ein Anstieg durch frisch geweckte Kinder ist NICHT gemessen.

## Offen

- Stand-Aufruf während ein Kind lebt, mit `gelesenAus: "lebender Agent"`.
- Frisch geweckter Zählerfall.
- Die Fristen der Mitgliederlesung und der Katalogaufrufe sind über Tests belegt (`test/team-stand-frist.test.mjs`, Mutationen rot), nicht im Live-Lauf gemessen.
