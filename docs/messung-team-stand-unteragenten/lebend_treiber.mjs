/**
 * Wegwerf-Messtreiber (2026-11-12): Abnahme 7 mit LEBENDEM Kind und Abnahme 4 (Zaehler).
 * Ein Teammitglied exp haelt ein Kind kind, das per [[LONG]] laenger laeuft. Der Stand wird
 * abgefragt, solange kind lebt; zusaetzlich zaehlt der Treiber Weckrufe je Kennung vor und nach
 * dem Lesen. Schreibt nur Lese-Ergebnisse; keine Nachbearbeitung.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

export const name = "probe-lebend";
export const inject = ["agents", "subagents", "agentTeams", "goals", "llm", "tools"];

const B = "/tmp/teams_plus_umbau/probe_stand";
const AUSGABE = process.env.PROBE_AUSGABE ?? B + "/ergebnis_lebend.json";
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const kurz = (c, g = 300) => { try { return typeof c === "string" ? c.slice(0, g) : JSON.stringify(c).slice(0, g); } catch { return String(c).slice(0, g); } };

export function apply(ctx) {
  const t0 = Date.now();
  const protokoll = [];
  const log = (art, d = {}) => protokoll.push({ ms: Date.now() - t0, art, ...d });
  let leadId = "";
  const neu = [];
  ctx.on("agent/created", ({ agent }) => { const id = String(agent?.id); if (id !== leadId) neu.push(id.slice(-6)); });
  const zuege = new Map();
  ctx.on("agent/status", ({ agent, status }) => {
    if (status !== "running") return;
    const id = String(agent?.id); if (id === leadId) return;
    zuege.set(id.slice(-6), (zuege.get(id.slice(-6)) || 0) + 1);
  });
  const schnapp = () => ({ neu: neu.slice(), zuege: [...zuege] });
  const diff = (a, b) => ({
    neueAgenten: b.neu.filter((x) => !a.neu.includes(x)),
    zuegeJeKennung: b.zuege.map(([k, v]) => [k, v - (new Map(a.zuege).get(k) || 0)]).filter((p) => p[1] > 0),
  });

  (async () => {
    try {
      await warte(1200);
      leadId = `lead-lebend-${Date.now()}`;
      const lead = (await ctx.agents.create({ sessionId: leadId, meta: { cwd: B }, agentOptions: { provider: "probe", model: "m" } })).agent;
      const m = await ctx.agentTeams.spawnTeammate(lead, { name: "exp", description: "Lebend-Experte", prompt: [{ type: "text", text: "Hallo [[SLOW]]" }], context: "fresh", provider: "spawn", agentOptions: { provider: "probe", model: "m" }, signal: new AbortController().signal });
      const expId = m.member.id; log("exp", { id: expId.slice(-6) });
      // Mitglied zuerst lebendig machen: eine lange Nachricht weckt es; warten bis es laeuft.
      ctx.subagents.prompt({ requestId: randomUUID(), parentSessionId: lead.id, childSessionId: expId, mode: "continuable", delivery: "queue", content: [{ type: "text", text: "Weck [[LONG]]" }] }, new AbortController().signal).catch(() => {});
      let exp = ctx.agents.get(expId);
      for (let i = 0; i < 60 && exp === undefined; i += 1) { await warte(200); exp = ctx.agents.get(expId); }
      log("exp-lebt-vor-kind", { lebt: exp !== undefined });
      if (exp === undefined) { writeFileSync(AUSGABE, JSON.stringify({ fatal: "exp nicht lebendig vor Kindanlage", protokoll }, null, 1)); process.exit(2); }
      const kindId = randomUUID();
      await ctx.subagents.startContinuable({ provider: "spawn", label: "Lebend-Kind", childId: kindId, request: { label: "Lebend-Kind", prompt: [{ type: "text", text: "Kind [[LONG]]" }], parent: exp }, signal: new AbortController().signal });
      await warte(1000);
      const kind = ctx.agents.get(kindId);
      log("kind-lebt", { lebt: kind !== undefined, status: kind?.status ?? null });
      if (kind !== undefined) {
        try { ctx.goals.create(kind, { objective: "Lebend-Ziel [[LONG]]", maxGoalRounds: 60 }); log("ziel-kind-gesetzt", {}); } catch (f) { log("ziel-fehler", { grund: kurz(f?.message ?? f) }); }
      }
      // Stand-Fenster: lesen, solange das Kind noch lebt (Zaehlerfenster um den Lesevorgang).
      const vor = schnapp();
      const lebtJetzt = ctx.agents.get(kindId) !== undefined;
      const lesung = { kindLebtVorLesung: lebtJetzt, kindStatus: ctx.agents.get(kindId)?.status ?? null, zielPhase: (() => { const k = ctx.agents.get(kindId); if (!k) return null; try { return ctx.goals.get(k)?.phase ?? null; } catch { return null; } })() };
      const nach = schnapp();
      log("lesung-fenster", { ...lesung, fenster: diff(vor, nach) });
      writeFileSync(AUSGABE, JSON.stringify({ szenario: "lebend-2026-11-12", kindId: kindId.slice(-6), expId: expId.slice(-6), lesung, fenster: diff(vor, nach), protokoll }, null, 1));
      process.exit(0);
    } catch (e) {
      writeFileSync(AUSGABE, JSON.stringify({ fatal: String(e?.stack ?? e).slice(0, 600), protokoll }, null, 1));
      process.exit(2);
    }
  })();
}
