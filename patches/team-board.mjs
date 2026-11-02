/**
 * team-board — das schwarze Brett eines Teams, auf der NATIVEN Team-Identität
 * ===========================================================================
 *
 * WAS DER MENSCH WOLLTE
 * `dsh-team` 0.2.11 soll aus dem Profil verschwinden. Es liefert neun `team_*`-
 * Werkzeuge; acht davon hat das native Plugin schon. Es fehlen genau drei:
 * `team_board`, `team_note` und `team_workspace` (das dritte ist die Ablage, die
 * die zwei Werkzeuge benutzen — hier eine Datei, siehe unten). Dieses Modul baut
 * die fehlenden zwei nach.
 *
 * WARUM NICHT ALS KOPIE VON `dsh-team`
 * `dsh-team` ist ein toter Fork. Er kennt eine eigene Team-Identität (eine
 * Zustandstabelle mit `leaderId` aus `child.session.header.parentSession`,
 * `SeatResolver`, eigenes Journal) und eigene Werkzeug-Gerüste. Wer die
 * abschreibt, importiert den Fork. Deshalb kommen Identität und Gerüst von dem,
 * was das Profil ohnehin lädt:
 *
 *   - IDENTITÄT: `ctx.agentTeams.membership(agent)` aus
 *     `@deepseek-ai/dsh-experimental-agent-team` (lib/types/roster.js:68-106,
 *     gemessen am 2026-11-02). Das Ergebnis ist
 *     `{ root, id, role, name }` — `root` ist der Lead-Agent, `role` ist
 *     `"lead"` oder `"teammate"`, `name` ist der modellseitige Name (`"lead"`
 *     bzw. der Teammate-Name), `id` ist die TEAM-Identität.
 *
 *     **Achtung, gemessen und wichtig:** für einen Teammate ist `id` gleich
 *     `root.id` (roster.js:89: `id: TeamId(root.id)`). Die Team-Identität ist
 *     also für ALLE Mitglieder dieselbe Zeichenkette und taugt NICHT als
 *     Schlüssel eines privaten Bereichs — sonst teilten sich alle Mitglieder
 *     einen Block. Für `leaderId` (die Team-Trennung) und für `authorId` gilt
 *     deshalb:
 *
 *        leaderId  = String(membership.root.id)   ← trennt die Teams
 *        bereich   = private ? String(agent.id) : "shared"
 *        authorId  = String(agent.id)             ← die Sitzung, die schreibt
 *        authorName= membership.name
 *
 *     Fehlt der Dienst, wird NICHT stillschweigend eine Ersatz-Identität
 *     erfunden: der Aufruf scheitert laut (siehe `identitaetVon`).
 *
 *   - GERÜST: `defineTool` aus `@deepseek-ai/dsh-tools`, wie in
 *     `patches/send-to-session.mjs` und `patches/goal-await.mjs`. Die Kernpakete
 *     wohnen nur in der Installation, deshalb derselbe Lade-Weg (`ladeKern`).
 *
 * DIE ABLAGE (E1)
 * `~/.dsh/.tm/teams-plus/state/board.json` — E1 des Pakets (ENTSCHEIDUNGEN.md,
 * 2026-10-30: „alle eigenen Daten eines Plugins unter ~/.dsh/.tm/<pluginName>").
 * Der Dateiname ist der, den der Auftrag nennt. `DSH_HOME` wird respektiert, und
 * zwar mit `||`-Verhalten: `DSH_HOME=""` zählt als „nicht gesetzt", nicht als
 * „das Arbeitsverzeichnis". Genau diese Falle stand im Repo schon einmal falsch
 * (`send-to-session.mjs`, Backlog A2) — hier ist es abgeschaut und im Test
 * festgehalten.
 *
 * DIE FORM DER DATEI — bewusste Übernahme aus `dsh-team`
 * Der Auftrag verlangt das Datenmodell von `dsh-team`s `team_workspace`:
 *
 *   { leaderId, area, key, text, authorId, authorName, updatedAt }
 *
 * `area` ist `"shared"` oder die Sitzungs-Id des Mitglieds, dessen privater
 * Block es ist. Ebenfalls bewusst übernommen (damit die Umstellung unsichtbar
 * bleibt, nicht aus Zufall):
 *
 *   - `key` wird getrimmt und gegen `/^[\w .\-一-鿿]{1,64}$/u` geprüft
 *     (dsh-team dist/index.js:1286, `KEY_PATTERN`) — ein Schlüssel, der den
 *     Adress-Trenner nicht überlebt, wäre ein Adressfehler.
 *   - Ein vorhandener Schlüssel wird GANZ ersetzt, nie ergänzt
 *     (dist/index.js:1371-1390).
 *   - Der Index steht NEUESTE ZUERST (dist/index.js:1325-1327).
 *   - Die Vorschau ist die erste nicht-leere Zeile, getrimmt, auf 180 Zeichen
 *     gekürzt mit „…" (dist/index.js:1320-1323, `PREVIEW_CHARS`).
 *   - Höchstens 32 Einträge je Bereich und 4000 Zeichen je Notiz
 *     (dist/index.js:27-28, Vorgaben `maxWorkspaceEntries`/`maxNoteChars`).
 *
 * **EINE STELLE, AN DER DIESES MODUL STRENGER IST ALS `dsh-team`:** der Index
 * ohne `key` trägt die Vorschau, NICHT den Volltext. `dsh-team` hat den Volltext
 * mitgeliefert (dist/index.js:2176-2183), obwohl seine eigene Beschreibung „the
 * index" sagt. Der Auftrag beschreibt den Index mit `key`, `authorName`,
 * `updatedAt` und Vorschau — daran steht dieses Modul. Der Unterschied ist
 * messbar: ein Index-Aufruf zöge sonst bis zu 32 × 4000 Zeichen in den Kontext.
 *
 * WAS HIER ANDERS IST ALS BEI `dsh-team` — und warum
 *   1. Die Ablage ist eine Datei, kein `storageDomain`. E1 Regel 2 verlangt,
 *      dass der Mensch sie in einem Editor öffnen und zitieren kann.
 *   2. Geschrieben wird UNTER DER VORHANDENEN SPERRE. `mitSperre` kommt aus
 *      `patches/send-to-session.mjs` und wird importiert, nicht nachgebaut:
 *      zwei Prozesse (zwei Hosts, ein Neustart neben einem laufenden Host)
 *      dürfen sich nicht überschreiben. Gelesen wird ohne Sperre, weil jede
 *      Änderung über `rename` geht — ein Leser sieht also immer eine ganze Datei,
 *      nie eine halbe.
 *   3. Eine kaputte `board.json` wird LAUT gemeldet, nicht als leeres Brett
 *      gelesen. Ein stiller leerer Zustand wäre von „es ist noch nichts
 *      geschrieben" nicht zu unterscheiden, und genau das macht Datenverlust
 *      unsichtbar (dieselbe Lehre wie `ladeZustand` in `send-to-session.mjs`).
 *   4. Löschen ohne Text ist idempotent: fehlt der Schlüssel, ist das Ergebnis
 *      „nichts war da", kein Fehler. `dsh-team` warf dort `UNKNOWN_NOTE`; ein
 *      zweiter Löschversuch ist aber kein Irrtum, den ein Modell beheben müsste.
 *
 * **`text` fehlt oder ist leer — beides löscht.** Der Unterschied ist messbar
 * (ein fehlender Parameter ist `undefined`, ein leerer ist `""`), aber er ist
 * bedeutungslos: der Auftrag sagt für beide Fälle dasselbe. Beide Wege gehen
 * durch dieselbe Prüfung (`zuLoeschen`), und der Test fährt beide.
 *
 * WAS DIESES MODUL NICHT TUT
 *   - Es fängt keine Team-Mitgliedschaft ab und erfindet keine: ohne
 *     `agentTeams` gibt es keine Notiz, sondern einen lauten Fehler.
 *   - Es schreibt nur seine eigene Datei; `~/.dsh` liest es, mehr nicht.
 *   - Es kennt keine Namen von Rollen und keine Sonderfälle für bestimmte
 *     Agenten: jede Regel hängt an `membership`, an der Sitzungs-Id oder an der
 *     Größe der Eingabe.
 *
 * NACHSEHEN
 *   ~/.dsh/.tm/teams-plus/state/board.json
 *   ~/.dsh/.tm/teams-plus/logs/team-board.log
 * PRÜFUNG
 *   node --test test/team-board.test.mjs
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mitSperre } from "./send-to-session.mjs";

/** Die Namen der zwei Werkzeuge. Sie stehen im Modell-Input und in der Ablage. */
export const WERKZEUG_BOARD = "team_board";
export const WERKZEUG_NOTIZ = "team_note";

