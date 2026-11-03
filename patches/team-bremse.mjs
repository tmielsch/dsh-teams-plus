/**
 * team-bremse — hoechstens N Agenten gleichzeitig, der Rest wartet
 * =================================================================
 *
 * WAS DER MENSCH WOLLTE (Spec `docs/SPEC-LOKALMODUS.md`, Nachtrag 2026-11-03, 21:42)
 * Seine Woerter, sinngemaess: *„Deswegen koennte man sagen, okay, es duerfen
 * maximal zwei aktive Sessions zurzeit im Team sein. Und die anderen muessen
 * dann halt ihren Turn beenden und werden dann geweckt wieder, wenn die andere
 * vorbei ist. Aber es muss halt immer irgendwie ein Bewusstsein dafuer sein, wie
 * viele Aktive sind gerade da."*
 *
 * Der Grund steht in den Zahlen derselben Spec: **eine Grafikkarte.** Die Engine
 * cached zwoelf Gespraeche, ein Modellwechsel kostet rund zwei Sekunden und ist
 * billig. Teuer ist, wenn zwei Agenten gleichzeitig Toolcalls haemmern: dann wird
 * der Kontext jeder Sitzung aus dem Speicher verdraengt, bevor sie wieder
 * drankommt. Deshalb ist die Grenze eine **Obergrenze mit Warteschlange**, kein
 * Verbot — und sie ist eine Einstellung (Vorgabe 2), keine Behauptung: ob zwei
 * gleichzeitig wirklich schneller sind, haengt an der Laenge der Toolcalls und
 * ist in der Spec ausdruecklich als ungemessen vermerkt.
 *
 * WAS DIESES MODUL BAUT — und was nicht
 * Gebaut ist nur das Teilstueck **Zaehler und Bremse**: eine Konfiguration, ein
 * Werkzeug `team_bremse` mit `status` / `ein` / `aus`, und die Bremse selbst.
 * **Kein** Verdichten (`context_compact`), **kein** Modellwechsel — das ist der
 * naechste Auftrag, und die Felder `lokal`/`cloud` der Konfiguration werden
 * dafuer nur gelesen und geprueft, nicht benutzt.
 *
 * DIE EHRLICHE GRENZE (gemessen, nicht behauptet)
 * Einen Turn, der schon begonnen hat, kann dieses Modul NICHT verhindern. Der
 * Kern sagt es selbst (`dsh-agent/lib/types/runtime-types.d.ts`, `agent/status`):
 * *„A waking delivery enters `running` synchronously after reserving
 * cancellation."* Die Bremse wirkt **zwischen** den Zuegen, nicht mitten in
 * einem. Das ist in der Spec so festgehalten und kein Fehler der Umsetzung.
 *
 * Das gilt fuer JEDEN Weckruf, nicht nur fuer die Zielrunde: eine Nachricht des
 * Menschen, ein `send_message` oder das eigene Wieder-Scharfschalten von
 * `await_goal_dependency` setzt den Agenten synchron auf `running`, bevor dieses
 * Modul hinsehen kann. Solche Weckrufe werden NICHT abgefangen — `await_goal_dependency`
 * bleibt unberuehrt (an `patches/goal-await.mjs` arbeitet eine andere Spur). Was
 * die Bremse verhindert, ist die naechste Runde; sie ist keine Sperre gegen
 * Nachrichten.
 *
 * WAS SIE STATTDESSEN TUT, und warum das den beschriebenen Fall loest
 * Der beschriebene Fall ist: zwei Agenten haben beide ein scharfes Ziel, beide
 * bekommen Runden nachgeschoben, beide haemmern Toolcalls. Genau dort greift
 * sie, und zwar an der Stelle, an der der Rundentreiber die naechste Runde
 * anfordert.
 *
 *   1. `agent/status` mit `{ agent, status }` wird bei JEDEM Wechsel
 *      `idle` ⇄ `running` ausgesandt (`dsh-agent-loop/lib/index.js:798`, in
 *      `setPhase`; `status` ist `idle`, solange die Phase `idle` oder
 *      `maintenance` ist).
 *   2. Der Rundentreiber hoert auf dasselbe Ereignis: bei `idle` ruft er
 *      `requestDrive(state)` und `drive()` kehrt sofort zurueck, wenn
 *      `goal.activation !== "armed"` ist (`dsh-goal-round-driver/lib/index.js`,
 *      `drive`). Ein entwaffnetes Ziel bekommt also keine Runde mehr.
 *   3. Selbst wenn unser Entwaffnen ERST NACH dem Eintragen der Runde ankommt
 *      (Reihenfolge der Zuhoerer), faengt der Kern es ab: `validReservation` in
 *      `agent/pre-step` verlangt `goal.activation === "armed"` und
 *      `source.round === goal.roundsStarted + 1`; sonst wird die Runde
 *      `{ kind: "reject" }`-iert. Die zweite Sicherung ist damit gemessen, nicht
 *      gehofft.
 *   4. Das WECKEN ist derselbe Weg rueckwaerts: `ctx.goals.resume` laeuft ueber
 *      `commit` (`dsh-goal/lib/index.js:858-877`) und sendet dabei
 *      `goal/changed`; der Rundentreiber hoert darauf (`dsh-goal-round-driver`,
 *      `ctx.on("goal/changed")`) und ruft `requestDrive`. Ein Agent, der `idle`
 *      ist und dessen Ziel wieder scharf wurde, bekommt also seine naechste
 *      Runde, ohne dass dieses Modul ihn anstossen muesste. Genau deshalb besteht
 *      die Warteschlange aus nichts als `disarm` und `resume`.
 *
 * WER ALS AKTIV ZAEHLT — und warum nicht nur `running`
 * Die Spec nennt `agent/status` als Quelle. Ein reiner `running`-Zaehler haette
 * aber ein gemessenes Loch: zwischen „Runde zugesagt" und „Status wird running"
 * liegt ein Moment, in dem der Agent noch `idle` ist. Wer in diesem Moment
 * entscheidet, laesst eine ganze Traube gleichzeitig durch. Deshalb zaehlt
 * dieses Modul als belegt:
 *
 *   `running`                                    — laeuft jetzt,
 *   `idle` + Ziel `active` + `armed` + Runden frei — bekommt JETZT seine Runde.
 *
 * Der zweite Teil ist die Reservierung, ohne eigene Buchfuehrung: der Kern
 * schaltet das Ziel beim Zustellen der Runde selbst scharf, und ein Ziel, das
 * keine Runde mehr bekommen kann (Phase nicht `active`, Runden aufgebraucht),
 * zaehlt nicht. Eine Warteschlange kann deshalb nicht ueberlaufen, ohne dass die
 * Zahl daneben steht.
 *
 * DIE ENTSCHEIDUNG BEI JEDEM `idle` — und die eine Stelle, an der ich eine
 * Reihenfolge festgelegt habe
 *   1. Der Agent bekommt keine weitere Runde (kein Ziel, Ziel nicht scharf,
 *      Runden aufgebraucht): nichts zu tun, sein Platz ist frei.
 *   2. Er bekommt eine Runde, aber die Grenze ist ohne ihn schon erreicht:
 *      er wird entwaffnet und haengt sich hinten an.
 *   3. Er bekommt eine Runde, es wartet jemand, und mit ihm waere kein Platz
 *      mehr fuer den Wartenden: **der Wartende geht vor**, der gerade `idle`
 *      gewordene Agent reiht sich hinten ein.
 *   4. Sonst darf er seine Runde nehmen. Danach wird geweckt, solange Platz ist.
 *
 * Punkt 3 ist die Festlegung: sie folgt dem Satz der Spec, dass der aelteste
 * entwaffnete Agent geweckt wird, *„wenn die andere vorbei ist"*. Ohne sie
 * koennten zwei dauerhaft scharfe Ziele einen dritten fuer immer aussperren —
 * ein Wartender, der nie drankommt, ist keine Bremse, sondern ein Ausfall. Der
 * Agent verliert dabei nichts: sein Zug ist beendet, seine naechste Runde wird
 * beim Wecken nachgeschoben.
 *
 * `aus` ENTLAESST DIE WARTENDEN. Wer wegen der Bremse entwaffnet wurde, wird
 * beim Abschalten wieder scharf geschaltet — sonst bliebe er still liegen, und
 * ein abgeschaltetes Werkzeug waere schlimmer als keines. Entlassen wird nur,
 * wer noch dasselbe Ziel in derselben Revision hat; ein inzwischen beendetes
 * Ziel wird verworfen, nicht wiederbelebt.
 *
 * DIE KONFIGURATION — Form und Begruendung
 * Datei `~/.dsh/.tm/teams-plus/lokalmodus.json`, Pfad ueber den vorhandenen
 * Datenordner-Mechanismus (`DSH_HOME`, sonst `~/.dsh`; dieselbe Aufloesung wie
 * `team-board.mjs` und `send-to-session.mjs`, inklusive der Falle, dass
 * `DSH_HOME=""` als „nicht gesetzt" gilt und nicht als Arbeitsverzeichnis):
 *
 *   { "maxAktiv": 2,
 *     "lokal": { "provider": "homepc",            "model": "swift-1.5-iq2_xs" },
 *     "cloud": { "provider": "deepseek-official", "model": "deepseek-flash"   } }
 *
 * Warum diese Form: die Spec verlangt **einen Default, den man ueberschreiben
 * kann**, und die beiden Provider-Routen sind in der Spec beantwortet
 * (`homepc/swift-1.5-iq2_xs`, `deepseek-official/deepseek-flash`). Die Vorgaben
 * stehen deshalb im Code, und die Datei ueberschreibt **feldweise**: ein
 * kaputtes `maxAktiv` macht die gueltigen Modellfelder nicht ungueltig.
 *
 * Fehlt die Datei, gelten die Vorgaben und es wird NICHT gemeldet — das ist der
 * vorgesehene Weg, nicht ein Fehler. Ist sie kaputt (kein JSON, kein Objekt,
 * falscher Typ, unlesbar), wird LAUT gemeldet: eine Zeile je Befund ins
 * Protokoll, `ctx.logger.warn`, und jede Antwort von `team_bremse` traegt das
 * Feld `warning`. Gearbeitet wird trotzdem, mit den Vorgaben — ein Werkzeug, das
 * beim Start wegen einer kaputten Datei nicht existiert, waere still.
 *
 * Gelesen wird beim Start des Plugins, nicht bei jeder Entscheidung: ein
 * Zaehler, der seine Grenze mitten im Lauf wechselt, waere nicht nachvollziehbar.
 * Nach dem Aendern der Datei also DSH neu starten; das Ein- und Ausschalten
 * dagegen geht ohne Neustart (`ein`/`aus`, nur im Speicher).
 *
 * WAS DIESES MODUL NICHT TUT
 *   - Es bricht keinen laufenden Turn ab (das wuerde Arbeit verlieren).
 *   - Es erzeugt keine Sitzung und keine Rolle; es zaehlt und entwaffnet nur.
 *   - Es kennt keine Namen, Kennungen oder Sonderfaelle bestimmter Agenten: jede
 *     Regel haengt an `agent.status`, am Ziel (`phase`, `activation`,
 *     `roundsStarted`/`maxGoalRounds`) und an der Zahl der Lebenden.
 *   - Es schreibt ausser Protokoll und Konfiguration nichts.
 *
 * SELBSTPRUEFUNG
 *   node --test test/team-bremse.test.mjs
 *   (13 Faelle, darunter die fuenf Pflichtfaelle aus dem Auftrag und die
 *   Gegenprobe am Code: eine Kopie unter /tmp, in der `ueberGrenze` immer
 *   `false` liefert, muss die zwei Kerntests ROT machen.)
 * NACHSEHEN
 *   ~/.dsh/.tm/teams-plus/lokalmodus.json
 *   ~/.dsh/.tm/teams-plus/logs/team-bremse.log
 * ZURUECK
 *   den Eintrag `team-bremse` in cordis.patch.yml entfernen und DSH neu starten.
 *   Ein entwaffnetes Ziel bleibt entwaffnet, bis der Mensch oder eine Nachricht
 *   es wieder scharf macht — genau wie beim Kern nach einem Neustart.
 */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Das Kernpaket, das dieses Modul zur Laufzeit braucht (nie statisch importieren). */
