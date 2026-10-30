/**
 * teammate-modell — ein Teammitglied darf auf einem anderen Modell laufen
 * =======================================================================
 *
 * WAS DER MENSCH WOLLTE (2026-10-10)
 * Teammitglieder sollen standardmaessig mit demselben Modell laufen wie der
 * Team-Leiter. Wenn der Leiter es aber ausdruecklich sagt, soll ein Mitglied
 * auf einem beliebigen anderen Modell laufen duerfen — genau wie ein
 * gewoehnlicher Unteragent (Subagent) es konnte. Erlaubt ist dabei dieselbe
 * Liste wie fuer Unteragenten; sie steht in der Einstellung
 * `subagent-model-selection` (Einstellungen -> Plugins) und ist die einzige
 * Quelle fuer beide.
 *
 * WAS HEUTE SCHIEF STAND
 * a) Das Werkzeug `spawn_teammate` (Paket dsh-experimental-tool-agent-team)
 *    kennt nur Name, Beschreibung, Auftrag und Kontext. Es reicht kein Modell
 *    an den Anlege-Vorgang weiter; die Felder `provider`, `model` und
 *    `reasoning_effort`, die `subagent` hatte, fehlen dort.
 * b) Der Dienst, der die Kind-Sitzung wirklich anlegt
 *    (`subagents.continuations.startContinuable`), NIMMT ein abweichendes
 *    Modell bereits an: `request.agentOptions` wird von
 *    `resolveChildAgentOptions` uebernommen und im Steckbrief der Kind-Sitzung
 *    gespeichert. Beim Aufwecken eines schlafenden Mitglieds wird es von dort
 *    wieder eingebaut — die Wahl ueberlebt also den Schlaf.
 * c) Der Weg dazwischen verliert sie: `TeamRoster.spawnAdmitted` baut den
 *    Auftrag zu `{ prompt, parent }` um und laesst alles andere fallen.
 *
 * WAS DIESES MODUL TUT (zwei Griffe, beide nur im Speicher)
 *  1. Es schaltet die drei Felder am Werkzeug `spawn_teammate` frei, indem es
 *     die Werkzeug-Definition im Agenten-Scope an Ort und Stelle erweitert
 *     (Parameter-Schema, Beschreibung, Ausfuehrung). Kein Paket wird
 *     angefasst; ein Neustart ohne dieses Plugin stellt alles wieder her.
 *  2. Es reicht die Wahl ueber einen AsyncLocalStorage-Kontext an
 *     `startContinuable` durch, ohne die Team-Klassen zu kopieren: der
 *     Aufruf des Werkzeugs setzt die Wahl, und eine Huelle um
 *     `startContinuable` haengt sie als `request.agentOptions` an.
 *
 * VOR JEDEM ANLEGEN WIRD GEPRUEFT
 *  - `provider` und `model` muessen zusammen kommen und nicht leer sein.
 *  - Die Route muss in der gemeinsamen Liste stehen (dieselbe Einstellung wie
 *    fuer Unteragenten). Ist die Liste leer oder abgeschaltet, wird die
 *    Auswahl abgelehnt statt still ignoriert.
 *  - `llm.resolveCallConfig` loest die Route gegen den laufenden Anbieter auf.
 *    Ein Tippfehler im Modellnamen oder eine unpassende Denktiefe faellt damit
 *    VOR dem Anlegen auf, und die Denktiefe des gewaehlten Modells wird
 *    uebernommen, wenn keine genannt ist.
 *
 * WAS ES NICHT AENDERT
 *  - Ohne die drei Felder bleibt alles wie bisher: das Mitglied erbt Anbieter,
 *    Modell und Denktiefe des Leiters. Das ist der empfohlene Weg, weil eine
 *    gleiche Route dem Anbieter erlaubt, den schon berechneten Anfang der
 *    Unterhaltung aus seinem Zwischenspeicher weiterzuverwenden.
 *  - Eine ausdrueckliche Route aendert diesen Vorteil: der Anfang wird neu
 *    berechnet. Das ist unvermeidlich und war bei Unteragenten genauso.
 *
 * RUECKGAENGIG
 * Eintrag `teammate-modell` aus ~/.dsh/profiles/web/cordis.patch.yml nehmen
 * und DSH neu starten. Selbstpruefung: node ~/.dsh/patches/teammate-model.mjs
 *
 * Protokoll der Entscheidungen: ~/.dsh/logs/teammate-modell.log
 */

