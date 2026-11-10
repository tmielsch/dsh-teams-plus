## Teams Plus: Namen und Aufträge (dsh-teams-plus)

Dieser Abschnitt gehört zum Plugin `dsh-teams-plus` und kommt aus der Datei `agents/teams-plus-agents.md`
im Repo `tmielsch/dsh-teams-plus`. Er wird nur dort geändert. Wo frühere Anweisungen regeln, wie ein Agent
benannt, beschrieben oder beauftragt wird, **gilt dieser Abschnitt**.

**Warum es ihn gibt.** Teams Plus zeigt jede Abteilung als Brett: oben die Gruppenleiter, darunter
ihre Facharbeiter, daneben die Hilfsarbeiter des Abteilungsleiters. Eine Karte trägt, was der Aufrufer beim
Starten angegeben hat. Fehlt das, sieht der Mensch nur den Anfang des ersten Auftragstextes, und bei 80
Karten ist das unlesbar (Beleg 2026-10-28: „<system-reminder> You are …“ und „ERSTER SATZ: Du arbeitest“
auf fast jeder Karte). Der Mensch (2026-10-28): *„es muss halt benannt werden“.*

### 1. Das Feld `description` ist der Name der Karte

Jeder Aufruf von `delegate_task` und `spawn_teammate` füllt `description` mit einem **Namen für die Aufgabe**:

- drei bis fünf Wörter, in der Sprache des Menschen, ohne Satzzeichen am Ende und ohne Markup;
- sagt, **was** getan wird, nicht **wer** es tut: „Kehlbleche Gauben prüfen“, nicht „Red-Team“ oder „Helfer“;
- unterscheidbar von den anderen Karten derselben Gruppe: zwei Karten mit gleichem Namen sind ein Fehler;
- nie ein Anfang des Auftragstextes, nie `<system-reminder>`, nie „ERSTER SATZ“, nie eine Sitzungs-ID.

Beispiele, richtig: „Plan gegen Spec prüfen“, „Brückenfehler Blick melden“, „Kantenprojektion messen“.
Beispiele, falsch: „Du bist ein Facharbeiter …“, „## ERSTER SATZ“, „Task“, „Helper“.

### 2. Die erste Zeile des Auftrags ist ein Titel

Der Titel einer Sitzung entsteht aus den ersten Wörtern ihres ersten Auftrags. Deshalb beginnt **jeder**
Auftrag an einen Unteragenten oder ein Teammitglied mit einer eigenen Zeile:

```text
Titel: <derselbe Name wie in description>
```

Danach folgen alle anderen Blöcke, die ein Projekt vorschreibt (zum Beispiel der Block „ERSTER SATZ“ oder
„Grundkonzept“). Die Titelzeile ersetzt sie nicht und wird von ihnen nicht verdrängt: Sie steht **davor**.
Wo ein Projekt verlangt, dass „jeder Auftrag mit diesem Block beginnt“, gilt das für den Inhalt **nach** der
Titelzeile.

### 3. Wer in welcher Spalte steht

- **Gruppenleiter** (Teammitglieder) heißen so, wie sie beim Starten genannt wurden (`name`). Sie sind die
  Einzigen, die „auf einen Auftrag warten“.
- **Facharbeiter** (Unteragenten eines Gruppenleiters) und **Hilfsarbeiter** (Unteragenten des Abteilungsleiters)
  arbeiten oder sind fertig. Wer fertig ist, wird nicht „wartend“ gehalten, nur damit die Karte stehen bleibt.
- **Bestehende Facharbeiter werden weiterbenutzt** (Regel „Rollen“ in dieser Datei weiter oben): Ein weiterer
  Auftrag an dieselbe Karte per `send_message` ist besser als ein neuer Unteragent. Wer einen neuen startet,
  gibt ihm einen eigenen, neuen Namen nach Punkt 1.

### 4. Was in die Beschreibung eines Gruppenleiters gehört

`spawn_teammate` verlangt eine `description`. Beim Gruppenleiter ist sie keine Aufgabe, sondern sein
**Aufgabengebiet** in einem Satz („STRATA-HDA: Wandmodule, Ecken, Projektion“). Sie wird im Team gespeichert
und ist Teil seiner Sitzung. Teams Plus zeigt sie **noch nicht** an: die Team-Projektion, die der
Browser liest, trägt für Mitglieder nur Name, Rolle und Zustand. Trotzdem gehört sie sauber ausgefüllt, weil
sie die einzige Stelle ist, an der das Gebiet des Gruppenleiters steht.

### 5. Es wird mit gemeinsamen Aufgaben gearbeitet

