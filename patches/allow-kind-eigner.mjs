#!/usr/bin/env node
/**
 * allow-kind-eigner — Kommandozeilen-Werkzeug
 * ===========================================
 * Macht den MENSCHEN zum zusaetzlichen Eigentuemer eines Kindes (Teammitglied, Unteragent): er kann es
 * wecken und ihm schreiben, ohne dass sein Elternteil lebt; das Eingabefeld im Browser bleibt frei; eine
 * Abschlussmeldung des Kindes wird bei kaltem Elternteil leise in dessen Posteingang gelegt. Die Logik steht in
 * `kind-eigner.mjs`; hier steht nur die Bedienung.
 *
 * AUFRUF
 *   node patches/allow-kind-eigner.mjs                      # suchen + freigeben
 *   node patches/allow-kind-eigner.mjs --status             # nur nachsehen
 *   node patches/allow-kind-eigner.mjs --revert             # zuruecknehmen
 *   node patches/allow-kind-eigner.mjs --root=<pfad>        # Wurzel erzwingen (zum Beispiel eine KOPIE des Kerns)
 *   node patches/allow-kind-eigner.mjs --sicherung=<ordner> # Sicherungsordner statt ~/.dsh/patches/backup-kind-eigner
 * Selbstpruefung der Textumwandlung (ohne Datei-Eingriff):
 *   node patches/kind-eigner.mjs --test
 *
 * Vor dem ersten Schreiben wird jede Kerndatei gesichert; Pruefsumme (sha256) vorher und nachher stehen in der
 * Ausgabe. Nach `--revert` ist jede Kerndatei byte-gleich zum Ausgangszustand (die Ausgabe zeigt die Pruefsumme).
 * Eine Abschlussmeldung, die der Patch schon in die Sitzungsdatei eines Elternteils gelegt hat, bleibt dort stehen.
 *
 * NACH DEM FREIGEBEN UND NACH DEM ZURUECKNEHMEN: `dsh web` neu starten (macht der Mensch) — der Host hat die alte
 * Fassung sonst weiter im Speicher, und der Browser laedt sein Skript neu beim Neuladen der Seite.
 */

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { ERSETZUNGEN, ZIELE, applyPatch, protokolliere, revertPatch, statusOf } from "./kind-eigner.mjs";

const argumente = process.argv.slice(2);
const modus = argumente.includes("--revert") ? "revert"
	: argumente.includes("--status") ? "status"
	: "apply";
const wert = (name) => argumente.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const zielArgument = wert("root");
const sicherungsOrdner = wert("sicherung") ?? join(homedir(), ".dsh", "patches", "backup-kind-eigner");

/**
 * Die beiden Ablageformen einer Installation.
 * 0 = globale Installation: dsh bringt seine Bausteine selbst mit.
 * 1 = Profil-Installation: die Bausteine liegen flach in der Wurzel.
 */
const ABLAGEFORMEN = [
	(wurzel, paket, datei) => join(wurzel, "@deepseek-ai", "dsh", "node_modules", ...paket.split("/"), datei),
	(wurzel, paket, datei) => join(wurzel, ...paket.split("/"), datei)
];

