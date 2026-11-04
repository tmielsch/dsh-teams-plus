/**
 * team-anruf.test.mjs — die Anrufdatenbank, mit Gegenprobe am Code.
 *
 * Die Lehre aus Issue #10 gilt hier: eine Pruefung ohne Gegenprobe ist eine
 * Behauptung. Deshalb steht am Ende jeder Pruefung ein Fall, der scheitern
 * MUSS — und fuer die Suche, den Kern des Moduls, eine Gegenprobe am echten
 * Code: eine Kopie unter /tmp, in der die Suche ausgebaut ist.
 *
 * Gesteuert wird ueber TEAM_ANRUF_MODUL: ohne die Variable gilt das Modul des
 * Repos, mit ihr die Kopie. Dieselbe Umlenkung benutzt team-bremse.test.mjs.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const PAKET = join(HIER, "..");
const MODUL = join(PAKET, "patches", "team-anruf.mjs");
const MODUL_DATEI = process.env.TEAM_ANRUF_MODUL ?? MODUL;

const modul = await import(MODUL_DATEI);

// ---------------------------------------------------------------------------
// Werkstatt: ein temporaeres Zuhause, damit der Test das echte nie anfasst.
// ---------------------------------------------------------------------------

function werkstatt() {
	const heim = mkdtempSync(join(tmpdir(), "teams-plus-anruf-"));
	const pfad = join(heim, "state", "anrufe.json");
	return { heim, pfad, aufraeumen: () => rmSync(heim, { recursive: true, force: true }) };
}

/** Ein Lauf auf der Ablage, mit dem Schreiben am Ende — wie es das Werkzeug tut. */
function mitAblage(ort, arbeit) {
	const ablage = existsSync(ort.pfad) ? modul.ladeAblage(ort.pfad) : modul.leereAblage();
	const { ablage: neu, ergebnis } = arbeit(ablage);
	modul.speichereAblage(neu, ort.pfad);
	return ergebnis;
}

// ---------------------------------------------------------------------------
// 1. Der ganze Lauf
// ---------------------------------------------------------------------------

test("der ganze Lauf: oeffnen, lesen, fork nachtragen, schliessen, lesen", () => {
	const ort = werkstatt();
	try {
		// oeffnen
		const anruf = mitAblage(ort, (ablage) => {
			const r = modul.oeffneAnruf(ablage, {
				von: "session-anna",
				an: "session-bert",
				thema: "Wer hat die Sperre zuletzt angefasst",
				stichworte: ["sperre", "zeitstempel"],
				jetzt: 1_700_000_000_000
			});
			return { ablage: r.ablage, ergebnis: r.eintrag };
		});
		assert.match(anruf.id, /^anruf-\d+$/u, "die Kennung muss anruf-<n> sein")
		assert.equal(anruf.stand, "offen", "ein neuer Anruf ist offen")
		assert.equal(anruf.zusammenfassung, "", "ein offener Anruf hat keine Zusammenfassung")
		assert.deepEqual(anruf.forks, [])

		// lesen
		const gelesen = modul.ladeAblage(ort.pfad);
		assert.equal(gelesen.eintraege.length, 1)
		assert.equal(gelesen.naechsteId, 2, "die naechste Kennung ist schon weitergeschaltet")

		// fork nachtragen
		mitAblage(ort, (ablage) => {
			const r = modul.trageFork(ablage, anruf.id, "session-fork-bert");
			return { ablage: r.ablage, ergebnis: r.eintrag };
		});
		// schliessen
		const geschlossen = mitAblage(ort, (ablage) => {
			const r = modul.schliesseAnruf(ablage, anruf.id, "Die Sperre hielt nur 600 ms; jetzt misst sie 5 s.", 1_700_000_100_000);
			return { ablage: r.ablage, ergebnis: r.eintrag };
		});

		assert.equal(geschlossen.stand, "erledigt")
		assert.deepEqual(geschlossen.forks, ["session-fork-bert"], "die Fork-Kennung muss erhalten bleiben")
		assert.match(geschlossen.zusammenfassung, /600 ms/u)

		// und noch einmal von der Platte
		const amEnde = modul.findeAnruf(modul.ladeAblage(ort.pfad), anruf.id);
		assert.equal(amEnde.stand, "erledigt")
		assert.equal(amEnde.zusammenfassung, geschlossen.zusammenfassung)
	} finally {
		ort.aufraeumen()
	}
})

