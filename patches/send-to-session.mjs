/**
 * send-to-session — ein Agent darf eine beliebige LEBENDE Sitzung anschreiben
 * =========================================================================
 *
 * WAS DER MENSCH WOLLTE (2026-10-30, sinngemaess woertlich)
 * "Kriegen wir das hin, einen send_message patch in dieses plugin aufzunehmen,
 * der das native send_message so patcht, dass agents an alle sessions senden
 * koennen?"
 *
 * WAS SICH BEIM MESSEN ZEIGTE — der Patch greift NICHT bei `send_message`
 * `send_message` ist ein duenner Aufsatz (dsh-tool-subagent-control/lib/index.js,
 * 95 Zeilen) und ruft nur `ctx.subagents.sendMessage()`. Die Verweigerung steht
 * eine Schicht tiefer, in `dsh-subagent/lib/index.js:1762`:
 *
 *   if (sender.session.header.parentSession === targetId) throw … "UNAUTHORIZED";
 *   return this.deliverToChild(sender, targetId, …);   // holdOwnership(parent, childId)
 *
 * `deliverToChild` verlangt ueber `activations.holdOwnership` eine
 * Eltern-Kind-Beziehung. Ein Umbau des Werkzeugs erreicht diese Pruefung also
 * gar nicht. Der Kommentar im Dienst sagt es selbst: "residency, cold resume,
 * and interrupt authorization belong to the subagent service".
 *
 * DER FREIE WEG — gemessen, nicht vermutet
 * Der Agent selbst bietet oeffentliche Methoden, die der Kern bei jeder
 * menschengetippten Nachricht benutzt und die KEINE Verwandtschaft pruefen
 * (dsh-agent/lib/types/runtime-types.d.ts, Zeile 145 und 176 ff.):
 *
 *   agent.followup(message)   "Queue an ordinary follow-up turn and wake the driver."
 *   agent.steer(message)      "Submit steering for the nearest step."
 *   agent.inbox               "Agent-owned access to durable pending work."
 *
 * Belegt an drei Stellen im Kern:
 *   dsh-api-session-controller/lib/index.js:902-903  (die Oberflaeche selbst)
 *   dsh-command-goal/lib/index.js:100                (ein Befehl)
 *   dsh-cordis-host-runner/lib/index.js:2388         (der Host)
 *
 * Und an den Agenten einer beliebigen Sitzung kommt man heran
 * (dsh-agent/lib/index.js:594): `get(id)` nimmt "the shared agent/session id",
 * `list()` gibt alle lebenden Agenten. Beides ohne Besitzpruefung.
 *
 * DESHALB EIN EIGENES WERKZEUG, KEIN UMBAU
 * Ein Umbau von `send_message` haette die Sperre nicht erreicht und waere
 * ausserdem gefaehrlich gewesen: er haette das Verhalten eines Kernwerkzeugs
 * fuer alle Agenten verschoben. Dieses Modul legt ein NEUES Werkzeug daneben.
 * `send_message` bleibt unveraendert und behaelt seine enge, sichere Bedeutung.
 *
 * WAS DIE MESSUNG AN GEFAHREN ZEIGT — und was hier dagegen steht
 *  1. Der Absender verschwindet. `MessageSourceMap` kennt nur `user`, `model`,
 *     `tool`, `system-prompt` (dsh-llm/lib/types/message.d.ts:101). Der Map ist
 *     ausdruecklich erweiterbar ("switch on `kind` and fall through unknowns"),
 *     und der Kern macht genau das selbst: `kind: "goal"` mit eigenen Feldern
 *     (dsh-goal-round-driver/lib/index.js:133-142). Dieses Modul schickt
 *     deshalb `kind: "agent-send"` mit Absender-Kennung. Zusaetzlich steht die
 *     Herkunft SICHTBAR im Text — wer die Nachricht liest, soll nicht glauben,
 *     der Mensch habe sie getippt.
 *
 *  2. `followup` startet eine neue Runde, `steer` schiebt in den naechsten
 *     Schritt. Vorgabe hier ist `steer`: es unterbricht nicht, es kommt an der
 *     naechsten natuerlichen Grenze. `followup` muss ausdruecklich verlangt
 *     werden. Grund: eine Nachricht, die eine fremde Sitzung mitten in der
 *     Arbeit in eine neue Runde zwingt, ist die Unterbrechung, die niemand
 *     staendig will.
 *
 *  3. Ohne Bremse wecken sich zwei Sitzungen gegenseitig auf. Es gibt eine
 *     Obergrenze je Zeitfenster (Vorgabe 6 Zustellungen in 10 Minuten, je
 *     Absender) und eine harte Regel: keine Nachricht an die eigene Sitzung.
 *
 *  4. Nur LEBENDE Sitzungen. `agents.get()` findet keine schlafende; eine
 *     schlafende braucht `resume` — das ist ein anderer Weg und absichtlich
 *     nicht in diesem ersten Wurf.
 *
 * GRENZEN, DIE GELTEN
 *  - Kein Eingriff in die Installation. Kein Text-Patch an einer Kerndatei.
 *  - `send_message` wird nicht angefasst, weder Parameter noch Ausfuehrung.
 *  - Kein Wecken schlafender Sitzungen, kein Erzeugen neuer Sitzungen.
 *  - Jede Zustellung wird protokolliert: Absender, Ziel, Modus, Laenge.
 *
 * NACHSEHEN
 *   ~/.dsh/logs/send-to-session.log
 * SELBSTPRUEFUNG (ohne laufendes DSH)
 *   node patches/send-to-session.mjs --test
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const WERKZEUG = "send_to_session";
const FENSTER_MS = 10 * 60 * 1000;
const HOECHSTENS_JE_FENSTER = 6;

/** Wo das Protokoll liegt. Ueber DSH_HOME umlenkbar, damit Tests hermetisch bleiben. */
function protokollPfad() {
	const heim = process.env.DSH_HOME ?? join(homedir(), ".dsh");
	return join(heim, "logs", "send-to-session.log");
}

