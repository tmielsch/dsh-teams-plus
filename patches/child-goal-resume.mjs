/**
 * child-goal-resume — ein Teammitglied darf sein pausiertes Ziel wieder aufnehmen
 * ==============================================================================
 *
 * WAS DER MENSCH GEMELDET HAT (2026-10-25)
 * Ein Teammitglied verfolgte ein eigenes Ziel, das Ziel wurde pausiert — und
 * danach ging von keiner Seite mehr etwas: er konnte nicht starten, nicht
 * loeschen, nicht editieren, kein Rollback. Beim Teammitglied „strata-hda-experte"
 * (Sitzung ec5d9db0) stand das Ziel `goal-0c20397d` auf `paused`.
 *
 * WARUM DAS EINE ECHTE SACKGASSE WAR
 * Drei Wege fuehren zu einem Ziel, und alle drei waren zu:
 *   1. DAS MODELL darf ein pausiertes Ziel nicht fortsetzen; im Werkzeug steht
 *      dafuer hart `GOAL_TOOL_RESUME_PAUSED` („the model cannot resume a paused
 *      goal; the user must resume it").
 *   2. DER MENSCH darf es — aber nur ueber die Zielkarte, und die laeuft ueber
 *      den Agent-Lookup des Gateways. Ist der Teammate untaetig, entsorgt DSH
 *      seinen Agenten, und dann findet dieser Lookup nichts mehr
 *      (`gateway/lookup-not-found`).
 *   3. Bleibt die Nachricht an das Kind: die weckt es wieder (`subagents.prompt`
 *      loest kalt auf). Aber der geweckte Agent bekommt genau dann keine
 *      Erlaubnis, sein eigenes Ziel aufzunehmen — Weg 1.
 * Ergebnis: Das Ziel stand still, und niemand konnte es anstossen.
 *
 * WAS DIESES MODUL TUT (zwei Ersetzungen, eine Datei)
 *   1. Die Sperre gilt nur noch fuer eine WURZELSITZUNG. Eine Kind-Sitzung
 *      (Teammitglied, Unteragent) darf ihr pausiertes Ziel aufnehmen, wenn sie
 *      die Autoritaet dazu hat. Die Autoritaet prueft weiterhin
 *      `requireDirectHuman`, und die ist durch `goals-for-subagents.mjs` fuer
 *      Kind-Sitzungen bereits geoeffnet: menschliche Nachricht ODER Auftrag des
 *      direkten Elternteils. Eigeninitiative (model, tool, goal) oeffnet nichts.
 *   2. Der Beschreibungstext sagt das auch. Sonst liest ein Teammitglied weiter
 *      „requires a direct top-level human request" und versucht es gar nicht —
 *      die Sperre waere weg, die Wirkung nicht da.
 *
 * WARUM DIE WURZELSITZUNG GESPERRT BLEIBT
 * Der Lead ist die Sitzung, mit der der Mensch spricht. Sein pausiertes Ziel
 * wieder scharf zu schalten ist eine Entscheidung ueber Kontingent, und die
 * trifft der Mensch. Ein Modell, das sich selbst wieder in Gang setzt, wuerde
 * genau die Pause aufheben, die der Mensch eingelegt hat.
 *
 * WARUM EIN DATEI-EINGRIFF UND KEIN PLUGIN
 * Die Sperre ist ein Ausdruck im Rumpf von `execute`; von aussen ist sie nicht
 * erreichbar. Ein Plugin muesste das ganze Werkzeug nachbauen (Rundenschwelle,
 * Abschlusstext, Fehlercodes). Zwei Ersetzungen sind kleiner und ruecknehmbar.
 * Der Host hat das Modul beim Start geladen; danach ist ein Neustart noetig.
 *
 * ZUSAMMENHANG
 * Dieses Modul ist der zweite Teil; der erste ist `child-session-routing.mjs`.
 * Ohne ihn bleibt die Bedienung einer lebenden Kind-Sitzung gesperrt. Mit beiden
 * gilt: ein lebendes Kind ist bedienbar (umbenennen, gabeln, Modell, Rollback),
 * ein untaetiges Kind weckt man mit einer Nachricht, und der geweckte Agent darf
 * sein pausiertes Ziel aufnehmen, weil die Nachricht die Autoritaet traegt.
 *
 * RUECKGAENGIG
 *   node ~/.dsh/patches/allow-child-goal-resume.mjs --revert
 *   danach `dsh web` neu starten.
 *
 * Selbstpruefung (ohne Datei-Eingriff):
 *   node ~/.dsh/patches/child-goal-resume.mjs --test
 * Protokoll: ~/.dsh/logs/child-goal-resume.log
 */

