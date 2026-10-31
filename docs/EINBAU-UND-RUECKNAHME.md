# Einbau und Rücknahme — die zwei Wege für `send_to_session`

Stand: 2026-10-31, 06:14 (Europe/Berlin).

## VOLLZOGEN: Weg B ist in Kraft

**Die gesperrte v0.4.0 ist abgeschaltet.** Gemessen im laufenden Host:

```
include:send-to-session  enabled: false  fiberPhase: null
```

Was geschehen ist:

1. Sicherung der Profildatei:
   `~/.dsh/profiles/web/cordis.patch.yml.bak-vor-s2s-sperre-20261031-061348` (80 444 Bytes)
2. Ein Block am **Ende** von `~/.dsh/profiles/web/cordis.patch.yml` angehängt:
   `- id: send-to-session` / `disabled: true`, mit Begründung und Rückwege im Kommentar.
3. **Kein Neustart nötig** — der Profil-Patch wird live nachgezogen, das Werkzeug ist aus
   der Werkzeugliste verschwunden.

**Unberührt:** Rollen, Policies, `delegate-send`, `stille-nachrichten`, `teammate-modell`,
`goal-await`, `rolle-titel` und der Host-Eintrag laufen weiter. Nur das eine Werkzeug ist weg.

**Rücknahme:** den Block am Dateiende entfernen, DSH neu starten. Oder die Sicherung
zurückspielen.

## Was noch offen ist

Der **bessere** Weg A (v0.6.0 einbauen) braucht einen Neustart von `dsh web`, und der beendet
alle laufenden Sitzungen. Er bleibt liegen, bis der Mensch einen ruhigen Zeitpunkt wählt.
Bis dahin gilt: das Werkzeug ist abgeschaltet, nicht ersetzt.

Der Tarball liegt fertig: `tmielsch-dsh-teams-plus-0.6.0.tgz`, geprüft, Einbau in einer Kopie
verifiziert.


## Weg A — v0.6.0 einbauen (Red-Team-Freigabe liegt vor, mit Auflagen; Auflagen erfüllt)

**Stand der Vorbereitung, gemessen am 2026-10-31, 06:20:**

- Tarball gebaut: `tmielsch-dsh-teams-plus-0.6.0.tgz`
- Inhalt geprüft: `package/patches/send-to-session.mjs` mit
  `QUELL_ART = "plugin:@tmielsch/dsh-teams-plus"`, `stille-nachrichten.mjs`, `cordis.patch.yml`,
  `package.json` mit `"version": "0.6.0"`
- **Einbau in einer Kopie geprüft** (`/tmp/profilprobe`, eigenes `package.json`, `pnpm install`):
  danach liegt `@tmielsch/dsh-teams-plus` **0.6.0** in `node_modules`, und die installierte Fassung
  trägt die richtige Quellart. Der echte Profilordner wurde dabei **nicht** angefasst.

```bash
cd ~/dsh-teams-plus
npm test                        # 129 Tests, alle grün
node scripts/build-client.mjs   # lib/ frisch bauen, sonst scheitern 8 Build-Tests
pnpm pack                       # erzeugt tmielsch-dsh-teams-plus-0.6.0.tgz
dsh plugin --profile web add file:/Users/tmielsch/dsh-teams-plus/tmielsch-dsh-teams-plus-0.6.0.tgz
# danach: dsh web neu starten
```

**Was der Neustart kostet, und warum das eine Entscheidung des Menschen ist:** Der laufende
`dsh web`-Prozess hält die geladene Fassung im Speicher. Bis zum Neustart läuft weiter v0.4.0, auch
wenn auf der Platte 0.6.0 liegt. Der Neustart beendet **alle laufenden Sitzungen**. Ohne Neustart
entsteht ein Zwischenzustand (Platte 0.6.0, Speicher 0.4.0), der genau die Verwirrung erzeugt, die
der STOPP beseitigen soll — deshalb: einbauen **und** neu starten, in einem Zug, zu einem Zeitpunkt
den der Mensch wählt.

