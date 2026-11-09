/**
 * Wegwerf-Treiber für die Probe-Instanz (Messung M1 bis M3 des Konzepts Gesprächsmodus).
 * Kein Teil des Plugins, wird nicht eingebaut. Szenarien über PROBE_SZENARIO:
 *   grundlinie   Menschen-Nachrichten an den Experten, nichts abgefangen (Ist-Zustand)
 *   abfangen     M1: Agent.send am Lead umwickelt, Abschlussmeldungen verworfen
 *   fehler       Anbieterfehler im Kind: Welche Meldung kommt, was ist unterscheidbar?
 *   abbruch      Kind wird unterbrochen: Welche Meldung kommt?
 *   ziel         Ziel am Kind, Mensch schreibt: was passiert mit dem Ziel? (Hijack-Frage)
 *   briefkasten  M3: Lead verwirft Team-Nachrichten: wird erneut zugestellt?
 * Ergebnis: JSON nach PROBE_AUSGABE.
 */
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

export const name = "probe-driver";
export const inject = ["agents", "subagents", "agentTeams", "goals", "llm", "tools"];

const AUSGABE = process.env.PROBE_AUSGABE ?? "/tmp/teams_plus_umbau/probe/ergebnis.json";
const SZENARIO = process.env.PROBE_SZENARIO ?? "grundlinie";
const N = Number(process.env.PROBE_N ?? 3);
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const kurz = (c) => JSON.stringify(c).slice(0, 200);

