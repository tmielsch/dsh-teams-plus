/**
 * Wegwerf-Messetreiber Abnahme team_stand Unteragenten (Nachbau 2026-11-12, dritte Fassung). Kein Plugin.
 * Laeuft nur in der Probeinstanz. Szene nach Plan Abschnitt 7: zwei Teammitglieder (eines mit Kindern und
 * Enkel, eines ohne Kinder) plus ein eigenes Kind des Aufrufers. fachA bekommt ein pausiertes Ziel (Nr. 2/8:
 * totes Kind in Phase paused, Aktivierung unbekannt); kindC laeuft sein Ziel bis zum Rundenlimit auf 1 und
 * wird blocked (Nr. 2 zweiter Fall); fachA bekommt eine Berichtsdatei (Nr. 7); das eigene Leadkind verliert
 * vor dem team_stand-Aufruf seinen Sitzungsordner (Nr. 3 nicht lesbar); die uebernahmen.json deckt Nr. 9 ab
 * (Mitglied pauseOffen false, Kind pauseOffen true). Weckrufzaehler je Sitzungskennung vor/nach jedem Fenster.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

export const name = "probe-abnahme";
export const inject = ["agents", "subagents", "goals", "agentTeams"];

const B = "/tmp/teams_plus_umbau/probe";
const H = "/tmp/teams_plus_umbau/probe_home";
const AUSGABE = process.env.PROBE_AUSGABE ?? `${B}/ergebnis_abnahme.json`;
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const kurz = (c, g = 400) => { try { return typeof c === "string" ? c.slice(0, g) : JSON.stringify(c).slice(0, g); } catch { return String(c).slice(0, g); } };

export function apply(ctx) {
  const t0 = Date.now();
  const protokoll = [];
  const log = (art, d = {}) => protokoll.push({ ms: Date.now() - t0, art, ...d });
  let leadId = "";
  const neuErzeugt = [];
  ctx.on("agent/created", ({ agent }) => { const id = String(agent?.id); if (id !== leadId) neuErzeugt.push(id.slice(-6)); });
  const zuegeProKennung = new Map();
  ctx.on("agent/status", ({ agent, status }) => {
    if (status !== "running") return;
    const id = String(agent?.id);
    if (id === leadId) return;
    const k = id.slice(-6);
    zuegeProKennung.set(k, (zuegeProKennung.get(k) || 0) + 1);
  });
  const schnapp = () => ({ erzeuge: neuErzeugt.slice(), zuege: Array.from(zuegeProKennung).map(([k, v]) => [k, v]) });
  function fensterDiff(alt, neu) {
    return {
      neueAgentenImFenster: neu.erzeuge.filter((i) => !alt.erzeuge.includes(i)),
      zugenommeneZuegeProKennung: neu.zuege.map(([k, v]) => [k, v - (new Map(alt.zuege).get(k) || 0)]).filter((p) => p[1] > 0)
    };
  }
  const waetBisLebt = async (sid, maxMs) => { let a; const uhr = Date.now(); while (Date.now() - uhr < maxMs) { a = ctx.agents.get(sid); if (a !== undefined && a.status === "running") return a; await warte(100); } return a ?? undefined; };
  const waetBisTot = async (sid, maxMs) => { const uhr = Date.now(); while (Date.now() - uhr < maxMs) { if (ctx.agents.get(sid) === undefined) return true; await warte(200); } return false; };

  (async () => {
    try {
      await warte(1500);
      leadId = `lead-abnahme-${Date.now()}`;
      const angelegt = await ctx.agents.create({ sessionId: leadId, meta: { cwd: B }, agentOptions: { provider: "probe", model: "m" } });
      const lead = angelegt.agent;

      const legeKind = async (label, txt, parent) => {
        const sid = randomUUID();
        try { await ctx.subagents.startContinuable({ provider: "spawn", label, childId: sid, request: { label, prompt: [{ type: "text", text: txt }], parent }, signal: new AbortController().signal }); }
        catch (f) { log("kind-fehler-" + label.slice(-12), { grund: kurz(f?.message ?? f) }); }
        return sid;
      };

      // --- Mitglied exp1 mit Kindern; wachhalten. ---
      const m1 = await ctx.agentTeams.spawnTeammate(lead, { name: "exp1", description: "Abnahme-Experte mit Kindern", prompt: [{ type: "text", text: "Hallo [[LONG]]" }], context: "fresh", provider: "spawn", agentOptions: { provider: "probe", model: "m" }, signal: new AbortController().signal });
      const exp1Id = m1.member.id; log("mitglied-exp1", { id: exp1Id.slice(-6) });
      let exp1 = await waetBisLebt(exp1Id, 8000);
      if (exp1 === undefined) { ctx.subagents.prompt({ requestId: randomUUID(), parentSessionId: lead.id, childSessionId: exp1Id, mode: "continuable", delivery: "queue", content: [{ type: "text", text: "Weck [[LONG]]" }] }, new AbortController().signal).catch(() => {}); exp1 = await waetBisLebt(exp1Id, 10000); }
      log("exp1-lebt-fuer-kinder", { lebt: exp1 !== undefined });

      const kinderIds = {};
      kinderIds.fachA = await legeKind("Abnahme fachA", "Kind mit Ziel [[LONG]]", exp1);
      kinderIds.fachB = await legeKind("Abnahme fachB ohne Ziel", "Kind ohne Ziel [[LONG]]", exp1);

      // Ziel fuer fachA sofort anlegen und pausieren (Nr. 2/8: totes Kind in Phase paused).
      let zielId = null;
      const a = await waetBisLebt(kinderIds.fachA, 6000);
      if (a !== undefined) {
        try { const z = ctx.goals.create(a, { objective: "Abnahme Kind-Ziel pausiert [[LONG]]", maxGoalRounds: 60 }); if (z?.id) { zielId = String(z.id); log("ziel-fachA", { id: zielId.slice(-6), phase: z.phase }); try { ctx.goals.pause(a, { id: z.id, revision: z.revision }); log("pause-fachA", {}); } catch (f) { log("pause-fehler", { grund: kurz(f?.message ?? f) }); } } }
        catch (f) { log("ziel-fehler", { grund: kurz(f?.message ?? f) }); }
      } else { log("fachA-nicht-lebendig-fuer-ziel", {}); }

      // Berichtsdatei fuer fachA-Ziel (Nr. 7).
      const berichtOrdner = `${H}/.tm/teams-plus/state/berichte`; mkdirSync(berichtOrdner, { recursive: true });
      if (zielId) { writeFileSync(`${berichtOrdner}/${zielId}.json`, JSON.stringify({ zielId, revision: 1, sitzung: kinderIds.fachA, zeit: new Date().toISOString(), wortlautZiel: "test", bericht: "Abnahme-Schlussbericht Kind." }, null, 2)); log("bericht-fachA", { pfad: `${berichtOrdner}/${zielId.slice(-6)}.json` }); }

      // --- Enkel UNTER fachA (Plan Nr. 1: depth 2, parentId auf das direkte Kind derselben Gruppe). ---
      let aErneut = ctx.agents.get(kinderIds.fachA);
      if (aErneut === undefined) { ctx.subagents.prompt({ requestId: randomUUID(), parentSessionId: lead.id, childSessionId: kinderIds.fachA, mode: "continuable", delivery: "queue", content: [{ type: "text", text: "WeckKind [[LONG]]" }] }, new AbortController().signal).catch(() => {}); }
      let aLebt = await waetBisLebt(kinderIds.fachA, 8000);
      kinderIds.enkel = aLebt ? await legeKind("Abnahme Enkel", "Enkel unter fachA [[LONG]]", aLebt) : "FEHLER-ELTERN-TOT";
      log("enkel-unter-fachA", { anlage: kinderIds.enkel !== "FEHLER-ELTERN-TOT", id: String(kinderIds.enkel).slice(-6) });

      // --- Drittes Kind in Phase blocked (Ziel laeuft bis Rundenlimit 1, dann paused/tot — Nr. 2 zweiter Fall). ---
      kinderIds.blocked = await legeKind("Abnahme blockedKind", "Runde bis Limit [[LONG]]", exp1);
      let bAgent = await waetBisLebt(kinderIds.blocked, 8000);
      if (bAgent) { try { const zb = ctx.goals.create(bAgent, { objective: "Ziel bis Rundenlimit [[SLOW]]", maxGoalRounds: 1 }); log("ziel-blockedKind", { id: String(zb?.id ?? "?").slice(-6), maxRunden: 1 }); } catch (f) { log("blocked-ziel-fehler", { grund: kurz(f?.message ?? f) }); } }

      // --- Mitglied ohne Kinder; eigenes Kind des Leads. ---
      const m2 = await ctx.agentTeams.spawnTeammate(lead, { name: "exp2", description: "Abnahme-Experte ohne Kinder", prompt: [{ type: "text", text: "Hallo [[LONG]]" }], context: "fresh", provider: "spawn", agentOptions: { provider: "probe", model: "m" }, signal: new AbortController().signal });
      log("mitglied-exp2", { id: m2.member.id.slice(-6) });
      kinderIds.eigen = await legeKind("Abnahme eigenesLeadKind", "Eigenes Leadkind [[LONG]]", lead);

      // --- Angehaltenseit-Faelle (Nr. 9) in der echten Datei. ---
      const uebernahmenPfad = `${H}/.tm/teams-plus/state/uebernahmen.json`; mkdirSync(`${H}/.tm/teams-plus/state`, { recursive: true });
      writeFileSync(uebernahmenPfad, JSON.stringify([
        { id: exp1Id, name: "exp1", zielId: "g-test-a", seit: new Date(Date.now() - 60000).toISOString(), pauseOffen: false },
        { id: kinderIds.fachB, name: "Abnahme fachB ohne Ziel", zielId: "g-test-b", seit: new Date(Date.now() - 90000).toISOString(), pauseOffen: true }
      ], null, 1) + "\n"); log("uebernahmen-datei", { anzahl: 2 });

      // --- Alles abbauen lassen. Ziel von blocked laeuft bis Rundenlimit (1 Runde = "active" bleibt, phase wird "blocked" wenn das Limit erreicht ist und die Attrappe eine neue runde will). ---
      await warte(6000);
      for (const sid of [exp1Id, m2.member.id, kinderIds.fachA, kinderIds.fachB, kinderIds.blocked, kinderIds.enkel, kinderIds.eigen]) { if (typeof sid === "string") log("abbau-" + String(sid).slice(-6), { tot: await waetBisTot(sid, 12000) }); }

      // --- Sitzungsordner des eigenen Leadkindes zerstoeren -> nicht lesbar (Nr. 3). ---
      let kaputtId = kinderIds.eigen;
      try {
        const gefundene = [];
        for (const ordner of readdirSync(`${H}/sessions`)) for (const n of readdirSync(`${H}/sessions/${ordner}`)) if (n.startsWith(String(kinderIds.eigen))) gefundene.push(`${H}/sessions/${ordner}/${n}`);
        for (const p of gefundene) { rmSync(p, { recursive: true, force: true }); log("sitzung-zerstoert", { pfad: p }); }
        if (!gefundene.length) log("kaputtmachen-fehler", { grund: "Sitzungsordner nicht gefunden" });
      } catch (f) { log("kaputtmachen-fehler", { grund: kurz(f?.message ?? f) }); }

      // --- A: Zaehler-Fenster um Katalog und Baum. ---
      const vK = schnapp();
      let kinderVonExp1 = null, kinderVonLead = null, baumVonLead = null;
      try { kinderVonExp1 = (await ctx.subagents.listChildren(exp1Id)).map((e) => ({ id: String(e.id).slice(-6), createdAt: e.createdAt, mode: e.mode, label: e.label })); } catch (f) { kinderVonExp1 = { fehler: kurz(f?.message ?? f) }; }
      try { kinderVonLead = (await ctx.subagents.listChildren(leadId)).map((e) => ({ id: String(e.id).slice(-6), createdAt: e.createdAt, mode: e.mode, label: e.label })); } catch (f) { kinderVonLead = { fehler: kurz(f?.message ?? f) }; }
      try { baumVonLead = (await ctx.subagents.listDescendants(leadId)).map((e) => ({ id: String(e.id).slice(-6), kind: e.kind, depth: e.depth, parent: String(e.parentId ?? "").slice(-6), activity: e.activity, label: e.label })); } catch (f) { baumVonLead = { fehler: kurz(f?.message ?? f) }; }
      const nK = schnapp();

      // --- B: team_stand am Lead, ueber den echten Cordis-Weg. ---
      await warte(1200);
      const vS = schnapp();
      let standNeu = null;
      try {
        const ab = lead.session.seq;
        lead.followup((await import("/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm/lib/index.js")).createUserMessage({ content: [{ type: "text", text: "Rufe [[TOOL:team_stand:{}]]" }], source: { kind: "user" } }));
        await warte(4000);
        const ereignisse = lead.session.snapshotEvents(ab).filter((e) => e.type === "tool/result");
        standNeu = ereignisse.map((e) => { try { return JSON.parse(JSON.stringify(e.data?.message?.content ?? e.data)); } catch { return String(e.data); } });
        log("stand-ueber-sitzung", { ereignisse: ereignisse.length });
      } catch (f) { standNeu = ["FEHLER-im-Aufruf: " + kurz(f?.message ?? f)]; }
      const nS = schnapp();

      writeFileSync(AUSGABE, JSON.stringify({
        szenario: "abnahme-nachbau-2026-11-12-v3",
        kennungen: { lead: leadId.slice(-6), exp1: exp1Id.slice(-6), exp2: String(m2.member.id).slice(-6), fachA: String(kinderIds.fachA).slice(-6), fachB: String(kinderIds.fachB).slice(-6), blocked: String(kinderIds.blocked).slice(-6), enkel: String(kinderIds.enkel).slice(-6), eigen: String(kinderIds.eigen).slice(-6), kaputtId: String(kaputtId).slice(-6), zielId: zielId ? zielId.slice(-6) : null },
        kinderVonExp1, kinderVonLead, baumVonLead,
        standNeu,
        fensterKatalog: fensterDiff(vK, nK), fensterStand: fensterDiff(vS, nS),
        protokoll
      }, null, 1));
      process.exit(0);
    } catch (fehler) {
      writeFileSync(AUSGABE, JSON.stringify({ fatalFehlerStack: String(fehler?.stack ?? fehler), protokoll }, null, 1));
      process.exit(2);
    }
  })();
}
