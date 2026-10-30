/**
 * delegate-send — ein Teammitglied darf seinen eigenen Unteragenten anschreiben
 * ===========================================================================
 *
 * WAS DER MENSCH WOLLTE (2026-10-25, sinngemaess woertlich)
 * "Sub-Agents mit Delegate Tasks sollen nicht one-shot sein. Es ist wirklich
 * einfach nur dumm, dass es one-shot ist. Mit denen soll man schreiben koennen,
 * an die soll man Bilder senden koennen, Dateien senden koennen. Das sind
 * einfach nur ganz normale Sessions, die einfach von anderen Sessions
 * gespawnt werden. Kein Unterschied."
 *
 * WAS SCHIEF STAND — zwei Stellen, nicht eine
 *  1. Das Profil hatte `backgroundMode: one-shot` an `delegate_task` stehen.
 *     Damit besitzt der Lauf nur einen Task: nach dem Ergebnis ist der
 *     Kind-Agent weg. Behoben im Profil (jetzt `continuable`), siehe
 *     ~/.dsh/profiles/web/cordis.patch.yml, Abschnitt "tool-delegate-task".
 *  2. Auch mit `continuable` haette ein Teammitglied seinen Unteragenten NICHT
 *     anschreiben koennen: in einem Team-Mitglied-Scope registriert
 *     `@deepseek-ai/dsh-experimental-tool-agent-team` sein eigenes
 *     `send_message`, und das kennt nur EIN Feld — `target`, den Team-Namen.
 *     Das Werkzeug des Kerns (`@deepseek-ai/dsh-tool-subagent-control`) mit dem
 *     Feld `agent_id` wird in diesem Scope verdeckt: im Werkzeug-Register
 *     gewinnt die scope-naehere Registrierung, das Team-Werkzeug liegt im
 *     Agenten-Scope, das Kern-Werkzeug in der Wurzel. Genau dieses Verdecken
 *     ist der Grund, warum "der Unteragent lebt weiter" allein nichts hilft:
 *     der weiterlebende Agent waere unerreichbar.
 *
 * WAS DIESES MODUL TUT (zwei Griffe, beide nur im Speicher)
 *  1. Es erweitert JEDES `send_message`, das noch kein Feld `agent_id` hat, um
 *     genau dieses Feld — Parameter, Beschreibung und Ausfuehrung. Ist
 *     `agent_id` genannt, geht die Nachricht an den Dienst `subagents`
 *     (`sendMessage`), also an die eigene fortsetzbare Kind-Sitzung; ist
 *     `target` genannt, laeuft alles unveraendert ueber das Team-Werkzeug.
 *  2. Derselbe Weg nimmt Anhaenge mit (`attach`, eine Liste von Pfaden).
 *     Bilder (png/jpeg/webp/gif) kommen als Bild an, das der Unteragent
 *     wirklich sieht; jede andere Datei wird unveraendert abgelegt und der
 *     Unteragent bekommt ihren schreibgeschuetzten Pfad genannt.
 *
 * WARUM FUER DATEIEN KEIN EINGRIFF INS PAKET NOETIG IST (gemessen 2026-10-25)
 * Der naheliegende Weg waere, den Datei-Teil auf die Leitung zu legen. Das
 * haette vier Aenderungen in der Installation gebraucht, zwei davon in
 * generierten Dateien (`typert.*.js`), die jedes DSH-Update ueberschreibt:
 *   - die Leitung `subagents.prompt` kennt nur `text` und `image`
 *     (dsh-subagent/lib/typert.remote-client.js und typert.host.js),
 *   - der Upload weist Unteragenten-Sitzungen ab
 *     (dsh-client-file-upload/lib/index.js, `assertOrdinaryAgent`),
 *   - der Browser lehnt Dateien an eine Kind-Sitzung ab
 *     (dsh-api-session-controller/lib/client.js),
 *   - die Oberflaeche gibt Dateien im Mitglied-Chat gar nicht erst frei.
 * Der Umweg ueber die Ablage braucht NICHTS davon: die Nachricht bleibt Text
 * plus Bild, also genau die Form, die die Leitung schon kann. Der Harness
 * macht es fuer normale Sitzungen selbst nicht anders — `dsh-llm` ersetzt
 * einen Datei-Block durch Text mit dem Ablagepfad (`fileHandleText`). Der
 * Wortlaut hier ist absichtlich derselbe, damit ein Unteragent nicht zwei
 * Erklaerungen fuer dieselbe Sache kennen muss.
 * Nebeneffekt, der zaehlt: kein generierter Code wird angefasst, also
 * ueberlebt der Anhang jedes Update der Installation.
 *
 * GEMESSEN AM 2026-10-25 (wichtig fuer jeden, der hier nachbaut)
 * `defineTool` uebersetzt das Parameter-Schema EINMAL beim Registrieren
 * (`parameterSchemaSpecToJsonSchema`, dsh-tools/lib/index.js Zeile 848) und
 * legt das Ergebnis als `definition.parameters` ab. Zwei Folgen:
 *   a) `definition.parameters` ist NICHT das Autoren-Schema, sondern das
 *      fertige JSON-Schema mit eigener `required`-Liste. Wer nur das
 *      Autoren-Objekt anfasst, aendert am Modell nichts: die Liste stand nach
 *      dem ersten Versuch weiter auf ["target","message"], und das Modell
 *      haette `target` fuer Pflicht gehalten. Darum wird der Eintrag "target"
 *      aus `schema.required` entfernt.
 *   b) Die Eigenschafts-Objekte werden NICHT kopiert, sie werden geteilt.
 *      Genau daran ist am 2026-10-25 die Anthropic-Anfrage gescheitert:
 *      `required: false` AN EINER EIGENSCHAFT ist kein gueltiges JSON Schema
 *      (`required` ist dort eine Liste von Namen, kein Wahrheitswert). Der
 *      Anbieter prueft das Werkzeug-Schema und antwortet mit
 *      "400 tools.279.custom.input_schema: JSON schema is invalid"; die
 *      Sitzung dreht dann nur noch Wiederholungen. Optionalitaet steht
 *      AUSSCHLIESSLICH in der `required`-Liste des Objekts (a).
 * Ausserdem haelt der Profil-Loader Module in Node's Cache (blankes
 * `import()`, keine Cache-Kennung): eine Aenderung an DIESER Datei greift erst
 * beim naechsten Start des Hosts, nicht beim Nachladen des Profils.
 *
 * WAS ES NICHT AENDERT
 *  - Team-Adressierung bleibt, wie sie war: `target` mit dem Namen aus
 *    `list_agents`, inklusive "lead".
 *  - Es wird kein Paket angefasst und nichts auf der Platte geschrieben ausser
 *    dem Protokoll. Ein Neustart ohne diesen Eintrag stellt alles wieder her.
 *  - Rechte: die Nachricht geht nur an eine Sitzung, unter der der Absender
 *    wirklich steht. `subagents.sendMessage` prueft das selbst
 *    ("message delivery requires the exact live sender agent", direkte
 *    Kind-Sitzung oder direkter Elternteil) und lehnt alles andere ab.
 *
 * RUECKGAENGIG
 * Eintrag `delegate-send` aus ~/.dsh/profiles/web/cordis.patch.yml nehmen und
 * DSH neu starten.
 *
 * Selbstpruefung: node ~/.dsh/patches/delegate-send.mjs
 * Protokoll:     ~/.dsh/logs/delegate-send.log
 */

