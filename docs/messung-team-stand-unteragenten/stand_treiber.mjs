/**
 * Wegwerf-Messetreiber für den Plan "team_stand für Unteragenten" (2026-11-10).
 * Kein Teil des Plugins, nichts hier wird eingebaut. Läuft in der Probe-Instanz
 * unter DSH_HOME=/tmp/teams_plus_umbau/probe_home, Profil "probe", Overlay stand.patch.yml.
 *
 * Messfragen:
 *  (a) Welche Unteragenten findet ein Leser zu einem Aufrufer — Direktkinder, Enkel, Abgebaute?
 *      Mittel: ctx.subagents.listChildren / listDescendants, beide ohne Agent zu laden.
 *  (b) Welche Felder liefert die Zeile je Kind? Katalog (label, mode, createdAt),
 *      Lebendigkeit (ctx.agents.get → status), Ziel lebend (ctx.goals.get),
 *      Ziel abgebaut (sessionQuery.observeSession → projections.values.goal).
 *  (d) Beweisen, dass das Lesen niemanden weckt: Zähler für neu materialisierte Agenten
 *      und für laufende Züge (agent/status → running) vor/nach jedem Lesefenster.
 */
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

export const name = "probe-stand";
export const inject = ["agents", "subagents", "goals", "llm", "agentTeams"];

const B = "/tmp/teams_plus_umbau/probe";
const AUSGABE = process.env.PROBE_AUSGABE ?? `${B}/ergebnis_stand.json`;
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const kurz = (c) => { try { return JSON.stringify(c).slice(0, 600); } catch { return String(c).slice(0, 600); } };

