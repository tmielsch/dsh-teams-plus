/**
 * goal-await — ein Ziel wartet auf eine Zutat, statt Runden zu verbrennen
 * =======================================================================
 *
 * WAS DER MENSCH WOLLTE (Anordnung 2026-10-25)
 * "Wenn einem Agent die Hände gebunden sind, sollte der die Möglichkeit haben,
 * das dem Goal-Tool zu melden und dann anzugeben, auf was er wartet, und dann,
 * dass das Goal-Tool checken kann, sobald es gekommen ist. […] Besser wäre es,
 * wenn das Goal-Tool automatisch verstehen würde, hey, der hat gerade das
 * bekommen, auf das er gewartet hat. […] Das Ziel dieser Goal-Funktion ist ja
 * quasi eine pausierte Session wieder auf Kurs zu bringen und auch zwischendrin
 * immer wieder mal das Ziel eigentlich reinzubringen. Und das würde ich halt
 * gerne behalten."
 *
 * DAS PROBLEM, GEMESSEN AM QUELLTEXT (dsh 0.2.0, 2026-10-25)
 * `@deepseek-ai/dsh-goal-round-driver` schiebt die nächste Runde nach, sobald
 * ein Agent mit aktivem, scharfern Ziel `idle` wird (`readyToDrive` in
 * `dsh-goal-round-driver/lib/index.js`, Zeile 80: `status === "idle" &&
 * !competitingQueued`). Ein Agent, der auf eine fremde Zutat wartet — auf die
 * Nachricht eines Teammitglieds, auf einen Hintergrundjob, auf einen Speicherpfad
 * des Lead —, beendet seinen Zug also *und bekommt sofort die nächste Runde*.
 * Er sieht nichts Neues, beendet wieder, und das Ziel verbrennt Runden und
 * Kontingent, ohne voranzukommen. Genau das hat der Mensch beobachtet.
 *
 * WAS NICHT GEHT — und deshalb ein Patch statt einer Regel
 * Das Modell kann sein eigenes Ziel nicht anhalten: `update_goal` mit
 * `action: "pause"` verlangt in `dsh-tool-goal/lib/index.js` (`requireDirectHuman`,
 * Zeile 93) eine menschliche Nachricht im offenen Zug. Und ein von Hand
 * pausiertes Ziel fortzusetzen ist dem Modell ausdrücklich verwehrt:
 * "the model cannot resume a paused goal; the user must resume it"
 * (Zeile 383). Eine reine Anweisung an die Agenten reicht deshalb nicht.
 *
 * WAS DIESES MODUL TUT (ohne eine Zeile im Kern zu ersetzen)
 * Es nutzt zwei öffentliche Dienste, die genau die benötigte Lücke haben:
 *
 *   `ctx.goals.disarm(agent)` nimmt dem Ziel die Fortsetzungs-Vollmacht und
 *   lässt die Phase auf `active` stehen (`dsh-goal/lib/index.js`, Zeile 622:
 *   "Remove process-local continuation authority without changing durable goal
 *   phase or revision."). Der Rundentreiber sieht danach `activation !==
 *   "armed"` und schiebt nichts mehr nach.
 *
 *   `ctx.goals.resume(agent, ref)` setzt sie zurück — und erlaubt ausdrücklich
 *   ein *aktives*, nur entwaffnetes Ziel (`resume`, Zeile 686: zulässig sind
 *   `active`, `paused`, `blocked`; die Sperre "schon aktiv und scharf" greift
 *   nur, wenn `activation === "armed"` ist). Das ist derselbe Weg, den der Kern
 *   nach einem Sitzungs-Neustart selbst geht.
 *
 * Das Modul legt also ein Werkzeug `await_goal_dependency` an. Ruft ein Agent
 * es auf, wird sein Ziel entwaffnet und die Wartebedingung festgehalten. Kommt
 * die Zutat an — eine Nachricht im Posteingang, eine fertig gewordene
 * Team-Aufgabe —, wird das Ziel wieder scharf geschaltet, und der
 * Rundentreiber schiebt die nächste Runde nach. Der Agent muss nichts tun, sich
 * an nichts erinnern und keine Schleife fahren.
 *
 * WAS ALS "ZUTAT ANGEKOMMEN" GILT
 *   1. `agent/inbox/inserted` für diesen Agenten — aber nicht mehr jede
 *      Nachricht. Nennt der Aufruf den erwarteten Absender (`von`), weckt nur
 *      noch eine Nachricht VON DIESEM Absender; die Zielrunde selbst
 *      (`source.kind === "goal"`) weckt nie, sonst weckt sich das Modul
 *      gegenseitig auf. Ohne `von` bleibt es beim bisherigen Verhalten.
 *   2. `session/event` mit `team/task` und `task.status === "completed"` — eine
 *      fertige Aufgabe ist auch eine Zutat, ganz ohne Nachricht. Nur für
 *      Agenten, die zu DIESEM Team gehören (siehe (C) unten).
 *   3. Ablauf der Frist (`max_wait_seconds`, Vorgabe 900 s = 15 min). Dann wird
 *      ebenfalls wieder scharf geschaltet, mit einem Hinweis im Protokoll: ein
 *      vergessener Wartezustand darf ein Ziel nie dauerhaft stilllegen.
 *
 * WARUM VERENGEN (A) UND KEIN ZWEITER WECKER AUF `activity.wait` (B)
 * Das Warten selbst war richtig; falsch war der WECKRUF. Die erste Fassung ließ
 * jede Nachricht durch, ein Gruß eines Teammates weckte also ein Ziel, das auf
 * einen Messbericht wartete. Dagegen hilft genau eine Angabe: WER die Zutat
 * bringt (`von`). Ohne Angabe bleibt alles wie vorher — das ist die
 * Rückwärtsverträglichkeit, und sie hat einen eigenen Test.
 *
 * Der naheliegende zweite Wecker — `activity.wait(teamId, …)` aus
 * `dsh-experimental-agent-team` — ist ABSICHTLICH nicht gebaut, und der Grund
 * ist gemessen, nicht geschätzt. Das Journal ruft `activity.notify` bei JEDER
 * Transaktion (`index.js` um Zeile 1834: `this.journal = new TeamJournal(ctx,
 * (root) => { this.activity.notify(TeamId(root.id)); })`), und `mailbox.send`
 * schreibt `team/message/queued` als Transaktion (`mailbox.js` Zeile 124). Ein
 * `activity.wait` weckt damit auch bei JEDER Teammate-Nachricht — genau der
 * Fehler, den (A) behebt. (B) und (A) widersprechen sich für Teammitglieder;
 * gebaut ist stattdessen der genauere Weg (C).
 *
 * (C) DER AUFGABEN-WECKER — und seine zwei Grenzen
 * `team/task` ist ein typisiertes Sitzungs-Ereignis: `TeamJournal.appendAndFlush`
 * hängt es an die Session der Team-Wurzel (`journal.js` Zeile 53-59), und der
 * Kern verteilt jeden Sitzungs-Eintrag als `session/event` (`session.js` Zeile
 * 1468). Aufgabe fertig, Ereignis da. Dieses Modul hört darauf, gefiltert auf
 * `team/task` und `status === "completed"`; eine Aufgabe, die auf
 * `in_progress` geht, weckt NICHT — sonst wäre der Wecker wieder „alles
 * weckt", nur auf einem anderen Kanal.
 * WER geweckt wird, entscheidet die Mitgliedschaft, nicht die Sitzung des
 * Ereignisses: `membership(agent)` gegen die Team-Kennung aus dem Ereignis.
 * Damit wird auch ein WARTENDES TEAMMITGLIED geweckt, obwohl das Ereignis auf
 * der Sitzung der Team-Wurzel liegt — das ist der Fall, für den der Mensch den
 * Wecker wollte ("sobald der Task fertig ist, muss die Dependency gelöst
 * werden").
 * Zwei Grenzen, offen gesagt:
 *   - Ein Agent OHNE Team (ein gewöhnlicher Sub-Agent) wird so nie geweckt. Für
 *     ihn bleibt es bei der Nachricht — richtig, weil er kein Team hat, an dem
 *     sich etwas ändern könnte.
 *   - Der Wecker fragt NICHT, WELCHE Aufgabe fertig wurde. Jede fertige Aufgabe
 *     des eigenen Teams ist ein Anlass nachzusehen. Das ist Absicht: welcher
 *     Task die Zutat ist, weiß das Modul nicht — `waiting_for` ist Prosa für
 *     den Menschen, kein Filter. Ein Filter auf Task-Kennungen wäre eine zweite
 *     Angabe, die ein Modell falsch ausfüllen kann; die Rückfrage kostet eine
 *     Runde, eine falsch gefilterte Aufgabe kostet den ganzen Wartezustand.
 *
 * Selbstwecken ist ausgeschlossen: dieses Modul schreibt kein `team/task`, und
 * nach dem Wecken ist der Wartezustand gelöscht — ein zweites Ereignis findet
 * nichts mehr. Geweckt wird außerdem nur, wer TATSAECHLICH wartet (`zustaende`
 * führt nur wartende Agenten); ein laufendes Ziel, das nicht über
 * `await_goal_dependency` wartet, fasst ein Task-Ereignis nicht an.
 *
 * WARUM DIE FRIST WICHTIG IST
 * Ein Agent, der auf etwas wartet, das nie kommt, wäre sonst für immer still.
 * Der Mensch sagte dazu: "manchmal vergessen die das dann". Die Frist kehrt die
 * Wirkung um: im schlechtesten Fall arbeitet das Ziel weiter wie vorher, im
 * guten Fall wartet es ohne Kontingentverbrauch.
 *
 * SELBSTPRÜFUNG
 *   node --test test/goal-await.test.mjs
 *   (13 Faelle plus drei Gegenproben am Code. Die frueher hier genannte Zeile
 *   `node ~/.dsh/patches/goal-await.mjs --test` war falsch: ein Selbsttest in
 *   dieser Datei hat nie existiert — der Verweis zeigte auf nichts.)
 * NACHSEHEN
 *   ~/.dsh/logs/goal-await.log
 * ZURÜCK
 *   den Eintrag `goal-await` in profiles/web/cordis.patch.yml entfernen und
 *   `dsh web` neu starten.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Die Kernpakete, die dieses Modul zur Laufzeit braucht (nie statisch importieren). */
