# Einbau: `send_message`-Fix auf dem Server (2026-11-04)

**Stand: 2026-11-04, 22:56.** Dieser Eingriff ist **auf dem Server live** und
dort gemessen. Der Mac trägt den Fix im Repo, aber **nicht** im Profil.

## Der Fehler

Im Betrieb, dem Menschen gemeldet am 2026-11-04:

```
Error: tool "send_message" returned invalid output:
"value.note" is not a declared property (additionalProperties: false)
```

**Was passierte:** Die Nachricht wurde zugestellt, der Empfänger wachte auf —
aber der Aufruf endete mit einem Fehler. Dreimal gesendet, dreimal Züge
verbrannt, kein Ergebnis zurück.

## Die Ursache

`patches/stille-nachrichten.mjs` hängte an das Ergebnis ein Feld `note` mit
einem Hinweis an den **Absender** („leite das nicht an den Lead weiter").

Das Ausgabeschema von `send_message` hat `additionalProperties: false` und genau
**ein** Feld: `messageId`
(`dsh-tool-subagent-control/lib/types/index.js`, Zeilen 37–44). Der Kern prüft
das Ergebnis mit `validateJsonSchemaValue(tool.output.schema, detached, "value")`
(`dsh-tools/lib/index.js`, Zeile 3543) und **verwirft es bei einem fremden Feld**.

**Beide Zweige** der Erweiterung waren betroffen: der Weg über `agent_id` und
der über den Team-Dienst.

Gemessen mit dem echten Kern-Validator, ehe etwas geändert wurde:

```
nur messageId              GUELTIG
mit note (heutiger Code)   ABGELEHNT: "value.note" is not a declared property
                           (additionalProperties: false)
```

## Die Behebung

Der Hinweis geht über `letzterHinweis` in den **gerenderten Text**. `render`
bekommt `(args, wert)` und darf frei formulieren; das Schema prüft den **Wert**,
nicht den Text. Das Ergebnis bleibt damit exakt `{ messageId }`.

Die Rücknahme stellt auch `render` wieder her.

Die Selbstprüfung des Moduls und der neue Test `test/stille-nachrichten.test.mjs`
prüfen gegen den **echten** Kern-Validator, samt Gegenprobe, dass ein Ergebnis
mit `note` abgelehnt wird. Ohne den Kern fällt der Test **laut** aus.

## Der Eingriff auf dem Server (ZimaOS)

**Nicht das ganze Paket, sondern genau eine Datei.** Der Grund ist gemessen:
Der Server läuft auf Paket **0.7.1**, das Mac-Repo auf **0.8.2**. Ein Paket
hätte alles zwischen den Versionen mitgebracht — darunter die Anrufdatenbank,
die noch keinen abgeschlossenen Red-Team-Pass hat.

| Was | Wert |
|---|---|
| Datei | `/DATA/.dsh/profiles/web/node_modules/@tmielsch/dsh-teams-plus/patches/stille-nachrichten.mjs` |
| vorher (sha256) | `82a080ad…faa9aed7cb84d6089d183cc8992fc5456946` |
| nachher (sha256) | `e2b8dbb4…5b832e440db85bc` |
| Sicherung | `…/stille-nachrichten.mjs.vor-fix-20261104` |
| Datei geändert | 21:54:30 |
| Prozessstart | 21:55:00 (PID 1413173) |
| Neustart | `bash /DATA/.dsh/tools/restart-web.sh` (Port 3080, Guard lässt durch) |
| HTTP danach | 401 (Anmeldung nötig — normal) |

**Die Absicherung hat gegriffen.** Der erste Einspielversuch scheiterte, weil
`node` nicht im PATH des Skripts stand. Das Skript fuhr automatisch zurück: die
Sicherung wurde zurückkopiert, die Prüfsumme war danach wieder die alte. Zweiter
Versuch mit `export PATH=/DATA/.npm-global/bin:/DATA/opt/node/bin:/DATA/.local/bin:/usr/bin:/usr/sbin`
war erfolgreich.

**Der Beweis auf dem Server selbst** (`/tmp/endbeweis.mjs`, Pfade angepasst):
schemakonform gültig, kein `note` im Ergebnis, Hinweis im Text; Gegenprobe mit
dem alten Verhalten wird mit **genau der Fehlermeldung aus dem Betrieb**
abgelehnt. Alle 26 Patch-Module: Syntax in Ordnung. Keine Fehler im
Host-Protokoll seit dem Neustart.

## Rückweg

```bash
ssh zimaos
export PATH=/DATA/.npm-global/bin:/DATA/opt/node/bin:/DATA/.local/bin:/usr/bin:/usr/sbin
Z=/DATA/.dsh/profiles/web/node_modules/@tmielsch/dsh-teams-plus/patches
cp -p "$Z/stille-nachrichten.mjs.vor-fix-20261104" "$Z/stille-nachrichten.mjs"
sha256sum "$Z/stille-nachrichten.mjs"   # muss 82a080ad… ergeben
bash /DATA/.dsh/tools/restart-web.sh
```

## Die Lehre — dieselbe wie bei `team-anruf`

**Zweimal derselbe Fehlertyp in vier Tagen.** Erst `team-anruf` (Feld `anruf`
ohne `additionalProperties`), jetzt `send_message` (Feld `note`). Beide Male hat
ein fremdes Feld im Ergebnis den Kern das Ganze verwerfen lassen.

Die Ursache ist nicht das einzelne Feld, sondern die fehlende Prüfung: **Jedes
Werkzeugergebnis muss gegen das echte Ausgabeschema geprüft werden, mit dem
echten Validator.** Eine Nachbildung prüft die Nachbildung. Ohne die
Installation im Zugriff muss der Test **laut** scheitern, nicht still.

Beim `team-anruf` hat es ein Red-Team-Pass gefunden, weil er gegen den echten
`defineTool` gemessen hat. Dieser Patch hatte keinen solchen Pass.

## Was offen bleibt

Der Mac trägt den Fix im Repo (`7f8f0ff`), aber die installierte Fassung im
Profil `web` (0.8.2) ist **noch die alte**. Der Fix wird auf dem Mac mit dem
nächsten Paket wirksam. Vorher ist zu entscheiden, ob die Anrufdatenbank
mitkommt (Eintrag `team-anruf` in `cordis.patch.yml`, Zeilen 48–49 — **das erste
`npm pack` macht sie live**).
