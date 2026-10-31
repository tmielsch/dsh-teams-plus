# Freigabevorlage v0.6.0 — `send_to_session`

Stand: 2026-10-31, 06:15 (Europe/Berlin). **Nicht eingebaut**, nur im Repo.
Zweite Red-Team-Runde gegen `bf4854a` gelaufen: **Freigabe mit Auflagen**. Die zwei HOCH-Befunde
sind in `342647c` abgearbeitet, jede Reparatur mit einer Gegenprobe, die sie rot machen kann.
Vorgeschichte: `docs/STOPP-V0.4.0.md` (Sperre), `docs/REDTEAM-SEND-TO-SESSION.md` (Altbericht),
Red-Team-Bericht gegen v0.5.0 (dieser Durchgang, mündlich an die Leitung).

## Was der Red-Team-Durchgang gegen v0.5.0 ergeben hat

**Urteil: STOPP für v0.5.0.** Ein Satz: `baueQuelle` schrieb `kind: "plugin"`, und das
**v4-Sitzungsformat lehnt genau diesen Wert beim Schreiben ab** — die Zustellung an eine lebende
Sitzung lässt deren Persistenz ab dem ersten `agent/inbox/spliced` stehen, und die fail-closed
Checkpoint-Policy kann den nächsten Modellschritt der Ziel-Sitzung abbrechen.

**Der Autor (ich) hat den Befund zuerst für falsch gehalten** und ihn mit einem eigenen Prüflauf
„widerlegt". Der Prüflauf war falsch: er baute das Ereignis als `data.message` statt `data`. Erst
die Gegenprobe zeigte beide Ausgänge in einem Lauf — echtes Ereignis: `THROW`, mein falsches:
`angenommen`. **Ein Prüflauf, der die geprüfte Stelle nicht erreicht, ist kein Gegenbeweis.** Das
ist derselbe Fehlertyp wie die STOPP-Datei, die am falschen Ort nachsah.

## Befunde und was daraus wurde

| Befund (v0.5.0) | Schwere | Stand in v0.6.0 |
|---|---|---|
| **B1** `kind: "plugin"` ist im v4-Format verboten; Persistenz der Ziel-Sitzung steht, DoS über die Checkpoint-Policy möglich | BLOCKER | **behoben** — `kind: "plugin:@tmielsch/dsh-teams-plus"` (vom Codec erzeugte Produzenten-Art, gemessen akzeptiert) + Test, der die echte Quelle durch `releasedV4SessionFormatCodec.encodeEvent` schickt (beide Ereignisformen) |
| **H1** Kettenbudget falsch positiv **und** falsch negativ (ein `ketteVon`-Slot pro Sitzung) | HOCH | **ersetzt** durch ein **Paar-Budget**: 2 Nachrichten je geordnetem Paar im Fenster, keine Wortwiederholung. Die Sprunghöhe ist **gestrichen**, nicht repariert (siehe unten) |
| **H2** Zustandsdatei ist schreibbar/löschbar; `ladeZustand` fiel fail-open | HOCH | **abgeschwächt, nicht gelöst** — `kaputt` wird gemeldet statt still verschluckt; im Kopf steht jetzt, dass die Bremse eine Höflichkeitsbremse ist, keine Sicherheitsgrenze |
| **H3** v0.4.0 läuft live, der Fix ist blockiert | HOCH | **offen** — das entscheidet der Mensch, nicht der Patch |
| **M1** Lost Update über zwei Zustands-Halter | MITTEL | **behoben** — Lesen-Buchen-Schreiben liegt unter einer Dateisperre; Merge allein reichte nicht (gemessen) |
| **M2** Titelsuche ist tot (`Session` hat kein `title`) | MITTEL | **behoben** — Zielsuche über Kennung, Kennungs-Präfix und `session.header.cwd` |
| **M3** Protokolle liegen außerhalb des E1-Datenordners | MITTEL | **behoben für dieses Modul** — `~/.dsh/.tm/teams-plus/logs/`; `stille-nachrichten` bleibt offen |
| **M4** Wurzelsitzung nicht markiert/gesperrt | MITTEL | **behoben** in `342647c` — eine Wurzel bekommt `inject`. Vorher stand hier `steer`; das war falsch, weil `steer` ebenfalls weckt |
| **N2** Testlauf schrieb ins echte `~/.dsh/logs` | NIEDRIG | **behoben** — `DSH_HOME` zeigt im Test auf ein temporäres Verzeichnis; gemessen: Zuwachs 0 Bytes |
| **N3** `--test`-Selbstprüfung war versprochen und existierte nicht | NIEDRIG | **behoben** — Kopf nennt jetzt den echten Prüfweg |