const PAKET_WERKZEUGE = "@deepseek-ai/dsh-tools";

/** Name des Werkzeugs, das die Agenten aufrufen. */
export const WERKZEUG = "await_goal_dependency";

/** Vorgabe-Frist in Sekunden, wenn der Aufruf keine nennt. */
export const FRIST_VORGABE = 900;

/** Harte Obergrenze der Frist, damit niemand sein Ziel tagelang stilllegt. */
export const FRIST_MAX = 7200;

/** Obergrenze der Wartebedingung im Text (Schutz gegen riesige Prompts). */
const BEDINGUNG_MAX_ZEICHEN = 400;

/** Obergrenze der Absenderangabe (`von`): ein Name oder eine Sitzungs-Kennung. */
const ABSENDER_MAX_ZEICHEN = 200;

/**
 * Die Basis-Ordner der dsh-Installation, in der Reihenfolge der Wahrscheinlichkeit.
 *
 * Der Weg hängt an der Installation, nicht an diesem Verzeichnis: die
 * Kernpakete wohnen NUR dort, und ein statischer Import aus `~/.dsh/patches/`
 * fände sie nicht (doppelte Modul-Instanzen brechen jeden Tool-Call, siehe
 * ~/.dsh/AGENTS.md).
 */
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

let werkzeugBaustein;