test("GEGENPROBE zu 1: ohne Zusammenfassung laesst sich ein Anruf nicht schliessen", () => {
	// Ohne diesen Fall waere Test 1 auch dann gruen, wenn "schliessen" den Text
	// einfach ignorierte und den Stand setzte.
	const ablage = modul.leereAblage();
	const { ablage: mitAnruf, eintrag } = modul.oeffneAnruf(ablage, {
		von: "a", an: "b", thema: "x", jetzt: 1
	});
	for (const leer of [undefined, "", "   "]) {
		assert.throws(
			() => modul.schliesseAnruf(mitAnruf, eintrag.id, leer),
			/the summary of a closed call/u,
			`schliessen mit ${JSON.stringify(leer)} muss abgelehnt werden`
		)
	}
	// Und der Eintrag ist danach immer noch offen, nicht halb geschlossen.
	assert.equal(modul.findeAnruf(mitAnruf, eintrag.id).stand, "offen")
})

// ---------------------------------------------------------------------------
// 2. Die Suche — der Kern des Moduls
// ---------------------------------------------------------------------------

test("die Suche findet ueber ein STICHWORT, das im Thema nicht vorkommt", () => {
	// Das ist der Grund, warum es die Stichworte gibt: spaeter sucht man nach
	// Woertern, die im Themasatz nicht stehen.
	const ablage = modul.leereAblage();
	const a = modul.oeffneAnruf(ablage, {
		von: "a", an: "b",
		thema: "Das Brett schreibt zu langsam",
		stichworte: ["Sperre", "Zeitstempel"],
		jetzt: 100
	});
	const b = modul.oeffneAnruf(a.ablage, {
		von: "c", an: "d",
		thema: "Wie wird ein Release gebaut",
		stichworte: ["Kompression"],
		jetzt: 200
	});

	// "sperre" steht NICHT im Thema, nur in den Stichworten.
	const treffer = modul.sucheAnrufe(b.ablage, "sperre");
	assert.equal(treffer.length, 1, "genau ein Treffer ueber das Stichwort")
	assert.equal(treffer[0].thema, "Das Brett schreibt zu langsam")

	// Die Suche ist nicht gross/klein-empfindlich und trimmt.
	assert.equal(modul.sucheAnrufe(b.ablage, "  ZEITSTEMPEL ").length, 1)
	// Ein leeres Suchwort liefert alles — "zeig mir, was da ist" ist kein Irrtum.
	assert.equal(modul.sucheAnrufe(b.ablage, "").length, 2)
	assert.equal(modul.sucheAnrufe(b.ablage, undefined).length, 2)
	// Und etwas, das nirgends steht, liefert nichts.
	assert.equal(modul.sucheAnrufe(b.ablage, "gibtesnicht").length, 0)
})

test("die Suche findet auch in der Zusammenfassung, und sortiert neueste zuerst", () => {
	const ablage = modul.leereAblage();
	const a = modul.oeffneAnruf(ablage, { von: "a", an: "b", thema: "eins", jetzt: 100 });
	const b = modul.oeffneAnruf(a.ablage, { von: "c", an: "d", thema: "zwei", jetzt: 200 });
	const c = modul.schliesseAnruf(b.ablage, b.eintrag.id, "Ergebnis: der Deckel passt nicht", 300);

	const treffer = modul.sucheAnrufe(c.ablage, "deckel");
	assert.equal(treffer.length, 1, "gefunden ueber die Zusammenfassung")
	assert.equal(treffer[0].id, b.eintrag.id)

	const alle = modul.sucheAnrufe(c.ablage, "");
	assert.deepEqual(alle.map((e) => e.thema), ["zwei", "eins"], "neueste zuerst")
})

