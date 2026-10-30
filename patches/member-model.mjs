/**
 * mitglied-modellwahl — Modellauswahl in Teammitglied-Sitzungen freigeben
 * ===========================================================================
 * Dieses Modul hat zwei Gesichter, genau wie `member-images.mjs`:
 *
 *   1. Es ist ein Cordis-Plugin. Als Eintrag im Profil geladen, macht es beim
 *      Start zwei Dinge: den Browser-Teil freischalten und den Host-Teil
 *      (den Server von DSH) so erweitern, dass er einen Modellwechsel fuer ein
 *      Teammitglied annimmt.
 *   2. Es exportiert `applyPatch`, `revertPatch` und `statusOf` fuer das
 *      Kommandozeilen-Werkzeug (allow-member-model.mjs).
 *
 * WARUM UEBERHAUPT
 * Die Modellauswahl (Auswahlfeld im Eingabekasten und der Befehl /model) war in
 * Sitzungen von Teammitgliedern aus zwei Gruenden gesperrt:
 *
 *   a) Im Browser (`@deepseek-ai/dsh-client-ui-model-selection`): Jede Sitzung,
 *      die einen Eltern-Eintrag hat ("adressierte Sub-Agent-Sitzung"), wird
 *      pauschal ausgeschlossen, auch wenn sie fortsetzbar ist wie ein
 *      Teammitglied.
 *   b) Im Host (`@deepseek-ai/dsh-api-session-controller`): Der Modellwechsel
 *      sucht den Agenten ueber den normalen Weg, und der weist jede Sitzung ab,
 *      die einem Sub-Agent-Routing gehoert.
 *
 * Dazu kommt ein Umstand, der die Sache schwieriger macht, als sie aussieht:
 * Ein Mitglied, das seinen Zug beendet hat, wird aus dem Speicher entfernt und
 * schlaeft, bis die naechste Nachricht kommt. Eine Wahl, die nur im Speicher
 * steht, waere dann weg. Deshalb gibt es hier zwei Wege:
 *
 *   - Das Mitglied laeuft gerade: der normale Weg des Controllers wird benutzt,
 *     er schreibt das Ereignis `model/selection` ins Protokoll des Mitglieds
 *     und meldet die Wahl an den naechsten Modellaufruf.
 *   - Das Mitglied schlaeft: das Ereignis wird mit einem kurzen Schreibzugriff
 *     direkt in das gespeicherte Protokoll angehaengt.
 *
 * Beim Aufwachen liest ein Hoerer auf `agent/created` das Protokoll: Steht dort
 * eine Wahl, wird sie wieder in den Agenten eingebaut. Ohne ihn wuerde ein
 * aufgewecktes Mitglied zu dem Modell zurueckkehren, mit dem es angelegt wurde.
 *
 * WAS GEAENDERT WIRD (Browser, acht Zeichenketten in einer Datei)
 * Ein Mitglied (Modus "continuable") darf waehlen; einmalige Sub-Agenten
 * ("one-shot") bleiben gesperrt, weil man ihnen nichts mehr schicken kann. Dazu
 * zeigt die Oberflaeche die Wahl sofort an, auch wenn die Sitzung schlaeft und
 * deshalb kein neues Ereignis zum Browser durchkommt.
 *
 * WAS ES NICHT AENDERT
 *   - Das Standardmodell fuer neue Sitzungen: der normale Weg speichert jede
 *     Wahl auch als Standard, und das gilt hier ebenso (ausdrueckliche
 *     Entscheidung des Nutzers, 2026-10-08).
 *   - Der Host-Teil ist ein Hoerer plus drei ueberschriebene Methoden im
 *     Speicher des laufenden Servers. Keine Datei im Paket wird angefasst.
 *     Verschwindet das Plugin, ist alles beim naechsten Neustart wie vorher.
 *
 * RUECKGAENGIG
 * Eintrag `mitglied-modellwahl` aus der cordis.patch.yml nehmen, oder
 * `node ~/.dsh/patches/allow-member-model.mjs --revert` fuer den Browser-Teil.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/** Paketname des Bausteins, dem die Modellauswahl im Browser gehoert. */
