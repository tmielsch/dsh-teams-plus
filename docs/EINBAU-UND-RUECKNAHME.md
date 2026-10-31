# Einbau und Rücknahme — `send_to_session`

Stand: 2026-10-31, 06:48 (Europe/Berlin).

## JETZT: 0.6.0 liegt auf der Platte, ist aber noch nicht live

| Was | Wert |
|---|---|
| Paket im Profil | **0.6.0** |
| Quellart | `plugin:@tmielsch/dsh-teams-plus` |
| `package.json` dependency | `file:/Users/tmielsch/dsh-teams-plus/tmielsch-dsh-teams-plus-0.6.0.tgz` |
| in `dsh.profile.bundles` | ja |
| Testsuite | 129 grün, Selbstprüfung grün |

**Im laufenden `dsh web` (PID 38856, gestartet 03:44) steckt weiter v0.4.0.** Gemessen, nicht
vermutet: nach dem Einbau hat der Prozess den **alten** Protokollpfad
`~/.dsh/logs/send-to-session.log` um 06:46 beschrieben; der neue Pfad
`~/.dsh/.tm/teams-plus/logs/` existiert, ist aber leer. Node hält das geladene Modul im
Speicher — ein Neustart ist der einzige Weg.

**Deshalb steht das Werkzeug gerade auf `disabled: true`.** Der Block am Ende von
`~/.dsh/profiles/web/cordis.patch.yml` hält die gesperrte v0.4.0 aus dem laufenden Prozess
heraus. Ohne ihn wäre nach dem Einbau wieder die alte, gesperrte Fassung aktiv — genau der
Zustand, den der STOPP beseitigen wollte.

## Der Neustart — zwei Schritte, in dieser Reihenfolge

```bash
# 1. den Sperrblock entfernen (er steht am Ende der Datei)
python3 - <<'PY'
p = "/Users/tmielsch/.dsh/profiles/web/cordis.patch.yml"
s = open(p).read()
i = s.index("# --- send_to_session: VOR dem Neustart")
open(p, "w").write(s[:i].rstrip() + "\n")
print("Sperrblock entfernt")
PY

# 2. dsh web neu starten  ->  0.6.0 ist live
```

**Wer Schritt 1 vergisst**, schaltet auch 0.6.0 ab. Das ist kein Schaden — das Werkzeug fehlt
dann nur in der Liste. Deshalb steht die Reihenfolge hier.

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