test("GEGENPROBE am Code: ohne die Suche werden die Suchtests rot", async () => {
	// Eine Kopie unter /tmp, in der `sucheAnrufe` immer alles liefert. Ersetzt
	// wird genau eine Zeile; die Ersetzung prueft sich selbst.
	const kopie = mkdtempSync(join(tmpdir(), "teams-plus-anruf-kopie-"));
	try {
		for (const datei of ["team-anruf.mjs", "send-to-session.mjs"]) {
			copyFileSync(join(PAKET, "patches", datei), join(kopie, datei))
		}
		const quelle = readFileSync(join(kopie, "team-anruf.mjs"), "utf8")
		const marke = "export function sucheAnrufe(ablage, suche) {"
		if (!quelle.includes(marke)) assert.fail("die Marke fuer die Gegenprobe fehlt")
		// Den Koerper der Funktion durch "alles zurueckgeben" ersetzen.
		const kaputt = quelle.replace(
			/export function sucheAnrufe\(ablage, suche\) \{[\s\S]*?\n\}/u,
			"export function sucheAnrufe(ablage, suche) {\n\treturn [...ablage.eintraege];\n}"
		)
		assert.notEqual(kaputt, quelle, "die Ersetzung muss greifen")
		writeFileSync(join(kopie, "team-anruf.mjs"), kaputt)

		const lauf = spawnSync(
			process.execPath,
			["--test", "--test-name-pattern", "die Suche findet ueber ein STICHWORT", fileURLToPath(import.meta.url)],
			{ encoding: "utf8", env: { ...process.env, TEAM_ANRUF_MODUL: join(kopie, "team-anruf.mjs") } }
		)
		// Zwei Wege, dass die Gegenprobe greift — und sie prueft BEIDE:
		//  (1) Der Kindprozess meldet einen Fehlschlag in seiner Ausgabe. Auf ihn
		//      allein ist kein Verlass: `spawnSync().status` ist hier 0 geblieben,
		//      obwohl „# fail 1" in der Ausgabe stand (gemessen 2026-11-04).
		//      Wer sich nur auf den Exit-Code verlaesst, meldet eine bestandene
		//      Gegenprobe, die keine ist — genau der Fehler, den dieses Repo an
		//      der Selbstpruefungs-Zeile schon hatte.
		//  (2) Die Suchfunktion selbst liefert in der Kopie falsche Ergebnisse.
		//      Das ist der direkte Beweis, unabhaengig vom Testrunner.
		const ausgabe = `${lauf.stdout}${lauf.stderr}`
		const kindRot = /not ok|# fail [1-9]/u.test(ausgabe)

		const kopieModul = await import(`${join(kopie, "team-anruf.mjs")}?v=${Date.now()}`)
		const probe = kopieModul.leereAblage()
		const a = kopieModul.oeffneAnruf(probe, { von: "a", an: "b", thema: "ohne Stichwort", jetzt: 1 })
		const kaputteSuche = kopieModul.sucheAnrufe(a.ablage, "gibtesnicht").length

		assert.ok(
			kindRot || kaputteSuche !== 0,
			`die Gegenprobe greift nicht: der Kindprozess war nicht rot UND die Kopie sucht richtig (${kaputteSuche} Treffer fuer ein Wort, das nirgends steht)`
		)
	} finally {
		rmSync(kopie, { recursive: true, force: true })
	}
})

// ---------------------------------------------------------------------------
// 3. Zwei Schreiber gleichzeitig
// ---------------------------------------------------------------------------