export const CLIENT_PACKAGE = "@deepseek-ai/dsh-client-ui-model-selection";

/** Kennung im Quelltext; ihr Vorhandensein heisst "schon freigegeben". */
export const MARKER = "memberSelect(request)";

/** Ausdruck: darf diese Sitzung waehlen? (keine Adresse oder ein fortsetzbares Mitglied) */
const DARF_ID = '(sessions.subagentAddress(sessionId)?.mode ?? "continuable") === "continuable"';
const DARF_SESSION = '(sessions.subagentAddress(session.sessionId)?.mode ?? "continuable") === "continuable"';
const FEHLER = 'throw new Error("model selection is unavailable for addressed subagent sessions");';

/**
 * Die in die Verzeichnis-Klasse eingefuegten Methoden, bewusst einzeilig.
 *
 * memberSelect: reicht die Wahl an den Host weiter und merkt sie sich, wenn sie
 * angenommen wurde. effectiveNext: liefert diese gemerkte Wahl so lange, bis der
 * Host von sich aus eine andere Wahl meldet (dann stimmt die Anzeige ohnehin).
 * Das ist noetig, weil eine schlafende Sitzung kein Ereignis zum Browser schickt.
 */
const METHODEN = "memberSelect(request) { return this.sessions.selectModel(request).then((result) => { if (result.ok) { this.optimistic = { provider: request.provider, model: request.model, ...request.reasoningEffort === void 0 ? {} : { reasoningEffort: request.reasoningEffort } }; this.optimisticBase = modelSelectionProjection(this.projected.getSnapshot())?.next; } return result; }); } effectiveNext(projected) { const chosen = this.optimistic; const next = projected?.next; if (chosen === void 0) return next; const base = this.optimisticBase; const same = (a, b) => a === b || a != null && b != null && a.provider === b.provider && a.model === b.model && a.reasoningEffort === b.reasoningEffort; if (!same(next ?? null, base ?? null)) { this.optimistic = void 0; return next; } return chosen; } ";

/**
 * Die Ersetzungen. `vorher` ist der Originaltext, `nachher` der freigegebene,
 * `anzahl` wie oft `vorher` genau vorkommen muss. Anwenden geht vorwaerts,
 * Zuruecknehmen rueckwaerts — dieselben Zeichenketten, deshalb koennen beide
 * Richtungen nicht auseinanderlaufen.
 */
