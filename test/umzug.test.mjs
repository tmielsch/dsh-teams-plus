/**
 * umzug.test.mjs — Selbstpruefung fuer den Umzug aus dsh-projectOS.
 *
 * Der Test belegt fuenf Dinge:
 *   1. alle 23 Patch-Dateien liegen im Paket und sind byte-gleich zum Original (sha256),
 *   2. package.json exportiert patches/*, und cordis.patch.yml nennt genau die fuenf B-Patches,
 *   3. jede der 18 A-Dateien antwortet auf --status, ohne die DSH-Installation anzufassen,
 *   4. bin/teams-plus.mjs ist ausfuehrbar und `status` listet die A-Patches,
 *   5. `link` haengt patches/ und rollen/ nach ~/.dsh/.tm/teams-plus (geprueft in einem
 *      Temp-Zuhause, nicht im echten ~/.dsh).
 *
 * Kein Netz, keine Schreibe in die echte DSH-Installation: die Werkzeuge laufen ausschliesslich
 * mit --status, und der Test vergleicht vorher/nachher Groesse und mtime der Zieldateien.
 * Die sha256-Werte sind am 2026-10-30 beim Umzug aus den Originalen festgehalten:
 *   /Users/tmielsch/dsh-projectOS/patches/<name>   (17 Dateien)
 *   /Users/tmielsch/.dsh/patches/<name>            (6 Dateien mit "member")
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PAKET = join(dirname(fileURLToPath(import.meta.url)), '..')
const PATCHES = join(PAKET, 'patches')
const BIN = join(PAKET, 'bin', 'teams-plus.mjs')

/** sha256 der 23 Originale beim Umzug. */
const SHA256 = {
	'allow-child-goal-resume.mjs': 'c87a4b1dc04468e4ec1a77d80e6619033fa7013d96776207e52eb8e84d716beb',
	'child-goal-resume.mjs': '87e26e8a225cea79f6135ef58ae5f09dbb5fa3c8b9bd1e153e88412f5b30509d',
	'allow-child-session-routing.mjs': 'ab86aeaea7da393723bc11395aaa380a1e32fa7e7eccb887f563490de60538a5',
	'child-session-routing.mjs': '302bfcbcebaccacb9094fc6359d8318a7305feda49a7978c51d7a4db942b2a74',
	'allow-subagent-goals.mjs': '0273abc405107b66718c82228aae422de5c840995b7d455bee7324852fc763b6',
	'goals-for-subagents.mjs': '27d90969244c1203ca7b0485113c79e604be42e8aeda67997df15644a42791ac',
	'allow-subagent-model-fields.mjs': 'f2b551039a62b61e0e80fb37af923dbe94957ce7f02ef787af068aef496de053',
	'subagent-model-fields.mjs': 'e0a0e28db5d3e26a3affc436824634c74d38e04d6824756aec2e157ff78def97',
	'allow-subagent-rolle.mjs': '798d0ec8e3c68c67ed8c36c1bc4bb7214b320e155e390fdf842807fda8b4df8f',
	'subagent-rolle.mjs': 'e7a3a889d5bd13dc616ab71640e3b19751b3dee4f76752bda84555c5dc8ec977',
	'allow-subagent-files.mjs': 'a6fdbce5767a63c02bf0c8d9f807483d2924c3d635c86fc32e2368bacc4f8d1e',
	'subagent-files.mjs': 'f2acd36af722be2d1e60d54b6e01b7f5bab9015b9e22bc038d7207184e97ad6f',
	'allow-member-images.mjs': 'b2783a30eb91d4a54b9ba567d7fa34420767a6e71d7b17baddfe1b9f2beb485d',
	'member-images.mjs': 'ea348bd3bc8a4aa1e41dc620aad1d363257c6c2c36553c356a51dbdf1522e4e4',
	'install-member-images.mjs': 'ff138988a03f53c0a8afad03c01feb4d85c01d21a589e0c52ce63f6cca0fd427',
	'member-image-check.mjs': '8422495fcf0ec4079959617c9dd1215199c27e6fe2f96463e54e5410f1f5d140',
	'allow-member-model.mjs': 'f2822fe597ea5487c37ad1fb7acbd844da844bad4b325145019a629bdd24e9fd',
	'member-model.mjs': '8f56ff4eaceb8773c3a537a4d729fa89ffad4f36dd59c7902c4feaf830be4584',
	'delegate-send.mjs': '62af78119649e92e65fa97ff968e1fe04fe2e074cb4c7f9e8604b87325a69d17',
	'teammate-model.mjs': 'a02a381d027a478e474116357b4c1ebde876a229809bd90641ea2630e139a09c',
	'goal-await.mjs': '5b14367e60387d777f23628795efbb6a69c49f5db879e7071c7aa64192eaa5ef',
	'stille-nachrichten.mjs': '31e83a7963ca6d9478414267a0f1a53de885121df1453386e879230677409ffd',
	'rolle-titel.mjs': '84dccc5a2d00aa017020cbf73c4b0eb24f766539781e98d7004542bf6c1c8934'
}