test("zwei Schreiber gleichzeitig verlieren keinen Eintrag, die Kennungen bleiben eindeutig", async () => {
	const ort = werkstatt();
	try {
		mkdirSync(dirname(ort.pfad), { recursive: true })
		modul.speichereAblage(modul.leereAblage(), ort.pfad)

		// Zehn Anrufe gleichzeitig, jeder in einem EIGENEN Prozess.
		//
		// Warum echte Prozesse: Die erste Fassung dieses Tests lief im selben
		// Node-Prozess und damit vollstaendig nacheinander — dort kann ohne Sperre
		// gar nichts verlorengehen, der Test konnte also nie rot werden
		// (Red-Team-Befund NIEDRIG-6; Mutant M1, die ausgeraubte Sperre im Modul,
		// blieb gruen). Mit zehn Prozessen ist der Verlust messbar: ohne Sperre
		// blieben 8, 9 und 10 von 10 Eintraegen uebrig, mit Sperre dreimal 10.
		const arbeiter = join(ort.heim, "arbeiter.mjs")
		const zeilen = [
			"import { mitSperre } from " + JSON.stringify(join(PAKET, "patches", "send-to-session.mjs")),
			"const modul = await import(" + JSON.stringify(MODUL_DATEI) + ")",
			"const [pfad, i] = process.argv.slice(2)",
			"await mitSperre(pfad, () => {",
			"\tconst ablage = modul.ladeAblage(pfad)",
			"\tconst r = modul.oeffneAnruf(ablage, { von: \"a-\" + i, an: \"b-\" + i, thema: \"Thema \" + i, jetzt: Date.now() })",
			"\tmodul.speichereAblage(r.ablage, pfad)",
			"})",
			""
		]
		writeFileSync(arbeiter, zeilen.join("\n"))
		await Promise.all(
			Array.from(
				{ length: 10 },
				(_, i) =>
					new Promise((fertig) => {
						const kind = spawn(process.execPath, [arbeiter, ort.pfad, String(i)], { stdio: "ignore" })
						kind.on("exit", fertig)
						kind.on("error", fertig)
					})
			)
		)

		const amEnde = modul.ladeAblage(ort.pfad)
		assert.equal(amEnde.eintraege.length, 10, "kein Eintrag darf verloren gehen")
		const ids = new Set(amEnde.eintraege.map((e) => e.id))
		assert.equal(ids.size, 10, "jede Kennung darf nur einmal vorkommen")
	} finally {
		ort.aufraeumen()
	}
})

// ---------------------------------------------------------------------------
// 4. Eine kaputte Ablage wird laut gemeldet
// ---------------------------------------------------------------------------

test("eine kaputte anrufe.json wird LAUT gemeldet, nicht als leeres Verzeichnis gelesen", () => {
	const ort = werkstatt();
	try {
		mkdirSync(dirname(ort.pfad), { recursive: true })
		writeFileSync(ort.pfad, '{ "version": 1, "eintraege": [')  // abgeschnitten

		assert.throws(
			() => modul.ladeAblage(ort.pfad),
			/NOT treated as empty/u,
			"eine unlesbare Datei muss werfen, nicht leer zurueckkommen"
		)

		// Gegenprobe: eine fehlende Datei ist dagegen LEISE leer. Ohne diesen Fall
		// waere nicht zu unterscheiden, ob der Test die Kaputtheit oder das
		// Fehlen prueft.
		const fehlt = join(ort.heim, "gibtesnicht", "anrufe.json")
		assert.deepEqual(modul.ladeAblage(fehlt), modul.leereAblage(), "fehlt die Datei, ist die Ablage leer und still")

		// Und eine Datei, die JSON ist, aber keine Ablage: ebenfalls laut.
		writeFileSync(ort.pfad, '{"etwas": "anderes"}')
		assert.throws(() => modul.ladeAblage(ort.pfad), /NOT treated as empty/u)
	} finally {
		ort.aufraeumen()
	}
})

test("ein einzelner kaputter Eintrag reisst die anderen nicht mit", () => {
	const ort = werkstatt();
	try {
		mkdirSync(dirname(ort.pfad), { recursive: true })
		writeFileSync(ort.pfad, JSON.stringify({
			version: 1,
			naechsteId: 3,
			eintraege: [
				{ id: "anruf-1", von: "a", an: "b", thema: "heil", stand: "offen", forks: [], stichworte: [] },
				{ id: 42, thema: "kaputt: id ist keine Zeichenkette" },
				{ id: "anruf-3", von: "c", an: "d", thema: "auch heil", stand: "erledigt", forks: [], stichworte: [] }
			]
		}))
		const ablage = modul.ladeAblage(ort.pfad)
		assert.equal(ablage.eintraege.length, 2, "der kaputte Eintrag faellt weg, die zwei heilen bleiben")
		assert.deepEqual(ablage.eintraege.map((e) => e.id), ["anruf-1", "anruf-3"])
	} finally {
		ort.aufraeumen()
	}
})

