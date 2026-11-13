#!/bin/bash
set -u
B=/tmp/teams_plus_umbau/probe
H=/tmp/teams_plus_umbau/probe_home
AL="${1:-45}"
rm -f "$B/stand2.patch.yml.tmp"
cat > "$B/stand2.patch.yml" <<EOF
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
    - id: team-modus
      name: '/Users/tmielsch/dsh-teams-plus/.worktrees/umsetzung-team-stand-unteragenten/patches/team-modus.mjs'
    - id: probe-stand2
      name: '$B/stand2_treiber.mjs'
EOF
rm -f "$H/.tm/teams-plus/team-modus.json" "$B/stand2_ergebnis.json" "$B/stand2.log" \
      "$B/plan.json" "$B/ziel-aktuell.json" "$B/llm-aufrufe.log"
rm -rf "$H/.tm/teams-plus/state/berichte"; rm -f "$H/.tm/teams-plus/state/uebernahmen.json"
PROBE_ALARM="$AL" PROBE_AUSGABE="$B/stand2_ergebnis.json" \
  perl -e "alarm \$ENV{PROBE_ALARM} + 10; exec @ARGV" env DSH_HOME="$H" \
  dsh --profile probe --patch "$B/stand2.patch.yml" > "$B/stand2.log" 2>&1
echo "exit=$?"
