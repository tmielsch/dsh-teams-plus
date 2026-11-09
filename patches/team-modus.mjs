/**
 * team-modus — im Team-Modus fallen die Meldungen „einfach nur fertig“ weg, Fehler bleiben laut,
 * und ein Ziel lässt sich nur mit Bericht abschließen
 * ====================================================================================================
 *
 * STAND: Entwurf auf dem Zweig `umsetzung/team-modus`, NICHT eingespielt, nicht gemergt.
 * Konzept: `docs/KONZEPT-GESPRAECHSMODUS.md` (Abschnitte 3, 5.1, 5.3, 5.7, 7); Anlass: Issue
 * `tmielsch/DSH-Verwaltung` Nr. 121.
 *
 * WAS DER MENSCH WOLLTE (2026-11-09, sinngemäß wörtlich, Entscheidungen in `/tmp/entscheidungen_teamwork_*.md`)
 * „Ich will es so haben, dass diese Funktionen nur unterdrückt werden, wenn /team work aktiv ist. Wenn es
 * nicht im Team ist, also ganz normale DSH-Nutzung, soll es weiterhin so funktionieren wie normal. Im
 * Team-Modus werden alle automatischen Statusnachrichten abgesehen von Task-Updates unterdrückt. […] Die
 * unterdrückten Nachrichten können im Prinzip weg.“ — „Legitime Status-Updates wie Critical Errors bitte
 * auf jeden Fall behalten.“ — „Man kann das Ziel nicht [ab]schließen, solange kein Bericht geschrieben
 * wurde.“ — „Ich will das ganze non-destructive haben, quasi als revertbaren Patch.“
 *
 * WAS DIESES MODUL TUT (fünf Teile, jeder für sich abschaltbar durch den Notschalter)
 *
 *  1. FILTER. Der Kern schickt dem Elternteil bei JEDER Ruhe eines Kindes eine Meldung („Background subagent
 *     … finished and will do no further work unless you send it more“; `dsh-subagent/lib/index.js` Z. 616 und
 *     1254–1268). Im Team-Modus wird genau diese Meldung verworfen. Das Modul umwickelt dafür `Agent.send` der
 *     Agenten — gemessen in der Probe (Konzept M1): die Kernmeldung läuft als `followup` über `send`, der Lead
 *     wurde bei vier Meldungen null Mal geweckt. VERWORFEN, NICHT GEPUFFERT (Entscheidung des Menschen).
 *     Alles andere geht unverändert durch: „stopped“, „failed“, „ran out of room“, „declined“, jede unbekannte
 *     Form, jede Nachricht eines Agenten, Task-Updates, jede Nachricht des Menschen. Maßgeblich ist der
 *     VOLLE erste Textblock der Meldung; passt er nicht Zeichen für Zeichen auf den „finished“-Satz, bleibt die
 *     Meldung (unbekannt heißt laut).
 *  2. BERICHT. Werkzeug `goal_report`: der Agent schreibt seinen Schlussbericht in eine Datei
 *     (`~/.dsh/.tm/teams-plus/state/berichte/`). Ein Wächter (`ctx.tools.guard`, gemessen in der Probe, M7)
 *     lehnt `update_goal(complete)` ab, solange für dieses Ziel kein Bericht vorliegt. Wird das Ziel danach
 *     abgeschlossen, stellt das Modul den Bericht dem Vorgesetzten GENAU EINMAL zu. Gemeint ist der Text des
 *     Agenten, keine Statuszeile. Ein Ziel auf „blocked“ wird dem Vorgesetzten gemeldet (kritischer Zustand).
 *     Die Wurzelsitzung (Lead, kein Vorgesetzter) ist ausgenommen: ihr Bericht geht an den Menschen.
 *  3. ÜBERSICHT. Werkzeug `team_stand` (nur lesend): je Mitglied Ziel (Phase, Runden, Wortlaut gekürzt), ob ein
 *     Bericht vorliegt, Zeit des letzten Ereignisses. Der Lead sieht den Stand ohne Weckrufe (Konzept M8).
 *  4. NOTSCHALTER. `~/.dsh/.tm/teams-plus/team-modus.json` mit `{"aus": true}` schaltet 1 und 2 ab (Verhalten
 *     wie ohne dieses Modul). Gelesen bei jeder Entscheidung, kein Neustart nötig. Eine kaputte Datei zählt
 *     als „aus“ und wird einmal laut gemeldet: lieber das alte Verhalten als ein halbes neues.
 *  5. SELBSTTEST. Beim Start und beim ersten Agenten: ist `defineTool` ladbar, gibt es `tools.guard`, ist der
 *     Berichtsordner beschreibbar, wurde `send` wirklich umwickelt? Abweichungen stehen im Protokoll und als
 *     Warnung; das Modul fällt dann auf das heutige Verhalten zurück, es bricht nichts.
 *
 * WANN GILT „TEAM-MODUS“ (Entscheidung des Menschen, F1)
 * Solange die Wurzelsitzung des Baums mindestens ein Teammitglied hat, das weder zur Ruhe gelegt (`/team rest`)
 * noch fehlgeschlagen ist, und der Notschalter nicht gedrückt ist. Ohne Team, mit ruhendem Team: alles wie
 * heute. Die Wurzel eines Agenten wird über `session.header.parentSession` aufwärts gefunden und hört bei der
 * ersten WURZELSITZUNG auf (`agents.roots()`): ein Fork des Leads hat zwar `parentSession` = Lead (gemessen,
 * Konzept M4a), ist aber eine eigene Wurzel mit leerem Team und damit NICHT im Team-Modus.
 *
 * WAS DIESES MODUL NICHT TUT (hängt an offenen Fragen des Menschen, deshalb noch nicht gebaut)
 *  - Keine Gesprächsübernahme („Mensch hat … übernommen, stand by“, Anhalten durch Entwaffnen) — F3.
 *  - Kein `give_task`, kein `ask_question`, keine Sperre von `send_message` — F5 (Weg A, B oder C).
 *  - Kein Eingriff in den Kochmodus der Szene — F7.
 *  - Es ändert keine Anweisungsdatei, schreibt nicht in die DSH-Installation und nicht in `~/.dsh/profiles/`.
 *
 * ROBUSTHEIT GEGEN UPDATES
 * Nur öffentliche Schnittstellen: `Agent.send`, `ctx.tools.guard`, `ctx.goals`, `ctx.on("goal/changed")`,
 * `agentTeams.listMembers`, `sessionQuery.observeSession`. Ändert ein Update eine davon, bleibt der Selbsttest
 * rot und das Verhalten fällt auf das heutige zurück („fail open“); die Kernmeldung kommt dann wieder an.
 *
 * RÜCKGÄNGIG
 *   Notschalter: `{"aus": true}` in `team-modus.json` — sofort, ohne Neustart.
 *   Ganz: den Eintrag `team-modus` aus `cordis.patch.yml` entfernen und DSH neu starten (Neustart nur durch
 *   den Menschen). Das Modul stellt beim Abbau die ursprüngliche `send`-Methode jedes Agenten wieder her.
 *
 * SELBSTPRÜFUNG   node --test test/team-modus.test.mjs
 * NACHSEHEN       ~/.dsh/.tm/teams-plus/logs/team-modus.log   ~/.dsh/.tm/teams-plus/state/berichte/
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { QUELL_ART, baueNachricht, baueQuelle } from "./send-to-session.mjs";

export const name = "team-modus";

/** Cordis-Dienste, ohne die dieses Modul nichts tun kann. Alles Weitere wird mit `ctx.get` geholt. */
export const inject = ["tools", "agents", "goals"];