// ---------------------------------------------------------------------------
// 5. Kleine Regeln, die leicht still brechen
// ---------------------------------------------------------------------------

test("ein Anruf mit sich selbst ist kein Anruf", () => {
	const ablage = modul.leereAblage();
	assert.throws(
		() => modul.oeffneAnruf(ablage, { von: "gleich", an: "gleich", thema: "x", jetzt: 1 }),
		/two different sessions/u
	)
})

test("Stichworte werden normalisiert: klein, ohne Doppel, ohne Leere, sortiert", () => {
	assert.deepEqual(
		modul.pruefeStichworte([" Sperre ", "sperre", "", "Zeitstempel", "  ", "SPERRE"]),
		["sperre", "zeitstempel"]
	)
	// Eine Zeichenkette mit Trennzeichen ist auch erlaubt.
	assert.deepEqual(modul.pruefeStichworte("Sperre, Zeitstempel;Sperre"), ["sperre", "zeitstempel"])
	// Nichts angegeben: leere Liste, kein Fehler.
	assert.deepEqual(modul.pruefeStichworte(undefined), [])
})

test("eine unbekannte Kennung ist ein Fehler, kein stiller Erfolg", () => {
	const ablage = modul.leereAblage()
	assert.throws(() => modul.trageFork(ablage, "anruf-99", "f"), /no call with id/u)
	assert.throws(() => modul.schliesseAnruf(ablage, "anruf-99", "text"), /no call with id/u)
	assert.equal(modul.findeAnruf(ablage, "anruf-99"), undefined)
})

test("GEGENPROBE: der Pfad faellt bei DSH_HOME=\"\" auf das echte Zuhause zurueck", () => {
	// Backlog A2: der leere Fall hat am 2026-09-01 bereits relative Pfade
	// erzeugt. Der Test rechnet nur, er schreibt nichts.
	const vorher = process.env.DSH_HOME
	try {
		delete process.env.DSH_HOME
		const ohne = modul.anrufPfad()
		process.env.DSH_HOME = ""
		const leer = modul.anrufPfad()
		assert.equal(leer, ohne, 'DSH_HOME="" ist "nicht gesetzt", nicht "das Arbeitsverzeichnis"')
		assert.ok(leer.startsWith("/"), `der Pfad ist relativ: ${leer}`)
		assert.match(leer, /\.tm\/teams-plus\/state\/anrufe\.json$/u)
	} finally {
		if (vorher === undefined) delete process.env.DSH_HOME
		else process.env.DSH_HOME = vorher
	}
})

test("HOCH-2: die naechste Kennung liegt nie hinter einer vergebenen", () => {
	// Gemessener Befund des Red Teams: Stand `naechsteId` auf 1, obwohl schon
	// anruf-1 und anruf-2 in der Datei lagen, bekam der naechste Anruf wieder
	// anruf-1. Ein spaeteres `schliessen` traf dann zwei Eintraege auf einmal.
	const ort = werkstatt()
	try {
		mkdirSync(dirname(ort.pfad), { recursive: true })
		writeFileSync(ort.pfad, JSON.stringify({
			version: 1,
			naechsteId: 1,
			eintraege: [
				{ id: "anruf-1", von: "a", an: "b", thema: "der erste", stand: "offen", forks: [], stichworte: [], begonnen: 1 },
				{ id: "anruf-2", von: "c", an: "d", thema: "der zweite", stand: "offen", forks: [], stichworte: [], begonnen: 2 }
			]
		}))
		const geladen = modul.ladeAblage(ort.pfad)
		assert.equal(geladen.naechsteId, 3, "die Kennung muss hinter anruf-2 liegen, nicht wieder bei 1 anfangen")
		const { eintrag } = modul.oeffneAnruf(geladen, { von: "e", an: "f", thema: "der dritte", jetzt: 3 })
		assert.equal(eintrag.id, "anruf-3")
		// Und eine Kollision wird LAUT abgelehnt statt still doppelt vergeben.
		// Hier absichtlich hergestellt: eine Ablage, deren naechste Kennung auf
		// einen vorhandenen Eintrag zeigt.
		const kollision = { ...geladen, naechsteId: 1 }
		assert.throws(
			() => modul.oeffneAnruf(kollision, { von: "e", an: "f", thema: "noch einer", jetzt: 4 }),
			/already taken/u,
			"eine doppelte Kennung muss abgelehnt werden, nicht hingenommen"
		)
	} finally {
		ort.aufraeumen()
	}
})

