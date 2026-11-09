#!/bin/bash
# Wegwerf: startet die Probe-Instanz für ein Szenario, höchstens 90 s, ohne Port, ohne Zugriff auf ~/.dsh.
# Aufruf: lauf.sh <szenario> [N]
set -u
S="$1"; N="${2:-3}"
B=/tmp/teams_plus_umbau/probe
rm -f "$B/ergebnis_$S.json"
DSH_HOME=/tmp/teams_plus_umbau/probe_home PROBE_SZENARIO="$S" PROBE_N="$N" PROBE_AUSGABE="$B/ergebnis_$S.json" \
  perl -e 'alarm 90; exec @ARGV' dsh --profile probe --patch "$B/probe.patch.yml" > "$B/lauf_$S.log" 2>&1
echo "exit=$?"