## Zweite Runde gegen `bf4854a` — Urteil und was daraus wurde

**Urteil: Freigabe mit Auflagen.** Der Blocker der ersten Runde war wirklich behoben und durch einen
Test gedeckt, der rot werden kann. Zwei HOCH-Befunde standen davor:

| Befund (Runde 2) | Was nicht stimmte | Stand in `342647c` |
|---|---|---|
| **HOCH-1** Nachricht ohne `id` | `llm.createUserMessage` gibt es am Dienst nicht — es ist eine **Modulfunktion** (`dsh-llm/lib/index.js:59`). Der Aufruf war immer `undefined`, der Fallback erzeugte eine Nachricht ohne `id`; der Posteingang wirft dann bei der zweiten ausstehenden Nachricht (`dsh-agent-loop:191-192`) | `createUserMessage` wird aus dem Kernmodul geladen; der Fallback vergibt eine eigene Kennung. Test + Gegenprobe |
| **HOCH-2** Wurzelschutz erreicht sein Ziel nicht | `steer` weckt ebenfalls: `send(input, "next-step", true)` (`dsh-agent-loop:809-811`), und der Kernvertrag sagt „an idle driver starts a turn". Nur `inject` weckt nicht | Eine Wurzel bekommt `inject`. Der Preis steht in der Antwort: die Nachricht kann liegen bleiben, bis der Mensch tippt |
| **MITTEL-1** Begründung für die gestrichene Sprunghöhe war falsch | „Die Abstammung sieht dieses Werkzeug nicht" — sie ist sichtbar (`dsh-tool-goal:12-20` liest `event.data.source`) | Begründung korrigiert: messbar ist die erste Stufe, **nicht** die ganze Kette ohne fremde Protokolle. Als benannte Grenze offen |
| **MITTEL-2** Kopfkommentar beschrieb v0.5.0 und empfahl `kind: "plugin"` | Ein Leser hätte den Blocker wieder eingebaut | Kopf auf 0.6.0, `plugin` ausdrücklich als Blocker markiert |
| **MITTEL-3** Hermetik-Nachweis maß am alten Logpfad | Der Code schreibt dort nicht mehr — die Messung konnte nicht scheitern | Positiv- und Negativkontrolle am neuen Pfad: neuer Pfad wächst, alter nicht |
| **MITTEL-4** Fehlendes `roots()` fiel still aus | Ohne den Dienst ging `followup` durch, ohne Meldung | `roots()` steht in `try`, ein Ausfall wird gemeldet; ein werfendes `roots()` verhindert die Zustellung nicht |
| **NIEDRIG-1** Skalare in der Zustandsdatei still akzeptiert | `null`, `42`, `"x"` galten als frischer Anfang | Sie gelten als `kaputt` und werden gemeldet |
| **NIEDRIG-3** Parameterbeschreibung versprach eine Titelsuche | Es gibt keinen Titel; die Suche liest `header.cwd` | Beschreibung korrigiert |

**Nicht abgearbeitet, mit Absicht:** NIEDRIG-2 (Test 2 prüft teilweise sich selbst), NIEDRIG-4 (der
Client zeigt `plugin:…` als menschliche Anfrage — die Herkunft trägt nur der Text), NIEDRIG-5
(absoluter Codec-Pfad im Test), NIEDRIG-6 (die Policy-Tests der Suite sind nicht hermetisch).
Alle vier sind benannt und keine davon berührt die Zustellung.

## Drei Gegenproben zu den Reparaturen

| Reparatur zurückgebaut | Wird rot |
|---|---|
| `id` aus dem Fallback entfernt | HOCH-1-Test |
| `inject` zurück auf `steer` | HOCH-2-Test |
| Merge vor der Buchung entfernt | M1-Integrationstest |

