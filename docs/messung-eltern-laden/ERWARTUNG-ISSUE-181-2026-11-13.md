# Erwartung vor der Messung: Issue 181 (Laden eines kalten Leads mit unzugestellter Team-Nachricht), 2026-11-13

Vor dem ersten Lauf geschrieben. Alle Zahlen hier sind `SCHÄTZUNG` (aus dem Quelltext abgeleitet, nicht gemessen). Quelle: `dsh-experimental-agent-team/lib/index.js` Zeilen 1843 bis 1845 (`agent/created` → `scheduleRecovery`), 898 bis 910 (`recoverFor`: ein Lead holt ALLE nicht zugestellten Nachrichten des Journals), 1008 bis 1040 (`dispatchOnce`: Ziel = Lead → `root.steer(input)`, anderes Ziel → `steerHostSubagentPrompt`), `dsh-agent-loop/lib/index.js` 809 und 854 bis 866 (`steer` → `wakeDriver` → bei `idle` ein Zug).

Lagen (je Lead mit einem Mitglied `exp`, Prozess hart beendet, Neustart ohne den Lead zu laden, dann Auslöser `page` auf die Kind-Adresse; zusätzlich Auslöser Gateway-Anschreiben):
- **A** unzugestellte Nachricht mit Ziel = Lead (Absender `exp`).
- **B** unzugestellte Nachricht mit Ziel = Mitglied `exp` (Absender Lead).
- **C** Kontrolle: keine unzugestellte Nachricht.
Je mit Patch (`mit`) und ohne Patch (`ohne`, Gegenprobe).

| Nr. | Frage | Erwartung (vor der Messung) | Warum |
|---|---|---|---|
| F1 | Lage C mit Patch: Modellaufrufe nach dem Laden | 0 (wie in der Planmessung) | kein Journaleintrag, nichts zuzustellen |
| F2 | Lage A mit Patch: löst das Laden eine Modellrunde des Leads aus? | **Ja**, ein Aufruf des Leads binnen weniger hundert Millisekunden nach dem Laden | `recoverFor` → `root.steer` → `wakeDriver` bei `idle` → `kick` |
| F3 | Lage A mit Patch: Nachricht als zugestellt gebucht? | Ja (`delivered` enthält die Kennung), sobald die Nachricht im Lead-Journal des Leads steht | `checkpointDelivered` |
| F4 | Lage B mit Patch: löst das Laden eine Modellrunde des Mitglieds aus? | Ja, ein Aufruf des Mitglieds (es wird kalt geweckt) | `steerHostSubagentPrompt` |
| F5 | Alle Lagen ohne Patch | 0 Aufrufe, Nachricht bleibt unzugestellt (nichts lädt den Lead) | Gegenprobe |
| F6 | Lage A/B: kommt die Runde auch, wenn der Auslöser das Gateway-Anschreiben ist statt `page`? | Ja, zusätzlich die Antwort des Kindes (normal, nicht das Laden) | gleicher Ladeweg |

Unsicherheit, die ich vor der Messung benenne: Ob eine frisch geladene Lead-Sitzung beim `agent/created` schon eine lesbare Team-Projektion hat (`journal.state` wirft sonst, `recoverFor` fängt es als Warnung), und ob ein hart beendeter Prozess die Nachricht tatsächlich ungebucht lässt: Die Lage wird nachgestellt, indem das Ereignis `team/message/queued` mit der Form aus `sendAdmitted` (Zeilen 922 bis 960) in das Lead-Journal geschrieben und geflusht wird, ohne dass zugestellt wird; ein echter Absturz zwischen Anhängen und Zustellen hinterlässt dasselbe.
