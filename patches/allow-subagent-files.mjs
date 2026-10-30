#!/usr/bin/env node
/**
 * allow-subagent-files — Kommandozeilen-Werkzeug
 * ==============================================
 * Gibt die Bueroklammer im Chat eines Unteragenten fuer BELIEBIGE Dateien frei
 * (und nimmt die Freigabe zurueck). Die eigentliche Logik steht in
 * `subagent-files.mjs`; hier steht nur die Bedienung.
 *
 * WARUM EIN KOMMANDOZEILEN-WERKZEUG UND KEIN START-PLUGIN
 * Anders als bei den Bildern liegen die meisten Stellen im HOST (Upload-Sperre,
 * Sitzungs-Steuerung, Zustellung, zwei Codecs). Der Host hat diese Module beim
 * Start geladen; ein Cordis-Plugin kann sie nicht mehr austauschen. Der Eingriff
 * muss also auf der Platte stehen, bevor `dsh web` startet.
 *
 * AUFRUF
 *   node ~/.dsh/patches/allow-subagent-files.mjs                # suchen + freigeben
 *   node ~/.dsh/patches/allow-subagent-files.mjs --status       # nur nachsehen
 *   node ~/.dsh/patches/allow-subagent-files.mjs --revert       # zuruecknehmen
 *   node ~/.dsh/patches/allow-subagent-files.mjs --root=<pfad>  # Wurzel erzwingen
 * Selbstpruefung der Textumwandlung (ohne Datei-Eingriff):
 *   node ~/.dsh/patches/subagent-files.mjs --test
 *
 * NACH DEM FREIGEBEN UND NACH DEM ZURUECKNEHMEN: `dsh web` neu starten.
 *
 * WELCHE INSTALLATION GEMEINT IST — der Punkt, an dem die erste Fassung falsch lag
 * Eine Wurzel gilt nur dann als gemeint, wenn ALLE acht Stellen in ihr
 * vorhanden sind, und zwar in genau einer der beiden Ablageformen (globale
 * Installation: `@deepseek-ai/dsh/node_modules/…`; Profil-Installation: flach).
 * Grund, gemessen: ein alter npx-Zwischenspeicher
 * (`~/.npm/_npx/1e7f6d9597241db0/node_modules`) enthaelt nur einen Teil der
 * Bausteine. Die erste Fassung nahm die erstbeste passende Wurzel, meldete fuer
 * die fehlenden Bausteine "FEHLT" und fuer die vorhandenen faelschlich
 * "unveraendert (schon so)" — sie haette also nichts getan und Erfolg gemeldet.
 *
 * SICHERHEITSNETZ
 * Vor dem Freigeben werden die Originale jeder betroffenen Datei nach
 * `~/.dsh/patches/backup-subagent-files/<zeitstempel>/` kopiert, mit einer
 * ANLEITUNG.txt daneben. ABSICHTLICH ausserhalb von node_modules: eine
 * Sicherung dort wuerde nach einem DSH-Update eine fremde Fassung
 * zurueckholen. Die Kopie ist fuer den Fall, dass `--revert` nicht mehr greift,
 * weil ein Update den Text geaendert hat.
 */

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { ERSETZUNGEN, PAKETE, applyPatch, revertPatch, statusOf, nodeModuleWurzeln } from "./subagent-files.mjs";

const argumente = process.argv.slice(2);
const modus = argumente.includes("--revert") ? "revert"
	: argumente.includes("--status") ? "status"
	: "apply";
const zielArgument = argumente.find((a) => a.startsWith("--root="));

/**
 * Die beiden Ablageformen einer Installation.
 * 0 = globale Installation: dsh bringt seine Bausteine selbst mit.
 * 1 = Profil-Installation: die Bausteine liegen flach in der Wurzel.
 */
const ABLAGEFORMEN = [
	(wurzel, paket, datei) => join(wurzel, "@deepseek-ai", "dsh", "node_modules", ...paket.split("/"), datei),
	(wurzel, paket, datei) => join(wurzel, ...paket.split("/"), datei)
];

/**
 * Findet vollstaendige Installationen.
 *
 * @param {string[]} wurzeln - Kandidaten.
 * @returns {{wurzel: string, form: number, pfade: Map<string, string>}[]}
 *          je Wurzel hoechstens ein Treffer.
 */
export function findeInstallationen(wurzeln) {
	const gefunden = [];
	for (const wurzel of wurzeln) {
		for (const [index, form] of ABLAGEFORMEN.entries()) {
			const pfade = new Map();
			let passt = true;
			for (const ersetzung of ERSETZUNGEN) {
				const pfad = form(wurzel, PAKETE[ersetzung.paket], ersetzung.datei);
				let quelle;
				try { quelle = readFileSync(pfad, "utf8"); } catch { passt = false; break; }
				const stand = statusOf(quelle, ersetzung.id);
				if (stand !== "gesperrt" && stand !== "freigegeben") { passt = false; break; }
				pfade.set(ersetzung.id, pfad);
			}
			if (passt) { gefunden.push({ wurzel, form: index, pfade }); break; }
		}
	}
	return gefunden;
}

