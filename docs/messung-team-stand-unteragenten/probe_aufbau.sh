#!/bin/bash
# Probe-Instanz neu aufbauen und einen Lauf fahren (2026-11-12). Eigenes Verzeichnis, kein Port, kein Notschalter.
# Aufruf: probe_aufbau.sh <ausgabe-json> [alarm-sekunden]
# Voraussetzung: Attrappe fake-llm.mjs und Treiber abnahme_treiber.mjs liegen in /tmp/teams_plus_umbau/probe_stand
# (aus main docs/messung-gespraechsmodus/abnahme/fake-llm.mjs und dem Treiber dieses Ordners).
set -u
P=/tmp/teams_plus_umbau/probe_stand
H=/tmp/teams_plus_umbau/probe_stand_home
WORKTREE=/Users/tmielsch/dsh-teams-plus/.worktrees/umsetzung-team-stand-unteragenten
AUSGABE="${1:?ausgabe-json fehlt}"
AL="${2:-150}"
mkdir -p "$P" "$H/.tm/teams-plus/state" "$H/profiles"
[ -f "$H/profiles/probe/package.json" ] || { cp -R ~/.dsh/profiles/headless "$H/profiles/probe"; rm -rf "$H/profiles/probe/node_modules"; printf '%s\n' '# Wegwerf-Probe' '[]' > "$H/profiles/probe/cordis.patch.yml"; }
cp "$WORKTREE/docs/messung-team-stand-unteragenten/abnahme_treiber.mjs" "$P/abnahme_treiber.mjs"
[ -f "$P/fake-llm.mjs" ] && sed -i '' -e "s#/tmp/teams_plus_umbau/probe/#$P/#g" "$P/fake-llm.mjs"
sed -i '' -e "s#const B = \"/tmp/teams_plus_umbau/probe\";#const B = \"$P\";#" -e "s#const H = \"/tmp/teams_plus_umbau/probe_home\";#const H = \"$H\";#" "$P/abnahme_treiber.mjs"
# Team-Modus AN: kein Notschalter in der Probe.
rm -f "$H/.tm/teams-plus/team-modus.json"
rm -f "$H/.tm/teams-plus/state/uebernahmen.json" "$AUSGABE"
rm -rf "$H/.tm/teams-plus/state/berichte"
cat > "$P/probe_stand.patch.yml" <<YEOF
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
      name: '$P/fake-llm.mjs'
    - id: team-modus
      name: '$WORKTREE/patches/team-modus.mjs'
    - id: probe-abnahme
      name: '$P/abnahme_treiber.mjs'
YEOF
perl -e "alarm $AL; exec @ARGV" env DSH_HOME="$H" PROBE_AUSGABE="$AUSGABE" \
  dsh --profile probe --patch "$P/probe_stand.patch.yml" > "$P/lauf.log" 2>&1
echo "exit=$?"
echo "probe_procs_nach=$(ps aux | grep -c '[d]sh --profile probe')"
