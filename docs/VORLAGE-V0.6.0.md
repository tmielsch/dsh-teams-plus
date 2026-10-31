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
schreiben zwei Prozesse dieselbe Datei. M1 ist damit heute **theoretisch** und morgen **echt** —
eine Auflage, kein Blocker.

## Offene Auflagen vor dem Einbau

1. **H3:** Die gesperrte v0.4.0 läuft. Entweder v0.6.0 einbauen (nach diesem Pass) oder die Zeile
   entfernen. Der jetzige Zustand ist der schlechteste von beiden.
   Die beiden Wege stehen fertig in `docs/EINBAU-UND-RUECKNAHME.md`.
2. **M1:** Lost Update über zwei Prozesse — Lock oder Read-Merge. Schwere gemessen: nur **ein**
   Prozess lädt das Paket, der Pfad ist aber nicht profilgetrennt. Heute theoretisch.
3. **H2:** Die Zustandsdatei ist keine Sicherheitsgrenze. Entweder in einen geschützten Store legen
   oder im Kopf ausdrücklich als Höflichkeitsbremse führen (letzteres ist getan).
4. ~~**M3:** `stille-nachrichten.mjs` schreibt nach `~/.dsh/logs/`.~~ **erledigt** in `cb5c7db`:
   jetzt `~/.dsh/.tm/teams-plus/logs/`, samt `mkdirSync` — ohne den hätte der Umzug das Protokoll
   still verschluckt.
5. ~~**M5:** Die Kaskaden-Regel steht zweimal im Modell-Input.~~ **erledigt** in `cb5c7db`: der
   Spawn-Anhang ist entfernt, die System-Sektion trägt sie allein. Gemessen: 25 Agenten → 20
   Protokollzeilen + 1 Summenzeile nach 1,3 s Ruhe (vorher ging die Summe bei Ruhe verloren, N1).

