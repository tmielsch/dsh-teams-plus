/**
 * Wegwerf-Treiber der Kern-Probe "Kind gehoert auch dem Menschen" (kein Teil des Plugins). Gestartet von probe-kern.sh.
 * Er ruft denselben Weg wie der Browser des Menschen: Gateway subagents/prompt (client.js 1722-1745 des Sitzungs-Controllers)
 * und session/list (aus dessen Antwort leitet der Browser die Sperre ab: agentAvailable des ELTERNTEILS = parentAvailable des Kindes).
 * Szenarien (PROBE_SZENARIO):
 *   a  Kind direkt unter dem Lead, Lead kalt: Mensch schreibt dem Kind (Abnahme a); danach Abschlussmeldung (c) und Zusammenfassung (e);
 *      zum Schluss wird der Elternteil GELADEN und sein Verlauf gelesen (kam die Abschlussmeldung dort an?)
 *   b  Enkel (Kind eines Kindes), Grosseltern und Mitte kalt: Mensch schreibt dem Enkel (Abnahme b)
 *   e  Zusammenfassung des Kindes im Ruhezustand und im laufenden Zustand (Feld agentAvailable des Kindes und des Elternteils)
 * Zahlen: Modellaufrufe je Sitzung aus llm-aufrufe.log (Attrappe fake-llm.mjs), Zuege je Sitzung aus agent/status running.
 */
import { writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";

export const name = "probe-treiber-kern";
export const inject = ["agents", "subagents", "goals", "sessions", "sessionQuery", "typertGateway", "typert", "sessionController"];

const B = process.env.PROBE_ORDNER ?? "/tmp/teams_plus_kern/probe";
const AUSGABE = process.env.PROBE_AUSGABE ?? `${B}/ergebnis.json`;
const LLM_LOG = process.env.PROBE_LLM_LOG ?? `${B}/llm-aufrufe.log`;
const HEIM = process.env.PROBE_HEIM;
const SZENARIO = process.env.PROBE_SZENARIO ?? "a";
const MODUS = process.env.PROBE_MODUS ?? "vorher";
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const kurz = (x, n = 300) => { try { return (typeof x === "string" ? x : JSON.stringify(x)).slice(0, n); } catch { return String(x).slice(0, n); } };
const modell = { provider: "probe", model: "m" };
const llmZeilen = () => { try { return readFileSync(LLM_LOG, "utf8").split("\n").filter(Boolean).map((z) => JSON.parse(z)); } catch { return []; } };

export function apply(ctx) {
	const t0 = Date.now();
	const protokoll = [];
	const log = (art, d = {}) => { protokoll.push({ ms: Date.now() - t0, art, ...d }); if (process.env.PROBE_STDERR) console.error("[probe]", art, JSON.stringify(d).slice(0, 200)); };
	const k8 = (id) => String(id).slice(-8);
	const zuege = new Map();
	const erzeugt = [];
	const verfuegbar = [];
	ctx.on("agent/status", ({ agent, status }) => { if (status === "running") zuege.set(String(agent.id), (zuege.get(String(agent.id)) ?? 0) + 1); });
	ctx.on("agent/created", ({ agent, source }) => { erzeugt.push({ ms: Date.now() - t0, id: k8(agent.id), source }); log("agent/created", { id: k8(agent.id), source }); });
	ctx.on("api-session/added", (s) => { verfuegbar.push({ ms: Date.now() - t0, id: k8(s.sessionId), agentAvailable: s.agentAvailable }); });
	const zaehlerLlm = (id) => llmZeilen().filter((z) => id === undefined || z.sitzung.endsWith(k8(id))).length;
	const zustand = (ids = {}) => ({
		llm: llmZeilen().length,
		llmJe: Object.fromEntries(Object.entries(ids).map(([n, id]) => [n, zaehlerLlm(id)])),
		zuegeJe: Object.fromEntries(Object.entries(ids).map(([n, id]) => [n, zuege.get(String(id)) ?? 0])),
		lebend: ctx.agents.list().map((a) => k8(a.id))
	});
	const anfrage = (e, k, t) => ({ requestId: randomUUID(), parentSessionId: e, childSessionId: k, mode: "continuable", delivery: "queue", content: [{ type: "text", text: t }] });
	const tor = (e, k, t) => ctx.typertGateway.invoke({ namespace: "subagents", method: "prompt", args: { request: anfrage(e, k, t) } });
	const sessionListe = async (ids) => { const r = await ctx.typertGateway.invoke({ namespace: "session", method: "list", args: { _request: {} } }); const z = Array.isArray(r) ? r : (r?.items ?? r?.value?.items ?? []); const gesucht = new Set(Object.values(ids).map(k8)); return z.map((i) => ({ id: k8(i.sessionId), agentAvailable: i.agentAvailable, running: i.running })).filter((i) => gesucht.has(i.id)); };
	const versuche = async (was, f, ids) => { const vor = zustand(ids); try { const r = await f(); log(was, { ok: true }); return { ok: true, r: kurz(r), vor, nach: zustand(ids) }; } catch (e) { log(was, { ok: false, code: e?.code }); return { ok: false, code: e?.code, fehler: kurz(e?.message ?? e, 600), vor, nach: zustand(ids) }; } };
	const kindStarten = async (elternAgent, text, etikett = "Probe-Kind") => { const id = randomUUID(); await ctx.subagents.startContinuable({ provider: "spawn", label: etikett, childId: id, request: { label: etikett, prompt: [{ type: "text", text }], parent: elternAgent }, signal: new AbortController().signal }); return id; };
	const dateiStand = (id) => { try { return readdirSync(`${HEIM}/sessions`, { recursive: true }).map(String).filter((p) => p.includes(id) && p.endsWith(".zstd")).map((p) => { const s = statSync(`${HEIM}/sessions/${p}`); return { datei: p.slice(-24), bytes: s.size, mtimeMs: Math.round(s.mtimeMs) }; }); } catch { return []; } };
	const ereignisse = (agent) => { try { return agent.session.snapshotEvents(0).map((e) => e.type + (e.data?.source?.kind ? `:${e.data.source.kind}` : "")); } catch (e) { return `fehler: ${kurz(e?.message ?? e, 100)}`; } };

	(async () => {
		const ergebnis = { szenario: SZENARIO, modus: MODUS };
		try {
			await warte(1200);
			const elternId = `eltern-${Date.now()}`;
			const handle = await ctx.agents.create({ sessionId: elternId, meta: { cwd: B }, agentOptions: modell });
			const ids = { eltern: elternId };
			if (SZENARIO === "a" || SZENARIO === "e") {
				const kindId = await kindStarten(handle.agent, "Start [[SLOW]]"); ids.kind = kindId;
				await warte(4000);
				ergebnis.vorAbbau = { listeKindRuhe: await sessionListe(ids), ...zustand(ids) };
				await handle.dispose(); await warte(500);
				ergebnis.nachAbbau = { elternLebt: ctx.agents.get(elternId) !== undefined, kindLebt: ctx.agents.get(kindId) !== undefined, ...zustand(ids) };
				ergebnis.listeKalt = await sessionListe(ids);
				ergebnis.dateienElternVor = dateiStand(elternId);
				ergebnis.dateienKindVor = dateiStand(kindId);
				const erzeugtVor = erzeugt.length;
				ergebnis.prompt = await versuche("mensch-an-kind", () => tor(elternId, kindId, "Mensch an Kind [[LONG]]"), ids);
				ergebnis.listeLaufend = await sessionListe(ids);
				ergebnis.lebendLaufend = zustand(ids);
				await warte(5500);
				ergebnis.listeNachAbschluss = await sessionListe(ids);
				ergebnis.nachAbschluss = { ...zustand(ids), elternLebt: ctx.agents.get(elternId) !== undefined, kindLebt: ctx.agents.get(kindId) !== undefined };
				ergebnis.neuErzeugt = erzeugt.slice(erzeugtVor);
				ergebnis.dateienElternNach = dateiStand(elternId);
				ergebnis.dateienKindNach = dateiStand(kindId);
				// (c): was kam beim Elternteil an? Elternteil JETZT laden (nur zum Lesen) und seinen Verlauf pruefen.
				const llmVor = zaehlerLlm(elternId);
				try {
					const h2 = await ctx.agents.resume({ resumeSessionId: elternId, agentOptions: modell });
					ergebnis.elternVerlaufNachLaden = ereignisse(h2.agent).slice(-14);
					ergebnis.elternHatSettlement = ereignisse(h2.agent).some((t) => t.includes("subagent-settled"));
					await warte(2500);
					ergebnis.llmElternNachLaden = zaehlerLlm(elternId) - llmVor;
					await h2.dispose();
				} catch (e) { ergebnis.elternLadenFehler = kurz(e?.message ?? e, 400); }
			}
			if (SZENARIO === "b") {
				const mitteId = await kindStarten(handle.agent, "Mitte [[LONG]]", "Mitte"); ids.mitte = mitteId;
				await warte(500);
				const mitte = ctx.agents.get(mitteId);
				if (!mitte) throw new Error("Mitte nicht lebendig");
				const enkelId = await kindStarten(mitte, "Enkel [[SLOW]]", "Enkel"); ids.enkel = enkelId;
				await warte(8000);
				await handle.dispose(); await warte(800);
				ergebnis.lebendVorTest = { gp: ctx.agents.get(elternId) !== undefined, mitte: ctx.agents.get(mitteId) !== undefined, enkel: ctx.agents.get(enkelId) !== undefined, ...zustand(ids) };
				ergebnis.listeKalt = await sessionListe(ids);
				const erzeugtVor = erzeugt.length;
				ergebnis.prompt = await versuche("mensch-an-enkel", () => tor(mitteId, enkelId, "Mensch an Enkel [[LONG]]"), ids);
				ergebnis.listeLaufend = await sessionListe(ids);
				await warte(5500);
				ergebnis.nachAbschluss = { ...zustand(ids), gpLebt: ctx.agents.get(elternId) !== undefined, mitteLebt: ctx.agents.get(mitteId) !== undefined, enkelLebt: ctx.agents.get(enkelId) !== undefined };
				ergebnis.listeNachAbschluss = await sessionListe(ids);
				ergebnis.neuErzeugt = erzeugt.slice(erzeugtVor);
			}
			ergebnis.ende = zustand(ids);
			ergebnis.llmLog = llmZeilen().map((z) => ({ ...z, zeit: z.zeit - t0, sitzung: z.sitzung.slice(-8) }));
		} catch (fehler) { ergebnis.fehler = String(fehler?.stack ?? fehler).slice(0, 1500); }
		ergebnis.verfuegbarEreignisse = verfuegbar;
		ergebnis.protokoll = protokoll;
		writeFileSync(AUSGABE, JSON.stringify(ergebnis, null, 1));
		process.exit(ergebnis.fehler ? 2 : 0);
	})();
}
