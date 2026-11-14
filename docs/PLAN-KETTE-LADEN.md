# Plan: Kette laden — ein Kind eines Kindes wecken, wenn Lead, Zwischenkind und Kind alle kalt sind (2026-11-13)

**Zweig:** `plan/kette-laden` (Worktree `/Users/tmielsch/dsh-teams-plus/.worktrees/plan-kette-laden`, ausgehend von `main` nach dem Merge von `umsetzung/eltern-laden`). **Kein Code im Plugin**, nur dieser Plan und Messbelege unter `docs/messung-kette-laden/` (Erwartung davor: `ERWARTUNG-2026-11-13.md`; Ergebnis: `ERGEBNIS-2026-11-13.md`; Rohdaten `ergebnis_k1-*.json`, `ergebnis_k2-*.json`; Aufbau `probe-kette.sh`, `probe-kette.patch.yml`, `treiber-kette.mjs`, `fake-llm.mjs`, `stub-dienste.mjs`). Zielbrief: `docs/ZIELBRIEF-KETTE-LADEN-2026-11-13.md`. Vorarbeit: `docs/PLAN-ELTERN-LADEN.md`, `patches/eltern-laden.mjs` (Release 0.8.7). Art der Aufgabe: **Prototyp, inkrementelles Weiterbauen** (kein Red-Team vor dem Start nötig, wenn der Mensch Option B wählt; bei einem Kerneingriff, Option D, ist es ein großer Umbau und braucht Red-Team und Abnahme durch den Lead).

## 1. Gegenstand in einem Satz, und was dieser Plan nicht beantwortet

Der Plan beschreibt, wie sich ein Unteragent (Enkel), dessen Elternteil (Zwischenkind) selbst ein Unteragent ist und dessen Vorfahren alle nicht im Arbeitsspeicher liegen, **jederzeit anschreiben lässt**, ohne den Kern von DSH zu ändern, und was das an Modellaufrufen kostet.

**Er beantwortet nicht:** wie das Eingabefeld im echten Browser reagiert (nur aus Quelltext gelesen, nicht gesehen; `dsh web` darf ich nicht berühren); Tiefe drei oder mehr (nur Konstruktion, nicht gemessen); echte Modelle (die Messung benutzt eine Attrappe, die nur „ACK n“ antwortet); große Sitzungen (alle gemessenen Sitzungen sind winzig); und alle Entscheidungen, die nur der Mensch treffen kann (Abschnitt 8).

## 2. Spec-Sätze, die der Plan umsetzt

**Keine Spec für diesen Bereich genannt** (das Spec-Verzeichnis der `AGENTS.md` kennt keine Spec zu Unteragenten-Weckung; die Vorgabe dieses Auftrags ist der Wortlaut des Menschen im Zielbrief `docs/ZIELBRIEF-KETTE-LADEN-2026-11-13.md`, Zeile 4, Stand: Commit „Zielbrief: Plan Kette laden …“ auf diesem Zweig, `c00fd58`). Wörtlich, vom Menschen (Issue DSH-Verwaltung 175, „Unteragenten-Sitzung nicht anschreibbar, wenn die Eltern-Sitzung offline ist“):

> „Ich muss jederzeit in der Lage sein, Subagent Sessions zu wecken. Das darf nicht an dem Parent Agent hängen.“

**Abweichungen von der Spec: keine** (der Plan versucht genau diesen Satz zu erfüllen). Eine Einschränkung steht ehrlich in Abschnitt 4: Option B erfüllt „jederzeit anschreiben“ im Kern (Zustellung), **nicht** sicher die Sperre des Eingabefelds im Browser für den Enkel (Annahme 7).

## 3. Tragende Annahmen (in der Reihenfolge, in der du sie prüfen solltest)

Alle Messungen: `docs/messung-kette-laden/probe-kette.sh k1-<typ> <mit|ohne>` (Phase 1: Kette anlegen und Prozess hart beenden), dann `PROBE_BEHALTE=1 probe-kette.sh k2-<typ>-<variante> <mit|ohne>` (Phase 2: Neustart, alles kalt). Eigene Pfade `/tmp/teams_plus_kette/{arbeit,home}`, kein Port, Prozesszähler nach jedem Lauf 0 (`probe-kette.sh --zaehler`). Die Zustandszeilen schreiben `L+1/0` = Lead lebt (`+`) bzw. kalt (`-`), 1 Modellaufruf bisher, 0 Züge.

