# Neustart-Vorbereitung 0.8.0 — Stand 2026-11-03, 23:10

Alles ist vorbereitet. **Es fehlt nur der Neustart**, und den macht der Mensch.

## Was eingebaut ist

| Was | Stand |
|---|---|
| Release | `v0.8.0`, https://github.com/tmielsch/dsh-teams-plus/releases/tag/v0.8.0 |
| Paket im Profil | **0.8.0** (`~/.dsh/profiles/web/node_modules/@tmielsch/dsh-teams-plus`) |
| Profil-Abhängigkeit | `https://github.com/…/releases/download/v0.8.0/tmielsch-dsh-teams-plus-0.8.0.tgz` |
| Paket-Patch im Profil | `cordis.patch.yml` Zeile 1043–1044, `id: teams-plus` |
| In `dsh.profile.bundles` | unverändert enthalten |
| Neuer Patch | `patches/team-bremse.mjs` liegt im Profil, Eintrag steht in der Paket-`cordis.patch.yml` |
| Konfiguration | `~/.dsh/.tm/teams-plus/lokalmodus.json`, `maxAktiv: 2` |

**Was der Einbau verändert hat, gemessen per diff gegen die Sicherung:** genau **eine**
Zeile — die Abhängigkeit `@tmielsch/dsh-teams-plus`. Die `bundles`-Liste ist
byte-gleich, alle anderen Abhängigkeiten auch.

Sicherung der Profil-`package.json` vor dem Einbau:
`~/.dsh/profiles/web/package.json.bak-vor-0.8.0-230226`

## Was nach dem Neustart zu sehen sein muss

1. **`team_bremse` steht im Werkzeugkasten.** Das Werkzeug gibt es erst ab 0.8.0;
   sein Erscheinen ist der Beweis, dass der neue Patch geladen wurde.
2. **`team_bremse` mit `aktion: "status"`** nennt Grenze 2, die laufenden Agenten und
   die Zahl der belegten Plätze.
3. **`teams-plus status`** meldet **8 B-Patches** (vorher 5).

## Was der Neustart NICHT ändert, und das ist wichtig

**`bash ~/.dsh/doctor.sh` meldet `ERGEBNIS: FEHLER` — das ist vorbestehend.**
Gemessen am 2026-11-03:

- Die 285 gemeldeten „doppelten Kernpakete" sind **286 Symlinks und 3 echte Ordner**.
  Die Symlinks zeigen auf **dieselbe** Installation:
  `profile/node_modules/@deepseek-ai/dsh-agent → /opt/homebrew/…/dsh/node_modules/@deepseek-ai/dsh-agent`.
  Ein Symlink auf dieselbe Datei ist **dieselbe Modulinstanz** — der Absturzfall aus
  der `AGENTS.md` („Cannot read properties of undefined (reading 'prepare')") tritt bei
  **echten Kopien** auf, nicht bei Verweisen.
- Die drei echten Ordner sind `cosmokit`, `schemastery`, `dsh-home-paths` — Beigaben von
  `cordis`, keine `@deepseek-ai`-Kernpakete.
- Angelegt am **31. Oktober**, also drei Tage vor diesem Einbau. Der laufende Prozess
  arbeitet damit (HTTP 401 auf Port 3080).

**Nichts davon wird angefasst.** Nach der Regel „der vorgefundene Zustand ist eine
Entscheidung, kein Defekt" bleiben die Verweise liegen; `doctor.sh` schlägt weiter an,
das ist der Preis.

**Dieselbe Lage bei den Plugins `@linxin666/*` und `dsh-better-sidebar`:** Sie sind am
31. Oktober installiert worden und verlangen `dsh >= 0.2.1-rc.3`, die Laufzeit ist
`0.2.0-rc.2`. Die Warnung erscheint bei jedem `dsh plugin`-Befehl, auch bei `list` —
also unabhängig von diesem Einbau. Eine Ausnahme (`dsh plugin allow-version`) würde das
Riskiko ausdrücklich übernehmen; das ist **eine Entscheidung des Menschen**, nicht
meine. Ohne Ausnahme werden diese Plugins beim Start verweigert.

## Der Neustart

```bash
bash ~/.dsh/tools/restart-web.sh          # neu starten, Port 3080
bash ~/.dsh/tools/restart-web.sh --status # vorher nachsehen, nichts anfassen
```

Das Skript beendet den Host auf **Port 3080** und startet ihn neu. Es koppelt sich
selbst mit `setsid` ab, weil es sonst mit dem Host stürbe, den es beendet. Auf ZimaOS
läuft auf **Port 3081** der Host eines anderen Benutzers — das Skript lehnt jeden
anderen Port ab, außer mit `RESTART_WEB_ERLAUBT=1`.

**ZimaOS wird nicht neu gestartet.** Dort ist 0.7.1 eingebaut und läuft; die Bremse
kommt dort erst mit einem eigenen Schritt.

## Zurücknehmen, falls etwas klemmt

```bash
cd ~/.dsh/profiles/web
cp package.json.bak-vor-0.8.0-230226 package.json
pnpm install
bash ~/.dsh/tools/restart-web.sh
```

Dann ist wieder 0.6.0 aus dem lokalen Tarball im Profil — genau der Stand von vor
diesem Einbau.

## Was noch nicht geprüft ist, und dafür ist der Neustart da

Die Bremse ist bisher **nur gegen einen nachgebauten Cordis-Kontext** getestet, nicht
im laufenden Host. Belegt ist die Mechanik (13 Tests, Gegenprobe macht 10 davon rot),
nicht die Wirkung in einem echten Team. Der erste echte Lauf wäre: zwei Agenten
starten, `team_bremse` mit `ein` scharf stellen und im `status` sehen, ob der dritte
geparkt wird.
