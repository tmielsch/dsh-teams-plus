# Plan: Eltern-Sitzung laden, damit jede Unteragenten-Sitzung jederzeit weckbar ist (2026-11-12)

**Zweig:** `umsetzung/eltern-laden` im Repo `/Users/tmielsch/dsh-teams-plus` (von `main`, Version 0.8.6). **Kein Code im Plugin**, nur dieser Plan und die Messbelege unter `docs/messung-eltern-laden/` (Erwartung davor: `ERWARTUNG-2026-11-12.md`, Ergebnisse: `ERGEBNIS-2026-11-12.md`, Rohdaten `ergebnis_<szenario>.json`, Probe-Aufbau `probe-eltern.sh`, `probe.patch.yml`, `treiber.mjs`, `fake-llm.mjs`, `stub-dienste.mjs`). Zielbrief: `docs/ZIELBRIEF-ELTERN-LADEN-2026-11-12.md`. Art der Aufgabe: **Prototyp, inkrementelles Weiterbauen** (kein Red-Team vor dem Start verlangt; der Bau erst nach Abnahme durch den Menschen).

## 1. Gegenstand in einem Satz, und was dieser Plan nicht beantwortet

Der Plan beschreibt, wie ein neuer, eigener Patch `patches/eltern-laden.mjs` (Teams Plus) die Eltern-Sitzung eines Unteragenten **von selbst in den Arbeitsspeicher lädt** (der Kern nennt eine nicht geladene Sitzung „offline“), sobald der Mensch das Kind öffnet oder anschreibt, ohne dass dabei eine Modellrunde, ein Modellaufruf oder ein Ziel anläuft, und wie die Sperre „The parent session is offline“ dadurch ohne Kernänderung verschwindet.

**Dieser Plan beantwortet nicht:** wie lange eine Wurzel-Sitzung mit vielen Ereignissen zum Laden braucht (alle Messungen mit winzigen Sitzungen, 2 bis 40 ms); ob die Sperre im echten Browser verschwindet (aus dem Quelltext des Clients gelesen, nicht im Browser gesehen); und den Fall, dass der Elternteil selbst ein Kind ist (Lead → Experte → Facharbeiter, Experte kalt): dort trägt der Weg **nicht**, siehe Abschnitt 3 Nr. 8 und Issue 177; ebenso keine Entscheidung, die nur der Mensch treffen kann (Abschnitt 8).

## 2. Spec-Sätze, die dieser Plan umsetzt

**Keine Spec im Auftrag genannt** für diesen Bereich (die Spec-Verzeichnis-Tabelle der `AGENTS.md` kennt dafür keine; die Spec dieses Auftrags ist der Wortlaut des Menschen im Zielbrief, Zeile 3, Stand der Datei: Commit „Zielbrief: Eltern-Sitzung laden …“ auf diesem Zweig). Wörtlich, vom Menschen (Issue „DSH-Verwaltung“ 175, Unteragenten-Sitzung nicht anschreibbar, wenn die Eltern-Sitzung offline ist):

> „Ich muss jederzeit in der Lage sein, Subagent Sessions zu wecken. Das darf nicht an dem Parent Agent haengen.“
> „Ich brauche keine Fehlermeldung. Ich muss das Problem geloest haben.“

**Abweichungen von der Spec: eine, ausdrücklich benannt.** „Jederzeit“ ist für einen **kalten Elternteil, der selbst ein Kind ist**, mit dem hier geplanten Mittel nicht erfüllbar (Messung M12, Issue „DSH-Verwaltung“ 177). Für diesen Fall liefert der Plan keine Lösung; er bleibt wie heute (Sperre) und der Mensch entscheidet in Abschnitt 8 Frage O3, ob dafür eine Kernänderung gewollt ist.

## 3. Tragende Annahmen (in der Reihenfolge, in der du sie prüfen solltest)

Alle Messungen: `docs/messung-eltern-laden/probe-eltern.sh <szenario>` erzeugt die Probe aus dem Repo neu (eigene Pfade `probe_eltern`, `probe_eltern_home`, kein Port).

