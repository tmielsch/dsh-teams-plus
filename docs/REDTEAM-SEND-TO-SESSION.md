# Red-Team: `send_to_session` (v0.4.0)

**Stand** 2026-10-30. Geprüft: Repo `/Users/tmielsch/dsh-teams-plus`, `main` @ `d8b6e99`, Release `v0.4.0`.
Gegenstand: `patches/send-to-session.mjs` (404 Zeilen), `test/send-to-session.test.mjs` (12 Tests),
`docs/MESSUNG-SEND-TO-SESSION.md`. Gemessen in
`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`.

Geprüft wurde **lesend** und in Kopien unter `/tmp/rt`: kein Einbau, kein Neustart, keine Änderung
unter `~/.dsh`, keine Änderung an `dsh-projectOS`, kein push, kein Release.

**Gesamturteil: NICHT EINBAUEN in der vorliegenden Form — ein STOPP.**
Der STOPP betrifft nicht den Weg über `agent.steer`/`followup` (der ist beabsichtigt, Punkt 2), sondern
die **Herkunft der Nachricht**: die gewählte `source.kind` erzeugt eine Nachricht, die der Kern als
**menschliche Anweisung** behandelt. Damit kann ein Agent einem anderen Ziel-Autorität unterschieben.

---

## 1) DIE DREI BEHAUPTUNGEN — **HÄLT** (alle drei bestätigt)

**1a. Die Sperre sitzt im Subagenten-Dienst, nicht im Werkzeug — bestätigt.**
`dsh-subagent/lib/index.js:1762` `async sendMessage(sender, targetId, content, options)` prüft zwei Dinge:

- `:1763` `if (this.ctx.agents.get(sender.id) !== sender) throw … "UNAUTHORIZED"` — der Absender muss
  der exakte lebende Agent sein.
- `:1770` `if (sender.session.header.parentSession === targetId) throw … "UNAUTHORIZED"` — und danach
  geht es über `deliverToChild` (`:1771`), das die Eltern-Kind-Linie verlangt.

Ein Umbau von `send_message` hätte diese Prüfung nicht erreicht. Die Aussage im Modulkopf
(`send-to-session.mjs:10–21`) stimmt.

**1b. `followup`/`steer` prüfen keine Verwandtschaft und sind öffentlich — bestätigt.**
`dsh-agent/lib/types/runtime-types.d.ts:192` `followup(message: UserMessage): void` und `:200`
`steer(message: UserMessage): void`. Beide ohne Besitz- oder Verwandtschaftsparameter. Die Zusagen im
Kommentar (`:189–200`) sind wörtlich: „Queue an ordinary follow-up turn and wake the driver" und
„Submit steering for the nearest step".

**1c. `ctx.agents.get()`/`list()` liefern jeden lebenden Agenten ohne Besitzprüfung — bestätigt.**
`dsh-agent/lib/index.js:594` `get(id) { return this.store.get(id)?.agent }` und `:612`
`list() { return [...this.store.values()].map((entry) => entry.agent) }`. Es gibt daneben `:606`
`isOwnedBy(id, owner)`, aber der wird hier nicht benutzt.

---

## 2) IST DER WEG BEABSICHTIGT? — **HÄLT, mit einer Einschränkung**

**Das Urteil: der Weg ist beabsichtigt.** Es gibt keine Schranke im Kern, die nur beim Aufruf vom Kern
aus greift. Der Beweis ist die vollständige Liste der Aufrufer von `.steer(`/`.followup(` — 30 Treffer
über 22 Pakete — und in **keinem** davon steht vor dem Aufruf eine Berechtigungsprüfung für das *Ziel*:

| Aufrufer | Belegstelle | was davor geprüft wird |
|---|---|---|
| Sitzungs-Oberfläche | `dsh-api-session-controller/lib/index.js:902–903` | die Sitzung, die der Mensch geöffnet hat |
| Warteschlangen-Aktion | `:1002` | `itemId` gehört zu dieser Sitzung |
| Ziel-Befehl | `dsh-command-goal/lib/index.js:100` | der eigene Agent |
| Host-Runner | `dsh-cordis-host-runner/lib/index.js:2388,2397,2410,2423` | eigener Agent aus `pending.agentId` |
| Ziel-Runden-Treiber | `dsh-goal-round-driver/lib/index.js:154` | eigener Agent |
| Team-Mailbox | `dsh-experimental-agent-team/lib/index.js:1028` | `root.steer` und `ctx.agents.get(target)` |
| Subagenten-Dienst | `dsh-subagent/lib/index.js:694,695,873,874` | **hier** ja: `authorizeLineage` |
| Hooks, Plan-Modus, Zeitplan, Webhook, Jobs, Fragen | `dsh-hooks-*/…`, `dsh-plan-mode:217`, `dsh-schedule:1596`, `dsh-webhook:184`, `dsh-tool-jobs:285,291`, `dsh-user-questions:582` | jeweils der eigene Agent |

Die einzige Stelle mit einer echten Ziel-Autorisierung ist `dsh-subagent/lib/index.js`: dort prüft
`authorizeLineage` (`:956–959`) den lebenden Elternteil **und** die Abstammung, und `assertAdmitting`
(`:945–949`) den Abbau-Zustand. Das ist genau die Schranke, die `send_message` benutzt und die
`send_to_session` **bewusst umgeht** — indem es nicht den Dienst, sondern die Agent-Methoden ruft.

**Die Einschränkung, und sie ist wichtig:** der Kern benutzt `agent.steer`/`followup` auf **fremde**
Agenten an genau einer Stelle — der Team-Mailbox (`dsh-experimental-agent-team/lib/index.js:1013`:
`this.ctx.agents.get(message.targetId)`). Und dort wird **nicht** `steer` allein benutzt: die Mailbox
hat eine eigene Zustell-Schicht mit `messageId`, `senderId`, `inFlightMessages`, `targetRecorded`,
`checkpointDelivered` (`:1000–1040`) und einer Nachrichten-Art `team-message` mit `senderId`
(`:1015–1021`). Sie liefert also **nicht** einfach in den Posteingang, sondern quittiert, protokolliert
und ordnet. `send_to_session` ruft die nackte Methode. Das ist kein Verbot, aber es ist der Unterschied
zwischen „der Kern tut das auch" und „der Kern tut dasselbe".

**Fazit:** der Weg ist technisch offen und der Kern benutzt ihn selbst für fremde Agenten — nur mit
eigener Buchführung. Vertretbar ist er deshalb, aber **nur mit einer Herkunft, die den Empfänger nicht
täuscht** — und das ist Punkt 3.

---

## 3) DIE HERKUNFT — **STOPP**

**Der STOPP: `source.kind: "agent-message"` ist keine neutrale Herkunft, sondern eine
Berechtigung — und der Lead erwägt genau diese Änderung.**

### 3a. Der Befund, der alles entscheidet

`dsh-tool-goal/lib/index.js:46–82` entscheidet, ob ein Agent ein **Ziel** anlegen, abschließen oder
blockieren darf. Die Funktion `hasDirectHumanInput` (`:49`) liest die Herkunft der Nachrichten im
laufenden Zug und liefert für zwei Arten `true`:

```js
if (quelle.kind === "user") return true;               // :78
if (istWurzel) return false;                            // :79
if (quelle.kind === "agent-message") return true;       // :80
return quelle.kind === "team-message" && elternSitzung !== undefined && quelle.senderId === elternSitzung;  // :81
```