/** Der Bereich, den jedes Mitglied liest und schreibt. Der stabile Name aus dsh-team. */
export const GETEILT = "shared";

/**
 * Die Grenzen an einer Stelle — jede Zahl ist eine Übernahme aus `dsh-team`
 * (dist/index.js:27-28 und :1288), keine Zufallszahl und keine neue Entscheidung.
 */
export const GRENZEN = Object.freeze({
	/** Höchstens so viele Einträge je Bereich (dsh-team `maxWorkspaceEntries`). */
	eintraege: 32,
	/** Höchstens so viele Zeichen je Notiz (dsh-team `maxNoteChars`). */
	notizZeichen: 4_000,
	/** So viele Zeichen trägt eine Vorschau im Index (dsh-team `PREVIEW_CHARS`). */
	vorschauZeichen: 180
});

/** Schlüssel, die eine Adresse überleben: Buchstaben, Ziffern, Leerzeichen, Punkt, Strich, CJK. */
export const SCHLUESSEL_MUSTER = /^[\w .\-一-鿿]{1,64}$/u;

/** Das Harness-Zuhause — mit `||`-Verhalten, siehe Dateikopf (Backlog A2). */
function dshHeim() {
	const gesetzt = process.env.DSH_HOME?.trim();
	return gesetzt === undefined || gesetzt === "" ? join(homedir(), ".dsh") : gesetzt;
}

