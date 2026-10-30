/**
 * subagent-rolle — das Delegations-Werkzeug kennt Rollen fuer Facharbeiter
 * =======================================================================
 *
 * WAS DER MENSCH WOLLTE (Anordnung 2026-10-26)
 * Eine dreistufige Hierarchie: Teamlead, Experten, Facharbeiter. Facharbeiter
 * (Red-Team, Projektmanager, Recherche, allgemeiner Arbeiter) sollen ALLE
 * dasselbe Profil, denselben Systemprompt und dieselbe Werkzeugliste haben,
 * damit die Prompt-Zwischenspeicherung (KV-Cache, besonders wichtig bei lokaler
 * KI) greift: ein Facharbeiter startet als Kopie des gemeinsamen Anfangs und
 * bekommt nur noch seinen Rollentext und seinen Auftrag. Ein eigenes DSH-Profil
 * je Rolle wuerde den Systemprompt aendern und den Cache brechen.
 *
 * WAS DIESES MODUL TUT
 * `delegate_task` bekommt ein optionales Feld `rolle`. Wird es genannt, liest
 * das Werkzeug `~/.dsh/rollen/<rolle>.md` und stellt den Text BYTE-GLEICH vor
 * den Auftrag des Experten (`rollentext + zwei Zeilenumbrueche + auftrag`).
 * Der Rollentext steht damit am Anfang der ersten Nutzernachricht des
 * Facharbeiters; alle Facharbeiter derselben Rolle teilen so den Anfang
 * (Systemprompt, Werkzeuge, Rollentext). Der Systemprompt wird NICHT angefasst
 * (der Persona-Weg des Werkzeugs waere Systemprompt-Ebene und brach den Cache).
 *
 *  - Die Rollendatei wird bei JEDEM Aufruf frisch gelesen: eine neue oder
 *    geaenderte Rolle gilt sofort, ohne Neustart. (Nur die Aufzaehlung in der
 *    Feldbeschreibung wird beim Start gebildet.)
 *  - Eine unbekannte Rolle wird mit der Liste der vorhandenen abgelehnt, nicht
 *    still ignoriert; ein Tippfehler startet so keinen Facharbeiter ohne Rolle.
 *  - Der Ordner ist `~/.dsh/rollen`, ueberschreibbar mit `DSH_ROLLEN_DIR`.
 *  - Dateien, deren Name mit `_` beginnt, sind keine Rollen.
 *
 * WAS UNVERAENDERT BLEIBT
 * Ohne `rolle` laeuft alles wie vorher, Byte fuer Byte. Modellwahl, Hintergrund-
 * lauf, Tiefe und Werkzeugfilter sind nicht beruehrt.
 *
 * RUECKGAENGIG
 *   node ~/.dsh/patches/allow-subagent-rolle.mjs --revert
 *   danach `dsh web` neu starten.
 *
 * Selbstpruefung (ohne Datei-Eingriff):
 *   node ~/.dsh/patches/subagent-rolle.mjs --test
 */

import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/** Paket, dessen Stellen ergaenzt werden. */
export const PAKET = "@deepseek-ai/dsh-tool-subagent";

/** Kennung im Quelltext; ihr Vorhandensein heisst "schon eingespielt". */
export const MARKER = "subagentRolleVoran";

const T = "\t";

/** Stelle 1: Hilfsfunktionen und ihre Importe, direkt hinter dem ersten Import. */
export const HILFE = {
	id: "hilfe",
	was: "Hilfsfunktionen, die die Rollendatei lesen und dem Auftrag voranstellen",
	datei: "lib/index.js",
	vorher: `import z from "@deepseek-ai/schemastery";\n`,
	nachher: String.raw`import z from "@deepseek-ai/schemastery";
// ${MARKER}: Rollen fuer Facharbeiter. Die Rollendatei steht byte-gleich vor dem
// Auftrag, damit alle Facharbeiter derselben Rolle den Anfang ihres Prompts
// (und damit den Zwischenspeicher) teilen. Siehe ~/.dsh/patches/subagent-rolle.mjs.
import { readFileSync as __rolleLese, readdirSync as __rolleListe } from "node:fs";
import { homedir as __rolleHeim } from "node:os";
import { join as __rolleJoin } from "node:path";
function subagentRollenOrdner() {
	return process.env.DSH_ROLLEN_DIR || __rolleJoin(__rolleHeim(), ".dsh", "rollen");
}
function subagentRollenListe() {
	try {
		return __rolleListe(subagentRollenOrdner()).filter((n) => n.endsWith(".md") && !n.startsWith("_")).map((n) => n.slice(0, -3)).sort();
	} catch {
		return [];
	}
}
function subagentRolleVoran(rolle, prompt) {
	if (rolle === undefined || rolle === null || rolle === "") return prompt;
	const name = String(rolle);
	const verfuegbar = subagentRollenListe();
	if (!/^[a-z0-9][a-z0-9-]*$/u.test(name) || !verfuegbar.includes(name)) {
		throw new Error("Unbekannte Rolle \"" + name + "\". Verfuegbar: " + (verfuegbar.join(", ") || "(keine)") + " (Ordner " + subagentRollenOrdner() + ")");
	}
	const text = __rolleLese(__rolleJoin(subagentRollenOrdner(), name + ".md"), "utf8").trimEnd();
	return text + "\n\n" + prompt;
}
`
};

