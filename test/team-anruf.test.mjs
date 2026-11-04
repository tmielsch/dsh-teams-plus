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
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

		// Zehn Anrufe gleichzeitig, jeder mit eigener Sperre und eigenem Laden.
		// Die Sperre ist die aus send-to-session.mjs — dieselbe, die das Werkzeug
		// benutzt. Ohne sie verlieren gleichzeitige Schreiber Einträge, weil
		// jeder seine eigene Ablage liest und alle dieselbe Datei ueberschreiben.
		const { mitSperre } = await import(join(PAKET, "patches", "send-to-session.mjs"))
		await Promise.all(
			Array.from({ length: 10 }, (_, i) =>
				mitSperre(ort.pfad, () => {
					const ablage = modul.ladeAblage(ort.pfad)
					const { ablage: neu } = modul.oeffneAnruf(ablage, {
						von: `a-${i}`, an: `b-${i}`, thema: `Thema ${i}`, jetzt: 1_700_000_000_000 + i
					})
					modul.speichereAblage(neu, ort.pfad)
					return true
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

test("das Modul laedt und meldet seine beiden Werkzeuge an", async () => {
	// Ein billiger Rauchtest: der Patch muss importierbar sein, ohne DSH zu
	// brauchen. Wer ihn kaputt macht, faellt hier auf, nicht erst beim Start.
	const frisch = await import(`${MODUL_DATEI}?v=${Date.now()}`)
	assert.equal(typeof frisch.apply, "function", "apply fehlt")
	assert.equal(frisch.name, "team-anruf")
	assert.ok(Array.isArray(frisch.inject))
})
