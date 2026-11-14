/**
 * kind-eigner.test.mjs — Pruefung des Kern-Patches "der Mensch als zusaetzlicher Eigentuemer eines Kindes"
 * (patches/kind-eigner.mjs und patches/allow-kind-eigner.mjs, Issue DSH-Verwaltung 175).
 *
 * Der Test belegt vier Dinge, ohne die DSH-Installation anzufassen (er liest sie hoechstens):
 *   1. die Textumwandlung (Selbstpruefung des Moduls) laeuft sauber durch,
 *   2. apply und --revert in einem Wegwerf-Wurzelordner: Ausgangszustand byte-gleich (sha256), Status je Stelle,
 *   3. ein veraenderter Anker wird abgelehnt, ohne dass etwas geschrieben wird,
 *   4. zehn Mutationen am Patch selbst werden jeweils rot (die Selbstpruefung schlaegt an).
 * Ist eine echte Installation vorhanden, werden ihre drei Kerndateien nur GELESEN und in ein Wegwerf-Verzeichnis kopiert;
 * dort wird der Patch angewendet, mit `node --check` auf Syntax geprueft und wieder zurueckgenommen.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ERSETZUNGEN, ZIELE, applyToSource, revertFromSource, statusOf } from '../patches/kind-eigner.mjs'

const PAKET = join(dirname(fileURLToPath(import.meta.url)), '..')
const LOGIK = join(PAKET, 'patches', 'kind-eigner.mjs')
const BEDIENUNG = join(PAKET, 'patches', 'allow-kind-eigner.mjs')
const sha = (text) => createHash('sha256').update(text).digest('hex')
const lauf = (datei, argumente, env = {}) => spawnSync(process.execPath, [datei, ...argumente], { encoding: 'utf8', env: { ...process.env, ...env } })

/** Pfad einer Kerndatei unterhalb einer Wurzel (globale Ablageform). */
const kernPfad = (wurzel, ziel) => join(wurzel, '@deepseek-ai', 'dsh', 'node_modules', ...ziel.paket.split('/'), ziel.datei)

/** Wegwerf-Wurzel: je Zieldatei ein Text aus allen `vorher`-Stellen, getrennt durch Fuellzeilen. */
function baueWurzel() {
	const ordner = mkdtempSync(join(tmpdir(), 'kind-eigner-'))
	const ausgang = new Map()
	for (const ziel of ZIELE) {
		const text = ERSETZUNGEN.filter((e) => e.paket === ziel.paket && e.datei === ziel.datei).map((e) => `// Fuellzeile vor ${e.id}\n${e.vorher}\n`).join('\n')
		const pfad = kernPfad(ordner, ziel)
		mkdirSync(dirname(pfad), { recursive: true })
		writeFileSync(pfad, text)
		ausgang.set(pfad, sha(text))
	}
	return { ordner, ausgang }
}

test('die Selbstpruefung der Textumwandlung laeuft durch', () => {
	const l = lauf(LOGIK, ['--test'])
	assert.equal(l.status, 0, `${l.stdout}${l.stderr}`)
	assert.match(l.stdout, /alles in Ordnung/u)
})

test('es sind sechzehn Ersetzungen in genau drei Kerndateien, jede mit eindeutigem Namen', () => {
	assert.equal(ERSETZUNGEN.length, 16)
	assert.equal(new Set(ERSETZUNGEN.map((e) => e.id)).size, 16)
	assert.equal(ZIELE.length, 3)
	// Die Zahl der Kernzeilen ist die Groesse des Patches (Zielbrief: etwa 60 bis 70, hier gemessen):
	const zeilen = (text) => text.split('\n').length
	const hinzu = ERSETZUNGEN.reduce((summe, e) => summe + Math.max(0, zeilen(e.nachher) - zeilen(e.vorher)), 0)
	assert.ok(hinzu > 0 && hinzu < 90, `Patch waechst um ${hinzu} Zeilen`)
})