/** Stelle 2: das Feld `rolle` im Parameterschema. */
export const SCHEMA = {
	id: "schema",
	was: "Parameter `rolle` im Schema des Delegations-Werkzeugs",
	datei: "lib/index.js",
	vorher: `description: wording.promptDescription\n${T.repeat(6)}},\n`,
	nachher: String.raw`description: wording.promptDescription
` + T.repeat(6) + String.raw`},
` + T.repeat(6) + String.raw`rolle: {
` + T.repeat(7) + String.raw`type: "string",
` + T.repeat(7) + String.raw`description: "Optional (${MARKER}). Rolle eines Facharbeiters. Der Rollentext aus ~/.dsh/rollen/<rolle>.md wird byte-gleich vor deinen Auftrag gestellt, damit alle Facharbeiter dieser Rolle denselben Prompt-Anfang teilen. Verfuegbar: " + (subagentRollenListe().join(", ") || "(keine)") + ". Der Auftrag im Feld prompt beschreibt nur die Sache, nicht die Rolle."
` + T.repeat(6) + String.raw`},
`
};

/** Stelle 3: der Auftrag wird mit dem Rollentext voran uebergeben. */
export const AUFTRAG = {
	id: "auftrag",
	was: "Rollentext vor den Auftrag stellen, wenn `rolle` genannt ist",
	datei: "lib/index.js",
	vorher: `text: args.prompt\n`,
	nachher: `text: ${MARKER}(args.rolle, args.prompt)\n`
};

export const ERSETZUNGEN = [HILFE, SCHEMA, AUFTRAG];

/** Schreibt eine Zeile ins Protokoll; ein Fehler dabei stoert nie. */
export function protokolliere(text) {
	try {
		const pfad = process.env.DSH_SUBAGENT_ROLLE_LOG ?? join(homedir(), ".dsh", "logs", "subagent-rolle.log");
		appendFileSync(pfad, `${new Date().toISOString()} ${text}\n`);
	} catch { /* Das Protokoll ist Beigabe, nie Bedingung. */ }
}

/** Wie oft kommt `needle` in `haystack` vor? */
function zaehle(haystack, needle) {
	if (needle.length === 0) return 0;
	let n = 0;
	let i = haystack.indexOf(needle);
	while (i !== -1) {
		n += 1;
		i = haystack.indexOf(needle, i + needle.length);
	}
	return n;
}

/** Zustand eines Quelltexts, ohne ihn zu veraendern. */
export function statusOf(source, id) {
	const ersetzung = ERSETZUNGEN.find((e) => e.id === id);
	if (ersetzung === undefined) return "unbekannt";
	if (zaehle(source, ersetzung.nachher) === 1) return "freigegeben";
	if (zaehle(source, ersetzung.vorher) === 1) return "gesperrt";
	return "unbekannt";
}

/** Reine Textumwandlung: einspielen. Ersetzt per Funktion, damit `$` im Text nicht als Muster gilt. */
export function applyToSource(source, id) {
	const ersetzung = ERSETZUNGEN.find((e) => e.id === id);
	if (ersetzung === undefined) return { changed: false, error: `unbekannte Stelle "${id}"` };
	if (statusOf(source, id) === "freigegeben") return { changed: false, source, steps: [] };
	const n = zaehle(source, ersetzung.vorher);
	if (n !== 1) {
		return { changed: false, error: `Die Stelle "${ersetzung.was}" kommt ${n} mal vor (erwartet: genau 1). Nach einem DSH-Update hat sich der Code geaendert; es wurde nichts geschrieben.` };
	}
	return { changed: true, source: source.replace(ersetzung.vorher, () => ersetzung.nachher), steps: [ersetzung.was] };
}