**1 — Der Kern lehnt das Anschreiben bei kaltem Elternteil ab, und zwar im Kern, nicht nur in der Oberfläche. `MESSUNG` (M1, M4, M15).** `subagents.prompt` wirft `subagent/parent-unavailable` („parent session … is not live“); auch der Weg der Oberfläche über das Gateway. 0 Modellaufrufe dabei. *Wäre die Konstruktion falsch*, käme beim Gateway-Aufruf ohne Haken eine `messageId` heraus. *Prüfen:* `ergebnis_tor.json`, Feld `torKalt` (`ok: false`, `code`).

**2 — Laden mit `ctx.agents.resume` oder dem Controller-Lookup `agent` startet weder Runde noch Modellaufruf. `MESSUNG` (M2, M6, M8, M16).** In allen Läufen blieb die Zahl der Modellaufrufe beim Laden gleich (2 → 2, 3 → 3). *Prüfen:* `ergebnis_grund.json` Felder `laden.vor.llm` und `laden.nach.llm`, `nachLaden.llm`; Gegenprobe ist der Zug **danach** (M3), der die Zahl erhöht, sobald das Kind antwortet; das ist die normale Antwort des Kindes, nicht das Laden.

**3 — Das Laden schaltet kein Ziel scharf. `MESSUNG` (M8).** Elternteil mit aktivem Ziel mitten in einer Runde, hart beendet (wie ein DSH-Neustart, Szenario `neustart-a`/`-b`): nach dem Laden `phase: active`, Aktivierung **`disarmed`**, `roundsStarted` unverändert 1, in 5 Messpunkten (je 1 s) 0 Modellaufrufe des Elternteils. Meine Erwartung davor war „scharf“ (E4) und **falsch**. *Prüfen:* `ergebnis_neustart-b.json` Felder `zielNachLaden` und `protokoll` (fünf Einträge `ziel-verlauf`, `llmEltern: 0`). Hinweis: Das Ziel läuft erst weiter, wenn der Mensch es fortsetzt; kommt dagegen die **Antwort des Kindes**, nimmt der Elternteil einen Zug (M9, Zielrunde) wie ein lebender Lead.

**4 — Ein Plugin kann beide Eingänge ohne Kernänderung umwickeln. `MESSUNG` in der Probe, `SCHÄTZUNG` für den echten Host.**
- Eingang A, das Anschreiben: `subagents.prompt` auf der Dienstinstanz ersetzen (M4: mit Haken `ok`, ohne Haken `parent-unavailable`).
- Eingang B, das Öffnen: der Client ruft beim Öffnen eines Kindes `session.follow` und `session.page` mit der Adresse `{kind:"subagent", parentSessionId, childSessionId, mode}` (Quelltext `dsh-api-session-controller/lib/client.js` Zeilen 428 und 468, gelesen). Eine Umwicklung von `sessionController.page` wurde vom Gateway tatsächlich durchlaufen (M6); `follow` direkt am Dienst (M7, Gateway-Strom ungemessen).
- Der Ladeweg: `ctx.typert.lookups.get("agent").resolve(elternId)`; das ist die Funktion `resolve()` des Controllers (`dsh-api-session-controller/lib/index.js` Zeilen 208 bis 230, Dedup über `this.resumes`), also die Lade-Funktion, die der Kern für `session.prompt` selbst benutzt (Zielbrief, Gegenstand letzter Punkt).
*Prüfen:* `ergebnis_oeffnen.json` Felder `seiteOhneHaken` → `elternLebtNachSeiteOhneHaken: false`, `seiteMitHaken` → `elternLebtNachSeiteMitHaken: true`. Einschränkung: Dass der **echte Host** (dsh web mit Verbindung) die ersetzte Methode ebenfalls durchläuft, ist ungemessen (die Probe hat den echten Gateway-Code, aber keinen Webserver); Etikett `SCHÄTZUNG` für diesen Unterschied.

