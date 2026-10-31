# Freigabevorlage v0.5.0 — `send_to_session`

Stand: 2026-10-31, 03:20 (Europe/Berlin). Vorlage für das Red Team. **Nicht eingebaut**, nur im Repo.
Vorgänger: `docs/STOPP-V0.4.0.md` (Sperre), `docs/REDTEAM-SEND-TO-SESSION.md` (Befund).

## Was in v0.4.0 gesperrt war, und was daraus geworden ist

| Befund des Red Teams (v0.4.0) | Stand in v0.5.0 |
|---|---|
| **B1** `source.kind` ist eine Berechtigung, nicht ein Etikett. Die naheliegende „Verbesserung" auf `agent-message` wäre eine Rechteübertragung. | **Behoben.** `kind: "plugin"` — steht in der geschlossenen `SOURCE_KINDS`-Liste und in **keinem** Zweig von `hasDirectHumanInput`. Öffnet also kein Ziel. Test: `die Quelle ist die dokumentierte Art 'plugin'`. |
| **B2** Die Bremse ist je **Absender**, nicht je **Ziel**; drei Sitzungen konnten je 6× an dieselbe vierte senden (18 Zustellungen). | **Behoben.** `bremsePruefe` prüft **beide** Fenster, je 6 in 10 Minuten. Test: `die Bremse gilt je Absender UND je Ziel` (3 Absender × 2 = 6, die siebte wird mit `grund: 'ziel'` abgewiesen). |
| **B3** Die Bremse liegt **nur im Speicher**; ein DSH-Neustart setzt sie vollständig zurück. | **Behoben.** Zustand in `~/.dsh/.tm/teams-plus/state/send-to-session.json`, atomar geschrieben (Nebendatei + `rename`). Test: `der Zustand ueberlebt einen Neustart`. |
| **B4** Kein Schutz gegen das Zutexten zu zweit (Ping-Pong). | **Behoben.** Kettenbudget mit drei Wächtern. Test: `Kette: ein Rundlaufbudget von zwei Nachrichten je geordnetem Paar`, `nach vier Weiterleitungen ist Schluss`, `wortgleiche Wiederholung`. |
| **B5** `agent-send` ist keine dokumentierte Quellart; der Formatprüfer kennt sie nicht. | **Behoben.** Siehe B1; zusätzlich `form: "relay"`, `senderSessionId`, `targetSessionId`. |

## Die drei Wächter im Kettenbudget

Nach dem Vorbild von `huxint/dsh-team` (MIT, `assertBudget`/`recordDelivery`) **neu geschrieben**, nicht kopiert:

| Befund | Wann | Grenze |
|---|---|---|
| `CHAIN_EXHAUSTED` | die Unterhaltung ist zu tief weitergeleitet | 4 Sprünge |
| `PING_PONG` | ein geordnetes Paar hat sein Budget aufgebraucht | 2 Nachrichten je Paar |
| `REPEATED_MESSAGE` | wortgleich dieselbe Nachricht an dasselbe Ziel | 1× |

**Was eine Kette ist.** Wer eine Nachricht bekommt, erbt die Unterhaltung eine Stufe tiefer; wer eine schickt, bleibt in seiner. So wird aus einer Weiterleitungskette **eine** begrenzte Unterhaltung. Das Kettenbuch vergisst nach 200 Unterhaltungen die ältesten, damit die Zustandsdatei nicht wächst.

## Was das Red Team besonders prüfen sollte

1. **Die Reihenfolge der Wächter.** `pruefeKette` fragt erst Hops, dann Rundläufe, dann Wortwiederholung. Ein Test hat gezeigt, dass die Wortwiederholung bei Budget 2 nie zum Zug kommt, wenn zwei verschiedene Texte geschickt wurden — das ist gewollt (das Budget ist die schärfere Grenze), aber es ist eine Festlegung, keine Notwendigkeit.
2. **`ketteFuer`-Zweig (b).** Beim ersten Testlauf fehlte er: jede Nachricht desselben Absenders begann eine neue Unterhaltung, und das Rundlaufbudget griff **nie**. Gefunden durch Test 21/22, nicht durch Nachdenken. Wer die Kette prüft, prüft bitte diesen Zweig zuerst.
3. **`auto` als Zustellart.** `agent.status` ist `'idle' | 'running'`. `auto` wählt `followup` bei `idle`, sonst `steer`. **Vorgabe bleibt `steer`** — die Typbeschreibung sagt, dass ein stiller Treiber auch durch `steer` eine Runde beginnt (`runtime-types.d.ts:194-195`). `auto` ist eine Wahl, keine stille Verhaltensänderung.
4. **Was NICHT geändert ist.** `send_message` bleibt unberührt. Kein Wecken schlafender Sitzungen. Kein Erzeugen von Sitzungen. Kein Eingriff in die Installation.

## Nachweis

```
$ node --test test/send-to-session.test.mjs
# tests 22   # pass 22   # fail 0

$ npm test                (ganzes Paket)
# pass 116   # fail 0
```

Die Tests sind **hermetisch**: jeder bekommt eine eigene Zustandsdatei unter `mkdtempSync`. Nach dem Lauf existiert `~/.dsh/.tm/teams-plus/state/` **nicht** — geprüft.

## Befund, der nicht diesen Patch betrifft, aber daneben liegt

`docs/STOPP-V0.4.0.md` behauptet: *„Das Werkzeug ist NICHT aktiv. Das Profil `web` lädt nur den Host-Eintrag `id: teams-plus`. `grep -c 'send-to-session' ~/.dsh/profiles/web/cordis.patch.yml` ergibt 0. Kein Schaden entstanden."*

**Gemessen am 2026-10-31, 02:55 ist das falsch.** Das Paket steht in `dsh.profile.bundles`, und sein **eigener** `cordis.patch.yml` lädt alle sieben Zeilen, `send-to-session` eingeschlossen. Live-Zustand: `include:send-to-session` → `enabled: true`, `fiberPhase: active`. Die Datei im Profil ist byte-gleich der gesperrten (`md5 38683855484768a3a43e9dc49cab899c`). In den Sitzungsprotokollen stehen **20** Aufrufe des Werkzeugs.

Die Prüfung suchte im Profil-Patch, also am falschen Ort. Ein Nichtfund ist kein Befund — derselbe Fehlertyp, der schon in `docs/STAND.md` §5f steht.

**Folge:** Bis zur Freigabe von v0.5.0 läuft die gesperrte Fassung im Betrieb. Das ist der Grund, warum diese Vorlage nicht „irgendwann" geprüft werden sollte.
