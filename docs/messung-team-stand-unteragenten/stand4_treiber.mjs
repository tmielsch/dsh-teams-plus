/**
 * Messetreiber 4 (Wegwerf, 2026-11-10): Das real fallende Muster.
 * Lead -> Teammitglied "exp" -> exp startet zwei Unteragenten (Facharbeiter).
 * Geaehlt wird:
 *   1) Was listChildren(exp.id) liefert (Katalog des Teammitglieds, auch nach dessen Abbau)
 *   2) Was team_stand am Lead liefert (nur Mitglieder? Ziel der Facharbeiter sichtbar?)
 *   3) ob irgendetwas davon jemanden weckt (Agent-Erneuerungen, Kinderzuege).
 */
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

export const name = "probe-stand4";
export const inject = ["agents", "subagents", "goals", "agentTeams"];

const B = "/tmp/teams_plus_umbau/probe";
const AUSGABE = process.env.PROBE_AUSGABE ?? `${B}/stand4_ergebnis.json`;
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const kurz = (c) => { try { return JSON.stringify(c).slice(0, 900); } catch { return String(c).slice(0, 900); } };

export function apply(ctx) {
  const t0 = Date.now();
  const protokoll = [];
  const log = (art, d = {}) => protokoll.push({ ms: Date.now() - t0, art, ...d });
  let leadId = "";
  let neu = 0;
  let zuegeKinder = 0;
  ctx.on("agent/created", ({ agent }) => { if (String(agent?.id) !== leadId) { neu += 1; log("agent-created", { id: String(agent.id).slice(-6) }); } });
  ctx.on("agent/status", ({ agent, status }) => { if (status === "running" && String(agent?.id) !== leadId) zuegeKinder += 1; });

  const snapshot = () => ({ neu, zuegeKinder, lebt: ctx.agents.list().map((a) => String(a.id).slice(-6)) });
  const diff = (v, n) => ({ neueAgenten: n.neu - v.neu, neueKinderZuege: n.zuegeKinder - v.zuegeKinder, lebtNeu: n.lebt.filter((i) => !v.lebt.includes(i)), lebtWeg: v.lebt.filter((i) => !n.lebt.includes(i)) });

  (async () => {
    try {
      await warte(1500);
      leadId = `lead-stand4-${Date.now()}`;
      const lead = (await ctx.agents.create({ sessionId: leadId, meta: { cwd: B }, agentOptions: { provider: "probe", model: "m" } })).agent;

      const m = await ctx.agentTeams.spawnTeammate(lead, {
        name: "exp", description: "Probe-Experte", prompt: [{ type: "text", text: "Hallo. [[SLOW]]" }],
        context: "fresh", provider: "spawn", agentOptions: { provider: "probe", model: "m" }, signal: new AbortController().signal
      });
      const expId = m.member.id;
      log("teammitglied", { id: expId.slice(-6), status: m.member.status });

      await warte(1500);
      // Das Teammitglied ist nach seinem ersten kurzen Turn abgebaut (wie in M5b fuer Kinder).
      // Fuer diese Messung muss es LEBENDIG sein, wenn ich ihm Kinder gebe: eine lange Nachricht weckt es.
      ctx.subagents.prompt({ requestId: randomUUID(), parentSessionId: lead.id, childSessionId: expId, mode: "continuable", delivery: "queue", content: [{ type: "text", text: "Weck [[LONG]]" }] }, new AbortController().signal).catch((fehler) => log("weck-fehler", { grund: String(fehler?.message ?? fehler).slice(0, 250) }));
      let exp = ctx.agents.get(expId);
      for (let i = 0; i < 40 && exp === undefined; i += 1) { await warte(250); exp = ctx.agents.get(expId); }
      log("exp-lebendig-fuer-kinder", { lebt: exp !== undefined, ms: Date.now() - t0 });
      if (exp === undefined) { writeFileSync(AUSGABE, JSON.stringify({ fehler: "exp nicht lebendig nach spawn", protokoll })); process.exit(2); return; }

      // 2 Facharbeiter unter exp, ueber dieselbe Route wie delegate_task
      const faIds = [];
      for (const [name, prompt] of [["fachA", "Facharbeiter A mit Ziel [[LONG]]"], ["fachB", "Facharbeiter B ohne Ziel [[SLOW]]"]]) {
        const id = randomUUID();
        try {
          await ctx.subagents.startContinuable({ provider: "spawn", label: `Stand4 ${name}`, childId: id, request: { label: `Stand4 ${name}`, prompt: [{ type: "text", text: prompt }], parent: exp }, signal: new AbortController().signal });
          faIds.push(name === "fachA" ? { name, id } : { name, id });
        } catch (fehler) { log("fa-fehler", { name, grund: String(fehler?.message ?? fehler).slice(0, 250) }); }
      }
      // Ziel fuer fachA sofort
      const kA = ctx.agents.get(faIds[0]?.id);
      if (kA) log("ziel-fachA", { id: String(ctx.goals.create(kA, { objective: "Facharbeiter-Ziel [[LONG]]", maxGoalRounds: 40 })?.id) });

      await warte(4000);

      // --- A: Katalog des Teammitglieds ---
      const vor1 = snapshot();
      let kinderVonExp = null;
      try { kinderVonExp = (await ctx.subagents.listChildren(expId)).map((e) => ({ id: e.id.slice(-6), mode: e.mode, label: e.label })); }
      catch (fehler) { kinderVonExp = { fehler: String(fehler?.message ?? fehler).slice(0, 250) }; }
      let kinderVonLead = null;
      try { kinderVonLead = (await ctx.subagents.listChildren(lead.id)).map((e) => ({ id: e.id.slice(-6), mode: e.mode, label: e.label })); }
      catch (fehler) { kinderVonLead = { fehler: String(fehler?.message ?? fehler).slice(0, 250) }; }
      let baumVonLead = null;
      try { baumVonLead = (await ctx.subagents.listDescendants(lead.id)).map((e) => ({ id: e.id.slice(-6), kind: e.kind, depth: e.depth, parent: String(e.parentId ?? "").slice(-6), mode: e.mode, activity: e.activity, label: e.label })); }
      catch (fehler) { baumVonLead = { fehler: String(fehler?.message ?? fehler).slice(0, 250) }; }
      const nach1 = snapshot();

      // --- B: team_stand am Lead, im Team-Modus ---
      await warte(1500);
      const vor2 = snapshot();
      let standJson = null;
      try {
        const ab = lead.session.seq;
        lead.followup((await import("@deepseek-ai/dsh-llm")).createUserMessage({ content: [{ type: "text", text: "Rufe [[TOOL:team_stand:{}]]" }], source: { kind: "user" } }));
        await warte(3000);
        standJson = lead.session.snapshotEvents(ab).filter((e) => e.type === "tool/result").map((e) => kurz(e.data?.message?.content ?? e.data));
      } catch (fehler) { standJson = ["FEHLER: " + String(fehler?.message ?? fehler).slice(0, 250)]; }
      const nach2 = snapshot();

      writeFileSync(AUSGABE, JSON.stringify({
        szenario: "stand4", kinderVonExp, kinderVonLead, baumVonLead,
        teamStandAmLead: standJson,
        fensterKatalog: diff(vor1, nach1), fensterStand: diff(vor2, nach2),
        protokoll
      }, null, 1));
      process.exit(0);
    } catch (fehler) {
      writeFileSync(AUSGABE, JSON.stringify({ fehler: String(fehler?.stack ?? fehler), protokoll }, null, 1));
      process.exit(2);
    }
  })();
}