Diese Funktion trägt **zwei** Berechtigungen (`:93–96` `requireDirectHuman`, `:103–111`
`completionAuthority`): das Anlegen und das Abschließen eines Ziels. Der Kommentar `:69–72` sagt
ausdrücklich, was `agent-message` dort bedeutet: „Der Sinn der ursprünglichen Sperre bleibt gewahrt:
`agent-message` erzeugt ausschließlich der Dienst subagents zwischen direkt benachbarten Sitzungen".

**Was das heißt.** Eine Nachricht mit `kind: "agent-message"`, `form: "relay"`,
`senderSessionId: <beliebig>` besteht die Migrationsprüfung
(`dsh-session-format-v2-to-v3/lib/index.js:126–133`) und wird von `hasDirectHumanInput` **als
menschliche Anweisung gezählt** — für jeden Nicht-Wurzel-Agenten. Ein Agent könnte damit einem anderen
Agenten die Berechtigung unterschieben, **ein Ziel anzulegen oder abzuschließen**.

**Der Unterschied zum heutigen Stand.** Mit `kind: "agent-send"` ist das *nicht* möglich: der Wert
steht in keiner der drei geprüften Arten, `hasDirectHumanInput` liefert `false`. Die derzeit
ausgelieferte Fassung ist an dieser Stelle **sicherer** als die vorgeschlagene Verbesserung.

### 3b. Was mit dem heutigen `agent-send` passiert (Punkt 3 des Auftrags)

- **Typtabelle:** `MessageSourceMap` (`dsh-llm/lib/types/message.d.ts:101–108`) kennt `user`,
  `model`, `tool`, `system-prompt`. Sie ist erweiterbar — 20 Pakete tun es
  (`declare module` … `interface MessageSourceMap`). Der Kern benutzt selbst `kind: "goal"`
  (`dsh-goal-round-driver/lib/index.js:137`) und `kind: "team-message"`
  (`dsh-experimental-agent-team/lib/index.js:1016`). Die Begründung des Leads stimmt.
- **Persistenz und Wiederaufbau: unproblematisch.** Sitzungen werden in **Format v4** geschrieben
  (`dsh-session/lib/types/types.js:54` `SESSION_FORMAT_VERSION = 4`). Die v4-Prüfung lässt unbekannte
  Arten ausdrücklich zu: `dsh-session-format-v3-to-v4/lib/index.js:123` — *„Native source admission
  preserves unknown attribution"* — und `:126` verlangt nur einen nicht-leeren `kind`, der nicht
  `plugin` ist. `createMessage` (`dsh-llm/lib/index.js:37–42`) prüft die Quelle überhaupt nicht.
- **Anzeige: unproblematisch.** Kein Client-Paket liest `source.kind` zum Rendern; die Herkunft steht
  im Text, und das tut sie (`send-to-session.mjs:178–186`).
- **Die harte Kante:** `dsh-session-format-v2-to-v3/lib/index.js:14–30` führt eine **geschlossene**
  Liste `SOURCE_KINDS` mit 16 Einträgen; `:125` wirft bei Unbekanntem
  `SessionFormatUnsupportedMigrationError("cannot safely transform unclassified message source")`.
  `agent-send` steht nicht darin. Eine Sitzung im Format v2 oder v3, die eine `agent-send`-Nachricht
  enthält, lässt sich **nicht** auf v4 migrieren. Heute nicht erreichbar (neu geschriebene Sitzungen
  sind v4), aber es ist eine Zeile, die man ändern müsste.

### 3c. Der richtige Weg — er ist keiner der beiden

`agent-message` ist die falsche Art (Berechtigung). `agent-send` ist die richtige Absicht mit einer
offenen Kante (geschlossene Migrationsliste). **Der saubere Weg ist, den Text des Kerns zu übernehmen und
die Herkunft aus der Berechtigungslogik herauszuhalten:** eine eigene Art, die *nicht* in
`hasDirectHumanInput` fällt, und sie in die Migrationsliste eintragen. Solange das nicht geschieht, ist
die sicherste Variante die **heutige**: `kind: "agent-send"` ohne Berechtigungswirkung.

