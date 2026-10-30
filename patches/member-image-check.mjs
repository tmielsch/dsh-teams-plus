/**
 * mitglied-bildpruefung — Bildpruefung richtet sich nach dem GEWAEHLTEN Modell
 * ===========================================================================
 * Ein Teammitglied, das mit einem Text-Modell (z. B. deepseek-v4-pro) angelegt
 * und danach per Modellwahl (siehe member-model.mjs) auf ein Bild-Modell
 * umgestellt wurde, bekam beim Senden eines Bildes weiter die Meldung, es solle
 * auf ein Vision-Modell umgeschaltet werden. Ursache: Vor jeder Nachricht mit
 * Bild ruft der Server `assertImageCapable` auf, und das liest nur das Modell
 * aus der Anlage des Mitglieds (`agent.options`), nie die spaetere Wahl.
 *
 * Dieses Plugin ersetzt die Methode auf dem Verwalter der fortsetzbaren
 * Mitglieder (im Speicher des laufenden Servers; keine Datei im Paket wird
 * angefasst): Gibt es im Protokoll des Mitglieds eine `model/selection`, gilt
 * die letzte Wahl, sonst wie bisher das Anlage-Modell. Die eigentliche Pruefung
 * (Bildfaehigkeit laut Modellkatalog) macht weiter der Originalcode.
 *
 * RUECKGAENGIG: Eintrag `mitglied-bildpruefung` aus der cordis.patch.yml nehmen.
 * Protokoll der Entscheidungen: ~/.dsh/logs/mitglied-bildpruefung.log
 */

import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const name = "mitglied-bildpruefung";

const MARKE = Symbol.for("mitglied-bildpruefung.ersatz");

export function apply(ctx) {
	const logDatei = join(homedir(), ".dsh", "logs", "mitglied-bildpruefung.log");
	const notiere = (text) => {
		try { appendFileSync(logDatei, `${new Date().toISOString()} ${text}\n`); } catch { /* nur Beigabe */ }
	};
	const melden = (stufe, text) => {
		try { if (typeof ctx.logger?.[stufe] === "function") ctx.logger[stufe](text); } catch { /* nie den Start stoeren */ }
	};

	/** Letzte ausdrueckliche Modellwahl dieser Sitzung, sonst undefined. */
	const letzteWahl = (agent) => {
		try {
			const ereignisse = agent.session.ownEvents();
			for (let i = ereignisse.length - 1; i >= 0; i -= 1) {
				const e = ereignisse[i];
				if (e.type === "model/selection" && typeof e.data?.provider === "string" && typeof e.data?.model === "string") return { provider: e.data.provider, model: e.data.model };
			}
		} catch { /* ohne lesbares Protokoll gilt das Anlage-Modell */ }
		return undefined;
	};

	let prototyp;
	let urspruenglich;
	let timer;
	let versuche = 0;

	const einbauen = () => {
		let manager;
		try { manager = ctx.get("subagents")?.continuations; } catch { manager = undefined; }
		if (manager === undefined) {
			versuche += 1;
			if (versuche < 80) return false;
			melden("warn", "mitglied-bildpruefung: der Verwalter fortsetzbarer Mitglieder blieb unauffindbar; nichts umgebogen.");
			notiere("FEHLER: Verwalter nicht gefunden, nichts umgebogen.");
			return true;
		}
		prototyp = Object.getPrototypeOf(manager);
		const aktuell = prototyp.assertImageCapable;
		if (typeof aktuell !== "function") {
			melden("warn", "mitglied-bildpruefung: assertImageCapable fehlt (DSH-Update?); nichts umgebogen.");
			notiere("FEHLER: assertImageCapable fehlt, nichts umgebogen.");
			return true;
		}
		// Eine fruehere Fassung (nach Neuladen) wird ersetzt, nicht gestapelt.
		urspruenglich = aktuell[MARKE] === true ? aktuell.original : aktuell;
		const ersatz = async function (agent, signal) {
			const wahl = letzteWahl(agent);
			if (wahl === undefined) return urspruenglich.call(this, agent, signal);
			const optionen = agent?.options ?? {};
			notiere(`Bildpruefung: angelegt mit ${optionen.provider}/${optionen.model}, geprueft wird gegen die Wahl ${wahl.provider}/${wahl.model}`);
			return urspruenglich.call(this, { options: { ...optionen, provider: wahl.provider, model: wahl.model } }, signal);
		};
		ersatz[MARKE] = true;
		ersatz.original = urspruenglich;
		prototyp.assertImageCapable = ersatz;
		notiere("Bildpruefung umgebogen (aktiv).");
		melden("info", "mitglied-bildpruefung: Bildpruefung richtet sich nach der gewaehlten Modellwahl.");
		return true;
	};

	ctx.effect(() => {
		if (!einbauen()) timer = setInterval(() => {
			if (einbauen() && timer !== undefined) clearInterval(timer);
		}, 250);
		return () => {
			if (timer !== undefined) clearInterval(timer);
			if (prototyp !== undefined && urspruenglich !== undefined && prototyp.assertImageCapable?.[MARKE] === true) prototyp.assertImageCapable = urspruenglich;
		};
	}, "mitglied-bildpruefung");
}
