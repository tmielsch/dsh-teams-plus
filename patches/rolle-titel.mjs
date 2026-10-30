/**
 * rolle-titel — die Titelzeile steht VOR dem Rollentext
 * =====================================================
 *
 * WAS DER MENSCH WOLLTE (Anordnung 2026-10-30, in M19 eingetragen)
 * Der erste Satz in der Init-Nachricht eines Facharbeiters ist der Titel der
 * Sitzung, so wie er in Menues und auf Karten gelistet wird. Schema:
 * "Arbeitername#" mit # = Nummer (Recherche1, RedTeam1, Implementer1), dann
 * Umbruch, dann die eigentliche Nachricht. Das Schema ist verpflichtend.
 *
 * DAS PROBLEM, GEMESSEN IM QUELLTEXT
 * dsh-tool-subagent/lib/index.js, Funktion subagentRolleVoran (Zeile 18 bis 26):
 * return text + "\n\n" + prompt; Der Rollentext steht byte-gleich VOR dem Auftrag.
 * Mit einer Rolle beginnt die Sitzung also mit der Ueberschrift der Rollendatei
 * ("# Rolle: ..."), nicht mit der Titelzeile des Auftrags.
 *
 * WAS DIESES MODUL TUT (nur im Speicher, kein Paket wird angefasst)
 * Es umhuellt die Ausfuehrung von delegate_task. Nennt der Aufruf eine Rolle UND
 * beginnt der Auftrag mit einer Titelzeile, setzt es den Text selbst zusammen:
 *
 *     Titelzeile
 *     (Leerzeile)
 *     Rollentext
 *     (Leerzeile)
 *     Rest des Auftrags
 *
 * und uebergibt ihn ohne das Feld rolle an das Original. In allen anderen Faellen
 * bleibt der Aufruf BYTE FUER BYTE wie er war (keine Rolle, keine Titelzeile,
 * unbekannte Rolle: dann wirft das Original wie bisher "Unbekannte Rolle ...").
 * Jeder Fehler in diesem Modul faellt auf das Original zurueck.
 *
 * WAS ALS TITELZEILE GILT (erste Zeile des Auftrags, hoechstens 80 Zeichen, danach ein Umbruch)
 *   1. "Titel: <Name>"   die Projekt-Manager-Regel aus ~/.dsh/AGENTS.md
 *   2. "<Name><Nummer>"  das Schema des Menschen: ein Wort aus Buchstaben (auch mit - oder _),
 *                        am Ende eine Zahl, zum Beispiel Recherche1 oder Red-Team2
 *
 * KOSTEN, ehrlich (SCHAETZUNG, nicht gemessen): Die Rollentexte waren der gemeinsame Anfang
 * der ersten Nutzernachricht aller Facharbeiter einer Rolle, damit der Zwischenspeicher
 * (KV-Cache) greift. Mit einer Titelzeile davor ist der Anfang je Facharbeiter verschieden;
 * geteilt bleibt nur Systemprompt plus Werkzeugliste. Der Rollentext (rund 2 bis 3 Tausend
 * Token je Rolle) wird je Start einmal neu eingelesen statt aus dem Zwischenspeicher.
 *
 * RUECKGAENGIG: Eintrag "rolle-titel" aus ~/.dsh/profiles/web/cordis.patch.yml nehmen und
 * dsh web neu starten.
 *
 * Selbstpruefung: node ~/.dsh/patches/rolle-titel.mjs --test
 * Trockenlauf:    node ~/.dsh/patches/rolle-titel.mjs --trockenlauf <rolle> "<Auftrag>"
 * Protokoll:      ~/.dsh/logs/rolle-titel.log
 */

import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const name = "rolle-titel";

/** Dienste, ohne die dieses Modul nichts tun kann. */
export const inject = ["tools", "agents"];

/** Das Werkzeug, um das es geht. */
export const WERKZEUG = "delegate_task";

/** Marke auf der umgebogenen Ausfuehrung: verhindert Stapeln nach einem Neuladen. */
const MARKE = Symbol.for("rolle-titel.umgebogen");

/** Laenge, ab der eine erste Zeile kein Titel mehr ist. */
export const TITEL_MAX = 80;

/** Schreibt eine Zeile ins Protokoll; ein Fehler dabei stoert nie. */
export function protokolliere(text) {
	try {
		const pfad = process.env.DSH_ROLLE_TITEL_LOG ?? join(homedir(), ".dsh", "logs", "rolle-titel.log");
		appendFileSync(pfad, new Date().toISOString() + " " + text + "\n");
	} catch { /* Das Protokoll ist Beigabe, nie Bedingung. */ }
}

/** Ordner der Rollendateien, wie ihn das Delegationswerkzeug selbst bestimmt. */
export function rollenOrdner() {
	return process.env.DSH_ROLLEN_DIR || join(homedir(), ".dsh", "rollen");
}

