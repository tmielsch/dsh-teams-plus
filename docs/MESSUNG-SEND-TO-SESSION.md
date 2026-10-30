# Messung: Können Agenten an fremde Sitzungen senden?

Stand 2026-10-30, 23:05. Gemessen in der DSH-Installation
`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`.
Alle Zeilenangaben sind aus dieser Fassung, nicht aus der Erinnerung.

**Ergebnis: Ja, ohne Eingriff in die Installation.** Der Weg ist öffentlich und
dokumentiert. Die Annahme, dass ein Installations-Patch nötig sei, war falsch.

---

## 1. Die Sperre sitzt im Subagenten-Dienst, nicht im Werkzeug

`send_message` ist ein dünner Aufsatz. `dsh-tool-subagent-control/lib/index.js`
(95 Zeilen) ruft nur `ctx.subagents.sendMessage(sender, targetId, …)`.

Die Verweigerung steht in `dsh-subagent/lib/index.js:1762`:

```js
async sendMessage(sender, targetId, content, options) {
  if (this.ctx.agents.get(sender.id) !== sender) throw … "UNAUTHORIZED";
  this.activations.assertAdmitting(sender);
  const senderActivation = this.activations.get(sender.id);
  if (senderActivation !== void 0 && … senderActivation.parentSession === targetId) {
    return this.sendToParent(…);
  }
  if (sender.session.header.parentSession === targetId) throw new SubagentError(…, "UNAUTHORIZED");
  return this.deliverToChild(sender, targetId, …);   // ← holdOwnership(parent, childId)
}
```

Der Kommentar im Dienst sagt, wo die Zuständigkeit liegt: *„residency, cold resume,
and interrupt authorization belong to the subagent service"*. Ein Patch am Werkzeug
erreicht die Sperre also **nicht**.

## 2. Der freie Weg: der Agent selbst

`dsh-agent/lib/types/runtime-types.d.ts` Zeile 145 und 176 f.:

```ts
readonly inbox: Inbox;
send(message: UserMessage, target: InboxTarget, wakeup: boolean): void;
followup(message: UserMessage): void;   // "Queue an ordinary follow-up turn and wake the driver."
steer(message: UserMessage): void;      // "Submit steering for the nearest step."
```

**Diese Methoden prüfen keine Verwandtschaft.** Es sind die, die der Kern selbst
benutzt, wenn ein Mensch über die Oberfläche schreibt — belegt an drei Stellen:

- `dsh-api-session-controller/lib/index.js:902-903` — `if (request.mode === "steer") agent.steer(message); else agent.followup(message);`
- `dsh-command-goal/lib/index.js:100` — `invocation.agent.followup(createUserMessage({ content: […], source: { kind: "user" } }))`
- `dsh-cordis-host-runner/lib/index.js:2388` — `agent.steer(createUserMessage({ … }))`

## 3. An den Agenten einer beliebigen Sitzung kommt man heran

`dsh-agent/lib/index.js:594`:

```js
get(id) { return this.store.get(id)?.agent; }   // "the shared agent/session id"
list()  { return [...this.store.values()].map((entry) => entry.agent); }
```

Beides ist öffentlich und ohne Besitzprüfung. `isOwnedBy` existiert daneben, wird
aber nur dort benutzt, wo der Aufrufer sie selbst abfragt.

## 4. Wie eine Nachricht aussehen muss

`createUserMessage(input)` aus `@deepseek-ai/dsh-llm`, `lib/index.js:59`:

```js
createUserMessage({
  content: [{ type: "text", text: "…" }],
  source: { kind: "user" }
})
```

`MessageBase` (dsh-llm `lib/types/message.d.ts:124`) verlangt `content` und `source`;
`id` vergibt `createMessage`. Kein Sitzungsbezug, keine Kennung des Absenders nötig.

---

## 5. Was daraus folgt

Ein Werkzeug `send_to_session` kann so gebaut werden:

1. `ctx.agents.list()` oder `ctx.agents.get(sessionId)` — Ziel finden.
2. `createUserMessage({ content, source: { kind: "user" } })` — Nachricht bauen.
3. `ziel.followup(nachricht)` oder `ziel.steer(nachricht)` — zustellen.

**Kein Text-Eingriff in die Installation. Kein Umhüllen einer gebundenen Methode.
Kein Warten auf ein DSH-Update.**

## 6. Was dabei zu bedenken ist (und in den Bau gehört)

- **Der Absender verschwindet.** `source: { kind: "user" }` heißt: die Nachricht sieht
  aus, als hätte der Mensch sie geschrieben. Für eine Notiz zwischen Agenten ist das
  falsch und gefährlich. Zu prüfen ist, ob `MessageSourceMap` eine passende Art hat
  (der `goal-await`-Patch kennt `source.kind === "goal"`); sonst muss die Herkunft im
  Text stehen, sichtbar und unübersehbar.
- **`followup` startet einen Zug**, `steer` schiebt in den nächsten Schritt. `followup`
  auf eine **laufende** Sitzung legt eine neue Runde an — das ist die Unterbrechung,
  die der Mensch nicht ständig will. Voreinstellung sollte `steer` sein, `followup`
  ausdrücklich.
- **Kein Weckruf ohne Grenze.** Ohne Bremse können sich zwei Sitzungen gegenseitig
  aufwecken. Der Bau braucht eine Obergrenze je Zeitfenster und eine Prüfung, dass
  keine Nachricht an sich selbst geht.
- **Tote Sitzungen.** `agents.get()` findet nur **lebende** Agenten. Eine schlafende
  Sitzung braucht `resume`; das ist ein anderer Weg und gehört nicht in den ersten Wurf.

## 7. Die drei Sitzungen, die `send_message` definieren

| Datei | Rolle |
|---|---|
| `dsh-tool-subagent-control/lib/index.js` | das globale Werkzeug (95 Zeilen) |
| `dsh-experimental-tool-agent-team/lib/index.js` | Team-Variante mit `quiet` und `agent_id` |
| `dsh-subagent/lib/index.js` | der Dienst dahinter — **hier sitzt die Sperre** |
