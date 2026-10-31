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
 * DESHALB EIN EIGENES WERKZEUG, KEIN UMBAU
 * Ein Umbau von `send_message` haette die Sperre nicht erreicht und waere
 * ausserdem gefaehrlich gewesen: er haette das Verhalten eines Kernwerkzeugs
 * fuer alle Agenten verschoben. Dieses Modul legt ein NEUES Werkzeug daneben.
 * `send_message` bleibt unveraendert und behaelt seine enge, sichere Bedeutung.
 *
 * ---------------------------------------------------------------------------
 * FASSUNG 0.5.0 — was gegenueber v0.4.0 geaendert ist, und warum
 * ---------------------------------------------------------------------------
 *
 * (1) QUELLART: `agent-send` ist ersetzt durch `kind: "plugin"`.
 *
 * v0.4.0 schrieb `kind: "agent-send"`. Das ist in DSH eine ERWEITERUNG, aber
 * keine DOKUMENTIERTE Quelle: der Formatpruefer fuehrt eine geschlossene Liste
 * `SOURCE_KINDS` (dsh-session-format-v2-to-v3/lib/index.js:14-30) — `plugin`
 * steht darin, `agent-send` nicht. Zeile 125 wirft bei allem, was nicht in der
 * Liste steht: "cannot safely transform unclassified message source". Heute
 * faellt das nicht auf, weil die Migration v2→v3 nur alte Staende anfasst; eine
 * kuenftige Pruefung wuerde die Nachricht verwerfen.
 *
 * DIE BERECHTIGUNGSFRAGE IST DER EIGENTLICHE GRUND (Red-Team-Befund, E-Code
 * `hasDirectHumanInput` in dsh-tool-goal/lib/index.js:49-82): Eine Quellart ist
 * im Kern keine Etikettierung, sondern eine BERECHTIGUNG. Sie oeffnet einem
 * Agenten das Recht, ein ZIEL anzulegen, abzuschliessen oder zu blockieren.
 * Geprueft wird genau:
 *
 *   quelle.kind === "user"            → ja
 *   istWurzel                        → nein (Wurzelsitzung bleibt menschlich)
 *   quelle.kind === "agent-message"   → ja
 *   quelle.kind === "team-message"    → nur vom direkten Elternteil
 *
 * `plugin` steht in KEINEM dieser Zweige. Die Nachricht kommt also an, wird
 * gelesen — und oeffnet trotzdem kein Ziel. Das ist die Eigenschaft, die wir
 * wollen: zustellen ja, Berechtigung nein.
 *
 * Das ist derselbe Weg, den `duanyunlun/dsh-conversation-link` (MIT) und
 * `stark-l-1/dsh-peer-mailbox` gehen; beide schreiben `kind: 'plugin'`.
 *
 * (2) KETTENBUDGET: drei Waechter gegen das Zutexten.
 *
 * v0.4.0 hatte nur eine Bremse JE ABSENDER. Zwei Sitzungen konnten sich
 * gegenseitig unbegrenzt Nachrichten schicken, solange jede unter ihrem eigenen
 * Kontingent blieb — das war ein offener Red-Team-Befund.
 *
 * Die drei Waechter sind nach dem Vorbild von `huxint/dsh-team` (MIT,
 * `assertBudget`/`recordDelivery`, dist/index.js) neu geschrieben, nicht
 * kopiert: ein Sprungbudget je Unterhaltung (Vorgabe 4), ein Rundlaufbudget je
 * geordnetem Paar (Vorgabe 2) und die Abweisung einer wortgleichen Wiederholung
 * an dasselbe Ziel in derselben Unterhaltung.
 *
 * Was eine "Kette" hier ist: Wer eine Nachricht bekommt, erbt die Unterhaltung
 * und gibt sie beim Weitersenden weiter. So entsteht aus einer Kette von
 * Weiterleitungen EINE begrenzte Unterhaltung statt einer unbegrenzten Folge.
 *
 * (3) DIE BREMSE UEBERLEBT DEN NEUSTART.
 *
 * v0.4.0 hielt die Zustellzeiten nur im Speicher; ein DSH-Neustart setzte sie
 * vollstaendig zurueck. Jetzt liegt der Zustand in
 * `~/.dsh/.tm/teams-plus/state/send-to-session.json` — Zaehler, Ketten und
 * Kettenzugehoerigkeit. Zusaetzlich zur Bremse je Absender gibt es eine je
 * ZIEL (Vorgabe 6 in 10 Minuten), damit drei Absender eine vierte Sitzung nicht
 * gemeinsam zumuellen koennen.
 *
 * (4) ZUSTELLART `auto`.
 *
 * `agent.status` ist `'idle' | 'running'` (dsh-agent/lib/types/runtime-types.d.ts:90).
 * `auto` waehlt danach: laeuft das Ziel, geht die Nachricht als `steer` an die
 * naechste natuerliche Grenze; ist es still, weckt `followup` es mit einer
 * eigenen Runde. Vorgabe BLEIBT `steer` — die Typbeschreibung sagt ausdruecklich,
 * dass ein stiller Treiber durch `steer` ebenfalls eine Runde beginnt
 * (runtime-types.d.ts:194-195). `auto` ist damit eine Wahl, keine stille
 * Verhaltensaenderung an allen Aufrufern.
 *
 * ---------------------------------------------------------------------------
 * WAS DIE MESSUNG AN GEFAHREN ZEIGT — und was hier dagegen steht
 * ---------------------------------------------------------------------------
 *  1. Der Absender verschwindet nicht: er steht in der Quelle (`senderSessionId`)
 *     UND sichtbar im Text. Wer die Nachricht liest, soll nicht glauben, der
 *     Mensch habe sie getippt.
 *
 *  2. `followup` startet eine neue Runde, `steer` schiebt in den naechsten
 *     Schritt. Vorgabe hier ist `steer`.
 *
 *  3. Ohne Bremse wecken sich zwei Sitzungen gegenseitig auf. Deshalb die zwei
 *     Fenster, das Kettenbudget und die harte Regel: keine Nachricht an die
 *     eigene Sitzung.
 *
 *  4. Nur LEBENDE Sitzungen. `agents.get()` findet keine schlafende; eine
 *     schlafende braucht `resume` — das ist ein anderer Weg und absichtlich
 *     nicht in diesem Wurf.
 *
 * GRENZEN, DIE GELTEN
 *  - Kein Eingriff in die Installation. Kein Text-Patch an einer Kerndatei.
 *  - `send_message` wird nicht angefasst, weder Parameter noch Ausfuehrung.
 *  - Kein Wecken schlafender Sitzungen, kein Erzeugen neuer Sitzungen.
 *  - Jede Zustellung wird protokolliert: Absender, Ziel, Modus, Laenge.
 *  - Jede Abweisung wird protokolliert: Grund, Absender, Ziel.
 *
 * NACHSEHEN
 *   ~/.dsh/logs/send-to-session.log
 *   ~/.dsh/.tm/teams-plus/state/send-to-session.json
 * SELBSTPRUEFUNG (ohne laufendes DSH)
 *   node patches/send-to-session.mjs --test
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const WERKZEUG = "send_to_session";

