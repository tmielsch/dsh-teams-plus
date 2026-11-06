# Einbau: die Regel „Befehle werden nicht bestätigt" auf dem Server (2026-11-06)

**Stand: 2026-11-06, 13:05, zweite Runde.** Die Regel steht auf dem Mac und auf ZimaOS. Der Eingriff war eine
**Dateiänderung ohne Neustart**: `AGENTS.md` wird beim Start einer Sitzung und bei Änderung der
Datei geladen, die zwei Anweisungsdateien im Paket liest ein Agent bei Bedarf.

## Was die Regel ist

Anordnung des Menschen 2026-11-06: Ein Befehl wird ausgeführt, und Schweigen heißt: erledigt.
Gemeldet wird nur, was nicht ging (einmal, an den Absender, mit Grund), oder ein Ergebnis, das der
Auftrag verlangt hat. Ein Bericht wird nicht beantwortet, außer er enthält eine Frage.
Wortlaut und Begründung: `docs/TEAM-ARBEITSWEISE.md`, § 7, Netiquette 8, Commit `4bfe357`.

## Was auf dem Server geändert wurde

| Datei | Änderung | Prüfsumme (sha256, Anfang) |
|---|---|---|
| `/DATA/.dsh/AGENTS.md` | TEAMSPLUS-Block aktualisiert, 5 Zeilen dazu (58 924 → 59 436 Bytes nach beiden Runden) | ursprünglich `a46ec7e6…` |
| `…/dsh-teams-plus/agents/teams-plus-agents.md` (der Zeiger) | durch die Fassung vom Mac ersetzt | `8abae92a…` (gleich Mac) |
| `…/dsh-teams-plus/agents/teams-plus-agents.voll.md` | durch die Fassung vom Mac ersetzt | `34e85d9b…` (gleich Mac) |

**Zwei Runden am selben Tag.** Die erste (12:01) brachte die Regel. Die zweite (12:03) brachte die
Reparatur eines Fehlers der ersten, siehe unten. Die Prüfsummen oben sind die der zweiten Runde.

`AGENTS.md` bleibt mit 59 436 Bytes unter dem Budget von 65 536 (auf dem Mac sind es 69 376; dort
liegt die Datei über dem Budget, siehe unten).

## Wie es gemacht wurde

1. **Bühne:** Zeiger, volle Fassung und `scripts/agents-block.mjs` vom Mac nach `/tmp/tp-buehne`
   auf dem Server kopiert, Prüfsummen gegen den Mac verglichen. Weicht eine ab, bricht das Skript ab.
2. **Probe an einer Kopie:** `--install` gegen eine Kopie der Server-`AGENTS.md`, Sicherung in einen
   Wegwerf-Ordner. Der Unterschied zur echten Datei: genau die 5 neuen Zeilen, sonst nichts.
3. **Echt:** `agents-block.mjs --install` (sichert vorher nach
   `/DATA/.dsh/.tm/teams-plus/backup-agents/`), danach beide Anweisungsdateien über
   Temp-Datei und `mv` ersetzt.
4. **Nachprüfung vom Mac aus**, unabhängig vom Skript: Regel in `AGENTS.md` (1 Treffer),
   Prüfsummen im Paket gleich Mac, Host auf Port 3080 läuft weiter (PID 1790004).

Warum **Temp-Datei und `mv`** und nicht `cp` auf die Datei: die Dateien im Paket sind Hardlinks in
den geteilten pnpm-Speicher. **Gemessen** (`stat`, 2026-11-06): `projectos-agents.md`, die ich nicht
angefasst habe, hat 2 Links und teilt sich den Inode mit einer Datei unter
`/DATA/.local/share/pnpm/store/v11/files/…`; die zwei ersetzten Dateien haben danach 1 Link und eigene
Inodes. `mv` hat nur den Verzeichniseintrag dieses Profils ersetzt, der Speicher blieb unberührt. Ein
Schreiben in die Datei hätte auch die Kopie im Speicher verändert.

## Rückweg

```bash
ssh zimaos
export PATH=/DATA/.npm-global/bin:/DATA/opt/node/bin:/DATA/.local/bin:/usr/bin:/usr/sbin
cd /DATA/.dsh

# 1) AGENTS.md: die Sicherung, die das Skript vor dem Eingriff angelegt hat
# die ERSTE Sicherung (12-01-15) ist der Stand vor jedem Eingriff dieses Tages;
# die zweite (12-03-39) ist der Stand nach der ersten Runde
cp -p .tm/teams-plus/backup-agents/AGENTS.md.2026-11-06T12-01-15-294Z AGENTS.md
sha256sum AGENTS.md          # muss a46ec7e6… ergeben

# 2) die zwei Anweisungsdateien im Paket
S=profiles/web/teams-plus-agents-vor-regel-20261106-120115   # Stand vor jedem Eingriff dieses Tages
P=profiles/web/node_modules/@tmielsch/dsh-teams-plus/agents
for f in teams-plus-agents.md teams-plus-agents.voll.md; do
  cp "$S/$f" "$P/$f.alt" && mv -f "$P/$f.alt" "$P/$f"
done
```

