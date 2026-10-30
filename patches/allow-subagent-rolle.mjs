#!/usr/bin/env node
/**
 * allow-subagent-rolle — Kommandozeilen-Werkzeug
 * ==============================================
 * Spielt in das Delegations-Werkzeug das Feld `rolle` ein: der Rollentext aus
 * ~/.dsh/rollen/<rolle>.md wird byte-gleich vor den Auftrag eines Facharbeiters
 * gestellt (gleicher Prompt-Anfang fuer alle Facharbeiter einer Rolle, damit der
 * Zwischenspeicher greift). Die Logik steht in `subagent-rolle.mjs`; hier steht
 * nur die Bedienung.
 *
 * AUFRUF
 *   node ~/.dsh/patches/allow-subagent-rolle.mjs             # einspielen
 *   node ~/.dsh/patches/allow-subagent-rolle.mjs --status    # nachsehen
 *   node ~/.dsh/patches/allow-subagent-rolle.mjs --revert    # zuruecknehmen
 *   node ~/.dsh/patches/allow-subagent-rolle.mjs --root=<pfad>
 * Selbstpruefung der Textumwandlung:
 *   node ~/.dsh/patches/subagent-rolle.mjs --test
 *
 * NACH DEM EINSPIELEN UND NACH DEM ZURUECKNEHMEN: `dsh web` neu starten.
 * Nach jedem DSH-Update muss das Einspielen wiederholt werden (doctor.sh sagt es).
 */

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { ERSETZUNGEN, PAKET, applyPatch, revertPatch, statusOf, protokolliere } from "./subagent-rolle.mjs";

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
	const ziel = join(homedir(), ".dsh", "patches", "backup-subagent-rolle", stempel);
	mkdirSync(ziel, { recursive: true });
	const ablage = join(ziel, relative("/", pfad).replaceAll(":", "_"));
	mkdirSync(dirname(ablage), { recursive: true });
	copyFileSync(pfad, ablage);
	writeFileSync(join(ziel, "ANLEITUNG.txt"), [
		"Sicherung von",
		`  ${pfad}`,
		"vor dem Einspielen des Rollenfeldes.",
		"",
		"Zuruecknehmen:",
		"  node ~/.dsh/patches/allow-subagent-rolle.mjs --revert",
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
	console.log("subagent-rolle.mjs neu gesucht werden — nicht geraten.");
	console.log("  node ~/.dsh/patches/allow-subagent-rolle.mjs --root=/opt/homebrew/lib/node_modules");
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
		protokolliere(modus === "revert" ? "Rollenfeld zurueckgenommen." : "Rollenfeld eingespielt.");
		console.log(modus === "revert"
			? "Zurueckgenommen. Jetzt `dsh web` neu starten."
			: "Freigegeben. Jetzt `dsh web` neu starten — der Host hat das alte Modul im Speicher.");
	} else {
		console.log(`${fehler} Stelle(n) konnten nicht bearbeitet werden; dort wurde nichts geschrieben.`);
		process.exitCode = 1;
	}
}
