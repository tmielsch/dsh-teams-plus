# Zielbrief: Plan team_stand nachbessern (2026-11-10 ~20:45, vom Lead)

**Zweck.** Dein Plan (Commit 76d6a25) ist von einem Red-Team gelesen worden; der Mensch hat zwei Fragen entschieden (Issue 143 und 121, jeweils letzter Kommentar). Du arbeitest den Plan nach. Weiter **kein Code**.

**Entschieden (im Plan als gültig eintragen, nicht mehr als offene Frage):**
- O2: team_stand zeigt Unteragenten **auch außerhalb des Team-Modus** (Lesen). Der Satz „Außerhalb des Team-Modus ändert Teams Plus nichts“ in agents/teams-plus-agents.voll.md Abschnitt 6 wird dafür bewusst geöffnet; der Plan nennt, welche Anweisungsstelle beim Einspielen zu ändern ist (nur nennen, nichts ändern).
- O1: Für abgebaute Kinder zeigt die Zeile die Aktivierung als „unbekannt“ (Issue 144 bleibt offen).

**Nachzubessern (Befunde des Red-Teams, mit Datei und Zeile von dem Prüfer; prüfe jeden selbst nach, bevor du ihn einarbeitest):**
1. HOCH: Das von Konzept 5.7 (Zeile 128) und 5.8 (Zeile 134) verlangte Feld „vom Menschen angehalten seit …“ fehlt in Schritt 3 und in der Abnahme. Die heutige Mitgliederzeile (patches/team-modus.mjs um Zeile 473 bis 503) kennt es ebenfalls nicht; die Übernahme-Datei existiert schon (uebernahmenPfad um Zeile 513, umgebung.uebernommen um Zeile 794). Ergänze das Feld im Plan (für Mitglieder und Kinder) und einen Abnahmepunkt.
2. MITTEL: Schritt 2 und 3 sagen nicht, von welchem Dienst die Kinderliste kommt. Die Methoden leben im Dienst subagents (dsh-subagent/lib/index.js um Zeile 2971 und 2989); inject in patches/team-modus.mjs (um Zeile 90) enthält ihn nicht. Beschreibe den Zugang genau und prüfe, ob er in der Fassade über hole(…) wie bei sessionQuery (um Zeile 783) geht.
3. MITTEL: Merge-Angaben zu umsetzung/give-task-brett korrigieren: 298 Ergänzungen und 20 Löschungen in patches/team-modus.mjs (nicht 318 neue Zeilen); main hat zwei Commits, die jener Zweig nicht hat. Miss es selbst nach (git diff main umsetzung/give-task-brett --stat, git log umsetzung/give-task-brett..main).
4. GERING: Drei Prüfpfade nennen Feldnamen falsch: ergebnis_stand2.json heißt das Feld projektionRoh (nicht projektionGoal); in der Treiberdatei stand4_treiber.mjs heißt das Ergebnis parent (Zeile 79). Prüfe alle Pfade im Plan gegen die Dateien.
5. GERING: Abnahme 2 prüft nur den Weg in den Zustand blocked. Ändere den Sollwert auf „letzte Phase vor dem Abbau gleich Phase aus der Datei“, und nimm zusätzlich ein totes Kind mit Phase paused auf.
6. GERING: Es fehlt eine Summen-Zeitgrenze (60 Kinder mal 5 Sekunden je Sitzung sind im Extremfall 300 Sekunden). Schlage eine Obergrenze für die Gesamtdauer vor und eine Zeile „Zeitgrenze erreicht“.
7. GERING: Der Fall „abgebautes Zwischeneltern“ (U-a) ist ungemessen. Miss ihn in der Probe-Instanz (listChildren auf einem abgebauten Experten, Kinder darunter) oder schreibe ausdrücklich „nicht Teil dieses Plans“ mit Begründung. Prüfe dabei auch die Verdachtsfrage: liefert der Kern (dsh-subagent/lib/types/list-children.js um Zeile 67) auf einer toten Eltern-Sitzung eine Projektion oder einen leeren Katalog?

**Grenzen.** Du arbeitest im Worktree /Users/tmielsch/dsh-teams-plus/.worktrees/umsetzung-team-stand-unteragenten (Zweig umsetzung/team-stand-unteragenten), nur docs/. Kein Code, kein Merge, kein Push, keine Anweisungsdatei, kein Profileintrag, keine Bundelversion. Kein Neustart und kein Stoppen von Diensten (absolutes Verbot); dsh web und ~/.dsh/profiles/web bleiben unberührt. Messen nur in der Probe-Instanz /tmp/teams_plus_umbau/probe, danach Prozesszähler 0. Zugangsdaten nie anzeigen. Bei Zweideutigkeit fragen. Jeden neuen Fund sofort als Issue in tmielsch/DSH-Verwaltung mit Art-Label und triage. Prüfe jede Meldung vor dem Senden auf fremde Wörter.

**Abnahme.** Jeder der sieben Punkte ist im Plan eingearbeitet oder mit Begründung abgelehnt; alle Zahlen tragen ein Etikett (MESSUNG, FORMEL, SCHÄTZUNG); offene Fragen an den Menschen stehen nur dort, wo wirklich noch eine zu entscheiden ist, mit der Wirkung zuerst. Kleiner Commit je logischem Schritt.

**Meldepflicht.** Bericht per send_message an den Lead, wenn der nachgebesserte Plan committed ist oder wenn du eine Entscheidung des Menschen brauchst. Rundenbegrenzung: höchstens 20.
