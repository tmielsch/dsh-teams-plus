/**
 * stille-nachrichten — eine Direkt-Nachricht an ein Teammitglied, ohne dass
 * der Lead davon erfahrt und ohne dass der Empfinger ihm melde
 * ========================================================================
 *
 * WAS DER MENSCH WOLLTE (Anordnung 2026-10-30, sinngemaess woertlich)
 * "Jedes Mal, wenn ich irgendwas mit irgendwem bespreche, wird sofort der Lead
 * gefragt. Alles wird immer mit dem Lead besprochen. Das stoert jedes Mal eine
 * Kaskade los an unnuetigen Nachrichten — einfach nur Energieverschwendung.
 * Es darf keine menschen-nachahmende Kommunikation geben. Es muss eine Agent-
 * first-Kommunikation geben, die ganz gezielt bestimmt, wer wann wen anschreiben
 * darf, um diese Kaskaden nicht auszueroedern."
 *
 * WAS GEMESSEN IST — woher die Kaskade kommt
 * Die Kaskade ist kein Fehler im Kern; sie steht als Anweisung im Team-Text:
 *   1. `teammateReminder` (dsh-experimental-tool-agent-team/lib/index.js, Zeile
 *      87-88) sagt jedem neuen Teammitglied: "To message your Team Lead, use
 *      send_message({ target: 'lead', ... })". Ein Mitglied, das fertig wird,
 *      meldet dem Lead — das ist die Anordnung, nicht eine Laune.
 *   2. `POLICY` (dieselbe Datei, Zeile 28) sagt: "The Lead must wait for required
 *      teammates before giving the final answer." Der Lead haengt damit in jeder
 *      Runde an jedem Mitglied.
 *   3. Jede zugestellte Team-Nachricht wird im Lead-Log verbucht
 *      (`team/message/queued` / `team/message/delivered` auf dem Lead-Session-Log,
 *      dsh-experimental-agent-team/lib/index.js Zeile 927ff). Der Lead sieht den
 *      Austausch also in seinem eigenen Log, und `wait_agent` weckt ihn darauf.
 *   Punkt 3 ist die Speicher-Struktur des Teams und laesst sich ohne Kern-Eingriff
 *      nicht entfernen; er zaehlt hier nicht als Kaskade, weil der Lead daraus
 *      nicht antwortet. Die Kaskade ist Punkt 1 und 2: das Modell wird gebeten,
 *      dem Lead zu schreiben.
 *
 * WAS DIESES MODUL TUT (nur im Speicher, kein Paket wird angefasst)
 * Es gibt `send_message` ein Feld `quiet` dazu. Steht `quiet: true`, haengt der
 * Modulcode der Nachricht einen Adressvermerk an, den BOTH Seiten lesen:
 *   - dem Empfaenger: "diese Nachricht ist nur fuer dich; antworte in diesem
 *     Thread, nicht dem Lead; melde sie ihm nicht weiter";
 *   - dem Absender im Werkzeug-Ergebnis: dieselbe Regel, damit er die Antwort
 *     erwartet und nicht selbst zum Lead rennt.
 * Der Vermerk ist Text im Nachrichtenkoerper, also genau das, was die Leitung
 * schon kann — kein Eingriff in die Zustellung, kein generierter Code.
 *
 * WAS ES NICHT AENDERT
 *   - Adressierung bleibt `target` (Name aus list_agents, inklusive "lead").
 *   - Rechte bleiben: die Nachricht geht nur an ein Teammitglied unter dem
 *     Absender; `agentTeams.sendMessage` prueft das selbst.
 *   - `quiet` ist keine Pflicht: ohne das Feld laeuft alles unveraendert.
 *   - Der Lead kann weiter angesprochen werden; der Mensch kann den Lead
 *     ansprechen. Die Anordnung des Menschen ist: wer vom Lead wissen muss, wird
 *     vom Menschen instruiert — nicht vom Teammitglied aus eigenem Antrieb.
 *
 * RUECKGAENGIG
 *   Eintrag `stille-nachrichten` aus profiles/web/cordis.patch.yml nehmen und
 *   DSH neu starten.
 *
 * Selbstpruefung: node ~/.dsh/patches/stille-nachrichten.mjs
 * Protokoll:      ~/.dsh/logs/stille-nachrichten.log
 */