/**
 * Schreibt eine Sicherung der betroffenen Dateien und eine Anleitung daneben.
 *
 * @param {string[]} pfade - die Originaldateien.
 * @returns {string} das Sicherungsverzeichnis.
 */
function sichere(pfade) {
	const stempel = new Date().toISOString().replace(/[:.]/gu, "-");
	const ziel = join(homedir(), ".dsh", "patches", "backup-subagent-files", stempel);
	mkdirSync(ziel, { recursive: true });
	const kopien = [];
	for (const pfad of new Set(pfade)) {
		const ablage = join(ziel, relative("/", pfad).replaceAll(":", "_"));
		mkdirSync(dirname(ablage), { recursive: true });
		copyFileSync(pfad, ablage);
		kopien.push(`  ${pfad}\n      -> ${ablage}`);
	}
	writeFileSync(join(ziel, "ANLEITUNG.txt"), [
		"Sicherung der Originaldateien vor der Freigabe der Bueroklammer fuer Unteragenten.",
		"",
		"Diese Kopien sind fuer den Notfall: wenn",
		"  node ~/.dsh/patches/allow-subagent-files.mjs --revert",
		"nicht mehr greift (typisch nach einem DSH-Update, das den Text geaendert hat),",
		"die Datei von Hand zurueckkopieren:",
		"",
		...kopien,
		"",
		"Danach `dsh web` neu starten.",
		""
	].join("\n"), "utf8");
	return ziel;
}

const wurzeln = zielArgument !== undefined ? [zielArgument.slice("--root=".length)] : nodeModuleWurzeln();
const installationen = findeInstallationen(wurzeln);

if (installationen.length === 0) {
	console.log("Keine vollstaendige DSH-Installation mit allen acht Stellen gefunden.");
	console.log("");
	console.log("Das heisst meist: ein Update hat den Text geaendert. Dann muss der Ankertext in");
	console.log("subagent-files.mjs neu gesucht werden — nicht geraten. Eine Wurzel laesst sich");
	console.log("mit --root=<pfad> erzwingen, zum Beispiel:");
	console.log("  node ~/.dsh/patches/allow-subagent-files.mjs --root=/opt/homebrew/lib/node_modules");
	process.exitCode = 1;
} else {
	let fehler = 0;
	for (const installation of installationen) {
		console.log(`Installation: ${installation.wurzel}`);
		console.log(`Form:         ${installation.form === 0 ? "globale Installation (dsh bringt eigene Bausteine mit)" : "Profil-Installation (flach)"}`);
		console.log("");

		if (modus === "status") {
			for (const ersetzung of ERSETZUNGEN) {
				const stand = statusOf(readFileSync(installation.pfade.get(ersetzung.id), "utf8"), ersetzung.id);
				const anzeige = stand === "freigegeben" ? "freigegeben " : stand === "gesperrt" ? "gesperrt    " : "UNBEKANNT   ";
				console.log(`  ${anzeige} ${ersetzung.id.padEnd(16)} ${ersetzung.was}`);
			}
			const alleFrei = ERSETZUNGEN.every((e) => statusOf(readFileSync(installation.pfade.get(e.id), "utf8"), e.id) === "freigegeben");
			console.log("");
			console.log(alleFrei ? "Alles freigegeben." : "Noch nicht (vollstaendig) freigegeben.");
			continue;
		}

		if (modus === "apply") {
			console.log(`Sicherung der Originale: ${sichere([...installation.pfade.values()])}`);
			console.log("");
		}

		for (const ersetzung of ERSETZUNGEN) {
			const pfad = installation.pfade.get(ersetzung.id);
			const ergebnis = modus === "revert" ? revertPatch(pfad, ersetzung.id) : applyPatch(pfad, ersetzung.id);
			const kurz = ersetzung.id.padEnd(16);
			if (ergebnis.error !== undefined) {
				fehler += 1;
				console.log(`  FEHLER       ${kurz} ${ergebnis.error}`);
			} else if (ergebnis.changed) {
				console.log(`  ${modus === "revert" ? "zurueck    " : "freigegeben"} ${kurz} ${ersetzung.was}`);
			} else {
				console.log(`  unveraendert ${kurz} (war schon ${modus === "revert" ? "gesperrt" : "freigegeben"})`);
			}
		}
	}

	console.log("");
	if (modus === "status") {
		// Im Status-Modus ist nichts geschehen — also auch keine Schlussfolgerung
		// darueber, dass jetzt etwas neu gestartet werden muesste.
	} else if (fehler === 0) {
		console.log(modus === "revert"
			? "Zurueckgenommen. Jetzt `dsh web` neu starten."
			: "Freigegeben. Jetzt `dsh web` neu starten — der Host hat die alten Fassungen noch im Speicher.");
	} else {
		console.log(`${fehler} Stelle(n) konnten nicht bearbeitet werden; dort wurde nichts geschrieben.`);
		process.exitCode = 1;
	}
}
