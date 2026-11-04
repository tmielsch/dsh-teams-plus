# Anrufdatenbank — Einbau und Rücknahme

Stand: 2026-11-04. Gehört zu `docs/TEAM-ARBEITSWEISE.md` § 6b.

**Dieses Dokument beschreibt den Einbau. Es ist noch nicht eingebaut.**
Regel 1 aus `~/.dsh/AGENTS.md` gilt: gebaut, getestet und gemessen wird ohne
Pass; in ein laufendes Profil kommt es erst nach einem Red-Team-Pass.

## Was eingebaut wird

| Teil | Datei |
|---|---|
| Werkzeug `team_anruf` und `team_anrufe` | `patches/team-anruf.mjs` |
| Tests | `test/team-anruf.test.mjs` |
| Lade-Eintrag | `cordis.patch.yml` (B-Patch, wie `team-board`) |
| Ablage (entsteht beim ersten Schreiben) | `~/.dsh/.tm/teams-plus/state/anrufe.json` |

Der Patch lädt als Cordis-Plugin. Er schreibt **nichts** in die DSH-Installation —
deshalb ist er ein **B**-Patch und braucht kein `teams-plus apply`.

## Vor dem Einbau: der Pass

Ein Red-Team liest `patches/team-anruf.mjs` und `docs/TEAM-ARBEITSWEISE.md` § 6b
gegen den Code. Worauf es zu sehen hat, und das sind die Stellen, an denen ein
solcher Patch erfahrungsgemäß bricht:

1. **Die Sperre.** Zwei Schreiber gleichzeitig: verliert einer seinen Eintrag?
   `mitSperre` aus `send-to-session.mjs` ist vorhanden — wird es benutzt, und
   hält es über Prozessgrenzen?
2. **Die kaputte Datei.** Wird eine unlesbare `anrufe.json` laut gemeldet, oder
   sieht Datenverlust wie ein frischer Anfang aus?
3. **Die Suche.** Findet sie wirklich über `stichworte`? Ein Verzeichnis, das
   man nur befüllt und nie abfragt, ist keine Datenbank.
4. **Der offene Anruf.** Bleibt `stand: offen` sichtbar, oder verschwindet er
   stillschweigend?
5. **Der Pfad.** `DSH_HOME=""` muss auf das echte Zuhause zurückfallen, nicht auf
   einen relativen Pfad im Arbeitsverzeichnis (Backlog A2 — derselbe Fehler war
   schon einmal da).

## Der Einbau, drei Schritte

Voraussetzung: das Paket ist im Profil installiert (0.8.x oder neuer).

```bash
cd ~/dsh-teams-plus
npm test                                   # muss grün sein
npm pack                                   # baut das Tarball
```

```bash
dsh plugin --profile web add file:/Users/tmielsch/dsh-teams-plus/tmielsch-dsh-teams-plus-<version>.tgz
```

Alternativ die Release-Adresse von GitHub — dann trägt jede Maschine dieselbe
Prüfsumme im Lockfile.

```bash
bash ~/.dsh/tools/restart-web.sh           # Neustart, beendet alle Sitzungen
bash ~/.dsh/tools/restart-web.sh --status  # vorher nachsehen, nichts anfassen
```

**Der Neustart ist Pflicht.** Node hält das geladene Modul im Speicher; erst der
neue Prozess liest den neuen Patch.

## Ob es geklappt hat

Nach dem Neustart im Werkzeugkasten nachsehen: **`team_anruf` und `team_anrufe`**
müssen da sein. Sie gibt es erst mit diesem Patch; ihr Erscheinen ist der Beweis,
dass er geladen wurde.

Dann:

```text
team_anrufe                                → leere Liste, kein Fehler
team_anruf  aktion "oeffnen" an "…" thema "…"  → liefert anruf-1
team_anrufe suche "…"                      → findet ihn
```

## Rücknahme

Der Patch ist ein Plugin-Patch: **seinen Eintrag in `cordis.patch.yml` entfernen
und DSH neu starten.** Danach ist er aus dem laufenden Betrieb verschwunden.

Die **Ablage bleibt liegen.** Das ist Absicht: `anrufe.json` enthält Gespräche,
die schon stattgefunden haben. Wer sie loschen will, tut das ausdrücklich:

```bash
mv ~/.dsh/.tm/teams-plus/state/anrufe.json ~/.dsh/.tm/teams-plus/state/anrufe.json.alt
```

## Was zurückbleibt, wenn man nichts tut

Ein Patch, der im Profil liegt und in `cordis.patch.yml` des **Pakets** steht,
wird beim nächsten Start geladen. Ein Patch, der **nur** im Repo liegt und nicht
im Profil, tut nichts. Der Unterschied ist die eine Zeile im Profil, nicht die
Datei im Repo.

Deshalb: Wer den Einbau zurücknimmt, nimmt den **Eintrag** zurück, nicht die
Datei. Die Datei im Repo darf bleiben und weiter verbessert werden.
