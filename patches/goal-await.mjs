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
 * die Zutat an — eine Nachricht im Posteingang, ein fertiger Hintergrundjob —,
 * wird das Ziel wieder scharf geschaltet, und der Rundentreiber schiebt die
 * nächste Runde nach. Der Agent muss nichts tun, sich an nichts erinnern und
 * keine Schleife fahren.
 *
 * WAS ALS "ZUTAT ANGEKOMMEN" GILT
 *   1. `agent/inbox/inserted` für diesen Agenten — jede Nachricht, ausdrücklich
 *      NICHT die Zielrunde selbst (`source.kind === "goal"` wird übersprungen,
 *      sonst weckt sich das Modul gegenseitig auf).
 *   2. Ein Hintergrundjob dieses Agenten wechselt auf fertig, wenn der Dienst
 *      `jobs` eine Abfrage dafür anbietet (`angekommen` prüft das defensiv).
 *   3. Ablauf der Frist (`max_wait_seconds`, Vorgabe 900 s = 15 min). Dann wird
 *      ebenfalls wieder scharf geschaltet, mit einem Hinweis im Protokoll: ein
 *      vergessener Wartezustand darf ein Ziel nie dauerhaft stilllegen.
 *
 * WARUM DIE FRIST WICHTIG IST
 * Ein Agent, der auf etwas wartet, das nie kommt, wäre sonst für immer still.
 * Der Mensch sagte dazu: "manchmal vergessen die das dann". Die Frist kehrt die
 * Wirkung um: im schlechtesten Fall arbeitet das Ziel weiter wie vorher, im
 * guten Fall wartet es ohne Kontingentverbrauch.
 *
 * SELBSTPRÜFUNG
 *   node ~/.dsh/patches/goal-await.mjs --test
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
 * Ob eine Nachricht als "die Zutat ist da" zählt.
 *
 * Die Zielrunde selbst zählt NICHT: sie wird vom Rundentreiber eingefügt, und
 * ein Wecken darauf wäre eine Schleife. Alles andere (Mensch, Elternteil,
 * Geschwister, Unteragent, Systemhinweis) zählt.
 *
 * @param nachricht - die eingefügte Nachricht.
 * @returns true, wenn sie den Wartezustand beenden soll.
 */
export function istZutat(nachricht) {
	const quelle = nachricht?.source;
	if (quelle === undefined || quelle === null) return true;
	if (quelle.kind === "goal") return false;
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

	/** Alle laufenden Wartezustände dieses Moduls (für Prüfung und Antwort). */
	function offene() {
		return [...zustaende.entries()].map(([agent, zustand]) => ({
			agent: agent.id,
			zielId: zustand.zielId,
			bedingung: zustand.bedingung,
			restSekunden: Math.max(0, Math.round((zustand.bis - Date.now()) / 1000))
		}));
	}

	const definition = (defineTool) => defineTool({
		name: WERKZEUG,
		description: "Declare that your goal cannot progress until something outside this session arrives, and let the goal wait for it WITHOUT spending continuation rounds. Use it the moment you notice you are blocked on a dependency: a message you asked another session for, a background job you started, a file or measurement someone else must produce. The goal is disarmed immediately; as soon as a message arrives for this session (or the wait expires) it is re-armed automatically and the next goal round continues the work. Do NOT use it to end your turn early or to avoid work you could do now: everything you can do in this turn must be done first. Do NOT use it while a human is available and waiting for an answer — just answer. One wait at a time: a second call replaces the first.",
		parameters: {
			waiting_for: {
				type: "string",
				required: true,
				description: "One sentence, in plain words, naming what you are waiting for and from whom — for example 'the P8 measurement numbers from strata-hda-experte'. It is shown to the human and written to the log, so name the thing, not the tool."
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
			const frist = fristMs(args.max_wait_seconds === undefined ? fristVorgabe : args.max_wait_seconds);
			// Ein laufender Wartezustand wird ersetzt, nicht gestapelt.
			if (zustaende.has(agent)) beendeWarten(agent, "ersetzt");
			ctx.goals.disarm(agent);
			const zustand = zustandFuer(agent);
			zustand.zielId = ziel.id;
			zustand.revision = ziel.revision;
			zustand.bedingung = bedingung;
			zustand.seit = Date.now();
			zustand.bis = zustand.seit + frist;
			zustand.uhr = setTimeout(() => {
				wecke(agent, "frist");
			}, frist);
			if (typeof zustand.uhr?.unref === "function") zustand.uhr.unref();
			protokoll(`warten agent=${agent.id} ziel=${ziel.id} frist=${Math.round(frist / 1000)}s bedingung="${bedingung}"`);
			return {
				waiting: true,
				goal: ziel.objective,
				wakes_on: "message",
				max_wait_seconds: Math.round(frist / 1000),
				note: `The goal is waiting for: ${bedingung}. It continues by itself as soon as a message arrives here, at the latest in ${Math.round(frist / 1000)} seconds. Tell the human in one sentence what you are waiting for and end your turn.`
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

		// 1. Die Zutat kommt an: jede Nachricht, außer der Zielrunde selbst.
		const abInbox = ctx.on("agent/inbox/inserted", ({ agent, message }) => {
			if (!istZutat(message)) return;
			wecke(agent, "nachricht");
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
				`Wenn ein Ziel auf eine fremde Zutat wartet (Nachricht einer anderen Sitzung, Hintergrundjob, Messung eines anderen), rufe \`${WERKZEUG}\` auf, statt deinen Zug nur zu beenden. Das Ziel wird dann entwaffnet und verbraucht keine Runden; die nächste eingehende Nachricht schaltet es von selbst wieder scharf. Alles, was du in diesem Zug noch selbst tun kannst, tust du vorher — das Werkzeug ist kein Freifahrtschein zum Abgeben.`
			].join("\n")
		});

		return () => {
			abgemeldet = true;
			if (typeof abRegister === "function") abRegister();
			if (typeof abDienst === "function") abDienst();
			abInbox?.();
			abWeg?.();
			abAbschnitt?.();
			for (const zustand of zustaende.values()) {
				if (zustand.uhr !== undefined) clearTimeout(zustand.uhr);
			}
			zustaende.clear();
		};
	}, "goal-await lifecycle");
}