Teams Plus zeigt, was in den **gemeinsamen Aufgaben des Agent-Teams** steht (Werkzeuge `team_task_create`,
`team_task_list`, `team_task_get`, `team_task_update`). Ohne sie bleibt das Brett leer: Es zeigt „0 offene Aufgaben“
und „keine Aufgabe übernommen“ (Beleg 2026-10-28), obwohl 17 Gruppenleiter arbeiten. Deshalb gilt:

1. **Der Abteilungsleiter legt die Aufgabe an, bevor er den Gruppenleiter einstellt.** Erst `team_task_create`
   (Titel = Name nach Punkt 1, Beschreibung mit Abnahme, bei Bedarf `blocked_by` und `write_scopes`), dann
   `spawn_teammate`. Der Auftrag an den Gruppenleiter nennt die Aufgaben-ID.
2. **Der Gruppenleiter übernimmt sie als Erstes** (`team_task_update` mit `action: "claim"` und der aktuellen
   `expected_revision`), und er **schließt** sie (`action: "complete"`), wenn die Abnahme erfüllt ist. Er legt für
   größere Teilschritte eigene Aufgaben an, statt sie nur im Verlauf zu erwähnen.
3. **Der Live-Stand: eine Zeile, die sagt, woran du gerade arbeitest.** Nach dem Übernehmen liest der Gruppenleiter die
   Aufgabe einmal ganz und schreibt dann **eine** Zeile an den Anfang ihrer Beschreibung: `Stand: <was ich gerade genau
   tue, ein Satz>` (`team_task_update` mit `action: "edit"`, die übrige Beschreibung bleibt unverändert). Ändert sich die
   Tätigkeit, ersetzt er **diese eine Zeile**, er hängt keine weiteren an. Teams Plus zeigt sie auf der Karte; der
   Mensch sieht so ohne Nachfrage, was gerade geschieht. Beim Abschließen entfernt er die Zeile oder ersetzt sie durch das
   Ergebnis in einem Satz.
4. **Abhängigkeiten stehen in `blocked_by`**, nicht in Prosa. Wer auf eine andere Aufgabe wartet, sagt es dort.
5. **Facharbeiter (`delegate_task`) haben keine eigenen Aufgaben.** Sie arbeiten im Auftrag ihres Gruppenleiters; die
   Aufgabe, zu der ihr Auftrag gehört, steht im Auftragstext (`Aufgabe: <ID>`), und der Gruppenleiter bucht das
   Ergebnis dort.
6. **Wer etwas Zusätzliches anlegt, sagt es.** Ändert eine Aufgabe ihren Umfang, geschieht das mit `action: "edit"`.

**Der Mensch darf das überschreiben.** Sagt er ausdrücklich, dass für eine Arbeit keine Aufgaben nötig sind oder dass
sie anders geführt werden sollen, gilt sein Wort. Hat er etwas vor, das dazu nicht passt, nennt der Agent ihm in
**einem Satz**, wie es vorgesehen ist („Normalerweise lege ich zuerst eine Aufgabe an, damit sie in Teams Plus
erscheint; soll ich das hier weglassen?“) und folgt dann seiner Antwort. **Fragt der Mensch, wie alles zusammenspielt,**
erklärt der Agent es vollständig und in ganzen Sätzen: Abteilung = Teamsitzung mit Abteilungsleiter; Arbeitsgruppe =
Gruppenleiter mit seinen Facharbeitern; gemeinsame Aufgaben = Stand der Arbeit, den Teams Plus anzeigt;
Facharbeiter = Unteragenten, die im Auftrag des Gruppenleiters arbeiten.

### 7. Wie miteinander gesprochen wird

**Diese Datei verspricht es oben, und bis zum 2026-11-04 stand es hier nicht** — wer den Zeiger aus
`AGENTS.md` las, fand nur Namen und Karten. Deshalb steht es jetzt hier.

**Die Regel, die am meisten Zeit spart: Regeln reisen in Dateien, nicht in Nachrichten.**

Eine geänderte Projektregel gehört in die Spec oder in `AGENTS.md`, mit Datum und im Wortlaut des
Menschen. Sie wird **nicht** an die Teammitglieder geschickt. `AGENTS.md` wird in jede Sitzung
injiziert; eine Nachricht erreicht eine Sitzung, einmal, und kostet zwei Turns. Der Mensch hat das
am 2026-11-04 angeordnet, wörtlich: *„Einfach nur sinnloser Bloat."*

