/**
 * bundle.test.mjs — das Paket ist baubar und ladbar.
 *
 * Der Test beweist ohne laufendes DSH, dass die beiden Ausgaben entstehen und dass der Host-Teil
 * wirklich geladen werden kann:
 *   1. der Build laeuft als Kindprozess durch und schreibt lib/index.js und lib/client.js,
 *   2. ein zweiter Lauf schreibt byte-gleiche Dateien (idempotent),
 *   3. lib/index.js laesst sich mit import() laden und exportiert `apply` als Funktion und `inject`
 *      als Liste der Dienste, die der Host braucht,
 *   4. das gebaute Host-Buendel importiert nur `node:*` und `@deepseek-ai/*` — alles andere, auch
 *      die lokalen .ts-Module und zod, ist aufgeloest beziehungsweise eingebunden,
 *   5. das gebaute Host-Buendel LAEUFT: `apply` meldet den Dienst `teamsPlus` an,
 *   6. lib/client.js beginnt mit dem `window.__ModuleLoader__.load`-Kopf, ohne den der Browser das
 *      Buendel nicht laedt,
 *   7. cordis.patch.yml nennt das Paket selbst (id `teams-plus`, zuerst) und danach die fuenf
 *      Patch-Module,
 *   8. beide Dateien aus `exports` existieren, `files` nimmt `lib` mit, und ein Haken erzwingt den
 *      Build vor dem Packen; `npm pack --dry-run` listet beide Dateien,
 *   9. die mitgelieferte Startdatei wird auch aus dem GEBAUTEN Paket gefunden (der Buendelpfad ist
 *      eine Ebene flacher als der Quellpfad).
 *
 * Kein Netz, kein Schreiben ausserhalb von lib/ und einem temporaeren Ordner.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PAKET = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIB = join(PAKET, 'lib')
const HOST = join(LIB, 'index.js')
const CLIENT = join(LIB, 'client.js')
const BUILD = join(PAKET, 'scripts', 'build-client.mjs')

const baue = () => spawnSync(process.execPath, [BUILD], { encoding: 'utf8' })

// Einmal bauen, damit die Pruefungen unten etwas vorfinden; jede weitere Pruefung baut bei Bedarf
// selbst. lib/ ist gitignoriert, ein frischer Klon hat es also nicht.
const ersterLauf = baue()

/** Groesse einer Datei, oder -1 wenn sie fehlt. */
const groesse = (pfad) => { try { return statSync(pfad).size } catch { return -1 } }

test('der Build laeuft durch und schreibt lib/index.js und lib/client.js', () => {
	assert.equal(ersterLauf.status, 0, `Build endet mit ${ersterLauf.status}: ${ersterLauf.stdout}${ersterLauf.stderr}`)
	assert.ok(existsSync(BUILD), 'scripts/build-client.mjs fehlt')
	assert.ok(groesse(HOST) > 1000, `lib/index.js ist zu klein (${groesse(HOST)} Bytes)`)
	assert.ok(groesse(CLIENT) > 100000, `lib/client.js ist zu klein (${groesse(CLIENT)} Bytes)`)
	// Der Build meldet beide Ausgaben mit ihrer Groesse.
	assert.match(ersterLauf.stdout, /lib\/client\.js \(\d+ Bytes\)/u)
	assert.match(ersterLauf.stdout, /lib\/index\.js \(\d+ Bytes\)/u)
})

test('der Build ist idempotent: ein zweiter Lauf schreibt byte-gleiche Dateien', () => {
	const hostVorher = readFileSync(HOST)
	const clientVorher = readFileSync(CLIENT)
	const zweiter = baue()
	assert.equal(zweiter.status, 0, `${zweiter.stdout}${zweiter.stderr}`)
	assert.ok(readFileSync(HOST).equals(hostVorher), 'lib/index.js aendert sich beim zweiten Lauf')
	assert.ok(readFileSync(CLIENT).equals(clientVorher), 'lib/client.js aendert sich beim zweiten Lauf')
})

test('lib/index.js laesst sich laden und exportiert apply und inject', async () => {
	const modul = await import(pathToFileURL(HOST).href)
	assert.equal(typeof modul.apply, 'function', 'apply fehlt im gebauten Host')
	assert.ok(Array.isArray(modul.inject), 'inject ist keine Liste')
	assert.ok(modul.inject.includes('systemPrompt'), `inject nennt systemPrompt nicht: ${modul.inject}`)
	assert.ok(modul.inject.includes('agents'), `inject nennt agents nicht: ${modul.inject}`)
	assert.ok(modul.inject.includes('workspaceRegistry'), `inject nennt workspaceRegistry nicht: ${modul.inject}`)
	assert.equal(modul.name, 'teams-plus')
	// Der Vertrag steht auch im Buendel: sechs Methoden mit Marker.
	assert.deepEqual(modul.METHODEN, ['listPolicies', 'listForWorkspace', 'savePolicy', 'deletePolicy', 'setEnabled', 'resolveTags'])
	const marker = Object.getOwnPropertyDescriptor(modul.TeamsPlusController.prototype, '@deepseek-ai/dsh-typert-protocol/remote-methods')
	assert.equal(marker.value.methods.length, 6)
})

