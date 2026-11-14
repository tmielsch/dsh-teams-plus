# Abnahme: Kern-Patch "Kind gehoert auch dem Menschen" (2026-11-14)

Zielbrief: docs/ZIELBRIEF-KERN-KIND-BESITZ-2026-11-14.md. Erwartung davor: docs/messung-kern-kind-besitz/ERWARTUNG-2026-11-14.md (Commit 700ee00). Entscheidung des Menschen zur Abschlussmeldung bei schlafendem Elternteil (ueber den Lead, 2026-11-14): "2 - Leise zustellen: die Meldung in den Posteingang des Elternteils legen, ohne ihn zu wecken". Ausdrueckliche Freigabe, dafuer in die Sitzungsdatei des Elternteils zu schreiben, genau fuer diesen Zweck.

## Was gebaut ist

Neue Dateien: patches/kind-eigner.mjs (Logik, 16 Ersetzungen, Selbstpruefung --test) und patches/allow-kind-eigner.mjs (Bedienung: Aufruf ohne Schalter = freigeben, --status, --revert, --root=<pfad>, --sicherung=<ordner>; Sicherung vor dem ersten Schreiben; sha256 vorher/nachher je Kerndatei in der Ausgabe). Test: test/kind-eigner.test.mjs (17 Faelle, davon zehn Mutationen). Messaufbau: docs/messung-kern-kind-besitz/ (probe-kern.sh, treiber-kern.mjs, rohdaten/).

Kernstellen (Kern 0.2.0-rc.2, Pfad .../@deepseek-ai/dsh/node_modules/@deepseek-ai/):

| Kerndatei | Stellen (Zeilen im Ausgangsstand) | Gemessene Zeilenaenderung (diff Installation gegen gepatchte Kopie) |
|---|---|---|
| dsh-subagent/lib/index.js | 14 Ersetzungen: prompt() Zeile 3016 und 3053, deliverByHuman (neu, vor deliverFollowup 1819), coldResume 1913-1914, assertAdmitting 944-946, materialize 967-968, Aufbau-Setup 1068-1075, applyChildComposition 511, Aktivierung 1096, acquireOwnership 1139-1142, submitAdmitted 998, notifySettlement 1249-1252 (Ablegen), finishDisposal 1248 (abwarten), depositSettlement (neu, vor flushFinalState 1266) | 60 hinzugefuegt, 12 entfernt |
| dsh-client-ui-conversation/lib/client.js | parentOffline (Zeile 17288) | 1 / 1 |
| dsh-client-ui-subagent/lib/client.js | selectReadOnlySubagent (Zeile 934-935) | 1 / 2 |

MESSUNG (diff -Zeilen, Werkzeug diff und grep -c): zusammen 62 Zeilen hinzugefuegt, 15 entfernt, drei Kerndateien; das ist die Groesse, die der Zielbrief "etwa 60 bis 70, drei Dateien" nannte, und der Lead hat sie vorab als innerhalb bestaetigt. Waere meine Zaehlung falsch, haette die Selbstpruefung der Ersetzungen (nachher minus vorher in kind-eigner.mjs) eine andere Summe gezeigt (Test "sechzehn Ersetzungen", Wachstum unter 90).

Die drei Teile des Patches:
1. Wecken ohne Elternteil: `subagents.prompt` wirft bei kaltem Elternteil nicht mehr, sondern ruft `deliverByHuman`; es prueft, dass die Elternadresse zur Kennung im Kopf des Kindes passt (sonst unveraendert subagent/unauthorized), und laeuft dann den normalen Zustellweg mit `parent = undefined`. Dort entfallen genau die Dinge, die einen lebenden Elternteil brauchen (Besitzeintrag, Ahnenpfad, Berechtigung durch lebenden Elternteil, Voreinstellung des Elternteils); die Voreinstellung (agent preset) kommt aus dem Kopf des Kindes. Mit lebendem Elternteil laeuft jede Ersetzung byte-genau den alten Zweig.
2. Abschlussmeldung: Ist der Elternteil kalt, legt `depositSettlement` die Meldung als angehaengtes Ereignis `agent/inbox/spliced` in dessen Sitzungsdatei, ueber `sessionPersistence.open(id, "write")` (dieselbe Persistenzschicht und Sperre wie der Kern), ohne den Elternteil zu laden. Es versucht bis zu zehnmal im Abstand von 200 ms, falls der Elternteil gerade geladen wird; lebt er dann, geht die Meldung den bisherigen Weg (sendWaking). Haelt jemand anderes die Sperre laenger, steht eine Warnung im Protokoll und nichts wird geschrieben.
3. Browser: Das Eingabefeld (`parentOffline = false`) und die Schreibschutz-Karte (`selectReadOnlySubagent` gibt nichts mehr zurueck) haengen nicht mehr am Elternteil. Die Host-Zusammenfassung (`agentAvailable`) bleibt ehrlich und unveraendert.