const PAKET_WERKZEUGE = "@deepseek-ai/dsh-tools";

/** Name des Werkzeugs, das die Agenten und der Mensch aufrufen. */
export const WERKZEUG = "team_bremse";

/** Die drei Aktionen des Werkzeugs. */
export const AKTIONEN = Object.freeze(["status", "ein", "aus"]);

/** Vorgabe der Grenze, wenn die Konfigurationsdatei sie nicht nennt. */
export const VORGABE_MAX_AKTIV = 2;

/** Vorgabe der lokalen Route (Spec F3: `homepc/swift-1.5-iq2_xs`). */
export const VORGABE_LOKAL = Object.freeze({ provider: "homepc", model: "swift-1.5-iq2_xs" });

/** Vorgabe der Cloud-Route (Spec F3: `deepseek-official/deepseek-flash`). */
export const VORGABE_CLOUD = Object.freeze({ provider: "deepseek-official", model: "deepseek-flash" });

/**
 * Das Harness-Zuhause: `~/.dsh`, oder das, was `DSH_HOME` sagt.
 *
 * `DSH_HOME=""` heisst „nicht gesetzt", nicht „das Arbeitsverzeichnis" — dieselbe
 * Falle, die in `send-to-session.mjs` (Backlog A2) schon einmal zugeschnappt ist.
 */