test("HOCH-2: ein schliessen trifft nur EINEN Eintrag, auch wenn zwei dieselbe Kennung tragen", () => {
	// Die alte Fassung schrieb `map((e) => (e.id === id ? neu : e))` und ersetzte
	// jeden Eintrag mit dieser Kennung. Aus einer alten Datei kann so ein Paar
	// entstehen; dann war ein `schliessen` stiller Datenverlust.
	const ablage = {
		version: 1,
		naechsteId: 2,
		eintraege: [
			{ id: "anruf-1", von: "a", an: "b", thema: "ERSTER", stand: "offen", forks: [], stichworte: [], begonnen: 1 },
			{ id: "anruf-1", von: "c", an: "d", thema: "DOPPELT", stand: "offen", forks: [], stichworte: [], begonnen: 2 }
		]
	}
	const { ablage: neu } = modul.schliesseAnruf(ablage, "anruf-1", "Antwort", 9)
	assert.equal(neu.eintraege.length, 2, "kein Eintrag darf verschwinden")
	assert.equal(neu.eintraege[1].thema, "DOPPELT", "der zweite Eintrag darf nicht ueberschrieben werden")
	assert.equal(neu.eintraege[1].stand, "offen")
	assert.equal(neu.eintraege[0].stand, "erledigt")
})

test("MITTEL-3: kaputte Zusatzfelder machen die Suche nicht kaputt", () => {
	// Gemessener Befund: `stichworte: 42` liess die Suche mit „is not iterable"
	// werfen, die ganze Ablage war dann unbrauchbar. Ein `stichworte` als
	// Zeichenkette wurde in Einzelzeichen zerlegt — die Suche nach „sperre"
	// fand nichts, die nach „s" fand den Eintrag.
	const ort = werkstatt()
	try {
		mkdirSync(dirname(ort.pfad), { recursive: true })
		writeFileSync(ort.pfad, JSON.stringify({
			version: 1,
			naechsteId: 3,
			eintraege: [
				{ id: "anruf-1", von: "a", an: "b", thema: "Das Brett schreibt zu langsam", stand: "offen", stichworte: 42, begonnen: 1 },
				{ id: "anruf-2", von: "c", an: "d", thema: "Ohne Stichwort im Thema", stand: "erledigt", stichworte: "sperre,zeitstempel", zusammenfassung: "Fertig", begonnen: 2 }
			]
		}))
		const ablage = modul.ladeAblage(ort.pfad)
		assert.equal(ablage.eintraege.length, 2, "kein Eintrag darf nur wegen eines kaputten Feldes verschwinden")
		const treffer = modul.sucheAnrufe(ablage, "sperre")
		assert.equal(treffer.length, 1, "das Stichwort aus der Zeichenkette muss gefunden werden")
		assert.equal(treffer[0].id, "anruf-2")
		assert.deepEqual(modul.findeAnruf(ablage, "anruf-1").stichworte, ["42"], "eine Zahl wird zu einem Stichwort, nicht zu einem Absturz")
	} finally {
		ort.aufraeumen()
	}
})

