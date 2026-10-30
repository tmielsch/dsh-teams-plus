/**
 * child-session-routing — eine LEBENDE Kind-Sitzung bleibt bedienbar
 * ==================================================================
 *
 * WAS DER MENSCH GEMELDET HAT (2026-10-25)
 * Beim Teammitglied „strata-hda-experte" (Sitzung ec5d9db0, ein Unteragent des
 * Lead) kam bei Starten, Loeschen, Umbenennen und Rollback:
 *
 *   session "ec5d9db0-…" is owned by subagent routing
 *
 * Besonders schlimm war es, wenn das eigene Ziel des Teammitglieds pausiert
 * war: dann war von keiner Seite mehr etwas zu machen.
 *
 * WAS SCHIEF STEHT — gemessen am 2026-10-25, dsh 0.2.0-rc.2
 * Der Kern (@deepseek-ai/dsh-api-session-controller) hat genau EINE gemeinsame
 * Pruefung, `hasApiSessionSubagentOwner`: sie sagt „fuer diese Sitzung ist das
 * Unteragenten-Routing zustaendig", sobald `header.origin === "subagent"` ist.
 * Diese Pruefung sitzt unter anderem in `liveAgent()`, und `liveAgent()` ist die
 * erste Station von `resolve()` — also der Aufloesung, die der Agent-Lookup des
 * Gateways benutzt.
 *
 * Damit haengen an EINER Sperre:
 *   - goals.*    (Zielkarte: fortsetzen, pausieren, bearbeiten)
 *   - commands.* (/rollback, /goal, /plan …)
 *   - session.rename, session.selectModel
 *   - terminal.*, fileUploads.*, userQuestions.*
 *
 * Folgen, die der Mensch gespuerrt hat:
 *   - Ein pausiertes Ziel ist von aussen nicht zu erreichen. Der Mensch darf es
 *     fortsetzen, das Modell nicht (`GOAL_TOOL_RESUME_PAUSED`), und die
 *     Zielkarte kann es nicht, weil hinter ihr derselbe Lookup steht.
 *   - Das Rollback-Plugin (`@domitor-syh/dsh-rollback`) holt seine Sitzung aus
 *     dem Befehl und findet sie nie.
 *   - Umbenennen, Gabeln, Modellwahl: alles gesperrt.
 *
 * WAS UNVERAENDERT BLEIBT — und warum
 *   - Die ZUSTELLUNG bleibt auf dem Kind-Weg. `prompt` prueft die
 *     Eigentuemerschaft weiterhin und wirft dasselbe `session/agent-busy`. Denn
 *     nur `subagents.prompt` prueft Aufenthaltsraum, Eigentuemer, Katalog und die
 *     Bildfaehigkeit des festen Kind-Modells, und nur dort wird die Zustellung
 *     als `announced` gebucht. Ein zweiter Zustellweg waere eine stille zweite
 *     Buchhaltung.
 *   - `cancel()` behaelt seine Sperre; der Kind-Weg heisst dort
 *     `subagents.interruptByParent` und wird von der Oberflaeche schon benutzt.
 *   - Eine KALTE Kind-Sitzung bleibt gesperrt. `resolve()` und
 *     `resumeObserved()` und `createOrAdopt()` werden nicht angefasst. Der
 *     Grund ist wichtig: ein kaltes Kind ueber den gewoehnlichen Weg zu wecken
 *     erzeugte einen Agenten OHNE Eigentuemer (Wurzelsitzung), waehrend das
 *     Unteragenten-Routing ihn spaeter erneut aufbauen will — dann kollidieren
 *     zwei Aufenthaltsraeume fuer dieselbe Sitzung. Ein kaltes Kind weckt man
 *     ueber eine Nachricht (subagents.prompt), dann ist es lebend und alles
 *     hier greift.
 *   - Der Kern behaelt seine Sperre fuer alles, was in `ensureSession`,
 *     `createOrAdopt`, `updateQueue` und `validateAddress` haengt.
 *
 * WAS DIESES MODUL TUT (zwei Ersetzungen, eine Datei)
 *   1. `liveAgent()` nimmt einen LEBENDEN Kind-Agenten an.
 *   2. `prompt()` prueft die Eigentuemerschaft ausdruecklich selbst, damit die
 *      Zustellung genau wie bisher abgewiesen wird.
 * Zusammen: Lesen und Verwalten offen, Zustellen unveraendert gesperrt.
 *
 * WARUM EIN DATEI-EINGRIFF UND KEIN PLUGIN
 * `liveAgent` ist eine Methode im Rumpf der Host-Klasse, nicht ueber einen
 * Dienst erreichbar. Ein Cordis-Plugin koennte nur den ganzen Controller
 * ersetzen und muesste Wiederaufnahme, Projektionen und den Fortschrittskanal
 * nachbauen. Zwei Ersetzungen sind kleiner und mit einem Befehl ruecknehmbar.
 * Der Host hat das Modul beim Start geladen; danach ist ein Neustart noetig.
 *
 * RUECKGAENGIG
 *   node ~/.dsh/patches/allow-child-session-routing.mjs --revert
 *   danach `dsh web` neu starten.
 *
 * Selbstpruefung (ohne Datei-Eingriff):
 *   node ~/.dsh/patches/child-session-routing.mjs --test
 * Protokoll: ~/.dsh/logs/child-session-routing.log
 */