import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const name = "stille-nachrichten";

/** Dienste, ohne die dieses Modul nichts tun kann. */
export const inject = ["tools", "agents", "agentTeams", "systemPrompt"];

/** Marke auf der umgebogenen Ausfuehrung: verhindert Stapeln nach einem Neuladen. */
const MARKE = Symbol.for("stille-nachrichten.umgebogen");
/** Dieselbe Marke auf `spawn_teammate`, damit ein Neuladen nicht stapelt. */
const MARKE_SPAWN = Symbol.for("stille-nachrichten.spawn-umgebogen");

/** Das Werkzeug, um das es geht. */
export const WERKZEUG = "send_message";

/** Schreibt eine Zeile ins Protokoll; ein Fehler dabei stoert nie. */
function protokolliere(text) {
	try {
		const pfad = process.env.DSH_STILLE_NACHRICHTEN_LOG ?? join(homedir(), ".dsh", "logs", "stille-nachrichten.log");
		appendFileSync(pfad, `${new Date().toISOString()} ${text}\n`);
	} catch { /* Das Protokoll ist Beigabe, nie Bedingung. */ }
}

/**
 * Der Adressvermerk fuer den Empfaenger: die Regel, die die Kaskade schliesst.
 *
 * @param senderName - der Name des Absenders, wie die Zustellung ihn nennt.
 * @returns {string} der Vermerk als Textblock.
 */
export function empfaengerVermerk(senderName) {
	const von = senderName ? ` von "${senderName}"` : "";
	return [
		`[STILLE DIREKT-NACHRICHT${von}]`,
		`Diese Nachricht ist nur fuer dich. Antworte in diesem Thread an den Absender.`,
		`Schreib dem Lead NICHT ueber diese Nachricht und melde sie ihm nicht weiter.`,
		`Der Lead erfahrt es nur, wenn der Mensch es ausdruecklich will.`,
		`Bist du fertig, antworte hier; send_message({target:"lead"}) ist fuer diese Nachricht verboten.`,
	].join("\n");
}

/**
 * Der Hinweis an den Absender im Werkzeug-Ergebnis: dieselbe Regel von der anderen
 * Seite, damit er die Antwort im Thread erwartet und nicht selbst zum Lead rennt.
 */
export function absenderHinweis(target) {
	return `quiet: die Nachricht ging nur an "${target}". Antworte nicht dem Lead ueber diesen Austausch; der Lead erfahrt es nur auf ausdruecklichen Wunsch des Menschen.`;
}

