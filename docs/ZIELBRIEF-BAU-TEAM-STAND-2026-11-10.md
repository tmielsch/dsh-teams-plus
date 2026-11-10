# Zielbrief Bau: team_stand für Unteragenten (2026-11-10 ~23:55, vom Lead)

**Zweck.** Der Mensch hat den Plan abgenommen (Issue 143 und 121, letzter Kommentar, Wortlaut dort). Du baust ihn. Übergeordnet: Der Lead muss zu jedem von ihm beauftragten Agenten lesen können, ob er ein Ziel hat, in welcher Phase es ist und ob der Mensch ihm geschrieben hat (Issue 143, 144, 147).

**Gegenstand.** Setze genau um, was in `docs/PLAN-TEAM-STAND-UNTERAGENTEN.md` steht, in dem Worktree /Users/tmielsch/dsh-teams-plus/.worktrees/umsetzung-team-stand-unteragenten auf dem Zweig `umsetzung/team-stand-unteragenten`. Lies den Plan VOLLSTÄNDIG, auch die Messberichte `docs/messung-team-stand-unteragenten/ERWARTUNG-2026-11-10.md` und `ERGEBNIS-2026-11-10.md`, bevor du eine Zeile änderst. Der Plan trägt: die Schritte (Abschnitt 5), die Abnahmen (Abschnitt 7), die entschiedenen Fragen O1 bis O4 (Abschnitt 8), die Grenzen (Abschnitt 9) und die Funde der Prüfungen (Abschnitt 10, 10a, 10b). Entschieden vom Menschen, nicht mehr zu diskutieren: Anzeige auch außerhalb des Team-Modus; Aktivierung bei abgebauten Kindern als „unbekannt“; höchstens 60 Kinder und 120 Sekunden Gesamtzeit; Darstellung gruppiert je Mitarbeiter (Feld `untergruppen`).

**Der Plan nennt Annahmen, die sich nicht von selbst verstehen.** Prüfe jede Annahme, die du brauchst, zuerst an der genannten Datei und Zeile. Trägt eine nicht, melde es an den Lead, bevor du weiterbaust, und rate nicht. Der Plan beschreibt die Ebene des großen Ganzen; die Handgriffe, Namen im Code und die Tests findest du als Facharbeiter selbst. Verwende vorhandene Helfer in `patches/team-modus.mjs` weiter (Fassade `hole`, `beobachte`, `ziel`, `agenten`, die Übernahme-Datei `uebernahmenPfad`), statt Gleiches neu zu schreiben.

**Grenzen.**
- Nur schreiben in: `patches/team-modus.mjs`, `test/` (neue Datei nach Muster der vorhandenen, zum Beispiel `test/team-stand-unteragenten.test.mjs`), `docs/` (Messbericht ergänzen). Sonst nichts.
- Kein Merge, kein Push, kein Eintrag in `cordis.patch.yml`, keine Bundelversion, kein Tag, keine Änderung an der Anweisungsdatei `agents/teams-plus-agents.voll.md` (das Einspielen und die Satzänderung O2 macht der Lead später in eigenen Commits nach der Reihenfolge aus Plan Abschnitt 6).
- Der Zweig `umsetzung/give-task-brett` ändert dieselbe Datei; lies ihn nur zum Verständnis (git show, git diff), ändere ihn nie.
- Kein Neustart und kein Stoppen von Diensten (absolutes Verbot). Das laufende `dsh web` (Port 3080) und `~/.dsh/profiles/web` bleiben unberührt. Messen nur in der Probe-Instanz unter `/tmp/teams_plus_umbau/probe` (Attrappen-Modell); danach Prozesszähler 0.
- Zugangsdaten nie anzeigen, auch nicht maskiert. Bei Zweideutigkeit fragen, nie die destruktive Wahl. Jeden neuen Fund sofort als Issue in tmielsch/DSH-Verwaltung mit Art-Label und `triage`. Keine eigene Anhebung deines Rundenlimits; wirst du blockiert, melde es dem Lead.
- Prüfe jede Meldung vor dem Senden auf fremde Wörter.

**Anweisungen.** Kleine Commits, ein logischer Schritt je Commit, Beschreibung auf Deutsch mit dem Bezug zu Plan-Schritt und Issue. Teste jede Änderung gegen eine Gegenprobe, die rot wird, wenn der Bau falsch wäre (Plan Abschnitt 7 sagt, welche). Lies vor dem Bauen auch den Messbericht, damit du Messungen nicht wiederholst, die schon in einer Datei stehen.

**Abnahme.** (1) Die gesamte Testsuite läuft grün (Stand von main 258 Tests; der Plan-Zweig hat denselben Ausgangsstand), neue Tests sind dabei. (2) Jede Abnahme aus Plan Abschnitt 7 ist erfüllt, je mit Werkzeug, Sollwert und Messdatei unter `docs/messung-team-stand-unteragenten/`; Zahlen tragen die Etiketten MESSUNG, FORMEL oder SCHÄTZUNG. (3) Lesen weckt niemanden: gemessen als Lead-Züge vor und nach, mit Zählern getrennt nach Sitzungskennung (Plan, Fund T4d). (4) Notschalter gedrückt: Verhalten wie im Plan beschrieben. (5) Prozesszähler der Probe nach dem letzten Lauf 0; `dsh web` PID 35460 unberührt (nur gelesen, nicht angefasst).

**Meldepflichten.** Bericht per send_message an den Lead, wenn alle Abnahmen erfüllt und committed sind, oder früher, wenn eine Annahme des Plans nicht trägt oder du eine Entscheidung des Menschen brauchst. Der Bericht nennt Commit-Hashes, Testzahl, Messdateien und was ungemessen blieb. Der Bericht ist deine letzte Handlung; kein Schlusssatz der Form „ich mache jetzt X“.

**Rundenbegrenzung:** höchstens 40.
