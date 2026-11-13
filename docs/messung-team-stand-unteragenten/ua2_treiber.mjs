/**
 * Wegwerf-Messetreiber ua2 (Nachbesserung 2026-11-10, kein Plugin, laeuft nur in der Probe).
 * Misst den Rest von Red-Team-Befund 5: die Abnahme 2 verlangt jetzt „die letzte Phase, die
 * lebend in der Registry zu lesen war, ist gleich der Phase aus der Datei nach dem Abbau“,
 * und zwar an einem pausierten Kind. Der ua-Lauf hat zwar die Datei-Projektion „paused“
 * bekommen, aber nicht mehr die letzte LEBEND-Phase direkt vor dem Tod erfasst (das Kind war
 * bereits weg, als zu pollern begonnen wurde). Hier: Ziel anlegen, erst warten bis eine Runde
 * wirklich laeuft, dann pausieren, dann in einem dichten Poll-Fenster jede Aenderung von
 * Phase/Status mitzaehlen. Direkt nach dem Abbau dieselbe Ziel-Projektion aus der Datei lesen
 * und vergleichen. Zaehler fuer Wecken: Agent-Erneuerungen und laufende Zuege je Kennung, mit
 * Fenster um den Datei-Lesevorgang selbst.
 */
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

export const name = "probe-ua2";
export const inject = ["agents", "subagents", "goals"];

const B = "/tmp/teams_plus_umbau/probe";
const AUSGABE = process.env.PROBE_AUSGABE || B + "/ua2_ergebnis.json";
const warte = (ms) => new Promise((loesung) => setTimeout(loesung, ms));
/** Text fuer Log und JSON begrenzen; nie ein Objekt „[object Object]“ nennen. */
function kuerz(wert, grenze) {
	const limit = grenze || 400;
	try { return typeof wert === "string" ? wert.slice(0, limit) : JSON.stringify(wert).slice(0, limit); }
	catch { return String(wert).slice(0, limit); }
}

