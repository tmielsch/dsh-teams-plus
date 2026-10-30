/**
 * subagent-model-fields — jedes Delegations-Werkzeug darf ein Modell waehlen
 * ========================================================================
 *
 * WAS DER MENSCH WOLLTE (Anordnung 2026-10-25)
 * "Es sollte moeglich sein ein modell entgegen zu nehmen, wie team mates es auch
 * koennen." Anlass war die Meldung: "Das delegate_task-Werkzeug dieser Sitzung
 * nimmt keine Modellangabe entgegen".
 *
 * WAS SCHIEF STAND (gemessen 2026-10-25, dsh 0.2.0-rc.2)
 * Die Konfiguration ist in Ordnung: `tool-delegate-task` steht im Profil auf
 * `modelSelectionSettings: true`, und die Liste erlaubter Modelle ist
 * eingeschaltet (`subagent-model-selection-settings`, 32 Routen). Das Feld
 * fehlt trotzdem, und zwar wegen einer Bedingung im Kern:
 *
 *   dsh-tool-subagent/lib/index.js, Funktion `selectForSession`:
 *       } else if (freshSession) {
 *           allowedModels = current.enabled ? current.allowedModels : void 0;
 *
 * `freshSession` ist nur wahr, wenn die Sitzung bei Ereignis 0 beginnt
 * (`firstLiveSeq === 0`) und dort kein `session/end-seed` steht. Fuer jede
 * SITZUNG, DIE FORTGESETZT WURDE, ist das falsch — und dann bleibt
 * `allowedModels` undefiniert. Folge: `modelSelectionEnabled` wird false, das
 * Werkzeug bekommt KEINE Felder `provider`, `model`, `reasoning_effort`, und
 * `list_subagent_models` wird gar nicht erst registriert.
 *
 * Weil Kinder die Liste vom Eltern erben, faerbt das nach unten: eine
 * Teammitglied-Sitzung, deren Lead fortgesetzt wurde, erbt "keine Liste" und
 * bekommt deshalb ebenfalls kein Modellfeld — obwohl `spawn_teammate` es hat
 * (der Weg dort ist ein anderer, siehe patches/teammate-model.mjs). Genau diese
 * Ungleichheit war der Anlass der Meldung.
 *
 * WAS DIESES MODUL TUT (eine Ersetzung, eine Datei)
 * Die Bedingung `freshSession` faellt weg. Jede WURZELSITZUNG bekommt die
 * eingeschaltete Liste, unabhaengig davon, ob sie neu oder fortgesetzt ist.
 * Kind-Sitzungen erben wie bisher von ihrem Eltern.
 *
 * WAS UNVERAENDERT BLEIBT
 *  - Die Liste bleibt die einzige Quelle (`subagent-model-selection-settings`).
 *    Ist sie abgeschaltet oder leer, bleibt das Feld weg — dann aber fuer alle
 *    gleich, und das ist die dokumentierte Absicht der Einstellung.
 *  - `assertAllowedModelSelection` prueft weiterhin jede genannte Route gegen
 *    die Liste. Ein Modell ausserhalb der Liste wird abgelehnt, nicht stilvoll
 *    ignoriert.
 *  - Ohne Angabe erbt das Kind die Route des Eltern; daran aendert sich nichts.
 *
 * RUECKGAENGIG
 *   node ~/.dsh/patches/allow-subagent-model-fields.mjs --revert
 *   danach `dsh web` neu starten.
 *
 * Selbstpruefung (ohne Datei-Eingriff):
 *   node ~/.dsh/patches/subagent-model-fields.mjs --test
 */