**1 — Der Kern lehnt das Anschreiben eines Kindes ab, wenn sein Elternteil nicht als Agent lebt, auch in der Kette. `MESSUNG` (K1).** Alles kalt, Gateway `subagents/prompt` an G (Elternteil M) und an M (Elternteil L): beide `subagent/parent-unavailable`, 0 neue Modellaufrufe (4 → 4 nach 5 s). *Wäre die Konstruktion falsch*, käme eine `messageId` heraus. *Prüfen:* `ergebnis_k2-u-tor_ohne.json`, Felder `torEnkel`, `torMitte`, `nach5s.llmGesamt`. Rumpf: `dsh-subagent/lib/index.js` Zeile 3015 bis 3016 (`const parent = this.ctx.get("agents")?.get(parentSessionId); if (parent === void 0) throw … "subagent/parent-unavailable"`).

**2 — Das Laden des Leads über den Lookup `agent` ist stumm (0 Modellaufrufe, 0 Züge), solange im Team-Journal des Leads keine unzugestellte Nachricht wartet. `MESSUNG` (K3, K9; bestätigt Issue 181).** L laden: 73 ms, L1 → 1, M und G bleiben kalt. Mit unzugestellter Team-Nachricht an M im Journal (Lage tB) weckt dasselbe Laden M kalt: nach 400 ms M 2 → 3, nach 5 s L 1 → 2. *Prüfen:* `ergebnis_k2-u-oben-unten_ohne.json` (`direktNachLeadLaden`), `ergebnis_k2-t-nur-lead_ohne.json` (Typ `t`, keine Nachricht: L1/M2/G1 nach 9 s), `ergebnis_k2-tB-nur-lead_ohne.json`.

**3 — Der Patch `eltern-laden` scheitert am Zwischenkind und sagt das. `MESSUNG` (K2).** Er lädt M über den Lookup `agent`, bekommt `session/agent-busy`, schreibt `eltern-ist-kind eltern=<M> code=session/agent-busy` ins Protokoll und hängt seinen Hinweis an `parent-unavailable`. Das Anschreiben von **M** (Elternteil L, ein Wurzel-Lead) geht dagegen (54 ms, `messageId`), weil der Patch L lädt und der Kern M kalt weckt. *Prüfen:* `ergebnis_k2-u-tor_mit.json`, Felder `torEnkel`, `torMitte`, `patchProtokoll`.

**4 — Die Zeile, die das Laden von M über den Lookup verhindert, liegt im Kern und ist Absicht des Kerns, nicht ein Zufall. `MESSUNG` (K2) plus Quelltext.** Rumpf `dsh-api-session-controller/lib/index.js`: Zeile 126 bis 128 (`hasApiSessionSubagentOwner`: `if (session.header.origin === "subagent") return true;`), Zeile 412 bis 414 (`resumeObserved`: `if (hasApiSessionSubagentOwner(this.ctx, { header: observation.header }, void 0)) throw new ApiSessionSubagentOwnership(sessionId);`), Zeile 236 (`resolve` übersetzt das in `session/agent-busy`), Zeile 138 bis 139 (Text „is owned by subagent routing“, `reason: "use subagent delivery for this child session"`). Die Absicht steht im Kommentar Zeile 385 bis 388 (der Kern will kein eigentümerloses kaltes Kind); der Kommentar ist hier **nur** Hinweis auf die Absicht, der Beleg ist die Messung K2. *Prüfen:* die vier Zeilen lesen und `ergebnis_k2-u-tor_mit.json` `patchProtokoll`.

