/**
 * team-modus — im Team-Modus fallen die Meldungen „einfach nur fertig“ weg, Fehler bleiben laut,
 * und ein Ziel lässt sich nur mit Bericht abschließen
 * ====================================================================================================
 *
 * STAND: Eingespielt als Bundel 0.8.5 auf main (2026-11-09); wirkt ab dem Neustart von dsh web,
 * den nur der Mensch tut. Der Notschalter wirkt jederzeit ohne Neustart.
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
 *  6. GESPRÄCHSÜBERNAHME (F3, Entscheidung 2026-11-09 „zwingend“). Schreibt der Mensch (Quelle `user` mit `rpcId`) einem
 *     Mitglied, dessen Ziel `active` ist, entwaffnet das Modul das Ziel in `Agent.send`, also VOR der Zustellung (`goals.disarm`).
 *     Läuft gerade eine Runde, läuft sie zu Ende („angehalten, nicht abgebrochen“); sobald der Agent ruhig ist, wird das Ziel
 *     pausiert. Der Vorgesetzte bekommt EINE Meldung „Mensch hat Kommunikation mit Agent <Name> übernommen, stand by“; weitere
 *     Nachrichten des Menschen melden nichts. Setzt der Mensch das Ziel fort (`goal/changed` `resume`), kommt EINE Meldung
 *     „Mensch hat <Name> freigegeben, Ziel lautet jetzt: <Wortlaut>“. Liste: `state/uebernahmen.json` (für den späteren Ticker).
 *  7. KANÄLE (F5, Weg A). `give_task` (Pflicht: Zielbrief + maxrunden; legt das Ziel für den Empfänger an, weckt ihn bei Bedarf),
 *     `ask_question` (still, ohne Ziel, auch an `mensch`), und ein Wächter, der das TEAM-Werkzeug `send_message` (Parameter
 *     `target`) im Team-Modus ablehnt. Das Unteragenten-Werkzeug `send_message` (`agent_id`) und `send_to_session` bleiben frei.
 *
 * WAS DIESES MODUL NICHT TUT
 *  - Kein Eingriff in den Kochmodus der Szene — F7 (steht in der AGENTS.md des Projekts, §0.3a).
 *  - Kein ist-Leser für Fragen an den Menschen in der Web-GUI (Ticker, zweiter Schritt); die Fragen stehen in `state/fragen-an-mensch.jsonl`.
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

/** Wie viele Sitzungen `team_stand` je Aufruf höchstens anfässt (Menschenentscheidung O3, 2026-11-10: 60). */
export const KIND_GRENZE = 60;

/** Gesamtzeitgrenze eines `team_stand`-Aufrufs in Sekunden (Menschenentscheidung O3, 2026-11-10: 120). */
export const STAND_FRIST_S = 120;

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
	"Below the members, the answer carries `untergruppen`: one group per employee (`gruppe: 'mitglied'`, headed by that member's session id) holding that member's own subagents and their descendants (each row with `depth` and `parentId`), plus a final group (`gruppe: 'eigeneUnteragenten'`) holding the caller's own subagents who belong to no member. A teammate is never listed twice; deduplication runs by session id, never by name.",
	"",
	"Use it instead of asking members for status. A member that ended a turn without completing its goal is NOT reported to you any more in Team mode (the plain 'finished' notice is dropped); this overview is how you see it."
].join("\n");

/** Der Satz für eine Gruppe, in der mangels Dienst gar keine Kinder gelesen wurden (Plan Schritt 2). */
export const UNTERAGENTEN_DIENST_FEHLT = "Unteragenten nicht gelesen: Dienst fehlt";

/** Der Aktivierungs-Text für ein Kind, das nicht mehr im Speicher liegt (Menschenentscheidung O1). */
export const UNBEKANNT_AKTIVIERUNG = "unbekannt (sitzt nicht in der Datei)";

/**
 * Liest eine Kinder-Gruppe breadth-first unter einem Gruppenkopf: je Sitzung ihr eigener Katalog via
 * `umgebung.kinderListe`, jede gefundene Zeile materialisiert über {@link leseSitzungsKern}. Das
 * Lesebudget (O3: {@link KIND_GRENZE} Sitzungen und {@link STAND_FRIST_S} Sekunden Gesamtfrist) wird
 * je Gruppe nach der Reihe geprüft. Die Tiefenstufe zählt relativ zum Gruppenkopf: ein direktes Kind
 * steht bei `depth: 1`, sein Kind (der Enkel des Kopfes) bei `depth: 2`; die Elternkennung kommt aus
 * dem Katalog-Element, sonst aus der Ebene, die es gelesen hat (`listChildren` selbst liefert kein
 * `parentId` — gemessen in `ergebnis_stand4.json`, dort schrieb nur der Treiber `parent`).
 * Doppelung über die Sitzungskennung: ein Eintrag in `besprochen` (alle Team-Mitglieder, später
 * jedes behandelte Kind) erscheint nie als Kinderzeile; sein Unterlauf wird dort nicht noch einmal
 * betreten — er bekommt seine eigene Gruppe.
 */
