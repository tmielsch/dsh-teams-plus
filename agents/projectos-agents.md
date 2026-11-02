## Projekt-Manager: Namen und Aufträge (dsh-projectOS)

Dieser Abschnitt gehört zum Plugin `dsh-projectOS` und kommt aus der Datei `agents/projectos-agents.md`
im Repo `tmielsch/dsh-projectOS`. Er wird nur dort geändert. Wo frühere Anweisungen regeln, wie ein Agent
benannt, beschrieben oder beauftragt wird, **gilt dieser Abschnitt**.

**Warum es ihn gibt.** Der Projekt-Manager zeigt jede Abteilung als Brett: oben die Gruppenleiter, darunter
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
und ist Teil seiner Sitzung. Der Projekt-Manager zeigt sie **noch nicht** an: die Team-Projektion, die der
Browser liest, trägt für Mitglieder nur Name, Rolle und Zustand. Trotzdem gehört sie sauber ausgefüllt, weil
sie die einzige Stelle ist, an der das Gebiet des Gruppenleiters steht.

### 5. Es wird mit gemeinsamen Aufgaben gearbeitet

Der Projekt-Manager zeigt, was in den **gemeinsamen Aufgaben des Agent-Teams** steht (Werkzeuge `team_task_create`,
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
   Tätigkeit, ersetzt er **diese eine Zeile**, er hängt keine weiteren an. Der Projekt-Manager zeigt sie auf der Karte; der
   Mensch sieht so ohne Nachfrage, was gerade geschieht. Beim Abschließen entfernt er die Zeile oder ersetzt sie durch das
   Ergebnis in einem Satz.
4. **Abhängigkeiten stehen in `blocked_by`**, nicht in Prosa. Wer auf eine andere Aufgabe wartet, sagt es dort.
5. **Facharbeiter (`delegate_task`) haben keine eigenen Aufgaben.** Sie arbeiten im Auftrag ihres Gruppenleiters; die
   Aufgabe, zu der ihr Auftrag gehört, steht im Auftragstext (`Aufgabe: <ID>`), und der Gruppenleiter bucht das
   Ergebnis dort.
6. **Wer etwas Zusätzliches anlegt, sagt es.** Ändert eine Aufgabe ihren Umfang, geschieht das mit `action: "edit"`.

**Der Mensch darf das überschreiben.** Sagt er ausdrücklich, dass für eine Arbeit keine Aufgaben nötig sind oder dass
sie anders geführt werden sollen, gilt sein Wort. Hat er etwas vor, das dazu nicht passt, nennt der Agent ihm in
**einem Satz**, wie es vorgesehen ist („Normalerweise lege ich zuerst eine Aufgabe an, damit sie im Projekt-Manager
erscheint; soll ich das hier weglassen?“) und folgt dann seiner Antwort. **Fragt der Mensch, wie alles zusammenspielt,**
erklärt der Agent es vollständig und in ganzen Sätzen: Abteilung = Teamsitzung mit Abteilungsleiter; Arbeitsgruppe =
Gruppenleiter mit seinen Facharbeitern; gemeinsame Aufgaben = Stand der Arbeit, den der Projekt-Manager anzeigt;
Facharbeiter = Unteragenten, die im Auftrag des Gruppenleiters arbeiten.

### 6. Was der Projekt-Manager nicht ändert

Rollen (`rolle` bei `delegate_task`), Specs, Ziele und Abnahmen laufen wie zuvor. Dieser Abschnitt regelt nur
Namen, Titelzeile, die Einordnung in Spalten und den Umgang mit gemeinsamen Aufgaben.