/** Die ueblichen Wurzeln, in denen eine dsh-Installation liegen kann. */
function wurzeln() {
	if (zielArgument !== undefined) return [zielArgument];
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

const sha = (pfad) => createHash("sha256").update(readFileSync(pfad)).digest("hex");

/** Findet vollstaendige Installationen: alle Zieldateien in genau einer Form, alle Stellen auffindbar. */
export function findeInstallationen(kandidaten) {
	const gefunden = [];
	for (const wurzel of kandidaten) {
		for (const form of ABLAGEFORMEN) {
			const dateien = new Map();
			let vollstaendig = true;
			for (const ziel of ZIELE) {
				const pfad = form(wurzel, ziel.paket, ziel.datei);
				let quelle;
				try { quelle = readFileSync(pfad, "utf8"); } catch { vollstaendig = false; break; }
				const passt = ERSETZUNGEN.filter((e) => e.paket === ziel.paket && e.datei === ziel.datei).every((e) => {
					const stand = statusOf(quelle, e.id);
					return stand === "gesperrt" || stand === "freigegeben";
				});
				if (!passt) { vollstaendig = false; break; }
				dateien.set(`${ziel.paket}|${ziel.datei}`, pfad);
			}
			if (vollstaendig) { gefunden.push({ wurzel, dateien }); break; }
		}
	}
	return gefunden;
}

/** Sichert die Originaldateien und schreibt eine Anleitung daneben. */
function sichere(pfade) {
	const stempel = new Date().toISOString().replace(/[:.]/gu, "-");
	const ziel = join(sicherungsOrdner, stempel);
	mkdirSync(ziel, { recursive: true });
	const abgelegt = [];
	for (const pfad of pfade) {
		const ablage = join(ziel, relative("/", pfad).replaceAll(":", "_"));
		mkdirSync(dirname(ablage), { recursive: true });
		copyFileSync(pfad, ablage);
		abgelegt.push(`  ${pfad}\n    -> ${ablage}\n    sha256 ${sha(pfad)}`);
	}
	writeFileSync(join(ziel, "ANLEITUNG.txt"), [
		"Sicherung der Kerndateien vor dem Patch kind-eigner (der Mensch als zusaetzlicher Eigentuemer eines Kindes).",
		"",
		...abgelegt,
		"",
		"Zuruecknehmen:",
		"  node patches/allow-kind-eigner.mjs --revert",
		"",
		"Falls das nicht mehr greift (nach einem DSH-Update), die Kopien zurueckkopieren (Pfade oben).",
		"Danach `dsh web` neu starten.",
		""
	].join("\n"), "utf8");
	return ziel;
}

const installationen = findeInstallationen(wurzeln());

if (installationen.length === 0) {
	console.log("Keine vollstaendige Installation mit allen Stellen gefunden.");
	console.log("Meist heisst das: ein DSH-Update hat den Text geaendert. Dann muss der Anker in");
	console.log("kind-eigner.mjs neu gesucht werden — nicht geraten.");
	console.log("  node patches/allow-kind-eigner.mjs --root=/opt/homebrew/lib/node_modules");
	process.exitCode = 1;
} else {
	let fehler = 0;
	for (const installation of installationen) {
		const pfade = [...installation.dateien.values()];
		console.log(`Wurzel: ${installation.wurzel}`);
		for (const pfad of pfade) console.log(`Datei: ${pfad}\n  sha256 vorher  ${sha(pfad)}`);
		console.log("");
		if (modus === "status") {
			for (const ersetzung of ERSETZUNGEN) {
				const pfad = installation.dateien.get(`${ersetzung.paket}|${ersetzung.datei}`);
				const stand = statusOf(readFileSync(pfad, "utf8"), ersetzung.id);
				const anzeige = stand === "freigegeben" ? "freigegeben " : stand === "gesperrt" ? "gesperrt    " : "UNBEKANNT   ";
				console.log(`  ${anzeige} ${ersetzung.id.padEnd(24)} ${ersetzung.was}`);
			}
			continue;
		}
		if (modus === "apply") {
			console.log(`Sicherung: ${sichere(pfade)}`);
			console.log("");
		}
		for (const ersetzung of ERSETZUNGEN) {
			const pfad = installation.dateien.get(`${ersetzung.paket}|${ersetzung.datei}`);
			const ergebnis = modus === "revert" ? revertPatch(pfad, ersetzung.id) : applyPatch(pfad, ersetzung.id);
			if (ergebnis.error !== undefined) {
				fehler += 1;
				console.log(`  FEHLER       ${ersetzung.id.padEnd(24)} ${ergebnis.error}`);
			} else if (ergebnis.changed) {
				console.log(`  ${modus === "revert" ? "zurueck    " : "freigegeben"} ${ersetzung.id.padEnd(24)} ${ersetzung.was}`);
			} else {
				console.log(`  unveraendert ${ersetzung.id.padEnd(24)} (war schon ${modus === "revert" ? "gesperrt" : "freigegeben"})`);
			}
		}
		console.log("");
		for (const pfad of pfade) console.log(`Datei: ${pfad}\n  sha256 nachher ${sha(pfad)}`);
	}

	console.log("");
	if (modus === "status") {
		// Im Status-Modus ist nichts geschehen.
	} else if (fehler === 0) {
		protokolliere(modus === "revert" ? "Kind-Eigner zurueckgenommen." : "Kind-Eigner freigegeben: der Mensch ist zusaetzlicher Eigentuemer eines Kindes.");
		console.log(modus === "revert"
			? "Zurueckgenommen. Jetzt `dsh web` neu starten."
			: "Freigegeben. Jetzt `dsh web` neu starten — der Host hat das alte Modul im Speicher.");
	} else {
		console.log(`${fehler} Stelle(n) konnten nicht bearbeitet werden; dort wurde nichts geschrieben.`);
		process.exitCode = 1;
	}
}
