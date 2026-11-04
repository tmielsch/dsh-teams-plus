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
 * DER KANAL RUHT (Entscheidung des Menschen 2026-11-04)
 * Ein Anruf muss NICHT geschlossen werden. Der Kanal bleibt dormant, bis er
 * wieder genutzt wird; niemand traegt einem offenen Anruf nach. In den Worten
 * des Menschen: „Anrufe muessen ja auch nicht geschlossen werden. Es ist
 * einfach nur so, dass man das auf beiden Seiten kann — eines der Modelle
 * entscheidet, eine Summary aus dem Fork an den Parent zurueckzuschicken. Aber
 * der Kanal bleibt halt einfach dormant, bis er wieder genutzt wird."
 *
 * Was bleibt: WENN einer schliesst, hat er eine Zusammenfassung. Ein Schliessen
 * ohne Text ist kein Ergebnis, sondern ein leeres Feld. Und die Zusammenfassung
 * kann von beiden Gespraechsteilnehmern kommen (`von` oder `an`), von niemandem
 * sonst — `istTeilnehmer` haelt das im Werkzeugpfad fest.
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

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
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

/** Der Protokollpfad. E1: unter `.tm/teams-plus`, nicht in `~/.dsh/logs`. */
export function protokollPfad() {
	return join(dshHeim(), ".tm", "teams-plus", "logs", "team-anruf.log");
}

/**
 * Eine Zeile ins Protokoll. Ein fehlendes Verzeichnis oder Recht darf nie werfen.
 *
 * WARUM ES DAS GIBT (Red-Team-Befund MITTEL-4, 2026-11-04): Ohne Protokoll
 * verschwand ein kaputter Eintrag beim naechsten Schreiben spurlos — niemand
 * konnte hinterher sagen, dass er je da war. `team-board.mjs` schreibt an
 * dieser Stelle `warn N malformed entries skipped`; diese Abweichung war im
 * Modulkopf nicht begruendet und ist hiermit aufgehoben.
 */
