#!/bin/bash
# Baut (falls nötig) und startet die Probe-Instanz "Eltern-Sitzung laden" aus dem Repo.
# Wegwerf-Messaufbau, kein Teil des Plugins. Kein Port, kein Webserver, kein Zugriff auf ~/.dsh.
# Aufruf:  probe-eltern.sh <szenario> [alarmsekunden]      (Ergebnis: $B/ergebnis_<szenario>.json, Log: $B/lauf_<szenario>.log)
#          probe-eltern.sh --zaehler                       (Prozesszähler der Probe; Sollwert 0)
# Eigene Pfade, damit der Bau-Worker mit seiner Probe (probe, probe_home) nicht kollidiert:
#   DSH_HOME = /tmp/teams_plus_umbau/probe_eltern_home    Arbeitsordner = /tmp/teams_plus_umbau/probe_eltern
set -u
HIER="$(cd "$(dirname "$0")" && pwd)"
B=/tmp/teams_plus_umbau/probe_eltern
H=/tmp/teams_plus_umbau/probe_eltern_home
if [ "${1:-}" = "--beende" ]; then
  # beendet NUR die in der PID-Datei festgehaltene PID, und nur wenn ihre Kommandozeile noch unsere Probe ist
  PIDDATEI="$HIER/probe-eltern.pid"; [ -f "$PIDDATEI" ] || { echo "keine PID-Datei, nichts zu beenden"; exit 0; }
  read -r PID _ < "$PIDDATEI"
  if ps -p "$PID" -o command= 2>/dev/null | grep -qF "$B/probe.patch.yml"; then kill "$PID"; echo "beendet $PID"; else echo "PID $PID ist nicht (mehr) unsere Probe, nichts getan"; fi
  rm -f "$PIDDATEI"; exit 0
fi
if [ "${1:-}" = "--zaehler" ]; then
  # zählt nur Prozesse dieser Probe (Profil probe + unser DSH_HOME im Aufruf), nie dsh web
  n=$(ps ax -o command= | grep -F "dsh --profile probe" | grep -F "$B" | grep -vc grep); echo "probe-prozesse=$n"; exit 0
fi
S="${1:?Szenario fehlt}"; AL="${2:-80}"
mkdir -p "$B" "$H"
# Kernpakete (@deepseek-ai/dsh-llm usw.) findet Node nur über einen node_modules-Verweis neben den Skripten
DSH_PAKET="$(cd "$(dirname "$(readlink -f "$(command -v dsh)")")/.." && pwd)"
ln -sfn "$DSH_PAKET/node_modules" "$B/node_modules"
cp "$HIER/fake-llm.mjs" "$HIER/treiber.mjs" "$HIER/stub-dienste.mjs" "$B/"
sed "s#@@B@@#$B#g; s#@@HIER@@#$HIER#g" "$HIER/probe.patch.yml" > "$B/probe.patch.yml"
# Profil einmalig anlegen: Vorlage headless plus Bündel experimental-agent-team-profile (Teams, Unteragenten)
if [ ! -f "$H/profiles/probe/package.json" ]; then
  DSH_HOME="$H" perl -e 'alarm 60; exec @ARGV' dsh probe --from-default-profile headless --dump-config > /dev/null 2>&1
  node -e '
    const fs=require("fs"),p=process.argv[1];const d=JSON.parse(fs.readFileSync(p,"utf8"));
    d.dsh.profile.bundles.push("@deepseek-ai/dsh-experimental-agent-team-profile");
    fs.writeFileSync(p,JSON.stringify(d,null,2));' "$H/profiles/probe/package.json"
fi
rm -f "$B/ergebnis_$S.json"
[ "${PROBE_BEHALTE:-}" = "1" ] || rm -f "$B/llm-aufrufe.log"
# PROBE_BEHALTE=1: Sitzungsdateien des vorigen Laufs behalten (Szenario neustart-b)
[ "${PROBE_BEHALTE:-}" = "1" ] || rm -rf "$H/sessions"
# PID-Datei: der Lauf wird im Hintergrund gestartet und seine PID festgehalten. Beendet wird nur diese PID
# (--beende), nie ein Prozess nach Namen. perl exec't dsh, die PID bleibt also dieselbe.
PIDDATEI="$HIER/probe-eltern.pid"
PROBE_STDERR="${PROBE_STDERR:-}" PROBE_SZENARIO="$S" PROBE_AUSGABE="$B/ergebnis_$S.json" PROBE_LLM_LOG="$B/llm-aufrufe.log" PROBE_HEIM="$H" \
  DSH_HOME="$H" perl -e "alarm $AL; exec @ARGV" dsh --profile probe --patch "$B/probe.patch.yml" > "$B/lauf_$S.log" 2>&1 &
PID=$!
echo "$PID $S $(date +%s)" > "$PIDDATEI"
wait "$PID"; echo "exit=$?"
rm -f "$PIDDATEI"
