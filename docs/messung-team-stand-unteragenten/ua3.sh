#!/bin/bash
# Wegwerf: U-a3-Lauf (Nachbesserung N3, 2026-11-10). Aufruf: ua3.sh [Alarmsekunden]
# Misst denselben Fall wie ua_treiber.mjs, aber das abgebaute Zwischeneltern ist ein ECHTES Teammitglied
# (agentTeams.spawnTeammate), nicht per startContinuable angelegt. Treiber-Datei wird aus dem Worktree
# in die Probe-Bibliothek kopiert, damit die laeuft, die committed ist.
set -u
B=/tmp/teams_plus_umbau/probe
H=/tmp/teams_plus_umbau/probe_home
AL="${1:-160}"
W="/Users/tmielsch/dsh-teams-plus/.worktrees/umsetzung-team-stand-unteragenten/docs/messung-team-stand-unteragenten"
mkdir -p "$H/.tm/teams-plus"

cp "$W/ua3_treiber.mjs" "$B/ua3_treiber.mjs" || { echo "kopieren fehlgeschlagen"; exit 1; }

cat > "$B/ua3.patch.yml" <<EOF
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
    - id: probe-ua3
      name: '$B/ua3_treiber.mjs'
EOF

rm -f "$H/.tm/teams-plus/team-modus.json" "$B/ua3_ergebnis.json" "$B/ua3.log" "$B/llm-aufrufe.log" "$B/plan.json" "$B/ziel-aktuell.json"
rm -rf "$H/.tm/teams-plus/state/berichte"; rm -f "$H/.tm/teams-plus/state/uebernahmen.json"

perl -e "alarm \$AL; exec @ARGV" env DSH_HOME="$H" PROBE_AUSGABE="$B/ua3_ergebnis.json" \
  dsh --profile probe --patch "$B/ua3.patch.yml" > "$B/ua3.log" 2>&1
rc=$?
echo "exit=$rc"
# Prozess-Hygiene aus dem Zielbrief: danach Probe-Prozesszaehler 0.
rest=$(ps aux | grep -c "[d]sh --profile probe")
echo "probe_procs_nach=$rest"