/** Namen der vorhandenen Rollen: *.md ohne fuehrenden Unterstrich. */
export function rollenListe(ordner = rollenOrdner()) {
	try {
		return readdirSync(ordner).filter((n) => n.endsWith(".md") && !n.startsWith("_")).map((n) => n.slice(0, -3)).sort();
	} catch {
		return [];
	}
}

/**
 * Trennt die Titelzeile vom Rest des Auftrags.
 *
 * @param {unknown} prompt - der Auftrag.
 * @returns {{titel: string, rest: string}|undefined} undefined, wenn die erste Zeile kein Titel ist.
 */
export function trenneTitel(prompt) {
	if (typeof prompt !== "string") return undefined;
	const umbruch = prompt.indexOf("\n");
	if (umbruch === -1) return undefined;
	const zeile = prompt.slice(0, umbruch).replace(/\r$/u, "").trim();
	if (zeile.length === 0 || zeile.length > TITEL_MAX) return undefined;
	const istTitelPrefix = /^Titel:\s*\S/u.test(zeile);
	const istNameMitNummer = /^\p{L}[\p{L}_-]*\d+$/u.test(zeile);
	if (!istTitelPrefix && !istNameMitNummer) return undefined;
	const rest = prompt.slice(umbruch + 1).replace(/^(?:[ \t]*\r?\n)+/u, "");
	return { titel: zeile, rest };
}

/**
 * Setzt den Auftrag in der Reihenfolge Titelzeile, Rollentext, Rest zusammen.
 *
 * @param {unknown} rolle - Name der Rolle oder leer.
 * @param {unknown} prompt - der Auftrag.
 * @param {string} [ordner] - Ordner der Rollendateien.
 * @returns {string|undefined} der neue Auftrag, oder undefined = nicht zustaendig (Original laeuft).
 */
export function baueAuftrag(rolle, prompt, ordner = rollenOrdner()) {
	if (rolle === undefined || rolle === null || rolle === "") return undefined;
	const rollenName = String(rolle);
	if (!/^[a-z0-9][a-z0-9-]*$/u.test(rollenName) || !rollenListe(ordner).includes(rollenName)) return undefined;
	const teile = trenneTitel(prompt);
	if (teile === undefined) return undefined;
	const text = readFileSync(join(ordner, rollenName + ".md"), "utf8").trimEnd();
	return teile.titel + "\n\n" + text + "\n\n" + teile.rest;
}

/**
 * Umhuellt die Ausfuehrung einer delegate_task-Definition.
 *
 * @param {object} definition - die aufgeloeste Werkzeug-Definition.
 * @returns {{stand: "fertig"|"aufgeben", zurueck?: () => void, grund?: string}}
 */
export function erweitereDefinition(definition) {
	if (definition === undefined || typeof definition.execute !== "function") {
		return { stand: "aufgeben", grund: "das Werkzeug " + WERKZEUG + " hat nicht die erwartete Form (DSH-Update?)" };
	}
	if (definition.execute[MARKE] === true) return { stand: "fertig" };
	const grundExecute = definition.execute;
	definition.execute = async function (args, exec) {
		let neu = args;
		try {
			const auftrag = baueAuftrag(args?.rolle, args?.prompt);
			if (auftrag !== undefined) {
				neu = { ...args, prompt: auftrag };
				delete neu.rolle;
				protokolliere("Titelzeile vor den Rollentext gestellt (Rolle " + String(args.rolle) + ").");
			}
		} catch (fehler) {
			neu = args;
			protokolliere("Fehler beim Zusammensetzen, Original laeuft: " + String(fehler));
		}
		return grundExecute.call(this, neu, exec);
	};
	definition.execute[MARKE] = true;
	return {
		stand: "fertig",
		zurueck() { definition.execute = grundExecute; }
	};
}

/**
 * Cordis-Plugin: haengt sich an delegate_task.
 *
 * @param {object} ctx - Cordis-Kontext der Profilwurzel.
 */
