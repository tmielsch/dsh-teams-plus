# Abnahme Bau: Eltern-Sitzung laden (2026-11-12)

Gebaut nach `docs/ZIELBRIEF-BAU-ELTERN-LADEN-2026-11-12.md` und `docs/PLAN-ELTERN-LADEN.md` (Zweig `umsetzung/eltern-laden`, Issue DSH-Verwaltung 175 „Unteragenten-Sitzung nicht anschreibbar, wenn die Eltern-Sitzung offline ist“, Fund Issue 177 „Elternteil ist selbst ein Kind“). Gelesen vor dem Bau, vollständig: Zielbrief (21 Zeilen), Plan (104 Zeilen, Datei vom 12.11. 20:02), `ERWARTUNG-2026-11-12.md`, `ERGEBNIS-2026-11-12.md` (M1 bis M16), `probe-eltern.sh`, `treiber.mjs`, `fake-llm.mjs`, `stub-dienste.mjs`. Messungen aus der Planmessung (M1 bis M16) wurden nicht wiederholt, außer wo der gebaute Patch statt des Treiber-Hakens läuft.

**Aufbau der Bau-Probe.** `docs/messung-eltern-laden/probe-bau.sh <szenario> mit|ohne` (Overlay `probe-bau.patch.yml`, Treiber `treiber-bau.mjs` ohne jeden Haken im Treiber). `mit` lädt `patches/eltern-laden.mjs` über das Overlay, `ohne` lässt die Zeile weg (Gegenprobe). Eigene Pfade: `DSH_HOME=/tmp/teams_plus_umbau/probe_eltern_bau_home`, Arbeitsordner `/tmp/teams_plus_umbau/probe_eltern_bau`, kein Port, kein Webserver. Beendet wird nur die in `probe-eltern-bau.pid` festgehaltene PID (`--beende`). Der echte Session-Controller des Web-Profils ist geladen (wie in der Planmessung), das Modell ist die Attrappe, die jeden Aufruf in `llm-aufrufe.log` zählt. Rohdaten: `docs/messung-eltern-laden/ergebnis_<szenario>_mit.json` und `_ohne.json`. Nach jedem Lauf Prozesszähler der Probe 0; `dsh web` (Port 3080) und `~/.dsh/profiles/web` wurden nicht berührt.

Alle Zahlen unten sind `MESSUNG` (aus der Ergebnisdatei gelesen), wenn nichts anderes dasteht. Die Spalte „wäre falsch, weil“ nennt, was anders herausgekommen wäre.

## Abnahmen aus Plan Abschnitt 7