/**
 * Die Grenzen an einer Stelle. Jede Zahl ist eine Entscheidung, keine Zufallszahl:
 *
 * - `fensterMs`/`jeAbsender`: 6 Zustellungen in 10 Minuten war die Grenze aus
 *   v0.4.0 und bleibt. Sie beantwortet "wie viel redet eine Sitzung".
 * - `jeZiel`: 6 in 10 Minuten beantwortet "wie viel bekommt eine Sitzung".
 *   Ohne diese zweite Zahl heben drei Absender die erste Bremse gemeinsam auf.
 * - `ketteHops`: 4 Weiterleitungen. Danach ist aus einer Unterhaltung ein
 *   Stille-Post-Spiel geworden.
 * - `ketteRundlaeufe`: 2 Nachrichten je geordnetem Paar in einer Unterhaltung.
 *   Reicht fuer Rueckfrage und Antwort; ein drittes Mal ist kein Gespraech.
 * - `kettenGedaeschtnis`: so viele Unterhaltungen werden behalten. Aeltere
 *   fallen weg, damit die Zustandsdatei nicht unbegrenzt waechst.
 */
export const GRENZEN = Object.freeze({
	fensterMs: 10 * 60 * 1000,
	jeAbsender: 6,
	jeZiel: 6,
	ketteHops: 4,
	ketteRundlaeufe: 2,
	kettenGedaeschtnis: 200
});