/** Die Kernpakete, die dieses Modul zur Laufzeit braucht (nie statisch importieren). */
const PAKET_WERKZEUGE = "@deepseek-ai/dsh-tools";
const PAKET_NACHRICHTEN = "@deepseek-ai/dsh-llm";

/** Namen der beiden Werkzeuge. */
export const WERKZEUG_BERICHT = "goal_report";
export const WERKZEUG_STAND = "team_stand";

/** Obergrenze, wie oft der Aufwärtsweg zur Wurzel geht (gegen Zyklen in kaputten Protokollen). */
const MAX_TIEFE = 16;

/** Wie lange `team_stand` auf das Lesen einer abgebauten Sitzung wartet. */
const LESE_FRIST_MS = 5000;

/** Der volle Satz der Kernmeldung bei normalem Ende — alles andere bleibt laut. */
const SATZ_FERTIG = /^Background subagent \S+ finished and will do no further work unless you send it more\.$/;

// ---------------------------------------------------------------------------------------------------
// Ablage: ein Ordner, wie bei den anderen Modulen (E1: eigene Daten unter ~/.dsh/.tm/teams-plus)
// ---------------------------------------------------------------------------------------------------

/** Das Harness-Zuhause; `DSH_HOME=""` heißt „nicht gesetzt“ (dieselbe Falle wie bei team-bremse). */
function dshHeim() {
	const gesetzt = process.env.DSH_HOME?.trim();
	return gesetzt === undefined || gesetzt === "" ? join(homedir(), ".dsh") : gesetzt;
}

/** Der Datenordner dieses Plugins. */
export function datenOrdner() {
	return join(dshHeim(), ".tm", "teams-plus");
}

export const notschalterPfad = () => join(datenOrdner(), "team-modus.json");
export const protokollPfad = () => join(datenOrdner(), "logs", "team-modus.log");
export const berichtOrdner = () => join(datenOrdner(), "state", "berichte");