| Nr. | Abnahme | Ergebnis (mit Patch) | Gegenprobe (ohne Patch) | Wäre der Bau falsch, käme hier etwas anderes heraus, weil … | Datei |
|---|---|---|---|---|---|
| 1 | Kind bei kaltem Elternteil anschreiben (Gateway `subagents/prompt`) | `ok: true`, `messageId` vorhanden; Elternteil lebt danach; `session.list` vorher: Elternteil `agentAvailable: false`, danach `true` | `parent-unavailable` („parent session … is not live“), Modellaufrufe 2 → 2 | ohne den Haken liefert derselbe Aufruf den Fehler, die rote Gegenprobe zeigt es | `ergebnis_tor_mit.json`, `ergebnis_tor_ohne.json` |
| 2 | Laden startet keine Runde, keinen Modellaufruf | Szenario `laden`: fünf Messpunkte (je 1 s) nach dem Öffnen, Modellaufrufe insgesamt, des Elternteils und des Kindes je 0; Gesamtzahl 2 → 2, Züge unverändert (Elternteil 1, Kind 1). Szenario `neustart-b`: Modellaufrufe in den ersten Sekunden und über 5 s: 0 | – | die Attrappe zählt auch Lead-Züge ohne Text (leere Zeile, siehe `llmLog` in `ergebnis_tor_mit.json`); eine Runde beim Laden hätte eine Zeile erzeugt | `ergebnis_laden_mit.json`, `ergebnis_neustart-b_mit.json` |
| 3 | Aktives Ziel des Elternteils wird nicht scharf | Szenario `neustart-a` (harter Abbruch, Exit 137 gewollt): vorher `active`/`armed`, `roundsStarted` 1. `neustart-b`: Elternteil geladen, Ziel `active`, Aktivierung `disarmed`, `roundsStarted` 1 unverändert, fünf Messpunkte `llmEltern: 0`, Status `idle`; danach Anschreiben des Kindes `ok` | – | wäre das Ziel scharf geworden, hätte ein Messpunkt `llmEltern > 0` oder `armed` gezeigt | `ergebnis_neustart-a_mit.json`, `ergebnis_neustart-b_mit.json` |
| 4 | Öffnen lädt den Elternteil im Hintergrund | `session.page` kehrt nach 39 ms zurück; zu diesem Zeitpunkt lebt der Elternteil noch nicht (`false`), nach 1 s lebt er (`true`), zwei Ereignisse `api-session/added` mit `agentAvailable: true` (3 ms auseinander); `session.list`: Elternteil `true`; Modellaufrufe 2 → 2. Patchprotokoll: `laedt art=oeffnen-page`, `geladen … ms=48` | Elternteil bleibt kalt (`lebt: false` nach 1 s), keine Ereignisse, `session.list` `false`, `page` kehrt nach 20 ms zurück | ohne den Haken bleibt der Elternteil kalt, das zeigt die Gegenprobe; wäre das Laden abgewartet worden, läge die Rückkehrzeit bei mindestens der Ladezeit und `lebt` wäre schon sofort `true` | `ergebnis_oeffnen_mit.json`, `ergebnis_oeffnen_ohne.json` |
| 5 | Mehrere gleichzeitig | zwei gleichzeitige Gateway-Prompts auf zwei Kinder: beide `ok`; Patchprotokoll: **ein** `laedt`, **ein** `geladen` (Zählung des Elternteils in `agent/created`: 2 = 1× Anlegen, 1× Laden) | – | doppeltes Laden hätte zwei `laedt`-Zeilen und drei `agent/created` ergeben | `ergebnis_parallel_mit.json` |
| 6 | Fehlerfälle brechen nichts | defekte Elterndatei: `follow` liefert den ersten Rahmen `snapshot`, `page` `ok`, Patchprotokoll `warn ladefehler … code=gateway/internal … corrupt Zstandard session`, Anschreiben bleibt `parent-unavailable` (eigener Fehler des Kerns). Elternteil ohne Datei: Öffnen und Anschreiben melden den eigenen Fehler des Kerns („subagent does not belong to the supplied parent“ bzw. `parent-unavailable`), Patchprotokoll `eltern-fehlt … code=session/not-found`. `follow` bei intaktem Elternteil: `snapshot`, Elternteil lebt nach 600 ms | `follow` bei intaktem Elternteil: Elternteil bleibt kalt | ein Fehler im Haken hätte das Öffnen mit `fehler` statt `snapshot` beendet | `ergebnis_oeffnen2_mit.json`, `ergebnis_oeffnen2_ohne.json` |
| 7 | Browser | **ausstehend**, nur der Mensch kann das im echten `dsh web`; Anleitung unten | – | – | – |
| 8 | Notschalter `eltern-laden.json` | `{"aus": true}`: Anschreiben `parent-unavailable`, Öffnen lädt nicht (Elternteil bleibt kalt), Datei gelöscht: Anschreiben `ok` und Elternteil lebt; kaputte Datei (`das ist kein json`): `parent-unavailable`, Patchprotokoll `warn Notschalter-Datei … ist unlesbar … das Modul bleibt AUS` | – | ein Schalter, der nicht gelesen oder nicht beachtet würde, ließe das Anschreiben trotz `aus` gelingen | `ergebnis_notschalter_mit.json` |
| 9 | Kette bleibt, wie sie ist | Lead → Mitte (selbst Kind, kalt) → Enkel: Anschreiben des Enkels `parent-unavailable`, Meldung trägt jetzt den Zusatz „Die Eltern-Sitzung ist selbst ein Unteragent und kann nicht automatisch geladen werden … (Issue DSH-Verwaltung 177)“; `page` auf den Enkel `ok`; Patchprotokoll `eltern-ist-kind … code=session/agent-busy`; Mitte bleibt kalt (nicht geladen); der Lead kann die Mitte weiterhin direkt anschreiben (`ok`, Kernweg); kein Absturz | – | ein Laden der Mitte hätte sie lebend gemacht und den Lead-Weg zerstört (M12); die Mitte blieb kalt und der Weg des Leads geht | `ergebnis_kette_mit.json` |

## Zielbrief-Abnahmen

