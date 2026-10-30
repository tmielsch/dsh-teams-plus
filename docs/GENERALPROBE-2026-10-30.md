# Generalprobe des Einbaus (2026-10-30)

Diese Datei hält fest, was der Einbau von AgentTeams+ **tatsächlich tut**, gemessen an einem
nachgebauten Zuhause — nicht behauptet, sondern gefahren. Der Zweck: Wer den Einbau wagt, soll
vorher wissen, was danach dasteht.

## Die Lage, auf der geprüft wurde

| Gegenstand | Wert |
|---|---|
| Profildatei | Kopie der echten `cordis.patch.yml`, `1ef2d9aa610b9bf12813a4235d36dc760cf10a2f4bc1355f56769391e5e194bb`, 1848 Zeilen |
| Paket | `tmielsch-dsh-teams-plus-0.3.1.tgz`, wie ausgeliefert, entpackt nach `profiles/web/node_modules/@tmielsch/dsh-teams-plus` |
| `~/.dsh/patches` | 19 Symlinks, alle nach `dsh-projectOS/patches` |
| `~/.dsh/rollen` | Symlink auf `dsh-projectOS/rollen` |
| `~/.dsh/AGENTS.md` | Kopie der echten, 1080 Zeilen mit dem PROJECTOS-Block |

Der Probeort ist `/tmp/generalprobe/dsh`; die echte Umgebung wurde nicht angefasst.

## Was jeder Schritt bewirkt hat

### `link --relink --apply`

Vorher 19 Verweise nach `dsh-projectOS`, nachher **keiner mehr**. 17 Verweise zeigen auf
`<datenordner>/patches/<name>`, die vier Dateien ohne Gegenstück im Paket sind durch byte-gleiche
Kopien ersetzt, `~/.dsh/rollen` zeigt auf `<datenordner>/rollen` mit allen sieben Rollen.

**Kein einziger toter Verweis.** Geprüft mit `find -L` und durch Anlaufen jedes Ziels. Die vier
Werkzeuge, die das Profil tatsächlich lädt (`delegate-send`, `teammate-model`, `goal-await`,
`stille-nachrichten`), sind **byte-gleich** mit der Fassung im Paket.

Sicherung: `<datenordner>/backup-links/<stempel>.json`.

### `einbau --apply`

Prüfsumme vorher `1ef2d9aa…194bb`, nachher `600d4b2e…1fc80`. Vier Einträge entfernt, `teams-plus`
an Zeile 1039/1040 eingesetzt — genau dort, wo `delegate-send` stand. 1849 → 1835 Zeilen.

Die fremden Modelländerungen stehen unverändert da: `provider: deepseek-official` /
`model: deepseek-flash` bei `agent-default-model`, `contextWindow: 512000`, `reasoningEffort: high`,
die Platzhalter `provider: '*'` und `model: '*'`. Das Skript meldet selbst „Nachkontrolle: nur die
geplanten Zeilen haben sich geändert."

**Der `disabled`-Schalter von `teammate-modell` bleibt stehen** — das ist der Bundle-Schalter, kein
Patch-Eintrag. Nur Einträge MIT `name:` fallen weg.

Nach dem Einbau lädt DSH die fünf Patches über das Paket statt über die vier Profileinträge. Geprüft:
keine `id` doppelt im `insert`-Block.

### `agents install`

Block vor den alten PROJECTOS-Block gesetzt, 1080 → 1177 Zeilen (97 Zeilen Block). Genau ein
TEAMSPLUS-Block, der alte PROJECTOS-Block bleibt vollständig darunter stehen.

### Das Paket lädt

`lib/index.js` aus dem installierten Pfad: `apply` ist eine Funktion, `name` ist `teams-plus`,
`inject` nennt `systemPrompt`, `agents`, `workspaceRegistry`. `patches/package.json` liegt im Paket —
die Browser-Hälfte wird also nicht mehrfach geladen.

## Die drei Rückwege, alle byte-gleich geprüft

| Befehl | Ergebnis |
|---|---|
| `einbau --revert <backup-profile/…>` | Prüfsumme kehrt auf `1ef2d9aa…194bb` zurück, 1848 Zeilen |
| `link --relink --revert <backup-links/…>` | 19 Verweise wieder nach `dsh-projectOS`, `rollen` zeigt wieder dorthin |
| `agents revert` | 1080 Zeilen, Block weg, alte Datei wiederhergestellt |

## Was das für den Einbau heißt

Der Ablauf ist am 2026-10-30 einmal vollständig durchgelaufen, mit denselben Befehlen, die in der
README stehen, und danach wieder zurückgenommen. Die Zahlen oben sind gemessen.

**Was diese Probe NICHT beweist:** ob der Browser die Client-Hälfte fehlerfrei rendert. Dafür
müsste DSH neu starten, und das trifft alle laufenden Sitzungen. Das ist der einzige Punkt, der
offenbleibt, bis der Einbau wirklich geschieht.