**5 — Der Kernaufruf, der ein Kind mit lebendem Elternteil lädt, ist `subagents.prompt(parent, child)`, intern `deliverToChild → deliverFollowup → coldResume → activations.materialize → agents.resume({ parentAgent })`; er schickt immer eine Nachricht. `MESSUNG` (K4, K5).** Mit L geladen: `prompt(L → M)` 45 ms ok, M lebt sofort, `isOwnedBy(M, L)` wahr, +1 Modellaufruf von M; sofort danach `prompt(M → G)` ok, G lebt, +1 von G. Ende der Kette: **L+1, M+2, G+1 = +4 Aufrufe** (G antwortet; M: Weckruf und danach die Antwort von G; L: Antwort von M); danach sind M und G wieder abgebaut. *Prüfen:* `ergebnis_k2-u-oben-unten_ohne.json` (`nach5s`), `erzeugt` (drei `resume`, Reihenfolge L, M, G), `llmLog`. Rumpf: `dsh-subagent/lib/index.js` Zeile 1820 bis 1824 (`if (activation === void 0) return this.coldResume(…)`), 1898 bis 1940 (`coldResume`, `authorizeLineage(parent, childId, source.header.parentSession)` verlangt den **exakten lebenden Agenten** `parent`, Zeile 957), 1969 bis 1975 (`submitAdmitted` legt eine Nutzernachricht ab).

**6 — Das Zwischenkind hält sich nur, solange es einen Besitzgriff, ein Kind oder eine wartende Nachricht hat; sonst wird es binnen Millisekunden abgebaut. `MESSUNG` (K6, K10b, Halt, Wiederholungen).** `settlementState` Zeile 1204: `if (activation.inbox.hasPending || activation.ownedChildren.size > 0) return "wait"; return "ready";`. Gemessen: M mit Weckruf (K4) ist nach ~0,5 s weg (G-Anschreiben nach 6 s: `parent-unavailable`); M **ohne Nachricht** angelegt war bei einer Abfrage alle 100 ms **schon beim ersten Messpunkt (100 ms) weg** (abgebaut 3 ms nach dem Anlegen, Ereignis `agent/disposed` bei 1288 ms, angelegt 1285 ms); `prompt(M → G)` direkt in derselben Fortsetzung (0 ms Pause): 3 von 3 ok, mit 5 ms Pause 0 von 2 (`parent-unavailable`). *Prüfen:* `ergebnis_k2-u-materialisieren-wdh_ohne.json` Feld `wiederholungen` (Läufe 1 bis 3 ok, 4 und 5 `parent-unavailable`), `ergebnis_k2-u-materialisieren-halt_ohne.json` Felder `lebensdauerMitte100ms`, `abgebaut`. **Das Fenster ist also kleiner als 5 ms; der Aufruf an G muss in derselben Fortsetzung wie das Anlegen von M stehen** (ein `await` dazwischen, das auf nichts wartet, genügt vermutlich; ungemessen).

**7 — Der Browser sperrt das Eingabefeld des Enkels, solange das Zwischenkind nicht als Agent lebt, und das Zwischenkind lebt in Option B nur Millisekunden. `SCHÄTZUNG` (Quelltext, plus `MESSUNG` des Hostereignisses).** Gemessen (Halt-Lauf): für M kommen `api-session/added` mit `agentAvailable: true` bei 1285/1286 ms und `agentAvailable: false` bei 1289 ms (3 ms später); beim erneuten Wecken ebenso (9352/9356 ms wahr, 9854 ms falsch). Der Client sperrt das Eingabefeld eines Kindes laut dem Plan `PLAN-ELTERN-LADEN.md` Annahme 5 nur bei `parentAvailable !== true` (Quelltext, `dsh-client-ui-conversation/lib/client.js` um Zeile 17288, dort gelesen, hier **nicht** neu gelesen). Folgerung: Das Eingabefeld des Enkels bliebe gesperrt, obwohl Haken A (Zustellung) funktioniert. *Prüfen:* Quelltext an den genannten Zeilen, dann Browsertest (Abnahme 8).

**8 — Direktes Laden des Zwischenkinds mit `agents.resume({ parentAgent: L })` (ohne Nachricht) trägt nicht. `MESSUNG` (K7, K8).** Es lädt M mit 0 Aufrufen, G ist anschreibbar, aber danach lässt sich M vom Lead nicht mehr anschreiben (`subagent/not-resumable`), solange dieses M lebt; nach `handle.dispose()` geht es wieder. Ursache laut Messung: das so geladene M hat keine Activation (`continuations.activations.get(M)` leer, daher kein Selbstabbau, kein Eigentümerzweig). Bestätigt `PLAN-ELTERN-LADEN.md` Annahme 8 (Issue 177). *Prüfen:* `ergebnis_k2-u-direkt-laden_ohne.json`, Felder `leadSchreibtMitteLebend`, `leadSchreibtMitteNachDispose`.