Alle drei gemessen, nicht behauptet.

## Die Entscheidung, die im Code steckt: Sprunghöhe gestrichen

v0.5.0 hatte einen Kettenzähler mit Sprunghöhe (4) und Rundläufen je Kette. Das Red Team hat
gemessen, dass beides gleichzeitig falsch positiv und falsch negativ war, weil eine „Kette" über
einen einzigen `ketteVon`-Slot je Sitzung lief.

**Die Sprunghöhe ist nicht repariert, sondern gestrichen** — aber die Begründung ist eine andere
als zuerst hier stand. Falsch war: „die Abstammung sieht dieses Werkzeug nicht". Sie ist sichtbar:
`dsh-tool-goal` liest über `agent.session.snapshotEvents()` und die Projektion `turnBoundary` die
Nachricht, die die laufende Runde geöffnet hat, und darin `event.data.source`. Richtig ist: Die
**ganze Kette** ist so nicht messbar — dafür müsste dieses Werkzeug die Protokolle fremder
Sitzungen lesen, und das soll es nicht. Was bleibt, ist das, was sich **je geordnetem Paar exakt
zählen lässt**. Die erste Stufe (wer hat diese Runde geöffnet?) bleibt als benannte Grenze offen. Gegenrichtung `A→B` und
`B→A` sind verschiedene Paare: wer antwortet, ist nicht der, der angefangen hat.

Der Altbericht verlangte Paar-Zähler **plus** Tiefenstufe. Die Tiefenstufe ist damit **offen
abgelehnt** — als benannte Grenze, nicht als vergessene Arbeit. Wer sie will, muss einen Weg finden,
die Abstammung mitzugeben.

## Was das Red Team in Ordnung fand (nicht doppelt prüfen)

- `hasDirectHumanInput` öffnet für `plugin:…` kein Ziel (`dsh-tool-goal:49-81`).
- `agent-send` und `plugin:dsh-teams-plus` passieren den v4-Codec (gemessen).
- `agent.status` existiert (`idle`/`running`); `auto` fällt sonst auf `steer` zurück.
- `agent.id` ist die Sitzungs-ID und bleibt über `resume` gleich.
- `systemPrompt.section()` gibt einen Disposer zurück, der die Sektion entfernt (gemessen mit echtem Cordis).
- Die Drossel in `stille-nachrichten` hält 20 Zeilen/s ohne Zählerleck.
- `ctx.tools.get` liefert die gespeicherte Definition; `neu` verhindert die 38k-Zeilen-Schleife.
- Selbstsperre, nur lebende Ziele, `send_message` unberührt.

## Nachweis (von der Leitung gemessen)

```
$ npm test
# tests 121   # pass 121   # fail 0

$ node patches/stille-nachrichten.mjs
Selbstpruefung: alles in Ordnung.

$ # Testlauf schreibt nicht mehr ins echte Protokoll:
Zuwachs ~/.dsh/logs/send-to-session.log: 0 Bytes
```

Die Tests sind **hermetisch**: `DSH_HOME` wird auf ein `mkdtemp`-Verzeichnis gesetzt, **bevor** das
Modul geladen wird. Ohne das schriebe die Suite in die Ablage des Menschen — dem Red Team ist genau
das an der Vorgängerfassung aufgefallen.

## Drei Gegenproben, die der Autor selbst gefahren hat