/** Eine Zeile ins Protokoll; ein fehlendes Recht darf nie eine Entscheidung verhindern. */
export function protokolliere(text) {
	try {
		const pfad = protokollPfad();
		mkdirSync(dirname(pfad), { recursive: true });
		appendFileSync(pfad, `${new Date().toISOString()} ${text}\n`);
	} catch { /* Protokoll ist Beiwerk. */ }
}

// ---------------------------------------------------------------------------------------------------
// Notschalter
// ---------------------------------------------------------------------------------------------------

/** Letzter gelesener Stand, damit eine kaputte Datei nur EINMAL laut gemeldet wird. */
const notschalterMerker = { schluessel: undefined, aus: false };

/**
 * Ist der Notschalter gedrückt?
 *
 * `{"aus": true}` → ja. Keine Datei → nein. Eine Datei, die sich nicht als Objekt lesen lässt, zählt als
 * „ja“ (das alte Verhalten ist die sichere Richtung) und wird einmal gemeldet.
 *
 * @param melde - `(text) => void`, bekommt die Meldung bei einer kaputten Datei (einmal je Stand).
 */
export function notschalterGedrueckt(melde = () => {}, pfad = notschalterPfad()) {
	let info;
	try { info = statSync(pfad); } catch { return false; }
	const schluessel = `${pfad}|${info.mtimeMs}|${info.size}`;
	if (notschalterMerker.schluessel === schluessel) return notschalterMerker.aus;
	let aus;
	try {
		const wert = JSON.parse(readFileSync(pfad, "utf8"));
		if (wert === null || typeof wert !== "object" || Array.isArray(wert)) throw new Error("kein Objekt");
		aus = wert.aus === true;
	} catch (fehler) {
		aus = true;
		melde(`Notschalter-Datei ${pfad} ist unlesbar (${fehler instanceof Error ? fehler.message : String(fehler)}); das Modul bleibt AUS`);
	}
	notschalterMerker.schluessel = schluessel;
	notschalterMerker.aus = aus;
	return aus;
}

// ---------------------------------------------------------------------------------------------------
// Team-Modus erkennen
// ---------------------------------------------------------------------------------------------------

/**
 * Die Wurzelsitzung, unter der dieser Agent hängt.
 *
 * Der Weg endet bei der ersten Wurzelsitzung. Ein Fork hat `parentSession` = Lead und ist trotzdem eine
 * Wurzel (gemessen): ohne diese Bedingung würde der Fork dem Team des Leads zugerechnet.
 *
 * @param agenten - der Agenten-Dienst (`get`, `roots`).
 */
export function wurzelVon(agenten, agent) {
	let aktuell = agent;
	const wurzeln = typeof agenten?.roots === "function" ? agenten.roots() : [];
	for (let schritt = 0; schritt < MAX_TIEFE; schritt += 1) {
		if (wurzeln.includes(aktuell)) return aktuell;
		const eltern = aktuell?.session?.header?.parentSession;
		if (eltern === undefined) return aktuell;
		const lebend = agenten.get(eltern);
		if (lebend === undefined) return aktuell;
		aktuell = lebend;
	}
	return aktuell;
}

/**
 * Gilt für diesen Agenten der Team-Modus?
 *
 * @param umgebung - `{ agenten, teams, notschalter }`; `teams()` liefert den Dienst `agentTeams` oder `undefined`,
 *                   `notschalter()` die Antwort von {@link notschalterGedrueckt}.
 */
export function istTeamModus(agent, umgebung) {
	if (umgebung.notschalter()) return false;
	const dienst = umgebung.teams();
	if (dienst === undefined || typeof dienst.listMembers !== "function") return false;
	const wurzel = wurzelVon(umgebung.agenten, agent);
	let zeilen;
	try { zeilen = dienst.listMembers(wurzel); } catch { return false; }
	return Array.isArray(zeilen) && zeilen.some((zeile) => zeile.role === "teammate" && ["running", "inactive", "provisioning"].includes(zeile.status));
}

/** Ist dieser Agent eine Wurzelsitzung (kein Vorgesetzter)? */
export function istWurzel(agenten, agent) {
	return typeof agenten?.roots === "function" && agenten.roots().includes(agent);
}

// ---------------------------------------------------------------------------------------------------
// Teil 1: der Filter
// ---------------------------------------------------------------------------------------------------

/** Ist das die Kernmeldung „normal fertig“, und nur diese? */
export function istAbschlussOhneBefund(nachricht) {
	if (nachricht?.source?.kind !== "subagent-settled") return false;
	const erster = Array.isArray(nachricht.content) ? nachricht.content[0] : undefined;
	return erster?.type === "text" && typeof erster.text === "string" && SATZ_FERTIG.test(erster.text);
}