/** Reine Textumwandlung: zuruecknehmen. */
export function revertFromSource(source, id) {
	const ersetzung = ERSETZUNGEN.find((e) => e.id === id);
	if (ersetzung === undefined) return { changed: false, error: `unbekannte Stelle "${id}"` };
	if (statusOf(source, id) !== "freigegeben") return { changed: false, source, steps: [] };
	const n = zaehle(source, ersetzung.nachher);
	if (n !== 1) {
		return { changed: false, error: `Die eingespielte Stelle "${ersetzung.was}" kommt ${n} mal vor (erwartet: genau 1). Zuruecknehmen waere unsicher; es wurde nichts geschrieben.` };
	}
	return { changed: true, source: source.replace(ersetzung.nachher, () => ersetzung.vorher), steps: [ersetzung.was] };
}

/** Schreibt eine Datei ersetzend: erst daneben, dann umbenennen (unteilbar). */
function atomarSchreiben(pfad, inhalt) {
	const temp = `${pfad}.tmp-${process.pid}`;
	try {
		writeFileSync(temp, inhalt);
		renameSync(temp, pfad);
	} catch {
		try { unlinkSync(temp); } catch { /* Temp-Datei war schon weg. */ }
		writeFileSync(pfad, inhalt);
	}
}

/** Zustand einer Datei lesen, ohne sie anzufassen. */
export function statusOfFile(pfad, id) {
	try {
		return { state: statusOf(readFileSync(pfad, "utf8"), id), size: statSync(pfad).size, pfad };
	} catch (error) {
		return { state: "fehlt", error: String(error?.code ?? error), pfad };
	}
}

/** Stelle auf eine Datei anwenden. */
export function applyPatch(pfad, id) {
	let original;
	try {
		original = readFileSync(pfad, "utf8");
	} catch (error) {
		return { changed: false, error: `Nicht lesbar: ${pfad} (${String(error?.code ?? error)})` };
	}
	const ergebnis = applyToSource(original, id);
	if (ergebnis.error !== undefined) return { changed: false, error: ergebnis.error };
	if (!ergebnis.changed) return { changed: false, steps: [], pfad };
	atomarSchreiben(pfad, ergebnis.source);
	if (statusOf(readFileSync(pfad, "utf8"), id) !== "freigegeben") {
		atomarSchreiben(pfad, original);
		return { changed: false, error: "Die Nachkontrolle nach dem Schreiben ist fehlgeschlagen; der Originalstand wurde wiederhergestellt." };
	}
	return { changed: true, steps: ergebnis.steps, pfad };
}

/** Stelle auf einer Datei zuruecknehmen. */
export function revertPatch(pfad, id) {
	let original;
	try {
		original = readFileSync(pfad, "utf8");
	} catch (error) {
		return { changed: false, error: `Nicht lesbar: ${pfad} (${String(error?.code ?? error)})` };
	}
	const ergebnis = revertFromSource(original, id);
	if (ergebnis.error !== undefined) return { changed: false, error: ergebnis.error };
	if (!ergebnis.changed) return { changed: false, steps: [], pfad };
	atomarSchreiben(pfad, ergebnis.source);
	if (statusOf(readFileSync(pfad, "utf8"), id) !== "gesperrt") {
		atomarSchreiben(pfad, original);
		return { changed: false, error: "Die Nachkontrolle nach dem Schreiben ist fehlgeschlagen; der vorherige Stand wurde wiederhergestellt." };
	}
	return { changed: true, steps: ergebnis.steps, pfad };
}

