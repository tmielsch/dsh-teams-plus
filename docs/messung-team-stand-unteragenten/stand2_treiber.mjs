/**
 * Wegwerf-Messetreiber 2, Stand/M8-Analogie fuer Unteragenten (2026-11-10).
 * Lauf 1 zeigte: Unteragenten werden nach ihrem ersten Turn abgebaut; die Gegenprobe
 * "Ziel aus der Datei lesen" war dadurch nicht bewiesen. Hier:
 *   kindKurz  Ziel mit maxGoalRounds 2 und [[LONG]] -> laeuft kurz, dann TOT. Die
 *             Datei-Projektion muss trotzdem das Ziel zeigen (Gegenprobe M8).
 *   kindLang  Ziel mit 60 Runden, bleibt lebendig; Eltern fuer einen Enkel.
 *   kindOhne  kein Ziel (Vergleichsfall: Projektion muss null sein).
 * Zaehler getrennt: Agenten-Erneuerung und laufende ZUEGE NACH KINDERN
 * (Lead-Zuege beim team_stand-Aufruf sind kein Weckruf).
 */
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

export const name = "probe-stand2";
export const inject = ["agents", "subagents", "goals", "agentTeams"];

const B = "/tmp/teams_plus_umbau/probe";
const AUSGABE = process.env.PROBE_AUSGABE ?? `${B}/stand2_ergebnis.json`;
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const kurz = (c) => { try { return JSON.stringify(c).slice(0, 600); } catch { return String(c).slice(0, 600); } };