export function apply(ctx) {
	const t0 = Date.now();
	const protokoll = [];
	const log = (art, daten) => { protokoll.push(Object.assign({ ms: Date.now() - t0, art }, daten || {})); };
	let leadId = "";

	// Weckrufzaehler getrennt nach Sitzungskennung, damit ein laufender Zielbetrieb nicht als „ geweckt durchs Lesen“ gezaehlt wird.
	const neuErzeugt = [];
	ctx.on("agent/created", ({ agent }) => { const id = String(agent.id); if (id !== leadId) neuErzeugt.push(id.slice(-6)); });
	const zuegeProKennung = new Map();
	ctx.on("agent/status", ({ agent, status }) => {
		if (status !== "running") return;
		const id = String(agent.id);
		if (id === leadId) return;
		const k = id.slice(-6);
		zuegeProKennung.set(k, (zuegeProKennung.get(k) || 0) + 1);
	});
	const schnapp = () => ({ erzeuge: neuErzeugt.slice(), zuege: Array.from(zuegeProKennung) });
	function fensterDifferenz(alt, neu) {
		const neueAgenten = [];
		for (const id of neu.erzeuge) if (!alt.erzeuge.includes(id)) neueAgenten.push(id);
		const alteZuege = new Map(alt.zuege);
		const zugenommeneZuegeProKennung = neu.zuege
			.map((paar) => [paar[0], paar[1] - (alteZuege.get(paar[0]) || 0)])
			.filter((paar) => paar[1] > 0);
		return { neueAgenten: neueAgenten, zugenommeneZuegeProKennung: zugenommeneZuegeProKennung };
	}

	(async () => {
		try {
			await warte(1500);
			leadId = "lead-ua2-" + Date.now();
			const angelegt = await ctx.agents.create({ sessionId: leadId, meta: { cwd: B }, agentOptions: { provider: "probe", model: "m" } });
			const lead = angelegt.agent;

			const kindId = randomUUID();
			try {
				await ctx.subagents.startContinuable({
					provider: "spawn", label: "UA2 kindPause", childId: kindId,
					request: { label: "UA2 kindPause", prompt: [{ type: "text", text: "start [[LONG]]" }], parent: lead },
					signal: new AbortController().signal
				});
			} catch (fehler) { writeFileSync(AUSGABE, JSON.stringify({ fatalFehlerBeiKindanlage: kuerz((fehler && (fehler.message || fehler)), 300), protokoll }, null, 1)); process.exit(2); }
			await warte(1200);

			let agent = ctx.agents.get(kindId);
			if (agent === undefined) { writeFileSync(AUSGABE, JSON.stringify({ fatalFehlerKindNachStartNichtLebendig: true, protokoll }, null, 1)); process.exit(2); }

			let ziel = null;
			try { ziel = ctx.goals.create(agent, { objective: "Probe-Ziel ua2 [[LONG]]", maxGoalRounds: 30 }); log("ziel-angelegt", { id: String(ziel && ziel.id) }); }
			catch (fehler) { log("zielanlage-fehler", { grund: kuerz((fehler && (fehler.message || fehler)), 250) }); }

			// Auf eine echte laufende Runde warten, damit der Pause-Aufruf noch lebendige Zeitfenster hinterlaesst.
			let wartezeitAufRunningMs = 0;
			for (let schritt = 0; schritt < 240; schritt += 1) {
				agent = ctx.agents.get(kindId);
				if (agent !== undefined && agent.status === "running") break;
				await warte(50);
				wartezeitAufRunningMs += 50;
			}

			let vorPauseLesung = null;
			agent = ctx.agents.get(kindId);
			const pauseVorherStatus = agent === undefined ? "TOT" : String(agent.status || "?");
			if (agent !== undefined) { try { const g = ctx.goals.get(agent); vorPauseLesung = (g === undefined) ? null : { phase: String(g.phase || "?"), runden: g.roundsStarted, aktivierung: ("activation" in g) ? String(g.activation || "?") : "keins" }; } catch (fehler) { vorPauseLesung = { fehler: kuerz((fehler && (fehler.message || fehler)), 200) }; } }
			const pauseErgebnis = {};
			agent = ctx.agents.get(kindId);
			if (agent !== undefined && ziel !== null && typeof ziel === "object" && String(ziel.id || "").length > 0) {
				try { ctx.goals.pause(agent, { id: ziel.id, revision: ziel.revision }); pauseErgebnis.aufrufOhneWurf = true; }
				catch (fehler) { pauseErgebnis.wurf = kuerz((fehler && (fehler.message || fehler)), 250); }
			} else { pauseErgebnis.grund = "Agent oder Ziel fuer Pause nicht verfuegbar"; }

			// Dichtes Poll-Fenster: jede Aenderung von Status/Phase/Runden als Zeitstrich, bis das Kind weg ist.
			const pollingStartMs = Date.now();
			let letzteLiveVorTot = null;
			const zeitstrichNurAenderungen = [];
			let totGetroffenNachMs = null;
			while (Date.now() - pollingStartMs < 20000) {
				agent = ctx.agents.get(kindId);
				if (agent === undefined) { totGetroffenNachMs = Date.now() - pollingStartMs; break; }
				let g = null; try { g = ctx.goals.get(agent); } catch { g = null; }
				const zeile = { ms: Date.now() - t0, status: String(agent.status || "?"), phase: (g === undefined) ? null : String(g.phase || "?"), runden: (g === undefined) ? null : g.roundsStarted, aktivierung: (g === undefined) ? null : ("activation" in g) ? String(g.activation || "?") : "keins" };
				if (zeile.phase !== null) letzteLiveVorTot = { phase: zeile.phase, runden: zeile.runden, msWaelrendDieserLesung: zeile.ms, status: zeile.status, aktivierung: zeile.aktivierung };
				const letzte = zeitstrichNurAenderungen.length ? zeitstrichNurAenderungen[zeitstrichNurAenderungen.length - 1] : null;
				if (!letzte || letzte.phase !== zeile.phase || letzte.status !== zeile.status) zeitstrichNurAenderungen.push(zeile);
				await warte(40);
			}

			// Datei-Projektion nach dem Abbau, mit Fenster fuer die Weckrufzaehler.
			const fensterVorDatei = schnapp(); const uhrDatei = Date.now();
			let dateiNachTot = null; let dateiFehler = null;
			try {
				const abfrage = ctx.get("sessionQuery");
				if (abfrage === undefined) throw new Error("sessionQuery ueber ctx.get nicht da");
				const beob = await abfrage.observeSession(kindId, {});
				const p = (beob && beob.projections && beob.projections.values) ? beob.projections.values.goal : undefined;
				if (p === undefined) dateiNachTot = { keineZielProjektionVorhanden: true };
				else {
					const inner = p.goal || {};
					dateiNachTot = {
						phaseAusDerInnerenObjekt: (inner.phase !== undefined) ? String(inner.phase) : null,
						keysDesInneren: Object.keys(inner), keysDerProjektionsEbene: Object.keys(p),
						roundsStartedObereEbene: p.roundsStarted, roundImInneren: inner.roundsStarted,
						revisionInnneWort: inner.revision
					};
				}
				if (beob !== undefined && typeof beob[Symbol.dispose] === "function") beob[Symbol.dispose]();
			} catch (fehler) { dateiFehler = kuerz((fehler && (fehler.message || fehler)), 300); }
			const dauerMsDateilesen = Date.now() - uhrDatei;
			const fensterNachDatei = schnapp();

			let gleichePhaseWieVorTot = null;
			if (letzteLiveVorTot !== null && dateiNachTot !== null && typeof dateiNachTot === "object" && dateiNachTot.phaseAusDerInnerenObjekt !== undefined) {
				gleichePhaseWieVorTot = (letzteLiveVorTot.phase === dateiNachTot.phaseAusDerInnerenObjekt);
			}

			writeFileSync(AUSGABE, JSON.stringify({
				szenario: "ua2-2026-11-10", kindIdKurz: kindId.slice(-6), wartezeitAufRunningMs: wartezeitAufRunningMs,
				pauseVorherStatus, vorPauseLesung, pauseErgebnis, totGetroffenNachMs, letzteLiveVorTot,
				letzterZeitstrichNurAenderungen: zeitstrichNurAenderungen.slice(-10), dateiNachTot, dateiFehler,
				gleichePhaseWieVorTot, dauerMsDateilesen, fensterUmDasDateilesen: fensterDifferenz(fensterVorDatei, fensterNachDatei),
				protokoll
			}, null, 1));
			process.exit(0);
		} catch (fehler) {
			writeFileSync(AUSGABE, JSON.stringify({ fatalFehlerStack: String((fehler && (fehler.stack || fehler)) || fehler), protokoll }, null, 1));
			process.exit(2);
		}
	})();
}
