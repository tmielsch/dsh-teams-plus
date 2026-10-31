# ⛔ v0.4.0 NICHT EINBAUEN — Red-Team-STOPP

Stand 2026-10-30, 23:50. Diese Datei sperrt eine ausgelieferte Fassung, bis sie behoben ist.
Wer sie liest, bevor er etwas einbaut: **v0.4.0 nicht einbauen.**

## Was gesperrt ist

`send_to_session` in `patches/send-to-session.mjs`, ausgeliefert als Release **v0.4.0**.
Bericht: `docs/REDTEAM-SEND-TO-SESSION.md` (Zweig `feature/redteam-send-to-session`, Commit `1050cde`).

**Das Werkzeug ist NICHT aktiv.** Das Profil `web` lädt nur den Host-Eintrag `id: teams-plus`,
nicht die einzelnen Patches. `grep -c 'send-to-session' ~/.dsh/profiles/web/cordis.patch.yml`
ergibt 0. Kein Schaden entstanden.

## Der STOPP, in einem Satz

Die Herkunftsangabe der Nachricht (`source.kind`) ist im Kern **kein Etikett, sondern eine
Berechtigung** — und die gewählte Art ist zwar heute ungefährlich, aber die naheliegende
„Verbesserung" wäre eine Rechteübertragung.

## Der Befund, der zählt

`dsh-tool-goal/lib/index.js`, Funktion `hasDirectHumanInput` (Zeilen 49–82) entscheidet, ob ein
Agent ein **Ziel** anlegen, abschließen oder blockieren darf. Sie liefert `true` für:

```js
if (quelle.kind === "user") return true;                              // :78
if (istWurzel) return false;                                          // :79
if (quelle.kind === "agent-message") return true;                     // :80
```

Diese Funktion trägt zwei Berechtigungen: `requireDirectHuman` (`:93–96`) und
`completionAuthority` (`:103–111`). Der Kommentar `:69–72` sagt, warum das sicher ist:

> „`agent-message` erzeugt **ausschließlich** der Dienst `subagents` zwischen direkt benachbarten
> Sitzungen."

**Der Fehler, den der Lead beinahe gemacht hätte:** er wollte `kind: "agent-send"` durch
`kind: "agent-message"` ersetzen — weil `agent-message` in der geschlossenen Liste
`SOURCE_KINDS` der Migration v2→v3 steht (`dsh-session-format-v2-to-v3/lib/index.js:14–30`).
Damit wäre die Migrationskante geschlossen worden, **aber jeder Agent hätte einer fremden Sitzung
die Berechtigung unterschieben können, ein Ziel anzulegen oder abzuschließen.**

## Die eiserne Regel, die daraus folgt

**`source.kind` ist eine Berechtigung. Wer sie setzt, muss wissen, welche Rechte er damit
weitergibt.** Prüfe vor jeder Wahl: welche Stellen lesen `source.kind` und was entscheiden sie?

`grep -rn 'source.kind\|quelle.kind' <installation>/@deepseek-ai/*/lib/index.js`

## Was vor einem Einbau nötig ist (aus dem Bericht)

1. **`source.kind` ohne Berechtigungswirkung.** `agent-send` behalten. Den Textaufbau des Kerns
   übernehmen: `Agent <id> sent a message: ` als eigener Block VOR dem Inhalt
   (`dsh-subagent/lib/index.js:588`), nicht als Kopfzeile im selben Block.
   Wer die Migrationskante schließen will, trägt `agent-send` in
   `dsh-session-format-v2-to-v3/lib/index.js:14–30` ein — das ist ein Eingriff in die Installation
   und eine eigene Entscheidung.
2. **Zähler je ZIEL**, nicht nur je Absender. Drei Sitzungen × 6 = 18 an dieselbe vierte.
3. **Zähler je Absender-Ziel-PAAR plus Tiefenstufe.** Der Paar-Zähler allein bricht nur A→B→A;
   eine Dreierkette A→B→C→A umgeht ihn. Tiefe: beim Eintreffen prüfen, ob der auslösende Zug selbst
   eine Agenten-Nachricht enthielt, Stufe um eins erhöhen, ab fester Stufe ablehnen.
4. **Ein Test, der die Berechtigungswirkung der Quelle festhält.** Test 3 prüft heute nur
   `!== "user"` — genau dort sitzt der STOPP.
5. **Die Bremse überlebt keinen Neustart** (`new Map` in `apply`, `:245`).

## Was der Bericht bestätigt hat

- Die drei Behauptungen des Leads stimmen: Sperre in `dsh-subagent/lib/index.js:1762`
  (prüft `:1763` exakten Absender, `:1770` Eltern-Kind-Linie); `steer`/`followup` öffentlich und
  ohne Verwandtschaftsprüfung (`runtime-types.d.ts:192,200`); `agents.get/list` ohne
  Besitzprüfung (`dsh-agent:594,612`).
- **Es gibt keine Schranke, die nur beim Aufruf vom Kern aus greift.** Alle 30 Aufrufstellen von
  `.steer(`/`.followup(` über 22 Pakete prüfen das Ziel nicht auf Berechtigung. Die einzige echte
  Ziel-Autorisierung ist `authorizeLineage` (`dsh-subagent:956–959`) und `assertAdmitting`
  (`:945–949`) — genau die, die `send_message` benutzt und `send_to_session` umgeht.
- Die 12 Tests halten fünf Mutationen stand; der Verdacht „Tests prüfen sich selbst" traf nicht zu.
- Eine Sitzung, die während der Zustellung endet, ergibt `{"delivered":false,"note":"delivery
  failed: … is disposed"}` — nichts wirft nach außen.

## Der Rückweg

```bash
gh release delete v0.4.0 --yes --cleanup-tag   # braucht ein gültiges gh-Token
```

Am 2026-10-30 nicht ausgeführt: der Token in `gh` war ungültig (`gh auth status`:
„The token in default is invalid"). Die letzte saubere Fassung ist **v0.3.1**.

Der Code bleibt auf `main` (`d8b6e99`) — er ist nicht geladen und richtet so keinen Schaden an.
Wer ihn einbauen will, muss die fünf Punkte oben abarbeiten und erneut prüfen lassen.