/**
 * Der Ort des Bretts: `~/.dsh/.tm/teams-plus/state/board.json`.
 *
 * Exportiert, damit der Test ihn prüfen kann, ohne ins echte `~/.dsh` zu schreiben.
 */
export function boardPfad() {
	return join(dshHeim(), ".tm", "teams-plus", "state", "board.json");
}

/** Der Protokollpfad. E1: unter `.tm/teams-plus`, nicht in `~/.dsh/logs`. */
export function protokollPfad() {
	return join(dshHeim(), ".tm", "teams-plus", "logs", "team-board.log");
}

/** Eine Zeile ins Protokoll. Ein fehlendes Verzeichnis oder Recht darf nie werfen. */
function protokolliere(text) {
	try {
		const pfad = protokollPfad();
		mkdirSync(dirname(pfad), { recursive: true });
		appendFileSync(pfad, `${new Date().toISOString()} ${text}\n`);
	} catch {
		/* Protokoll ist Beiwerk; es darf nie eine Notiz verhindern. */
	}
}

/** Kürzt langen Text für das Protokoll, damit die Datei lesbar bleibt. */
function kurz(text, grenze = 60) {
	const eine = String(text).replace(/\s+/gu, " ").trim();
	return eine.length <= grenze ? eine : `${eine.slice(0, grenze)}…`;
}

// ---------------------------------------------------------------------------
// Die Datei: laden, speichern, ändern.
// ---------------------------------------------------------------------------

/** Das leere Brett. Die Form ist die Form der Datei auf der Platte. */
export function leererBoard() {
	return { version: 1, entries: [] };
}

/** Ist der Wert ein schlichtes Objekt (kein Array, kein null)? */
function istObjekt(wert) {
	return wert !== null && typeof wert === "object" && Array.isArray(wert) === false;
}

/** Trägt dieser Eintrag die sieben Felder, die das Datenmodell nennt? */
function istEintrag(wert) {
	return istObjekt(wert)
		&& typeof wert.leaderId === "string"
		&& typeof wert.area === "string"
		&& typeof wert.key === "string"
		&& typeof wert.text === "string"
		&& typeof wert.authorId === "string"
		&& typeof wert.authorName === "string"
		&& typeof wert.updatedAt === "number"
		&& Number.isFinite(wert.updatedAt);
}

/**
 * Liest das Brett.
 *
 * Fehlt die Datei, ist das Brett leer — beim ersten Aufruf ist das richtig.
 * Ist sie da und unlesbar, wird GEWORFEN: ein stiller leerer Zustand wäre von
 * „noch nichts geschrieben" nicht zu unterscheiden und würde Datenverlust
 * verstecken. Der Text nennt den Pfad, damit der Mensch nachsehen kann.
 *
 * @param pfad - Ablage; Vorgabe ist {@link boardPfad}.
 * @returns `{ version: 1, entries }`.
 */
export function ladeBoard(pfad = boardPfad()) {
	if (existsSync(pfad) === false) return leererBoard();
	const roh = readFileSync(pfad, "utf8");
	let daten;
	try {
		daten = JSON.parse(roh);
	} catch (fehler) {
		throw new Error(`the team board ${pfad} is not readable as JSON (${fehler instanceof Error ? fehler.message : String(fehler)}) — it was NOT treated as an empty board`);
	}
	if (istObjekt(daten) === false || Array.isArray(daten.entries) === false) {
		throw new Error(`the team board ${pfad} does not hold a board (expected { entries: [...] }) — it was NOT treated as an empty board`);
	}
	// Ein einzelner kaputter Eintrag ist kein Grund, die anderen zu verlieren — aber
	// er wird auch nicht stillschweigend weggelassen: er wird gemeldet.
	const entries = daten.entries.filter(istEintrag);
	if (entries.length !== daten.entries.length) {
		protokolliere(`warn ${daten.entries.length - entries.length} malformed entries skipped in ${pfad}`);
	}
	return { version: 1, entries };
}

