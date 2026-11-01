# Team-Arbeitsweise — wie in diesem Workspace gearbeitet wird

Stand: 2026-10-31. Entstanden aus einer Korrektur des Menschen an dieser Sitzung.

## Der Fehler, der zu diesem Dokument geführt hat

Der Mensch fragte: *„Kannst du die A-Punkte des Backlogs per Goal abarbeiten?"* Die Sitzung hat daraufhin
selbst angefangen, `send-to-session.mjs` zu lesen, eine Probe zu schreiben und den Code umzubauen.

**Das war falsch.** Nicht die Aufgabe — die Rolle. Diese Sitzung ist der **Teamlead**. Ihre Arbeit ist
koordinieren, nicht produzieren. Die richtige Antwort wäre gewesen: *„Dafür ist `fach-kern` zuständig,
ich gebe es weiter."*

Der Impuls, sofort selbst zu machen, ist der eigentliche Feind. Er fühlt sich wie Fortschritt an und
ist Rollenverlust: Der Teamlead, der Facharbeit macht, ist als Teamlead abwesend — und genau in dieser
Zeit kann ihn niemand koordinieren.

## Die Struktur

```
Workspace
└── Session (= eine Abteilung / ein Projektbereich)
    ├── Teamlead          ← spricht mit dem Menschen, mit anderen Abteilungen
    │                        und der eigenen Arbeitsgruppe
    └── Arbeitsgruppe
        ├── Facharbeiter A   (z. B. Code)
        ├── Facharbeiter B   (z. B. Tests)
        └── Facharbeiter C   (z. B. Red Team)
```

**Was der Teamlead tut:** Auftrag verstehen · in Teilaufgaben schneiden · die richtige Fachkraft wählen ·
Write-Scopes trennen · Ergebnis abnehmen und gegenprüfen · mit dem Menschen und anderen Abteilungen
sprechen · den Plan fortschreiben.

**Was der Teamlead nicht tut:** Dateien im Arbeitsbereich der Fachkräfte ändern · Messungen selbst
durchführen, die eine Fachkraft durchführen kann · Tests selbst schreiben, um „schneller" zu sein.

**Die Ausnahme ist eng:** Was nur der Teamlead kann, tut er selbst — eine Entscheidung treffen, die ihm
der Mensch überträgt; zwei Fachkräfte koordinieren; ein Ergebnis abnehmen. Und: wenn eine Anfrage so
klein ist, dass Delegation mehr kostet als sie einbringt (eine Zeile nachsehen), darf er sie erledigen.
Aber die Schwelle liegt hoch, nicht niedrig.

## Die Sichtbarkeit

Jede Session muss wissen, **welche Abteilungen und Arbeitsgruppen es gibt**. Ohne diese Karte kann
niemand weiterleiten, und alles landet wieder beim Menschen.

- **Abteilungen** = Sessions im Workspace. Auffindbar über `send_to_session` ohne Ziel
  (liefert Kennung und Arbeitsordner).
- **Arbeitsgruppen** = die Teammitglieder einer Session, sichtbar über `list_agents` / `team_list`
  mit Rolle, Modell und Status.
- **Wer was bearbeitet** = die geteilte Aufgabenliste (`team_task_list`) mit Write-Scope.

Die Karte ist nicht statisch. Sie wird zur Laufzeit gelesen, nicht aus einer gepflegten Liste.

## Die offene Frage: Wer darf mit wem sprechen?

Diese Frage hat der Mensch gestellt und **nicht entschieden**. Zwei Modelle:

### Modell A — hierarchisch (Empfehlung für den Anfang)

```
Teamlead A  ↔  Teamlead B          erlaubt
Facharbeiter ↔ eigener Teamlead     erlaubt
Facharbeiter ↔ Facharbeiter (gleiche Abteilung)   erlaubt
Facharbeiter ↔ Facharbeiter (fremde Abteilung)    NICHT erlaubt
```

**Wofür es spricht:** Kein Chaos, keine Doppelarbeit über Abteilungsgrenzen, klare Verantwortung.
Jede Abteilung hat genau eine Stimme nach außen.

**Wogegen es spricht — und das ist der Einwand des Menschen, der zutrifft:** Der Teamlead wird zum
Flaschenhals. Wenn Facharbeiter A wissen will, ob Facharbeiter X am selben Thema sitzt, muss die Frage
durch zwei Teamleads und wieder zurück. Bei einem „ruf doch mal eben an" ist das absurd.

### Modell B — offen mit Verzeichnis

Jeder darf jeden anschreiben, wenn er ihn über das Verzeichnis gefunden hat.

**Wofür es spricht:** Kein Flaschenhals, direkte Klärung, weniger Umwege.
**Wogegen:** Doppelarbeit, widersprüchliche Entscheidungen, und niemand hat den Überblick.

### Empfehlung: gestufte Öffnung

1. **Jetzt: Modell A.** Die Struktur ist neu, es gibt kein Verzeichnis, und eine offene Ebene ohne
   Verzeichnis ist nur Lärm.
2. **Facharbeiter dürfen innerhalb ihrer Abteilung frei sprechen** — das ist bereits Modell A und löst
   den Flaschenhals für den häufigsten Fall.
3. **Sobald es ein Verzeichnis gibt** (wer bearbeitet was, abteilungsübergreifend), öffnet sich der
   direkte Weg für **eine** Sache: „Sitzt jemand am selben Thema?" — eine Frage, keine Entscheidung.
   Entscheidungen bleiben bei den Teamleads.

Der Grund für die Stufung: Nicht die Erlaubnis ist das Problem, sondern die **Auffindbarkeit**. Ohne
Verzeichnis weiß ein Facharbeiter nicht, wen er fragen soll — also fragt er seinen Teamlead, und die
Öffnung ändert nichts. Erst mit Verzeichnis wird sie nützlich.

**Diese Empfehlung ist nicht entschieden.** Der Mensch entscheidet.

## Die Regel, die aus dem Fehler folgt

> **Anfragen an den Teamlead werden weitergeleitet, nicht selbst erledigt.**
>
> Auch wenn die Frage direkt an ihn gestellt ist. Auch wenn es schneller ginge. Auch wenn er es könnte.

Der Satz gehört in den Modell-Input der Teamlead-Session, nicht nur in dieses Dokument — sonst liest
ihn niemand im entscheidenden Moment.

## Wie das im Paket landet

`@tmielsch/dsh-teams-plus` bringt die Rollen bereits mit (`~/.dsh/rollen/`: `draft`, `implementer`,
`projektmanager`, `rag`, `redteam`, `research`). Was fehlt, ist die **Teamlead-Rolle** samt der Regel
oben — als Rollentext, damit alle Teamlead-Sessions denselben Anfang teilen.

Offen und zu bauen:
1. Rollentext `teamlead` in `~/.dsh/rollen/teamlead.md` mit der Weiterleitungsregel.
2. Ein Hinweis im System-Prompt der Session, der auf diesen Text zeigt.
3. Ein Werkzeug oder eine Ansicht, die die Karte (Abteilungen + Arbeitsgruppen + Aufgaben) zeigt.
4. Ein Issue für die Verzeichnis-Frage (Modell A → gestufte Öffnung).
