/**
 * kind-eigner — der MENSCH ist zusaetzlicher Eigentuemer eines Kindes
 * ====================================================================
 *
 * WAS DER MENSCH GEMELDET HAT (Issue DSH-Verwaltung 175, 2026-11-14)
 * „Ich muss jederzeit in der Lage sein, Subagent Sessions zu wecken. Das darf nicht an
 * dem Parent Agent haengen." und: „Warum muss denn der subagent nur dem parent gehoeren?
 * Was spricht dagegen, dass auch ich der owner bin? Das ist doch eine kuenstliche
 * Einschraenkung."
 *
 * WAS SCHIEF STEHT — gelesen am 2026-11-14, dsh 0.2.0-rc.2
 * Der Weg des Menschen im Chat (dsh-api-session-controller/lib/client.js um 1722-1745) ruft
 * `subagents.prompt` mit der Elternadresse. `prompt()` wirft sofort `subagent/parent-unavailable`,
 * wenn der Elternteil nicht lebt, und die ganze Zustellung (`deliverToChild`, `coldResume`,
 * `materialize`, `authorizeLineage`, `submitAdmitted`) verlangt den EXAKT lebenden Elternteil. Der
 * Browser leitet dieselbe Sperre ein zweites Mal ab (`parentOffline` im Eingabefeld, Schreibschutz-Karte
 * in `selectReadOnlySubagent`). Folge: schlaeft der Elternteil (oder ist selbst ein Kind), bleibt das
 * Kind fuer den Menschen tot, das Eingabefeld grau.
 *
 * WAS DIESES MODUL TUT — drei Kerndateien, sechzehn kleine Ersetzungen
 *   A. dsh-subagent/lib/index.js (14 Ersetzungen, zusammen ein getrennt ruecknehmbarer Block):
 *      1. `prompt()` wirft nicht mehr, wenn der Elternteil kalt ist, sondern ruft `deliverByHuman`.
 *      2. `deliverByHuman` (neu) prueft, dass die Elternadresse zum Kind passt (sonst UNAUTHORIZED wie
 *         bisher) und geht dann den normalen Zustellweg mit `parent = undefined`.
 *      3. Dieser Weg tut mit `parent === undefined` genau das, was er mit Elternteil tat, MINUS alles, was den
 *         Elternteil braucht: kein Besitzeintrag beim Elternteil, kein Ahnenpfad, die Voreinstellung
 *         (agent preset) kommt aus dem Kopf des Kindes statt vom Elternteil, ein eigener Platzpool.
 *      4. Die Abschlussmeldung des Kindes (`notifySettlement`) war bei kaltem Elternteil still verloren.
 *         Jetzt wird sie LEISE in den Posteingang des Elternteils gelegt: ein angehaengtes Ereignis
 *         `agent/inbox/spliced` in dessen Sitzungsdatei, ueber dieselbe Persistenzschicht und dieselbe
 *         Schreibsperre wie der Kern (`sessionPersistence.open(id, "write")`), ohne den Elternteil zu laden
 *         oder zu wecken. Nur Anhaengen, nie eine vorhandene Zeile veraendern. Lebt der Elternteil, bleibt
 *         der bisherige Weg (`sendWaking`). Haelt jemand anderes die Sperre, steht eine Warnung im Protokoll.
 *         (Entscheidung des Menschen 2026-11-14: „2 – Leise zustellen".)
 *   B. dsh-client-ui-conversation/lib/client.js: `parentOffline` sperrt das Eingabefeld nicht mehr.
 *   C. dsh-client-ui-subagent/lib/client.js: die Schreibschutz-Karte „Elternteil offline" erscheint nicht mehr.
 *   Die Host-Zusammenfassung (`agentAvailable`) bleibt unveraendert und ehrlich: kein „true" fuer einen
 *   Agenten, der nicht lebt.
 *
 * WAS NICHT GEAENDERT WIRD
 *   - `sendToParent` (ein lebendes Kind schreibt per Werkzeug an seinen Elternteil) bleibt: ist der
 *     Elternteil kalt, wirft es weiter PARENT_UNAVAILABLE. Das ist die Modell-Seite, nicht die des Menschen.
 *   - Der Weg bei LEBENDEM Elternteil bleibt Byte fuer Byte derselbe (jede Ersetzung verzweigt nur auf
 *     `parent === void 0`).
 *
 * RUECKGAENGIG
 *   node patches/allow-kind-eigner.mjs --revert   (macht die Kerndateien byte-gleich zum Ausgangszustand;
 *   bereits in Sitzungsdateien von Elternteilen abgelegte Abschlussmeldungen bleiben natuerlich stehen.)
 *
 * Selbstpruefung (ohne Datei-Eingriff): node patches/kind-eigner.mjs --test
 * Protokoll: ~/.dsh/logs/kind-eigner.log
 */

