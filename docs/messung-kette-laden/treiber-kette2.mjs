/**
 * Wegwerf-Treiber der Probe "Kette laden", Fassung 2 (kein Teil des Plugins). Nachfolger von treiber-kette.mjs nach dem
 * Pruefbericht: agentOptions wie coldResume, Halten des Zwischenkinds ueber holdOwnership, Tiefe 3, Oeffnen-Haken,
 * Anzeige-Luege, Mitglied als Zwischenkind. Aufruf ueber probe-kette.sh mit TREIBER=treiber-kette2.mjs.
 *
 * PROBE_SZENARIO:  k1-<typ>  (Phase 1: Kette anlegen, fertig werden lassen, Prozess HART beenden)
 *                  k2-<typ>-<variante>  (Phase 2: Neustart auf denselben Sitzungsdateien; alles kalt)
 * typ:       u   L -> M (Unteragent) -> G          d3  L -> M1 -> M2 -> G (Tiefe 3)
 *            t   L -> M (Mitglied "exp") -> G      tB  wie t, plus unzugestellte Team-Nachricht von L an M im Journal
 * variante:  kosten         L laden, M mit agentOptions aus dem Descriptor anlegen (wie coldResume), sofort prompt(M->G)
 *            kosten-leer    wie kosten, aber agentOptions {} (Fehlerbild des Pruefberichts B3)
 *            halten         L laden, M anlegen + holdOwnership(M, G); 6 s beobachten; prompt(M->G); Freigeber
 *            tiefe3         (typ d3) wie halten, zwei Ebenen
 *            oeffnen        Prototyp Haken B: sessionController.page umwickelt, baut Kette im Hintergrund und haelt
 *            luege          Prototyp Anzeige: sessionController.listState.list umwickelt; ohne und mit Prototyp Haken A
 *            parallel       zwei gleichzeitige materialize(M)
 *            mitglied       (typ t/tB) L laden, Kette bauen und halten
 * PROBE_MODUS ist hier immer "ohne" (der gebaute Patch existiert nicht; die Prototypen stehen in dieser Datei).
 */
import { writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { foldSubagentDescriptor } from "@deepseek-ai/dsh-subagent";

export const name = "probe-treiber-kette2";
export const inject = ["agents", "subagents", "agentTeams", "sessions", "typertGateway", "typert", "sessionQuery", "sessionController"];

const B = process.env.PROBE_ORDNER ?? "/tmp/teams_plus_kette/arbeit";
const AUSGABE = process.env.PROBE_AUSGABE ?? `${B}/ergebnis.json`;
const LLM_LOG = process.env.PROBE_LLM_LOG ?? `${B}/llm-aufrufe.log`;
const HEIM = process.env.PROBE_HEIM;
const SZENARIO = process.env.PROBE_SZENARIO ?? "k1-u";
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const kurz = (x, n = 300) => { try { return (typeof x === "string" ? x : JSON.stringify(x)).slice(0, n); } catch { return String(x).slice(0, n); } };
const modell = { provider: "probe", model: "m" };
const llmZeilen = () => { try { return readFileSync(LLM_LOG, "utf8").split("\n").filter(Boolean).map((z) => JSON.parse(z)); } catch { return []; } };

/** Liest die Ereignisse einer Sitzung von der Platte (zstd) und fasst zusammen, was der Pruefbericht B6 verlangt. */
function platte(sitzungsId) {
	try {
		const dateien = readdirSync(`${HEIM}/sessions`, { recursive: true }).map(String).filter((p) => p.includes(sitzungsId) && p.endsWith(".zstd"));
		const aus = { dateien: dateien.length, ereignisse: 0, userOhneRpcId: 0, userMitRpcId: 0, teamNachricht: 0, teamQueued: 0, teamDelivered: 0, turnEndFehler: [], turnEnd: 0 };
		for (const d of dateien) {
			const exe = existsSync("/Users/tmielsch/anaconda3/bin/zstd") ? "/Users/tmielsch/anaconda3/bin/zstd" : "zstd";
			const text = execFileSync(exe, ["-dc", `${HEIM}/sessions/${d}`], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
			for (const zeile of text.split("\n").filter(Boolean)) {
				let e; try { e = JSON.parse(zeile); } catch { continue; }
				const t = e.type ?? e.event?.type; const daten = e.data ?? e.event?.data; aus.ereignisse += 1;
				if (t === "user/message") {
					const q = daten?.source;
					if (q?.kind === "user") { if (q.rpcId === undefined) aus.userOhneRpcId += 1; else aus.userMitRpcId += 1; }
					if (q?.kind === "team-message") aus.teamNachricht += 1;
				}
				if (t === "team/message/queued") aus.teamQueued += 1;
				if (t === "team/message/delivered") aus.teamDelivered += 1;
				if (t === "turn/end") { aus.turnEnd += 1; if (daten?.reason?.kind === "error") aus.turnEndFehler.push(kurz(daten?.reason, 220)); }
			}
		}
		return aus;
	} catch (e) { return { fehler: String(e?.message ?? e).slice(0, 200) }; }
}

export function apply(ctx) {
	const t0 = Date.now();
	const protokoll = [];
	const log = (art, d = {}) => { protokoll.push({ ms: Date.now() - t0, art, ...d }); if (process.env.PROBE_STDERR) console.error("[probe]", art, JSON.stringify(d).slice(0, 200)); };
	const k8 = (id) => String(id).slice(-8);
	const statusVerlauf = []; const erzeugt = []; const abgebaut = []; const verfuegbar = [];
	ctx.on("agent/status", ({ agent, status }) => { statusVerlauf.push({ ms: Date.now() - t0, id: k8(agent.id), status: String(status) }); });
	ctx.on("agent/created", ({ agent, source }) => { erzeugt.push({ ms: Date.now() - t0, id: k8(agent.id), source }); });
	ctx.on("agent/disposed", ({ agent }) => { abgebaut.push({ ms: Date.now() - t0, id: k8(agent.id) }); });
	ctx.on("api-session/added", (z) => { verfuegbar.push({ ms: Date.now() - t0, id: k8(z.sessionId), agentAvailable: z.agentAvailable }); });
	const zaehlerLlm = (id) => llmZeilen().filter((z) => z.sitzung.endsWith(k8(id))).length;
	const [, typ, variante] = SZENARIO.match(/^k[12]-(u|d3|tB|t)(?:-(.+))?$/) ?? [];
	const phase = SZENARIO.startsWith("k1") ? 1 : 2;
	const idsDatei = `${B}/kette2-ids-${typ}.json`;
	const adresse = (e, k) => ({ kind: "subagent", parentSessionId: e, childSessionId: k, mode: "continuable" });
	const direkt = (elternId, kindId, text) => ctx.subagents.prompt({ requestId: randomUUID(), parentSessionId: elternId, childSessionId: kindId, mode: "continuable", delivery: "queue", content: [{ type: "text", text }] }, new AbortController().signal);
	const tor = (elternId, kindId, text) => ctx.typertGateway.invoke({ namespace: "subagents", method: "prompt", args: { request: { requestId: randomUUID(), parentSessionId: elternId, childSessionId: kindId, mode: "continuable", delivery: "queue", content: [{ type: "text", text }] } } });
	const seite = (e, k) => ctx.typertGateway.invoke({ namespace: "session", method: "page", args: { request: { address: adresse(e, k), throughSeq: -1 } } });
	const liste = async (ids) => { const r = await ctx.typertGateway.invoke({ namespace: "session", method: "list", args: { _request: {} } }); const z = Array.isArray(r) ? r : (r?.items ?? r?.value?.items ?? []); return Object.fromEntries(z.filter((i) => Object.values(ids).includes(i.sessionId)).map((i) => [k8(i.sessionId), i.agentAvailable])); };
	const kindStarten = async (elternAgent, text, etikett) => { const id = randomUUID(); await ctx.subagents.startContinuable({ provider: "spawn", label: etikett, childId: id, request: { label: etikett, prompt: [{ type: "text", text }], parent: elternAgent }, signal: new AbortController().signal }); return id; };
	const ladeUeberLookup = async (id) => { const a = ctx.typert.lookups.get("agent"); if (a === undefined) throw new Error("Lookup agent fehlt"); return a.resolve(id); };
	const versuche = async (was, f) => {
		const tA = Date.now();
		try { const r = await f(); log(was, { ok: true }); return { ok: true, dauerMs: Date.now() - tA, r: kurz(r, 200) }; }
		catch (e) { log(was, { ok: false, code: e?.code }); return { ok: false, dauerMs: Date.now() - tA, code: e?.code, fehler: kurz(e?.message ?? e, 400) }; }
	};

	// ------------------------------------------------------------------------------------------------
	// Prototyp der Kettenbildung (so wuerde der Patch es tun). Eigenschaften der Eingabe, keine einzelne Sitzung beim Namen.
	// ------------------------------------------------------------------------------------------------
	const kopf = async (id) => {
		const b = await ctx.sessionQuery.observeSession(id, { signal: new AbortController().signal });
		try {
			const h = b.header;
			const d = h.origin === "subagent" ? foldSubagentDescriptor(b.events.slice(b.inheritedEventCount)) : undefined;
			return { origin: h.origin, parent: h.parentSession, d };
		} finally { b[Symbol.dispose]?.(); }
	};
	const optionenAus = (d) => ({
		...(d.agentProvider !== undefined ? { provider: d.agentProvider } : {}),
		...(d.agentModel !== undefined ? { model: d.agentModel } : {}),
		...(d.agentReasoningEffort !== undefined ? { reasoningEffort: d.agentReasoningEffort } : {})
	});
	/**
	 * Baut die Kette der kalten Vorfahren von `elternId` (dem Elternteil von `zielId`) von oben nach unten und haelt das
	 * unterste Zwischenkind ueber holdOwnership(Zwischenkind, naechstesKind). Wirft nie; gibt Protokoll und Freigeber zurueck.
	 */
	const baueKette = async (zielId, elternId, { halten = true, leereOptionen = false } = {}) => {
		const tA = Date.now();
		const aus = { pfad: [], schritte: [], freigeber: [], fehler: [] };
		try {
			const pfad = []; let id = elternId;
			while (ctx.agents.get(id) === undefined) {
				const k = await kopf(id);
				if (k.origin !== "subagent") { pfad.push({ id, wurzel: true }); break; }
				pfad.push({ id, k }); id = k.parent;
			}
			pfad.reverse();
			aus.pfad = pfad.map((p) => ({ id: k8(p.id), wurzel: p.wurzel === true }));
			for (const [i, p] of pfad.entries()) {
				const naechstes = i + 1 < pfad.length ? pfad[i + 1].id : zielId;
				if (p.wurzel) { await ladeUeberLookup(p.id); aus.schritte.push(`wurzel-geladen ${k8(p.id)}`); continue; }
				const eltern = ctx.agents.get(p.k.parent);
				if (eltern === undefined) { aus.fehler.push(`eltern-fehlt ${k8(p.k.parent)}`); break; }
				try {
					const akt = await ctx.subagents.continuations.activations.materialize({ childId: p.id, provider: p.k.d.provider, parent: eltern, agentOptions: leereOptionen ? {} : optionenAus(p.k.d), composition: { persona: p.k.d.persona, toolFilter: p.k.d.toolFilter }, signal: new AbortController().signal });
					if (halten) aus.freigeber.push(ctx.subagents.continuations.activations.holdOwnership(akt.handle.agent, naechstes));
					aus.schritte.push(`angelegt ${k8(p.id)}${halten ? " gehalten" : ""}`);
				} catch (e) {
					const text = String(e?.message ?? e);
					if (ctx.agents.get(p.id) !== undefined && /already owned|already exists/.test(text)) aus.schritte.push(`bereits-vorhanden ${k8(p.id)}`);
					else { aus.fehler.push(`${k8(p.id)}: ${kurz(text, 160)}`); break; }
				}
			}
		} catch (e) { aus.fehler.push(kurz(e?.message ?? e, 200)); }
		aus.dauerMs = Date.now() - tA;
		return aus;
	};
	const freigeben = (kette) => { for (const f of [...kette.freigeber].reverse()) { try { f(); } catch (e) { log("freigeber-fehler", { f: kurz(e?.message ?? e, 100) }); } } kette.freigeber.length = 0; };

	const zustand = (ids) => {
		const aus = { ms: Date.now() - t0, llmGesamt: llmZeilen().length };
		for (const [n, id] of Object.entries(ids)) {
			const a = ctx.agents.get(id);
			aus[n] = { lebt: a !== undefined, status: a ? String(a.status) : null, llm: zaehlerLlm(id), zuege: statusVerlauf.filter((s) => s.id === k8(id) && s.status === "running").length };
		}
		return aus;
	};

	(async () => {
		const ergebnis = { szenario: SZENARIO, typ, variante, phase };
		try {
			await warte(1200);
			if (phase === 1) {
				const leadId = `kette2-lead-${typ}-${Date.now()}`;
				const lead = (await ctx.agents.create({ sessionId: leadId, meta: { cwd: B }, agentOptions: modell })).agent;
				let mitteId;
				if (typ === "u" || typ === "d3") mitteId = await kindStarten(lead, "Mitte [[LONG]]", "Mitte");
				else mitteId = (await ctx.agentTeams.spawnTeammate(lead, { name: "exp", description: "Probe-Mitte", prompt: [{ type: "text", text: "Mitte [[LONG]]" }], context: "fresh", provider: "spawn", agentOptions: modell, signal: new AbortController().signal })).member.id;
				await warte(500);
				const mitte = ctx.agents.get(mitteId);
				if (!mitte) throw new Error("Mitte nicht lebendig");
				let mitte2Id; let elternDesEnkels = mitte;
				if (typ === "d3") { mitte2Id = await kindStarten(mitte, "Mitte2 [[LONG]]", "Mitte2"); await warte(300); elternDesEnkels = ctx.agents.get(mitte2Id); if (!elternDesEnkels) throw new Error("Mitte2 nicht lebendig"); }
				const enkelId = await kindStarten(elternDesEnkels, "Enkel [[SLOW]]", "Enkel");
				log("kette-angelegt", { lead: k8(leadId), mitte: k8(mitteId), mitte2: mitte2Id ? k8(mitte2Id) : null, enkel: k8(enkelId) });
				await warte(11000);
				ergebnis.lebendNachAbschluss = Object.fromEntries(Object.entries({ lead: leadId, mitte: mitteId, mitte2: mitte2Id, enkel: enkelId }).filter(([, v]) => v).map(([n, v]) => [n, ctx.agents.get(v) !== undefined]));
				if (typ === "tB") {
					const nachricht = { id: `team-message-${randomUUID()}`, senderId: leadId, senderName: "lead", targetId: mitteId, content: [{ type: "text", text: "Auftrag vom Lead an die Mitte (unzugestellt)" }] };
					lead.session.append("team/message/queued", { version: 2, teamId: leadId, message: nachricht });
				}
				await ctx.sessions.flush(lead.session);
				writeFileSync(idsDatei, JSON.stringify({ leadId, mitteId, mitte2Id, enkelId }));
				ergebnis.protokoll = protokoll; ergebnis.statusVerlauf = statusVerlauf;
				writeFileSync(AUSGABE, JSON.stringify(ergebnis, null, 1));
				process.kill(process.pid, "SIGKILL");
				return;
			}
			// ---------------------------------- Phase 2 ----------------------------------
			const { leadId, mitteId, mitte2Id, enkelId } = JSON.parse(readFileSync(idsDatei, "utf8"));
			const ids = { lead: leadId, mitte: mitteId, ...(mitte2Id ? { mitte2: mitte2Id } : {}), enkel: enkelId };
			const elternG = mitte2Id ?? mitteId; // Elternteil des Enkels
			const messen = (marke) => { ergebnis[marke] = zustand(ids); };
			const ladeLead = () => versuche("lead-laden", async () => { const a = await ladeUeberLookup(leadId); return k8(a.agent?.id ?? a.id ?? "?"); });
			ergebnis.kuerzel = Object.fromEntries(Object.entries(ids).map(([n, v]) => [n, k8(v)]));
			messen("beimStart");

			if (variante === "kosten" || variante === "kosten-leer") {
				ergebnis.ladeLead = await ladeLead();
				const kette = await baueKette(enkelId, elternG, { halten: false, leereOptionen: variante === "kosten-leer" });
				ergebnis.kette = kette;
				ergebnis.promptEnkel = await versuche("prompt-mitte-an-enkel", () => direkt(elternG, enkelId, "Mensch an Enkel [[SLOW]]"));
				messen("direktNachPromptEnkel");
				await warte(400); messen("nach400ms"); await warte(4600); messen("nach5s"); await warte(6000); messen("nach11s");
				ergebnis.plattenM = platte(mitteId); ergebnis.plattenG = platte(enkelId);
			}
			if (variante === "halten" || variante === "tiefe3") {
				ergebnis.ladeLead = await ladeLead();
				const kette = await baueKette(enkelId, elternG, { halten: true });
				ergebnis.kette = { pfad: kette.pfad, schritte: kette.schritte, fehler: kette.fehler, dauerMs: kette.dauerMs };
				ergebnis.lebensdauer = [];
				for (let s = 0; s <= 6; s++) { if (s > 0) await warte(1000); ergebnis.lebensdauer.push({ s, lebt: Object.fromEntries(Object.entries(ids).map(([n, v]) => [n, ctx.agents.get(v) !== undefined])), llm: llmZeilen().length, liste: await liste(ids) }); }
				messen("nach6s");
				ergebnis.promptEnkel = await versuche("prompt-an-enkel-nach-6s", () => direkt(elternG, enkelId, "Mensch an Enkel [[SLOW]]"));
				await warte(400); messen("nachPrompt400ms"); await warte(4600); messen("nachPrompt5s");
				ergebnis.listeVorFreigabe = await liste(ids);
				freigeben(kette);
				await warte(1500); messen("nachFreigabe1500ms");
				ergebnis.listeNachFreigabe = await liste(ids);
				ergebnis.plattenM = platte(mitteId);
			}
			if (variante === "halten-ohne-prompt") {
				ergebnis.ladeLead = await ladeLead();
				const kette = await baueKette(enkelId, elternG, { halten: true });
				await warte(3000); messen("nach3s"); ergebnis.listeGehalten = await liste(ids);
				freigeben(kette);
				await warte(1500); messen("nachFreigabe1500ms"); ergebnis.listeNachFreigabe = await liste(ids);
				ergebnis.plattenM = platte(mitteId);
			}
			if (variante === "oeffnen") {
				const sc = ctx.sessionController; const orig = sc.page; let kette; let fertig;
				sc.page = function (anfrage, signal) { const a = anfrage?.address; if (a?.kind === "subagent") { fertig = baueKette(a.childSessionId, a.parentSessionId, { halten: true }).then((k) => { kette = k; }); } return Reflect.apply(orig, this, [anfrage, signal]); };
				ergebnis.oeffnen = await versuche("oeffnen-page", () => seite(elternG, enkelId));
				messen("direktNachOeffnen");
				await fertig; ergebnis.kette = { pfad: kette.pfad, schritte: kette.schritte, fehler: kette.fehler, dauerMs: kette.dauerMs };
				await warte(1500); messen("nach1500ms"); ergebnis.listeNachOeffnen = await liste(ids);
				await warte(3000); messen("nach4500ms");
				ergebnis.promptEnkelNachOeffnen = await versuche("prompt-ohne-haken-a-nach-oeffnen", () => tor(elternG, enkelId, "Mensch an Enkel [[SLOW]]"));
				await warte(400); messen("nachPrompt400ms"); await warte(4600); messen("nachPrompt5s");
				freigeben(kette); await warte(1500); messen("nachFreigabe1500ms"); sc.page = orig;
				ergebnis.plattenM = platte(mitteId);
			}
			if (variante === "luege") {
				const lst = ctx.sessionController.listState; const origListe = lst.list;
				lst.list = async function (signal) {
					const items = await Reflect.apply(origListe, this, [signal]);
					const byId = new Map(items.map((i) => [i.sessionId, i]));
					const kinderVon = new Map(); for (const i of items) if (i.origin === "subagent" && i.parentSessionId) kinderVon.set(i.parentSessionId, (kinderVon.get(i.parentSessionId) ?? 0) + 1);
					const weckbar = (i, tiefe = 0) => { if (tiefe > 16) return false; if (i.agentAvailable) return true; if (!kinderVon.has(i.sessionId)) return false; if (i.origin !== "subagent") return true; const p = byId.get(i.parentSessionId); return p !== undefined && weckbar(p, tiefe + 1); };
					return items.map((i) => (!i.agentAvailable && weckbar(i) ? { ...i, agentAvailable: true } : i));
				};
				ergebnis.listeMitLuege = await liste(ids);
				ergebnis.ohneHakenA = await versuche("tor-ohne-haken-a", () => tor(elternG, enkelId, "Mensch an Enkel, ohne Haken A [[SLOW]]"));
				messen("nachOhneHakenA");
				// Prototyp Haken A
				const origPrompt = ctx.subagents.prompt;
				ctx.subagents.prompt = async function (anfrage, signal) { if (ctx.agents.get(anfrage.parentSessionId) === undefined) { const k = await baueKette(anfrage.childSessionId, anfrage.parentSessionId, { halten: false }); ergebnis.hakenAKette = { schritte: k.schritte, fehler: k.fehler, dauerMs: k.dauerMs }; } return Reflect.apply(origPrompt, this, [anfrage, signal]); };
				ergebnis.mitHakenA = await versuche("tor-mit-haken-a", () => tor(elternG, enkelId, "Mensch an Enkel, mit Haken A [[SLOW]]"));
				messen("direktNachMitHakenA");
				await warte(400); messen("nach400ms"); await warte(4600); messen("nach5s");
				ctx.subagents.prompt = origPrompt; lst.list = origListe;
			}
			if (variante === "folgen") {
				// Prototyp Haken B an follow: Kette bauen und HALTEN, solange der Strom offen ist; Freigabe bei Abbruch des Signals.
				const sc = ctx.sessionController; const orig = sc.follow; let kette; let fertig;
				sc.follow = function (anfrage, signal) {
					const a = anfrage?.address;
					if (a?.kind === "subagent") {
						fertig = baueKette(a.childSessionId, a.parentSessionId, { halten: true }).then((k) => { kette = k; signal?.addEventListener("abort", () => { freigeben(k); log("freigabe-bei-abort"); }, { once: true }); });
					}
					return Reflect.apply(orig, this, [anfrage, signal]);
				};
				const ac = new AbortController(); const rahmen = [];
				const strom = (async () => { try { for await (const r of sc.follow({ address: adresse(elternG, enkelId), cursor: -1 }, ac.signal)) { rahmen.push({ ms: Date.now() - t0, typ: r?.type }); } } catch (e) { rahmen.push({ fehler: kurz(e?.message ?? e, 120) }); } })();
				await warte(300); await fertig;
				ergebnis.kette = { pfad: kette.pfad, schritte: kette.schritte, fehler: kette.fehler, dauerMs: kette.dauerMs };
				ergebnis.lebensdauer = [];
				for (let i = 0; i <= 8; i++) { if (i > 0) await warte(1000); ergebnis.lebensdauer.push({ s: i, mitteLebt: ctx.agents.get(mitteId) !== undefined, llm: llmZeilen().length }); }
				messen("vorAbbruch"); ergebnis.listeVorAbbruch = await liste(ids);
				ac.abort(); await warte(1500); messen("nachAbbruch1500ms"); ergebnis.listeNachAbbruch = await liste(ids);
				ergebnis.rahmen = rahmen.slice(0, 5); sc.follow = orig;
			}
			if (variante === "luege2") {
				// Anzeige-Prototyp an der Quelle: summaryFor (Ereignisse api-session/added UND list) und summarizeCold (list) umwickelt.
				const lst = ctx.sessionController.listState; const origFuer = lst.summaryFor; const origKalt = lst.summarizeCold;
				const koepfe = new Map(); const hat = new Set();
				for (const r of await ctx.sessionQuery.listSessions()) { koepfe.set(r.header.id, { origin: r.header.origin, parent: r.header.parentSession }); if (r.header.parentSession) hat.add(r.header.parentSession); }
				const weckbar = (id, tiefe = 0) => { if (tiefe > 16) return false; const k = koepfe.get(id); if (k === undefined) return false; if (!hat.has(id)) return false; if (k.origin !== "subagent") return true; return ctx.agents.get(k.parent) !== undefined || weckbar(k.parent, tiefe + 1); };
				const luege = (z) => (!z.agentAvailable && weckbar(z.sessionId) ? { ...z, agentAvailable: true } : z);
				lst.summaryFor = function (sitzung) { return luege(Reflect.apply(origFuer, this, [sitzung])); };
				lst.summarizeCold = function (kopf) { return luege(Reflect.apply(origKalt, this, [kopf])); };
				ergebnis.listeMitLuege = await liste(ids);
				const kette = await baueKette(enkelId, elternG, { halten: true });
				await warte(500); ergebnis.listeGehalten = await liste(ids);
				freigeben(kette); await warte(1500);
				ergebnis.listeNachFreigabe = await liste(ids);
				ergebnis.lebtNachFreigabe = Object.fromEntries(Object.entries(ids).map(([n, v]) => [n, ctx.agents.get(v) !== undefined]));
				lst.summaryFor = origFuer; lst.summarizeCold = origKalt;
			}
			if (variante === "parallel") {
				ergebnis.ladeLead = await ladeLead();
				const k = await kopf(mitteId); const lead = ctx.agents.get(leadId);
				const eine = () => ctx.subagents.continuations.activations.materialize({ childId: mitteId, provider: k.d.provider, parent: lead, agentOptions: optionenAus(k.d), composition: { persona: k.d.persona, toolFilter: k.d.toolFilter }, signal: new AbortController().signal });
				const r = await Promise.allSettled([eine(), eine()]);
				ergebnis.parallel = r.map((x) => (x.status === "fulfilled" ? "ok" : kurz(x.reason?.message ?? x.reason, 200)));
				ergebnis.fehlercodes = r.map((x) => (x.status === "rejected" ? { code: x.reason?.code, name: x.reason?.name } : null));
				await warte(500); messen("nach500ms"); await warte(3000); messen("nach3500ms");
			}
			if (variante === "mitglied") {
				ergebnis.ladeLead = await ladeLead();
				messen("direktNachLeadLaden");
				const kette = await baueKette(enkelId, elternG, { halten: true });
				ergebnis.kette = { pfad: kette.pfad, schritte: kette.schritte, fehler: kette.fehler, dauerMs: kette.dauerMs };
				messen("direktNachKette"); await warte(400); messen("nach400ms"); await warte(4600); messen("nach5s");
				ergebnis.listeGehalten = await liste(ids);
				ergebnis.promptEnkel = await versuche("prompt-mitte-an-enkel", () => direkt(elternG, enkelId, "Mensch an Enkel [[SLOW]]"));
				await warte(400); messen("nachPrompt400ms"); await warte(4600); messen("nachPrompt5s");
				freigeben(kette); await warte(1500); messen("nachFreigabe1500ms");
				ergebnis.plattenM = platte(mitteId); ergebnis.plattenLead = platte(leadId);
			}
			ergebnis.llmLog = llmZeilen().map((z) => ({ ...z, zeit: z.zeit - t0, sitzung: z.sitzung.slice(-8) }));
		} catch (fehler) { ergebnis.fehler = String(fehler?.stack ?? fehler).slice(0, 1500); }
		ergebnis.verfuegbar = verfuegbar; ergebnis.statusVerlauf = statusVerlauf; ergebnis.erzeugt = erzeugt; ergebnis.abgebaut = abgebaut; ergebnis.protokoll = protokoll;
		writeFileSync(AUSGABE, JSON.stringify(ergebnis, null, 1));
		process.exit(ergebnis.fehler ? 2 : 0);
	})();
}