function dshHeim() {
	const gesetzt = process.env.DSH_HOME?.trim();
	return gesetzt === undefined || gesetzt === "" ? join(homedir(), ".dsh") : gesetzt;
}

/**
 * Der Ort der Konfiguration: `~/.dsh/.tm/teams-plus/lokalmodus.json`.
 *
 * Exportiert, damit der Test ihn umlenken kann, ohne ins echte `~/.dsh` zu schreiben.
 */
export function konfigurationsPfad() {
	return join(dshHeim(), ".tm", "teams-plus", "lokalmodus.json");
}

/** Der Protokollpfad. E1: eigene Daten unter `.tm/teams-plus`, nicht in `~/.dsh/logs`. */
export function protokollPfad() {
	return join(dshHeim(), ".tm", "teams-plus", "logs", "team-bremse.log");
}

/** Eine Zeile ins Protokoll. Ein fehlender Ordner oder ein Recht darf nie werfen. */
export function protokolliere(text) {
	try {
		const pfad = protokollPfad();
		mkdirSync(dirname(pfad), { recursive: true });
		appendFileSync(pfad, `${new Date().toISOString()} ${text}\n`);
	} catch {
		/* Protokoll ist Beiwerk; es darf nie eine Entscheidung verhindern. */
	}
}

/** Ist der Wert ein schlichtes Objekt (kein Array, kein null)? */
function istObjekt(wert) {
	return wert !== null && typeof wert === "object" && Array.isArray(wert) === false;
}

