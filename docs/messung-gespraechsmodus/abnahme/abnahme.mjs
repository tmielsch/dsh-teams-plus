/**
 * Wegwerf-Abnahmetreiber für das Modul patches/team-modus.mjs (Zweig umsetzung/team-modus) in der Probe-Instanz.
 * Das Modul wird über das Overlay abnahme.patch.yml aus dem Worktree geladen, NICHT aus dem Profil.
 * Szenarien (PROBE_SZENARIO):
 *   a  Team-Modus an, N Gänge des Menschen mit dem Experten        -> Lead-Züge, was kommt an
 *   b  Notschalter gedrückt (team-modus.json aus:true), dasselbe   -> Verhalten wie heute (Regression)
 *   c  Absturz im Kind (Anbieterfehler)                             -> Meldung "failed" kommt an
 *   f  Ziel mit Bericht: complete ohne Bericht abgelehnt, goal_report, complete -> Bericht genau einmal
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

export const name = "probe-abnahme";
export const inject = ["agents", "subagents", "agentTeams", "goals", "llm", "tools"];

const AUSGABE = process.env.PROBE_AUSGABE;
const SZENARIO = process.env.PROBE_SZENARIO ?? "a";
const N = Number(process.env.PROBE_N ?? 3);
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const kurz = (c) => JSON.stringify(c).slice(0, 160);
const B = "/tmp/teams_plus_umbau/probe";

export function apply(ctx) {
	const t0 = Date.now();
	const protokoll = [];
	const log = (art, d = {}) => protokoll.push({ ms: Date.now() - t0, art, ...d });

	(async () => {
		try {
			await warte(1500);
			const lead = (await ctx.agents.create({ sessionId: `lead-probe-${Date.now()}`, meta: { cwd: B }, agentOptions: { provider: "probe", model: "m" } })).agent;
			const angekommen = [];   // was nach dem Filter im Eingangskorb des Leads landet
			let leadZuege = 0;
			ctx.on("agent/inbox/inserted", ({ agent, message }) => {
				if (agent.id === lead.id) angekommen.push({ ms: Date.now() - t0, art: message.source?.kind, text: kurz(message.content).slice(0, 120) });
			});
			ctx.on("agent/status", ({ agent, status }) => { if (agent.id === lead.id && status === "running") { leadZuege += 1; log("lead-zug", { n: leadZuege }); } });

			const startPrompt = SZENARIO === "c" ? "Start [[FAIL]]" : SZENARIO === "f" ? "Start [[LONG]]" : "Hallo. [[SLOW]]";
			const m = await ctx.agentTeams.spawnTeammate(lead, {
				name: "exp", description: "Probe-Experte", prompt: [{ type: "text", text: startPrompt }],
				context: "fresh", provider: "spawn", agentOptions: { provider: "probe", model: "m" }, signal: new AbortController().signal
			});
			const kindId = m.member.id;
			const mensch = (text) => ctx.subagents.prompt({ requestId: randomUUID(), parentSessionId: lead.id, childSessionId: kindId, mode: "continuable", delivery: "queue", content: [{ type: "text", text }] }, new AbortController().signal);
			const extra = {};

			if (SZENARIO === "a" || SZENARIO === "b") {
				await warte(2500);
				log("nach-start", { leadZuege, angekommen: angekommen.length });
				for (let i = 1; i <= N; i++) { await mensch(`Menschen-Nachricht ${i} [[SLOW]]`); await warte(2500); log("mensch-gang", { i, leadZuege, angekommen: angekommen.length }); }
			}
			if (SZENARIO === "c") { await warte(6000); log("nach-fehler", { leadZuege, angekommen: angekommen.length }); }
			if (SZENARIO === "f") {
				const kind = ctx.agents.get(kindId);
				if (kind === undefined) throw new Error("Kind schon abgebaut");
				writeFileSync(B + "/plan.json", JSON.stringify({ name: "f" + Date.now(), steps: [
					{ tool: "update_goal", args: { goal_id: "$GOAL_ID", revision: "$REV", action: "complete" } },
					{ tool: "goal_report", args: { bericht: "Schlussbericht des Experten: Ergebnis erreicht, Beleg Datei A, offen nichts." } },
					{ tool: "update_goal", args: { goal_id: "$GOAL_ID", revision: "$REV", action: "complete" } }
				] }));
				const z = ctx.goals.create(kind, { objective: "Probe-Ziel mit Bericht [[PLAN]]", maxGoalRounds: 6 });
				writeFileSync(B + "/ziel-aktuell.json", JSON.stringify({ id: z.id, revision: z.revision }));
				log("ziel-angelegt", { id: String(z.id) });
				await warte(9000);
				const lebt = ctx.agents.get(kindId);
				const beob = await ctx.get("sessionQuery").observeSession(kindId, {});
				extra.zielEnde = beob.projections?.values?.goal?.goal ?? null;
				const evs = beob.events ?? [];
				extra.werkzeugErgebnisse = evs.filter((e) => e.type === "tool/result").map((e) => JSON.stringify(e.data?.message?.content ?? "").slice(0, 200));
				beob[Symbol.dispose]?.();
			}
			const logDatei = (process.env.DSH_HOME ?? "") + "/.tm/teams-plus/logs/team-modus.log";
			writeFileSync(AUSGABE, JSON.stringify({ szenario: SZENARIO, N, leadZuege, angekommen, extra, protokoll, pluginLog: existsSync(logDatei) ? readFileSync(logDatei, "utf8").split("\n").slice(-30) : [] }, null, 1));
			process.exit(0);
		} catch (fehler) {
			writeFileSync(AUSGABE, JSON.stringify({ fehler: String(fehler?.stack ?? fehler), protokoll }, null, 1));
			process.exit(2);
		}
	})();
}