export function apply(ctx) {
	const melden = (stufe, text) => {
		protokolliere(text);
		try {
			const logger = ctx.logger;
			if (logger !== undefined && typeof logger[stufe] === "function") logger[stufe]("rolle-titel: " + text);
		} catch { /* Ein fehlendes Protokoll darf den Start nie stoeren. */ }
	};
	const ruecknahmen = new WeakMap();

	const erweitere = (agent) => {
		let definition;
		try {
			definition = ctx.tools.get(WERKZEUG, agent);
		} catch (fehler) {
			melden("warn", "das Werkzeug " + WERKZEUG + " liess sich nicht abfragen: " + String(fehler));
			return "aufgeben";
		}
		if (definition === undefined) return "spaeter";
		const ergebnis = erweitereDefinition(definition);
		if (ergebnis.stand === "aufgeben") {
			melden("warn", ergebnis.grund + "; es bleibt unveraendert.");
			return "aufgeben";
		}
		if (ergebnis.zurueck !== undefined) ruecknahmen.set(definition, ergebnis.zurueck);
		return "fertig";
	};

	const durchgang = () => {
		let erweitert = 0;
		let aufgegeben = false;
		for (const agent of ctx.agents.list()) {
			const ergebnis = erweitere(agent);
			if (ergebnis === "fertig") erweitert += 1;
			if (ergebnis === "aufgeben") aufgegeben = true;
		}
		return { erweitert, aufgegeben };
	};

	ctx.on("agent/created", () => { durchgang(); });
	ctx.on("tools/change", () => { durchgang(); });
	ctx.on("app-boot/config-reload", () => { durchgang(); });

	ctx.effect(() => {
		const stand = durchgang();
		if (stand.aufgegeben) melden("warn", "das Werkzeug " + WERKZEUG + " hatte nicht die erwartete Form; die Titelzeile steht dann weiter hinter dem Rollentext.");
		else protokolliere("beim Start eingehaengt in " + stand.erweitert + " Agenten-Scope(s).");
		return () => {
			for (const agent of ctx.agents.list()) {
				let definition;
				try { definition = ctx.tools.get(WERKZEUG, agent); } catch { definition = undefined; }
				if (definition === undefined) continue;
				ruecknahmen.get(definition)?.();
			}
		};
	}, "rolle-titel");
}

// ---------------------------------------------------------------------------
// Trockenlauf und Selbstpruefung
// ---------------------------------------------------------------------------
const alsHauptmodul = process.argv[1] !== undefined && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;

if (alsHauptmodul && process.argv.includes("--trockenlauf")) {
	const i = process.argv.indexOf("--trockenlauf");
	const rolle = process.argv[i + 1];
	const auftrag = (process.argv[i + 2] ?? "").split("\\n").join("\n");
	const ergebnis = baueAuftrag(rolle, auftrag);
	if (ergebnis === undefined) {
		console.log("NICHT ZUSTAENDIG: Original laeuft (keine Rolle, keine Titelzeile oder unbekannte Rolle). Vorhandene Rollen: " + rollenListe().join(", "));
	} else {
		const zeilen = ergebnis.split("\n");
		const rollenKopf = zeilen.findIndex((z) => z.startsWith("# Rolle"));
		const strich = zeilen.lastIndexOf("AUFTRAG");
		console.log("Reihenfolge im ersten Prompt des Facharbeiters:");
		console.log("  Zeile 1            : " + zeilen[0] + "   <- Titelzeile");
		console.log("  Zeile " + String(rollenKopf + 1).padEnd(14) + ": " + zeilen[rollenKopf] + "   <- Beginn des Rollentextes");
		console.log("  Zeile " + String(strich + 1).padEnd(14) + ": " + zeilen[strich] + "   <- Ende des Rollentextes");
		console.log("  danach          : " + (zeilen.slice(strich + 1).find((z) => z.trim() !== "") ?? "(leer)") + "   <- Beginn des Auftrags");
		console.log("Gesamtlaenge: " + ergebnis.length + " Zeichen.");
	}
}