**Was eine Nachricht ist:**
Im Team-Modus (Abschnitt „Der Team-Modus“ unten) gibt es **vier Kanäle**, und `send_message` an Teammitglieder ist abgelehnt:
- `ask_question` — eine konkrete Frage an genau eine Sitzung (auch an den Menschen), ohne Ziel und ohne Meldung nach oben;
- `give_task` — ein Auftrag an den, der ihn ausführt; **ohne Zielbrief und Rundenbegrenzung kein Auftrag**;
- `goal_report` — das Ergebnis an den Vorgesetzten, mit Beleg (Pfad, Messung, Prüfsumme); Pflicht vor `update_goal(complete)`;
- die gemeinsamen Aufgaben (`team_task_*`) — Task-Updates bleiben.

Außerhalb des Team-Modus gilt die bisherige Liste mit `send_message`: eine konkrete Frage an genau eine Sitzung, ein Auftrag an den, der ihn ausführt, ein Ergebnis an den Vorgesetzten mit Beleg — an ihn, nicht an das ganze Team.

**Was keine Nachricht ist:**
- eine Regeländerung, ein Rundruf, „zur Info",
- die Bestätigung, dass man etwas bekommen hat („habe ich bekommen") — das ist eine Nachricht an
  niemanden,
- das Weiterreichen einer Nachricht, weil man selbst sie erhalten hat,
- eine Betriebs-Banalität: „Worker ist geweckt", „Datei kopiert", „Befehl ausgeführt", „Neustart gemacht".
  Das ist die Ausführung eines Befehls, kein Ergebnis — der Absender hat den Befehl gegeben und plant mit ihr.

**Befehle werden ausgeführt, nicht bestätigt** (Anordnung des Menschen 2026-11-06, wörtlich: *„für jeden
verschissenen Befehl auch noch eine Bestätigung die ganze Kette wieder rauf zu schicken, nur um im Worst
Case wieder eine Antwort auf die Antwort nach unten zu triggern"*).

- **Ein Befehl wird ausgeführt, und Schweigen heißt: erledigt.** Weist der Team Lead einen Abteilungsleiter
  an, einen Worker zu wecken, dann weckt der Leiter ihn und meldet **nichts** zurück. Keine „habe ich
  gemacht"-, keine „verstanden"-, keine „danke"-Nachricht, weder hinauf noch hinunter.
- **Gemeldet wird nur, was nicht geschah** (einmal, an den Absender, mit Grund und Beleg) **oder ein Ergebnis,
  das der Auftrag verlangt hat** (Plan, Messung, Bild, Pfad). Der Empfänger, der einen Befehl für falsch oder
  unausführbar hält, sagt das einmal, statt still abzuweichen.
- **Ein Bericht wird nicht beantwortet,** außer er enthält eine Frage oder verlangt eine Entscheidung.
- **Warum:** `send_message` liefert die Zustellbestätigung (`messageId`) im selben Turn selbst; eine Quittung des
  Empfängers kostet zwei Turns und meldet nichts Neues. Wer mehr wissen will, fragt das System
  (`list_agents`, eine Datei), nicht den Agenten.
- **Beide Hälften gehören zusammen:** Wer sich auf Schweigen verlässt, muss sich darauf verlassen können,
  dass ein Scheitern nie still bleibt. Ein Agent, der abstürzt, bevor er das Scheitern melden konnte, meldet
  nichts: wer etwas Wichtiges von einem Befehl abhängig macht, prüft die Wirkung am System (Status, Datei,
  Prüfsumme), nicht beim Empfänger.

**Wer mit wem:** innerhalb einer Abteilung frei; abteilungsübergreifend
über die Abteilungsleiter; eine Frage („sitzt jemand an diesem Thema?") ist die einzige Sache, für
die es später einen direkten Weg geben soll.

**Was das technische Drosseln nicht löst:** `stille-nachrichten` bremst die Menge (20/s plus
Summenzeile). Es bremst nicht die Nachricht, die man besser gar nicht geschickt hätte. Das leistet
nur diese Regel.

### 8. Der Team-Modus

*Dieser Abschnitt beschreibt das Plugin-Modul `team-modus` (Bundel 0.8.5). Was dort steht, ist gebaut und in der Probe-Instanz gemessen; was nicht gemessen oder nicht gebaut ist, steht ausdrücklich dabei.*

**Wann er gilt.** Für einen Agenten gilt der Team-Modus, wenn zu seinem Team mindestens ein Teammitglied gehört, das läuft, ruht oder gerade angelegt wird, und der Notschalter nicht gesetzt ist. Außerhalb davon, also bei ganz normaler Nutzung von DSH, ändert sich nichts.

**Der Notschalter.** Die Datei `~/.dsh/.tm/teams-plus/team-modus.json` mit dem Inhalt `{"aus": true}` schaltet den Team-Modus sofort ab, ohne Neustart. Eine Datei, die sich nicht lesen lässt, zählt als „aus“ (lieber das alte Verhalten als ein halbes neues). Das Protokoll steht in `~/.dsh/.tm/teams-plus/logs/team-modus.log`.

**Meldungen.**
- Die Meldung „… finished and will do no further work …“, die der Kern einem Vorgesetzten schickt, sobald ein Unteragent zur Ruhe kommt, wird verworfen, nicht aufgehoben. Sie weckt niemanden mehr.
- Echte Fehler bleiben laut: „stopped“, „failed“, „ran out of room“, „declined“ und jede unbekannte Form kommen an. Task-Updates und alle Nachrichten des Menschen kommen immer an.
- **Ein Ziel wird nur mit Bericht abgeschlossen:** `update_goal(complete)` ohne vorher geschriebenen `goal_report` wird abgelehnt. Der Bericht geht genau einmal an den Vorgesetzten; ein Ziel auf „blocked“ wird ebenfalls gemeldet.

**Wenn der Mensch einem Mitglied schreibt (Gesprächsübernahme).**
- Das Ziel des Mitglieds wird angehalten, nicht abgebrochen: Eine gerade laufende Runde läuft zu Ende, danach startet keine neue. Das Ziel wird zuerst entwaffnet, die Pause folgt am Rundenende.
- Der Vorgesetzte bekommt **eine** Meldung: „Mensch hat Kommunikation mit Agent <Name> übernommen, stand by“. Weitere Nachrichten des Menschen an dasselbe Mitglied lösen keine weitere Meldung aus. Beim Gespräch mit einem Facharbeiter geht die Meldung an den Experten, nicht an den Lead.
- Wer auf ein angehaltenes Mitglied wartet, hält sich daran: Ein angehaltenes Ziel setzt kein Agent fort. Nur der Mensch setzt es fort.
- Wenn der Mensch das Ziel fortsetzt, geht **eine** Meldung an den Vorgesetzten: „Mensch hat <Name> freigegeben, Ziel lautet jetzt: <aktueller Wortlaut des Ziels>“. Auch das Entfernen eines Ziels meldet eine kurze Freigabe.
- **Vergessene Gespräche:** Es gibt keine automatische Freigabe. Die Liste der angehaltenen Mitglieder steht in `~/.dsh/.tm/teams-plus/state/uebernahmen.json`.
- *Nicht gemessen:* ob der Knopf „Fortsetzen“ im Chat eines Teammitglieds funktioniert, und die Nachricht an ein noch lebendes, wartendes Mitglied (gemessen ist sie nur am Attrappen-Modell). Eine weitere Nachricht des Menschen weckt ein vom Kern abgebautes Mitglied wieder.

**Aufträge und Fragen.**
- `give_task` legt das Ziel für den Empfänger an und weckt ihn bei Bedarf. Es wirkt nur nach unten, also auf direkte Teammitglieder und Facharbeiter des Aufrufers.
- `ask_question` ist still: Es erzeugt kein Ziel, bricht kein Ziel ab und meldet nichts nach oben. Eine Frage an `mensch` wird in `~/.dsh/.tm/teams-plus/state/fragen-an-mensch.jsonl` aufgezeichnet. *Folgt:* Eine Anzeige für diese Fragen in der Web-GUI (der „Ticker“) gibt es noch nicht.
- Antworten auf eine Frage nur, wenn man etwas zu sagen hat. Kein Dank und keine Folgeangebote.

### 9. Berater-Fork

Der Mensch kann den Lead forken, um zu diskutieren. Der Fork behält den Kontext des Leads, hat aber ein leeres Team: Er ist eine eigene Wurzelsitzung und nicht im Team-Modus. Er erbt kein Ziel. Seine Rückmeldung an den Lead geht per `send_to_session` und gilt nicht als Gesprächsübernahme.

### 10. Das Werkzeug `team_stand`

`team_stand` liest den Stand der Mitglieder, ohne jemanden zu wecken: je Mitglied das Ziel (Phase, Aktivierung, Runden, der Wortlaut gekürzt), ob ein Bericht vorliegt und die Zeit des letzten Ereignisses. Der Lead nutzt es statt Nachfragen und statt Schleifen mit `list_agents`.

### 6. Was Teams Plus nicht ändert

Außerhalb des Team-Modus ändert Teams Plus nichts. Rollen (`rolle` bei `delegate_task`), Specs, Ziele und Abnahmen laufen wie zuvor. Dieser Abschnitt regelt nur
Namen, Titelzeile, die Einordnung in Spalten und den Umgang mit gemeinsamen Aufgaben.