/** Die Vorgabe-Konfiguration als frische Kopie (niemand soll die Vorgabe veraendern). */
export function vorgabeKonfiguration() {
	return {
		maxAktiv: VORGABE_MAX_AKTIV,
		lokal: { ...VORGABE_LOKAL },
		cloud: { ...VORGABE_CLOUD }
	};
}

/**
 * Prueft einen Modellblock (`lokal` oder `cloud`).
 *
 * @param wert - der rohe Wert aus der Datei.
 * @returns `undefined`, wenn er in Ordnung ist, sonst der Grund im Klartext.
 */
function modellFehler(wert) {
	if (!istObjekt(wert)) return "ist kein Objekt";
	for (const feld of ["provider", "model"]) {
		const teil = wert[feld];
		if (typeof teil !== "string" || teil.trim() === "") return `hat kein nicht-leeres "${feld}"`;
	}
	return undefined;
}

/**
 * Liest die Konfiguration und mischt sie feldweise ueber die Vorgaben.
 *
 * Was hier passiert, ist Absicht: ein kaputtes Feld wird **laut** gemeldet und
 * durch seine Vorgabe ersetzt, die anderen Felder der Datei bleiben gueltig. Eine
 * fehlende Datei ist kein Fehler — sie ist der dokumentierte Weg zu den Vorgaben.
 *
 * @param pfad - der Pfad der Datei; Vorgabe ist {@link konfigurationsPfad}.
 * @returns `{ werte, quelle, fehler }`; `fehler` ist leer, wenn alles stimmt.
 *          `quelle` ist `"datei"` oder `"vorgabe"`.
 */
export function leseKonfiguration(pfad = konfigurationsPfad()) {
	const werte = vorgabeKonfiguration();
	const fehler = [];
	let roh;
	try {
		roh = readFileSync(pfad, "utf8");
	} catch (irrtum) {
		if (irrtum?.code !== "ENOENT") {
			fehler.push(`${pfad} ist nicht lesbar (${irrtum?.code ?? "Fehler"}): ${irrtum?.message ?? String(irrtum)}`);
		}
		return { werte, quelle: "vorgabe", fehler };
	}
	let daten;
	try {
		daten = JSON.parse(roh);
	} catch (irrtum) {
		fehler.push(`${pfad} ist kein gueltiges JSON: ${irrtum?.message ?? String(irrtum)}`);
		return { werte, quelle: "vorgabe", fehler };
	}
	if (!istObjekt(daten)) {
		fehler.push(`${pfad} enthaelt kein Objekt, sondern ${Array.isArray(daten) ? "eine Liste" : typeof daten}`);
		return { werte, quelle: "vorgabe", fehler };
	}

	if (daten.maxAktiv !== undefined) {
		if (Number.isInteger(daten.maxAktiv) && daten.maxAktiv >= 1) {
			werte.maxAktiv = daten.maxAktiv;
		} else {
			fehler.push(`"maxAktiv" ist ${JSON.stringify(daten.maxAktiv)}; erlaubt ist eine ganze Zahl ab 1. Es gilt die Vorgabe ${VORGABE_MAX_AKTIV}.`);
		}
	}
	for (const feld of ["lokal", "cloud"]) {
		if (daten[feld] === undefined) continue;
		const grund = modellFehler(daten[feld]);
		if (grund === undefined) {
			werte[feld] = { provider: daten[feld].provider.trim(), model: daten[feld].model.trim() };
		} else {
			fehler.push(`"${feld}" ${grund}. Es gilt die Vorgabe ${JSON.stringify(werte[feld])}.`);
		}
	}
	return { werte, quelle: "datei", fehler };
}

/**
 * Die Grenzpruefung — an EINER Stelle, damit die Gegenprobe sie ausbauen kann.
 *
 * @param anzahl - wie viele Agenten belegt sind.
 * @param grenze - die erlaubte Zahl.
 * @returns true, wenn die Grenze erreicht oder ueberschritten ist.
 */
export function ueberGrenze(anzahl, grenze) {
	return anzahl >= grenze;
}

/**
 * Ob ein Ziel gerade eine weitere Runde bekommen wuerde.
 *
 * Die drei Bedingungen sind die des Rundentreibers: Phase `active`, `armed`, und
 * der Rundenvorrat darf nicht aufgebraucht sein (`drive` blockt sonst mit
 * `round-limit`). Ein Ziel ohne Wartezustand, ein pausiertes, ein beendetes und
 * ein von `await_goal_dependency` entwaffnetes zaehlen deshalb NICHT.
 *
 * @param ziel - die Sicht aus `ctx.goals.get(agent)`, darf fehlen.
 * @returns true, wenn eine Entwaffnung diese Runde noch verhindern kann.
 */
export function istBremsbar(ziel) {
	if (ziel === undefined || ziel === null) return false;
	if (ziel.phase !== "active" || ziel.activation !== "armed") return false;
	const erschoepft = typeof ziel.roundsStarted === "number"
		&& typeof ziel.maxGoalRounds === "number"
		&& ziel.roundsStarted >= ziel.maxGoalRounds;
	return !erschoepft;
}