import { appendFileSync, readFileSync, renameSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Paket, dessen eine Datei angefasst wird. */
export const PAKET = "@deepseek-ai/dsh-tool-goal";

/** Kennung im Quelltext; ihr Vorhandensein heisst "schon freigegeben". */
export const MARKER = "childGoalResumeAllowed";

/**
 * Die erste Ersetzung: die Sperre gilt nur noch fuer die Wurzelsitzung.
 *
 * `ctx.agents.roots()` liefert genau die Agenten ohne Besitzer — also den Lead
 * und jede Sitzung, die der Mensch selbst geoeffnet hat. Eine Kind-Sitzung
 * steht dort nie.
 */
export const WIEDERAUFNAHME = {
	id: "wiederaufnahme",
	was: "Wiederaufnahme: ein pausiertes Ziel einer Kind-Sitzung ist aufnehmbar",
	datei: "lib/index.js",
	vorher: `\t\t\t\tif (args.action === "resume" && current?.id === ref.id && current.revision === ref.revision && current.phase === "paused") throw new HarnessError("the model cannot resume a paused goal; the user must resume it", "GOAL_TOOL_RESUME_PAUSED");`,
	nachher: `\t\t\t\t// ${MARKER}: die Sperre gilt nur fuer die Wurzelsitzung.
\t\t\t\t//
\t\t\t\t// Ein pausiertes Ziel eines Teammitglieds war sonst von keiner Seite mehr zu
\t\t\t\t// erreichen: der Mensch kommt ueber die Zielkarte an einen Agenten, den DSH
\t\t\t\t// entsorgt hat (Lookup findet nichts), das Modell war hier gesperrt, und eine
\t\t\t\t// Nachricht an das Kind weckt es zwar wieder, gab ihm aber keine Erlaubnis.
\t\t\t\t//
\t\t\t\t// Die Autoritaet bleibt Pflicht: requireDirectHuman ist zwei Zeilen weiter
\t\t\t\t// oben schon gelaufen und laesst fuer eine Kind-Sitzung die menschliche
\t\t\t\t// Nachricht ODER den Auftrag des direkten Elternteils zu — Eigeninitiative
\t\t\t\t// (model, tool, goal) nicht. In der Wurzelsitzung bleibt es beim Menschen,
\t\t\t\t// weil ein selbst wieder scharf geschaltetes Ziel genau die Pause aufhebt,
\t\t\t\t// die der Mensch eingelegt hat.
\t\t\t\tif (args.action === "resume" && current?.id === ref.id && current.revision === ref.revision && current.phase === "paused" && ctx.agents.roots().includes(execution.agent)) throw new HarnessError("the model cannot resume a paused goal; the user must resume it", "GOAL_TOOL_RESUME_PAUSED");`
};

/**
 * Die zweite Ersetzung: der Text, den das Modell liest.
 *
 * Ohne sie bliebe die Freigabe unsichtbar: ein Teammitglied, das seinen
 * Anweisungen folgt, liest „requires a direct top-level human request" und
 * laesst die Finger davon.
 */
export const BESCHREIBUNG = {
	id: "beschreibung",
	was: "Beschreibung: der Auftrag des Elternteils oeffnet diese Aktionen mit",
	datei: "lib/index.js",
	vorher: `\t\t\t\tdescription: "edit, pause, and resume require a direct top-level human request. complete and blocked are also allowed during an automatic continuation of this goal; blocked is rejected before the configured minimum round count."`,
	nachher: `\t\t\t\tdescription: "edit, pause, and resume require a direct request: in a top-level session that is a human request; in a teammate or subagent session a task from your direct parent counts too. ${MARKER}: a child session may resume its own paused goal on such a request. complete and blocked are also allowed during an automatic continuation of this goal; blocked is rejected before the configured minimum round count."`
};

/** Beide Ersetzungen in Anwendungsreihenfolge. */
export const ERSETZUNGEN = [WIEDERAUFNAHME, BESCHREIBUNG];

/** Schreibt eine Zeile ins Protokoll; ein Fehler dabei stoert nie. */
export function protokolliere(text) {
	try {
		const pfad = process.env.DSH_CHILD_GOAL_LOG ?? join(homedir(), ".dsh", "logs", "child-goal-resume.log");
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

/** Reine Textumwandlung: freigeben. Wirft nie, meldet stattdessen. */
export function applyToSource(source, id) {
	const ersetzung = ERSETZUNGEN.find((e) => e.id === id);
	if (ersetzung === undefined) return { changed: false, error: `unbekannte Stelle "${id}"` };
	if (statusOf(source, id) === "freigegeben") return { changed: false, source, steps: [] };
	const n = zaehle(source, ersetzung.vorher);
	if (n !== 1) {
		return { changed: false, error: `Die Stelle "${ersetzung.was}" kommt ${n} mal vor (erwartet: genau 1). Nach einem DSH-Update hat sich der Code geaendert; es wurde nichts geschrieben.` };
	}
	return { changed: true, source: source.replace(ersetzung.vorher, ersetzung.nachher), steps: [ersetzung.was] };
}

/** Reine Textumwandlung: zuruecknehmen. */
export function revertFromSource(source, id) {
	const ersetzung = ERSETZUNGEN.find((e) => e.id === id);
	if (ersetzung === undefined) return { changed: false, error: `unbekannte Stelle "${id}"` };
	if (statusOf(source, id) !== "freigegeben") return { changed: false, source, steps: [] };
	const n = zaehle(source, ersetzung.nachher);
	if (n !== 1) {
		return { changed: false, error: `Die freigegebene Stelle "${ersetzung.was}" kommt ${n} mal vor (erwartet: genau 1). Zuruecknehmen waere unsicher; es wurde nichts geschrieben.` };
	}
	return { changed: true, source: source.replace(ersetzung.nachher, ersetzung.vorher), steps: [ersetzung.was] };
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

/** Freigabe auf eine Datei anwenden. */
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

/** Freigabe auf eine Datei zuruecknehmen. */
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
		return { changed: false, error: "Die Nachkontrolle nach dem Zuruecknehmen ist fehlgeschlagen; der vorherige Stand wurde wiederhergestellt." };
	}
	return { changed: true, steps: ergebnis.steps, pfad };
}

// ---------------------------------------------------------------------------
// Selbstpruefung: node ~/.dsh/patches/child-goal-resume.mjs --test
// Reine Textumwandlung, ohne eine Datei anzufassen.
// ---------------------------------------------------------------------------
if (process.argv.includes("--test")) {
	let fehlgeschlagen = 0;
	const pruefe = (ist, soll, was) => {
		if (JSON.stringify(ist) !== JSON.stringify(soll)) {
			fehlgeschlagen += 1;
			console.log(`FEHLER  ${was}: ${JSON.stringify(ist)}, erwartet ${JSON.stringify(soll)}`);
		}
	};

	for (const ersetzung of ERSETZUNGEN) {
		pruefe(ersetzung.vorher === ersetzung.nachher, false, `${ersetzung.id}: vorher und nachher sind verschieden`);
		const einmal = applyToSource(ersetzung.vorher, ersetzung.id);
		pruefe(einmal.changed, true, `${ersetzung.id}: freigeben aendert etwas`);
		pruefe(applyToSource(einmal.source, ersetzung.id).changed, false, `${ersetzung.id}: zweimal freigeben ist harmlos`);
		const zurueck = revertFromSource(einmal.source, ersetzung.id);
		pruefe(zurueck.changed, true, `${ersetzung.id}: zuruecknehmen aendert etwas`);
		pruefe(zurueck.source, ersetzung.vorher, `${ersetzung.id}: Ruecknahme stellt den Ausgangstext her`);
		pruefe(applyToSource("nichts davon hier", ersetzung.id).error !== undefined, true, `${ersetzung.id}: fremder Text wird abgelehnt`);
		pruefe(ersetzung.nachher.includes(MARKER), true, `${ersetzung.id}: die Kennung steht darin`);
	}

	// Der Zweck, als Text pruefbar.
	pruefe(WIEDERAUFNAHME.nachher.includes("ctx.agents.roots().includes(execution.agent)"), true, "die Wurzelsitzung bleibt gesperrt");
	pruefe(WIEDERAUFNAHME.nachher.includes("GOAL_TOOL_RESUME_PAUSED"), true, "der Fehlercode bleibt fuer die Wurzelsitzung erhalten");
	pruefe(WIEDERAUFNAHME.nachher.includes('current.phase === "paused"'), true, "die Phase wird weiter geprueft");
	pruefe(WIEDERAUFNAHME.nachher.includes("requireDirectHuman"), true, "die Autoritaet wird als Bedingung genannt");
	pruefe(BESCHREIBUNG.nachher.includes("direct parent"), true, "der Auftrag des Elternteils steht im Text");
	pruefe(BESCHREIBUNG.nachher.includes("top-level session"), true, "die Wurzelsitzung bleibt im Text erkennbar");

	console.log(fehlgeschlagen === 0 ? "Selbstpruefung: alles in Ordnung." : `Selbstpruefung: ${fehlgeschlagen} Fehler.`);
	process.exitCode = fehlgeschlagen === 0 ? 0 : 1;
}