/** Lädt einen Kernbaustein über alle bekannten Ablageformen. */
async function ladeKern(paket) {
	const unterpfad = paket.replace("@deepseek-ai/", "");
	const kandidaten = [paket];
	for (const basis of kernBasis()) {
		kandidaten.push(join(basis, unterpfad, "lib", "index.js"));
		kandidaten.push(join(basis, "dsh", "node_modules", "@deepseek-ai", unterpfad, "lib", "index.js"));
	}
	for (const kandidat of kandidaten) {
		try {
			return await import(kandidat);
		} catch { /* nächster Kandidat */ }
	}
	return undefined;
}

/** Schreibt eine Zeile ins Protokoll; ein Protokollfehler darf nie den Aufruf brechen. */
export function protokoll(zeile) {
	try {
		const ordner = join(homedir(), ".dsh", "logs");
		mkdirSync(ordner, { recursive: true });
		appendFileSync(join(ordner, "goal-await.log"), `${new Date().toISOString()} ${zeile}\n`);
	} catch { /* Protokoll ist Beiwerk */ }
}

/**
 * Kürzt und normalisiert die Wartebedingung.
 *
 * @param wert - der rohe Text des Aufrufs.
 * @returns ein einzeiliger Text mit höchstens {@link BEDINGUNG_MAX_ZEICHEN} Zeichen.
 */
export function bedingungText(wert) {
	const roh = typeof wert === "string" ? wert : "";
	const einzeilig = roh.replace(/\s+/g, " ").trim();
	if (einzeilig.length <= BEDINGUNG_MAX_ZEICHEN) return einzeilig;
	return `${einzeilig.slice(0, BEDINGUNG_MAX_ZEICHEN - 1)}…`;
}

/**
 * Normalisiert die Absenderangabe `von`.
 *
 * Anders als die Wartebedingung wird sie NICHT in einen Satz verwandelt: sie
 * wird gegen `senderSessionId`, `senderId` und `senderName` verglichen, und
 * jede Umschreibung (Kürzen, Zeilenumbrüche) würde den Vergleich kaputtmachen,
 * der genau diese Zeichenkette sucht.
 *
 * @param wert - der rohe Wert des Aufrufs, darf fehlen oder unsinnig sein.
 * @returns der erwartete Absender; `""` bedeutet "kein Absender verlangt".
 */
export function absenderText(wert) {
	const roh = typeof wert === "string" ? wert : "";
	const einzeilig = roh.replace(/\s+/g, " ").trim();
	if (einzeilig.length <= ABSENDER_MAX_ZEICHEN) return einzeilig;
	return einzeilig.slice(0, ABSENDER_MAX_ZEICHEN);
}

