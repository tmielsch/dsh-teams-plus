/**
 * mitglied-bilder — Bild-Anhaenge im Mitglied-Chat freigeben
 * ===========================================================================
 * Dieses Modul hat zwei Gesichter, absichtlich:
 *
 *   1. Es ist ein Cordis-Plugin. Als Eintrag im Profil geladen, gibt es beim
 *      Start die Anhang-Sperre im Mitglied-Chat frei — automatisch, auf jeder
 *      Maschine, ohne Paketinstallation. Der genaue Dateipfad wird NICHT
 *      geraten: der Dienst `clientModules` kennt die Datei, die dieser Server
 *      tatsaechlich ausliefert, und nennt sie uns.
 *   2. Es exportiert `applyPatch`, `revertPatch` und `statusOf`, damit das
 *      Kommandozeilen-Werkzeug (allow-member-images.mjs) dieselbe Logik
 *      benutzt. Eine Umsetzung, zwei Zugaenge.
 *
 * WARUM UEBERHAUPT
 * Das Web-GUI sperrt Anhaenge in der Unterhaltung mit einem Teammitglied: die
 * Bueroklammer ist sichtbar, aber nicht drueckbar, und Einfuegen aus der
 * Zwischenablage tut nichts. Die Sperre sitzt in der Browser-Oberflaeche
 * (`@deepseek-ai/dsh-client-ui-conversation`), nicht im Host. Der Host nimmt
 * Bilder fuer eine fortfuehrbare Kind-Unterhaltung ausdruecklich an — er
 * verweigert dort nur generische DATEI-Anhaenge. Die Oberflaeche verbietet
 * also mehr als die Gegenseite. Genau diese eine Stelle lockern wir.
 *
 * WAS GEAENDERT WIRD (fuenf Zeichenketten, nichts weiter)
 *   1. intakeFiles steigt im Mitglied-Chat nicht mehr sofort aus, sondern
 *      behaelt nur Bilder und weist den Rest mit einem Hinweis ab. Diese eine
 *      Funktion bedient alle drei Wege: Dateidialog, Einfuegen, Hineinziehen.
 *   2. canAcceptDrop erlaubt den Mitglied-Chat -> Bueroklammer wird drueckbar.
 *   3. Das versteckte Dateifeld ist dort nicht mehr abgeschaltet.
 *   4+5. Je eine Textzeile (chinesisch und englisch) erklaert, dass nur Bilder
 *      angenommen werden.
 *
 * Die Ersetzungen sind ABSICHTLICH einzeilig und ohne Einrueckungsbezug: eine
 * gebaute Datei muss nicht huebsch sein, und so bleibt jede Ersetzung in beide
 * Richtungen eindeutig pruefbar. Jede Ersetzung muss genau einmal vorkommen,
 * sonst wird nichts geschrieben.
 *
 * WAS ES NICHT AENDERT
 * Generische Dateien bleiben im Mitglied-Chat unmoeglich. Der Host lehnt sie
 * selbst ab (`SUBAGENT_FILE_UNSUPPORTED` in @deepseek-ai/dsh-client-file-upload).
 * Dagegen hilft nur ein zweiter, groesserer Eingriff.
 *
 * RUECKGAENGIG
 * `revertPatch` dreht dieselben fuenf Ersetzungen zurueck. Es braucht keine
 * Sicherungsdatei — und das ist Absicht: eine alte Vollsicherung im
 * node_modules-Verzeichnis waere nach einem Update eine Falle, weil sie eine
 * fremde Fassung zurueckholen wuerde.
 */

import { readFileSync, renameSync, statSync, writeFileSync, unlinkSync } from "node:fs";

/** Paketname des Bausteins, dem der Eingabekasten gehoert. */
export const CLIENT_PACKAGE = "@deepseek-ai/dsh-client-ui-conversation";

/** Kennung im Quelltext; ihr Vorhandensein heisst "schon freigegeben". */
export const MARKER = "attachment.memberImagesOnly";

/** Die eingefuegte Zeile, woertlich — beide Richtungen pruefen dieselbe Zeichenkette. */
const GATE_ALT = "if (subagent !== null || addFiles === void 0 || files.length === 0) return;";
const GATE_NEU = "if (addFiles === void 0 || files.length === 0) return; if (subagent !== null) { const zugelassen = imageLimits === void 0 ? [] : files.filter((file) => imageLimits.mediaTypes.includes(file.type)); if (zugelassen.length < files.length) showToast(t(\"attachment.memberImagesOnly\")); if (zugelassen.length === 0) return; files = zugelassen; }";

const ZH_ALT = '"attachment.pathUnsupported": "\u8def\u5f84\u542b\u6709\u65e0\u6cd5\u5f15\u7528\u7684\u5b57\u7b26\uff0c\u8bf7\u6539\u540d\u540e\u518d\u8bd5",';
const ZH_NEU = `${ZH_ALT} "attachment.memberImagesOnly": "\u6210\u5458\u4f1a\u8bdd\u53ea\u63a5\u53d7\u56fe\u7247\uff0c\u5176\u4ed6\u6587\u4ef6\u5df2\u5ffd\u7565",`;