/**
 * Die Bremse selbst, ohne Cordis — damit ein Test sie ohne Host pruefen kann.
 *
 * @param dienste - `{ agenten, ziele, maxAktiv, protokoll }`.
 *   `agenten` braucht `list()` und `get(id)`, `ziele` braucht `get(agent)`,
 *   `disarm(agent)` und `resume(agent, ref)`; `protokoll` ist optional.
 * @returns die Bremse; alle Methoden sind synchron.
 */
export function erzeugeBremse(dienste) {
	const { agenten, ziele, maxAktiv } = dienste;
	const protokoll = typeof dienste.protokoll === "function" ? dienste.protokoll : () => {};
	const grenze = Number.isInteger(maxAktiv) && maxAktiv >= 1 ? maxAktiv : VORGABE_MAX_AKTIV;

	/** Nur im Speicher: ein Neustart entwaffnet ohnehin, was das Ziel betrifft. */
	let scharf = false;

	/** Die Wartenden, aeltester zuerst: `{ agent, zielId, revision, seit }`. */
	const wartende = [];

	/** Alle lebenden Agenten, notfalls keine. */
	function liste() {
		try {
			const alle = agenten.list();
			return Array.isArray(alle) ? alle.filter((agent) => agent !== undefined && agent !== null) : [];
		} catch {
			return [];
		}
	}

	/** Das Ziel eines Agenten; ein nicht mehr lebender Agent wirft im Kern, hier nicht. */
	function holeZiel(agent) {
		try {
			return ziele.get(agent);
		} catch {
			return undefined;
		}
	}

	/**
	 * Wie viele Agenten belegt sind (ausser dem uebergebenen).
	 *
	 * `running` zaehlt direkt; `idle` zaehlt, wenn sein Ziel gerade eine Runde
	 * bekommen wuerde (die Reservierung, siehe Dateikopf).
	 */
	function belegtOhne(agent) {
		let anzahl = 0;
		for (const anderer of liste()) {
			if (anderer === agent) continue;
			if (anderer.status === "running") {
				anzahl += 1;
				continue;
			}
			if (istBremsbar(holeZiel(anderer))) anzahl += 1;
		}
		return anzahl;
	}

	/** Wie viele Agenten belegt sind, ueber alle. */
	function belegt() {
		let anzahl = 0;
		for (const agent of liste()) {
			if (agent.status === "running") {
				anzahl += 1;
				continue;
			}
			if (istBremsbar(holeZiel(agent))) anzahl += 1;
		}
		return anzahl;
	}

	/** Ob ein Wartender noch derselbe ist (Agent lebendig, Ziel unveraendert, entwaffnet). */
	function istGueltig(eintrag) {
		if (eintrag === undefined) return false;
		const lebendig = typeof agenten.get === "function" ? agenten.get(eintrag.agent.id) : undefined;
		if (lebendig !== eintrag.agent) return false;
		const ziel = holeZiel(eintrag.agent);
		if (ziel === undefined) return false;
		if (ziel.id !== eintrag.zielId || ziel.revision !== eintrag.revision) return false;
		if (ziel.phase !== "active") return false;
		// Schon wieder scharf: jemand anders war schneller, es gibt nichts zu wecken.
		return ziel.activation === "disarmed";
	}

	/** Ob jemand wartet; raeumt dabei veraltete Eintraege weg, ohne einen gueltigen zu nehmen. */
	function jemandWartet() {
		for (let i = 0; i < wartende.length;) {
			if (istGueltig(wartende[i])) return true;
			protokoll(`verworfen agent=${wartende[i].agent.id} grund=ziel-oder-agent-weg`);
			wartende.splice(i, 1);
		}
		return false;
	}

	/** Der aelteste gueltige Wartende, aus der Liste entfernt; veraltete werden verworfen. */
	function naechsterWartender() {
		while (wartende.length > 0) {
			const eintrag = wartende.shift();
			if (istGueltig(eintrag)) return eintrag;
			protokoll(`verworfen agent=${eintrag.agent.id} grund=ziel-oder-agent-weg`);
		}
		return undefined;
	}

	/** Entwaffnet einen Agenten und stellt ihn hinten an. */
	function sperre(agent, ziel) {
		try {
			ziele.disarm(agent);
		} catch (fehler) {
			protokoll(`warn entwaffnen fehlgeschlagen agent=${agent.id} fehler=${fehler instanceof Error ? fehler.message : String(fehler)}`);
			return false;
		}
		if (!wartende.some((eintrag) => eintrag.agent === agent)) {
			wartende.push({ agent, zielId: ziel.id, revision: ziel.revision, seit: Date.now() });
		}
		protokoll(`warten agent=${agent.id} ziel=${ziel.id} grenze=${grenze} belegt=${belegt()}`);
		return true;
	}

	/** Schaltet einen Wartenden wieder scharf. */
	function entlasse(eintrag) {
		try {
			ziele.resume(eintrag.agent, { id: eintrag.zielId, revision: eintrag.revision });
			protokoll(`wecken agent=${eintrag.agent.id} ziel=${eintrag.zielId} gewartet=${Math.max(0, Math.round((Date.now() - eintrag.seit) / 1000))}s`);
			return true;
		} catch (fehler) {
			protokoll(`warn wecken fehlgeschlagen agent=${eintrag.agent.id} ziel=${eintrag.zielId} fehler=${fehler instanceof Error ? fehler.message : String(fehler)}`);
			return false;
		}
	}

	/** Weckt Wartende, solange ein Platz frei ist. */
	function weckeWartende() {
		for (;;) {
			if (ueberGrenze(belegt(), grenze)) return;
			const eintrag = naechsterWartender();
			if (eintrag === undefined) return;
			entlasse(eintrag);
		}
	}

	/**
	 * Ein Agent ist auf `idle` gegangen und wuerde jetzt seine naechste Runde bekommen.
	 *
	 * @param agent - der Agent aus dem `agent/status`-Ereignis.
	 */
	function agentIdle(agent) {
		if (!scharf) return;
		const ziel = holeZiel(agent);
		if (istBremsbar(ziel)) {
			const andere = belegtOhne(agent);
			const keinPlatz = ueberGrenze(andere, grenze);
			// Der Wartende geht vor, wenn mit diesem Agenten kein Platz mehr fuer ihn bliebe.
			const wartenderGehtVor = jemandWartet() && ueberGrenze(andere + 1, grenze);
			if (keinPlatz || wartenderGehtVor) sperre(agent, ziel);
		}
		weckeWartende();
	}

	/** Ein Agent wird abgebaut: sein Warteeintrag ist nichts mehr wert. */
	function agentWeg(agent) {
		const index = wartende.findIndex((eintrag) => eintrag.agent === agent);
		if (index < 0) return;
		wartende.splice(index, 1);
		protokoll(`verworfen agent=${agent.id} grund=agent-entfernt`);
	}

	/** Schaltet die Bremse scharf und nimmt sofort die Ueberzaehligen aus dem Verkehr. */
	function ein() {
		scharf = true;
		const alle = liste();
		let ladung = 0;
		for (const agent of alle) {
			if (agent.status === "running") ladung += 1;
		}
		for (const agent of alle) {
			if (agent.status === "running") continue;
			const ziel = holeZiel(agent);
			if (!istBremsbar(ziel)) continue;
			if (ueberGrenze(ladung, grenze)) sperre(agent, ziel);
			else ladung += 1;
		}
		protokoll(`ein grenze=${grenze} agenten=${alle.length} wartend=${wartende.length}`);
		weckeWartende();
	}

	/** Schaltet die Bremse ab und entlaesst alle, die sie geparkt hat. */
	function aus() {
		scharf = false;
		let entlassen = 0;
		for (;;) {
			const eintrag = naechsterWartender();
			if (eintrag === undefined) break;
			if (entlasse(eintrag)) entlassen += 1;
		}
		protokoll(`aus entlassen=${entlassen}`);
	}

	/**
	 * Der Stand fuer die Aktion `status`.
	 *
	 * `running` ist die Zahl, die die Spec nennt; `bremsbarIdle` ist die Nachfrage
	 * (Agenten, die JETZT eine Runde bekommen wuerden) und `nichtBremsbar` sind
	 * laufende Agenten ohne scharfes Ziel — die ehrliche Grenze, sichtbar gemacht.
	 */
	function status() {
		const running = [];
		const idle = [];
		const bremsbarIdle = [];
		const nichtBremsbar = [];
		for (const agent of liste()) {
			const kennung = String(agent.id);
			const ziel = holeZiel(agent);
			if (agent.status === "running") {
				running.push(kennung);
				if (!istBremsbar(ziel)) nichtBremsbar.push(kennung);
				continue;
			}
			idle.push(kennung);
			if (istBremsbar(ziel)) bremsbarIdle.push(kennung);
		}
		return {
			scharf,
			grenze,
			running,
			idle,
			bremsbarIdle,
			nichtBremsbar,
			// Nur die Wartenden, die noch warten: ein Ziel, das inzwischen beendet
			// wurde, ist kein Platz in der Schlange mehr. Gefiltert, nicht geloescht
			// — `status` ist ein Lesevorgang und veraendert nichts.
			wartend: wartende.filter(istGueltig).map((eintrag) => String(eintrag.agent.id)),
			ueberschritten: running.length > grenze,
			belegt: running.length + bremsbarIdle.length
		};
	}

	return { ein, aus, istScharf: () => scharf, status, agentIdle, agentWeg, weckeWartende };
}