/**
 * Rechnet die gewünschte Frist in Millisekunden und hält sie in den Grenzen.
 *
 * @param sekunden - Wert aus dem Aufruf, darf fehlen oder unsinnig sein.
 * @returns die Frist in Millisekunden, immer endlich und positiv.
 */
export function fristMs(sekunden) {
	const zahl = typeof sekunden === "number" && Number.isFinite(sekunden) ? sekunden : FRIST_VORGABE;
	const begrenzt = Math.min(Math.max(zahl, 5), FRIST_MAX);
	return Math.round(begrenzt * 1000);
}

/**
 * Wer eine Nachricht geschickt hat, soweit die Quelle es hergibt.
 *
 * Es gibt im Kern DREI Formen mit Absender (gemessen an den Typen in
 * `dsh-llm/lib/types/message.d.ts` und den erzeugenden Stellen):
 *   - `agent-message` (`send_message` an ein Kind, Fortsetzung): `senderSessionId`
 *   - `team-message` (Team-Mailbox): `senderId` (die Sitzung) und `senderName`
 *   - `subagent-settled` (Kind fertig): `senderSessionId` = das Kind
 * `send_to_session` aus diesem Paket schreibt `senderSessionId` ebenfalls.
 * Alles andere (Mensch, Systemhinweis, Snapshots) trägt keinen Absender — dann
 * gibt es nichts zu vergleichen, und die Nachricht zählt wie bisher.
 *
 * @param quelle - die `source` einer Nachricht.
 * @returns `{ kennung, name }`, sobald die Quelle einen Absender nennt, sonst undefined.
 */
function absenderVon(quelle) {
	if (quelle === undefined || quelle === null || typeof quelle !== "object") return undefined;
	const kennung = typeof quelle.senderSessionId === "string" && quelle.senderSessionId.length > 0
		? quelle.senderSessionId
		: typeof quelle.senderId === "string" && quelle.senderId.length > 0
			? quelle.senderId
			: undefined;
	const name = typeof quelle.senderName === "string" && quelle.senderName.length > 0
		? quelle.senderName
		: undefined;
	if (kennung === undefined && name === undefined) return undefined;
	return { kennung, name };
}

/**
 * Ob eine Nachricht von dem erwarteten Absender kommt.
 *
 * Die Regel ist absichtlich EINSEITIG: `von` nimmt etwas weg, es fügt nichts
 * hinzu. Ohne Angabe (`""`) zählt jede Nachricht wie vorher. Mit Angabe zählt
 * eine Nachricht, die einen FREMDEN Absender nennt und nicht zu `von` passt,
 * nicht mehr — sie weckt das Ziel nicht. Eine Nachricht OHNE Absender (der
 * Mensch, ein Systemhinweis) zählt weiterhin immer: der Mensch ist nicht die
 * Zutat, auf die man wartet, sondern der, der jederzeit dazwischenreden darf.
 *
 * Verglichen wird ohne Rücksicht auf Groß- und Kleinschreibung gegen die
 * Sitzungs-Kennung UND den Namen, weil ein Modell beides kennt: "bob" steht so
 * in der Mitgliederliste, "sess-…" im Protokoll.
 *
 * @param quelle - die `source` der eingefügten Nachricht.
 * @param von - der erwartete Absender (Name oder Sitzungs-Kennung), darf fehlen.
 * @returns true, wenn die Nachricht den Wartezustand beenden darf.
 */
function abgesendetVon(quelle, von) {
	const absender = absenderVon(quelle);
	if (absender === undefined) return true;
	const gesucht = typeof von === "string" ? von.trim().toLowerCase() : "";
	if (gesucht.length === 0) return true;
	return [absender.kennung, absender.name].some(
		(wert) => typeof wert === "string" && wert.trim().toLowerCase() === gesucht
	);
}

/**
 * Ob eine Nachricht als "die Zutat ist da" zählt.
 *
 * Die Zielrunde selbst zählt NICHT: sie wird vom Rundentreiber eingefügt, und
 * ein Wecken darauf wäre eine Schleife. Alles andere (Mensch, Elternteil,
 * Geschwister, Unteragent, Systemhinweis) zählt — außer es wurde ein Absender
 * erwartet und ein ANDERER schreibt (siehe {@link abgesendetVon}).
 *
 * @param nachricht - die eingefügte Nachricht.
 * @param von - optional: der erwartete Absender aus dem Wartezustand.
 * @returns true, wenn sie den Wartezustand beenden soll.
 */
export function istZutat(nachricht, von) {
	const quelle = nachricht?.source;
	if (quelle === undefined || quelle === null) return true;
	if (quelle.kind === "goal") return false;
	if (!abgesendetVon(quelle, von)) return false;
	return true;
}