// ---------------------------------------------------------------------------
// Selbstpruefung: node ~/.dsh/patches/subagent-rolle.mjs --test
// ---------------------------------------------------------------------------
if (process.argv.includes("--test")) {
	let fehlgeschlagen = 0;
	const pruefe = (ist, soll, was) => {
		if (JSON.stringify(ist) !== JSON.stringify(soll)) {
			fehlgeschlagen += 1;
			console.log(`FEHLER  ${was}: ${JSON.stringify(ist)}, erwartet ${JSON.stringify(soll)}`);
		}
	};

	// Nachbau des Anker-Ausschnitts, wie er im Original steht (Tabs wie dort).
	const original = [
		`import z from "@deepseek-ai/schemastery";`,
		`import { x } from "y";`,
		`${T.repeat(6)}prompt: {`,
		`${T.repeat(7)}type: "string",`,
		`${T.repeat(7)}required: true,`,
		`${T.repeat(7)}description: wording.promptDescription`,
		`${T.repeat(6)}},`,
		`${T.repeat(6)}...modelSelectionEnabled ? {`,
		`${T.repeat(8)}text: args.prompt`,
		`${T.repeat(7)}}],`,
		""
	].join("\n");

	// 1) Jede Ersetzung einzeln: hin, doppelt harmlos, zurueck ergibt den Ausgangstext.
	for (const ersetzung of ERSETZUNGEN) {
		pruefe(ersetzung.vorher === ersetzung.nachher, false, `${ersetzung.id}: vorher und nachher sind verschieden`);
		pruefe(statusOf(original, ersetzung.id), "gesperrt", `${ersetzung.id}: Anker im Nachbau genau einmal`);
		const einmal = applyToSource(original, ersetzung.id);
		pruefe(einmal.changed, true, `${ersetzung.id}: einspielen aendert etwas`);
		pruefe(applyToSource(einmal.source, ersetzung.id).changed, false, `${ersetzung.id}: zweimal einspielen ist harmlos`);
		const zurueck = revertFromSource(einmal.source, ersetzung.id);
		pruefe(zurueck.changed, true, `${ersetzung.id}: zuruecknehmen aendert etwas`);
		pruefe(zurueck.source, original, `${ersetzung.id}: Ruecknahme stellt den Ausgangstext her`);
		pruefe(applyToSource("nichts davon hier", ersetzung.id).error !== undefined, true, `${ersetzung.id}: fremder Text wird abgelehnt`);
	}

	// 2) Alle drei zusammen, in jeder Reihenfolge, und die Ruecknahme in der Gegenreihenfolge.
	let alle = original;
	for (const e of ERSETZUNGEN) alle = applyToSource(alle, e.id).source;
	pruefe(ERSETZUNGEN.every((e) => statusOf(alle, e.id) === "freigegeben"), true, "alle drei eingespielt, alle drei erkannt");
	let ruecklauf = alle;
	for (const e of [...ERSETZUNGEN].reverse()) ruecklauf = revertFromSource(ruecklauf, e.id).source;
	pruefe(ruecklauf, original, "alles zurueck ergibt den Ausgangstext");

	// 3) Das eingespielte Modul muss syntaktisch laufen und das Verhalten haben.
	const werkstatt = mkdtempSync(join(tmpdir(), "rolle-test-"));
	try {
		const rollenOrdner = join(werkstatt, "rollen");
		mkdirSync(rollenOrdner);
		writeFileSync(join(rollenOrdner, "probe.md"), "ROLLE PROBE\n\n---\n\nAUFTRAG\n\n");
		writeFileSync(join(rollenOrdner, "_vorlage.md"), "keine Rolle");
		const hilfe = HILFE.nachher.split("\n").filter((z) => !z.startsWith("import z ")).join("\n");
		const modul = join(werkstatt, "hilfe.mjs");
		writeFileSync(modul, `${hilfe}\nexport { subagentRolleVoran, subagentRollenListe };\n`);
		process.env.DSH_ROLLEN_DIR = rollenOrdner;
		const m = await import(modul);
		pruefe(m.subagentRollenListe(), ["probe"], "Aufzaehlung: nur echte Rollen, Vorlage mit _ nicht");
		pruefe(m.subagentRolleVoran(undefined, "Sache"), "Sache", "ohne Rolle bleibt der Auftrag unveraendert");
		pruefe(m.subagentRolleVoran("", "Sache"), "Sache", "leere Rolle bleibt der Auftrag unveraendert");
		pruefe(m.subagentRolleVoran("probe", "Sache"), "ROLLE PROBE\n\n---\n\nAUFTRAG\n\nSache", "Rolle steht byte-gleich vor dem Auftrag");
		pruefe(m.subagentRolleVoran("probe", "Sache") === m.subagentRolleVoran("probe", "Sache"), true, "zwei Aufrufe erzeugen denselben Anfang");
		for (const boese of ["gibtsnicht", "../probe", "Probe", "_vorlage", "probe.md"]) {
			let meldung = "";
			try { m.subagentRolleVoran(boese, "x"); } catch (fehler) { meldung = String(fehler.message); }
			pruefe(meldung.includes("Unbekannte Rolle") && meldung.includes("probe"), true, `Rolle "${boese}" wird abgelehnt und nennt die vorhandenen`);
		}
	} finally {
		rmSync(werkstatt, { recursive: true, force: true });
	}

	// 4) Die eingefuegten Texte tragen die Kennung und haengen am richtigen Ort.
	pruefe(AUFTRAG.nachher.includes("args.rolle") && AUFTRAG.nachher.includes("args.prompt"), true, "Auftrag gibt Rolle und Auftrag weiter");
	pruefe(SCHEMA.nachher.includes("rolle: {"), true, "Schema enthaelt das Feld rolle");
	pruefe(HILFE.nachher.includes("\\n\\n"), true, "Hilfsfunktion fuegt zwei Zeilenumbrueche ein (als Text, nicht als echter Umbruch)");

	console.log(fehlgeschlagen === 0 ? "Selbstpruefung: alles in Ordnung." : `Selbstpruefung: ${fehlgeschlagen} Fehler.`);
	process.exitCode = fehlgeschlagen === 0 ? 0 : 1;
}