export async function leseKinderGruppe(gruppe, kopfId, umgebung, ordner, uebernahmenListe, budget, zeitVorbei, dienstFehlt, besprochen) {
	if (gruppe !== "mitglied" && gruppe !== "eigeneUnteragenten") throw new Error(`leseKinderGruppe: unbekannter gruppe-Wert "${gruppe}"`);
	const ergebnis = { gruppe, id: kopfId, unteragenten: [] };
	if (dienstFehlt) { ergebnis.fehler = UNTERAGENTEN_DIENST_FEHLT; return ergebnis; }
	let katalog;
	try { katalog = await umgebung.kinderListe(String(kopfId)); }
	catch (fehler) { katalog = { fehler: kuerze(fehler instanceof Error ? fehler.message : String(fehler), 120) }; }
	if (katalog === null) { ergebnis.fehler = UNTERAGENTEN_DIENST_FEHLT; return ergebnis; } // Dienst fehlt (Plan Schritt 2).
	if (!Array.isArray(katalog)) { ergebnis.fehler = `Katalog nicht lesbar: ${String(katalog?.fehler ?? "unbekannt")}`; return ergebnis; }
	budget.gezaehlt += 1; // Der Gruppenkopf ist eine gelesene Sitzung.
	const warteschlange = katalog.map((z) => ({ row: z, tiefe: 1, elternId: String(kopfId) }));
	let abgeschnittenGrund = null;
	while (warteschlange.length > 0) {
		if (zeitVorbei()) { abgeschnittenGrund = "zeit"; break; }
		if (budget.gezaehlt >= KIND_GRENZE) { abgeschnittenGrund = "anzahl"; break; }
		const { row, tiefe, elternId } = warteschlange.shift();
		budget.gezaehlt += 1;
		const id = String(row.id);
		if (besprochen?.has(id)) continue; // Team-Mitglied in einer fremden Gruppe: nie nochmal.
		besprochen?.add(id);
		const kern = await leseSitzungsKern(id, umgebung, ordner, uebernahmenListe);
		ergebnis.unteragenten.push({
			id, label: row.label ?? "", createdAt: row.createdAt ?? null, depth: tiefe, parentId: row.parentId ?? elternId,
			zustand: kern.zustand, ziel: kern.ziel, aktivierung: kern.aktivierung,
			zeitLetztesEreignis: kern.zeitLetztesEreignis, angehaltenSeit: kern.angehaltenSeit, bericht: kern.bericht, gelesenAus: kern.gelesenAus
		});
		let kinder;
		try { kinder = await umgebung.kinderListe(id); }
		catch (fehler) { kinder = { fehler: kuerze(fehler instanceof Error ? fehler.message : String(fehler), 120) }; }
		if (!Array.isArray(kinder)) continue; // Kinderkatalog nicht lesbar — die Zeile des Kindes selbst bleibt stehen.
		for (const kind of kinder) warteschlange.push({ row: kind, tiefe: tiefe + 1, elternId: id });
	}
	if (abgeschnittenGrund !== null && warteschlange.length > 0) {
		const anzahl = warteschlange.length;
		const text = abgeschnittenGrund === "zeit" ? `Zeitgrenze erreicht: ${anzahl} Kinder nicht gelesen` : `Grenze erreicht: ${anzahl} Kind-Sitzungen nicht gelesen`;
		if (ergebnis.unteragenten.length === 0) { ergebnis.fehler = text; } // Vollständig ungelesene Gruppe: Meldung an den Gruppenkopf.
		else {
			for (const { row, tiefe } of warteschlange) ergebnis.unteragenten.push({
				id: String(row.id), label: row.label ?? "", createdAt: row.createdAt ?? null, depth: tiefe, parentId: row.parentId ?? kopfId,
				zustand: null, ziel: null, aktivierung: null, zeitLetztesEreignis: null, angehaltenSeit: null, bericht: false, gelesenAus: "nicht gelesen"
			});
			ergebnis.unteragenten.push({ marke: "grenze", text });
		}
		budget.gezaehlt += anzahl; // Nicht gelesene Sitzungen verbrauchen das Budget (Zeit- und Zahlengrenze bleiben ehrlich).
	}
	// Sortierung nach Anlegezeit aufsteigend, ohne createdAt ans Ende; eine Markerzeile bleibt letzte.
	const markeZeilen = ergebnis.unteragenten.filter((z) => z.marke === "grenze");
	const normale = ergebnis.unteragenten.filter((z) => z.marke !== "grenze");
	normale.sort((a, b) => {
		if (a.createdAt == null && b.createdAt == null) return 0;
		if (a.createdAt == null) return 1;
		if (b.createdAt == null) return -1;
		return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
	});
	ergebnis.unteragenten = markeZeilen.length > 0 ? [...normale, ...markeZeilen] : normale;
	return ergebnis;
}

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
				untergruppen: { type: "array", required: true, items: { type: "object", additionalProperties: true } },
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
			/** Die Sitzungskennungen aller Team-Mitglieder — ihre Unterbäume gehören in ihre eigene Gruppe (A4). */
			const mitgliedsIds = new Set();
			for (const zeile of zeilen) {
				if (zeile.role !== "teammate") continue;
				mitgliedsIds.add(String(zeile.id));
			}
			const uebernahmenListe = typeof umgebung.uebernahmenListe === "function" ? umgebung.uebernahmenListe() : leseUebernahmen();
			const startMs = Date.now();
			const fristBis = startMs + STAND_FRIST_S * 1000;
			const budget = { gezaehlt: 0 };
			const zeitVorbei = () => Date.now() >= fristBis;
			/** Kinder-Erhebung nur, wenn es sie gibt; bei fehlendem Dienst wird sie übersprungen (Plan Schritt 2). */
			const dienstFehlt = typeof umgebung.kinderListe !== "function";

			for (const zeile of zeilen) {
				if (zeile.role !== "teammate") continue;
				mitglieder.push(await umgebung.leseMitglied(zeile, ordner, uebernahmenListe));
			}

			// Kinder-Gruppen: je Teammitglied seine eigene Gruppe (in der Reihenfolge von listMembers),
			// dann die Gruppe der Kinder des Aufrufers selbst. Doppelung über die Sitzungskennung, nie über Namen.
			const besprochen = new Set(mitgliedsIds);
			const gruppen = [];
			for (const zeile of zeilen) {
				if (zeile.role !== "teammate") continue;
				gruppen.push(await leseKinderGruppe("mitglied", String(zeile.id), umgebung, ordner, uebernahmenListe, budget, zeitVorbei, dienstFehlt, besprochen));
			}
			gruppen.push(await leseKinderGruppe("eigeneUnteragenten", String(agent.id), umgebung, ordner, uebernahmenListe, budget, zeitVorbei, dienstFehlt, besprochen));

			return {
				teamModus: istTeamModus(agent, umgebung),
				notschalter,
				mitglieder,
				untergruppen: gruppen,
				hinweis: "One row per teammate ('mitglieder'); 'ziel' is null when the member has no goal; 'zeitLetztesEreignis' is the last session event; 'gelesenAus' says live agent or stored session. 'untergruppen' groups subagents per employee: one 'mitglied' group headed by that member's session id holding its own descendants (depth and parentId relative to the group head), then 'eigeneUnteragenten' for the caller's own subagents who belong to no member. A teammate is never listed twice; deduplication is by session id. For a torn-down ('abgebaut') child the goal stays readable but whether it runs on is not — 'aktivierung' then says 'unbekannt (sitzt nicht in der Datei)'."
			};
		}
	});
}