/**
 * Die Basis-Ordner der dsh-Installation, in der Reihenfolge der Wahrscheinlichkeit.
 *
 * Der Weg haengt an der Installation, nicht an diesem Verzeichnis: die
 * Kernpakete wohnen NUR dort, und ein statischer Import aus `.tm/teams-plus`
 * faende sie nicht (doppelte Modul-Instanzen brechen jeden Tool-Call, siehe
 * ~/.dsh/AGENTS.md).
 */
function kernBasis() {
	const basis = new Set();
	const fuegen = (pfad) => {
		if (typeof pfad !== "string" || pfad.length === 0) return;
		basis.add(pfad);
		const knoten = pfad.indexOf("/node_modules/");
		if (knoten >= 0) basis.add(pfad.slice(0, knoten + 1));
	};
	for (const argument of process.argv) fuegen(argument);
	fuegen(process.execPath);
	basis.add("/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai");
	fuegen(join(homedir(), ".dsh", "lib", "node_modules", "@deepseek-ai"));
	fuegen("/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai");
	fuegen("/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai");
	return [...basis];
}

let werkzeugBaustein;

/** Laedt einen Kernbaustein ueber alle bekannten Ablageformen. */
async function ladeKern(paket) {
	const unterpfad = paket.replace("@deepseek-ai/", "");
	const kandidaten = [paket];
	for (const basis of kernBasis()) {
		kandidaten.push(join(basis, unterpfad, "lib", "index.js"));
		kandidaten.push(join(basis, "dsh", "node_modules", "@deepseek-ai", unterpfad, "lib", "index.js"));
	}
	for (const kandidat of kandidaten) {
		try {
			return await import(kandidat);
		} catch { /* naechster Kandidat */ }
	}
	return undefined;
}

