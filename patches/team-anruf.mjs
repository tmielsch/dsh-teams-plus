/**
 * team-anruf — das Verzeichnis der Gespräche zwischen zwei Abteilungen
 * ====================================================================
 *
 * WAS DER MENSCH WOLLTE (Anordnung 2026-11-04, Spec docs/TEAM-ARBEITSWEISE.md § 6a/6b)
 * „Es könnte eine Art Anrufdatenbank geben, wo Fork-IDs und Zusammenfassung und
 * Anruf-IDs usw. gespeichert sind, und Sessions so schnell in den Fachgesprächen
 * anderer suchen können. Evtl. kann man das auch indizieren, um Sessions die
 * Möglichkeit zu geben, von schon gelösten Problemen zu profitieren."
 *
 * Der Fork-Kanal aus § 6a läuft ohne diese Ablage. Aber jedes Gespräch beginnt
 * dann bei null — auch wenn dieselbe Frage vor drei Wochen schon beantwortet
 * wurde und die Antwort irgendwo in einer Sitzung liegt, die niemand mehr kennt.
 *
 * DIE ABLAGE
 *   ~/.dsh/.tm/teams-plus/state/anrufe.json
 *   { "version": 1, "naechsteId": 1, "eintraege": [ … ] }
 *
 * Sie liegt im Datenordner, nicht im Projekt: ein Anruf betrifft ZWEI
 * Abteilungen und gehört damit keiner von beiden.
 *
 * WAS EIN EINTRAG IST — ein Anruf, kein Gesprächsschritt
 *   id            anruf-<n>, fortlaufend, in der Datei geführt
 *   von / an      Sitzungs-Kennungen der beiden Abteilungsleiter
 *   thema         ein Satz, wonach man später sucht
 *   stand         offen | erledigt | abgebrochen
 *   begonnen      Zeitstempel (ms seit Epoche)
 *   forks         Fork-Kennungen beider Seiten, sobald bekannt
 *   zusammenfassung  das Ergebnis; leer, solange der Anruf offen ist
 *   stichworte    Liste für die Suche — ohne sie findet man nur, was man exakt benennt
 *
 * DIE EISERNE REGEL (§ 6b)
 * Ein Eintrag wird erst GESCHLOSSEN, wenn die Zusammenfassung vorliegt. Ein
 * offener Anruf bleibt als `stand: offen` sichtbar und stört damit. Ein stiller
 * offener Anruf wäre dasselbe Muster wie der Wecker, der nicht weckte: ein
 * Zustand, der verschwindet, statt sichtbar zu sein.
 *
 * DIE SUCHE IST DER PUNKT, NICHT DAS ANLEGEN
 * Ein Verzeichnis, das man nur befüllt und nie abfragt, ist eine Ablage, keine
 * Datenbank. `team_anrufe` durchsucht Thema, Zusammenfassung UND Stichworte —
 * gerade die Stichworte, weil man später nach Wörtern sucht, die im Thema nicht
 * stehen.
 *
 * WAS SIE AUSDRÜCKLICH NICHT TUT
 * - Sie hängt sich nicht in den Systemprompt. Sie ist eine Datei, die man liest;
 *   sie weckt niemanden und kostet keinen Turn.
 * - Sie schreibt nichts in die DSH-Installation. Deshalb ist sie ein B-Patch und
 *   braucht kein `teams-plus apply`.
 * - Kein Verlauf je Fassung: ein zweites `schliessen` überschreibt die
 *   Zusammenfassung. Ein Verlauf wäre eine zweite Wahrheit, und die Erfahrung
 *   dieses Repos sagt, dass zwei Wahrheiten irgendwann auseinanderlaufen. Wer
 *   den alten Text behalten will, schreibt ihn in den neuen.
 *
 * EINBAU
 * Eintrag in cordis.patch.yml (wie team-board), dann `dsh web` neu starten.
 * Rücknahme: den Eintrag entfernen, neu starten. Die Ablage bleibt liegen —
 * sie enthält Gespräche, die stattgefunden haben. Siehe docs/EINBAU-ANRUFDB.md.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { mitSperre } from "./send-to-session.mjs";

export const name = "team-anruf";

/** Der Name des Anruf-Werkzeugs; im Text der Beschreibung wiederverwendet. */
const WERKZEUG = "team_anruf";
const WERKZEUG_LISTE = "team_anrufe";

const STAENDE = ["offen", "erledigt", "abgebrochen"];