## Messungen (Attrappen-Modell, Kopie des Kerns, Probe ohne Port)

Aufbau: probe-kern.sh startet dsh aus /tmp/teams_plus_kern/kopie (rsync der Installation, 504 MB, dann mit --root gepatcht), DSH_HOME /tmp/teams_plus_kern/probe_home, Attrappe fake-llm.mjs zaehlt jeden Modellaufruf in llm-aufrufe.log, Treiber treiber-kern.mjs ruft denselben Weg wie der Browser (Gateway subagents/prompt, session/list). Rohdaten: docs/messung-kern-kind-besitz/rohdaten/ergebnis_<szenario>_<vorher|nachher>.json. Alle Laeufe: Exit 0, kein Fehlerfeld, Prozesszaehler der Probe danach 0. Die laufende Installation und dsh web wurden nicht beruehrt (Pruefsummen der Installation unveraendert, unten).

### Abnahme (a) und (b), vorher gegen nachher (MESSUNG)

| Fall | Vorher (Kern unveraendert) | Nachher (gepatcht) |
|---|---|---|
| (a) Kind unter kaltem Lead, Mensch schreibt dem Kind | subagent/parent-unavailable, Modellaufrufe 2 -> 2, nichts lebt | messageId kommt; Modellaufrufe 2 -> 3 (nur +1 des Kindes: Kind 1 -> 2, Lead 1 -> 1); lebend: nur das Kind (agent/created source=resume, eine Kennung); Lead nie erzeugt |
| (b) Enkel unter kalter Mitte unter kaltem Lead | parent-unavailable, Modellaufrufe 4 -> 4 | messageId kommt; Modellaufrufe 4 -> 5 (nur +1 des Enkels: 1 -> 2; Lead 1, Mitte 2 unveraendert); lebend: nur der Enkel; Lead und Mitte nie erzeugt |

Waere die Konstruktion falsch, kaeme hier etwas anderes heraus, weil: bei einem Patch, der den Elternteil doch irgendwo laedt, stuende im Treiber ein zweites agent/created fuer die Kennung des Elternteils und sein Zaehler im llm-Log stiege; beide Messungen zaehlen beides und zeigen 0. Der Vergleich ist gegen den Lauf "vorher" im selben Treiber und derselben Kopie, nicht gegen eine Erwartung.

### Gegenproben (MESSUNG, alle nachher)

- Fremde Elternadresse (Szenario f): subagent/unauthorized ("subagent does not belong to this parent"), Kind lebt nicht, Modellaufrufe unveraendert. Waere der Besitz-Check zu weit geoeffnet, kaeme messageId und das Kind lebte (Mutationen 2 und 3 im Test pruefen den Text dieser Zeilen).
- Elternteil lebt (Szenario g): messageId kommt, Meldung geht den bisherigen Weg: der lebende Elternteil bekommt genau eine neue Abschlussmeldung (Zaehlung 1 -> 2 in seinem Verlauf), Elternteil lebt weiter, Modellaufrufe wie im unveraenderten Kern (Eltern 1 -> 2 durch die Meldung, Kind 1 -> 2).
- Die Sperre (Szenario h): haelt ein anderer die Schreibsperre der Elterndatei, waehrend das Kind fertig wird, steht die Warnung "settlement notice for the sleeping parent ... was not stored: session ... is already owned by an active write handle" im Protokoll des Hosts (vom Treiber abgefangen, rohdaten/ergebnis_h_nachher.json, Feld warnungen), der Elternteil bekommt keine zweite Meldung (MESSUNG: 2 Zeilen mit subagent-settled in seiner Datei waehrend der Sperre, das sind Ereignis und Nachricht der EINEN Meldung der ersten Runde, wie im Lauf ohne Sperre vor dem Wecken; Dateigroesse waehrend der Sperre 11625 Byte, rohdaten/ergebnis_h_nachher.json), es gibt keinen Absturz und kein Beschreiben ohne Sperre. Die Meldung geht in diesem Fall verloren (nach zehn Versuchen im Abstand von 200 ms kein weiterer). Waere meine Sperrbehandlung falsch, stuende die Zeilenzahl danach bei 4 oder die Warnung fehlte.

### (c) Abschlussmeldung bei schlafendem Elternteil (MESSUNG, Szenario a nachher)

