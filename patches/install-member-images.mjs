#!/usr/bin/env node
/**
 * mitglied-bilder — Einrichtung auf einer Maschine
 * ===========================================================================
 * Richtet die Freigabe fuer Bild-Anhaenge im Mitglied-Chat auf DIESEM Rechner
 * ein. Einmal aufrufen, danach greift sie bei jedem Start von selbst.
 *
 * WAS ES TUT
 *   1. Legt die beiden Dateien nach <Harness-Zuhause>/patches/ (also
 *      ~/.dsh/patches/), falls sie dort noch nicht liegen.
 *   2. Traegt in jedem vorhandenen Profil einen Eintrag in
 *      profiles/<name>/cordis.patch.yml ein, der diese Datei beim Start laedt.
 *      Ist der Eintrag schon da, passiert nichts (mehrfach aufrufbar).
 *   3. Prueft das Ergebnis und meldet, was zu tun bleibt.
 *
 * Es wird NICHTS ueberschrieben und nichts geloescht: die Profildatei wird nur
 * ergaenzt, und nur, wenn der Eintrag fehlt.
 *
 * AUFRUF
 *   node patches/install-member-images.mjs
 *   node patches/install-member-images.mjs --status     # nur nachsehen
 *
 * Fuer ein anderes Zuhause (Probe, zweite Installation):
 *   DSH_HOME=/pfad/zu/home node patches/install-member-images.mjs
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, sep } from "node:path";

/** Kennung des Eintrags in der Profildatei. */
const EINTRAG_ID = "mitglied-bilder-freigabe";
/** Name der Datei, die geladen wird. */
const MODUL = "member-images.mjs";
/** Die Dateien, die im patches-Verzeichnis liegen muessen. */
const DATEIEN = [MODUL, "allow-member-images.mjs", "install-member-images.mjs"];

const nurNachsehen = process.argv.includes("--status");
const zuhause = process.env.DSH_HOME !== undefined && process.env.DSH_HOME.trim() !== "" ? process.env.DSH_HOME : join(homedir(), ".dsh");
const patches = join(zuhause, "patches");
const hier = import.meta.dirname;

console.log(`\nHarness-Zuhause: ${zuhause}`);

if (!existsSync(zuhause)) {
	console.error(`FEHLER: Dieses Verzeichnis gibt es nicht. Ist DSH_HOME richtig gesetzt?\n`);
	process.exit(1);
}

// --- 1. Die Dateien an ihren Platz legen -----------------------------------
if (!nurNachsehen) {
	mkdirSync(patches, { recursive: true });
	for (const datei of DATEIEN) {
		const quelle = join(hier, datei);
		const ziel = join(patches, datei);
		if (!existsSync(quelle)) {
			console.log(`  · ${datei}: nicht im Paket gefunden (${quelle}) — uebersprungen`);
			continue;
		}
		if (existsSync(ziel) && statSync(ziel).size === statSync(quelle).size) {
			console.log(`  = ${ziel} ist schon da`);
			continue;
		}
		copyFileSync(quelle, ziel);
		console.log(`  + ${ziel} eingerichtet`);
	}
} else {
	console.log(`  patches-Verzeichnis: ${existsSync(patches) ? patches : "fehlt"}`);
}

