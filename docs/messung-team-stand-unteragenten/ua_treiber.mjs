/**
 * Wegwerf-Messetreiber U-a (Nachbesserung 2026-11-10). Kein Teil des Plugins; laeuft nur in der Probe-Instanz.
 * Misst fuer den Plan team_stand Unteragenten:
 *   U-a   Liefert ctx.subagents.listChildren(...) auf einem ABGEBAUTEN Zwischeneltern noch seine Kinder
 *         (Katalog ueberlebt), einen leeren Katalog, oder wirft es? Traversiert listDescendants(lead) weiter
 *         darunter hindurch, obwohl dieses Eltern nicht mehr lebt? Zaehlt alles pro Sitzungskennung.
 *   Vorbehalt Befund 5: Ein Kind wird pausiert (goals.pause). Wir lesen die Phase lebend aus der Registry,
 *         lassen es abgebaut werden und lesen dieselbe Projektion aus der Datei. Ist sie gleich?
 */
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

export const name = "probe-ua";
export const inject = ["agents", "subagents", "goals"];

const B = "/tmp/teams_plus_umbau/probe";
const AUSGABE = process.env.PROBE_AUSGABE || (B + "/ua_ergebnis.json");
const warte = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const kuerzText = (wert, grenze) => {
	const g = grenze || 450;
	try { return typeof wert === "string" ? wert.slice(0, g) : JSON.stringify(wert).slice(0, g); }
	catch { return String(wert).slice(0, g); }
};