export function apply(ctx) {
  const t0 = Date.now();
  const protokoll = [];
  const log = (art, d = {}) => protokoll.push({ ms: Date.now() - t0, art, ...d });
  const extra = {};

  let leadId = "";
  let neu = 0;
  let zuegeLead = 0;
  let zuegeKinder = 0;
  ctx.on("agent/created", ({ agent }) => {
    const id = String(agent?.id);
    if (id !== leadId) { neu += 1; log("agent-created", { id: id.slice(-6) }); }
  });
  ctx.on("agent/status", ({ agent, status }) => {
    if (status !== "running") return;
    if (String(agent?.id) === leadId) zuegeLead += 1; else { zuegeKinder += 1; log("kind-laeuft", { id: String(agent.id).slice(-6) }); }
  });

  const snapshot = () => ({ neu, zuegeKinder, zuegeLead, lebt: ctx.agents.list().map((a) => String(a.id).slice(-6)) });
  const diff = (v, n) => ({ neueAgenten: n.neu - v.neu, neueKinderZuege: n.zuegeKinder - v.zuegeKinder, lebtNeu: n.lebt.filter((i) => !v.lebt.includes(i)), lebtWeg: v.lebt.filter((i) => !n.lebt.includes(i)) });

  const liesZiel = async (id) => {
    const agent = ctx.agents.get(id);
    const vor = snapshot();
    const lebendZiel = agent ? (() => { try { return ctx.goals.get(agent); } catch { return null; } })() : null;
    let beob = null; let dauerMs = null; let febler = null;
    const uhr = Date.now();
    try { beob = await ctx.get("sessionQuery").observeSession(id, {}); } catch (fehler) { febler = String(fehler?.message ?? fehler).slice(0, 200); }
    dauerMs = Date.now() - uhr;
    const nach = snapshot();
    const p = beob?.projections?.values?.goal;
    return {
      lebtAgent: agent !== undefined, status: agent?.status ?? "TOT",
      zielAusRegistry: lebendZiel == null ? null : { phase: lebendZiel.phase, aktivierung: lebendZiel.activation, runden: lebendZiel.roundsStarted },
      projektionRoh: p === undefined ? "undefined" : kurz(p).slice(0, 220),
      projektionGoal: p?.goal == null ? null : { phase: p.goal.phase, runden: p.roundsStarted ?? p.goal.roundsStarted ?? null, wortlaut: String(p.goal.objective ?? "").slice(0, 80) },
      letzteEreignisZeit: beob?.events?.at?.(-1)?.time ?? null,
      dauerMs, febler, fenster: diff(vor, nach)
    };
  };

  (async () => {
    try {
      await warte(1500);
      leadId = `lead-stand2-${Date.now()}`;
      const lead = (await ctx.agents.create({ sessionId: leadId, meta: { cwd: B }, agentOptions: { provider: "probe", model: "m" } })).agent;

      const legeKind = async (name, prompt) => {
        const id = randomUUID();
        try {
          await ctx.subagents.startContinuable({
            provider: "spawn", label: `Stand2 ${name}`, childId: id,
            request: { label: `Stand2 ${name}`, prompt: [{ type: "text", text: prompt }], parent: lead },
            signal: new AbortController().signal
          });
        } catch (fehler) { log("kind-fehler", { name, grund: String(fehler?.message ?? fehler).slice(0, 250) }); }
        return id;
      };

      // Kinder anlegen und SOFORT das Ziel setzen, solange sie noch lebendig sind.
      const idKurz = await legeKind("kindKurz", "kurz [[SLOW]]");
      let zKurz = null;
      { const k = ctx.agents.get(idKurz); if (k) { zKurz = ctx.goals.create(k, { objective: "Probe-Ziel kurz [[LONG]]", maxGoalRounds: 2 }); log("ziel-kurz", { id: String(zKurz?.id), phase: zKurz?.phase }); } else log("ziel-kurz-fehlt", { grund: "Kind nicht lebendig" }); }
      await warte(40);
      const idOhne = await legeKind("kindOhne", "ohne [[SLOW]]");
      const idLang = await legeKind("kindLang", "lang [[SLOW]]");
      let zLang = null;
      { const k = ctx.agents.get(idLang); if (k) { zLang = ctx.goals.create(k, { objective: "Probe-Ziel lange Runden [[LONG]]", maxGoalRounds: 60 }); log("ziel-lang", { id: String(zLang?.id), phase: zLang?.phase }); } else log("ziel-lang-fehlt", {}); }

      await warte(5000);

      // Enkel an kindLang, solange es laeuft.
      const eltern = ctx.agents.get(idLang);
      const idEnkel = randomUUID();
      if (eltern) {
        try {
          await ctx.subagents.startContinuable({ provider: "spawn", label: "Stand2 Enkel", childId: idEnkel, request: { label: "Stand2 Enkel", prompt: [{ type: "text", text: "Enkel [[SLOW]]" }], parent: eltern }, signal: new AbortController().signal });
          log("enkel-ok", {});
        } catch (fehler) { log("enkel-fehler", { grund: String(fehler?.message ?? fehler).slice(0, 250) }); }
      } else log("enkel-uebersprungen", {});

      await warte(1200);

      // Baum-Wahl mit Enkel.
      const vorBaum = snapshot();
      let baum = null;
      try { baum = (await ctx.subagents.listDescendants(lead.id)).map((e) => ({ id: e.id.slice(-6), kind: e.kind, depth: e.depth, parent: String(e.parentId ?? "").slice(-6), mode: e.mode, activity: e.activity, label: e.label })); }
      catch (fehler) { baum = { fehler: String(fehler?.message ?? fehler).slice(0, 250) }; }
      const nachBaum = snapshot();

      const vorDirekt = snapshot();
      let direkt = null;
      try { direkt = (await ctx.subagents.listChildren(idLang)).map((e) => ({ id: e.id.slice(-6), mode: e.mode, label: e.label })); }
      catch (fehler) { direkt = { fehler: String(fehler?.message ?? fehler).slice(0, 250) }; }
      const nachDirekt = snapshot();

      // --- LEBENDES FENSTER: kindLang ---
      const vorL = snapshot();
      const lLang = await liesZiel(idLang);
      const nachL = snapshot();

      // bis 20 s: kindKurz ist fertig (2 Runden a ~3 s), sollte TOT sein
      while (Date.now() - t0 < 21000) await warte(500);
      const vorK = snapshot();
      const lKurz = await liesZiel(idKurz);
      const lOhne = await liesZiel(idOhne);
      const lEnkel = await liesZiel(idEnkel);
      const nachK = snapshot();

      // noch ein Ziel fuer das bereits TOT-Kind anlegen, um den zweiten Fall zu sehen? Nein —
      // das wuerde es wieder zum Leben erwecken. Stattdessen: Zustand festhalten und beenden.
      extra.fenster = {
        baum: diff(vorBaum, nachBaum), direkt: diff(vorDirekt, nachDirekt),
        lebendFenster: diff(vorL, nachL), totFenster: diff(vorK, nachK)
      };
      extra.baum = baum; extra.direktKinderVonKindLang = direkt;
      extra.kindLang = { vorL, lLang, nachL };
      extra.tot = { vorK, lKurz, lOhne, lEnkel, nachK };
      writeFileSync(AUSGABE, JSON.stringify({ szenario: "stand2", kinder: { idKurz: idKurz.slice(-6), idOhne: idOhne.slice(-6), idLang: idLang.slice(-6), idEnkel: idEnkel.slice(-6) }, extra, protokoll: protokoll.filter((z) => z.art !== "kind-laeuft").slice(0, 120), laeuftSumme: zuegeKinder, zuegeLead }, null, 1));
      process.exit(0);
    } catch (fehler) {
      writeFileSync(AUSGABE, JSON.stringify({ fehler: String(fehler?.stack ?? fehler), protokoll }, null, 1));
      process.exit(2);
    }
  })();
}