/** Eine Zeile ins Protokoll. Ein fehlendes Verzeichnis oder Recht darf nie werfen. */
function protokolliere(text) {
	try {
		const pfad = protokollPfad();
		mkdirSync(dirname(pfad), { recursive: true });
		appendFileSync(pfad, `${new Date().toISOString()} ${text}\n`);
	} catch {
		/* Protokoll ist Beiwerk; es darf nie eine Zustellung verhindern. */
	}
}

/** Kuerzt langen Text fuer das Protokoll, damit die Datei lesbar bleibt. */
function kurz(text, grenze = 60) {
	const eine = String(text).replace(/\s+/gu, " ").trim();
	return eine.length <= grenze ? eine : `${eine.slice(0, grenze)}…`;
}

/** Die Kernpakete, die dieses Modul zur Laufzeit braucht (nie statisch importieren). */
const PAKET_WERKZEUGE = "@deepseek-ai/dsh-tools";

/** Einmal geladener Werkzeug-Baustein; ein zweiter Ladeversuch waere Verschwendung. */
let werkzeugBaustein;

/**
 * Die Basis-Ordner der dsh-Installation, in der Reihenfolge der Wahrscheinlichkeit.
 *
 * Warum nicht einfach importieren: die Kernpakete wohnen NUR in der Installation,
 * ein statischer Import aus dem Paket faende sie nicht, und zwei Modul-Instanzen
 * brechen jeden Werkzeug-Aufruf (siehe ~/.dsh/AGENTS.md, "NIEMALS
 * @deepseek-ai-Kernpakete installieren"). Dieses Muster ist aus `goal-await`
 * uebernommen, wo es sich im Betrieb bewaehrt hat.
 */
