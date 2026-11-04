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

---

## Stand 2026-11-04, 05:55 — was fertig ist, was läuft

**Fertig:**
- Der Plan (§ 6b, Commit `dcdf569`)
- Die Einbau- und Rücknahme-Anleitung samt der fünf Pass-Kriterien
  (`docs/EINBAU-ANRUFDB.md`, Commit `f08741e`)

**Läuft:** Eine Fachkraft baut `patches/team-anruf.mjs` und `test/team-anruf.test.mjs`.
Auftrag mit WRITE-SCOPE, fünf Pflichttests und der Auflage, Abweichungen
vorzulegen statt zu verschweigen. Noch kein Commit — der Patch ist nicht da.

**Nächster Schritt, wenn sie abliefert:**
1. Abnahme: Tests selbst laufen lassen, die Gegenprobe zur Suche selbst fahren.
2. Prüfen, ob `mitSperre` wirklich benutzt wird und ob eine kaputte Datei laut meldet.
3. Sichten, ob sie etwas über den Plan hinaus entschieden hat.
4. Version hochziehen, packen, Release, Einbau ins Profil.
5. Erst nach dem Red-Team-Pass einbauen — bis dahin bleibt es im Repo.
---

## Nachtrag 2026-11-04: der erste Red-Team-Pass und was daraus wurde

Der erste Pass hat **STOPP** gegeben. Er ist im Sitzungsverlauf dokumentiert und
in `patches/team-anruf.mjs` an den betroffenen Stellen zitiert. Hier steht, was
er gefunden hat und was daraus geworden ist, damit der **zweite** Pass nicht
dieselben Löcher suchen muss.

### Das sechste Kriterium, das oben fehlt

Die fünf Kriterien weiter oben sind nicht falsch, aber sie waren unvollständig:
**Keines von ihnen fragte, ob der echte Kern die Werkzeugdefinition überhaupt
annimmt.** Genau dort lag der Absturz.

Sechstes Kriterium, ab jetzt bei jedem solchen Patch:

> **Nimmt der echte `defineTool` die Definition an?** Nicht „sieht richtig aus“,
> sondern gemessen: den `defineTool` aus der Installation laden, `apply` mit
> einem Cordis-Kontext aufrufen und zählen, wie viele Werkzeuge ankommen.
> Erwartet: zwei, `team_anruf` und `team_anrufe`.

Der Grund, warum das nötig ist: Die Schema-Sprache des Kerns verlangt bei jedem
Objekt ausdrücklich `additionalProperties: true` oder `false`. Fehlt es, wirft
`defineTool` — und wenn die Registrierung in einer asynchronen Selbstausführung
ohne `catch` steht, wird daraus eine unbehandelte Ablehnung, und Node beendet den
Host mit Exit 1. Ein Patch, der aussieht wie eine Funktion, tötet dann `dsh web`
beim Start.

### Die Befunde und ihre Behebung

| Befund | Behebung | Test, der jetzt scheitern kann |
|---|---|---|
| **HOCH-1** Schema ungültig, Ablehnung unbehandelt → Host-Exit | `additionalProperties: true`; Registrierung in `try/catch` mit Meldung; `.catch` an der Selbstausführung | „der ECHTE defineTool nimmt beide Werkzeuge an“ |
| **HOCH-2** `naechsteId` hinter vergebenen Kennungen → ein `schliessen` traf mehrere Einträge | `naechsteFreieNummer` beim Laden; Kollision wird laut abgelehnt; `ersetzeErsten` statt `map` | „die naechste Kennung liegt nie hinter einer vergebenen“, „ein schliessen trifft nur EINEN Eintrag“ |
| **MITTEL-3** ein kaputtes Feld machte die ganze Suche unbrauchbar | `normalisiereEintrag` beim Laden: `stichworte`, `forks`, `begonnen`, `zusammenfassung` | „kaputte Zusatzfelder machen die Suche nicht kaputt“ |
| **MITTEL-4** verworfener Eintrag verschwand spurlos | `protokolliere` nach `~/.dsh/.tm/teams-plus/logs/team-anruf.log`, wie beim Brett | „ein verworfener Eintrag steht im Protokoll“ |
| **NIEDRIG-6** Sperr-Test konnte nicht scheitern | zehn **echte Kindprozesse**; die Sperre wird über `apply(ctx, { sperre })` hereingereicht und im Werkzeugpfad gemessen | „… und der Werkzeugpfad benutzt die Sperre“ |
| **NIEDRIG-7** Rauchtest prüfte nur `typeof apply` | derselbe Test wie HOCH-1: echter Rahmen, echter `apply`, echter Aufruf | siehe oben |
| **NIEDRIG-10** stilles Nichts ohne `defineTool` | Meldung ins Protokoll; `ladeKern` mit Installations-Rückfall wie beim Brett | sichtbar im Protokoll |

### Was ausdrücklich NICHT geändert wurde

- **`warning`-Feld:** Der Auftrag an den ersten Pass behauptete, § 6b verlange
  eines. Das war falsch. § 6b verlangt „laut gemeldet, nicht als leeres
  Verzeichnis“ — das Modul wirft und antwortet mit `ok: false` samt Pfad und
  Grund. Kein Feld ergänzt.
- **Wer schließen darf (MITTEL-5):** offen. Die Spec entscheidet es nicht.
- **Umlaut-Faltung (NIEDRIG-8):** offen.
- **`stand: abgebrochen` (NIEDRIG-9):** in der Spec, aber von keiner Aktion
  erreichbar. Offen.

### Stand

`npm test`: **214/214 grün**. Fünf Mutationen wurden gefahren (Schema-Feld
entfernt, Sperre umgangen, Kennungsrechnung zurückgedreht, Normalisierung
ausgelassen, Protokoll stummgeschaltet); jede machte den zugehörigen Test rot.

**Eingebaut ist weiterhin nichts.** Der zweite Pass steht aus.
