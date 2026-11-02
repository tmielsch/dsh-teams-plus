/**
 * Test fuer patches/team-board.mjs — `team_board` und `team_note` auf der nativen Team-Identität
 *
 * WAS HIER GEPRUEFT WIRD, UND WARUM GERADE SO
 * Der Patch haengt an Cordis-Diensten, an der nativen Team-Identitaet und an einer
 * Datei. Geprueft wird, was ohne laufendes DSH pruefbar ist und genau die Stellen
 * traegt, an denen ein Fehler teuer waere:
 *
 *   1. Schreiben und Wiederlesen,  2. Ersetzen statt Anhaengen,
 *   3. Loeschen (leerer UND fehlender Text),  4. privater Block gegen geteiltes Brett,
 *   5. ZWEI TEAMS SEHEN SICH NICHT — der wichtigste Test,
 *   6. die Sperre ueber echte Prozessgrenzen, MIT Gegenprobe in einer Kopie unter /tmp,
 *   7. die Identitaet kommt vom Dienst oder der Aufruf scheitert LAUT.
 *
 * **Jede Pruefung, die scheitern koennen muss, hat einen Fall, der scheitert**
 * (die Lehre aus Issue #10: eine Pruefung ohne Gegenprobe ist eine Behauptung).
 * Wo eine Gegenprobe moeglich ist, steht sie im selben Test oder direkt daneben.
 *
 * DIE IDENTITAET WIRD SO NACHGEBAUT, WIE SIE GEMESSEN IST
 * `ctx.agentTeams.membership(agent)` liefert `{ root, id, role, name }`, und bei
 * einem Teammate ist `id` GLEICH `root.id`
 * (@deepseek-ai/dsh-experimental-agent-team lib/types/roster.js:89). Die
 * Attrappen unten tragen genau diese Eigenschaft — sonst wuerde der Test die
 * Verwechslung, gegen die der Patch gebaut ist, gar nicht bemerken.
 *
 * HERMETISCH: `DSH_HOME` zeigt auf ein temporaeres Verzeichnis, BEVOR das Modul
 * geladen wird. Ohne das schriebe die Suite in das echte `~/.dsh` des Menschen.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { test } from 'node:test'

// Hermetisch machen, BEVOR irgendetwas aus dem Patch geladen wird.
const HEIM = mkdtempSync(join(tmpdir(), 'team-board-home-'))
process.env.DSH_HOME = HEIM

// Den echten Werkzeug-Rahmen aufloesen, nicht nachbauen: die Parameterschemata,
// die das Modell sieht, entstehen in `defineTool`.
const { createRequire } = await import('node:module')
const werkzeugKandidaten = []
try {
	werkzeugKandidaten.push(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-tools/lib/index.js'))
} catch { /* liegt nicht im Suchpfad des Repos */ }
for (const basis of [
	'/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules',
	join(homedir(), '.npm-global', 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules'),
	'/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules'
]) {
	werkzeugKandidaten.push(join(basis, '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'))
}
const werkzeugPfad = werkzeugKandidaten.find((pfad) => existsSync(pfad))
if (werkzeugPfad === undefined) {
	throw new Error('der Werkzeug-Rahmen @deepseek-ai/dsh-tools ist nicht auffindbar; ohne ihn prueft dieser Test einen nachgebauten Rahmen — das soll LAUT scheitern, nicht still')
}
const { defineTool } = await import(werkzeugPfad)

const MODUL = new URL('../patches/team-board.mjs', import.meta.url).pathname
const SEND_TO_SESSION = new URL('../patches/send-to-session.mjs', import.meta.url).pathname
const REPO = new URL('..', import.meta.url).pathname

/**
 * Das zu pruefende Modul ist umlenkbar.
 *
 * Test 6 (Gegenprobe am Code) faehrt DIESELBEN Fork-Tests gegen eine Kopie unter
 * /tmp, in der die Fork-Erkennung ausgebaut ist. Ohne diese Umlenkung pruefte die
 * Gegenprobe eine Nachbildung statt den Test, der den Patch prueft. Ohne die
 * Variable gilt das Modul des Repos — der normale Lauf merkt von alldem nichts.
 */
const MODUL_DATEI = process.env.TEAM_BOARD_MODUL ?? MODUL

const {
	GRENZEN,
	aendereBoard,
	apply,
	baueWerkzeuge,
	boardPfad,
	identitaetVon,
	istEigenesTeam,
	ladeBoard,
	leererBoard,
	protokollPfad,
	pruefeSchluessel,
	speichereBoard,
	vorschau,
	zuLoeschen
} = await import(MODUL_DATEI)

/** Eine frische Ablage je Test. */
function frischeAblage() {
	return join(mkdtempSync(join(tmpdir(), 'team-board-')), 'board.json')
}

const warten = (ms) => new Promise((fertig) => setTimeout(fertig, ms))

// ---------------------------------------------------------------------------
// Die Mannschaft: Attrappen mit der GEMESSENEN Form der nativen Mitgliedschaft
// ---------------------------------------------------------------------------

const LEAD_A = { id: 'sess-lead-a', session: {} }
const ANNA = { id: 'sess-anna', session: {} }
const BOB = { id: 'sess-bob', session: {} }
const LEAD_B = { id: 'sess-lead-b', session: {} }
const CEM = { id: 'sess-cem', session: {} }

/**
 * Ein FORK: ein Kind ohne Roster-Eintrag. `parentSession` ist der einzige
 * Unterschied zur Wurzel-Sitzung — gemessen an `SessionHeader.parentSession`
 * (dsh-session/lib/types/types.d.ts:71).
 */
const FORK = { id: 'sess-fork', session: { header: { parentSession: 'sess-anna' } } }
const FORK2 = { id: 'sess-fork-2', session: { header: { parentSession: 'sess-bob' } } }

/**
 * Die Wurzel-Sitzung des Menschen: ein `header` IST da, `parentSession` nicht.
 * Sie ist ihre eigene Wurzel und SOLL ihr eigenes Team sein — hier darf nichts
 * gemeldet werden. Der Test prueft damit, dass nicht jedes `header` reicht.
 */
const WURZEL = { id: 'sess-wurzel', session: { header: { id: 'sess-wurzel', isSeeded: false } } }

/** Team A: ein Lead, zwei Teammates. `id` ist bei beiden Teammates `root.id` — gemessen. */
const TEAM_A = {
	'sess-lead-a': { root: LEAD_A, id: 'sess-lead-a', role: 'lead', name: 'lead' },
	'sess-anna': { root: LEAD_A, id: 'sess-lead-a', role: 'teammate', name: 'anna' },
	'sess-bob': { root: LEAD_A, id: 'sess-lead-a', role: 'teammate', name: 'bob' }
}

/** Team B: ein anderer Lead, ein Teammate. */
const TEAM_B = {
	'sess-lead-b': { root: LEAD_B, id: 'sess-lead-b', role: 'lead', name: 'lead' },
	'sess-cem': { root: LEAD_B, id: 'sess-lead-b', role: 'teammate', name: 'cem' }
}

/**
 * Die Attrappen des Fork-Falls: der Dienst macht Fork UND Wurzel zu ihrer
 * EIGENEN Wurzel (`root` zeigt auf sie selbst) — genau das liefert `TeamRoster`
 * fuer einen direkten Nachkommen ohne Roster-Eintrag (roster.js:85-105) und fuer
 * die Wurzel-Sitzung. Der Unterschied ist allein `parentSession`.
 */
const SELBST = {
	'sess-fork': { root: FORK, id: 'sess-fork', role: 'lead', name: 'lead' },
	'sess-fork-2': { root: FORK2, id: 'sess-fork-2', role: 'lead', name: 'lead' },
	'sess-wurzel': { root: WURZEL, id: 'sess-wurzel', role: 'lead', name: 'lead' }
}

/** Der native Dienst, so weit ihn das Brett benutzt. */
function baueAgentTeams(zuordnung) {
	return {
		membership(agent) {
			const treffer = zuordnung[agent.id]
			if (treffer === undefined) throw new Error(`agent "${agent.id}" is not a member of an active Agent Team`)
			return treffer
		}
	}
}

/**
 * Meldet beide Werkzeuge an einer Ablage an.
 *
 * @param optionen - `{ pfad, teams, ohneDienst }`.
 */
function anmelden(optionen = {}) {
	const pfad = optionen.pfad ?? frischeAblage()
	const teams = { ...TEAM_A, ...TEAM_B, ...SELBST, ...(optionen.teams ?? {}) }
	const dienst = optionen.ohneDienst === true ? () => undefined : () => baueAgentTeams(teams)
	const [board, notiz] = baueWerkzeuge({ defineTool, pfad, dienst })
	return { board, notiz, pfad }
}

/** Der Aufrufkontext, den `defineTool` an `execute` gibt. */
const exec = (agent) => ({ agent, signal: new AbortController().signal })

/** Wie viele Eintraege in der Datei stehen (ohne die Bereichsfilter). */
const anzahl = (pfad) => ladeBoard(pfad).entries.length

// ---------------------------------------------------------------------------
// 1. Schreiben und wieder lesen
// ---------------------------------------------------------------------------

test('eine Notiz wird geschrieben und mit Text und Autor wieder gelesen', async () => {
	const { board, notiz, pfad } = anmelden()

	const geschrieben = await notiz.execute({ key: 'api entscheidung', text: 'Wir nehmen JSON.\nKein XML.' }, exec(ANNA))
	assert.equal(geschrieben.action, 'written')
	assert.equal(geschrieben.area, 'shared')
	assert.equal(geschrieben.existed, false, 'ein neuer Schluessel darf nicht als vorhanden gelten')
	assert.equal(geschrieben.entry.authorName, 'anna', 'der Autor kommt aus membership().name')
	assert.equal(geschrieben.entry.authorId, 'sess-anna', 'der Autor ist die SITZUNG, nicht die Team-Id')

	const index = await board.execute({}, exec(BOB))
	assert.equal(index.area, 'shared')
	assert.equal(index.entries.length, 1)
	assert.equal(index.entries[0].key, 'api entscheidung')
	assert.equal(index.entries[0].authorName, 'anna')
	assert.equal(index.entries[0].preview, 'Wir nehmen JSON.', 'die Vorschau ist die erste Zeile')
	assert.equal(index.entries[0].text, undefined, 'der Index ohne key darf den Volltext NICHT mitliefern (sonst zieht ein Aufruf bis zu 32 Notizen in den Kontext)')

	const eine = await board.execute({ key: 'api entscheidung' }, exec(BOB))
	assert.equal(eine.entries.length, 1)
	assert.equal(eine.entries[0].key, 'api entscheidung')
	assert.equal(eine.entries[0].text, 'Wir nehmen JSON.\nKein XML.', 'mit key kommt der Volltext')
	assert.equal(eine.entries[0].updatedAt > 0, true)

	// Gegenprobe: ein unbekannter Schluessel liefert nichts und sagt das auch.
	const fehlt = await board.execute({ key: 'gibt es nicht' }, exec(BOB))
	assert.equal(fehlt.entries.length, 0)
	assert.match(fehlt.note, /no note named/u, 'ein unbekannter Schluessel darf nicht wie ein leeres Brett klingen')
})

test('der Index ohne key zaehlt nicht mehr Text, als die Vorschau braucht', () => {
	// Eigener Fall, weil die Vorschau am Volltext haengt: 200 Zeichen, eine Zeile.
	const lang = 'a'.repeat(200)
	const kurz = vorschau(lang)
	assert.equal(kurz.length, GRENZEN.vorschauZeichen + 1, 'Vorschau muss 180 Zeichen plus Auslassungszeichen sein')
	assert.ok(kurz.endsWith('…'))
	// Gegenprobe: unter der Grenze wird NICHT gekuerzt.
	assert.equal(vorschau('  kurz  '), 'kurz', 'die Vorschau wird getrimmt und nicht gekuerzt')
})

// ---------------------------------------------------------------------------
// 2. Ersetzen statt anhaengen
// ---------------------------------------------------------------------------

test('derselbe Schluessel zweimal geschrieben ERSETZT den Eintrag, statt zwei anzulegen', async () => {
	const { notiz, pfad } = anmelden()

	await notiz.execute({ key: 'plan', text: 'erste Fassung' }, exec(ANNA))
	await warten(5)
	const zweite = await notiz.execute({ key: 'plan', text: 'zweite Fassung' }, exec(BOB))

	assert.equal(zweite.existed, true, 'der zweite Aufruf muss den vorhandenen Eintrag sehen')
	assert.equal(anzahl(pfad), 1, 'nach zwei Schreibvorgaengen darf genau EIN Eintrag dastehen')
	assert.equal(zweite.index.length, 1, 'auch der zurueckgegebene Index darf nur einen Eintrag tragen')
	assert.equal(zweite.entry.authorName, 'bob', 'der Autor muss der des ZWEITEN Schreibvorgangs sein — sonst wurde nicht ersetzt')

	// Und der Volltext in der Datei ist der neue, nicht der alte.
	const gelesen = ladeBoard(pfad).entries[0]
	assert.equal(gelesen.text, 'zweite Fassung', 'der alte Text steht noch in der Datei — ersetzt wurde nicht ganz')
})

// ---------------------------------------------------------------------------
// 3. Loeschen — leerer und fehlender Text
// ---------------------------------------------------------------------------

test('leerer text loescht die Notiz; danach steht sie nicht mehr im Index', async () => {
	const { board, notiz } = anmelden()

	await notiz.execute({ key: 'weg damit', text: 'irgendwas' }, exec(ANNA))
	const geloescht = await notiz.execute({ key: 'weg damit', text: '' }, exec(ANNA))

	assert.equal(geloescht.action, 'deleted')
	assert.equal(geloescht.existed, true, 'ein vorhandener Eintrag muss beim Loeschen als vorhanden gemeldet werden')
	assert.equal(geloescht.index.length, 0)
	assert.equal(geloescht.entry, undefined, 'beim Loeschen gibt es keinen Eintrag zurueck')

	const index = await board.execute({}, exec(ANNA))
	assert.equal(index.entries.length, 0, 'die geloeschte Notiz steht noch im Index')
	assert.match(index.note, /empty/u)

	// Gegenprobe: ein Loeschversuch auf einem fehlenden Schluessel ist KEIN Fehler,
	// aber er meldet ehrlich, dass nichts da war.
	const nochmal = await notiz.execute({ key: 'weg damit' }, exec(ANNA))
	assert.equal(nochmal.action, 'deleted')
	assert.equal(nochmal.existed, false, 'ein zweites Loeschen darf nicht behaupten, es haette etwas geloescht')
})

test('fehlender und leerer text sind unterscheidbar und loeschen trotzdem beide', async () => {
	// Der Auftrag sagt fuer beide Faelle dasselbe. Der Test haelt BEIDES fest: dass
	// der Unterschied im Wert messbar ist und dass die Wirkung dieselbe ist.
	assert.equal(zuLoeschen(undefined), true, 'fehlender Parameter muss loeschen')
	assert.equal(zuLoeschen(''), true, 'leerer Text muss loeschen')
	assert.equal(zuLoeschen('   \n '), true, 'reiner Leerraum ist keine Notiz')
	assert.equal(zuLoeschen('x'), false, 'ein Text mit Inhalt darf nicht loeschen')
	assert.notEqual(undefined, '', 'die beiden Werte sind verschieden — deshalb steht die Regel an einer Stelle')

	const { notiz, pfad } = anmelden()
	await notiz.execute({ key: 'a', text: 'inhalt' }, exec(ANNA))
	await notiz.execute({ key: 'a' }, exec(ANNA)) // Parameter fehlt
	assert.equal(anzahl(pfad), 0, 'fehlender text hat nicht geloescht')

	await notiz.execute({ key: 'b', text: 'inhalt' }, exec(ANNA))
	await notiz.execute({ key: 'b', text: '' }, exec(ANNA)) // Parameter leer
	assert.equal(anzahl(pfad), 0, 'leerer text hat nicht geloescht')
})

// ---------------------------------------------------------------------------
// 4. Privater Block gegen geteiltes Brett
// ---------------------------------------------------------------------------

test('der private Block ist im geteilten Brett nicht sichtbar — und umgekehrt', async () => {
	const { board, notiz } = anmelden()

	await notiz.execute({ key: 'tagebuch', text: 'nur fuer mich', private: true }, exec(ANNA))
	await notiz.execute({ key: 'absprache', text: 'fuer alle', private: false }, exec(ANNA))

	// (a) Der eigene Block: die private Notiz ja, die geteilte nein.
	const eigenes = await board.execute({ private: true }, exec(ANNA))
	assert.equal(eigenes.area, 'private')
	assert.deepEqual(eigenes.entries.map((e) => e.key), ['tagebuch'], 'der private Block enthaelt fremde (geteilte) Notizen oder die falschen')
	// Der Index traegt die Vorschau; der Volltext kommt mit key — und zwar aus dem
	// PRIVATEN Bereich, nicht aus dem geteilten Brett.
	assert.equal(eigenes.entries[0].preview, 'nur fuer mich')
	const voll = await board.execute({ private: true, key: 'tagebuch' }, exec(ANNA))
	assert.equal(voll.entries[0].text, 'nur fuer mich', 'der Volltext aus dem privaten Block fehlt')

	// (b) Das geteilte Brett: die geteilte Notiz ja, die private nein.
	const geteilt = await board.execute({}, exec(ANNA))
	assert.deepEqual(geteilt.entries.map((e) => e.key), ['absprache'], 'die private Notiz steht im geteilten Brett')
	// Gegenprobe: derselbe Schluessel ist ueber das geteilte Brett NICHT zu bekommen,
	// auch nicht im Volltext — sonst waere "privat" nur eine Frage des Index.
	const heimlich = await board.execute({ key: 'tagebuch' }, exec(ANNA))
	assert.equal(heimlich.entries.length, 0, 'die private Notiz ist ueber das geteilte Brett im Volltext lesbar')
})

test('zwei Mitglieder DESSELBEN Teams teilen keinen privaten Block, obwohl ihre Team-Id gleich ist', async () => {
	// Das ist die Falle, gegen die `bereichVon` gebaut ist: `membership.id` ist bei
	// beiden Teammates `sess-lead-a`. Waere der Bereich daran gehaengt, saehen Anna
	// und Bob denselben Block. Der Test prueft die Wirkung, nicht die Feldnamen.
	const { board, notiz } = anmelden()
	await notiz.execute({ key: 'notiz', text: 'von anna', private: true }, exec(ANNA))

	const bobsBlock = await board.execute({ private: true }, exec(BOB))
	assert.equal(bobsBlock.entries.length, 0, 'Bob liest Annas privaten Block — die Bereiche sind nicht getrennt')
	assert.match(bobsBlock.note, /empty/u)

	// Gegenprobe: Annas eigener Block ist sehr wohl da. Ohne diesen Teil wuerde der
	// Test auch bestehen, wenn der private Block gar nicht funktioniert.
	const annasBlock = await board.execute({ private: true }, exec(ANNA))
	assert.deepEqual(annasBlock.entries.map((e) => e.key), ['notiz'])
})

// ---------------------------------------------------------------------------
// 5. Zwei Teams sehen sich nicht — der wichtigste Test
// ---------------------------------------------------------------------------

test('zwei Teams mit verschiedenen Leads sehen sich nicht', async () => {
	const { board, notiz, pfad } = anmelden()

	await notiz.execute({ key: 'vertrag', text: 'Fassung des Teams A' }, exec(ANNA))
	await notiz.execute({ key: 'vertrag', text: 'Fassung des Teams B' }, exec(CEM))

	// (a) Jedes Team liest seine eigene Fassung.
	const a = await board.execute({ key: 'vertrag' }, exec(ANNA))
	const b = await board.execute({ key: 'vertrag' }, exec(CEM))
	assert.equal(a.entries.length, 1)
	assert.equal(b.entries.length, 1)
	assert.equal(a.entries[0].text, 'Fassung des Teams A')
	assert.equal(b.entries[0].text, 'Fassung des Teams B')

	// (b) Der Index zeigt nur das eigene Team.
	assert.equal((await board.execute({}, exec(LEAD_A))).entries.length, 1)
	assert.equal((await board.execute({}, exec(LEAD_B))).entries.length, 1)

	// (c) In der Datei stehen BEIDE, getrennt durch leaderId — sonst wuerde (a) auch
	// bestehen, wenn der zweite Schreibvorgang den ersten ueberschrieben haette.
	const roh = ladeBoard(pfad).entries
	assert.equal(roh.length, 2, 'der zweite Schreibvorgang hat den ersten ueberschrieben')
	assert.deepEqual([...new Set(roh.map((e) => e.leaderId))].sort(), ['sess-lead-a', 'sess-lead-b'])
})

test('ein Team ohne Notizen sieht die Notizen des anderen Teams nicht, auch nicht im privaten Block', async () => {
	const { board, notiz } = anmelden()
	await notiz.execute({ key: 'geheim', text: 'A', private: true }, exec(ANNA))

	const fremd = await board.execute({ private: true }, exec(CEM))
	assert.equal(fremd.entries.length, 0, 'Team B liest den privaten Block aus Team A')
})

// ---------------------------------------------------------------------------
// 6. Die Sperre — mit Gegenprobe in einer Kopie unter /tmp
// ---------------------------------------------------------------------------

/**
 * Legt eine Kopie des Moduls OHNE Sperre unter /tmp an.
 *
 * Die Kopie entsteht aus DER Datei des Repos, nicht aus einer Nachbildung: genau
 * eine Zeile wird ersetzt (`return mitSperre(pfad, arbeit)` → `return
 * Promise.resolve(arbeit())`), der Import zeigt auf das echte send-to-session.mjs.
 * So misst die Gegenprobe denselben Code, nur ohne die eine Zeile.
 */
function kopieOhneSperre() {
	const quelle = readFileSync(MODUL, 'utf8')
	const angepasst = quelle
		.replace('from "./send-to-session.mjs"', `from ${JSON.stringify(SEND_TO_SESSION)}`)
		.replace('return mitSperre(pfad, arbeit);', 'return Promise.resolve(arbeit());')
	if (angepasst.includes('return mitSperre(pfad, arbeit);')) {
		throw new Error('die Sperr-Zeile wurde in der Kopie nicht ersetzt — die Gegenprobe wuerde sonst die Sperre mitmessen')
	}
	if (!angepasst.includes('Promise.resolve(arbeit())')) {
		throw new Error('die Kopie ohne Sperre traegt die Ersetzung nicht — die Gegenprobe waere keine')
	}
	const ordner = mkdtempSync(join(tmpdir(), 'team-board-ohne-sperre-'))
	const ziel = join(ordner, 'team-board-ohne-sperre.mjs')
	writeFileSync(ziel, angepasst)
	return ziel
}

/**
 * Laesst `zahl` Prozesse gleichzeitig denselben Eintrag schreiben.
 *
 * Der Treffpunkt ist eine `go`-Datei: jedes Kind meldet mit einer `ready`-Datei,
 * dass es geladen hat, und wartet dann auf das Startsignal. Ohne diesen
 * Treffpunkt waeren die Prozesse nacheinander schnell genug, dass auch die
 * Fassung OHNE Sperre nichts verlieren muesste.
 *
 * Im kritischen Abschnitt (nach dem Laden, vor dem Schreiben) wartet jedes Kind
 * 60 ms mit einer leeren Schleife — das ist der Abschnitt, den die Sperre deckt.
 *
 * @returns die Zahl der Eintraege, die danach in der Datei stehen.
 */
function laufMitKindern(modulPfad, zahl) {
	return new Promise((fertig, fehler) => {
		const ordner = mkdtempSync(join(tmpdir(), 'team-board-lauf-'))
		const pfad = join(ordner, 'board.json')
		const go = join(ordner, 'go')
		const heim = join(ordner, 'heim')
		const kind = (n) => `
process.env.DSH_HOME = ${JSON.stringify(heim)};
const fs = await import('node:fs');
const m = await import(${JSON.stringify(modulPfad)});
const warte = (ms) => { const bis = Date.now() + ms; while (Date.now() < bis) {} };
fs.writeFileSync(${JSON.stringify(join(ordner, 'ready'))} + ${n}, '');
const grenze = Date.now() + 10000;
while (!fs.existsSync(${JSON.stringify(go)}) && Date.now() < grenze) warte(2);
await m.aendereBoard(${JSON.stringify(pfad)}, (board) => {
  warte(60);
  board.entries.push({ leaderId: 'lead', area: 'shared', key: 'n${n}', text: 'x', authorId: 'a${n}', authorName: 'kind${n}', updatedAt: Date.now() });
  return null;
});
`
		const kinder = []
		let offen = zahl
		let kaputt = null
		for (let n = 0; n < zahl; n += 1) {
			const prozess = spawn(process.execPath, ['--input-type=module', '-e', kind(n)], { stdio: ['ignore', 'ignore', 'pipe'] })
			kinder.push(prozess)
			let meldung = ''
			prozess.stderr.on('data', (teil) => { meldung += teil })
			prozess.on('close', (code) => {
				if (code !== 0 && kaputt === null) kaputt = new Error(`Kind ${n} endet mit ${code}: ${meldung.slice(0, 400)}`)
				offen -= 1
				if (offen > 0) return
				if (kaputt !== null) return fehler(kaputt)
				fertig(anzahl(pfad))
			})
		}
		// Startsignal erst, wenn alle Kinder geladen und bereit sind.
		;(async () => {
			const grenze = Date.now() + 10000
			while (Date.now() < grenze) {
				const bereit = kinder.filter((_, n) => existsSync(join(ordner, 'ready') + n)).length
				if (bereit === zahl) break
				await warten(2)
			}
			writeFileSync(go, '')
		})()
	})
}

test('die Sperre schuetzt ueber echte Prozessgrenzen (Gegenprobe in einer /tmp-Kopie)', async () => {
	// Die einzige ehrliche Pruefung fuer eine Dateisperre sind mehrere PROZESSE, die
	// sich im kritischen Abschnitt ueberlappen. In einem Prozess laesst sich das
	// nicht zeigen: dort ist der Abschnitt synchron und damit ununterbrechbar.
	const ohne = kopieOhneSperre()

	const mitSperre = await laufMitKindern(MODUL, 4)
	const ohneSperre = await laufMitKindern(ohne, 4)

	assert.equal(mitSperre, 4, `mit Sperre darf kein Eintrag verloren gehen (gemessen: ${mitSperre} von 4)`)
	assert.ok(ohneSperre < 4, `ohne Sperre muss Verlust auftreten, sonst prueft dieser Test die Sperre nicht (gemessen: ${ohneSperre} von 4)`)
})

// ---------------------------------------------------------------------------
// 7. Die Identitaet — vom Dienst oder gar nicht
// ---------------------------------------------------------------------------

test('ohne ctx.agentTeams scheitert der Aufruf LAUT statt mit erfundener Identitaet', async () => {
	const { board, notiz, pfad } = anmelden({ ohneDienst: true })

	await assert.rejects(
		() => notiz.execute({ key: 'x', text: 'y' }, exec(ANNA)),
		/agentTeams/u,
		'ohne Team-Dienst muss der Aufruf scheitern und den Dienst nennen'
	)
	await assert.rejects(
		() => board.execute({}, exec(ANNA)),
		/agentTeams/u,
		'auch das Lesen darf ohne Identitaet keine Notiz erfinden'
	)
	assert.equal(existsSync(pfad), false, 'der gescheiterte Aufruf hat trotzdem eine Datei angelegt')

	// Gegenprobe zur Fehlermeldung: sie nennt den Grund, nicht nur "failed".
	await assert.rejects(
		() => notiz.execute({ key: 'x', text: 'y' }, exec(ANNA)),
		/because|without|does not provide/u
	)
})

test('ein Agent, der in keinem Team ist, scheitert laut (kein stilles Fremdteam)', async () => {
	const { notiz } = anmelden()
	const fremder = { id: 'sess-niemand', session: {} }

	await assert.rejects(
		() => notiz.execute({ key: 'x', text: 'y' }, exec(fremder)),
		/not a member/u,
		'der Dienst wirft TEAM_NOT_MEMBER — das muss durchkommen, nicht abgefangen werden'
	)
})

test('elementare Identitaetsregeln: leaderId ist die Wurzel, der Autor die Sitzung', () => {
	// Reine Rechnung, ohne Datei: die zwei Felder, an denen die ganze Trennung haengt.
	const dienst = baueAgentTeams(TEAM_A)
	const anna = identitaetVon(dienst, ANNA)
	assert.equal(anna.leaderId, 'sess-lead-a', 'leaderId ist die Wurzel des Teams')
	assert.equal(anna.sitzung, 'sess-anna', 'die Sitzung des Schreibers, nicht die Team-Id')
	assert.equal(anna.name, 'anna')
	assert.notEqual(anna.sitzung, anna.leaderId, 'Sitzung und Team-Wurzel sind fuer einen Teammate verschieden')
	// Gegenprobe: die native Mitgliedschaft traegt fuer BEIDE Teammates dieselbe id.
	const bob = identitaetVon(dienst, BOB)
	assert.equal(anna.leaderId, bob.leaderId, 'beide gehoeren zu Team A')
	assert.equal(TEAM_A['sess-anna'].id, TEAM_A['sess-bob'].id, 'gemessene Eigenschaft der Quelle: die Team-Id ist fuer alle Mitglieder gleich')
	assert.notEqual(anna.sitzung, bob.sitzung, 'die Sitzungen unterscheiden sich — nur darum taugt die Sitzung als Bereich')
})

// ---------------------------------------------------------------------------
// 8. Die Ablage: Pfad, Form, kaputte Datei
// ---------------------------------------------------------------------------

test('der Pfad liegt unter .tm/teams-plus und folgt DSH_HOME (E1)', () => {
	assert.match(boardPfad(), /\/\.tm\/teams-plus\/state\/board\.json$/u)
	assert.ok(boardPfad().startsWith(HEIM), `der Pfad ignoriert DSH_HOME: ${boardPfad()}`)
	assert.match(protokollPfad(), /\/\.tm\/teams-plus\/logs\/team-board\.log$/u)
})

test('DSH_HOME="" faellt auf das echte Home zurueck, nicht auf einen relativen Pfad (A2)', () => {
	// Nur GERECHNET, nicht geschrieben: die Ablage des Menschen bleibt unberuehrt.
	const vorher = process.env.DSH_HOME
	const erwartet = join(homedir(), '.dsh', '.tm', 'teams-plus', 'state', 'board.json')
	try {
		delete process.env.DSH_HOME
		const ohneVariable = boardPfad()
		process.env.DSH_HOME = ''
		const leer = boardPfad()
		assert.equal(leer, ohneVariable, 'DSH_HOME="" ist "nicht gesetzt", nicht "das Arbeitsverzeichnis"')
		assert.ok(isAbsolute(leer), `der Pfad ist relativ: ${leer}`)
		assert.equal(leer, erwartet)
		process.env.DSH_HOME = '   '
		assert.equal(boardPfad(), erwartet, 'reiner Leerraum zaehlt ebenfalls als nicht gesetzt')
	} finally {
		process.env.DSH_HOME = vorher
	}
})

test('eine unlesbare board.json wird gemeldet, nicht als leeres Brett gelesen', () => {
	const pfad = frischeAblage()
	writeFileSync(pfad, '{ kaputt')
	assert.throws(() => ladeBoard(pfad), /not readable as JSON/u, 'kaputtes JSON wurde stillschweigend als leer gelesen')
	assert.throws(() => ladeBoard(pfad), /NOT treated as an empty board/u)

	// Falsche Form ist derselbe Fall: die Datei WAR da, sie ist nur kein Brett.
	writeFileSync(pfad, '[1,2,3]')
	assert.throws(() => ladeBoard(pfad), /does not hold a board/u)

	// Gegenprobe: eine fehlende Datei ist ein leeres Brett, kein Fehler.
	assert.deepEqual(ladeBoard(join(mkdtempSync(join(tmpdir(), 'board-leer-')), 'fehlt.json')), leererBoard())
})

test('ein einzelner kaputter Eintrag kostet nicht die anderen', () => {
	const pfad = frischeAblage()
	speichereBoard({
		version: 1,
		entries: [
			{ leaderId: 'l', area: 'shared', key: 'gut', text: 'x', authorId: 'a', authorName: 'a', updatedAt: 1 },
			{ leaderId: 'l', area: 'shared', key: 'kaputt' }
		]
	}, pfad)
	assert.deepEqual(ladeBoard(pfad).entries.map((e) => e.key), ['gut'])
})

test('der Index steht neueste zuerst', async () => {
	// Die Zeitstempel werden GESETZT, nicht vom Uhrwerk erwartet: drei Schreibvorgaenge
	// in derselben Millisekunde waeren sonst gleich alt, und der Test wuerde eine
	// Reihenfolge pruefen, die es gar nicht gibt. Geprueft wird der Weg, den das
	// Modell geht: `team_board` ohne key.
	const pfad = frischeAblage()
	speichereBoard({
		version: 1,
		entries: [
			{ leaderId: 'sess-lead-a', area: 'shared', key: 'alt', text: 'a', authorId: 'a', authorName: 'a', updatedAt: 1_000 },
			{ leaderId: 'sess-lead-a', area: 'shared', key: 'neu', text: 'n', authorId: 'a', authorName: 'a', updatedAt: 3_000 },
			{ leaderId: 'sess-lead-a', area: 'shared', key: 'mitte', text: 'm', authorId: 'a', authorName: 'a', updatedAt: 2_000 }
		]
	}, pfad)

	const { board } = anmelden({ pfad })
	const index = await board.execute({}, exec(ANNA))
	assert.deepEqual(index.entries.map((e) => e.key), ['neu', 'mitte', 'alt'], 'der Index steht nicht neueste zuerst')

	// Gegenprobe: die ALT-Reihenfolge waere die andere — der Test kann also scheitern.
	assert.notDeepEqual(index.entries.map((e) => e.key), ['alt', 'mitte', 'neu'])
})

test('die Datei ist von Hand lesbar: eingerueckt, sortiert, mit allen sieben Feldern', () => {
	const pfad = frischeAblage()
	speichereBoard({
		version: 1,
		entries: [{ leaderId: 'l', area: 'shared', key: 'k', text: 'x', authorId: 'a', authorName: 'n', updatedAt: 1 }]
	}, pfad)
	const text = readFileSync(pfad, 'utf8')
	assert.ok(text.includes('\n\t'), 'die Datei ist nicht eingerueckt — E1 Regel 2 verlangt Lesbarkeit von Hand')
	for (const feld of ['leaderId', 'area', 'key', 'text', 'authorId', 'authorName', 'updatedAt']) {
		assert.ok(text.includes(`"${feld}"`), `das Feld ${feld} fehlt in der Datei`)
	}
})

// ---------------------------------------------------------------------------
// 9. Der Schluessel, die Grenzen, die Anmeldung
// ---------------------------------------------------------------------------

test('der Schluessel wird geprueft: leer, zu lang, mit Zeilenumbruch', () => {
	assert.equal(pruefeSchluessel('  api entscheidung  '), 'api entscheidung', 'der Schluessel wird getrimmt')
	for (const schlecht of ['', '   ', 'a'.repeat(65), 'zwei\nzeilen', `x${String.fromCharCode(0)}y`]) {
		assert.throws(() => pruefeSchluessel(schlecht), /invalid note key/u, `der Schluessel ${JSON.stringify(schlecht)} wurde angenommen`)
	}
	// Gegenprobe: die erlaubten Zeichen kommen durch.
	for (const gut of ['a', 'gross Und klein', 'mit-punkt.und strich', '中文']) {
		assert.equal(pruefeSchluessel(gut), gut, `${JSON.stringify(gut)} wurde abgelehnt`)
	}
})

test('die Grenzen aus dsh-team gelten: 4000 Zeichen je Notiz, 32 Eintraege je Bereich', async () => {
	const { notiz } = anmelden()

	await assert.rejects(
		() => notiz.execute({ key: 'zu lang', text: 'x'.repeat(GRENZEN.notizZeichen + 1) }, exec(ANNA)),
		/at most 4000 are allowed/u,
		'eine zu lange Notiz wurde angenommen'
	)

	// Gegenprobe: genau an der Grenze geht sie durch.
	const passt = await notiz.execute({ key: 'genau', text: 'x'.repeat(GRENZEN.notizZeichen) }, exec(ANNA))
	assert.equal(passt.action, 'written')
	assert.equal(passt.entry.key, 'genau')
})

test('die Werkzeuge werden angemeldet und tragen die echten Parameterschemata', async () => {
	const registriert = []
	const ctx = {
		logger: { info() {}, warn() {}, error() {} },
		get: (name) => (name === 'agentTeams' ? baueAgentTeams(TEAM_A) : undefined),
		tools: { register: (definition) => { registriert.push(definition); return () => {} } },
		effect(fn) { fn() },
		provide() { return () => {} }
	}
	apply(ctx, { pfad: frischeAblage() })
	await warten(400)

	assert.equal(registriert.length, 2, `es wurden ${registriert.length} Werkzeuge angemeldet statt zwei`)
	assert.deepEqual(registriert.map((definition) => definition.name).sort(), ['team_board', 'team_note'])

	const board = registriert.find((definition) => definition.name === 'team_board')
	const notiz = registriert.find((definition) => definition.name === 'team_note')

	// team_board: beide Parameter freiwillig — ohne key liest man den Index.
	assert.equal(board.parameters.required, undefined, 'team_board darf keinen Pflichtparameter haben')
	assert.deepEqual(Object.keys(board.parameters.properties).sort(), ['key', 'private'])
	assert.equal(board.parameters.properties.private.type, 'boolean')

	// team_note: key ist Pflicht, text und private sind es nicht (text fehlt = loeschen).
	assert.deepEqual(notiz.parameters.required, ['key'])
	assert.deepEqual(Object.keys(notiz.parameters.properties).sort(), ['key', 'private', 'text'])
	assert.equal(notiz.parameters.properties.text.type, 'string')
})

// ---------------------------------------------------------------------------
// 10. Der Fork-Fall — die Antwort sagt die Wahrheit, die Ablage bleibt
// ---------------------------------------------------------------------------

test('ein Fork erfaehrt beim Schreiben, dass das Brett ihm allein gehoert', async () => {
	const { notiz, pfad } = anmelden()

	// Die Erkennung selbst: der Dienst nennt den Fork seine EIGENE Wurzel, UND er
	// ist ein Kind — nur beides zusammen ist der Fall.
	assert.equal(istEigenesTeam(SELBST['sess-fork'], FORK), true, 'der Fork wird nicht als eigener Fall erkannt')

	const antwort = await notiz.execute({ key: 'fund', text: 'der Fork hat etwas herausgefunden' }, exec(FORK))

	assert.equal(antwort.action, 'written', 'die Notiz wird gespeichert — nicht verboten und nicht abgelehnt')
	assert.equal(antwort.allein, true, 'die Antwort sagt dem Fork nicht, dass das Brett ihm allein gehoert')
	assert.match(antwort.hinweis, /belongs to you alone/u, 'der Hinweis sagt nicht, dass das Brett ihm allein gehoert')
	assert.match(antwort.hinweis, /own session/u, 'der Hinweis nennt den Grund nicht: seine Wurzel ist er selbst')
	assert.match(antwort.hinweis, /send_to_session/u, 'der Hinweis nennt den Ausweg nicht')

	// Die Kennzeichnung aendert die ABLAGE nicht: die Notiz steht ganz normal da.
	const gespeichert = ladeBoard(pfad).entries
	assert.equal(gespeichert.length, 1, 'die Notiz des Forks wurde verworfen, statt gespeichert')
	assert.equal(gespeichert[0].text, 'der Fork hat etwas herausgefunden')
	assert.equal(gespeichert[0].leaderId, 'sess-fork', 'der Fork schreibt nicht unter seiner eigenen Wurzel-Id')
})

test('ein Fork erfaehrt beim Lesen dieselbe Wahrheit', async () => {
	const { board, notiz } = anmelden()
	const geschrieben = await notiz.execute({ key: 'fund', text: 'x' }, exec(FORK))

	const gelesen = await board.execute({}, exec(FORK))
	assert.equal(gelesen.allein, true, 'das Lesen verschweigt dem Fork, dass es sein eigenes Brett ist')
	assert.equal(gelesen.hinweis, geschrieben.hinweis, 'team_board und team_note tragen nicht denselben Hinweis')
	assert.equal(gelesen.entries.length, 1)
	assert.equal(gelesen.entries[0].key, 'fund')

	// Auch der private Block gehoert dem Fork allein — dieselbe Kennzeichnung.
	const privat = await board.execute({ private: true }, exec(FORK))
	assert.equal(privat.allein, true, 'der private Block des Forks traegt die Kennzeichnung nicht')
})

test('ein Teammate bekommt KEINEN Allein-Hinweis (Gegenprobe zu Test 1)', async () => {
	// Ohne diesen Fall wuerde ein Patch, der IMMER `allein` setzt, die zwei
	// Fork-Tests auch bestehen.
	const { notiz } = anmelden()
	const antwort = await notiz.execute({ key: 'x', text: 'y' }, exec(ANNA))

	assert.equal(antwort.allein, undefined, 'ein Teammate wird gewarnt, obwohl sein root der Lead ist')
	assert.equal(antwort.hinweis, undefined, 'ein Teammate bekommt den Fork-Hinweis')
	// Der Grund ist der FREMDE root, nicht ein fehlendes header: der Dienst nennt
	// den Lead die Wurzel, also ist Anna kein eigener Fall.
	assert.equal(istEigenesTeam(TEAM_A['sess-anna'], ANNA), false)
})

test('eine Wurzel-Sitzung ohne parentSession bekommt KEINEN Allein-Hinweis (Gegenprobe zu Test 2)', async () => {
	// Die Wurzel-Sitzung des Menschen ist ihre eigene Wurzel und SOLL ihr eigenes
	// Team sein. Ohne diesen Fall wuerde jede Sitzung gewarnt.
	const { board, notiz } = anmelden()
	const geschrieben = await notiz.execute({ key: 'x', text: 'y' }, exec(WURZEL))
	const gelesen = await board.execute({}, exec(WURZEL))

	assert.equal(geschrieben.allein, undefined, 'die Wurzel-Sitzung wird gewarnt, obwohl sie ihr eigenes Team IST')
	assert.equal(gelesen.allein, undefined, 'das Lesen warnt die Wurzel-Sitzung')
	assert.equal(geschrieben.hinweis, undefined)
	// Der Unterschied ist wirklich nur `parentSession`: header ist da, Elternfeld
	// nicht — und die Wurzel ist sie selbst.
	assert.equal(SELBST['sess-wurzel'].root.id, WURZEL.id)
	assert.equal(WURZEL.session.header.parentSession, undefined)
	assert.equal(istEigenesTeam(SELBST['sess-wurzel'], WURZEL), false)
})

test('die Notiz eines Forks liegt in seinem eigenen Brett: ein anderes Team sieht sie nicht', async () => {
	const { board, notiz, pfad } = anmelden()

	await notiz.execute({ key: 'nur fuer mich', text: 'gilt nur in meinem Kopf' }, exec(FORK))

	// In der Datei steht der Fork unter SEINER Id als leaderId — er ist seine
	// eigene Wurzel, deshalb ist sein "geteiltes" Brett von jedem Team getrennt.
	assert.equal(ladeBoard(pfad).entries[0].leaderId, 'sess-fork')

	// Ein Teammate mit anderem root liest die Notiz nicht ...
	const bob = await board.execute({}, exec(BOB))
	assert.equal(bob.entries.length, 0, 'Team A sieht die Notiz des Forks — dann waere die Warnung falsch')
	// ... und ein zweiter Fork auch nicht. Gegenprobe: der Fork selbst sieht sie.
	const zweiterFork = await board.execute({}, exec(FORK2))
	assert.equal(zweiterFork.entries.length, 0, 'zwei Forks teilen ein Brett — der Hinweis waere falsch')
	const eigen = await board.execute({}, exec(FORK))
	assert.deepEqual(eigen.entries.map((e) => e.key), ['nur fuer mich'], 'der Fork selbst sieht seine eigene Notiz nicht')
})

/**
 * Legt eine Kopie des Moduls unter /tmp an, in der `istEigenesTeam` IMMER
 * `false` liefert.
 *
 * Die Kopie entsteht aus DER Datei des Repos, nicht aus einer Nachbildung: genau
 * eine Zeile wird ersetzt, der Import zeigt auf das echte send-to-session.mjs.
 * Greift die Ersetzung nicht, wirft die Funktion — sonst maesse die Gegenprobe
 * die Erkennung mit und waere keine.
 */
function kopieOhneForkErkennung() {
	const quelle = readFileSync(MODUL, 'utf8')
	const angepasst = quelle
		.replace('from "./send-to-session.mjs"', `from ${JSON.stringify(SEND_TO_SESSION)}`)
		.replace('return ichBinDieWurzel && binEinKind;', 'return false;')
	if (angepasst.includes('return ichBinDieWurzel && binEinKind;')) {
		throw new Error('die Fork-Erkennung wurde in der Kopie nicht ersetzt — die Gegenprobe wuerde sonst die Erkennung mitmessen')
	}
	if (!angepasst.includes('return false;')) {
		throw new Error('die Kopie ohne Fork-Erkennung traegt die Ersetzung nicht — die Gegenprobe waere keine')
	}
	const ordner = mkdtempSync(join(tmpdir(), 'team-board-ohne-fork-'))
	const ziel = join(ordner, 'team-board-ohne-fork.mjs')
	writeFileSync(ziel, angepasst)
	return ziel
}

/**
 * Faehrt DIESE Testdatei erneut — nur mit den zwei Tests, deren Name mit
 * „ein Fork" beginnt (Test 1 und 2), und gegen `modulPfad` statt gegen das
 * Modul des Repos.
 *
 * @returns `{ code, ausgabe }` des Kindprozesses.
 */
function laufeForkTests(modulPfad) {
	return new Promise((fertig, fehler) => {
		// `NODE_TEST_CONTEXT` erbt der Kindprozess vom laufenden Test-Runner; mit ihr
		// haelt sich `node --test` fuer einen rekursiven Lauf und startet gar nichts
		// ("skipping running files"). Ein eigener Lauf braucht sie nicht.
		const umgebung = { ...process.env, TEAM_BOARD_MODUL: modulPfad }
		delete umgebung.NODE_TEST_CONTEXT
		const prozess = spawn(process.execPath, ['--test', '--test-name-pattern', '^ein Fork', 'test/team-board.test.mjs'], {
			cwd: REPO,
			env: umgebung,
			stdio: ['ignore', 'pipe', 'pipe']
		})
		let ausgabe = ''
		prozess.stdout.on('data', (teil) => { ausgabe += teil })
		prozess.stderr.on('data', (teil) => { ausgabe += teil })
		prozess.on('error', fehler)
		prozess.on('close', (code) => fertig({ code, ausgabe }))
	})
}

test('Gegenprobe am Code: ohne die Fork-Erkennung werden die zwei Fork-Tests rot', async () => {
	// Erst die Probe auf dem ECHTEN Modul: dieselben zwei Tests muessen hier gruen
	// sein, sonst misst der Vergleich nur, dass irgendetwas kaputt ist.
	const echt = await laufeForkTests(MODUL)
	assert.equal(echt.code, 0, `die zwei Fork-Tests sind auf dem echten Modul rot:\n${echt.ausgabe}`)
	assert.match(echt.ausgabe, /# pass 2/u, `es liefen nicht genau die zwei Fork-Tests:\n${echt.ausgabe}`)

	// Jetzt dieselben zwei Tests gegen die Kopie, in der die Erkennung immer false
	// liefert: BEIDE muessen rot werden. Blieben sie gruen, prueften sie nichts.
	const ohne = kopieOhneForkErkennung()
	const kaputt = await laufeForkTests(ohne)
	assert.notEqual(kaputt.code, 0, `die zwei Fork-Tests blieben ohne Fork-Erkennung gruen — sie pruefen die Erkennung nicht:\n${kaputt.ausgabe}`)
	assert.match(kaputt.ausgabe, /# fail 2/u, `ohne Erkennung wurde nicht GENAU die zwei Fork-Tests rot:\n${kaputt.ausgabe}`)
})