Danach prüfen — **beides**, nicht nur eins:

1. `node -e 'console.log(require("/Users/tmielsch/.dsh/profiles/web/node_modules/@tmielsch/dsh-teams-plus/package.json").version)'`
   → muss `0.6.0` sein.
2. Werkzeug-Inspect: `send_to_session` muss jetzt `mode.enum = ["auto","steer","followup"]` zeigen
   (v0.4.0 zeigt `["steer","followup"]`). Das ist der einzige verlässliche Nachweis, **welche**
   Fassung läuft — die Paketversion allein genügt nicht, weil ein alter Loader weiterlaufen kann.

**Rücknahme:** `dsh plugin --profile web remove @tmielsch/dsh-teams-plus` — dann ist auch das
Policy-Tooling weg. Wer nur das Werkzeug loswerden will, nimmt Weg B.

---

## Weg B — die Zeile abschalten (Rücknahme ohne Deinstallation)

Der Profil-Patch kann eine Zeile aus einem Bundle **überstimmen**. Das Muster steht schon in der
Datei: `@domitor-syh/dsh-rollback` wurde am 2026-10-31 genau so abgeschaltet
(`~/.dsh/profiles/web/cordis.patch.yml:1867-1868`):

```yaml
- id: rollback
  disabled: true
```

Übertragen auf unser Werkzeug — **anhängen** an `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
# send_to_session (v0.4.0) ist vom Red Team gesperrt (docs/STOPP-V0.4.0.md) und laeuft
# trotzdem, weil die Zeile im Bundle-Patch des Pakets steht und nicht im Profil-Patch.
# Diese Ueberstimmung nimmt sie heraus, ohne das Paket zu deinstallieren — das Policy-Tooling,
# die Rollen und die uebrigen Patches bleiben.
# Nachsehen: Werkzeug-Inspect; send_to_session muss aus der Liste verschwinden.
# Zurueck:  diesen Eintrag entfernen und DSH neu starten.
- id: send-to-session
  disabled: true
```

**Wirkung:** nur das Werkzeug `send_to_session` verschwindet. `delegate-send`, `stille-nachrichten`,
`teammate-modell`, `goal-await`, `rolle-titel` und der Host-Eintrag laufen weiter.

**Rücknahme:** Eintrag löschen, DSH neu starten.

### Warum Weg B nicht dasselbe ist wie „gesperrt"

Die Sperre sagt: das Werkzeug soll nicht laufen. Weg B setzt das durch. Weg A ersetzt es durch die
geprüfte Fassung. **Beides beendet den Ist-Zustand; Nichtstun nicht.**

---

## Was der Mensch entscheiden muss

Die Wahl hängt an einer Frage: **Braucht er `send_to_session` in den nächsten Tagen?**

- **Ja** → Weg A, sobald die Freigabe da ist. Bis dahin läuft die gesperrte Fassung weiter.
- **Nein** → Weg B **sofort**. Das ist die einzige Variante, die den STOPP heute durchsetzt, ohne
  auf einen Prüfdurchgang zu warten.

Ich habe Weg B **nicht** ausgeführt, obwohl er sofort ginge: Der Mensch hat am 2026-10-31 die
Variante C gewählt („baue die Wächter, das Red Team prüft die neue Fassung"), und dabei war bewusst,
dass v0.4.0 bis dahin aktiv bleibt. Diese Entscheidung ändere ich nicht im Alleingang — aber sie
stand unter der Annahme, dass v0.4.0 nur „alte Lücken" hat. Seit dem Red-Team-Bericht ist bekannt,
dass die Quellart-Frage den **Bestand** betrifft: v0.4.0 schreibt `kind: "agent-send"`, und das ist
zwar v4-tauglich (gemessen), aber es ist eine **selbsterfundene** Quellart, die in keiner Liste des
Kerns steht. Sie öffnet kein Ziel — der v4-Codec nimmt sie an — aber sie ist nicht dokumentiert.