test('das gebaute Host-Buendel importiert nur node:* und @deepseek-ai/*', () => {
	const text = readFileSync(HOST, 'utf8')
	const ziele = [...text.matchAll(/^\s*import[^'"]*from\s+["']([^"']+)["']/gmu)].map((treffer) => treffer[1])
	assert.ok(ziele.length > 0, 'keine Importe gefunden — die Pruefung laeuft ins Leere')
	for (const ziel of ziele) {
		assert.ok(
			ziel.startsWith('node:') || ziel.startsWith('@deepseek-ai/'),
			`unerlaubter Import "${ziel}": nur node:* und @deepseek-ai/* duerfen offen bleiben`,
		)
	}
	// Der .ts-Import des Quellbaums ist aufgeloest, nicht stehen geblieben.
	assert.ok(!/from\s+["'][^"']*\.ts["']/u.test(text), 'im Buendel steht noch ein .ts-Import')
	assert.ok(!/^\s*import[^'"]*from\s+["']zod["']/mu.test(text), 'zod ist nicht eingebunden')
})

test('das gebaute Host-Buendel laeuft: apply meldet den Dienst teamsPlus an', async () => {
	const modul = await import(pathToFileURL(HOST).href)
	const root = mkdtempSync(join(tmpdir(), 'teams-plus-bundle-'))
	const vorher = process.env.TEAMS_PLUS_DATA_DIR
	const calls = { provided: [], contexts: [], warns: [] }
	try {
		process.env.TEAMS_PLUS_DATA_DIR = root
		const ctx = {
			reflect: { provide: () => {} },
			provide: (name, value) => { calls.provided.push([name, value]); return () => {} },
			effect: (execute) => execute(),
			logger: () => ({ warn: (meldung) => calls.warns.push(meldung) }),
			get: (key) => {
				if (key === 'systemPrompt') return { context: (kontext) => { calls.contexts.push(kontext); return () => {} } }
				if (key === 'agents') return { currentInitiator: () => ({ session: { header: { cwd: '/Users/t/proj' } } }) }
				if (key === 'workspaceRegistry') return { list: () => [{ id: 'ws_10', path: '/Users/t/proj' }] }
				return undefined
			},
		}
		await modul.apply(ctx)
		assert.deepEqual(calls.warns, [], `das Buendel meldet Probleme: ${calls.warns.join(' | ')}`)
		assert.equal(calls.provided.length, 1, 'der Dienst wurde nicht angemeldet')
		assert.equal(calls.provided[0][0], 'teamsPlus')
		assert.equal(calls.contexts.length, 1, 'die Prompt-Injektion wurde nicht angemeldet')
		assert.equal(calls.contexts[0].order, 130)
		// Die Startdatei ist angelegt und wird im Prompt sichtbar, sobald sie aktiviert ist.
		assert.ok(existsSync(join(root, 'policies', 'lokalmodus.md')), 'die Startdatei wurde aus dem Buendel heraus nicht gefunden')
		await calls.provided[0][1].setEnabled({ workspaceId: 'ws_10', policyId: 'lokalmodus', enabled: true })
		assert.ok(calls.contexts[0].text().startsWith('# Workspace Policy (Lokalmodus)'))
	} finally {
		if (vorher === undefined) delete process.env.TEAMS_PLUS_DATA_DIR
		else process.env.TEAMS_PLUS_DATA_DIR = vorher
		rmSync(root, { recursive: true, force: true })
	}
})

test('lib/client.js traegt den Lader-Kopf mit Paketnamen und factory', () => {
	const text = readFileSync(CLIENT, 'utf8')
	assert.ok(text.startsWith('window.__ModuleLoader__.load({'), `der Kopf fehlt: ${text.slice(0, 80)}`)
	assert.ok(text.includes('id: "@tmielsch/dsh-teams-plus"'), 'der Paketname steht nicht im Kopf')
	assert.ok(text.includes('factory: (require) =>'), 'die factory fehlt im Kopf')
	assert.ok(text.includes('return module.exports;'), 'das Ende der factory fehlt')
	// react bleibt external und wird von der Seite hereingereicht.
	assert.ok(text.includes('require("react")'), 'react wird nicht als external hereingereicht')
	// Die Ansicht ist mitgebaut.
	assert.ok(text.includes('tp-switch'), 'das Stylesheet der Ansicht fehlt im Buendel')
	// Der Wire-Beschreiber: die Kennung entsteht zur Laufzeit aus `${PKG}#teamsPlus/<methode>`,
	// im Text stehen deshalb nur die Bausteine und die Methodennamen.
	assert.ok(text.includes('#teamsPlus/'), 'der Wire-Beschreiber fehlt im Buendel')
	for (const methode of ['listPolicies', 'listForWorkspace', 'savePolicy', 'deletePolicy', 'setEnabled', 'resolveTags']) {
		assert.ok(text.includes(`"${methode}"`), `die Methode ${methode} fehlt im Wire-Beschreiber des Buendels`)
	}
})

test('cordis.patch.yml nennt das Paket selbst zuerst und danach die fuenf Patch-Module', () => {
	const yml = readFileSync(join(PAKET, 'cordis.patch.yml'), 'utf8')
	const eintraege = [...yml.matchAll(/-\s*id:\s*([\w.-]+)/gu)].map((treffer) => treffer[1])
	assert.equal(eintraege[0], 'teams-plus', `der Paket-Eintrag steht nicht zuerst: ${eintraege.join(', ')}`)
	assert.ok(yml.includes("name: '@tmielsch/dsh-teams-plus'"), 'der Paketname fehlt im cordis-Eintrag')
	const patches = eintraege.slice(1)
	assert.deepEqual(patches, ['delegate-send', 'teammate-modell', 'goal-await', 'stille-nachrichten', 'rolle-titel'])
	for (const name of ['delegate-send', 'teammate-model', 'goal-await', 'stille-nachrichten', 'rolle-titel']) {
		assert.ok(yml.includes(`@tmielsch/dsh-teams-plus/patches/${name}.mjs`), `patches/${name}.mjs fehlt in cordis.patch.yml`)
	}
})

test('exports, files und ein Haken fuer den Build passen zusammen', () => {
	const pkg = JSON.parse(readFileSync(join(PAKET, 'package.json'), 'utf8'))
	assert.equal(pkg.exports['.'].default, './lib/index.js')
	assert.equal(pkg.exports['./client'].default, './lib/client.js')
	// Die beiden Dateien, auf die exports zeigt, entstehen wirklich.
	assert.ok(existsSync(join(PAKET, pkg.exports['.'].default)), 'die Datei aus exports["." ] fehlt')
	assert.ok(existsSync(join(PAKET, pkg.exports['./client'].default)), 'die Datei aus exports["./client"] fehlt')
	assert.ok(pkg.files.includes('lib'), '"files" nimmt lib nicht mit')
	assert.equal(pkg.scripts.build, 'node scripts/build-client.mjs')
	// Vor dem Packen wird gebaut: prepack (npm pack/publish) oder prepublishOnly.
	const erzwingt = pkg.scripts.prepack ?? pkg.scripts.prepublishOnly
	assert.equal(erzwingt, 'node scripts/build-client.mjs', 'kein Haken erzwingt den Build vor dem Packen')
})

test('npm pack --dry-run listet lib/index.js und lib/client.js', () => {
	// Der Haken prepack baut dabei neu; die Ausgabe nennt jede Datei mit ihrer Groesse.
	const lauf = spawnSync('npm', ['pack', '--dry-run'], { encoding: 'utf8', cwd: PAKET, timeout: 120000 })
	const ausgabe = `${lauf.stdout}${lauf.stderr}`
	assert.equal(lauf.status, 0, `npm pack endet mit ${lauf.status}:\n${ausgabe}`)
	assert.match(ausgabe, /lib\/index\.js/u, 'lib/index.js fehlt im Paket')
	assert.match(ausgabe, /lib\/client\.js/u, 'lib/client.js fehlt im Paket')
	assert.match(ausgabe, /policies\/lokalmodus\.md/u, 'die Startdatei fehlt im Paket')
	assert.ok(!existsSync(join(PAKET, 'tmielsch-dsh-teams-plus-0.1.0.tgz')), 'npm pack --dry-run hat ein Tarball geschrieben')
})

test('die Startdatei wird auch aus dem gebauten Paket gefunden', async () => {
	// Die Lage des Buendels ist eine Ebene flacher als der Quellpfad: lib/index.js gegen
	// src/policy/store.ts. Beide muessen auf <paket>/policies zeigen.
	const { startOrdner } = await import(pathToFileURL(join(PAKET, 'src', 'policy', 'store.ts')).href)
	const ausQuelle = startOrdner(join(PAKET, 'src', 'policy', 'store.ts'))
	const ausBuendel = startOrdner(HOST)
	assert.equal(ausQuelle, join(PAKET, 'policies'))
	assert.equal(ausBuendel, join(PAKET, 'policies'), `aus dem Buendel zeigt der Startordner nach ${ausBuendel}`)
	assert.ok(existsSync(join(ausBuendel, 'lokalmodus.md')))
})
