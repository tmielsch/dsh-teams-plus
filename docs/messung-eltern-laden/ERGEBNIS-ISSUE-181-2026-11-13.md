# Ergebnis der Messung zu Issue 181 (2026-11-13)

Frage (Issue DSH-Verwaltung 181 „Eltern-laden: Das Laden kann wartende Team-Nachrichten ausliefern und eine Modellrunde starten“): Löst das Laden einer kalten Eltern-Sitzung, die ein Team-Lead ist und im Team-Journal eine noch nicht zugestellte Nachricht hat, eine Modellrunde oder ein Wecken aus? Erwartung davor: `ERWARTUNG-ISSUE-181-2026-11-13.md` (Commit b8acf5a).

**Antwort: Ja. Das Laden löst eine Modellrunde aus, und zwar sofort.** Gemessen mit echtem Team-Paket (`@deepseek-ai/dsh-experimental-agent-team`, Dienst `agentTeams`), nicht mit einer Attrappe des Teams; nur das Modell ist die Attrappe.

## Aufbau (Wegwerf, `docs/messung-eltern-laden/probe-bau.sh` mit `TREIBER=treiber-181.mjs`, Treiber `treiber-181.mjs`)

- Eigene Pfade `probe_eltern_bau`, `probe_eltern_bau_home`, PID-Datei `probe-eltern-bau.pid`, kein Port, nur eigene Prozesse (Zähler nach jedem Lauf 0), `dsh web` nicht berührt.
- **Phase 1** (`team1-<Lage>`): Lead anlegen, Mitglied `exp` über `agentTeams.spawnTeammate` anlegen, Mitglied wird fertig. Danach die Lage herstellen und den Prozess **hart beenden** (SIGKILL, Exit 137, kein Abbau).
- **Phase 2** (`team2-<Lage>-<Auslöser>`): Neustart auf denselben Sitzungsdateien, den Lead **nicht** laden (beim Start leben weder Lead noch Mitglied), Zähler der Modellaufrufe je Sitzungskennung vor dem Auslöser, direkt danach, nach 400 ms und nach 5 s. Auslöser `page` (Öffnen des Kindes, Gateway `session/page`) oder `prompt` (Anschreiben, Gateway `subagents/prompt`).
- **Lagen:** A = unzugestellte Nachricht mit Ziel Lead (Absender `exp`); B = unzugestellte Nachricht mit Ziel Mitglied `exp` (Absender Lead); C = Kontrolle ohne Nachricht.
- **Wie die unzugestellte Nachricht entsteht:** Das Ereignis `team/message/queued` wird mit genau der Form aus `dsh-experimental-agent-team/lib/index.js` `sendAdmitted` (Zeilen 922 bis 940) an das Lead-Journal angehängt und mit `sessions.flush` auf die Platte gebracht, **ohne** zuzustellen. Das ist dasselbe Bild, das ein Absturz zwischen „in Warteschlange“ und „zugestellt“ hinterlässt. Die Lage ist nachgestellt, nicht durch einen echten Absturz entstanden (`SCHÄTZUNG`, dass beides gleich aussieht; der Kern liest nur das Journal). Auf der Platte (zstd-Datei der Lead-Sitzung, mit `zstd -dc` gelesen) steht nach Phase 1 `queued: [id]`, `delivered: []`.
- „Ohne Patch“ (Gegenprobe) heißt: `patches/eltern-laden.mjs` ist nicht geladen. Dort wird zusätzlich **nach** den 5 Sekunden der Lead mit dem Lookup `agent` explizit geladen, also derselbe Ladeweg, den der Kern für `session.prompt` auf den Lead selbst nimmt (das passiert, wenn der Mensch den Lead öffnet und ihm schreibt).

## Zahlen (`MESSUNG`, aus `docs/messung-eltern-laden/issue-181/ergebnis_team2-<Lage>-<Auslöser>_<modus>.json`)

G = Modellaufrufe der Attrappe gesamt, L = des Leads, E = des Mitglieds `exp` (Zeilen in `llm-aufrufe.log`, je Sitzungskennung). Vorher war überall G2/L1/E1 (Start des Teams: je ein Aufruf). „Zugestellt“ = Zahl der Einträge in `delivered` der Team-Projektion des Leads.

