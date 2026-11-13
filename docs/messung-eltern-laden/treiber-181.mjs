/**
 * Wegwerf-Treiber der Probe zu Issue 181 (kein Teil des Plugins): löst das Laden eines kalten Team-Leads, der im
 * Team-Journal eine noch nicht zugestellte Nachricht hat, eine Modellrunde oder ein Wecken aus?
 * Szenarien (PROBE_SZENARIO), PROBE_MODUS = mit | ohne (Patch eltern-laden geladen oder nicht):
 *   team1-<lage>              Phase 1: echtes Team anlegen (Lead + Mitglied "exp" über agentTeams.spawnTeammate), Mitglied
 *                             wird fertig, dann die Lage herstellen und den Prozess HART beenden (SIGKILL, kein Abbau).
 *   team2-<lage>-<ausloeser>  Phase 2: Neustart auf denselben Sitzungsdateien (PROBE_BEHALTE=1), den Lead NICHT laden; Zähler;
 *                             Auslöser; Zähler direkt danach, nach 400 ms und nach 5 s; bei "ohne" zusätzlich explizites Laden.
 * Lagen:  A = unzugestellte Nachricht mit Ziel Lead (Absender exp), B = Ziel Mitglied exp (Absender Lead), C = keine Nachricht.
 * Auslöser: page (Öffnen des Kindes über das Gateway session/page), prompt (Anschreiben über das Gateway subagents/prompt).
 * Die unzugestellte Nachricht wird als Ereignis team/message/queued mit genau der Form aus
 * dsh-experimental-agent-team/lib/index.js (sendAdmitted, Zeilen 922 bis 940) in das Lead-Journal geschrieben und geflusht,
 * ohne zuzustellen: dasselbe Bild, das ein Absturz zwischen Anhängen und Zustellen hinterlässt.
 */
import { writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

export const name = "probe-treiber-181";
export const inject = ["agents", "subagents", "agentTeams", "sessions", "sessionProjections", "typertGateway", "typert", "sessionController"];

const B = process.env.PROBE_ORDNER ?? "/tmp/teams_plus_umbau/probe_eltern_bau";
const AUSGABE = process.env.PROBE_AUSGABE ?? `${B}/ergebnis181.json`;
const LLM_LOG = process.env.PROBE_LLM_LOG ?? `${B}/llm-aufrufe.log`;
const HEIM = process.env.PROBE_HEIM;
const SZENARIO = process.env.PROBE_SZENARIO ?? "team1-A";
const MODUS = process.env.PROBE_MODUS ?? "mit";
const PATCH_LOG = `${HEIM}/.tm/teams-plus/logs/eltern-laden.log`;
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const kurz = (x, n = 300) => { try { return (typeof x === "string" ? x : JSON.stringify(x)).slice(0, n); } catch { return String(x).slice(0, n); } };
const modell = { provider: "probe", model: "m" };
const llmZeilen = () => { try { return readFileSync(LLM_LOG, "utf8").split("\n").filter(Boolean).map((z) => JSON.parse(z)); } catch { return []; } };
const patchLog = () => { try { return readFileSync(PATCH_LOG, "utf8").split("\n").filter(Boolean).map((z) => z.replace(/^\S+ /, "")); } catch { return []; } };

/** Liest die Team-Ereignisse einer Sitzung direkt von der Platte (zstd-JSON-Zeilen), ohne die Sitzung zu laden. */
function plattenJournal(sitzungsId) {
	try { return plattenJournalRoh(sitzungsId); } catch (e) { return { fehler: String(e?.message ?? e).slice(0, 200) }; }
}
function plattenJournalRoh(sitzungsId) {
	const dateien = readdirSync(`${HEIM}/sessions`, { recursive: true }).map(String).filter((p) => p.includes(sitzungsId) && p.endsWith(".zstd"));
	const aus = { dateien: dateien.length, queued: [], delivered: [], quellen: [] };
	for (const d of dateien) {
		const text = execFileSync(existsSync("/Users/tmielsch/anaconda3/bin/zstd") ? "/Users/tmielsch/anaconda3/bin/zstd" : "zstd", ["-dc", `${HEIM}/sessions/${d}`], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8"); // mehrere Frames: nur das Kommandozeilenwerkzeug liest sie alle
		for (const zeile of text.split("\n").filter(Boolean)) {
			let e; try { e = JSON.parse(zeile); } catch { continue; }
			const t = e.type ?? e.event?.type; const daten = e.data ?? e.event?.data;
			if (t === "team/message/queued") aus.queued.push(daten?.message?.id);
			if (t === "team/message/delivered") aus.delivered.push(daten?.messageId);
			if (t === "user/message" && daten?.content?.[0]?.text?.startsWith("Team message ")) aus.quellen.push(daten.content[0].text.slice(13, 60));
			if (false && t === "user/message" && daten?.source?.kind === "team-message") aus.quellen.push(daten.source.messageId);
		}
	}
	return aus;
}

export function apply(ctx) {
	const t0 = Date.now();
	const protokoll = [];
	const log = (art, d = {}) => { protokoll.push({ ms: Date.now() - t0, art, ...d }); if (process.env.PROBE_STDERR) console.error("[probe]", art, JSON.stringify(d).slice(0, 200)); };
	const k8 = (id) => String(id).slice(-8);
	const statusVerlauf = [];
	const erzeugt = [];
	ctx.on("agent/status", ({ agent, status }) => { statusVerlauf.push({ ms: Date.now() - t0, id: k8(agent.id), status }); });
	ctx.on("agent/created", ({ agent, source }) => { erzeugt.push({ ms: Date.now() - t0, id: k8(agent.id), source }); });
	const zaehlerLlm = (id) => llmZeilen().filter((z) => id === undefined || z.sitzung.endsWith(k8(id))).length;
	const [, lage, ausloeser] = SZENARIO.match(/^team[12]-([ABC])(?:-(page|prompt))?$/) ?? [];
	const phase = SZENARIO.startsWith("team1") ? 1 : 2;
	const idsDatei = `${B}/team-ids-${lage}.json`;
	const adresse = (e, k) => ({ kind: "subagent", parentSessionId: e, childSessionId: k, mode: "continuable" });
	const seite = (e, k) => ctx.typertGateway.invoke({ namespace: "session", method: "page", args: { request: { address: adresse(e, k), throughSeq: -1 } } });
	const tor = (e, k, t) => ctx.typertGateway.invoke({ namespace: "subagents", method: "prompt", args: { request: { requestId: randomUUID(), parentSessionId: e, childSessionId: k, mode: "continuable", delivery: "queue", content: [{ type: "text", text: t }] } } });
	const versuche = async (was, f) => { try { const r = await f(); log(was, { ok: true }); return { ok: true, r: kurz(r, 200) }; } catch (e) { log(was, { ok: false, code: e?.code }); return { ok: false, code: e?.code, fehler: kurz(e?.message ?? e, 300) }; } };

	/** Zustand einer Sitzung aus Sicht des laufenden Prozesses. */
	const zustand = (leadId, expId) => {
		const lead = ctx.agents.get(leadId); const exp = ctx.agents.get(expId);
		let projektion;
		try { const p = lead ? ctx.sessionProjections.stateOf(lead.session, "agentTeam") : undefined; projektion = p ? { queued: p.messages.map((m) => m.id), delivered: [...p.delivered] } : null; } catch (e) { projektion = `fehler: ${kurz(e?.message ?? e, 100)}`; }
		return {
			leadLebt: lead !== undefined, expLebt: exp !== undefined,
			leadStatus: lead ? String(lead.status) : null, expStatus: exp ? String(exp.status) : null,
			llmGesamt: zaehlerLlm(), llmLead: zaehlerLlm(leadId), llmExp: zaehlerLlm(expId),
			projektion,
			leadEreignisse: (() => { try { return lead ? lead.session.snapshotEvents(0).map((e) => e.type + (e.data?.source?.kind ? `:${e.data.source.kind}` : "")).slice(-8) : null; } catch { return null; } })(),
			expEreignisse: (() => { try { return exp ? exp.session.snapshotEvents(0).map((e) => e.type + (e.data?.source?.kind ? `:${e.data.source.kind}` : "")).slice(-8) : null; } catch { return null; } })()
		};
	};

	(async () => {
		const ergebnis = { szenario: SZENARIO, modus: MODUS, lage, phase };
		try {
			await warte(1200);
			if (phase === 1) {
				const leadId = `lead181-${lage}-${Date.now()}`;
				const lead = (await ctx.agents.create({ sessionId: leadId, meta: { cwd: B }, agentOptions: modell })).agent;
				const mitglied = await ctx.agentTeams.spawnTeammate(lead, { name: "exp", description: "Probe-Experte", prompt: [{ type: "text", text: "Start [[SLOW]]" }], context: "fresh", provider: "spawn", agentOptions: modell, signal: new AbortController().signal });
				const expId = mitglied.member.id;
				log("team-angelegt", { lead: k8(leadId), exp: k8(expId) });
				await warte(3500);
				ergebnis.nachStart = zustand(leadId, expId);
				if (lage === "A" || lage === "B") {
					const nachricht = lage === "A"
						? { id: `team-message-${randomUUID()}`, senderId: expId, senderName: "exp", targetId: leadId, content: [{ type: "text", text: "Zwischenbericht vom Experten (unzugestellt, Lage A)" }] }
						: { id: `team-message-${randomUUID()}`, senderId: leadId, senderName: "lead", targetId: expId, content: [{ type: "text", text: "Auftrag vom Lead (unzugestellt, Lage B)" }] };
					lead.session.append("team/message/queued", { version: 2, teamId: leadId, message: nachricht });
					await ctx.sessions.flush(lead.session);
					ergebnis.nachricht = { id: nachricht.id, ziel: lage === "A" ? "lead" : "exp" };
					log("nachricht-gebucht-nicht-zugestellt", ergebnis.nachricht);
				}
				await ctx.sessions.flush(lead.session);
				ergebnis.vorHartemEnde = zustand(leadId, expId);
				ergebnis.platte = plattenJournal(leadId);
				writeFileSync(idsDatei, JSON.stringify({ leadId, expId, nachrichtId: ergebnis.nachricht?.id }));
				ergebnis.patchProtokoll = patchLog(); ergebnis.protokoll = protokoll;
				writeFileSync(AUSGABE, JSON.stringify(ergebnis, null, 1));
				process.kill(process.pid, "SIGKILL"); // hartes Ende wie ein Neustart: kein Abbau, keine Abschlussereignisse
				return;
			}
			// Phase 2
			const { leadId, expId, nachrichtId } = JSON.parse(readFileSync(idsDatei, "utf8"));
			ergebnis.nachrichtId = nachrichtId;
			ergebnis.plattePhase2Start = plattenJournal(leadId);
			ergebnis.beimStart = zustand(leadId, expId);
			const messen = async (marke) => { ergebnis[marke] = { ms: Date.now() - t0, ...zustand(leadId, expId) }; };
			const ausloesen = () => (ausloeser === "page" ? seite(leadId, expId) : tor(leadId, expId, "Mensch an Experte [[SLOW]]"));
			await messen("vorAusloeser");
			const tA = Date.now();
			ergebnis.ausloeser = await versuche(`ausloeser-${ausloeser}`, ausloesen);
			ergebnis.ausloeser.dauerMs = Date.now() - tA;
			await messen("direktDanach");
			await warte(400); await messen("nach400ms");
			await warte(4600); await messen("nach5s");
			ergebnis.patchProtokollNachAusloeser = patchLog();
			if (!ctx.agents.get(leadId)) {
				// Gegenprobe der Gegenprobe: dasselbe Laden, das der Kern für session.prompt selbst benutzt (Lookup agent), ohne den Patch.
				ergebnis.zusatzExplizitesLaden = await versuche("zusatz-explizit-laden", async () => { const a = await ctx.typert.lookups.get("agent").resolve(leadId); return k8(a.agent?.id ?? a.id); });
				await messen("zusatzDirektDanach"); await warte(400); await messen("zusatzNach400ms"); await warte(4600); await messen("zusatzNach5s");
			}
			ergebnis.platteEnde = plattenJournal(leadId);
			ergebnis.llmLog = llmZeilen().map((z) => ({ ...z, zeit: z.zeit - t0, sitzung: z.sitzung.slice(-8) })).filter((z) => z.zeit > -1e9);
		} catch (fehler) { ergebnis.fehler = String(fehler?.stack ?? fehler).slice(0, 1500); }
		ergebnis.statusVerlauf = statusVerlauf; ergebnis.erzeugt = erzeugt;
		ergebnis.patchProtokoll = patchLog();
		ergebnis.protokoll = protokoll;
		writeFileSync(AUSGABE, JSON.stringify(ergebnis, null, 1));
		process.exit(ergebnis.fehler ? 2 : 0);
	})();
}