/**
 * Ob ein Sitzungs-Ereignis eine FERTIG GEWORDENE Team-Aufgabe meldet.
 *
 * Nur `completed` weckt. Eine Aufgabe, die angelegt (`pending`) oder in Arbeit
 * genommen wird (`in_progress`), ist keine Zutat, auf die jemand wartet; würde
 * sie wecken, wäre der Wecker wieder „jede Änderung weckt" — derselbe Fehler
 * wie beim Wecken auf jede Nachricht, nur auf dem Team-Kanal.
 *
 * Die Ereignisform ist gemessen: `TeamJournal.appendAndFlush(root, 'team/task',
 * { version: 2, teamId, task })` (`task-board.js` Zeile 53 und 197), und
 * `task` trägt den vollständigen Stand samt `status`.
 *
 * @param ereignis - der zweite Parameter von `session/event`.
 * @returns true, wenn das Ereignis ein Warteziel wecken darf.
 */
export function istAufgabenWecker(ereignis) {
	if (ereignis?.type !== "team/task") return false;
	if (ereignis.data?.task?.status !== "completed") return false;
	return true;
}

/**
 * Der Wartezustand eines Agenten, wie dieses Modul ihn führt.
 *
 * Bewusst nur im Speicher: ein Wartezustand ist eine Bedingung des Laufs, keine
 * Eigenschaft des Ziels. Nach einem Neustart ist der Agent ohnehin untätig, und
 * ein entwaffnetes Ziel bleibt entwaffnet, bis der Mensch oder eine Nachricht
 * es wieder scharf macht — genau wie der Kern es nach einem Neustart vorsieht.
 */
export function neuerZustand() {
	return {
		/** Ziel-Kennung und Revision, die entwaffnet wurde. */
		zielId: undefined,
		revision: undefined,
		/** Die Wartebedingung im Klartext, für Protokoll und Antwort. */
		bedingung: "",
		/** Der erwartete Absender (Name oder Sitzungs-Kennung); leer = jeder. */
		von: "",
		/** Wann der Wartezustand begann (ms seit Epoche). */
		seit: 0,
		/** Wann er spätestens endet (ms seit Epoche). */
		bis: 0,
		/** Die Frist-Uhr. */
		uhr: undefined
	};
}

export const name = "goal-await";

/** Cordis-Dienste, ohne die dieses Modul nichts tun kann. */
export const inject = ["tools", "goals", "agents", "systemPrompt"];

/**
 * Hängt das Modul in den Host.
 *
 * @param ctx - der Cordis-Kontext des Profils.
 * @param config - optionale Einstellungen aus der Patch-Datei.
 */