**5 — Der Client entsperrt das Eingabefeld von selbst, sobald der Elternteil geladen ist, und eine reine Host-Lösung genügt. `SCHÄTZUNG` (Quelltext gelesen; Host-Teil `MESSUNG`).** Gemessen (M5): Beim Laden sendet der Host zweimal `api-session/added` mit `agentAvailable: true` (binnen 3 ms), und `session.list` zeigt danach `true` statt `false`. Aus dem Quelltext des Clients: `handleSessionAdded` ruft `updateParentAvailability` (`client.js` um 2760 bis 2765), das `handleSubagentParentAvailable(true)` am geöffneten Kind aufruft (Zeilen 1985 bis 1992); das Eingabefeld sperrt nur bei `parentAvailable !== true` (`dsh-client-ui-conversation/lib/client.js` Zeile 17288). **Der Client-Teil des Plans ist darum leer, solange der Browser-Test (Abnahme 7) bestätigt, dass das Feld entsperrt.** *Prüfen:* Quelltext an den genannten Zeilen, dann Abnahme 7.

**6 — Mehrere Kinder oder mehrere Aufrufe gleichzeitig laden den Elternteil nur einmal. `MESSUNG` (M11).** Zwei gleichzeitige Gateway-Prompts: der Haken lief zweimal, geladen wurde einmal (der Controller dedupliziert), beide `ok`. *Prüfen:* `ergebnis_parallel.json`, Felder `parallel`, `haken`.

**7 — Fehlerfälle brechen das Öffnen nicht. `MESSUNG` (M13, M14).** Defekte Elterndatei: der Haken fängt `gateway/internal` („corrupt Zstandard session …“), das Öffnen des Kindes liefert trotzdem den ersten Rahmen; das Anschreiben bleibt `parent-unavailable`. Elternteil ohne Datei: der Haken fängt `session/not-found`. *Prüfen:* `ergebnis_oeffnen2.json` Felder `hakenDefekt`, `defektFollow`, `hakenFremd`, `fremdFollow`.

**8 — Ist der kalte Elternteil selbst ein Kind, trägt der Weg nicht. `MESSUNG` (M12), Issue 177.** Der Lookup `agent` liefert `session/agent-busy` („is owned by subagent routing“). Direktes `ctx.agents.resume({parentAgent})` lädt, danach ist der Elternteil aber vom Großelter nicht mehr anschreibbar (`subagent/not-resumable`, „already owned by an active write handle“). Ein Weg über Kernänderung oder einen anderen Zugang zur Aktivierung wäre nötig. Das ist ein bewusst **ausgenommener** Fall des Patches, nicht verschleiert. *Prüfen:* `ergebnis_kette.json` Felder `mitteUeberLookup`, `mitteDirekt`, `gpTorMitte`.

## 4. Hier bin ich unsicher

- **Ob die Last beim Laden großer Lead-Sitzungen trägt.** Gewählt: im Hintergrund laden (M16: das Öffnen kehrt nach 37 ms zurück, der Elternteil ist 42 ms später da). Alternative: das Öffnen abwarten lassen; dann wartet der Mensch bei einer großen Sitzung. Ungemessen mit großen Sitzungen.
- **Ob beim Öffnen laden gewollt ist**, oder nur beim Anschreiben. Gewählt: **beide** (A und B), weil die Oberfläche das Eingabefeld sperrt, bevor ein Anschreiben überhaupt möglich wäre (Annahme 5). Alternative: nur A (Anschreiben) und die Sperre im Client entfernen; das ist ein Client-Teil und größer.
- **Die Umwicklung von `sessionController.page` statt `follow`.** Gewählt `page`, weil es in der Probe gemessen ist und beim Öffnen immer gelesen wird; `follow` ist nur am Dienst gemessen. Alternative: beide umwickeln. Ich empfehle beide (billig, jeweils der gleiche Haken).
- **Der Notschalter** (Abschnitt 6), und ob der Patch auch außerhalb des Team-Modus gilt (Abschnitt 8, O1/O2): Entscheidungen des Menschen, hier nur Vorschlag.
- **Ob der Patch das Verhalten für den Lead selbst verändert.** Nicht gemessen: Wirkung auf Fälle, in denen jemand absichtlich einen Elternteil kalt lässt (Archiv, `archived-session-gate`): der Kern lässt ein archiviertes Elternteil-Laden vermutlich zu, aber nicht laufen; ungemessen.

## 5. Schritte (kein Schritt enthält Code)