/**
 * Schreibt das Brett.
 *
 * Erst in eine eindeutig benannte Nebendatei, dann umbenennen: ein Abbruch
 * mitten im Schreiben hinterlässt so nie eine halbe Datei, und ein Leser ohne
 * Sperre sieht entweder den alten oder den neuen Stand (dieselbe Technik wie
 * `speichereZustand` in `send-to-session.mjs`). Die Einträge stehen sortiert,
 * damit die Datei von Hand lesbar bleibt (E1 Regel 2).
 *
 * @returns den Pfad, oder wirft, wenn nicht geschrieben werden konnte — ein
 *          stiller Schreibverlust wäre der schlimmere Ausgang.
 */
export function speichereBoard(board, pfad = boardPfad()) {
	mkdirSync(dirname(pfad), { recursive: true });
	const sortiert = [...board.entries].sort((links, rechts) => links.leaderId.localeCompare(rechts.leaderId)
		|| links.area.localeCompare(rechts.area)
		|| links.key.localeCompare(rechts.key));
	const vorlaeufig = `${pfad}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.neu`;
	try {
		writeFileSync(vorlaeufig, `${JSON.stringify({ version: 1, entries: sortiert }, null, "\t")}\n`);
		renameSync(vorlaeufig, pfad);
	} catch (fehler) {
		try { unlinkSync(vorlaeufig); } catch { /* war nie da */ }
		throw new Error(`the team board ${pfad} could not be written: ${fehler instanceof Error ? fehler.message : String(fehler)}`);
	}
	return pfad;
}

/**
 * Liest, ändert und schreibt — unter der VORHANDENEN Sperre.
 *
 * Die Sperre ist `mitSperre` aus `patches/send-to-session.mjs` (dort Zeilen
 * 570-604): Lesen-Buchen-Schreiben unter `open(…, 'wx')`, asynchron wartend,
 * veraltete Sperre nach 5 Sekunden. Sie wird BENUTZT, nicht nachgebaut — zwei
 * Prozesse dürfen sich nicht überschreiben, und zwei Sperren an derselben Datei
 * wären keine Sperre.
 *
 * Die Arbeit MUSS synchron sein: sie läuft zwischen Anlegen und Löschen der
 * Sperrdatei. `ladeBoard`/`speichereBoard` sind es.
 *
 * @param pfad - die Ablage.
 * @param aenderung - bekommt das geladene Brett, ändert es und gibt sein Ergebnis zurück.
 * @returns was `aenderung` zurückgegeben hat.
 */
export function aendereBoard(pfad, aenderung) {
	const arbeit = () => {
		const board = ladeBoard(pfad);
		const ergebnis = aenderung(board);
		speichereBoard(board, pfad);
		return ergebnis;
	};
	return mitSperre(pfad, arbeit);
}

// ---------------------------------------------------------------------------
// Die Regeln auf dem Brett. Reine Funktionen, damit sie ohne DSH prüfbar sind.
// ---------------------------------------------------------------------------

/** Den Schlüssel so, wie er in der Datei steht: getrimmt, geprüft, sonst laut. */
export function pruefeSchluessel(wert) {
	const getrimmt = typeof wert === "string" ? wert.trim() : "";
	if (SCHLUESSEL_MUSTER.test(getrimmt) === false) {
		throw new Error(`invalid note key ${JSON.stringify(wert)}: use up to 64 letters, digits, spaces, dots or dashes`);
	}
	return getrimmt;
}

/**
 * Löscht dieser Aufruf, statt zu schreiben?
 *
 * `undefined` (Parameter fehlt) und `""` (Parameter leer) sind verschiedene
 * Werte und werden hier BEWUSST gleich behandelt: der Auftrag sagt für beide
 * „die Notiz löschen". Reiner Leerraum zählt ebenfalls als leer — eine Notiz
 * aus drei Leerzeichen ist keine Notiz.
 */
export function zuLoeschen(text) {
	return text === undefined || String(text).trim() === "";
}

/** Die Vorschau eines Eintrags: erste nicht-leere Zeile, getrimmt, gekürzt (dsh-team). */
export function vorschau(text) {
	const zeile = String(text).split("\n").find((teil) => teil.trim().length > 0)?.trim() ?? "";
	return zeile.length > GRENZEN.vorschauZeichen ? `${zeile.slice(0, GRENZEN.vorschauZeichen)}…` : zeile;
}