export function apply(ctx) {
	const t0 = Date.now();
	const protokoll = [];
	const log = (art, d) => { protokoll.push(Object.assign({ ms: Date.now() - t0, art }, d || {})); };
	let leadId = "";

	// Weckrufzaehler nach Sitzungskennung. created heisst Agent wurde (neu) geladen; running heisst Runde laeuft gerade.
	const neuErzeugt = []; // array short ids
	ctx.on("agent/created", ({ agent }) => { const id = String(agent.id); if (id !== leadId) neuErzeugt.push(id.slice(-6)); });
	const zuegeProKennung = new Map();
	ctx.on("agent/status", ({ agent, status }) => {
		if (status !== "running") return;
		const id = String(agent.id);
		if (id === leadId) return;
		const k = id.slice(-6);
		zuegeProKennung.set(k, (zuegeProKennung.get(k) || 0) + 1);
	});

	const schnappZaehler = () => ({ erzeuge: neuErzeugt.slice(), zuege: Array.from(zuegeProKennung).map((paar) => [paar[0], paar[1]]) });
	const fensterDifferenz = (alt, neu) => {
		const dAgenten = [];
		for (const id of neu.erzeuge) if (!alt.erzeuge.includes(id)) dAgenten.push(id);
		const altMap = new Map(alt.zuege);
		const deltaZuege = neu.zuege
			.map((paar) => [paar[0], paar[1] - (altMap.get(paar[0]) || 0)])
			.filter((paar) => paar[1] > 0);
		return { neueAgentenImFenster: dAgenten, zugenommeneZuegeProKennung: deltaZuege };
	};

	const waetBisTot = async (sid, maxMs) => {
		const uhr = Date.now();
		while (Date.now() - uhr < maxMs) {
			if (ctx.agents.get(sid) === undefined) return { totNachMs: Date.now() - uhr };
			await warte(200);
		}
		return { bliebLebendigBisLimitMs: true, warteteBisMs: maxMs };
	};
	const lebendigStatus = (sid) => { const a = ctx.agents.get(sid); return a === undefined ? "TOT" : String(a.status || "?"); };

	(async () => {
		try {
			await warte(1500);
			leadId = "lead-ua-" + Date.now();
			const angelegt = await ctx.agents.create({ sessionId: leadId, meta: { cwd: B }, agentOptions: { provider: "probe", model: "m" } });
			const lead = angelegt.agent;

			const legeKind = async (label, promptText, elternAgent) => {
				const sid = randomUUID();
				try {
					await ctx.subagents.startContinuable({
						provider: "spawn", label: label, childId: sid,
						request: { label: label, prompt: [{ type: "text", text: promptText }], parent: elternAgent },
						signal: new AbortController().signal
					});
				} catch (fehler) { log("kind-fehler-" + String(label).slice(-16), { grund: kuerzText(fehler && (fehler.message || fehler), 250) }); }
				return sid;
			};

			// Zwischeneltern p1 mit zwei Kindern. Alle [[LONG]], damit der Elter beim Anlegen der Kinder noch lebt.
			const p1 = await legeKind("UA zwischeneltern", "start [[LONG]]", lead);
			log("p1-angelegt", { id: p1.slice(-6), statusDirektDanach: lebendigStatus(p1) });
			const kinderVonP1 = [];
			for (const teil of ["kindA", "kindB"]) {
				const elterLebendig = ctx.agents.get(p1);
				if (elterLebendig !== undefined) kinderVonP1.push(await legeKind("UA p1 " + teil, "start [[LONG]]", elterLebendig));
				else log("p1-tot-vor-kind-anlegen-" + teil, {});
			}

			// kind3 fuer den Pausen-Fall (Befund 5). Ziel mit vielen Runden; wird gleich pausiert.
			const kind3 = await legeKind("UA kind3 pause", "start [[LONG]]", lead);
			let ziel3 = null;
			{ const k = ctx.agents.get(kind3); if (k !== undefined) { try { ziel3 = ctx.goals.create(k, { objective: "Probe-Ziel zum pausieren [[LONG]]", maxGoalRounds: 60 }); } catch (fehler) { log("ziel3-fehler", { grund: kuerzText(fehler && (fehler.message || fehler), 250) }); } } else { log("kind3-tot-vor-zielanlage", {}); } }
			await warte(2400);

			const kind3AgentVorPause = ctx.agents.get(kind3);
			const vorDerPauseLesung = {};
			if (kind3AgentVorPause !== undefined && ziel3 !== null) {
				try {
					const g = ctx.goals.get(kind3AgentVorPause);
					vorDerPauseLesung.agentLebtVorPause = true;
					if (g !== undefined) {
						vorDerPauseLesung.phaseAusRegistryVorPause = String(g.phase || "");
						if ("activation" in g) vorDerPauseLesung.aktivierungAusRegistryVorPause = String(g.activation || "");
						else vorDerPauseLesung.keinAktivierungsfeldInGoalsGet = true;
					}
					ctx.goals.pause(kind3AgentVorPause, { id: ziel3.id, revision: ziel3.revision });
					vorDerPauseLesung.pauseAufriefOhneWurf = true;
				} catch (fehler) { vorDerPauseLesung.fehlerBeimPausierenOderAendern = kuerzText(fehler && (fehler.message || fehler), 250); }
			} else { vorDerPauseLesung.ausgesprochenesProblem = "Agent oder Ziel zum Pausieren nicht gefunden"; }
			await warte(1300);

			const statusP1NachWartenTot = await waetBisTot(p1, 24000); log("p1-status-tot", Object.assign({ id: p1.slice(-6) }, statusP1NachWartenTot));
			const kinderStatusListe = [];
			for (const sid of kinderVonP1) { const st = await waetBisTot(sid, 7000); kinderStatusListe.push(Object.assign({ kind: String(sid).slice(-6) }, st)); }

			let statusKind3WartenAufAbbaut = null;
			if (kind3AgentVorPause !== undefined && vorDerPauseLesung.agentLebtVorPause === true) { const s3 = await waetBisTot(kind3, 26000); log("kind3-status-tot", s3); statusKind3WartenAufAbbaut = s3; }
			else log("kind3-pausenfall-abgebrochen", {});

			// U-a: Katalog eines TOTEN Zwischeneltern lesen. Fenster fuer Weckrufzaehler um jeden einzelnen Lesevorgang.
			const fensterVorKatalog = schnappZaehler(); const uhrKatalog = Date.now();
			let kinderAusKatalogEinesTotenEltern = null; let keysDerErstenZeileP1 = [];
			try {
				const liste = await ctx.subagents.listChildren(p1);
				keysDerErstenZeileP1 = Object.keys(liste.length > 0 ? liste[0] : {});
				kinderAusKatalogEinesTotenEltern = liste.map((eintrag) => Object.assign({}, eintrag, { id: String(eintrag.id).slice(-6), label: kuerzText(eintrag.label, 80) }));
			} catch (fehler) { kinderAusKatalogEinesTotenEltern = { fehler: kuerzText(fehler && (fehler.message || fehler), 250) }; }
			const dauerMsKataloglesen = Date.now() - uhrKatalog; const fensterNachKatalogLesen = fensterDifferenz(fensterVorKatalog, schnappZaehler());

			// U-a: listDescendants(lead) unter einem toten Zwischeneltern durch.
			const fensterVorBaum = schnappZaehler(); const uhrBaum = Date.now();
			let baumNachTot = null; let keysErsteZeileBaum = [];
			try {
				const b = await ctx.subagents.listDescendants(lead.id);
				keysErsteZeileBaum = Object.keys(b.length > 0 ? b[0] : {});
				baumNachTot = b.map((eintrag) => ({
					id: String(eintrag.id).slice(-6),
					kind: eintrag.kind,
					depth: eintrag.depth,
					elternFeldnameAusDemKernVorhanden: "parentId" in eintrag ? "ja" : ("parent" in eintrag ? "parent" : "keins"),
					wertDesElternfeldes: eintrag.parentId !== undefined ? String(eintrag.parentId).slice(-6) : (eintrag.parent !== undefined ? String(eintrag.parent).slice(-6) : null),
					mode: eintrag.mode, activity: eintrag.activity, label: kuerzText(eintrag.label, 80)
				}));
			} catch (fehler) { baumNachTot = { fehler: kuerzText(fehler && (fehler.message || fehler), 250) }; }
			const dauerMsBaumLesen = Date.now() - uhrBaum; const fensterNachBaumLesen = fensterDifferenz(fensterVorBaum, schnappZaehler());

			// kind3-Ziel nach dem Abbau aus der Datei lesen und mit lebender Registry-Zeile vergleichen.
			const fensterVorZielDatei = schnappZaehler(); const uhrZielDatei = Date.now(); let kind3AusDerDateiNachTot = null;
			try {
				const abfrage = typeof ctx.get === "function" ? ctx.get("sessionQuery") : undefined;
				if (abfrage === undefined) throw new Error("sessionQuery-Dienst nicht erreichbar ueber ctx.get");
				const beob = await abfrage.observeSession(kind3, {});
				const p = (beob && beob.projections && beob.projections.values) ? beob.projections.values.goal : undefined;
				const info = { lebtAgentGeradeBeiDerLesung: ctx.agents.get(kind3) !== undefined };
				if (p === undefined) info.keineZielProjektionVorhanden = true; else {
					info.keysAufDerProjektionEbene1 = Object.keys(p);
					const inner = p.goal || {};
					info.phaseInDerInnerenZielObjekt = inner.phase !== undefined ? String(inner.phase) : null;
					info.aktivierungImInnerenVorhanden = "aktivierung" in inner || "activation" in inner;
					info.keysDesInnerenZielObjekts = Object.keys(inner);
					info.roundsStartedObereEbene = p.roundsStarted !== undefined ? String(p.roundsStarted) : null;
					info.roundsStartedImInneren = inner.roundsStarted !== undefined ? String(inner.roundsStarted) : null;
				}
				if (beob !== undefined && typeof beob[Symbol.dispose] === "function") beob[Symbol.dispose]();
				else if (beob !== undefined && typeof beob.close === "function") beob.close();
				kind3AusDerDateiNachTot = info;
			} catch (fehler) { kind3AusDerDateiNachTot = { fehler: kuerzText(fehler && (fehler.message || fehler), 250) }; }
			const dauerMsZielDateiLesen = Date.now() - uhrZielDatei; const fensterNachZielDateiLesen = fensterDifferenz(fensterVorZielDatei, schnappZaehler());

			const alleIdsFuerStatusAmEnde = [p1].concat(kinderVonP1).concat([kind3]);
			const statusGanzAmEnde = alleIdsFuerStatusAmEnde.map((sid) => ({ id: String(sid).slice(-6), statusJetzt: lebendigStatus(sid) }));

			writeFileSync(AUSGABE, JSON.stringify({
				szenario: "ua-2026-11-10",
				leadIdKurz: leadId.slice(-8),
				p1IdKurz: p1.slice(-6), kinderVonP1Ids: kinderVonP1.map((sid) => String(sid).slice(-6)), kind3IdKurz: kind3.slice(-6),
				vorDerPauseLesung: vorDerPauseLesung, statusKind3WartenAufAbbaut: statusKind3WartenAufAbbaut,
				statusP1NachWartenTot: statusP1NachWartenTot, kinderStatusListe: kinderStatusListe,
				UaKatalogToterZwischeneltern: { dauerMs: dauerMsKataloglesen, keysDerErstenZeileP1: keysDerErstenZeileP1, kinderAnzahl: Array.isArray(kinderAusKatalogEinesTotenEltern) ? kinderAusKatalogEinesTotenEltern.length : "fehler", kinder: kinderAusKatalogEinesTotenEltern, fensterVorherNachher: fensterNachKatalogLesen },
				UaBaumUnterTotenEltern: { dauerMs: dauerMsBaumLesen, keysErsteZeileBaum: keysErsteZeileBaum, baumEintragZeilen: Array.isArray(baumNachTot) ? baumNachTot.map((z) => ({ id: z.id, kind: z.kind, depth: z.depth, elternFeldname: z.elternFeldnameAusDemKernVorhanden, parentWert: z.wertDesElternfeldes, mode: z.mode, activity: z.activity })) : baumNachTot, fensterVorherNachher: fensterNachBaumLesen },
				Befund5PausiertVergleich: { dauerMsZielDateiLesen: dauerMsZielDateiLesen, kind3AusDerDateiNachTot: kind3AusDerDateiNachTot, fensterVorherNachherZielDateiLesen: fensterNachZielDateiLesen },
				statusGanzAmEnde: statusGanzAmEnde, protokoll: protokoll.slice(-70)
			}, null, 1));
			log("fertig", { ausgabe: AUSGABE });
			process.exit(0);
		} catch (fehler) {
			writeFileSync(AUSGABE, JSON.stringify({ fatalFehlerStack: String((fehler && (fehler.stack || fehler)) || fehler), protokoll: protokoll }, null, 1));
			process.exit(2);
		}
	})();
}