/**
 * Gemeinsamer Lesekern: Ziel, Berichtflag, Zeit des letzten Ereignisses und Angehaltenseit für eine
 * Sitzungskennung — bei einem lebenden Agenten aus Registry und Agentenobjekt, sonst aus der
 * gespeicherten Sitzung mit Frist. Der Zustand („läuft“ / „ruht“ / „abgebaut“) kommt mit, damit die
 * Kinderzeilen ihn nicht gesondert bestimmen müssen. Dieser Kern wirft nie: eine fehlgeschlagene
 * Lesung steht lesbar in `gelesenAus`, und `ziel: null` (kein Ziel) bleibt von „nicht lesbar“ unterscheidbar.
 */
export async function leseSitzungsKern(id, umgebung, ordner = berichtOrdner(), uebernahmen) {
	const formen = (z, aktivierung) => ({
		phase: z.phase,
		...(aktivierung === undefined ? {} : { aktivierung }),
		runden: z.roundsStarted ?? null,
		maxRunden: z.maxGoalRounds ?? null,
		wortlaut: kuerze(z.objective, 200)
	});
	const basis = { angehaltenSeit: angehaltenSeitAus(uebernahmen ?? leseUebernahmen(), id) };
	try {
		const lebend = umgebung.agenten.get(id);
		if (lebend !== undefined) {
			const ziel = umgebung.ziel(lebend);
			let zeit = null;
			try {
				const ereignisse = lebend.session.snapshotEvents(Math.max(0, lebend.session.seq - 1));
				zeit = ereignisse.at(-1)?.time ?? null;
			} catch { /* Zeit ist Beiwerk */ }
			return { ...basis, gelesenAus: "lebender Agent", zustand: lebend.status === "running" ? "läuft" : "ruht",
				ziel: ziel === undefined ? null : formen(ziel, ziel.activation),
				aktivierung: ziel === undefined ? null : (ziel.activation ?? null),
				bericht: ziel === undefined ? false : hatBericht(ziel.id, ordner),
				zeitLetztesEreignis: zeit === null ? null : new Date(zeit).toISOString() };
		}
		const beobachtung = await umgebung.beobachte(id, LESE_FRIST_MS);
		if (beobachtung === undefined) return { ...basis, gelesenAus: "nicht lesbar", zustand: "abgebaut", ziel: null, bericht: false, zeitLetztesEreignis: null };
		try {
			const projektion = beobachtung.projections?.values?.goal;
			const ziel = projektion?.goal;
			const zeit = beobachtung.events?.at?.(-1)?.time;
			return { ...basis, gelesenAus: "gespeicherte Sitzung", zustand: "abgebaut",
				ziel: ziel === undefined ? null : { ...formen({ ...ziel, roundsStarted: projektion.roundsStarted }, undefined) },
				aktivierung: ziel === undefined ? null : UNBEKANNT_AKTIVIERUNG,
				bericht: ziel === undefined ? false : hatBericht(ziel.id, ordner),
				zeitLetztesEreignis: typeof zeit === "number" ? new Date(zeit).toISOString() : null };
		} finally { beobachtung[Symbol.dispose]?.(); }
	} catch (fehler) {
		return { ...basis, gelesenAus: `Fehler: ${kuerze(fehler instanceof Error ? fehler.message : String(fehler), 120)}`, zustand: "abgebaut", ziel: null, bericht: false, zeitLetztesEreignis: null };
	}
}