**Der Text-Aufbau des Kerns ist trotzdem übernehmenswert.** `dsh-subagent/lib/index.js:588` schreibt
`\`Agent ${sender.id} sent a message: \`` als **eigenen Textblock vor** dem Inhalt. Das ist besser als
die Kopfzeile im selben Block (`send-to-session.mjs:184`): der Kern trennt Herkunft und Inhalt in zwei
Blöcke, was für den Zwischenspeicher und für die Lesbarkeit günstiger ist. Empfehlung: den Kern-Text
übernehmen, aber `source.kind` **nicht** auf `agent-message` setzen.

---

## 4) DIE BREMSE — **BEDENKLICH**

**Urteil: BEDENKLICH.** Sie zählt je **Absender**, nicht je Ziel, und sie lebt nur im Speicher.

- **Beleg:** `send-to-session.mjs:366` `zustellungen.get(absenderAgent.id) ?? []`, Zählung nach Erfolg
  in `:390–391`. `FENSTER_MS = 10 * 60 * 1000` und `HOECHSTENS_JE_FENSTER = 6` (`:89–90`).
- **Umgehbar durch mehrere Absender:** drei Sitzungen × 6 Zustellungen = **18 Nachrichten** an dieselbe
  vierte Sitzung in 10 Minuten, ohne dass eine der drei gebremst wird. Das ist die Lücke.
- **Nach einem Neustart:** `zustellungen` ist ein `new Map()` im Modulumfang von `apply`
  (`:245`) — ein DSH-Neustart setzt sie vollständig zurück. Wer den Neustart auslösen kann oder
  einfach wartet, hat wieder 6 Zustellungen.
- **Die Zählung sitzt an der richtigen Stelle:** nach erfolgreicher Zustellung (`:390`), nicht davor —
  eine fehlgeschlagene Zustellung verbraucht kein Kontingent. Das ist richtig.

---

## 5) DIE SELBSTSPERRE — **BEDENKLICH**

**Urteil: BEDENKLICH.** `zielId === absenderAgent.id` (`send-to-session.mjs:358`) hält nur den
Selbstbezug auf. A→B und B→A sind unbehindert und laufen gegen **zwei verschiedene** Zähler.

Eine Schleife ist damit real: A sendet an B mit `followup`, B wacht auf, antwortet an A mit
`followup`, A wacht auf. Je 6 Zustellungen in 10 Minuten ergibt das bis zu 12 Runden in 10 Minuten.
Die Bremse **verlangsamt** das, sie beendet es nicht. Es gibt keine Tiefen-, Ketten- oder
Absender-übergreifende Begrenzung.

**Zur Idee des Leads, einen Zähler je Absender-Ziel-PAAR zu führen:** das ist richtig und nötig, aber
**nicht ausreichend**. Ein Paar-Zähler bricht die Zwei-Sitzungen-Schleife; eine Dreier-Kette
A→B→C→A umgeht ihn, weil jedes Paar nur einmal zählt. Was zusätzlich nötig ist, ist eine **Kennzeichnung
der Tiefe**: eine Nachricht, die selbst als Reaktion auf eine Agenten-Nachricht entsteht, trägt eine
höhere Stufe, und ab einer festen Stufe wird abgelehnt. Technisch heißt das: beim Eintreffen prüfen, ob
der auslösende Zug eine `agent-send`-Nachricht enthielt, und deren Stufe um eins erhöhen.

---

## 6) DIE SITZUNG ENDET WÄHREND DER ZUSTELLUNG — **HÄLT**

**Urteil: HÄLT.** Kein Absturz, keine stille Nichtzustellung.

- `agents.get(zielId)` wird unmittelbar vor der Zustellung noch einmal aufgerufen
  (`send-to-session.mjs:361–362`); ist das Ziel weg, kommt `"the target session is not live"`.
