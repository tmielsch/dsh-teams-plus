#!/bin/bash
# Wegwerf: Abnahmelauf; Aufruf: abnahme.sh <szenario> [N] [notschalter]
set -u
S="$1"; N="${2:-3}"; NS="${3:-}"
B=/tmp/teams_plus_umbau/probe
H=/tmp/teams_plus_umbau/probe_home
mkdir -p "$H/.tm/teams-plus"
rm -f "$H/.tm/teams-plus/team-modus.json" "$B/abnahme_$S.json" "$B/plan.json" "$B/ziel-aktuell.json"
[ "$NS" = "notschalter" ] && echo '{"aus": true}' > "$H/.tm/teams-plus/team-modus.json"
: > "$H/.tm/teams-plus/logs/team-modus.log" 2>/dev/null
DSH_HOME="$H" PROBE_SZENARIO="$S" PROBE_N="$N" PROBE_AUSGABE="$B/abnahme_$S${NS:+_$NS}.json" \
  perl -e 'alarm 90; exec @ARGV' dsh --profile probe --patch "$B/abnahme.patch.yml" > "$B/abnahme_$S.log" 2>&1
echo "exit=$?"
rm -f "$H/.tm/teams-plus/team-modus.json"
