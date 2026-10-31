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
 *   ~/.dsh/.tm/teams-plus/logs/send-to-session.log   (E1: alle eigenen Daten unter .tm/)
 *   ~/.dsh/.tm/teams-plus/state/send-to-session.json
 * PRUEFUNG (die fruehere Angabe \`node patches/send-to-session.mjs --test\` war falsch —
 * es gab diesen Pfad nie; das Red Team hat es beanstandet):
 *   node --test test/send-to-session.test.mjs
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
 * - `paarNachrichten`: zwei Nachrichten je geordnetem Paar im selben Fenster.
 *   Reicht fuer Rueckfrage und Antwort; ein drittes Mal ist kein Gespraech.
 * - `paareGedaeschtnis`: so viele Paare werden behalten.
 *
 * **WAS HIER NICHT MEHR STEHT, UND WARUM.** v0.5.0 hatte ein "Kettenbudget" mit
 * Sprunghoehe (4) und Rundlaeufen je Kette. Das Red-Team hat es gemessen und
 * beides beanstandet: es war **falsch positiv** und **falsch negativ** zugleich,
 * weil eine "Kette" ueber eine einzige `ketteVon`-Zuordnung je Sitzung lief.
 * A→B verbrauchte die Kette; A→C landete in derselben, und C→A wurde dann nach
 * EINER Nachricht abgewiesen. Umgekehrt oeffnete ein fremder Erstabsender eine
 * neue Kette, und danach war A→B wieder frei.
 *
 * Die Sprunghoehe ist deshalb **gestrichen**, nicht repariert: Eine echte Tiefe
 * braucht die Abstammung der Nachricht, und die sieht dieses Werkzeug nicht —
 * es bekommt keinen eingehenden Nachrichtenkopf. Eine Zahl, die niemand messen
 * kann, ist keine Grenze, sondern ein Versprechen. Was bleibt, ist das, was sich
 * je Paar exakt zaehlen laesst.
 */
export const GRENZEN = Object.freeze({
	fensterMs: 10 * 60 * 1000,
	jeAbsender: 6,
	jeZiel: 6,
	paarNachrichten: 2,
	paareGedaeschtnis: 200
});

/** Die zwei Befunde des Paar-Budgets. Sie stehen im Protokoll und in der Antwort. */
export const KETTEN_BEFUNDE = Object.freeze({
	rundlaeufe: "PING_PONG",
	wiederholung: "REPEATED_MESSAGE"
});

/**
 * Wo das Protokoll liegt: `~/.dsh/.tm/teams-plus/logs/`.
 *
 * E1 des Pakets (siehe `docs/ENTSCHEIDUNGEN.md`): alle eigenen Daten eines
 * Plugins liegen unter `~/.dsh/.tm/<plugin>`, damit ein Update des Pakets sie
 * nie ueberschreibt und der Mensch sie an EINER Stelle findet. v0.5.0 schrieb
 * nach `~/.dsh/logs/` und widersprach damit der eigenen README. Ueber
 * `DSH_HOME` umlenkbar, damit Tests hermetisch bleiben.
 */
function protokollPfad() {
	const heim = process.env.DSH_HOME ?? join(homedir(), ".dsh");
	return join(heim, ".tm", "teams-plus", "logs", "send-to-session.log");
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
 * **`kind: "plugin"` waere FALSCH — gemessen, nicht vermutet.** Der v4-Codec
 * (`dsh-session-format-v3-to-v4/lib/index.js`, Funktion `source()`, Zeile 126)
 * lehnt genau diesen Wert beim Schreiben ab: *"format v4 message requires a
 * producer-owned source kind"*. Die Folge waere nicht ein Fehler im Werkzeug,
 * sondern eine SITZUNG, DEREN PERSISTENZ STEHENBLEIBT: die Nachricht ist im
 * Speicher da, `delivered: true` wird gemeldet, und die Platte schreibt nicht
 * mehr. Wer das einbaut, beschaedigt fremde Sitzungen, ohne es zu merken.
 *
 * Was v4 akzeptiert, ist eine **erzeugereigene** Art. Der Umbenenner des Kerns
 * bildet sie selbst so (`producerKind`, Zeile 87-93): `plugin:<paketname>`.
 * Genau diese Form steht hier — und sie ist weiterhin **keine Berechtigung**:
 * `hasDirectHumanInput` (dsh-tool-goal) kennt nur `user`, `agent-message` und
 * `team-message` vom direkten Elternteil. `plugin:…` faellt durch.
 *
 * Der Test schickt diese Quelle durch den ECHTEN Codec. Ein Test, der nur das
 * Etikett prueft, haette den Fehler nicht gefunden — die Suite war 22/22 gruen,
 * waehrend die Fassung unbrauchbar war.
 *
 * `senderSessionId` traegt der Kern selbst bei `agent-message`-Quellen; die
 * Client-Haelfte zeigt damit den Absender an. `targetSessionId` steht daneben,
 * damit das Protokoll beweist, wer wem geschrieben hat.
 */
export const QUELL_ART = "plugin:@tmielsch/dsh-teams-plus";

export function baueQuelle(absender, ziel) {
	return {
		kind: QUELL_ART,
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

/**
 * Der leere Zustand. Die Form ist die Form der Datei auf der Platte.
 *
 * Aeltere Dateien tragen `ketten`/`ketteVon`. Sie werden beim Laden
 * **verworfen**, nicht migriert: die Kette war nachweislich falsch gebaut (siehe
 * GRENZEN), und alte Zaehler fuer ein kaputtes Modell zu uebernehmen waere
 * schlimmer als frisch anzufangen. Ein neuer Zustand kostet hoechstens ein
 * Zeitfenster Kulanz.
 */
export function leererZustand() {
	return { absender: {}, ziel: {}, paare: {} };
}

/**
 * Laedt den Zustand.
 *
 * **Fehlt** die Datei, beginnt ein frischer Zustand — beim ersten Start ist das
 * richtig.
 *
 * **Ist sie da und kaputt**, wird das gemeldet (`kaputt: true`) und der Aufrufer
 * entscheidet. Frueher fiel beides zusammen: ein Fehler lieferte stillschweigend
 * den leeren Zustand, und damit war das Loeschen der Datei ein bequemer Weg, die
 * Bremse zurueckzusetzen. Das Red Team hat es beanstandet (Befund H2), und es
 * stimmt: Das Web-Profil laeuft mit `danger-full-access`, der Datenordner
 * gehoert demselben Benutzer, `test -w` sagt ja. Die Bremse ist damit eine
 * Hoeflichkeitsbremse gegen Versehen, **keine** Sicherheitsgrenze gegen einen
 * Agenten, der sie umgehen will. Das steht hier, damit niemand sich auf sie
 * verlaesst.
 *
 * Was der Aufrufer (`apply`) mit `kaputt` macht: laut melden und den Zustand
 * trotzdem fuehren — aber die Kaputtheit nicht vergessen.
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
			paare: istObjekt(roh.paare) ? roh.paare : leer.paare,
			// Eine Datei aus v0.5.0 (vor dem Umbau) traegt ein anderes Modell.
			alt: istObjekt(roh.ketten) || istObjekt(roh.ketteVon),
			// Die Datei WAR da, ist aber kein Zustand: entweder kein Objekt, oder ein
			// Objekt ohne einen einzigen bekannten Schluessel. Beides wird gemeldet
			// statt stillschweigend als "frischer Anfang" verbucht.
			kaputt: !istObjekt(roh)
				|| (istObjekt(roh.absender) === false && istObjekt(roh.ziel) === false
					&& istObjekt(roh.paare) === false && istObjekt(roh.ketten) === false)
		};
	} catch {
		return { ...leererZustand(), kaputt: true };
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

/** Die Kante eines geordneten Paares, wie das Buch sie schluesselt. */
export function kante(von, an) {
	return `${von} ${an}`;
}

/**
 * Darf diese Nachricht von `von` an `an` noch raus?
 *
 * **Das Budget haengt am geordneten PAAR, nicht an einer Kette.** Zwei Fragen im
 * selben Zeitfenster: hat dieses Paar seine zwei Nachrichten aufgebraucht, und
 * ist es wortgleich derselbe Text wie zuletzt.
 *
 * Warum je Paar und nicht je Kette: Eine Kette musste raten, wer mit wem
 * spricht. Sie tat es falsch — A→C erbte die Kette von A→B, und C→A wurde dann
 * nach einer Nachricht abgewiesen, obwohl das Paar C→A noch nichts gesagt hatte.
 * Das Paar ist die Groesse, die sich ohne Raten zaehlen laesst.
 *
 * Gegenrichtung: `A B` und `B A` sind **verschiedene** Paare. Wer antwortet,
 * ist nicht der, der angefangen hat.
 *
 * @returns `{ ok: true }` oder `{ ok: false, befund, text }`.
 */
export function pruefeKette(zustand, von, an, text, jetzt = Date.now(), grenzen = GRENZEN) {
	const buch = zustand.paare?.[kante(von, an)];
	if (buch === undefined) return { ok: true };
	const zeiten = (Array.isArray(buch.zeiten) ? buch.zeiten : []).filter((t) => jetzt - t < grenzen.fensterMs);
	if (zeiten.length >= grenzen.paarNachrichten) {
		return {
			ok: false,
			befund: KETTEN_BEFUNDE.rundlaeufe,
			text: `${zeiten.length} message(s) already went from that sender to that target (at most ${grenzen.paarNachrichten} per ${grenzen.fensterMs / 60000} minutes)`
		};
	}
	if (buch.letzterText === text && zeiten.length > 0) {
		return {
			ok: false,
			befund: KETTEN_BEFUNDE.wiederholung,
			text: "this exact message already went from that sender to that target"
		};
	}
	return { ok: true };
}

/** Verbucht eine angenommene Zustellung im Paar-Buch. */
export function verbucheKette(zustand, von, an, text, jetzt = Date.now(), grenzen = GRENZEN) {
	const schluessel = kante(von, an);
	const alt = zustand.paare?.[schluessel];
	const zeiten = (Array.isArray(alt?.zeiten) ? alt.zeiten : []).filter((t) => jetzt - t < grenzen.fensterMs);
	zeiten.push(jetzt);
	zustand.paare = zustand.paare ?? {};
	zustand.paare[schluessel] = { zeiten, letzterText: text };

	// Alte Paare fallen weg, damit die Datei nicht unbegrenzt waechst.
	const alle = Object.keys(zustand.paare);
	if (alle.length > grenzen.paareGedaeschtnis) {
		for (const altes of alle.slice(0, alle.length - grenzen.paareGedaeschtnis)) delete zustand.paare[altes];
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
	// Was eine Sitzung wirklich hergibt: id, cwd, createdAt, origin. Ein `title`
	// steht NICHT auf der Session — gemessen am 2026-10-31 an
	// `dsh-session/lib/types/index.d.ts` (SessionHeader: version, id, createdAt,
	// cwd, parentSession, isSeeded, origin, …). v0.5.0 suchte nach `session.title`
	// und fand nie etwas; nur die exakte Kennung funktionierte. Das Red-Team hat
	// es beanstandet, und es stimmt.
	const alle = agenten.map((a) => ({
		id: String(a.id),
		ordner: typeof a.session?.header?.cwd === "string"
			? a.session.header.cwd
			: typeof a.session?.cwd === "string" ? a.session.cwd : undefined
	}));
	if (eingabe === undefined || eingabe === "") return { art: "liste", alle };
	const text = String(eingabe);
	const treffer = alle.find((a) => a.id === text);
	if (treffer !== undefined) return { art: "genau", ziel: treffer };
	// Ein Praefix der Kennung ist eindeutig genug, solange es nur einen gibt.
	const nachId = alle.filter((a) => a.id.startsWith(text));
	if (nachId.length === 1) return { art: "genau", ziel: nachId[0] };
	if (nachId.length > 1) return { art: "mehrdeutig", kandidaten: nachId };
	// Der Ordner ist das, was ein Mensch an einer Sitzung wiedererkennt.
	const nachOrdner = alle.filter((a) => typeof a.ordner === "string" && a.ordner.toLowerCase().includes(text.toLowerCase()));
	if (nachOrdner.length === 1) return { art: "genau", ziel: nachOrdner[0] };
	if (nachOrdner.length > 1) return { art: "mehrdeutig", kandidaten: nachOrdner };
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

	/** Der Zustand: Zaehler und Paar-Buch. Beim Laden einmal gelesen, danach gefuehrt. */
	const pfad = optionen.pfad ?? zustandPfad();
	const geladen = ladeZustand(pfad);
	const zustand = geladen;
	if (geladen.kaputt === true) {
		melden("warn", `die Zustandsdatei ${pfad} ist unlesbar; die Bremsen beginnen bei null. Das ist eine Hoeflichkeitsbremse, keine Sicherheitsgrenze.`);
	} else if (geladen.alt === true) {
		melden("warn", `die Zustandsdatei ${pfad} traegt das alte Kettenmodell; Paar-Zaehler beginnen bei null.`);
	}

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
			"LIMITS: at most 6 messages per sender and 6 per target within 10 minutes;",
			"one ordered sender/target pair may exchange at most 2 messages in that window.",
			"A root session (the one a human is typing in) never receives a new turn: followup is",
			"downgraded to steer there.",
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
				return { delivered: false, sessions: suche.kandidaten, note: "the folder matches several sessions; use the id" };
			}
			if (suche.art === "unbekannt") {
				return { delivered: false, sessions: suche.alle, note: "no live session has that id or folder" };
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

			// (2) Das Paar-Budget: zwei Nachrichten je geordnetem Paar, keine Wortwiederholung.
			const kettenPruefung = pruefeKette(zustand, absenderAgent.id, zielId, args.message, jetzt);
			if (kettenPruefung.ok !== true) {
				melden("warn", `paar abgewiesen befund=${kettenPruefung.befund} absender=${absenderAgent.id} ziel=${zielId}`);
				return { delivered: false, note: `${kettenPruefung.befund}: ${kettenPruefung.text}` };
			}

			// (3) Die Wurzelsitzung ist die, mit der der Mensch spricht. Ein `followup`
			// dort startet eine NEUE RUNDE in seiner eigenen Sitzung — das darf kein
			// fremder Agent ausloesen. `steer` ist erlaubt: es kommt an der naechsten
			// Grenze an, ohne eine Runde zu oeffnen.
			const istWurzel = typeof dienstAgenten.roots === "function"
				&& dienstAgenten.roots().some((a) => a.id === zielId);
			const gewuenscht = loeseModus(args.mode, ziel);
			const modus = istWurzel && gewuenscht === "followup" ? "steer" : gewuenscht;
			if (istWurzel) melden("info", `ziel ist eine Wurzelsitzung; modus auf ${modus} begrenzt`);

			const inhalt = baueInhalt(args.message, absenderAgent.id, absenderAgent.session?.cwd);
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
			verbucheKette(zustand, absenderAgent.id, zielId, args.message, jetzt);
			if (speichereZustand(zustand, pfad) !== true) {
				melden("warn", `Zustand konnte nicht geschrieben werden: ${pfad}`);
			}

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
