# Lies mich: alte Messdateien

Die zwei Dateien `ergebnis_abnahme_v3.json` und `ergebnis_abnahme_notschalter_v3.json` stammen vom Stand `dc7d4f2`.

Sie tragen `teamModus: false` und `notschalter: true`. Sie gelten **nicht** als Beleg für den Lauf mit Team-Modus an. Die Angabe „Team-Modus an“ im früheren Messblatt war falsch: die Probe hatte noch eine `team-modus.json` mit `{"aus": true}` stehen.

Diese Dateien werden **nicht gelöscht**; das Löschen im Beleg-Ordner braucht ein Ja des Menschen.

Maßgeblich für den Lauf mit Team-Modus an ist `ergebnis_teamaktiv_2026-11-12.json` (`teamModus: true`, `notschalter: false`). Für den Notschalter-Lauf gilt `ergebnis_notschalter_2026-11-12.json` (`teamModus: false`, `notschalter: true`).