import { appendFileSync, readFileSync, statSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const name = "delegate-send";

/** Dienste, ohne die dieses Modul nichts tun kann. */
export const inject = ["tools", "agents", "subagents", "attachments"];

/** Marke auf der umgebogenen Ausfuehrung: verhindert Stapeln nach einem Neuladen. */
const MARKE = Symbol.for("delegate-send.umgebogen");

/** Das Werkzeug, um das es geht. */
export const WERKZEUG = "send_message";

/** Schreibt eine Zeile ins Protokoll; ein Fehler dabei stoert nie. */
function protokolliere(text) {
	try {
		const pfad = process.env.DSH_DELEGATE_SEND_LOG ?? join(homedir(), ".dsh", "logs", "delegate-send.log");
		appendFileSync(pfad, `${new Date().toISOString()} ${text}\n`);
	} catch { /* Das Protokoll ist Beigabe, nie Bedingung. */ }
}

/**
 * Welcher Weg ist gemeint? Reine Funktion, damit sie ohne laufendes DSH
 * geprueft werden kann.
 *
 * @param {object} args - Argumente des Werkzeugaufrufs.
 * @returns {"kind"|"team"} `kind` = eigene Kind-Sitzung ueber `agent_id`,
 *          `team` = Team-Ziel ueber `target`.
 * @throws {Error} wenn beide Felder genannt sind, keines genannt ist oder
 *          eines davon leer ist.
 */
export function weg(args) {
	const agentId = args?.agent_id;
	const target = args?.target;
	const hatAgent = agentId !== undefined && agentId !== null && String(agentId).length > 0;
	const hatTarget = target !== undefined && target !== null && String(target).length > 0;
	if (hatAgent && hatTarget) {
		throw new Error("nenne entweder `agent_id` (die eigene Kind-Sitzung, z. B. der `subagentId` aus delegate_task) ODER `target` (ein Teammitglied oder \"lead\"), nicht beides.");
	}
	if (hatAgent) return "kind";
	if (hatTarget) return "team";
	throw new Error("nenne `agent_id` fuer die eigene Kind-Sitzung oder `target` fuer ein Teammitglied.");
}

/**
 * Prueft die Argumente des Wegs ueber `agent_id`.
 *
 * NOETIG, und zwar aus einem gemessenen Grund: `defineTool` haengt seine
 * Argument-Pruefung in die oeffentliche `execute`-Funktion hinein
 * (dsh-tools/lib/index.js Zeile 866: die zurueckgegebene `execute` prueft
 * zuerst und ruft dann den Autor-Code). Wer `definition.execute` ersetzt,
 * ersetzt damit auch diese Pruefung — Aufrufe ohne `message` kaemen dann
 * ungeprueft beim Dienst an. Darum prueft der zweite Weg seine Argumente
 * selbst, statt sich auf den Rahmen zu verlassen.
 *
 * @param {object} args - Argumente des Werkzeugaufrufs.
 * @throws {Error} wenn `message` fehlt, leer ist oder kein Text ist.
 */
export function pruefeNachricht(args) {
	const nachricht = args?.message;
	if (typeof nachricht !== "string" || nachricht.length === 0) {
		throw new Error("`message` fehlt: eine Nachricht ohne Text kann nicht zugestellt werden.");
	}
}

/**
 * Liest die Liste der anzuhaengenden Dateien aus einem Werkzeugaufruf.
 *
 * Reine Formpruefung, ohne das Dateisystem anzufassen — damit sie ohne
 * laufendes DSH pruefbar bleibt. Ob eine Datei existiert und lesbar ist,
 * entscheidet der Aufrufer, weil nur er weiss, in welchem Verzeichnis der
 * Agent laeuft.
 *
 * @param {object} args - Argumente des Werkzeugaufrufs.
 * @returns {string[]} die genannten Pfade, in der genannten Reihenfolge;
 *          eine leere Liste, wenn nichts anhaengt.
 * @throws {Error} wenn `attach` keine Liste von nicht-leeren Zeichenketten ist.
 */
export function pruefeAnhaenge(args) {
	const anhaenge = args?.attach;
	if (anhaenge === undefined || anhaenge === null) return [];
	if (!Array.isArray(anhaenge)) throw new Error("`attach` muss eine Liste von Dateipfaden sein, zum Beispiel [\"/pfad/zur/datei.pdf\"].");
	return anhaenge.map((pfad) => {
		if (typeof pfad !== "string" || pfad.trim().length === 0) throw new Error("jeder Eintrag in `attach` muss ein nicht-leerer Dateipfad sein.");
		return pfad;
	});
}

/**
 * Loest einen Anhang-Pfad gegen das Arbeitsverzeichnis auf und prueft, ob eine
 * regulaere, nicht-leere Datei dahintersteht.
 *
 * Der Grund fuer die Vorabpruefung ist eine gemessene Unannehmlichkeit: ohne sie
 * kommt ein Tippfehler im Pfad als roher Dateisystem-Fehler aus der Tiefe des
 * Anhang-Dienstes zurueck, und niemand weiss dann, welcher der genannten Pfade
 * gemeint war.
 *
 * @param {string} pfad - der genannte Pfad, relativ oder absolut.
 * @param {string} [arbeitsverzeichnis] - Bezug fuer relative Pfade.
 * @returns {{pfad: string, name: string, bytes: number}} der aufgeloeste Pfad,
 *          der angezeigte Name und die Groesse.
 * @throws {Error} wenn die Datei fehlt, ein Verzeichnis ist oder leer ist.
 */
export function pruefeDatei(pfad, arbeitsverzeichnis) {
	const absolut = resolve(arbeitsverzeichnis ?? process.cwd(), pfad);
	let groesse;
	try {
		groesse = statSync(absolut);
	} catch {
		throw new Error(`die Datei "${pfad}" gibt es nicht (gesucht unter ${absolut}). Nenne einen Pfad, den der Agent lesen kann.`);
	}
	if (!groesse.isFile()) throw new Error(`"${pfad}" ist keine Datei (${absolut}). Ein Verzeichnis laesst sich nicht anhaengen.`);
	if (groesse.size === 0) throw new Error(`die Datei "${pfad}" ist leer (${absolut}); sie wuerde dem Unteragenten nichts sagen.`);
	return { pfad: absolut, name: basename(absolut), bytes: groesse.size };
}

/**
 * Bild-Art an der Dateiendung erkennen.
 *
 * Nur diese vier Arten nimmt der Anhang-Dienst als Bild an; alles andere wird
 * als Datei gespeichert und dem Unteragenten ueber ihren Pfad genannt. Damit
 * ist auch klar, was passiert, wenn die Endung fehlt: es wird eine Datei.
 */
const BILD_ARTEN = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif"
};