/**
 * Erweitert eine `send_message`-Definition um das Feld `quiet`.
 *
 * Bewusst eine eigene exportierte Funktion, damit der ganze Eingriff ohne
 * laufenden Host geprueft werden kann. Sie veraendert die Definition an Ort und
 * Stelle, wie es das Werkzeug-Register erwartet, und gibt eine Ruecknahme.
 *
 * @param {object} definition - die aufgeloeste Werkzeug-Definition.
 * @param {object} umgebung - `protokoll(text)` schreibt eine Zeile.
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
	if (!Object.hasOwn(eigenschaften, "target")) return { stand: "aufgeben", grund: `das Werkzeug ${WERKZEUG} hat kein \`target\`; es ist nicht das Team-Werkzeug` };
	if (Object.hasOwn(eigenschaften, "quiet")) return { stand: "kern" };

	const grundExecute = definition.execute;
	const grundBeschreibung = definition.description;

	// `quiet` als optionale Eigenschaft. Optionalitaet steht ausschliesslich in
	// der required-Liste des Objekts — `required: false` an einer Eigenschaft ist
	// ungueltiges JSON Schema und laesst Anthropic die Anfrage mit 400 ablehnen
	// (gemessen am delegate-Patch, 2026-10-25).
	eigenschaften.quiet = {
		type: "boolean",
		description: "Set true to send a private direct message: the target answers only in this thread and must NOT report it to the Lead. Use it to discuss with an expert or subagent without starting a Lead cascade. Leave it out for normal messages."
	};

	definition.description = grundBeschreibung + " With `quiet: true` the message is private between you and the target: the target answers in its own thread and does not tell the Lead about it, so no cascade of unnecessary messages starts.";

	definition.execute = async function (args, exec) {
		if (args.quiet !== true) return grundExecute.call(this, args, exec);
		const nachricht = args?.message;
		if (typeof nachricht !== "string" || nachricht.length === 0) {
			throw new Error("`message` fehlt: eine Nachricht ohne Text kann nicht zugestellt werden.");
		}
		const sender = exec?.agent;
		if (sender === undefined) throw new Error(`${WERKZEUG} braucht einen aufrufenden Agenten.`);

		// Der Weg zu einer eigenen Kind-Sitzung (`agent_id`, vom delegate-send-Patch):
		// der Vermerk kommt vor den Text, die Grund-execute macht die Zustellung.
		const kind = args?.agent_id;
		if (kind !== undefined && kind !== null && String(kind).length > 0) {
			let kindName = "";
			try {
				const sessions = umgebung.sessions?.();
				kindName = sessions?.get?.(String(kind))?.displayTitle ?? String(kind);
			} catch { /* Der Name ist Schmuck am Vermerk, nie Bedingung. */ }
			return {
				...(await grundExecute.call(this, { ...args, message: empfaengerVermerk(kindName) + "\n\n" + nachricht }, exec)),
				note: absenderHinweis(String(kind)),
			};
		}

		let senderName = "";
		try {
			const teams = umgebung.teams();
			if (teams !== undefined && typeof teams.membership === "function") senderName = teams.membership(sender)?.name ?? "";
		} catch { /* Der Name ist Schmuck am Vermerk, nie Bedingung. */ }
		const content = [{ type: "text", text: empfaengerVermerk(senderName) }, { type: "text", text: nachricht }];
		// Die Grund-execute nimmt nur `target`/`message` und kann den Vermerk nicht
		// mitgeben, also geht die Zustellung ueber den Dienst — genau die Form, die
		// die Leitung schon kann (Text-Teile), kein Eingriff in die Zustellung.
		const teams = umgebung.teams();
		if (teams === undefined || typeof teams.sendMessage !== "function") {
			throw new Error("der Team-Dienst fehlt in diesem Profil; eine stille Nachricht kann nicht zugestellt werden.");
		}
		const gesendet = await teams.sendMessage(sender, { target: args.target, content, signal: exec.signal });
		umgebung.protokoll(`stille Nachricht an "${args.target}" zugestellt (${gesendet?.messageId ?? "ohne Kennung"}).`);
		return {
			...(gesendet && typeof gesendet === "object" ? gesendet : {}),
			note: absenderHinweis(args.target),
		};
	};
	definition.execute[MARKE] = true;
	return {
		stand: "fertig",
		zurueck() {
			definition.execute = grundExecute;
			definition.description = grundBeschreibung;
			Reflect.deleteProperty(eigenschaften, "quiet");
		}
	};
}

/**
 * Die Regel, die jeder neue Teammitglied-Prompt als Anhang bekommt: die
 * Kaskade wird an der Quelle geschlossen, nicht nur im Einzelfall. Der Anhang
 * steht nach `teammateReminder` (die Kern-Funktion setzt die Reminder-Textblöcke
 * vorn), also kennt das Modell die Regel von der ersten Zeile an.
 */