/**
 * Liest Ziel und Zeit eines Mitglieds: lebend aus dem Agenten, sonst aus der gespeicherten Sitzung.
 * Die Abfrage der gespeicherten Sitzung bekommt eine Frist, damit eine sehr große Sitzung die Übersicht nicht
 * aufhält (nicht gemessen, wie lange das bei den größten Sitzungen dauert — siehe Konzept, offene Punkte).
 */
export async function leseMitglied(zeile, umgebung, ordner = berichtOrdner(), uebernahmen) {
	return { name: zeile.name, id: zeile.id, status: zeile.status, ...await leseSitzungsKern(zeile.id, umgebung, ordner, uebernahmen) };
}

// ---------------------------------------------------------------------------------------------------
// Teil 4: Gesprächsübernahme (F3) und die Kanäle nach unten und zur Seite (F5, Weg A)
// ---------------------------------------------------------------------------------------------------

/** Namen der beiden neuen Werkzeuge. */
export const WERKZEUG_AUFTRAG = "give_task";
export const WERKZEUG_FRAGE = "ask_question";

export const uebernahmenPfad = () => join(datenOrdner(), "state", "uebernahmen.json");
export const fragenPfad = () => join(datenOrdner(), "state", "fragen-an-mensch.jsonl");

/** Kürzeste Länge eines Zielbriefs; kürzer ist kein Brief. */
const MIN_ZIELBRIEF = 40;

/** Der Hinweis, wenn `give_task` ohne Zielbrief aufgerufen wird. */
export const HINWEIS_OHNE_ZIELBRIEF =
	"give_task needs a goal brief (parameter `zielbrief`) and a round limit (`maxrunden`). Write the brief so the recipient can work without " +
	"the conversation: purpose (which higher goal it serves), subject (what exactly, with paths and numbers), limits (what is theirs, what they " +
	"must not touch), instructions, acceptance (measurements with target values), reporting duties. If you only want to ask something, use " +
	"ask_question instead; it needs no goal.";

/** Der Hinweis, den `send_message` im Team-Modus bekommt. */
export const HINWEIS_SEND_MESSAGE =
	"Team mode: send_message is not available here. To give a teammate WORK, use give_task (it needs a goal brief and a round limit). " +
	"To ASK a teammate or the human something, use ask_question (it needs no goal and is answered quietly). Your supervisor receives your " +
	"closing report through goal_report and update_goal complete, not through send_message.";

/** Ist das eine Nachricht des Menschen (Eingabe des Menschen, nicht eines Agenten oder Plugins)? */
export function istMenschlicheNachricht(nachricht) {
	const quelle = nachricht?.source;
	return quelle?.kind === "user" && quelle.rpcId !== undefined && quelle.rpcId !== null;
}

/** Liest die Liste der Übernahmen (Datei, nur zum Nachsehen und für den späteren Ticker). */
export function leseUebernahmen(pfad = uebernahmenPfad()) {
	try {
		const roh = JSON.parse(readFileSync(pfad, "utf8"));
		return Array.isArray(roh) ? roh : [];
	} catch { return []; }
}

/**
 * Die Zeit, seit der Mensch diesen Agenten durch eine Nachricht übernommen (angehalten) hat —
 * oder `null`, wenn die Liste keinen Eintrag für diese Sitzungskennung enthält.
 *
 * Der Wert kommt aus dem Eintrag selbst, unabhängig von `pauseOffen`: `seit` ist die Zeit der
 * Übernahme, und `uebernehmeGespraech` schreibt einen Eintrag genau dann, wenn der Mensch einem
 * Agenten mit laufendem Ziel schreibt (Zeile "kein laufendes Ziel" lehnt sonst ab). Der Nachbar-
 * zustand innerhalb einer bestehenden Übernahme — "die Runde läuft noch zu Ende" (`pauseOffen: true`)
 * gegenüber "sofort pausiert" — ändert an der Zeit nichts. Kein Eintrag heißt "nie angehalten" und
 * ist `null`, ausdrücklich nicht "unbekannt": "unbekannt (sitzt nicht in der Datei)" bleibt das Feld
 * Aktivierung aus O1 vorbehalten.
 */
export function angehaltenSeitAus(eintraege, sitzungsId) {
	if (!Array.isArray(eintraege)) return null;
	const gesuchte = String(sitzungsId ?? "");
	return eintraege.find((e) => e?.id === gesuchte)?.seit ?? null;
}

/**
 * Liest die Angehaltenseit-Zeit aus der Übernahme-Datei. `eintraege` (wetterfeste Liste aus dem
 * Speicher oder einer Datei) kann vorbegeben werden, um die Datei nicht mehrfach zu lesen.
 */
export function angehaltenSeit(sitzungsId, eintraege) {
	return angehaltenSeitAus(eintraege ?? leseUebernahmen(), sitzungsId);
}

/** Schreibt die Liste der Übernahmen. Ein fehlendes Recht verhindert nie eine Entscheidung. */
export function schreibeUebernahmen(liste, pfad = uebernahmenPfad()) {
	try {
		mkdirSync(dirname(pfad), { recursive: true });
		writeFileSync(pfad, `${JSON.stringify(liste, null, 1)}\n`);
	} catch { /* Beiwerk */ }
}

