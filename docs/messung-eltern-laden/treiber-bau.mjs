/**
 * Wegwerf-Treiber der Bau-Probe "Eltern-Sitzung laden" (kein Teil des Plugins). Ersetzt treiber.mjs aus der Planmessung:
 * es gibt KEINEN Haken im Treiber mehr, geprueft wird der gebaute Patch patches/eltern-laden.mjs (Plan Abschnitt 7).
 * Szenarien ueber PROBE_SZENARIO, Modus ueber PROBE_MODUS (mit = Patch geladen, ohne = Gegenprobe), Ergebnis nach PROBE_AUSGABE.
 *   tor        Abnahme 1: Kind ueber das Gateway (subagents/prompt) anschreiben, Eltern kalt; Modellaufrufe vor/nach
 *   oeffnen    Abnahme 4: session.page auf die Kind-Adresse; Rueckkehrzeit, Eltern lebt binnen 1 s, Ereignis agentAvailable
 *   laden      Abnahme 2: nur Laden (page), keine Anschrift: Modellaufrufe je Sitzung vor/nach, Zuege, Ziel
 *   parallel   Abnahme 5: zwei Kinder gleichzeitig ueber das Gateway
 *   oeffnen2   Abnahme 6: follow mit defekter und fehlender Elterndatei
 *   notschalter Abnahme 8: eltern-laden.json {"aus":true} -> parent-unavailable; Datei weg -> geht wieder
 *   kette      Abnahme 9: Grosseltern -> Mitte (selbst Kind) -> Enkel; Mitte kalt
 *   neustart-a / neustart-b  Abnahme 2+3: wie in der Planmessung (a legt an und beendet hart, b startet neu auf denselben Dateien, PROBE_BEHALTE=1)
 */
