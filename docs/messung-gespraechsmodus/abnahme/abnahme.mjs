/**
 * Wegwerf-Abnahmetreiber für das Modul patches/team-modus.mjs (Zweig umsetzung/team-modus) in der Probe-Instanz.
 * Das Modul wird über das Overlay abnahme.patch.yml aus dem Worktree geladen, NICHT aus dem Profil.
 * Szenarien (PROBE_SZENARIO):
 *   a  Team-Modus an, N Gänge des Menschen mit dem Experten        -> Lead-Züge, was kommt an
 *   b  Notschalter gedrückt (team-modus.json aus:true), dasselbe   -> Verhalten wie heute (Regression)
 *   c  Absturz im Kind (Anbieterfehler)                             -> Meldung "failed" kommt an
 *   u  Gesprächsübernahme: Ziel läuft (Runden à 3 s), der Mensch schreibt MITTEN IN EINER RUNDE; dann Freigabe  (F3)
 *   d  give_task ohne Zielbrief scheitert verständlich, mit Zielbrief legt es das Ziel an                      (F5, Abnahme d)
 *   e  send_message im Team-Modus abgelehnt, ask_question still zugestellt, Fork antwortet seinem Parent frei   (F5, Abnahme e)
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

			const startPrompt = SZENARIO === "c" ? "Start [[FAIL]]" : (SZENARIO === "f" || SZENARIO === "u") ? "Start [[LONG]]" : "Hallo. [[SLOW]]";
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
			const llm = await import("@deepseek-ai/dsh-llm");
			const lies = (agent, ab) => agent.session.snapshotEvents(ab).filter((e) => e.type === "tool/result").map((e) => JSON.stringify(e.data?.message?.content ?? e.data).slice(0, 420));
			const rufe = async (agent, name, args) => { const ab = agent.session.seq; agent.followup(llm.createUserMessage({ content: [{ type: "text", text: `Rufe [[TOOL:${name}:${JSON.stringify(args)}]]` }], source: { kind: "user" } })); await warte(1800); return lies(agent, ab); };
			const zustand = (kind) => { const g = kind ? ctx.goals.get(kind) : undefined; return { status: kind?.status ?? "TOT", phase: g?.phase ?? null, aktivierung: g?.activation ?? null, runden: g?.roundsStarted ?? null }; };
			let rundenstarts = 0;
			ctx.on("agent/status", ({ agent, status }) => { if (agent.id === kindId && status === "running") { rundenstarts += 1; log("kind-lauf", { n: rundenstarts }); } });

			if (SZENARIO === "u") {
				const kind = ctx.agents.get(kindId);
				const z = ctx.goals.create(kind, { objective: "Probe-Ziel: lange Runden [[LONG]]", maxGoalRounds: 30 });
				log("ziel-angelegt", { id: String(z.id), ...zustand(kind) });
				// warten, bis eine Runde LÄUFT, dann mitten hinein schreiben
				for (let i = 0; i < 40 && ctx.agents.get(kindId)?.status !== "running"; i++) await warte(100);
				await warte(800);
				const vorMensch = { ...zustand(ctx.agents.get(kindId)), rundenstarts };
				log("vor-mensch", vorMensch);
				await mensch("Mensch redet mit dem Experten, mitten in der Runde [[SLOW]]");
				const t1 = Date.now();
				for (let i = 0; i < 20; i++) { await warte(500); log("verlauf", { ...zustand(ctx.agents.get(kindId)), rundenstarts, leadZuege, angekommen: angekommen.length }); }
				extra.vorMensch = vorMensch;
				extra.rundenstartsNachMensch = rundenstarts - vorMensch.rundenstarts;
				// zweite Nachricht des Menschen: darf nichts melden
				await mensch("Zweite Nachricht des Menschen [[LONG]]");
				await warte(600);
				extra.angekommenVorFreigabe = angekommen.length;
				// Freigabe durch den Menschen
				const k = ctx.agents.get(kindId);
				if (k) { const g = ctx.goals.get(k); try { ctx.goals.resume(k, { id: g.id, revision: g.revision }); log("freigegeben", zustand(k)); } catch (x) { log("resume-fehler", { f: String(x).slice(0, 200) }); } }
				else log("freigabe-unmoeglich", { grund: "Kind abgebaut" });
				for (let i = 0; i < 10; i++) { await warte(500); log("nach-freigabe", { ...zustand(ctx.agents.get(kindId)), rundenstarts, leadZuege, angekommen: angekommen.length }); }
			}
			if (SZENARIO === "d") {
				await warte(2500);
				const lang = "Zweck: Teil des Probe-Ziels. Gegenstand: Datei A mit 5 Zeilen. Grenzen: nur Datei A. Abnahme: Zählung ergibt 5. Meldung: goal_report am Ende.";
				extra.ohneBrief = await rufe(lead, "give_task", { empfaenger: "exp", maxrunden: 3 });
				extra.zuKurz = await rufe(lead, "give_task", { empfaenger: "exp", zielbrief: "mach mal", maxrunden: 3 });
				extra.zielNachFehlern = zustand(ctx.agents.get(kindId));
				extra.mitBrief = await rufe(lead, "give_task", { empfaenger: "exp", zielbrief: lang, maxrunden: 3 });
				await warte(2500);
				extra.zielNachAuftrag = zustand(ctx.agents.get(kindId));
				extra.zweiterAuftrag = await rufe(lead, "give_task", { empfaenger: "exp", zielbrief: lang, maxrunden: 3 });
			}
			if (SZENARIO === "e") {
				await warte(2500);
				extra.sendMessage = await rufe(lead, "send_message", { target: "exp", message: "hallo" });
				const vorher = { leadZuege, angekommen: angekommen.length };
				extra.frageAnExp = await rufe(lead, "ask_question", { empfaenger: "exp", frage: "Wie viele Zeilen hat Datei A?" });
				await warte(1500);
				extra.nachFrage = { vorher, nachher: { leadZuege, angekommen: angekommen.length }, kindLauf: rundenstarts };
				extra.frageAnMensch = await rufe(lead, "ask_question", { empfaenger: "mensch", frage: "Soll das Dach rund sein?" });
				// Fork des Leads: eigene Wurzel, darf seinem Parent antworten
				const { buildForkSeed } = await import("@deepseek-ai/dsh-session/fork");
				const evs = lead.session.snapshotEvents(0);
				let grenze; for (const e of evs) if (e.type === "turn/end") grenze = e.seq;
				const fork = (await ctx.agents.create({ sessionId: "fork-probe-" + Date.now(), seed: buildForkSeed(evs, grenze), inheritedEventCount: grenze + 1, meta: { cwd: B, parentSession: lead.id, isSeeded: true }, agentOptions: { provider: "probe", model: "m" } })).agent;
				await warte(300);
				const vor = angekommen.length;
				try { lead.inject(llm.createUserMessage({ content: [{ type: "text", text: "Rückmeldung vom Fork (inject)" }], source: { kind: "plugin:probe" } })); extra.forkInject = "ok"; } catch (x) { extra.forkInject = String(x.message).slice(0, 140); }
				extra.forkSendMessage = await rufe(fork, "send_message", { target: "lead", message: "vom Fork" });
				extra.forkAngekommen = angekommen.length - vor;
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
