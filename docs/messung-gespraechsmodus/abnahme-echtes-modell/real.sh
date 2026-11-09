#!/bin/bash
# Wegwerf: Lauf mit echtem Modell; Aufruf: real.sh <szenario> [sekunden]
# Der Schluessel wird nur in der Umgebung dieses einen Prozesses gesetzt, nie in eine Datei geschrieben.
set -u
S="$1"; T="${2:-150}"; NS="${3:-}"
B=/tmp/teams_plus_umbau/probe
H=/tmp/teams_plus_umbau/probe_home
U=/tmp/teams_plus_umbau/probe_userhome
mkdir -p "$H/.tm/teams-plus/logs" "$U/.dsh/logs"
rm -f "$H/.tm/teams-plus/team-modus.json" "$B/real_$S.json"; [ "$NS" = "notschalter" ] && echo '{"aus": true}' > "$H/.tm/teams-plus/team-modus.json" "$H/.tm/teams-plus/state/uebernahmen.json"
: > "$H/.tm/teams-plus/logs/team-modus.log"; : > "$U/.dsh/logs/goal-await.log"
KEY=$(sed -n 's/^  PCSERVE_API_KEY: *//p' ~/.dsh/.credentials.yaml | tr -d '"')
HOME="$U" PCSERVE_API_KEY="$KEY" DSH_HOME="$H" PROBE_SZENARIO="$S" PROBE_AUSGABE="$B/real_$S.json" \
  perl -e 'alarm shift; exec @ARGV' "$T" dsh --profile probe --patch "$B/real.patch.yml" > "$B/real_$S.log" 2>&1
echo "exit=$?"
unset KEY
rm -f "$H/.tm/teams-plus/team-modus.json"
