# Einbau und Rücknahme — `send_to_session`

Stand: 2026-10-31, 06:48 (Europe/Berlin). Der Warnhinweis zur Reihenfolge wurde am 2026-11-01
nach Backlog A4 verschärft.

## JETZT: 0.6.0 liegt auf der Platte, ist aber noch nicht live

| Was | Wert |
|---|---|
| Paket im Profil | **0.6.0** |
| Quellart | `plugin:@tmielsch/dsh-teams-plus` |
| `package.json` dependency | `file:/Users/tmielsch/dsh-teams-plus/tmielsch-dsh-teams-plus-0.6.0.tgz` |
| in `dsh.profile.bundles` | ja |
| Testsuite | 137 grün, Selbstprüfung grün |

**Im laufenden `dsh web` (PID 38856, gestartet 03:44) steckt weiter v0.4.0.** Gemessen, nicht
vermutet: nach dem Einbau hat der Prozess den **alten** Protokollpfad
`~/.dsh/logs/send-to-session.log` um 06:46 beschrieben; der neue Pfad
`~/.dsh/.tm/teams-plus/logs/` existiert, ist aber leer. Node hält das geladene Modul im
Speicher — ein Neustart ist der einzige Weg.

**Deshalb steht das Werkzeug gerade auf `disabled: true`.** Der Block am Ende von
`~/.dsh/profiles/web/cordis.patch.yml` hält die gesperrte v0.4.0 aus dem laufenden Prozess
heraus. Ohne ihn wäre nach dem Einbau wieder die alte, gesperrte Fassung aktiv — genau der
Zustand, den der STOPP beseitigen wollte.

## Der Neustart — die Reihenfolge ist der ganze Punkt

> ⚠️ **WARNUNG AN DER STELLE, WO DER BLOCK ENTFERNT WIRD.**
> Das Entfernen des Eintrags `- id: send-to-session` / `disabled: true` schaltet die
> **laufende** Fassung **sofort** wieder ein — **ohne Neustart**. Beim 0.6.0-Einbau ist genau
> das passiert; abgelesen an der Plugin-Liste (`enabled: true, fiberPhase: active`), während im
> Prozessspeicher noch der alte Code lag. Wer den Block entfernt und dann weiterarbeitet, hat
> die gesperrte Fassung live.

**Zwei Reihenfolgen sind erlaubt — beide enden im selben Zustand:**

1. **Neustart planen, DANN den Block entfernen:** `dsh web` beenden, Block entfernen, starten.
   Kein Fenster, in dem die gesperrte Fassung wieder aktiv wird.
2. **Block entfernen und SOFORT neu starten:** kein weiterer Agentenlauf dazwischen, keine
   Nutzung von `send_to_session`, kein „mache ich gleich". Das Fenster ist so lang wie der
   Neustart.

**Verboten ist der dritte Weg:** Block entfernen, weiterarbeiten, Neustart später. Genau so kam
die laufende v0.4.0 wieder hoch — beim 0.6.0-Einbau fast falsch herum.

```bash
# Reihenfolge 2, Schritt 1: Sperrblock entfernen (er steht am Ende der Datei).
# ⚠️ AB HIER ist die laufende Fassung wieder aktiv — nur weiter, wenn Schritt 2 SOFORT folgt.
python3 - <<'PY'
p = "/Users/tmielsch/.dsh/profiles/web/cordis.patch.yml"
s = open(p).read()
i = s.index("# --- send_to_session: VOR dem Neustart")
open(p, "w").write(s[:i].rstrip() + "\n")
print("Sperrblock entfernt")
PY

# Reihenfolge 2, Schritt 2: SOFORT neu starten  ->  0.6.0 ist live
# (Bei Reihenfolge 1 steht dieser Befehl VOR dem Entfernen.)
```

**Wer den Block stehen lässt und nur neu startet**, schaltet auch 0.6.0 ab. Das ist kein
Schaden — das Werkzeug fehlt dann nur in der Liste —, aber der Neustart war umsonst. Deshalb
steht die Reihenfolge hier.

## Woran man erkennt, dass 0.6.0 wirklich läuft

**Nicht** an der Paketversion — die stand schon nach dem Einbau auf 0.6.0, während im Speicher
noch die alte Fassung lief. Drei Merkmale, die nur 0.6.0 hat:

1. **`mode.enum`** der Werkzeugbeschreibung ist `["auto","steer","followup"]`. v0.4.0 hatte
   `["steer","followup"]`.
2. **Ein neuer Protokollpfad entsteht:** `~/.dsh/.tm/teams-plus/logs/send-to-session.log`.
   Solange dort keine Datei liegt, läuft noch die alte Fassung.
3. **Die Kopfzeile** der Datei nennt `FASSUNG 0.6.0`.

## Rücknahme (wenn etwas klemmt)

```bash
cp ~/.dsh/profiles/web/package.json.bak-vor-060-064609 ~/.dsh/profiles/web/package.json
cp ~/.dsh/profiles/web/cordis.patch.yml.bak-vor-060-064609 ~/.dsh/profiles/web/cordis.patch.yml
# dann dsh web neu starten
```

Zusätzlich liegt die Sicherung vom 06:13 unter
`~/.dsh/profiles/web/cordis.patch.yml.bak-vor-s2s-sperre-20261031-061348` (80 444 Bytes).

## Was beim Einbau gemessen wurde — und was davon überraschte

- **Das Entfernen des Sperrblocks schaltet die laufende Fassung wieder ein.** Genau das ist beim
  Einbau passiert und wurde an der Plugin-Liste abgelesen (`enabled: true, fiberPhase: active`).
  Deshalb steht der Block jetzt wieder — und deshalb ist die Reihenfolge oben nicht beliebig.
- **`dsh plugin add` beendet den alten Prozess nicht.** Es schreibt nur die Platte um.
- **Der Einbau selbst lief sauber durch** — die Ausgabe war nur von Peer-Warnungen zweier
  **anderer** Plugins überlagert (`@linxin666/dsh-client-ui-skin-center@0.4.12`,
  `dsh-better-sidebar@0.28.2`). Beide gehören nicht zu diesem Vorgang und standen schon vorher so da.

## Der frühere Weg B (Abschalten ohne Einbau) — noch gültig als Rückfall

Wenn 0.6.0 zurückgenommen werden soll und die alte Fassung **nicht** wieder laufen darf: den Block
aus dem Abschnitt oben wieder anhängen. Er wirkt ohne Neustart, weil der Profil-Patch live
nachgezogen wird.

**Das gilt in beide Richtungen:** auch das **Entfernen** des Blocks wirkt ohne Neustart — die
laufende Fassung ist dann sofort wieder aktiv. Deshalb steht die Warnung im Abschnitt „Der
Neustart" direkt an dem Befehl, der den Block entfernt.