/**
 * Was geschieht mit dieser Nachricht an diesen Empfänger?
 *
 * @returns `{ aktion: "verwerfen" | "durchlassen", grund }`. Nur die „finished“-Meldung im Team-Modus wird
 *          verworfen; jede andere Nachricht kostet nur den Blick auf `source.kind`.
 */
export function entscheide(empfaenger, nachricht, umgebung) {
	if (nachricht?.source?.kind !== "subagent-settled") return { aktion: "durchlassen", grund: "keine Kernmeldung" };
	if (!istAbschlussOhneBefund(nachricht)) return { aktion: "durchlassen", grund: "Kernmeldung mit Befund oder unbekannter Form" };
	if (!istTeamModus(empfaenger, umgebung)) return { aktion: "durchlassen", grund: "kein Team-Modus" };
	return { aktion: "verwerfen", grund: "normal fertig im Team-Modus" };
}

const MARKE = Symbol.for("teams-plus.team-modus.send");

/**
 * Umwickelt `Agent.send` eines Agenten. Wirft `entscheiden` oder ist die Methode fremd, geht die Nachricht
 * unverändert durch („fail open“).
 *
 * @param entscheiden - `(agent, nachricht) => { aktion, grund }`.
 * @returns eine Funktion, die den ursprünglichen Zustand wiederherstellt, oder `undefined`, wenn nichts umwickelt wurde.
 */
export function umwickleSend(agent, entscheiden, protokoll = () => {}) {
	if (typeof agent?.send !== "function") return undefined;
	if (agent.send[MARKE] === true) return undefined;
	const grund = agent.send;
	const hatEigene = Object.hasOwn(agent, "send");
	const neu = function (nachricht, ziel, wecken) {
		let urteil;
		try { urteil = entscheiden(agent, nachricht); } catch (fehler) {
			protokoll(`warn Filter geworfen, Nachricht geht durch: ${fehler instanceof Error ? fehler.message : String(fehler)}`);
			urteil = { aktion: "durchlassen" };
		}
		if (urteil?.aktion === "verwerfen") {
			protokoll(`verworfen empfaenger=${agent.id} art=${nachricht?.source?.kind} grund="${urteil.grund}"`);
			return undefined;
		}
		return grund.call(this, nachricht, ziel, wecken);
	};
	neu[MARKE] = true;
	agent.send = neu;
	return () => {
		if (agent.send !== neu) return;
		if (hatEigene) agent.send = grund;
		else delete agent.send;
	};
}

// ---------------------------------------------------------------------------------------------------
// Teil 2: Berichte
// ---------------------------------------------------------------------------------------------------

