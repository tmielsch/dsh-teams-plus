# Einbau und Rücknahme — die zwei Wege für `send_to_session`

Stand: 2026-10-31, 06:00 (Europe/Berlin). Diese Datei ist eine **Vorbereitung**, keine
Ausführung. Nichts davon ist geschehen.

## Der Ist-Zustand, gemessen

| Was | Wert | Beleg |
|---|---|---|
| Paket im Profil | `@tmielsch/dsh-teams-plus` **0.4.0** | `node_modules/…/package.json` |
| Bezugsquelle im Profil | `https://github.com/tmielsch/dsh-teams-plus/releases/download/v0.4.0/tmielsch-dsh-teams-plus-0.4.0.tgz` | `~/.dsh/profiles/web/package.json`, `dependencies` |
| In `dsh.profile.bundles` | ja | ebd. |
| Treffer im **Profil**-Patch | **0** | `grep -c 'send-to-session' ~/.dsh/profiles/web/cordis.patch.yml` |
| Treffer im **Bundle**-Patch des Pakets | **1**, Zeile 34 (`- id: send-to-session`) | `node_modules/@tmielsch/dsh-teams-plus/cordis.patch.yml` |
| Live im Loader | `include:send-to-session`, `enabled: true`, `fiberPhase: active` | Cordis-Werkzeug-Inspect |
| Geladene Datei | `md5 38683855484768a3a43e9dc49cab899c` = die in `STOPP-V0.4.0.md` gesperrte Fassung | `md5 -q` |
| Repo-Stand (ungeprüft) | `md5 928af3d0…` | `md5 -q patches/send-to-session.mjs` |

**Die Sperre ist im Betrieb nicht in Kraft.** Sie prüfte den Profil-Patch, die Zeile steht aber im
Bundle-Patch des Pakets — und ein Bundle bringt seinen Patch mit.

---

## Weg A — v0.6.0 einbauen (nach Red-Team-Freigabe)

Voraussetzung: Die zweite Red-Team-Runde gibt `bf4854a` (oder einen Nachfolger) frei.

```bash
cd ~/dsh-teams-plus
npm test                        # muss grün sein, 121 Tests
pnpm pack                       # erzeugt tmielsch-dsh-teams-plus-0.6.0.tgz
dsh plugin --profile web add file:/Users/tmielsch/dsh-teams-plus/tmielsch-dsh-teams-plus-0.6.0.tgz
# danach: dsh web neu starten
```

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
