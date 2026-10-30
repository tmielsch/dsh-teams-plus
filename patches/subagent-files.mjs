/**
 * subagent-files — Dateien an einen Unteragenten, im Browser-Fenster
 * ==================================================================
 *
 * WAS DER MENSCH WOLLTE (2026-10-25, sinngemaess woertlich)
 * "Mit denen soll man schreiben koennen, an die soll man Bilder senden koennen,
 * Dateien senden koennen. Das sind einfach nur ganz normale Sessions, die
 * einfach von anderen Sessions gespawnt werden. Kein Unterschied."
 *
 * WAS BEREITS GEHT, OHNE DIESE DATEI
 *   - Ein Unteragent lebt weiter und nimmt Nachrichten an (`continuable` im
 *     Profil, Modul delegate-send.mjs fuer `agent_id`).
 *   - Bilder in seinem Chat: `member-images.mjs` lockert die Bueroklammer auf
 *     Bilder.
 *   - Dateien ueber die NACHRICHT an ihn: `delegate-send.mjs`, Feld `attach`.
 *
 * WAS DIESE DATEI ZUSATZLICH FREIGIBT
 * Die Bueroklammer (das Bueroklammer-Symbol im Eingabefeld) im Chat eines
 * Unteragenten nimmt eine BELIEBIGE Datei. Dafuer sind sieben Stellen zu
 * aendern, in fuenf Dateien — und zwar sowohl im Browser als auch im Host,
 * weil der Host den Weg selbst sperrt.
 *
 *  1. Oberflaeche, Eingang: die Freigabe aus `member-images.mjs` wirft alle
 *     Nicht-Bilder weg. Hier wird sie durchgereicht.
 *  2. Oberflaeche, Ablegen per Hineinziehen: dieselbe Bedingung.
 *  3. Oberflaeche, verstecktes Dateifeld: nicht mehr abgeschaltet.
 *  4. Browser-Datei-Upload (Host): `assertOrdinaryAgent` wirft fuer jede
 *     Sitzung mit `origin === "subagent"`. Diese eine Zeile faellt weg.
 *  5. Browser-Client der Sitzungs-Steuerung: der Zweig, der eine Datei an eine
 *     Kind-Sitzung mit SUBAGENT_FILE_UNSUPPORTED abweist, faellt weg. Danach
 *     geht die Datei denselben Weg wie ein Bild (subagents.prompt).
 *  6./7. Die Leitung (zwei generierte Codec-Dateien): die Inhalts-Union kennt
 *     nur `text` und `image`, beide im Modus `strict` — ein Datei-Teil wird
 *     also schon beim Entpacken abgelehnt. Beide bekommen einen dritten Zweig
 *     `{type:"file", receiptId}`; das ist genau die Form, die der normale
 *     Sitzungsweg im Browser schon benutzt.
 *  8. Host-Zustellung (`dsh-subagent`, `prompt()`): der Beleg (receiptId) muss
 *     gegen die dauerhafte Ablage der KIND-Sitzung aufgeloest werden, sonst
 *     kommt beim Kind ein Datei-Teil ohne Ablage an. Dieselbe Reihenfolge wie
 *     im normalen Sitzungsweg: aufloesen, aufnehmen, Beleg binden.
 *
 * WARUM DAS EIN EIGENES WERKZEUG IST UND NICHT EIN START-PLUGIN
 * Die Stellen 4 bis 8 liegen im Host. Der Host hat diese Module beim Start
 * schon geladen; ein Cordis-Plugin kann sie nicht mehr austauschen. Der Eingriff
 * muss also auf der Platte stehen, BEVOR `dsh web` startet. Deshalb ist dieses
 * Modul ein Kommandozeilen-Werkzeug: einmal anwenden, dann neu starten.
 *
 * WAS ES NICHT TUT
 *  - Es legt keine Sicherungsdateien an, sondern dreht dieselben Zeichenketten
 *    zurueck (wie `member-images.mjs`). Eine alte Vollsicherung waere nach
 *    einem Update eine Falle: sie wuerde eine fremde Fassung zurueckholen.
 *  - Jede Ersetzung muss GENAU EINMAL vorkommen. Sonst wird nichts geschrieben
 *    und die Meldung sagt, welche Stelle nicht mehr passt — das ist der Fall
 *    nach einem DSH-Update, und dann muss die Stelle neu gesucht werden, nicht
 *    blind geschrieben.
 *
 * RUECKGAENGIG
 *   node ~/.dsh/patches/allow-subagent-files.mjs --revert
 *   dann `dsh web` neu starten.
 */