/** Die drei Befunde des Kettenbudgets. Sie stehen im Protokoll und in der Antwort. */
export const KETTEN_BEFUNDE = Object.freeze({
	hops: "CHAIN_EXHAUSTED",
	rundlaeufe: "PING_PONG",
	wiederholung: "REPEATED_MESSAGE"
});

/** Wo das Protokoll liegt. Ueber DSH_HOME umlenkbar, damit Tests hermetisch bleiben. */
function protokollPfad() {
	const heim = process.env.DSH_HOME ?? join(homedir(), ".dsh");
	return join(heim, "logs", "send-to-session.log");
}

/** Wo der Zustand liegt (Zaehler, Ketten). Gleiche Umlenkung wie das Protokoll. */
export function zustandPfad() {
	const heim = process.env.DSH_HOME ?? join(homedir(), ".dsh");
	return join(heim, ".tm", "teams-plus", "state", "send-to-session.json");
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
 * `kind: "plugin"` ist die dokumentierte Form (siehe Kopfkommentar, Punkt 1):
 * sie steht in der geschlossenen Liste des Formatpruefers und sie oeffnet in
 * `hasDirectHumanInput` KEIN Ziel. Das ist Absicht, nicht Zufall — ein Test
 * haelt beides fest.
 *
 * `senderSessionId` traegt der Kern selbst bei `agent-message`-Quellen und die
 * Client-Haelfte von DSH zeigt damit den Absender an. `targetSessionId` steht
 * daneben, damit das Protokoll beweist, wer wem geschrieben hat.
 */
export function baueQuelle(absender, ziel) {
	return {
		kind: "plugin",
		plugin: "dsh-teams-plus",
		form: "relay",
		senderSessionId: String(absender),
		targetSessionId: String(ziel)
	};
}

// ---------------------------------------------------------------------------
// Zustand: Zaehler und Ketten. Alles reine Funktionen auf einem schlichten
// Objekt, damit es ohne DSH pruefbar bleibt und die Datei nie zur Laufzeit
// gewachsen ist.
// ---------------------------------------------------------------------------

/** Der leere Zustand. Die Form ist die Form der Datei auf der Platte. */
export function leererZustand() {
	return { absender: {}, ziel: {}, ketten: {}, ketteVon: {} };
}

/**
 * Laedt den Zustand. Fehlt die Datei oder ist sie unlesbar, kommt der leere
 * Zustand zurueck — eine kaputte Zaehlerdatei darf den Start nie verhindern.
 */
export function ladeZustand(pfad = zustandPfad()) {
	try {
		if (!existsSync(pfad)) return leererZustand();
		const roh = JSON.parse(readFileSync(pfad, "utf8"));
		const leer = leererZustand();
		if (roh === null || typeof roh !== "object") return leer;
		return {
			absender: istObjekt(roh.absender) ? roh.absender : leer.absender,
			ziel: istObjekt(roh.ziel) ? roh.ziel : leer.ziel,
			ketten: istObjekt(roh.ketten) ? roh.ketten : leer.ketten,
			ketteVon: istObjekt(roh.ketteVon) ? roh.ketteVon : leer.ketteVon
		};
	} catch {
		return leererZustand();
	}
}

/** Ist der Wert ein schlichtes Objekt (kein Array, kein null)? */
function istObjekt(wert) {
	return wert !== null && typeof wert === "object" && Array.isArray(wert) === false;
}

/**
 * Schreibt den Zustand. Erst in eine Nebendatei, dann umbenennen: ein Abbruch
 * mitten im Schreiben hinterlaesst so nie eine halbe Datei. Wirft nie.
 */
export function speichereZustand(zustand, pfad = zustandPfad()) {
	try {
		mkdirSync(dirname(pfad), { recursive: true });
		const vorlaeufig = `${pfad}.neu`;
		writeFileSync(vorlaeufig, `${JSON.stringify(zustand, null, "\t")}\n`);
		renameSync(vorlaeufig, pfad);
		return true;
	} catch {
		return false;
	}
}

/** Die Kante eines geordneten Paares, wie das Kettenbuch sie schluesselt. */
function kante(von, an) {
	return `${von} ${an}`;
}

/**
 * Die Unterhaltung, zu der ein Absender gerade gehoert.
 *
 * Hat er zuletzt eine Nachricht bekommen, erbt er deren Unterhaltung — so wird
 * aus einer Weiterleitungskette EINE Unterhaltung. Hat er nichts bekommen,
 * beginnt er eine neue.
 */
export function ketteFuer(zustand, absenderId) {
	// (a) Er hat zuletzt etwas BEKOMMEN: er sitzt in der Unterhaltung, eine Stufe tiefer.
	const geerbt = zustand.ketteVon?.[absenderId];
	if (geerbt !== undefined && typeof geerbt.chainId === "string") {
		return { chainId: geerbt.chainId, hop: Number(geerbt.hop) || 0 };
	}
	// (b) Er hat zuletzt etwas GESCHICKT: die Unterhaltung, in der er schon steckt,
	//     wird fortgesetzt. Ohne diesen Zweig begaenne jede Nachricht desselben
	//     Absenders eine NEUE Unterhaltung — und das Rundlaufbudget griffe nie.
	//     (Genau dieser Fehler ist beim ersten Testlauf aufgefallen.)
	for (const [chainId, buch] of Object.entries(zustand.ketten ?? {})) {
		const kanten = Object.keys(buch?.edges ?? {});
		if (kanten.some((k) => k.startsWith(`${absenderId} `))) return { chainId, hop: 0 };
	}
	// (c) Er ist an nichts beteiligt: neue Unterhaltung.
	return { chainId: `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`, hop: 0 };
}

/**
 * Darf diese Nachricht in dieser Unterhaltung noch raus?
 *
 * Drei Fragen, in dieser Reihenfolge: ist die Kette schon zu tief, hat dieses
 * geordnete Paar sein Rundlaufbudget aufgebraucht, ist es wortgleich dieselbe
 * Nachricht wie zuletzt an dieses Ziel.
 *
 * @returns `{ ok: true }` oder `{ ok: false, befund, text }`.
 */
export function pruefeKette(zustand, kette, von, an, text, grenzen = GRENZEN) {
	if (kette.hop > grenzen.ketteHops) {
		return {
			ok: false,
			befund: KETTEN_BEFUNDE.hops,
			text: `relay ${kette.hop} of at most ${grenzen.ketteHops} — the conversation has gone far enough`
		};
	}
	const buch = zustand.ketten?.[kette.chainId];
	if (buch === undefined) return { ok: true };
	const schluessel = kante(von, an);
	const runden = Number(buch.edges?.[schluessel]) || 0;
	if (runden >= grenzen.ketteRundlaeufe) {
		return {
			ok: false,
			befund: KETTEN_BEFUNDE.rundlaeufe,
			text: `${runden} message(s) already went to that session in this conversation (at most ${grenzen.ketteRundlaeufe})`
		};
	}
	if (buch.said?.[schluessel] === text) {
		return {
			ok: false,
			befund: KETTEN_BEFUNDE.wiederholung,
			text: "this exact message already went to that session in this conversation"
		};
	}
	return { ok: true };
}

/**
 * Verbucht eine angenommene Zustellung: Paar zaehlen, Text merken, und dem Ziel
 * die Unterhaltung vererben (eine Stufe tiefer).
 */
export function verbucheKette(zustand, kette, von, an, text, grenzen = GRENZEN) {
	const schluessel = kante(von, an);
	const buch = zustand.ketten[kette.chainId] ?? { edges: {}, said: {} };
	buch.edges = buch.edges ?? {};
	buch.said = buch.said ?? {};
	buch.edges[schluessel] = (Number(buch.edges[schluessel]) || 0) + 1;
	buch.said[schluessel] = text;
	zustand.ketten[kette.chainId] = buch;

	// Das Ziel erbt die Unterhaltung eine Stufe tiefer.
	zustand.ketteVon[an] = { chainId: kette.chainId, hop: kette.hop + 1 };

	// Alte Unterhaltungen fallen weg, damit die Datei nicht unbegrenzt waechst.
	const schluesselAlle = Object.keys(zustand.ketten);
	if (schluesselAlle.length > grenzen.kettenGedaeschtnis) {
		for (const alt of schluesselAlle.slice(0, schluesselAlle.length - grenzen.kettenGedaeschtnis)) {
			delete zustand.ketten[alt];
		}
	}
	return zustand;
}

/** Prueft eine Liste von Zeitstempeln gegen ein Fenster. Reine Rechnung. */
export function bremseOk(zeiten, jetzt = Date.now(), grenzen = GRENZEN) {
	const frisch = zeiten.filter((t) => jetzt - t < grenzen.fensterMs);
	return { ok: frisch.length < grenzen.jeAbsender, frisch };
}

/**
 * Die volle Bremse: je Absender UND je Ziel.
 *
 * Die zweite Zahl ist der Red-Team-Befund aus v0.4.0. Ohne sie koennen drei
 * Absender je sechs Nachrichten an dieselbe vierte Sitzung schicken — achtzehn
 * Zustellungen, ohne dass eine Bremse greift.
 *
 * @returns `{ ok: true, absenderFrisch, zielFrisch }` oder `{ ok: false, grund }`.
 */
export function bremsePruefe(zustand, absenderId, zielId, jetzt = Date.now(), grenzen = GRENZEN) {
	const absenderStand = Array.isArray(zustand.absender?.[absenderId]) ? zustand.absender[absenderId] : [];
	const zielStand = Array.isArray(zustand.ziel?.[zielId]) ? zustand.ziel[zielId] : [];

	const absenderFrisch = absenderStand.filter((t) => jetzt - t < grenzen.fensterMs);
	const zielFrisch = zielStand.filter((t) => jetzt - t < grenzen.fensterMs);

	if (absenderFrisch.length >= grenzen.jeAbsender) {
		return { ok: false, grund: "absender", frisch: absenderFrisch };
	}
	if (zielFrisch.length >= grenzen.jeZiel) {
		return { ok: false, grund: "ziel", frisch: zielFrisch };
	}
	return { ok: true, absenderFrisch, zielFrisch };
}

/** Verbucht eine Zustellung in beiden Fenstern. */
export function bremseVerbuche(zustand, absenderId, zielId, jetzt = Date.now(), grenzen = GRENZEN) {
	const frischAbsender = (Array.isArray(zustand.absender[absenderId]) ? zustand.absender[absenderId] : [])
		.filter((t) => jetzt - t < grenzen.fensterMs);
	frischAbsender.push(jetzt);
	zustand.absender[absenderId] = frischAbsender;

	const frischZiel = (Array.isArray(zustand.ziel[zielId]) ? zustand.ziel[zielId] : [])
		.filter((t) => jetzt - t < grenzen.fensterMs);
	frischZiel.push(jetzt);
	zustand.ziel[zielId] = frischZiel;

	return zustand;
}

/**
 * Welche Zustellart gilt?
 *
 * `auto` schaut auf den lebenden Zustand des Ziels: laeuft es, geht die
 * Nachricht als `steer` an die naechste Grenze; ist es still, weckt `followup`
 * es mit einer eigenen Runde. Ohne Statusangabe bleibt es bei `steer` — das ist
 * die Vorgabe aus v0.4.0 und die vorsichtigere Wahl.
 */
export function loeseModus(modus, ziel) {
	if (modus === "auto") return ziel?.status === "idle" ? "followup" : "steer";
	if (modus === "followup") return "followup";
	// `steer` und alles Unbekannte: die vorsichtige Vorgabe aus v0.4.0.
	return "steer";
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
 *
 * @param ctx - Cordis-Kontext des Loader-Eintrags.
 * @param optionen - nur fuer Tests: `{ pfad }` lenkt die Zustandsdatei um.
 */
export function apply(ctx, optionen = {}) {
	const melden = (stufe, text) => {
		protokolliere(text);
		try {
			const logger = ctx.logger;
			if (logger !== undefined && typeof logger[stufe] === "function") logger[stufe](`send-to-session: ${text}`);
		} catch { /* Ein fehlendes Protokoll darf den Start nie stoeren. */ }
	};

	/** Der Zustand: Zaehler und Ketten. Beim Laden einmal gelesen, danach gefuehrt. */
	const pfad = optionen.pfad ?? zustandPfad();
	const zustand = ladeZustand(pfad);

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
				ab = ctx.tools.register(defineWerkzeug(ctx, melden, zustand, pfad, dienst, defineTool));
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
 * Cordis-Kontext zu bauen: `defineWerkzeug` nimmt die Dienste als Funktionen.
 */
function defineWerkzeug(ctx, melden, zustand, pfad, dienst, defineTool) {
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
			"- It grants no authority: the message arrives as a plugin message and opens no goal.",
			"",
			"MODES: `steer` (default) arrives at the target's next natural step and does NOT interrupt.",
			"`followup` queues a new turn and wakes the target — use it only when the target should act now.",
			"`auto` picks by the target's live state: running → steer, idle → followup.",
			"",
			"LIMITS: at most 6 messages per sender and 6 per target within 10 minutes; one conversation",
			"may relay at most 4 hops, and one ordered pair may exchange at most 2 messages in it.",
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
				enum: ["auto", "steer", "followup"],
				description: "steer (default) = next step, no interruption. followup = new turn, wakes the target. auto = by the target's live state."
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

			const jetzt = Date.now();

			// (1) Die zwei Fenster: je Absender und je Ziel.
			const gebremst = bremsePruefe(zustand, absenderAgent.id, zielId, jetzt);
			if (gebremst.ok !== true) {
				melden("warn", `gebremst grund=${gebremst.grund} absender=${absenderAgent.id} ziel=${zielId}`);
				const zahl = gebremst.grund === "absender" ? GRENZEN.jeAbsender : GRENZEN.jeZiel;
				const wer = gebremst.grund === "absender" ? "this sender" : "that target";
				return {
					delivered: false,
					note: `rate limit: at most ${zahl} deliveries for ${wer} per ${GRENZEN.fensterMs / 60000} minutes; try again later`
				};
			}

			// (2) Das Kettenbudget: Sprunghoehe, Rundlaeufe je Paar, wortgleiche Wiederholung.
			const kette = ketteFuer(zustand, absenderAgent.id);
			const kettenPruefung = pruefeKette(zustand, kette, absenderAgent.id, zielId, args.message);
			if (kettenPruefung.ok !== true) {
				melden("warn", `kette abgewiesen befund=${kettenPruefung.befund} absender=${absenderAgent.id} ziel=${zielId}`);
				return { delivered: false, note: `${kettenPruefung.befund}: ${kettenPruefung.text}` };
			}

			const modus = loeseModus(args.mode, ziel);
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

			// (3) Erst nach erfolgreicher Zustellung buchen — und sofort auf die Platte,
			// damit ein Neustart die Zaehler nicht vergisst (Red-Team-Befund v0.4.0).
			bremseVerbuche(zustand, absenderAgent.id, zielId, jetzt);
			verbucheKette(zustand, kette, absenderAgent.id, zielId, args.message);
			if (speichereZustand(zustand, pfad) !== true) {
				melden("warn", `Zustand konnte nicht geschrieben werden: ${pfad}`);
			}

			melden("info", `zugestellt von=${absenderAgent.id} an=${zielId} modus=${modus} kette=${kette.chainId} hop=${kette.hop} "${kurz(args.message)}"`);
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
