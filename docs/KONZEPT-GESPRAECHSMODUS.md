# Konzept: Gesprächsmodus und ziel-getriebene Team-Kommunikation

Stand: 2026-11-09, Entwurf eines Unteragenten des Leads. **Nichts davon ist eingebaut.** Dies ist ein Konzept, kein Plan zur Freigabe: Der Mensch hat noch sechs Fragen zu beantworten (Abschnitt 9), und drei Annahmen sind noch nicht am laufenden System gemessen (Abschnitt 8).

Auslöser und Bestandsaufnahme: Issue `tmielsch/DSH-Verwaltung` Nr. 121 („Agent Teams: Abschlussmeldungen von Unteragenten wecken den Lead, auch während der Mensch direkt mit einem Experten spricht"), dort der Kommentar „Bestandsaufnahme".

Ablage: diese Datei liegt im Repo `tmielsch/dsh-teams-plus` (Arbeitsordner `/Users/tmielsch/dsh-teams-plus/.worktrees/konzept-gespraechsmodus`, Zweig `konzept/gespraechsmodus`, nicht gepusht), neben den anderen Konzeptdateien in `docs/`.

## 0. Wortlaut des Menschen (2026-11-09 ca. 19:35, Spracheingabe, nur leicht geglättet)

Er steht vollständig im Issue 121. Die Sätze, auf die sich dieses Konzept stützt:

- „Es muss wirklich so etwas wie einen Schalter geben, der sagt: Okay, du bist jetzt im Gespräch mit dem Menschen, alle Team-Notifications, alles Agent-Teams-mäßige wird pausiert. Du bist gerade quasi aus diesem Agent-Team rausgenommen und komplett isoliert. Keine Tasks mehr, keine Notifications, gar nichts mehr. Nur noch das Gespräch mit dem Menschen. Bis dieses Gespräch zu einem Punkt gekommen ist, wo der Mensch das wieder freigibt.“
- „Wenn ein Sub-Agent losgeschickt wird, etwas zu tun, darf das nicht ohne Goal passieren. Das Goal ist dann der einzige Motor, der dafür sorgt, dass das Team weiter am Laufen bleibt.“
- „Und erst wenn das Goal abgeschlossen ist, wird an den Vorgesetzten gemeldet, vorher nicht. Und wenn ich ein Teammitglied direkt anschreibe, wird sofort das Goal pausiert. Und dann wird diese Status-Notification ausgeschaltet oder stumm geschaltet. Kann man vielleicht auch mit einem Schalter versehen, dass der Team Lead entscheiden kann, ob er diese Updates kriegen will oder nicht.“
- „Eigentlich will ich in dem Rahmen bleiben, den DSH mit dem Plugin bietet.“

## 1. Was die Messung ergeben hat (Kurzfassung der Bestandsaufnahme)

Alle Zeilenangaben beziehen sich auf `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/` (DSH 0.2.0-rc.2), gelesen, nichts verändert.

1. **Die Meldung kommt aus dem Kern, nicht aus dem Plugin.** Text: `dsh-subagent/lib/index.js` Zeile 616. Auslöser `notifySettlement`: Zeilen 1254–1268.
2. **Sie geht immer an das unmittelbare Elternteil** (`activation.parentSession`, Zeile 1257). Ein Teammitglied ist technisch ein fortsetzbarer Unteragent des Leads (Anbieter `spawn`, Kopfzeile seiner Sitzung: `parentSession` = Lead, `delegationDepth` 1). Deshalb trifft es den Lead und nicht „den Vorgesetzten der Arbeitsgruppe".
3. **Jede Zustellung an das Kind setzt `announced = true`** (Zeilen 1837 und 1957), auch die Nachricht des Menschen aus dem Chat (`subagent.prompt`, Zeilen 3010–3053). Kommt das Kind danach zur Ruhe (Zeilen 1155–1206: Agent untätig, Eingangskorb leer, keine eigenen Kinder), wird es abgebaut und meldet dem Elternteil. **Jeder Gesprächsgang des Menschen mit dem Experten erzeugt also genau eine Meldung an den Lead.** Gemessen: 15 Meldungen am 2026-11-09 zwischen 17:14 und 19:22, 15 ausgelöste Lead-Züge, rund 6,42 Mio. Token Cache-Schreiben und 4,16 Mio. Token Cache-Lesen (elfmal war der Zwischenspeicher abgelaufen und der ganze Kontext von 545 000 bis 617 000 Token wurde neu geschrieben).
4. **Ein Schalter im Kern existiert nicht.** Die Einstellungen von `dsh-subagent` sind nur `maxDepth` und `maxActiveSubagents` (Zeilen 2821–2823). Die Einstellungsoberfläche (`dsh-client-ui-settings-subagent`) hat denselben Umfang.
5. **Ist das Elternteil untätig, wird die Meldung als `followup` zugestellt** (Zeile 1264 `parent.status === "idle" ? "queue" : "steer"`, dann Zeilen 863–875 `sendWaking`: ein Elternteil ohne eigene Aktivierung, wie der Lead als Wurzel, bekommt `parent.followup(message)`). `followup` öffnet einen eigenen Zug (`dsh-agent-loop/lib/index.js` Zeilen 797–810). Läuft der Lead gerade, kommt sie als `steer` in den nächsten Schritt.
6. **Der gemeinsame Engpass aller Zustellungen ist `Agent.send(message, target, wakeup)`** (`dsh-agent/lib/types/runtime-types.d.ts`, öffentliche Agent-Schnittstelle; `followup`, `steer` und `inject` rufen es alle, `dsh-agent-loop/lib/index.js` Zeilen 800–810).

## 2. Die Bausteine, die DSH einem Plugin bietet (gemessen)

| Baustein | Was er kann | Fundstelle |
|---|---|---|
| `agent/inbox/inserted`, `agent/inbox/claimed`, `agent/inbox/discarded`, `agent/status` | nur beobachten (Modus „emit"), nichts verhindern | `dsh-agent/lib/types/runtime-types.d.ts` 240–300 |
| `agent/pre-step` (Modus „waterfall") | im letzten Moment vor einem Modellaufruf die angenommenen Nachrichten ersetzen oder den Schritt ablehnen (`{kind:"reject"}`: der Zug endet ohne Modellaufruf, die angenommene Nachricht wird weder verworfen noch als Sitzungsereignis geschrieben) | `runtime-types.d.ts` 296–310, `dsh-agent-loop/lib/index.js` 902–924 und 958–962 |
| Der Dienst `ctx.goals` | `get`, `create`, `disarm`, `resume`, `pause`; **die Dienste prüfen keine menschliche Vollmacht**, die steckt erst im Werkzeug `update_goal` (`requireDirectHuman`, `dsh-tool-goal/lib/index.js` 93) | `dsh-goal/lib/index.js` 604–700 |
| Ereignisse `goal/changed`, `goal/activation-changed` | beobachten, wann ein Kind ein Ziel anlegt, erreicht, blockiert oder entwaffnet wird | `dsh-goal/lib/index.js` 798 und 877 |
| `Agent.send` selbst | öffentlich; ein Plugin kann es **am Agenten-Objekt** umwickeln und Nachrichten vor dem Eingangskorb abfangen (das Plugin tut das heute schon mit Werkzeug-Definitionen: `stille-nachrichten.mjs`, `delegate-send.mjs`) | `runtime-types.d.ts` Agent-Schnittstelle |
| `ctx.commands.register` | Schrägstrich-Befehle, die ohne Modell ausgeführt werden | `dsh-commands/lib/index.js` 266, Beispiel `dsh-command-goal` |
| Werkzeug-Definitionen umwickeln | neue Felder an `send_message`, `delegate_task` | `stille-nachrichten.mjs` 223–360 |
| Zustand und Protokoll unter `~/.dsh/.tm/teams-plus/` | Entscheidung E1 der Repo-Spec | `ENTSCHEIDUNGEN.md` |

Was **nicht** da ist: ein Ereignis oder eine Hook-Stelle in `notifySettlement`; ein Schalter für die Abschlussmeldung; ein Weg für ein Plugin, die Meldung am Ursprung (Kern) zu unterdrücken, ohne in interne Felder zu greifen (`ctx.subagents.continuations.activations`, nicht öffentlich dokumentiert).

## 3. Warum die vorhandenen Werkzeuge das Problem nicht lösen

- **`quiet: true` an `send_message`** (`patches/stille-nachrichten.mjs`): setzt nur einen Text-Vermerk vor die Nachricht („antworte nicht dem Lead") und leitet den Absender an. Es betrifft **eine Nachricht eines Agenten an einen Agenten**. Die Abschlussmeldung ist keine Nachricht eines Agenten, sondern eine **Laufzeitmeldung des Kerns** (`subagent-settled`); die Nachricht des Menschen aus dem Chat läuft über `subagent.prompt`, nicht über `send_message`. Der Vermerk ist außerdem eine Bitte an ein Modell, keine Sperre. Das ist der Grund, warum es „nicht gereicht" hat.
- **`goals.disarm` / `goals.resume` und `await_goal_dependency`** (`patches/goal-await.mjs`): nehmen einer Sitzung die Vollmacht, sich **selbst** eine nächste Zielrunde zu geben. Sie sagen nichts darüber, was **andere** dieser Sitzung zustellen. Die Abschlussmeldung weckt den Lead, auch wenn dessen Ziel entwaffnet ist (sie ist ein `followup`, keine Zielrunde). Außerdem entsteht beim Warten selbst eine Meldung: Wer auf `await_goal_dependency` wartet, wird untätig, kommt zur Ruhe und meldet dem Elternteil. (Gemessen: der Teamleiter rief das Werkzeug 14-mal in drei Tagen auf, der Lead bekam in denselben Tagen 98 Meldungen dieses Kindes; Warten erklärt also nur einen kleinen Teil.)
- **`team_bremse`** (`patches/team-bremse.mjs`): begrenzt, wie viele Agenten mit scharfem Ziel gleichzeitig Zielrunden bekommen; wirkt nur **zwischen** Zügen und entwaffnet/weckt nur Ziele. Der Weckruf einer Nachricht „tritt synchron in `running` ein", bevor die Bremse hinsehen kann (Kopfkommentar des Patches). Sie ist eine Lastbegrenzung, kein Stummschalter.
- **`send_to_session` mit `inject`** für Wurzelsitzungen: wirkt nur für Nachrichten **dieses Werkzeugs**, nicht für die Kernmeldung.

## 4. Die Fähigkeiten a bis g

Jede mit Einordnung: **Plugin** (wie `goal-await.mjs`, im Profil geladen, ohne Eingriff in die Installation), **Kern-Patch** (Textänderung an einer Datei unter `/opt/homebrew/...`, wie die bestehenden `allow-*`-Patches, geht bei jedem DSH-Update verloren und muss mit `teams-plus apply` wieder eingespielt werden), **geht nicht**.

### a) Gesprächsmodus

**Einordnung: als Plugin machbar, mit zwei Vorbehalten; der kleinste Eingriff am Kern ist optional.**

Was der Mensch will: eine Sitzung — auch der Lead — wird aus dem Team herausgenommen. Keine Teamnachrichten, keine Aufgaben, keine Abschlussmeldungen wecken sie, bis der Mensch freigibt.

Vorschlag (Stufe 1, nur Plugin):

1. **Zustand** in `~/.dsh/.tm/teams-plus/state/gespraech.json`: welche Sitzungs-IDs im Gesprächsmodus sind, seit wann, wer ihn gesetzt hat. Er überlebt einen Neustart (E1: von Hand lesbar).
2. **Abfangen vor dem Eingangskorb**: Das Plugin umwickelt `Agent.send` an jedem Agenten, den es sieht (`agent/created` plus beim Start einmal `ctx.agents.list()`, so wie `agentTeams` es tut). Ist die Empfänger-Sitzung im Gesprächsmodus und die Nachricht von einer „Team-Art" (`source.kind` ist `subagent-settled`, `team-message` oder `agent-message`; Nachrichten des Menschen, Art `user`, gehen **immer** durch), wird sie
   - zuerst in den Puffer geschrieben (`~/.dsh/.tm/teams-plus/state/gespraech-puffer.jsonl`: Nachrichten-ID, Art, Absender, Zeit, Text),
   - danach nicht in den Eingangskorb gelegt. Ergebnis: kein Zug, kein Modellaufruf, kein Eintrag im Sitzungsprotokoll des Leads. Die Reihenfolge „erst Puffer, dann verwerfen" ist Pflicht: schlägt das Schreiben fehl, geht die Nachricht normal durch.
3. **Rückfall, falls das Umwickeln von `send` nicht greift** (Messung M1, Abschnitt 8): ein Zuhörer auf `agent/pre-step` am Lead, der angenommene Nachrichten dieser Arten herausfiltert (und den Schritt mit `{kind:"reject"}` ablehnt, wenn nichts übrig bleibt). Das ist teurer (der Zug öffnet sich und wird ohne Modellaufruf geschlossen; der Systemprompt wird noch zusammengesetzt) und schreibt Ereignisse ins Protokoll, kostet aber keine Token. **Wichtig:** `dsh-time-context` hängt in `agent/pre-step` bei „enter" mit leerer Nachrichtenliste trotzdem eine Zeitnachricht an und löst so einen Modellaufruf aus; nur `reject` unterdrückt ihn.
4. **Freigabe** bringt die gepufferten Nachrichten gesammelt zurück oder verwirft sie (Frage 1).

Vorbehalt A: **Teamnachrichten** (`team-message`) haben einen dauerhaften Briefkasten. Werden sie am Eingangskorb verworfen, bleiben sie im Briefkasten als „nicht zugestellt" stehen (`dsh-experimental-agent-team/lib/index.js` 1020–1050: Zustellung gilt erst als erfolgt, wenn die Zielsitzung sie als Sitzungsereignis geschrieben hat). Ob und wann der Briefkasten es dann erneut versucht (und damit erneut weckt), ist **nicht gemessen** (M3). Der sicherere Weg für diese Art ist, im Gesprächsmodus das Zustellen zu verweigern (Fehler werfen: der Briefkasten behält die Nachricht, `dispatchOnce` meldet „remains queued") und bei Freigabe ein Neuzustellen anzustoßen.

Vorbehalt B: Was wir unterdrücken, sind **gerade die Meldungen, die verhindern, dass ein Agent vergessen wird** (Abschnitt 4g). Deshalb braucht der Modus Sichtbarkeit und eine Wächteruhr (4g).

Stufe 2, optional und nur wenn Stufe 1 gemessen nicht genügt: **Kern-Patch** an `notifySettlement` (Zeile 1254). Kleinster Eingriff: eine Zeile vor dem Senden, die einen Dienst des Plugins fragt, ob diese Meldung zugestellt werden soll:

```js
// Entwurf, nicht angewendet: dsh-subagent/lib/index.js, in notifySettlement, nach "if (parent === void 0) return;"
const filter = this.ctx.get("teamsPlusMeldefilter");
if (filter !== void 0 && filter.zustellen(activation.childId, parent.id, terminal) === false) return;
```

Vorteil: die Meldung wird gar nicht erst gebaut. Nachteil: Textänderung in der Installation, nach jedem DSH-Update neu einzuspielen (wie `allow-child-session-routing.mjs`).

### b) Direkt angeschrieben heißt pausiert

**Einordnung: Plugin.**

- **Auslöser**: Eine Nachricht der Art `user` mit `rpcId` (das ist der Menschenweg, `dsh-subagent/lib/index.js` 3017–3021) trifft ein Kind (Teammitglied oder Unteragent). Die Anfangsaufgabe beim Start hat ebenfalls Art `user`, aber ohne `rpcId` (Zeile 1739): so lässt sich der Mensch von der Startaufgabe unterscheiden.
- **Wirkung 1: Ziel stoppen.** `ctx.goals.disarm(kind)` (der Rundentreiber schiebt nichts mehr nach; die Phase bleibt `active`), später `ctx.goals.resume(kind, ref)`. Genau dieser Weg ist in `goal-await.mjs` und `team-bremse.mjs` schon erprobt. Die Alternative `ctx.goals.pause` setzt die Phase auf `paused` (sichtbar in der Oberfläche), bricht aber einen gerade laufenden Zug des Kindes ab (`dsh-goal-round-driver/lib/index.js` Zeile 234) und darf laut Werkzeug nur der Mensch fortsetzen — das ist **nicht dasselbe** wie „entwaffnet". Welches der Mensch mit „pausiert" meint, ist Frage 2.
- **Wirkung 2: Meldungen des Kindes stumm schalten.** Das Kind kommt in die Liste „stumm" (Zustand wie bei a). Die Abschlussmeldung des Kerns und Nachrichten, die das Kind an sein Elternteil schickt, werden am Elternteil abgefangen (a, Punkt 2) und gepuffert.
- **Freigabe**: Befehl oder Werkzeug (Frage 3). Bei Freigabe: Ziel wieder scharf (`resume`), Stummschaltung weg, gepufferte Meldungen nach Wahl zustellen.
- Gegen den Befund aus Issue 37 (Teamleiter wird nach einer angekündigten Zwischenmeldung nicht wieder geweckt): Das Wiederscharfschalten muss immer gesichert sein (4g).

### c) Melden erst bei erreichtem Ziel

**Einordnung: Plugin, aber nur als Filter am Elternteil; die Meldung am Ursprung bleibt nur mit Kern-Patch.**

Der Kern kennt kein „Ziel erreicht" als Bedingung der Abschlussmeldung; er meldet bei jeder Ruhe. Das Plugin kann am Elternteil die Meldung mit einem eigenen Wissen abgleichen: Es beobachtet `goal/changed` und `goal/activation-changed` und führt für jedes Kind eine Schattenkarte (Kind → letzte Phase und Scharfstellung). Eine Meldung wird nur durchgelassen, wenn die Phase des Kindes `complete` oder `blocked` ist (oder wenn das Kind gar kein Ziel hat und die Regel aus d noch nicht gilt). Alles andere geht in den Puffer und wird nicht zugestellt. Grenze: Zum Zeitpunkt der Meldung ist das Kind bereits abgebaut; seine Ziele sind nur aus der Schattenkarte lesbar, nicht mehr über `ctx.goals.get` (`assertLive`). Nach einem Neustart der Maschine ist die Schattenkarte leer; sie muss dann aus dem Sitzungsprotokoll des Kindes nachgeladen werden (`goal/change` Ereignisse, sichtbar im Protokoll des Teamleiters).

Zusatz: Eine Meldung bei **Blockade** muss immer durchkommen, auch im Gesprächsmodus des Elternteils nicht verschluckt werden (4g, „Notbremse").

### d) Kein Auftrag ohne Ziel

**Einordnung: Plugin kann es erzwingen — aber nur auf Kosten einer Regel in `~/.dsh/AGENTS.md`, die der Mensch ausdrücklich aufheben müsste.**

Technisch: Ein Plugin umwickelt `delegate_task`, `spawn_teammate` und `send_message` (die Wickeltechnik gibt es, `stille-nachrichten.mjs`) und verlangt ein neues Pflichtfeld `ziel` (Zielbrief, Rundenbegrenzung). Zwei Wege, es auch durchzusetzen:

- **Weg 1 (dem Wortlaut der AGENTS.md treu)**: das Plugin hängt an den Auftrag den festen Satz „Lege als Erstes `create_goal` mit diesem Zielbrief an" und prüft nach dem ersten beendeten Zug des Empfängers, ob ein Ziel existiert (`goal/changed` Schattenkarte). Fehlt es, schickt es dem Empfänger einmal eine Erinnerung; fehlt es danach noch, lehnt es weitere Aufträge an diesen Empfänger ab. Wirkt, kostet einen Zug.
- **Weg 2 (stärker)**: Das Plugin legt das Ziel selbst für den Empfänger an: `ctx.goals.create(empfaenger, {objective, maxGoalRounds})`. Der Dienst prüft keine menschliche Vollmacht (siehe Abschnitt 2). **Das widerspricht** der ausdrücklichen Regel in `~/.dsh/AGENTS.md` („Ein Agent kann ein Ziel nicht für einen anderen anlegen … der Worker legt es für sich an") — dort steht sie als Beschreibung einer technischen Grenze des Werkzeugs `create_goal`, nicht als Entscheidung des Menschen. Ob er sie aufhebt, ist Frage 4.

Was dagegen spricht, ehrlich:

1. **Kosten.** Ein Ziel treibt Runden an, jede Runde ist ein Modellaufruf. Der Mensch beklagt gerade verbrannte Token. Ohne Rundenbegrenzung (`max_goal_rounds`) kann ein Ziel teurer sein als das Problem, das es lösen soll.
2. **Fragen sind keine Aufträge.** Eine kurze Rückfrage („welche Datei meinst du?") braucht kein Ziel. Eine harte Sperre „ohne Ziel keine Nachricht" würde auch Antworten blockieren. Das Konzept braucht deshalb zwei getrennte Wege (f): Auftrag (mit Ziel, Zwang) und Nachfrage/Antwort (ohne Ziel, nicht zwingend).
3. **Das Ziel kollidiert mit dem Gespräch** — genau das Problem aus b. Ein Experte mit scharfem Ziel arbeitet weiter, während der Mensch ihm schreibt. Deshalb gehört d ohne b nicht gebaut.
4. **Offene Arbeit hat kein klares Ende.** `update_goal` mit `blocked` ist vor einer Mindestrundenzahl abgelehnt; ein Ziel „bleibe im Gespräch" kann nie erreicht werden.

### e) Schalter für den Lead: Statusmeldungen ja oder nein

**Einordnung: Plugin.**

Eine Datei `~/.dsh/.tm/teams-plus/meldungen.json` mit dem Wert pro Elternsitzung: `alle` (heutiges Verhalten, Vorgabe), `nur-ziel` (nur Abschluss oder Blockade, siehe c), `aus` (nichts, alles in den Puffer). Ein Werkzeug `team_meldungen` (nur für Wurzelsitzungen) und ein Schrägstrich-Befehl lesen und setzen sie. Das Umwickeln von `Agent.send` (a) liest den Wert bei jeder Nachricht. Eine Wirkung auf die Nachrichten des Menschen gibt es nie.

### f) Mehrere Kommunikationswege — was es heute unter anderem Namen gibt

| Gewünscht | Gibt es heute? | Wie |
|---|---|---|
| **Nachricht** | ja | `send_message` (Kern, Steer), `send_to_session` (Plugin, `auto`/`steer`/`followup`, eine Sitzung beliebiger Art), `quiet: true` (Plugin, Vermerk) |
| **Auftrag** | halb | `delegate_task` und `spawn_teammate` starten Arbeit mit einem Text; ein Ziel entsteht nur, wenn der Empfänger `create_goal` selbst aufruft |
| **Team-Auftrag** | ja, nur unter anderem Namen | die gemeinsamen Aufgaben des Teams: `team_task_create` / `team_task_update` (Kern, Brett), eine Aufgabe weckt aber niemanden (Messung `docs/MESSUNG-AUFGABEN-WECKER.md`) |
| **Nachfrage** an einen Experten, ohne dessen Arbeit zu stören | nein | `team_anruf` ist nur ein Verzeichnis geführter Gespräche; ein Fork ist immer ein Kind der **eigenen** Sitzung, nicht der fremden (siehe `docs/TEAM-ARBEITSWEISE.md` §6b) |
| **Stille Nachfrage über einen Fork** | nicht gebaut | denkbarer Plugin-Weg: eine kurzlebige Sitzung, die aus dem gespeicherten Protokoll des Experten **angelegt** wird (`ctx.agents.create` mit `seed`), die Frage beantwortet und dann endet; der Experte wird dabei nicht geweckt und sein Protokoll nicht beschrieben. **Nicht gemessen, ob `seed` aus einer fremden Sitzung erlaubt ist.** |
| **Status** | ja | `list_agents`, `team_task_list`; `Stand:`-Zeile im Brett (Regel §5 der Anweisungsdatei) |

Das Wesentliche: **Nachricht, Auftrag, Nachfrage und Status sind heute alle derselbe Kanal** (`send_message`, Steer). Deshalb gibt es keine Möglichkeit, ihnen unterschiedliche Regeln (mit Ziel, ohne Ziel, still) mitzugeben. Das Konzept schlägt vor, dem Werkzeug (durch Umwickeln) ein Feld `art` zu geben: `nachricht` (heutiges Verhalten), `auftrag` (verlangt `ziel`), `nachfrage` (still, kein Wecken des Empfängers, keine Meldung an den Lead), `status` (nur an das Elternteil, in `meldungen.json` einschränkbar).

### g) Was dabei kaputtgehen kann, und wie es verhindert wird

1. **Ein Agent wird nie wieder geweckt.** Gefahr: Gesprächsmodus oder Stummschaltung bleiben stehen, das Ziel bleibt entwaffnet, niemand merkt es. Vorsorge: (i) der Zustand steht auf der Platte und im Werkzeug `team_bremse status`-ähnlichen `gespraech status` mit Alter; (ii) eine **Wächteruhr** warnt (nicht gibt frei) nach einer einstellbaren Zeit (Vorgabe 2 Stunden): sie schreibt eine einzige Zeile an den Menschen; (iii) bei Freigabe wird jedes entwaffnete Ziel durch `goals.resume` wieder scharf geschaltet, mit Prüfung, dass die Zielkennung und die Revision unverändert sind (so macht es `team-bremse.mjs` `istGueltig`); (iv) die bestehende Lücke aus Issue 37 bleibt, wird aber durch die Wächteruhr überwacht.
2. **Verlorene Nachrichten.** Vorsorge: erst in den Puffer schreiben (Datei, `fsync`), erst dann nicht zustellen; Nachrichten-IDs; bei Freigabe jede ID nur einmal; ein Testfall pro Art mit Gegenprobe (Puffer defekt → Nachricht geht durch); Briefkasten-Nachrichten bleiben im dauerhaften Briefkasten des Teams, werden also nicht doppelt gepuffert.
3. **Notbremse.** Eine Blockade-Meldung eines Kindes und eine Nachricht des Menschen gehen nie durch den Filter in den Puffer. Fehlerfall im Filter selbst (Ausnahme) → durchlassen.
4. **Selbstweckschleifen.** Eine Freigabe, die gepufferte Meldungen als eigene Nachricht zustellt, darf nicht selbst wieder gepuffert werden (eigene Herkunftsart `plugin:@tmielsch/dsh-teams-plus`, wie `send-to-session.mjs` es für sich festgelegt hat; der Filter lässt sie durch).
5. **Neustart.** Zustand und Puffer überleben; Ziele sind nach einem Neustart ohnehin wieder entwaffnet (`dsh-goal/lib/index.js` Zeilen 595–602). Der Gesprächsmodus gilt danach weiter und wird in der ersten Antwort sichtbar gemacht.
6. **Update des Kerns.** Stufe 1 hängt am öffentlichen `Agent.send` und an Ereignissen und überlebt Updates, soweit diese Schnittstellen bleiben; ein Selbsttest beim Start prüft, ob das Umwickeln wirkte (Muster: `stille-nachrichten.mjs` meldet „Form unerwartet" statt zu raten). Nur die optionale Stufe 2 geht bei einem Update verloren.

## 5. Reihenfolge, wenn der Mensch zustimmt (kleinste Schritte, jeder einzeln prüfbar)

1. Nur Messungen M1–M4 (Abschnitt 8), ohne Einbau. Ein kleines Wegwerf-Probe-Plugin im Worktree, **nicht** geladen.
2. Schritt „Abfangen und Puffern" (a) für **Abschlussmeldungen allein** — das löst den Anlass des Issues. Schalter: Datei und Befehl. Nichts anderes ändert sich.
3. Schritt b (direkt angeschrieben) auf Stufe 2 aufgesetzt.
4. Schritt e (Schalter für den Lead).
5. Schritt c (nur bei Ziel melden).
6. Schritt f/d (Wege und Zwang) zuletzt, denn hier greift der Plugin-Umbau in Werkzeuge und in die Regel des Menschen ein.

Jeder Schritt wird einzeln eingebaut, mit einer Gegenprobe, die rot wird, wenn der Schritt fehlt (Muster der bestehenden Testsuite, 230 Tests).

## 6. Zusammenfassung der Einordnung

| Fähigkeit | Einordnung | Fundstelle | Kleinster Eingriff |
|---|---|---|---|
| a Gesprächsmodus | Plugin (Stufe 1); Kern-Patch nur optional | `dsh-agent/lib/types/runtime-types.d.ts` (`Agent.send`), `dsh-subagent/lib/index.js` 1254–1268 | `Agent.send` am Lead umwickeln, vor dem Eingangskorb in den Puffer schreiben |
| b Direkt angeschrieben = pausiert | Plugin | `dsh-subagent/lib/index.js` 3010–3021 (Quelle `user` mit `rpcId`), `dsh-goal/lib/index.js` 604–700 | Auslöser am Kind erkennen, `goals.disarm`, Kind in die Liste „stumm" |
| c Melden erst bei Ziel | Plugin (Filter am Elternteil); am Ursprung nur Kern-Patch | `dsh-goal/lib/index.js` 798, 877; `dsh-subagent/lib/index.js` 1254 | Schattenkarte der Ziele, Filter nach Phase |
| d Kein Auftrag ohne Ziel | Plugin kann es erzwingen; Weg 2 widerspricht einer Anweisung; Kosten und Gespräch sprechen dagegen | `dsh-tool-goal/lib/index.js` 93; `dsh-goal/lib/index.js` 636 | Pflichtfeld `ziel` in einem umwickelten `delegate_task`, Weg 1 |
| e Schalter für den Lead | Plugin | wie a | Datei `meldungen.json` und ein Befehl |
| f Kommunikationswege | halb vorhanden; „stille Nachfrage über Fork" geht nur mit unbestätigter Annahme | `team_task_*` (Kern), `send_to_session` (Plugin) | Feld `art` an `send_message` |
| g Risiken | beherrschbar, wenn Puffer-vor-Verwerfen, Wächteruhr und Notbremse mitgebaut werden | siehe 4g | — |

## 7. Was das Konzept ausdrücklich nicht tut

- Es ändert nichts an `~/.dsh/profiles/`, an der Installation oder an einem laufenden Dienst, und es verlangt keinen Neustart, bevor der Mensch zugestimmt hat.
- Es ersetzt keine Regel in `~/.dsh/AGENTS.md`; wo es ihr widerspricht (d, Weg 2), steht es als Frage.

## 8. Noch nicht gemessen (jede Annahme mit dem Weg zur Messung)

- **M1.** Greift ein am Lead-Agenten-Objekt umwickeltes `send` auch dann, wenn die Meldung vom Kern über `parent.followup(...)` kommt? Quelltext sagt ja (`followup` ruft `this.send`), am laufenden System nicht gemessen. Probe: ein Wegwerf-Plugin im Worktree, in einer **eigenen** DSH-Instanz (nicht in der laufenden) geladen — das ist ein Neustart eines Prozesses und braucht deshalb die ausdrückliche Zustimmung des Menschen.
- **M2.** Läuft ein Schrägstrich-Befehl im Chat eines Teammitglieds? Der Chatweg dorthin ist über `subagents.prompt` umgeleitet (Patch `allow-child-session-routing`); ob das Befehls-Parsen dort stattfindet, ist ungeprüft.
- **M3.** Verhalten des Teambriefkastens, wenn eine Zustellung scheitert: wird erneut versucht, wann, mit welchem Weckeffekt?
- **M4.** (bereits teilgemessen) Anteil der Meldungen, die durch `await_goal_dependency` entstehen: 14 Aufrufe des Teamleiters in drei Tagen gegen 98 Meldungen an den Lead. Der Hauptanteil kommt also aus anderen Ruhezeiten (Gespräch mit dem Menschen, Ende eines Auftrags).

## 9. Fragen an den Menschen

Sie stehen mit Wirkung, Fachname und Empfehlung in der Abschlussmeldung dieses Unteragenten an den Lead; hier die Kurzfassung der Entscheidungen, die sie auslösen:

1. Gepufferte Meldungen nach dem Gespräch: gesammelt zustellen oder verwerfen?
2. „Pausiert": sichtbar pausiert (Phase `paused`) oder still entwaffnet (Phase `active`, Rundentreiber stoppt)?
3. Wer gibt frei: ein Befehl im selben Chat, ein Werkzeug, oder eine Zeit (die dem Wortlaut „bis der Mensch freigibt" widerspräche)?
4. Darf das Plugin ein Ziel für einen anderen Agenten anlegen (d, Weg 2), oder bleibt es dabei, dass der Empfänger es selbst anlegt?
5. Soll „kein Auftrag ohne Ziel" eine harte Sperre sein oder ein Hinweis, und gilt sie nicht für Fragen?
6. Soll „direkt angeschrieben" automatisch auslösen (jede Nachricht des Menschen an ein Teammitglied) oder nur auf einen Befehl?
