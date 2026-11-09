# Konzept: Team-Modus, Gesprächsübernahme und ziel-getriebene Team-Kommunikation

Stand: 2026-11-09 abends, **zweite Fassung** (die erste Fassung vom Nachmittag steht in der Git-Geschichte dieser Datei, Commit `a4ed921`). Entwurf eines Unteragenten des Leads. **Nichts davon ist eingebaut, es gibt keinen Patch-Code im Repo.** Gemessen wurde nur in einer Wegwerf-Probe-Instanz von DSH (Abschnitt 3); die Skripte dazu liegen als Beleg in `docs/messung-gespraechsmodus/`.

Auslöser und Bestandsaufnahme: Issue `tmielsch/DSH-Verwaltung` Nr. 121 („Agent Teams: Abschlussmeldungen von Unteragenten wecken den Lead, auch während der Mensch direkt mit einem Experten spricht“), dort Kommentar „Bestandsaufnahme“ und die Entscheidungen des Menschen.

## 1. Was der Mensch entschieden hat (Wortlaut in `/tmp/entscheidungen_teamwork_2026-11-09.md` und `…_2_…md`, beide auch als Kommentar im Issue)

Das Konzept setzt diese Sätze um und deutet sie nicht um. Die tragenden Sätze:

- Alles **non-destructive, als revertbarer Patch**.
- Unterdrückt wird **nur, wenn `/team work` aktiv ist**; bei normaler DSH-Nutzung bleibt alles wie heute.
- Im Team-Modus fallen **alle automatischen Statusmeldungen weg, ausgenommen Task-Updates**. Die unterdrückten Meldungen werden **verworfen, nicht gepuffert**. Gemeldet wird, was ein Agent selbst schreibt: Zwischenfazit bei erreichtem Ziel beziehungsweise abgeschlossenem Checkpoint.
- **Fehler bleiben laut** („Legitime Status-Updates wie Critical Errors bitte auf jeden Fall behalten“); unterdrückt wird nur die Meldung, wenn ein Zug ohne Werkzeugaufruf einfach endet.
- **Hijack:** „Ziel läuft, ich steere, das Ziel wird angehalten (nicht abgebrochen)“ wird übernommen, nicht automatisch neu ausgelöst. Der Lead bekommt dann genau eine Meldung „Mensch hat Kommunikation mit Agent XY übernommen, stand by“, und den Mitarbeiter erst zurück, wenn der Mensch das Ziel selbst fortsetzt (dann eine Meldung mit dem aktuellen Ziel-Wortlaut).
- **Ohne Ziel wird nicht gearbeitet.** Bevorzugt: der Lead setzt dem Untergeordneten ein Ziel („die saubere Version“). Sonst eigene Werkzeuge (`give_task`, `ask_question`), und `send_message` wird im Team-Modus abgelehnt, mit Hinweis auf diese Kanäle.
- **Pflichtbericht:** ein Ziel lässt sich nicht abschließen, solange kein Bericht geschrieben wurde.
- **Mensch als Wildcard-Mitarbeiter:** nicht mehr Single Point of Entry über den Lead; jedes Teammitglied darf den Menschen direkt ansprechen. Der Lead übt passive Aufsicht (Orchestrierung, Qualitätskontrolle, Prüfer schicken). Der Mensch forkt den Lead als Berater; der Fork verliert das Team, behält den Kontext und darf an seinen Parent zurückmelden.
- **Benachrichtigungen an den Menschen:** Leiste/Ticker in der Web-GUI mit den letzten Team-Nachrichten, scrollbar, Klick führt zur Sitzung; Fragen sichtbar machen, besonders bei `await_goal_dependency` auf eine Antwort des Menschen. Erst der Patch, dann der Ticker.
- **Anweisungsdateien** dürfen umgeschrieben werden, mit der Auflage: „Vorsicht aber, dass dabei nichts subtil verloren geht von dem, was eigentlich erhalten bleiben sollte.“ Eingetragen wird erst nach Abnahme durch den Menschen. Unangetastet bleiben Spec-Regeln, Ablage, Sprache, Fragen und das Verbot, Dienste neu zu starten.
- **Probe-Instanz, Merge auf `main` (kein Push), Löschen der entpackten Protokolle:** freigegeben.

## 2. Zusätzliche Anforderungen des Leads (als Anforderungen übernommen)

Fehler bleiben laut (1); der Bericht bei erreichtem Ziel ist der selbstgeschriebene Text des Agenten (2); der Team-Modus gilt für den **ganzen Baum** unter dem Lead, auch für Facharbeiter gegenüber ihrem Experten (3); Rückgabe an den Lead mit aktuellem Ziel-Wortlaut (4); vergessene Gespräche: keine automatische Freigabe, im Ticker steht eine Liste „angehalten durch den Menschen, seit …“ ohne Nachricht an irgendwen (5); Anweisungsdateien mit Diff (6, Abschnitt 8); Aufsicht über Artefakte statt Nachrichten (7, Abschnitt 6.7); Entscheidungen trägt der Gesprächspartner in die Spec ein (8, Abschnitt 8); robust gegen DSH-Updates, Eingriff in den Kern nur wenn es als Plugin nicht geht, ein Schalter schaltet alles ab (9, Abschnitt 7); drei Maschinen (10, Abschnitt 9); Reihenfolge Patch vor Ticker (11); Abnahme in der Probe-Instanz (12, Abschnitt 10).

## 3. Messungen in der Probe-Instanz (alles MESSUNG, mit Ort)

**Aufbau (gemessen, nichts am laufenden System):** `dsh --profile probe`, Datenverzeichnis `DSH_HOME=/tmp/teams_plus_umbau/probe_home`, **kein Webserver und kein Port**, Profil aus der Vorlage `headless` plus Bündel `experimental-agent-team-profile`, Attrappen-Modell ohne Anbieter und ohne Kosten, ein Treiber-Plugin, das einen Lead und einen Experten anlegt und den Chat-Weg des Menschen (`subagents.prompt`, Quelle `user` mit `rpcId`) nachspielt. Jeder Lauf höchstens 90 s, danach `ps` ohne Rest. Das laufende `dsh web` (PID 65458 auf Port 3080, laut Lead PID 90805 beim Lead; beide sind unberührt) und alle anderen Dienste wurden weder gestartet noch gestoppt. Skripte und Ergebnisse: `docs/messung-gespraechsmodus/`.