/** Ein Eintrag als Index-Zeile: alles außer dem Volltext. */
export function alsIndexZeile(eintrag) {
	return {
		key: eintrag.key,
		authorId: eintrag.authorId,
		authorName: eintrag.authorName,
		updatedAt: eintrag.updatedAt,
		preview: vorschau(eintrag.text)
	};
}

/** Ein Eintrag mit Volltext. */
export function alsVolltext(eintrag) {
	return { ...alsIndexZeile(eintrag), text: eintrag.text };
}

/**
 * Die Einträge EINES Bereichs EINES Teams, neueste zuerst.
 *
 * Die Trennung ist die ganze Sicherheit dieser Ablage: `leaderId` ist der Lead
 * des Teams, `area` der Bereich darin. Zwei Teams mit verschiedenen Leads sehen
 * sich nicht, und der private Block eines Mitglieds steht in einem eigenen
 * Bereich — er ist im geteilten Brett nicht enthalten, weil `area` dort
 * `"shared"` ist.
 */
export function eintraegeVon(board, leaderId, area) {
	return board.entries
		.filter((eintrag) => eintrag.leaderId === leaderId && eintrag.area === area)
		.sort((links, rechts) => rechts.updatedAt - links.updatedAt || links.key.localeCompare(rechts.key));
}

/** Sucht einen Eintrag. Gibt es ihn nicht, ist das `undefined`. */
export function findeEintrag(board, leaderId, area, key) {
	return board.entries.find((eintrag) => eintrag.leaderId === leaderId && eintrag.area === area && eintrag.key === key);
}

// ---------------------------------------------------------------------------
// Identität. Sie kommt vom nativen Dienst oder gar nicht.
// ---------------------------------------------------------------------------

/**
 * Wer schreibt, und in welches Team?
 *
 * **Der einzige Weg zur Identität ist `ctx.agentTeams.membership(agent)`.**
 * Fehlt der Dienst, wird geworfen — laut und mit einem Satz, der sagt, was
 * fehlt. Eine erfundene Ersatz-Identität (etwa: „nimm die Sitzungs-Id als Lead")
 * wäre schlimmer als ein Fehler: sie würde Notizen in ein Team schreiben, das es
 * nicht gibt, und zwei fremde Teams stillschweigend vermischen.
 *
 * `membership(agent)` selbst wirft `TEAM_NOT_MEMBER` für einen Agenten, der in
 * keinem Team ist. Das wird durchgereicht, nicht abgefangen: derselbe Grund.
 *
 * @param dienst - was `ctx.get("agentTeams")` liefert, oder `undefined`.
 * @param agent - der aufrufende Agent aus `exec.agent`.
 * @returns `{ leaderId, name, role, sitzung }`.
 */
export function identitaetVon(dienst, agent) {
	if (dienst === undefined || dienst === null || typeof dienst.membership !== "function") {
		throw new Error("the team board needs the native agentTeams service (ctx.agentTeams from @deepseek-ai/dsh-experimental-agent-team), and this profile does not provide it — without it there is no team identity, and this plugin does not invent one");
	}
	if (agent === undefined || agent === null || typeof agent.id !== "string" || agent.id.length === 0) {
		throw new Error("the team board needs the calling agent (exec.agent) to resolve the team identity, and the call carried none");
	}
	const mitgliedschaft = dienst.membership(agent);
	if (istObjekt(mitgliedschaft) === false || istObjekt(mitgliedschaft.root) === false || typeof mitgliedschaft.root.id !== "string") {
		throw new Error("the agentTeams service returned no team root for this agent, so the board cannot tell which team it belongs to");
	}
	const name = typeof mitgliedschaft.name === "string" && mitgliedschaft.name.length > 0
		? mitgliedschaft.name
		: typeof mitgliedschaft.role === "string" && mitgliedschaft.role.length > 0 ? mitgliedschaft.role : "member";
	return {
		// root.id trennt die Teams. NICHT `mitgliedschaft.id` benutzen: das ist für
		// jeden Teammate dieselbe Zeichenkette wie root.id (roster.js:89).
		leaderId: String(mitgliedschaft.root.id),
		name,
		role: typeof mitgliedschaft.role === "string" ? mitgliedschaft.role : "member",
		// Die Sitzungs-Id des Schreibers. Sie ist je Mitglied verschieden und deshalb
		// der einzige taugliche Schlüssel eines privaten Bereichs.
		sitzung: String(agent.id)
	};
}

