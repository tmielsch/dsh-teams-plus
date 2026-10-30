/**
 * goals-for-subagents — Ziele auch fuer Teammitglieder und Unteragenten
 * ======================================================================
 *
 * WAS DER MENSCH WOLLTE (Anordnung 2026-10-25)
 * "Goals und todos sollten auch team mates und subagents zur verfuegung
 * stehen." Anlass war der Bericht eines Teammitglieds: `create_goal` wird bei
 * ihm abgelehnt mit "this goal operation requires a direct human turn on a
 * top-level agent". Es hat das als Systemgrenze gemeldet und nicht weiter
 * versucht — richtig gelesen, aber die Grenze war nicht gewollt.
 *
 * WAS SCHIEF STAND — und was NICHT (gemessen 2026-10-25, dsh 0.2.0-rc.2)
 *   - `todo_write` hat KEINE solche Sperre. Die Ablage haengt an der SITZUNG
 *     (`todo/write`-Ereignisse am aufrufenden Agenten), ein Teammitglied kann
 *     sie also schon heute benutzen. Wer dort einen Fehler sieht, sieht einen
 *     anderen: nicht die Sitzungsart, sondern etwa doppelte Aufgabe oder
 *     mehrere `in_progress` bei abgeschalteter Parallelitaet. Dieses Modul
 *     aendert daran nichts und muss es auch nicht.
 *   - `goal-round-driver` (der Antrieb, der Runden nachschiebt) hat ebenfalls
 *     keine Sperre; er arbeitet auf jeder Sitzung, die ein Ziel hat.
 *   - Genau EINE Stelle sperrt: `@deepseek-ai/dsh-tool-goal`, Funktion
 *     `hasDirectHumanInput`. Sie verlangt zweierlei zugleich — die Sitzung
 *     muss in `ctx.agents.roots()` stehen (`roots()` liefert nur Agenten ohne
 *     Besitzer, also nie eine Kind-Sitzung), UND im offenen Zug muss eine
 *     Nachricht der Art `user` liegen.
 *   - Eine erste Fassung dieses Moduls liess fuer Kind-Sitzungen nur
 *     `agent-message` zu. Das erreicht Unteragenten (Dienst `subagents`), aber
 *     KEIN Teammitglied: das bekommt seine Nachrichten ueber die Team-Mailbox
 *     mit der Art `team-message`. Am 2026-10-25 um 01:30 UTC kam deshalb
 *     weiterhin "requires a direct human turn on a top-level agent". Die
 *     Team-Mailbox stellt auch zwischen Geschwistern zu; sie zaehlt daher nur,
 *     wenn der Absender die eigene `parentSession` ist.
 *
 * WAS DIESES MODUL TUT (eine Ersetzung, eine Datei)
 * Es hebt beide Bedingungen in EINER Funktion auf und laesst drei
 * gleichwertige Auftragsquellen zu:
 *   1. `user` — die menschliche Nachricht, wie bisher;
 *   2. `agent-message` — der Auftrag des direkten Elternteils an einen
 *      Unteragenten;
 *   3. `team-message` — derselbe Auftrag an ein Teammitglied, das seine
 *      Nachrichten ueber die Team-Mailbox bekommt.
 * Punkt 2 ist keine Aufweichung, sondern die vorhandene Ordnung:
 * `agent-message` kann laut `MessageSourceMap` nur der Dienst `subagents`
 * erzeugen (`agentMessageSource`), und der stellt ausschliesslich zwischen
 * direkt benachbarten Sitzungen zu — Eltern zu Kind, Kind zu Eltern. Eine
 * solche Nachricht ist immer ein Auftrag von oben.
 * Punkt 3 gilt nur, wenn der Absender die eigene `parentSession` ist. Die
 * Team-Mailbox stellt naemlich auch zwischen Geschwistern zu; eine Nachricht
 * des Nachbarn ist kein Auftrag von oben und oeffnet deshalb keine Ziele.
 * Der Sinn der Sperre — "das Modell soll sich nicht selbst Ziele geben" —
 * bleibt erhalten: alles, was ein Agent von sich aus tut, traegt andere Arten
 * (`model`, `tool`, `goal`, `subagent-settled`, `system-prompt` ...). Keine
 * davon oeffnet die Ziele.
 *
 * WAS UNVERAENDERT BLEIBT
 *  - `edit`, `pause`, `resume` verlangen weiterhin Autoritaet; der Eingriff
 *    aendert nur, WER sie haben kann, nicht WOFUER.
 *  - `complete` und `blocked` laufen ueber `completionAuthority` und
 *    funktionieren unveraendert, samt Rundenschwelle und Abschlusstext.
 *  - Ein pausiertes Ziel kann das Modell weiterhin nicht selbst aufnehmen.
 *  - Die zweite Ersetzung betrifft nur den Beschreibungstext: er sprach vom
 *    "direct human request". Ein Teammitglied, das ihn liest, haette weiter
 *    gezaudert. Jetzt nennt er den Auftrag von oben ausdruecklich.
 *
 * WARUM EIN DATEI-EINGRIFF UND KEIN PLUGIN
 * `hasDirectHumanInput` ist eine Modul-Variable im Paket; sie ist von aussen
 * nicht erreichbar. Ein Cordis-Plugin koennte nur `definition.execute`
 * ersetzen — dann muesste es die ganze Werkzeug-Logik nachbauen (Rundenschwelle,
 * Abschlusstext, Fehlercodes) und liefe bei jedem Update auseinander. Eine
 * Ersetzung des einen Ausdrucks ist kleiner, ehrlicher und mit einem Befehl
 * ruecknehmbar. Der Host laedt das Modul beim Start, deshalb ist danach ein
 * Neustart noetig — wie bei `allow-subagent-files.mjs`.
 *
 * RUECKGAENGIG
 *   node ~/.dsh/patches/allow-subagent-goals.mjs --revert
 *   danach `dsh web` neu starten.
 *
 * Selbstpruefung (ohne Datei-Eingriff):
 *   node ~/.dsh/patches/goals-for-subagents.mjs --test
 * Protokoll: ~/.dsh/logs/goals-for-subagenten.log
 */