**Schritt 1 — Entscheidungen des Menschen (Abschnitt 8) abwarten.** Ohne sie wird nicht gebaut.

**Schritt 2 — Neue Datei `patches/eltern-laden.mjs`.** Eigener Cordis-Patch im Stil der vorhandenen Dateien in `patches/` (Muster: `team-modus.mjs`, Kopfkommentar mit Zweck, Notschalter, Protokoll; Protokolldatei `~/.dsh/.tm/teams-plus/logs/eltern-laden.log`). **Nicht in `team-modus.mjs` mischen** (Zielbrief (f); der Zweig `umsetzung/team-stand-unteragenten` ändert diese Datei). Eintrag in `cordis.patch.yml` des Pakets neben `team-modus`, Name `@tmielsch/dsh-teams-plus/patches/eltern-laden.mjs`; ein Rücknahmepunkt = diese Zeile streichen. Abhängigkeiten über `inject`: `agents`, `subagents`; `sessionController` und `typert` **weich** über `ctx.get` holen (Muster `hole()` in `team-modus.mjs` Zeile 775), weil das Profil ohne Web (Probe, headless) sie nicht hat; fehlt einer, meldet der Patch eine Zeile im Protokoll und tut für diesen Eingang nichts.

**Schritt 3 — Haken A (Anschreiben).** `subagents.prompt` auf der Dienstinstanz so umwickeln, dass vor dem Original geprüft wird: Ist `request.parentSessionId` kein lebender Agent (`ctx.agents.get`), wird über den Lookup `agent` geladen und **abgewartet**, dann läuft das Original. Fehler beim Laden werden gefangen, protokolliert, und das Original läuft trotzdem (es meldet dann seinen eigenen Fehler). Eine Wiederherstellung der ursprünglichen Methode beim Entladen des Patches (HMR) gehört dazu (`ctx.effect`).

**Schritt 4 — Haken B (Öffnen).** `sessionController.page` und `sessionController.follow` umwickeln: Hat die Anfrage eine Adresse der Art `kind: "subagent"` und ist der Elternteil kalt, wird der Elternteil **im Hintergrund** geladen (nicht abwarten, Messung M16), das Original läuft sofort. Eine Menge „im Flug“ verhindert doppeltes Laden (zusätzlich zur Dedup des Controllers, M11). Alle Fehler werden geschluckt und protokolliert.

**Schritt 5 — Ausnahmen im Haken, ohne Namen oder Kennungen einzelner Sitzungen.** Keine Liste einzelner Sitzungen; die Regel hängt nur an der Eigenschaft „Elternteil ist nicht lebend“ und am Fehlercode des Ladens. Ist der Elternteil selbst ein Kind (Herkunft `subagent` im Kopf der Elternsitzung; erkennbar am Fehler `session/agent-busy`), wird nicht geladen und eine Protokollzeile `eltern-ist-kind` geschrieben (Annahme 8).

**Schritt 6 — Tests** `test/eltern-laden.test.mjs`: reine Funktionen (Entscheidung „laden ja/nein“, Ausnahme für Kinder, Dedup) mit Attrappen; die Gegenprobe der Messung (vor dem Patch rot, nach dem Patch grün) ist Abnahme 1 bis 3 in der Probe.

**Schritt 7 — Anweisungsdatei** (`agents/teams-plus-agents.voll.md`, Zeile 181 „Außerhalb des Team-Modus ändert Teams Plus nichts“) **nur benennen, nicht ändern**: falls der Mensch in O1 „auch außerhalb des Team-Modus“ wählt, muss dieser Satz beim Einspielen geöffnet werden (Muster wie bei `team_stand`, Issue 143). Die Änderung gehört dem Lead beim Einspielen.

## 6. Risiken und Notschalter