export function kaskadenRegel() {
	return [
		"KEINE MENSCHEN-NACHAHMUNG, KEINE KASKADE:",
		"- Melde dem Lead nichts aus eigenem Antrieb. Du darfst ihm schreiben, wenn der Auftrag es verlangt, wenn du steckenbleibst, oder wenn der Mensch es will.",
		"- Eine Nachricht mit dem Vermerk [STILLE DIREKT-NACHRICHT] ist privat: antworte in diesem Thread und dem Lead nicht darüber.",
		"- Ein 'Hallo, ich habe deine Nachricht bekommen' ist keine Antwort. Antworte mit Inhalt oder gar nicht.",
		"- Du musst den Lead nicht am Ende jedes Zugs informieren; der Lead erfährt das Ergebnis über die geteilte Aufgabenliste und die Aufgaben selbst.",
	].join("\n");
}

/**
 * Erweitert eine `spawn_teammate`-Definition, damit jedes neue Teammitglied die
 * Kaskaden-Regel im Prompt bekommt.
 *
 * @param {object} definition - die aufgelöste Werkzeug-Definition.
 * @returns {{stand: "fertig"|"aufgeben", zurueck?: () => void}}
 */
export function erweitereSpawnWerkzeug(definition) {
	if (definition === undefined || typeof definition.execute !== "function") return { stand: "aufgeben" };
	if (definition.execute[MARKE_SPAWN] === true) return { stand: "fertig" };
	const grundExecute = definition.execute;
	definition.execute = async function (args, exec) {
		if (typeof args?.prompt !== "string") return grundExecute.call(this, args, exec);
		return grundExecute.call(this, { ...args, prompt: args.prompt + "\n\n" + kaskadenRegel() }, exec);
	};
	definition.execute[MARKE_SPAWN] = true;
	return { stand: "fertig", zurueck() { definition.execute = grundExecute; } };
}

/**
 * Die Lead-Seite: der Lead soll stille Threads nicht nachverfolgen und keine
 * Bestätigungs-Kette auslösen. Ein eigener Abschnitt, additive, im Lead-Scope.
 */
export function leadRegel() {
	return [
		"STILLE THREADS: ein Teammitglied, das eine private Direkt-Nachricht erhält, antwortet in seinem Thread; der Lead wird nicht informiert und muss nicht nachfragen.",
		"- Antworte auf eine Team-Nachricht nicht mit 'ich habe sie bekommen'; antworte mit Inhalt oder gar nicht.",
		"- Wer vom Lead wissen muss, wird vom Menschen instruiert; der Lead verteilt die Information nur auf ausdrücklichen Wunsch.",
	].join("\n");
}

/**
 * Cordis-Plugin: gibt jedem `send_message` das Feld `quiet`, jedem neuen
 * Teammitglied die Kaskaden-Regel und dem Lead die Lead-Regel.
 *
 * @param {object} ctx - Cordis-Kontext der Profilwurzel.
 */
