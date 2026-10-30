#!/usr/bin/env node
/**
 * allow-subagent-model-fields — Kommandozeilen-Werkzeug
 * ====================================================
 * Gibt jedem Delegations-Werkzeug die Felder `provider`, `model` und
 * `reasoning_effort` — nicht nur frischen Sitzungen. Die eigentliche Logik steht
 * in `subagent-model-fields.mjs`; hier steht nur die Bedienung.
 *
 * WARUM DAS NOETIG IST
 * Die Konfiguration ist in Ordnung (`modelSelectionSettings: true` an
 * `tool-delegate-task`, Liste der erlaubten Modelle eingeschaltet). Der Kern
 * gibt die Felder trotzdem nur einer FRISCHEN Wurzelsitzung; eine fortgesetzte
 * bekommt keine Liste, und ihr Werkzeug verliert die Wahl. Weil Kinder die Liste
 * vom Eltern erben, verliert sie auch jedes Teammitglied unter einem
 * fortgesetzten Lead — genau die gemeldete Ungleichheit zu `spawn_teammate`.
 *
 * AUFRUF
 *   node ~/.dsh/patches/allow-subagent-model-fields.mjs             # freigeben
 *   node ~/.dsh/patches/allow-subagent-model-fields.mjs --status    # nachsehen
 *   node ~/.dsh/patches/allow-subagent-model-fields.mjs --revert    # zuruecknehmen
 *   node ~/.dsh/patches/allow-subagent-model-fields.mjs --root=<pfad>
 * Selbstpruefung der Textumwandlung:
 *   node ~/.dsh/patches/subagent-model-fields.mjs --test
 *
 * NACH DEM FREIGEBEN UND NACH DEM ZURUECKNEHMEN: `dsh web` neu starten.
 */

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { ERSETZUNGEN, PAKET, applyPatch, revertPatch, statusOf, protokolliere } from "./subagent-model-fields.mjs";

const argumente = process.argv.slice(2);
const modus = argumente.includes("--revert") ? "revert"
	: argumente.includes("--status") ? "status"
	: "apply";
const zielArgument = argumente.find((a) => a.startsWith("--root="));

/** Die beiden Ablageformen einer Installation. */
const ABLAGEFORMEN = [
	(wurzel) => join(wurzel, "@deepseek-ai", "dsh", "node_modules", ...PAKET.split("/"), "lib", "index.js"),
	(wurzel) => join(wurzel, ...PAKET.split("/"), "lib", "index.js")
];

/** Die ueblichen Wurzeln, in denen eine dsh-Installation liegen kann. */
function wurzeln() {
	if (zielArgument !== undefined) return [zielArgument.slice("--root=".length)];
	const heim = homedir();
	return [
		"/opt/homebrew/lib/node_modules",
		"/usr/local/lib/node_modules",
		"/usr/lib/node_modules",
		join(heim, ".npm-global", "lib", "node_modules"),
		join(heim, ".local", "lib", "node_modules"),
		join(heim, "AppData", "Roaming", "npm", "node_modules"),
		(process.env.ProgramFiles ?? "") === "" ? "" : join(process.env.ProgramFiles, "nodejs", "node_modules")
	].filter((p) => p !== "");
}

/** Findet vollstaendige Installationen (die Stelle in genau einer Form). */
export function findeInstallationen(kandidaten) {
	const gefunden = [];
	for (const wurzel of kandidaten) {
		for (const form of ABLAGEFORMEN) {
			const pfad = form(wurzel);
			let quelle;
			try { quelle = readFileSync(pfad, "utf8"); } catch { continue; }
			const passt = ERSETZUNGEN.every((e) => {
				const stand = statusOf(quelle, e.id);
				return stand === "gesperrt" || stand === "freigegeben";
			});
			if (passt) { gefunden.push({ wurzel, pfad }); break; }
		}
	}
	return gefunden;
}