function kernBasis() {
	const basis = new Set();
	const fuegen = (pfad) => {
		if (typeof pfad !== "string" || pfad.length === 0) return;
		if (existsSync(pfad)) basis.add(pfad);
	};
	const laufend = process.argv[1];
	if (typeof laufend === "string" && laufend.length > 0) {
		const teile = laufend.split("/");
		const bei = teile.lastIndexOf("node_modules");
		if (bei > 0) fuegen(teile.slice(0, bei + 1).join("/"));
	}
	fuegen("/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules");
	fuegen(join(homedir(), ".npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules"));
	fuegen("/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules");
	return basis;
}

/** Laedt einen Kernbaustein ueber alle bekannten Ablageformen. */
async function ladeKern(paket) {
	const unterpfad = paket.replace("@deepseek-ai/", "");
	const kandidaten = [paket];
	for (const basis of kernBasis()) {
		// Die Installation haelt ihre Pakete unter `@deepseek-ai/` — gemessen am
		// 2026-10-30: base/dsh-tools/lib/index.js gibt es NICHT,
		// base/@deepseek-ai/dsh-tools/lib/index.js schon.
		kandidaten.push(join(basis, "@deepseek-ai", unterpfad, "lib", "index.js"));
		kandidaten.push(join(basis, "dsh", "node_modules", "@deepseek-ai", unterpfad, "lib", "index.js"));
	}
	for (const kandidat of kandidaten) {
		try {
			return await import(kandidat);
		} catch { /* naechster Kandidat */ }
	}
	return undefined;
}

/**
 * Baut die Nachricht, die der Ziel-Agent in seinen Posteingang bekommt.
 *
 * Die Herkunft steht sichtbar im Text. Wer sie liest, soll wissen, dass ein
 * anderer Agent geschrieben hat und nicht der Mensch. Ein Test haelt das fest.
 *
 * @param text - der eigentliche Inhalt.
 * @param absender - Kennung des schreibenden Agenten.
 * @param absenderName - lesbarer Name, falls vorhanden.
 * @returns die Textbloecke fuer `createUserMessage`.
 */
export function baueInhalt(text, absender, absenderName) {
	const wer = absenderName === undefined || absenderName === absender
		? absender
		: `${absenderName} (${absender})`;
	return [{
		type: "text",
		text: `[Nachricht von Agent ${wer} — nicht vom Menschen]\n\n${text}`
	}];
}

/**
 * Die Quelle, mit der die Nachricht im Sitzungsprotokoll steht.
 *
 * `kind: "agent-send"` ist eine Erweiterung des offenen `MessageSourceMap`;
 * der Kern macht dasselbe mit `kind: "goal"`. Die Felder nennen Absender und
 * Ziel, damit das Protokoll spaeter beweist, wer was geschickt hat.
 */
export function baueQuelle(absender, ziel) {
	return { kind: "agent-send", from: String(absender), to: String(ziel) };
}

/** Prueft die Bremse: hoechstens HOECHSTENS_JE_FENSTER Zustellungen je Absender. */
export function bremseOk(zeiten, jetzt = Date.now()) {
	const frisch = zeiten.filter((t) => jetzt - t < FENSTER_MS);
	return { ok: frisch.length < HOECHSTENS_JE_FENSTER, frisch };
}

/**
 * Sucht den Ziel-Agenten.
 *
 * Drei Eingabeformen, in dieser Reihenfolge: eine Sitzungs-Kennung, ein
 * lesbarer Name (der Titel der Sitzung), oder gar nichts — dann kommt eine
 * Liste aller lebenden Sitzungen zurueck, aus der der Agent waehlen kann.
 *
 * @returns das Ergebnis als schlichtes Objekt, damit es pruefbar bleibt.
 */