Ein Satz: Die Meldung steht nach dem Fertigwerden des Kindes im Posteingang des schlafenden Elternteils (Sitzungsdatei 11609 -> 11958 Byte, mit zstd gelesen; nach dem Laden zeigt `inbox.next-turn` eine Nachricht mit source.kind subagent-settled), der Elternteil wurde nicht geladen und hat 0 Modellaufrufe in der Zeit; wird er spaeter geladen, laeuft ebenfalls keine Runde von selbst (Status idle, 0 Aufrufe nach 2,5 s), und erst eine Nachricht an ihn stellt die Meldung zu: 2 Modellaufrufe des Elternteils (die Meldung und die neue Nachricht, im selben Zug) und der Posteingang ist danach leer, die Zaehlung subagent-settled im Verlauf steigt 1 -> 2. Waere die Meldung nicht angelegt, stuende die Zaehlung nach dem Laden bei 1 und der Posteingang waere leer; beides ist gemessen anders.

Eine Einschraenkung steht dort ehrlich: Dass die Meldung beim Laden "wartet", statt eine Runde zu starten, gilt fuer einen Elternteil ohne Ziel und ohne Team. Das Risiko aus Issue DSH-Verwaltung 181 (Laden eines Leads mit wartender Team-Nachricht startet eine Runde) gilt fuer die Team-Nachrichten weiter, siehe (d).

### (d) Wartende Team-Nachrichten, Lead kalt (MESSUNG, Szenario d nachher)

Lead mit zwei unzugestellten Team-Nachrichten im Journal (eine an den Lead, eine an das Mitglied exp), Lead und exp kalt. Mensch schreibt exp: messageId kommt, exp lebt (source=resume), Lead bleibt kalt, die zwei Team-Nachrichten bleiben UNZUGESTELLT (delivered [] auf der Platte), Modellaufrufe 2 -> 3 (nur exp). Kein Wecken durch wartende Nachrichten. Danach wird der Lead (wie vom Menschen) geladen: Status running, 0 Aufrufe direkt; nach 400 ms hat der Lead 1 Aufruf und exp 1 (zugestellt: beide Team-Nachrichten gebucht, exp wird wieder geweckt), nach 5 s Lead 2 Aufrufe (er antwortet auf die zweite Abschlussmeldung von exp). Das ist die Kette aus Issue 181 (docs/messung-eltern-laden/ERGEBNIS-ISSUE-181-2026-11-13.md), nur dass der Mensch hier den Lead laedt, nicht ein Haken beim Oeffnen eines Kindes. Der Patch aendert das nicht; er legt zusaetzlich eine Abschlussmeldung von exp in den Posteingang des Leads (Zaehlung 1 -> 2 auf der Platte, nach dem Laden 3). Quota: ein Aufruf je wartender Nachricht, wie in Issue 181 gemessen.

Zusatzbefund (MESSUNG): Waehrend der Lead kalt ist, liefert `agentTeams.tryMembership` fuer das geweckte Mitglied `undefined` (Treiber nach dem Wecken: expTeamZugehoerigkeit undefined). Das geweckte Mitglied ist fuer das Team also kein Mitglied, bis der Lead geladen ist: seine Team-Werkzeuge liefern nichts. Das haengt am Team-Paket, nicht an diesem Patch, und ist die Folge davon, dass der Lead nicht geladen wird.

### (e) Zusammenfassung und Browser-Feld (MESSUNG fuer die Host-Zusammenfassung; Browser selbst NICHT gemessen)

Der Browser leitet die Sperre aus dem Feld `parentAvailable` des Kindes ab, das er aus `agentAvailable` der ELTERN-Zusammenfassung (`session.list`) bildet (dsh-api-session-controller/lib/client.js 2477 und 2589; dsh-client-ui-conversation 17288; dsh-client-ui-subagent 934). MESSUNG session.list: im Ruhezustand des Kindes (kalter Elternteil) Kind false, Elternteil false (vorher wie nachher); im laufenden Zustand nach dem Wecken Kind true und running true, Elternteil false (nur nachher moeglich; vorher kann man das Kind nicht wecken). Damit steht fest: ohne die dritte Stelle bliebe das Feld grau, weil `parentAvailable` fuer das geweckte Kind false bleibt, solange der Elternteil kalt ist. Darum ruehren die Ersetzungen "eingabefeld" und "schreibschutz-karte" die Browser-Dateien an, und nicht die Host-Zusammenfassung (kein "agentAvailable true" fuer einen Agenten, der nicht lebt). Der Zustand "Eingabefeld frei" ist am Text der Datei gelesen (`parentOffline = false`, node --check ok), nicht im Browser gesehen.

### Rueckweg (MESSUNG)

--revert an der Kopie nach dem Patch: alle drei Kerndateien byte-gleich zu den Originalen in der Installation (sha256 index.js e0fb5cc3..., conversation client.js 9ac75e8f..., subagent client.js e6627b51..., beide Seiten gleich). Das Werkzeug gibt vorher und nachher je Datei aus. Waere die Ruecknahme falsch, stuende hier eine andere Pruefsumme; im Test "apply und --revert" ist derselbe Vergleich an einer Wegwerf-Wurzel automatisiert.