const EN_ALT = '"attachment.pathUnsupported": "The path contains characters a reference cannot carry; rename it and try again",';
const EN_NEU = `${EN_ALT} "attachment.memberImagesOnly": "Teammate chats accept images only; other files were ignored",`;

/**
 * Die fuenf Ersetzungen. `vorher` ist der Originaltext, `nachher` der
 * freigegebene. Anwenden geht vorwaerts, Zuruecknehmen rueckwaerts — dieselben
 * Zeichenketten, deshalb koennen beide Richtungen nicht auseinanderlaufen.
 */
export const ERSETZUNGEN = [
	{ was: "Anhang-Eingang: Bilder zulassen, Dateien abweisen", vorher: GATE_ALT, nachher: GATE_NEU },
	{ was: "Bueroklammer verfuegbar machen", vorher: "const canAcceptDrop = subagent === null && !locked && !machineBusy && addFiles !== void 0;", nachher: "const canAcceptDrop = (subagent === null || imageLimits !== void 0) && !locked && !machineBusy && addFiles !== void 0;" },
	{ was: "verstecktes Dateifeld freigeben", vorher: "disabled: subagent !== null,", nachher: "disabled: subagent !== null && imageLimits === void 0," },
	{ was: "Textzeile chinesisch", vorher: ZH_ALT, nachher: ZH_NEU },
	{ was: "Textzeile englisch", vorher: EN_ALT, nachher: EN_NEU }
];

/** Wie oft kommt `needle` in `haystack` vor? */
function zaehle(haystack, needle) {
	if (needle.length === 0) return 0;
	let n = 0;
	let i = haystack.indexOf(needle);
	while (i !== -1) {
		n += 1;
		i = haystack.indexOf(needle, i + needle.length);
	}
	return n;
}

/** Zustand eines Quelltexts, ohne ihn zu veraendern. */
export function statusOf(source) {
	if (source.includes(MARKER)) return "freigegeben";
	const treffer = ERSETZUNGEN.filter((e) => zaehle(source, e.vorher) === 1).length;
	return treffer === ERSETZUNGEN.length ? "gesperrt" : "unbekannt";
}

/** Reine Textumwandlung: freigeben. Wirft nie, meldet stattdessen. */
export function applyToSource(source) {
	if (statusOf(source) === "freigegeben") return { changed: false, source, steps: [] };
	const steps = [];
	for (const ersetzung of ERSETZUNGEN) {
		const n = zaehle(source, ersetzung.vorher);
		if (n !== 1) {
			return { changed: false, error: `Die Stelle "${ersetzung.was}" kommt ${n} mal vor (erwartet: genau 1). Vermutlich wurde DSH aktualisiert und der Code hat sich geaendert. Es wurde nichts geschrieben.` };
		}
		source = source.replace(ersetzung.vorher, ersetzung.nachher);
		steps.push(ersetzung.was);
	}
	return { changed: true, source, steps };
}

/** Reine Textumwandlung: Sperre wiederherstellen. */
export function revertFromSource(source) {
	if (statusOf(source) !== "freigegeben") return { changed: false, source, steps: [] };
	const steps = [];
	for (const ersetzung of [...ERSETZUNGEN].reverse()) {
		const n = zaehle(source, ersetzung.nachher);
		if (n !== 1) {
			return { changed: false, error: `Die freigegebene Stelle "${ersetzung.was}" kommt ${n} mal vor (erwartet: genau 1). Zuruecknehmen waere unsicher; es wurde nichts geschrieben.` };
		}
		source = source.replace(ersetzung.nachher, ersetzung.vorher);
		steps.push(ersetzung.was);
	}
	return { changed: true, source, steps };
}

/**
 * Schreibt eine Datei ersetzend: erst daneben, dann umbenennen. Das Umbenennen
 * ist unteilbar, damit der Waechter des Servers (er liest die Datei alle
 * 500 Millisekunden) nie eine halb geschriebene Fassung zu sehen bekommt.
 */
function atomarSchreiben(pfad, inhalt) {
	const temp = `${pfad}.tmp-${process.pid}`;
	try {
		writeFileSync(temp, inhalt);
		renameSync(temp, pfad);
	} catch (error) {
		try { unlinkSync(temp); } catch { /* Temp-Datei war schon weg. */ }
		writeFileSync(pfad, inhalt);
		void error;
	}
}