- Der eigentliche Aufruf steht in `try/catch` (`:378–389`); ein Wurf wird zu
  `{ delivered: false, note: "delivery failed: …" }`.
- **Gegenprobe gefahren:** ein Ziel, dessen `steer`/`followup` `agent "b2" is disposed` wirft,
  ergibt `{"delivered":false,"note":"delivery failed: agent \"b2\" is disposed"}` — `execute`
  antwortet, es wirft nichts nach außen. Der Modulkopf verspricht das (`:231–233`), und es stimmt.
- Die Zählung läuft erst nach Erfolg (`:390`), ein Fehlschlag verbraucht also kein Kontingent.

---

## 7) DIE TESTS — **HÄLT**

**Urteil: HÄLT.** 12 Tests, 12 grün (`node --test test/send-to-session.test.mjs`). Fünf Mutationen in
einer Repo-Kopie (`git archive HEAD`), jede schlägt an:

| Mutation | gefallene Tests |
|---|---|
| Selbstsperre entfernt (`if (false)`) | 10 — „an sich selbst wird nie zugestellt" |
| Bremse entfernt (`if (false)`) | 12 — „die Bremse greift auch im Werkzeug" |
| Herkunftszeile aus dem Text entfernt | 1, 2, 8 |
| Quelle auf `kind: "user"` gefälscht | 3, 8 |
| `steer`/`followup` vertauscht | 8, 9 |

**Der Verdacht des Leads (Tests prüfen eine nachgebaute Form) trifft nicht zu.** Der nachgebaute
Kontext (`test/send-to-session.test.mjs:102–116`) gibt `defineTool` nicht vor, sondern lädt den echten
Baustein über `modul.apply(ctx)` (`:127–128`); die Tests laufen also durch das echte `defineTool`. Dass
`parameters` als JSON-Schema geprüft wird (`:136–140`), zeigt es: eine nachgebaute Form hätte das flache
Objekt zurückgegeben. Die Mutation „`steer`/`followup` vertauscht" fällt genau deshalb, weil
`ziel.steer`/`ziel.followup` wirklich gerufen werden.

**Eine Lücke bleibt:** kein Test prüft, dass die gewählte `source.kind` **keine** Berechtigungswirkung
hat. Test 3 prüft nur, dass sie nicht `"user"` ist (`:34–35`). Genau dort sitzt der STOPP aus Punkt 3 —
der Test hätte ihn nicht gefunden.

---

## 8) DIE GEFAHR IM BETRIEB — **BEDENKLICH**

**Urteil: BEDENKLICH.** Das Werkzeug erlaubt jedem Agenten, jede lebende Sitzung anzuschreiben, auch die
des Menschen. Die drei schlimmsten Fälle:

1. **Ein Agent schiebt einer fremden Sitzung eine Anweisung unter, die wie eine menschliche klingt.**
   Die Herkunft steht zwar im Text (`send-to-session.mjs:184`), aber sie ist **Text** — kein Feld, das
   die Oberfläche auswertet. Wer die Nachricht überfliegt, liest den Inhalt, nicht die Kopfzeile.
   Mit einer Herkunftsart, die der Kern als Berechtigung liest (Punkt 3), wird daraus mehr als eine
   Täuschung: eine **Rechteübertragung**.
2. **Zwei Sitzungen ziehen sich gegenseitig in Runden** (Punkt 5). Jede `followup`-Zustellung weckt die
   andere; mit je 6 in 10 Minuten läuft das Stunden, verbraucht Kontingent und produziert Nachrichten,
   die niemand liest. Für den Menschen sieht das aus wie „das System arbeitet".
3. **Ein Agent schreibt in die Sitzung des Menschen und stört eine laufende Arbeit.** Die Sitzung des
   Menschen ist ein normaler lebender Agent, also erreichbar. Eine `followup`-Nachricht dort startet
   eine neue Runde in genau der Sitzung, in der der Mensch gerade tippt.