test("MITTEL-4: ein verworfener Eintrag steht im Protokoll, nicht nur im Nichts", () => {
	// Frueher verschwand ein kaputter Eintrag beim naechsten Schreiben spurlos.
	// Jetzt steht er im Protokoll, wie es `team-board.mjs` seit jeher tut.
	const ort = werkstatt()
	const vorher = process.env.DSH_HOME
	try {
		process.env.DSH_HOME = ort.heim
		const pfad = modul.anrufPfad()
		mkdirSync(dirname(pfad), { recursive: true })
		writeFileSync(pfad, JSON.stringify({
			version: 1,
			naechsteId: 3,
			eintraege: [
				{ id: "anruf-1", von: "a", an: "b", thema: "heil", stand: "offen", forks: [], stichworte: [], begonnen: 1 },
				{ id: 42, thema: "kaputt: die Kennung ist keine Zeichenkette" }
			]
		}))
		const ablage = modul.ladeAblage(pfad)
		assert.equal(ablage.eintraege.length, 1)
		const protokoll = readFileSync(modul.protokollPfad(), "utf8")
		assert.match(protokoll, /1 malformed entries skipped/u, "der verworfene Eintrag muss im Protokoll stehen")
	} finally {
		if (vorher === undefined) delete process.env.DSH_HOME
		else process.env.DSH_HOME = vorher
		ort.aufraeumen()
	}
})

test("der ECHTE defineTool nimmt beide Werkzeuge an, und der Werkzeugpfad benutzt die Sperre", async () => {
	// Zwei Befunde auf einmal, beide gemessen:
	//
	// NIEDRIG-7: Der alte Rauchtest prueft nur `typeof apply === "function"` und
	// blieb gruen, auch als apply gar nichts mehr tat (Mutant M3). Genau dieser
	// Test haette HOCH-1 fangen muessen — die ungueltige Werkzeugdefinition.
	//
	// NIEDRIG-6: Der alte Sperr-Test rief `mitSperre` selbst auf und konnte
	// nicht scheitern. Dieser Test schickt eine eigene Sperre in das Modul und
	// misst, ob der Werkzeugpfad sie wirklich benutzt.
	const { createRequire } = await import("node:module")
	const kandidaten = []
	try {
		kandidaten.push(createRequire(import.meta.url).resolve("@deepseek-ai/dsh-tools/lib/index.js"))
	} catch { /* liegt nicht im Suchpfad des Repos */ }
	for (const basis of [
		"/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules",
		join(homedir(), ".npm-global", "lib", "node_modules", "@deepseek-ai", "dsh", "node_modules"),
		"/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules"
	]) {
		kandidaten.push(join(basis, "@deepseek-ai", "dsh-tools", "lib", "index.js"))
	}
	const werkzeugPfad = kandidaten.find((pfad) => existsSync(pfad))
	if (werkzeugPfad === undefined) {
		throw new Error("der Werkzeug-Rahmen @deepseek-ai/dsh-tools ist nicht auffindbar; ohne ihn prueft dieser Test einen nachgebauten Rahmen — das soll LAUT scheitern, nicht still")
	}
	await import(werkzeugPfad)

	const ort = werkstatt()
	try {
		const registriert = []
		const sperren = []
		const ctx = {
			logger: { info() {}, warn() {} },
			effect(fn) {
				fn()
				return () => {}
			},
			tools: {
				register: (definition) => {
					registriert.push(definition)
					return () => {}
				}
			},
			get: () => undefined
		}
		modul.apply(ctx, {
			pfad: ort.pfad,
			sperre: (pfad, aktion) => {
				sperren.push(pfad)
				return aktion()
			}
		})
		// apply laedt den Kernbaustein asynchron; ihm einen Moment geben.
		for (let i = 0; i < 150 && registriert.length < 2; i += 1) {
			await new Promise((fertig) => setTimeout(fertig, 20))
		}
		assert.equal(registriert.length, 2, "beide Werkzeuge muessen vom echten Kern angenommen werden (HOCH-1)")

		const anrufWerkzeug = registriert.find((w) => w.name === "team_anruf")
		assert.ok(anrufWerkzeug !== undefined, "team_anruf fehlt unter den angemeldeten Werkzeugen")
		const ergebnis = await anrufWerkzeug.execute(
			{ aktion: "oeffnen", an: "session-b", thema: "Eine Frage an die andere Abteilung" },
			{ agent: { id: "session-a" } }
		)
		assert.equal(ergebnis.ok, true, "oeffnen scheiterte: " + ergebnis.note)
		assert.ok(
			sperren.length >= 1,
			"der Werkzeugpfad muss die Sperre benutzen; ohne sie verliert gleichzeitiges Schreiben Eintraege"
		)
	} finally {
		ort.aufraeumen()
	}
})