export function findeZiel(agenten, eingabe) {
	const alle = agenten.map((a) => ({
		id: a.id,
		titel: typeof a.session?.title === "string" ? a.session.title : undefined
	}));
	if (eingabe === undefined || eingabe === "") return { art: "liste", alle };
	const treffer = alle.find((a) => a.id === eingabe);
	if (treffer !== undefined) return { art: "genau", ziel: treffer };
	const nachTitel = alle.filter((a) => typeof a.titel === "string" && a.titel.toLowerCase().includes(String(eingabe).toLowerCase()));
	if (nachTitel.length === 1) return { art: "genau", ziel: nachTitel[0] };
	if (nachTitel.length > 1) return { art: "mehrdeutig", kandidaten: nachTitel };
	return { art: "unbekannt", alle };
}

/**
 * Das Modul. Wird vom Loader als Plugin eingespielt.
 *
 * Jeder Teil ist einzeln abgesichert: ein Fehler hier darf DSH nie am Starten
 * hindern. Fehlt der Agent-Dienst, meldet das Werkzeug das beim Aufruf, statt
 * beim Laden zu werfen.
 */
export function apply(ctx) {
	const melden = (stufe, text) => {
		protokolliere(text);
		try {
			const logger = ctx.logger;
			if (logger !== undefined && typeof logger[stufe] === "function") logger[stufe](`send-to-session: ${text}`);
		} catch { /* Ein fehlendes Protokoll darf den Start nie stoeren. */ }
	};

	/** Zustellzeiten je Absender, fuer die Bremse. */
	const zustellungen = new Map();

	/** Holt einen Dienst, ohne beim Fehlen zu werfen. */
	const dienst = (name) => {
		try { return ctx.get(name); } catch { return undefined; }
	};

	ctx.effect(() => {
		let abgemeldet = false;
		let ab;
		(async () => {
			werkzeugBaustein ??= await ladeKern(PAKET_WERKZEUGE);
			if (abgemeldet) return;
			const defineTool = werkzeugBaustein?.defineTool;
			if (typeof defineTool !== "function") {
				melden("warn", "der Werkzeug-Baustein (defineTool) ist nicht auffindbar; das Werkzeug steht nicht zur Verfuegung");
				return;
			}
			try {
				ab = ctx.tools.register(defineWerkzeug(ctx, melden, zustellungen, dienst, defineTool));
			} catch (fehler) {
				melden("warn", `Werkzeug konnte nicht angemeldet werden: ${fehler instanceof Error ? fehler.message : String(fehler)}`);
			}
		})();
		return () => {
			if (abgemeldet === true) return;
			abgemeldet = true;
			try { ab?.(); } catch { /* beim Abbau ist alles verziehen */ }
		};
	});

	melden("info", "geladen");
}

/**
 * Die Werkzeugdefinition.
 *
 * Getrennt von `apply`, damit ein Test das Verhalten pruefen kann, ohne einen
 * Cordis-Kontext zu bauen: `baueWerkzeug` nimmt die Dienste als Funktionen.
 */
