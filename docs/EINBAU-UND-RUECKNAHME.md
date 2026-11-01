# Einbau und Rücknahme — `send_to_session`

Stand: 2026-11-01, 16:37 (Europe/Berlin). Gemessen, nicht vermutet: **0.6.0 ist eingebaut und
läuft**, die Korrekturen der letzten Runde stehen im Repo, sind aber **weder eingebaut noch
geladen**. Warum dafür ein Neustart allein nicht reicht, steht unter „Wie die Korrekturen aus dem
Repo ins Profil kommen“. Der Warnhinweis zur Reihenfolge (Backlog A4) gilt weiter, sobald der
Sperrblock für eine Rücknahme erneut gesetzt wird; heute ist er entfernt.

## JETZT: 0.6.0 ist eingebaut und läuft — der Repo-Stand läuft nicht

| Was | Wert |
|---|---|
| Paket im Profil | **0.6.0** (`~/.dsh/profiles/web/node_modules/@tmielsch/dsh-teams-plus/package.json`) |
| Quellart | `plugin:@tmielsch/dsh-teams-plus` |
| `package.json` dependency | `file:/Users/tmielsch/dsh-teams-plus/tmielsch-dsh-teams-plus-0.6.0.tgz` |
| in `dsh.profile.bundles` | ja |
| Ladeort des Patches | eigenes Modul: `@tmielsch/dsh-teams-plus/patches/send-to-session.mjs` — so steht es im Paket-Patch `cordis.patch.yml`, Zeile 34–35 |
| Sperrblock in `~/.dsh/profiles/web/cordis.patch.yml` | **entfernt** — 0 Treffer für `id: send-to-session` |
| Testsuite | **137 grün** (`npm test`), darunter die Selbstprüfungen |

**Der laufende Prozess lädt 0.6.0.** Gemessen, nicht vermutet: der neue Protokollpfad
`~/.dsh/.tm/teams-plus/logs/send-to-session.log` wird geschrieben — am 31. Okt.
`2026-10-31T06:35:36Z` „geladen“ (= 07:35 Berlin; die Datei wurde zuletzt 09:53 Berlin
beschrieben) und `2026-10-31T08:53:34Z` ein inject-Eintrag. Diesen Pfad gibt es erst seit 0.6.0.
Der **alte** Pfad `~/.dsh/logs/send-to-session.log` steht seit `2026-10-31T05:46:14Z` still
(= 06:46 Berlin, zugleich die Änderungszeit der Datei).

**Was trotzdem nicht live ist: der Korrekturstand des Repos.** Das Profil lädt keine Datei aus dem
Repo, sondern die Kopie in `node_modules`. Gemessen per md5:

| Ort der Datei `patches/send-to-session.mjs` | md5 |
|---|---|
| installiert im Profil | `3a67fabc07cbdf2edf4f46a1ac5cd88e` |
| im Repo | `1d2c79f809d45c2065dcd7291508e687` |
| im Tarball `tmielsch-dsh-teams-plus-0.6.0.tgz` (`package/patches/send-to-session.mjs`) | `3a67fabc…` — also ebenfalls alt |

Die Paketversion sagt dazu nichts: die Datei nennt in allen drei Fällen im Kopf `FASSUNG 0.6.0`.
Der Unterschied sind die Korrekturen der letzten Runde — der Repo-Stand enthält unter anderem die
Behandlung von `DSH_HOME=""` (Backlog A2), die Altersgrenze des Paar-Gedächtnisses (Backlog A1) und
die geprüfte Nachrichtenkennung (Nachtrag HOCH-1).

## Wie die Korrekturen aus dem Repo ins Profil kommen

**Ein Neustart allein genügt nicht.** Das Profil lädt die *Kopie* in `node_modules`, nicht das
Repo. Wer nur neu startet, startet denselben alten Stand neu.

Drei Schritte, in dieser Reihenfolge — jeder mit dem Grund, warum er nicht ausgelassen werden darf:

1. **Neu packen — im Repo `npm pack`.** Das Tarball im Profil ist alt (`3a67fab…` in der Datei
   darin); ohne diesen Schritt passiert nichts. `prepack` läuft dabei
   (`node scripts/build-client.mjs`) und baut `lib/` neu — `lib/client.js` und `lib/index.js`.
   Weil die Version gleich bleibt, überschreibt `npm pack` den bisherigen Tarball unter demselben
   Dateinamen.

2. **Neu ins Profil einbauen.**

   ```bash
   dsh plugin --profile web add file:/Users/tmielsch/dsh-teams-plus/tmielsch-dsh-teams-plus-0.6.0.tgz
   ```

   Das ersetzt die Kopie in `~/.dsh/profiles/web/node_modules/@tmielsch/dsh-teams-plus/`; genau
   diese Kopie lädt das Profil.

3. **`dsh web` neu starten.** Node hält das geladene Modul im Speicher; erst der neue Prozess liest
   die neue Datei. (Der Neustart beendet alle laufenden Sitzungen.)

**Prüfen, ob „alt“ oder „neu“ auf der Platte liegt — die md5-Summe ist das direkte Mittel:**

```bash
md5 -q ~/.dsh/profiles/web/node_modules/@tmielsch/dsh-teams-plus/patches/send-to-session.mjs
md5 -q /Users/tmielsch/dsh-teams-plus/patches/send-to-session.mjs   # Gegenprobe: Repo-Stand
```

Soll danach die erste Summe `1d2c79f809d45c2065dcd7291508e687` sein (oder was der dann aktuelle
Repo-Stand ist). Solange dort `3a67fab` steht, ist der Stand alt. Die Summe prüft die **Platte**,
nicht den Speicher: erst Schritt 3 holt sie in den laufenden Prozess.

## Der Neustart

**Heute ist der Sperrblock weg** (0 Treffer für `id: send-to-session` in
`~/.dsh/profiles/web/cordis.patch.yml`). Es gibt also kein Fenster mehr, in dem ein Neustart die
gesperrte Fassung wieder einschaltet. Ein Neustart ist heute nur noch der dritte Schritt von oben —
und allein nutzlos.

**Der Grund für die Reihenfolge gilt wieder, sobald der Block für eine Rücknahme erneut gesetzt
wird.** Das Entfernen des Eintrags `- id: send-to-session` / `disabled: true` schaltet die
**laufende** Fassung **sofort** wieder ein — **ohne Neustart**. Beim 0.6.0-Einbau ist genau das
passiert; abgelesen an der Plugin-Liste (`enabled: true, fiberPhase: active`), während im
Prozessspeicher noch der alte Code lag. Wer den Block entfernt und dann weiterarbeitet, hat die
gesperrte Fassung live.

Daher gelten dann zwei Reihenfolgen — beide enden im selben Zustand:

1. **Neustart planen, DANN den Block entfernen:** `dsh web` beenden, Block entfernen, starten.
   Kein Fenster, in dem die gesperrte Fassung wieder aktiv wird.
2. **Block entfernen und SOFORT neu starten:** kein weiterer Agentenlauf dazwischen, keine Nutzung
   von `send_to_session`, kein „mache ich gleich“. Das Fenster ist so lang wie der Neustart.

**Verboten ist der dritte Weg:** Block entfernen, weiterarbeiten, Neustart später. Genau so kam die
laufende v0.4.0 wieder hoch.

Einen Entfernungsbefehl gibt es heute nicht mehr: der frühere suchte die Markierung
`# --- send_to_session: VOR dem Neustart`, und die steht nicht mehr in der Datei.

## Woran man erkennt, dass 0.6.0 wirklich läuft

**Nicht** an der Paketversion — die stand schon nach dem Einbau auf 0.6.0, während im Speicher
noch die alte Fassung lief. Auch **nicht** an der Kopfzeile der Datei und nicht am `mode.enum`:
beide sind in der alten Profil-Kopie (`3a67fab`) genauso wie im Repo (`1d2c79f`), weil beide
0.6.0 sind. Für den **Versionsstand** (v0.4.0 gegen 0.6.0) gelten diese Merkmale:

1. **`mode.enum`** der Werkzeugbeschreibung ist `["auto","steer","followup"]` (in
   `patches/send-to-session.mjs`). v0.4.0 hatte `["steer","followup"]`.
2. **Der neue Protokollpfad entsteht:** `~/.dsh/.tm/teams-plus/logs/send-to-session.log` wird
   beschrieben; nur 0.6.0 schreibt dorthin. Solange der alte Pfad
   `~/.dsh/logs/send-to-session.log` noch wächst, läuft v0.4.0.
3. **Die Kopfzeile** der Datei nennt `FASSUNG 0.6.0`.

Für den **Korrekturstand** hilft keines davon, sondern nur die md5-Summe oben (Platte) zusammen mit
dem Neustart (Speicher).

## Rücknahme (wenn etwas klemmt)

```bash
cp ~/.dsh/profiles/web/package.json.bak-vor-060-064609 ~/.dsh/profiles/web/package.json
cp ~/.dsh/profiles/web/cordis.patch.yml.bak-vor-060-064609 ~/.dsh/profiles/web/cordis.patch.yml
# dann dsh web neu starten
```

Zusätzlich liegt die Sicherung vom 06:13 unter
`~/.dsh/profiles/web/cordis.patch.yml.bak-vor-s2s-sperre-20261031-061348` (80 444 Bytes) — und die
Sicherung vom 07:35 unter `~/.dsh/profiles/web/cordis.patch.yml.bak-vor-freigabe-073521`; das ist
der Stand **mit** Sperrblock, also direkt vor der Freigabe von 0.6.0.

## Was beim Einbau gemessen wurde — und was davon überraschte

- **Das Entfernen des Sperrblocks schaltet die laufende Fassung wieder ein.** Genau das ist beim
  Einbau passiert und wurde an der Plugin-Liste abgelesen (`enabled: true, fiberPhase: active`).
  Deshalb stand der Block danach wieder — bis zum 31. Okt. um 07:35; seitdem läuft 0.6.0 und der
  Block ist entfernt.
- **`dsh plugin add` beendet den alten Prozess nicht.** Es schreibt nur die Platte um.
- **Der Einbau selbst lief sauber durch** — die Ausgabe war nur von Peer-Warnungen zweier
  **anderer** Plugins überlagert (`@linxin666/dsh-client-ui-skin-center@0.4.12`,
  `dsh-better-sidebar@0.28.2`). Beide gehören nicht zu diesem Vorgang und standen schon vorher so da.
- **Die Paketversion 0.6.0 sagt nichts über den Code.** Das Tarball von 0.6.0 enthält die alte
  Patch-Datei (`3a67fab…` statt `1d2c79f…`); deshalb ist die Kopie im Profil alt, obwohl dort
  0.6.0 steht.

## Der frühere Weg B (Abschalten ohne Einbau) — noch gültig als Rückfall

Wenn 0.6.0 zurückgenommen werden soll und die alte Fassung **nicht** wieder laufen darf: diese
Zeilen ans Ende von `~/.dsh/profiles/web/cordis.patch.yml` hängen.

```yaml
- id: send-to-session
  disabled: true
```

Der Block steht in dieser Form in der Sicherung
`~/.dsh/profiles/web/cordis.patch.yml.bak-vor-freigabe-073521` (ab Zeile 1893). Er wirkt **ohne
Neustart**, weil der Profil-Patch live nachgezogen wird: das Werkzeug fehlt dann sofort in der
Liste.

**Das gilt in beide Richtungen:** auch das **Entfernen** des Blocks wirkt ohne Neustart — die
laufende Fassung ist dann sofort wieder aktiv. Deshalb steht die Warnung im Abschnitt „Der
Neustart“.