export function apply(ctx) {
	const melden = (stufe, text) => {
		protokolliere(text);
		try {
			const logger = ctx.logger;
			if (logger !== undefined && typeof logger[stufe] === "function") logger[stufe](`stille-nachrichten: ${text}`);
		} catch { /* Ein fehlendes Protokoll darf den Start nie stoeren. */ }
	};

	const ruecknahmen = new WeakMap();
	const spawnRuecknahmen = new WeakMap();
	const promptRegistriert = new WeakMap();

	const teams = () => {
		try { return ctx.get("agentTeams"); } catch { return undefined; }
	};

	/** Die Regel, die in den Scope dieses Agenten gehört: Lead-Text oder Kaskaden-Regel. */
	function regelFuer(agent) {
		if (promptRegistriert.has(agent)) return;
		let rolle = null;
		try {
			const t = teams();
			if (t !== undefined && typeof t.tryMembership === "function") rolle = t.tryMembership(agent)?.role ?? null;
		} catch { /* Ohne Team-Rolle ist der Agent ein Einzelagent: keine Regel. */ }
		if (rolle !== "lead" && rolle !== "teammate") return;
		const text = rolle === "lead" ? leadRegel() : kaskadenRegel();
		let disposer;
		try {
			disposer = agent.ctx.systemPrompt.section({ name: "stille-nachrichten:regel", order: 610, text });
		} catch (error) {
			melden("warn", `die Regel liess sich im Scope nicht eintragen: ${String(error)}`);
			return;
		}
		promptRegistriert.set(agent, disposer);
		protokolliere(`Regel im ${rolle}-Scope eingetragen.`);
	}

	const erweitere = (agent) => {
		let definition;
		try {
			definition = ctx.tools.get(WERKZEUG, agent);
		} catch (error) {
			melden("warn", `das Werkzeug ${WERKZEUG} liess sich nicht abfragen: ${String(error)}`);
			return "aufgeben";
		}
		if (definition === undefined) return "spaeter";
		const ergebnis = erweitereDefinition(definition, { protokoll: protokolliere, teams });
		if (ergebnis.stand === "aufgeben") {
			melden("warn", `${ergebnis.grund}; es bleibt unveraendert.`);
			return "aufgeben";
		}
		if (ergebnis.stand === "kern") return "kern";
		if (ergebnis.zurueck !== undefined) ruecknahmen.set(definition, ergebnis.zurueck);
		protokolliere(`Werkzeug ${WERKZEUG} erweitert: \`quiet\` stellt eine stille Direkt-Nachricht zu.`);
		return "fertig";
	};

	/** `spawn_teammate` bekommt die Kaskaden-Regel als Anhang des Auftrags. */
	const erweitereSpawn = (agent) => {
		let definition;
		try {
			definition = ctx.tools.get("spawn_teammate", agent);
		} catch { return "spaeter"; }
		if (definition === undefined) return "spaeter";
		const ergebnis = erweitereSpawnWerkzeug(definition);
		if (ergebnis.stand === "aufgeben") return "aufgeben";
		if (ergebnis.zurueck !== undefined) spawnRuecknahmen.set(definition, ergebnis.zurueck);
		return "fertig";
	};

	const durchgang = () => {
		let erweitert = 0;
		let aufgegeben = false;
		for (const agent of ctx.agents.list()) {
			const ergebnis = erweitere(agent);
			if (ergebnis === "fertig") erweitert += 1;
			if (ergebnis === "aufgeben") aufgegeben = true;
			erweitereSpawn(agent);
			regelFuer(agent);
		}
		return { erweitert, aufgegeben };
	};

	ctx.on("agent/created", ({ agent }) => { durchgang(); });
	ctx.on("tools/change", () => { durchgang(); });
	ctx.on("app-boot/config-reload", () => { durchgang(); });

	ctx.effect(() => {
		const stand = durchgang();
		if (stand.aufgegeben) melden("warn", `das Werkzeug ${WERKZEUG} hatte nicht die erwartete Form; \`quiet\` fehlt moeglicherweise.`);
		else if (stand.erweitert > 0) protokolliere(`beim Start erweitert in ${stand.erweitert} Agenten-Scope(s).`);
		return () => {
			for (const agent of ctx.agents.list()) {
				let definition;
				try { definition = ctx.tools.get(WERKZEUG, agent); } catch { definition = undefined; }
				if (definition !== undefined) ruecknahmen.get(definition)?.();
				let spawn;
				try { spawn = ctx.tools.get("spawn_teammate", agent); } catch { spawn = undefined; }
				if (spawn !== undefined) spawnRuecknahmen.get(spawn)?.();
				promptRegistriert.get(agent)?.();
				promptRegistriert.delete(agent);
			}
		};
	}, "stille-nachrichten");
}

