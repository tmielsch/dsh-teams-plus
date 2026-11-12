/**
 * eltern-laden — jede Unteragenten-Sitzung ist jederzeit weckbar, auch wenn ihre Eltern-Sitzung „offline“ ist
 * ====================================================================================================
 *
 * STAND: gebaut auf dem Zweig `umsetzung/eltern-laden` (2026-11-12), noch nicht eingespielt. Plan:
 * `docs/PLAN-ELTERN-LADEN.md`, Messungen M1 bis M16: `docs/messung-eltern-laden/ERGEBNIS-2026-11-12.md`.
 * Es gibt (noch) keinen Eintrag in `cordis.patch.yml`; den macht der Lead beim Einspielen.
 * Anlass: Issue `tmielsch/DSH-Verwaltung` Nr. 175 (Unteragenten-Sitzung nicht anschreibbar, wenn die Eltern-Sitzung
 * offline ist); Fund Nr. 177 (Elternteil ist selbst ein Kind).
 *
 * WAS DER MENSCH WOLLTE (Issue 175, wörtlich)
 * „Ich muss jederzeit in der Lage sein, Subagent Sessions zu wecken. Das darf nicht an dem Parent Agent haengen.“ —
 * „Ich brauche keine Fehlermeldung. Ich muss das Problem geloest haben.“
 * Entschieden (Zielbrief Bau, 2026-11-12): (O1) die Lösung gilt auch außerhalb des Team-Modus, dieses Modul fragt
 * deshalb nie nach Team oder Team-Modus; (O2) eigener Notschalter `eltern-laden.json`; (O3) der Fall „Elternteil ist
 * selbst ein Kind“ bleibt eine bekannte Grenze (Issue 177), wird aber lesbar abgelehnt; (O4) schon das ÖFFNEN eines
 * Kindes lädt den Elternteil.
 *
 * WAS DIESES MODUL TUT
 * Der Kern lehnt das Anschreiben eines Kindes ab (`subagent/parent-unavailable`), solange die Eltern-Sitzung nicht
 * als Agent im Arbeitsspeicher lebt, und die Oberfläche sperrt das Eingabefeld, solange `agentAvailable` des
 * Elternteils nicht `true` ist. Dieses Modul lädt den Elternteil von selbst, über dieselbe Lade-Funktion, die der Kern
 * für `session.prompt` benutzt (der Lookup `agent` des Typert-Dienstes, Controller-Methode `resolve`, die gleichzeitige
 * Ladevorgänge selbst zusammenfasst). Laden startet weder eine Runde noch einen Modellaufruf noch ein Ziel (M2, M8).
 *  - Haken A, Anschreiben: `subagents.prompt` wird auf der Dienstinstanz umwickelt. Ist die Eltern-Sitzung kalt, wird
 *    sie geladen und das Laden ABGEWARTET, danach läuft das Original.
 *  - Haken B, Öffnen: `sessionController.page` und `sessionController.follow` werden umwickelt. Hat die Anfrage eine
 *    Adresse der Art `kind: "subagent"` und ist der Elternteil kalt, wird er im HINTERGRUND geladen (M16: das Öffnen
 *    wird nicht verzögert), das Original läuft sofort. Der Host meldet dem Client beim Laden `agentAvailable: true`
 *    (M5), und der Client entsperrt das Eingabefeld (Quelltext; im Browser noch nicht gesehen, Abnahme 7).
 *  - Fehler beim Laden werden gefangen und protokolliert; das Original läuft trotzdem und meldet dann seinen eigenen
 *    Fehler. Ein defekter oder fehlender Elternteil bricht das Öffnen nie ab (M13, M14).
 *  - Ein Elternteil, der selbst ein Kind ist, lässt sich so nicht laden (Lookup meldet `session/agent-busy`, M12). Das
 *    Modul schreibt dann die Protokollzeile `eltern-ist-kind` und hängt an den Fehler des Originals einen lesbaren
 *    Hinweis an; sonst ändert es nichts.
 *
 * WAS DIESES MODUL NICHT TUT
 *  - Es fragt nie nach Team oder Team-Modus (O1) und kennt keine einzelne Sitzung beim Namen: die Regel hängt nur an
 *    der Eigenschaft „Elternteil lebt nicht als Agent“ und am Fehlercode des Ladens.
 *  - Es fasst `patches/team-modus.mjs` nicht an (nur der Ordnername `datenOrdner()` wird von dort übernommen), keine
 *    Anweisungsdatei, keine Installation, kein Profil, keinen Dienst. Es rührt die Aktivierung des Kindes nie an.
 *  - Kein Neuladen, kein Weckruf, keine Zielaktivierung: Es lädt nur.
 *
 * NOTSCHALTER (O2)
 * `~/.dsh/.tm/teams-plus/eltern-laden.json` mit `{"aus": true}` schaltet NUR dieses Modul ab (alle Haken reichen dann
 * unverändert durch); gelesen bei jedem Aufruf, kein Neustart. Eine unlesbare Datei zählt als „aus“ und wird einmal
 * gemeldet. Getrennt vom Schalter des Team-Modus (`team-modus.json`): wer den drückt, will trotzdem anschreiben können.
 *
 * ROBUSTHEIT GEGEN UPDATES
 * Hängt an den Methodennamen `prompt` (Dienst `subagents`), `page` und `follow` (Dienst `sessionController`) und am
 * Lookup `agent`. Fehlt einer davon, schreibt das Modul das beim Start (Selbsttest) ins Protokoll und tut für diesen
 * Eingang nichts („fail open“: das Verhalten ist dann das heutige). `sessionController` und `typert` sind weich:
 * ein Profil ohne Web (Probe, headless) hat sie nicht.
 *
 * RÜCKGÄNGIG
 *   Notschalter: `{"aus": true}` in `eltern-laden.json` (sofort). Ganz: Eintrag aus `cordis.patch.yml` streichen und
 *   neu starten (Neustart nur durch den Menschen). Beim Abbau stellt das Modul die ursprünglichen Methoden wieder her.
 *
 * SELBSTPRÜFUNG   node --test test/eltern-laden.test.mjs
 * NACHSEHEN       ~/.dsh/.tm/teams-plus/logs/eltern-laden.log
 */

import { appendFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { datenOrdner } from "./team-modus.mjs";

export const name = "eltern-laden";

/** Cordis-Dienste, ohne die dieses Modul nichts tun kann. `sessionController` und `typert` werden weich geholt. */
export const inject = ["agents", "subagents"];

/** Der Hinweis, der an den Fehler des Originals gehängt wird, wenn der Elternteil selbst ein Kind ist (O3). */
export const HINWEIS_ELTERN_IST_KIND =
	"Teams Plus (eltern-laden): Die Eltern-Sitzung ist selbst ein Unteragent und kann nicht automatisch geladen werden. " +
	"Das ist eine bekannte Grenze (Issue DSH-Verwaltung 177); die Eltern-Sitzung muss zuerst von ihrem Vorgesetzten angeschrieben werden.";

// ---------------------------------------------------------------------------------------------------
// Ablage: Protokoll und Notschalter (eigene Dateien, getrennt vom Team-Modus)
// ---------------------------------------------------------------------------------------------------

export const notschalterPfad = () => join(datenOrdner(), "eltern-laden.json");
export const protokollPfad = () => join(datenOrdner(), "logs", "eltern-laden.log");

/** Eine Zeile ins Protokoll; ein fehlendes Recht darf nie eine Entscheidung verhindern. */
export function protokolliere(text, pfad = protokollPfad()) {
	try {
		mkdirSync(dirname(pfad), { recursive: true });
		appendFileSync(pfad, `${new Date().toISOString()} ${text}\n`);
	} catch { /* Protokoll ist Beiwerk. */ }
}

/** Letzter gelesener Stand, damit eine kaputte Datei nur EINMAL laut gemeldet wird (eigener Merker, nicht der des Team-Modus). */
const notschalterMerker = { schluessel: undefined, aus: false };

/**
 * Ist der Notschalter gedrückt? `{"aus": true}` → ja. Keine Datei → nein. Eine Datei, die sich nicht als Objekt
 * lesen lässt, zählt als „ja“ und wird einmal gemeldet.
 *
 * @param melde - `(text) => void`, bekommt die Meldung bei einer kaputten Datei (einmal je Stand).
 * @param pfad - nur für Tests.
 */
export function notschalterGedrueckt(melde = () => {}, pfad = notschalterPfad()) {
	let info;
	try { info = statSync(pfad); } catch { return false; }
	const schluessel = `${pfad}|${info.mtimeMs}|${info.size}`;
	if (notschalterMerker.schluessel === schluessel) return notschalterMerker.aus;
	let aus;
	try {
		const wert = JSON.parse(readFileSync(pfad, "utf8"));
		if (wert === null || typeof wert !== "object" || Array.isArray(wert)) throw new Error("kein Objekt");
		aus = wert.aus === true;
	} catch (fehler) {
		aus = true;
		melde(`Notschalter-Datei ${pfad} ist unlesbar (${fehler instanceof Error ? fehler.message : String(fehler)}); das Modul bleibt AUS`);
	}
	notschalterMerker.schluessel = schluessel;
	notschalterMerker.aus = aus;
	return aus;
}

// ---------------------------------------------------------------------------------------------------
// Reine Entscheidungen
// ---------------------------------------------------------------------------------------------------

/** Die Eltern-Kennung aus einer Anfrage an `subagents.prompt`; `undefined`, wenn keine brauchbare da ist. */
export function elternKennungAusAnschreiben(anfrage) {
	const kennung = anfrage?.parentSessionId;
	return typeof kennung === "string" && kennung !== "" ? kennung : undefined;
}

/** Die Eltern-Kennung aus einer Anfrage an `session.page` oder `session.follow`: nur Adressen der Art `subagent`. */
export function elternKennungAusOeffnen(anfrage) {
	const adresse = anfrage?.address;
	if (adresse?.kind !== "subagent") return undefined;
	const kennung = adresse.parentSessionId;
	return typeof kennung === "string" && kennung !== "" ? kennung : undefined;
}

/**
 * Ordnet den Fehler des Ladens ein.
 * `session/agent-busy`: die Sitzung gehört dem Unteragenten-Routing, der Elternteil ist selbst ein Kind (M12).
 * `session/not-found`: es gibt keine Datei zu dieser Kennung (M14). Alles andere ist ein sonstiger Fehler (M13).
 */
export function klassifiziereLadefehler(fehler) {
	const code = fehler?.code;
	if (code === "session/agent-busy") return "eltern-ist-kind";
	if (code === "session/not-found") return "eltern-fehlt";
	return "fehler";
}

/** Hängt den lesbaren Hinweis an die Meldung des Fehlers (einmal); gibt den Fehler zurück. */
export function haengeHinweisAn(fehler) {
	try {
		if (fehler !== null && typeof fehler === "object" && typeof fehler.message === "string" && !fehler.message.includes(HINWEIS_ELTERN_IST_KIND)) {
			fehler.message = `${fehler.message} — ${HINWEIS_ELTERN_IST_KIND}`;
		}
	} catch { /* ein schreibgeschützter Fehler bleibt, wie er ist */ }
	return fehler;
}

/** Wartet auf `versprechen`, bis es fertig ist oder `signal` abbricht (dann `undefined`). Das Versprechen läuft weiter. */
export function warteMitAbbruch(versprechen, signal) {
	if (signal === undefined || signal === null || typeof signal.addEventListener !== "function") return versprechen;
	if (signal.aborted) return Promise.resolve(undefined);
	return new Promise((fertig) => {
		const ab = () => fertig(undefined);
		signal.addEventListener("abort", ab, { once: true });
		versprechen.then(
			(wert) => { signal.removeEventListener("abort", ab); fertig(wert); },
			() => { signal.removeEventListener("abort", ab); fertig(undefined); }
		);
	});
}

// ---------------------------------------------------------------------------------------------------
// Der Lader: eine Menge „im Flug“, damit dieselbe Eltern-Sitzung nie doppelt angestoßen wird (zusätzlich zur Dedup des Controllers, M11)
// ---------------------------------------------------------------------------------------------------

/**
 * @param umgebung - `{ lebt(id)→bool, laedt(id)→Promise, protokoll(text), jetzt()→ms }`.
 *   `laedt` ist die Lade-Funktion des Kerns (Lookup `agent`, `resolve`); sie darf werfen.
 * @returns `{ lebt(id), laden(id, art, signal?)→Promise<{ergebnis}>, imFlugAnzahl() }`. `laden` wirft nie.
 *   Ergebnisse: `lebt-schon`, `geladen`, `eltern-ist-kind`, `eltern-fehlt`, `fehler`, `nicht-lebend`, `abgebrochen`.
 */
export function baueLader(umgebung) {
	const imFlug = new Map();
	const jetzt = umgebung.jetzt ?? (() => Date.now());

	const ladeEinmal = (id, art) => {
		const vorhanden = imFlug.get(id);
		if (vorhanden !== undefined) return vorhanden;
		const start = jetzt();
		umgebung.protokoll(`laedt art=${art} eltern=${id}`);
		const versprechen = (async () => {
			try {
				await umgebung.laedt(id);
			} catch (fehler) {
				const art2 = klassifiziereLadefehler(fehler);
				const code = fehler?.code ?? "-";
				if (art2 === "eltern-ist-kind") umgebung.protokoll(`eltern-ist-kind eltern=${id} code=${code}: Eltern-Sitzung ist selbst ein Kind, wird nicht geladen (bekannte Grenze, Issue 177)`);
				else if (art2 === "eltern-fehlt") umgebung.protokoll(`eltern-fehlt eltern=${id} code=${code}`);
				else umgebung.protokoll(`warn ladefehler eltern=${id} code=${code} meldung=${String(fehler?.message ?? fehler).slice(0, 160)}`);
				return { ergebnis: art2 };
			}
			if (!umgebung.lebt(id)) {
				umgebung.protokoll(`warn nicht-lebend eltern=${id}: Laden kehrte zurueck, der Elternteil lebt trotzdem nicht`);
				return { ergebnis: "nicht-lebend" };
			}
			umgebung.protokoll(`geladen eltern=${id} ms=${jetzt() - start}`);
			return { ergebnis: "geladen" };
		})().finally(() => { imFlug.delete(id); });
		imFlug.set(id, versprechen);
		return versprechen;
	};

	return {
		lebt: (id) => umgebung.lebt(id),
		imFlugAnzahl: () => imFlug.size,
		async laden(id, art, signal) {
			try {
				if (umgebung.lebt(id)) return { ergebnis: "lebt-schon" };
				const erg = await warteMitAbbruch(ladeEinmal(id, art), signal);
				return erg ?? { ergebnis: "abgebrochen" };
			} catch (fehler) {
				umgebung.protokoll(`warn lader eltern=${id}: ${fehler instanceof Error ? fehler.message : String(fehler)}`);
				return { ergebnis: "fehler" };
			}
		},
		/** Für Haken B: anstoßen, nicht abwarten. Wirft nie, gibt nichts zurück. */
		anstossen(id, art) {
			try {
				if (umgebung.lebt(id)) return;
				void ladeEinmal(id, art).catch(() => {});
			} catch (fehler) {
				umgebung.protokoll(`warn lader eltern=${id}: ${fehler instanceof Error ? fehler.message : String(fehler)}`);
			}
		}
	};
}

// ---------------------------------------------------------------------------------------------------
// Die Haken
// ---------------------------------------------------------------------------------------------------

/**
 * Ersetzt `objekt[methode]` durch eine Umwicklung und gibt die Rücknahme zurück; `undefined`, wenn es keine Methode ist.
 * Die Rücknahme setzt die Methode nur zurück, wenn noch unsere Umwicklung dort steht (hat jemand darüber umwickelt,
 * würde das Zurücksetzen dessen Umwicklung zerstören); sonst wird unsere Umwicklung stillgelegt (reicht durch).
 *
 * @param bauer - `(original, zustand) => neueMethode`; `zustand.aktiv` ist `false` nach der Rücknahme.
 */
export function umwickleMethode(objekt, methode, bauer) {
	const original = objekt?.[methode];
	if (typeof original !== "function") return undefined;
	const eigen = Object.prototype.hasOwnProperty.call(objekt, methode);
	const zustand = { aktiv: true };
	const neu = bauer(original, zustand);
	objekt[methode] = neu;
	return () => {
		zustand.aktiv = false;
		if (objekt[methode] !== neu) return;
		if (eigen) objekt[methode] = original;
		else delete objekt[methode];
	};
}

/**
 * Haken A: `subagents.prompt`. Ist der Elternteil kalt, wird er geladen und das Laden abgewartet, dann läuft das Original.
 *
 * @param dienst - der Dienst `subagents`.
 * @param lader - aus `baueLader`.
 * @param schalter - `() => bool`, `true` = Notschalter gedrückt (alles reicht durch).
 */
export function umwickleAnschreiben(dienst, lader, schalter) {
	return umwickleMethode(dienst, "prompt", (original, zustand) => async function elternLadenPrompt(anfrage, signal) {
		let eltern = false;
		if (zustand.aktiv && !schalter()) {
			const id = elternKennungAusAnschreiben(anfrage);
			if (id !== undefined && !lader.lebt(id)) {
				const erg = await lader.laden(id, "anschreiben", signal);
				eltern = erg.ergebnis === "eltern-ist-kind";
			}
		}
		if (!eltern) return Reflect.apply(original, this, [anfrage, signal]);
		try {
			return await Reflect.apply(original, this, [anfrage, signal]);
		} catch (fehler) {
			throw haengeHinweisAn(fehler);
		}
	});
}

/**
 * Haken B: `sessionController.page` und `.follow`. Der Elternteil wird im Hintergrund geladen, das Original läuft sofort.
 * `follow` ist ein asynchroner Generator; die Umwicklung ist eine gewöhnliche Funktion, die den Generator des Originals
 * unverändert zurückgibt, damit der Strom nicht verzögert wird.
 *
 * @returns die beiden Rücknahmen (je `undefined`, wenn die Methode fehlt).
 */
export function umwickleOeffnen(controller, lader, schalter) {
	const haken = (methode) => umwickleMethode(controller, methode, (original, zustand) => function elternLadenOeffnen(anfrage, signal) {
		try {
			if (zustand.aktiv && !schalter()) {
				const id = elternKennungAusOeffnen(anfrage);
				if (id !== undefined) lader.anstossen(id, `oeffnen-${methode}`);
			}
		} catch { /* ein Fehler im Haken darf das Öffnen nie abbrechen */ }
		return Reflect.apply(original, this, [anfrage, signal]);
	});
	return { page: haken("page"), follow: haken("follow") };
}

// ---------------------------------------------------------------------------------------------------
// Selbsttest
// ---------------------------------------------------------------------------------------------------

/**
 * @param befund - `{ prompt, page, follow, lookup }` (Wahrheitswerte); `page`/`follow` nur beurteilt, wenn der Controller da ist.
 * @returns `{ ok, abweichungen: string[] }`
 */
export function selbsttest(befund) {
	const abweichungen = [];
	if (!befund.prompt) abweichungen.push("subagents.prompt fehlt: das Anschreiben eines Kindes laedt den Elternteil nicht");
	if (befund.page === false) abweichungen.push("sessionController.page fehlt: das Oeffnen eines Kindes laedt ueber page nicht");
	if (befund.follow === false) abweichungen.push("sessionController.follow fehlt: das Oeffnen eines Kindes laedt ueber follow nicht");
	if (befund.lookup === false) abweichungen.push("Lookup agent (typert) fehlt: es gibt keinen Ladeweg, der Patch tut nichts");
	return { ok: abweichungen.length === 0, abweichungen };
}

// ---------------------------------------------------------------------------------------------------
// Einhängen in den Host
// ---------------------------------------------------------------------------------------------------

/**
 * @param ctx - der Cordis-Kontext des Profils.
 * @param optionen - nur für Tests: `{ protokollDatei, notschalterDatei }`.
 */
export function apply(ctx, optionen = {}) {
	const protokollDatei = optionen.protokollDatei;
	const meldeZeile = (text) => protokolliere(text, protokollDatei);
	const melden = (stufe, text) => {
		meldeZeile(`${stufe === "warn" ? "warn " : ""}${text}`);
		try { if (typeof ctx.logger?.[stufe] === "function") ctx.logger[stufe](`eltern-laden: ${text}`); } catch { /* Beiwerk */ }
	};
	const hole = (dienst) => { try { return ctx.get(dienst); } catch { return undefined; } };
	const schalter = () => notschalterGedrueckt((text) => melden("warn", text), optionen.notschalterDatei ?? notschalterPfad());
	const lookup = () => { try { return hole("typert")?.lookups?.get?.("agent"); } catch { return undefined; } };

	const lader = baueLader({
		lebt: (id) => ctx.agents.get(id) !== undefined,
		laedt: async (id) => {
			const weg = lookup();
			if (weg === undefined || typeof weg.resolve !== "function") throw new Error("Lookup agent fehlt");
			return weg.resolve(id);
		},
		protokoll: (text) => (text.startsWith("warn ") ? melden("warn", text.slice(5)) : meldeZeile(text))
	});

	ctx.effect(() => {
		const rueckholer = [];

		// Haken A.
		const rueckA = umwickleAnschreiben(ctx.subagents, lader, schalter);
		if (rueckA !== undefined) rueckholer.push(rueckA);
		const selbstA = selbsttest({ prompt: rueckA !== undefined });
		if (!selbstA.ok) melden("warn", `selbsttest ABWEICHUNG: ${selbstA.abweichungen.join("; ")}`);

		melden("info", `geladen (Haken A ${rueckA !== undefined ? "aktiv" : "FEHLT"}); Notschalter ${optionen.notschalterDatei ?? notschalterPfad()}`);
		return () => {
			for (const rueck of rueckholer) { try { rueck(); } catch { /* Abbau darf nicht werfen */ } }
			rueckholer.length = 0;
		};
	}, "eltern-laden anschreiben");

	// Haken B: der Controller gehört dem Web-Profil und kommt, wenn überhaupt, erst später. Weich einhängen.
	if (typeof ctx.inject === "function") {
		ctx.inject(["sessionController"], function elternLadenOeffnenEinhaengen(c) {
			c.effect(() => {
				const controller = hole("sessionController") ?? c.sessionController;
				const rueck = controller === undefined ? { page: undefined, follow: undefined } : umwickleOeffnen(controller, lader, schalter);
				const befund = selbsttest({ prompt: true, page: rueck.page !== undefined, follow: rueck.follow !== undefined, lookup: lookup() !== undefined });
				if (befund.ok) melden("info", "Haken B (Oeffnen) aktiv: page und follow umwickelt; selbsttest ok");
				else melden("warn", `Haken B: selbsttest ABWEICHUNG: ${befund.abweichungen.join("; ")}`);
				return () => {
					for (const r of [rueck.page, rueck.follow]) { try { if (typeof r === "function") r(); } catch { /* Abbau darf nicht werfen */ } }
				};
			}, "eltern-laden oeffnen");
		});
	} else {
		melden("warn", "ctx.inject fehlt: Haken B (Oeffnen) wird nicht eingehaengt");
	}
}