1. **Gesamtsuite:** `node --test test/*.test.mjs` → 298 Tests, 298 grün (`MESSUNG`; Basis 258 plus 40 neue; vorher ohne die Änderung an `test/umzug.test.mjs` 296 grün, 2 rot, siehe unten).
2. **Abnahmen aus Abschnitt 7:** 1 bis 6, 8, 9 erfüllt; Nr. 7 ausstehend (Mensch).
3. **Laden löst keine Runde, keinen Modellaufruf, keine Zielaktivierung aus** (Zähler vor und nach, je Sitzungskennung): `laden` (Gesamt, Elternteil, Kind: 0 über 5 Messpunkte), `neustart-b` (Elternteil 0, Ziel `disarmed`), `oeffnen` (2 → 2). Im Test zusätzlich: das Modul ruft auf `ctx.agents` nur `get` auf und berührt `ctx.goals` nie (Prüfung 17).
4. **Notschalter:** Abnahme 8 oben. Die Datei liegt im Teams-Plus-Ordner `~/.dsh/.tm/teams-plus/eltern-laden.json` (`datenOrdner()` aus `patches/team-modus.mjs`, nur gelesen), das Protokoll in `~/.dsh/.tm/teams-plus/logs/eltern-laden.log`. In der Probe liegen beide unter `probe_eltern_bau_home/.tm/teams-plus/`. Der Plan nennt diese Stelle in Abschnitt 6 schon; sie ist dort unverändert richtig (Entscheidung O2).
5. **Prozesszähler 0** nach jedem Lauf (`probe-bau.sh --zaehler` → `probe-prozesse=0`); `dsh web` (PID 3078 auf Port 3080) wurde nur gelesen (`ps`), nicht berührt; keine fremde Probe (`probe_stand`, `probe_eltern`) angefasst.

## Tests (`test/eltern-laden.test.mjs`, 40 Tests)

19 Prüfungen der Verdrahtung gegen eine Attrappe des Hosts, in der der Kern wie der echte ablehnt, wenn der Elternteil nicht lebt (Anschreiben kalt/lebend, Abwarten, Ladefehler, Abbruch des Aufrufers, Elternteil-ist-Kind, `page`/`follow` im Hintergrund, gewöhnliche Adresse, Gleichzeitigkeit, Notschalter an/aus/kaputt/ohne Neustart, Abbau stellt die Originale wieder her, Controller kommt später, ohne Controller, kein Team-Dienst und kein Ziel berührt, Ladefehler beim Öffnen ohne unbehandelte Zurückweisung, Lader), dazu reine Funktionen, Vertrag und „keine Einzelfälle“ (keine Sitzungskennung im Quelltext). **13 Mutationen** (Kopien des Moduls mit je einer Verfälschung), jede muss die zuständige Prüfung rot machen und besteht damit: Laden nicht abwarten, Notschalter in den Haken ignoriert, Schalter-Feld immer `false`, Haken B lädt nie, Menge „im Flug“ fehlt, Rücknahme stellt nichts wieder her, Lader prüft Leben nicht, Einordnung „Elternteil ist Kind“ kaputt, Ladefehler nicht gefangen (zweimal, Anschreiben und Öffnen), Abbruch des Aufrufers ignoriert, Haken A wickelt nichts um, Modul fragt nach dem Team-Dienst. Die vier Mutationen des früheren Baus (Frist 120 ms statt 120 s, Frist ignoriert, Schalter immer `false`, Sortierung entfernt) haben hier ihre Gegenstücke: Abbruch/Frist (Mutation „Abbruch des Aufrufers ignoriert“, Prüfung 5), Schalter ignoriert (2), Schalter-Feld immer `false` (3); eine Sortierung gibt es in diesem Modul nicht.

Beim Schreiben der Mutationen blieben zunächst zwei ungefangen (die Attrappe lud sofort statt mit Verzögerung; die Prüfung kannte den Weg ohne Signal nicht); beides wurde in den **Prüfungen** nachgezogen, nicht im Modul.

## Was ich im Plan nicht vorfand oder anders gemacht habe

- Der Plan (Schritt 2) nennt einen Eintrag in `cordis.patch.yml`; der Zielbrief verbietet ihn. **Es gibt keinen Eintrag.** Das Einspielen (Eintrag `eltern-laden` neben `team-modus`, Name `@tmielsch/dsh-teams-plus/patches/eltern-laden.mjs`) ist die Aufgabe des Leads.
- Haken B wird über `ctx.inject(["sessionController"], …)` eingehängt, nicht über `inject` des Moduls: `sessionController` gehört dem Web-Profil, ein Profil ohne Web (Probe, headless) hat ihn nicht. Der Plan sagt „weich über `ctx.get`“; `ctx.inject` ist die weiche Variante, die auch einen später kommenden Controller erfasst (Test 15 prüft das).
- `follow` wird über eine gewöhnliche Funktion umwickelt, die den asynchronen Generator des Originals unverändert zurückgibt (der Strom wird nicht verzögert). Gemessen über den Dienstaufruf (`ersterRahmen`), **nicht** über den Gateway-Strom-Träger (wie M7); Etikett: Gateway-Strom für `follow` ungemessen, `SCHÄTZUNG`.
- Der Plan verlangt zu Elternteil-ist-Kind „eine Protokollzeile“; zusätzlich hängt der Haken A einen lesbaren Hinweis an den Fehler des Kerns (Entscheidung O3: „klar ablehnen mit lesbarer Meldung statt still“). Der Fehlercode bleibt `subagent/parent-unavailable`, nur die Meldung wächst.
- Der Zielbrief verlangt eine Änderung an `test/umzug.test.mjs` nicht; sie wurde nötig (zwei Tests mit fester Dateizahl) und vom Lead freigegeben, als eigener Commit.