function protokolliere(text) {
	try {
		const pfad = protokollPfad();
		mkdirSync(dirname(pfad), { recursive: true });
		appendFileSync(pfad, `${new Date().toISOString()} ${text}\n`);
	} catch {
		/* Protokoll ist Beiwerk; es darf nie einen Anruf verhindern. */
	}
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
 * Einen heilen Eintrag so herrichten, dass er die Suche nicht umbringt.
 *
 * WARUM DAS NOETIG IST (Red-Team-Befund MITTEL-3, 2026-11-04, gemessen):
 * Ein Eintrag mit `stichworte: 42` liess `sucheAnrufe` mit „is not iterable"
 * werfen — die ganze Ablage war dann nicht mehr durchsuchbar, und die Antwort
 * sah wie „nichts gefunden" aus statt wie „kaputt". Ein `stichworte` als
 * Zeichenkette wurde in EINZELZEICHEN zerlegt: die Suche nach „sperre" fand
 * nichts, die nach „s" fand den Eintrag. Ein fehlendes `forks` liess
 * `trageFork` werfen. Genau das Gegenteil dessen, was der Kommentar ueber
 * `istEintrag` verspricht.
 *
 * Repariert wird, nicht verworfen: ein Gespraech mit einem kaputten Feld ist
 * immer noch ein Gespraech.
 */
export function normalisiereEintrag(wert) {
	const forks = Array.isArray(wert.forks)
		? wert.forks.filter((f) => typeof f === "string" && f.trim().length > 0).map((f) => f.trim())
		: [];
	return {
		...wert,
		forks,
		stichworte: pruefeStichworte(wert.stichworte),
		begonnen: Number.isFinite(wert.begonnen) ? wert.begonnen : 0,
		zusammenfassung: typeof wert.zusammenfassung === "string" ? wert.zusammenfassung : ""
	};
}

/**
 * Die naechste freie Anruf-Nummer.
 *
 * **HOCH-2 des Red-Team-Berichts, gemessen:** Stand `naechsteId` auf 1, obwohl
 * schon `anruf-1` und `anruf-2` in der Datei lagen, bekam der naechste Anruf
 * wieder `anruf-1`. Ein `schliessen` traf danach ZWEI Eintraege und ersetzte
 * beide durch denselben — stiller Datenverlust, Antwort `ok: true`. Und das
 * passiert nicht nur bei Handbearbeitung: fehlt das Feld, setzte der Lader es
 * auf 1.
 *
 * Deshalb gilt: die Nummer liegt nie hinter einer vergebenen.
 */
export function naechsteFreieNummer(gespeichert, eintraege) {
	let hoechste = 0;
	for (const eintrag of eintraege) {
		const treffer = /^anruf-(\d+)$/u.exec(eintrag.id ?? "");
		if (treffer === null) continue;
		const nummer = Number(treffer[1]);
		if (Number.isSafeInteger(nummer) && nummer > hoechste) hoechste = nummer;
	}
	const ausDatei = Number.isSafeInteger(gespeichert) && gespeichert > 0 ? gespeichert : 1;
	return Math.max(ausDatei, hoechste + 1);
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
	const eintraege = [];
	let verworfen = 0;
	let repariert = 0;
	const ohneZusammenfassung = [];
	for (const wert of daten.eintraege) {
		if (istEintrag(wert) === false) {
			verworfen += 1;
			continue;
		}
		const heil = normalisiereEintrag(wert);
		// A5 (Red-Team 2, MITTEL-6): Wer repariert, protokolliert die Reparatur.
		// Sonst schreibt der naechste fremde Schreibvorgang die Glaettung still
		// fest, und niemand weiss hinterher, dass die Datei je anders aussah.
		if (JSON.stringify(heil) !== JSON.stringify(wert)) repariert += 1;
		// Und ein `erledigt` ohne Zusammenfassung ist genau der Zustand, den die
		// Kanal-Regel verbietet (ein geschlossener Anruf ohne Text ist ein leeres
		// Feld) — er wird gemeldet, nicht gesund geredet.
		if (heil.stand === "erledigt" && heil.zusammenfassung.trim().length === 0) {
			ohneZusammenfassung.push(heil.id);
		}
		eintraege.push(heil);
	}
	// Ein verworfener Eintrag ist nicht still (MITTEL-4): er steht im Protokoll.
	if (verworfen > 0) protokolliere(`warn ${verworfen} malformed entries skipped in ${pfad}`);
	if (repariert > 0) protokolliere(`warn ${repariert} entries repaired on load in ${pfad}`);
	if (ohneZusammenfassung.length > 0) {
		protokolliere(`warn ${ohneZusammenfassung.length} closed calls without a summary in ${pfad}: ${ohneZusammenfassung.join(", ")}`);
	}
	return { version: 1, naechsteId: naechsteFreieNummer(daten.naechsteId, eintraege), eintraege };
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
	try {
		renameSync(vorlaeufig, pfad);
	} catch (fehler) {
		// NIEDRIG-3: bleibt das Umbenennen stecken, darf keine .tmp liegen
		// bleiben — das Brett raeumt an genau dieser Stelle genauso auf.
		try { unlinkSync(vorlaeufig); } catch { /* schon weg */ }
		throw fehler;
	}
	return pfad;
}

// ---------------------------------------------------------------------------
// Die Regeln. Reine Funktionen ohne Dateisystem — damit der Test sie ohne
// Sperre und ohne Datei fuehren kann.
// ---------------------------------------------------------------------------

/**
 * Alle deutschen Schreibweisen eines Wortes, fuer die Suche.
 *
 * Anordnung des Menschen 2026-11-04: „es sollte mit Umlauten, mit und ohne, das
 * sollte quasi dasselbe sein, ob es ein Umlaut ist oder UE oder Ü."
 *
 * Warum nicht EINE Faltung: `Größe` einmal auf `grose` zu falten laesst
 * `grosse` nichts finden; einmal auf `groesse` laesst `grose` nichts finden.
 * Und gemischte Schreibweisen wie `grosse` (ö ohne e, ß als ss) braucht man
 * auch. Deshalb werden ALLE Kombinationen gebildet — vier Stellen, hoechstens
 * 2^4 = 16 Formen je Wort:
 *
 *   ä → a | ae      ö → o | oe      ü → u | ue      ß → s | ss
 *
 * Damit finden `lösung`, `losung`, `loesung`, `LÖSUNG`, `Größe`, `grose`,
 * `grosse` und `groesse` jeweils denselben Eintrag.
 */
export function faltFormen(text) {
	const klein = String(text ?? "").toLowerCase();
	const stellen = [
		["ä", ["a", "ae"]],
		["ö", ["o", "oe"]],
		["ü", ["u", "ue"]],
		["ß", ["s", "ss"]]
	];
	let formen = [klein];
	for (const [zeichen, ersatz] of stellen) {
		const neu = [];
		for (const form of formen) {
			if (form.includes(zeichen) === false) {
				neu.push(form);
				continue;
			}
			for (const e of ersatz) neu.push(form.split(zeichen).join(e));
		}
		formen = neu;
	}
	return [...new Set(formen)];
}

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
	// A5 (Red-Team 2, MITTEL-5): Ein Wert wie `{"toString": 1}` liess `String()`
	// mit „Cannot convert object to primitive value" werfen — und damit war die
	// GANZE Ablage unlesbar, fuer beide Werkzeuge. Deshalb: nur Zeichenketten und
	// endliche Zahlen, alles andere wird uebersprungen.
	let roh;
	if (Array.isArray(wert)) roh = wert;
	else if (typeof wert === "string") roh = wert.split(/[,;]+/u);
	else if (typeof wert === "number" && Number.isFinite(wert)) roh = [String(wert)];
	else roh = [];
	const gesehen = new Set();
	for (const teil of roh) {
		let wort = "";
		if (typeof teil === "string") wort = teil.trim().toLowerCase();
		else if (typeof teil === "number" && Number.isFinite(teil)) wort = String(teil);
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
	// HOCH-2: Eine doppelte Kennung ist Datenverlust, kein Schoenheitsfehler.
	if (ablage.eintraege.some((eintrag) => eintrag.id === id)) {
		throw new Error(`the call id ${JSON.stringify(id)} is already taken; the register was NOT written`);
	}
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

/**
 * Ob eine Sitzung in diesem Anruf mitspricht.
 *
 * Entscheidung des Menschen 2026-11-04: „Diese Summary kommt dann halt fuer
 * beide, kann aber von beiden Gespraechsteilnehmern getriggert werden." Also
 * `von` oder `an` — und niemand sonst. Eine dritte Sitzung schliesst keinen
 * fremden Anruf.
 */
export function istTeilnehmer(eintrag, sitzung) {
	return eintrag.von === sitzung || eintrag.an === sitzung;
}

/** Einen Eintrag nach seiner Kennung suchen, ohne zu werfen. */
export function findeAnruf(ablage, id) {
	return ablage.eintraege.find((eintrag) => eintrag.id === id);
}

/**
 * Ersetzt GENAU den ersten Eintrag mit dieser Kennung.
 *
 * Die alte Fassung schrieb `map((e) => (e.id === id ? neu : e))` und traf damit
 * jeden Eintrag mit dieser Kennung. Solange Kennungen eindeutig sind, ist das
 * dasselbe; liegen aus einer alten Datei zwei gleiche da, ist es Datenverlust
 * (HOCH-2, gemessen 2026-11-04). Diese Fassung kann nur einen treffen.
 */
export function ersetzeErsten(ablage, id, neu) {
	const stelle = ablage.eintraege.findIndex((eintrag) => eintrag.id === id);
	if (stelle < 0) return ablage;
	const eintraege = [...ablage.eintraege];
	eintraege[stelle] = neu;
	return { ...ablage, eintraege };
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
		ablage: ersetzeErsten(ablage, id, neu),
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
		ablage: ersetzeErsten(ablage, id, neu),
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
	// Beide Schreibweisen auf BEIDEN Seiten (siehe faltFormen): sonst findet
	// „losung" das Wort „Lösung" nicht, und „loesung" faende „Losung" nicht.
	const nadeln = typeof suche === "string" && suche.trim().length > 0 ? faltFormen(suche.trim()) : [];
	const treffer = nadeln.length === 0
		? [...ablage.eintraege]
		: ablage.eintraege.filter((eintrag) => {
			const heu = [eintrag.thema, eintrag.zusammenfassung, ...(eintrag.stichworte ?? [])]
				.flatMap((wert) => faltFormen(wert));
			return nadeln.some((nadel) => heu.some((teil) => teil.includes(nadel)));
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

// NIEDRIG-7: `agents` wird nirgends gelesen — 6b sagt ausdruecklich, die Ablage
// haenge sich nicht in die Sitzungen. Also bleibt nur `tools`.
export const inject = ["tools"];

/** Ein Kern-Baustein, einmal geladen. */
let werkzeugBaustein;

/**
 * Die Basis-Ordner der dsh-Installation, in der Reihenfolge der Wahrscheinlichkeit.
 *
 * Die Kernpakete wohnen NUR in der Installation. Ein nackter Import findet sie
 * im Repo nicht — und dann steht das Werkzeug still, ohne dass jemand es merkt
 * (Red-Team-Befund NIEDRIG-10). Der Weg ist aus `team-board.mjs` und
 * `send-to-session.mjs` uebernommen, wo er sich im Betrieb bewaehrt hat.
 */
function kernBasis() {
	const basis = new Set();
	const fuegen = (pfad) => {
		if (typeof pfad !== "string" || pfad.length === 0) return;
		if (existsSync(pfad)) basis.add(pfad);
	};
	const laufend = process.argv[1];
	if (typeof laufend === "string" && laufend.length > 0) {
		const teile = laufend.split("/");
		const bei = teile.lastIndexOf("node_modules");
		if (bei > 0) fuegen(teile.slice(0, bei + 1).join("/"));
	}
	fuegen("/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules");
	fuegen(join(homedir(), ".npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules"));
	fuegen("/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules");
	return basis;
}

/** Laedt einen Kernbaustein ueber alle bekannten Ablageformen. */
async function ladeKern(paket) {
	const unterpfad = paket.replace("@deepseek-ai/", "");
	const kandidaten = [paket];
	for (const basis of kernBasis()) {
		kandidaten.push(join(basis, "@deepseek-ai", unterpfad, "lib", "index.js"));
		kandidaten.push(join(basis, "dsh", "node_modules", "@deepseek-ai", unterpfad, "lib", "index.js"));
	}
	for (const kandidat of kandidaten) {
		try {
			return await import(kandidat);
		} catch { /* naechster Kandidat */ }
	}
	return undefined;
}

/**
 * Das Modul anmelden.
 *
 * @param ctx - Cordis-Kontext des Loader-Eintrags.
 * @param optionen - nur fuer Tests: `{ pfad, sperre }` lenkt Ablage und Sperre um.
 *   Ohne sie gilt die echte Ablage und `mitSperre` aus `send-to-session.mjs`.
 *   Die Umlenkung ist noetig, weil der Werkzeugpfad sonst gar nicht pruefbar ist
 *   (Red-Team-Befund NIEDRIG-6) — und genau dort sitzt die Sperre.
 */
export function apply(ctx, optionen = {}) {
	// NIEDRIG-5: `apply(ctx, null)` warf vor jedem Schutz. Ein Test darf nicht
	// den Host mitreissen, nur weil er den zweiten Parameter vergisst.
	const einstellungen = optionen ?? {};
	const sperre = typeof einstellungen.sperre === "function" ? einstellungen.sperre : mitSperre;
	const melden = (stufe, text) => {
		protokolliere(text);
		try {
			const logger = ctx.logger;
			if (logger !== undefined && typeof logger[stufe] === "function") logger[stufe](`team-anruf: ${text}`);
		} catch { /* Ein fehlendes Protokoll darf den Start nie stoeren. */ }
	};

	ctx.effect(() => {
		let abgemeldet = false;
		const abmeldungen = [];

		(async () => {
			werkzeugBaustein ??= await ladeKern("@deepseek-ai/dsh-tools");
			if (abgemeldet) return;
			const defineTool = werkzeugBaustein?.defineTool;
			if (typeof defineTool !== "function") {
				melden("warn", "der Werkzeug-Baustein (defineTool) ist nicht auffindbar; die Werkzeuge stehen nicht zur Verfuegung");
				return;
			}

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
							// HOCH-1: der Kern verlangt bei jedem Objekt ausdruecklich
							// `additionalProperties`; ohne das Feld lehnt `defineTool` die
							// ganze Definition ab und der Host stirbt beim Laden.
							anruf: { type: "object", additionalProperties: true },
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
						const pfad = einstellungen.pfad ?? anrufPfad();
						const aktion = args?.aktion;
						try {
							const ergebnis = await sperre(pfad, () => {
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
									const vorhanden = findeAnruf(ablage, args.id);
									if (vorhanden !== undefined && istTeilnehmer(vorhanden, absender) === false) {
										return {
											ok: false,
											note: `only the two sessions of this call (${vorhanden.von} and ${vorhanden.an}) may close it, not ${absender}`
										};
									}
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
						const pfad = einstellungen.pfad ?? anrufPfad();
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

			// A4 (Red-Team 2, MITTEL-4): Die Aufraeum-Liste steht VOR der Schleife und
			// wird pro Definition gefuellt. Die alte Fassung wies sie erst nach dem
			// vollstaendigen `map` zu — warf das `map` in der Mitte, blieb ein halb
			// registrierter Zustand stehen, den der Disposer nicht mehr abraeumen
			// konnte (gemessen: `team_anruf` blieb belegt, der zweite Ladevorgang
			// registrierte gar nichts mehr). Das Brett macht es seit jeher so.
			for (const definition of abläufe) {
				try {
					abmeldungen.push(ctx.tools.register(definition));
				} catch (fehler) {
					// HOCH-1: Eine abgelehnte Definition darf den Host nicht toeten.
					melden("warn", `Werkzeug ${definition?.name} konnte nicht angemeldet werden: ${fehler instanceof Error ? fehler.message : String(fehler)}`);
				}
			}
			melden("info", `Werkzeuge ${WERKZEUG} und ${WERKZEUG_LISTE} registriert; Ablage ${optionen.pfad ?? anrufPfad()}`);
		})().catch((fehler) => {
			// HOCH-1: Was hier abgelehnt wird, ist eine unbehandelte Ablehnung —
			// und die beendet nach Node-Regel den ganzen Host (Exit 1). Das darf
			// eine fehlerhafte Werkzeugdefinition nie mehr ausloesen.
			melden("warn", "Werkzeuge konnten nicht angemeldet werden: " + (fehler instanceof Error ? fehler.message : String(fehler)));
		});

		return () => {
			abgemeldet = true;
			for (const ab of abmeldungen) if (typeof ab === "function") ab();
		};
	}, "team-anruf lifecycle");
}