/** Freigabe auf eine Datei anwenden. */
export function applyPatch(pfad) {
	let original;
	try {
		original = readFileSync(pfad, "utf8");
	} catch (error) {
		return { changed: false, error: `Nicht lesbar: ${pfad} (${String(error?.code ?? error)})` };
	}
	const ergebnis = applyToSource(original);
	if (ergebnis.error !== undefined) return { changed: false, error: ergebnis.error };
	if (!ergebnis.changed) return { changed: false, steps: [], pfad };
	atomarSchreiben(pfad, ergebnis.source);
	// Nachkontrolle: nur melden, wenn es wirklich angekommen ist.
	const zurueck = readFileSync(pfad, "utf8");
	if (statusOf(zurueck) !== "freigegeben") {
		atomarSchreiben(pfad, original);
		return { changed: false, error: "Die Nachkontrolle nach dem Schreiben ist fehlgeschlagen; der Originalstand wurde wiederhergestellt." };
	}
	return { changed: true, steps: ergebnis.steps, pfad };
}

/** Freigabe auf eine Datei zuruecknehmen. */
export function revertPatch(pfad) {
	let original;
	try {
		original = readFileSync(pfad, "utf8");
	} catch (error) {
		return { changed: false, error: `Nicht lesbar: ${pfad} (${String(error?.code ?? error)})` };
	}
	const ergebnis = revertFromSource(original);
	if (ergebnis.error !== undefined) return { changed: false, error: ergebnis.error };
	if (!ergebnis.changed) return { changed: false, steps: [], pfad };
	atomarSchreiben(pfad, ergebnis.source);
	const zurueck = readFileSync(pfad, "utf8");
	if (statusOf(zurueck) !== "gesperrt") {
		atomarSchreiben(pfad, original);
		return { changed: false, error: "Die Nachkontrolle nach dem Schreiben ist fehlgeschlagen; der vorherige Stand wurde wiederhergestellt." };
	}
	return { changed: true, steps: ergebnis.steps, pfad };
}

/** Zustand einer Datei lesen, ohne sie anzufassen. */
export function statusOfFile(pfad) {
	try {
		return { state: statusOf(readFileSync(pfad, "utf8")), size: statSync(pfad).size, pfad };
	} catch (error) {
		return { state: "fehlt", error: String(error?.code ?? error), pfad };
	}
}

// ---------------------------------------------------------------------------
// Cordis-Plugin: derselbe Schnitt, aber beim Start und mit dem Pfad, den
// dieser Server wirklich ausliefert.
// ---------------------------------------------------------------------------

export const name = "mitglied-bilder-freigabe";

/**
 * Wir brauchen `clientModules`: dieser Dienst kennt die Datei hinter dem
 * Baustein. Ohne ihn gibt es in diesem Profil auch keinen Browser-Anteil, dann
 * hat der Eintrag nichts zu tun und bleibt einfach untaetig.
 */
export const inject = ["clientModules"];

export function apply(ctx) {
	const melden = (stufe, text) => {
		try {
			const logger = ctx.logger;
			if (logger !== undefined && typeof logger[stufe] === "function") logger[stufe](text);
		} catch { /* Ein fehlendes Protokoll darf nie den Start stoeren. */ }
	};

	let versuche = 0;
	let timer;

	const einmalVersuchen = () => {
		let ziel;
		try {
			ziel = ctx.clientModules.artifactBaseline(CLIENT_PACKAGE);
		} catch (error) {
			melden("warn", `mitglied-bilder: der Baustein ${CLIENT_PACKAGE} liess sich nicht abfragen: ${String(error)}`);
			return true; // Nicht endlos wiederholen.
		}
		if (ziel === undefined || typeof ziel.path !== "string") {
			versuche += 1;
			// Der Modulgraph wird beim Start zusammengesetzt; ein paar Runden
			// Geduld sind noetig, danach geben wir ehrlich auf.
			if (versuche < 40) return false;
			melden("warn", `mitglied-bilder: ${CLIENT_PACKAGE} ist nicht im Modulgraphen aufgetaucht; die Freigabe wurde nicht angewandt.`);
			return true;
		}
		const ergebnis = applyPatch(ziel.path);
		if (ergebnis.error !== undefined) {
			melden("warn", `mitglied-bilder: die Freigabe konnte nicht angewandt werden. ${ergebnis.error}`);
			return true;
		}
		if (!ergebnis.changed) {
			melden("info", `mitglied-bilder: bereits freigegeben (${ziel.path}).`);
			return true;
		}
		melden("info", `mitglied-bilder: freigegeben in ${ziel.path} (${ergebnis.steps.length} Stellen).`);
		// Sofort neu einlesen lassen, damit der Browser die Fassung ohne Wartezeit bekommt.
		try {
			ctx.clientModules.rebuilt(CLIENT_PACKAGE);
		} catch (error) {
			melden("warn", `mitglied-bilder: der Baustein wurde geaendert, aber das Neuladen scheiterte: ${String(error)}`);
		}
		return true;
	};

	ctx.effect(() => {
		if (!einmalVersuchen()) timer = setInterval(() => {
			if (einmalVersuchen() && timer !== undefined) clearInterval(timer);
		}, 250);
		return () => {
			if (timer !== undefined) clearInterval(timer);
		};
	}, "mitglied-bilder: Freigabe beim Start");
}