/** Die 18 A-Dateien: sie schreiben in die DSH-Installation. */
const A_DATEIEN = [
	'allow-child-goal-resume.mjs', 'child-goal-resume.mjs',
	'allow-child-session-routing.mjs', 'child-session-routing.mjs',
	'allow-subagent-goals.mjs', 'goals-for-subagents.mjs',
	'allow-subagent-model-fields.mjs', 'subagent-model-fields.mjs',
	'allow-subagent-rolle.mjs', 'subagent-rolle.mjs',
	'allow-subagent-files.mjs', 'subagent-files.mjs',
	'allow-member-images.mjs', 'member-images.mjs', 'install-member-images.mjs', 'member-image-check.mjs',
	'allow-member-model.mjs', 'member-model.mjs'
]

/** Die fuenf B-Patches: Cordis-Plugins aus cordis.patch.yml. */
const B_PATCHES = ['delegate-send.mjs', 'teammate-model.mjs', 'goal-await.mjs', 'stille-nachrichten.mjs', 'rolle-titel.mjs']

/** Die Werkzeuge mit eigener Bedienung (--status, --revert). */
const WERKZEUGE = A_DATEIEN.filter((name) => name.startsWith('allow-'))

/** Die Rollen, die mit umgezogen sind. */
const ROLLEN = ['research.md', 'redteam.md', 'implementer.md', 'draft.md', 'rag.md', 'projektmanager.md', '_ENTWURF-team-profile.md']

/**
 * Bekannte Meldungen, mit denen ein Werkzeug ehrlich aufhoert, wenn es nichts findet.
 * Ein Exit 1 ist nur dann in Ordnung, wenn eine davon in der Ausgabe steht.
 */
const BEKANNT = [
	/Keine vollstaendige .* gefunden/,
	/Keine DSH-Installation gefunden/,
	/Dieses Verzeichnis gibt es nicht/
]

const starte = (datei, argumente) => spawnSync(process.execPath, [datei, ...argumente], { encoding: 'utf8' })

/**
 * Die Dateien der DSH-Installation, die ein A-Patch anfassen kann: alle lib/index.js und
 * lib/client.js der @deepseek-ai-Pakete. Aufgenommen werden Groesse und mtime; schreibt ein
 * Werkzeug, aendert sich beides.
 */