// ---------------------------------------------------------------------------
// Selbstpruefung: node ~/.dsh/patches/stille-nachrichten.mjs
// ---------------------------------------------------------------------------
const alsHauptmodul = process.argv[1] !== undefined && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
if (alsHauptmodul) {
	let fehlgeschlagen = 0;
	const pruefe = (ist, soll, was) => {
		if (JSON.stringify(ist) !== JSON.stringify(soll)) {
			fehlgeschlagen += 1;
			console.log(`FEHLER  ${was}: ${JSON.stringify(ist)}, erwartet ${JSON.stringify(soll)}`);
		}
	};

	// --- 1. Der Vermerk schliesst die Kaskade, beide Seiten ---
	const v = empfaengerVermerk("worker-1");
	pruefe(v.includes("nur fuer dich"), true, "der Vermerk sagt: nur fuer den Empfaenger");
	pruefe(v.includes("Lead") && v.includes("nicht"), true, "und verbietet die Meldung an den Lead");
	pruefe(v.includes("von \"worker-1\""), true, "der Absender wird genannt");
	pruefe(absenderHinweis("experte").includes("Lead"), true, "auch der Absender wird gewarnt");

	// --- 2. Die Erweiterung an einer nachgebauten Definition ---
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
		const ergebnis = erweitereDefinition(definition, { protokoll: () => {}, teams: () => ({ sendMessage: async () => ({ messageId: "m" }) }) });
		pruefe(ergebnis.stand, "fertig", "Stand nach der Erweiterung");
		pruefe(Object.hasOwn(definition.parameters.properties, "quiet"), true, "quiet ist als Parameter da");
		pruefe(definition.parameters.required.includes("quiet"), false, "quiet ist keine Pflicht (required-Liste unveraendert)");
		pruefe(definition.description.includes("quiet"), true, "die Beschreibung nennt den Weg");
	}

	{
		// Ein Aufruf ohne quiet laeuft unveraendert ueber das Team-Werkzeug.
		const { definition, aufrufe } = nachbau();
		erweitereDefinition(definition, { protokoll: () => {}, teams: () => ({ sendMessage: async () => ({}) }) });
		definition.execute({ target: "worker-1", message: "hallo" }, { agent: { id: "s" } });
		pruefe(aufrufe.length, 1, "ohne quiet: das Team-Werkzeug wird gerufen");
	}

	{
		// Ein Aufruf mit quiet geht durch den Dienst, der Vermerk steht vorn.
		const { definition, aufrufe } = nachbau();
		let gesehen = null;
		erweitereDefinition(definition, {
			protokoll: () => {},
			teams: () => ({
				membership: () => ({ name: "lead" }),
				sendMessage: async (caller, req) => { gesehen = req; return { messageId: "m2", status: "accepted" }; }
			})
		});
		const wert = definition.execute({ target: "experte", message: "hallo unter vier Augen", quiet: true }, { agent: { id: "s" } });
		Promise.resolve(wert).then((ergebnis) => {
			pruefe(gesehen?.content?.[0]?.text?.includes("nur fuer dich"), true, "der Vermerk steht an der Nachricht");
			pruefe(gesehen?.content?.[1]?.text, "hallo unter vier Augen", "der Text folgt dem Vermerk");
			pruefe(ergebnis.note.includes("Lead"), true, "der Absender bekommt den Hinweis");
			pruefe(aufrufe.length, 0, "die gefilterte Grund-execute wird bei quiet nicht gerufen");
		});
	}

	{
		// Zweimal erweitern stapelt nicht; die Ruecknahme stellt her.
		const { definition } = nachbau();
		const umgebung = { protokoll: () => {}, teams: () => ({ sendMessage: async () => ({}) }) };
		const erste = erweitereDefinition(definition, umgebung);
		const zweite = erweitereDefinition(definition, umgebung);
		pruefe(zweite.stand, "fertig", "zweiter Durchgang meldet fertig");
		pruefe(zweite.zurueck, undefined, "zweiter Durchgang haengt keine zweite Ruecknahme an");
		erste.zurueck();
		pruefe(Object.hasOwn(definition.parameters.properties, "quiet"), false, "Ruecknahme entfernt quiet");
	}

	{
		// Fremde Form wird nicht angefasst.
		pruefe(erweitereDefinition({ name: "send_message" }, { protokoll: () => {} }).stand, "aufgeben", "formlose Definition wird abgelehnt");
		pruefe(erweitereDefinition({ name: "send_message", parameters: { type: "object", properties: {} }, execute: async () => ({}) }, { protokoll: () => {} }).stand, "aufgeben", "ohne target wird es nicht erkannt");
	}

	// --- 3. spawn_teammate haengt die Kaskaden-Regel an den Auftrag ---
	{
		const aufrufe = [];
		const definition = {
			name: "spawn_teammate",
			parameters: { type: "object", properties: { name: { type: "string" }, prompt: { type: "string" } }, required: ["name", "prompt"] },
			execute: async function (args) { aufrufe.push(args); return { member: { target: args.name } }; }
		};
		const stand = erweitereSpawnWerkzeug(definition);
		pruefe(stand.stand, "fertig", "spawn erweitert");
		definition.execute({ name: "experte", prompt: "Bau das Dach." }, {});
		pruefe(aufrufe[0].prompt.startsWith("Bau das Dach."), true, "der Auftrag bleibt vorn");
		pruefe(aufrufe[0].prompt.includes("KEINE MENSCHEN-NACHAHMUNG"), true, "die Kaskaden-Regel ist angehaengt");
		stand.zurueck();
		definition.execute({ name: "x", prompt: "Nur das." }, {});
		pruefe(aufrufe[1].prompt, "Nur das.", "Ruecknahme stellt den rohen Auftrag her");
	}

	// --- 4. Die Regeln verbieten die Bestaetigungskette ---
	pruefe(kaskadenRegel().includes("ich habe deine Nachricht bekommen"), true, "die Mitglied-Regel nennt die Bestaetigung");
	pruefe(leadRegel().includes("ich habe sie bekommen"), true, "die Lead-Regel nennt sie auch");
	pruefe(empfaengerVermerk("lead").includes("send_message"), true, "der Vermerk nennt das verbotene Werkzeug");

	{
		// quiet ohne message darf nicht durchrutschen.
		const { definition } = nachbau();
		let angekommen = 0;
		erweitereDefinition(definition, { protokoll: () => {}, teams: () => ({ sendMessage: async () => { angekommen += 1; return {}; } }) });
		let abgelehnt = false;
		try { await definition.execute({ target: "x", quiet: true }, { agent: { id: "s" } }); } catch { abgelehnt = true; }
		pruefe(abgelehnt, true, "quiet ohne message wird abgelehnt");
		pruefe(angekommen, 0, "und erreicht den Dienst nicht");
	}

	// --- 5. quiet auf dem agent_id-Weg: Vermerk vor dem Text, Zustellung durch die Grund-execute ---
	{
		const { definition } = nachbau()
		definition.parameters.properties.agent_id = { type: "string" }
		const aufrufe = []
		definition.execute = async function (args, exec) { aufrufe.push(args); return { ok: true } }
		const umgebung = {
			protokoll: () => {},
			teams: () => ({ sendMessage: async () => ({}) }),
			sessions: () => ({ get: (id) => id === "kind1" ? { displayTitle: "Der Experte" } : undefined }),
		}
		erweitereDefinition(definition, umgebung)
		const ergebnis = await definition.execute({ agent_id: "kind1", message: "Nur unter uns.", quiet: true }, { agent: { id: "s" } })
		pruefe(aufrufe.length, 1, "die Grund-execute stellt die Kind-Nachricht zu")
		const text = aufrufe[0].message
		pruefe(text.includes("nur fuer dich"), true, "der Vermerk steht vor dem Text")
		pruefe(text.endsWith("Nur unter uns."), true, "der Nachrichttext bleibt der letzte Teil")
		pruefe(text.includes("Der Experte"), true, "der Kind-Name steht im Vermerk")
		pruefe(aufrufe[0].agent_id, "kind1", "agent_id bleibt erhalten")
		pruefe(ergebnis.note.includes("kind1"), true, "der Absender bekommt den Hinweis auf die Kind-Sitzung")
	}

	setTimeout(() => {
		console.log(fehlgeschlagen === 0 ? "Selbstpruefung: alles in Ordnung." : `Selbstpruefung: ${fehlgeschlagen} Fehler.`);
		process.exitCode = fehlgeschlagen === 0 ? 0 : 1;
	}, 20);
}