/** Die Zeile eines Mitglieds nach Name (ohne Beachtung der Großschreibung) im Team der Wurzel dieses Agenten. */
export function findeMitglied(umgebung, agent, name) {
	const dienst = umgebung.teams();
	if (dienst === undefined) return { zeilen: [], zeile: undefined };
	const zeilen = dienst.listMembers(wurzelVon(umgebung.agenten, agent));
	const gesucht = String(name ?? "").trim().toLowerCase();
	return { zeilen, zeile: zeilen.find((z) => String(z.name).toLowerCase() === gesucht) };
}

/**
 * Wächter für `send_message` im Team-Modus (Entscheidung F5, Weg A).
 *
 * Nur das Team-Werkzeug mit dem Parameter `target` ist gemeint. Das Werkzeug `send_message` der Unteragenten
 * (Parameter `agent_id`) bleibt unberührt, ebenso `send_to_session` (Antwort eines Berater-Forks an seinen
 * Vorgesetzten) — beides läuft nicht über dieses Werkzeug.
 *
 * @returns den Ablehnungstext oder `undefined`.
 */
export function pruefeSendMessage(ausfuehrung, umgebung) {
	if (ausfuehrung?.name !== "send_message") return undefined;
	const agent = ausfuehrung.agent;
	if (agent === undefined) return undefined;
	let argumente = ausfuehrung.arguments;
	if (typeof argumente === "string") { try { argumente = JSON.parse(argumente); } catch { return undefined; } }
	if (argumente === null || typeof argumente !== "object" || !("target" in argumente)) return undefined;
	if (!istTeamModus(agent, umgebung)) return undefined;
	return HINWEIS_SEND_MESSAGE;
}

const BESCHREIBUNG_AUFTRAG = [
	"Give a teammate WORK. Creates a goal for the recipient from your goal brief and starts it; the recipient works on its own and reports back with goal_report when the goal is done. Use it for every assignment. For a plain question use ask_question.",
	"",
	"`zielbrief` is mandatory and must stand on its own: purpose, subject (paths, numbers), limits, instructions, acceptance (measurement and target value), reporting duties. `maxrunden` is the upper bound of work rounds. `aufgabenliste` (optional) holds the todo items the recipient should create first.",
	"",
	"It fails with a clear message when the brief or the round limit is missing, when the recipient is not one of your direct teammates, is not running, already has a goal, or is currently talking to the human."
].join("\n");

const BESCHREIBUNG_FRAGE = [
	"Ask a teammate or the human something. No goal is needed and nothing is reported upward: the question is delivered quietly, the answer comes back as a message.",
	"",
	"`empfaenger` is a teammate name, `lead`, or `mensch`. A question to `mensch` is recorded for the human (the team overview shows it later); after asking, call await_goal_dependency so your goal waits without burning rounds. A teammate who is currently talking to the human cannot be asked."
].join("\n");

/** Baut `give_task`. */
export function baueAuftragWerkzeug({ defineTool, umgebung }) {
	return defineTool({
		name: WERKZEUG_AUFTRAG,
		description: BESCHREIBUNG_AUFTRAG,
		parameters: {
			empfaenger: { type: "string", required: true, description: "Name of the teammate (see list_agents)." },
			// Absichtlich NICHT `required`: fehlt ein Wert, soll das Modell unsere verständliche Meldung bekommen, nicht die
			// knappe Schemameldung des Kerns („missing required property“) — gemessen in der Probe (Abnahme d).
			zielbrief: { type: "string", description: "MANDATORY. The complete goal brief (purpose, subject, limits, instructions, acceptance, reporting duties)." },
			maxrunden: { type: "integer", description: "MANDATORY. Upper bound of work rounds for the goal." },
			aufgabenliste: { type: "string", description: "Optional todo items the recipient creates first, one per line." }
		},
		output: {
			schema: { type: "object", additionalProperties: false, properties: {
				angelegt: { type: "boolean", required: true },
				empfaenger: { type: "string", required: true },
				zielId: { type: "string", required: true },
				hinweis: { type: "string", required: true }
			} },
			render: (_args, wert) => [{ type: "text", text: JSON.stringify(wert) }]
		},
		presentCall: (args) => ({ card: "generic", title: `Give task to ${args?.empfaenger ?? "teammate"}`, kind: "other" }),
		presentResult: () => ({ card: "generic", title: "Task given" }),
		isConcurrencySafe: () => false,
		execute: async (args, exec) => {
			const absender = exec?.agent;
			if (absender === undefined) throw new Error("give_task needs a calling agent");
			if (!istTeamModus(absender, umgebung)) throw new Error("give_task is only available in Team mode (a team with at least one active teammate).");
			const brief = typeof args?.zielbrief === "string" ? args.zielbrief.trim() : "";
			const runden = args?.maxrunden;
			if (brief.length < MIN_ZIELBRIEF || !Number.isSafeInteger(runden) || runden < 1) throw new Error(HINWEIS_OHNE_ZIELBRIEF);
			const { zeilen, zeile } = findeMitglied(umgebung, absender, args?.empfaenger);
			if (zeile === undefined) throw new Error(`unknown recipient "${args?.empfaenger}". Teammates: ${zeilen.map((z) => z.name).join(", ")}.`);
			if (zeile.id === absender.id) throw new Error("give_task cannot go to yourself.");
			let empfaenger = umgebung.agenten.get(zeile.id);
			if (empfaenger === undefined && typeof umgebung.wecke === "function" && ["inactive", "running"].includes(zeile.status)) {
				// Ein ruhendes Mitglied ist meist abgebaut (gemessen: Kind nach seinem Zug nicht mehr lebend); eine stille Nachricht weckt es.
				try { empfaenger = await umgebung.wecke(absender, zeile, exec.signal); } catch (fehler) { protokolliere(`warn Wecken von ${zeile.name} gescheitert: ${fehler instanceof Error ? fehler.message : String(fehler)}`); }
			}
			if (empfaenger === undefined) throw new Error(`${zeile.name} is not running (status ${zeile.status}) and could not be woken. Try ask_question first, then call give_task again.`);
			if (empfaenger.session?.header?.parentSession !== absender.id) throw new Error("give_task only goes DOWN: to your own direct teammates or workers. To report upward use goal_report.");
			if (umgebung.uebernommen(zeile.id)) throw new Error(`${zeile.name} is talking to the human right now; the human decides when it is released. Try again after the release message.`);
			const vorhanden = umgebung.ziel(empfaenger);
			if (vorhanden !== undefined && vorhanden.phase !== "complete") throw new Error(`${zeile.name} already has a goal (phase ${vorhanden.phase}). Wait for its report or ask it with ask_question.`);
			const liste = typeof args?.aufgabenliste === "string" ? args.aufgabenliste.trim() : "";
			const wortlaut = liste === "" ? brief : `${brief}\n\n[Todo list to create first with todo_write]\n${liste}`;
			const ziel = umgebung.erzeugeZiel(empfaenger, { objective: wortlaut, maxGoalRounds: runden });
			protokolliere(`auftrag von=${absender.id} an=${zeile.name} ziel=${ziel.id} maxrunden=${runden}`);
			return { angelegt: true, empfaenger: String(zeile.name), zielId: String(ziel.id), hinweis: "Goal created and started for the recipient. You are told through its closing report; use team_stand to look in without waking anyone." };
		}
	});
}

