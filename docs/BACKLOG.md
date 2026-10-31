# Backlog — `@tmielsch/dsh-teams-plus`

Stand: 2026-10-31, 07:40. Gepflegt aus dieser Sitzung (`session-e40fe6ab`).

## Wozu diese Datei

Die Frage war: *„Hast du einen Backlog für Sachen, die ich nicht direkt beantworte?"* Bis jetzt
nicht — offene Punkte lagen verstreut in `docs/VORLAGE-V0.6.0.md`, im Red-Team-Bericht und in
GitHub-Issues. Das hier ist die eine Liste.

**Die entscheidende Spalte ist „Wer".**

- **A — ich allein.** Kann ohne Rückfrage bearbeitet werden: bauen, messen, Test mit Gegenprobe,
  dokumentieren. Einbau ins laufende Profil bleibt trotzdem an AGENTS.md Regel 1 gebunden
  („Nichts ohne Red Team pass integrieren").
- **H — Mensch.** Braucht eine Entscheidung, die ich nicht erfinden darf: Produktverhalten,
  Eingriff in ein fremdes Paket, Zeitpunkt eines Neustarts, Priorität gegen andere Arbeit.

Wenn eine Zeile auf **H** steht, wird sie **nicht** bearbeitet und **nicht** erneut gefragt. Sie
wartet. Genau dafür ist Issue #14 gedacht (Goal pausiert statt weiterzulaufen).

## A — kann ich allein

| # | Was | Woher | Aufwand | Stand |
|---|---|---|---|---|
| A1 | **`paareGedaeschtnis` löscht nach Einfügereihenfolge, nicht nach Alter.** Ein heißes Paar kann durch 200 andere verdrängt werden; sein Zähler beginnt dann bei null. Der Red-Team-Bericht hat das nur gerechnet, nicht gemessen. Zu tun: 200 Paare erzeugen, das heiße Paar erneut zustellen, prüfen ob es durchkommt. Dann entweder nach Alter löschen oder den Befund als Grenze dokumentieren. | Red-Team §6 | 1 h | offen |
| A2 | **`DSH_HOME=""` wird von `??` nicht abgefangen.** Mit leerer Zeichenkette entstehen relative Pfade (`.tm/teams-plus/…`) im Arbeitsverzeichnis. Aus dem Code abgeleitet, nicht gemessen. Zu tun: `process.env.DSH_HOME \|\| default` statt `??`, Test mit leerem Wert. | Red-Team §6 | 30 min | offen |
| A3 | **NIEDRIG-6: die Installer-/Policy-Tests sind nicht hermetisch.** Ein Lauf mit gefälschtem `HOME` schreibt `<HOME>/.dsh/.tm/teams-plus/policies/lokalmodus.md`. Nicht der `send-to-session`-Test (der ist über `DSH_HOME` sauber), sondern die Installer-Tests. Zu tun: dieselbe `DSH_HOME`-Umlenkung dort. | Red-Team R2 | 1 h | offen |
| A4 | **Test für den Sperrblock-Mechanismus.** Gemessen, aber nicht festgehalten: das Entfernen eines `disabled`-Eintrags schaltet die **laufende** Fassung wieder ein, ohne Neustart. Das ist beim 0.6.0-Einbau fast schiefgegangen. Zu tun: als Kommentar in `docs/EINBAU-UND-RUECKNAHME.md` (steht schon) **und** als Warnung an der Stelle, wo jemand den Block entfernt. | eigene Messung | 30 min | teilweise |
| A5 | **Prüfen, ob der id-lose Nachrichtenfall überhaupt noch erreichbar ist.** HOCH-1 ist behoben (jede Nachricht hat jetzt eine `id`), aber der Client-Fall aus §6 (zwei id-lose Nachrichten in einem Turn) wurde nie gemessen. Zu tun: messen, ob es den Zustand noch geben kann; wenn nicht, den Punkt schließen. | Red-Team §6 | 30 min | offen |

## H — wartet auf den Menschen

| # | Was | Warum H? | Stand |
|---|---|---|---|
| H1 | **NIEDRIG-4: der Client zeigt eine `plugin:`-Nachricht als menschliche Anfrage.** Die Herkunft trägt nur der Nachrichtentext. Ein sauberer Fix gehört in `dsh-client-ui-chat` — ein **fremdes** Paket. Das fasse ich nicht ohne ausdrückliche Freigabe an. | Eingriff in fremdes Paket | offen |
| H2 | **Issue #14: Goal pausiert, wenn eine Frage offen bleibt.** Die Änderung sitzt im Kern (`dsh-tool-goal` / Runden-Treiber), nicht in diesem Repo. | Kernänderung | offen |
| H3 | **Ob `stille-nachrichten` so bleiben soll.** Nach der Drossel: 20 Zeilen/s, Summenzeile bei Ruhe. Ob die Menge jetzt passt, entscheidet der Mensch am Protokoll. | Produktverhalten | offen |
| H4 | **Die 16 offenen Issues in `tmielsch/DSH-Verwaltung`.** Sie betreffen Anweisungsdateien, Workflow und Repo-Namen — ein ganzer Stapel eigener Arbeit. Ob und in welcher Reihenfolge der abgearbeitet wird, ist eine Prioritätsfrage. | Priorität | offen |
| H5 | **Der nächste Schritt für `send_to_session` selbst.** Läuft seit 07:36 live (0.6.0). Ob es weitere Runden braucht oder erst einmal beobachtet wird, entscheidet der Mensch. | Produktentscheidung | offen |

## Was ausdrücklich erledigt ist (damit es nicht wieder auftaucht)

- **v0.4.0 gesperrt** (`docs/STOPP-V0.4.0.md`), **v0.6.0 eingebaut und live** seit 2026-10-31 07:36.
  Beweis: Werkzeugliste zeigt `mode.enum = ["auto","steer","followup"]`, neuer Protokollpfad
  `~/.dsh/.tm/teams-plus/logs/` wird beschrieben, `send_to_session` listet die lebenden Sitzungen
  über `ordner` (nicht mehr über das tote `title`).
- **Red-Team-Runde 2** — Freigabe mit Auflagen; beide HOCH-Befunde und alle MITTEL behoben
  (`342647c`), jede Reparatur mit einer Gegenprobe, die sie rot macht.
- **M1** (Lost Update) — Dateisperre, gemessen 1/5 ohne, 5/5 mit.
- **M3** (Logpfad), **M5** (doppelte Kaskaden-Regel) — erledigt in `cb5c7db`.
- **NIEDRIG-1, -2, -3, -5** — erledigt in `f28d4f8`.
- **Issue #10** — die Lehre „ein Prüfer, der die geprüfte Stelle nicht erreicht, ist kein Beweis"
  ist als Issue festgehalten und in jedem Test dieses Repos angewandt.

## Die Regel, die über allem steht

**Nichts ohne Red Team pass integrieren** (`~/.dsh/AGENTS.md`, Regel 1). Das gilt auch für A-Punkte:
bauen und messen ja, in ein laufendes Profil einbauen erst nach einem Pass.