import { appendFileSync, readFileSync, renameSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Paket, dessen eine Funktion gehoben wird. */
export const PAKET = "@deepseek-ai/dsh-tool-goal";

/** Kennung im Quelltext; ihr Vorhandensein heisst "schon freigegeben". */
export const MARKER = "goalsForSubagents";

/**
 * Die eine Ersetzung, die zaehlt.
 *
 * Bewusst der GANZE Funktionskoerper, nicht ein Teilstueck: so ist in beide
 * Richtungen eindeutig, was gemeint war, und die Nachkontrolle kann pruefen,
 * ob genau diese Fassung steht.
 */
export const AUTORITAET = {
	id: "autoritaet",
	was: "Goal-Autoritaet: Kind-Sitzungen duerfen Ziele, Wurzelsitzung nur auf Zuruf des Menschen",
	datei: "lib/index.js",
	vorher: `function hasDirectHumanInput(ctx, execution) {
	if (!ctx.agents.roots().includes(execution.agent)) return false;
	return someOpenTurnEvent(execution, (event) => event.type === "user/message" && event.data.source.kind === "user");
}`,
	nachher: `function hasDirectHumanInput(ctx, execution) {
	// goalsForSubagents: drei Auftragsquellen, eine Ordnung.
	//
	// 1. Eine Kind-Sitzung steht nie in roots() (roots() liefert nur Agenten ohne
	//    Besitzer), und ihr Auftrag von oben traegt nicht die Art "user". Beides
	//    zusammen sperrte Teammitglieder und Unteragenten aus. Fuer sie gilt
	//    jetzt: menschliche Nachricht ODER Auftrag des direkten Elternteils.
	// 2. Der Weg des Elternteils haengt an der Sitzungsart: ein Unteragent
	//    bekommt "agent-message" (Dienst subagents), ein Teammitglied
	//    "team-message" (Team-Mailbox). Die Mailbox stellt auch zwischen
	//    Geschwistern zu; deshalb zaehlt dort nur, wenn senderId die eigene
	//    parentSession ist.
	// 3. Eine WURZELSITZUNG (der Team Lead, also die Sitzung, mit der der Mensch
	//    spricht) bleibt auf die menschliche Nachricht beschraenkt. Ohne diesen
	//    Zusatz koennte ein Teammitglied dem Lead per Nachricht ein Ziel
	//    unterschieben, und der Lead wuerde von allein Runden weiterarbeiten und
	//    Kontingent verbrauchen. Die Ordnung ist: von oben nach unten eine
	//    Anweisung, von unten nach oben nur ein Vorschlag — und ueber ein Ziel des
	//    Leads entscheidet der Mensch, nicht ein Teammitglied.
	//
	// Der Sinn der urspruenglichen Sperre bleibt gewahrt: "agent-message" erzeugt
	// ausschliesslich der Dienst subagents zwischen direkt benachbarten
	// Sitzungen; "team-message" zaehlt nur vom direkten Elternteil. Eigeninitiative
	// (model, tool, goal, subagent-settled) oeffnet weiterhin keine Ziele.
	const istWurzel = ctx.agents.roots().includes(execution.agent);
	const elternSitzung = execution.agent.session.header.parentSession;
	return someOpenTurnEvent(execution, (event) => {
		if (event.type !== "user/message") return false;
		const quelle = event.data.source;
		if (quelle.kind === "user") return true;
		if (istWurzel) return false;
		if (quelle.kind === "agent-message") return true;
		return quelle.kind === "team-message" && elternSitzung !== undefined && quelle.senderId === elternSitzung;
	});
}`
};

/**
 * Die Beschreibung, die einem Teammitglied sagt, dass es Ziele anlegen darf.
 *
 * Ohne diese zweite Ersetzung waere der Eingriff halb: das Werkzeug ginge,
 * aber der Text spraeche weiter nur von einem menschlichen Auftrag, und ein
 * Agent, der seine Anweisungen ernst nimmt, wuerde es nicht versuchen.
 */
export const BESCHREIBUNG = {
	id: "beschreibung",
	was: "Beschreibung: Auftrag von oben ausdruecklich nennen",
	datei: "lib/index.js",
	vorher: `const CREATE_DESCRIPTION = "Create a persisted goal that keeps this session working across automatic continuation rounds. Use it when the direct human request is a long-running objective, even if the user did not say \\"goal\\"; not for single-turn work.";`,
	nachher: `const CREATE_DESCRIPTION = "Create a persisted goal that keeps this session working across automatic continuation rounds. Use it when a task you were given is a long-running objective, even if nobody said \\"goal\\"; not for single-turn work. ${MARKER}: this works for a direct human request AND for a task delegated to you by another agent (a Team Lead or a parent session), so a teammate or subagent may create a goal for the work it was handed.";`
};

/** Beide Ersetzungen in Anwendungsreihenfolge. */
export const ERSETZUNGEN = [AUTORITAET, BESCHREIBUNG];

/** Schreibt eine Zeile ins Protokoll; ein Fehler dabei stoert nie. */
export function protokolliere(text) {
	try {
		const pfad = process.env.DSH_GOALS_SUBAGENTEN_LOG ?? join(homedir(), ".dsh", "logs", "goals-for-subagenten.log");
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
		return { changed: false, error: "Die Nachkontrolle nach dem Schreiben ist fehlgeschlagen; der vorherige Stand wurde wiederhergestellt." };
	}
	return { changed: true, steps: ergebnis.steps, pfad };
}

// ---------------------------------------------------------------------------
// Selbstpruefung: node ~/.dsh/patches/goals-for-subagents.mjs --test
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
	}

	// Die neue Fassung muss ALLE Auftragsquellen fuer Kind-Sitzungen nennen und
	// fuer die Wurzelsitzung den Auftrag von oben ausschliessen. Das ist der
	// ganze Zweck; ein Tippfehler hier waere still.
	pruefe(AUTORITAET.nachher.includes('kind === "user"'), true, "die menschliche Quelle bleibt");
	pruefe(AUTORITAET.nachher.includes('kind === "agent-message"'), true, "der Auftrag des Elternteils an den Unteragenten kommt dazu");
	pruefe(AUTORITAET.nachher.includes('kind === "team-message"'), true, "der Auftrag des Elternteils an das Teammitglied kommt dazu");
	pruefe(AUTORITAET.nachher.includes("senderId === elternSitzung"), true, "die Team-Nachricht zaehlt nur vom direkten Elternteil");
	pruefe(AUTORITAET.nachher.includes("header.parentSession"), true, "der Elternteil wird aus der Sitzung gelesen");
	pruefe(AUTORITAET.nachher.includes("if (istWurzel) return false;"), true, "der Auftrag von oben gilt NUR fuer Kind-Sitzungen");
	pruefe(AUTORITAET.nachher.includes("roots()"), true, "die Wurzel wird weiterhin bestimmt");
	pruefe(AUTORITAET.nachher.includes(MARKER), true, "die Kennung steht darin");
	pruefe(AUTORITAET.nachher.includes("someOpenTurnEvent"), true, "der offene Zug wird weiter geprueft");
	// Der Grund fuer die Sperre bleibt: Eigeninitiative oeffnet nichts.
	for (const art of ["model", "tool", "goal", "subagent-settled"]) {
		pruefe(AUTORITAET.nachher.includes(`kind === "${art}"`), false, `die Eigeninitiative-Art "${art}" oeffnet keine Ziele`);
	}

	console.log(fehlgeschlagen === 0 ? "Selbstpruefung: alles in Ordnung." : `Selbstpruefung: ${fehlgeschlagen} Fehler.`);
	process.exitCode = fehlgeschlagen === 0 ? 0 : 1;
}