// --- 2. Den Eintrag in jedes Profil schreiben ------------------------------
const profileVerzeichnis = join(zuhause, "profiles");
const profile = existsSync(profileVerzeichnis)
	? readdirSync(profileVerzeichnis, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
	: [];

if (profile.length === 0) {
	console.log("  · Keine Profile gefunden — der Eintrag muss von Hand gesetzt werden.");
}

/** Den Eintrag als Textblock bauen; der Pfad wird relativ eingetragen. */
function blockFuer(profilVerzeichnis) {
	// Der Eintrag wird relativ zum Profilverzeichnis eingetragen, so wie der
	// Harness ihn aufloest (new URL(name, baseUrl)). Dadurch stimmt er auf jedem
	// Rechner und in jedem Zuhause, ohne fest verdrahtete Pfade.
	const relativ = relative(profilVerzeichnis, join(patches, MODUL)).split(sep).join("/");
	return [
		"# --- Mitglied-Chat: Bild-Anhaenge freigeben (lokaler Patch, kein Paket) ---",
		"# Das Web-GUI sperrt Anhaenge in der Unterhaltung mit einem Teammitglied, obwohl",
		"# der Host Bilder dort ausdruecklich annimmt. Dieser Eintrag laedt eine lokale",
		"# Datei, die genau diese Sperre beim Start lockert.",
		"#",
		`# Nachsehen:  node ${join(patches, "allow-member-images.mjs")} --status`,
		`# Zurueck:    node ${join(patches, "allow-member-images.mjs")} --revert`,
		"- insert:",
		`    - id: ${EINTRAG_ID}`,
		`      name: '${relativ}'`,
		""
	].join("\n");
}

/**
 * Den Eintrag in eine Patch-Liste eintragen. Drei Faelle, und der dritte ist
 * der Grund, warum das hier nicht einfach ein Anhaengen ist:
 *   - leere oder nur kommentierte Datei -> nur den Block schreiben
 *   - abgeschlossene Fliessliste "[]"    -> diese Zeile ERSETZEN, denn an eine
 *     abgeschlossene Fliessliste laesst sich keine Blockliste anhaengen; das
 *     ergaebe ungueltiges YAML
 *   - Blockliste ("- ...")               -> anhaengen
 * Alles andere wird abgelehnt, statt zu raten.
 */
function eintragen(inhalt, block) {
	const zeilen = inhalt.split("\n");
	const wirksam = zeilen.map((z) => z.trim()).filter((z) => z !== "" && !z.startsWith("#"));

	if (wirksam.length === 0) {
		// Leer oder nur Kommentare: anhaengen ist hier richtig, denn daraus wird
		// erst durch den Block eine gueltige Blockliste.
		return { text: `${inhalt === "" || inhalt.endsWith("\n") ? inhalt : `${inhalt}\n`}${block}` };
	}
	if (wirksam.length === 1 && wirksam[0] === "[]") {
		const stelle = zeilen.findIndex((z) => z.trim() === "[]");
		zeilen.splice(stelle, 1, block.replace(/\n$/, ""));
		return { text: zeilen.join("\n") };
	}
	if (!wirksam[0].startsWith("-")) {
		return { fehler: "Die Datei beginnt nicht mit einem Listenpunkt ('- ...'); das ist vermutlich keine Patch-Liste. Den Eintrag bitte von Hand ergaenzen." };
	}
	return { text: `${inhalt.endsWith("\n") ? inhalt : `${inhalt}\n`}\n${block}` };
}

let eingerichtet = 0;

for (const name of profile) {
	const profildatei = join(profileVerzeichnis, name, "cordis.patch.yml");
	const vorhanden = existsSync(profildatei);
	const inhalt = vorhanden ? readFileSync(profildatei, "utf8") : "";

	if (vorhanden && inhalt.includes(EINTRAG_ID)) {
		console.log(`  = Profil "${name}": Eintrag ist schon vorhanden`);
		continue;
	}
	if (nurNachsehen) {
		console.log(`  - Profil "${name}": Eintrag FEHLT (${profildatei}${vorhanden ? "" : " — Datei gibt es noch nicht"})`);
		continue;
	}

	const ergebnis = eintragen(inhalt, blockFuer(join(profileVerzeichnis, name)));
	if (ergebnis.fehler !== undefined) {
		console.log(`  ! Profil "${name}": ${ergebnis.fehler}`);
		continue;
	}
	writeFileSync(profildatei, ergebnis.text);

	// Nachkontrolle: genau ein Eintrag, und die Datei ist gewachsen oder ersetzt.
	const kontrolle = readFileSync(profildatei, "utf8");
	const anzahl = kontrolle.split(EINTRAG_ID).length - 1;
	if (anzahl !== 1) {
		if (vorhanden) writeFileSync(profildatei, inhalt);
		else writeFileSync(profildatei, "");
		console.log(`  ! Profil "${name}": die Nachkontrolle ist fehlgeschlagen, der vorherige Stand wurde wiederhergestellt.`);
		continue;
	}
	eingerichtet += 1;
	console.log(`  + Profil "${name}": Eintrag ergaenzt (${vorhanden ? profildatei : `${profildatei} neu angelegt`})`);
}

// --- 3. Was zu tun bleibt --------------------------------------------------
console.log();
if (nurNachsehen) {
	console.log("Nur nachgesehen, nichts geaendert.\n");
} else if (eingerichtet > 0) {
	console.log("Fertig. Ein laufender Server uebernimmt den Eintrag sofort, wenn er");
	console.log("die Profildatei bemerkt; spaetestens beim naechsten Start.");
	console.log("Danach pruefen mit:");
	console.log(`  node ${join(patches, "allow-member-images.mjs")} --status\n`);
} else {
	console.log("Nichts zu tun — die Einrichtung war schon vollstaendig.\n");
}