import { appendFileSync, readFileSync, renameSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Paket, dessen eine Bedingung faellt. */
export const PAKET = "@deepseek-ai/dsh-tool-subagent";

/** Kennung im Quelltext; ihr Vorhandensein heisst "schon freigegeben". */
export const MARKER = "subagentModelFieldsForAllRoots";

/** Die eine Ersetzung. */
export const MODELLFELDER = {
	id: "wurzelsitzung",
	was: "Modellwahl fuer jede Wurzelsitzung (auch fortgesetzte), nicht nur fuer frische",
	datei: "lib/index.js",
	vorher: `			} else if (freshSession) {
				const current = settings.current();
				allowedModels = current.enabled ? current.allowedModels : void 0;`,
	nachher: `			} else if (true) {
				// ${MARKER}: die Bedingung war \`freshSession\` und galt nur fuer Sitzungen,
				// die bei Ereignis 0 beginnen. Eine fortgesetzte Sitzung bekam deshalb keine
				// Liste, und damit verlor ihr Delegations-Werkzeug die Felder provider, model
				// und reasoning_effort — obwohl die Einstellung eingeschaltet war und
				// spawn_teammate die Wahl laengst anbietet. Jetzt bekommt jede Wurzelsitzung
				// die eingeschaltete Liste; Kind-Sitzungen erben weiterhin vom Eltern.
				const current = settings.current();
				allowedModels = current.enabled ? current.allowedModels : void 0;`
};

export const ERSETZUNGEN = [MODELLFELDER];

/** Schreibt eine Zeile ins Protokoll; ein Fehler dabei stoert nie. */
export function protokolliere(text) {
	try {
		const pfad = process.env.DSH_SUBAGENT_MODEL_LOG ?? join(homedir(), ".dsh", "logs", "subagent-modellfelder.log");
		appendFileSync(pfad, `${new Date().toISOString()} ${text}\n`);
	} catch { /* Das Protokoll ist Beigabe, nie Bedingung. */ }
}

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
export function statusOf(source, id) {
	const ersetzung = ERSETZUNGEN.find((e) => e.id === id);
	if (ersetzung === undefined) return "unbekannt";
	if (zaehle(source, ersetzung.nachher) === 1) return "freigegeben";
	if (zaehle(source, ersetzung.vorher) === 1) return "gesperrt";
	return "unbekannt";
}

/** Reine Textumwandlung: freigeben. */
export function applyToSource(source, id) {
	const ersetzung = ERSETZUNGEN.find((e) => e.id === id);
	if (ersetzung === undefined) return { changed: false, error: `unbekannte Stelle "${id}"` };
	if (statusOf(source, id) === "freigegeben") return { changed: false, source, steps: [] };
	const n = zaehle(source, ersetzung.vorher);
	if (n !== 1) {
		return { changed: false, error: `Die Stelle "${ersetzung.was}" kommt ${n} mal vor (erwartet: genau 1). Nach einem DSH-Update hat sich der Code geaendert; es wurde nichts geschrieben.` };
	}
	return { changed: true, source: source.replace(ersetzung.vorher, ersetzung.nachher), steps: [ersetzung.was] };
}

/** Reine Textumwandlung: zuruecknehmen. */
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

/** Schreibt eine Datei ersetzend: erst daneben, dann umbenennen (unteilbar). */
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
	if (statusOf(readFileSync(pfad, "utf8"), id) !== "freigegeben") {
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
	if (statusOf(readFileSync(pfad, "utf8"), id) !== "gesperrt") {
		atomarSchreiben(pfad, original);
		return { changed: false, error: "Die Nachkontrolle nach dem Schreiben ist fehlgeschlagen; der vorherige Stand wurde wiederhergestellt." };
	}
	return { changed: true, steps: ergebnis.steps, pfad };
}

// ---------------------------------------------------------------------------
// Selbstpruefung: node ~/.dsh/patches/subagent-model-fields.mjs --test
// ---------------------------------------------------------------------------
if (process.argv.includes("--test")) {
	let fehlgeschlagen = 0;
	const pruefe = (ist, soll, was) => {
		if (JSON.stringify(ist) !== JSON.stringify(soll)) {
			fehlgeschlagen += 1;
			console.log(`FEHLER  ${was}: ${JSON.stringify(ist)}, erwartet ${JSON.stringify(soll)}`);
		}
	};

	for (const ersetzung of ERSETZUNGEN) {
		pruefe(ersetzung.vorher === ersetzung.nachher, false, `${ersetzung.id}: vorher und nachher sind verschieden`);
		const einmal = applyToSource(ersetzung.vorher, ersetzung.id);
		pruefe(einmal.changed, true, `${ersetzung.id}: freigeben aendert etwas`);
		pruefe(applyToSource(einmal.source, ersetzung.id).changed, false, `${ersetzung.id}: zweimal freigeben ist harmlos`);
		const zurueck = revertFromSource(einmal.source, ersetzung.id);
		pruefe(zurueck.changed, true, `${ersetzung.id}: zuruecknehmen aendert etwas`);
		pruefe(zurueck.source, ersetzung.vorher, `${ersetzung.id}: Ruecknahme stellt den Ausgangstext her`);
		pruefe(applyToSource("nichts davon hier", ersetzung.id).error !== undefined, true, `${ersetzung.id}: fremder Text wird abgelehnt`);
	}

	// Der Zweck: die Bedingung darf NICHT mehr von `freshSession` abhaengen, und
	// die Liste muss weiter aus der Einstellung kommen. Ein Tippfehler hier
	// waere still — das Werkzeug ginge, das Feld fehlte weiter.
	pruefe(MODELLFELDER.nachher.includes("} else if (freshSession) {"), false, "die Bedingung haengt nicht mehr an freshSession");
	pruefe(MODELLFELDER.vorher.includes("} else if (freshSession) {"), true, "der Originaltext haengt an freshSession");
	pruefe(MODELLFELDER.nachher.includes("settings.current()"), true, "die Liste kommt weiter aus der Einstellung");
	pruefe(MODELLFELDER.nachher.includes("current.enabled"), true, "die Einstellung kann weiter abgeschaltet werden");
	pruefe(MODELLFELDER.nachher.includes(MARKER), true, "die Kennung steht darin");

	console.log(fehlgeschlagen === 0 ? "Selbstpruefung: alles in Ordnung." : `Selbstpruefung: ${fehlgeschlagen} Fehler.`);
	process.exitCode = fehlgeschlagen === 0 ? 0 : 1;
}