Hinweis aus der Arbeit (kein Fehler des Patches, aber eine Falle): --revert gehoert zu derselben Fassung wie apply. Aenderte ich den Text des Patches zwischen apply und revert, blieb in der Kopie ein Rest stehen, den das Werkzeug als "gesperrt" las, weil der alte Ausgangstext in der neuen Einfuegung vorkommt. Wer den Patch spaeter aendert, nimmt zuerst mit der alten Fassung zurueck.

## Tests

- test/kind-eigner.test.mjs: 17 Faelle (Selbstpruefung, 16 Ersetzungen in genau 3 Dateien, apply/--status/--revert in einer Wegwerf-Wurzel byte-gleich, veraenderter Anker -> Weigerung ohne Schreiben, doppelter Anker abgelehnt, echte Installation nur gelesen und auf einer Kopie syntaxgeprueft und zurueckgenommen, Grundlinie, **zehn Mutationen, jede wird rot**: Ruecknahme laesst Rest, Elternadresse nicht geprueft (deliverByHuman), Elternadresse nicht geprueft (coldResume), authorizeLineage entfaellt bei lebendem Elternteil, prompt wirft weiter, Abschlussmeldung laedt den Elternteil, Abschlussmeldung nicht nur angehaengt, Eingabefeld bleibt gesperrt, agentAvailable verfaelscht, Weg mit lebendem Elternteil verschwindet).
- test/umzug.test.mjs: Dateizaehlung von 29 auf 31 .mjs-Dateien angepasst (kind-eigner.mjs, allow-kind-eigner.mjs), sonst unveraendert.
- Ganze Suite: 355 von 355 gruen (vorher 338 auf main; 17 neue Faelle). MESSUNG, `npm test`.

## Einspielen und Zuruecknehmen (drei Handgriffe fuer den Menschen)

1. Einspielen: `node patches/allow-kind-eigner.mjs` (im Paket dsh-teams-plus; sucht die Installation und sichert nach ~/.dsh/patches/backup-kind-eigner/<zeit>/). Vorher `--status`: alle 16 Zeilen muessen "gesperrt" zeigen. Der Patch steht bewusst NICHT in `teams-plus apply`.
2. `dsh web` neu starten (macht der Mensch; die Browser-Seite danach neu laden). Der Host hat das alte Modul im Speicher.
3. Zuruecknehmen: `node patches/allow-kind-eigner.mjs --revert`, `dsh web` neu starten, Seite neu laden. Danach sind die drei Kerndateien byte-gleich zum Ausgang. Bereits abgelegte Abschlussmeldungen in Sitzungsdateien von Elternteilen bleiben natuerlich stehen (sie sind normale Eintraege des Posteingangs und werden beim Laden wie eine gewoehnliche Abschlussmeldung behandelt). Nach einem DSH-Update: `--status` zeigt "UNBEKANNT", dann wird nichts geschrieben.

## Was ich nicht gemessen habe

- Den echten Browser: ob das Eingabefeld wirklich frei ist und ob die Seite nach dem Neuladen das Kind richtig zeigt (nur Text gelesen und Syntax geprueft).
- Ein echtes Modell: alle Zahlen stammen von der Attrappe (Antwort "ACK n"); wie ein echter Lead auf eine abgelegte Abschlussmeldung reagiert (Werkzeugaufrufe, Weckkette), ist ungemessen.
- Grosse Sitzungsdateien: die Elterndateien waren winzig (11 KB); `depositSettlement` liest den ganzen Verlauf, um die Zahl der wartenden Nachrichten zu zaehlen (Schaetzung SCHAETZUNG: bei Hunderttausenden Ereignissen spuerbar, nicht gemessen).
- Zwei Prozesse (zwei dsh gleichzeitig): die Sperre ist eine Sperre des Betriebssystems; der Fall "anderer Prozess haelt sie" ist nur ueber die In-Prozess-Sperre gemessen (Szenario h).
- Dateien und Bilder an ein kaltes Kind ueber den Menschen-Weg (Teil mit `file` liest `agents.get(childSessionId)`, bleibt wie bisher "unavailable" bei kaltem Kind).
- `sendToParent` (das Kind schreibt per Werkzeug an seinen kalten Elternteil): bleibt PARENT_UNAVAILABLE, nicht angefasst.
- Mehrere gleichzeitig fertig werdende Kinder desselben kalten Elternteils: die Meldungen laufen in einer Warteschlange pro Elternteil (locks.run, gelesen), gemessen ist eins.
- Ein Zwischenkind, das lebt, waehrend sein Enkel vom Menschen geweckt wird: der Enkel bekommt dann `parent === undefined` nur, wenn das Zwischenkind nicht lebt; der Fall "Zwischenkind lebt" ist der unveraenderte Kernweg (Szenario g misst ihn fuer Lead-Kind).