| Nr. | Frage | Ergebnis | Wäre die Annahme falsch, käme hier etwas anderes heraus, weil … |
|---|---|---|---|
| M0 | Grundlinie: wie oft wird der Lead geweckt, wenn der Mensch N Mal mit dem Experten spricht? | N=2: **3 Lead-Züge** (1 nach dem Start des Experten, 1 je Gang), jede Meldung Art `subagent-settled`, Quelle Kern | der Kern keinen Weckruf pro Gang schickte |
| M1 | Greift ein am Lead umwickeltes `Agent.send` bei der Kernmeldung? | **Ja.** Szenario „abfangen“, N=3: 4 Abschlussmeldungen kamen am Lead an (je `target: next-turn`, `wecken: true`), alle 4 verworfen, **Lead-Züge: 0** | die Kernmeldung `send` nicht passierte (sie geht über `followup`, das `send` ruft) |
| M1b | Welche Zustände der Kernmeldung sind unterscheidbar? | Normal: Text „… **finished** and will do no further work …“. Abbruch (Unterbrechen): „… **was stopped** before it finished.“. Fehler im Modellaufruf (geworfen): „… **failed** before it finished.“. Unterscheidbar an `source.summary` | die Kernmeldung nur einen Text hätte |
| M3 | Team-Nachricht Kind→Lead im Eingangskorb verworfen: wird sie erneut zugestellt? | Beobachtet 9 s lang (Szenario `briefkasten`): **kein** zweiter Versuch; die Nachricht blieb im Briefkasten `queued`. Quelltext (`dsh-experimental-agent-team/lib/index.js` 1985–1998): neuer Versuch erst bei `agent/created` (Start/Neuladen der Sitzung) | der Briefkasten sofort erneut zustellte |
| M4a | Fork: Team, Wurzelstatus, Elternverweis | Fork ist **Wurzelsitzung** (`istWurzel: true`), `parentSession` = Lead; `listMembers(fork)` zeigt **nur sich selbst als Lead** (leeres Team: „verliert das Team“ stimmt); `sendMessage` an `exp`: „active teammate not found“ | der Fork das Team erbte |
| M4b | Fork: Rückmeldung an den Parent | `subagents.sendMessage(fork, parent)` abgelehnt („not a resident continuable child“); `parent.inject(Nachricht mit Plugin-Quelle)` **geht**, weckt nicht. Heute vorhanden: Werkzeug `send_to_session` (Plugin), Wurzeln bekommen dort `inject` | der Kern die Rückmeldung zuließe |
| M5 | Ziel und Mensch-Nachricht: wird „angehalten“? | **Nein, nicht auf der API-Ebene.** Ziel läuft (`active`/`armed`, Runden steigen), Nachricht mit `queue` **und** mit `steer` ändern daran nichts (Szenarien `ziel`, `zielsteer`: Runden stiegen weiter von 0 auf 5, Phase blieb `active`). **Anhalten geschieht nur beim Abbruch einer Zielrunde** (Unterbrechen/Stopp): dann `pause`, `paused`/`disarmed` (Szenarien `stopp`, `stopp2`) | die Nachricht des Menschen das Ziel pausierte |
| M5b | Nach dem Stopp: Kind lebt? Fortsetzen? | Nach dem Stopp wird das Kind **abgebaut** („TOT“) und dem Lead als „was stopped“ gemeldet. Eine Nachricht des Menschen **weckt es kalt**, das Ziel bleibt `paused`/`disarmed`. `goals.resume` am lebenden Kind: `active`/`armed`, Runden laufen weiter (3 → 12 in 6 s) | `resume` bei abgebautem Kind ginge |
| M5c | Geht das Fortsetzen durch den Menschen bequem? | Quelltext: die Zielleiste der GUI hat einen Fortsetzen-Knopf bei `paused` oder `active/disarmed` (`dsh-client-ui-goal/lib/client.js` 272). In der Sitzung eines **Teammitglieds** braucht er (a) das lebende Kind (Nachricht weckt es) und (b) den Patch `child-goal-resume` (eingespielt). **Zwei Schritte: erst schreiben, dann Knopf.** Am Browser nicht gemessen | — |
| M6 | Lässt sich `send_message` im Team-Modus ablehnen? | **Ja, als Plugin, ohne Kern-Patch**: `ctx.tools.guard(...)` lehnte `send_message` ab mit „Team-Modus: send_message ist hier nicht erlaubt. Nutze give_task oder ask_question.“; das Modell bekommt das als Werkzeugfehler | der Wächter nicht griffe |
| M7 | Lässt sich `update_goal(complete)` ohne Bericht ablehnen? | **Ja, als Plugin**: derselbe Wächter lehnte `complete` ohne Bericht ab („Ziel kann erst abgeschlossen werden, wenn ein Bericht geschrieben wurde.“) | der Wächter nicht griffe |
| M8 | Ist das Ziel eines abgebauten Mitglieds billig lesbar (Aufsicht ohne Weckrufe)? | **Ja**: `sessionQuery.observeSession(kindId)` liefert die Projektion `goal` samt `phase`, `roundsStarted`, Zeitstempeln auch für abgebaute Kinder, ohne sie zu wecken. Dieselbe Projektion hat `todos`, `inbox`, `userQuestions`, `tokenUsage`, `agentTeam` | die Projektion nur lebende Agenten hätte |

**Befund, der eine Annahme des Menschen betrifft (M5):** Der Mensch sagte, wenn er steere, werde das Ziel „automatisch pausiert“, das sei die Funktion zum Übernehmen. Gemessen auf der Ebene des Kerns: **Eine Nachricht pausiert das Ziel nicht**; nur ein **Abbruch der laufenden Zielrunde** pausiert es (`dsh-goal-round-driver/lib/index.js` 213–225, `goal/changed` mit `pause`, Z. 234). Ob der Chat der GUI beim Senden während eines laufenden Zuges zuerst abbricht (und so die Pause auslöst), habe ich ohne Browser **nicht** gemessen. Im Protokoll von `strata-teamleiter` (2026-11-05 06:41) kam die Pause nicht vom Kern, sondern vom Teilnehmer selbst: Er rief auf Anweisung `update_goal(pause)` auf. Folge für das Konzept: Die Gesprächsübernahme darf sich **nicht** darauf verlassen, dass der Kern pausiert; das Plugin erkennt die Nachricht des Menschen selbst (Abschnitt 5.2).