/**
 * Der Text, der beim Empfänger einer Frage ankommt. Er nennt den NAMEN des Fragenden (nicht die Sitzungs-Kennung,
 * denn `ask_question` nimmt Namen) und sagt, wann nicht zu antworten ist, damit aus Frage und Dank keine Kette wird.
 * (Gemessen im Probelauf mit echtem Modell: ohne diesen Satz bedankte sich das Mitglied für die Antwort, und der Lead
 * wurde dafür ein weiteres Mal geweckt.)
 */
export function baueFrageText(fragenderName, text) {
	return `[Question from ${fragenderName}. Answer with ask_question(empfaenger: "${fragenderName}") only if you have information to give. ` +
		`Do not send thanks, confirmations or follow-up offers. send_message is not available in Team mode.]\n\n${text}`;
}

/** Baut `ask_question`. */
export function baueFrageWerkzeug({ defineTool, umgebung, fragen = fragenPfad() }) {
	return defineTool({
		name: WERKZEUG_FRAGE,
		description: BESCHREIBUNG_FRAGE,
		parameters: {
			empfaenger: { type: "string", required: true, description: "Teammate name, `lead`, or `mensch`." },
			frage: { type: "string", required: true, description: "The question, self-contained." }
		},
		output: {
			schema: { type: "object", additionalProperties: false, properties: {
				zugestellt: { type: "boolean", required: true },
				empfaenger: { type: "string", required: true },
				hinweis: { type: "string", required: true }
			} },
			render: (_args, wert) => [{ type: "text", text: JSON.stringify(wert) }]
		},
		presentCall: (args) => ({ card: "generic", title: `Ask ${args?.empfaenger ?? "teammate"}`, kind: "other" }),
		presentResult: () => ({ card: "generic", title: "Question asked" }),
		isConcurrencySafe: () => false,
		execute: async (args, exec) => {
			const absender = exec?.agent;
			if (absender === undefined) throw new Error("ask_question needs a calling agent");
			const text = typeof args?.frage === "string" ? args.frage.trim() : "";
			if (text === "") throw new Error("`frage` is empty.");
			const ziel = String(args?.empfaenger ?? "").trim();
			if (ziel.toLowerCase() === "mensch") {
				try {
					mkdirSync(dirname(fragen), { recursive: true });
					appendFileSync(fragen, `${JSON.stringify({ zeit: new Date().toISOString(), von: absender.id, frage: text })}\n`);
				} catch (fehler) { throw new Error(`the question could not be recorded: ${fehler instanceof Error ? fehler.message : String(fehler)}`); }
				protokolliere(`frage an=mensch von=${absender.id}`);
				return { zugestellt: true, empfaenger: "mensch", hinweis: "Recorded for the human. Now call await_goal_dependency so your goal waits for the answer without burning rounds." };
			}
			if (!istTeamModus(absender, umgebung)) throw new Error("ask_question to a teammate is only available in Team mode; outside it use the normal send_message.");
			const { zeilen, zeile } = findeMitglied(umgebung, absender, ziel);
			if (zeile === undefined) throw new Error(`unknown recipient "${ziel}". Members: ${zeilen.map((z) => z.name).join(", ")}, or "mensch".`);
			if (zeile.id === absender.id) throw new Error("ask_question cannot go to yourself.");
			if (umgebung.uebernommen(zeile.id)) throw new Error(`${zeile.name} is talking to the human right now; ask again after the release.`);
			await umgebung.sendeFrage(absender, zeile.name, text, exec.signal);
			protokolliere(`frage von=${absender.id} an=${zeile.name}`);
			return { zugestellt: true, empfaenger: String(zeile.name), hinweis: "Delivered quietly. The answer arrives as a message; call await_goal_dependency if your goal should wait for it." };
		}
	});
}