| Lage | Auslöser | Patch | direkt nach dem Auslöser | nach 400 ms | nach 5 s | Zustellung |
|---|---|---|---|---|---|---|
| C (keine Nachricht) | page | mit | G2/L1/E1, Lead kalt | G2/L1/E1, Lead `idle` (geladen) | G2/L1/E1 | 0 |
| A (Ziel Lead) | page | mit | G2/L1/E1, Lead kalt | **G3/L2/E1**, Lead `idle`, Nachricht im Lead-Journal (`user/message:team-message`) | G3/L2/E1 | **zugestellt gebucht** (`team/message/delivered`) |
| A | page | ohne | G2/L1/E1, Lead kalt | G2/L1/E1, Lead kalt | G2/L1/E1 | nicht zugestellt (Journal auf der Platte: `queued`, `delivered` leer) |
| A | page | ohne, dann explizites Laden des Leads | – | – | **G3/L2/E1** nach dem Laden | zugestellt gebucht |
| B (Ziel Mitglied) | page | mit | G2/L1/E1, Lead und `exp` kalt | **G3/L1/E2**, `exp` `running` (kalt geweckt, `agent/created source=resume` für Lead und `exp`) | G4/L2/E2 (der Lead antwortet auf die Abschlussmeldung des `exp`) | zugestellt gebucht; auf der Platte `delivered` gesetzt |
| B | page | ohne | alles kalt | alles kalt | alles kalt | nicht zugestellt |
| B | page | ohne, dann explizites Laden des Leads | – | – | **G4/L2/E2** | zugestellt gebucht |
| C | prompt | mit | G2/L1/E1, Lead `idle`, `exp` `running` (die Menschen-Nachricht wird zugestellt) | G3/L1/E2 | G4/L2/E2 (Antwort des Kindes weckt den Lead, normal) | 0 |
| A | prompt | mit | Lead `running`, `exp` `running` | G4/L2/E2 | G5/L3/E2 | zugestellt gebucht (nach 400 ms) |
| B | prompt | mit | Lead `idle`, `exp` `running` | G3/L1/E2 | G5/L2/E3 (zwei Aufrufe des Kindes: Team-Nachricht und Menschen-Nachricht) | zugestellt gebucht |
| A/B/C | prompt | ohne | **abgelehnt**: `subagent/parent-unavailable` (7 ms), alles kalt | – | – | – |

Alle 12 Läufe der Matrix endeten mit Exit 0 ohne Fehlerfeld. Lage C mit `page` bestätigt die Planmessung (Laden ohne wartende Nachricht: 0 neue Modellaufrufe, Lead `idle`).

**Wäre die Konstruktion falsch, käme etwas anderes heraus, weil …** Lage C ist die Kontrolle in derselben Probe: dieselbe Schleife mit leerem Journal liefert 0 Aufrufe; die Lagen A und B unterscheiden sich von C nur durch den einen Journal-Eintrag `team/message/queued`. Und die Lagen „ohne Patch“ zeigen, dass ohne Laden nichts passiert (Aufrufe unverändert, Journal bleibt unzugestellt); erst das explizite Laden löst sie aus.

## Was das heißt

1. **Die Kette aus Issue 181 trägt** (Kern, nicht Plugin): `agent/created` → `scheduleRecovery` → `recoverFor` (Lead holt alle unzugestellten Nachrichten) → `dispatchOnce` → `root.steer` bzw. `steerHostSubagentPrompt` → ein Modellaufruf des Leads bzw. das kalte Wecken des Mitglieds. Der Lead hat in Lage A einen Aufruf binnen 400 ms nach dem Öffnen; in Lage B wird das **Mitglied** geweckt (kalt geladen), nicht der Lead.
2. **Der Patch löst das früher aus, nicht grundsätzlich anders:** Ohne Patch passiert dasselbe in dem Moment, in dem irgendetwas den Lead lädt (Mensch öffnet den Lead und schreibt, oder das Explizite Laden der Gegenprobe: Lage A G3/L2/E1, Lage B G4/L2/E2, identisch zur Patchzahl). Neu ist nur der Zeitpunkt (schon beim bloßen Öffnen eines Kindes) und dass der Mensch dabei den Lead nie angeklickt hat. Quota-Verbrauch: ein Modellaufruf je wartender Nachricht an den Lead, ein Aufruf des Mitglieds je wartender Nachricht an das Mitglied.
3. **Ohne wartende Team-Nachricht ist das Laden still** (Lage C, 0 Aufrufe). Wartende Nachrichten entstehen nur, wenn ein Prozess zwischen „in Warteschlange“ und „zugestellt“ endet, oder wenn eine Zustellung scheiterte (Zielmitglied kalt und nicht ladbar). Das ist der Ausnahmefall, aber nach einem harten Neustart von `dsh web` mit laufendem Team genau der naheliegende.
4. **Notschalter wirkt vorher:** Mit `~/.dsh/.tm/teams-plus/eltern-laden.json` = `{"aus": true}` lädt der Patch nicht (Abnahme 8 des Messberichts); die Zustellung beim späteren, bewussten Öffnen des Leads bleibt wie ohne Patch.

## Ungemessen

- Echter Absturz zwischen Anhängen und Zustellen (nachgestellt, nicht ausgelöst).
- Echtes Modell: ob der Lead auf die Team-Nachricht Werkzeuge aufruft oder Mitglieder weiterweckt (Attrappe antwortet nur mit „ACK n“); die Folge im Echtbetrieb kann länger sein als ein Aufruf (`SCHÄTZUNG`).
- Mehrere wartende Nachrichten: gemessen ist eine je Lage.