**Nicht gemessen (jeweils mit Weg):** (U1) Schrägstrich-Befehle im Chat eines Teammitglieds und der GUI-Knopf „Fortsetzen“ dort (Browser nötig, Probe ohne Webserver); (U2) ob ein neuer Versuch des Briefkastens nach einem Neustart die verworfene Team-Nachricht wieder zustellt (nur Quelltext); (U3) ob ein Fork das Ziel des Leads erbt (`goal/change` steht in der geerbten Vorgeschichte; `ctx.goals.get(fork)` nach dem Fork prüfen); (U4) ob `ctx.tools.restrict` das Team-`send_message` ausblendet (Quelltext: gilt nur für **globale** Werkzeuge, Eintragungen im Agenten-Scope bleiben sichtbar, `dsh-tools/lib/index.js` 2906–2927); (U5) das Verhalten eines echten Anbieterfehlers 402 (Issue #70: dort kam „stopped“, hier beim geworfenen Fehler „failed“; gemessen ist nur der geworfene Fehler).

## 4. Begriffe

- **Team-Modus** ist kein neuer Zustand, sondern liest den vorhandenen: Die Wurzelsitzung hat mindestens ein Teammitglied in Phase `active` (also nicht nach `/team rest`, Phase `resting`). Er gilt für den **ganzen Baum** unter dieser Wurzel (Eltern-Kette über `session.header.parentSession`, `liveLineage`-Muster, `dsh-subagent/lib/index.js` 1036–1048). Ein Fork ist eine neue Wurzel mit leerem Team und damit **nicht** im Team-Modus (M4a).
- **Master-Schalter:** `~/.dsh/.tm/teams-plus/team-modus.json` mit `{"aus": true}` schaltet alles Folgende ab; ohne Datei oder mit `aus: false` gilt der Team-Modus wie oben (Vorschlag, Frage F1).
- **Ziel-Zustand der Gesprächsübernahme:** `paused` oder entwaffnet (Frage F2 aus der ersten Runde: der Mensch hat „angehalten, nicht abgebrochen“ gesagt; beide erfüllen es, siehe 5.2).

## 5. Fähigkeiten

Einordnung je Fähigkeit: **Plugin** (wie `goal-await.mjs`, im Profil geladen), **Kern-Patch** (Textänderung unter `/opt/homebrew/...`, geht bei einem Update verloren), **geht nicht**.

### 5.1 Meldungen im Team-Modus: nur Echtes bleibt (Plugin)

Mechanik: das Plugin umwickelt `Agent.send` an jedem Agenten im Baum (`agent/created` plus beim Start `ctx.agents.list()`), gemessen in M1. Es wertet **Art und Zusammenfassung** der Nachricht aus (M1b):

| Meldung | Im Team-Modus | Begründung |
|---|---|---|
| `subagent-settled`, Zusammenfassung „… **finished** and will do no further work …“ | **verwerfen** (nicht puffern) | das ist die „einfach nur eine Antwort geschickt“-Meldung des Menschen |
| `subagent-settled` „… **was stopped** …“, „… **failed** …“, „… **ran out of room** …“, „… **declined** …“ und jede unbekannte Form | **durchlassen** | echte Fehler und kritische Zustände; unbekannte Form fällt auf „laut“ |
| `team-message` / `agent-message` von einem Agenten (Zwischenfazit, Frage, `give_task`, `ask_question`, `goal_report`) | durchlassen | vom Agenten selbst geschrieben, das ist die gewollte Meldung |
| Task-Updates (`team/task`) | durchlassen | ausdrücklich ausgenommen |
| Nachrichten des Menschen (Art `user`) | immer durch | |
| Blockade eines Ziels (`blocked`) | durchlassen | kritischer Zustand |

Wichtig (M3, U2): **Team-Nachrichten dürfen am Eingangskorb nicht verworfen werden**, weil sie im dauerhaften Briefkasten als „nicht zugestellt“ stehen bleiben und bei einem Neustart erneut kämen. Verworfen wird nur, was der Kern selbst erzeugt und nicht im Briefkasten ablegt: die „finished“-Meldung. Dass Agenten untereinander nichts Überflüssiges schicken, regeln die Kanäle in 5.5, nicht ein Filter.

Fehlerfall im Filter selbst: Ausnahme → durchlassen (fail open). Selbsttest beim Start: umwickelt `send` überhaupt, gibt es einen Treffer-Zähler im Protokoll (`~/.dsh/.tm/teams-plus/logs/team-modus.log`)?

Optionaler Kern-Patch (nur falls Messung U-später zeigt, dass das Umwickeln nicht trägt): eine Zeile in `notifySettlement` (`dsh-subagent/lib/index.js` 1254) vor dem Senden, die einen Plugin-Dienst fragt. Nach dem Stand der Messung **nicht nötig**.

### 5.2 Gesprächsübernahme („direkt angeschrieben heißt angehalten“) (Plugin)

Gemessen (M5): Der Kern pausiert bei einer Nachricht nicht. Deshalb erkennt das Plugin die Übernahme selbst:

1. **Auslöser:** eine Nachricht der Art `user` **mit `rpcId`** (Menschenweg über `subagents.prompt`, `dsh-subagent/lib/index.js` 3017–3021; die Startaufgabe hat keine `rpcId`, Z. 1739) trifft ein Kind im Baum, und das Kind hat ein Ziel mit Phase `active`.
2. **Wirkung auf das Ziel:** `ctx.goals.pause(kind, ref)` **oder** `ctx.goals.disarm(kind)`. Der Mensch sagte „angehalten, nicht abgebrochen. Einfach die normale Funktion, wie es jetzt im Prinzip auch schon ist.“ Das entspricht dem **Pausieren** (`paused`, sichtbar „pausiert“ in der Zielleiste, Knopf „Fortsetzen“; aber `pause` bricht einen **laufenden Zug ab**, `dsh-goal-round-driver/lib/index.js` 234). `disarm` bricht nichts ab, zeigt aber keine „pausiert“-Anzeige (`active`, nur die Zielleiste zeigt Fortsetzen bei `active/disarmed`, `client.js` 272). Frage F2.
3. **Genau eine Meldung an den Vorgesetzten** (bei Facharbeitern: an den Experten): „Mensch hat Kommunikation mit Agent XY übernommen, stand by“ (Text vom Plugin, nicht vom Modell; Art `plugin:@tmielsch/dsh-teams-plus`, damit der Kern sie als Zustellung ohne Berechtigung behandelt, wie `send-to-session.mjs` es festgelegt hat). Weitere Mensch-Nachrichten an dasselbe Kind lösen **keine** weitere Meldung aus, solange es angehalten ist.
4. **Alle Kernmeldungen dieses Kindes an den Vorgesetzten werden stumm** („finished“ immer; „stopped/failed“ weiterhin laut, 5.1).
5. **Rückgabe:** setzt der Mensch das Ziel fort (`goal/changed` mit `resume`, Zielleiste oder Befehl), geht **eine** Meldung an den Vorgesetzten: „Mensch hat Agent XY freigegeben, Ziel fortgesetzt“, mit dem **aktuellen Wortlaut** des Ziels (aus `ctx.goals.get`, nicht aus der Zeit der Übernahme, weil der Mensch es im Gespräch geändert haben kann).
6. **Kein Fortsetzen durch Agenten:** ein pausiertes Ziel kann das Modell nicht selbst fortsetzen (`GOAL_TOOL_RESUME_PAUSED`; Patch `child-goal-resume` lockert nur für Kind-Sitzungen mit Auftrag des Elternteils oder Nachricht des Menschen). Das bleibt so.
7. **Vergessene Gespräche (Lead-Punkt 5):** keine automatische Freigabe. Das Plugin führt in `~/.dsh/.tm/teams-plus/state/uebernahmen.json` eine Liste `{Sitzung, Name, seit}` aus den Übernahme- und Rückgabe-Ereignissen; der Ticker (Abschnitt 6.8) zeigt sie als „angehalten durch den Menschen, seit …“. Es geht keine Nachricht an irgendwen.

Wie der Mensch das Ziel eines Teammitglieds fortsetzt (Lead-Punkt 4, M5c): heute zwei Schritte (Nachricht schreiben, um das abgebaute Kind zu wecken; dann Knopf in der Zielleiste dieser Sitzung). Verbesserung als Plugin: ein Schrägstrich-Befehl `/uebernahme frei <name>`, der das Kind weckt und das Ziel fortsetzt (U1: ob Befehle im Teammitglied-Chat laufen, ist ungemessen; Alternative: Werkzeug für den Lead mit Menschenvollmacht ist verboten, siehe 5.2 Nr. 6).

### 5.3 Melden erst bei erreichtem Ziel, Pflichtbericht (Plugin)

- **Eigenes Werkzeug `goal_report`** (Plugin-registriert): der Agent schreibt seinen Bericht (Text, Pfade/Belege). Das Plugin speichert ihn mit Ziel-Kennung und Revision (`~/.dsh/.tm/teams-plus/state/berichte/`) und stellt ihn **genau einmal** dem Vorgesetzten zu.
- **Wächter auf `update_goal`:** `complete` wird abgelehnt, solange für `{Ziel-Kennung, Revision}` kein Bericht vorliegt (M7: Wächter greift ohne Kern-Patch). Der Hinweistext nennt `goal_report`.
- Warum **nicht** ein Pflichtfeld `bericht` an `update_goal`: das Schema wird beim Registrieren einmal in JSON-Schema übersetzt (Erfahrung aus `delegate-send.mjs`, `required`-Liste und geteilte Eigenschafts-Objekte); ein zusätzliches Feld hängt an Kerninterna und hätte bei einem Update das Risiko eines ungültigen Schemas (der Anbieter lehnt es mit 400 ab). Der Wächter prüft den Zustand, nicht die Form.
- Auch `blocked` wird gemeldet: der Kern setzt dort bereits eine Begründung (`blocked_reason`); Meldung an den Vorgesetzten durchlassen (5.1).
- Ein Ziel, das **ohne** `complete` endet (Kind kommt ohne Ziel-Abschluss zur Ruhe, „finished“): die Meldung wird im Team-Modus verworfen (5.1). Damit der Vorgesetzte das nicht verpasst, gibt es die Aufsicht über Artefakte (6.7).

### 5.4 Kein Auftrag ohne Ziel (Plugin; Weg 2 ist vom Menschen freigegeben)

- **Der Lead setzt das Ziel selbst** (die „saubere Version“): das Plugin legt mit `ctx.goals.create(kind, { objective, maxGoalRounds })` ein Ziel **für** das Kind an. Gemessen: `create` prüft keine Vollmacht; das Ziel läuft sofort (`active`/`armed`, Runden steigen). Voraussetzung: das Kind **lebt** (`assertLive`, Fehler „agent is not live in this registry“ gemessen), also vorher wecken.
- Das widerspricht dem Satz in `~/.dsh/AGENTS.md` („Ein Agent kann ein Ziel nicht für einen anderen anlegen …“). Der Mensch hat dem zugestimmt („Ob das Plugin ein Ziel für einen anderen anlegt, entscheidet damit der Mensch mit Ja“). Der neue Wortlaut steht in 8.1; **geändert wird nichts ohne Abnahme.**
- **Werkzeug `give_task`** (Plugin): Pflichtfelder `empfaenger`, `zielbrief` (Zweck, Gegenstand, Grenzen, Abnahme), `maxrunden`, optional `aufgabenliste`. Ohne Zielbrief scheitert der Aufruf mit verständlicher Meldung (Abnahme 12d). Das Plugin weckt das Kind, legt das Ziel an, stellt den Auftrag zu.
- **Werkzeug `ask_question`** (Plugin): eine Frage an genau eine Sitzung ohne Ziel; der Empfänger antwortet im selben Strang. Es erzeugt **kein** Ziel, bricht kein laufendes Ziel ab und löst **keine** Meldung an den Vorgesetzten aus.
- **`send_message` im Team-Modus abgelehnt** mit Hinweis auf `give_task`, `ask_question`, `goal_report` (M6, Abnahme 12e). Außerhalb des Team-Modus unverändert.
- Kosten und Gegenstimmen (aus Runde 1, weiter gültig): jede Zielrunde ist ein Modellaufruf, daher `maxrunden` als Pflicht; Rückfragen sind keine Aufträge (daher `ask_question`); ohne 5.2 darf 5.4 nicht gebaut werden, sonst arbeitet ein scharfes Ziel weiter, während der Mensch mit dem Experten spricht.
- **Jedes Teammitglied darf den Menschen direkt fragen** (Wunsch des Menschen): dafür `ask_question` mit Empfänger `mensch`; die Frage wird im Ticker sichtbar (6.8) und, wenn der Agent mit `await_goal_dependency` darauf wartet, als „wartet auf Antwort des Menschen“ markiert.

### 5.5 Kommunikationswege: was es gibt, was neu ist

| Gewünscht | Heute | Konzept |
|---|---|---|
| Nachricht | `send_message` (Steer), `send_to_session` (Plugin) | im Team-Modus `send_message` abgelehnt; Nachrichten nur über die vier Kanäle |
| Auftrag mit Ziel | nur als Text; Ziel legt der Empfänger selbst an | `give_task` (hart: ohne Zielbrief kein Auftrag) |
| Nachfrage | `send_message` | `ask_question` (still, kein Ziel, keine Meldung nach oben) |
| Bericht | Text an den Vorgesetzten | `goal_report` (Pflicht vor `complete`) |
| Team-Auftrag | `team_task_*` (Brett), weckt niemanden | unverändert; Task-Updates bleiben (Entscheidung des Menschen) |
| Stille Nachfrage über Fork | nicht vorhanden | ungemessen (U3); Fork des Leads ist ein Berater-Weg (6.6), keine Nachfrage an einen Experten |

### 5.6 Berater-Fork des Leads (Plugin, nur Vorgaben)

Gemessen (M4a/M4b): Ein Fork des Leads ist eine Wurzel mit leerem Team, Elternverweis auf den Lead. Das passt zu „verliert das Team, behält den Kontext“. Er ist nicht im Team-Modus (kein aktives Mitglied) und bekommt deshalb weder die Filter noch die abgelehnten Werkzeuge. **Rückmeldung an den Parent:** heute nur über `send_to_session` (Plugin; Wurzeln bekommen `inject` und werden nie geweckt) oder `parent.inject`. Das Konzept ergänzt: eine Rückmeldung des Forks an den Parent gilt **nicht** als Mensch-Eingriff, löst also keine Übernahme-Meldung aus, und weckt den Lead nicht (er liest sie beim nächsten Zug). Offen U3: ob der Fork das Ziel des Leads erbt und nach einem Neustart scharf wird.

### 5.7 Aufsicht des Leads ohne Weckrufe (Plugin)

Gemessen (M8): die Projektion `goal` (und `todos`, `userQuestions`, `tokenUsage`) ist für lebende **und** abgebaute Mitglieder billig lesbar, ohne sie zu wecken. Vorschlag: Werkzeug **`team_stand`** (Plugin, nur lesend): pro Mitglied Name, Ziel (Phase, Aktivierung, Runden, Wortlaut gekürzt), Zeit des letzten Ereignisses, „angehalten durch den Menschen seit …“, offene Frage an den Menschen, ob der letzte Bericht vorliegt. Eine Zeile je Mitglied. So braucht der Lead weder Nachrichten noch `list_agents`-Schleifen (die er laut Regel „Aufsicht gegen Schleifen“ bisher alle fünf Minuten machen sollte). Kein Weckruf, weil es eine Abfrage ist, kein Ereignis.

### 5.8 Benachrichtigungen an den Menschen: Ticker (eigener zweiter Schritt, Client-Plugin)

- Datenquelle: das Plugin schreibt jede durchgelassene Team-Meldung, jede Übernahme-/Rückgabe-Meldung, jede Frage an den Menschen und jeden Bericht in `~/.dsh/.tm/teams-plus/state/ticker.jsonl` (Zeit, Art, Absender, Ziel-Sitzung, Kurztext). Das ist Protokoll, nicht Zustellung: es weckt niemanden.
- Anzeige: eine Leiste in der Web-GUI (Client-Plugin; das Paket hat schon einen Client-Teil, `lib/client.js`, der mit `npm run build` gebaut wird, `dsh.client` in `package.json`), scrollbar, ein Klick springt zur Sitzung. Fragen an den Menschen werden hervorgehoben; ebenso Kinder, die per `await_goal_dependency` auf eine Antwort des Menschen warten.
- Listenansicht „angehalten durch den Menschen, seit …“ (5.2 Nr. 7).
- Wird **nach** dem Patch gebaut, getrennt abgenommen. Er hat keinen Einfluss auf die Filter.

## 6. Die drei Wege gegen DSH-Updates (Frage des Menschen) — nebeneinander

Die Sorge des Menschen: „das Modell weiß es dann nicht“, wenn das Profil nur zeitweise überschrieben wird, und Updates brechen die Lösung. Alle drei Wege behalten das **Filtern von „finished“ (5.1)** und die **Gesprächsübernahme (5.2)** als Plugin; sie unterscheiden sich nur bei den Kommunikationswerkzeugen.

| | **A: DSH-Werkzeuge im Team-Modus umwickeln und ablehnen** | **B: eigene Werkzeuge, DSH-Werkzeuge im Team-Modus ausblenden** | **C: eigene Werkzeuge, DSH-Werkzeuge bleiben sichtbar** |
|---|---|---|---|
| Wie | `give_task`, `ask_question`, `goal_report` sind immer registriert; ein Wächter (`tools.guard`, M6) lehnt `send_message` im Team-Modus ab mit Hinweis | dasselbe, zusätzlich `tools.restrict({deny:["send_message", …]})` im Agenten-Scope bei Eintritt in den Team-Modus | nur die eigenen Werkzeuge, keine Sperre |
| Wie bricht ein DSH-Update ihn? | Nur wenn `send_message` umbenannt wird: dann trifft der Wächter nichts (fail open: der alte Weg bleibt offen, **kein Absturz**); der Selbsttest meldet „Wächter ohne Treffer“ im Protokoll und beim Start. Der Wächter nutzt die öffentliche `tools.guard`-Schnittstelle | `restrict` wirft bei **unbekanntem** Namen („names unknown global tool“), also bei jeder Umbenennung ein **Fehler beim Anlegen**; wirkt außerdem **nur auf globale** Werkzeuge: das `send_message` des Team-Plugins liegt im Agenten-Scope und bleibt sichtbar (Quelltext, U4) | bricht nicht, denn es wird nichts gesperrt |
| Wie erfährt das Modell davon? | (1) Werkzeugfehler mit Hinweistext (gemessen, M6), (2) Abschnitt im Systemprompt (`systemPrompt.section`, Muster `stille-nachrichten.mjs`), (3) Beschreibungen der eigenen Werkzeuge, (4) Anweisungsdatei | Das Werkzeug **fehlt** in der Liste ohne Begründung; ein langer Kontext, der es noch aufgerufen hat, bekommt „unbekanntes Werkzeug“. Die Werkzeugliste steht im Anfrage-Kopf: **jede Umschaltung ändert den Kopf und entwertet den Zwischenspeicher** (`toolsChanged`, `dsh-agent-loop/lib/index.js` 927), bei den 550 000-Token-Kontexten des Leads rund 0,5 Mio. Token Cache-Schreiben je Umschaltung | Das Modell bleibt bei der Gewohnheit (`send_message`); die Anweisungsdatei allein hält laut Mensch nicht („Rein über Prompt Engineering funktioniert das nicht immer“) |
| Harte Sperre? | ja | ja, aber lückenhaft (Scoped-Werkzeuge) | **nein** |
| Rückholbar? | ja (Schalter, Plugin entfernen) | ja, mit Cache-Kosten bei jedem Wechsel | ja |
| Empfehlung | **Empfohlen** | nicht empfohlen (U4 und Cache-Kosten) | nicht empfohlen (keine Sperre) |

**Empfehlung A**, mit eigenen Werkzeugen als Pflichtkanäle. Es hält, was der Mensch will (harte Sperre in einem Werkzeug, nicht im anderen), ändert die Werkzeugliste nicht beim Umschalten, bricht bei einem Update schlimmstenfalls in den heutigen Zustand zurück statt in einen Fehler, und das Modell erfährt es an vier Stellen. Die komplett nachgebaute Kommunikation mit Abschalten der DSH-internen (B-Variante des Menschen) bleibt als Ausbau möglich, wenn die Messung U4 zeigt, dass `restrict` auch das Team-Werkzeug trifft.

## 7. Robust gegen Updates, Schalter, Kern-Eingriffe (Lead-Punkt 9)

- **Als Plugin machbar und deshalb ohne Kern-Eingriff:** 5.1, 5.2, 5.3 (Wächter), 5.4, 5.7, 5.8. Gemessen in der Probe (M1, M6, M7, M8) mit öffentlichen Schnittstellen (`Agent.send`, `tools.guard`, `ctx.goals`, `sessionQuery`).
- **Kern-Patch (nur bei Bedarf, nicht geplant):** eine Zeile in `notifySettlement`. Falls je nötig: als Patch-Datei nach dem Muster `allow-*.mjs` (Anker, `--status`, `--revert`), mit einer Prüfung in `~/.dsh/doctor.sh` Abschnitt [6/6] (dort stehen die vorhandenen Patch-Prüfungen, `doctor.sh` Z. 186–231), die nach einem Update „Patch fehlt“ meldet. Derzeit vorhandene Befunde dieser Art: Issue #24 (`allow-subagent-model-fields` findet seinen Anker nicht mehr) und #98 (`allow-subagent-rolle` halb eingespielt); `teams-plus doctor` meldet sie als „nachholen“.
- **Ein Schalter schaltet alles ab:** `team-modus.json` mit `aus: true` (4); wirkt beim nächsten Nachrichteneingang, kein Neustart nötig, weil der Zustand bei jeder Nachricht gelesen wird.
- **Selbsttest beim Start** (Muster `stille-nachrichten.mjs`): „Wächter hat Treffer“, „`send` umwickelt“, „Berichts-Ablage beschreibbar“; bei Abweichung Protokollzeile und Verhalten wie heute.
- **Das Plugin ändert beim Einbau nichts an `~/.dsh/profiles/`**, bis der Mensch einbaut (Regel dieser Runde); der Einbau ist ein eigener Schritt mit Speicherpunkt und Neustart-Freigabe.

## 8. Anweisungsdateien: Vorschläge als Diff (nichts geändert; Eintrag erst nach Abnahme)

Pro Stelle: die geänderte Regel im alten und neuen Wortlaut, danach die Liste dessen, was gestrichen oder geändert wird, mit Grund. Was nicht aufgeführt ist, bleibt unangetastet, insbesondere: Spec-Regeln („Specs sind heilig“), Ablage und Wirkung, Sprache in Antworten, Fragen und Checkpoints, Wortlaut nie umdeuten, **das Verbot, Dienste neu zu starten**, Branch-/Worktree-Disziplin, Tool-Aufrufe sind Aufrufe, Ausdauer, Konfigurations-Repo.

Zeilenangaben beziehen sich auf den Stand von heute (global `~/.dsh/AGENTS.md`, 982 Zeilen; Teams-Plus-Datei 144 Zeilen; Projekt `/Users/tmielsch/Perforce/stalker-dev/AGENTS.md`).

### 8.1 Global `~/.dsh/AGENTS.md`

**G1 — „Ziele: Anweisung nach unten, Vorschlag nach oben“ (Z. 561–579), Absatz Z. 576–579**

```diff
-Ein Agent kann ein Ziel **nicht für einen anderen** anlegen: `create_goal` legt
-immer ein Ziel für die aufrufende Sitzung an, es gibt kein Adressatenfeld. „Der
-Experte weist dem Worker ein Ziel zu“ heißt technisch: Nachricht mit dem Auftrag
-hinüber, und der Worker legt es für sich an.
+Im Team-Modus (`/team work`, mindestens ein aktives Teammitglied) legt der
+Vorgesetzte das Ziel eines Untergeordneten selbst an: mit dem Werkzeug
+`give_task` (Zielbrief und Rundenbegrenzung sind Pflicht; ohne sie scheitert der
+Aufruf). Das Plugin legt das Ziel für den Empfänger an. Außerhalb des Team-Modus
+gilt unverändert: `create_goal` legt ein Ziel nur für die aufrufende Sitzung an,
+und der Empfänger legt es für sich an.
```

Geändert/gestrichen: nur der Satz „kann nicht für einen anderen anlegen“ gilt im Team-Modus nicht mehr. **Bleibt:** „Nach unten Anweisung, nach oben Vorschlag“ (Z. 566–571), „Über ein Ziel des Projektleiters entscheidet der Mensch“ (Z. 572–574). Warum: Der Mensch hat das Anlegen durch den Vorgesetzten freigegeben; das Verbot „Lead kann sich kein Ziel von Teammitgliedern geben lassen“ bleibt davon unberührt.

**G2 — „Der Weg eines Plans“ (Z. 620–654)**

```diff
 3. **Der Lead nimmt ab:** er liest Plan und Red-Team-Befunde und antwortet mit Ja
-   oder Nein und Begründung. Erst nach seinem Ja geht der Plan an einen Worker.
+   oder Nein und Begründung. Erst nach seinem Ja geht der Plan an einen Worker.
+   Im Team-Modus nimmt den Plan der **Mensch gemeinsam mit dem Experten** ab
+   („Abnahme vom Menschen mache ich direkt mit dem Experten“); der Lead erfährt
+   davon durch die Meldung „Mensch hat … übernommen“ beziehungsweise „Ziel
+   fortgesetzt“ und prüft bei Bedarf mit einem Prüfer oder Red-Team, statt selbst
+   nachzuprüfen.
```

```diff
-5. **Aufsicht gegen Schleifen:** auf einen Worker höchstens zehn Minuten am Stück
-   warten, dann prüfen, ob er vorankommt (Stand-Datei, Protokoll, Zeitstempel,
-   sich wiederholende Aufrufe). Hängt er, nachschreiben oder anhalten. Auf einen
-   Experten wartet der Lead höchstens fünf Minuten am Stück.
+5. **Aufsicht gegen Schleifen:** auf einen Worker höchstens zehn Minuten am Stück
+   warten, dann prüfen … (unverändert für den Experten gegenüber seinen Workern).
+   Der Lead wartet auf einen Experten **im Team-Modus nicht mit einer
+   Fünf-Minuten-Frist**, sondern mit `await_goal_dependency` auf das Ergebnis des
+   Ziels; er liest den Stand über `team_stand` und die Dateien des Experten, nicht
+   über Nachfragen.
```

Geändert: (a) wer abnimmt (Mensch + Experte statt Lead); (b) Aufsicht des Leads passiv. **Bleibt:** Red-Team vor Abnahme (Punkt 2), höchstens drei Worker (Punkt 4), Experte prüft Ergebnis mit eigener Stichprobe (Punkt 6), „Auf Nachrichten wird nie blockierend gewartet“, `await_goal_dependency` (Z. 638–651). Grund: ohne Statusmeldungen gäbe die Fünf-Minuten-Regel ein teures Abfragen, und ohne die Abnahme-Änderung würde jeder Plan wieder am Lead hängen.

**G3 — „Delegation in der Praxis“ (Z. 656–679)**

```diff
 5. **Der Lead** führt die Ressorts zusammen und berichtet dem Menschen, mit
    Belegen (Pfade, Commits, Messungen) statt mit Behauptungen.
+   Im Team-Modus **ist der Lead nicht der einzige Zugang des Menschen**: Der
+   Mensch spricht direkt mit Experten (auch mit Facharbeitern) und arbeitet im
+   Team mit. Jedes Teammitglied darf den Menschen direkt fragen
+   (`ask_question` an `mensch`). Der Lead orchestriert (Ziele setzen, Prüfer und
+   Red-Team beauftragen) und prüft die Ergebnisse durch **Prüfer**, nicht selbst.
```

Unverändert bleiben: „Der Lead arbeitet nicht mit Workern“ (Z. 669–673), die Nachbarschaftsregel (Z. 675–679; Ergänzung unten), die Meldung von Werkzeugproblemen an den Workflow-Experten (Z. 681–700).

```diff
 Teammitglieder und Unteragenten schreiben einander nur **direkt benachbart**
 (Eltern zu Kind, Kind zu Eltern).
+Ausnahme im Team-Modus: **jedes Mitglied darf den Menschen direkt fragen.**
+Außerhalb von Abnahme und Frage laufen Nachrichten nur über die Kanäle
+`give_task`, `ask_question`, `goal_report` (Details in der Teams-Plus-Datei).
```

**G4 — „Die drei Rollen“ (Z. 518–528), neue Zeile**

```diff
 | **Worker** | ein Unteragent des Experten (`delegate_task`) | … |
+| **Mensch** | Wildcard-Mitarbeiter im Team (über dem Lead) | übernimmt Aufgaben, spricht direkt mit jedem Mitglied; der Lead bekommt davon nur die Meldungen „übernommen“ und „freigegeben“ |
+| **Berater-Fork** | Fork des Leads, vom Menschen angelegt | behält den Kontext, verliert das Team, darf an seinen Parent zurückmelden |
```

**G5 — Entscheidungen des Menschen (neue Regel, Rolle des Gesprächspartners)**

```diff
+**Entscheidungen des Menschen trägt die Sitzung in die Spec ein, mit der er
+gesprochen hat** (Experte, Facharbeiter, Fork), nicht der Lead; mit Datum und im
+Wortlaut des Menschen. Der Lead liest sie in der Spec.
```

Steht heute als geübte Praxis (Lead-Punkt 8), aber nicht in der Datei; kein vorhandener Text wird dafür gestrichen.

### 8.2 Teams-Plus-Anweisung `~/.dsh/.tm/teams-plus/agents/teams-plus-agents.voll.md` (Quelle im Repo: `agents/teams-plus-agents.md`)

**T1 — „7. Wie miteinander gesprochen wird“ (Z. 89–139), Absatz „Was eine Nachricht ist“ (Z. 101–104)**

```diff
 **Was eine Nachricht ist:**
-- eine konkrete Frage an genau eine Sitzung,
-- ein Auftrag an den, der ihn ausführt,
-- ein Ergebnis an den Vorgesetzten, mit Beleg (Pfad, Messung, Prüfsumme) — an ihn, nicht an das ganze Team.
+Im Team-Modus gibt es **vier Kanäle**, und `send_message` ist abgelehnt:
+- `ask_question` — eine konkrete Frage an genau eine Sitzung (auch an den Menschen),
+  ohne Ziel, ohne Meldung nach oben;
+- `give_task` — ein Auftrag an den, der ihn ausführt; **ohne Zielbrief kein Auftrag**;
+- `goal_report` — das Ergebnis an den Vorgesetzten, mit Beleg (Pfad, Messung,
+  Prüfsumme); Pflicht vor `update_goal(complete)`;
+- die gemeinsamen Aufgaben (`team_task_*`) — Task-Updates bleiben.
+Außerhalb des Team-Modus gilt die bisherige Liste mit `send_message`.
```

Geändert: der Kanal. **Bleibt:** „Was keine Nachricht ist“ (Z. 106–112), „Befehle werden ausgeführt, nicht bestätigt“ (Z. 114–131, wörtlich Anordnung des Menschen 2026-11-06), „Wer mit wem“ (Z. 133–135, bis auf die Ausnahme „jeder darf den Menschen fragen“), „Was das technische Drosseln nicht löst“.

**T2 — neue Abschnitte**: „Der Team-Modus“ (wann er gilt, Schalter, Wirkung auf Meldungen, Gesprächsübernahme und Rückgabe, vergessene Gespräche), „Berater-Fork“, `team_stand`. Neu, es wird nichts gestrichen. **Abschnitt 5 („Es wird mit gemeinsamen Aufgaben gearbeitet“, Z. 57–87)** bleibt; Task-Updates sind ausdrücklich vom Verwerfen ausgenommen. **Abschnitt 6 („Was Teams Plus nicht ändert“, Z. 141–144)** wird ergänzt: „Außerhalb des Team-Modus ändert Teams Plus nichts.“

**Hinweis:** `~/.dsh/.tm/teams-plus/agents` ist ein Verweis ins Repo; die Änderung gehört in `agents/teams-plus-agents.md` des Repos (die `.voll.md` im Repo ebenfalls) und wird mit `teams-plus agents install` in die globale Datei übertragen. Gleiches gilt für `projectos-agents.md` (nur Zeiger, unverändert).

### 8.3 Projekt `/Users/tmielsch/Perforce/stalker-dev/AGENTS.md`

**P1 — §0.3a Punkt 4 „Speichern und Einreichen: nur der Lead, im Modus `auto`“ (Z. 323), Z. 368, Z. 849, Z. 874**

```diff
-4. **Speichern und Einreichen:** nur der Lead, im Modus `auto`.
+4. **Speichern und Einreichen:** im Team-Modus der **Schreiber des Netzes**
+   (der Experte, der das Netz besitzt), nach jedem abgeschlossenen, gemessenen
+   und mit Bild geprüften Schritt (§ „Wann gespeichert wird“), in einer
+   **eigenen Changelist**, nie in der Default-Changelist; vorher
+   `p4 opened -c default` lesen. Außerhalb des Team-Modus bleibt es beim Lead.
```

```diff
-5. Speichern und Einreichen tut der Lead (§0.3a); ein Teamleiter meldet ihm „Schritt fertig, bitte sichern“.
+5. Im Team-Modus speichert und reicht der Teamleiter selbst ein (§0.3a, Punkt 4);
+   er braucht dafür keine Meldung an den Lead.
```

Z. 368 und Z. 849 entsprechend („… nur durch den Lead“ → „… durch den Schreiber des Netzes, im Team-Modus“). Geändert: wer speichert. **Bleibt:** die Regel „Keine kopierten Szenendateien“, „Wann gespeichert wird“ (nach jedem Schritt, nicht dauernd), „Offene Dateien sind geteilt – Shelf statt offener Datei“, „Der Agentenauftrag endet eingecheckt“. Grund: ohne diese Änderung müsste jeder Experte für jedes Speichern den Lead fragen — genau die Rückfrage-Kette, die das Konzept abschafft.

**Nicht vorgeschlagen, weil der Mensch entscheiden muss (Frage F7):** „**Der Kochmodus gehört dem Lead**; kein anderer schaltet ihn um“ (§0.3a Z. 317). Im Team-Modus ist der Lead passiv; wer schaltet dann `manual`/`auto` um? Das ist eine Entscheidung über geteilten Zustand der Szene, keine reine Rollenfrage, deshalb hier nur als offene Frage.

**P2 — §10.3 (Z. 1203–1263)**

```diff
 - **Der Ablauf:** Der Teamleiter beauftragt den Recherchearbeiter …, entwirft **selbst** den Plan, der Plan geht an Red-Team/QA, nach dessen Abnahme an den Implementer, und das Ergebnis geht zurück an Red-Team/QA. Die Punkte 2 und 3 dieses Abschnitts bleiben: der Lead nimmt den Plan ab, bevor er an den Implementer geht.
+ … Im Team-Modus nimmt den Plan der Mensch gemeinsam mit dem Teamleiter ab; der Lead
+ sieht die Meldung „übernommen/freigegeben“ und beauftragt bei Bedarf einen Prüfer
+ (Punkt 2 „Der Lead vermittelt, baut nichts“ bleibt).
```

Geändert: Abnahme im Team-Modus. **Bleibt:** Zuschnitt (ein Teamleiter, drei Facharbeiter), „Kein Bild-Facharbeiter, der Teamleiter sieht selbst“, „Architekturgespräch und Inventur parallel“, „Der Lead führt die Teamleiter, nicht die Facharbeiter“, Modellregeln, §10.4 Issue-Abschluss.

## 9. Drei Maschinen (Lead-Punkt 10)

Das Plugin kommt als Release-`tgz` (`https://github.com/tmielsch/dsh-teams-plus/releases/download/vX.Y.Z/…tgz`) auf Mac, ZimaOS und PC (so steht es heute für 0.8.4 in `~/.dsh/profiles/web/package.json`). Der Entwurf (5.1–5.7) ist reiner Plugin-Code ohne Kern-Eingriff und damit auf allen drei Maschinen gleich; ein Kern-Patch (derzeit nicht geplant) müsste je Maschine mit `teams-plus apply` eingespielt und von `doctor.sh` geprüft werden. Die Sitzungen auf ZimaOS sind betroffen, weil der Team-Modus je Maschine aus dem lokalen Profil und dem lokalen Team liest; ein Team ist maschinenlokal. Der Schalter-Pfad `~/.dsh/.tm/teams-plus/` ist je Maschine eigen (Konfigurations-Repo: ein Zweig pro Maschine). Pfade im Plugin (`/tmp/...`) dürfen nicht vorkommen; die Probe-Skripte tun es und gehören nicht ins Paket.

## 10. Abnahme (Lead-Punkt 12), später in der Probe-Instanz mit dem gebauten Plugin

Gemessen sind bisher nur die Bausteine (Abschnitt 3); das Plugin gibt es noch nicht.

| Prüfung | Soll | Baustein-Beleg heute |
|---|---|---|
| a) Team-Modus an, der Mensch spricht N Züge mit dem Experten | Lead wird **genau einmal** geweckt („stand by“), danach erst bei Freigabe oder Ziel erreicht | M0 (Grundlinie: 1 Zug je Gang), M1 (Filter: 0 Züge) |
| b) Team-Modus aus | Verhalten byte-gleich wie heute | Grundlinie M0 als Referenz; Vergleichslauf mit geladenem Plugin und `aus: true` |
| c) Absturz eines Unteragenten im Team-Modus | Meldung „failed“ kommt beim Vorgesetzten an | M1b (Text „failed“ unterscheidbar), Szenario `fehler` (Lead bekam sie) |
| d) `give_task` ohne Ziel | scheitert mit verständlicher Meldung | M6-Mechanik (Wächter/Werkzeugfehler) |
| e) `send_message` im Team-Modus | abgelehnt mit Hinweis auf die Kanäle | M6 |
| f) Meldung bei Ziel erreicht | genau einmal | M7 (Wächter für `complete`), Zustellung noch zu bauen |