/** Dateiname zu einer Ziel-Kennung (nur harmlose Zeichen). */
function berichtDatei(zielId, ordner = berichtOrdner()) {
	return join(ordner, `${String(zielId).replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
}

/** Liest den Bericht zu einem Ziel, oder `undefined`. */
export function leseBericht(zielId, ordner = berichtOrdner()) {
	try {
		const wert = JSON.parse(readFileSync(berichtDatei(zielId, ordner), "utf8"));
		return wert !== null && typeof wert === "object" && typeof wert.bericht === "string" ? wert : undefined;
	} catch { return undefined; }
}

/** Gibt es einen nicht leeren Bericht zu diesem Ziel? */
export function hatBericht(zielId, ordner = berichtOrdner()) {
	return (leseBericht(zielId, ordner)?.bericht ?? "").trim() !== "";
}

/** Schreibt den Bericht; ein zweiter Aufruf ersetzt den ersten, solange er noch nicht zugestellt ist. */
export function schreibeBericht(eintrag, ordner = berichtOrdner()) {
	mkdirSync(ordner, { recursive: true });
	const vorher = leseBericht(eintrag.zielId, ordner);
	writeFileSync(berichtDatei(eintrag.zielId, ordner), JSON.stringify({ ...eintrag, zugestellt: vorher?.zugestellt === true }, null, 2));
}

/** Merkt sich, dass der Bericht zugestellt ist. */
function markiereZugestellt(zielId, ordner = berichtOrdner()) {
	const wert = leseBericht(zielId, ordner);
	if (wert === undefined) return;
	writeFileSync(berichtDatei(zielId, ordner), JSON.stringify({ ...wert, zugestellt: true, zugestelltAm: new Date().toISOString() }, null, 2));
}

/** Der Hinweis, den das Modell bekommt, wenn es ein Ziel ohne Bericht abschließen will. */
export const HINWEIS_OHNE_BERICHT =
	"Team mode: a goal cannot be completed until you have written its report. Call goal_report with your closing report " +
	"(what was achieved, evidence such as paths and measurements, what is left open), then call update_goal with action complete again.";

/**
 * Der Wächter für `ctx.tools.guard`: lehnt `update_goal(complete)` ohne Bericht ab.
 *
 * @returns den Ablehnungstext oder `undefined`.
 */
export function pruefeAbschluss(ausfuehrung, umgebung, ordner = berichtOrdner()) {
	if (ausfuehrung?.name !== "update_goal") return undefined;
	const agent = ausfuehrung.agent;
	if (agent === undefined) return undefined;
	let argumente = ausfuehrung.arguments;
	if (typeof argumente === "string") { try { argumente = JSON.parse(argumente); } catch { return undefined; } }
	if (argumente?.action !== "complete") return undefined;
	if (istWurzel(umgebung.agenten, agent)) return undefined;
	if (!istTeamModus(agent, umgebung)) return undefined;
	let ziel;
	try { ziel = umgebung.ziel(agent); } catch { return undefined; }
	if (ziel === undefined) return undefined;
	return hatBericht(ziel.id, ordner) ? undefined : HINWEIS_OHNE_BERICHT;
}

// ---------------------------------------------------------------------------------------------------
// Laden der Kernbausteine (wie bei den anderen Modulen: nie statisch importieren)
// ---------------------------------------------------------------------------------------------------

function kernBasis() {
	const basis = new Set();
	const fuegen = (pfad) => {
		if (typeof pfad !== "string" || pfad.length === 0) return;
		basis.add(pfad);
		const knoten = pfad.indexOf("/node_modules/");
		if (knoten >= 0) basis.add(pfad.slice(0, knoten + 1));
	};
	for (const argument of process.argv) fuegen(argument);
	fuegen(process.execPath);
	basis.add("/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai");
	fuegen(join(homedir(), ".dsh", "lib", "node_modules", "@deepseek-ai"));
	fuegen("/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai");
	fuegen("/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai");
	return [...basis];
}

async function ladeKern(paket) {
	const unterpfad = paket.replace("@deepseek-ai/", "");
	const kandidaten = [paket];
	for (const basis of kernBasis()) {
		kandidaten.push(join(basis, unterpfad, "lib", "index.js"));
		kandidaten.push(join(basis, "dsh", "node_modules", "@deepseek-ai", unterpfad, "lib", "index.js"));
	}
	for (const kandidat of kandidaten) {
		try { return await import(kandidat); } catch { /* nächster Kandidat */ }
	}
	return undefined;
}

// ---------------------------------------------------------------------------------------------------
// Werkzeuge
// ---------------------------------------------------------------------------------------------------

const BESCHREIBUNG_BERICHT = [
	"Write the closing report of your current goal. In Team mode a goal can only be completed (update_goal with action complete) after this report exists; when you then complete it, the report is delivered to your supervisor exactly once. The report is YOUR text, not a status line: what was achieved, the evidence (paths, measurements, images), what is left open or uncertain.",
	"",
	"Calling it again before completion replaces the report. Outside Team mode it only stores the text and changes nothing else."
].join("\n");

const BESCHREIBUNG_STAND = [
	"Read-only overview of the Team: for every member its goal (phase, rounds used, objective shortened), whether a closing report exists, and the time of its last session event. It wakes nobody and costs no model call of the members.",
	"",
	"Use it instead of asking members for status. A member that ended a turn without completing its goal is NOT reported to you any more in Team mode (the plain 'finished' notice is dropped); this overview is how you see it."
].join("\n");

/** Kürzt einen Text auf eine Zeile mit Obergrenze. */
function kuerze(text, grenze) {
	const eine = String(text ?? "").replace(/\s+/g, " ").trim();
	return eine.length > grenze ? `${eine.slice(0, grenze - 1)}…` : eine;
}

/** Baut `goal_report`. */
export function baueBerichtWerkzeug({ defineTool, umgebung, ordner = berichtOrdner() }) {
	return defineTool({
		name: WERKZEUG_BERICHT,
		description: BESCHREIBUNG_BERICHT,
		parameters: {
			bericht: { type: "string", required: true, description: "Your closing report, in full sentences, with evidence." }
		},
		output: {
			schema: { type: "object", additionalProperties: false, properties: {
				gespeichert: { type: "boolean", required: true },
				zielId: { type: "string", required: true },
				hinweis: { type: "string", required: true }
			} },
			render: (_args, wert) => [{ type: "text", text: JSON.stringify(wert) }]
		},
		presentCall: () => ({ card: "generic", title: "Write closing report", kind: "other" }),
		presentResult: () => ({ card: "generic", title: "Closing report" }),
		isConcurrencySafe: () => false,
		execute: async (args, exec) => {
			const agent = exec?.agent;
			if (agent === undefined) throw new Error("goal_report needs a calling agent");
			const text = typeof args?.bericht === "string" ? args.bericht.trim() : "";
			if (text === "") throw new Error("`bericht` is empty: write the report, then call goal_report again.");
			const ziel = umgebung.ziel(agent);
			if (ziel === undefined) throw new Error("this session has no goal, so there is nothing to report on.");
			schreibeBericht({ zielId: ziel.id, revision: ziel.revision, sitzung: agent.id, zeit: new Date().toISOString(), wortlautZiel: ziel.objective, bericht: text }, ordner);
			protokolliere(`bericht gespeichert agent=${agent.id} ziel=${ziel.id} zeichen=${text.length}`);
			return { gespeichert: true, zielId: String(ziel.id), hinweis: "Report stored. Now call update_goal with action complete; the report is then delivered to your supervisor." };
		}
	});
}

/** Baut `team_stand`. */
export function baueStandWerkzeug({ defineTool, umgebung, ordner = berichtOrdner() }) {
	return defineTool({
		name: WERKZEUG_STAND,
		description: BESCHREIBUNG_STAND,
		parameters: {},
		output: {
			schema: { type: "object", additionalProperties: false, properties: {
				teamModus: { type: "boolean", required: true },
				notschalter: { type: "boolean", required: true },
				mitglieder: { type: "array", required: true, items: { type: "object", additionalProperties: true } },
				hinweis: { type: "string", required: true }
			} },
			render: (_args, wert) => [{ type: "text", text: JSON.stringify(wert) }]
		},
		presentCall: () => ({ card: "generic", title: "Team overview", kind: "read" }),
		presentResult: () => ({ card: "generic", title: "Team overview" }),
		isConcurrencySafe: () => true,
		execute: async (_args, exec) => {
			const agent = exec?.agent;
			if (agent === undefined) throw new Error("team_stand needs a calling agent");
			const notschalter = umgebung.notschalter();
			const wurzel = wurzelVon(umgebung.agenten, agent);
			const dienst = umgebung.teams();
			const zeilen = dienst === undefined ? [] : dienst.listMembers(wurzel);
			const mitglieder = [];
			for (const zeile of zeilen) {
				if (zeile.role !== "teammate") continue;
				mitglieder.push(await umgebung.leseMitglied(zeile, ordner));
			}
			return {
				teamModus: istTeamModus(agent, umgebung),
				notschalter,
				mitglieder,
				hinweis: "One row per teammate. 'ziel' is null when the member has no goal. 'zeitLetztesEreignis' is the time of the last session event; 'gelesenAus' says whether the live agent or the stored session was read."
			};
		}
	});
}

/**
 * Liest Ziel und Zeit eines Mitglieds: lebend aus dem Agenten, sonst aus der gespeicherten Sitzung.
 * Die Abfrage der gespeicherten Sitzung bekommt eine Frist, damit eine sehr große Sitzung die Übersicht nicht
 * aufhält (nicht gemessen, wie lange das bei den größten Sitzungen dauert — siehe Konzept, offene Punkte).
 */
export async function leseMitglied(zeile, umgebung, ordner = berichtOrdner()) {
	const basis = { name: zeile.name, id: zeile.id, status: zeile.status, ziel: null, bericht: false, zeitLetztesEreignis: null, gelesenAus: "nichts" };
	const formen = (ziel, aktivierung) => ({
		phase: ziel.phase,
		...(aktivierung === undefined ? {} : { aktivierung }),
		runden: ziel.roundsStarted ?? null,
		maxRunden: ziel.maxGoalRounds ?? null,
		wortlaut: kuerze(ziel.objective, 200)
	});
	try {
		const lebend = umgebung.agenten.get(zeile.id);
		if (lebend !== undefined) {
			const ziel = umgebung.ziel(lebend);
			let zeit = null;
			try {
				const ereignisse = lebend.session.snapshotEvents(Math.max(0, lebend.session.seq - 1));
				zeit = ereignisse.at(-1)?.time ?? null;
			} catch { /* Zeit ist Beiwerk */ }
			return { ...basis, gelesenAus: "lebender Agent", ziel: ziel === undefined ? null : formen(ziel, ziel.activation), bericht: ziel === undefined ? false : hatBericht(ziel.id, ordner), zeitLetztesEreignis: zeit === null ? null : new Date(zeit).toISOString() };
		}
		const beobachtung = await umgebung.beobachte(zeile.id, LESE_FRIST_MS);
		if (beobachtung === undefined) return { ...basis, gelesenAus: "nicht lesbar" };
		try {
			const projektion = beobachtung.projections?.values?.goal;
			const ziel = projektion?.goal;
			const zeit = beobachtung.events?.at?.(-1)?.time;
			return { ...basis, gelesenAus: "gespeicherte Sitzung", ziel: ziel === undefined ? null : { ...formen({ ...ziel, roundsStarted: projektion.roundsStarted }, undefined) }, bericht: ziel === undefined ? false : hatBericht(ziel.id, ordner), zeitLetztesEreignis: typeof zeit === "number" ? new Date(zeit).toISOString() : null };
		} finally { beobachtung[Symbol.dispose]?.(); }
	} catch (fehler) {
		return { ...basis, gelesenAus: `Fehler: ${kuerze(fehler instanceof Error ? fehler.message : String(fehler), 120)}` };
	}
}

// ---------------------------------------------------------------------------------------------------
// Selbsttest
// ---------------------------------------------------------------------------------------------------

/**
 * Prüft, ob die Schnittstellen da sind, auf die dieses Modul baut.
 *
 * @param befund - `{ defineTool, guard, teams, agentenListe, berichtOrdnerSchreibbar }` (Wahrheitswerte).
 * @returns `{ ok, abweichungen: string[] }`
 */
export function selbsttest(befund) {
	const abweichungen = [];
	if (!befund.defineTool) abweichungen.push("defineTool nicht ladbar: goal_report und team_stand fehlen");
	if (!befund.guard) abweichungen.push("tools.guard fehlt: update_goal(complete) wird nicht auf den Bericht geprüft");
	if (!befund.teams) abweichungen.push("Dienst agentTeams fehlt: der Team-Modus ist nie aktiv, der Filter lässt alles durch");
	if (!befund.agentenListe) abweichungen.push("agents.list/roots fehlt: Agenten werden nicht umwickelt");
	if (!befund.berichtOrdnerSchreibbar) abweichungen.push("Berichtsordner nicht beschreibbar: goal_report scheitert");
	return { ok: abweichungen.length === 0, abweichungen };
}

// ---------------------------------------------------------------------------------------------------
// Einhängen in den Host
// ---------------------------------------------------------------------------------------------------

/**
 * @param ctx - der Cordis-Kontext des Profils.
 * @param optionen - nur für Tests: `{ ordner }` lenkt den Berichtsordner um.
 */
export function apply(ctx, optionen = {}) {
	const ordner = optionen.ordner ?? berichtOrdner();
	const melden = (stufe, text) => {
		protokolliere(`${stufe === "warn" ? "warn " : ""}${text}`);
		try { if (typeof ctx.logger?.[stufe] === "function") ctx.logger[stufe](`team-modus: ${text}`); } catch { /* Beiwerk */ }
	};
	const hole = (dienst) => { try { return ctx.get(dienst); } catch { return undefined; } };

	const umgebung = {
		agenten: ctx.agents,
		teams: () => hole("agentTeams"),
		notschalter: () => notschalterGedrueckt((text) => melden("warn", text)),
		ziel: (agent) => ctx.goals.get(agent),
		beobachte: async (sitzungsId, fristMs) => {
			const abfrage = hole("sessionQuery");
			if (abfrage === undefined || typeof abfrage.observeSession !== "function") return undefined;
			const abbruch = new AbortController();
			const uhr = setTimeout(() => abbruch.abort(), fristMs);
			try { return await abfrage.observeSession(sitzungsId, { signal: abbruch.signal }); } catch { return undefined; } finally { clearTimeout(uhr); }
		}
	};
	umgebung.leseMitglied = (zeile, o) => leseMitglied(zeile, umgebung, o);

	ctx.effect(() => {
		let abgemeldet = false;
		const rueckholer = new Map();
		const abmelder = [];
		let selbsttestEinmal = false;

		/** Zustellung an den Vorgesetzten; der Kern kennt dafür kein Postfach, also `steer` wie bei send-to-session. */
		const stelleZu = (kind, text, nachrichtenBaustein) => {
			const elternId = kind?.session?.header?.parentSession;
			const eltern = elternId === undefined ? undefined : ctx.agents.get(elternId);
			if (eltern === undefined) { melden("warn", `kein lebender Vorgesetzter für ${kind?.id}; Zustellung entfällt`); return false; }
			const nachricht = baueNachricht([{ type: "text", text }], baueQuelle(kind.id, eltern.id), nachrichtenBaustein);
			eltern.steer(nachricht);
			return true;
		};

		let nachrichtenBaustein;

		const entscheiden = (agent, nachricht) => entscheide(agent, nachricht, umgebung);

		const umwickle = (agent) => {
			if (abgemeldet || rueckholer.has(agent)) return;
			const rueck = umwickleSend(agent, entscheiden, (zeile) => melden(zeile.startsWith("warn") ? "warn" : "info", zeile.replace(/^warn /, "")));
			if (rueck === undefined) {
				if (typeof agent?.send === "function" && agent.send[MARKE] === true) return;
				melden("warn", `send von ${agent?.id} ließ sich nicht umwickeln; der Filter wirkt dort nicht`);
				return;
			}
			rueckholer.set(agent, rueck);
		};

		const testeEinmal = () => {
			if (selbsttestEinmal) return;
			selbsttestEinmal = true;
			let schreibbar = true;
			try { mkdirSync(ordner, { recursive: true }); accessSync(ordner, constants.W_OK); } catch { schreibbar = false; }
			const erg = selbsttest({
				defineTool: typeof werkzeugBaustein?.defineTool === "function",
				guard: typeof ctx.tools?.guard === "function",
				teams: umgebung.teams() !== undefined,
				agentenListe: typeof ctx.agents?.list === "function" && typeof ctx.agents?.roots === "function",
				berichtOrdnerSchreibbar: schreibbar
			});
			if (erg.ok) melden("info", "selbsttest ok");
			else melden("warn", `selbsttest ABWEICHUNG: ${erg.abweichungen.join("; ")}`);
		};

		let werkzeugBaustein;

		// 1. Agenten umwickeln: die vorhandenen und jeden neuen. `agent/created` läuft, bevor Eingang angenommen wird.
		try { for (const agent of ctx.agents.list()) umwickle(agent); } catch (fehler) { melden("warn", `agents.list: ${String(fehler)}`); }
		abmelder.push(ctx.on("agent/created", ({ agent }) => { umwickle(agent); }));
		abmelder.push(ctx.on("agent/disposed", ({ agent }) => { rueckholer.delete(agent); }));

		// 2. Ziel-Ereignisse: Abschluss (Bericht zustellen) und Blockade (melden).
		abmelder.push(ctx.on("goal/changed", ({ agent, change }) => {
			try {
				if (change?.operation !== "complete" && change?.operation !== "block") return;
				if (istWurzel(ctx.agents, agent) || !istTeamModus(agent, umgebung)) return;
				if (change.operation === "block") {
					const grund = change.goal?.blockedReason;
					stelleZu(agent, `[Ziel blockiert — Agent ${agent.id}]\n\n${kuerze(change.goal?.objective, 300)}\n\nGrund (${grund?.code ?? "?"}): ${grund?.message ?? "nicht angegeben"}`, nachrichtenBaustein);
					protokolliere(`blockade gemeldet agent=${agent.id} ziel=${change.goal?.id}`);
					return;
				}
				const zielId = change.goal?.id;
				const bericht = zielId === undefined ? undefined : leseBericht(zielId, ordner);
				if (bericht === undefined) { protokolliere(`complete ohne Bericht agent=${agent.id} ziel=${zielId}: nichts zuzustellen`); return; }
				if (bericht.zugestellt === true) { protokolliere(`bericht schon zugestellt agent=${agent.id} ziel=${zielId}`); return; }
				if (stelleZu(agent, `[Schlussbericht — Agent ${agent.id}, Ziel erreicht]\n\n${bericht.bericht}`, nachrichtenBaustein)) {
					markiereZugestellt(zielId, ordner);
					protokolliere(`bericht zugestellt agent=${agent.id} ziel=${zielId}`);
				}
			} catch (fehler) { melden("warn", `goal/changed: ${fehler instanceof Error ? fehler.message : String(fehler)}`); }
		}));

		// 3. Wächter auf update_goal(complete).
		if (typeof ctx.tools?.guard === "function") {
			try { abmelder.push(ctx.tools.guard((ausfuehrung) => { try { return pruefeAbschluss(ausfuehrung, umgebung, ordner); } catch { return undefined; } })); }
			catch (fehler) { melden("warn", `Wächter nicht anmeldbar: ${String(fehler)}`); }
		}

		// 4. Kernbausteine und Werkzeuge.
		(async () => {
			[nachrichtenBaustein, werkzeugBaustein] = await Promise.all([ladeKern(PAKET_NACHRICHTEN), ladeKern(PAKET_WERKZEUGE)]);
			if (abgemeldet) return;
			testeEinmal();
			const defineTool = werkzeugBaustein?.defineTool;
			if (typeof defineTool !== "function") return;
			for (const baue of [baueBerichtWerkzeug, baueStandWerkzeug]) {
				try { abmelder.push(ctx.tools.register(baue({ defineTool, umgebung, ordner }))); }
				catch (fehler) { melden("warn", `Werkzeug nicht anmeldbar: ${fehler instanceof Error ? fehler.message : String(fehler)}`); }
			}
		})();

		melden("info", `geladen; Notschalter ${notschalterPfad()}`);
		return () => {
			abgemeldet = true;
			for (const rueck of rueckholer.values()) { try { rueck(); } catch { /* Abbau darf nicht werfen */ } }
			rueckholer.clear();
			for (const ab of abmelder) { try { if (typeof ab === "function") ab(); } catch { /* ebenso */ } }
		};
	}, "team-modus lifecycle");
}