test('apply und --revert in einer Wegwerf-Wurzel: Status je Stelle, danach byte-gleich zum Ausgang', () => {
	const { ordner, ausgang } = baueWurzel()
	const sicherung = join(ordner, 'sicherung')
	const log = join(ordner, 'kind-eigner.log')
	try {
		const env = { DSH_KIND_EIGNER_LOG: log }
		const vorher = lauf(BEDIENUNG, ['--status', `--root=${ordner}`], env)
		assert.equal(vorher.status, 0, `${vorher.stdout}${vorher.stderr}`)
		assert.equal((vorher.stdout.match(/gesperrt/gu) ?? []).length, 16)

		const an = lauf(BEDIENUNG, [`--root=${ordner}`, `--sicherung=${sicherung}`], env)
		assert.equal(an.status, 0, `${an.stdout}${an.stderr}`)
		assert.equal((an.stdout.match(/^ {2}freigegeben /gmu) ?? []).length, 16)
		assert.match(an.stdout, /sha256 vorher/u)
		assert.match(an.stdout, /sha256 nachher/u)
		for (const pfad of ausgang.keys()) assert.notEqual(sha(readFileSync(pfad, 'utf8')), ausgang.get(pfad), 'apply hat die Datei nicht veraendert')
		assert.ok(existsSync(sicherung), 'es gibt keine Sicherung')

		const mitte = lauf(BEDIENUNG, ['--status', `--root=${ordner}`], env)
		assert.equal((mitte.stdout.match(/freigegeben/gu) ?? []).length, 16)

		// zweimal anwenden ist harmlos
		const nochmal = lauf(BEDIENUNG, [`--root=${ordner}`, `--sicherung=${sicherung}`], env)
		assert.equal(nochmal.status, 0)
		assert.equal((nochmal.stdout.match(/unveraendert/gu) ?? []).length, 16)

		const zurueck = lauf(BEDIENUNG, ['--revert', `--root=${ordner}`], env)
		assert.equal(zurueck.status, 0, `${zurueck.stdout}${zurueck.stderr}`)
		for (const [pfad, soll] of ausgang) assert.equal(sha(readFileSync(pfad, 'utf8')), soll, `${pfad} ist nach --revert nicht byte-gleich zum Ausgang`)
	} finally {
		rmSync(ordner, { recursive: true, force: true })
	}
})

test('ein veraenderter Anker: der Patch weigert sich, statt still nichts zu tun, und schreibt nichts', () => {
	const { ordner, ausgang } = baueWurzel()
	try {
		const ziel = ZIELE[0]
		const pfad = kernPfad(ordner, ziel)
		const text = readFileSync(pfad, 'utf8')
		const ersetzung = ERSETZUNGEN.find((e) => e.paket === ziel.paket && e.datei === ziel.datei)
		const kaputt = text.replace(ersetzung.vorher, ersetzung.vorher.replace(/[a-z]/u, 'X'))
		assert.notEqual(kaputt, text)
		writeFileSync(pfad, kaputt)
		const stand = sha(kaputt)
		const l = lauf(BEDIENUNG, [`--root=${ordner}`, `--sicherung=${join(ordner, 's')}`], { DSH_KIND_EIGNER_LOG: join(ordner, 'l.log') })
		assert.equal(l.status, 1, `${l.stdout}${l.stderr}`)
		assert.match(l.stdout, /Keine vollstaendige Installation/u)
		assert.equal(sha(readFileSync(pfad, 'utf8')), stand, 'bei veraendertem Anker wurde trotzdem geschrieben')
		// und die reine Umwandlung meldet einen Fehler, wirft nicht
		assert.ok(applyToSource(kaputt, ersetzung.id).error !== undefined)
		for (const [anderer, soll] of ausgang) if (anderer !== pfad) assert.equal(sha(readFileSync(anderer, 'utf8')), soll)
	} finally {
		rmSync(ordner, { recursive: true, force: true })
	}
})

test('Anker die zweimal vorkommen werden abgelehnt (nicht geraten)', () => {
	for (const e of ERSETZUNGEN) {
		const doppelt = `${e.vorher}\n${e.vorher}`
		const ergebnis = applyToSource(doppelt, e.id)
		assert.ok(ergebnis.error !== undefined && /2 mal/u.test(ergebnis.error), `${e.id}: doppelter Anker wurde nicht abgelehnt`)
		const doppeltNach = `${e.nachher}\n${e.nachher}`
		assert.equal(statusOf(doppeltNach, e.id), 'unbekannt', `${e.id}: doppeltes Ergebnis darf nicht als freigegeben gelten`)
		assert.ok(revertFromSource(doppeltNach, e.id).changed === false)
	}
})

test('echte Installation (nur gelesen): alle Stellen sind gesperrt oder freigegeben; auf einer Kopie ist die Syntax in Ordnung und --revert byte-gleich', (t) => {
	const wurzel = '/opt/homebrew/lib/node_modules'
	if (!ZIELE.every((ziel) => existsSync(kernPfad(wurzel, ziel)))) { t.skip('keine DSH-Installation an der ueblichen Stelle'); return }
	const kopie = mkdtempSync(join(tmpdir(), 'kind-eigner-echt-'))
	try {
		for (const ziel of ZIELE) {
			const quelle = readFileSync(kernPfad(wurzel, ziel), 'utf8')
			for (const e of ERSETZUNGEN.filter((x) => x.paket === ziel.paket && x.datei === ziel.datei)) {
				const stand = statusOf(quelle, e.id)
				if (stand === 'unbekannt') { t.skip(`Die Installation passt nicht mehr zu ${e.id} (DSH-Update?)`); return }
			}
			const ziel2 = kernPfad(kopie, ziel)
			mkdirSync(dirname(ziel2), { recursive: true })
			copyFileSync(kernPfad(wurzel, ziel), ziel2)
		}
		const vorher = new Map(ZIELE.map((ziel) => [kernPfad(kopie, ziel), sha(readFileSync(kernPfad(kopie, ziel), 'utf8'))]))
		const env = { DSH_KIND_EIGNER_LOG: join(kopie, 'l.log') }
		const an = lauf(BEDIENUNG, [`--root=${kopie}`, `--sicherung=${join(kopie, 's')}`], env)
		assert.equal(an.status, 0, `${an.stdout}${an.stderr}`)
		for (const pfad of vorher.keys()) {
			const syntax = spawnSync(process.execPath, ['--check', pfad], { encoding: 'utf8' })
			assert.equal(syntax.status, 0, `${pfad}: ${syntax.stderr}`)
		}
		const zurueck = lauf(BEDIENUNG, ['--revert', `--root=${kopie}`], env)
		assert.equal(zurueck.status, 0, `${zurueck.stdout}${zurueck.stderr}`)
		for (const [pfad, soll] of vorher) assert.equal(sha(readFileSync(pfad, 'utf8')), soll, `${pfad}: nach --revert nicht byte-gleich`)
	} finally {
		rmSync(kopie, { recursive: true, force: true })
	}
})