if (alsHauptmodul && process.argv.includes("--test")) {
	let fehlgeschlagen = 0;
	const pruefe = (ist, soll, was) => {
		if (JSON.stringify(ist) !== JSON.stringify(soll)) {
			fehlgeschlagen += 1;
			console.log("FEHLER  " + was + ": " + JSON.stringify(ist) + ", erwartet " + JSON.stringify(soll));
		}
	};
	const werkstatt = mkdtempSync(join(tmpdir(), "rolle-titel-test-"));
	try {
		const ordner = join(werkstatt, "rollen");
		mkdirSync(ordner);
		writeFileSync(join(ordner, "probe.md"), "# Rolle: Probe\n\nText.\n\n---\n\nAUFTRAG\n\n");
		writeFileSync(join(ordner, "_vorlage.md"), "keine Rolle");

		// 1) Titelzeilen erkennen
		pruefe(trenneTitel("Recherche1\nSache"), { titel: "Recherche1", rest: "Sache" }, "Name mit Nummer");
		pruefe(trenneTitel("RedTeam12\n\n\nSache")?.rest, "Sache", "Leerzeilen nach der Titelzeile fallen weg");
		pruefe(trenneTitel("Red-Team2\nSache")?.titel, "Red-Team2", "Name mit Bindestrich");
		pruefe(trenneTitel("Titel: Kantenprojektion messen\nSache")?.titel, "Titel: Kantenprojektion messen", "Titel-Praefix");
		pruefe(trenneTitel("Recherche1\r\nSache")?.titel, "Recherche1", "Windows-Zeilenende");
		pruefe(trenneTitel("Du bist ein Facharbeiter.\nSache"), undefined, "normaler Satz ist kein Titel");
		pruefe(trenneTitel("## ERSTER SATZ\nSache"), undefined, "Ueberschrift ist kein Titel");
		pruefe(trenneTitel("Recherche\nSache"), undefined, "Name ohne Nummer ist kein Titel");
		pruefe(trenneTitel("Recherche1"), undefined, "ohne Umbruch kein Titel");
		pruefe(trenneTitel("Titel: " + "x".repeat(90) + "\nSache"), undefined, "zu lange erste Zeile");
		pruefe(trenneTitel(undefined), undefined, "kein Text");

		// 2) Zusammensetzen: Reihenfolge Titelzeile, Rollentext, Auftrag
		const voll = baueAuftrag("probe", "Recherche1\nSache", ordner);
		pruefe(voll, "Recherche1\n\n# Rolle: Probe\n\nText.\n\n---\n\nAUFTRAG\n\nSache", "Reihenfolge Titelzeile, Rollentext, Auftrag");
		pruefe(voll.split("\n")[0], "Recherche1", "die erste Zeile ist die Titelzeile");
		pruefe(baueAuftrag("probe", "Du bist.\nSache", ordner), undefined, "ohne Titelzeile nicht zustaendig");
		pruefe(baueAuftrag(undefined, "Recherche1\nSache", ordner), undefined, "ohne Rolle nicht zustaendig");
		pruefe(baueAuftrag("", "Recherche1\nSache", ordner), undefined, "leere Rolle nicht zustaendig");
		for (const boese of ["gibtsnicht", "../probe", "Probe", "_vorlage", "probe.md"]) {
			pruefe(baueAuftrag(boese, "Recherche1\nSache", ordner), undefined, "Rolle " + boese + " ist nicht zustaendig (das Original lehnt ab)");
		}

		// 3) Die Umhuellung an einer nachgebauten Definition
		const nachbau = () => {
			const aufrufe = [];
			return { aufrufe, definition: { name: "delegate_task", execute: async function (args) { aufrufe.push(args); return { kind: "continuable", subagentId: "x" }; } } };
		};
		process.env.DSH_ROLLEN_DIR = ordner;
		{
			const { definition, aufrufe } = nachbau();
			pruefe(erweitereDefinition(definition).stand, "fertig", "Umhuellung eingehaengt");
			await definition.execute({ description: "a", prompt: "Recherche1\nSache", rolle: "probe" }, {});
			pruefe(aufrufe[0].prompt.split("\n")[0], "Recherche1", "umgebogen: erste Zeile ist die Titelzeile");
			pruefe(Object.hasOwn(aufrufe[0], "rolle"), false, "umgebogen: Feld rolle ist weg, das Original setzt nichts doppelt");
			pruefe(aufrufe[0].description, "a", "umgebogen: description bleibt");
		}
		{
			const { definition, aufrufe } = nachbau();
			erweitereDefinition(definition);
			const original = { description: "a", prompt: "Du bist.\nSache", rolle: "probe" };
			await definition.execute(original, {});
			pruefe(aufrufe[0] === original, true, "ohne Titelzeile geht dasselbe Argumentobjekt unveraendert durch");
			const ohneRolle = { description: "a", prompt: "Recherche1\nSache" };
			await definition.execute(ohneRolle, {});
			pruefe(aufrufe[1] === ohneRolle, true, "ohne Rolle geht dasselbe Argumentobjekt unveraendert durch");
			const unbekannt = { description: "a", prompt: "Recherche1\nSache", rolle: "gibtsnicht" };
			await definition.execute(unbekannt, {});
			pruefe(aufrufe[2] === unbekannt, true, "unbekannte Rolle geht unveraendert zum Original (das lehnt ab)");
		}
		{
			const { definition } = nachbau();
			const umhuellt = erweitereDefinition(definition);
			const einmal = definition.execute;
			erweitereDefinition(definition);
			pruefe(definition.execute === einmal, true, "zweimal einhaengen stapelt nicht");
			umhuellt.zurueck();
			pruefe(definition.execute[MARKE], undefined, "Ruecknahme stellt das Original her");
		}
		pruefe(erweitereDefinition(undefined).stand, "aufgeben", "fremde Form wird nicht angefasst");
		pruefe(erweitereDefinition({ name: "x" }).stand, "aufgeben", "Definition ohne execute wird nicht angefasst");
	} finally {
		rmSync(werkstatt, { recursive: true, force: true });
	}
	console.log(fehlgeschlagen === 0 ? "Selbstpruefung: alles in Ordnung." : "Selbstpruefung: " + fehlgeschlagen + " Fehler.");
	process.exitCode = fehlgeschlagen === 0 ? 0 : 1;
}
