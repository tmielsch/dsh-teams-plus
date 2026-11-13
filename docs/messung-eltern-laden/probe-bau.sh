#!/bin/bash
# Startet die Bau-Probe "Eltern-Sitzung laden" aus dem Repo. Wegwerf-Messaufbau, kein Teil des Plugins.
# Kein Port, kein Webserver, kein Zugriff auf ~/.dsh. Eigene Pfade (nicht probe, probe_eltern, probe_stand):
#   DSH_HOME = /tmp/teams_plus_umbau/probe_eltern_bau_home    Arbeitsordner = /tmp/teams_plus_umbau/probe_eltern_bau
# Aufruf:  probe-bau.sh <szenario> [mit|ohne] [alarmsekunden]   (mit = gebauter Patch geladen, ohne = Gegenprobe)
#          probe-bau.sh --zaehler                               (Prozesse DIESER Probe; Sollwert 0)
#          probe-bau.sh --beende                                (beendet NUR die in probe-eltern-bau.pid festgehaltene PID)
set -u
HIER="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HIER/../.." && pwd)"
B=/tmp/teams_plus_umbau/probe_eltern_bau
H=/tmp/teams_plus_umbau/probe_eltern_bau_home
PIDDATEI="$HIER/probe-eltern-bau.pid"
if [ "${1:-}" = "--beende" ]; then
  [ -f "$PIDDATEI" ] || { echo "keine PID-Datei, nichts zu beenden"; exit 0; }
  read -r PID _ < "$PIDDATEI"
  if ps -p "$PID" -o command= 2>/dev/null | grep -qF "$B/probe.patch.yml"; then kill "$PID"; echo "beendet $PID"; else echo "PID $PID ist nicht (mehr) unsere Probe, nichts getan"; fi
  rm -f "$PIDDATEI"; exit 0
fi
if [ "${1:-}" = "--zaehler" ]; then
  n=$(ps ax -o command= | grep -F "dsh --profile probe" | grep -F "$B/probe.patch.yml" | grep -vc grep); echo "probe-prozesse=$n"; exit 0
fi
S="${1:?Szenario fehlt}"; MODUS="${2:-mit}"; AL="${3:-80}"
mkdir -p "$B" "$H"
DSH_PAKET="$(cd "$(dirname "$(readlink -f "$(command -v dsh)")")/.." && pwd)"
ln -sfn "$DSH_PAKET/node_modules" "$B/node_modules"
cp "$HIER/fake-llm.mjs" "$HIER/stub-dienste.mjs" "$B/"
TREIBER="${TREIBER:-treiber-bau.mjs}"
cp "$HIER/$TREIBER" "$B/$TREIBER"
if [ "$MODUS" = "mit" ]; then
  sed "s#@@B@@#$B#g; s#@@REPO@@#$REPO#g; s#@@TREIBER@@#$TREIBER#g; s/^#MIT# //" "$HIER/probe-bau.patch.yml" > "$B/probe.patch.yml"
else
  sed "s#@@B@@#$B#g; s#@@REPO@@#$REPO#g; s#@@TREIBER@@#$TREIBER#g; /^#MIT# /d" "$HIER/probe-bau.patch.yml" > "$B/probe.patch.yml"
fi
if [ ! -f "$H/profiles/probe/package.json" ]; then
  DSH_HOME="$H" perl -e 'alarm 60; exec @ARGV' dsh probe --from-default-profile headless --dump-config > /dev/null 2>&1
  node -e '
    const fs=require("fs"),p=process.argv[1];const d=JSON.parse(fs.readFileSync(p,"utf8"));
    d.dsh.profile.bundles.push("@deepseek-ai/dsh-experimental-agent-team-profile");
    fs.writeFileSync(p,JSON.stringify(d,null,2));' "$H/profiles/probe/package.json"
fi
ERG="$B/ergebnis_${S}_${MODUS}.json"
rm -f "$ERG"
[ "${PROBE_BEHALTE:-}" = "1" ] || rm -f "$B/llm-aufrufe.log"
[ "${PROBE_BEHALTE:-}" = "1" ] || rm -rf "$H/sessions"
# Notschalter-Datei und Protokoll der Probe gehören der Probe (DSH_HOME ist unser eigener Ordner), nie ~/.dsh
[ "${PROBE_BEHALTE:-}" = "1" ] || rm -rf "$H/.tm"
PROBE_STDERR="${PROBE_STDERR:-}" PROBE_SZENARIO="$S" PROBE_MODUS="$MODUS" PROBE_AUSGABE="$ERG" PROBE_LLM_LOG="$B/llm-aufrufe.log" PROBE_HEIM="$H" PROBE_ORDNER="$B" \
  DSH_HOME="$H" perl -e "alarm $AL; exec @ARGV" dsh --profile probe --patch "$B/probe.patch.yml" > "$B/lauf_${S}_${MODUS}.log" 2>&1 &
PID=$!
echo "$PID $S $MODUS $(date +%s)" > "$PIDDATEI"
wait "$PID"; echo "exit=$?"
rm -f "$PIDDATEI"