## Der Fehler der ersten Runde, und was die zweite repariert hat

Eine andere Sitzung meldete ein Loch: Die volle Fassung verwies dreimal auf
`docs/TEAM-ARBEITSWEISE.md` (Zeilen 104 und 127, dazu „Stufung aus § 6 der Spec" in Zeile 129). **Diese
Datei wird nicht ausgeliefert.** Gemessen am 2026-11-06:

| Messung | Ergebnis |
|---|---|
| `package.json` `files` | `patches`, `rollen`, `agents`, `bin`, `scripts`, `policies`, `cordis.patch.yml`, `README.md`, `LICENSE`, `lib` — **kein `docs`** |
| `~/.dsh/.tm/teams-plus/docs/TEAM-ARBEITSWEISE.md` | existiert nicht (dort hängt nur `agents`, `patches`, `rollen`) |
| `docs/` im Paket auf dem Server | existiert nicht |
| `ls docs/TEAM-ARBEITSWEISE.md` aus einem anderen Verzeichnis | `No such file or directory` |

Ein Agent in einem fremden Projekt konnte den Verweis also **nie** auflösen. Die Ursache liegt bei mir:
Ich habe die Verweise aus der Spec in die Anweisungsdatei übernommen, ohne zu prüfen, ob die Datei beim
Leser ankommt. Dieselbe Klasse wie der `note`-Fehler und der `team_anruf`-Schemafehler: **ich habe
geschrieben, was im Repo stimmt, und nicht gemessen, was beim Empfänger ankommt.**

Das zweite Loch derselben Meldung: Die Liste „Was keine Nachricht ist" kannte keine Betriebs-Banalität
wie „Worker ist geweckt". Genau der Fall, den der Mensch als Beispiel genannt hatte.

**Behoben in der zweiten Runde:** Die drei Verweise sind gestrichen und durch den Inhalt ersetzt; die
Liste führt die Banalität („Worker ist geweckt", „Datei kopiert", „Befehl ausgeführt", „Neustart
gemacht") ausdrücklich; der **Zeiger**, der als Einziges in jede Sitzung kommt, nennt sie ebenfalls.
Der Test `die Anweisungsdateien sind eigenstaendig` in `test/umzug.test.mjs` verbietet jeden
`docs/…`-Verweis und jeden Verweis auf „die Spec" in den drei Anweisungsdateien. Er war **vor** der
Reparatur rot und danach grün. Wird `docs` einmal ausgeliefert, scheitert er mit dem Hinweis, die
Prüfung bewusst zu lockern.

## Was dieser Eingriff **nicht** getan hat

- **Kein Neustart.** Der Host auf Port 3080 lief durch.
- **Die Regel wirkt nicht in laufenden Sitzungen rückwirkend:** `AGENTS.md` wird beim Laden einer
  Sitzung injiziert. Eine bereits laufende Sitzung bekommt den neuen Text erst, wenn der Kern die
  Datei neu einliest (auf dem Mac kam er in der laufenden Sitzung als „aktualisierte Anweisung" an;
  auf dem Server ist das **nicht gemessen**).
- **Das Paket auf dem Server bleibt 0.7.1.** Nur die zwei Anweisungsdateien sind neuer als die
  Paketversion; wer `dsh plugin add` mit einem 0.8.x-Tarball ausführt, bekommt sie ohnehin mit.

## Offen: `AGENTS.md` auf dem Mac liegt über dem Budget

`~/.dsh/AGENTS.md` hat **69 376 Bytes**, das Budget liegt bei 65 536 (`docs/TEAM-ARBEITSWEISE.md`,
Frage 10). Der Kern kennt dafür eine Regel: Passt eine Datei nicht, wird sie weggelassen oder gekürzt
(`dsh-agent-instructions`, „omitted or truncated to fit the configured byte budget"). In dieser
Sitzung kam die Datei vollständig an, das Budget ist also nicht an diesen 65 536 festgemacht
(`cordis.patch.yml` nennt `maxBytes: 262144`). Die Zahl 65 536 in der Spec ist damit
**ungemessen veraltet** und gehört neu geprüft, bevor man sich auf sie stützt.