export function apply(ctx, config = {}) {
	const zustaende = new Map();
	const fristVorgabe = typeof config.maxWaitSeconds === "number" && Number.isFinite(config.maxWaitSeconds)
		? config.maxWaitSeconds
		: FRIST_VORGABE;

	/** Zustand eines Agenten, notfalls frisch. */
	function zustandFuer(agent) {
		let zustand = zustaende.get(agent);
		if (zustand === undefined) {
			zustand = neuerZustand();
			zustaende.set(agent, zustand);
		}
		return zustand;
	}

	/** Nimmt einen laufenden Wartezustand aus dem Speicher und stoppt seine Uhr. */
	function beendeWarten(agent, grund) {
		const zustand = zustaende.get(agent);
		if (zustand === undefined || zustand.zielId === undefined) return undefined;
		if (zustand.uhr !== undefined) {
			clearTimeout(zustand.uhr);
			zustand.uhr = undefined;
		}
		const ergebnis = {
			zielId: zustand.zielId,
			revision: zustand.revision,
			bedingung: zustand.bedingung,
			von: zustand.von,
			gewartetSekunden: Math.max(0, Math.round((Date.now() - zustand.seit) / 1000)),
			grund
		};
		zustaende.delete(agent);
		return ergebnis;
	}

	/**
	 * Schaltet das Ziel eines Agenten wieder scharf.
	 *
	 * @param agent - der wartende Agent.
	 * @param grund - warum der Wartezustand endet (für Protokoll und Antwort).
	 * @returns der beendete Wartezustand, oder undefined, wenn keiner lief.
	 */
	function wecke(agent, grund) {
		const beendet = beendeWarten(agent, grund);
		if (beendet === undefined) return undefined;
		let scharf = false;
		let fehler;
		try {
			const ziel = ctx.goals.get(agent);
			if (ziel !== undefined && ziel.id === beendet.zielId && ziel.revision === beendet.revision && ziel.phase === "active") {
				if (ziel.activation !== "armed") {
					ctx.goals.resume(agent, { id: ziel.id, revision: ziel.revision });
					scharf = true;
				} else {
					scharf = true;
				}
			}
		} catch (error) {
			fehler = error instanceof Error ? error.message : String(error);
		}
		protokoll(`wecken agent=${agent.id} grund=${grund} gewartet=${beendet.gewartetSekunden}s ziel=${beendet.zielId} scharf=${scharf}${fehler === undefined ? "" : ` fehler=${fehler}`} bedingung="${beendet.bedingung}"`);
		return { ...beendet, scharf, ...fehler === undefined ? {} : { fehler } };
	}

	/**
	 * Der native Team-Dienst, falls dieses Profil ihn hat.
	 *
	 * `ctx.get` wirft, wenn der Dienst fehlt (cordis: „service not found"). Ein
	 * Profil ohne `dsh-experimental-agent-team` hat keine Teams — dann gibt es
	 * auch keinen Aufgaben-Wecker, und dieser Patch bleibt bei der Nachricht.
	 * Derselbe Zugriffsweg wie in `team-board.mjs`.
	 *
	 * @returns der Dienst oder undefined.
	 */
	function teamDienst() {
		try {
			return ctx.get("agentTeams");
		} catch {
			return undefined;
		}
	}

	/**
	 * Ob ein Agent zu dem Team gehört, dessen Aufgabe gerade fertig wurde.
	 *
	 * Verglichen wird die Team-Kennung: `membership(agent).id` ist bei Lead UND
	 * Teammates die Sitzung der Team-Wurzel, und genau die steht im Ereignis.
	 * `tryMembership` wird bevorzugt, weil es für einen Agenten ohne Team
	 * `undefined` liefert statt zu werfen; ein Dienst ohne diese Methode wird
	 * über `membership` im try/catch gefragt.
	 *
	 * @param agent - der wartende Agent.
	 * @param teamId - die Team-Kennung aus dem Ereignis.
	 * @returns true, wenn das Ereignis diesen Agenten etwas angeht.
	 */
	function gehoertZumTeam(agent, teamId) {
		const dienst = teamDienst();
		if (dienst === undefined || dienst === null) return false;
		try {
			const mitglied = typeof dienst.tryMembership === "function"
				? dienst.tryMembership(agent)
				: dienst.membership(agent);
			return mitglied !== undefined && mitglied !== null && String(mitglied.id) === teamId;
		} catch {
			return false;
		}
	}

	/** Alle laufenden Wartezustände dieses Moduls (für Prüfung und Antwort). */
	function offene() {
		return [...zustaende.entries()].map(([agent, zustand]) => ({
			agent: agent.id,
			zielId: zustand.zielId,
			bedingung: zustand.bedingung,
			von: zustand.von,
			restSekunden: Math.max(0, Math.round((zustand.bis - Date.now()) / 1000))
		}));
	}

	const definition = (defineTool) => defineTool({
		name: WERKZEUG,
		description: [
			"Put your goal into idle so it spends NO continuation rounds until something outside this session arrives. Use it the moment you notice you are blocked on a dependency.",
			"",
			"WHEN THIS APPLIES — this is the important part, be generous with it:",
			"- You asked another session (or the human) for something and must wait for the answer.",
			"- You started a background job (a build, a test run, a subagent, a download) and your next step needs its result.",
			"- You need a file, a measurement, or a decision that only the human or another session can produce.",
			"- You told the human what to do and now wait for them to do it (run a command, restart, answer a question, decide between options).",
			"In all of these cases you are BLOCKED — not finished, not idle by choice. Do not keep working in circles around the blocker and do not end the turn just to burn nothing.",
			"",
			"WHAT IT DOES — measured behaviour, not a promise:",
			"1. Your goal is disarmed at once: phase stays 'active', but the round driver sees activation != 'armed' and pushes no further rounds.",
			"2. It re-arms ITSELF. You do nothing, you remember nothing, you run no loop. The triggers are: a matching incoming message for this session, a team task of your team that reaches 'completed', or the expiry of max_wait_seconds.",
			"3. When re-armed, the next round continues the work. You will not be asked to explain what you were waiting for.",
			"You never need to poll, sleep, or re-check. That is the whole point.",
			"",
			"WHAT COUNTS AS 'THE DEPENDENCY ARRIVED': an incoming message in this session's inbox (a goal round itself does NOT count), a team task of your team that reaches 'completed', or the expiry of max_wait_seconds. Expiry is deliberate: a forgotten wait must never stall a goal forever.",
			"",
			"NAME THE SENDER whenever you wait for ONE specific session or teammate: pass `von`. Without it, a greeting from anyone wakes the goal — that is the bug this field closes. Human input always wakes it either way.",
			"",
			"DO NOT use it:",
			"- to end a turn early, or to avoid work you could do in this turn — do everything you can first;",
			"- while a human is available and waiting for your answer — just answer;",
			"- when there is no active goal: then it does nothing, and an incoming message wakes you anyway.",
			"One wait at a time: a second call replaces the first.",
			"",
			"TELL THE HUMAN ONE SENTENCE about what you are waiting for, then end your turn."
		].join("\n"),
		parameters: {
			waiting_for: {
				type: "string",
				required: true,
				description: "One sentence, in plain words, naming what you are waiting for and from whom — for example 'the P8 measurement numbers from strata-hda-experte'. It is shown to the human and written to the log, so name the thing, not the tool."
			},
			von: {
				type: "string",
				description: "Optional. WHO brings the dependency: a teammate name, a session id, or your own subagent's agent id (the subagentId from delegate_task). Give it and only a message from that sender wakes the goal — a greeting from anyone else no longer does. Everything else still wakes it: human input, your own subagent finishing, a team task that reaches completed, and the expiry. Omit it and every incoming message wakes the goal, exactly as before."
			},
			max_wait_seconds: {
				type: "number",
				description: "Safety limit in seconds (5 … 7200, default 900). When it expires the goal is re-armed anyway, so a forgotten wait can never stall a goal forever."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					waiting: { type: "boolean", required: true, description: "True when the goal is now disarmed and waiting." },
					goal: { type: "string", required: true, description: "Objective of the goal that is waiting, for the human's orientation." },
					wakes_on: {
						type: "string",
						required: true,
						enum: ["message", "timeout", "none"],
						description: "What will re-arm the goal: the next incoming message, the expiry, or nothing (when no active goal exists)."
					},
					max_wait_seconds: { type: "number", required: true, description: "Effective safety limit in seconds." },
					note: { type: "string", required: true, description: "What the model should tell the human, in one sentence." }
				}
			},
			render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }]
		},
		execute: async function (args, exec) {
			const agent = exec.agent;
			if (agent === undefined) {
				return {
					waiting: false,
					goal: "",
					wakes_on: "none",
					max_wait_seconds: 0,
					note: "No agent context; nothing was disarmed."
				};
			}
			const ziel = ctx.goals.get(agent);
			if (ziel === undefined) {
				return {
					waiting: false,
					goal: "",
					wakes_on: "none",
					max_wait_seconds: 0,
					note: "This session has no goal. Nothing was disarmed — just end your turn; an incoming message wakes you anyway."
				};
			}
			if (ziel.phase !== "active") {
				return {
					waiting: false,
					goal: ziel.objective,
					wakes_on: "none",
					max_wait_seconds: 0,
					note: `The goal is ${ziel.phase}, so there is nothing to wait for. End your turn.`
				};
			}
			const bedingung = bedingungText(args.waiting_for);
			const von = absenderText(args.von);
			const frist = fristMs(args.max_wait_seconds === undefined ? fristVorgabe : args.max_wait_seconds);
			// Ein laufender Wartezustand wird ersetzt, nicht gestapelt.
			if (zustaende.has(agent)) beendeWarten(agent, "ersetzt");
			ctx.goals.disarm(agent);
			const zustand = zustandFuer(agent);
			zustand.zielId = ziel.id;
			zustand.revision = ziel.revision;
			zustand.bedingung = bedingung;
			zustand.von = von;
			zustand.seit = Date.now();
			zustand.bis = zustand.seit + frist;
			zustand.uhr = setTimeout(() => {
				wecke(agent, "frist");
			}, frist);
			if (typeof zustand.uhr?.unref === "function") zustand.uhr.unref();
			protokoll(`warten agent=${agent.id} ziel=${ziel.id} frist=${Math.round(frist / 1000)}s bedingung="${bedingung}"${von.length === 0 ? "" : ` von=${von}`}`);
			return {
				waiting: true,
				goal: ziel.objective,
				wakes_on: "message",
				max_wait_seconds: Math.round(frist / 1000),
				note: `The goal is waiting for: ${bedingung}. It continues by itself as soon as ${
					von.length === 0 ? "a message arrives here" : `${von} writes here`
				}, and as soon as a task of your team reaches 'completed', at the latest in ${Math.round(frist / 1000)} seconds. Tell the human in one sentence what you are waiting for and end your turn.`
			};
		},
		presentCall: (args) => ({
			card: "generic",
			title: "Goal waits for a dependency",
			kind: "other",
			rawInput: bedingungText(args.waiting_for)
		})
	});

	ctx.effect(() => {
		let abgemeldet = false;
		let abRegister;

		// Diagnose-Dienst: nur zum Nachsehen von außen, steuert nichts.
		// gemessen 2026-10-29: `ctx.set` verlangt, dass der Name in DIESEM Fiber
		// vorher mit `ctx.provide` angemeldet war (cordis/lib/index.js:785:
		// "cannot set property \"goalAwait\" without provide"). Der Eintrag wurde
		// beim Start abgewiesen und das Werkzeug `await_goal_dependency` gab es
		// nicht. Der Dienst wird hier angemeldet und beim Abbau wieder abgemeldet.
		let abDienst;
		try {
			abDienst = ctx.provide("goalAwait", { offene, wecke });
		} catch (error) {
			protokoll(`warn Diagnose-Dienst goalAwait konnte nicht angemeldet werden: ${String(error?.message ?? error)}`);
		}

		(async () => {
			werkzeugBaustein ??= await ladeKern(PAKET_WERKZEUGE);
			if (abgemeldet) return;
			const defineTool = werkzeugBaustein?.defineTool;
			if (typeof defineTool !== "function") {
				protokoll("warn der Werkzeug-Baustein (defineTool) ist nicht auffindbar; das Werkzeug steht nicht zur Verfuegung.");
				return;
			}
			abRegister = ctx.tools.register(definition(defineTool));
			protokoll("start Werkzeug registriert");
		})();

		// 1. Die Zutat kommt an: eine Nachricht, die zu dem passt, worauf gewartet wird.
		//    Ohne Absenderangabe ist das jede Nachricht außer der Zielrunde selbst.
		const abInbox = ctx.on("agent/inbox/inserted", ({ agent, message }) => {
			if (!istZutat(message, zustaende.get(agent)?.von)) return;
			wecke(agent, "nachricht");
		});

		// 1b. Eine Team-Aufgabe ist fertig: das ist auch eine Zutat, ganz ohne
		//     Nachricht. Wer geweckt wird, entscheidet die Mitgliedschaft, nicht die
		//     Sitzung des Ereignisses — das Ereignis liegt auf der Sitzung der
		//     Team-Wurzel, und ein wartendes Teammitglied soll es trotzdem spüren.
		//
		// DIAGNOSE (03.11., vorübergehend): Gemessen werden soll, ob dieser
		// Horcher überhaupt aufgerufen wird. Zwei Live-Versuche haben gezeigt,
		// dass der Aufgaben-Wecker nicht weckt; die Hypothese "asynchron
		// registriert" ist widerlegt, weil die Registrierung synchron steht.
		// Bleibt die Frage, ob `session/event` den Plugin-Kontext erreicht.
		// Solange diese Zeile steht, protokolliert der Horcher JEDES ankommende
		// Ereignis. Nach der Messung wird sie wieder entfernt.
		//
		// STAND 0.7.0: Die Diagnose ist wieder AUSGEBAUT. Ein Release soll kein
		// Protokoll-Feuerwerk enthalten. Wer die Messung wiederholt, baut die Zeile
		// `protokoll(\`diagnose session/event …\`)` als erste Zeile im Rumpf ein und
		// zieht den sha256-Anker in test/umzug.test.mjs nach.
		const abAufgabe = ctx.on("session/event", (session, event) => {
			if (!istAufgabenWecker(event)) return;
			const teamId = String(event.data.teamId ?? "");
			if (teamId.length === 0) return;
			// Über eine Kopie laufen: das Wecken löscht aus derselben Map.
			for (const agent of [...zustaende.keys()]) {
				if (!gehoertZumTeam(agent, teamId)) continue;
				wecke(agent, "aufgabe");
			}
		});

		// 2. Ein Agent wird abgebaut: Uhr anhalten, nichts mehr wecken.
		const abWeg = ctx.on("agent/disposed", ({ agent }) => {
			const zustand = zustaende.get(agent);
			if (zustand?.uhr !== undefined) clearTimeout(zustand.uhr);
			zustaende.delete(agent);
		});

		// 3. Der Hinweis im Systemprompt: warten statt Runden verbrennen.
		const abAbschnitt = ctx.systemPrompt.section({
			name: "tool:goal-await",
			order: ctx.systemPrompt.getSectionOrder("TOOL_GOAL") + 1,
			text: [
				"## Warten ohne Rundenverbrauch",
				`Wenn ein Ziel auf eine fremde Zutat wartet (Messbericht eines Teammates, Antwort des Menschen, fertige Team-Aufgabe), rufe \`${WERKZEUG}\` auf, statt deinen Zug nur zu beenden. Das Ziel wird dann entwaffnet und verbraucht keine Runden; die passende Nachricht — oder eine Team-Aufgabe, die auf \`completed\` geht — schaltet es von selbst wieder scharf. Nenne mit \`von\` den Absender, auf den du wartest, sonst weckt dich jede Nachricht. Alles, was du in diesem Zug noch selbst tun kannst, tust du vorher — das Werkzeug ist kein Freifahrtschein zum Abgeben.`
			].join("\n")
		});

		return () => {
			abgemeldet = true;
			if (typeof abRegister === "function") abRegister();
			if (typeof abDienst === "function") abDienst();
			abInbox?.();
			abAufgabe?.();
			abWeg?.();
			abAbschnitt?.();
			for (const zustand of zustaende.values()) {
				if (zustand.uhr !== undefined) clearTimeout(zustand.uhr);
			}
			zustaende.clear();
		};
	}, "goal-await lifecycle");
}
