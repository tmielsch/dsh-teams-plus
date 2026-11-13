# Erwartung vor der Messung: Eltern-Sitzung laden (2026-11-12, vor dem ersten Lauf geschrieben)

Zielbrief: `docs/ZIELBRIEF-ELTERN-LADEN-2026-11-12.md`. Alle Erwartungen sind **SCHÄTZUNG** (aus dem Quelltext abgeleitet, nicht gemessen). Sie stehen hier, damit nach der Messung sichtbar ist, wo ich falsch lag.

| Nr. | Frage | Erwartung (vor der Messung) | Warum ich das glaube |
|---|---|---|---|
| E1 | Weist `subagents.prompt` ein Kind bei kaltem Elternteil ab? | Ja, `subagent/parent-unavailable` | `dsh-subagent/lib/index.js` Zeile 3015 bis 3016 |
| E2 | Lässt sich der kalte Elternteil per `ctx.agents.resume` laden, und kommt danach das Kind durch? | Ja, ohne Runde und ohne Modellaufruf, weil `resume` nur den Agenten aus der Datei aufbaut | `resumeObserved` Zeilen 412 bis 424 ruft nur `ctx.agents.resume`; ein Modellaufruf braucht einen Eingang im Postfach |
| E3 | Startet das Laden einen Lead-Zug, wenn im Postfach des Elternteils noch eine Abschlussmeldung des Kindes wartet? | Unsicher. Ich vermute: ja, der Zug startet, weil `resume` das Postfach abarbeitet (SCHÄTZUNG, schwach) | Kern-Code zum Postfach nicht gelesen |
| E4 | Schaltet das Laden ein aktives Ziel des Elternteils scharf? | Ja, wenn das Ziel zum Zeitpunkt des Abbaus `active` und `armed` war; die Aktivierung ist nach dem Abbau verloren (Befund aus dem Plan team_stand: sie steht nicht in der Datei), danach vermutlich „scharf“ per Vorgabe | PLAN-TEAM-STAND-UNTERAGENTEN A5 |
| E5 | Gibt es einen Plugin-Haken ohne Kernänderung? | Ja: die Dienstmethode `subagents.prompt` auf der Instanz umwickeln | `team-modus.mjs` umwickelt `Agent.send` auf Instanzen schon |
| E6 | Gilt der Haken auch für den Weg der Weboberfläche (Typert-Remote)? | Unsicher: nur, wenn der Remote-Aufruf die Methode zur Laufzeit auf der Instanz nachschlägt und nicht eine beim Start gebundene Funktion aufruft | nicht gelesen |
| E7 | Genügt eine reine Host-Lösung? | Nein: die Sperre sitzt in der Oberfläche (Eingabefeld gesperrt, wenn `parentAvailable !== true`). Ob der Client die Sperre von selbst aufhebt, wenn der Elternteil geladen wird, hängt daran, ob der Host die Änderung von `agentAvailable` an den Client schickt | `dsh-api-session-controller/lib/client.js` Zeilen 1975 bis 1992, 2589 bis 2594 |
