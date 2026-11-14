/**
 * Wegwerf-Treiber der Probe "Kette laden" (kein Teil des Plugins): Lead L -> Mitte M -> Enkel G, alle kalt.
 * Aufbau abgeleitet von docs/messung-eltern-laden/treiber.mjs (Szenario "kette") und treiber-181.mjs (hartes Ende).
 *
 * PROBE_SZENARIO:
 *   k1-<typ>            Phase 1: Kette anlegen, alles abschliessen lassen, Lead-Sitzung sichern, Prozess HART beenden (SIGKILL).
 *   k2-<typ>-<variante> Phase 2: Neustart auf denselben Sitzungsdateien (PROBE_BEHALTE=1); nichts ist geladen.
 * typ:        u  = M ist ein gewoehnlicher Unteragent von L (startContinuable)
 *             t  = M ist Teammitglied "exp" von L (agentTeams.spawnTeammate), G Unteragent von M
 *             tB = wie t, zusaetzlich eine unzugestellte Team-Nachricht von L an M im Journal (Issue 181 Lage B)
 * variante:   tor            G direkt per Gateway anschreiben, dann M direkt per Gateway anschreiben (nichts geladen; mit/ohne Patch)
 *             oben-unten     L ueber Lookup laden, dann subagents.prompt(L->M) (Weg coldResume), sofort danach subagents.prompt(M->G)
 *             oben-unten-spaet  wie oben-unten, aber 6 s Pause vor dem Anschreiben von G
 *             direkt-laden   L ueber Lookup laden, M mit agents.resume({parentAgent: L}) laden, subagents.prompt(M->G); dann L->M; dann M abbauen, L->M
 *             materialisieren  L ueber Lookup laden, M ohne Nachricht als Activation anlegen (Kern-Interna: subagents.continuations.activations.materialize), subagents.prompt(M->G), dann L->M
 *             materialisieren-sofort  wie materialisieren, aber ohne Pause: subagents.prompt(M->G) unmittelbar nach dem Anlegen von M
 *             materialisieren-halt  wie materialisieren, zusaetzlich 3 s lang alle 100 ms: lebt M noch? (Lebensdauer ohne Kind, ohne Nachricht); Ereignisse api-session/added|updated
 *             materialisieren-wdh  5 Laeufe: M anlegen, Pause 0/0/0/5/20 ms, G anschreiben (Wettlauf gegen den Selbstabbau von M)
 *             nur-lead       nur L ueber den Lookup laden, dann beobachten (Issue-181-Frage fuer die Kette)
 * PROBE_MODUS = mit | ohne  (Patch eltern-laden geladen oder nicht).
 */
import { writeFileSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { foldSubagentDescriptor } from "@deepseek-ai/dsh-subagent";

export const name = "probe-treiber-kette";
export const inject = ["agents", "subagents", "agentTeams", "sessions", "typertGateway", "typert", "sessionQuery"];

const B = process.env.PROBE_ORDNER ?? "/tmp/teams_plus_kette/arbeit";
const AUSGABE = process.env.PROBE_AUSGABE ?? `${B}/ergebnis.json`;
const LLM_LOG = process.env.PROBE_LLM_LOG ?? `${B}/llm-aufrufe.log`;
const HEIM = process.env.PROBE_HEIM;
const SZENARIO = process.env.PROBE_SZENARIO ?? "k1-u";
const MODUS = process.env.PROBE_MODUS ?? "ohne";
const PATCH_LOG = `${HEIM}/.tm/teams-plus/logs/eltern-laden.log`;
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const kurz = (x, n = 300) => { try { return (typeof x === "string" ? x : JSON.stringify(x)).slice(0, n); } catch { return String(x).slice(0, n); } };
const modell = { provider: "probe", model: "m" };
const llmZeilen = () => { try { return readFileSync(LLM_LOG, "utf8").split("\n").filter(Boolean).map((z) => JSON.parse(z)); } catch { return []; } };
const patchLog = () => { try { return readFileSync(PATCH_LOG, "utf8").split("\n").filter(Boolean).map((z) => z.replace(/^\S+ /, "")); } catch { return []; } };

export function apply(ctx) {
	const t0 = Date.now();
	const protokoll = [];
	const log = (art, d = {}) => { protokoll.push({ ms: Date.now() - t0, art, ...d }); if (process.env.PROBE_STDERR) console.error("[probe]", art, JSON.stringify(d).slice(0, 200)); };
	const k8 = (id) => String(id).slice(-8);
	const statusVerlauf = [];
	const erzeugt = [];
	const abgebaut = [];
	ctx.on("agent/status", ({ agent, status }) => { statusVerlauf.push({ ms: Date.now() - t0, id: k8(agent.id), status: String(status) }); });
	ctx.on("agent/created", ({ agent, source }) => { erzeugt.push({ ms: Date.now() - t0, id: k8(agent.id), source }); });
	const verfuegbar = [];
	ctx.on("api-session/added", (zusammenfassung) => { verfuegbar.push({ ms: Date.now() - t0, id: k8(zusammenfassung.sessionId), agentAvailable: zusammenfassung.agentAvailable }); });
	ctx.on("api-session/updated", (zusammenfassung) => { verfuegbar.push({ ms: Date.now() - t0, art: "updated", id: k8(zusammenfassung.sessionId), agentAvailable: zusammenfassung.agentAvailable }); });
	ctx.on("agent/disposed", ({ agent }) => { abgebaut.push({ ms: Date.now() - t0, id: k8(agent.id) }); });
	const zaehlerLlm = (id) => llmZeilen().filter((z) => z.sitzung.endsWith(k8(id))).length;
	const [, typ, variante] = SZENARIO.match(/^k[12]-(u|tB|t)(?:-(.+))?$/) ?? [];
	const phase = SZENARIO.startsWith("k1") ? 1 : 2;
	const idsDatei = `${B}/kette-ids-${typ}.json`;
	const direkt = (elternId, kindId, text) => ctx.subagents.prompt({ requestId: randomUUID(), parentSessionId: elternId, childSessionId: kindId, mode: "continuable", delivery: "queue", content: [{ type: "text", text }] }, new AbortController().signal);
	const tor = (elternId, kindId, text) => ctx.typertGateway.invoke({ namespace: "subagents", method: "prompt", args: { request: { requestId: randomUUID(), parentSessionId: elternId, childSessionId: kindId, mode: "continuable", delivery: "queue", content: [{ type: "text", text }] } } });
	const kindStarten = async (elternAgent, text, etikett) => { const id = randomUUID(); await ctx.subagents.startContinuable({ provider: "spawn", label: etikett, childId: id, request: { label: etikett, prompt: [{ type: "text", text }], parent: elternAgent }, signal: new AbortController().signal }); return id; };
	const ladeUeberLookup = async (id) => { const a = ctx.typert.lookups.get("agent"); if (a === undefined) throw new Error("Lookup agent fehlt"); return a.resolve(id); };
	const versuche = async (was, f) => {
		const tA = Date.now();
		try { const r = await f(); log(was, { ok: true }); return { ok: true, dauerMs: Date.now() - tA, r: kurz(r, 200) }; }
		catch (e) { log(was, { ok: false, code: e?.code }); return { ok: false, dauerMs: Date.now() - tA, code: e?.code, fehler: kurz(e?.message ?? e, 400) }; }
	};

	/** Zustand der drei Sitzungen: lebt, Status, Zahl der Modellaufrufe und Zuege (agent/status running) seit Start. */
	const zustand = (ids) => {
		const aus = { ms: Date.now() - t0, llmGesamt: llmZeilen().length, lebend: ctx.agents.list().map((a) => k8(a.id)) };
		for (const [n, id] of Object.entries(ids)) {
			const a = ctx.agents.get(id);
			aus[n] = {
				lebt: a !== undefined, status: a ? String(a.status) : null, llm: zaehlerLlm(id),
				zuege: statusVerlauf.filter((s) => s.id === k8(id) && s.status === "running").length,
				eigentuemerLead: a && ids.lead && n !== "lead" ? ctx.agents.isOwnedBy(id, ctx.agents.get(ids.lead)) : undefined
			};
		}
		return aus;
	};

	(async () => {
		const ergebnis = { szenario: SZENARIO, modus: MODUS, typ, variante, phase };
		try {
			await warte(1200);
			if (phase === 1) {
				const leadId = `kette-lead-${typ}-${Date.now()}`;
				const lead = (await ctx.agents.create({ sessionId: leadId, meta: { cwd: B }, agentOptions: modell })).agent;
				let mitteId;
				if (typ === "u") mitteId = await kindStarten(lead, "Mitte [[LONG]]", "Mitte");
				else {
					const mitglied = await ctx.agentTeams.spawnTeammate(lead, { name: "exp", description: "Probe-Mitte", prompt: [{ type: "text", text: "Mitte [[LONG]]" }], context: "fresh", provider: "spawn", agentOptions: modell, signal: new AbortController().signal });
					mitteId = mitglied.member.id;
				}
				await warte(500);
				const mitte = ctx.agents.get(mitteId);
				if (!mitte) throw new Error("Mitte nicht lebendig");
				const enkelId = await kindStarten(mitte, "Enkel [[SLOW]]", "Enkel");
				log("kette-angelegt", { lead: k8(leadId), mitte: k8(mitteId), enkel: k8(enkelId) });
				await warte(9000);
				ergebnis.lebendNachAbschluss = { lead: ctx.agents.get(leadId) !== undefined, mitte: ctx.agents.get(mitteId) !== undefined, enkel: ctx.agents.get(enkelId) !== undefined };
				if (typ === "tB") {
					const nachricht = { id: `team-message-${randomUUID()}`, senderId: leadId, senderName: "lead", targetId: mitteId, content: [{ type: "text", text: "Auftrag vom Lead an die Mitte (unzugestellt)" }] };
					lead.session.append("team/message/queued", { version: 2, teamId: leadId, message: nachricht });
					ergebnis.nachricht = { id: nachricht.id, ziel: "mitte" };
				}
				await ctx.sessions.flush(lead.session);
				ergebnis.vorEnde = zustand({ lead: leadId, mitte: mitteId, enkel: enkelId });
				writeFileSync(idsDatei, JSON.stringify({ leadId, mitteId, enkelId }));
				ergebnis.protokoll = protokoll; ergebnis.statusVerlauf = statusVerlauf;
				writeFileSync(AUSGABE, JSON.stringify(ergebnis, null, 1));
				process.kill(process.pid, "SIGKILL");
				return;
			}
			// Phase 2
			const { leadId, mitteId, enkelId } = JSON.parse(readFileSync(idsDatei, "utf8"));
			const ids = { lead: leadId, mitte: mitteId, enkel: enkelId };
			const messen = (marke) => { ergebnis[marke] = zustand(ids); };
			const verlauf = async (marken) => { let t = 0; for (const [bis, marke] of marken) { await warte(bis - t); t = bis; messen(marke); } };
			messen("beimStart");

			if (variante === "tor") {
				ergebnis.torEnkel = await versuche("tor-enkel-alles-kalt", () => tor(mitteId, enkelId, "Mensch an Enkel [[SLOW]]"));
				messen("nachTorEnkel");
				ergebnis.torMitte = await versuche("tor-mitte-alles-kalt", () => tor(leadId, mitteId, "Mensch an Mitte [[SLOW]]"));
				await verlauf([[400, "nach400ms"], [5000, "nach5s"]]);
			}
			if (variante === "materialisieren" || variante === "materialisieren-sofort" || variante === "materialisieren-halt") {
				ergebnis.ladeLead = await versuche("lead-laden", async () => { const a = await ladeUeberLookup(leadId); return k8(a.agent?.id ?? a.id ?? "?"); });
				const lead = ctx.agents.get(leadId);
				messen("direktNachLeadLaden");
				ergebnis.zugang = { continuations: typeof ctx.subagents.continuations, activations: typeof ctx.subagents.continuations?.activations, materialize: typeof ctx.subagents.continuations?.activations?.materialize };
				ergebnis.materialisiereMitte = await versuche("mitte-materialisieren-ohne-nachricht", async () => {
					const beobachtung = await ctx.sessionQuery.observeSession(mitteId, { signal: new AbortController().signal });
					try {
						const d = foldSubagentDescriptor(beobachtung.events.slice(beobachtung.inheritedEventCount));
						ergebnis.descriptor = kurz(d, 300);
						const a = await ctx.subagents.continuations.activations.materialize({ childId: mitteId, provider: d.provider, parent: lead, agentOptions: {}, composition: { persona: d.persona, toolFilter: d.toolFilter }, signal: new AbortController().signal });
						return k8(a.childId);
					} finally { beobachtung[Symbol.dispose]?.(); }
				});
				messen("direktNachMaterialisieren");
				if (variante === "materialisieren-halt") { const lebensdauer = []; for (let i = 0; i < 30; i++) { await warte(100); lebensdauer.push(ctx.agents.get(mitteId) !== undefined ? 1 : 0); } ergebnis.lebensdauerMitte100ms = lebensdauer.join(""); messen("nachHalt"); }
				if (variante === "materialisieren") { await warte(1000); messen("einSekundeNachMaterialisieren"); }
				ergebnis.promptEnkel = await versuche("prompt-mitte-an-enkel", () => direkt(mitteId, enkelId, "Mensch an Enkel [[SLOW]]"));
				messen("direktNachPromptEnkel");
				await verlauf([[400, "nach400ms"], [5000, "nach5s"]]);
				ergebnis.leadSchreibtMitte = await versuche("prompt-lead-an-mitte", () => direkt(leadId, mitteId, "Mensch an Mitte [[SLOW]]"));
				await verlauf([[400, "nachLeadAnMitte400ms"], [5000, "nachLeadAnMitte5s"]]);
			}
			if (variante === "materialisieren-wdh") {
				ergebnis.ladeLead = await versuche("lead-laden", async () => { const a = await ladeUeberLookup(leadId); return k8(a.agent?.id ?? a.id ?? "?"); });
				const lead = ctx.agents.get(leadId);
				ergebnis.wiederholungen = [];
				for (const [i, pause] of [0, 0, 0, 5, 20].entries()) {
					const r = { lauf: i + 1, pauseMsZwischenAnlegenUndAnschreiben: pause };
					const llmVor = { m: zaehlerLlm(mitteId), g: zaehlerLlm(enkelId), l: zaehlerLlm(leadId) };
					const beobachtung = await ctx.sessionQuery.observeSession(mitteId, { signal: new AbortController().signal });
					let d; try { d = foldSubagentDescriptor(beobachtung.events.slice(beobachtung.inheritedEventCount)); } finally { beobachtung[Symbol.dispose]?.(); }
					const tA = Date.now();
					try {
						await ctx.subagents.continuations.activations.materialize({ childId: mitteId, provider: d.provider, parent: lead, agentOptions: {}, composition: { persona: d.persona, toolFilter: d.toolFilter }, signal: new AbortController().signal });
						r.materialisiert = true;
					} catch (e) { r.materialisiert = false; r.fehlerM = kurz(e?.message ?? e, 200); }
					if (pause > 0) await warte(pause);
					r.mitteLebtVorAnschreiben = ctx.agents.get(mitteId) !== undefined;
					const g = await versuche("prompt-mitte-an-enkel", () => direkt(mitteId, enkelId, "Wdh " + (i + 1) + " [[SLOW]]"));
					r.anschreibenOk = g.ok; r.anschreibenCode = g.code; r.dauerMs = Date.now() - tA;
					await warte(4000);
					r.aufrufeNachher = { l: zaehlerLlm(leadId) - llmVor.l, m: zaehlerLlm(mitteId) - llmVor.m, g: zaehlerLlm(enkelId) - llmVor.g };
					r.lebendNachher = { m: ctx.agents.get(mitteId) !== undefined, g: ctx.agents.get(enkelId) !== undefined };
					ergebnis.wiederholungen.push(r);
				}
			}
			if (variante === "nur-lead") {
				ergebnis.ladeLead = await versuche("lead-laden", async () => { const a = await ladeUeberLookup(leadId); return k8(a.agent?.id ?? a.id ?? "?"); });
				messen("direktNachLeadLaden");
				await verlauf([[400, "nach400ms"], [5000, "nach5s"], [9000, "nach9s"]]);
			}
			if (variante === "oben-unten" || variante === "oben-unten-spaet") {
				ergebnis.ladeLead = await versuche("lead-laden", async () => { const a = await ladeUeberLookup(leadId); return k8(a.agent?.id ?? a.id ?? "?"); });
				messen("direktNachLeadLaden");
				await warte(1000); messen("einSekundeNachLeadLaden");
				ergebnis.promptMitte = await versuche("prompt-lead-an-mitte", () => direkt(leadId, mitteId, "Weckruf an Mitte [[SLOW]]"));
				messen("direktNachPromptMitte");
				if (variante === "oben-unten-spaet") { await warte(6000); messen("vorPromptEnkel"); }
				ergebnis.promptEnkel = await versuche("prompt-mitte-an-enkel", () => direkt(mitteId, enkelId, "Mensch an Enkel [[SLOW]]"));
				messen("direktNachPromptEnkel");
				await verlauf([[400, "nach400ms"], [5000, "nach5s"], [11000, "nach11s"]]);
			}
			if (variante === "direkt-laden") {
				ergebnis.ladeLead = await versuche("lead-laden", async () => { const a = await ladeUeberLookup(leadId); return k8(a.agent?.id ?? a.id ?? "?"); });
				const lead = ctx.agents.get(leadId);
				messen("direktNachLeadLaden");
				let mitteHandle;
				ergebnis.ladeMitteDirekt = await versuche("mitte-direkt-laden", async () => { mitteHandle = await ctx.agents.resume({ resumeSessionId: mitteId, parentAgent: lead, agentOptions: modell }); return k8(mitteHandle.agent.id); });
				messen("direktNachMitteLaden");
				await warte(1000); messen("einSekundeNachMitteLaden");
				ergebnis.promptEnkel = await versuche("prompt-mitte-an-enkel", () => direkt(mitteId, enkelId, "Mensch an Enkel [[SLOW]]"));
				messen("direktNachPromptEnkel");
				await verlauf([[400, "nach400ms"], [5000, "nach5s"]]);
				ergebnis.leadSchreibtMitteLebend = await versuche("prompt-lead-an-mitte-solange-mitte-direkt-lebt", () => direkt(leadId, mitteId, "Mensch an Mitte [[SLOW]]"));
				messen("nachLeadAnMitteLebend");
				if (mitteHandle) { await mitteHandle.dispose(); await warte(300); messen("nachMitteDispose"); }
				ergebnis.leadSchreibtMitteNachDispose = await versuche("prompt-lead-an-mitte-nach-dispose", () => direkt(leadId, mitteId, "Mensch an Mitte, zweiter Versuch [[SLOW]]"));
				await verlauf([[400, "nachDisposeNach400ms"], [5000, "nachDisposeNach5s"]]);
			}
			ergebnis.llmLog = llmZeilen().map((z) => ({ ...z, zeit: z.zeit - t0, sitzung: z.sitzung.slice(-8) }));
			ergebnis.kuerzel = { lead: k8(leadId), mitte: k8(mitteId), enkel: k8(enkelId) };
		} catch (fehler) { ergebnis.fehler = String(fehler?.stack ?? fehler).slice(0, 1500); }
		ergebnis.verfuegbar = verfuegbar; ergebnis.statusVerlauf = statusVerlauf; ergebnis.erzeugt = erzeugt; ergebnis.abgebaut = abgebaut;
		ergebnis.patchProtokoll = patchLog();
		ergebnis.protokoll = protokoll;
		writeFileSync(AUSGABE, JSON.stringify(ergebnis, null, 1));
		process.exit(ergebnis.fehler ? 2 : 0);
	})();
}