- **Speicher und Sitzungssperre.** Jede geöffnete Kind-Sitzung lädt künftig ihren Elternteil. Ein geladener Agent hält seine Sitzungsdatei (`session.lock`) und Speicher. Bei Dutzenden geöffneten Kindern ist das spürbar (ungemessen, `SCHÄTZUNG`).
- **Antwort des Kindes weckt den Elternteil (M9).** Das ist heute schon so, solange der Elternteil lebt; neu ist nur, dass es jetzt auch dann eintritt, wenn der Mensch einen Elternteil „aufgeweckt“ hat, der vorher still lag: seine Zielrunde läuft dann (Quota-Verbrauch im Rahmen seines Ziels). Dieses Verhalten ist gewollt, nicht verhindert.
- **Zwei Besitzer des Kindes (Annahme 8).** Der Patch rührt die Aktivierung des Kindes nicht an.
- **Kernupdate.** Der Patch hängt an den Methodennamen `prompt`, `page`, `follow` und dem Lookup `agent`; ein Kern-Update, das sie umbenennt, macht den Haken wirkungslos. Der Patch prüft beim Start, ob alle drei Eingänge vorhanden sind, und meldet das im Protokoll (wie `team-modus.mjs` Zeilen 756 und 873 mit `abweichungen`).
- **Notschalter (Zielbrief (e)).** Vorschlag, zur Entscheidung (O2): ein eigener Schalter `~/.dsh/.tm/teams-plus/eltern-laden.json` mit `{"aus": true}`, gelesen bei jedem Aufruf (Muster `notschalterGedrueckt` in `team-modus.mjs` Zeile 152), der **nur** diesen Patch abschaltet. Die Begründung, getrennt vom Team-Modus-Schalter zu halten: Der Team-Modus-Schalter regelt Meldungsfilter; wer ihn drückt, will vielleicht trotzdem anschreiben können. Alternative: dieselbe Datei `team-modus.json` zusätzlich beachten.

## 7. Abnahme (je Ziel eine Messung mit Werkzeug und Sollwert)

Alle in der Probe `docs/messung-eltern-laden/probe-eltern.sh` mit dem **gebauten Patch** statt des im Treiber ersetzten Hakens (der Treiber wird dann umgestellt, der Patch geladen über das Overlay `probe.patch.yml`). Nach jedem Lauf Prozesszähler 0.

1. **Kind anschreiben bei kaltem Elternteil geht.** Szenario `tor` ohne Treiber-Haken. Sollwert: `torKalt.ok == true`, `messageId` vorhanden. Gegenprobe (macht diese Abnahme zu einer echten): dieselbe Probe **ohne** den Patch (Overlay-Eintrag weggelassen) muss `parent-unavailable` liefern; sie wird rot, wenn der Patch fehlt.
2. **Das Laden startet keine Runde, keinen Modellaufruf.** Szenarien `grund`, `neustart-b`: Zahl der Zeilen in `llm-aufrufe.log` unmittelbar nach dem Laden gleich der Zahl davor (Sollwert: Differenz 0, gemessen an der Attrappe, nicht am Plugin). Gilt die Messung als „bestanden“ auch bei falscher Konstruktion? Nein: die Attrappe zählt auch Lead-Züge ohne Text (leere Zeile).
3. **Ein aktives Ziel des Elternteils wird nicht scharf.** Szenario `neustart-b`: nach dem Laden `activation == "disarmed"`, `roundsStarted` unverändert, 5 Messpunkte `llmEltern == 0`.
4. **Das Öffnen eines Kindes lädt den Elternteil im Hintergrund.** Szenario `oeffnen3`: `session.page` kehrt in unter 200 ms zurück, binnen 1 s `ctx.agents.get(elternId) !== undefined`, `agentAvailable: true` im Ereignis. Gegenprobe: ohne Patch bleibt der Elternteil kalt (`oeffnen` ohne Haken).
5. **Mehrere gleichzeitig.** Szenario `parallel`: beide `ok`, ein Laden.
6. **Fehlerfälle brechen nichts.** Szenario `oeffnen2`: Öffnen liefert den ersten Rahmen auch bei defekter oder fehlender Elterndatei.
7. **Browser (nicht in der Probe machbar).** Nach dem Einspielen: der Mensch (oder ein Lead mit `blick`) öffnet ein Kind eines kalten Elternteils im echten `dsh web`; Sollwert: kein Text „Parent session offline“, Eingabefeld frei, Nachricht kommt an. **Ohne diesen Test ist die Aussage „die Sperre ist gelöst“ nicht belegt** (Annahme 5 ist nur Quelltext).
8. **Notschalter.** `eltern-laden.json` mit `{"aus": true}`: Szenario `tor` liefert wieder `parent-unavailable`, Datei löschen, es geht wieder.
9. **Kette bleibt, wie sie ist.** Szenario `kette`: kein Absturz, Protokollzeile `eltern-ist-kind`, Verhalten wie heute.