// ---------------------------------------------------------------------------
// Ablage: Pfad, Laden, Schreiben. Reine Funktionen, damit sie ohne DSH pruefbar
// sind.
// ---------------------------------------------------------------------------

/**
 * Das dsh-Zuhause. Dieselbe Aufloesung wie team-board.mjs und
 * send-to-session.mjs: `DSH_HOME=""` ist „nicht gesetzt", nicht „das
 * Arbeitsverzeichnis". Der leere Fall hat 2026-11-01 schon einmal relative
 * Pfade im Arbeitsordner erzeugt (Backlog A2).
 */
function dshHeim() {
	const gesetzt = process.env.DSH_HOME?.trim();
	return gesetzt === undefined || gesetzt === "" ? join(homedir(), ".dsh") : gesetzt;
}

/** Der Ort der Anrufe. Exportiert, damit der Test ihn pruefen kann. */
export function anrufPfad() {
	return join(dshHeim(), ".tm", "teams-plus", "state", "anrufe.json");
}

/** Eine leere Ablage. */
export function leereAblage() {
	return { version: 1, naechsteId: 1, eintraege: [] };
}

function istObjekt(wert) {
	return typeof wert === "object" && wert !== null && Array.isArray(wert) === false;
}

/**
 * Ob ein Wert ein brauchbarer Eintrag ist.
 *
 * Bewusst nachsichtig bei den Zusatzfeldern und streng bei id und stand: ein
 * kaputter Eintrag darf die anderen nicht mitreissen, aber er darf auch nicht
 * als heil gelten.
 */
export function istEintrag(wert) {
	if (istObjekt(wert) === false) return false;
	if (typeof wert.id !== "string" || wert.id.length === 0) return false;
	if (typeof wert.thema !== "string") return false;
	if (STAENDE.includes(wert.stand) === false) return false;
	return true;
}

/**
 * Die Ablage lesen.
 *
 * **Eine kaputte Datei wird LAUT geworfen, nicht als leer gelesen.** Ein stiller
 * leerer Zustand waere von „es ist noch nichts geschrieben" nicht zu
 * unterscheiden — und genau das macht Datenverlust unsichtbar. Dieselbe Lehre
 * wie `ladeBoard` in team-board.mjs.
 *
 * @throws {Error} wenn die Datei nicht lesbar ist oder keine Ablage enthaelt.
 */
export function ladeAblage(pfad = anrufPfad()) {
	if (existsSync(pfad) === false) return leereAblage();
	const roh = readFileSync(pfad, "utf8");
	let daten;
	try {
		daten = JSON.parse(roh);
	} catch (fehler) {
		throw new Error(
			`the call register ${pfad} is not readable as JSON (${fehler instanceof Error ? fehler.message : String(fehler)}) — it was NOT treated as empty`
		);
	}
	if (istObjekt(daten) === false || Array.isArray(daten.eintraege) === false) {
		throw new Error(
			`the call register ${pfad} does not hold a register (expected { eintraege: [...] }) — it was NOT treated as empty`
		);
	}
	const eintraege = daten.eintraege.filter(istEintrag);
	const naechsteId = Number.isSafeInteger(daten.naechsteId) && daten.naechsteId > 0 ? daten.naechsteId : 1;
	return { version: 1, naechsteId, eintraege };
}

/**
 * Die Ablage schreiben — atomar.
 *
 * Vorlaeufige Datei plus `renameSync`, dasselbe Muster wie `speichereBoard`.
 * Ein Abbruch mitten im Schreiben darf keine halbe Datei hinterlassen: eine
 * halbe JSON-Datei ist genau der Fall, den `ladeAblage` laut meldet.
 */
export function speichereAblage(ablage, pfad = anrufPfad()) {
	mkdirSync(dirname(pfad), { recursive: true });
	const vorlaeufig = `${pfad}.${process.pid}.tmp`;
	writeFileSync(vorlaeufig, `${JSON.stringify(ablage, null, "\t")}\n`);
	renameSync(vorlaeufig, pfad);
	return pfad;
}

// ---------------------------------------------------------------------------
// Die Regeln. Reine Funktionen ohne Dateisystem — damit der Test sie ohne
// Sperre und ohne Datei fuehren kann.
// ---------------------------------------------------------------------------