/** Welcher Bereich ist gemeint: das geteilte Brett oder der eigene Block? */
export function bereichVon(identitaet, privat) {
	return privat === true ? identitaet.sitzung : GETEILT;
}

// ---------------------------------------------------------------------------
// Der Werkzeug-Baustein: die Kernpakete liegen nur in der Installation.
// ---------------------------------------------------------------------------

/** Die Kernpakete, die dieses Modul zur Laufzeit braucht (nie statisch importieren). */
const PAKET_WERKZEUGE = "@deepseek-ai/dsh-tools";

/** Einmal geladener Werkzeug-Baustein; ein zweiter Ladeversuch wäre Verschwendung. */
let werkzeugBaustein;

/**
 * Die Basis-Ordner der dsh-Installation, in der Reihenfolge der Wahrscheinlichkeit.
 *
 * Warum nicht einfach importieren: die Kernpakete wohnen NUR in der Installation,
 * ein statischer Import aus dem Paket fände sie nicht, und zwei Modul-Instanzen
 * brechen jeden Werkzeug-Aufruf (siehe `~/.dsh/AGENTS.md`, „NIEMALS
 * @deepseek-ai-Kernpakete installieren"). Der Weg ist aus
 * `patches/send-to-session.mjs` übernommen, wo er sich im Betrieb bewährt hat.
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

/** Laedt einen Kernbaustein über alle bekannten Ablageformen. */
async function ladeKern(paket) {
	const unterpfad = paket.replace("@deepseek-ai/", "");
	const kandidaten = [paket];
	for (const basis of kernBasis()) {
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

// ---------------------------------------------------------------------------
// Die zwei Werkzeuge.
// ---------------------------------------------------------------------------

/** Die Felder eines Index-Eintrags. Ausgabe-Schema und Wert teilen sie. */
const INDEX_FELDER = {
	key: { type: "string", required: true },
	authorId: { type: "string", required: true },
	authorName: { type: "string", required: true },
	updatedAt: { type: "number", required: true },
	preview: { type: "string", required: true }
};

/** Die Felder eines Eintrags mit Volltext. */
const VOLLTEXT_FELDER = { ...INDEX_FELDER, text: { type: "string" } };

/**
 * `team_board` — ein Team-Bereich wird gelesen.
 *
 * Ohne `key`: der Index des Bereichs (Schlüssel, Autor, Zeitpunkt, Vorschau).
 * Mit `key`: diese eine Notiz im Volltext.
 * `private=true`: der eigene private Block statt des geteilten Bretts.
 */
function boardWerkzeug({ defineTool, pfad, dienst }) {
	return defineTool({
		name: WERKZEUG_BOARD,
		description: [
			"Read a team workspace: the shared board that every member of your team writes to, or your own private pad.",
			"These workspaces are NOT files and they are NOT in the user's working tree, so do not look for them with file tools.",
			"",
			"Without `key` you get the index of the area: every note with the key it is filed under, who wrote it and when, plus the first line of its text.",
			"With `key` you get that one note in full.",
			"With `private: true` you read your own pad instead — nobody else can read it, and the shared board does not show it.",
			"",
			"Read the board before you message anyone: what you were about to ask for may already be written down, and a note costs nobody a turn."
		].join("\n"),
		parameters: {
			key: {
				type: "string",
				description: "Read one note in full; omit for the index of the whole area."
			},
			private: {
				type: "boolean",
				description: "true reads your own private pad; default false reads the shared board of your team."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					area: { type: "string", required: true, enum: [GETEILT, "private"] },
					entries: { type: "array", required: true, items: { type: "object", additionalProperties: false, properties: VOLLTEXT_FELDER } },
					note: { type: "string", required: true }
				}
			},
			render: (_args, wert) => [{ type: "text", text: JSON.stringify(wert) }]
		},
		presentCall: (args) => ({
			card: "generic",
			title: args.key === undefined ? (args.private === true ? "Read own private pad" : "Read the team board") : `Read note ${args.key}`,
			kind: "read"
		}),
		presentResult: () => ({ card: "generic", title: "Team board" }),
		execute: async (args, exec) => {
			const identitaet = identitaetVon(dienst(), exec.agent);
			const bereich = bereichVon(identitaet, args.private === true);
			const board = ladeBoard(pfad);
			const gehalten = eintraegeVon(board, identitaet.leaderId, bereich);
			// **Ohne `key` nur der Index, mit `key` der Volltext.** Die Reihenfolge
			// entscheidet ueber die Groesse des Ergebnisses: der Index ist eine Zeile je
			// Notiz, der Volltext kann bis zu `GRENZEN.notizZeichen` je Eintrag tragen.
			// Ohne diese Trennung zoege ein einziger Index-Aufruf bis zu 32 × 4000 Zeichen
			// in den Kontext — der Grund, warum `key` ueberhaupt existiert.
			const gewaehlt = args.key === undefined
				? gehalten
				: gehalten.filter((eintrag) => eintrag.key === pruefeSchluessel(args.key));
			const entries = args.key === undefined ? gewaehlt.map(alsIndexZeile) : gewaehlt.map(alsVolltext);
			const wie = args.private === true ? "your private pad" : "the shared board";
			const note = entries.length > 0
				? `${entries.length} note(s) from ${wie}`
				: args.key === undefined
					? `${wie} is empty`
					: `no note named ${JSON.stringify(pruefeSchluessel(args.key))} in ${wie}`;
			protokolliere(`read team=${identitaet.leaderId} bereich=${args.private === true ? "private" : GETEILT} key=${args.key === undefined ? "-" : kurz(args.key, 40)} n=${entries.length}`);
			return { area: args.private === true ? "private" : GETEILT, entries, note };
		}
	});
}

/**
 * `team_note` — ein Team-Bereich wird geschrieben.
 *
 * Ein vorhandener Schlüssel wird GANZ ersetzt. Fehlt `text` oder ist er leer,
 * wird die Notiz gelöscht (siehe `zuLoeschen`).
 */
function notizWerkzeug({ defineTool, pfad, dienst }) {
	return defineTool({
		name: WERKZEUG_NOTIZ,
		description: [
			"Write one note into a team workspace. These workspaces are NOT files and they are NOT in the user's working tree.",
			"Every member of your team reads and writes the shared board, so a conclusion belongs there instead of being messaged around:",
			"a note costs nobody a turn, and it is still there after you have gone idle.",
			"",
			"With `private: true` the note goes to your own pad instead, which nobody else can read — use it to keep your own state across turns.",
			"",
			"Writing a key that already exists REPLACES it whole; there are never two notes under one key.",
			"Omit `text` (or pass it empty) to DELETE the note instead. Deleting a note that is not there is not an error."
		].join("\n"),
		parameters: {
			key: {
				type: "string",
				required: true,
				description: "Short name of the note, e.g. \"api decision\". Up to 64 letters, digits, spaces, dots or dashes. Writing the same key again replaces the note."
			},
			text: {
				type: "string",
				description: `The whole note, at most ${GRENZEN.notizZeichen} characters. Omit or leave empty to delete the note instead.`
			},
			private: {
				type: "boolean",
				description: "true writes your own private pad; default false writes the shared board."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					area: { type: "string", required: true, enum: [GETEILT, "private"] },
					key: { type: "string", required: true },
					action: { type: "string", required: true, enum: ["written", "deleted"] },
					existed: { type: "boolean", required: true },
					entry: { type: "object", additionalProperties: false, properties: INDEX_FELDER },
					index: { type: "array", required: true, items: { type: "object", additionalProperties: false, properties: INDEX_FELDER } }
				}
			},
			render: (_args, wert) => [{ type: "text", text: JSON.stringify(wert) }]
		},
		presentCall: (args) => ({
			card: "generic",
			title: args.text === undefined || String(args.text).trim() === "" ? `Drop note ${args.key}` : `Note: ${args.key}`,
			kind: "other"
		}),
		presentResult: () => ({ card: "generic", title: "Team note" }),
		// Zwei Schreiber auf einer Datei dürfen nicht als gleichzeitig gelten: die
		// Sperre ist da, aber der Rahmen soll nicht zwei Aufrufe parallel starten.
		isConcurrencySafe: () => false,
		execute: async (args, exec) => {
			const identitaet = identitaetVon(dienst(), exec.agent);
			const key = pruefeSchluessel(args.key);
			const bereich = bereichVon(identitaet, args.private === true);
			const loeschen = zuLoeschen(args.text);
			const wie = args.private === true ? "your private pad" : "the shared board";

			return aendereBoard(pfad, (board) => {
				const vorhanden = findeEintrag(board, identitaet.leaderId, bereich, key);
				let action;
				if (loeschen) {
					if (vorhanden !== undefined) board.entries.splice(board.entries.indexOf(vorhanden), 1);
					action = "deleted";
				} else {
					const text = String(args.text);
					if (text.length > GRENZEN.notizZeichen) {
						throw new Error(`note "${key}" is ${text.length} characters; at most ${GRENZEN.notizZeichen} are allowed`);
					}
					if (vorhanden === undefined && eintraegeVon(board, identitaet.leaderId, bereich).length >= GRENZEN.eintraege) {
						throw new Error(`${GRENZEN.eintraege} notes already in ${wie} — replace or drop one before adding another`);
					}
					const eintrag = {
						leaderId: identitaet.leaderId,
						area: bereich,
						key,
						text,
						authorId: identitaet.sitzung,
						authorName: identitaet.name,
						updatedAt: Date.now()
					};
					if (vorhanden === undefined) board.entries.push(eintrag);
					else board.entries[board.entries.indexOf(vorhanden)] = eintrag;
					action = "written";
				}
				const index = eintraegeVon(board, identitaet.leaderId, bereich).map(alsIndexZeile);
				const neu = findeEintrag(board, identitaet.leaderId, bereich, key);
				protokolliere(`${action} team=${identitaet.leaderId} autor=${identitaet.sitzung}(${identitaet.name}) bereich=${args.private === true ? "private" : GETEILT} key="${kurz(key, 40)}"${action === "written" ? ` zeichen=${String(args.text).length}` : ""}`);
				return {
					area: args.private === true ? "private" : GETEILT,
					key,
					action,
					existed: vorhanden !== undefined,
					...(action === "written" && neu !== undefined ? { entry: alsIndexZeile(neu) } : {}),
					index
				};
			});
		}
	});
}