/** Die Felder der Antwort von `team_bremse`, einmal fuer Schema und Wert. */
const AUSGABE_FELDER = {
	scharf: { type: "boolean", required: true },
	grenze: { type: "number", required: true },
	running: { type: "array", required: true, items: { type: "string" } },
	idle: { type: "array", required: true, items: { type: "string" } },
	bremsbarIdle: { type: "array", required: true, items: { type: "string" } },
	nichtBremsbar: { type: "array", required: true, items: { type: "string" } },
	wartend: { type: "array", required: true, items: { type: "string" } },
	ueberschritten: { type: "boolean", required: true },
	belegt: { type: "number", required: true },
	note: { type: "string", required: true },
	warning: { type: "string" },
	konfiguration: {
		type: "object",
		required: true,
		additionalProperties: false,
		properties: {
			pfad: { type: "string", required: true },
			quelle: { type: "string", required: true, enum: ["datei", "vorgabe"] },
			maxAktiv: { type: "number", required: true }
		}
	}
};

/**
 * Die Beschreibung, die das Modell bei jedem Aufruf sieht.
 *
 * Kurz, verhaltensorientiert, und mit der Grenze VOR den Aktionen: was das
 * Werkzeug nicht kann, ist die wichtigere Information.
 */
const BESCHREIBUNG = [
	"Cap how many agents work at the same time on this machine, and report who is active right now.",
	"",
	"WHY: this machine has one GPU and caches about a dozen conversations, so switching models is cheap. What is expensive is two agents hammering tool calls at once: one agent's context gets pushed out of memory. This brake keeps at most `maxAktiv` agents active; the others finish their turn and are woken when a slot frees.",
	"",
	"WHAT IT DOES: 'status' reports every live agent as running or idle with its session id, the limit, how many are occupied, and whether the limit is currently exceeded. 'ein' arms the brake (in memory, no restart) and immediately parks the agents over the limit. 'aus' disarms it and wakes everyone it had parked.",
	"",
	"HONEST LIMIT: the brake acts BETWEEN turns. It cannot stop a turn that has already started — a waking delivery enters 'running' before anything else runs. What it does stop is the next round: an agent over the limit is disarmed (its goal keeps its phase and revision but loses continuation authority) and is woken when a slot frees. An agent that is running without an active, armed goal cannot be braked at all; 'status' lists those under `nichtBremsbar`.",
	"",
	"The limit comes from `lokalmodus.json` in this plugin's data folder (`maxAktiv`, default 2), read at startup. While the brake is not armed, nothing is touched."
].join("\n");

/**
 * Baut die Werkzeugdefinition.
 *
 * Getrennt von `apply`, damit ein Test die Bremse ohne Host pruefen kann; die
 * Definition selbst braucht nur `defineTool` und die Bremse.
 *
 * @param optionen - `{ defineTool, bremse, konfiguration }`; `konfiguration` ist
 *                   das Ergebnis von {@link leseKonfiguration}.
 * @returns die Definition fuer `ctx.tools.register`.
 */