/**
 * Die Gesprächsübernahme: ein Mensch schreibt einem Mitglied, dessen Ziel läuft.
 *
 * Arbeitet synchron und muss VOR der Zustellung laufen (sie hängt in `Agent.send`, der frühesten öffentlichen
 * Stelle: vor dem Eingangskorb, vor dem Rundentreiber und vor `goal-await`). Sie
 *  1. entwaffnet das Ziel (`goals.disarm`): ab jetzt startet der Rundentreiber keine neue Runde;
 *  2. legt das Ziel in die Pause, sobald der Agent ruhig ist (eine laufende Runde läuft zu Ende, „angehalten, nicht
 *     abgebrochen“); ohne Lauf sofort;
 *  3. meldet dem Vorgesetzten EINMAL „… übernommen, stand by“.
 * Weitere Nachrichten des Menschen an dasselbe Mitglied ändern nichts und melden nichts.
 *
 * @param aktion - `{ ziel(agent), disarm(agent), pause(agent, ref), melde(agent, text), name(agent), laeuft(agent) }`.
 * @returns `{ uebernommen: boolean, grund }`
 */
export function uebernehmeGespraech(agent, nachricht, umgebung, aktion, zustand) {
	if (!istMenschlicheNachricht(nachricht)) return { uebernommen: false, grund: "keine Nachricht des Menschen" };
	if (istWurzel(umgebung.agenten, agent)) return { uebernommen: false, grund: "Wurzelsitzung" };
	if (!istTeamModus(agent, umgebung)) return { uebernommen: false, grund: "kein Team-Modus" };
	if (zustand.has(agent.id)) return { uebernommen: false, grund: "schon übernommen" };
	const ziel = aktion.ziel(agent);
	if (ziel === undefined || ziel.phase !== "active") return { uebernommen: false, grund: "kein laufendes Ziel" };
	aktion.disarm(agent);
	const eintrag = { id: agent.id, name: aktion.name(agent), zielId: ziel.id, seit: new Date().toISOString(), pauseOffen: false };
	if (aktion.laeuft(agent)) eintrag.pauseOffen = true;
	else {
		try { aktion.pause(agent, { id: ziel.id, revision: ziel.revision }); } catch (fehler) { protokolliere(`warn Pause nach Übernahme gescheitert agent=${agent.id}: ${fehler instanceof Error ? fehler.message : String(fehler)}`); }
	}
	zustand.set(agent.id, eintrag);
	aktion.melde(agent, `Mensch hat Kommunikation mit Agent ${eintrag.name} übernommen, stand by`);
	protokolliere(`uebernommen agent=${agent.id} name=${eintrag.name} ziel=${ziel.id} laeuft=${eintrag.pauseOffen}`);
	return { uebernommen: true, grund: eintrag.pauseOffen ? "Runde läuft zu Ende, Pause folgt" : "sofort pausiert" };
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
	umgebung.leseMitglied = (zeile, o, uebernahmenListe) => leseMitglied(zeile, umgebung, o, uebernahmenListe);
	// Kinder-Erhebung über den öffentlichen Unteragenten-Dienst (`subagents`), Fassade wie bei `teams`,
	// damit ein fehlendes Kernpaket das Modul nicht ganz scheitern lässt (Plan Schritt 2).
	umgebung.unteragenten = () => hole("subagents");
	/** Der Kinderkatalog einer Sitzung; `null`, wenn der Unteragenten-Dienst selbst fehlt. */
	umgebung.kinderListe = async (sitzungsId) => {
		const dienst = hole("subagents");
		if (dienst === undefined || typeof dienst.listChildren !== "function") return null;
		return await dienst.listChildren(sitzungsId);
	};
	/** Übernahmen (Mensch spricht mit dem Mitglied): Kennung → Eintrag. Beim Start aus der Datei gelesen. */
	const uebernahmen = new Map(leseUebernahmen().map((e) => [e.id, e]));
	const sichereUebernahmen = () => schreibeUebernahmen([...uebernahmen.values()]);
	/** Die Live-Liste für die Stand-Übersicht: dasselbe Gedächtnis, nicht nochmal aus der Datei. */
	umgebung.uebernahmenListe = () => [...uebernahmen.values()];
	umgebung.uebernommen = (id) => uebernahmen.has(id);
	umgebung.erzeugeZiel = (agent, anfrage) => ctx.goals.create(agent, anfrage);
	umgebung.wecke = async (absender, zeile, signal) => {
		const dienst = hole("agentTeams");
		if (dienst === undefined) return undefined;
		await dienst.sendMessage(absender, { target: zeile.name, content: [{ type: "text", text: "[Wake-up note from " + absender.id + ": a goal with a task brief follows in a moment. Do nothing until it arrives.]" }], signal: signal ?? new AbortController().signal });
		for (let i = 0; i < 30; i += 1) {
			const lebend = ctx.agents.get(zeile.id);
			if (lebend !== undefined) return lebend;
			await new Promise((fertig) => setTimeout(fertig, 150));
		}
		return undefined;
	};
	const nameDesMitglieds = (a) => {
		try { return findeMitglied(umgebung, a, "").zeilen.find((z) => z.id === a.id)?.name ?? a.id; } catch { return a.id; }
	};
	umgebung.sendeFrage = async (absender, zielName, text, signal) => {
		const dienst = hole("agentTeams");
		if (dienst === undefined) throw new Error("agentTeams service is not available");
		await dienst.sendMessage(absender, { target: zielName, content: [{ type: "text", text: baueFrageText(nameDesMitglieds(absender), text) }], signal: signal ?? new AbortController().signal });
	};

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

		/**
		 * Läuft vor jeder Zustellung an einen Agenten. Zuerst die Gesprächsübernahme (Nebenwirkung: Ziel entwaffnen,
		 * Pause, EINE Meldung nach oben), danach der Filter. Wirft die Übernahme, geht die Nachricht trotzdem durch.
		 */
		const entscheiden = (agent, nachricht) => {
			try {
				const erg = uebernehmeGespraech(agent, nachricht, umgebung, {
					ziel: (a) => ctx.goals.get(a),
					disarm: (a) => ctx.goals.disarm(a),
					pause: (a, ref) => ctx.goals.pause(a, ref),
					laeuft: (a) => a.status === "running",
					name: (a) => nameDesMitglieds(a),
					melde: (a, text) => { stelleZu(a, text, nachrichtenBaustein); }
				}, uebernahmen);
				if (erg.uebernommen) sichereUebernahmen();
			} catch (fehler) { melden("warn", `Gesprächsübernahme: ${fehler instanceof Error ? fehler.message : String(fehler)}`); }
			return entscheide(agent, nachricht, umgebung);
		};

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
		abmelder.push(ctx.on("agent/status", ({ agent, status }) => {
			try {
				const eintrag = uebernahmen.get(agent?.id);
				if (eintrag === undefined || eintrag.pauseOffen !== true || status === "running") return;
				const ziel = ctx.goals.get(agent);
				eintrag.pauseOffen = false;
				sichereUebernahmen();
				if (ziel !== undefined && ziel.phase === "active" && ziel.id === eintrag.zielId) {
					ctx.goals.pause(agent, { id: ziel.id, revision: ziel.revision });
					protokolliere(`pause nachgeholt agent=${agent.id} ziel=${ziel.id}`);
				}
			} catch (fehler) { melden("warn", `agent/status: ${fehler instanceof Error ? fehler.message : String(fehler)}`); }
		}));

		// 2. Ziel-Ereignisse: Abschluss (Bericht zustellen) und Blockade (melden).
		abmelder.push(ctx.on("goal/changed", ({ agent, change }) => {
			try {
				if (change?.operation === "resume" && uebernahmen.get(agent.id)?.pauseOffen === true) {
					// Das Ziel wurde wieder scharf geschaltet, obwohl die Pause noch aussteht (die laufende Runde läuft noch). Das
					// kann nur ein anderer Wecker sein (etwa goal-await bei einer eingehenden Nachricht oder beim Fristablauf);
					// der Mensch kann ein noch nicht pausiertes Ziel nicht „fortsetzen“. Also: sofort wieder entwaffnen,
					// keine Freigabe-Meldung.
					ctx.goals.disarm(agent);
					protokolliere(`wiederbewaffnung abgewehrt agent=${agent.id} ziel=${change.goal?.id}`);
					return;
				}
				if (change?.operation === "resume" && uebernahmen.has(agent.id)) {
					const eintrag = uebernahmen.get(agent.id);
					uebernahmen.delete(agent.id);
					sichereUebernahmen();
					stelleZu(agent, `Mensch hat ${eintrag.name} freigegeben, Ziel lautet jetzt: ${change.goal?.objective ?? "(unbekannt)"}`, nachrichtenBaustein);
					protokolliere(`freigegeben agent=${agent.id} name=${eintrag.name} ziel=${change.goal?.id}`);
					return;
				}
				if (change?.operation === "clear" && uebernahmen.has(agent.id)) {
					const eintrag = uebernahmen.get(agent.id);
					uebernahmen.delete(agent.id);
					sichereUebernahmen();
					stelleZu(agent, `Mensch hat ${eintrag.name} freigegeben; das Ziel wurde entfernt, ${eintrag.name} hat jetzt kein Ziel.`, nachrichtenBaustein);
					protokolliere(`freigegeben (Ziel entfernt) agent=${agent.id} name=${eintrag.name}`);
					return;
				}
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
			try { abmelder.push(ctx.tools.guard((ausfuehrung) => { try { return pruefeAbschluss(ausfuehrung, umgebung, ordner) ?? pruefeSendMessage(ausfuehrung, umgebung); } catch { return undefined; } })); }
			catch (fehler) { melden("warn", `Wächter nicht anmeldbar: ${String(fehler)}`); }
		}

		// 4. Kernbausteine und Werkzeuge.
		(async () => {
			[nachrichtenBaustein, werkzeugBaustein] = await Promise.all([ladeKern(PAKET_NACHRICHTEN), ladeKern(PAKET_WERKZEUGE)]);
			if (abgemeldet) return;
			testeEinmal();
			const defineTool = werkzeugBaustein?.defineTool;
			if (typeof defineTool !== "function") return;
			for (const baue of [baueBerichtWerkzeug, baueStandWerkzeug, baueAuftragWerkzeug, baueFrageWerkzeug]) {
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