/** Kuerzt und prüft einen Text, der im Eintrag stehen soll. */
export function pruefeText(wert, feld, grenze = 400) {
	const getrimmt = typeof wert === "string" ? wert.trim() : "";
	if (getrimmt.length === 0) throw new Error(`${feld} is required and must not be empty`);
	if (getrimmt.length > grenze) throw new Error(`${feld} is longer than ${grenze} characters`);
	return getrimmt;
}

/** Eine Liste von Stichworten: getrimmt, ohne Leere, ohne Doppel, klein geschrieben. */
export function pruefeStichworte(wert) {
	if (wert === undefined || wert === null) return [];
	const roh = Array.isArray(wert) ? wert : String(wert).split(/[,;]+/u);
	const gesehen = new Set();
	for (const teil of roh) {
		const wort = typeof teil === "string" ? teil.trim().toLowerCase() : "";
		if (wort.length > 0 && wort.length <= 64) gesehen.add(wort);
	}
	return [...gesehen].sort();
}

/**
 * Einen Anruf anlegen. Reine Rechnung auf der Ablage; der Aufrufer schreibt.
 *
 * @returns {{ ablage: object, eintrag: object }} neue Ablage und der Eintrag.
 */
export function oeffneAnruf(ablage, { von, an, thema, stichworte, jetzt = Date.now() }) {
	const absender = pruefeText(von, "the calling session");
	const ziel = pruefeText(an, "the called session");
	if (absender === ziel) throw new Error("a call needs two different sessions; both were the same");
	const gegenstand = pruefeText(thema, "thema", 200);
	const id = `anruf-${ablage.naechsteId}`;
	const eintrag = {
		id,
		von: absender,
		an: ziel,
		thema: gegenstand,
		stand: "offen",
		begonnen: jetzt,
		forks: [],
		zusammenfassung: "",
		stichworte: pruefeStichworte(stichworte)
	};
	return {
		ablage: { ...ablage, naechsteId: ablage.naechsteId + 1, eintraege: [...ablage.eintraege, eintrag] },
		eintrag
	};
}

/** Einen Eintrag nach seiner Kennung suchen, ohne zu werfen. */
export function findeAnruf(ablage, id) {
	return ablage.eintraege.find((eintrag) => eintrag.id === id);
}

/**
 * Eine Fork-Kennung nachtragen. Doppelt genannt ist kein Fehler: dieselbe
 * Fork-Kennung zweimal ist „steht schon da", nicht „falsch".
 */
export function trageFork(ablage, id, fork) {
	const kennung = pruefeText(fork, "the fork id", 200);
	const eintrag = findeAnruf(ablage, id);
	if (eintrag === undefined) throw new Error(`no call with id ${JSON.stringify(id)}`);
	if (eintrag.forks.includes(kennung)) return { ablage, eintrag };
	const neu = { ...eintrag, forks: [...eintrag.forks, kennung] };
	return {
		ablage: { ...ablage, eintraege: ablage.eintraege.map((e) => (e.id === id ? neu : e)) },
		eintrag: neu
	};
}

/**
 * Einen Anruf schliessen. **Ohne Zusammenfassung ist das verboten** — das ist
 * die eiserne Regel aus § 6b.
 *
 * Ein zweites Schliessen ueberschreibt die Zusammenfassung. Kein Verlauf je
 * Fassung: zwei Wahrheiten laufen irgendwann auseinander (Modulkopf).
 */
export function schliesseAnruf(ablage, id, zusammenfassung, jetzt = Date.now()) {
	const text = pruefeText(zusammenfassung, "the summary of a closed call", 4000);
	const eintrag = findeAnruf(ablage, id);
	if (eintrag === undefined) throw new Error(`no call with id ${JSON.stringify(id)}`);
	const neu = { ...eintrag, stand: "erledigt", zusammenfassung: text, geschlossen: jetzt };
	return {
		ablage: { ...ablage, eintraege: ablage.eintraege.map((e) => (e.id === id ? neu : e)) },
		eintrag: neu
	};
}

/**
 * Die Suche. **Das ist der Zweck des ganzen Moduls.**
 *
 * Gesucht wird ueber `thema`, `zusammenfassung` UND `stichworte`. Die Stichworte
 * sind der Grund, warum man spaeter findet, was man nicht exakt benannt hat:
 * „Sperre", „Zeitstempel", „Reload" stehen selten im Themasatz.
 *
 * Ein leerer Suchbegriff liefert alles — „zeig mir, was verzeichnet ist" ist ein
 * sinnvoller Aufruf, kein Irrtum.
 *
 * @returns die passenden Eintraege, neueste zuerst.
 */
