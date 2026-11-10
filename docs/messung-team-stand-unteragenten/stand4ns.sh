#!/bin/bash
# Wegwerf: stand4 mit gedrücktem Notschalter — verhält sich team_stand außerhalb
# des Team-Modus beim Zeigen der Mitglieder anders? Ergebnis stand4ns_ergebnis.json.
set -u
B=/tmp/teams_plus_umbau/probe
H=/tmp/teams_plus_umbau/probe_home
AL="${1:-90}"
mkdir -p "$H/.tm/teams-plus"
rm -rf "$H/.tm/teams-plus/state/berichte"; rm -f "$H/.tm/teams-plus/state/uebernahmen.json" "$B/stand4ns_ergebnis.json" "$B/llm-aufrufe.log"
echo '{"aus": true}' > "$H/.tm/teams-plus/team-modus.json"
perl -e "alarm \$AL; exec @ARGV" env DSH_HOME="$H" PROBE_AUSGABE="$B/stand4ns_ergebnis.json" \
  dsh --profile probe --patch "$B/stand4.patch.yml" > "$B/stand4ns.log" 2>&1
rc=$?
rm -f "$H/.tm/teams-plus/team-modus.json"
echo "exit=$rc"
