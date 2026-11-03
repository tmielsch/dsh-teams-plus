# MESSUNG — Der Aufgaben-Wecker weckt nicht

Stand: 2026-11-03, 02:25 Uhr. Gemessen an der laufenden Installation, nicht am Quelltext.

## Das Ergebnis in einem Satz

Der Patch `patches/goal-await.mjs` hört auf `session/event` und soll ein wartendes
Ziel wecken, sobald eine Team-Aufgabe auf `completed` geht. **Er weckt nicht.**
Zwei unabhängige Live-Versuche, beide mit derselben Ursache: das Ereignis erreicht
den Horcher nicht.

## Woran es nicht liegt

Diese Punkte sind gemessen und ausgeschlossen:

1. **Die Ereignisse existieren.** Im Journal der Lead-Sitzung liegen sie, drei
   Schritte je Aufgabe, mit `task.id`, `task.ownerId`, `task.status` und `teamId`:

   ```
   1793668605052  rev 1  pending      task-14
   1793668674759  rev 2  in_progress  task-14
   1793668676618  rev 3  completed    task-14

   1793669081053  rev 1  pending      task-15
   1793669388980  rev 2  in_progress  task-15
   1793669390218  rev 3  completed    task-15
   ```

2. **Die Sitzungs-Kennung stimmt.** `teamId` im Ereignis ist
   `session-e40fe6ab-341d-4d8f-829b-216c6eaf57cc` — genau die Sitzung, auf der der
   Horcher registriert ist, und genau die Sitzung, deren Agent (die Team-Wurzel)
   gewartet hat.

3. **Der Zeitpunkt war innerhalb der Frist.** Bei task-15: Wartebeginn 02:19:00,
   Aufgabe fertig 02:19:50 (50 s), Frist 300 s. Der Eingang war also da, lange
   bevor die Frist ablief.

4. **Der Patch ist geladen.** Die Logzeile `warten ... frist=300s` zeigt, dass
   `await_goal_dependency` im laufenden Prozess die neue Fassung benutzt. Der
   Prozess wurde 02:15:55 gestartet, die Änderung war 17:33:51 vom Vortag — die
   Fassung mit dem Aufgaben-Horcher ist also im Betrieb.

## Die beiden Versuche und warum der erste verunreinigt war

**Versuch 1 (task-14).** Ein Teammitglied schloss die Aufgabe ab und beendete
seinen Zug. Der Lead wurde geweckt — aber das Protokoll zeigt den falschen Weg:

```
2026-11-03T01:18:01.552Z wecken ... grund=nachricht gewartet=69s
```

`grund=nachricht`, nicht `grund=aufgabe`. Was weckte, war der Abschluss-Bericht
des Teammitglieds: Jedes Teammitglied, das seinen Zug beendet, erzeugt eine
Meldung **ohne Absender** (Quelle `undefined`), und `abgesendetVon` lässt alles
ohne Absender durch — das ist die gewollte Rückwärtsverträglichkeit für
Nachrichten des Menschen. Der Test hat damit seinen eigenen Gegenstand zerstört.

**Versuch 2 (task-15).** Derselbe Ablauf, aber der Teammate hielt seinen Zug
danach mit `sleep 600` offen. Damit konnte keine Abschluss-Meldung entstehen.
Ergebnis:

```
2026-11-03T01:24:00.194Z wecken ... grund=frist gewartet=300s
```

`grund=frist` — geweckt hat ausschließlich die Frist. Kein einziges
`grund=aufgabe` steht im Protokoll, in keinem der beiden Versuche.

## Was der Quelltext sagt und was daraus folgt

`@deepseek-ai/dsh-session/lib/index.js`, `append` um Zeile 1460: Ereignisse
erreichen einen Horcher nur, wenn er in `entry.emitCtx` hängt:

```js
const callbackArgs = [this, event];
if (entry !== void 0) callbacks = collectSessionCallbacks(entry.emitCtx, [
    entry.carrier,
    "session/event",
    ...callbackArgs
]);
```