**9 — Anlegen des Zwischenkinds als Activation ohne Nachricht geht über Kern-Interna und kostet nur den Aufruf von G. `MESSUNG` (K10, Wiederholungen).** `ctx.subagents.continuations.activations.materialize({ childId, provider, parent: L, agentOptions: {}, composition: { persona, toolFilter }, signal })` — der Aufruf, den `coldResume` selbst macht (Zeile 1920 bis 1934), mit Eingaben aus `foldSubagentDescriptor` der Sitzung von M. M lebt als `isOwnedBy(M, L)`, **0 Aufrufe bei M und L**, danach `prompt(M → G)`: nur G +1 (nach 4 s M 0, L 0 in allen drei erfolgreichen Wiederholungen). Der Zugang `continuations` ist ein öffentliches Feld der Dienstinstanz (Zeile 2826), aber **kein dokumentierter Plugin-Weg** (`SCHÄTZUNG` für die Stabilität über Kern-Updates). *Prüfen:* `ergebnis_k2-u-materialisieren-sofort_ohne.json` (`zugang`, L/M/G-Zähler), `…-wdh_ohne.json`.

## 4. Hier bin ich unsicher

- **Welche Option der Mensch will (A bis D).** Gewählt als Empfehlung ist B2 (Abschnitt 5, „nach Wirkung“), weil sie die Zustellung ohne Kernänderung erfüllt, aber **Annahme 7 (Eingabefeld) ist nicht gelöst**; ob das reicht, hängt davon ab, wie der Mensch Wecken versteht (Zustellung per Fenster, per Agent oder nur das Eingabefeld). Alternativen: A (nichts tun, Hinweis), C (Anzeige-Haken), D (Kern ändern).
- **Ob das Eingabefeld des Enkels frei wird, wenn der Patch `agentAvailable` des Zwischenkinds selbst auf wahr setzt.** Vorschlag in Option C, ungemessen, gewählt aus: Antwort des Hosts für `session.list` und Ereignisse umwickeln (wie die Haken von `eltern-laden`) statt Client ändern; Alternative: Client-Plugin. Verfälscht eine Anzeige (die Sitzung ist kalt, wird aber beim Anschreiben sicher angelegt, solange der Patch aktiv ist).
- **Ob das Anlegen von M über `agent/created` Team-Recovery auslöst** (Issue 181: `agent/created` → `scheduleRecovery` für Team-Mitglieder; in Lage tB weckt das Laden von L das Mitglied M). Ob dasselbe passiert, wenn M selbst als Activation angelegt wird und im Journal eine Nachricht an M wartet: **ungemessen** (nur Unteragent ohne Team in Option B gemessen, Typ `u`). Risiko: ein zusätzlicher Weckruf mit Modellrunde.
- **Ob zwei gleichzeitige Weckungen derselben Kette sich stören** (Dedup auf M fehlt in der Kern-Interna-Variante): ungemessen; der Patch müsste eine „im Flug“-Menge pro Zwischenkind führen (Muster `baueLader`).
- **Die Rekursion über mehr als zwei Ebenen:** Konstruktion aus K3 bis K10 (`FORMEL`: jede Ebene wiederholt dasselbe Anlegen, geordnet von oben nach unten), nicht gemessen.
- **Ob das Anlegen mit leeren `agentOptions: {}` das Modell von M richtig setzt.** In `coldResume` Zeile 1924 bis 1928 setzt der Kern `agentProvider/agentModel/agentReasoningEffort` aus dem Descriptor; in meiner Probe habe ich `{}` übergeben und die Attrappe hat trotzdem geantwortet (nur ein Modell). Im Echtbetrieb müsste der Patch dieselbe Abbildung wie der Kern bauen.

## 5. Optionen und Schritte