export function apply(ctx) {
	const protokoll = [];
	const t0 = Date.now();
	const log = (art, daten = {}) => protokoll.push({ ms: Date.now() - t0, art, ...daten });

	(async () => {
		try {
			await warte(1200);
			const lead = (await ctx.agents.create({
				sessionId: `lead-probe-${Date.now()}`,
				meta: { cwd: "/tmp/teams_plus_umbau/probe" },
				agentOptions: { provider: "probe", model: "m" }
			})).agent;
			const leadEingang = [];     // alles, was am Lead ankommt (vor dem Eingangskorb, falls umwickelt)
			let leadZuege = 0;
			let verworfen = 0;
			const verwerfeArten = new Set(
				SZENARIO === "abfangen" ? ["subagent-settled"] :
				SZENARIO === "briefkasten" ? ["team-message"] : []
			);
			const grundSend = lead.send.bind(lead);
			lead.send = function (message, target, wakeup) {
				const art = message?.source?.kind;
				leadEingang.push({ ms: Date.now() - t0, art, ziel: target, wecken: wakeup, vorschau: kurz(message.content).slice(0, 120), quelle: kurz(message.source).slice(0, 160) });
				if (verwerfeArten.has(art)) { verworfen += 1; return; }
				return grundSend(message, target, wakeup);
			};
			ctx.on("agent/status", ({ agent, status }) => {
				if (agent.id === lead.id && status === "running") { leadZuege += 1; log("lead-zug", { n: leadZuege }); }
			});
			log("lead-angelegt", { sendUmwickelt: lead.send !== undefined });

			const startPrompt = SZENARIO === "fehler" ? "Start [[FAIL]]" : (SZENARIO === "ziel" || SZENARIO === "stopp" || SZENARIO === "zielsteer" || SZENARIO === "stopp2" || SZENARIO === "briefkasten" || SZENARIO === "fork" || SZENARIO === "sperre") ? "Start [[SLOW]]" : "Hallo, melde dich kurz. [[SLOW]]";
			const mitglied = await ctx.agentTeams.spawnTeammate(lead, {
				name: "exp", description: "Probe-Experte",
				prompt: [{ type: "text", text: startPrompt }],
				context: "fresh", provider: "spawn",
				agentOptions: { provider: "probe", model: "m" },
				signal: new AbortController().signal
			});
			const kindId = mitglied.member.id;
			log("teammate-angelegt", { kindId });
			await warte(SZENARIO === "fehler" ? 12000 : (SZENARIO === "ziel" || SZENARIO === "stopp" || SZENARIO === "zielsteer" || SZENARIO === "stopp2") ? 100 : 2500);
			const nachStart = { leadZuege, eingang: leadEingang.length, verworfen };
			log("nach-start", nachStart);

			const mensch = (text, delivery = "queue") => ctx.subagents.prompt({
				requestId: randomUUID(), parentSessionId: lead.id, childSessionId: kindId,
				mode: "continuable", delivery, content: [{ type: "text", text }]
			}, new AbortController().signal);

			const extra = {};
			if (SZENARIO === "grundlinie" || SZENARIO === "abfangen") {
				for (let i = 1; i <= N; i++) {
					const vorher = { leadZuege, eingang: leadEingang.length, verworfen };
					await mensch(`Menschen-Nachricht ${i} [[SLOW]]`);
					await warte(2500);
					log("mensch-gang", { i, vorher, nachher: { leadZuege, eingang: leadEingang.length, verworfen } });
				}
			}
			if (SZENARIO === "abbruch") {
				await mensch("Lange Arbeit [[SLOW]]");
				await warte(150);
				ctx.subagents.interrupt(kindId, { kind: "ancestor", agent: lead });
				log("unterbrochen");
				await warte(2500);
			}
			if (SZENARIO === "briefkasten") {
				const kind = ctx.agents.get(kindId);
				if (kind === undefined) throw new Error("Kind schon abgebaut");
				const gesendet = await ctx.agentTeams.sendMessage(kind, { target: "lead", content: [{ type: "text", text: "Zwischenbericht vom Experten" }], signal: new AbortController().signal });
				extra.gesendet = gesendet;
				log("team-nachricht-gesendet");
				await warte(9000);
				extra.zustandBriefkasten = "siehe leadEingang: Zahl der Zustellversuche";
			}
			if (SZENARIO === "ziel" || SZENARIO === "stopp" || SZENARIO === "zielsteer" || SZENARIO === "stopp2") {
				const kind = ctx.agents.get(kindId);
				const ereignisse = [];
				ctx.on("goal/changed", ({ agent, change }) => { if (agent.id === kindId) ereignisse.push({ ms: Date.now() - t0, art: "changed", op: change.operation, phase: change.goal?.phase, rev: change.goal?.revision }); });
				ctx.on("goal/activation-changed", (e) => { if (e.sessionId === kindId) ereignisse.push({ ms: Date.now() - t0, art: "activation", akt: e.goal?.activation }); });
				ctx.on("agent/status", ({ agent, status }) => { if (agent.id === kindId) ereignisse.push({ ms: Date.now() - t0, art: "kind-status", status }); });
				ctx.goals.create(kind, { objective: "Probe-Ziel: arbeite weiter [[SLOW]]", maxGoalRounds: 100 });
				log("ziel-angelegt");
				const zustand = () => { const a = ctx.agents.get(kindId); if (!a) return { lebt: false }; const g = ctx.goals.get(a); return { lebt: true, phase: g?.phase, akt: g?.activation, runden: g?.roundsStarted }; };
				await warte(1200);
				log("vor-eingriff", zustand());
				if (SZENARIO === "ziel") await mensch("Mensch lenkt (queue) [[SLOW]]", "queue");
				if (SZENARIO === "zielsteer") await mensch("Mensch lenkt (steer) [[SLOW]]", "steer");
				if (SZENARIO === "stopp") ctx.subagents.interrupt(kindId, { kind: "user", parentSessionId: lead.id });
				if (SZENARIO === "stopp2") {
					// warten, bis eine echte Zielrunde läuft (Runden >= 1 und Kind läuft), dann wie der Stopp-Knopf unterbrechen
					for (let i = 0; i < 60; i++) { const z = zustand(); const a = ctx.agents.get(kindId); if (z.lebt && z.runden >= 1 && a.status === "running") break; await warte(50); }
					log("stopp-jetzt", zustand());
					ctx.subagents.interrupt(kindId, { kind: "user", parentSessionId: lead.id });
					for (let i = 0; i < 6; i++) { await warte(400); log("nach-stopp", zustand()); }
					await mensch("Mensch redet mit dem Experten (nach Stopp) [[LONG]]", "queue");
					await warte(700); log("nach-mensch-lebt", zustand());
					const k2 = ctx.agents.get(kindId);
					if (k2) { const g = ctx.goals.get(k2); try { ctx.goals.resume(k2, { id: g.id, revision: g.revision }); log("fortgesetzt", zustand()); } catch (x) { log("resume-fehler", { f: String(x).slice(0, 160) }); } }
					for (let i = 0; i < 12; i++) { await warte(500); log("nach-resume", zustand()); }
				} else
				for (let i = 0; i < 8; i++) { await warte(500); log("verlauf", zustand()); }
				extra.ereignisse = ereignisse;
			}
			if (SZENARIO === "fork") {
				await warte(2500);
				const { buildForkSeed } = await import("@deepseek-ai/dsh-session/fork");
				const evs = lead.session.snapshotEvents(0);
				// letzter abgeschlossener Zug als Grenze
				let grenze;
				for (const e of evs) if (e.type === "turn/end") grenze = e.seq;
				const seed = buildForkSeed(evs, grenze);
				const forkId = "fork-probe-" + Date.now();
				const fork = (await ctx.agents.create({
					sessionId: forkId, seed, inheritedEventCount: grenze + 1,
					meta: { cwd: "/tmp/teams_plus_umbau/probe", parentSession: lead.id, isSeeded: true },
					agentOptions: { provider: "probe", model: "m" }
				})).agent;
				await warte(300);
				const roots = ctx.agents.roots().map((a) => a.id);
				extra.fork = {
					forkId, parentSession: fork.session.header.parentSession, istWurzel: roots.includes(forkId),
					mitgliedschaft: (() => { try { const m = ctx.agentTeams.tryMembership(fork); return m ? { rolle: m.role, name: m.name ?? null } : null; } catch (x) { return "fehler " + String(x).slice(0, 80); } })(),
					mitglieder: (() => { try { return ctx.agentTeams.listMembers(fork).map((m) => m.name + ":" + m.role + ":" + m.status); } catch (x) { return "fehler " + String(x).slice(0, 120); } })(),
					leadMitglieder: ctx.agentTeams.listMembers(lead).map((m) => m.name + ":" + m.role + ":" + m.status)
				};
				// Fork versucht, ein Teammitglied anzuschreiben und den Parent
				try { await ctx.agentTeams.sendMessage(fork, { target: "exp", content: [{ type: "text", text: "vom Fork" }], signal: new AbortController().signal }); extra.fork.anMitglied = "zugestellt"; } catch (x) { extra.fork.anMitglied = String(x.message).slice(0, 140); }
				try { await ctx.subagents.sendMessage(fork, lead.id, [{ type: "text", text: "Rückmeldung vom Fork" }], { signal: new AbortController().signal }); extra.fork.anParentSubagentsDienst = "zugestellt"; } catch (x) { extra.fork.anParentSubagentsDienst = String(x.message).slice(0, 140); }
				// Direkte Zustellung in den Parent mit eigener Quelle (wie send_to_session): geht das?
				try { const { createUserMessage } = await import("@deepseek-ai/dsh-llm"); lead.inject(createUserMessage({ content: [{ type: "text", text: "Rückmeldung vom Fork (inject)" }], source: { kind: "plugin:probe" } })); extra.fork.anParentInject = "ok"; } catch (x) { extra.fork.anParentInject = String(x.message).slice(0, 140); }
			}
			if (SZENARIO === "sperre") {
				// Wächter wie im Entwurf: im Team-Modus send_message ablehnen, update_goal(complete) nur mit Bericht
				let teamModus = true;
				const abgelehnt = [];
				ctx.tools.guard((exec) => {
					if (!teamModus) return undefined;
					if (exec.name === "send_message") { abgelehnt.push("send_message"); return "Team-Modus: send_message ist hier nicht erlaubt. Nutze give_task oder ask_question."; }
					if (exec.name === "update_goal") {
						const a = typeof exec.arguments === "string" ? JSON.parse(exec.arguments) : exec.arguments;
						if (a?.action === "complete" && !(typeof a.bericht === "string" && a.bericht.length > 0) && !exec.agent?.__bericht) { abgelehnt.push("update_goal:complete"); return "Ziel kann erst abgeschlossen werden, wenn ein Bericht geschrieben wurde."; }
					}
					return undefined;
				});
				extra.sperre = { versuche: [] };
				const ergebnisVonWerkzeug = (agent, ab) => {
					const evs = agent.session.snapshotEvents(ab);
					return evs.filter((e) => e.type === "tool/result").map((e) => JSON.stringify(e.data?.message?.content ?? e.data).slice(0, 260));
				};
				const g = ctx.goals.create(lead, { objective: "Sperre-Probe", maxGoalRounds: 5 });
				ctx.goals.disarm(lead);
				const ab1 = lead.session.seq;
				lead.followup((await import("@deepseek-ai/dsh-llm")).createUserMessage({ content: [{ type: "text", text: "Rufe an [[TOOL:update_goal:{\"goal_id\":\"" + g.id + "\",\"revision\":" + g.revision + ",\"action\":\"complete\"}]]" }], source: { kind: "user" } }));
				await warte(1500);
				extra.sperre.complete_ohne_bericht = ergebnisVonWerkzeug(lead, ab1);
				const ab2 = lead.session.seq;
				lead.followup((await import("@deepseek-ai/dsh-llm")).createUserMessage({ content: [{ type: "text", text: "Sende [[TOOL:send_message:{\"target\":\"exp\",\"message\":\"hallo\"}]]" }], source: { kind: "user" } }));
				await warte(1500);
				extra.sperre.send_message = ergebnisVonWerkzeug(lead, ab2);
				extra.sperre.abgelehnt = abgelehnt;
				extra.sperre.werkzeuge = ctx.tools.list ? "list vorhanden" : "keine list";
			}
			const kindAgent = ctx.agents.get(kindId) ?? lead;
			let kindEreignisse = [];
			try { kindEreignisse = kindAgent.session.snapshotEvents(0).map((e) => ({ art: e.type, seq: e.seq, grund: e.data?.reason?.kind, fehler: e.data?.reason?.error?.code ?? e.data?.reason?.error?.message })).filter((e) => !["time-context"].includes(e.art)); } catch (x) { kindEreignisse = [String(x)]; }
			if (SZENARIO === "stopp2") {
				try {
					const q = ctx.get("sessionQuery");
					const obs = await q.observeSession(kindId, {});
					const proj = obs.projections?.values ?? {};
					extra.uebersicht = { schluessel: Object.keys(proj), goal: proj.goal ?? null };
					obs[Symbol.dispose]?.();
				} catch (x) { extra.uebersicht = { fehler: String(x).slice(0, 300) }; }
			}
			const ergebnis = {
				kindEreignisse,
				szenario: SZENARIO, N, nachStart,
				ende: { leadZuege, eingang: leadEingang.length, verworfen },
				leadEingang, extra, protokoll
			};
			writeFileSync(AUSGABE, JSON.stringify(ergebnis, null, 1));
			process.exit(0);
		} catch (fehler) {
			writeFileSync(AUSGABE, JSON.stringify({ fehler: String(fehler?.stack ?? fehler), protokoll }, null, 1));
			process.exit(2);
		}
	})();
}