function zieldateien() {
	const stan = []
	const wurzeln = ['/opt/homebrew/lib/node_modules', '/usr/local/lib/node_modules', join(homedir(), '.local', 'lib', 'node_modules')]
	const profile = join(homedir(), '.dsh', 'profiles')
	if (existsSync(profile)) {
		for (const name of readdirSync(profile)) wurzeln.push(join(profile, name, 'node_modules'))
	}
	for (const wurzel of wurzeln) {
		for (const basis of [join(wurzel, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'), join(wurzel, '@deepseek-ai')]) {
			if (!existsSync(basis)) continue
			for (const paket of readdirSync(basis)) {
				for (const datei of ['index.js', 'client.js']) {
					const pfad = join(basis, paket, 'lib', datei)
					if (!existsSync(pfad)) continue
					const stand = statSync(pfad)
					stan.push(`${pfad} ${stand.size} ${stand.mtimeMs}`)
				}
			}
		}
	}
	return stan.sort()
}

test('alle 23 Patch-Dateien liegen im Paket und sind byte-gleich zum Original', () => {
	assert.equal(Object.keys(SHA256).length, 23, 'die Liste der Originale muss 23 Dateien haben')
	const abweichend = []
	for (const [name, soll] of Object.entries(SHA256)) {
		const pfad = join(PATCHES, name)
		if (!existsSync(pfad)) { abweichend.push(`${name}: fehlt im Paket`); continue }
		const ist = createHash('sha256').update(readFileSync(pfad)).digest('hex')
		if (ist !== soll) abweichend.push(`${name}: sha256 ${ist} statt ${soll}`)
	}
	assert.deepEqual(abweichend, [], 'Dateien weichen vom Original ab')
	assert.deepEqual(readdirSync(PATCHES).sort(), Object.keys(SHA256).sort(), 'im Ordner patches/ liegt eine andere Dateiliste als erwartet')
})

test('die sieben Rollen sind vorhanden', () => {
	const fehlend = ROLLEN.filter((name) => !existsSync(join(PAKET, 'rollen', name)))
	assert.deepEqual(fehlend, [])
	assert.equal(readdirSync(join(PAKET, 'rollen')).length, ROLLEN.length)
})

test('package.json exportiert patches/*, und cordis.patch.yml nennt genau die fuenf B-Patches', () => {
	const paket = JSON.parse(readFileSync(join(PAKET, 'package.json'), 'utf8'))
	assert.equal(paket.exports['./patches/*'], './patches/*', 'Wildcard-Export "./patches/*" fehlt')
	assert.equal(paket.exports['./rollen/*'], './rollen/*', 'Wildcard-Export "./rollen/*" fehlt')
	assert.equal(paket.bin['teams-plus'], './bin/teams-plus.mjs')

	const yml = readFileSync(join(PAKET, 'cordis.patch.yml'), 'utf8')
	const genannt = [...yml.matchAll(/@tmielsch\/dsh-teams-plus\/patches\/([\w.-]+\.mjs)/gu)].map((treffer) => treffer[1])
	assert.deepEqual(genannt.sort(), [...B_PATCHES].sort(), 'cordis.patch.yml nennt andere Dateien als die fuenf B-Patches')
	for (const name of genannt) assert.ok(existsSync(join(PATCHES, name)), `patches/${name} fehlt`)
})

test('jede A-Datei antwortet auf --status, und die DSH-Installation bleibt unberuehrt', () => {
	const vorher = zieldateien()
	const abweichend = []

	for (const name of A_DATEIEN) {
		const lauf = starte(join(PATCHES, name), ['--status'])
		const text = `${lauf.stdout}${lauf.stderr}`
		// Kein Absturz: ein Absturz hinterlaesst eine Ausnahme im Text.
		assert.ok(!/(TypeError|ReferenceError|SyntaxError|RangeError|node:internal)/u.test(text), `${name} ist abgestuerzt:\n${text}`)
		if (lauf.status === 0) continue
		if (lauf.status === 1 && BEKANNT.some((muster) => muster.test(text))) continue
		abweichend.push(`${name}: Exit ${lauf.status}\n${text}`)
	}
	assert.deepEqual(abweichend, [], 'A-Dateien ohne Antwort auf --status')

	const nachher = zieldateien()
	assert.deepEqual(nachher, vorher, 'ein --status hat in der DSH-Installation etwas geschrieben')
	assert.ok(vorher.length > 0, 'keine DSH-Installation gefunden — der Test konnte nichts vergleichen')
})

test('bin/teams-plus.mjs ist ausfuehrbar und status listet die A-Patches', () => {
	assert.ok(existsSync(BIN), 'bin/teams-plus.mjs fehlt')
	assert.ok((statSync(BIN).mode & 0o111) !== 0, 'bin/teams-plus.mjs hat kein Ausfuehrungsrecht')
	assert.ok(readFileSync(BIN, 'utf8').startsWith('#!/usr/bin/env node'), 'Shebang fehlt')

	const lauf = starte(BIN, ['status'])
	assert.equal(lauf.status, 0, `status endet mit ${lauf.status}:\n${lauf.stdout}${lauf.stderr}`)
	for (const werkzeug of WERKZEUGE) {
		assert.ok(lauf.stdout.includes(werkzeug), `${werkzeug} fehlt in der Ausgabe von status`)
	}
	assert.match(lauf.stdout, /18 A-Dateien in 8 Werkzeugen/u)
	assert.match(lauf.stdout, /Nichts wurde geschrieben/u)

	const hilfe = starte(BIN, ['help'])
	assert.equal(hilfe.status, 0)
	assert.match(hilfe.stdout, /teams-plus apply/u)
})

test('link haengt patches/ und rollen/ nach ~/.dsh/.tm/teams-plus, nicht nach ~/.dsh/patches', () => {
	const heim = mkdtempSync(join(tmpdir(), 'teams-plus-link-'))
	try {
		const lauf = starte(BIN, ['link', `--dsh-home=${heim}`])
		assert.equal(lauf.status, 0, `${lauf.stdout}${lauf.stderr}`)

		const ziel = join(heim, '.tm', 'teams-plus')
		assert.ok(lstatSync(join(ziel, 'patches')).isSymbolicLink(), 'patches ist kein Verweis')
		assert.ok(lstatSync(join(ziel, 'rollen')).isSymbolicLink(), 'rollen ist kein Verweis')
		assert.ok(!existsSync(join(heim, 'patches')), 'es wurde ein Ordner ~/.dsh/patches angelegt')
		assert.equal(readdirSync(join(ziel, 'patches')).length, 23)
		assert.equal(readdirSync(join(ziel, 'rollen')).length, ROLLEN.length)
		assert.ok(readFileSync(join(ziel, 'patches', 'delegate-send.mjs')).equals(readFileSync(join(PATCHES, 'delegate-send.mjs'))))

		// Der Rueckweg ersetzt die Verweise durch byte-gleiche Kopien.
		const zurueck = spawnSync(process.execPath, [join(PAKET, 'scripts', 'link-dsh.mjs'), '--revert', `--dsh-home=${heim}`], { encoding: 'utf8' })
		assert.equal(zurueck.status, 0, `${zurueck.stdout}${zurueck.stderr}`)
		assert.ok(!lstatSync(join(ziel, 'patches')).isSymbolicLink(), 'patches ist nach --revert noch ein Verweis')
		assert.ok(readFileSync(join(ziel, 'patches', 'delegate-send.mjs')).equals(readFileSync(join(PATCHES, 'delegate-send.mjs'))))
	} finally {
		rmSync(heim, { recursive: true, force: true })
	}
})

test('der Anweisungstext traegt den neuen Namen und keinen alten', () => {
	const text = readFileSync(join(PAKET, 'agents', 'teams-plus-agents.md'), 'utf8')
	assert.ok(text.startsWith('## Teams Plus: Namen und Aufträge (dsh-teams-plus)'), 'Titelzeile ist nicht umgestellt')
	assert.ok(!/projectOS|Projekt-Manager/u.test(text), 'der Text nennt noch dsh-projectOS oder Projekt-Manager')
	assert.ok(text.includes('tmielsch/dsh-teams-plus'), 'der Repo-Name fehlt')
	assert.ok(text.includes('Wo frühere Anweisungen regeln'), 'der Vorrang-Satz fehlt')
})