import { appendFileSync, readFileSync, renameSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Paket, dessen eine Datei angefasst wird. */
export const PAKET = "@deepseek-ai/dsh-api-session-controller";

/** Kennung im Quelltext; ihr Vorhandensein heisst "schon freigegeben". */
export const MARKER = "childSessionRoutingAllowed";

/**
 * Die erste Ersetzung: `liveAgent` nimmt einen lebenden Kind-Agenten an.
 *
 * Bewusst der GANZE Methodenkoerper, damit in beide Richtungen eindeutig ist,
 * was gemeint war.
 */
export const LEBENDER_AGENT = {
	id: "lebender-agent",
	was: "Agent-Lookup: eine lebende Kind-Sitzung wird angenommen",
	datei: "lib/index.js",
	vorher: `\tliveAgent(sessionId) {
\t\tconst agent = this.ctx.agents.get(sessionId);
\t\tif (agent === void 0) return void 0;
\t\treturn hasApiSessionSubagentOwner(this.ctx, agent.session, agent) ? { error: apiSessionSubagentOwnershipError(sessionId) } : { agent };
\t}`,
	nachher: `\tliveAgent(sessionId) {
\t\tconst agent = this.ctx.agents.get(sessionId);
\t\tif (agent === void 0) return void 0;
\t\t// ${MARKER}: eine LEBENDE Kind-Sitzung wird angenommen.
\t\t//
\t\t// Der Kern sperrte hier jede Sitzung mit origin "subagent" — auch wenn ihr
\t\t// Agent lief. An dieser einen Pruefung hingen Zielkarte (goals.*), Befehle
\t\t// (commands.*, also auch /rollback), Umbenennen, Modellwahl und Terminal.
\t\t// Ein pausiertes Ziel eines Teammitglieds war damit von keiner Seite mehr zu
\t\t// erreichen: der Mensch darf es fortsetzen, das Modell nicht, und der Weg
\t\t// des Menschen endete hier.
\t\t//
\t\t// Nur der LEBENDE Fall wird geoeffnet. Dieser Zweig kennt gar keinen anderen:
\t\t// resolve und resumeObserved behalten ihre Sperre fuer kalte Sitzungen,
\t\t// damit ein kaltes Kind nicht als eigentuemerloser Agent neben dem
\t\t// Unteragenten-Routing entsteht.
\t\treturn { agent };
\t}`
};

/**
 * Die zweite Ersetzung: die Zustellung bleibt auf dem Kind-Weg.
 *
 * Ohne diese Zeile waere die Freigabe halb: `session.prompt` auf einer lebenden
 * Kind-Sitzung liefe am Unteragenten-Routing vorbei — ohne Pruefung des
 * Aufenthaltsraums, ohne Eigentuemer-Buchung, ohne Katalog-Eintrag und ohne die
 * Bildpruefung des festen Kind-Modells.
 */
export const ZUSTELLUNG = {
	id: "zustellung",
	was: "Zustellung: session.prompt weist eine Kind-Sitzung weiterhin auf den Kind-Weg",
	datei: "lib/index.js",
	vorher: `\t\tconst agent = await this.resolveAgent(request.sessionId);
\t\tif (hasPromptRequest(agent, request.requestId)) return { accepted: true };`,
	nachher: `\t\tconst agent = await this.resolveAgent(request.sessionId);
\t\t// ${MARKER}: die Zustellung einer Kind-Sitzung laeuft weiterhin ueber
\t\t// subagents.prompt. Der Grund ist nicht die Sperre an sich, sondern die
\t\t// Buchhaltung: nur dort werden Aufenthaltsraum, Eigentuemer, Katalog-Eintrag
\t\t// und die Bildfaehigkeit des festen Kind-Modells geprueft, und nur dort wird
\t\t// die Zustellung als announced gebucht. Der Menschen-Weg im Chat benutzt
\t\t// ohnehin subagents.prompt, sobald die Sitzung ihre Elternadresse kennt.
\t\tif (hasApiSessionSubagentOwner(this.ctx, agent.session, agent)) throw apiSessionSubagentOwnershipError(request.sessionId);
\t\tif (hasPromptRequest(agent, request.requestId)) return { accepted: true };`
};

/** Beide Ersetzungen in Anwendungsreihenfolge. */
export const ERSETZUNGEN = [LEBENDER_AGENT, ZUSTELLUNG];

/** Schreibt eine Zeile ins Protokoll; ein Fehler dabei stoert nie. */
export function protokolliere(text) {
	try {
		const pfad = process.env.DSH_CHILD_SESSION_LOG ?? join(homedir(), ".dsh", "logs", "child-session-routing.log");
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
// Selbstpruefung: node ~/.dsh/patches/child-session-routing.mjs --test
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

	// Der Zweck, als Text pruefbar: der lebende Agent wird angenommen, die
	// Zustellung bleibt gesperrt. Ein Tippfehler hier waere still.
	pruefe(LEBENDER_AGENT.nachher.includes("return { agent };"), true, "der lebende Agent wird zurueckgegeben");
	pruefe(LEBENDER_AGENT.nachher.includes("apiSessionSubagentOwnershipError(sessionId)"), false, "der lebende Zweig wirft nicht mehr");
	pruefe(LEBENDER_AGENT.nachher.includes('origin === "subagent"'), false, "die Herkunft sperrt den lebenden Zweig nicht mehr");
	pruefe(ZUSTELLUNG.nachher.includes("throw apiSessionSubagentOwnershipError(request.sessionId)"), true, "die Zustellung wird weiterhin abgewiesen");
	pruefe(ZUSTELLUNG.nachher.includes("hasPromptRequest"), true, "die Wiederholungspruefung bleibt erhalten");
	// Nichts, was kalt aufweckt, darf angefasst sein.
	pruefe(LEBENDER_AGENT.nachher.includes("agents.resume"), false, "der Patch weckt keine Sitzung");
	pruefe(ZUSTELLUNG.nachher.includes("agents.resume"), false, "auch hier wird nichts geweckt");

	console.log(fehlgeschlagen === 0 ? "Selbstpruefung: alles in Ordnung." : `Selbstpruefung: ${fehlgeschlagen} Fehler.`);
	process.exitCode = fehlgeschlagen === 0 ? 0 : 1;
}
