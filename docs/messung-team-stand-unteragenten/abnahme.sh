#!/bin/bash
# Wegwerf: Abnahme-Lauf team_stand Unteragenten (Nachbau 2026-11-11). Aufruf: abnahme.sh [Alarmsekunden]
set -u
B=/tmp/teams_plus_umbau/probe
H=/tmp/teams_plus_umbau/probe/../probe_home
AL="${1:-90}"

cat > "$B/abnahme.patch.yml" <<EOF
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
    - id: probe-abnahme
      name: '$B/abnahme_treiber.mjs'
EOF

rm -f "$H/.tm/teams-plus/team-modus.json" "$H/.tm/teams-plus/state/uebernahmen.json" "${PROBE_AUSGABE:-$B/ergebnis_abnahme.json}" "$B/abnahme.log" "$B/llm-aufrufe.log"
rm -rf "$H/.tm/teams-plus/state/berichte"

# Notschalter auf Wunsch vor dem Lauf setzen (Umweltvariable NOTSCHALTER=1).
if [ "${NOTSCHALTER:-0}" = "1" ]; then mkdir -p "$H/.tm/teams-plus"; printf '{"aus":true}\n' > "$H/.tm/teams-plus/team-modus.json"; fi

perl -e "alarm \$AL; exec @ARGV" env DSH_HOME="$H" PROBE_AUSGABE="${PROBE_AUSGABE:-$B/ergebnis_abnahme.json}" \
  dsh --profile probe --patch "$B/abnahme.patch.yml" > "$B/abnahme.log" 2>&1
rc=$?
echo "exit=$rc"
rest=$(ps aux | grep -c "[d]sh --profile probe")
echo "probe_procs_nach=$rest"
tail -5 "$B/abnahme.log"