Alle Optionen **gebaut wird erst nach der Entscheidung des Menschen (Abschnitt 8)**. Kein Schritt enthält fertigen Code.

### Option A — nichts am Weg ändern, Fehlermeldung verständlicher machen

Der Patch meldet dem Menschen und dem Lead, **welche Vorfahren zu wecken sind** (Kette lesbar machen), und der Lead weckt von oben nach unten selbst. Aufwand klein (Text im Hinweis `HINWEIS_ELTERN_IST_KIND`, Kette aus `subagents.listChildren`). **Erfüllt die Spec nicht** („Ich brauche keine Fehlermeldung“, Issue 175), also nur Notlösung.

### Option B — die Kette von oben nach unten laden (empfohlen als Grundlage)

Grundregel: **zuerst die Wurzel, dann abwärts**; jeder Schritt nur, wenn der Elternteil lebt (`ctx.agents.get`).

- **B1, mit Kernaufruf `subagents.prompt` (Weckruf):** Für jedes kalte Zwischenkind eine echte Nachricht schicken. Vorteil: nur öffentliche Dienstmethode. Nachteile: (a) eine **künstliche Nutzernachricht im Verlauf** jedes Zwischenkinds, (b) +1 Modellaufruf je Zwischenkind und +1 je Rückmeldung (K5: +4 gegen +1), (c) das Zwischenkind fällt nach ~0,5 s wieder ab, das Fenster für G ist kurz. **Nicht empfohlen**: Nebenwirkung auf Verlauf und Kosten.
- **B2, mit Kern-Interna `continuations.activations.materialize` (ohne Nachricht):** M wird als Activation angelegt (0 Aufrufe, keine Nachricht), und `subagents.prompt(M → G)` folgt **in derselben Fortsetzung** (Fenster unter 5 ms, Annahme 6). Kosten: nur der Aufruf von G (+1, Annahme 9). Nachteile: Zugang zu einem **nicht dokumentierten** Feld (`ctx.subagents.continuations.activations`), Selbstabbau von M (Eingabefeld, Annahme 7), Team-Recovery ungemessen. **Empfehlung** (siehe Abschnitt 4, Preis).

Schritte für B2 (Entwurf, nach Ja des Menschen):

1. **Neue Datei oder Erweiterung von `patches/eltern-laden.mjs`?** Empfehlung: **Erweiterung derselben Datei** (die Ausnahme `eltern-ist-kind` ist ihr Ausgangspunkt; Notschalter `eltern-laden.json` bleibt der eine Schalter), kein neuer Patch. Danach muss `team-modus.mjs` weiter unberührt bleiben.
2. **Haken A erweitern (`umwickleAnschreiben`):** Bevor `prompt` das Original ruft, wird die Kette des Elternteils bestimmt: aus `request.parentSessionId` die Eltern-Kette über die Kopfzeilen der Sitzungen lesen (`ctx.sessionQuery.observeSession`, `header.parentSession`, `header.origin`) bis zu einer Sitzung mit `origin !== "subagent"` (Wurzel). Keine Liste einzelner Sitzungen, nur diese Eigenschaften.
3. **Von oben nach unten laden:** Wurzel über den Lookup `agent` laden (Lader aus `baueLader`, wie bisher, stumm nach Annahme 2); für jedes Zwischenkind (kalt) `materialize` mit dem Eltern-Agenten, dem Descriptor (`foldSubagentDescriptor` über `observeSession`) und einem `AbortController`-Signal; den letzten `subagents.prompt` an das Ziel **ohne zwischenliegendes `await`, das nicht auf die `materialize`-Antwort wartet**.
4. **Dedup und „im Flug“:** je Zwischenkind eine Menge im Flug (wie `baueLader`), damit zwei gleichzeitige Weckungen M nicht doppelt anlegen.
5. **Fehlerfälle:** jeder Fehler wird gefangen, protokolliert (`kette-fehler eltern=<id> schritt=<n> code=…`), das Original läuft trotzdem und meldet seinen eigenen Fehler (wie bisher).
6. **Selbsttest beim Start:** prüfen, ob `ctx.subagents.continuations?.activations?.materialize` eine Funktion ist; fehlt sie, Protokollzeile `selbsttest ABWEICHUNG` und der Patch verhält sich wie heute (fail open).
7. **Tests** `test/eltern-laden.test.mjs`: reine Funktionen (Kette aus Kopfzeilen bestimmen, Reihenfolge, Dedup) mit Attrappen. Die Gegenprobe der Messung (vor dem Bau rot, nach dem Bau grün) ist Abnahme 1 bis 3.

