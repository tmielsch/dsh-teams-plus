/**
 * Messetreiber 3 (Wegwerf, 2026-11-10): Kann team_stand die AKTIVIERUNG
 * (scharf/entschaerft) eines abgebauten Unteragenten aus der Datei rekonstruieren?
 * Die Projektion `goal` traegt nach Lauf 2 kein Feld `aktivierung`. Hier:
 *   Kind 1: Ziel mit vielen Runden -> goals.pause -> bis abgebaut -> aus der Datei lesen.
 *   Kind 2: Ziel mit vielen Runden -> goals.disarm (active/disarmed, Muster await_goal_dependency)
 *           -> bis abgebaut -> aus der Datei lesen.
 * Frage: steht in Projektion oder Protokoll genug fuer Phase/Aktivierung/Runden pro Zeile?
 */
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

export const name = "probe-stand3";
export const inject = ["agents", "subagents", "goals"];

const B = "/tmp/teams_plus_umbau/probe";
const AUSGABE = process.env.PROBE_AUSGABE ?? `${B}/stand3_ergebnis.json`;
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const kurz = (c) => { try { return JSON.stringify(c).slice(0, 500); } catch { return String(c).slice(0, 500); } };

export function apply(ctx) {
  const t0 = Date.now();
  const protokoll = [];
  const log = (art, d = {}) => protokoll.push({ ms: Date.now() - t0, art, ...d });
  let neu = 0;
  let zuegeKinder = 0;
  let leadId = "";
  ctx.on("agent/created", ({ agent }) => { if (String(agent?.id) !== leadId) { neu += 1; log("agent-created", { id: String(agent.id).slice(-6) }); } });
  ctx.on("agent/status", ({ agent, status }) => { if (status === "running" && String(agent?.id) !== leadId) zuegeKinder += 1; });
  const zielEvents = [];
  ctx.on("goal/changed", ({ agent, change }) => zielEvents.push({ ms: Date.now() - t0, wer: String(agent.id).slice(-6), op: change?.operation, phase: change?.goal?.phase, akt: change?.goal?.activation, runden: change?.goal?.roundsStarted }));

  const legeKind = async (label, prompt) => {
    const id = randomUUID();
    try {
      await ctx.subagents.startContinuable({
        provider: "spawn", label, childId: id,
        request: { label, prompt: [{ type: "text", text: prompt }], parent: lead },
        signal: new AbortController().signal
      });
    } catch (fehler) { log("kind-fehler", { label, grund: String(fehler?.message ?? fehler).slice(0, 250) }); }
    return id;
  };

  let lead = null;
  const lies = async (sid, marke) => {
    const vor = { neu, zuegeKinder };
    const uhr = Date.now();
    let beob = null; let febler = null;
    try { beob = await ctx.get("sessionQuery").observeSession(sid, {}); } catch (fehler) { febler = String(fehler?.message ?? fehler).slice(0, 250); }
    const dauerMs = Date.now() - uhr;
    const nach = { neu, zuegeKinder };
    const alle = (beob?.events ?? []);
    const goalEvents = alle.filter((e) => String(e.type).toLowerCase().includes("goal")).map((e) => ({ seq: e.seq, type: e.type, zeit: e.time, daten: kurz(e.data) }));
    const p = beob?.projections?.values?.goal;
    return {
      marke, kind: sid.slice(-6), lebtAgent: ctx.agents.get(sid) !== undefined, dauerMs, febler,
      fensterWeckruf: { neueAgenten: nach.neu - vor.neu, neueKinderZuege: nach.zuegeKinder - vor.zuegeKinder },
      projektionRoh: kurz(p), projektionKeys: p == null ? [] : Object.keys(p),
      goalEventsInDerDatei: goalEvents, anzahlGoalEvents: goalEvents.length,
      letzteEreignisse: alle.slice(-8).map((e) => ({ seq: e.seq, type: e.type, zeit: e.time })),
      alleTypes: [...new Set(alle.map((e) => e.type))].slice(0, 60)
    };
  };

  (async () => {
    try {
      await warte(1500);
      leadId = `lead-stand3-${Date.now()}`;
      const angelegt = await ctx.agents.create({ sessionId: leadId, meta: { cwd: B }, agentOptions: { provider: "probe", model: "m" } });
      lead = angelegt.agent;

      const id1 = await legeKind("Stand3 pausiert", "lang [[SLOW]]");
      const z1 = (() => { const k = ctx.agents.get(id1); return k ? ctx.goals.create(k, { objective: "Probe-Ziel zum Pausieren [[LONG]]", maxGoalRounds: 60 }) : null; })();
      const id2 = await legeKind("Stand3 entwaffnet", "lang [[SLOW]]");
      const z2 = (() => { const k = ctx.agents.get(id2); return k ? ctx.goals.create(k, { objective: "Probe-Ziel zum Entwaffnen [[LONG]]", maxGoalRounds: 60 }) : null; })();
      await warte(2200);

      const pausen = [];
      { const k = ctx.agents.get(id1); if (k && z1) { try { const r = ctx.goals.pause(k, { id: z1.id, revision: z1.revision }); pausen.push({ art: "pause", phase: r?.goal?.phase ?? null, akt: r?.goal?.activation ?? null, ergebnis: kurz(r).slice(0, 220) }); } catch (fehler) { pausen.push({ art: "pause", fehler: String(fehler?.message ?? fehler).slice(0, 200) }); } } else pausen.push({ art: "pause", grund: "Kind oder Ziel fehlt" }); }
      const entwaffneten = [];
      { const k = ctx.agents.get(id2); if (k && z2) { try { const r = ctx.goals.disarm(k); entwaffneten.push({ art: "disarm", phase: r?.goal?.phase ?? null, akt: r?.goal?.activation ?? null }); } catch (fehler) { entwaffneten.push({ art: "disarm", fehler: String(fehler?.message ?? fehler).slice(0, 200) }); } } else entwaffneten.push({ art: "disarm", grund: "Kind oder Ziel fehlt" }); }
      log("zustand-setzen", { pausen, entwaffneten });

      const amAnfang = Date.now();
      for (let i = 0; i < 110; i += 1) {
        if (ctx.agents.get(id1) === undefined && ctx.agents.get(id2) === undefined) break;
        await warte(250);
      }
      const wartMs = Date.now() - amAnfang;
      log("zustand-vor-lesen", { lebt1: ctx.agents.get(id1) !== undefined, lebt2: ctx.agents.get(id2) !== undefined, wartMs });

      const r1 = await lies(id1, "pausiert");
      const r2 = await lies(id2, "entwaffnet");
      writeFileSync(AUSGABE, JSON.stringify({
        szenario: "stand3", pausen, entwaffneten, wartMs,
        faelle: [r1, r2],
        zielEventsWaehrendDesLaufs: zielEvents
      }, null, 1));
      process.exit(0);
    } catch (fehler) {
      writeFileSync(AUSGABE, JSON.stringify({ fehler: String(fehler?.stack ?? fehler), protokoll }, null, 1));
      process.exit(2);
    }
  })();
}