`entry` steht für den laufenden Zug **dieser** Sitzung. Ein Plugin-Horcher, der
über `ctx.on("session/event", …)` registriert wird, hängt am Kontext des
**Plugins**, nicht am `emitCtx` der Sitzung, deren Ereignis gerade geschrieben
wird. Das ist die plausibelste Erklärung und sie deckt sich mit dem Befund, dass
die Registrierung im selben Prozess erfolgreich war (das Werkzeug ist da, die
Frist läuft) und trotzdem nichts ankommt.

**Ausdrücklich nicht bewiesen:** Ich habe die Kette nicht im laufenden System
verfolgt (kein Debugger am DSH-Prozess). Der Satz „das Ereignis erreicht den
Plugin-Kontext nicht" ist eine Schlussfolgerung aus dem Code plus dem
Messbefund, keine direkte Beobachtung. Die Gegenprobe fehlt noch.

## Der Verdacht, der als erster zu prüfen ist

Das Team-Plugin selbst benutzt denselben Weg und **bekommt** Ereignisse:

```js
// dsh-experimental-agent-team/lib/index.js:1840
ctx.on("session/event", (session, event) => {
    this.mailbox.observeSessionEvent(session, event);
});
```

Es unterscheidet sich in einem Punkt: Es wird **im Rumpf von `apply()`**
registriert, unser Patch dagegen in einer asynchronen Selbstausführung
(`void (async () => { … })()`), die erst nach einem `await` zum Registrieren
kommt (Z. 435–457: das Werkzeug wird erst nach einem dynamischen Import
registriert). Wenn der Horcher damit an einem anderen Kontext hängt als der
Plugin-Kontext, den das Team-Plugin benutzt, ist das die Ursache.

**Der nächste Schritt ist deshalb klein und billig:** den `session/event`-Horcher
aus der asynchronen Selbstausführung herausnehmen und direkt in `apply()`
registrieren, dann denselben Test wiederholen. Wenn das grün wird, ist die
Ursache gefunden; wenn nicht, ist die Hypothese widerlegt und muss durch eine
Messung im Prozess ersetzt werden.

## Was dieser Befund für den Plan bedeutet

Bis dahin gilt: **Der Aufgaben-Wecker ist nicht benutzbar.** Wer
`await_goal_dependency` heute mit einer Aufgabenwartezeit benutzt, bekommt nur
die Frist — also genau das, was der Patch eigentlich verhindern sollte. Es ist
kein Rückschritt gegenüber dem Zustand davor (dort weckte jede Nachricht), aber
es ist auch kein Fortschritt für den Fall „Aufgabe fertig, Lead schläft".

Die Modultests (13 Fälle, drei Gegenproben) sind davon **nicht** betroffen: Sie
prüfen die Logik gegen einen nachgebauten Cordis-Kontext. Sie sagen nichts
darüber, ob ein echtes `session/event` diesen Kontext erreicht — genau die Lücke,
die hier aufgefallen ist, und der Grund, warum der Live-Lauf gemacht wurde.

## Nachtrag: eine Falle im Messaufbau (03.11., 02:35)

Der Teilnehmer des zweiten Versuchs hat beim Bericht einen Punkt genannt, der
den Aufbau erst wirksam gemacht hat und den ich beim nächsten Mal sonst wieder
übersehen hätte:

> „Danach den Zug 600 Sekunden offen gehalten (zweimal `sleep 300` im Vordergrund,
> damit keine Obergrenze den Schlaf in einen Hintergrundjob verschiebt und den Zug
> vorzeitig beendet). In dieser Zeit ging keine Nachricht an den Lead — das
> Team-Ereignis ‚Aufgabe abgeschlossen' war damit das einzige Signal, das ihn
> wecken konnte."

**Die Falle:** Ein einzelnes `sleep 600` wäre an der Obergrenze des Werkzeugs
gescheitert und in einen Hintergrundjob gewandert. Der Zug hätte sich beendet,
die Abschluss-Meldung ohne Absender wäre entstanden — und der Test wäre genau
dort verunreinigt gewesen, wo er sauber sein sollte. Zwei `sleep 300` umgehen das.

Für jeden künftigen Test dieser Art gilt deshalb: **Der Teilnehmer muss im Zug
bleiben, und zwar nachweislich.** Ein `sleep`, der in den Hintergrund rutscht,
beendet den Zug und erzeugt genau die Meldung, die man ausschließen will.