### Option C — nur Anzeige: das Eingabefeld des Enkels freigeben

Zusätzlich zu B2 (oder allein, wenn der Mensch das Anschreiben im Kern für ausreichend hält): `sessionController.list` und die Ereignisse `api-session/added|updated` so umwickeln, dass ein kaltes Zwischenkind als `agentAvailable: true` erscheint, **wenn seine Eltern-Kette bis zu einer Wurzel reicht und der Patch aktiv ist** (also beim Anschreiben sicher angelegt wird). Das verfälscht die Anzeige, ist aber die einzige Möglichkeit ohne Client-Änderung (`SCHÄTZUNG`, ungemessen, Annahme 7). Der Browsertest (Abnahme 8) entscheidet.

### Option D — Kernänderung als Vorschlag an den Menschen (nicht bauen)

Drei Stellen kämen infrage (alle in `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`, nicht von mir zu ändern):
1. `dsh-api-session-controller/lib/index.js` Zeile 412 bis 414: bei kaltem Kind mit **lebendem** Elternteil den Fall nicht als `agent-busy` ablehnen, sondern über `subagents` routen. Vorteil: der Lookup `agent` lädt dann ein Zwischenkind sauber, der Patch bräuchte keine Kern-Interna. Risiko: die Absicht des Kerns (kein eigentümerloses Kind, Kommentar Zeile 385 bis 388) wird berührt.
2. `dsh-subagent/lib/index.js` Zeile 3015 bis 3016 (`subagents.prompt`): selbst die Kette laden, statt `parent-unavailable` zu werfen. Der sauberste Ort (der Kern kennt Eigentümer und Fenster), ein Eingriff in den Kern.
3. `dsh-subagent/lib/index.js` Zeile 1204 (`settlementState`): ein Zwischenkind eine Frist lang halten (zum Beispiel für das Eingabefeld). Ändert das Verhalten **aller** Unteragenten.
Empfehlung: nur 2, und nur als Vorschlag an die Autoren; **nicht in diesem Plan**.

## 6. Risiken und Notschalter

- **Modellaufrufe beim Wecken mehrerer Sitzungen.** Gemessen (Attrappe): B1 +4 gegen +1 (K5), B2 +1 (K10). Im Echtbetrieb kann jede Sitzung auf eine Nachricht mit mehreren Zügen und Werkzeugen antworten (`SCHÄTZUNG`, Faktor unbekannt); ein Zwischenkind **mit** wartender Team-Nachricht weckt sich beim Anlegen vermutlich selbst (K9, Typ tB für L gemessen, für M ungemessen). **Zählung:** je Abnahme vor und nach jedem Schritt `llm-aufrufe.log` je Sitzungskennung, Sollwert siehe Abschnitt 7.
- **Verlauf des Zwischenkinds:** B1 schreibt eine Nachricht, die nie ein Mensch gesendet hat. B2 nicht.
- **Kern-Interna (B2):** der Zugang `ctx.subagents.continuations.activations.materialize` kann in einem Kern-Update verschwinden oder die Eingaben ändern; der Selbsttest (Schritt 6) macht das sichtbar, die Messung der Wiederholungen (Abnahme 3) deckt es beim Einspielen.
- **Wettlauf M gegen Selbstabbau:** Fenster kleiner als 5 ms (Annahme 6). Wenn der Patch zwischen Anlegen und Anschreiben auch nur einen Zug des Ereignisschleife abgibt, kann M verschwunden sein; der Patch muss dann einmal erneut anlegen und anschreiben (Wiederholungsgrenze zu klären).
- **Eigentümer von M ist L** (`isOwnedBy(M, L)` wahr, K4/K10): das erlaubt Lead → Mitte weiter normal; bei **direktem** Laden (K7/K8) bricht es. Der Patch darf deshalb nie `agents.resume` ohne `materialize` benutzen.
- **Team-Modus ist hier nicht Voraussetzung** (Entscheidung O1 des Plans Eltern laden: das Laden gilt auch außerhalb des Team-Modus); die Kette benutzt dieselbe Entscheidung.
- **Notschalter:** derselbe wie bisher, `~/.dsh/.tm/teams-plus/eltern-laden.json` mit `{"aus": true}`; gelesen bei jedem Aufruf. Die neue Kette fragt ihn vor jedem Schritt (nicht nur einmal am Anfang).