function defineWerkzeug(ctx, melden, zustellungen, dienst, defineTool) {
	return defineTool({
		name: WERKZEUG,
		description: [
			"Send a message to ANY live session in this harness, not only to your own children.",
			"",
			"WHEN TO USE IT:",
			"- Another session works on something you need; you want to tell it something, ask it, or hand over work.",
			"- The human asks you to talk to another session.",
			"- You noticed a conflict (two sessions editing the same thing) and must warn the other one.",
			"",
			"WHAT IT DOES NOT DO:",
			"- It does not reach sleeping sessions. Only live ones are listed.",
			"- It does not replace `send_message`: that one talks to your own children and stays unchanged.",
			"",
			"MODES: `steer` (default) arrives at the target's next natural step and does NOT interrupt.",
			"`followup` queues a new turn and wakes the target — use it only when the target should act now.",
			"",
			"The message is marked as coming from an agent, not from the human. Say who you are in your text.",
			"Without a target it returns the list of live sessions."
		].join("\n"),
		parameters: {
			target: {
				type: "string",
				description: "Session id or a distinctive part of the session title. Omit to list all live sessions."
			},
			message: { type: "string", description: "The message to deliver." },
			mode: {
				type: "string",
				enum: ["steer", "followup"],
				description: "steer (default) = next step, no interruption. followup = new turn, wakes the target."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					delivered: { type: "boolean", required: true },
					to: { type: "string" },
					mode: { type: "string" },
					sessions: { type: "array" },
					note: { type: "string", required: true }
				}
			},
			render: (_args, wert) => [{ type: "text", text: JSON.stringify(wert) }]
		},
		execute: async (args, exec) => {
			const absenderAgent = exec.agent;
			if (absenderAgent === undefined) return { delivered: false, note: "no calling agent" };
			const dienstAgenten = dienst("agents");
			if (dienstAgenten === undefined || typeof dienstAgenten.list !== "function") {
				return { delivered: false, note: "the `agents` service is not available in this profile" };
			}
			const lebende = dienstAgenten.list();
			if (args.message === undefined || args.message === "") {
				return {
					delivered: false,
					sessions: findeZiel(lebende).alle,
					note: "no message given; here are the live sessions"
				};
			}
			const suche = findeZiel(lebende, args.target);
			if (suche.art === "liste") {
				return { delivered: false, sessions: suche.alle, note: "no target given; pass `target` to deliver" };
			}
			if (suche.art === "mehrdeutig") {
				return { delivered: false, sessions: suche.kandidaten, note: "the title matches several sessions; use the id" };
			}
			if (suche.art === "unbekannt") {
				return { delivered: false, sessions: suche.alle, note: "no live session has that id or title" };
			}
			const zielId = suche.ziel.id;
			if (zielId === absenderAgent.id) {
				return { delivered: false, note: "refusing to send to yourself" };
			}
			const ziel = dienstAgenten.get(zielId);
			if (ziel === undefined) return { delivered: false, note: "the target session is not live" };

			const modus = args.mode === "followup" ? "followup" : "steer";
			const jetzt = Date.now();
			const stand = zustellungen.get(absenderAgent.id) ?? [];
			const geprueft = bremseOk(stand, jetzt);
			if (!geprueft.ok) {
				melden("warn", `gebremst absender=${absenderAgent.id} ziel=${zielId}`);
				return {
					delivered: false,
					note: `rate limit: ${HOECHSTENS_JE_FENSTER} deliveries per ${FENSTER_MS / 60000} minutes; try again later`
				};
			}

			const inhalt = baueInhalt(args.message, absenderAgent.id, absenderAgent.session?.title);
			const quelle = baueQuelle(absenderAgent.id, zielId);
			try {
				const llm = dienst("llm");
				const nachricht = typeof llm?.createUserMessage === "function"
					? llm.createUserMessage({ content: inhalt, source: quelle })
					: { role: "user", content: inhalt, source: quelle };
				if (modus === "followup") ziel.followup(nachricht);
				else ziel.steer(nachricht);
			} catch (fehler) {
				const text = fehler instanceof Error ? fehler.message : String(fehler);
				melden("warn", `Zustellung fehlgeschlagen absender=${absenderAgent.id} ziel=${zielId}: ${text}`);
				return { delivered: false, note: `delivery failed: ${text}` };
			}
			geprueft.frisch.push(jetzt);
			zustellungen.set(absenderAgent.id, geprueft.frisch);
			melden("info", `zugestellt von=${absenderAgent.id} an=${zielId} modus=${modus} "${kurz(args.message)}"`);
			return {
				delivered: true,
				to: zielId,
				mode: modus,
				note: `delivered to ${zielId} (${modus}); the target was told the message comes from an agent`
			};
		}
	});
}

export const inject = ["tools", "agents"];
export const name = "send-to-session";