import { appendFileSync, readFileSync, renameSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Kennung im Quelltext; ihr Vorhandensein heisst "schon freigegeben". */
export const MARKER = "kindEignerAllowed";

const T = "\t";
/** Eine Quelltextzeile mit n Tabulatoren Einzug. */
const z = (n, text) => T.repeat(n) + text;
/** Mehrere Zeilen zu einem Textblock. */
const block = (...zeilen) => zeilen.join("\n");

const SUB = { paket: "@deepseek-ai/dsh-subagent", datei: "lib/index.js" };
const KONVERSATION = { paket: "@deepseek-ai/dsh-client-ui-conversation", datei: "lib/client.js" };
const SUBAGENT_UI = { paket: "@deepseek-ai/dsh-client-ui-subagent", datei: "lib/client.js" };

/**
 * Die Ersetzungen. Jede: exakte Textstelle (`vorher`, im Rumpf, nicht im Kommentar) und ihr Ersatz (`nachher`).
 * `nachher` enthaelt immer MARKER, damit der Zustand eindeutig lesbar ist.
 */
export const ERSETZUNGEN = [
	{
		id: "prompt-wurf",
		was: "subagents.prompt: ein kalter Elternteil ist kein Fehler mehr",
		...SUB,
		vorher: z(3, 'if (parent === void 0) throw new RemoteError("subagent/parent-unavailable", `parent session "${parentSessionId}" is not live`, { parentSessionId });'),
		nachher: z(3, "// " + MARKER + ": ein kalter Elternteil sperrt den Menschen nicht (deliverByHuman).")
	},
	{
		id: "prompt-zustellung",
		was: "subagents.prompt: ohne lebenden Elternteil Zustellung durch den Menschen",
		...SUB,
		vorher: z(4, "return { messageId: await this[deliverSubagentPrompt](parent, childSessionId, content, source, signal, delivery) };"),
		nachher: z(4, "return { messageId: parent === void 0 ? await this.requireContinuations().deliverByHuman(parentSessionId, childSessionId, content, source, signal, delivery) : await this[deliverSubagentPrompt](parent, childSessionId, content, source, signal, delivery) }; // " + MARKER)
	},
	{
		id: "mensch-zustellung",
		was: "Fortsetzungs-Verwalter: deliverByHuman (neu)",
		...SUB,
		vorher: block(
			z(1, "/** The delivery loop behind {@link deliverToChild}, run under the parent hold. */"),
			z(1, "async deliverFollowup(parent, childId, content, options) {")
		),
		nachher: block(
			z(1, "/**"),
			z(1, "* " + MARKER + ": the human delivers to a child whose direct parent is not live. The parent address"),
			z(1, "* in the request must be the child's recorded parent (else UNAUTHORIZED, as before); the delivery"),
			z(1, "* then runs the ordinary loop with `parent` undefined."),
			z(1, "*/"),
			z(1, "async deliverByHuman(parentSessionId, childId, content, source, signal, delivery) {"),
			z(2, "const resident = this.activations.get(childId);"),
			z(2, 'if (resident !== void 0 && resident.parentSession !== parentSessionId) throw new SubagentError("subagent " + JSON.stringify(childId) + " belongs to another parent session", "UNAUTHORIZED");'),
			z(2, "this.activations.assertAdmitting(void 0);"),
			z(2, "return this.deliverFollowup(void 0, childId, content, { source, signal, delivery, humanParentId: parentSessionId });"),
			z(1, "}"),
			z(1, "/** The delivery loop behind {@link deliverToChild}, run under the parent hold. */"),
			z(1, "async deliverFollowup(parent, childId, content, options) {")
		)
	},
	{
		id: "kalt-wecken",
		was: "coldResume: Berechtigung des Menschen statt des lebenden Elternteils",
		...SUB,
		vorher: block(
			z(3, "this.activations.assertAdmitting(parent);"),
			z(3, "this.activations.authorizeLineage(parent, childId, source.header.parentSession);")
		),
		nachher: block(
			z(3, "this.activations.assertAdmitting(parent);"),
			z(3, "// " + MARKER + ": without a live parent the human's parent address must match the recorded parent."),
			z(3, 'if (parent === void 0) { if (source.header.parentSession !== options.humanParentId) throw new SubagentError("subagent " + JSON.stringify(childId) + " belongs to another parent session", "UNAUTHORIZED"); }'),
			z(3, "else this.activations.authorizeLineage(parent, childId, source.header.parentSession);")
		)
	},
	{
		id: "zugang",
		was: "Zugangssperre: ohne Elternteil gilt nur die Sperre des ganzen Verwalters",
		...SUB,
		vorher: block(
			z(1, "assertAdmitting(agent) {"),
			z(2, "const closing = this.closingTeardownFor(agent);")
		),
		nachher: block(
			z(1, "assertAdmitting(agent) {"),
			z(2, "const closing = agent === void 0 ? this.draining ? \"manager\" : void 0 : this.closingTeardownFor(agent); // " + MARKER)
		)
	},
	{
		id: "ahnen-und-platz",
		was: "materialize: ohne Elternteil kein Ahnenpfad, eigener Platzpool",
		...SUB,
		vorher: block(
			z(2, "const lineage = this.liveLineage(inputs.parent);"),
			z(2, "const pool = this.resident.get(inputs.parent.id)?.pool ?? this.rootPool(inputs.parent);")
		),
		nachher: block(
			z(2, "// " + MARKER + ": a human-woken child has no live ancestors and shares one pool."),
			z(2, "const lineage = inputs.parent === void 0 ? [] : this.liveLineage(inputs.parent);"),
			z(2, "const pool = inputs.parent === void 0 ? (this.humanPool ??= new ActivationPool()) : this.resident.get(inputs.parent.id)?.pool ?? this.rootPool(inputs.parent);")
		)
	},
	{
		id: "voreinstellung",
		was: "Aufbau des Kindes: Voreinstellung aus dem Kopf des Kindes, wenn kein Elternteil lebt",
		...SUB,
		vorher: block(
			z(3, "applyChildComposition(childCtx, parent, inputs.composition);"),
			z(2, "};")
		),
		nachher: block(
			z(3, "// " + MARKER + ": without a live parent the child mounts the preset its own header names."),
			z(3, 'if (parent === void 0) { const presets = childCtx.get("agentPresets"); const presetId = child.session.header.agentPreset; return (presets !== void 0 && presetId != null ? presets.mount(childCtx, presetId) : Promise.resolve()).then(() => applyChildComposition(childCtx, parent, inputs.composition)); }'),
			z(3, "applyChildComposition(childCtx, parent, inputs.composition);"),
			z(2, "};")
		)
	},
	{
		id: "voreinstellung-beitritt",
		was: "applyChildComposition: ohne Elternteil kein Beitritt zu dessen Voreinstellung",
		...SUB,
		vorher: z(1, 'childCtx.get("agentPresets")?.composeFrom(childCtx, parent.ctx);'),
		nachher: z(1, 'if (parent !== void 0) childCtx.get("agentPresets")?.composeFrom(childCtx, parent.ctx); // ' + MARKER)
	},
	{
		id: "elternkennung",
		was: "Aktivierung: die Elternkennung kommt aus dem Kopf des Kindes, wenn kein Elternteil lebt",
		...SUB,
		vorher: z(3, "parentSession: parent.id,"),
		nachher: z(3, "parentSession: parent === void 0 ? handle.agent.session.header.parentSession : parent.id, // " + MARKER)
	},
	{
		id: "besitz-eintrag",
		was: "Besitzeintrag beim Elternteil entfaellt, wenn es keinen lebenden gibt",
		...SUB,
		vorher: block(
			z(2, "const parentActivation = this.resident.get(parent.id);"),
			z(2, "if (parentActivation === void 0) return;")
		),
		nachher: block(
			z(2, "const parentActivation = parent === void 0 ? void 0 : this.resident.get(parent.id); // " + MARKER),
			z(2, "if (parentActivation === void 0) return;")
		)
	},
	{
		id: "einreichen",
		was: "Einreichen: die Pruefung des lebenden Elternteils entfaellt ohne Elternteil",
		...SUB,
		vorher: z(2, "this.authorizeLineage(parent, activation.childId, activation.handle.agent.session.header.parentSession);"),
		nachher: z(2, "if (parent !== void 0) this.authorizeLineage(parent, activation.childId, activation.handle.agent.session.header.parentSession); // " + MARKER)
	},
	{
		id: "abschluss-ablegen",
		was: "Abschlussmeldung: bei kaltem Elternteil leise in dessen Posteingang legen statt verlieren",
		...SUB,
		vorher: block(
			z(3, "const parent = this.ctx.agents.get(activation.parentSession);"),
			z(3, "if (parent === void 0) return;")
		),
		nachher: block(
			z(3, "const parent = this.ctx.agents.get(activation.parentSession);"),
			z(3, "if (parent === void 0) return this.depositSettlement(activation, terminal); // " + MARKER)
		)
	},
	{
		id: "abschluss-abwarten",
		was: "Aufraeumen des Kindes wartet, bis die Abschlussmeldung abgelegt ist",
		...SUB,
		vorher: z(2, "this.notifySettlement(activation, activation.observer.terminal(failure));"),
		nachher: z(2, "await this.notifySettlement(activation, activation.observer.terminal(failure)); // " + MARKER)
	},
	{
		id: "abschluss-methode",
		was: "Aktivierungs-Verzeichnis: depositSettlement (neu)",
		...SUB,
		vorher: block(
			z(1, "/** Request a best-effort final session flush before closing natural-settlement admission. */"),
			z(1, "async flushFinalState(activation) {")
		),
		nachher: block(
			z(1, "/**"),
			z(1, "* " + MARKER + ": the direct parent is not live. Lay the settlement notice into the parent's durable inbox"),
			z(1, "* WITHOUT loading it: append one `agent/inbox/spliced` event through the same persistence layer and write"),
			z(1, "* lock the host uses. Append only; no stored line is changed. If another holder owns the lock the notice is"),
			z(1, "* not written and a warning says so."),
			z(1, "*/"),
			z(1, "depositSettlement(activation, terminal) {"),
			z(2, "const parentId = activation.parentSession;"),
			z(2, "const message = createSettlementMessage(activation.childId, terminal);"),
			z(2, "return this.locks.run(\"settlement-to:\" + parentId, async () => {"),
			z(3, "const persistence = this.ctx.get(\"sessionPersistence\");"),
			z(3, "let handle;"),
			z(3, "try {"),
			z(4, "if (persistence === void 0) throw new Error(\"no session persistence\");"),
			z(4, "// The parent may wake or be loading right now: then its write handle is held and the ordinary path (sendWaking) applies."),
			z(4, "for (let attempt = 0; handle === void 0; attempt++) {"),
			z(5, "const live = this.ctx.agents.get(parentId);"),
			z(5, 'if (live !== void 0) { this.sendWaking(live, message, live.status === "idle" ? "queue" : "steer"); return; }'),
			z(5, "try { handle = await persistence.open(parentId, \"write\"); } catch (error) { if (error?.name !== \"SessionAlreadyOwnedError\" || attempt >= 10) throw error; await new Promise((resolve) => setTimeout(resolve, 200)); }"),
			z(4, "}"),
			z(4, "const { events } = await handle.read(0);"),
			z(4, 'const pending = { "next-turn": 0, "next-step": 0 };'),
			z(4, 'for (const event of events) if (event.type === "agent/inbox/spliced") pending[event.data.target] += event.data.inserted.length - (event.data.removedCount ?? 0);'),
			z(4, 'await handle.append([{ type: "agent/inbox/spliced", seq: events.length, time: Date.now(), data: { target: "next-turn", start: pending["next-turn"], inserted: [message] } }]);'),
			z(4, "await handle.flush();"),
			z(3, "} catch (error) {"),
			z(4, 'this.ctx.logger.warn("subagent " + JSON.stringify(activation.childId) + " settlement notice for the sleeping parent " + JSON.stringify(parentId) + " was not stored: " + errorChain(error));'),
			z(3, "} finally {"),
			z(4, "await handle?.close().catch(() => void 0);"),
			z(3, "}"),
			z(2, "});"),
			z(1, "}"),
			z(1, "/** Request a best-effort final session flush before closing natural-settlement admission. */"),
			z(1, "async flushFinalState(activation) {")
		)
	},
	{
		id: "eingabefeld",
		was: "Browser: das Eingabefeld eines Kindes haengt nicht mehr am Elternteil",
		...KONVERSATION,
		vorher: z(3, "const parentOffline = continuable && subagent.parentAvailable !== true;"),
		nachher: z(3, "const parentOffline = false; // " + MARKER + ": der Mensch ist Eigentuemer, der Server entscheidet")
	},
	{
		id: "schreibschutz-karte",
		was: "Browser: keine Schreibschutz-Karte „Elternteil offline“ fuer ein fortsetzbares Kind",
		...SUBAGENT_UI,
		vorher: block(
			z(3, "if (subagent.parentAvailable !== false) return null;"),
			z(3, 'return owner.session?.running === true ? null : { reason: "parent-unavailable" };')
		),
		nachher: z(3, "return null; // " + MARKER + ": ein kalter Elternteil macht das Kind nicht schreibgeschuetzt")
	}
];

/** Namen der Pakete, die der Patch anfasst (jeweils mit Datei). */
export const ZIELE = [...new Map(ERSETZUNGEN.map((e) => [e.paket + "|" + e.datei, { paket: e.paket, datei: e.datei }])).values()];

/** Schreibt eine Zeile ins Protokoll; ein Fehler dabei stoert nie. */
export function protokolliere(text) {
	try {
		const pfad = process.env.DSH_KIND_EIGNER_LOG ?? join(homedir(), ".dsh", "logs", "kind-eigner.log");
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
	return { changed: true, source: source.replace(ersetzung.vorher, () => ersetzung.nachher), steps: [ersetzung.was] };
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

/** Freigabe auf eine Datei anwenden (eine Ersetzung). */
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

/** Freigabe auf eine Datei zuruecknehmen (eine Ersetzung). */
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
// Selbstpruefung: node patches/kind-eigner.mjs --test  (reine Textumwandlung, keine Datei wird angefasst)
// ---------------------------------------------------------------------------
if (process.argv.includes("--test")) {
	let fehlgeschlagen = 0;
	const pruefe = (ist, soll, was) => {
		if (JSON.stringify(ist) !== JSON.stringify(soll)) {
			fehlgeschlagen += 1;
			console.log(`FEHLER  ${was}: ${JSON.stringify(ist)}, erwartet ${JSON.stringify(soll)}`);
		}
	};

	pruefe(new Set(ERSETZUNGEN.map((e) => e.id)).size, ERSETZUNGEN.length, "die Namen der Ersetzungen sind eindeutig");
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

	// Der Zweck, als Text pruefbar. Ein Tippfehler hier waere still.
	const text = (id) => ERSETZUNGEN.find((e) => e.id === id).nachher;
	pruefe(text("prompt-wurf").includes("parent-unavailable"), false, "prompt wirft bei kaltem Elternteil nicht mehr");
	pruefe(text("prompt-zustellung").includes("deliverByHuman"), true, "prompt ruft deliverByHuman");
	pruefe(text("prompt-zustellung").includes("this[deliverSubagentPrompt]"), true, "der Weg mit lebendem Elternteil bleibt");
	pruefe(text("mensch-zustellung").includes("UNAUTHORIZED"), true, "deliverByHuman prueft die Elternadresse");
	pruefe(text("mensch-zustellung").includes("resident.parentSession !== parentSessionId"), true, "deliverByHuman vergleicht die Elternadresse mit der des lebenden Kindes");
	pruefe(text("prompt-zustellung").includes("parent === void 0 ? await this.requireContinuations().deliverByHuman"), true, "nur ohne lebenden Elternteil geht es an deliverByHuman");
	pruefe(text("prompt-zustellung").includes(": await this[deliverSubagentPrompt](parent"), true, "mit lebendem Elternteil bleibt der Kernweg");
	pruefe(text("kalt-wecken").includes("options.humanParentId"), true, "coldResume prueft die Elternadresse des Menschen");
	pruefe(text("kalt-wecken").includes("else this.activations.authorizeLineage"), true, "mit Elternteil bleibt authorizeLineage");
	pruefe(text("abschluss-methode").includes('persistence.open(parentId, \\"write\\")') || text("abschluss-methode").includes('persistence.open(parentId, "write")'), true, "die Abschlussmeldung geht ueber die Schreibsperre des Kerns");
	pruefe(text("abschluss-methode").includes('agents.resume'), false, "die Abschlussmeldung laedt den Elternteil nicht");
	pruefe(text("abschluss-methode").includes("handle.append"), true, "die Abschlussmeldung wird nur angehaengt");
	pruefe(text("eingabefeld").includes("parentOffline = false"), true, "das Eingabefeld ist frei");
	pruefe(ERSETZUNGEN.some((e) => e.nachher.includes("agentAvailable")), false, "agentAvailable wird nirgends angefasst");

	console.log(fehlgeschlagen === 0 ? "Selbstpruefung: alles in Ordnung." : `Selbstpruefung: ${fehlgeschlagen} Fehler.`);
	process.exitCode = fehlgeschlagen === 0 ? 0 : 1;
}