/** Sichert die Originaldatei und schreibt eine Anleitung daneben. */
function sichere(pfad) {
	const stempel = new Date().toISOString().replace(/[:.]/gu, "-");
	const ziel = join(homedir(), ".dsh", "patches", "backup-subagent-model-fields", stempel);
	mkdirSync(ziel, { recursive: true });
	const ablage = join(ziel, relative("/", pfad).replaceAll(":", "_"));
	mkdirSync(dirname(ablage), { recursive: true });
	copyFileSync(pfad, ablage);
	writeFileSync(join(ziel, "ANLEITUNG.txt"), [
		"Sicherung von",
		`  ${pfad}`,
		"vor der Freigabe der Modellwahl fuer alle Wurzelsitzungen.",
		"",
		"Zuruecknehmen:",
		"  node ~/.dsh/patches/allow-subagent-model-fields.mjs --revert",
		"",
		"Falls das nicht mehr greift (nach einem DSH-Update), die Kopie zurueckkopieren:",
		`  -> ${ablage}`,
		"",
		"Danach `dsh web` neu starten.",
		""
	].join("\n"), "utf8");
	return ziel;
}

const installationen = findeInstallationen(wurzeln());

if (installationen.length === 0) {
	console.log("Keine vollstaendige Delegations-Installation mit der Stelle gefunden.");
	console.log("Meist heisst das: ein DSH-Update hat den Text geaendert. Dann muss der Anker in");
	console.log("subagent-model-fields.mjs neu gesucht werden — nicht geraten.");
	console.log("  node ~/.dsh/patches/allow-subagent-model-fields.mjs --root=/opt/homebrew/lib/node_modules");
	process.exitCode = 1;
} else {
	let fehler = 0;
	for (const installation of installationen) {
		console.log(`Datei: ${installation.pfad}`);
		console.log("");
		if (modus === "status") {
			for (const ersetzung of ERSETZUNGEN) {
				const stand = statusOf(readFileSync(installation.pfad, "utf8"), ersetzung.id);
				const anzeige = stand === "freigegeben" ? "freigegeben " : stand === "gesperrt" ? "gesperrt    " : "UNBEKANNT   ";
				console.log(`  ${anzeige} ${ersetzung.id.padEnd(14)} ${ersetzung.was}`);
			}
			continue;
		}
		if (modus === "apply") {
			console.log(`Sicherung: ${sichere(installation.pfad)}`);
			console.log("");
		}
		for (const ersetzung of ERSETZUNGEN) {
			const ergebnis = modus === "revert" ? revertPatch(installation.pfad, ersetzung.id) : applyPatch(installation.pfad, ersetzung.id);
			if (ergebnis.error !== undefined) {
				fehler += 1;
				console.log(`  FEHLER       ${ersetzung.id.padEnd(14)} ${ergebnis.error}`);
			} else if (ergebnis.changed) {
				console.log(`  ${modus === "revert" ? "zurueck    " : "freigegeben"} ${ersetzung.id.padEnd(14)} ${ersetzung.was}`);
			} else {
				console.log(`  unveraendert ${ersetzung.id.padEnd(14)} (war schon ${modus === "revert" ? "gesperrt" : "freigegeben"})`);
			}
		}
	}

	console.log("");
	if (modus === "status") {
		// Im Status-Modus ist nichts geschehen.
	} else if (fehler === 0) {
		protokolliere(modus === "revert" ? "Modellwahl-Felder zurueckgenommen." : "Modellwahl fuer alle Wurzelsitzungen freigegeben.");
		console.log(modus === "revert"
			? "Zurueckgenommen. Jetzt `dsh web` neu starten."
			: "Freigegeben. Jetzt `dsh web` neu starten — der Host hat das alte Modul im Speicher.");
	} else {
		console.log(`${fehler} Stelle(n) konnten nicht bearbeitet werden; dort wurde nichts geschrieben.`);
		process.exitCode = 1;
	}
}
