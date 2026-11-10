/**
 * Wegwerf-Messetreiber U-a3 (Nachbesserung, 2026-11-10). Kein Teil des Plugins; laeuft nur in der Probe-Instanz.
 * Misst fuer den Plan team_stand Unteragenten (Red-Team-Zweitpruefung N3):
 *   Liefert ctx.subagents.listChildren(...) auf einem ABGEBAUTEN TEAMMITGLIED (echt, per agentTeams.spawnTeammate)
 *   noch seine Kinder, einen leeren Katalog, oder wirft es? Traversiert listDescendants(lead) darunter hindurch?
 *   Der fruehere Lauf ua_treiber.mjs mass dasselbe nur fuer ein totes UNTERAGENTEN-Zwischeneltern (startContinuable);
 *   diese Datei ersetzt das Zwischeneltern durch ein echtes Teammitglied. Weckrufzaehler pro Sitzungskennung.
 */
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

export const name = "probe-ua3";
export const inject = ["agents", "subagents", "goals", "agentTeams"];

const B = "/tmp/teams_plus_umbau/probe";
const AUSGABE = process.env.PROBE_AUSGABE || (B + "/ua3_ergebnis.json");
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
			leadId = "lead-ua3-" + Date.now();
			const angelegt = await ctx.agents.create({ sessionId: leadId, meta: { cwd: B }, agentOptions: { provider: "probe", model: "m" } });
			const lead = angelegt.agent;

			// 1. Echtes Teammitglied (nicht via delegate_task, sondern ueber denselben Kernweg wie spawn_teammate).
			const m = await ctx.agentTeams.spawnTeammate(lead, {
				name: "exp3", description: "UA3 zwischenmitglied", prompt: [{ type: "text", text: "Hallo. [[SLOW]]" }],
				context: "fresh", provider: "spawn", agentOptions: { provider: "probe", model: "m" }, signal: new AbortController().signal
			});
			const expId = String(m.member.id);
			log("teammitglied", { id: expId.slice(-6), status: m.member.status });

			// 2. Nach dem ersten kurzen Turn ist das Mitglied abgebaut (M5b). Fuer Kinder muss es LEBENDIG sein:
			//    eine lange Nachricht weckt es; dieselbe Lehre wie in stand4_treiber.mjs.
			ctx.subagents.prompt({ requestId: randomUUID(), parentSessionId: lead.id, childSessionId: expId, mode: "continuable", delivery: "queue", content: [{ type: "text", text: "Weck [[LONG]]" }] }, new AbortController().signal).catch((fehler) => log("weck-fehler", { grund: String(fehler?.message ?? fehler).slice(0, 250) }));
			let exp = ctx.agents.get(expId);
			for (let i = 0; i < 40 && exp === undefined; i += 1) { await warte(250); exp = ctx.agents.get(expId); }
			log("exp-lebendig-fuer-kinder", { lebt: exp !== undefined, ms: Date.now() - t0 });
			if (exp === undefined) { writeFileSync(AUSGABE, JSON.stringify({ fehler: "exp nicht lebendig nach spawn", protokoll }, null, 1)); process.exit(2); }

			// 3. Zwei Kinder unter dem Teammitglied, ueber dieselbe Route wie delegate_task.
			const kinderVonExp = [];
			for (const teil of ["kindA", "kindB"]) {
				const elterLebendig = ctx.agents.get(expId);
				if (elterLebendig === undefined) { log("exp-tot-vor-kind-anlegen-" + teil, {}); continue; }
				const sid = randomUUID();
				try {
					await ctx.subagents.startContinuable({
						provider: "spawn", label: "UA3 exp " + teil, childId: sid,
						request: { label: "UA3 exp " + teil, prompt: [{ type: "text", text: "start [[LONG]]" }], parent: elterLebendig },
						signal: new AbortController().signal
					});
					kinderVonExp.push(sid);
				} catch (fehler) { log("kind-fehler-" + teil, { grund: kuerzText(fehler && (fehler.message || fehler), 250) }); }
			}

			// 4. Warten, bis das Teammitglied abgebaut ist, und bis dahin auch die Kinder.
			const statusExpNachWartenTot = await waetBisTot(expId, 30000); log("exp-status-tot", Object.assign({ id: expId.slice(-6) }, statusExpNachWartenTot));
			const kinderStatusListe = [];
			for (const sid of kinderVonExp) { const st = await waetBisTot(sid, 9000); kinderStatusListe.push(Object.assign({ kind: String(sid).slice(-6) }, st)); }

			// 5. Katalog eines TOTEN Teammitglieds lesen. Fenster fuer Weckrufzaehler um jeden einzelnen Lesevorgang.
			const fensterVorKatalog = schnappZaehler(); const uhrKatalog = Date.now();
			let kinderAusKatalogEinesTotenMitglieds = null; let keysDerErstenZeileExp = [];
			try {
				const liste = await ctx.subagents.listChildren(expId);
				keysDerErstenZeileExp = Object.keys(liste.length > 0 ? liste[0] : {});
				kinderAusKatalogEinesTotenMitglieds = liste.map((eintrag) => Object.assign({}, eintrag, { id: String(eintrag.id).slice(-6), label: kuerzText(eintrag.label, 80) }));
			} catch (fehler) { kinderAusKatalogEinesTotenMitglieds = { fehler: kuerzText(fehler && (fehler.message || fehler), 250) }; }
			const dauerMsKataloglesen = Date.now() - uhrKatalog; const fensterNachKatalogLesen = fensterDifferenz(fensterVorKatalog, schnappZaehler());

			// 6. listDescendants(lead) durch das tote Mitglied hindurch.
			const fensterVorBaum = schnappZaehler(); const uhrBaum = Date.now();
			let baumNachTot = null; let keysErsteZeileBaum = [];
			try {
				const b = await ctx.subagents.listDescendants(lead.id);
				keysErsteZeileBaum = Object.keys(b.length > 0 ? b[0] : {});
				baumNachTot = b.map((eintrag) => ({
					id: String(eintrag.id).slice(-6), kind: eintrag.kind, depth: eintrag.depth,
					elternFeldnameAusDemKernVorhanden: "parentId" in eintrag ? "ja" : ("parent" in eintrag ? "parent" : "keins"),
					wertDesElternfeldes: eintrag.parentId !== undefined ? String(eintrag.parentId).slice(-6) : (eintrag.parent !== undefined ? String(eintrag.parent).slice(-6) : null),
					mode: eintrag.mode, activity: eintrag.activity, label: kuerzText(eintrag.label, 80)
				}));
			} catch (fehler) { baumNachTot = { fehler: kuerzText(fehler && (fehler.message || fehler), 250) }; }
			const dauerMsBaumLesen = Date.now() - uhrBaum; const fensterNachBaumLesen = fensterDifferenz(fensterVorBaum, schnappZaehler());

			// 7. Ziel des toten Mitglieds aus der Datei (dasselbe Muster wie T2b, nur fuer ein echtes Mitglied).
			const fensterVorZielDatei = schnappZaehler(); const uhrZielDatei = Date.now(); let zielExpAusDerDateiNachTot = null;
			try {
				const abfrage = typeof ctx.get === "function" ? ctx.get("sessionQuery") : undefined;
				if (abfrage === undefined) throw new Error("sessionQuery-Dienst nicht erreichbar ueber ctx.get");
				const beob = await abfrage.observeSession(expId, {});
				const p = (beob && beob.projections && beob.projections.values) ? beob.projections.values.goal : undefined;
				const info = { lebtAgentGeradeBeiDerLesung: ctx.agents.get(expId) !== undefined };
				if (p === undefined) info.keineZielProjektionVorhanden = true;
				else { info.keysAufDerProjektionEbene1 = Object.keys(p); const inner = p.goal || {}; info.phaseInDerInnerenZielObjekt = inner.phase !== undefined ? String(inner.phase) : null; }
				if (beob !== undefined && typeof beob[Symbol.dispose] === "function") beob[Symbol.dispose]();
				else if (beob !== undefined && typeof beob.close === "function") beob.close();
				zielExpAusDerDateiNachTot = info;
			} catch (fehler) { zielExpAusDerDateiNachTot = { fehler: kuerzText(fehler && (fehler.message || fehler), 250) }; }
			const dauerMsZielDateiLesen = Date.now() - uhrZielDatei; const fensterNachZielDateiLesen = fensterDifferenz(fensterVorZielDatei, schnappZaehler());

			const alleIdsFuerStatusAmEnde = [expId].concat(kinderVonExp);
			const statusGanzAmEnde = alleIdsFuerStatusAmEnde.map((sid) => ({ id: String(sid).slice(-6), statusJetzt: lebendigStatus(sid) }));

			writeFileSync(AUSGABE, JSON.stringify({
				szenario: "ua3-2026-11-10",
				leadIdKurz: leadId.slice(-8),
				expIdKurz: expId.slice(-6), kinderVonExpIds: kinderVonExp.map((sid) => String(sid).slice(-6)),
				statusExpNachWartenTot: statusExpNachWartenTot, kinderStatusListe: kinderStatusListe,
				Ua3KatalogToterZwischenelternAusSpawnTeammate: { dauerMs: dauerMsKataloglesen, keysDerErstenZeileExp: keysDerErstenZeileExp, kinderAnzahl: Array.isArray(kinderAusKatalogEinesTotenMitglieds) ? kinderAusKatalogEinesTotenMitglieds.length : "fehler", kinder: kinderAusKatalogEinesTotenMitglieds, fensterVorherNachher: fensterNachKatalogLesen },
				Ua3BaumUnterTotemMitglied: { dauerMs: dauerMsBaumLesen, keysErsteZeileBaum: keysErsteZeileBaum, baumEintragZeilen: Array.isArray(baumNachTot) ? baumNachTot.map((z) => ({ id: z.id, kind: z.kind, depth: z.depth, elternFeldname: z.elternFeldnameAusDemKernVorhanden, parentWert: z.wertDesElternfeldes, mode: z.mode, activity: z.activity })) : baumNachTot, fensterVorherNachher: fensterNachBaumLesen },
				Ua3ZielTotesMitgliedAusDerDatei: { dauerMsZielDateiLesen: dauerMsZielDateiLesen, zielExpAusDerDateiNachTot: zielExpAusDerDateiNachTot, fensterVorherNachher: fensterNachZielDateiLesen },
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
