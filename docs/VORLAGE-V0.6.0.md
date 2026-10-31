# Freigabevorlage v0.6.0 — `send_to_session`

Stand: 2026-10-31, 05:30 (Europe/Berlin). **Nicht eingebaut**, nur im Repo.
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
| **M1** Lost Update über zwei Zustands-Halter | MITTEL | **offen** — im einen Prozess nicht möglich, über zwei Prozesse ja. Braucht Lock oder Read-Merge |
| **M2** Titelsuche ist tot (`Session` hat kein `title`) | MITTEL | **behoben** — Zielsuche über Kennung, Kennungs-Präfix und `session.header.cwd` |
| **M3** Protokolle liegen außerhalb des E1-Datenordners | MITTEL | **behoben für dieses Modul** — `~/.dsh/.tm/teams-plus/logs/`; `stille-nachrichten` bleibt offen |
| **M4** Wurzelsitzung nicht markiert/gesperrt | MITTEL | **behoben** — `followup` an eine Wurzel wird auf `steer` heruntergestuft und gemeldet |
| **N2** Testlauf schrieb ins echte `~/.dsh/logs` | NIEDRIG | **behoben** — `DSH_HOME` zeigt im Test auf ein temporäres Verzeichnis; gemessen: Zuwachs 0 Bytes |
| **N3** `--test`-Selbstprüfung war versprochen und existierte nicht | NIEDRIG | **behoben** — Kopf nennt jetzt den echten Prüfweg |

## Die Entscheidung, die im Code steckt: Sprunghöhe gestrichen

v0.5.0 hatte einen Kettenzähler mit Sprunghöhe (4) und Rundläufen je Kette. Das Red Team hat
gemessen, dass beides gleichzeitig falsch positiv und falsch negativ war, weil eine „Kette" über
einen einzigen `ketteVon`-Slot je Sitzung lief.

**Die Sprunghöhe ist nicht repariert, sondern gestrichen.** Eine echte Tiefe braucht die Abstammung
der Nachricht, und die sieht dieses Werkzeug nicht — es bekommt beim Senden keinen eingehenden
Nachrichtenkopf. Eine Zahl, die niemand messen kann, ist keine Grenze, sondern ein Versprechen.
Was bleibt, ist das, was sich **je geordnetem Paar exakt zählen lässt**. Gegenrichtung `A→B` und
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

## Offene Auflagen vor dem Einbau

1. **H3:** Die gesperrte v0.4.0 läuft. Entweder v0.6.0 einbauen (nach diesem Pass) oder die Zeile
   entfernen. Der jetzige Zustand ist der schlechteste von beiden.
2. **M1:** Lost Update über zwei Prozesse — Lock oder Read-Merge.
3. **H2:** Die Zustandsdatei ist keine Sicherheitsgrenze. Entweder in einen geschützten Store legen
   oder im Kopf ausdrücklich als Höflichkeitsbremse führen (letzteres ist getan).
4. **M3:** `stille-nachrichten.mjs` schreibt weiter nach `~/.dsh/logs/`. Derselbe Umzug fehlt dort.
5. **M5:** Die Kaskaden-Regel steht beim Teammitglied zweimal im Modell-Input (Spawn-Prompt **und**
   System-Sektion). Token-Verschwendung, kein Fehler.