import { readFileSync, readdirSync, renameSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Kennung im Quelltext; ihr Vorhandensein heisst "schon freigegeben". */
export const MARKER = "subagentFilesAllowed";

/** Die Pakete, deren Dateien angefasst werden. */
export const PAKETE = {
	subagent: "@deepseek-ai/dsh-subagent",
	upload: "@deepseek-ai/dsh-client-file-upload",
	controller: "@deepseek-ai/dsh-api-session-controller",
	conversation: "@deepseek-ai/dsh-client-ui-conversation"
};

/**
 * Die Ersetzungen. Jede traegt ihren Fundort, damit eine Meldung sagt, WO sie
 * nicht mehr passt. `vorher` ist der Originaltext, `nachher` der freigegebene;
 * Anwenden geht vorwaerts, Zuruecknehmen rueckwaerts mit denselben Zeichen-
 * ketten — so koennen beide Richtungen nicht auseinanderlaufen.
 */
export const ERSETZUNGEN = [
	{
		id: "leitung-remote",
		was: "Leitung (Browser-Codec): Datei-Teil annehmen",
		datei: "lib/typert.remote-client.js",
		paket: "subagent",
		vorher: `  'data': z.string().readonly(),
  'name': z.string().readonly().optional(),
})])).readonly(),`,
		nachher: `  'data': z.string().readonly(),
  'name': z.string().readonly().optional(),
}), z.object({
  'type': z.literal("file").readonly(),
  'receiptId': z.intersection(z.string(), z.unknown()).readonly(),
})])).readonly(), // subagentFilesAllowed`
	},
	{
		id: "leitung-host",
		was: "Leitung (Host-Codec): Datei-Teil annehmen",
		datei: "lib/typert.host.js",
		paket: "subagent",
		vorher: `  'data': z.string().readonly(),
  'name': z.string().readonly().optional(),
})])).readonly(),`,
		nachher: `  'data': z.string().readonly(),
  'name': z.string().readonly().optional(),
}), z.object({
  'type': z.literal("file").readonly(),
  'receiptId': z.intersection(z.string(), z.unknown()).readonly(),
})])).readonly(), // subagentFilesAllowed`
	},
	{
		id: "host-zustellung",
		was: "Host: Datei-Beleg gegen die Ablage der Kind-Sitzung aufloesen",
		datei: "lib/index.js",
		paket: "subagent",
		vorher: `					const attachments = this.ctx.get("attachments");
					if (attachments === void 0) throw new Error("subagent image prompt requires an attachment store");
					content = await attachments.admitPromptContent(request.content);`,
		nachher: `					const attachments = this.ctx.get("attachments");
					if (attachments === void 0) throw new Error("subagent image prompt requires an attachment store");
					// subagentFilesAllowed: ein Datei-Teil kommt als Beleg (receiptId) an —
					// die Bytes liegen schon in der Ablage der Kind-Sitzung. Erst hier wird
					// daraus eine dauerhafte Ablage, in derselben Reihenfolge wie im normalen
					// Sitzungsweg: aufloesen, aufnehmen, Beleg binden (damit der Beleg nach
					// der Zustellung aufgeraeumt wird und nicht liegen bleibt).
					let vorbereitet = request.content;
					if (request.content.some((part) => part.type === "file")) {
						const kindAgent = this.ctx.get("agents")?.get(childSessionId);
						const uploads = this.ctx.get("fileUploads");
						if (kindAgent === void 0 || uploads === void 0) throw new RemoteError("subagent/attachment-invalid", "file uploads are unavailable for this child session", { reason: "SUBAGENT_FILE_UNSUPPORTED" });
						const belege = [];
						vorbereitet = request.content.map((part) => {
							if (part.type !== "file") return part;
							const attachment = uploads.resolve(kindAgent, part.receiptId);
							if (attachment === void 0) throw new RemoteError("subagent/attachment-invalid", "File was not uploaded for this session.", { reason: "FILE_NOT_STAGED" });
							belege.push(part.receiptId);
							return { type: "file", attachment };
						});
						uploads.bindPrompt(kindAgent, belege, request.requestId);
					}
					content = await attachments.admitPromptContent(vorbereitet);`
	},
	{
		id: "upload-sperre",
		was: "Host: Datei-Upload fuer Unteragenten-Sitzungen freigeben",
		datei: "lib/index.js",
		paket: "upload",
		vorher: `			if (agent.session.header.origin === "subagent") throw new RemoteError("subagent/attachment-invalid", "subagent conversations do not accept file uploads", { reason: "SUBAGENT_FILE_UNSUPPORTED" });`,
		nachher: `			if (agent.session.header.origin === "subagent" && false) throw new RemoteError("subagent/attachment-invalid", "subagent conversations do not accept file uploads", { reason: "SUBAGENT_FILE_UNSUPPORTED" }); // subagentFilesAllowed`
	},
	{
		id: "client-sperre",
		was: "Browser-Client: Datei an eine Kind-Sitzung durchreichen statt abweisen",
		datei: "lib/client.js",
		paket: "controller",
		vorher: `				} else if (content.some((part) => part.type === "file")) result = {
					ok: false,
					error: new RemoteError("subagent/attachment-invalid", "subagent continuation does not accept files", { reason: "SUBAGENT_FILE_UNSUPPORTED" })
				};
				else {`,
		nachher: `				} else { // subagentFilesAllowed: files route through subagents.prompt like images`
	},
	{
		id: "ui-eingang",
		was: "Oberflaeche: Nicht-Bilder im Mitglied-Chat nicht mehr wegwerfen",
		datei: "lib/client.js",
		paket: "conversation",
		vorher: `if (subagent !== null) { const zugelassen = imageLimits === void 0 ? [] : files.filter((file) => imageLimits.mediaTypes.includes(file.type)); if (zugelassen.length < files.length) showToast(t("attachment.memberImagesOnly")); if (zugelassen.length === 0) return; files = zugelassen; }`,
		nachher: `if (false) { /* subagentFilesAllowed: Unteragenten nehmen jede Datei */ }`
	},
	{
		id: "ui-ziehen",
		was: "Oberflaeche: Hineinziehen im Mitglied-Chat erlauben",
		datei: "lib/client.js",
		paket: "conversation",
		vorher: `			const canAcceptDrop = (subagent === null || imageLimits !== void 0) && !locked && !machineBusy && addFiles !== void 0;`,
		nachher: `			const canAcceptDrop = !locked && !machineBusy && addFiles !== void 0; // subagentFilesAllowed`
	},
	{
		id: "ui-feld",
		was: "Oberflaeche: verstecktes Dateifeld freigeben",
		datei: "lib/client.js",
		paket: "conversation",
		vorher: `											disabled: subagent !== null && imageLimits === void 0,`,
		nachher: `											disabled: false, // subagentFilesAllowed`
	}
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

/**
 * Wurzelverzeichnisse, unter denen eine DSH-Installation liegen kann — dieselbe
 * Liste wie in `allow-member-images.mjs`, damit beide Werkzeuge dieselbe
 * Installation finden.
 */
export function nodeModuleWurzeln() {
	const heim = homedir();
	const listen = [
		"/opt/homebrew/lib/node_modules",
		"/usr/local/lib/node_modules",
		"/usr/lib/node_modules",
		join(heim, ".npm-global", "lib", "node_modules"),
		join(heim, ".local", "lib", "node_modules"),
		join(heim, ".local", "share", "pnpm", "global", "5", "node_modules"),
		join(heim, "AppData", "Roaming", "npm", "node_modules"),
		join(heim, "AppData", "Local", "pnpm", "global", "5", "node_modules"),
		(process.env.ProgramFiles ?? "") === "" ? "" : join(process.env.ProgramFiles, "nodejs", "node_modules")
	].filter((p) => p !== "");
	for (const name of unterverzeichnisse(join(heim, ".dsh", "profiles"))) listen.push(join(heim, ".dsh", "profiles", name, "node_modules"));
	for (const zwischenspeicher of [join(heim, ".npm", "_npx"), join(heim, "AppData", "Local", "npm-cache", "_npx")]) {
		for (const name of unterverzeichnisse(zwischenspeicher)) listen.push(join(zwischenspeicher, name, "node_modules"));
	}
	return listen;
}

/** Unterverzeichnisse lesen; Fehler still schlucken, das ist reine Bequemlichkeit. */
function unterverzeichnisse(pfad) {
	try {
		return readdirSync(pfad, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
	} catch {
		return [];
	}
}

/** Zustand eines Quelltexts, ohne ihn zu veraendern. */
export function statusOf(source, id) {
	const ersetzung = ERSETZUNGEN.find((e) => e.id === id);
	if (ersetzung === undefined) return "unbekannt";
	if (source.includes(ersetzung.nachher)) return "freigegeben";
	if (zaehle(source, ersetzung.vorher) === 1) return "gesperrt";
	return "unbekannt";
}

/** Reine Textumwandlung: eine Stelle freigeben. Wirft nie, meldet stattdessen. */
export function applyToSource(source, id) {
	const ersetzung = ERSETZUNGEN.find((e) => e.id === id);
	if (ersetzung === undefined) return { changed: false, error: `unbekannte Stelle "${id}"` };
	const stand = statusOf(source, id);
	if (stand === "freigegeben") return { changed: false, source, steps: [] };
	const n = zaehle(source, ersetzung.vorher);
	if (n !== 1) {
		return { changed: false, error: `Die Stelle "${ersetzung.was}" kommt ${n} mal vor (erwartet: genau 1). Nach einem DSH-Update hat sich der Code geaendert; es wurde nichts geschrieben.` };
	}
	return { changed: true, source: source.replace(ersetzung.vorher, ersetzung.nachher), steps: [ersetzung.was] };
}

/** Reine Textumwandlung: eine Stelle zuruecknehmen. */
export function revertFromSource(source, id) {
	const ersetzung = ERSETZUNGEN.find((e) => e.id === id);
	if (ersetzung === undefined) return { changed: false, error: `unbekannte Stelle "${id}"` };
	if (statusOf(source, id) !== "freigegeben") return { changed: false, source, steps: [] };
	const n = zaehle(source, ersetzung.nachher);
	if (n !== 1) {
		return { changed: false, error: `Die freigegebene Stelle "${ersetzung.was}" kommt ${n} mal vor (erwartet: genau 1). Zuruecknehmen waere unsicher; es wurde nichts geschrieben.` };
	}
	return { changed: true, source: source.replace(ersetzung.nachher, ersetzung.vorher), steps: [ersetzung.was] };
}

/**
 * Schreibt eine Datei ersetzend: erst daneben, dann umbenennen. Das Umbenennen
 * ist unteilbar, damit kein gleichzeitig laufender Leser eine halb geschriebene
 * Fassung sieht.
 */
function atomarSchreiben(pfad, inhalt) {
	const temp = `${pfad}.tmp-${process.pid}`;
	try {
		writeFileSync(temp, inhalt);
		renameSync(temp, pfad);
	} catch {
		try { unlinkSync(temp); } catch { /* Temp-Datei war schon weg. */ }
		writeFileSync(pfad, inhalt);
	}
}

/** Zustand einer Datei lesen, ohne sie anzufassen. */
export function statusOfFile(pfad, id) {
	try {
		return { state: statusOf(readFileSync(pfad, "utf8"), id), size: statSync(pfad).size, pfad };
	} catch (error) {
		return { state: "fehlt", error: String(error?.code ?? error), pfad };
	}
}

/** Freigabe auf eine Datei anwenden. */
export function applyPatch(pfad, id) {
	let original;
	try {
		original = readFileSync(pfad, "utf8");
	} catch (error) {
		return { changed: false, error: `Nicht lesbar: ${pfad} (${String(error?.code ?? error)})` };
	}
	const ergebnis = applyToSource(original, id);
	if (ergebnis.error !== undefined) return { changed: false, error: ergebnis.error };
	if (!ergebnis.changed) return { changed: false, steps: [], pfad };
	atomarSchreiben(pfad, ergebnis.source);
	const zurueck = readFileSync(pfad, "utf8");
	if (statusOf(zurueck, id) !== "freigegeben") {
		atomarSchreiben(pfad, original);
		return { changed: false, error: "Die Nachkontrolle nach dem Schreiben ist fehlgeschlagen; der Originalstand wurde wiederhergestellt." };
	}
	return { changed: true, steps: ergebnis.steps, pfad };
}

/** Freigabe auf eine Datei zuruecknehmen. */
export function revertPatch(pfad, id) {
	let original;
	try {
		original = readFileSync(pfad, "utf8");
	} catch (error) {
		return { changed: false, error: `Nicht lesbar: ${pfad} (${String(error?.code ?? error)})` };
	}
	const ergebnis = revertFromSource(original, id);
	if (ergebnis.error !== undefined) return { changed: false, error: ergebnis.error };
	if (!ergebnis.changed) return { changed: false, steps: [], pfad };
	atomarSchreiben(pfad, ergebnis.source);
	const zurueck = readFileSync(pfad, "utf8");
	if (statusOf(zurueck, id) !== "gesperrt") {
		atomarSchreiben(pfad, original);
		return { changed: false, error: "Die Nachkontrolle nach dem Schreiben ist fehlgeschlagen; der vorherige Stand wurde wiederhergestellt." };
	}
	return { changed: true, steps: ergebnis.steps, pfad };
}

// ---------------------------------------------------------------------------
// Selbstpruefung: node ~/.dsh/patches/subagent-files.mjs --test
// Reine Textumwandlung, ohne eine einzige Datei anzufassen.
// ---------------------------------------------------------------------------
const alsSelbstpruefung = process.argv.includes("--test");
if (alsSelbstpruefung) {
	let fehlgeschlagen = 0;
	const pruefe = (ist, soll, was) => {
		if (JSON.stringify(ist) !== JSON.stringify(soll)) {
			fehlgeschlagen += 1;
			console.log(`FEHLER  ${was}: ${JSON.stringify(ist)}, erwartet ${JSON.stringify(soll)}`);
		}
	};

	// Jede Ersetzung muss ihren eigenen Marker tragen oder als Paar stimmen.
	for (const ersetzung of ERSETZUNGEN) {
		pruefe(ersetzung.vorher === ersetzung.nachher, false, `${ersetzung.id}: vorher und nachher sind verschieden`);
		pruefe(zaehle(ersetzung.nachher, ersetzung.vorher), 0, `${ersetzung.id}: nachher enthaelt vorher nicht mehr`);
		const einmal = applyToSource(ersetzung.vorher, ersetzung.id);
		pruefe(einmal.changed, true, `${ersetzung.id}: freigeben aendert etwas`);
		const zurueck = revertFromSource(einmal.source, ersetzung.id);
		pruefe(zurueck.changed, true, `${ersetzung.id}: zuruecknehmen aendert etwas`);
		pruefe(zurueck.source, ersetzung.vorher, `${ersetzung.id}: Ruecknahme stellt den Ausgangstext her`);
		pruefe(applyToSource(einmal.source, ersetzung.id).changed, false, `${ersetzung.id}: zweimal freigeben ist harmlos`);
		pruefe(applyToSource("nichts davon hier", ersetzung.id).error !== undefined, true, `${ersetzung.id}: fremder Text wird abgelehnt`);
	}

	// Eine Datei, in der zwei Stellen stehen, wird von beiden beruehrt und
	// von keiner doppelt — der Fall UI (drei Stellen in einer Datei).
	const ui = [
		`if (subagent !== null) { const zugelassen = imageLimits === void 0 ? [] : files.filter((file) => imageLimits.mediaTypes.includes(file.type)); if (zugelassen.length < files.length) showToast(t("attachment.memberImagesOnly")); if (zugelassen.length === 0) return; files = zugelassen; }`,
		`			const canAcceptDrop = (subagent === null || imageLimits !== void 0) && !locked && !machineBusy && addFiles !== void 0;`,
		`											disabled: subagent !== null && imageLimits === void 0,`
	].join("\n");
	let quelle = ui;
	for (const id of ["ui-eingang", "ui-ziehen", "ui-feld"]) {
		const ergebnis = applyToSource(quelle, id);
		pruefe(ergebnis.changed, true, `${id}: greift in der gemeinsamen Datei`);
		quelle = ergebnis.source;
	}
	pruefe(quelle.includes(MARKER), true, "die Kennung steht in der Fassung");
	for (const id of ["ui-eingang", "ui-ziehen", "ui-feld"]) {
		pruefe(applyToSource(quelle, id).changed, false, `${id}: nochmal freigeben tut nichts`);
	}
	for (const id of ["ui-eingang", "ui-ziehen", "ui-feld"]) {
		const ergebnis = revertFromSource(quelle, id);
		pruefe(ergebnis.changed, true, `${id}: laesst sich zuruecknehmen`);
		quelle = ergebnis.source;
	}
	pruefe(quelle, ui, "nach drei Ruecknahmen steht wieder alles wie vorher");
	pruefe(quelle.includes(MARKER), false, "und die Kennung ist weg");

	// Der Host-Zustellungsteil muss die Ablage der Kind-Sitzung treffen, nicht
	// die der Eltern-Sitzung — sonst kommt der Beleg nie an.
	pruefe(ERSETZUNGEN.find((e) => e.id === "host-zustellung").nachher.includes("get(childSessionId)"), true, "die Kind-Sitzung wird adressiert");
	pruefe(ERSETZUNGEN.find((e) => e.id === "host-zustellung").nachher.includes("bindPrompt"), true, "der Beleg wird gebunden (und damit spaeter aufgeraeumt)");

	console.log(fehlgeschlagen === 0 ? "Selbstpruefung: alles in Ordnung." : `Selbstpruefung: ${fehlgeschlagen} Fehler.`);
	process.exitCode = fehlgeschlagen === 0 ? 0 : 1;
}