**Was zusätzlich gelten müsste:** (a) eine Herkunft ohne Berechtigungswirkung — der Punkt-3-STOPP;
(b) ein Ziel-Zähler und ein Paar-Zähler (Punkte 4 und 5); (c) `followup` auf die Sitzung des Menschen
nur mit ausdrücklicher Erlaubnis; (d) die Sitzung des Menschen in der Liste der Ziele **kennzeichnen**,
damit ein Agent sie nicht versehentlich für eine Kollegin hält.

---

## Die acht Urteile in einer Zeile je Punkt

1. **Die drei Behauptungen — HÄLT.** Alle drei bestätigt: Sperre in `dsh-subagent/lib/index.js:1762`,
   `steer`/`followup` ohne Verwandtschaftsprüfung (`runtime-types.d.ts:192,200`), `agents.get/list`
   ohne Besitzprüfung (`dsh-agent/lib/index.js:594,612`).
2. **Ist der Weg beabsichtigt — HÄLT, mit Einschränkung.** Keine Schranke im Kern, die nur beim Aufruf
   vom Kern aus greift; 30 Aufrufstellen, keine prüft das Ziel. Aber der Kern benutzt ihn auf fremde
   Agenten nur mit eigener Buchführung (Team-Mailbox, `dsh-experimental-agent-team:1000–1040`).
3. **Die Herkunft — STOPP.** `kind: "agent-message"` wird von `hasDirectHumanInput`
   (`dsh-tool-goal/lib/index.js:80`) als menschliche Anweisung gezählt und überträgt damit
   Ziel-Autorität. Das heutige `agent-send` tut das nicht und ist an dieser Stelle sicherer.
4. **Die Bremse — BEDENKLICH.** Je Absender statt je Ziel, nur im Speicher; 3×6 = 18 an ein Ziel.
5. **Die Selbstsperre — BEDENKLICH.** A→B→A ist offen; ein Paar-Zähler allein reicht nicht, eine
   Tiefenstufe ist nötig.
6. **Das Leben — HÄLT.** Kein Absturz; gefangen, gemeldet, kein Kontingentverbrauch.
7. **Die Tests — HÄLT.** Fünf Mutationen, fünf Treffer; die Tests prüfen die echte Form. Eine Lücke:
   keine Prüfung der Berechtigungswirkung der Quelle.
8. **Die Gefahr im Betrieb — BEDENKLICH.** Drei benannte Fälle; vier zusätzliche Bedingungen.

---

## Darf es eingebaut werden?

**Nein — nicht in der vorliegenden Form, und die vom Lead erwogene Änderung auf
`kind: "agent-message"` macht es schlimmer, nicht besser.**

**Was vor einem Einbau geändert werden muss:**

1. **`source.kind` darf keine Berechtigung tragen.** `agent-message` ist gesperrt (Punkt 3).
   `agent-send` ist zulässig und heute die sichere Wahl; wer die Kante der geschlossenen
   Migrationsliste schließen will, trägt `agent-send` in
   `dsh-session-format-v2-to-v3/lib/index.js:14–30` ein — das ist ein Eingriff in die Installation und
   damit eine eigene Entscheidung. **Der Text** des Kerns (`Agent <id> sent a message: ` als eigener
   Block, `dsh-subagent/lib/index.js:588`) sollte übernommen werden.
2. **Einen Ziel-Zähler ergänzen** (`zustellungenAnZiel`), zusätzlich zum Absender-Zähler.
3. **Einen Paar-Zähler plus eine Tiefenstufe** ergänzen (Punkt 5), sonst bleibt die Kette offen.
4. **Einen Test ergänzen**, der festhält, dass die gewählte Quelle keine Berechtigungswirkung hat —
   die Lücke aus Punkt 7.

Mit diesen vier Änderungen ist der Weg vertretbar; der STOPP aus Punkt 3 ist die Bedingung.