## Ungemessen (ehrlich)

- Browser (Abnahme 7) und Eingabefeld-Entsperrung: Quelltext gelesen (Plan Annahme 5), nicht gesehen.
- Gateway-Strom für `follow` (nur der Dienstaufruf gemessen).
- Ladezeit großer Lead-Sitzungen (alle Probe-Sitzungen winzig: Laden 29 bis 68 ms).
- Teammitglied (`spawnTeammate`) als kalter Zwischen-Elternteil: Probe benutzte `startContinuable` (`SCHÄTZUNG`, gleicher Pfad).
- Ob der echte Host (`dsh web` mit Verbindung) die ersetzte Methode `sessionController.page` durchläuft, wenn der Client sie ruft: Die Probe nutzt den echten Gateway-Code, aber keinen Webserver (`SCHÄTZUNG`, durch Abnahme 7 zu belegen).
- Eine verspätete Abschlussmeldung im Postfach des Elternteils (M10 blieb dort eingeschränkt).
- Der echte Neustart von `dsh web` (nur Mensch).

## Abnahme 7 vorbereiten: was der Mensch im echten `dsh web` tut

Voraussetzung: Der Lead hat den Eintrag `eltern-laden` in `cordis.patch.yml` eingespielt, und `dsh web` wurde vom Menschen neu gestartet (das tut nur er). Die Schritte in Alltagssprache:

1. **Ausgangslage herstellen.** Du brauchst ein Gespräch (Lead), in dem ein Unteragent gearbeitet hat, und das nach einem Neustart von `dsh web` noch nicht wieder geöffnet wurde. Das ist der Normalfall nach jedem Neustart: Der Lead liegt dann nur als Datei da, die Seitenleiste zeigt ihn, aber er ist nicht „lebendig“.
2. **Vorher ansehen (ohne den Patch, nur zum Vergleich, falls du magst):** den Unteragenten in der Seitenleiste öffnen. Früher stand dort „Parent session offline“ und das Eingabefeld war grau.
3. **Mit dem Patch:** Öffne, ohne den Lead anzuklicken, direkt den Unteragenten. Erwartet:
   - Der Text „Parent session offline“ erscheint nicht (oder verschwindet nach ein bis zwei Sekunden).
   - Das Eingabefeld ist frei.
4. **Schreibe dem Unteragenten eine kurze Nachricht** (zum Beispiel „Sag nur: ok“). Erwartet: Sie kommt an, der Unteragent antwortet. Wundere dich nicht, wenn dadurch der Lead einmal eine Runde macht: Das ist die normale Folge, wenn ein Kind antwortet (M9), nicht das Laden.
5. **Gegenprobe Notschalter:** lege die Datei `~/.dsh/.tm/teams-plus/eltern-laden.json` mit dem Inhalt `{"aus": true}` an, öffne einen anderen Unteragenten eines kalten Leads. Erwartet: die alte Sperre ist wieder da. Datei löschen: es geht wieder.
6. **Nachsehen:** `~/.dsh/.tm/teams-plus/logs/eltern-laden.log` zeigt Zeilen `laedt art=…` und `geladen eltern=… ms=…`.
7. **Meldung zurück:** Sieht das Feld frei aus, ist die Aussage „die Sperre ist gelöst“ belegt; bleibt es grau, ist Annahme 5 des Plans widerlegt, und der Client-Teil wird nötig. Ein Lead mit `blick` kann Schritt 3 auch mit einem Bild belegen.
8. **Der Sonderfall, der bewusst nicht gelöst ist:** ein Unteragent unter einem Experten, der selbst ein Unteragent ist und kalt liegt (Issue 177). Hier bleibt die Sperre; die Meldung enthält jetzt den Hinweis auf die Grenze.

Beim Einspielen zusätzlich (Aufgabe des Leads, Plan Schritt 7): der Satz in `agents/teams-plus-agents.voll.md` Zeile 181 „Außerhalb des Team-Modus ändert Teams Plus nichts“ muss geöffnet werden (Entscheidung O1).