/**
 * Bestimmt, ob ein Pfad als Bild (das der Unteragent wirklich SIEHT) oder als
 * Datei (deren Pfad er genannt bekommt) ankommt.
 *
 * @param {string} pfad - aufgeloester Pfad.
 * @returns {string|undefined} die Bild-Art, oder undefined fuer eine Datei.
 */
export function bildArt(pfad) {
	const punkt = pfad.lastIndexOf(".");
	if (punkt === -1) return undefined;
	return BILD_ARTEN[pfad.slice(punkt + 1).toLowerCase()];
}

/**
 * Erweitert eine `send_message`-Definition um den Weg ueber `agent_id`.
 *
 * Bewusst eine eigene, exportierte Funktion: so laesst sich der ganze Eingriff
 * ohne laufenden Host pruefen (siehe Selbstpruefung unten). Sie veraendert die
 * Definition an Ort und Stelle, wie es das Werkzeug-Register erwartet, und gibt
 * eine Ruecknahme zurueck.
 *
 * @param {object} definition - die aufgeloeste Werkzeug-Definition.
 * @param {object} umgebung - Zugang nach aussen:
 *        `senden(agentId, text, anhaenge, signal, sender, exec)` liefert die
 *        Nachrichtenkennung, `protokoll(text)` schreibt eine Zeile.
 * @returns {{stand: "fertig"|"kern"|"aufgeben", zurueck?: () => void, grund?: string}}
 */
