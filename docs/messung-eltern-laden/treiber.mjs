/**
 * Wegwerf-Treiber der Probe "Eltern-Sitzung laden" (kein Teil des Plugins). Szenarien über PROBE_SZENARIO,
 * Ergebnis als JSON nach PROBE_AUSGABE; das Skript beendet den Prozess selbst.
 *   grund     Eltern + Kind, Eltern abbauen (kalt): prompt ohne Laden / ctx.agents.resume / prompt danach; Modellaufrufe vorher-nachher
 *   tor       der Weg der Oberfläche über das Gateway (subagents/prompt) mit und ohne Haken (subagents.prompt umwickelt, lädt Eltern über den "agent"-Lookup)
 *   ereignis  zeigt das Laden dem Client an (Ereignis api-session/added mit agentAvailable)?
 *   ziel      Eltern mit laufendem Ziel abbauen und laden: startet das Laden Runden?
 *   post      Kind meldet sich ab, während der Elternteil kalt ist: was geschieht mit der Abschlussmeldung, wenn der Elternteil geladen wird?
 *   kette     Großeltern -> Eltern (selbst Kind) -> Enkel: Laden des Zwischenelternteils
 *   oeffnen   Host-Haken beim ÖFFNEN eines Kindes: sessionController.page (Aufruf der Oberfläche beim Laden des Verlaufs) umwickelt, lädt den kalten Elternteil; kommt agentAvailable=true beim Client an?
 *   oeffnen2  (1) Haken auf sessionController.follow (zweiter Öffnungsweg der Oberfläche); (2) Elternteil mit zerstörter Sitzungsdatei; (3) Elternteil ohne jede Datei: der Haken muss den Fehler schlucken, das Öffnen des Kindes darf nicht scheitern
 *   oeffnen3  wie oeffnen, aber der Haken am Öffnen lädt im Hintergrund (nicht abwarten): kehrt page sofort zurück, und wird der Elternteil trotzdem geladen und gemeldet?
 *   neustart-a / neustart-b  der echte Fall "DSH neu gestartet": a legt Eltern (mit aktivem Ziel mitten in einer Runde) + Kind an und beendet den Prozess hart (kein Abbau), b startet NEU auf denselben Sitzungsdateien (PROBE_BEHALTE=1), lädt den Elternteil und schreibt das Kind an
 *   parallel  zwei Kinder gleichzeitig angeschrieben, Eltern kalt: wird einmal geladen?
 */
import { writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";

export const name = "probe-treiber";
export const inject = ["agents", "subagents", "goals", "sessions", "sessionQuery", "typertGateway", "typert", "sessionController"];

const B = "/tmp/teams_plus_umbau/probe_eltern";
const AUSGABE = process.env.PROBE_AUSGABE ?? `${B}/ergebnis.json`;
const LLM_LOG = process.env.PROBE_LLM_LOG ?? `${B}/llm-aufrufe.log`;
const SZENARIO = process.env.PROBE_SZENARIO ?? "grund";
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const kurz = (x, n = 300) => { try { return (typeof x === "string" ? x : JSON.stringify(x)).slice(0, n); } catch { return String(x).slice(0, n); } };
const modell = { provider: "probe", model: "m" };
const llmZeilen = () => { try { return readFileSync(LLM_LOG, "utf8").split("\n").filter(Boolean).map((z) => JSON.parse(z)); } catch { return []; } };

export function apply(ctx) {
	const t0 = Date.now();
	const protokoll = [];
	const log = (art, d = {}) => { protokoll.push({ ms: Date.now() - t0, art, ...d }); if (process.env.PROBE_STDERR) console.error("[probe]", art, JSON.stringify(d).slice(0, 160)); };
	const k8 = (id) => String(id).slice(-8);
	const zuege = new Map();
	const erzeugt = [];
	const verfuegbar = []; // Ereignis api-session/added: agentAvailable je Sitzung
	ctx.on("agent/status", ({ agent, status }) => { if (status === "running") zuege.set(String(agent.id), (zuege.get(String(agent.id)) ?? 0) + 1); });
	ctx.on("agent/created", ({ agent, source }) => { erzeugt.push(k8(agent.id)); log("agent/created", { id: k8(agent.id), source }); });
	ctx.on("agent/disposed", ({ agent }) => log("agent/disposed", { id: k8(agent.id) }));
	ctx.on("api-session/added", (summary) => { verfuegbar.push({ ms: Date.now() - t0, id: k8(summary.sessionId), agentAvailable: summary.agentAvailable }); });
	const zaehlerLlm = (id) => llmZeilen().filter((z) => id === undefined || z.sitzung.endsWith(k8(id))).length;
	const zustand = (ids = {}) => ({
		llm: llmZeilen().length,
		llmJe: Object.fromEntries(Object.entries(ids).map(([n, id]) => [n, zaehlerLlm(id)])),
		zuege: Object.fromEntries([...zuege].map(([k, v]) => [k8(k), v])),
		erzeugt: erzeugt.length,
		lebend: ctx.agents.list().map((a) => k8(a.id))
	});
	const prompt = (elternId, kindId, text) => ctx.subagents.prompt({ requestId: randomUUID(), parentSessionId: elternId, childSessionId: kindId, mode: "continuable", delivery: "queue", content: [{ type: "text", text }] }, new AbortController().signal);
	const tor = (elternId, kindId, text) => ctx.typertGateway.invoke({ namespace: "subagents", method: "prompt", args: { request: { requestId: randomUUID(), parentSessionId: elternId, childSessionId: kindId, mode: "continuable", delivery: "queue", content: [{ type: "text", text }] } } });
	const sessionListe = async () => { const r = await ctx.typertGateway.invoke({ namespace: "session", method: "list", args: { _request: {} } }); const z = Array.isArray(r) ? r : (r?.items ?? r?.value?.items ?? []); return z.map((i) => ({ id: k8(i.sessionId), agentAvailable: i.agentAvailable })); };
	const versuche = async (was, f, ids) => { const vor = zustand(ids); try { const r = await f(); log(was, { ok: true }); return { ok: true, r: kurz(r), vor, nach: zustand(ids) }; } catch (e) { log(was, { ok: false, code: e?.code }); return { ok: false, code: e?.code, fehler: kurz(e?.message ?? e, 220), ursache: kurz((() => { const k = []; let c = e?.cause; while (c && k.length < 5) { k.push(String(c.message ?? c)); c = c.cause; } return k; })(), 500), vor, nach: zustand(ids) }; } };
	const ladeUeberLookup = async (id) => { const a = ctx.typert.lookups.get("agent"); if (a === undefined) throw new Error("Lookup agent fehlt"); return a.resolve(id); };
	const ladeDirekt = async (id, elternAgent) => (await ctx.agents.resume({ resumeSessionId: id, ...(elternAgent ? { parentAgent: elternAgent } : {}), agentOptions: modell })).agent;
	const kindStarten = async (elternAgent, text, etikett = "Probe-Kind") => { const id = randomUUID(); await ctx.subagents.startContinuable({ provider: "spawn", label: etikett, childId: id, request: { label: etikett, prompt: [{ type: "text", text }], parent: elternAgent }, signal: new AbortController().signal }); return id; };
	const haken = [];
	const hakenEinbauen = () => {
		const original = ctx.subagents.prompt;
		ctx.subagents.prompt = async function (request, signal) {
			const eltern = request?.parentSessionId;
			if (eltern !== undefined && ctx.agents.get(eltern) === undefined) {
				haken.push({ ms: Date.now() - t0, art: "haken-laedt", eltern: k8(eltern) });
				try { await ladeUeberLookup(eltern); haken.push({ art: "haken-geladen", lebt: ctx.agents.get(eltern) !== undefined }); } catch (e) { haken.push({ art: "haken-fehler", code: e?.code, f: kurz(e?.message ?? e, 200) }); }
			}
			return Reflect.apply(original, this, [request, signal]);
		};
		return () => { ctx.subagents.prompt = original; };
	};

	(async () => {
		const ergebnis = { szenario: SZENARIO };
		try {
			await warte(1200);
			const elternId = `eltern-${Date.now()}`;
			const neuB = SZENARIO === "neustart-b";
			const handle = neuB ? undefined : await ctx.agents.create({ sessionId: elternId, meta: { cwd: B }, agentOptions: modell });
			const eltern = handle?.agent;
			if (!neuB) log("eltern-angelegt", { id: k8(elternId) });
			const ids = { eltern: elternId };

			if (SZENARIO === "grund" || SZENARIO === "tor" || SZENARIO === "ereignis" || SZENARIO === "parallel") {
				const kindId = await kindStarten(eltern, "Start [[SLOW]]"); ids.kind = kindId;
				const kind2 = SZENARIO === "parallel" ? await kindStarten(eltern, "Start2 [[SLOW]]", "Probe-Kind-2") : undefined;
				await warte(4000);
				ergebnis.nachStart = zustand(ids);
				await handle.dispose(); await warte(500);
				ergebnis.nachAbbau = zustand(ids);
				ergebnis.elternLebt = ctx.agents.get(elternId) !== undefined; ergebnis.kindLebt = ctx.agents.get(kindId) !== undefined;
				if (SZENARIO === "grund") {
					ergebnis.promptOhneLaden = await versuche("prompt-kalter-eltern", () => prompt(elternId, kindId, "Mensch an Kind 1 [[SLOW]]"), ids);
					ergebnis.laden = await versuche("eltern-laden", async () => { const a = await ladeDirekt(elternId); return { id: k8(a.id), status: String(a.status) }; }, ids);
					await warte(2500);
					ergebnis.nachLaden = zustand(ids);
					ergebnis.promptNachLaden = await versuche("prompt-geladener-eltern", () => prompt(elternId, kindId, "Mensch an Kind 2 [[SLOW]]"), ids);
					await warte(3000);
				}
				if (SZENARIO === "tor") {
					ergebnis.listeKalt = await versuche("session-list-kalt", sessionListe, ids);
					ergebnis.torKalt = await versuche("tor-prompt-kalt", () => tor(elternId, kindId, "Tor 1 [[SLOW]]"), ids);
					const zurueck = hakenEinbauen();
					ergebnis.torMitHaken = await versuche("tor-prompt-mit-haken", () => tor(elternId, kindId, "Tor 2 [[SLOW]]"), ids);
					ergebnis.haken = haken;
					await warte(2500);
					ergebnis.listeNachLaden = await versuche("session-list-nach-laden", sessionListe, ids);
					zurueck();
				}
				if (SZENARIO === "ereignis") {
					const vor = verfuegbar.length;
					const a = await ladeUeberLookup(elternId);
					await warte(500);
					ergebnis.ereignisseBeimLaden = verfuegbar.slice(vor);
					ergebnis.listeNachLaden = await versuche("session-list-nach-laden", sessionListe, ids);
				}
				if (SZENARIO === "parallel") {
					const zurueck = hakenEinbauen();
					const r = await Promise.allSettled([tor(elternId, kindId, "Parallel A [[SLOW]]"), tor(elternId, kind2, "Parallel B [[SLOW]]")]);
					ergebnis.parallel = r.map((x) => x.status === "fulfilled" ? "ok" : kurz(x.reason?.message, 160));
					ergebnis.haken = haken;
					ergebnis.erzeugtLeadAgenten = erzeugt.filter((x) => x === k8(elternId)).length;
					await warte(3000);
					zurueck();
				}
			}

			if (SZENARIO === "ziel") {
				ergebnis.zielAnlegen = kurz(ctx.goals.create(eltern, { objective: "Eltern-Ziel: arbeite weiter [[LONG]]", maxGoalRounds: 100 }), 200);
				await warte(1500);
				ergebnis.vorAbbau = { ziel: kurz(ctx.goals.get(eltern), 250), ...zustand(ids) };
				await handle.dispose(); await warte(300);
				ergebnis.nachAbbau = zustand(ids);
				const llmVorLaden = zaehlerLlm(elternId);
				ergebnis.laden = await versuche("eltern-laden", async () => { const a = await ladeUeberLookup(elternId); return k8(a.agent?.id ?? a.id); }, ids);
				const neu = ctx.agents.get(elternId);
				for (let i = 0; i < 6; i++) { await warte(1000); const g = neu ? ctx.goals.get(neu) : null; log("ziel-verlauf", { phase: g?.phase, akt: g?.activation, runden: g?.roundsStarted, status: String(neu?.status), llmEltern: zaehlerLlm(elternId) - llmVorLaden }); }
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
				process.kill(process.pid, "SIGKILL"); // hartes Ende wie ein Neustart: kein dispose, keine Abschlussereignisse
				return;
			}
			if (SZENARIO === "neustart-b") {
				const { elternId: alt, kindId } = JSON.parse(readFileSync(`${B}/neustart-ids.json`, "utf8"));
				ids.eltern = alt; ids.kind = kindId;
				ergebnis.beimStart = zustand(ids);
				ergebnis.listeKalt = await versuche("session-list-kalt", sessionListe, ids);
				ergebnis.promptOhneLaden = await versuche("prompt-kalter-eltern", () => tor(alt, kindId, "Nach Neustart ohne Laden [[SLOW]]"), ids);
				const llmVor = zaehlerLlm(alt);
				ergebnis.laden = await versuche("eltern-laden", async () => { const a = await ladeUeberLookup(alt); return k8(a.agent?.id ?? a.id); }, ids);
				for (let i = 0; i < 5; i++) { await warte(1000); const n = ctx.agents.get(alt); const g = n ? ctx.goals.get(n) : null; log("ziel-verlauf", { phase: g?.phase, akt: g?.activation, runden: g?.roundsStarted, status: String(n?.status), llmEltern: zaehlerLlm(alt) - llmVor }); }
				const n = ctx.agents.get(alt);
				ergebnis.zielNachLaden = kurz(n ? ctx.goals.get(n) : null, 300);
				try { ergebnis.elternEreignisseNachLaden = n.session.snapshotEvents(0).map((e) => e.type).slice(-14); } catch (e) { ergebnis.elternEreignisseNachLaden = String(e).slice(0, 100); }
				ergebnis.torNachLaden = await versuche("tor-prompt-nach-laden", () => tor(alt, kindId, "Nach Neustart und Laden [[SLOW]]"), ids);
				await warte(2500);
			}
			if (SZENARIO === "oeffnen") {
				const kindId = await kindStarten(eltern, "Start [[SLOW]]"); ids.kind = kindId;
				await warte(4000);
				await handle.dispose(); await warte(500);
				const adresse = { kind: "subagent", parentSessionId: elternId, childSessionId: kindId, mode: "continuable" };
				const seite = () => ctx.typertGateway.invoke({ namespace: "session", method: "page", args: { request: { address: adresse, throughSeq: -1 } } });
				ergebnis.seiteOhneHaken = await versuche("page-ohne-haken", async () => { const r = await seite(); return { records: (r?.records ?? r?.value?.records ?? []).length }; }, ids);
				ergebnis.elternLebtNachSeiteOhneHaken = ctx.agents.get(elternId) !== undefined;
				const sc = ctx.sessionController;
				const original = sc.page;
				sc.page = async function (request, signal) {
					const a = request?.address;
					if (a?.kind === "subagent" && ctx.agents.get(a.parentSessionId) === undefined) {
						haken.push({ ms: Date.now() - t0, art: "haken-laedt-beim-oeffnen", eltern: k8(a.parentSessionId) });
						try { await ladeUeberLookup(a.parentSessionId); haken.push({ art: "haken-geladen", lebt: ctx.agents.get(a.parentSessionId) !== undefined }); } catch (e) { haken.push({ art: "haken-fehler", code: e?.code, f: kurz(e?.message ?? e, 200) }); }
					}
					return Reflect.apply(original, this, [request, signal]);
				};
				const vor = verfuegbar.length;
				ergebnis.seiteMitHaken = await versuche("page-mit-haken", async () => { const r = await seite(); return { records: (r?.records ?? r?.value?.records ?? []).length }; }, ids);
				await warte(800);
				ergebnis.elternLebtNachSeiteMitHaken = ctx.agents.get(elternId) !== undefined;
				ergebnis.ereignisseNachOeffnen = verfuegbar.slice(vor);
				ergebnis.listeNachOeffnen = await versuche("session-list-nach-oeffnen", sessionListe, ids);
				ergebnis.promptDanachOhneHakenAmPrompt = await versuche("prompt-danach", () => tor(elternId, kindId, "Nach Öffnen [[SLOW]]"), ids);
				await warte(2500);
				sc.page = original;
			}
			if (SZENARIO === "oeffnen2") {
				const kindId = await kindStarten(eltern, "Start [[SLOW]]"); ids.kind = kindId;
				await warte(4000);
				await handle.dispose(); await warte(500);
				const adresse = (e, k) => ({ kind: "subagent", parentSessionId: e, childSessionId: k, mode: "continuable" });
				const sc = ctx.sessionController;
				const haken = [];
				const ladeFuerOeffnen = async (a) => {
					if (a?.kind !== "subagent" || ctx.agents.get(a.parentSessionId) !== undefined) return;
					haken.push({ art: "laedt", eltern: k8(a.parentSessionId) });
					try { await ladeUeberLookup(a.parentSessionId); haken.push({ art: "geladen", lebt: ctx.agents.get(a.parentSessionId) !== undefined }); } catch (e) { haken.push({ art: "fehler-geschluckt", code: e?.code, f: kurz(e?.message ?? e, 160) }); }
				};
				const origFollow = sc.follow;
				sc.follow = async function* (request, signal) { await ladeFuerOeffnen(request?.address); yield* Reflect.apply(origFollow, this, [request, signal]); };
				const ersterRahmen = async (adr) => { const ab = new AbortController(); const it = ctx.typertGateway; const stream = await it.openStream?.({ namespace: "session", method: "follow", args: { request: { address: adr, assistantStream: true } }, signal: ab.signal }); return stream ? "stream-offen" : "kein openStream"; };
				// direkt über den Dienst (nicht über das Gateway), weil der Gateway-Strom einen Träger braucht
				const ersterRahmenDienst = async (adr) => { const ab = new AbortController(); const g = sc.follow({ address: adr, assistantStream: true }, ab.signal); const r = await g.next(); ab.abort(); try { await g.return?.(); } catch {} return r?.value?.type ?? "kein-rahmen"; };
				ergebnis.followMitHaken = await versuche("follow-mit-haken", () => ersterRahmenDienst(adresse(elternId, kindId)), ids);
				ergebnis.elternLebtNachFollow = ctx.agents.get(elternId) !== undefined;
				ergebnis.hakenFollow = haken.splice(0);
				// (2) Elternteil mit zerstörter Datei
				await ctx.agents.get(elternId)?.session && 0;
				const eltern2 = `eltern-defekt-${Date.now()}`;
				const h2 = await ctx.agents.create({ sessionId: eltern2, meta: { cwd: B }, agentOptions: modell });
				const kind2 = await kindStarten(h2.agent, "Start [[SLOW]]"); await warte(3500);
				await h2.dispose(); await warte(500);
				const dateien = readdirSync(`${process.env.PROBE_HEIM}/sessions`, { recursive: true }).filter((p) => String(p).includes(eltern2) && String(p).endsWith(".zstd"));
				ergebnis.defektDateien = dateien;
				for (const d of dateien) writeFileSync(`${process.env.PROBE_HEIM}/sessions/${d}`, "kaputt-kaputt-kaputt");
				ergebnis.defektFollow = await versuche("follow-defekter-eltern", () => ersterRahmenDienst(adresse(eltern2, kind2)), ids);
				ergebnis.hakenDefekt = haken.splice(0);
				ergebnis.defektElternLebt = ctx.agents.get(eltern2) !== undefined;
				ergebnis.defektPrompt = await versuche("prompt-defekter-eltern", () => prompt(eltern2, kind2, "x [[SLOW]]"), ids);
				// (3) Elternteil, den es nicht gibt
				ergebnis.fremdFollow = await versuche("follow-eltern-ohne-datei", () => ersterRahmenDienst(adresse("gibt-es-nicht", kindId)), ids);
				ergebnis.hakenFremd = haken.splice(0);
				sc.follow = origFollow;
			}
			if (SZENARIO === "oeffnen3") {
				const kindId = await kindStarten(eltern, "Start [[SLOW]]"); ids.kind = kindId;
				await warte(4000);
				await handle.dispose(); await warte(500);
				const adresse = { kind: "subagent", parentSessionId: elternId, childSessionId: kindId, mode: "continuable" };
				const sc = ctx.sessionController;
				const original = sc.page;
				const imFlug = new Set();
				sc.page = async function (request, signal) {
					const a = request?.address;
					if (a?.kind === "subagent" && ctx.agents.get(a.parentSessionId) === undefined && !imFlug.has(a.parentSessionId)) {
						imFlug.add(a.parentSessionId);
						daten.hakenStart = Date.now() - t0;
						ladeUeberLookup(a.parentSessionId).then(() => { daten.hakenFertig = Date.now() - t0; }, (e) => { daten.hakenFehler = kurz(e?.message ?? e, 160); }).finally(() => imFlug.delete(a.parentSessionId));
					}
					return Reflect.apply(original, this, [request, signal]);
				};
				const daten = {};
				const vor = verfuegbar.length;
				const t1 = Date.now();
				ergebnis.seite = await versuche("page-hintergrund-haken", async () => { const r = await ctx.typertGateway.invoke({ namespace: "session", method: "page", args: { request: { address: adresse, throughSeq: -1 } } }); return { records: (r?.records ?? r?.value?.records ?? []).length, dauerMs: Date.now() - t1 }; }, ids);
				ergebnis.sofortNachPage = { elternLebt: ctx.agents.get(elternId) !== undefined };
				await warte(800);
				ergebnis.spaeter = { elternLebt: ctx.agents.get(elternId) !== undefined, daten, ereignisse: verfuegbar.slice(vor) };
				ergebnis.llmNachHaken = zustand(ids);
				sc.page = original;
			}
			if (SZENARIO === "post") {
				const kindId = await kindStarten(eltern, "Lang [[LONG]]"); ids.kind = kindId;
				await warte(400);
				await handle.dispose(); log("eltern-abgebaut-waehrend-kind-laeuft");
				await warte(6000); // Kind ist fertig (3 s) und konnte den Elternteil nicht benachrichtigen
				ergebnis.nachKindEnde = zustand(ids);
				const llmVor = zaehlerLlm(elternId);
				ergebnis.laden = await versuche("eltern-laden", async () => { const a = await ladeUeberLookup(elternId); return k8(a.agent?.id ?? a.id); }, ids);
				await warte(4000);
				ergebnis.nachLaden = zustand(ids);
				ergebnis.elternModellaufrufeSeitLaden = zaehlerLlm(elternId) - llmVor;
				const neu = ctx.agents.get(elternId);
				try { ergebnis.elternEreignisse = neu.session.snapshotEvents(0).map((e) => ({ t: e.type, v: kurz(e.data?.message?.content ?? e.data?.source, 100) })).slice(-12); } catch (e) { ergebnis.elternEreignisse = String(e).slice(0, 100); }
			}

			if (SZENARIO === "kette" || SZENARIO === "kette-kontrolle") {
				// Großeltern (lebend, bleiben es) -> Mitte (selbst ein Kind) -> Enkel. Mitte und Enkel werden abgebaut (enden von selbst).
				const gp = eltern;
				const mitteId = await kindStarten(gp, "Mitte [[LONG]]", "Mitte"); ids.mitte = mitteId;
				await warte(500);
				const mitte = ctx.agents.get(mitteId);
				if (!mitte) throw new Error("Mitte nicht lebendig");
				const enkelId = await kindStarten(mitte, "Enkel [[SLOW]]", "Enkel"); ids.enkel = enkelId;
				await warte(8000);
				ergebnis.lebendVorTest = { gp: ctx.agents.get(elternId) !== undefined, mitte: ctx.agents.get(mitteId) !== undefined, enkel: ctx.agents.get(enkelId) !== undefined };
				ergebnis.nachStart = zustand(ids);
				ergebnis.mitteKopf = (() => { try { return null; } catch { return null; } })();
				if (SZENARIO === "kette-kontrolle") {
					// Kontrolle: Großeltern schreiben die kalte Mitte an, ohne dass vorher irgendetwas direkt geladen wurde (Kernweg coldResume)
					ergebnis.gpTorMitteKontrolle = await versuche("gp-schreibt-mitte-an-ohne-vorheriges-laden", () => prompt(elternId, mitteId, "Mensch an Mitte [[SLOW]]"), ids);
					await warte(2500);
				}
				if (SZENARIO === "kette") ergebnis.promptEnkelOhneLaden = await versuche("prompt-enkel-mitte-kalt", () => prompt(mitteId, enkelId, "Mensch an Enkel 1 [[SLOW]]"), ids);
				if (SZENARIO === "kette") ergebnis.mitteUeberLookup = await versuche("mitte-ueber-lookup", async () => { const a = await ladeUeberLookup(mitteId); return k8(a.agent?.id ?? a.id ?? "?"); }, ids);
				ergebnis.mitteLebtNachLookup = ctx.agents.get(mitteId) !== undefined;
				if (SZENARIO === "kette" && !ergebnis.mitteLebtNachLookup) {
					ergebnis.mitteDirekt = await versuche("mitte-direkt-mit-gp-als-eigentuemer", async () => { const a = await ladeDirekt(mitteId, gp); return { id: k8(a.id), eigentuemerGp: ctx.agents.isOwnedBy(a.id, gp) }; }, ids);
					await warte(1500);
					ergebnis.promptEnkelNachDirekt = await versuche("prompt-enkel-nach-direkt-laden", () => prompt(mitteId, enkelId, "Mensch an Enkel 2 [[SLOW]]"), ids);
					await warte(2500);
				}
				if (SZENARIO === "kette") ergebnis.gpTorMitte = await versuche("gp-schreibt-mitte-an", () => prompt(elternId, mitteId, "Mensch an Mitte [[SLOW]]"), ids);
				await warte(2500);
			}
			ergebnis.ende = zustand(ids);
			ergebnis.haken = haken;
			ergebnis.verfuegbarEreignisse = verfuegbar;
			ergebnis.llmLog = llmZeilen().map((z) => ({ ...z, zeit: z.zeit - t0, sitzung: z.sitzung.slice(-8) }));
		} catch (fehler) { ergebnis.fehler = String(fehler?.stack ?? fehler).slice(0, 1500); }
		ergebnis.protokoll = protokoll;
		writeFileSync(AUSGABE, JSON.stringify(ergebnis, null, 1));
		process.exit(ergebnis.fehler ? 2 : 0);
	})();
}