/**
 * Zehn Mutationen am Patch selbst. Jede veraendert genau eine Stelle von patches/kind-eigner.mjs in einer Wegwerf-Kopie
 * und muss die Selbstpruefung (`--test`) auf Exit 1 bringen. Bleibt eine Mutation gruen, prueft der Test nichts.
 */
const MUTATIONEN = [
	['Ruecknahme laesst Rest zurueck', 'return { changed: true, source: source.replace(ersetzung.nachher, () => ersetzung.vorher), steps: [ersetzung.was] };', 'return { changed: true, source: source, steps: [ersetzung.was] };'],
	['Besitz-Check zu weit geoeffnet: die Elternadresse wird nicht mehr geprueft (deliverByHuman)', '\'if (resident !== void 0 && resident.parentSession !== parentSessionId) throw new SubagentError("subagent " + JSON.stringify(childId) + " belongs to another parent session", "UNAUTHORIZED");\'', '\'/* keine Pruefung */\''],
	['Besitz-Check zu weit geoeffnet: coldResume prueft die Elternadresse nicht', 'if (source.header.parentSession !== options.humanParentId) throw', 'if (false) throw'],
	['mit lebendem Elternteil entfaellt authorizeLineage', 'z(3, "else this.activations.authorizeLineage(parent, childId, source.header.parentSession);")', 'z(3, "this.activations.authorizeLineage(parent, childId, source.header.parentSession);")'],
	['prompt wirft bei kaltem Elternteil weiter', 'z(3, "// " + MARKER + ": ein kalter Elternteil sperrt den Menschen nicht (deliverByHuman).")', 'z(3, \'if (parent === void 0) throw new RemoteError("subagent/parent-unavailable", "x", {});\')'],
	['die Abschlussmeldung laedt den Elternteil (statt leise abzulegen)', "handle = await persistence.open(parentId, \\\"write\\\");", "handle = await this.ctx.agents.resume({ resumeSessionId: parentId });"],
	['die Abschlussmeldung wird nicht mehr nur angehaengt', 'await handle.append([{ type: "agent/inbox/spliced"', 'await handle.write([{ type: "agent/inbox/spliced"'],
	['das Eingabefeld bleibt gesperrt', 'const parentOffline = false; // " + MARKER', 'const parentOffline = true; // " + MARKER'],
	['agentAvailable wird verfaelscht (kosmetische Luege)', 'const parentOffline = false; // " + MARKER + ": der Mensch ist Eigentuemer, der Server entscheidet"', 'const parentOffline = false; /* agentAvailable true */ // " + MARKER + ": der Mensch ist Eigentuemer, der Server entscheidet"'],
	['der Weg mit lebendem Elternteil verschwindet aus prompt', ': await this[deliverSubagentPrompt](parent, childSessionId, content, source, signal, delivery) }; // " + MARKER', ': await this.requireContinuations().deliverByHuman(parentSessionId, childSessionId, content, source, signal, delivery) }; // " + MARKER']
]

test('Grundlinie: die unveraenderte Selbstpruefung ist gruen (sonst sagen die Mutationen nichts)', () => {
	assert.equal(lauf(LOGIK, ['--test']).status, 0)
})

for (const [name, vorher, nachher] of MUTATIONEN) {
	test(`Mutation muss rot werden: ${name}`, () => {
		const quelle = readFileSync(LOGIK, 'utf8')
		assert.ok(quelle.includes(vorher), `die Mutationsstelle fehlt im Patch: ${vorher.slice(0, 80)}`)
		const ordner = mkdtempSync(join(tmpdir(), 'kind-eigner-mut-'))
		try {
			const datei = join(ordner, 'kind-eigner.mjs')
			writeFileSync(datei, quelle.replace(vorher, () => nachher))
			const l = lauf(datei, ['--test'])
			assert.notEqual(l.status, 0, `Die Mutation "${name}" blieb gruen:\n${l.stdout}${l.stderr}`)
		} finally {
			rmSync(ordner, { recursive: true, force: true })
		}
	})
}