## 7. Abnahme (je Ziel eine Messung mit Werkzeug und Sollwert)

Alle in der Probe `docs/messung-kette-laden/probe-kette.sh` mit dem **gebauten Patch** (`#MIT#`-Zeile in `probe-kette.patch.yml`, Modus `mit`); Gegenprobe jeweils `ohne` (Patch nicht geladen, wird dort rot). Nach jedem Lauf Prozesszähler 0.

1. **Enkel anschreiben bei vollständig kalter Kette geht.** `k2-u-tor` mit Patch: `torEnkel.ok == true` (Heute `false`, `parent-unavailable`, K2). Die Messung würde auch „bestanden“ melden, wenn der Patch G über einen anderen Weg anschreibt; deshalb zusätzlich Protokollzeilen `kette-geladen` je Ebene (Reihenfolge L, M) und `isOwnedBy(M, L) == true` im Ergebnis.
2. **Modellaufrufe.** `k2-u-tor` mit Patch: Aufrufe nach 5 s für L, M, G zusammen ≤ vorher + 1 (nur G; Sollwert aus K10: +1; B1 wäre +4). Bei einem Zwischenkind mit unzugestellter Team-Nachricht (Typ tB) wird die Zahl getrennt gemeldet. Aussagekraft: die Attrappe zählt auch Züge ohne Text; würde M einen Zug ausführen, stünde eine Zeile mehr im Log.
3. **Wettlauf.** Fünf Wiederholungen in einem Lauf (wie `materialisieren-wdh`, jetzt über den Patch statt Treiber-Code): 5 von 5 `ok`. Der Treiber dort legt M selbst an; die Abnahme muss den Patch aufrufen (`tor`-Weg), sonst prüft sie nur den Treiber.
4. **Kein Verlauf im Zwischenkind.** Nach dem Weckvorgang `ergebnis…ereignisse` von M: kein `user/message` mit Quelle des Patchs (bei B2 erwartet 0; bei B1 wäre es 1).
5. **Notschalter.** `eltern-laden.json` = `{"aus": true}`: derselbe Lauf liefert `parent-unavailable`; Datei löschen, es geht wieder.
6. **Wurzel mit wartender Team-Nachricht** (Lage A/B aus Issue 181) in der Kette: Zahl der Aufrufe wird gemeldet, kein Sollwert außer „so viele wie ohne Patch beim bewussten Öffnen des Leads“ (Gegenprobe `ohne` + explizites Laden).
7. **Tiefe drei** (Lead → Mitte → Mitte2 → Enkel): Treiber erweitern; Sollwert Enkel anschreibbar, Aufrufe +1.
8. **Browser (nicht in der Probe machbar).** Nach dem Einspielen: der Mensch (oder ein Lead mit `blick`) öffnet den Enkel bei kalter Kette im echten `dsh web`. Sollwert: Eingabefeld frei, Nachricht kommt an. **Ohne diesen Test ist die Aussage „der Enkel ist jederzeit weckbar“ nicht belegt** (Annahme 7).

Formeln und Schätzungen stehen nicht in dieser Abnahme.

## 8. Offene Fragen an den Menschen (Wirkung zuerst)

**F1 — Reicht es, dass der Enkel beim Absenden zugestellt wird, auch wenn das Eingabefeld im Browser gesperrt bleibt?** Wirkung: Ohne Anzeigehaken (Option C) kommt die Nachricht an, wenn sie von einem Agenten oder einem Plugin geschickt wird; ob das Eingabefeld des Enkels für dich frei wird, wissen wir erst im echten Browser. Mit Option C ändern wir, was die Oberfläche über das Zwischenkind erfährt (es erscheint als „verfügbar“, obwohl kalt). **Empfehlung:** erst B2 bauen und im Browser prüfen; C nur, wenn das Feld gesperrt bleibt.