export function apply(ctx) {
  const t0 = Date.now();
  const protokoll = [];
  const log = (art, d = {}) => protokoll.push({ ms: Date.now() - t0, art, ...d });
  const extra = {};

  let leadId = "";
  let neu = 0;
  let zuege = 0;
  ctx.on("agent/created", ({ agent }) => {
    if (String(agent?.id) !== leadId) neu += 1;
    log("agent-created", { id: String(agent?.id).slice(-6) });
  });
  ctx.on("agent/status", ({ agent, status }) => {
    if (status === "running") zuege += 1;
  });

  const snapshot = () => ({
    lebt: ctx.agents.list().map((a) => String(a.id).slice(-6)),
    neu,
    zuege
  });
  const diff = (vorher, nachher) => ({
    neueAgenten: nachher.neu - vorher.neu,
    neueZuege: nachher.zuege - vorher.zuege,
    lebtNeu: nachher.lebt.filter((i) => !vorher.lebt.includes(i)),
    lebtWeg: vorher.lebt.filter((i) => !nachher.lebt.includes(i))
  });

  (async () => {
    try {
      await warte(1500);
      const provider = (() => { try { return ctx.subagents.list(); } catch (e) { return ["FEHLER: " + String(e).slice(0, 80)]; } })();
      log("provider", { provider });

      leadId = `lead-stand-${Date.now()}`;
      const lead = (await ctx.agents.create({
        sessionId: leadId,
        meta: { cwd: B },
        agentOptions: { provider: "probe", model: "m" }
      })).agent;

      // 1) vier Kinder über dieselbe Kern-Route wie delegate_task (continuable, spawn-Provider)
      const kinder = [];
      for (const [name, prompt] of [
        ["mitZiel", "Worker mit Ziel [[LONG]]"],
        ["ohneZiel", "Worker ohne Ziel [[SLOW]]"],
        ["zweitesKind", "Zweites Kind [[SLOW]]"],
        ["abgebaut", "Wird angehalten [[LONG]]"]
      ]) {
        const id = randomUUID();
        try {
          const start = await ctx.subagents.startContinuable({
            provider: "spawn",
            label: `Plan-Messung ${name}`,
            childId: id,
            request: { label: `Plan-Messung ${name}`, prompt: [{ type: "text", text: prompt }], parent: lead },
            signal: new AbortController().signal
          });
          kinder.push({ name, id });
          log("kind-angelegt", { name, id: id.slice(-6), messageId: String(start.messageId ?? "").slice(-6) });
        } catch (fehler) {
          kinder.push({ name, id, fehler: String(fehler?.message ?? fehler).slice(0, 200) });
          log("kind-fehler", { name, grund: String(fehler?.message ?? fehler).slice(0, 250) });
        }
      }

      await warte(3500);

      // 2) einem Kind ein Ziel geben (genau das, was give_task für Teammitglieder tut)
      const kindMitZiel = ctx.agents.get(kinder[0]?.id);
      if (kindMitZiel) {
        const z = ctx.goals.create(kindMitZiel, { objective: "Probe-Ziel Unteragent: Runden laufen [[LONG]]", maxGoalRounds: 30 });
        log("ziel-fuer-unteragent", { id: String(z.id), phase: z.phase, runden: z.roundsStarted });
      }

      await warte(4000);

      // 3) Enkel: Kind 1 (mit Ziel) als Elternteil für ein viertes Kind? Wir nehmen kind[2] als Eltern.
      const eltnEnkel = ctx.agents.get(kinder[2]?.id) ?? undefined;
      const enkelId = randomUUID();
      let enkelMglich = null;
      if (eltnEnkel !== undefined) {
        try {
          await ctx.subagents.startContinuable({
            provider: "spawn",
            label: "Plan-Messung Enkel",
            childId: enkelId,
            request: { label: "Plan-Messung Enkel", prompt: [{ type: "text", text: "Enkel [[SLOW]]" }], parent: eltnEnkel },
            signal: new AbortController().signal
          });
          enkelMglich = true;
          log("enkel-angelegt", { id: enkelId.slice(-6) });
        } catch (fehler) {
          enkelMglich = String(fehler?.message ?? fehler).slice(0, 250);
          log("enkel-fehler", { grund: enkelMglich });
        }
      } else {
        log("enkel-uebersprungen", { grund: "Elternkind nicht lebendig" });
      }

      await warte(3000);

      // 4) Anhalten eines laufenden Ziels, damit der abgebaute Fall entsteht (Muster wie bei M5b)
      const kindAbgebaut = ctx.agents.get(kinder[3]?.id);
      if (kindAbgebaut) {
        try { ctx.subagents.interrupt(kindAbgebaut.id, { agent: lead }); log("kind-anhalten", { id: String(kindAbgebaut.id).slice(-6) }); }
        catch (fehler) { log("kind-anhalten-fehler", { grund: String(fehler?.message ?? fehler).slice(0, 250) }); }
      }

      await warte(6000);

      // ---- MESSPHASE A: Direktkinder und Baum finden ----
      const vorA = snapshot();
      let direkt = null;
      try { direkt = (await ctx.subagents.listChildren(lead.id)).map((e) => ({ id: e.id.slice(-6), mode: e.mode, label: e.label, createdAt: e.createdAt })); }
      catch (fehler) { direkt = { fehler: String(fehler?.message ?? fehler).slice(0, 250) }; }
      const nachA = snapshot();

      const vorB = snapshot();
      let baum = null;
      try { baum = (await ctx.subagents.listDescendants(lead.id)).map((e) => ({ id: e.id.slice(-6), kind: e.kind, depth: e.depth, parentId: String(e.parentId ?? "").slice(-6), mode: e.mode, activity: e.activity, label: e.label, hasChildren: e.hasChildren })); }
      catch (fehler) { baum = { fehler: String(fehler?.message ?? fehler).slice(0, 250) }; }
      const nachB = snapshot();

      // ---- MESSPHASE B: Ziel-Projection je Kind, lebend und abgebaut ----
      const alleIds = [...kinder.map((k) => k.id), ...(enkelMglich === true ? [enkelId] : [])];
      const zeilen = [];
      for (const id of alleIds) {
        const vor = snapshot();
        const t0x = Date.now();
        let agent = ctx.agents.get(id);
        const lebtVor = agent !== undefined;
        const lebendZiel = agent ? (() => { try { return ctx.goals.get(agent); } catch { return null; } })() : null;
        let beob = null; let lesedauerMs = null; let febler = null;
        try {
          const abfrage = ctx.get("sessionQuery");
          const t0y = Date.now();
          beob = await abfrage.observeSession(id, {});
          lesedauerMs = Date.now() - t0y;
        } catch (fehler) { febler = String(fehler?.message ?? fehler).slice(0, 250); }
        const projektion = beob?.projections?.values?.goal ?? null;
        let projektionen = null;
        try { projektionen = Object.keys(beob?.projections?.values ?? {}); } catch { }
        agent = ctx.agents.get(id);
        const nach = snapshot();
        zeilen.push({
          id: String(id).slice(-6),
          lebtVorher: lebtVor,
          lebtNachher: agent !== undefined,
          status: agent?.status ?? "TOT",
          zielLebend: lebendZiel == null ? null : { phase: lebendZiel.phase, aktivierung: lebendZiel.activation, runden: lebendZiel.roundsStarted, max: lebendZiel.maxGoalRounds },
          projektionGoal: projektion?.goal == null ? (projektion == null ? "keine Projektion" : "Projection ohne goal") : { phase: projektion.goal.phase, runden: projektion.roundsStarted, wortlaut: String(projektion.goal.objective ?? "").slice(0, 60) },
          weitereProjektionen: projektionen,
          letzteEreignisZeit: beob?.events?.at?.(-1)?.time ?? null,
          lesedauerMs, febler,
          fenster: diff(vor, nach)
        });
      }

      // ---- IST-Zustand team_stand (ohne Erweiterung), am Lead angerufen ----
      const vorC = snapshot();
      let standIst = null;
      try {
        const llm = await import("@deepseek-ai/dsh-llm");
        const ab = lead.session.seq;
        lead.followup(llm.createUserMessage({ content: [{ type: "text", text: "Rufe [[TOOL:team_stand:{}]]" }], source: { kind: "user" } }));
        await warte(2500);
        standIst = lead.session.snapshotEvents(ab)
          .filter((e) => e.type === "tool/result")
          .map((e) => kurz(e.data?.message?.content ?? e.data).slice(0, 400));
      } catch (fehler) { standIst = ["FEHLER: " + String(fehler?.message ?? fehler).slice(0, 250)]; }
      const nachC = snapshot();

      extra.standIstOhneErweiterung = standIst;
      extra.zuegeLeadVorher = nachC.zuege;
      extra.direktKinder = direkt;
      extra.direktFenster = diff(vorA, nachA);
      extra.baum = baum;
      extra.baumFenster = diff(vorB, nachB);
      extra.zeilen = zeilen;
      extra.teamKinderFenster = { neuAgentenImMessfenster: diff(vorC, nachC) };
      writeFileSync(AUSGABE, JSON.stringify({ szenario: "stand", provider, kinder, extra, protokoll }, null, 1));
      process.exit(0);
    } catch (fehler) {
      writeFileSync(AUSGABE, JSON.stringify({ fehler: String(fehler?.stack ?? fehler), protokoll }, null, 1));
      process.exit(2);
    }
  })();
}