import { writeFileSync, readFileSync, readdirSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

export const name = "probe-treiber-bau";
export const inject = ["agents", "subagents", "goals", "sessions", "sessionQuery", "typertGateway", "typert", "sessionController"];

const B = process.env.PROBE_ORDNER ?? "/tmp/teams_plus_umbau/probe_eltern_bau";
const AUSGABE = process.env.PROBE_AUSGABE ?? `${B}/ergebnis.json`;
const LLM_LOG = process.env.PROBE_LLM_LOG ?? `${B}/llm-aufrufe.log`;
const HEIM = process.env.PROBE_HEIM;
const SZENARIO = process.env.PROBE_SZENARIO ?? "tor";
const MODUS = process.env.PROBE_MODUS ?? "mit";
const PATCH_LOG = `${HEIM}/.tm/teams-plus/logs/eltern-laden.log`;
const SCHALTER = `${HEIM}/.tm/teams-plus/eltern-laden.json`;
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const kurz = (x, n = 300) => { try { return (typeof x === "string" ? x : JSON.stringify(x)).slice(0, n); } catch { return String(x).slice(0, n); } };
const modell = { provider: "probe", model: "m" };
const llmZeilen = () => { try { return readFileSync(LLM_LOG, "utf8").split("\n").filter(Boolean).map((z) => JSON.parse(z)); } catch { return []; } };
const patchLog = () => { try { return readFileSync(PATCH_LOG, "utf8").split("\n").filter(Boolean).map((z) => z.replace(/^\S+ /, "")); } catch { return []; } };

export function apply(ctx) {
	const t0 = Date.now();
	const protokoll = [];
	const log = (art, d = {}) => { protokoll.push({ ms: Date.now() - t0, art, ...d }); if (process.env.PROBE_STDERR) console.error("[probe]", art, JSON.stringify(d).slice(0, 160)); };
	const k8 = (id) => String(id).slice(-8);
	const zuege = new Map();
	const erzeugt = [];
	const verfuegbar = [];
	ctx.on("agent/status", ({ agent, status }) => { if (status === "running") zuege.set(String(agent.id), (zuege.get(String(agent.id)) ?? 0) + 1); });
	ctx.on("agent/created", ({ agent, source }) => { erzeugt.push(k8(agent.id)); log("agent/created", { id: k8(agent.id), source }); });
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
	const sessionListe = async () => { const r = await ctx.typertGateway.invoke({ namespace: "session", method: "list", args: { _request: {} } }); const z = Array.isArray(r) ? r : (r?.items ?? r?.value?.items ?? []); return z.map((i) => ({ id: k8(i.sessionId), agentAvailable: i.agentAvailable })); };
	const versuche = async (was, f, ids) => { const vor = zustand(ids); try { const r = await f(); log(was, { ok: true }); return { ok: true, r: kurz(r), vor, nach: zustand(ids) }; } catch (e) { log(was, { ok: false, code: e?.code }); return { ok: false, code: e?.code, fehler: kurz(e?.message ?? e, 600), vor, nach: zustand(ids) }; } };
	const kindStarten = async (elternAgent, text, etikett = "Probe-Kind") => { const id = randomUUID(); await ctx.subagents.startContinuable({ provider: "spawn", label: etikett, childId: id, request: { label: etikett, prompt: [{ type: "text", text }], parent: elternAgent }, signal: new AbortController().signal }); return id; };
	const adresse = (e, k) => ({ kind: "subagent", parentSessionId: e, childSessionId: k, mode: "continuable" });
	const seite = (e, k) => ctx.typertGateway.invoke({ namespace: "session", method: "page", args: { request: { address: adresse(e, k), throughSeq: -1 } } });
	const ersterRahmen = async (adr) => { const ab = new AbortController(); const g = ctx.sessionController.follow({ address: adr, assistantStream: true }, ab.signal); const r = await g.next(); ab.abort(); try { await g.return?.(); } catch {} return r?.value?.type ?? "kein-rahmen"; };

	(async () => {
		const ergebnis = { szenario: SZENARIO, modus: MODUS };
		try {
			await warte(1200);
			const elternId = `eltern-${Date.now()}`;
			const neuB = SZENARIO === "neustart-b";
			const handle = neuB ? undefined : await ctx.agents.create({ sessionId: elternId, meta: { cwd: B }, agentOptions: modell });
			const eltern = handle?.agent;
			const ids = { eltern: elternId };
			const kaltMitKind = async (zweites = false) => {
				const kindId = await kindStarten(eltern, "Start [[SLOW]]"); ids.kind = kindId;
				const kind2 = zweites ? await kindStarten(eltern, "Start2 [[SLOW]]", "Probe-Kind-2") : undefined;
				if (kind2) ids.kind2 = kind2;
				await warte(4000);
				await handle.dispose(); await warte(500);
				ergebnis.nachAbbau = { elternLebt: ctx.agents.get(elternId) !== undefined, kindLebt: ctx.agents.get(kindId) !== undefined };
				return { kindId, kind2 };
			};

			if (SZENARIO === "tor") {
				const { kindId } = await kaltMitKind();
				ergebnis.listeKalt = await versuche("session-list-kalt", sessionListe, ids);
				ergebnis.torKalt = await versuche("tor-prompt-kalt", () => tor(elternId, kindId, "Tor [[SLOW]]"), ids);
				await warte(2500);
				ergebnis.elternLebtDanach = ctx.agents.get(elternId) !== undefined;
				ergebnis.listeDanach = await versuche("session-list-danach", sessionListe, ids);
			}
			if (SZENARIO === "oeffnen") {
				const { kindId } = await kaltMitKind();
				const vor = verfuegbar.length;
				const t1 = Date.now();
				ergebnis.seite = await versuche("page", async () => { const r = await seite(elternId, kindId); return { records: (r?.records ?? r?.value?.records ?? []).length, dauerMs: Date.now() - t1 }; }, ids);
				ergebnis.sofortNachPage = { elternLebt: ctx.agents.get(elternId) !== undefined };
				await warte(1000);
				ergebnis.nachEinerSekunde = { elternLebt: ctx.agents.get(elternId) !== undefined, ereignisse: verfuegbar.slice(vor) };
				ergebnis.listeDanach = await versuche("session-list-danach", sessionListe, ids);
				ergebnis.llmNachOeffnen = zustand(ids);
			}
			if (SZENARIO === "laden") {
				const { kindId } = await kaltMitKind();
				const vor = zustand(ids);
				await seite(elternId, kindId);
				for (let i = 0; i < 5; i++) { await warte(1000); log("nach-laden", { lebt: ctx.agents.get(elternId) !== undefined, llm: zaehlerLlm() - vor.llm, llmEltern: zaehlerLlm(elternId) - vor.llmJe.eltern, llmKind: zaehlerLlm(kindId) - vor.llmJe.kind }); }
				ergebnis.vorLaden = vor; ergebnis.nachLaden = zustand(ids);
			}
			if (SZENARIO === "parallel") {
				const { kindId, kind2 } = await kaltMitKind(true);
				const r = await Promise.allSettled([tor(elternId, kindId, "Parallel A [[SLOW]]"), tor(elternId, kind2, "Parallel B [[SLOW]]")]);
				ergebnis.parallel = r.map((x) => x.status === "fulfilled" ? "ok" : kurz(x.reason?.message, 160));
				ergebnis.erzeugtLeadAgenten = erzeugt.filter((x) => x === k8(elternId)).length;
				await warte(3000);
			}
			if (SZENARIO === "oeffnen2") {
				const { kindId } = await kaltMitKind();
				ergebnis.followIntakt = await versuche("follow", () => ersterRahmen(adresse(elternId, kindId)), ids);
				await warte(600); ergebnis.elternLebtNachFollow = ctx.agents.get(elternId) !== undefined;
				const eltern2 = `eltern-defekt-${Date.now()}`;
				const h2 = await ctx.agents.create({ sessionId: eltern2, meta: { cwd: B }, agentOptions: modell });
				const kind2 = await kindStarten(h2.agent, "Start [[SLOW]]"); await warte(3500);
				await h2.dispose(); await warte(500);
				const dateien = readdirSync(`${HEIM}/sessions`, { recursive: true }).filter((p) => String(p).includes(eltern2) && String(p).endsWith(".zstd"));
				ergebnis.defektDateien = dateien.length;
				for (const d of dateien) writeFileSync(`${HEIM}/sessions/${d}`, "kaputt-kaputt-kaputt");
				ergebnis.defektFollow = await versuche("follow-defekter-eltern", () => ersterRahmen(adresse(eltern2, kind2)), ids);
				ergebnis.defektPage = await versuche("page-defekter-eltern", () => seite(eltern2, kind2), ids);
				ergebnis.defektElternLebt = ctx.agents.get(eltern2) !== undefined;
				ergebnis.defektPrompt = await versuche("prompt-defekter-eltern", () => tor(eltern2, kind2, "x [[SLOW]]"), ids);
				ergebnis.fremdFollow = await versuche("follow-eltern-ohne-datei", () => ersterRahmen(adresse("gibt-es-nicht", kindId)), ids);
				ergebnis.fremdPage = await versuche("page-eltern-ohne-datei", () => seite("gibt-es-nicht", kindId), ids);
				ergebnis.fremdPrompt = await versuche("prompt-eltern-ohne-datei", () => tor("gibt-es-nicht", kindId, "x [[SLOW]]"), ids);
				await warte(500);
			}
			if (SZENARIO === "notschalter") {
				const { kindId } = await kaltMitKind();
				mkdirSync(`${HEIM}/.tm/teams-plus`, { recursive: true });
				writeFileSync(SCHALTER, JSON.stringify({ aus: true }));
				ergebnis.torSchalterAus = await versuche("tor-schalter-aus", () => tor(elternId, kindId, "Schalter aus [[SLOW]]"), ids);
				ergebnis.seiteSchalterAus = await versuche("page-schalter-aus", () => seite(elternId, kindId), ids);
				await warte(800);
				ergebnis.elternLebtSchalterAus = ctx.agents.get(elternId) !== undefined;
				rmSync(SCHALTER);
				ergebnis.torSchalterWeg = await versuche("tor-schalter-weg", () => tor(elternId, kindId, "Schalter weg [[SLOW]]"), ids);
				await warte(2000);
				ergebnis.elternLebtSchalterWeg = ctx.agents.get(elternId) !== undefined;
				// Kaputte Datei zaehlt als aus (sichere Richtung), Eltern wieder kalt stellen ist unnoetig: nur die Entscheidung messen
				writeFileSync(SCHALTER, "das ist kein json");
				const eltern3 = `eltern-schalter-${Date.now()}`;
				const h3 = await ctx.agents.create({ sessionId: eltern3, meta: { cwd: B }, agentOptions: modell });
				const kind3 = await kindStarten(h3.agent, "Start [[SLOW]]"); await warte(3500);
				await h3.dispose(); await warte(500);
				ergebnis.torSchalterKaputt = await versuche("tor-schalter-kaputt", () => tor(eltern3, kind3, "kaputt [[SLOW]]"), ids);
				rmSync(SCHALTER);
			}
			if (SZENARIO === "kette") {
				const gp = eltern;
				const mitteId = await kindStarten(gp, "Mitte [[LONG]]", "Mitte"); ids.mitte = mitteId;
				await warte(500);
				const mitte = ctx.agents.get(mitteId);
				if (!mitte) throw new Error("Mitte nicht lebendig");
				const enkelId = await kindStarten(mitte, "Enkel [[SLOW]]", "Enkel"); ids.enkel = enkelId;
				await warte(8000);
				ergebnis.lebendVorTest = { gp: ctx.agents.get(elternId) !== undefined, mitte: ctx.agents.get(mitteId) !== undefined, enkel: ctx.agents.get(enkelId) !== undefined };
				ergebnis.promptEnkel = await versuche("prompt-enkel-mitte-kalt", () => tor(mitteId, enkelId, "Mensch an Enkel [[SLOW]]"), ids);
				ergebnis.seiteEnkel = await versuche("page-enkel-mitte-kalt", () => seite(mitteId, enkelId), ids);
				await warte(500);
				ergebnis.mitteLebtDanach = ctx.agents.get(mitteId) !== undefined;
				ergebnis.gpPromptMitte = await versuche("gp-schreibt-mitte-an", () => ctx.subagents.prompt(anfrage(elternId, mitteId, "Mensch an Mitte [[SLOW]]"), new AbortController().signal), ids);
				await warte(2500);
			}
			if (SZENARIO === "neustart-a") {
				const kindId = await kindStarten(eltern, "Start [[SLOW]]");
				await warte(2500);
				ctx.goals.create(eltern, { objective: "Eltern-Ziel: arbeite weiter [[LONG]]", maxGoalRounds: 100 });
				await warte(1200);
				const g = ctx.goals.get(eltern);
				writeFileSync(`${B}/neustart-ids.json`, JSON.stringify({ elternId, kindId }));
				ergebnis.vorHartemEnde = { ziel: kurz(g, 260), status: String(eltern.status), ...zustand({ eltern: elternId }) };
				ergebnis.protokoll = protokoll;
				writeFileSync(AUSGABE, JSON.stringify(ergebnis, null, 1));
				process.kill(process.pid, "SIGKILL");
				return;
			}
			if (SZENARIO === "neustart-b") {
				const { elternId: alt, kindId } = JSON.parse(readFileSync(`${B}/neustart-ids.json`, "utf8"));
				ids.eltern = alt; ids.kind = kindId;
				ergebnis.beimStart = zustand(ids);
				ergebnis.listeKalt = await versuche("session-list-kalt", sessionListe, ids);
				const llmVor = zaehlerLlm(alt); const llmVorGesamt = zaehlerLlm();
				const t1 = Date.now();
				ergebnis.seite = await versuche("page-oeffnen", async () => { const r = await seite(alt, kindId); return { records: (r?.records ?? r?.value?.records ?? []).length, dauerMs: Date.now() - t1 }; }, ids);
				ergebnis.llmGesamtDifferenzSofortNachLaden = zaehlerLlm() - llmVorGesamt;
				for (let i = 0; i < 5; i++) { await warte(1000); const n = ctx.agents.get(alt); const g = n ? ctx.goals.get(n) : null; log("ziel-verlauf", { lebt: n !== undefined, phase: g?.phase, akt: g?.activation, runden: g?.roundsStarted, status: String(n?.status), llmEltern: zaehlerLlm(alt) - llmVor, llmGesamt: zaehlerLlm() - llmVorGesamt }); }
				const n = ctx.agents.get(alt);
				ergebnis.zielNachLaden = kurz(n ? ctx.goals.get(n) : null, 300);
				ergebnis.torNachLaden = await versuche("tor-prompt-nach-laden", () => tor(alt, kindId, "Nach Neustart und Laden [[SLOW]]"), ids);
				await warte(2500);
			}
			ergebnis.ende = zustand(ids);
			ergebnis.llmLog = llmZeilen().map((z) => ({ ...z, zeit: z.zeit - t0, sitzung: z.sitzung.slice(-8) }));
		} catch (fehler) { ergebnis.fehler = String(fehler?.stack ?? fehler).slice(0, 1500); }
		ergebnis.verfuegbarEreignisse = verfuegbar;
		ergebnis.patchProtokoll = patchLog();
		ergebnis.protokoll = protokoll;
		writeFileSync(AUSGABE, JSON.stringify(ergebnis, null, 1));
		process.exit(ergebnis.fehler ? 2 : 0);
	})();
}
