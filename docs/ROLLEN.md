# Rollen und Begriffe

Stand: 2026-10-31. Festgelegt im Gespräch mit dem Menschen. Ersetzt die ungenauen Bezeichnungen
in `TEAM-ARBEITSWEISE.md`, wo noch von „Teamlead" und „Facharbeiter" die Rede war.

## Die drei Ebenen

| Agent Teams (englisch) | Deutsch | Was es ist | Verrichtet Arbeit? |
|---|---|---|---|
| **Team Lead** | **Abteilungsleiter** | Die Session, mit der der Mensch spricht. Schnittstelle zu Mensch, eigener Arbeitsgruppe und anderen Abteilungen. | **Nein** |
| **Teammate** | **Arbeitsgruppenleiter** = **Experte** | Spezialist für *einen* Fachbereich. Führt sein Team aus Facharbeitern. | **Nein** |
| **Sub-Agent** | **Facharbeiter** | Bekommt Aufträge derselben Art von seinem Arbeitsgruppenleiter und führt sie aus. | **Ja** |

„Arbeitsgruppenleiter" und „Experte" sind **dasselbe**. Das eine beschreibt die Funktion in der
Struktur, das andere die Qualifikation. Beide Wörter dürfen benutzt werden.

**Der wichtigste Satz:** Der Arbeitsgruppenleiter ist **kein Arbeiter**. Er ist der Chef einer
Arbeitsgruppe, die die Arbeit macht. Wenn er anfängt zu arbeiten, fehlt er als Chef.

## Was ein Wegwerf-Sub-Agent ist — und was nicht

Ein **Einmal-Helfer** ist ein Sub-Agent, der einen Auftrag erledigt und danach nicht mehr gebraucht
wird: eine Recherche, ein Nachschlagen, ein einzelner Umbau.

Ein **Facharbeiter** ist das Gegenteil: eine dauerhafte Session, die *immer wieder Aufgaben derselben
Art* bekommt. Man legt ihn einmal an, wie man in einer Firma jemanden einstellt, und dann bleibt er.

Beides läuft über dasselbe Werkzeug (`subagent`). Der Unterschied ist die **Absicht**, nicht die Technik.

**Die Regel:** Wegwerf-Sub-Agents sind für Einmal-Aufgaben. Für alles, was wiederkehrt oder komplexer
ist, gibt es einen Facharbeiter in der zuständigen Arbeitsgruppe. Wer für jede Kleinigkeit einen neuen
Sub-Agent startet, baut keine Struktur, sondern Müll.

## Die Struktur ist statisch

```
Workspace
└── Abteilung  (= eine Session, ein Projektbereich)
    ├── Abteilungsleiter          ← spricht mit dem Menschen
    └── Arbeitsgruppen            ← je ein Arbeitsgruppenleiter (Experte)
        ├── Arbeitsgruppe „Code"      → Facharbeiter, die Code schreiben
        ├── Arbeitsgruppe „Tests"     → Facharbeiter, die Tests schreiben
        └── Arbeitsgruppe „Red Team"  → Facharbeiter, die angreifen
```

**Angelegt wird sie einmal, am Anfang** — in der Init-Session, aus der Projektbeschreibung heraus.
Danach ist sie **gelockt**.

## Die Sperre

> **Nach der Init-Session wird kein neuer Arbeitsgruppenleiter erzeugt, ohne ausdrückliche Erlaubnis
> des Menschen.**

Der Grund: Ein Arbeitsgruppenleiter ist ein Spezialist für einen Fachbereich und hält einen Platz im
Team. Wer ihn für eine Aufgabe erzeugt, hat keinen Spezialisten eingestellt, sondern eine Aufgabe
verkleidet. Die Struktur verwässert, und nach zehn Aufgaben gibt es zehn „Abteilungen", die keine sind.

**Was ohne Erlaubnis geht:** Ein Arbeitsgruppenleiter legt **Facharbeiter in seiner eigenen Gruppe** an
und wieder ab. Das ist seine Aufgabe — er ist der Chef. Und Einmal-Helfer für One-Shot-Aufgaben sind
frei, solange sie nicht als Struktur missverstanden werden.

**Was der Mensch bestätigen muss:** jede neue **Arbeitsgruppe**. Also jede neue Spezialisierung.

## Die Lücke: Sub-Agents lassen sich nicht löschen

Ein Problem, das der Mensch ausdrücklich genannt hat und das noch keine Lösung hat:

Sub-Agents sammeln sich an. Nach hundert Einmal-Aufgaben stehen hundert inaktive Sub-Agents im
Interface. Sie sind „durch", aber sie sind da, und niemand kann sie entfernen. Das Interface verstopft
mit Erledigtem.

Für **Teammates** gibt es `retire_teammate`: der Platz im Team wird frei, der Datensatz bleibt lesbar.
Für **Sub-Agents** gibt es kein Gegenstück. Das ist eine Lücke im Harness, nicht in unserer Arbeitsweise.

**Nicht entschieden ist, was passieren soll.** Drei Möglichkeiten, mit verschiedenen Folgen:

1. **Wirklich löschen** — der Datensatz verschwindet. Aufräumen ja, aber die Spur ist weg. Wenn ein
   Sub-Agent etwas herausgefunden hat, das später zählt, ist es verloren.
2. **Archivieren** — aus der Liste nehmen, Datensatz behalten und bei Bedarf hervorholbar. Wie
   `retire_teammate` es für Teammates macht.
3. **Automatisch aufräumen** — Einmal-Helfer verschwinden nach einer Frist von selbst. Bequem, aber
   man muss wissen, welche Frist, und ein wichtiger Fund darf nicht mit verschwinden.

**Diese Entscheidung liegt beim Menschen.** Sie ist als Issue festgehalten.

## Was aus dieser Sitzung folgt

Diese Sitzung hat gegen die eigene Regel verstoßen: Sie hat zwei **Teammates** (`fach-kern`,
`fach-tests`) erzeugt, um drei One-Shot-Aufgaben zu erledigen. Nach dieser Ordnung waren das
**Einmal-Helfer**, keine Arbeitsgruppenleiter. Sie werden nach ihrer Aufgabe aus dem Team genommen,
nicht als Struktur geführt.

Der Fehler ist derselbe wie beim Selbstmachen: Die richtige Ebene wurde nicht gewählt.