Damit ist der zweite Versuch auch von der Seite des Teilnehmers bestätigt: keine
Nachricht, kein Werkzeugfehler, keine private Notiz. Das einzige Signal war das
Team-Ereignis — und es hat nicht geweckt.
## Korrektur 03.11., 02:36 — die Hypothese war falsch

Im Abschnitt „Der Verdacht, der als erster zu prüfen ist" stand, unser Horcher
werde in einer asynchronen Selbstausführung registriert und hänge deshalb am
falschen Kontext. **Das ist widerlegt, und zwar am eigenen Code.**

`patches/goal-await.mjs`: Die asynchrone Selbstausführung (Zeile 653-663)
umschließt **nur** die Werkzeug-Registrierung (`ctx.tools.register`) mit ihrem
dynamischen Import. Die drei Horcher stehen **synchron daneben**, in derselben
`ctx.effect`-Funktion:

    ctx.effect(() => {
        ...  // Dienst anmelden
        (async () => { ...Werkzeug registrieren... })();   // asynchron
        const abInbox   = ctx.on("agent/inbox/inserted", ...);   // synchron
        const abAufgabe = ctx.on("session/event", ...);          // synchron
        const abWeg     = ctx.on("agent/disposed", ...);         // synchron
        return () => { ...alles abmelden... };
    }, "goal-await lifecycle");

Die Registrierung ist also nicht das Problem. Und der Nachrichten-Horcher auf
`agent/inbox/inserted` **funktioniert** — er hat in Versuch 1 nachweislich
geweckt (`grund=nachricht`). Dasselbe Registrierungsmuster trägt dort also.

**Damit ist die Ursache offen, nicht gefunden.** Der Unterschied zwischen den
beiden Horchern liegt nicht in der Registrierung, sondern im Ereignis selbst:
`agent/inbox/inserted` gegenüber `session/event`.

### Was als Nächstes gemessen wird, statt weiter zu raten

Ein Diagnose-Protokoll im Patch, das **jedes** ankommende `session/event`
mitschreibt (Typ und Zeitstempel), unabhängig von allen Filtern. Dann ein
Team-Ereignis auslösen und nachsehen:

- **Kommt gar nichts an** → der Plugin-Kontext sieht die Sitzungsereignisse nicht;
  der Weg über `session/event` ist für dieses Modul unbrauchbar und muss durch
  den Team-Dienst ersetzt werden.
- **Kommt etwas an, aber nicht `team/task`** → die Verteilung filtert bereits;
  dann ist der Weg über den Dienst (`waitForChange`) richtig.
- **Kommt `team/task` an** → der Fehler liegt in `istAufgabenWecker` oder in
  `gehoertZumTeam`, und ich prüfe dort weiter.

Das kostet einen Neustart, ist aber die einzige Messung, die die drei Fälle
trennt. Alle drei möglichen Ausgänge führen zu einer klaren Entscheidung.

### Der Ausweichweg, der ohne `session/event` auskommt

Der Team-Dienst bietet selbst, was gebraucht wird — ohne Ereignis-Verteilung:

    ctx.get("agentTeams").waitForChange(caller, timeoutMs, signal)

(`lib/index.js:1939-1942`). Grenzen: 10 s bis 1 h. Er weckt bei **jeder**
Änderung im Team — aber das ist hier kein Fehler mehr, denn der Patch kann
danach **selbst nachsehen**, welche Aufgabe fertig wurde:

    ctx.get("agentTeams").listTasks(caller)

Damit wird aus „weckt zu oft" ein „weckt und prüft": Der Patch wartet auf die
nächste Team-Änderung, liest die Aufgabenliste und weckt nur, wenn die erwartete
Aufgabe wirklich `completed` ist. Das ist derselbe Filter, nur ohne auf die
Verteilung von `session/event` angewiesen zu sein.

**Das ist der Weg, den ich für richtig halte**, wenn die Diagnose „kommt nichts an"
ergibt. Er benutzt ausschließlich dokumentierte Methoden des Dienstes und keine
Annahme über die Ereignis-Verteilung.