/**
 * Baut beide Werkzeuge.
 *
 * Getrennt von `apply`, damit ein Test das Verhalten prüfen kann, ohne einen
 * Cordis-Kontext zu bauen und ohne auf das Laden des Kernbausteins zu warten.
 *
 * @param optionen - `{ defineTool, pfad, dienst }`; `dienst` liefert das native
 *                   Service oder `undefined`, `pfad` die Ablage.
 * @returns die zwei Werkzeugdefinitionen.
 */
export function baueWerkzeuge({ defineTool, pfad, dienst }) {
	return [boardWerkzeug({ defineTool, pfad, dienst }), notizWerkzeug({ defineTool, pfad, dienst })];
}

/**
 * Das Modul. Wird vom Loader als Plugin eingespielt.
 *
 * Jeder Teil ist einzeln abgesichert: ein Fehler hier darf DSH nie am Starten
 * hindern. Fehlt der Team-Dienst, meldet das WERKZEUG das beim Aufruf, statt
 * beim Laden zu werfen — ein Profil ohne Agent Teams soll weiter starten.
 *
 * @param ctx - Cordis-Kontext des Loader-Eintrags.
 * @param optionen - nur für Tests: `{ pfad }` lenkt die Ablage um.
 */
export function apply(ctx, optionen = {}) {
	const melden = (stufe, text) => {
		protokolliere(text);
		try {
			const logger = ctx.logger;
			if (logger !== undefined && typeof logger[stufe] === "function") logger[stufe](`team-board: ${text}`);
		} catch { /* Ein fehlendes Protokoll darf den Start nie stören. */ }
	};

	const pfad = optionen.pfad ?? boardPfad();
	/** Holt den nativen Team-Dienst, ohne beim Fehlen zu werfen. */
	const dienst = () => {
		try {
			return ctx.get("agentTeams");
		} catch {
			return undefined;
		}
	};

	ctx.effect(() => {
		let abgemeldet = false;
		/** @type {Array<() => void>} */
		const abmeldungen = [];
		(async () => {
			werkzeugBaustein ??= await ladeKern(PAKET_WERKZEUGE);
			if (abgemeldet) return;
			const defineTool = werkzeugBaustein?.defineTool;
			if (typeof defineTool !== "function") {
				melden("warn", "der Werkzeug-Baustein (defineTool) ist nicht auffindbar; die Werkzeuge stehen nicht zur Verfuegung");
				return;
			}
			try {
				for (const definition of baueWerkzeuge({ defineTool, pfad, dienst })) {
					abmeldungen.push(ctx.tools.register(definition));
				}
				melden("info", `Werkzeuge ${WERKZEUG_BOARD} und ${WERKZEUG_NOTIZ} registriert; Ablage ${pfad}`);
			} catch (fehler) {
				melden("warn", `Werkzeuge konnten nicht angemeldet werden: ${fehler instanceof Error ? fehler.message : String(fehler)}`);
			}
		})();
		return () => {
			if (abgemeldet === true) return;
			abgemeldet = true;
			for (const ab of abmeldungen) {
				try { ab(); } catch { /* beim Abbau ist alles verziehen */ }
			}
		};
	});

	melden("info", "geladen");
}

export const inject = ["tools"];
export const name = "team-board";