export function erweitereDefinition(definition, umgebung) {
	if (definition === undefined || typeof definition.execute !== "function" || definition.parameters === undefined) {
		return { stand: "aufgeben", grund: `das Werkzeug ${WERKZEUG} hat nicht die erwartete Form (DSH-Update?)` };
	}
	if (definition.execute[MARKE] === true) return { stand: "fertig" };
	const schema = definition.parameters;
	const eigenschaften = schema?.properties;
	if (eigenschaften === undefined || typeof eigenschaften !== "object") {
		return { stand: "aufgeben", grund: `das Werkzeug ${WERKZEUG} hat kein Parameter-Schema` };
	}
	// Das Werkzeug des Kerns traegt `agent_id` schon: nichts zu tun.
	if (Object.hasOwn(eigenschaften, "agent_id")) return { stand: "kern" };
	// Alles andere ohne `target` erkennen wir nicht als das Standard-Werkzeug.
	if (!Object.hasOwn(eigenschaften, "target")) return { stand: "aufgeben", grund: `das Werkzeug ${WERKZEUG} hat weder \`agent_id\` noch \`target\`` };

	const grundExecute = definition.execute;
	const grundBeschreibung = definition.description;

	// (a) Die uebersetzte `required`-Liste: `target` ist keine Pflicht mehr,
	//     sonst lehnt die Werkzeug-Pruefung jeden Aufruf mit nur `agent_id` ab.
	const pflichtVorher = Array.isArray(schema.required) ? [...schema.required] : undefined;
	if (Array.isArray(schema.required)) schema.required = schema.required.filter((eintrag) => eintrag !== "target");

	// (b) Die geteilte Eigenschaft: nur neu beschreiben. Kein `required: false`
	//     an der Eigenschaft — das ist ungueltiges JSON Schema und laesst
	//     Anthropic die ganze Anfrage mit 400 ablehnen (siehe oben, b).
	const targetVorher = eigenschaften.target;
	const targetBeschreibungVorher = targetVorher?.description;
	if (targetVorher !== undefined && typeof targetVorher === "object") {
		targetVorher.description = "Member target returned by spawn_teammate or list_agents, including lead. Omit it when you address one of your own child sessions through `agent_id`.";
	}

	// (c) Der zweite Weg: die eigene Kind-Sitzung.
	eigenschaften.agent_id = {
		type: "string",
		description: "The agent id of one of your own continuable child sessions (the `subagentId` returned by `delegate_task`) — or, when you are such a child, your direct parent. The message continues that conversation. Omit it to address a Team member through `target`."
	};

	// (d) Anhaenge: der zweite Weg nimmt Dateien und Bilder mit.
	//     Der Team-Weg bleibt unberuehrt und ignoriert dieses Feld (die
	//     Argument-Pruefung des Rahmens laesst unbekannte Felder durch; die
	//     unveraenderte Original-execute liest es einfach nicht).
	const hatteAttach = Object.hasOwn(eigenschaften, "attach");
	if (!hatteAttach) {
		eigenschaften.attach = {
			type: "array",
			items: { type: "string" },
			description: "Optional file paths to send along with the message to a child session (`agent_id` only). Images (png, jpeg, webp, gif) arrive as pictures the child can see; every other file is stored verbatim and the child is given its read-only path to open itself. Relative paths resolve against the working directory."
		};
	}

	definition.description = grundBeschreibung + " You can also send to one of your own continuable child sessions with `agent_id` — the `subagentId` returned by `delegate_task` — and that message continues the same conversation; a child that is idle wakes up for it, and its model must accept images if you attach any.";

	definition.execute = async function (args, exec) {
		if (weg(args) === "team") return grundExecute.call(this, args, exec);
		pruefeNachricht(args);
		const anhaenge = pruefeAnhaenge(args);
		const sender = exec?.agent;
		if (sender === undefined) throw new Error(`${WERKZEUG} mit \`agent_id\` braucht einen aufrufenden Agenten.`);
		umgebung.protokoll(`Nachricht an die Kind-Sitzung ${args.agent_id}${anhaenge.length === 0 ? "" : ` mit ${anhaenge.length} Anhang/Anhaengen`}.`);
		const messageId = await umgebung.senden(String(args.agent_id), String(args.message), anhaenge, exec.signal, sender, exec);
		// Form des Team-Werkzeugs beibehalten, damit ein Aufrufer beide Wege
		// gleich behandelt: messageId plus status.
		return { messageId: String(messageId), status: "accepted" };
	};
	definition.execute[MARKE] = true;
	return {
		stand: "fertig",
		zurueck() {
			definition.execute = grundExecute;
			definition.description = grundBeschreibung;
			Reflect.deleteProperty(eigenschaften, "agent_id");
			if (!hatteAttach) Reflect.deleteProperty(eigenschaften, "attach");
			if (pflichtVorher !== undefined) schema.required = pflichtVorher;
			if (targetVorher !== undefined && typeof targetVorher === "object") {
				if (targetBeschreibungVorher !== undefined) targetVorher.description = targetBeschreibungVorher;
			}
		}
	};
}

/**
 * Macht aus den genannten Pfaden die Nachrichtenteile, die der Dienst erwartet.
 *
 * Warum ueberhaupt eine eigene Funktion: der Dienst `subagents` nimmt nur Text
 * und Bilder. Ein Bild wird als base64 mit Art mitgeschickt und beim Empfaenger
 * gespeichert; jede andere Datei muss vorher ueber den Anhang-Dienst abgelegt
 * werden, und der Unteragent bekommt dann ihren Pfad als Text — genau so, wie
 * das Harness es fuer normale Sitzungen schon macht (dsh-llm ersetzt einen
 * Datei-Block durch einen Text-Hinweis mit dem Ablagepfad).
 *
 * Die Reihenfolge bleibt: erst der Text, dann die Anhaenge in der genannten
 * Reihenfolge. So liest der Unteragent zuerst den Auftrag und danach, was
 * dazugehoert.
 *
 * @param {string} text - die Nachricht.
 * @param {Array<{pfad: string, name: string}>} dateien - geprueftes Ergebnis
 *        von {@link pruefeDatei}, in genannter Reihenfolge.
 * @param {object} umgebung - Zugang nach aussen:
 *        `lesen(pfad)` liefert die Bytes,
 *        `bildAufnehmen({mediaType, data, name})` speichert ein Bild und
 *        liefert den fertigen Bild-Teil (er MUSS beim Empfaenger aufgenommen
 *        sein: rohe base64-Bytes versteht die Zustellung nicht),
 *        `ablegen({bytes, name})` legt eine Datei ab und liefert
 *        `{attachmentId, name, bytes}`,
 *        `pfadVon(ref)` liefert den lesbaren Pfad der abgelegten Kopie.
 * @returns {Promise<Array<object>>} die Nachrichtenteile in Sendereihenfolge.
 */
export async function baueInhalt(text, dateien, umgebung) {
	const inhalt = [{ type: "text", text }];
	for (const datei of dateien) {
		const art = bildArt(datei.pfad);
		const bytes = await umgebung.lesen(datei.pfad);
		if (art !== undefined) {
			inhalt.push(await umgebung.bildAufnehmen({ mediaType: art, data: Buffer.from(bytes).toString("base64"), name: datei.name }));
			continue;
		}
		const ref = await umgebung.ablegen({ bytes, name: datei.name });
		const pfad = umgebung.pfadVon(ref);
		inhalt.push({ type: "text", text: dateiHinweis(ref, pfad) });
	}
	return inhalt;
}

