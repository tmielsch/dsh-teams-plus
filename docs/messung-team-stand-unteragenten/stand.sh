#!/bin/bash
# Wegwerf-Laeuf fuer die Stand-Messung 2026-11-10 (Plan team_stand Unteragenten).
# Aufruf: stand.sh  [Alarmsekunden]  | Ergebnis: probe/stand_ergebnis.json + stand.log
set -u
B=/tmp/teams_plus_umbau/probe
H=/tmp/teams_plus_umbau/probe_home
AL="${1:-100}"
mkdir -p "$H/.tm/teams-plus"
rm -f "$H/.tm/teams-plus/team-modus.json" "$B/stand_ergebnis.json" "$B/plan.json" "$B/ziel-aktuell.json" \
      "$B/llm-aufrufe.log" "$B/stand.log"
rm -f "$H/.tm/teams-plus/state/uebernahmen.json"
rm -rf "$H/.tm/teams-plus/state/berichte"
: > "$H/.tm/teams-plus/logs/team-modus.log" 2>/dev/null

PROBE_ALARM="$AL" PROBE_AUSGABE="$B/stand_ergebnis.json" \
  perl -e "alarm \$ENV{PROBE_ALARM} + 15; exec @ARGV" env DSH_HOME="$H" \
  dsh --profile probe --patch "$B/stand.patch.yml" > "$B/stand.log" 2>&1
echo "exit=$?"