export function sucheAnrufe(ablage, suche) {
	const nadel = typeof suche === "string" ? suche.trim().toLowerCase() : "";
	const treffer = nadel.length === 0
		? [...ablage.eintraege]
		: ablage.eintraege.filter((eintrag) => {
			const heu = [eintrag.thema, eintrag.zusammenfassung, ...(eintrag.stichworte ?? [])]
				.map((wert) => String(wert ?? "").toLowerCase());
			return heu.some((teil) => teil.includes(nadel));
		});
	return treffer.sort((a, b) => (b.begonnen ?? 0) - (a.begonnen ?? 0));
}

/** Eine Zeile je Eintrag, wie sie `team_anrufe` zurueckgibt. */
export function alsZeile(eintrag) {
	return {
		id: eintrag.id,
		thema: eintrag.thema,
		stand: eintrag.stand,
		von: eintrag.von,
		an: eintrag.an,
		begonnen: eintrag.begonnen,
		forks: eintrag.forks ?? [],
		stichworte: eintrag.stichworte ?? []
	};
}

// ---------------------------------------------------------------------------
// Das Modul: Werkzeug registrieren.
// ---------------------------------------------------------------------------

export const inject = ["tools", "agents"];

/** Ein Kern-Baustein, einmal geladen. */
let werkzeugBaustein;
let nachrichtenBaustein;

async function ladeKern(paket) {
	try {
		return await import(paket);
	} catch {
		return undefined;
	}
}