/**
 * Der Text, mit dem ein Unteragent von einer angehaengten Datei erfaehrt.
 *
 * Absichtlich derselbe Wortlaut wie im Harness selbst (dsh-llm,
 * `fileHandleText`), damit ein Unteragent nicht zwei verschiedene Erklaerungen
 * fuer dieselbe Sache kennen muss: Groesse, Pruefsumme und der Hinweis, dass es
 * eine schreibgeschuetzte Kopie ist.
 *
 * @param {{attachmentId: string, name: string, bytes: number}} ref - die Ablage.
 * @param {string|undefined} pfad - der lesbare Pfad der Kopie.
 * @returns {string} der Hinweistext.
 */
export function dateiHinweis(ref, pfad) {
	const kennung = String(ref.attachmentId).slice(7, 15);
	const identitaet = `File "${ref.name}" (${ref.bytes} bytes, sha256:${kennung})`;
	if (pfad === undefined) return `[${identitaet} was attached, but this environment exposes no readable path for it. Report that limitation if its contents are needed; do not claim to have read it.]`;
	return `[${identitaet}: verbatim read-only copy saved at "${pfad}". Read that path with your file tools when its contents are needed; copy it to a writable location before modifying it.]`;;
}

/**
 * Cordis-Plugin: gibt jedem `send_message` das Feld `agent_id`.
 *
 * @param {object} ctx - Cordis-Kontext der Profilwurzel.
 */
export function apply(ctx) {
	const melden = (stufe, text) => {
		protokolliere(text);
		try {
			const logger = ctx.logger;
			if (logger !== undefined && typeof logger[stufe] === "function") logger[stufe](`delegate-send: ${text}`);
		} catch { /* Ein fehlendes Protokoll darf den Start nie stoeren. */ }
	};

	/** Ruecknahmen je Werkzeug-Definition, damit ein Neuladen nichts stapelt. */
	const ruecknahmen = new WeakMap();

	/** Reicht eine Nachricht an den Dienst `subagents` weiter. */
	const senden = async (agentId, text, anhaenge, signal, sender, exec) => {
		let dienst;
		try { dienst = ctx.get("subagents"); } catch { dienst = undefined; }
		if (dienst === undefined || typeof dienst.sendMessage !== "function") {
			throw new Error("die Kind-Sitzung liess sich nicht anschreiben: der Dienst `subagents` fehlt in diesem Profil.");
		}
		const dateien = anhaenge.map((pfad) => pruefeDatei(pfad, arbeitsverzeichnis(exec)));
		const inhalt = dateien.length === 0
			? [{ type: "text", text }]
			: await baueInhalt(text, dateien, umgebungAussen());
		return await dienst.sendMessage(sender, agentId, inhalt, { signal });
	};

	/**
	 * Das Verzeichnis, gegen das relative Anhang-Pfade aufgeloest werden.
	 *
	 * Der Agent kennt sein Arbeitsverzeichnis nicht als Feld; die
	 * Sitzungs-Kennung traegt es auch nicht. Der verlaessliche Bezug ist der
	 * Ort, an dem der Host laeuft — dort laeuft auch jeder Unteragent, denn alle
	 * teilen denselben Prozess und dasselbe Dateisystem. Das ist genau die
	 * Zusage aus der Anordnung: "ganz normale Sessions".
	 */
	const arbeitsverzeichnis = () => {
		const ausUmgebung = process.env.DSH_WORKSPACE ?? process.env.DSH_CWD;
		return ausUmgebung !== undefined && ausUmgebung.length > 0 ? ausUmgebung : process.cwd();
	};

	/** Die vier Zugriffe, die {@link baueInhalt} braucht — aus dem laufenden Host. */
	const umgebungAussen = () => ({
		lesen: async (pfad) => readFileSync(pfad),
		bildAufnehmen: async ({ mediaType, data, name }) => {
			let anhaengeDienst;
			try { anhaengeDienst = ctx.get("attachments"); } catch { anhaengeDienst = undefined; }
			if (anhaengeDienst === undefined || typeof anhaengeDienst.admitPromptContent !== "function") {
				throw new Error("das Bild liess sich nicht aufnehmen: der Dienst `attachments` fehlt in diesem Profil.");
			}
			// `admitPromptContent` prueft das Bild und legt es dauerhaft ab —
			// dasselbe Tor, durch das ein Bild aus dem Browser geht. Danach ist
			// der Teil genau die Form, die die Zustellung versteht.
			const [teil] = await anhaengeDienst.admitPromptContent([{ type: "image", mediaType, data, name }]);
			return teil;
		},
		ablegen: async ({ bytes, name }) => {
			let anhaengeDienst;
			try { anhaengeDienst = ctx.get("attachments"); } catch { anhaengeDienst = undefined; }
			if (anhaengeDienst === undefined || typeof anhaengeDienst.saveFile !== "function") {
				throw new Error("die Datei liess sich nicht ablegen: der Dienst `attachments` fehlt in diesem Profil.");
			}
			return await anhaengeDienst.saveFile({ data: bytes, name });
		},
		pfadVon: (ref) => {
			let anhaengeDienst;
			try { anhaengeDienst = ctx.get("attachments"); } catch { anhaengeDienst = undefined; }
			if (anhaengeDienst === undefined || typeof anhaengeDienst.fileHostPath !== "function") return undefined;
			try { return anhaengeDienst.fileHostPath(ref); } catch { return undefined; }
		}
	});

	/**
	 * Erweitert das Werkzeug in einem Agenten-Scope. "spaeter" heisst: in
	 * diesem Scope ist es noch nicht sichtbar — der Normalfall fuer einen
	 * Agenten ohne Team-Rolle, und deshalb kein Fehler.
	 *
	 * @param {object} agent - der Agent, in dessen Scope das Werkzeug liegt.
	 * @returns {"fertig"|"spaeter"|"kern"|"aufgeben"}
	 */
	const erweitere = (agent) => {
		let definition;
		try {
			definition = ctx.tools.get(WERKZEUG, agent);
		} catch (error) {
			melden("warn", `das Werkzeug ${WERKZEUG} liess sich nicht abfragen: ${String(error)}`);
			return "aufgeben";
		}
		if (definition === undefined) return "spaeter";
		const ergebnis = erweitereDefinition(definition, { senden, protokoll: protokolliere });
		if (ergebnis.stand === "aufgeben") {
			melden("warn", `${ergebnis.grund}; es bleibt unveraendert.`);
			return "aufgeben";
		}
		if (ergebnis.stand === "kern") return "kern";
		if (ergebnis.zurueck !== undefined) ruecknahmen.set(definition, ergebnis.zurueck);
		protokolliere(`Werkzeug ${WERKZEUG} erweitert: \`agent_id\` erreicht die eigene Kind-Sitzung.`);
		return "fertig";
	};

	/**
	 * Ein Durchgang ueber alle Agenten-Scopes. Der Nachhol-Teil ist nicht
	 * Zierde: das Team-Werkzeug erscheint erst, wenn das Team-Plugin seinen
	 * Agenten-Scope bestueckt hat, und je nach Reihenfolge der Hoerer auf
	 * `agent/created` kann das nach diesem Modul geschehen. `tools/change`
	 * feuert bei jeder Werkzeug-Registrierung, also kommt die Erweiterung dort
	 * sicher nach.
	 *
	 * @returns {{erweitert: number, aufgegeben: boolean}}
	 */
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
		if (stand.aufgegeben) melden("warn", `das Werkzeug ${WERKZEUG} hatte nicht die erwartete Form; \`agent_id\` fehlt moeglicherweise.`);
		else if (stand.erweitert > 0) protokolliere(`beim Start erweitert in ${stand.erweitert} Agenten-Scope(s).`);
		return () => {
			for (const agent of ctx.agents.list()) {
				let definition;
				try { definition = ctx.tools.get(WERKZEUG, agent); } catch { definition = undefined; }
				if (definition === undefined) continue;
				ruecknahmen.get(definition)?.();
			}
		};
	}, "delegate-send");
}

