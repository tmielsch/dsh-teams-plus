# Entwurf: Team-Profile und Hierarchie (Stand 2026-10-27, noch nichts davon gebaut außer den Rollen)

Dieser Entwurf hält fest, was der Mensch (Tilman) am 2026-10-26 entschieden und gewünscht hat. Der Dateiname beginnt mit `_`, damit der Rollen-Patch ihn nicht als Rolle anbietet.

## Bereits gebaut und eingespielt
- `~/.dsh/rollen/redteam.md` und `~/.dsh/rollen/projektmanager.md` (Rollentexte, enden mit „AUFTRAG").
- Patch `~/.dsh/patches/subagent-rolle.mjs` (+ `allow-subagent-rolle.mjs`): `delegate_task` bekommt das Feld `rolle`; der Rollentext steht byte-gleich vor dem Auftrag. Commit 1cac36b, Zweig `mac`. Wirkt erst nach Neustart von `dsh web`.
- Noch offen: Probelauf und Messung, ob der Cache bei zwei Red-Team-Facharbeitern greift.

## Entschieden
- Alle Agenten teilen Profil, Systemprompt und Werkzeugliste (Cache!). Rolle = Textbaustein am Anfang des ersten Auftrags. Kein eigenes DSH-Profil je Rolle.
- Ablage in DSH selbst (`~/.dsh/rollen/`), nicht im Skill-Repo; Verteilung wie die `AGENTS.md` auf alle Maschinen.
- Ein Plugin als eigenes Repo ist erwünscht (übersteht DSH-Updates, Paketdatei von GitHub-Release), aber erst nach der Messung der kleinen Fassung.
- **Solo ist das Standardprofil.** Einzelchats bleiben unverändert und fragen nichts. Das Gate ist **hart**, gilt aber nur, wenn der Mensch Teambildung ausdrücklich verlangt; dann wählt er ein Team-Profil, und das Preset legt die Struktur fest.

## Entschieden am 2026-10-26 (Nachtrag)
- Die Teambildung wird mit dem Befehl **`/team`** ausgelöst; er zeigt die Profile als Auswahlformular. Ohne `/team` bleibt die Sitzung Solo.
- Das Feld `obergrenzen` steht im Profil-Format, mit **`"facharbeiter": 0`** als Startwert. Die dritte Ebene (Wegwerf-Worker unter Facharbeitern) ist damit ausgeschaltet; sie einzuschalten heißt später nur: Zahl erhöhen und `maxDepth` auf 3 setzen.

## Zwei Ebenen: Abteilung und Gruppe (Entscheidung des Menschen, 2026-10-27)
Wortlaut sinngemäß: Der Teamlead ist **Abteilungsleiter**, die Experten sind **Gruppenleiter**. Es gibt einen globalen Teamtyp für die Abteilung, und jede Gruppe hat ihre eigenen Regeln. Der Gruppenleiter wird ausdrücklich beauftragt, seine Gruppe selbst zu strukturieren. Ein einziges Profil für die ganze Sitzung (der frühere Entwurf) ist damit überholt.

1. **Abteilungsprofil** (`~/.dsh/team-profile/abteilung/<name>.json`): wird vom Menschen mit dem Teamlead gewählt. Es setzt den Rahmen: höchstens wie viele Gruppenleiter, welche Modelle auf welcher Ebene, welche Facharbeiter-Rollen es überhaupt gibt, `obergrenzen` (Startwert `facharbeiter: 0`).
2. **Gruppenprofil** (`~/.dsh/team-profile/gruppe/<abteilung>--<experte>.json`): gehört je einem Experten. Es beschreibt seine Gruppe: welche Facharbeiter (Rolle, Modell, Anzahl), Eigenheiten der Gruppe (zum Beispiel „Bildprobe nach jedem Bauschritt, Worker nur auf swift") und welche Spec-Dateien die Gruppe vor der ersten Handlung liest.
3. **Das Gruppenprofil darf den Rahmen verengen und erweitern** (Mensch, 2026-10-27). Folge: das Abteilungsprofil ist die **Vorgabe**, nicht die Obergrenze. Jede Abweichung steht im Gruppenprofil im Feld `abweichungVomRahmen` mit Begründung, damit sie sichtbar bleibt. **Vorschlag, noch nicht entschieden:** der Teamlead genehmigt eine Erweiterung, der Mensch erfährt sie im Zwischenfazit. Unverändert hart bleiben die Grenzen, die nicht im Profil liegen: `maxDepth` in `cordis.patch.yml`, `maxMembers: 8`, höchstens drei gleichzeitige Worker, die Liste erlaubter Modelle.
4. **Das bestätigte Gruppenprofil ist die Erlaubnis.** Was darin steht, stellt der Experte ohne Rückfrage ein. Fragen muss er nur bei Abweichung vom bestätigten Profil. Damit löst sich die offene Frage nach der Erlaubnispflicht (Belegfall: über 40 Subagenten in einer STRATA-Sitzung).
5. **Der Gruppenleiter entwirft sein Gruppenprofil selbst** und schickt es als Vorschlag nach oben (wie ein Ziel von unten nach oben: nur ein Vorschlag). Der Teamlead prüft gegen das Abteilungsprofil und gibt Ja oder Nein; bei einem großen Umbau fragt er den Menschen.

### Ablauf von „/team" in der kleinen Fassung (ohne Plugin)
1. Der Mensch sagt „/team". Der Teamlead zeigt die Abteilungsprofile aus `~/.dsh/team-profile/abteilung/` als Auswahlformular (Inline-`dsh-ui`, `submit` mit `action`).
2. Die Wahl wird in eine Datei im Projekt geschrieben, damit sie einen Neustart überlebt.
3. Je Experte geht die Gruppenvorgabe als Text vor dessen Auftrag (neuer Experte) oder per `send_message` (bestehender Experte). Nie in den Systemprompt, sonst bricht der gemeinsame Cache-Anfang.
4. Der Experte schlägt sein Gruppenprofil vor, der Teamlead bestätigt, der Experte stellt danach ein.
5. Bestehende Experten werden nicht neu gestartet; sie bekommen ihr Gruppenprofil nachträglich als Nachricht.

### Erster Fall: der STRATA-Experte
Der STRATA-Experte hat die meiste Erfahrung mit Red-Team und Projektmanager und ist deshalb der Prüffall. Ablauf: (a) Der Teamlead schickt ihm den Auftrag, sein Gruppenprofil auf Grundlage dessen vorzuschlagen, was seine Gruppe heute wirklich hat. Bestehende Facharbeiter werden weiterbenutzt, nicht ersetzt. (b) Neue Facharbeiter derselben Gruppe werden mit `rolle` gestartet (`redteam`, `projektmanager`, `draft`), sobald der Neustart von `dsh web` das Feld freigeschaltet hat. (c) Nach den ersten Einsätzen wird gemessen: Anteil falscher Annahmen im Entwurf von `draft`, Cache-Treffer der gemeinsamen Anfänge, Anzahl der Facharbeiter gegenüber dem bestätigten Profil.

## Rolle „draft" (entschieden 2026-10-27)
- Name `draft`, Datei `~/.dsh/rollen/draft.md`. Modell: **`homepc/swift-1.5-iq3_xxs`** (neuralwatt war an dem Tag nicht erreichbar; der Mensch wollte ohnehin swift).
- Schreibt Entwuerfe fuer Plaene und Zielbriefe samt vorbereiteter Aufgabenliste; der Experte korrigiert. Pflichtformat: Spec-Saetze zuerst, tragende Annahmen mit Etikett und Minutenpruefung, Abschnitt „Hier bin ich unsicher", Abnahme mit Sollwerten.
- Nicht einsetzen, wenn die Methode noch offen ist (Schranke §0.7): dann denkt der Experte selbst.
- Kette: Projektmanager -> draft -> Experte korrigiert -> Red-Team -> Abnahme durch den Lead -> Worker.
- Zu messen nach den ersten Einsaetzen: Anteil falscher Annahmen im Entwurf (zeigt, ob swift reicht).

## Struktur eines Facharbeiter-Eintrags (Entscheidung des Menschen)
Jede Rolle hat: Rollenbeschreibung (die Markdown-Datei), erlaubte Modelle, erlaubte Anzahl. Die Instanzen heißen `<rolle>-1`, `<rolle>-2` und so weiter.
- Standard: **ein Facharbeiter je Fachrichtung**, damit es für jedes Fachgebiet einen klaren Adressaten gibt.
- Ein zweiter derselben Rolle nur im Ausnahmefall, wenn Parallelarbeit sinnvoll ist, und dann als **Fork des ersten**.
- Standardmäßig **zwei allgemeine Worker** (Rolle „arbeiter", führen Pläne des Experten aus).

## Dritte Ebene: Wegwerf-Worker (Idee, Entscheidung offen)
Facharbeiter könnten selbst „dumme" Wegwerf-Worker starten: gleicher Systemprompt und gleiche Werkzeuge (Cache), aber nicht den ganzen Gesprächskontext. Mögliche Obergrenzen je Ebene: Teamlead 5, Experte 2, Facharbeiter 1. Ziel: Gleichgewicht zwischen verschachtelten Agenten und sauberer Arbeitsteilung; kluge Modelle denken und planen, einfachere setzen um und bekommen das Wissen als Skills.

**Gemessener Befund:** `~/.dsh/profiles/web/cordis.patch.yml` Zeile 916 setzt `maxDepth: 2` (Teamlead 0 → Experte 1 → Facharbeiter 2). Ein Facharbeiter kann derzeit nicht weiter delegieren. Für Wegwerf-Worker unter Facharbeitern wäre `maxDepth: 3` nötig (zusätzlich ein Zähler je Ebene, den es heute nicht gibt).

## Profil-Dateien (Vorschlag)
Abteilungsprofil, `~/.dsh/team-profile/abteilung/<name>.json`:
```json
{
  "name": "haus-rekonstruktion",
  "beschreibung": "...",
  "teamlead": { "modell": "..." },
  "maxGruppen": 5,
  "gruppenleiterModelle": ["neuralwatt/deepseek-v4-pro"],
  "rollen": {
    "redteam":        { "modelle": ["..."], "max": 1 },
    "projektmanager": { "modelle": ["..."], "max": 1 },
    "draft":          { "modelle": ["homepc/swift-1.5-iq3_xxs"], "max": 1 },
    "arbeiter":       { "modelle": ["homepc/swift-1.5-iq3_xxs"], "max": 2 }
  },
  "obergrenzen": { "teamlead": 5, "experte": 2, "facharbeiter": 0 }
}
```
Gruppenprofil, `~/.dsh/team-profile/gruppe/<abteilung>--<experte>.json`:
```json
{
  "abteilung": "haus-rekonstruktion",
  "experte": "strata",
  "stand": "2026-10-27",
  "bestaetigtVon": "teamlead",
  "specs": ["houdini/TOOLSUITE.md", "houdini/buildings/STRATA_GRUNDKONZEPT.md"],
  "facharbeiter": [
    { "rolle": "redteam",        "anzahl": 1, "modell": "..." },
    { "rolle": "projektmanager", "anzahl": 1, "modell": "..." },
    { "rolle": "draft",          "anzahl": 1, "modell": "homepc/swift-1.5-iq3_xxs" }
  ],
  "eigenheiten": ["Bildprobe nach jedem Bauschritt"],
  "abweichungVomRahmen": []
}
```

## Offene Fragen
1. ~~Teambildung auslösen~~ — entschieden: `/team`.
2. Dürfen im Solo-Profil einfache Helfer-Unteragenten laufen (empfohlen: ja), nur `spawn_teammate` gesperrt?
3. Erlaubnis-Pflicht technisch erzwingen (Werkzeug „Facharbeiter beantragen")? Empfehlung: ja. Durch die Gruppenprofile (Punkt 4 oben) ist die Pflicht nur noch für Abweichungen nötig.
3a. Wer genehmigt eine **Erweiterung** des Rahmens durch ein Gruppenprofil: der Teamlead (Vorschlag) oder der Mensch?
4. Dritte Ebene (Wegwerf-Worker unter Facharbeitern) einführen, mit `maxDepth: 3`? Und welche Obergrenzen je Ebene?
5. Profil für `context: fresh`-Experten: das Plugin stellt den Profiltext selbst vor deren Auftrag (nicht in den Systemprompt, sonst bricht der Cache).
