#!/usr/bin/env node
/**
 * mitglied-bilder — Kommandozeilen-Werkzeug
 * ===========================================================================
 * Gibt Bild-Anhaenge in der Unterhaltung mit einem Teammitglied frei (und
 * nimmt die Freigabe zurueck). Die eigentliche Logik steht in
 * `member-images.mjs`; hier steht nur die Bedienung.
 *
 * Normalerweise brauchst du dieses Werkzeug NICHT: der Eintrag
 * `mitglied-bilder-freigabe` im Profil wendet die Freigabe bei jedem Start von
 * selbst an. Es ist fuer den Fall da, dass du selbst nachsehen, von Hand
 * nachziehen oder auf einer Maschine ohne laufenden Server eingreifen willst.
 *
 * AUFRUF
 *   node ~/.dsh/patches/allow-member-images.mjs              # suchen + freigeben
 *   node ~/.dsh/patches/allow-member-images.mjs --status     # nur nachsehen
 *   node ~/.dsh/patches/allow-member-images.mjs --revert     # zuruecknehmen
 *   node ~/.dsh/patches/allow-member-images.mjs --target=<pfad/zur/client.js>
 *
 * Gefundene Installationen mit einer anderen Fassung werden uebersprungen
 * statt bearbeitet: aeltere oder neuere Fassungen haben diesen Code nicht, und
 * daran herumzuschreiben waere Unsinn.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CLIENT_PACKAGE, applyPatch, revertPatch, statusOf, statusOfFile } from "./member-images.mjs";

const argumente = process.argv.slice(2);
const modus = argumente.includes("--revert") ? "revert" : argumente.includes("--status") ? "status" : "apply";
const zielArgument = argumente.find((a) => a.startsWith("--target="));

/** Der Pfad hinter einem beliebigen `node_modules`-Wurzelverzeichnis. */
const RELATIVE = [
	// So liegt es in einer globalen Installation: das dsh-Paket bringt eigene
	// Abhaengigkeiten mit.
	join("@deepseek-ai", "dsh", "node_modules", ...CLIENT_PACKAGE.split("/"), "lib", "client.js"),
	// So liegt es, wenn ein Profil das Paket direkt installiert hat.
	join(...CLIENT_PACKAGE.split("/"), "lib", "client.js")
];

/** Wurzelverzeichnisse, unter denen eine DSH-Installation liegen kann. */
function nodeModuleWurzeln() {
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

	// Profile des Harness: dort koennen Pakete ebenfalls liegen.
	for (const name of unterverzeichnisse(join(heim, ".dsh", "profiles"))) {
		listen.push(join(heim, ".dsh", "profiles", name, "node_modules"));
	}

	// Der npx-Zwischenspeicher, den `npx @deepseek-ai/dsh` benutzt.
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

/** Alle gefundenen Client-Dateien, ohne Doppelte. */
function findeZiele() {
	const treffer = new Set();
	for (const wurzel of nodeModuleWurzeln()) {
		for (const relativ of RELATIVE) {
			const kandidat = join(wurzel, relativ);
			if (existsSync(kandidat)) treffer.add(kandidat);
		}
	}
	return [...treffer];
}

/** Fassung des Pakets, zu dem diese Datei gehoert (fuer die Anzeige). */
function fassung(pfad) {
	try {
		const manifest = JSON.parse(readFileSync(join(pfad, "..", "..", "package.json"), "utf8"));
		return typeof manifest.version === "string" ? manifest.version : "?";
	} catch {
		return "?";
	}
}

/** Pfad lesbar machen: das eigene Zuhause wird zu "~". */
function kuerze(pfad) {
	const heim = homedir();
	return pfad.startsWith(heim) ? `~${pfad.slice(heim.length)}` : pfad;
}

const ziele = zielArgument === undefined ? findeZiele() : [zielArgument.slice("--target=".length)];

if (ziele.length === 0) {
	console.error("\nFEHLER: Keine DSH-Installation gefunden.");
	console.error("Nenne die Datei ausdruecklich mit --target=<pfad/zur/client.js>.\n");
	process.exit(1);
}

console.log(`\nGefundene Installationen: ${ziele.length}`);

let geaendert = 0;
let uebersprungen = 0;
let probleme = 0;

for (const ziel of ziele) {
	if (!existsSync(ziel)) {
		probleme += 1;
		console.log(`  ! ${kuerze(ziel)}\n      Gibt es nicht (mehr).`);
		continue;
	}
	const vorher = statusOfFile(ziel);
	const version = fassung(ziel);
	const kopf = `${kuerze(ziel)} (Fassung ${version})`;

	if (modus === "status") {
		const stand = vorher.state === "freigegeben" ? "Bilder freigegeben"
			: vorher.state === "gesperrt" ? "Sperre aktiv"
			: "diese Fassung kennt der Patch nicht";
		console.log(`  ${vorher.state === "freigegeben" ? "+" : vorher.state === "gesperrt" ? "-" : "?"} ${kopf}\n      ${stand}`);
		continue;
	}

	// Passt der Anker nicht, ist das keine Panne, sondern eine andere Fassung.
	if (vorher.state === "unbekannt") {
		uebersprungen += 1;
		console.log(`  · ${kopf}\n      uebersprungen: diese Fassung hat den gesuchten Code nicht.`);
		continue;
	}

	const ergebnis = modus === "revert" ? revertPatch(ziel) : applyPatch(ziel);
	if (ergebnis.error !== undefined) {
		probleme += 1;
		console.log(`  ! ${kopf}\n      ${ergebnis.error}`);
		continue;
	}
	if (!ergebnis.changed) {
		const schon = statusOf(readFileSync(ziel, "utf8"));
		console.log(`  = ${kopf}\n      nichts zu tun (${schon === "freigegeben" ? "war schon freigegeben" : "keine Aenderung noetig"})`);
		continue;
	}
	geaendert += 1;
	console.log(`  + ${kopf}\n      ${modus === "revert" ? "Sperre wiederhergestellt" : `Bilder freigegeben (${ergebnis.steps.length} Stellen)`}`);
}

if (modus !== "status") {
	console.log(`\n${geaendert} geaendert, ${uebersprungen} uebersprungen, ${probleme} Problem(e).`);
	if (geaendert > 0) {
		console.log("Ein laufender Server bemerkt die Aenderung innerhalb einer halben Sekunde und laedt sie in den Browser.");
		console.log("Falls die Oberflaeche nicht von selbst neu laedt: Seite neu laden (F5).");
	}
}
console.log();
