#!/bin/bash
# Wegwerf: U-a-Lauf (Nachbesserung 2026-11-10). Aufruf: ua.sh [Alarmsekunden]
set -u
B=/tmp/teams_plus_umbau/probe
H=/tmp/teams_plus_umbau/probe_home
AL="${1:-75}"
mkdir -p "$H/.tm/teams-plus"

cat > "$B/ua.patch.yml" <<EOF
- id: headless-runner
  disabled: true
- id: headless-startup
  disabled: true
- id: agent-default-model
  config:
    provider: probe
    model: m
- insert:
    - id: probe-fake-llm
      name: '$B/fake-llm.mjs'
    - id: probe-ua
      name: '$B/ua_treiber.mjs'
EOF

rm -f "$H/.tm/teams-plus/team-modus.json" "$B/ua_ergebnis.json" "$B/ua.log" "$B/llm-aufrufe.log" "$B/plan.json" "$B/ziel-aktuell.json"
rm -rf "$H/.tm/teams-plus/state/berichte"; rm -f "$H/.tm/teams-plus/state/uebernahmen.json"

perl -e "alarm \$AL; exec @ARGV" env DSH_HOME="$H" PROBE_AUSGABE="$B/ua_ergebnis.json" \
  dsh --profile probe --patch "$B/ua.patch.yml" > "$B/ua.log" 2>&1
rc=$?
echo "exit=$rc"
# Prozess-Hygiene aus dem Zielbrief: danach Probe-Prozesszaehler 0.
rest=$(ps aux | grep -c "[d]sh --profile probe")
echo "probe_procs_nach=$rest"
