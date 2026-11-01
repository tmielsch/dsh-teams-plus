# Backlog — `@tmielsch/dsh-teams-plus`

Stand: 2026-11-01, 16:33. Gepflegt aus dieser Sitzung (`session-e40fe6ab`).

## Wozu diese Datei

Die Frage war: *„Hast du einen Backlog für Sachen, die ich nicht direkt beantworte?"* Bis jetzt
nicht — offene Punkte lagen verstreut in `docs/VORLAGE-V0.6.0.md`, im Red-Team-Bericht und in
GitHub-Issues. Das hier ist die eine Liste.

**Die entscheidende Spalte ist „Wer".**

- **A — ich allein.** Kann ohne Rückfrage bearbeitet werden: bauen, messen, Test mit Gegenprobe,
  dokumentieren. Einbau ins laufende Profil bleibt trotzdem an AGENTS.md Regel 1 gebunden
  („Nichts ohne Red Team pass integrieren").
- **H — Mensch.** Braucht eine Entscheidung, die ich nicht erfinden darf: Produktverhalten,
  Eingriff in ein fremdes Paket, Zeitpunkt eines Neustarts, Priorität gegen andere Arbeit.

Wenn eine Zeile auf **H** steht, wird sie **nicht** bearbeitet und **nicht** erneut gefragt. Sie
wartet. Genau dafür ist Issue #14 gedacht (Goal pausiert statt weiterzulaufen).

## A — kann ich allein

**A1–A5 sind erledigt**, belegt in `78c7832` (A1, A2, A4), `737a9a4` (A3, A5) und `48a6c4a`
(Nachtrag zu A5). Offen ist nur noch **A6**.

| # | Was | Woher | Aufwand | Stand |
|---|---|---|---|---|
| A1 | **`paareGedaeschtnis` löschte nach Einfügereihenfolge, nicht nach Alter.** Ein heißes Paar konnte durch 200 andere verdrängt werden; sein Zähler begann dann bei null. Der Red-Team-Bericht hat das nur gerechnet, nicht gemessen. | Red-Team §6 | 1 h | **erledigt** `78c7832` — gelöscht wird jetzt nach **Alter** (Zeitstempel des jüngsten Ereignisses je Paar), nicht nach Einfügereihenfolge. Ein heißes Paar wird nicht mehr durch 200 andere verdrängt. Test `Paar-Buch loescht nach ALTER, nicht nach Einfuegereihenfolge (A1)` samt Gegenprobe (`test/send-to-session.test.mjs:471`, Gegenprobe `:532`) |
| A2 | **`DSH_HOME=""` wurde von `??` nicht abgefangen.** Mit leerer Zeichenkette entstanden relative Pfade (`.tm/teams-plus/…`) im Arbeitsverzeichnis. Aus dem Code abgeleitet, nicht gemessen. | Red-Team §6 | 30 min | **erledigt** `78c7832` — die leere Zeichenkette fällt auf das echte Home zurück, relative Pfade entstehen nicht mehr; Leerraum zählt ebenfalls als nicht gesetzt (`patches/send-to-session.mjs:194-197`). Test `DSH_HOME="" faellt auf das echte Home zurueck, nicht auf einen relativen Pfad (A2)` (`test/send-to-session.test.mjs:782`) |
| A3 | **NIEDRIG-6: die Suite war nicht hermetisch — ein Lauf mit gefälschtem `HOME` schrieb `<HOME>/.dsh/.tm/teams-plus/policies/lokalmodus.md`.** Die frühere Zuordnung („die Installer-Tests") war **falsch**: schuldig waren zwei Tests in `test/policy-host.test.mjs` (Zeilen 343 und 368 vor der Reparatur), die `apply()` ohne eigene Wurzel aufriefen. Der Policy-Store kennt **kein** `DSH_HOME` (`src/policy/store.ts:43` → `datenOrdner(home = homedir())`); die Leitungen in die Ablage sind `TEAMS_PLUS_DATA_DIR` oder `homedir()`. | Red-Team R2 | 1 h | **erledigt** `737a9a4` — repariert über **beide** Haken: `HOME` und `TEAMS_PLUS_DATA_DIR` zeigen auf ein `mkdtemp`-Verzeichnis, gesetzt **bevor** der Projektcode geladen wird; dazu ein Wächter-Test, der beide Zeilen festhält. Gemessen danach: ganze Suite unter gefälschtem `HOME` = **0** Einträge unter `<HOME>/.dsh` (2026-11-01 nachgemessen: 137/137 grün, kein `.dsh` im Testzuhause) |
| A4 | **Test für den Sperrblock-Mechanismus.** Gemessen, aber nicht festgehalten: das Entfernen eines `disabled`-Eintrags schaltet die **laufende** Fassung wieder ein, ohne Neustart. Das ist beim 0.6.0-Einbau fast schiefgegangen. | eigene Messung | 30 min | **erledigt** `78c7832` — die Warnung steht jetzt an der Stelle, wo der Block entfernt wird, und wurde in `docs/EINBAU-UND-RUECKNAHME.md` verschärft |
| A5 | **Prüfen, ob der id-lose Nachrichtenfall überhaupt noch erreichbar ist.** HOCH-1 ist behoben (jede Nachricht hat jetzt eine `id`), aber der Client-Fall aus §6 (zwei id-lose Nachrichten in einem Turn) wurde nie gemessen. | Red-Team §6 | 30 min | **erledigt** `737a9a4` + `48a6c4a` — der Fall ist über **beide** Wege nicht mehr erreichbar (Kern `createUserMessage` und Fallback). Der Kern liefert nachgewiesen UUID-Kennungen (`dsh-llm` → `createMessage` → `id: brandString(randomUUID())`, `dsh-llm/lib/index.js:37-40`). Zusätzlich gehärtet: `baueNachricht` prüft jetzt das **Ergebnis** des Kernaufrufs, nicht nur die Existenz der Funktion — ein künftiger Kern, der `createUserMessage` ohne `id` exportiert, käme nicht mehr durch (`patches/send-to-session.mjs:641`; Tests `:163` und `:215`, dazu `test/nachricht-kern-id.test.mjs`) |
| A6 | **Die Rollentexte `rollen/abteilungsleiter.md` und `rollen/arbeitsgruppenleiter.md` sind live, ohne Red-Team-Pass.** `~/.dsh/rollen` zeigt über zwei Symlinks auf dieses Repo (`~/.dsh/rollen` → `~/.dsh/.tm/teams-plus/rollen` → `<repo>/rollen`); deshalb stehen die Dateien aus `e41e482` ab sofort vor jedem Auftrag ihrer Rolle. Der Commit-Text sagt „Noch NICHT installiert" — durch die Symlink-Kette ist das falsch. Einbau ohne Pass ist ein **Verstoß gegen Regel 1**. | eigene Sitzung | — | **offen — Pass läuft.** Solange der Red-Team-Pass läuft, gilt der Einbau nicht als abgenommen; danach entweder den Pass nachtragen oder die beiden Texte zurücknehmen |

## H — wartet auf den Menschen

| # | Was | Warum H? | Stand |
|---|---|---|---|
| H1 | **NIEDRIG-4: der Client zeigt eine `plugin:`-Nachricht als menschliche Anfrage.** Die Herkunft trägt nur der Nachrichtentext. Ein sauberer Fix gehört in `dsh-client-ui-chat` — ein **fremdes** Paket. Das fasse ich nicht ohne ausdrückliche Freigabe an. | Eingriff in fremdes Paket | offen |
| H2 | **Issue #14: Goal pausiert, wenn eine Frage offen bleibt.** Die Änderung sitzt im Kern (`dsh-tool-goal` / Runden-Treiber), nicht in diesem Repo. | Kernänderung | offen |
| H3 | **Ob `stille-nachrichten` so bleiben soll.** Nach der Drossel: 20 Zeilen/s, Summenzeile bei Ruhe. Ob die Menge jetzt passt, entscheidet der Mensch am Protokoll. | Produktverhalten | offen |
| H4 | **Die 16 offenen Issues in `tmielsch/DSH-Verwaltung`.** Sie betreffen Anweisungsdateien, Workflow und Repo-Namen — ein ganzer Stapel eigener Arbeit. Ob und in welcher Reihenfolge der abgearbeitet wird, ist eine Prioritätsfrage. | Priorität | offen |
| H5 | **Der nächste Schritt für `send_to_session` selbst.** Läuft seit 07:36 live (0.6.0). Ob es weitere Runden braucht oder erst einmal beobachtet wird, entscheidet der Mensch. | Produktentscheidung | offen |

## Was ausdrücklich erledigt ist (damit es nicht wieder auftaucht)

- **A1–A5** — siehe Tabelle oben; jeder Punkt trägt dort seinen Stand mit Commit.
- **v0.4.0 gesperrt** (`docs/STOPP-V0.4.0.md`), **v0.6.0 eingebaut und live** seit 2026-10-31 07:36.
  Beweis: Werkzeugliste zeigt `mode.enum = ["auto","steer","followup"]`, neuer Protokollpfad
  `~/.dsh/.tm/teams-plus/logs/` wird beschrieben, `send_to_session` listet die lebenden Sitzungen
  über `ordner` (nicht mehr über das tote `title`).
- **Red-Team-Runde 2** — Freigabe mit Auflagen; beide HOCH-Befunde und alle MITTEL behoben
  (`342647c`), jede Reparatur mit einer Gegenprobe, die sie rot macht.
- **M1** (Lost Update) — Dateisperre, gemessen 1/5 ohne, 5/5 mit.
- **M3** (Logpfad), **M5** (doppelte Kaskaden-Regel) — erledigt in `cb5c7db`.
- **NIEDRIG-1, -2, -3, -5** — erledigt in `f28d4f8`.
- **NIEDRIG-6** — erledigt in `737a9a4`, siehe A3 in der Tabelle oben; die alte Zuordnung war falsch.
- **Issue #10** — die Lehre „ein Prüfer, der die geprüfte Stelle nicht erreicht, ist kein Beweis"
  ist als Issue festgehalten und in jedem Test dieses Repos angewandt.

## Die Regel, die über allem steht

**Nichts ohne Red Team pass integrieren** (`~/.dsh/AGENTS.md`, Regel 1). Das gilt auch für A-Punkte:
bauen und messen ja, in ein laufendes Profil einbauen erst nach einem Pass.
