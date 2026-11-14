# Erwartung zum Kern-Patch "Kind gehoert auch dem Menschen" (2026-11-14)

Zielbrief: docs/ZIELBRIEF-KERN-KIND-BESITZ-2026-11-14.md (Issue DSH-Verwaltung 175, Unteragenten wecken ohne Elternteil; Issue 177, Eltern-laden scheitert bei Kette). Stand: NUR GELESEN (Kern 0.2.0-rc.2, /opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/), noch nichts gebaut, noch nichts gemessen. Zeilennummern gegen den Quelltext geprueft.

## Was der Kern heute tut (gelesen)

Weg des Menschen im Browser: `dsh-api-session-controller/lib/client.js` 1722-1745 ruft `subagents.prompt({parentSessionId, childSessionId, ...})`.
1. `dsh-subagent/lib/index.js` `prompt()` ab 3011: `parent = agents.get(parentSessionId)`; ist er nicht lebendig, wird SOFORT `subagent/parent-unavailable` geworfen (3016).
2. Danach `queuePrompt` -> `deliverToChild(parent, ...)` -> `deliverFollowup` -> bei kaltem Kind `coldResume(parent, ...)` (1898). Dort: `authorizeLineage` (957) verlangt den EXAKT lebenden Elternteil; `materialize` (960) braucht den Elternteil fuer Zugangssperre (`assertAdmitting`), Ahnenreihe (`liveLineage`), Platzpool, `agents.resume({parentAgent: parent})` (1076), `applyChildComposition` (510: das Kind tritt der Voreinstellung des Elternteils bei, `parent.ctx`), `acquireOwnership`.
3. Abschlussmeldung: `notifySettlement` (1249): `agents.get(activation.parentSession)` ist undefined -> `return` ohne Zeile, ohne Journal, ohne Warnung. `sendToParent` (Kind schreibt selbst an den Elternteil) wirft `PARENT_UNAVAILABLE`.
4. Browser: `dsh-client-ui-conversation/lib/client.js` 17288 `parentOffline = continuable && subagent.parentAvailable !== true`, 17289 `disabled = ... || parentOffline`; `dsh-client-ui-subagent/lib/client.js` 934 (`parentAvailable !== false -> null`, sonst Schreibschutz-Karte, Text 916). `parentAvailable` kommt aus `agentAvailable` der ELTERN-Zusammenfassung (`dsh-api-session-controller/lib/client.js` 2477, 2589).
5. Das Team-Paket (`dsh-experimental-agent-team/lib/index.js` `tryMembership` 396-440): ist der Elternteil weder lebendig noch als Sitzung angehaengt, liefert `tryMembership` fuer ein Kind `undefined` (es hat einen Unteragenten-Beschreiber). Ein ohne Lead geweckter Teammitglied-Agent waere fuer das Team also ein Nicht-Mitglied.

## Geplante Aenderung (kleinste, die ich sehe)

Alle in der KOPIE, mit `--root`, nie in der Installation.

A. `dsh-subagent/lib/index.js`, ERSETZUNG "kind-menschenweg":
   - `prompt()`: der Wurf `parent-unavailable` (3016) entfaellt; ist `parent` undefined, geht die Zustellung an eine neue Methode des Fortsetzungs-Verwalters (`menschenPrompt`) statt an `deliverSubagentPrompt`.
   - `menschenPrompt` (neu, ca. 30 Zeilen): unter der Kind-Sperre; lebendes Kind -> direkt einreichen; kaltes Kind -> wie `coldResume`, aber `parent = undefined`; die Elternadresse aus der Anfrage muss mit `header.parentSession` des Kindes uebereinstimmen (sonst `UNAUTHORIZED`, wie heute).
   - `materialize`/`materializeTracked`/`submitAdmitted`/`acquireOwnership`/`applyChildComposition`: je eine Schutzzeile fuer `parent === undefined` (Ahnenreihe leer, eigener Pool, kein `parentAgent`, Voreinstellung aus dem Kopf des Kindes statt `composeFrom`).
B. `dsh-client-ui-conversation/lib/client.js` 17288, ERSETZUNG "kind-feld-frei": `parentOffline` wird `false` (die Sperre hing am Elternteil; der Mensch ist jetzt Eigentuemer, der Server entscheidet).
C. `dsh-client-ui-subagent/lib/client.js` 934, ERSETZUNG "kind-karte-weg": `selectReadOnlySubagent` meldet bei fortsetzbarem Kind nicht mehr "parent-unavailable".
   Kein `agentAvailable true` fuer einen toten Agenten, keine Aenderung der Host-Zusammenfassung.

Schaetzung `SCHAETZUNG`: Kernzeilen A ca. 55-65, B+C je 1-3; 3 Kerndateien (genau die Grenze), ca. 60-70 Zeilen (an der Grenze von "etwa 60").

## Was nach dem Patch passieren soll (Erwartung)

- (a) Kind direkt unter dem Lead, Lead kalt: `subagents.prompt` gelingt, Kind lebt, Lead bleibt kalt (0 Zuege des Leads), Modellaufrufe nur die des Kindes.
- (b) Enkel, Lead und Zwischenkind kalt: dasselbe, nur der Enkel lebt.
- (c) Abschlussmeldung des Kindes bei kaltem Elternteil: `notifySettlement` kehrt still zurueck (Quelltext, 1249-1262) -> die Meldung ist VERLOREN, ohne Fehler. Sie steht nur im eigenen Journal des Kindes. Wird der Elternteil spaeter geladen, kommt nichts nach. **Das ist nach Zielbrief "Anhalten und fragen" (ii).**
- (d) Wartender Zustand (Issue 181): Das Kind hat keine eigene Team-Warteschlange. Wartende Team-Nachrichten stehen im Journal des LEADS. Beim Wecken eines Teammitglieds ohne Lead sieht `tryMembership` kein Team (siehe 5.); `recoverFor` holt dann nichts. Erwartung: kein Wecken durch wartende Nachrichten, aber das Mitglied ist fuer das Team kein Mitglied mehr, solange der Lead nicht geladen ist.
- (e) Browser: Feld frei durch Ersetzung B; die Zusammenfassung bleibt `agentAvailable=false` fuer den Elternteil und `true` fuer das Kind, solange es lebt.
- `--revert` macht die Kopie byte-gleich zum Original.

## Was mich widerlegen wuerde

- Wenn `subagents.prompt` ohne lebenden Elternteil trotzdem `parent-unavailable` wirft: A greift nicht.
- Wenn nach dem Wecken in der Probe ein Elternteil oder Zwischenkind als lebend erscheint (`agent/created` fuer sie): dann hat irgendetwas doch geladen, der Zielbrief verlangt 0.
- Wenn das kalte Kind bei `parent = undefined` an `agents.resume` oder den Voreinstellungen scheitert: dann braucht A mehr als die Schutzzeilen.
- Wenn die Abschlussmeldung im Journal des Elternteils erscheint (ich erwarte: nirgends).

## Offene Entscheidung des Menschen (vor dem Bau)

Siehe Frage an den Lead: Abschlussmeldung bei kaltem Elternteil geht verloren; Wahl liegt beim Menschen.
