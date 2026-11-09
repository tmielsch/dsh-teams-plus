/**
 * Wegwerf-Treiber (Turn 5): Abnahme von team-modus.mjs + goal-await.mjs gemeinsam, mit ECHTEM Modell
 * (deepseek-official/deepseek-flash). Läuft nur in der Probe-Instanz (kein Port), Ausgabe in eine Datei.
 * Szenarien (PROBE_SZENARIO): u1 (warten ohne `von`), u2 (warten mit `von`), a (3 Gänge), de (give_task/ask_question/send_message), f (Bericht)
 * Der API-Schlüssel kommt nur aus der Umgebung des Prozesses; hier steht und wird nichts davon geschrieben.
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

export const name = "probe-abnahme-real";
export const inject = ["agents", "subagents", "agentTeams", "goals", "llm", "tools"];

const AUSGABE = process.env.PROBE_AUSGABE;
const SZ = process.env.PROBE_SZENARIO ?? "a";
const MODELL = { provider: "pcserve", model: "swift-1.5-iq2_xs" };
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const B = "/tmp/teams_plus_umbau/probe";

export function apply(ctx) {
	const t0 = Date.now();
	const protokoll = [];
	const log = (art, d = {}) => protokoll.push({ ms: Date.now() - t0, art, ...d });
	const extra = {};

	(async () => {
		try {
			await warte(1500);
			const llm = await import("@deepseek-ai/dsh-llm");
			const lead = (await ctx.agents.create({ sessionId: `lead-real-${Date.now()}`, meta: { cwd: B }, agentOptions: MODELL })).agent;
			let leadZuege = 0;
			const eingang = [];     // alles, was in Eingangskörbe von Lead und Kind fällt
			ctx.on("agent/inbox/inserted", ({ agent, message }) => {
				const text = JSON.stringify(message.content ?? "").slice(0, 110);
				eingang.push({ ms: Date.now() - t0, an: agent.id === lead.id ? "LEAD" : "kind", art: message.source?.kind, text });
			});
			ctx.on("agent/status", ({ agent, status }) => {
				if (agent.id === lead.id && status === "running") { leadZuege += 1; log("lead-zug", { n: leadZuege }); }
			});
			const kindStarts = [];
			ctx.on("agent/status", ({ agent, status }) => { if (agent.id !== lead.id && status === "running") kindStarts.push(Date.now() - t0); });
			ctx.on("goal/changed", ({ agent, change }) => log("ziel-aenderung", { wer: agent.id === lead.id ? "LEAD" : "kind", op: change?.operation, phase: change?.goal?.phase, akt: change?.goal?.activation }));

			const startText = (SZ === "de") ? "Antworte nur mit dem Wort: bereit." : "Antworte nur mit dem Wort: bereit.";
			const m = await ctx.agentTeams.spawnTeammate(lead, {
				name: "exp", description: "Probe-Experte", prompt: [{ type: "text", text: startText }],
				context: "fresh", provider: "spawn", agentOptions: MODELL, signal: new AbortController().signal
			});
			const kindId = m.member.id;
			const mensch = (text) => ctx.subagents.prompt({ requestId: randomUUID(), parentSessionId: lead.id, childSessionId: kindId, mode: "continuable", delivery: "queue", content: [{ type: "text", text }] }, new AbortController().signal);
			const zustand = () => {
				const k = ctx.agents.get(kindId);
				if (!k) return { lebt: false };
				const g = ctx.goals.get(k);
				return { lebt: true, status: k.status, phase: g?.phase ?? null, akt: g?.activation ?? null, runden: g?.roundsStarted ?? null };
			};
			const toolErgebnisse = (agent, ab) => {
				try { return agent.session.snapshotEvents(ab).filter((e) => /tool/.test(e.type)).map((e) => `${e.type}: ${JSON.stringify(e.data?.message?.content ?? e.data?.call ?? e.data).slice(0, 300)}`); } catch (x) { return [String(x)]; }
			};
			const frageLead = async (text, fristS = 45) => {
				const ab = lead.session.seq;
				lead.followup(llm.createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } }));
				await warte(1200);
				for (let i = 0; i < fristS * 2 && lead.status === "running"; i++) await warte(500);
				await warte(500);
				return toolErgebnisse(lead, ab);
			};

			if (SZ === "x") {
				await warte(5000);
				const k = ctx.agents.get(kindId);
				const q = await ctx.get("sessionQuery").observeSession(kindId, {});
				extra.ereignisse = (q.events ?? []).map((e) => ({ art: e.type, grund: e.data?.reason?.kind, fehler: String(e.data?.reason?.error?.message ?? e.data?.error?.message ?? "").replace(/sk-[A-Za-z0-9_-]+/g, "<G>").slice(0, 400), code: e.data?.reason?.error?.code })).filter((e) => !/time-context/.test(e.art));
				q[Symbol.dispose]?.();
				extra.lebt = Boolean(k);
			}
			if (SZ === "u1" || SZ === "u2") {
				const kind = ctx.agents.get(kindId);
				const von = SZ === "u2" ? " und von='lead'" : "";
				const z = ctx.goals.create(kind, {
					objective: `Test des Wartens. Rufe SOFORT das Werkzeug await_goal_dependency auf mit waiting_for='Nachricht des Menschen', max_wait_seconds=30${von}. Tu sonst nichts. Wenn danach eine Nachricht kommt, antworte in EINEM Satz und rufe das Werkzeug NICHT noch einmal auf.`,
					maxGoalRounds: 6
				});
				log("ziel-angelegt", { id: String(z.id), ...zustand() });
				// warten, bis das Kind wartet (entwaffnet) oder tot ist
				let wartetSeit;
				for (let i = 0; i < 160; i++) {
					await warte(250);
					const s = zustand();
					if (i % 4 === 0) log("verlauf", s);
					if (s.lebt && s.akt === "disarmed" && s.phase === "active" && s.status !== "running") { wartetSeit = Date.now() - t0; break; }
					if (!s.lebt && i > 8) { wartetSeit = Date.now() - t0; log("kind-tot-vor-warten"); break; }
				}
				log("wartet", { seit: wartetSeit, ...zustand() });
				await warte(4000);
				log("vor-mensch", zustand());
				const goalVor = eingang.filter((e) => e.art === "goal").length;
				const startsVor = kindStarts.length;
				const tMensch = Date.now() - t0;
				await mensch("Hallo, hier spricht der Mensch. Antworte nur mit dem Wort: gehört.");
				log("mensch-gesendet", zustand());
				// Beobachten bis 50 s nach Beginn des Wartens (Frist 30 s) — die Frist läuft währenddessen ab
				const ende = (wartetSeit ?? tMensch) + 50000;
				while (Date.now() - t0 < ende) { await warte(500); log("nach-mensch", zustand()); }
				extra.zielRundenNachMensch = eingang.filter((e) => e.art === "goal" && e.ms > tMensch).length;
				extra.zielRundenVorMensch = goalVor;
				extra.kindLaeufeNachMensch = kindStarts.filter((ms) => ms > tMensch).length;
				extra.lauefeNachMenschMs = kindStarts.filter((ms) => ms > tMensch);
				extra.tMensch = tMensch;
				extra.wartetSeit = wartetSeit;
				// Freigabe: das Kind muss leben, sonst weckt eine weitere Nachricht es
				if (!ctx.agents.get(kindId)) {
					await mensch("Noch eine Nachricht, schreibe eine ausführliche Antwort von mindestens 200 Wörtern über das Wetter.");
					for (let i = 0; i < 60 && !ctx.agents.get(kindId); i++) await warte(100);
				}
				const k2 = ctx.agents.get(kindId);
				if (k2) {
					const g = ctx.goals.get(k2);
					log("vor-freigabe", zustand());
					const ab = eingang.length;
					try { ctx.goals.resume(k2, { id: g.id, revision: g.revision }); log("freigegeben", zustand()); } catch (x) { log("resume-fehler", { f: String(x).slice(0, 200) }); }
					for (let i = 0; i < 16; i++) { await warte(500); log("nach-freigabe", zustand()); }
					extra.nachFreigabe = eingang.slice(ab);
				} else log("freigabe-unmoeglich");
			}

			if (SZ === "r") {
				// Wiederbewaffnung: das Kind arbeitet in einer Zielrunde, der Mensch schreibt, danach schaltet ein fremder Wecker (hier der Treiber, wie goal-await) scharf
				const kind = ctx.agents.get(kindId);
				const z = ctx.goals.create(kind, { objective: "Schreibe eine sehr ausführliche Geschichte von mindestens 600 Wörtern über einen Leuchtturm. Fange sofort an.", maxGoalRounds: 8 });
				for (let i = 0; i < 80 && ctx.agents.get(kindId)?.status !== "running"; i++) await warte(100);
				await warte(1500);
				log("vor-mensch", zustand());
				const tM = Date.now() - t0;
				await mensch("Der Mensch spricht: Antworte nur mit dem Wort: gehört.");
				await warte(300);
				log("nach-mensch", zustand());
				const k = ctx.agents.get(kindId);
				if (k) { const g = ctx.goals.get(k); try { ctx.goals.resume(k, { id: g.id, revision: g.revision }); log("fremder-wecker-resume", zustand()); } catch (x) { log("resume-fehler", { f: String(x).slice(0, 160) }); } }
				for (let i = 0; i < 100; i++) { await warte(500); const st = zustand(); if (i % 2 === 0) log("verlauf", st); }
				extra.zielRundenNachMensch = eingang.filter((e) => e.art === "goal" && e.ms > tM).length;
				extra.kindLaeufeNachMensch = kindStarts.filter((ms) => ms > tM).length;
			}
			if (SZ === "a") {
				await warte(9000);
				log("nach-start", { leadZuege, eingang: eingang.filter((e) => e.an === "LEAD").length });
				for (let i = 1; i <= 3; i++) {
					await mensch(`Gang ${i}: Antworte nur mit dem Wort: ok${i}.`);
					await warte(9000);
					log("mensch-gang", { i, leadZuege, eingangLead: eingang.filter((e) => e.an === "LEAD").length });
				}
			}

			if (SZ === "de") {
				await warte(8000);
				const brief = "Zweck: Test der Kanäle. Gegenstand: Antworte mit dem Wort fertig. Grenzen: keine Dateien anfassen. Abnahme: Du hast mit goal_report einen Bericht geschrieben und danach das Ziel mit update_goal (action complete) abgeschlossen. Meldepflicht: goal_report.";
				extra.d1_ohneBrief = await frageLead("Rufe jetzt das Werkzeug give_task auf mit empfaenger='exp' und maxrunden=3. Lass das Feld zielbrief WEG. Sag danach in einem Satz, was das Werkzeug geantwortet hat.");
				extra.zielNachD1 = zustand();
				extra.d2_mitBrief = await frageLead(`Rufe jetzt das Werkzeug give_task auf mit empfaenger='exp', maxrunden=4 und zielbrief='${brief}'. Sag danach in einem Satz, was das Werkzeug geantwortet hat.`);
				log("nach-give_task", zustand());
				for (let i = 0; i < 50; i++) { await warte(1000); const s = zustand(); if (i % 5 === 0) log("warte-auf-bericht", s); if (eingang.some((e) => e.an === "LEAD" && /Schlussbericht/.test(e.text))) break; }
				extra.berichtBeimLead = eingang.filter((e) => e.an === "LEAD" && /Schlussbericht|blockiert/.test(e.text));
				extra.e1_sendMessage = await frageLead("Rufe jetzt das Werkzeug send_message auf mit target='exp' und message='hallo'. Sag danach in einem Satz, was passiert ist.");
				const vorFrage = { leadZuege, eingangLead: eingang.filter((e) => e.an === "LEAD").length };
				extra.e2_askQuestion = await frageLead("Rufe jetzt das Werkzeug ask_question auf mit empfaenger='exp' und frage='Wie viele Zeilen hat Datei A?'. Sag danach in einem Satz, was das Werkzeug geantwortet hat.");
				await warte(8000);
				extra.nachFrage = { vorFrage, jetzt: { leadZuege, eingangLead: eingang.filter((e) => e.an === "LEAD").length } };
				extra.e3_askMensch = await frageLead("Rufe jetzt das Werkzeug ask_question auf mit empfaenger='mensch' und frage='Soll das Dach rund sein?'. Sag danach in einem Satz, was das Werkzeug geantwortet hat.");
			}

			if (SZ === "f") {
				const kind = ctx.agents.get(kindId);
				const z = ctx.goals.create(kind, {
					objective: "Test des Abschlusses. Schritt 1: Rufe get_goal auf. Schritt 2: Rufe update_goal mit action='complete' auf (mit der goal_id und revision aus get_goal), OHNE vorher einen Bericht geschrieben zu haben. Schritt 3: Wird das abgelehnt, rufe goal_report mit einem kurzen bericht ('Fertig: Test bestanden.') auf und danach update_goal mit action='complete' erneut.",
					maxGoalRounds: 6
				});
				log("ziel-angelegt", { id: String(z.id) });
				for (let i = 0; i < 60; i++) { await warte(1000); if (i % 5 === 0) log("verlauf", zustand()); if (eingang.some((e) => e.an === "LEAD" && /Schlussbericht/.test(e.text))) break; }
				await warte(3000);
				const kk = ctx.agents.get(kindId);
				extra.werkzeuge = kk ? toolErgebnisse(kk, 0) : "Kind abgebaut";
			}

			// Token- und Kostenzahlen aus den gespeicherten Projektionen
			const verbrauch = {};
			for (const [wer, id] of [["lead", lead.id], ["kind", kindId]]) {
				try {
					const obs = await ctx.get("sessionQuery").observeSession(id, {});
					verbrauch[wer] = obs.projections?.values?.tokenUsage ?? "keine Projektion tokenUsage";
					obs[Symbol.dispose]?.();
				} catch (x) { verbrauch[wer] = "Fehler " + String(x).slice(0, 120); }
			}
			const logDatei = (process.env.DSH_HOME ?? "") + "/.tm/teams-plus/logs/team-modus.log";
			const gaLog = (process.env.HOME ?? "") + "/.dsh/logs/goal-await.log";
			const letzte = (p, n) => existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).slice(-n) : [];
			writeFileSync(AUSGABE, JSON.stringify({ szenario: SZ, leadZuege, eingang, extra, verbrauch, protokoll, pluginLog: letzte(logDatei, 40), goalAwaitLog: letzte(gaLog, 30) }, null, 1));
			process.exit(0);
		} catch (fehler) {
			writeFileSync(AUSGABE, JSON.stringify({ fehler: String(fehler?.stack ?? fehler), protokoll, eingang: [] }, null, 1));
			process.exit(2);
		}
	})();
}
