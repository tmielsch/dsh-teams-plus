#!/bin/bash
# Startet die Kern-Probe "Kind gehoert auch dem Menschen" aus dem Repo. Wegwerf-Messaufbau, kein Teil des Plugins.
# Anders als docs/messung-eltern-laden/probe-bau.sh startet sie dsh NICHT aus der Installation, sondern aus der KOPIE des Kerns
#   KOPIE=/tmp/teams_plus_kern/kopie/lib/node_modules/@deepseek-ai/dsh   (rsync der Installation, Original nie angefasst)
# und die Bausteine (node_modules) kommen ebenfalls aus der Kopie. Kein Port, kein Webserver, kein Zugriff auf ~/.dsh.
# Eigene Pfade: DSH_HOME=/tmp/teams_plus_kern/probe_home   Arbeitsordner=/tmp/teams_plus_kern/probe   PID-Datei neben diesem Skript.
# Aufruf:  probe-kern.sh <szenario> <etikett>   (etikett = vorher | nachher: nur Name der Ergebnisdatei; der Stand der Kopie entscheidet)
#          probe-kern.sh --zaehler    (Prozesse DIESER Probe, Sollwert 0)
#          probe-kern.sh --beende     (beendet NUR die in probe-kern.pid festgehaltene PID, wenn sie unsere Probe ist)
# Umgebung: TREIBER (Vorgabe treiber-kern.mjs), PROBE_BEHALTE=1 (Sitzungsdateien behalten), PROBE_STDERR=1
set -u
HIER="$(cd "$(dirname "$0")" && pwd)"
EVO="$HIER/../messung-eltern-laden"
KOPIE=/tmp/teams_plus_kern/kopie/lib/node_modules/@deepseek-ai/dsh
B=/tmp/teams_plus_kern/probe
H=/tmp/teams_plus_kern/probe_home
PIDDATEI="$HIER/probe-kern.pid"
if [ "${1:-}" = "--beende" ]; then
  [ -f "$PIDDATEI" ] || { echo "keine PID-Datei, nichts zu beenden"; exit 0; }
  read -r PID _ < "$PIDDATEI"
  if ps -p "$PID" -o command= 2>/dev/null | grep -qF "$B/probe.patch.yml"; then kill "$PID"; echo "beendet $PID"; else echo "PID $PID ist nicht (mehr) unsere Probe, nichts getan"; fi
  rm -f "$PIDDATEI"; exit 0
fi
if [ "${1:-}" = "--zaehler" ]; then
  n=$(ps ax -o command= | grep -F "$B/probe.patch.yml" | grep -vc grep); echo "probe-prozesse=$n"; exit 0
fi
S="${1:?Szenario fehlt}"; E="${2:-vorher}"; AL="${3:-80}"
mkdir -p "$B" "$H"
ln -sfn "$KOPIE/node_modules" "$B/node_modules"
cp "$EVO/fake-llm.mjs" "$EVO/stub-dienste.mjs" "$B/"
TREIBER="${TREIBER:-treiber-kern.mjs}"
case "$TREIBER" in treiber-kern.mjs) cp "$HIER/$TREIBER" "$B/$TREIBER";; *) cp "$EVO/$TREIBER" "$B/$TREIBER";; esac
# Overlay: wie probe-bau.patch.yml OHNE den Patch eltern-laden (er gehoert nicht zu dieser Messung).
sed "s#@@B@@#$B#g; s#@@REPO@@#$HIER#g; s#@@TREIBER@@#$TREIBER#g; /^#MIT# /d" "$EVO/probe-bau.patch.yml" > "$B/probe.patch.yml"
if [ ! -f "$H/profiles/probe/package.json" ]; then
  DSH_HOME="$H" perl -e 'alarm 60; exec @ARGV' node "$KOPIE/lib/bin.js" probe --from-default-profile headless --dump-config > /dev/null 2>&1
  node -e '
    const fs=require("fs"),p=process.argv[1];const d=JSON.parse(fs.readFileSync(p,"utf8"));
    d.dsh.profile.bundles.push("@deepseek-ai/dsh-experimental-agent-team-profile");
    fs.writeFileSync(p,JSON.stringify(d,null,2));' "$H/profiles/probe/package.json"
fi
ERG="$B/ergebnis_${S}_${E}.json"
rm -f "$ERG"
[ "${PROBE_BEHALTE:-}" = "1" ] || rm -f "$B/llm-aufrufe.log"
[ "${PROBE_BEHALTE:-}" = "1" ] || rm -rf "$H/sessions"
[ "${PROBE_BEHALTE:-}" = "1" ] || rm -rf "$H/.tm"
PROBE_STDERR="${PROBE_STDERR:-}" PROBE_SZENARIO="$S" PROBE_MODUS="$E" PROBE_AUSGABE="$ERG" PROBE_LLM_LOG="$B/llm-aufrufe.log" PROBE_HEIM="$H" PROBE_ORDNER="$B" \
  DSH_HOME="$H" perl -e "alarm $AL; exec @ARGV" node "$KOPIE/lib/bin.js" --profile probe --patch "$B/probe.patch.yml" > "$B/lauf_${S}_${E}.log" 2>&1 &
PID=$!
echo "$PID $S $E $(date +%s)" > "$PIDDATEI"
wait "$PID"; echo "exit=$?"
rm -f "$PIDDATEI"