export function apply(ctx) {
	ctx.effect(() => {
		let abgemeldet = false;
		let abRegister;

		(async () => {
			werkzeugBaustein ??= await ladeKern("@deepseek-ai/dsh-tools");
			nachrichtenBaustein ??= await ladeKern("@deepseek-ai/dsh-llm");
			if (abgemeldet) return;
			const defineTool = werkzeugBaustein?.defineTool;
			if (typeof defineTool !== "function") return;

			const jsonOutput = (schema) => ({
				schema,
				render: (_args, wert) => [{ type: "text", text: JSON.stringify(wert) }]
			});

			const abläufe = [
				defineTool({
					name: WERKZEUG,
					description: [
						"The register of conversations between two departments. One entry is one CALL, not one turn.",
						"",
						"WHY IT EXISTS: The fork channel (see `send_to_session`) runs without this register too — but every",
						"conversation then starts at zero, even when the same question was answered three weeks ago in a",
						"session nobody remembers. Write the call down when you open one; the summary when you close it.",
						"",
						"ACTIONS:",
						"`oeffnen` needs `an` (the other session id) and `thema` (one line, what it is about), plus optional",
						"`stichworte` — the words you would SEARCH for later, not the words of the topic. Returns the call id.",
						"`fork` carries a fork id into an open call (both sides, as they become known).",
						"`schliessen` needs `id` and `zusammenfassung`. THE IRON RULE: a call is closed only WITH a summary.",
						"  A call left open stays visible as `offen` and keeps bothering you — that is intended.",
						"`lesen` returns one call in full.",
						"",
						"SEARCH: use `team_anrufe` (see below). Looking is the point of this register, not filling it."
					].join("\n"),
					parameters: {
						aktion: {
							type: "string",
							required: true,
							enum: ["oeffnen", "fork", "schliessen", "lesen"],
							description: "What to do with the register."
						},
						id: { type: "string", description: "The call id, e.g. anruf-3. Required for fork, schliessen and lesen." },
						an: { type: "string", description: "For oeffnen: the called session id." },
						thema: { type: "string", description: "For oeffnen: one line on what the call is about (searchable)." },
						stichworte: {
							type: "array",
							description: "For oeffnen: words you would search for later. They do not have to appear in the topic."
						},
						fork: { type: "string", description: "For fork: the fork's session id." },
						zusammenfassung: { type: "string", description: "For schliessen: the outcome. Required — a call without one stays open." }
					},
					output: jsonOutput({
						type: "object",
						additionalProperties: false,
						properties: {
							ok: { type: "boolean", required: true },
							anruf: { type: "object" },
							note: { type: "string", required: true }
						}
					}),
					presentCall: (args) => ({
						card: "generic",
						title: `Call register: ${args.aktion}`,
						kind: args.aktion === "lesen" ? "read" : "other",
						rawInput: args.id ?? args.thema ?? ""
					}),
					isConcurrencySafe: () => false,
					execute: async (args, exec) => {
						const absender = exec?.agent?.id;
						if (typeof absender !== "string") return { ok: false, note: "no calling agent" };
						const pfad = anrufPfad();
						const aktion = args?.aktion;
						try {
							const ergebnis = await mitSperre(pfad, () => {
								const ablage = ladeAblage(pfad);
								if (aktion === "oeffnen") {
									const { ablage: neu, eintrag } = oeffneAnruf(ablage, {
										von: absender,
										an: args.an,
										thema: args.thema,
										stichworte: args.stichworte
									});
									speichereAblage(neu, pfad);
									return { ok: true, anruf: eintrag, note: `opened ${eintrag.id}; close it only with a summary` };
								}
								if (aktion === "fork") {
									const { ablage: neu, eintrag } = trageFork(ablage, args.id, args.fork);
									speichereAblage(neu, pfad);
									return { ok: true, anruf: eintrag, note: `fork noted on ${eintrag.id}` };
								}
								if (aktion === "schliessen") {
									const { ablage: neu, eintrag } = schliesseAnruf(ablage, args.id, args.zusammenfassung);
									speichereAblage(neu, pfad);
									return { ok: true, anruf: eintrag, note: `closed ${eintrag.id} with a summary` };
								}
								if (aktion === "lesen") {
									const eintrag = findeAnruf(ablage, args.id);
									if (eintrag === undefined) return { ok: false, note: `no call with id ${JSON.stringify(args.id)}` };
									return { ok: true, anruf: eintrag, note: `read ${eintrag.id}` };
								}
								return { ok: false, note: `unknown action ${JSON.stringify(aktion)}; use oeffnen, fork, schliessen or lesen` };
							});
							return ergebnis;
						} catch (fehler) {
							return { ok: false, note: fehler instanceof Error ? fehler.message : String(fehler) };
						}
					}
				}),
				defineTool({
					name: WERKZEUG_LISTE,
					description: [
						"Look into the call register: what did other departments already discuss with each other?",
						"",
						"THIS IS THE POINT OF THE REGISTER. Before you open a new call, look here — the answer may already",
						"be written down, and a call costs both sides a turn.",
						"",
						"Without `suche` you get every entry (id, topic, state, date). With `suche` it is a full-text search",
						"over topic, summary AND keywords — the keywords are why you find what you did not name exactly.",
						"",
						"Entries with state `offen` are calls that were never closed with a summary. They stay visible on",
						"purpose: a call without an outcome is not an outcome."
					].join("\n"),
					parameters: {
						suche: { type: "string", description: "Free text. Empty or omitted returns everything." },
						stand: {
							type: "string",
							enum: STAENDE,
							description: "Only entries in this state."
						}
					},
					output: jsonOutput({
						type: "object",
						additionalProperties: false,
						properties: {
							ok: { type: "boolean", required: true },
							anzahl: { type: "number" },
							eintraege: { type: "array" },
							note: { type: "string", required: true }
						}
					}),
					presentCall: (args) => ({
						card: "generic",
						title: "Call register",
						kind: "read",
						rawInput: args.suche ?? ""
					}),
					isConcurrencySafe: () => true,
					execute: async (args) => {
						const pfad = anrufPfad();
						try {
							const ablage = ladeAblage(pfad);
							let treffer = sucheAnrufe(ablage, args?.suche);
							if (typeof args?.stand === "string") treffer = treffer.filter((e) => e.stand === args.stand);
							const zeilen = treffer.map(alsZeile);
							return {
								ok: true,
								anzahl: zeilen.length,
								eintraege: zeilen,
								note: zeilen.length === 0
									? "the register holds no matching call"
									: `${zeilen.length} call(s); open ones have no summary yet`
							};
						} catch (fehler) {
							// Eine kaputte Ablage wird LAUT gemeldet, nicht als leer ausgegeben.
							return {
								ok: false,
								anzahl: 0,
								eintraege: [],
								note: `the register could not be read: ${fehler instanceof Error ? fehler.message : String(fehler)}`
							};
						}
					}
				})
			];

			abRegister = abläufe.map((definition) => ctx.tools.register(definition));
		})();

		return () => {
			abgemeldet = true;
			if (Array.isArray(abRegister)) for (const ab of abRegister) if (typeof ab === "function") ab();
			else if (typeof abRegister === "function") abRegister();
		};
	}, "team-anruf lifecycle");
}
