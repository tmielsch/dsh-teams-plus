# Abnahme mit echtem Modell (Turn 5/6, 2026-11-09)

Modell: Anbieter `pcserve`, `swift-1.5-iq2_xs` (kostenlos, schwaecher bei Werkzeugaufrufen). Geladen: `goal-await.mjs` und `team-modus.mjs` gemeinsam.
Lauf: `real.sh <szenario>` (liest `PCSERVE_API_KEY` nur zur Laufzeit aus der Konfiguration und gibt ihn als Umgebungsvariable an den einen Probeprozess; der Schluessel steht in keiner Datei).
Szenarien: u1 (warten ohne von), u2 (mit von), r (fremder Wecker waehrend laufender Runde), a (drei Gaenge), de (give_task, ask_question, send_message), f (goal_report). `real_*.json` sind die Ergebnisse.