export function baueWerkzeug({ defineTool, bremse, konfiguration }) {
	const warnung = konfiguration.fehler.length === 0 ? undefined : konfiguration.fehler.join(" ");
	return defineTool({
		name: WERKZEUG,
		description: BESCHREIBUNG,
		parameters: {
			aktion: {
				type: "string",
				required: true,
				enum: [...AKTIONEN],
				description: "'status' reads the counter; 'ein' arms the brake; 'aus' disarms it and wakes the agents it had parked."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: AUSGABE_FELDER
			},
			render: (_args, wert) => [{ type: "text", text: JSON.stringify(wert) }]
		},
		presentCall: (args) => ({
			card: "generic",
			title: args.aktion === "ein" ? "Arm the brake" : args.aktion === "aus" ? "Disarm the brake" : "Active agents",
			kind: args.aktion === "status" ? "read" : "other"
		}),
		presentResult: () => ({ card: "generic", title: "Team brake" }),
		// Ein- und Ausschalten aendert den gemeinsamen Zustand; zwei Aufrufe duerfen
		// nicht gleichzeitig als unabhaengig gelten.
		isConcurrencySafe: () => false,
		execute: async (args) => {
			const aktion = args?.aktion;
			if (aktion === "ein") bremse.ein();
			else if (aktion === "aus") bremse.aus();
			const stand = bremse.status();
			const note = !stand.scharf
				? `The brake is OFF; ${stand.running.length} agent(s) are running and nothing is touched. Arm it with 'ein'.`
				: stand.ueberschritten
					? `The brake is ON with limit ${stand.grenze}, but ${stand.running.length} agents are running — the limit is exceeded. A running turn is not interrupted; the brake only keeps the next rounds from starting.`
					: `The brake is ON with limit ${stand.grenze}; ${stand.running.length} running, ${stand.wartend.length} parked and waiting for a slot.`;
			return {
				...stand,
				note,
				konfiguration: {
					pfad: konfiguration.pfad,
					quelle: konfiguration.quelle,
					maxAktiv: konfiguration.werte.maxAktiv
				},
				...(warnung === undefined ? {} : { warning: warnung })
			};
		}
	});
}

export const name = "team-bremse";

/** Cordis-Dienste, ohne die dieses Modul nichts tun kann. */
export const inject = ["tools", "agents", "goals"];

/**
 * Haengt das Modul in den Host.
 *
 * @param ctx - der Cordis-Kontext des Profils.
 * @param optionen - nur fuer Tests: `{ konfigurationsPfad }` lenkt die Datei um.
 */
export function apply(ctx, optionen = {}) {
	const melden = (stufe, text) => {
		protokolliere(text);
		try {
			const logger = ctx.logger;
			if (logger !== undefined && typeof logger[stufe] === "function") logger[stufe](`team-bremse: ${text}`);
		} catch { /* Ein fehlendes Protokoll darf den Start nie stoeren. */ }
	};

	const pfad = optionen.konfigurationsPfad ?? konfigurationsPfad();
	const gelesen = leseKonfiguration(pfad);
	if (gelesen.fehler.length === 0) {
		melden("info", `Konfiguration aus ${pfad} (${gelesen.quelle}): maxAktiv=${gelesen.werte.maxAktiv}`);
	} else {
		for (const befund of gelesen.fehler) melden("warn", `KAPUTTE KONFIGURATION ${befund}`);
		melden("warn", `es gilt die Vorgabe maxAktiv=${gelesen.werte.maxAktiv}; die Datei ${pfad} bitte reparieren`);
	}

	const bremse = erzeugeBremse({
		agenten: {
			list: () => ctx.agents.list(),
			get: (id) => ctx.agents.get(id)
		},
		ziele: {
			get: (agent) => ctx.goals.get(agent),
			disarm: (agent) => ctx.goals.disarm(agent),
			resume: (agent, ref) => ctx.goals.resume(agent, ref)
		},
		maxAktiv: gelesen.werte.maxAktiv,
		protokoll: protokolliere
	});

	const konfiguration = {
		pfad,
		quelle: gelesen.quelle,
		werte: gelesen.werte,
		fehler: gelesen.fehler
	};

	ctx.effect(() => {
		let abgemeldet = false;
		let abRegister;

		// 1. Der Takt der Bremse: jeder Wechsel idle ⇄ running. Nur `idle` ist eine
		//    Entscheidung — `running` heisst, der Turn laeuft schon, und der wird
		//    nicht abgebrochen (siehe Dateikopf, ehrliche Grenze).
		const abStatus = ctx.on("agent/status", ({ agent, status }) => {
			if (status !== "idle") return;
			try {
				bremse.agentIdle(agent);
			} catch (fehler) {
				melden("warn", `Bremse konnte beim Wechsel auf idle nicht entscheiden: ${fehler instanceof Error ? fehler.message : String(fehler)}`);
			}
		});

		// 2. Ein Agent verschwindet: sein Warteeintrag ist nichts mehr wert.
		const abWeg = ctx.on("agent/disposed", ({ agent }) => {
			bremse.agentWeg(agent);
		});

		(async () => {
			werkzeugBaustein ??= await ladeKern(PAKET_WERKZEUGE);
			if (abgemeldet) return;
			const defineTool = werkzeugBaustein?.defineTool;
			if (typeof defineTool !== "function") {
				melden("warn", "der Werkzeug-Baustein (defineTool) ist nicht auffindbar; das Werkzeug steht nicht zur Verfuegung");
				return;
			}
			try {
				abRegister = ctx.tools.register(baueWerkzeug({ defineTool, bremse, konfiguration }));
				melden("info", `Werkzeug ${WERKZEUG} registriert (Aktionen ${AKTIONEN.join(", ")})`);
			} catch (fehler) {
				melden("warn", `Werkzeug konnte nicht angemeldet werden: ${fehler instanceof Error ? fehler.message : String(fehler)}`);
			}
		})();

		return () => {
			abgemeldet = true;
			if (typeof abRegister === "function") abRegister();
			abStatus?.();
			abWeg?.();
		};
	}, "team-bremse lifecycle");

	melden("info", "geladen");
}
