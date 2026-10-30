# Agent Teams Plus (`@tmielsch/dsh-teams-plus`)

Das Paket, das Agent Teams in DeepSeek Harness erst vollständig benutzbar macht: die Unlocks,
die Rollen und ein standardisiertes Policy-Schema — an einem Ort, installierbar in einem Schritt.

**Was es löst.** Team-Infrastruktur lag bisher an drei Stellen verstreut: die Patches in
`~/.dsh/patches/`, die Rollen in `~/.dsh/rollen/`, die Policy-Engine in `dsh-projectOS`. Wer wissen
wollte, wie ein Team arbeitet, musste alles drei lesen. Dieses Paket führt die Team-Seite zusammen;
ProjectOS bleibt die Oberfläche (Brett, Graph) und hängt sich an denselben Vertrag.

## Zwei Orte, streng getrennt

| Ort | Inhalt | Warum |
|---|---|---|
| das Paket (in `node_modules`) | Patches, Rollen, Code | Ein Update überschreibt nie deine eigenen Daten |
| `~/.dsh/.tm/teams-plus/` | `policies/`, `workspaces/`, `logs/` | Deine Daten, von Hand lesbar, per Git sicherbar |

`~/.dsh/.tm/<plugin>` ist ab jetzt der Ort für alle eigenen Plugins und ihre Daten. Teams Plus ist
der erste, der ihn benutzt.

## Was drin ist

- **Patches** — die Eingriffe, ohne die Agent Teams nicht taugt: Rollen an Unteragenten, Modelle je
  Ebene, Dateien mitschicken, Ziele für Unteragenten, Warten ohne Rundenverbrauch, stille
  Direktnachrichten. Zwei Arten: `allow-*` schreibt in die DSH-Installation (nach jedem DSH-Update
  neu einspielen), die Plugin-Patches laden beim Start.
- **Rollen** — Recherche, Red-Team, Implementer, Draft, RAG, Projektmanager. Der Rollentext steht
  byte-gleich vor jedem Auftrag, damit alle Facharbeiter einer Rolle denselben Prompt-Anfang teilen
  und der Cache greift.
- **Policies** — Prompt-Bausteine mit Tags, pro Workspace an- und abschaltbar. Eine Datei je Policy
  unter `~/.dsh/.tm/teams-plus/policies/`, oben ein Kopfblock, darunter der Text.
- **Der Vertrag** — ein Dienst `teamsPlus`, über den jede Ansicht liest und schreibt. Kein View
  kennt Dateipfade; ein neues Menü oder ein neuer Tab kann danebentreten, ohne das erste zu stören.

## Befehle

```text
teams-plus status      Zustand: welche Patches sind eingespielt, welche Rollen liegen da, welche Policies
teams-plus apply       die A-Patches in die DSH-Installation einspielen
teams-plus revert      die A-Patches zurücknehmen (Ausgangszustand byte-gleich)
teams-plus doctor      nach einem DSH-Update: was fehlt, mit dem Befehl zum Nachholen
teams-plus link        Datenordner unter ~/.dsh/.tm/teams-plus/ anlegen
```

**Die A-Patches laufen nie von allein.** Sie schreiben in die DSH-Installation, deshalb sind sie ein
ausdrücklicher Befehl und keine Nebenwirkung der Installation.

`teams-plus agents install` setzt den Anweisungsblock in `~/.dsh/AGENTS.md` (`status` zeigt, ob er
aktuell ist, `revert` nimmt ihn zurück). Der Block steht **vor** einem älteren `PROJECTOS`-Block,
weil er Vorrang beansprucht; zwei Blöcke gleichen Namens kann es nicht geben.

`teams-plus einbau` trägt das Paket in das Profil ein. Es entfernt die vier alten Patch-Einträge
(`delegate-send`, `teammate-modell`, `goal-await`, `stille-nachrichten`) und setzt dafür einen
`teams-plus`-Eintrag an dieselbe Stelle. Ohne diesen Schritt lädt jeder der vier Patches **zweimal**,
sobald das Paket installiert ist — doppelte Werkzeugregistrierung ist ein Absturzrisiko.
Ohne `--apply` ist es ein Trockenlauf; `--revert <sicherung>` legt eine Sicherung zurück.

## Einbau, in dieser Reihenfolge

```bash
dsh plugin --profile web add <release-url>      # oder: npm install im Paketordner
teams-plus link                                 # patches/ und rollen/ nach ~/.dsh/.tm/teams-plus
teams-plus einbau                               # Trockenlauf: zeigt genau die angefassten Zeilen
teams-plus einbau --apply                       # entfernt die vier Einträge, setzt teams-plus ein
# danach DSH neu starten — das trifft alle laufenden Sitzungen
teams-plus apply                                # die A-Patches in die DSH-Installation
```

`einbau` arbeitet zeilenweise und fasst ausschließlich die fünf Einträge an. Alle anderen Zeilen der
Profildatei — Kommentare, fremde Modelländerungen, Kontextfenster, Platzhalter — bleiben byte-gleich;
das ist der wichtigste Test in `test/einbau.test.mjs`. Vor jeder Änderung sichert es die Datei nach
`~/.dsh/.tm/teams-plus/backup-profile/` und gibt die Prüfsumme vorher und nachher aus.

## Selbst bauen

```bash
npm install        # esbuild, typescript, zod
npm run build      # schreibt lib/client.js (Browser) und lib/index.js (Host)
npm test           # 71 Tests, ohne laufendes DSH
npm pack           # der prepack-Haken baut vorher neu
```

**Wenn `npm install` mit „root-owned files in the cache" abbricht:** Auf dieser Maschine liegen
34263 root-eigene Dateien unter `~/.npm/_npx/` (ein früherer `sudo`-Lauf). Statt am System zu
schrauben genügt ein eigenes Cache-Ziel:

```bash
npm install --cache /tmp/npm-cache
```

Dauerhaft beheben ließe es sich mit `sudo chown -R 501:20 ~/.npm`; nötig ist das nicht.

Der Build erzeugt **zwei** Bündel: `lib/client.js` trägt den `window.__ModuleLoader__.load`-Kopf,
ohne den der Browser das Paket nicht lädt, und `lib/index.js` ist der Host-Teil, der nur `node:*` und
`@deepseek-ai/*` offen lässt — alles andere, auch zod, ist eingebündelt.

## Abhängigkeiten, die nicht hierher gehören

| Abhängigkeit | Wozu | Pflicht? |
|---|---|---|
| DSH mit `dsh-experimental-agent-team`, `…-tool-agent-team`, `…-client-ui-agent-team` | Teams, Aufgaben, Mitglieder | ja, kommt mit DSH |
| `team-rente` von ExpertKT | `retire_teammate`, Phasen `retired`/`resting` | nein — fremder Code, Lizenz ungeprüft, bleibt draußen |

## Herkunft

Die Patches und Rollen stammen aus `tmielsch/dsh-projectOS` und wurden dort entwickelt. Sie ziehen
hierher um, weil Agent Teams sie braucht und ProjectOS nicht. Der Umzug ändert an ihrem Verhalten
nichts.

## Lizenz

MIT