// ---------------------------------------------------------------------------
// Selbstpruefung: node ~/.dsh/patches/delegate-send.mjs
// ---------------------------------------------------------------------------
const alsHauptmodul = process.argv[1] !== undefined && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url; // realpath: der Start ueber einen Verweis (~/.dsh/patches -> dsh-projectOS) bleibt erkannt
if (alsHauptmodul) {
	let fehlgeschlagen = 0;
	const pruefe = (ist, soll, was) => {
		if (JSON.stringify(ist) !== JSON.stringify(soll)) {
			fehlgeschlagen += 1;
			console.log(`FEHLER  ${was}: ${JSON.stringify(ist)}, erwartet ${JSON.stringify(soll)}`);
		}
	};

	// --- 1. Der Weg wird richtig erkannt ---
	const faelle = [
		{ args: { agent_id: "abc", message: "hallo" }, erwartet: "kind" },
		{ args: { target: "lead", message: "hallo" }, erwartet: "team" },
		{ args: { target: "worker-1", message: "hallo" }, erwartet: "team" },
		{ args: { agent_id: "abc", target: "lead", message: "hallo" }, fehler: true },
		{ args: { message: "hallo" }, fehler: true },
		{ args: { agent_id: "", message: "hallo" }, fehler: true },
		{ args: { agent_id: "abc" }, erwartet: "kind" }
	];
	for (const fall of faelle) {
		try {
			const ergebnis = weg(fall.args);
			if (fall.fehler === true || ergebnis !== fall.erwartet) {
				fehlgeschlagen += 1;
				console.log(`FEHLER  weg(${JSON.stringify(fall.args)}) -> ${JSON.stringify(ergebnis)}, erwartet ${JSON.stringify(fall.erwartet)}`);
			}
		} catch (error) {
			if (fall.fehler !== true) {
				fehlgeschlagen += 1;
				console.log(`FEHLER  weg(${JSON.stringify(fall.args)}) -> unerwartet: ${error.message}`);
			}
		}
	}

	// --- 2. Die Erweiterung, an einer nachgebauten Definition ---
	// Nachgebaut wie `defineTool` sie hinterlaesst: uebersetztes JSON-Schema mit
	// eigener `required`-Liste, geteilte Eigenschafts-Objekte.
	const nachbau = () => {
		const props = {
			target: { type: "string", description: "Member target ..." },
			message: { type: "string", description: "The message." }
		};
		const aufrufe = [];
		const definition = {
			name: "send_message",
			description: "Send one durable message to another Team member.",
			parameters: { type: "object", properties: props, required: ["target", "message"], additionalProperties: false },
			execute: async function (args) {
				aufrufe.push(args);
				return { messageId: "team-1", status: "accepted" };
			}
		};
		return { definition, aufrufe };
	};

	{
		const { definition } = nachbau();
		const ergebnis = erweitereDefinition(definition, {
			senden: async () => "kind-1",
			protokoll: () => {}
		});
		pruefe(ergebnis.stand, "fertig", "Stand nach der Erweiterung");
		pruefe(definition.parameters.required, ["message"], "required nach der Erweiterung (target ist keine Pflicht mehr)");
		pruefe(Object.hasOwn(definition.parameters.properties, "agent_id"), true, "agent_id ist als Parameter da");
		pruefe(Object.hasOwn(definition.parameters.properties.target, "required"), false, "target traegt kein ungueltiges required an der Eigenschaft");
		pruefe(definition.description.includes("agent_id"), true, "die Beschreibung nennt den zweiten Weg");
	}
	{
		// Ein Aufruf mit nur `agent_id` geht an den Dienst, nicht ans Team.
		const { definition, aufrufe } = nachbau();
		erweitereDefinition(definition, { senden: async (id) => `kind-${id}`, protokoll: () => {} });
		const wert = definition.execute({ agent_id: "abc", message: "hallo" }, { agent: { id: "sender" } });
		Promise.resolve(wert).then((ergebnis) => {
			pruefe(ergebnis.messageId, "kind-abc", "Aufruf mit agent_id erreicht den Dienst");
			pruefe(aufrufe.length, 0, "das Team-Werkzeug wurde dabei nicht gerufen");
		});
	}
	{
		// Ein Aufruf mit `target` laeuft unveraendert ueber das Team.
		const { definition, aufrufe } = nachbau();
		erweitereDefinition(definition, { senden: async () => "falsch", protokoll: () => {} });
		definition.execute({ target: "lead", message: "hallo" }, { agent: { id: "sender" } });
		pruefe(aufrufe.length, 1, "Aufruf mit target geht ans Team-Werkzeug");
	}
	{
		// Zweimal erweitern stapelt nicht.
		const { definition } = nachbau();
		const umgebung = { senden: async () => "x", protokoll: () => {} };
		const erste = erweitereDefinition(definition, umgebung);
		const zweite = erweitereDefinition(definition, umgebung);
		pruefe(zweite.stand, "fertig", "zweiter Durchgang meldet fertig");
		pruefe(zweite.zurueck, undefined, "zweiter Durchgang haengt keine zweite Ruecknahme an");
		// Und die Ruecknahme stellt den Ausgangszustand her.
		erste.zurueck();
		pruefe(definition.parameters.required, ["target", "message"], "Ruecknahme stellt required her");
		pruefe(Object.hasOwn(definition.parameters.properties, "agent_id"), false, "Ruecknahme entfernt agent_id");
	}
	{
		// Das Werkzeug des Kerns (hat agent_id schon) bleibt unberuehrt.
		const definition = {
			name: "send_message",
			description: "Send a message to an agent.",
			parameters: { type: "object", properties: { agent_id: { type: "string" }, message: { type: "string" } }, required: ["agent_id", "message"] },
			execute: async () => ({ messageId: "x" })
		};
		pruefe(erweitereDefinition(definition, { senden: async () => "x", protokoll: () => {} }).stand, "kern", "Kern-Werkzeug wird erkannt");
	}
	{
		// Fremde Form wird nicht angefasst.
		pruefe(erweitereDefinition({ name: "send_message" }, {}).stand, "aufgeben", "formlose Definition wird abgelehnt");
	}

	{
		// Ohne `message` darf der zweite Weg nicht zum Dienst durchrutschen.
		// Grund (gemessen): der Rahmen von defineTool prueft in der ERSETZTEN
		// execute nicht mehr, deshalb prueft der zweite Weg selbst.
		const { definition } = nachbau();
		let angekommen = 0;
		erweitereDefinition(definition, { senden: async () => { angekommen += 1; return "x"; }, protokoll: () => {} });
		let abgelehnt = false;
		try {
			await definition.execute({ agent_id: "abc" }, { agent: { id: "sender" } });
		} catch { abgelehnt = true; }
		pruefe(abgelehnt, true, "Aufruf mit agent_id ohne message wird abgelehnt");
		pruefe(angekommen, 0, "und erreicht den Dienst nicht");
	}

	// --- 3. Anhaenge: Form, Art-Erkennung und der gebaute Inhalt -------------
	{
		// Die Pfadliste wird geprueft, bevor irgendetwas gelesen wird.
		pruefe(pruefeAnhaenge({}), [], "ohne attach gibt es keine Anhaenge");
		pruefe(pruefeAnhaenge({ attach: ["/a/b.txt"] }), ["/a/b.txt"], "ein Pfad kommt durch");
		for (const fall of [{ attach: "/a/b.txt" }, { attach: [""] }, { attach: [42] }, { attach: ["  "] }]) {
			let abgelehnt = false;
			try { pruefeAnhaenge(fall); } catch { abgelehnt = true; }
			pruefe(abgelehnt, true, `attach ${JSON.stringify(fall.attach)} wird abgelehnt`);
		}
	}
	{
		// Bild oder Datei entscheidet die Endung — Gross- und Kleinschreibung egal.
		pruefe(bildArt("/x/foto.PNG"), "image/png", "PNG wird als Bild erkannt");
		pruefe(bildArt("/x/foto.jpeg"), "image/jpeg", "JPEG wird als Bild erkannt");
		pruefe(bildArt("/x/foto.webp"), "image/webp", "WEBP wird als Bild erkannt");
		pruefe(bildArt("/x/foto.gif"), "image/gif", "GIF wird als Bild erkannt");
		pruefe(bildArt("/x/bericht.pdf"), undefined, "PDF ist eine Datei");
		pruefe(bildArt("/x/ohne.endung"), undefined, "ohne Endung ist es eine Datei");
		pruefe(bildArt("/x/foto.bmp"), undefined, "ein unbekanntes Bildformat ist eine Datei");
	}
	{
		// Der gebaute Inhalt: Text zuerst, dann die Anhaenge in genannter Folge.
		// Ein Bild geht als base64 mit, eine Datei wird abgelegt und ihr Pfad
		// als Text genannt. Beides wird hier ohne echtes Dateisystem gefahren.
		const abgelegt = [];
		const gelesen = [];
		const aufgenommen = [];
		const umgebung = {
			lesen: async (pfad) => { gelesen.push(pfad); return Buffer.from(`bytes-von-${pfad}`); },
			bildAufnehmen: async (bild) => {
				aufgenommen.push(bild.name);
				return { type: "image", attachment: { attachmentId: `att-0000000099998888-${bild.name}`, name: bild.name, bytes: 3 } };
			},
			ablegen: async ({ bytes, name }) => {
				abgelegt.push({ bytes: bytes.length, name });
				return { attachmentId: `att-0000000011112222-${name}`, name, bytes: bytes.length };
			},
			pfadVon: (ref) => `/ablage/${ref.name}`
		};
		const inhalt = await baueInhalt("hier ist alles", [
			{ pfad: "/tmp/foto.png", name: "foto.png" },
			{ pfad: "/tmp/bericht.pdf", name: "bericht.pdf" }
		], umgebung);
		pruefe(inhalt.length, 3, "Text plus zwei Anhaenge ergeben drei Teile");
		pruefe(inhalt[0], { type: "text", text: "hier ist alles" }, "der Auftrag steht vorn");
		pruefe(inhalt[1].type, "image", "das Bild kommt als Bild");
		pruefe(inhalt[1].attachment.attachmentId.startsWith("att-"), true, "und zwar als dauerhafte Ablage, nicht als rohe Bytes");
		pruefe(inhalt[1].data, undefined, "die rohen base64-Bytes werden NICHT mitgeschickt");
		pruefe(aufgenommen, ["foto.png"], "das Bild wurde beim Empfaenger aufgenommen");
		pruefe(inhalt[2].type, "text", "die Datei kommt als Text-Hinweis");
		pruefe(inhalt[2].text.includes("/ablage/bericht.pdf"), true, "der Hinweis nennt den lesbaren Pfad");
		pruefe(inhalt[2].text.includes("bericht.pdf"), true, "der Hinweis nennt den Namen");
		pruefe(inhalt[2].text.includes("read-only"), true, "der Hinweis sagt, dass die Kopie schreibgeschuetzt ist");
		pruefe(gelesen, ["/tmp/foto.png", "/tmp/bericht.pdf"], "gelesen wird in genannter Reihenfolge");
		pruefe(abgelegt.length, 1, "nur die Datei wird abgelegt, das Bild nicht");
	}
	{
		// Ohne lesbaren Pfad darf der Hinweis nicht behaupten, die Datei sei lesbar.
		const hinweis = dateiHinweis({ attachmentId: "att-abcdefgh1234", name: "x.bin", bytes: 7 }, undefined);
		pruefe(hinweis.includes("no readable path"), true, "ohne Pfad wird die Grenze benannt");
		pruefe(hinweis.includes("do not claim to have read it"), true, "und keine Lektuere behauptet");
	}
	{
		// Eine fehlende Datei wird VOR dem Senden gemeldet, mit Pfad im Text.
		// Zwei Faelle, weil sie sich verschieden verhalten: ein absoluter Pfad
		// bleibt, wie er ist; ein relativer wird gegen das Arbeitsverzeichnis
		// gehaengt — und dann nennt die Meldung beide, den genannten und den
		// gesuchten Ort. Genau das braucht der Mensch beim Suchen.
		let absolut = "";
		try { pruefeDatei("/gibt/es/nicht.txt", "/tmp"); } catch (error) { absolut = error.message; }
		pruefe(absolut.includes("/gibt/es/nicht.txt"), true, "die Meldung nennt den genannten Pfad");
		let relativ = "";
		try { pruefeDatei("nicht-da.txt", "/tmp"); } catch (error) { relativ = error.message; }
		pruefe(relativ.includes("nicht-da.txt"), true, "die Meldung nennt den relativen Pfad");
		pruefe(relativ.includes("/tmp/nicht-da.txt"), true, "und den aufgeloesten Ort");
	}
	{
		// Ein Aufruf mit attach erreicht den Dienst mit der Anhangliste — der
		// Modulcode selbst prueft die Dateien, hier zaehlt nur die Weitergabe.
		const { definition } = nachbau();
		let gesehen = null;
		erweitereDefinition(definition, {
			senden: async (id, text, anhaenge) => { gesehen = { id, text, anhaenge }; return "m1"; },
			protokoll: () => {}
		});
		await definition.execute({ agent_id: "abc", message: "hallo", attach: ["/a/b.png", "/a/c.pdf"] }, { agent: { id: "sender" } });
		pruefe(gesehen.anhaenge, ["/a/b.png", "/a/c.pdf"], "die Anhangliste kommt beim Dienst an");
		pruefe(gesehen.text, "hallo", "der Text bleibt unveraendert");
	}
	{
		// Und die Ruecknahme raeumt auch das Anhang-Feld weg.
		const { definition } = nachbau();
		const erste = erweitereDefinition(definition, { senden: async () => "x", protokoll: () => {} });
		pruefe(Object.hasOwn(definition.parameters.properties, "attach"), true, "attach ist da");
		erste.zurueck();
		pruefe(Object.hasOwn(definition.parameters.properties, "attach"), false, "Ruecknahme entfernt attach");
	}

	// Die asynchronen Faelle oben brauchen einen Moment.
	setTimeout(() => {
		console.log(fehlgeschlagen === 0 ? "Selbstpruefung: alles in Ordnung." : `Selbstpruefung: ${fehlgeschlagen} Fehler.`);
		process.exitCode = fehlgeschlagen === 0 ? 0 : 1;
	}, 20);
}