export const ERSETZUNGEN = [
	{ was: "Verzeichnis: Wahl fuer Mitglieder verfuegbar", anzahl: 1, vorher: "() => sessions.subagentAddress(sessionId) === void 0, this.catalog", nachher: `() => ${DARF_ID}, this.catalog` },
	{ was: "/model: Befehl fuer Mitglieder verfuegbar", anzahl: 1, vorher: "available: (session) => sessions.subagentAddress(session.sessionId) === void 0,", nachher: `available: (session) => ${DARF_SESSION},` },
	{ was: "/model: Optionen und Auswahl nicht mehr abweisen", anzahl: 2, vorher: `if (sessions.subagentAddress(session.sessionId) !== void 0) ${FEHLER}`, nachher: `if (!(${DARF_SESSION})) ${FEHLER}` },
	{ was: "Eingabekasten: Auswahlfeld fuer Mitglieder", anzahl: 1, vorher: "const available = sessions.subagentAddress(sessionId) === void 0;", nachher: `const available = ${DARF_ID};` },
	{ was: "Auswahl ueber memberSelect schicken", anzahl: 1, vorher: "const result = await this.sessions.selectModel({", nachher: "const result = await this.memberSelect({" },
	{ was: "Methoden memberSelect und effectiveNext einfuegen", anzahl: 1, vorher: "assertAvailable() {", nachher: `${METHODEN}assertAvailable() {` },
	{ was: "Anzeige: gemerkte Wahl (Teil 1)", anzahl: 1, vorher: "const intended = projected?.next ?? catalog.value?.default;", nachher: "const intended = this.effectiveNext(projected) ?? catalog.value?.default;" },
	{ was: "Anzeige: gemerkte Wahl (Teil 2)", anzahl: 1, vorher: "const selection = projected.next ?? catalog.value.default;", nachher: "const selection = this.effectiveNext(projected) ?? catalog.value.default;" }
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

/** Zustand eines Quelltexts, ohne ihn zu veraendern. */
export function statusOf(source) {
	if (source.includes(MARKER)) return "freigegeben";
	const treffer = ERSETZUNGEN.filter((e) => zaehle(source, e.vorher) === e.anzahl).length;
	return treffer === ERSETZUNGEN.length ? "gesperrt" : "unbekannt";
}

/** Eine Ersetzung ueberall anwenden. */
function ersetzeAlle(source, von, nach) {
	return source.split(von).join(nach);
}

/** Reine Textumwandlung: freigeben. Wirft nie, meldet stattdessen. */
export function applyToSource(source) {
	if (statusOf(source) === "freigegeben") return { changed: false, source, steps: [] };
	const steps = [];
	for (const ersetzung of ERSETZUNGEN) {
		const n = zaehle(source, ersetzung.vorher);
		if (n !== ersetzung.anzahl) {
			return { changed: false, error: `Die Stelle "${ersetzung.was}" kommt ${n} mal vor (erwartet: ${ersetzung.anzahl}). Vermutlich wurde DSH aktualisiert und der Code hat sich geaendert. Es wurde nichts geschrieben.` };
		}
		source = ersetzeAlle(source, ersetzung.vorher, ersetzung.nachher);
		steps.push(ersetzung.was);
	}
	return { changed: true, source, steps };
}

/** Reine Textumwandlung: Sperre wiederherstellen. */
export function revertFromSource(source) {
	if (statusOf(source) !== "freigegeben") return { changed: false, source, steps: [] };
	const steps = [];
	for (const ersetzung of [...ERSETZUNGEN].reverse()) {
		const n = zaehle(source, ersetzung.nachher);
		if (n !== ersetzung.anzahl) {
			return { changed: false, error: `Die freigegebene Stelle "${ersetzung.was}" kommt ${n} mal vor (erwartet: ${ersetzung.anzahl}). Zuruecknehmen waere unsicher; es wurde nichts geschrieben.` };
		}
		source = ersetzeAlle(source, ersetzung.nachher, ersetzung.vorher);
		steps.push(ersetzung.was);
	}
	return { changed: true, source, steps };
}

/**
 * Schreibt eine Datei ersetzend: erst daneben, dann umbenennen. Das Umbenennen
 * ist unteilbar, damit der Waechter des Servers (er liest die Datei alle
 * 500 Millisekunden) nie eine halb geschriebene Fassung zu sehen bekommt.
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

/** Umwandlung auf eine Datei anwenden und nachkontrollieren. */
function umwandeln(pfad, umwandlung, erwartet) {
	let original;
	try {
		original = readFileSync(pfad, "utf8");
	} catch (error) {
		return { changed: false, error: `Nicht lesbar: ${pfad} (${String(error?.code ?? error)})` };
	}
	const ergebnis = umwandlung(original);
	if (ergebnis.error !== undefined) return { changed: false, error: ergebnis.error };
	if (!ergebnis.changed) return { changed: false, steps: [], pfad };
	atomarSchreiben(pfad, ergebnis.source);
	// Nachkontrolle: nur melden, wenn es wirklich angekommen ist.
	if (statusOf(readFileSync(pfad, "utf8")) !== erwartet) {
		atomarSchreiben(pfad, original);
		return { changed: false, error: "Die Nachkontrolle nach dem Schreiben ist fehlgeschlagen; der vorherige Stand wurde wiederhergestellt." };
	}
	return { changed: true, steps: ergebnis.steps, pfad };
}

/** Freigabe auf eine Datei anwenden. */
export function applyPatch(pfad) {
	return umwandeln(pfad, applyToSource, "freigegeben");
}

/** Freigabe auf eine Datei zuruecknehmen. */
export function revertPatch(pfad) {
	return umwandeln(pfad, revertFromSource, "gesperrt");
}

/** Zustand einer Datei lesen, ohne sie anzufassen. */
export function statusOfFile(pfad) {
	try {
		return { state: statusOf(readFileSync(pfad, "utf8")), size: statSync(pfad).size, pfad };
	} catch (error) {
		return { state: "fehlt", error: String(error?.code ?? error), pfad };
	}
}

// ---------------------------------------------------------------------------
// Cordis-Plugin
// ---------------------------------------------------------------------------

export const name = "mitglied-modellwahl";

/**
 * `clientModules` kennt die Browser-Datei; `sessionController` ist der Host-
 * Dienst mit dem Modellwechsel; `agents`, `sessionQuery`, `sessionPersistence`
 * und `sessionProjections` brauchen wir fuer schlafende Mitglieder.
 */
export const inject = ["clientModules", "sessionController", "agents", "sessionQuery", "sessionPersistence", "sessionProjections"];

/** Schluessel, mit dem ein Platzhalter-Agent fuer ein schlafendes Mitglied erkannt wird. */
const SCHLAFEND = Symbol("mitglied-modellwahl.schlafend");

export function apply(ctx) {
	const melden = (stufe, text) => {
		try {
			const logger = ctx.logger;
			if (logger !== undefined && typeof logger[stufe] === "function") logger[stufe](text);
		} catch { /* Ein fehlendes Protokoll darf nie den Start stoeren. */ }
	};

	/** Pfad, ab dem wir RemoteError finden; wird beim Browser-Teil gesetzt. */
	let ankerPfad;
	/** Die RemoteError-Klasse des Hosts, falls auffindbar (nur fuer eine freundlichere Meldung). */
	let RemoteError;

	// --- Browser-Teil -------------------------------------------------------
	let versuche = 0;
	let timer;

	const browserEinmalVersuchen = () => {
		let ziel;
		try {
			ziel = ctx.clientModules.artifactBaseline(CLIENT_PACKAGE);
		} catch (error) {
			melden("warn", `mitglied-modellwahl: der Baustein ${CLIENT_PACKAGE} liess sich nicht abfragen: ${String(error)}`);
			return true;
		}
		if (ziel === undefined || typeof ziel.path !== "string") {
			versuche += 1;
			if (versuche < 40) return false;
			melden("warn", `mitglied-modellwahl: ${CLIENT_PACKAGE} ist nicht im Modulgraphen aufgetaucht; der Browser-Teil wurde nicht angewandt.`);
			return true;
		}
		ankerPfad = ziel.path;
		const ergebnis = applyPatch(ziel.path);
		if (ergebnis.error !== undefined) {
			melden("warn", `mitglied-modellwahl: der Browser-Teil konnte nicht angewandt werden. ${ergebnis.error}`);
			return true;
		}
		if (!ergebnis.changed) {
			melden("info", `mitglied-modellwahl: Browser-Teil schon freigegeben (${ziel.path}).`);
			return true;
		}
		melden("info", `mitglied-modellwahl: Browser-Teil freigegeben in ${ziel.path} (${ergebnis.steps.length} Stellen).`);
		try {
			ctx.clientModules.rebuilt(CLIENT_PACKAGE);
		} catch (error) {
			melden("warn", `mitglied-modellwahl: der Baustein wurde geaendert, aber das Neuladen scheiterte: ${String(error)}`);
		}
		return true;
	};

	ctx.effect(() => {
		if (!browserEinmalVersuchen()) timer = setInterval(() => {
			if (browserEinmalVersuchen() && timer !== undefined) clearInterval(timer);
		}, 250);
		return () => {
			if (timer !== undefined) clearInterval(timer);
		};
	}, "mitglied-modellwahl: Browser-Teil");

	// --- Host-Teil ----------------------------------------------------------
	const controller = ctx.sessionController;
	const commands = controller?.commands;
	const agentController = controller?.agents;
	if (commands === undefined || agentController === undefined
		|| typeof commands.selectModel !== "function" || typeof commands.resolveAgent !== "function"
		|| typeof agentController.selectForNextRequest !== "function" || typeof agentController.selectionFor !== "function") {
		melden("warn", "mitglied-modellwahl: der Sitzungs-Controller hat nicht die erwartete Form (DSH-Update?); der Host-Teil wurde nicht angewandt.");
		return;
	}

	/** Gilt der Kontext der gerade laufenden Wahl, kann `resolveAgent` das Mitglied liefern. */
	const kontext = new AsyncLocalStorage();

	/** Ist diese Sitzung ein fortsetzbares Kind (Teammitglied)? Fuer einen laufenden Agenten. */
	const istMitglied = (session) => {
		try {
			if (session.header.origin !== "subagent") return false;
			const identitaet = ctx.sessionProjections.snapshot(session, ["subagent"]).values.subagent;
			return identitaet?.mode === "continuable" && session.isOwnSeq(identitaet.seq);
		} catch {
			return false;
		}
	};

	/** Ist diese gespeicherte (schlafende) Sitzung ein fortsetzbares Kind? */
	const istSchlafendesMitglied = async (sessionId) => {
		let beobachtung;
		try {
			beobachtung = await ctx.sessionQuery.observeSession(sessionId, { projectionMode: "all" });
		} catch {
			return false; // Unbekannt: der normale Weg meldet dann "nicht gefunden".
		}
		try {
			if (beobachtung.header.cwd === undefined || beobachtung.header.origin !== "subagent") return false;
			const identitaet = beobachtung.projections?.values.subagent;
			return identitaet != null && identitaet.seq >= beobachtung.inheritedEventCount && identitaet.mode === "continuable";
		} finally {
			try { beobachtung[Symbol.dispose]?.(); } catch { /* schon freigegeben */ }
		}
	};

	/** Laufender Agent oder Platzhalter fuer ein schlafendes Mitglied; sonst undefined. */
	const mitgliedFuer = async (sessionId) => {
		const laufend = ctx.agents.get(sessionId);
		if (laufend !== undefined) return istMitglied(laufend.session) ? { agent: laufend } : undefined;
		if (!(await istSchlafendesMitglied(sessionId))) return undefined;
		const zustand = { selection: undefined };
		return { agent: { id: sessionId, [SCHLAFEND]: zustand }, zustand };
	};

	/** Fehler mit dem Code, den der Browser kennt (Sitzung belegt), soweit moeglich. */
	const belegt = (sessionId, ursache) => {
		const text = `session "${sessionId}" is being written by another process: ${String(ursache)}`;
		return RemoteError === undefined ? new Error(text) : new RemoteError("session/writer-held", text, { sessionId });
	};

	/** Die Wahl in das gespeicherte Protokoll eines schlafenden Mitglieds anhaengen. */
	const inSchlafendesProtokoll = async (sessionId, selection) => {
		let handle;
		try {
			handle = await ctx.sessionPersistence.open(sessionId, "write");
		} catch (error) {
			// Zwischenzeitlich aufgewacht? Dann gilt der Weg fuer laufende Mitglieder.
			const laufend = ctx.agents.get(sessionId);
			if (laufend !== undefined && istMitglied(laufend.session)) {
				agentController.selectForNextRequest(laufend, selection);
				return;
			}
			throw belegt(sessionId, error);
		}
		try {
			const gelesen = await handle.read();
			await handle.append([{ type: "model/selection", seq: gelesen.events.length, time: Date.now(), data: { ...selection } }]);
			await handle.flush();
		} finally {
			await handle.close();
		}
	};

	ctx.effect(() => {
		// Merken, ob die Eigenschaft vorher ein eigener Wert war oder von der Klasse kam.
		const eigen = (objekt, schluessel) => Object.hasOwn(objekt, schluessel);
		const vorherSelect = { eigen: eigen(commands, "selectModel"), wert: commands.selectModel };
		const vorherResolve = { eigen: eigen(commands, "resolveAgent"), wert: commands.resolveAgent };
		const vorherAuswahl = { eigen: eigen(agentController, "selectForNextRequest"), wert: agentController.selectForNextRequest };

		// 1. resolveAgent liefert dem laufenden Modellwechsel das Mitglied -- und
		//    nur ihm: der Kontext gilt nur innerhalb dieses einen Aufrufs.
		commands.resolveAgent = function (sessionId) {
			const eintrag = kontext.getStore();
			if (eintrag !== undefined && eintrag.sessionId === sessionId) return Promise.resolve(eintrag.agent);
			return vorherResolve.wert.call(this, sessionId);
		};

		// 2. Fuer einen Platzhalter wird nichts angehaengt, sondern die Wahl nur gemerkt.
		agentController.selectForNextRequest = function (agent, selection) {
			const zustand = agent !== null && typeof agent === "object" ? agent[SCHLAFEND] : undefined;
			if (zustand !== undefined) {
				zustand.selection = selection;
				return;
			}
			return vorherAuswahl.wert.call(this, agent, selection);
		};

		// 3. Der Modellwechsel selbst: Mitglieder gehen durch den Originalweg (alle
		//    Pruefungen, Standard speichern), nur der Agent wird ihnen untergeschoben.
		commands.selectModel = async function (request) {
			let mitglied;
			try {
				mitglied = await mitgliedFuer(request.sessionId);
			} catch (error) {
				melden("warn", `mitglied-modellwahl: Mitglied-Pruefung fehlgeschlagen, normaler Weg: ${String(error)}`);
				mitglied = undefined;
			}
			if (mitglied === undefined) return vorherSelect.wert.call(this, request);
			const ergebnis = await kontext.run({ sessionId: request.sessionId, agent: mitglied.agent }, () => vorherSelect.wert.call(this, request));
			if (mitglied.zustand !== undefined) {
				if (mitglied.zustand.selection === undefined) throw new Error(`mitglied-modellwahl: keine Wahl fuer schlafendes Mitglied "${request.sessionId}" erhalten`);
				await inSchlafendesProtokoll(request.sessionId, mitglied.zustand.selection);
			}
			return ergebnis;
		};

		// 4. Beim Aufwachen: steht im Protokoll eine Wahl, wieder einbauen.
		const hoerer = ctx.on("agent/created", ({ agent }) => {
			try {
				if (agent.session.header.origin !== "subagent") return;
				if (!agent.session.ownEvents().some((ereignis) => ereignis.type === "model/selection")) return;
				agentController.selectionFor(agent);
			} catch (error) {
				melden("warn", `mitglied-modellwahl: die gespeicherte Wahl konnte nicht wieder eingebaut werden: ${String(error)}`);
			}
		});

		melden("info", "mitglied-modellwahl: Host-Teil aktiv.");

		return () => {
			try { hoerer?.(); } catch { /* wird ohnehin entfernt */ }
			const zurueck = (objekt, schluessel, vorher) => {
				if (vorher.eigen) objekt[schluessel] = vorher.wert;
				else delete objekt[schluessel];
			};
			zurueck(commands, "selectModel", vorherSelect);
			zurueck(commands, "resolveAgent", vorherResolve);
			zurueck(agentController, "selectForNextRequest", vorherAuswahl);
		};
	}, "mitglied-modellwahl: Host-Teil");

	// RemoteError nachladen: nur fuer eine freundlichere Fehlermeldung, nie noetig.
	ctx.effect(() => {
		let aktiv = true;
		const suche = setInterval(async () => {
			if (ankerPfad === undefined || RemoteError !== undefined) return;
			clearInterval(suche);
			try {
				const wurzel = realpathSync(join(dirname(ankerPfad), "..", "..", "dsh-typert-protocol", "lib", "index.js"));
				const modul = await import(pathToFileURL(wurzel).href);
				if (aktiv && typeof modul.RemoteError === "function") RemoteError = modul.RemoteError;
			} catch { /* Dann gibt es eben eine einfache Fehlermeldung. */ }
		}, 500);
		return () => {
			aktiv = false;
			clearInterval(suche);
		};
	}, "mitglied-modellwahl: Fehlerklasse");
}