Eine Prüfung ohne Fall, der scheitern kann, ist keine Prüfung (Issue #10 im Verwaltungs-Repo).
Deshalb hier drei Messungen mit beiden Ausgängen:

**(1) Wird der Encode-Test wirklich rot?** Kopie des Repos unter `/tmp`, `QUELL_ART` zurück auf
`"plugin"` gesetzt (den Blocker), Suite gegen die Kopie:

```
not ok 1  - die Quelle kommt durch den ECHTEN v4-Codec (der Blocker aus v0.5.0)
not ok 2  - die Quelle ist NICHT `plugin` — genau das lehnt der Codec ab
not ok 3  - die Quelle ist die dokumentierte Erzeuger-Art und oeffnet kein Ziel
not ok 21 - die Zustellung geht an den naechsten Schritt, nicht in eine neue Runde
# tests 27   # pass 23   # fail 4
```

Vier Tests werden rot, darunter der Encode-Test. Mit der richtigen Quelle: 27/27 grün. **Der Test
kann scheitern.**

**(2) Existiert `session.header.cwd` zur Laufzeit?** Das ist die Frage, an der die alte Fassung
gescheitert ist (`session.title` gab es nicht). Gemessen an einer echten `Session`:

```
SESSION_FORMAT_VERSION: 4
hat header: true
header.cwd: /tmp/x
hat title: false
Header-Schluessel: version, id, createdAt, isSeeded, cwd
```

`header.cwd` gibt es, `title` nicht. Die Zielsuche liest ein Feld, das existiert.

**(3) Wie viele Prozesse können die Zustandsdatei gleichzeitig schreiben (M1)?**

```
ps: node /opt/homebrew/bin/dsh web --no-open          (der Web-Host)
ps: node /opt/homebrew/bin/dsh --profile sicht        (fluechtig, beim zweiten Blick weg)
Profilaulagen: headless laedt @tmielsch/dsh-teams-plus NICHT, web schon
```

**Ein** Prozess lädt das Plugin. Der Pfad `~/.dsh/.tm/teams-plus/state/` ist allerdings **nicht
pro Profil** getrennt: Sobald ein zweites Profil das Paket lädt (oder ein zweiter `dsh web` läuft),
schreiben zwei Prozesse dieselbe Datei.

Nachgemessen mit vier bzw. fünf **echten Kindprozessen**, die sich im kritischen Abschnitt
überlappen (künstliche Verzögerung, sonst überlappen sie nicht — ein Prüflauf ohne Überlappung
kann eine Sperre nicht prüfen):

| Fassung | Ziele, die ankamen |
|---|---|
| ohne Sperre | **1 von 5** |
| mit Merge, ohne Sperre | **3 von 5** |
| mit Sperre | **5 von 5** |

Der Merge allein war also nicht die Lösung — erst die Sperre schließt das Loch. Der Test
`die Sperre schützt über echte Prozessgrenzen` führt beides aus und **verlangt**, dass die Fassung
ohne Sperre verliert; sonst wäre er wertlos.

## Offene Auflagen vor dem Einbau

1. **H3:** Die gesperrte v0.4.0 läuft. Entweder v0.6.0 einbauen (nach diesem Pass) oder die Zeile
   entfernen. Der jetzige Zustand ist der schlechteste von beiden.
   Die beiden Wege stehen fertig in `docs/EINBAU-UND-RUECKNAHME.md`.
2. ~~**M1:** Lost Update über zwei Prozesse.~~ **erledigt** in `c25e2c5`: eine Dateisperre
   (`open … 'wx'`) umschließt Lesen, Buchen und Schreiben; veraltete Sperren werden nach 5 s
   entfernt, gewartet wird bis 600 ms. Der Merge allein genügte **nicht** — gemessen verlor auch
   die Merge-Fassung ohne Sperre noch 2 von 5 Einträgen. Restgrenze, offen benannt: Hält ein
   Prozess die Sperre länger als die Wartezeit, arbeitet der nächste **ohne** sie weiter (lieber
   zustellen als hängen); dann greift wieder der Merge.
3. **H2:** Die Zustandsdatei ist keine Sicherheitsgrenze. Entweder in einen geschützten Store legen
   oder im Kopf ausdrücklich als Höflichkeitsbremse führen (letzteres ist getan).
4. ~~**M3:** `stille-nachrichten.mjs` schreibt nach `~/.dsh/logs/`.~~ **erledigt** in `cb5c7db`:
   jetzt `~/.dsh/.tm/teams-plus/logs/`, samt `mkdirSync` — ohne den hätte der Umzug das Protokoll
   still verschluckt.
5. ~~**M5:** Die Kaskaden-Regel steht zweimal im Modell-Input.~~ **erledigt** in `cb5c7db`: der
   Spawn-Anhang ist entfernt, die System-Sektion trägt sie allein. Gemessen: 25 Agenten → 20
   Protokollzeilen + 1 Summenzeile nach 1,3 s Ruhe (vorher ging die Summe bei Ruhe verloren, N1).