## 11. Offene Fragen an den Menschen (Wirkung zuerst; die Fassung mit Kontext steht in der Abschlussmeldung)

- **F1 — Team-Modus ohne eigenen Schalter?** Ein Team mit aktiven Mitgliedern ist schon der Team-Modus (`/team work` hebt nur `/team rest` auf). Ein zusätzlicher Schalter wäre nur der Master-Schalter `aus`. Empfehlung: kein zusätzlicher Ein-Schalter, nur der Master-Schalter zum Abschalten.
- **F2 — Anhalten per Pause oder per Entwaffnen?** (5.2 Nr. 2)
- **F3 — Die Annahme „Nachricht pausiert das Ziel“ ist gemessen falsch (M5).** Soll das Plugin das Anhalten selbst auslösen, sobald du einem Mitglied mit laufendem Ziel schreibst? Empfehlung: ja, mit Meldung „stand by“.
- **F4 — Berater-Fork und Ziel:** Soll der Fork das Ziel des Leads erben, wenn das Ziel nach dem Fork scharf wird? (U3) Empfehlung: nein, der Fork bekommt kein scharfes Ziel.
- **F5 — Weg A, B oder C?** (Abschnitt 6) Empfehlung A.
- **F6 — Pflichtbericht über `goal_report` und Wächter statt Pflichtfeld.** Empfehlung ja.
- **F7 — Wer schaltet den Kochmodus im Team-Modus?** (8.3) Empfehlung: der Schreiber des Netzes für die Dauer seines Schritts, mit Rückschaltung.
- **F8 — Mitglieder, die ohne Ziel „finished“ enden:** die Meldung wird verworfen. Empfehlung: ja, dafür gibt es `team_stand` (5.7) und den Ticker.