**F2 — Darf der Patch den nicht dokumentierten Kern-Zugang `ctx.subagents.continuations.activations.materialize` benutzen?** Wirkung: Ohne ihn gibt es nur den Weckruf per Nachricht (Option B1: ein künstlicher Satz im Verlauf des Zwischenkinds, +4 statt +1 Modellaufrufe) oder die Kernänderung (Option D). Der Zugang kann bei einem DSH-Update verschwinden; dann merkt es der Selbsttest und das Verhalten fällt auf „wie heute“ zurück. **Empfehlung:** ja, mit Selbsttest.

**F3 — Soll die Kette auch dann geladen werden, wenn beim Zwischenkind eine Team-Nachricht wartet?** Wirkung: Das Anlegen des Zwischenkinds kann dann (wie das Laden des Leads, Issue 181) eine Modellrunde bei ihm auslösen, die du nicht angefordert hast (Kosten Quota). Ungemessen für das Zwischenkind. **Empfehlung:** vor dem Bau messen (Treiber `treiber-kette.mjs` Typ `tB`, Variante `materialisieren`), dann entscheiden.

**F4 — Option D (Kernänderung) jetzt als Vorschlag an die Autoren des Kerns aufschreiben?** Wirkung: Wenn ja, schreibe ich einen Issue-Text mit den drei Zeilen aus Abschnitt 5 und den Messbelegen; ändern darf den Kern nur der Mensch. **Empfehlung:** erst nach der Browserprobe von B2.

**F5 — Was gilt bei Tiefe drei und mehr (Experte → Facharbeiter → Hilfsarbeiter)?** Wirkung: Die Konstruktion wiederholt dasselbe Anlegen je Ebene, ist aber nur zweistufig gemessen. **Empfehlung:** ja, mit Abnahme 7 vor dem Einspielen.

## 9. Grenzen für den späteren Bau-Worker

Dem Worker gehören: `patches/eltern-laden.mjs` (Erweiterung), `test/eltern-laden.test.mjs`, die Dateien unter `docs/messung-kette-laden/` (Treiber umstellen: der Patch statt Treiber-Code ruft das Anlegen auf) und, nur nach Ja des Leads, der eine Eintrag in `cordis.patch.yml`. Er ändert **nicht**: `patches/team-modus.mjs`, keine Anweisungsdatei, kein Kernpaket unter `/opt/homebrew/…`, kein Profil unter `~/.dsh/profiles/`; **kein Neustart und kein Stoppen irgendeines Dienstes** (insbesondere `dsh web` auf Port 3080 nicht berühren, nicht anschreiben, nicht abfragen). Er beendet nur Prozesse, die er selbst gestartet hat und deren PID in `docs/messung-kette-laden/probe-kette.pid` steht (`probe-kette.sh --beende`). Zugangsdaten nie anzeigen. Jeden neuen Fund sofort als Issue in `tmielsch/DSH-Verwaltung` mit Art-Label und `triage`. Kein Push, kein Merge; Abnahme und Einspielen tut der Lead. Zweideutigkeit heißt fragen, nie die destruktive Wahl.

## 10. Aufgabenliste für den Bau-Worker (Vorschlag für `todo_write`)

1. Plan, Ergebnis und Erwartung lesen; Annahmen 6, 7 und 9 am Probe-Lauf nachvollziehen (`probe-kette.sh k2-u-materialisieren-wdh ohne`).
2. Messen vor dem Bau: F3 (Zwischenkind mit wartender Team-Nachricht, `tB` + neue Variante), Tiefe drei.
3. Selbsttest und Kettenermittlung (Schritte 2 und 6) mit Tests.
4. Anlegen von oben nach unten mit Dedup (Schritte 3 und 4).
5. Probe mit Patch (`mit`) gegen `ohne`: Abnahme 1 bis 6.
6. Bericht an den Experten mit Etiketten; Browserprobe (Abnahme 8) für den Lead vorbereiten.