import { appendFileSync, realpathSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const name = "teammate-modell";

/** Dienste, ohne die dieses Modul nichts tun kann. */
export const inject = ["tools", "agents", "subagents"];

/** Marke auf der umgebogenen Methode: verhindert doppeltes Umbiegen nach einem Neuladen. */
const MARKE = Symbol.for("teammate-modell.umgebogen");

/** Marke am Modell-Schema: kennzeichnet die Kern-kompatible Beschreibung. */
const MARKE_SCHEMA = Symbol.for("teammate-modell.schema");

/** Traegt die Modellwahl vom Werkzeugaufruf bis zum Anlegen der Kind-Sitzung. */
const AUSWAHL = new AsyncLocalStorage();

/** Das Werkzeug, um das es geht, und der Dienst, der Mitglieder anlegt. */
export const WERKZEUG = "spawn_teammate";
const DIENST_SETTINGS = "subagentModelSelection";

/**
 * Tracer: schreibt bei JEDEM Spawn-Aufruf die Roh-Argumente und die eigene
 * Version ins Protokoll. Ein Aufruf ohne diese Zeilen = die geladene Datei ist
 * aelter als diese hier (Node-Cache). Der Text der Kennung ist einmalig, damit
 * ein Log-Fund eindeutig ist.
 */
const TRACER_KENNUNG = "tracer-2026-10-17T1850";

/**
 * Liest die drei Felder aus einem Werkzeugaufruf.
 *
 * Reine Funktion ohne Seiteneffekt, damit sie ohne laufendes DSH geprueft
 * werden kann. Sie prueft nur die Form; ob die Route erlaubt und aufloesbar
 * ist, entscheidet der Aufrufer.
 *
 * @param {object} args - Argumente des Werkzeugaufrufs.
 * @returns {{provider: string, model: string, reasoningEffort?: string}|undefined}
 *          die genannte Wahl, oder undefined wenn keine genannt wurde.
 * @throws {Error} wenn nur eines von Anbieter und Modell genannt wurde oder
 *          eines davon leer ist.
 */
export function parseSelection(args, routen) {
	const provider = args?.provider;
	const model = args?.model;
	const effort = args?.reasoning_effort;
	const genannt = provider !== undefined || model !== undefined || effort !== undefined;
	if (!genannt) return undefined;
	if (provider === undefined && model === undefined) {
		throw new Error("`reasoning_effort` allein sagt nicht, welches Modell gemeint ist: nenne `provider` und `model` zusammen mit der Denktiefe.");
	}
	const liste = Array.isArray(routen) ? routen : [];
	const slugVon = (anbieter, modell) => `${anbieter}/${modell}`;
	const anbieterAus = (slug) => slug.slice(0, slug.indexOf("/"));
	const modellAus = (slug) => slug.slice(slug.indexOf("/") + 1);
	const freigegeben = (anbieter, slugModell) => liste.some((r) => passt(r?.provider, anbieter) && (passt(r?.model, slugModell) || passt(slugVon(r?.provider, r?.model), slugModell)));

	if (provider === undefined || model === undefined) {
		// Der Kern verlangt im Feld `model` die Form "<provider>/<modell>". Fehlt
		// eines der beiden Felder, wird es aus dem vorhandenen und der Liste
		// ergaenzt:
		//   - nur `model` mit Slash (Slugs sind die Form der Liste): die Route
		//     muss freigegeben sein; das Anbieter-Feld bekommt den nackten
		//     Anbieter, das Modell-Feld bleibt der Slug — so, wie der Kern es
		//     sehen will. Ein Anbieter-Feld darf denselben Pfad wiederholen.
		//   - nur `model` nackt: die Liste muss genau eine Route mit diesem
		//     Modell enthalten; der Slug wird gebaut.
		//   - nur `provider`: die Liste muss genau ein Modell dieses Anbieters
		//     enthalten; es wird gewaehlt.
		// In allen anderen Faellen bleibt es bei der bekannten Meldung.
		const slug = typeof model === "string" ? model : "";
		const slash = slug.indexOf("/");
		const hatSlash = slash > 0 && slash < slug.length - 1;
		if (hatSlash) {
			const anbieterSlug = anbieterAus(slug);
			const wiederholt = typeof provider === "string" && (provider === slug || provider === anbieterSlug);
			if ((provider === undefined || wiederholt) && freigegeben(anbieterSlug, slug)) {
				return { provider: anbieterSlug, model: slug, ...effort === undefined ? {} : { reasoningEffort: effort } };
			}
		} else if (provider === undefined && slug.length > 0) {
			const treffer = liste.filter((r) => !/[*?]/.test(r?.model ?? "") && passt(r?.model, slug));
			if (treffer.length === 1) return { provider: treffer[0].provider, model: slugVon(treffer[0].provider, slug), ...effort === undefined ? {} : { reasoningEffort: effort } };
		} else if (typeof provider === "string" && !provider.includes("/") && slug.length === 0) {
			const kandidat = liste.filter((r) => passt(r?.provider, provider) && !/[*?]/.test(r?.model ?? ""));
			if (kandidat.length === 1) return { provider, model: slugVon(provider, kandidat[0].model), ...effort === undefined ? {} : { reasoningEffort: effort } };
		}
		throw new Error("`provider` (Anbieter) und `model` (Modell) gehoeren zusammen: nenne beide oder keines von beiden. Der Kern verlangt im Feld `model` die Form \"<provider>/<modell>\", zum Beispiel \"homepc/swift-1.5-iq3_xxs\".");
	}
	if (typeof provider !== "string" || provider.length === 0) throw new Error("`provider` darf nicht leer sein.");
	if (typeof model !== "string" || model.length === 0) throw new Error("`model` darf nicht leer sein.");
	if (effort !== undefined && (typeof effort !== "string" || effort.length === 0)) {
		throw new Error("`reasoning_effort` muss, wenn es genannt wird, ein nicht-leerer Name sein.");
	}
	// Der Kern zerlegt den Slug im Modell-Feld selbst (parseModelRoute) und will
	// im Anbieter-Feld den nackten Namen — die Kanonische Form. Ein nacktes
	// Modell mit genanntem Anbieter lehnt der Kern ab; dafuer baut dieser Patch
	// ueber die Liste den Slug. Die Rueckgabe nennt deshalb immer:
	//   provider = nackter Anbieter, model = "anbieter/modell".
	if (model.includes("/")) {
		const anbieterSlug = anbieterAus(model);
		if (anbieterSlug !== provider) {
			throw new Error(`der Anbieter im Modell-Slug ("${anbieterSlug}") ist nicht der genannte Anbieter "${provider}". Schreibe model als "<provider>/<modell>", zum Beispiel "${slugVon(provider, modellAus(model))}".`);
		}
		return { provider, model, ...effort === undefined ? {} : { reasoningEffort: effort } };
	}
	// Nacktes Modell mit genanntem Anbieter: der Kern lehnt das ab. Aus der
	// Liste wird der Slug gebaut, wenn genau diese Route freigegeben ist.
	if (liste.length === 0 || liste.some((r) => passt(r?.provider, provider) && passt(r?.model, model))) {
		return { provider, model: slugVon(provider, model), ...effort === undefined ? {} : { reasoningEffort: effort } };
	}
	return { provider, model, ...effort === undefined ? {} : { reasoningEffort: effort } };
}

/**
 * Hilferuf fuer parseSelection: die Routen eines Anbieters aus der Liste.
 *
 * @param {Array<{provider: string, model: string}>} routen - erlaubte Routen.
 * @param {string|undefined} anbieter - der Anbieter, nach dem gefiltert wird;
 *          undefined liefert die Liste unveraendert.
 * @returns {Array<{provider: string, model: string}>} die passenden Routen.
 */
function listefuerAnbieter(routen, anbieter) {
	return anbieter === undefined ? routen : routen.filter((route) => route?.provider === anbieter);
}

/** Platzhalter-Vergleich: `*` und `?` in Mustern, sonst exakt. */
export function passt(muster, wert) {
	if (typeof muster !== "string" || typeof wert !== "string") return false;
	if (!/[*?]/.test(muster)) return muster === wert;
	let quelle = "^";
	for (const zeichen of muster) {
		if (zeichen === "*") quelle += ".*";
		else if (zeichen === "?") quelle += ".";
		else quelle += zeichen.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}
	quelle += "$";
	return new RegExp(quelle).test(wert);
}

/**
 * Steht diese Route in der gemeinsamen Liste?
 *
 * @param {Array<{provider: string, model: string}>|undefined} routen - erlaubte Routen.
 * @param {string} provider - Anbieter der geprueften Route.
 * @param {string} model - Modell der geprueften Route.
 * @returns {boolean} true, wenn die Route ausdruecklich freigegeben ist.
 */
export function isAllowed(routen, provider, model) {
	if (!Array.isArray(routen)) return false;
	return routen.some((route) => passt(route?.provider, provider) && passt(route?.model, model));
}

/**
 * Macht eine Routen-Liste als Text lesbar, damit ein Fehler oder eine
 * Werkzeug-Beschreibung sie ohne Nachfragen zeigen kann.
 *
 * @param {Array<{provider: string, model: string}>|undefined} routen - erlaubte Routen.
 * @returns {string} "anbieter/modell, anbieter/modell" oder "(keine)".
 */
export function routeText(routen) {
	if (!Array.isArray(routen) || routen.length === 0) return "(keine)";
	return routen.map((route) => `${route.provider}/${route.model}`).join(", ");
}

/**
 * Schreibt eine Zeile ins Entscheidungsprotokoll; ein Fehler dabei stoert nie.
 *
 * Ueber `DSH_TEAMMATE_MODELL_LOG` laesst sich ein anderer Pfad setzen. Der
 * Pruefstand nutzt das, damit seine Laeufe nicht im Protokoll der laufenden
 * Sitzung landen und die Messung dort verfaelschen.
 *
 * @param {string} text - die Zeile ohne Zeitstempel.
 */
function protokolliere(text) {
	try {
		const pfad = process.env.DSH_TEAMMATE_MODELL_LOG ?? join(homedir(), ".dsh", "logs", "teammate-modell.log");
		appendFileSync(pfad, `${new Date().toISOString()} ${text}\n`);
	} catch { /* Das Protokoll ist Beigabe, nie Bedingung. */ }
}

/**
 * Cordis-Plugin: erweitert das Team-Werkzeug um die Modellwahl und reicht sie
 * bis zum Anlegen der Kind-Sitzung durch.
 *
 * @param {object} ctx - Cordis-Kontext der Profilwurzel.
 */
export function apply(ctx) {
	const melden = (stufe, text) => {
		protokolliere(text);
		try {
			const logger = ctx.logger;
			if (logger !== undefined && typeof logger[stufe] === "function") logger[stufe](`teammate-modell: ${text}`);
		} catch { /* Ein fehlendes Protokoll darf den Start nie stoeren. */ }
	};

	/**
	 * Die gemeinsame Liste erlaubter Routen, oder undefined wenn die Auswahl
	 * abgeschaltet bzw. die Liste leer ist.
	 */
	const erlaubteRouten = () => {
		let dienst;
		try {
			dienst = ctx.get(DIENST_SETTINGS);
		} catch (error) {
			melden("warn", `die Einstellung ${DIENST_SETTINGS} liess sich nicht lesen: ${String(error)}`);
			return undefined;
		}
		if (dienst === undefined || typeof dienst.current !== "function") return undefined;
		try {
			const stand = dienst.current();
			if (stand?.enabled !== true || !Array.isArray(stand.allowedModels) || stand.allowedModels.length === 0) return undefined;
			return stand.allowedModels;
		} catch (error) {
			melden("warn", `die gemeinsame Modell-Liste ist unbrauchbar: ${String(error)}`);
			return undefined;
		}
	};

	// --- Griff 1: die Wahl bis zum Anlegen durchreichen ----------------------
	/**
	 * Biegt `startContinuable` um, damit eine genannte Modellwahl als
	 * `request.agentOptions` beim Anlegen ankommt.
	 *
	 * Gesucht wird zuerst der fortsetzbare Verwalter, denn dort ist die
	 * Methode definiert; solange er noch nicht existiert (er entsteht erst,
	 * wenn der Agenten-Dienst steht), wird ersatzweise der Dienst selbst
	 * genommen. Beide Wege sind gleichwertig, weil der Dienst nur an den
	 * Verwalter weiterreicht.
	 *
	 * Wiederholt aufgerufen ist die Funktion harmlos: steht die Marke schon
	 * auf der Methode, tut sie nichts.
	 *
	 * @returns {boolean} true, wenn der Durchreicher steht.
	 */
	const startContinuableUmbiegen = () => {
		let dienst;
		try { dienst = ctx.get("subagents"); } catch { dienst = undefined; }
		if (dienst === undefined) return false;
		const ziele = [];
		if (dienst.continuations !== undefined) ziele.push(dienst.continuations);
		ziele.push(dienst);
		let gefunden = false;
		for (const ziel of ziele) {
			const prototyp = Object.getPrototypeOf(ziel);
			const original = prototyp?.startContinuable;
			if (typeof original !== "function") continue;
			gefunden = true;
			if (original[MARKE] === true) return true;
			const ersatz = function (spec) {
				const auswahl = AUSWAHL.getStore();
				if (auswahl === undefined || spec?.request === undefined || spec.request.agentOptions !== undefined) {
					return original.call(this, spec);
				}
				// Der Kern vergleicht die geteilte Liste gegen das NACKTE Modell
				// (dsh-tool-subagent/lib/index.js Zeile 96: route.model === model).
				// Die Liste traegt Slugs. Darum geht die Wahl als nacktes Modell ins
				// Anlegen — der Kern prueft dann nackt gegen Slug und faehlt; dieser
				// Patch uebernimmt die Zulassung selbst (slug-faehig, siehe execute).
				const model = String(auswahl.model ?? "");
				const nacktesModel = model.startsWith(auswahl.provider + "/")
					? { ...auswahl, model: model.slice(auswahl.provider.length + 1) }
					: auswahl;
				return original.call(this, { ...spec, request: { ...spec.request, agentOptions: nacktesModel } });
			};
			ersatz[MARKE] = true;
			ersatz.original = original;
			prototyp.startContinuable = ersatz;
			protokolliere("startContinuable umgebogen: eine genannte Modellwahl erreicht jetzt das Anlegen.");
			return true;
		}
		if (!gefunden) melden("warn", "startContinuable ist nicht auffindbar (DSH-Update?); der Durchreicher wurde nicht eingebaut.");
		return !gefunden;
	};

	// --- Griff 2: das Werkzeug erweitern -------------------------------------
	/** Ruecknahmen je Werkzeug-Definition, damit ein Neuladen nichts stapelt. */
	const ruecknahmen = new WeakMap();
	/** Die unveraenderte Beschreibung je Werkzeug-Definition, als Grundlage jeder Auffrischung. */
	const grundBeschreibungen = new WeakMap();
	/** Der zuletzt geschriebene Beschreibungstext je Definition, damit das Protokoll nicht flutet. */
	const letzteBeschreibung = new WeakMap();

	/**
	 * Der Zusatz, der im Werkzeug steht und die erlaubten Routen nennt.
	 *
	 * Eine Stelle fuer beide Faelle (Erweiterung und Auffrischung), damit der
	 * Text nie auseinanderlaeuft.
	 *
	 * @returns {string} der anzuhangende Beschreibungstext.
	 */
	const wahlBeschreibung = () => {
		const routen = erlaubteRouten();
		if (routen === undefined) return " Child model selection is currently unavailable: the shared allowed-model list is empty or switched off, so a teammate inherits the Lead's model.";
		return ` Optional: name \`provider\` and \`model\` together to run this teammate on another model, and optionally \`reasoning_effort\` for its thinking depth (omitting it uses the selected model's default). Allowed routes: ${routeText(routen)}. Omit all three to let the teammate inherit the Lead's model — an identical route also lets the provider reuse the cached conversation prefix, so inheriting is cheaper.`;
	};

	/**
	 * Erweitert das Werkzeug in einem Agenten-Scope.
	 *
	 * Drei Ausgaenge, und der Unterschied ist wichtig:
	 *   "fertig"  — erweitert oder schon erweitert; hier gibt es nichts zu tun.
	 *   "spaeter" — das Werkzeug ist in diesem Scope noch nicht sichtbar. Das
	 *               ist der Normalfall fuer jeden Agenten, der kein
	 *               Teammitglied ist, und darf deshalb keinen Fehler ausloesen.
	 *   "aufgeben"— die Form passt nicht (DSH-Update); gemeldet und gelassen.
	 *
	 * @param {object} agent - der Agent, in dessen Scope das Werkzeug liegt.
	 * @returns {"fertig"|"spaeter"|"aufgeben"} was geschehen ist.
	 */
	const erweitereWerkzeug = (agent) => {
		let definition;
		try {
			definition = ctx.tools.get(WERKZEUG, agent);
		} catch (error) {
			melden("warn", `das Werkzeug ${WERKZEUG} liess sich nicht abfragen: ${String(error)}`);
			return "aufgeben";
		}
		if (definition === undefined) return "spaeter";
		if (typeof definition.execute !== "function" || definition.parameters === undefined) {
			melden("warn", `das Werkzeug ${WERKZEUG} hat nicht die erwartete Form (DSH-Update?); es bleibt unveraendert.`);
			return "aufgeben";
		}
		if (definition.execute[MARKE] === true) return "fertig";

		const eigenschaften = definition.parameters.properties;
		if (eigenschaften === undefined || typeof eigenschaften !== "object") {
			melden("warn", `das Werkzeug ${WERKZEUG} hat kein Parameter-Schema; es bleibt unveraendert.`);
			return "aufgeben";
		}
		// Der Kern verlangt fuer dieses Werkzeug die Form "<provider>/<modell>" im
		// Feld `model`. Diese Regel ist kernfest und ueberlebt jeden Neustart.
		// Die Beschreibung des Feldes sagt es hier direkt, damit ein Agent die
		// geforderte Form beim Schreiben kennt und nicht aus einem Fehler lernt.
		if (eigenschaften.model && typeof eigenschaften.model === "object") {
			eigenschaften.model.description = "Model id in the form \"<provider>/<model>\", e.g. \"homepc/swift-1.5-iq3_xxs\". Supply together with provider, whose own value must be just the provider name (e.g. \"homepc\"). Omit both to inherit the Lead's model.";
		}
		const grundExecute = definition.execute;
		// Die Beschreibung kann von einem frueheren Durchgang schon erweitert
		// sein (etwa nach einem Profil-Neuladen); der Grundtext kommt daher aus
		// der Ablage, nicht aus dem aktuellen Feld.
		const grundBeschreibung = grundBeschreibungen.get(definition) ?? definition.description;
		grundBeschreibungen.set(definition, grundBeschreibung);
		const fehlend = [];
		for (const feld of ["provider", "model", "reasoning_effort"]) if (!Object.hasOwn(eigenschaften, feld)) fehlend.push(feld);

		definition.execute = async function (args, exec) {
			// Tracer-Zeile VOR aller Logik: zeigt, ob DIESE Datei laedt.
			protokolliere(`${TRACER_KENNUNG} aufruf args=${JSON.stringify(args)}`);
			const routen = erlaubteRouten();
			const auswahl = parseSelection(args, routen);
			if (auswahl === undefined) return grundExecute.call(this, args, exec);

			if (routen === undefined) {
				throw new Error("ein Teammitglied kann gerade kein eigenes Modell bekommen: die gemeinsame Liste erlaubter Modelle ist leer oder abgeschaltet (Einstellungen -> Plugins -> \"Subagent model selection\"). Nenne kein Modell, dann erbt das Mitglied das Modell des Leiters.");
			}
			// Die Liste nennt Paare {provider, model}. Der Kern vergleicht im
			// subagent-Pfad nackten Modellnamen gegen r.model; der subagent-Pfad
			// wird NUR aktiv, wenn die Liste nackte Modelle traegt. Bei Slug-Liste
			// (der Normalfall: UI schreibt Slugs) wird der Vergleich hier
			// slug-faehig ausgefuehrt und das nackte Modell weitergereicht —
			// dieselbe Semantik, die der Kern in seiner eigenen Liste erwartet.
			const istSlugListe = Array.isArray(routen) && routen.some((r) => typeof r?.model === "string" && r.model.includes("/"));
			const vergleich = auswahl.model.includes("/") && auswahl.model.startsWith(auswahl.provider + "/")
				? { provider: auswahl.provider, model: auswahl.model.slice(auswahl.provider.length + 1) }
				: auswahl;
			const erlaubt = routen === undefined || (istSlugListe
				? routen.some((r) => passt(r?.provider, vergleich.provider) && (passt(r?.model, vergleich.model) || passt(r?.model, `${vergleich.provider}/${vergleich.model}`)))
				: isAllowed(routen, vergleich.provider, vergleich.model));
			if (!erlaubt) {
				throw new Error(`die Modell-Route "${auswahl.provider}/${auswahl.model}" ist fuer Teammitglieder nicht freigegeben. Erlaubt ist: ${routeText(routen)}.`);
			}
			let llm;
			try { llm = ctx.get("llm"); } catch { llm = undefined; }
			if (llm === undefined || typeof llm.resolveCallConfig !== "function") {
				throw new Error("die Modell-Route liess sich nicht pruefen, weil der LLM-Dienst fehlt; das Mitglied wurde nicht angelegt.");
			}
			let aufgeloest;
			try {
				aufgeloest = await llm.resolveCallConfig({
					provider: vergleich.provider,
					model: vergleich.model,
					...auswahl.reasoningEffort === undefined ? {} : { reasoningEffort: auswahl.reasoningEffort }
				}, exec?.signal);
			} catch (error) {
				throw new Error(`die Modell-Route "${auswahl.provider}/${auswahl.model}" hat der Anbieter abgelehnt: ${error instanceof Error ? error.message : String(error)}`);
			}
			const gewaehlt = {
				provider: vergleich.provider,
				model: vergleich.model,
				...aufgeloest?.reasoningEffort === undefined ? {} : { reasoningEffort: aufgeloest.reasoningEffort }
			};
			protokolliere(`Mitglied wird angelegt auf ${gewaehlt.provider}/${gewaehlt.model}${gewaehlt.reasoningEffort === undefined ? "" : ` (Denktiefe ${gewaehlt.reasoningEffort})`}.`);
			return AUSWAHL.run(gewaehlt, () => grundExecute.call(this, args, exec));
		};
		definition.execute[MARKE] = true;

		if (fehlend.length > 0) {
			eigenschaften.provider = {
				type: "string",
				description: "LLM provider route for this teammate. Supply together with model; omit both to inherit the Lead's route."
			};
			eigenschaften.model = {
				type: "string",
				description: "Model id interpreted by the provider, e.g. neuralwatt/gemma-4-31b. Supply together with provider; omit both to inherit the Lead's model."
			};
			eigenschaften.reasoning_effort = {
				type: "string",
				description: "Adapter-owned reasoning effort for the selected model. Omit to use that model's default effort."
			};
		}
		definition.description = grundBeschreibung + wahlBeschreibung();

		ruecknahmen.set(definition, () => {
			definition.execute = grundExecute;
			definition.description = grundBeschreibung;
			for (const feld of fehlend) Reflect.deleteProperty(eigenschaften, feld);
		});
		protokolliere(`Werkzeug ${WERKZEUG} erweitert: provider, model und reasoning_effort sind jetzt waehlbar.`);
		return "fertig";
	};

	/**
	 * Der eine Durchgang ueber alle Agenten-Scopes: fehlende Erweiterung
	 * nachholen, vorhandene Beschreibung auffrischen.
	 *
	 * Beides in einem Schritt, weil beides am selben Ort passiert und der
	 * Ausloeser derselbe ist. Der Nachhol-Teil ist nicht Zierde: das
	 * Team-Werkzeug erscheint erst, wenn das Team-Plugin seinen Agenten-Scope
	 * bestueckt hat, und je nach Reihenfolge der Hoerer auf `agent/created`
	 * kann das nach diesem Modul geschehen. `tools/change` feuert bei jeder
	 * Werkzeug-Registrierung, also kommt die Erweiterung dort sicher nach.
	 *
	 * @returns {{werkzeug: boolean, aufgegeben: boolean}} Stand nach dem Durchgang.
	 */
	const durchgang = () => {
		let werkzeug = false;
		let aufgegeben = false;
		for (const agent of ctx.agents.list()) {
			let definition;
			try { definition = ctx.tools.get(WERKZEUG, agent); } catch { definition = undefined; }
			if (definition !== undefined && definition.execute?.[MARKE] !== true) {
				const ergebnis = erweitereWerkzeug(agent);
				if (ergebnis === "fertig") werkzeug = true;
				if (ergebnis === "aufgeben") aufgegeben = true;
				continue;
			}
			if (definition === undefined) continue;
			werkzeug = true;
			const grund = grundBeschreibungen.get(definition);
			if (grund === undefined) continue;
			definition.description = grund + wahlBeschreibung();
			// Nur melden, wenn sich der Text wirklich geaendert hat. `tools/change`
			// feuert bei jeder Werkzeug-Registrierung; ohne diesen Vergleich
			// ueberflutete das Protokoll.
			const stand = definition.description;
			if (letzteBeschreibung.get(definition) !== stand) {
				letzteBeschreibung.set(definition, stand);
				const routen = erlaubteRouten();
				protokolliere(routen === undefined
					? "Die gemeinsame Modell-Liste ist leer oder abgeschaltet; Teammitglieder erben das Modell des Leiters."
					: `Die gemeinsame Modell-Liste gilt jetzt fuer Teammitglieder (${routen.length} Routen): ${routeText(routen)}`);
			}
		}
		return { werkzeug, aufgegeben };
	};

	/**
	 * Baut beide Griffe ein.
	 *
	 * @returns {{durchreicher: boolean, werkzeug: boolean, aufgegeben: boolean}}
	 *          was gelungen ist. `werkzeug` ist true, sobald mindestens ein
	 *          Agenten-Scope das Werkzeug zeigt und es dort erweitert wurde;
	 *          ein Team-Werkzeug ist nicht in jedem Scope sichtbar, und "hier
	 *          nicht sichtbar" ist kein Fehler.
	 */
	const allesEinbauen = () => ({ durchreicher: startContinuableUmbiegen() === true, ...durchgang() });

	ctx.on("agent/created", () => {
		durchgang();
	});
	ctx.on("tools/change", () => {
		durchgang();
	});
	/**
	 * Nach einem Profil-Neuladen die Beschreibung neu setzen.
	 *
	 * Der Grund ist gemessen, nicht vermutet: die Liste erlaubter Modelle lebt
	 * in einer Einstellung, und wer sie in der Oberflaeche aendert, loest ein
	 * Neuladen der Konfiguration aus — nicht aber eine Aenderung an der
	 * Werkzeug-Schicht. Ohne diesen Hoerer blieb in der laufenden Sitzung die
	 * alte Beschreibung stehen, im schlimmsten Fall mit dem Hinweis, die
	 * Auswahl sei abgeschaltet, obwohl sie es nicht mehr ist.
	 */
	ctx.on("app-boot/config-reload", () => {
		durchgang();
	});

	/**
	 * Wie lange auf den fortsetzbaren Verwalter und das Team-Werkzeug gewartet
	 * wird. Der Verwalter erscheint erst, wenn der Agenten-Dienst steht, und
	 * das Werkzeug erst, wenn ein Team-Mitglied existiert; deshalb wird
	 * geduldig nachgesehen, aber nicht endlos.
	 */
	const VERSUCHE = 80;

	/** Wiederholungs-Wecker, solange der Verwalter noch nicht aufgetaucht ist. */
	let timer;

	ctx.effect(() => {
		// Der Verwalter ist die eine harte Bedingung: ohne ihn kann keine
		// Modellwahl ankommen. Das Werkzeug wird unabhaengig davon ueber
		// `agent/created` erweitert, sobald ein Team-Scope existiert.
		let versuche = 0;
		const versuchen = () => {
			const stand = allesEinbauen();
			if (stand.durchreicher) {
				if (timer !== undefined) { clearInterval(timer); timer = undefined; }
				if (!stand.werkzeug && !stand.aufgegeben) protokolliere("Der fortsetzbare Verwalter ist umgebogen; das Team-Werkzeug wird erweitert, sobald ein Team-Scope existiert.");
				return true;
			}
			versuche += 1;
			if (versuche > VERSUCHE) {
				if (timer !== undefined) { clearInterval(timer); timer = undefined; }
				melden("warn", "der fortsetzbare Verwalter blieb unauffindbar; die Modellwahl fuer Teammitglieder ist NICHT aktiv.");
				return true;
			}
			return false;
		};
		if (!versuchen()) timer = setInterval(versuchen, 250);
		return () => {
			if (timer !== undefined) clearInterval(timer);
			let verwaltung;
			try { verwaltung = ctx.get("subagents")?.continuations; } catch { verwaltung = undefined; }
			const prototyp = verwaltung === undefined ? undefined : Object.getPrototypeOf(verwaltung);
			if (prototyp?.startContinuable?.[MARKE] === true) prototyp.startContinuable = prototyp.startContinuable.original;
			for (const agent of ctx.agents.list()) {
				let definition;
				try { definition = ctx.tools.get(WERKZEUG, agent); } catch { definition = undefined; }
				if (definition === undefined) continue;
				ruecknahmen.get(definition)?.();
			}
		};
	}, "teammate-modell");
}

// ---------------------------------------------------------------------------
// Selbstpruefung: node ~/.dsh/patches/teammate-model.mjs
// ---------------------------------------------------------------------------
const alsHauptmodul = process.argv[1] !== undefined && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url; // realpath: der Start ueber einen Verweis (~/.dsh/patches -> dsh-projectOS) bleibt erkannt
if (alsHauptmodul) {
	const faelle = [
		{ args: {}, erwartet: undefined },
		// Der Kern verlangt: Anbieter-Feld nackt, Modell-Feld "anbieter/modell".
		// Das ist die kanonische Form; sie wird unveraendert durchgereicht.
		{ args: { provider: "homepc", model: "homepc/swift-1.5-iq3_xxs" }, erwartet: { provider: "homepc", model: "homepc/swift-1.5-iq3_xxs" } },
		{ args: { provider: "neuralwatt", model: "neuralwatt/gemma-4-31b" }, erwartet: { provider: "neuralwatt", model: "neuralwatt/gemma-4-31b" } },
		// Die vom Kern abgelehnte Form: nacktes Modell. Wird ueber die Liste
		// ergaenzt, wenn genau diese Route freigegeben ist.
		{ args: { provider: "homepc", model: "swift-1.5-iq3_xxs" }, erwartet: { provider: "homepc", model: "homepc/swift-1.5-iq3_xxs" } },
		{ args: { model: "homepc/swift-1.5-iq3_xxs" }, erwartet: { provider: "homepc", model: "homepc/swift-1.5-iq3_xxs" } },
		{ args: { model: "swift-1.5-iq3_xxs" }, erwartet: { provider: "homepc", model: "homepc/swift-1.5-iq3_xxs" } },
		{ args: { provider: "neuralwatt", model: "gemma-4-31b", reasoning_effort: "high" }, erwartet: { provider: "neuralwatt", model: "neuralwatt/gemma-4-31b", reasoningEffort: "high" } },
		// Ein Anbieter mit mehreren Modellen ist ohne Modell nicht entscheidbar.
		{ args: { provider: "anthropic" }, fehler: true },
		// Ein Anbieter mit genau einem freigegebenen Modell ist entscheidbar.
		{ args: { provider: "neuralwatt" }, erwartet: { provider: "neuralwatt", model: "neuralwatt/gemma-4-31b" } },
		{ args: { reasoning_effort: "high" }, fehler: true },
		{ args: { provider: "", model: "x" }, fehler: true }
	];
	let fehlgeschlagen = 0;
	// Die Selbstpruefung faehrt die gemeinsame Liste mit den zwei Routen, die
	// die Faelle unten brauchen (homepc/swift-1.5-iq3_xxs und neuralwatt/…),
	// plus ein Anbieter mit mehreren Modellen fuer den mehrdeutigen Fall.
	const pruefrouten = [
		{ provider: "homepc", model: "swift-1.5-iq3_xxs" },
		{ provider: "neuralwatt", model: "gemma-4-31b" },
		{ provider: "anthropic", model: "claude-haiku-5-5" },
		{ provider: "anthropic", model: "claude-sonnet-5-5" }
	];
	for (const fall of faelle) {
		try {
			const ergebnis = parseSelection(fall.args, pruefrouten);
			const gleich = JSON.stringify(ergebnis) === JSON.stringify(fall.erwartet);
			if (fall.fehler === true || !gleich) {
				fehlgeschlagen += 1;
				console.log(`FEHLER  ${JSON.stringify(fall.args)} -> ${JSON.stringify(ergebnis)}, erwartet ${JSON.stringify(fall.erwartet)}`);
			}
		} catch (error) {
			if (fall.fehler !== true) {
				fehlgeschlagen += 1;
				console.log(`FEHLER  ${JSON.stringify(fall.args)} -> unerwartet: ${error.message}`);
			}
		}
	}
	const routen = [{ provider: "neuralwatt", model: "gemma-4-31b" }];
	const listen = [
		[isAllowed(routen, "neuralwatt", "gemma-4-31b"), true, "erlaubte Route"],		[isAllowed(routen, "neuralwatt", "gpt-5.6-luna"), false, "fremdes Modell"],
		[isAllowed(undefined, "neuralwatt", "gemma-4-31b"), false, "leere Liste"],
		[routeText(routen), "neuralwatt/gemma-4-31b", "Text der Liste"],
		[routeText(undefined), "(keine)", "Text ohne Liste"]
	];
	for (const [ist, soll, was] of listen) {
		if (ist !== soll) {
			fehlgeschlagen += 1;
			console.log(`FEHLER  ${was}: ${JSON.stringify(ist)}, erwartet ${JSON.stringify(soll)}`);
		}
	}
	console.log(fehlgeschlagen === 0 ? "Selbstpruefung: alles in Ordnung." : `Selbstpruefung: ${fehlgeschlagen} Fehler.`);
	process.exitCode = fehlgeschlagen === 0 ? 0 : 1;
}