Formeln und Schätzungen stehen nicht in dieser Abnahme.

## 8. Offene Fragen an den Menschen (Wirkung zuerst)

**O1 — Soll das Laden auch gelten, wenn der Team-Modus aus ist?** Ohne diese Entscheidung weiß ich nicht, ob der Patch für jeden Unteragenten (also auch die Facharbeiter, die ein Experte mit `delegate_task` startet, und die Unteragenten außerhalb jedes Teams) oder nur für Mitglieder eines Teams wirkt. Heute steht in der Teams-Plus-Anweisung (`agents/teams-plus-agents.voll.md` Zeile 181): „Außerhalb des Team-Modus ändert Teams Plus nichts.“ Du hast gesagt „jederzeit“; das spricht für überall, und das Anzeigen von Unteragenten hast du für `team_stand` schon ausdrücklich geöffnet (Issue 143). **Empfehlung: überall**, dann muss beim Einspielen jener eine Satz geöffnet werden.

**O2 — Welcher Notschalter?** Wenn etwas schiefgeht: soll ein eigener Schalter nur dieses Laden abschalten (Empfehlung, Datei `eltern-laden.json` mit `{"aus": true}`), oder soll der bekannte Schalter des Team-Modus (`team-modus.json`) dieses Laden mit abschalten? Der Unterschied: im zweiten Fall verliert man mit einem Handgriff auch das Anschreiben, im ersten bleibt es getrennt.

**O3 — Fall „Elternteil ist selbst ein Kind“ (Lead → Experte → Facharbeiter, Experte kalt).** Heute lässt sich der Facharbeiter dann nicht anschreiben, und mit den öffentlichen Mitteln des Kerns ist das nicht lösbar (Issue 177 mit Messung). Soll dieser Fall (a) vorerst bleiben, wie er ist (Empfehlung: der Plan ist sonst nicht gestoppt, und der Normalfall „Lead kalt, Experte lebt“ ist gelöst), oder (b) soll eine Kernänderung geplant werden (eine Zeile am Verteiler der Aktivierung, die ein Plugin nicht erreicht)? Bei (b) braucht es einen eigenen Plan und die Ablehnung der Regel „kein Kerneingriff“.

**O4 — Soll das Öffnen eines Kindes schon genügen, damit der Elternteil geladen wird?** Der Preis: schon das bloße Ansehen eines Kindes lädt dessen Elternteil in den Speicher (er läuft nicht, aber er liegt da). Der Nutzen: das Eingabefeld ist frei, sobald du das Kind aufmachst. **Empfehlung: ja**; ohne das bleibt die Oberfläche gesperrt, bevor du schreiben kannst.

## 9. Grenzen für den späteren Bau-Worker

Dem Worker gehören: `patches/eltern-laden.mjs`, `test/eltern-laden.test.mjs`, der eine Eintrag in `cordis.patch.yml` und die Dateien unter `docs/messung-eltern-laden/` (Treiber umstellen). Er ändert **nicht**: `patches/team-modus.mjs`; keine Anweisungsdatei (auch Zeile 181 nicht, das tut der Lead beim Einspielen); kein Kernpaket unter `/opt/homebrew/...`; kein Profil unter `~/.dsh/profiles/`; kein Neustart und kein Stoppen irgendeines Dienstes (insbesondere `dsh web` auf Port 3080); keine Szenendateien. Er beendet nur Prozesse, deren PID er selbst in `docs/messung-eltern-laden/probe-eltern.pid` festgehalten hat (`probe-eltern.sh --beende`). Zugangsdaten nie anzeigen, auch nicht maskiert. Jeden neuen Fund sofort als Issue in `tmielsch/DSH-Verwaltung` mit Art-Label und `triage`. Kein Push, kein Merge; die Abnahme und das Einspielen tut der Lead.
