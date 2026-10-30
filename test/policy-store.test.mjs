/**
 * policy-store.test.mjs — die Ablage unter ~/.dsh/.tm/teams-plus.
 *
 * Der Test belegt sieben Dinge:
 *   1. ein fehlender Ordnerbaum wird angelegt, ohne Absturz (auch verschachtelt),
 *   2. die mitgelieferte Startdatei entsteht nur, wenn der policies-Ordner leer ist,
 *   3. Schreiben ist atomar: danach liegt keine temporaere Datei mehr herum,
 *   4. eine kaputte Datei wird gemeldet und NICHT ueberschrieben,
 *   5. Loeschen raeumt die Aktivierungen in allen workspaces-Dateien auf,
 *   6. die workspaces-Datei hat genau die Form {"enabled":["id1","id2"]},
 *   7. resolveTags findet nach Tag, ohne Ruecksicht auf Gross und Klein.
 *
 * Jeder Fall laeuft in einem eigenen temporaeren Ordner: das echte ~/.dsh bleibt unberuehrt.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStore, datenOrdner, startOrdner, workspaceNameOk } from '../src/policy/store.ts'
import { bauen, zerlegen } from '../src/policy/schema.ts'

const PAKET = join(dirname(fileURLToPath(import.meta.url)), '..')
const START = join(PAKET, 'policies')

/** Ein Store in einem frischen temporaeren Ordner; der Aufrufer raeumt ihn ab. */
function werkstatt() {
	const root = mkdtempSync(join(tmpdir(), 'teams-plus-store-'))
	return { root, store: createStore({ root, seed: START }) }
}

const policy = (id, title, extra = {}) => ({ id, title, tags: [], order: 0, body: `${title} Text.`, ...extra })

test('datenOrdner und startOrdner zeigen auf die vereinbarten Orte', () => {
	assert.equal(datenOrdner('/Users/t'), join('/Users/t', '.dsh', '.tm', 'teams-plus'))
	assert.equal(startOrdner(), START)
	assert.ok(existsSync(join(START, 'lokalmodus.md')), 'die mitgelieferte Startdatei fehlt im Paket')
})

test('ein fehlender Ordnerbaum wird angelegt, ohne Absturz — auch verschachtelt', () => {
	const root = mkdtempSync(join(tmpdir(), 'teams-plus-neu-'))
	const tief = join(root, 'gibt', 'es', 'noch', 'nicht', 'teams-plus')
	try {
		const store = createStore({ root: tief, seed: START })
		// Lesen vor dem Anlegen darf nicht werfen: kein Ordner heisst "nichts da".
		assert.deepEqual(store.listen(), { policies: [], broken: [] })
		assert.deepEqual(store.aktiviert('ws_10'), { ids: [], broken: null })
		store.ensure()
		for (const ordner of ['policies', 'workspaces', 'logs']) {
			assert.ok(existsSync(join(tief, ordner)), `${ordner} wurde nicht angelegt`)
		}
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test('die Startdatei entsteht nur, wenn der policies-Ordner leer ist', () => {
	const { root, store } = werkstatt()
	try {
		store.ensure()
		assert.equal(store.seedWennLeer(), 'lokalmodus')
		const datei = join(store.policiesDir, 'lokalmodus.md')
		assert.ok(existsSync(datei))
		const gelesen = zerlegen(readFileSync(datei, 'utf8'))
		assert.equal(gelesen.ok, true)
		assert.equal(gelesen.policy.title, 'Lokalmodus')
		assert.ok(gelesen.policy.body.includes('rein sequentiell'))
		// Kanonische Form: die ausgelieferte Datei ist genau das, was bauen erzeugen wuerde.
		assert.equal(readFileSync(datei, 'utf8'), bauen(gelesen.policy))

		// Ein zweiter Lauf legt nichts mehr an und ueberschreibt nichts.
		const vorher = readFileSync(datei, 'utf8')
		assert.equal(store.seedWennLeer(), null)
		assert.equal(readFileSync(datei, 'utf8'), vorher)

		// Eine eigene Datei im Ordner verhindert das Seeding ebenfalls.
		rmSync(join(store.policiesDir, 'lokalmodus.md'))
		writeFileSync(join(store.policiesDir, 'eigen.md'), bauen(policy('eigen', 'Eigen')))
		assert.equal(store.seedWennLeer(), null)
		assert.equal(readdirSync(store.policiesDir).length, 1)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test('speichern legt an und aendert: atomar, kanonisch, mit Pfad-sicherer Id', () => {
	const { root, store } = werkstatt()
	try {
		const neu = store.speichern({ title: '  Ruhe  ', body: '  Ein Text.  ', tags: ['a', ' a ', 'b'] })
		assert.equal(neu.ok, true, neu.ok ? '' : neu.message)
		assert.match(neu.policy.id, /^p[0-9a-f]{16}$/)
		assert.equal(neu.policy.title, 'Ruhe')
		assert.equal(neu.policy.body, 'Ein Text.')
		assert.deepEqual(neu.policy.tags, ['a', 'b'])
		assert.equal(neu.policy.order, 0, 'die erste Policy in einer leeren Bibliothek bekommt order 0')

		const zweite = store.speichern({ title: 'Zweite', body: 'B' })
		assert.equal(zweite.ok, true)
		assert.equal(zweite.policy.order, 1, 'die naechste Policy rueckt eine Stelle weiter')

		const datei = join(store.policiesDir, `${neu.policy.id}.md`)
		assert.equal(readFileSync(datei, 'utf8'), bauen(neu.policy))
		// Keine temporaere Datei liegt mehr herum.
		assert.deepEqual(readdirSync(store.policiesDir).filter((name) => name.includes('.tmp-')), [])

		const geaendert = store.speichern({ id: neu.policy.id, title: 'Ruhiger', body: 'Neuer Text.', tags: [] })
		assert.equal(geaendert.ok, true, geaendert.ok ? '' : geaendert.message)
		assert.equal(geaendert.policy.title, 'Ruhiger')
		assert.equal(geaendert.policy.order, neu.policy.order, 'order bleibt beim Aendern stehen')
		assert.equal(readFileSync(datei, 'utf8'), bauen(geaendert.policy))

		// Eine leere description entfernt das Feld, eine fehlende laesst es stehen.
		const mitText = store.speichern({ id: neu.policy.id, title: 'Ruhiger', body: 'Neuer Text.', description: 'Ein Satz.' })
		assert.equal(mitText.ok, true)
		assert.equal(mitText.policy.description, 'Ein Satz.')
		const ohneText = store.speichern({ id: neu.policy.id, title: 'Ruhiger', body: 'Neuer Text.', description: '  ' })
		assert.equal(ohneText.ok, true)
		assert.equal(ohneText.policy.description, undefined)
		assert.ok(!readFileSync(datei, 'utf8').includes('description:'))

		// Pflichtfelder und unbekannte Id werden abgelehnt.
		assert.equal(store.speichern({ title: '', body: 'x' }).ok, false)
		assert.equal(store.speichern({ title: 'x', body: '   ' }).ok, false)
		const unbekannt = store.speichern({ id: 'gibtsnicht', title: 'x', body: 'y' })
		assert.equal(unbekannt.ok, false)
		assert.ok(unbekannt.message.includes('unbekannte Policy'))
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test('eine kaputte Datei wird gemeldet und nicht ueberschrieben', () => {
	const { root, store } = werkstatt()
	try {
		store.ensure()
		const kaputt = join(store.policiesDir, 'kaputt.md')
		const inhalt = 'id: kaputt\ntitle: ohne Kopfblock\n\nText\n'
		writeFileSync(kaputt, inhalt)

		const gelesen = store.listen()
		assert.deepEqual(gelesen.policies, [])
		assert.equal(gelesen.broken.length, 1)
		assert.equal(gelesen.broken[0].file, 'kaputt.md')
		assert.ok(gelesen.broken[0].errors.length > 0)

		const versuch = store.speichern({ id: 'kaputt', title: 'Neu', body: 'Neu' })
		assert.equal(versuch.ok, false)
		assert.ok(versuch.message.includes('kaputt'), versuch.message)
		assert.equal(readFileSync(kaputt, 'utf8'), inhalt, 'die kaputte Datei wurde angefasst')

		// Auch eine abweichende id im Kopfblock ist ein Fehler (die Id muss zum Dateinamen passen).
		writeFileSync(join(store.policiesDir, 'falsch.md'), bauen(policy('andere', 'Andere')))
		const gemeldet = store.listen().broken.map((eintrag) => eintrag.file)
		assert.deepEqual(gemeldet.sort(), ['falsch.md', 'kaputt.md'])
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test('schalten schreibt die Form {"enabled":[...]} und meldet unbekannte Policies', () => {
	const { root, store } = werkstatt()
	try {
		store.ensure()
		const a = store.speichern({ title: 'A', body: 'A' })
		const b = store.speichern({ title: 'B', body: 'B' })
		assert.equal(a.ok && b.ok, true)

		assert.deepEqual(store.schalten('ws_10', a.policy.id, true), { ok: true, enabled: true })
		const datei = join(store.workspacesDir, 'ws_10.json')
		assert.equal(readFileSync(datei, 'utf8'), `${JSON.stringify({ enabled: [a.policy.id] }, null, 2)}\n`)

		assert.equal(store.schalten('ws_10', b.policy.id, true).ok, true)
		assert.deepEqual(store.aktiviert('ws_10').ids, [a.policy.id, b.policy.id])

		// Ausschalten entfernt den Eintrag, statt false zu speichern.
		assert.equal(store.schalten('ws_10', a.policy.id, false).ok, true)
		assert.deepEqual(JSON.parse(readFileSync(datei, 'utf8')), { enabled: [b.policy.id] })

		// Unbekannte Policy, ungueltige Ids: abgelehnt, keine Datei ausserhalb des Ordners.
		assert.equal(store.schalten('ws_10', 'gibtsnicht', true).ok, false)
		assert.equal(store.schalten('../ausserhalb', a.policy.id, true).ok, false)
		assert.equal(store.schalten('ws_10', '../x', true).ok, false)
		assert.ok(!existsSync(join(root, 'ausserhalb.json')))

		// Eine kaputte workspaces-Datei wird nicht ueberschrieben.
		const kaputt = join(store.workspacesDir, 'ws_kaputt.json')
		writeFileSync(kaputt, '{ "enabled": [ ')
		assert.equal(store.schalten('ws_kaputt', a.policy.id, true).ok, false)
		assert.equal(readFileSync(kaputt, 'utf8'), '{ "enabled": [ ')
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test('Loeschen raeumt die Aktivierungen in allen workspaces-Dateien auf', () => {
	const { root, store } = werkstatt()
	try {
		store.ensure()
		const a = store.speichern({ title: 'A', body: 'A' })
		const b = store.speichern({ title: 'B', body: 'B' })
		writeFileSync(join(store.workspacesDir, 'ws_10.json'), JSON.stringify({ enabled: [a.policy.id, b.policy.id] }))
		writeFileSync(join(store.workspacesDir, 'ws_11.json'), JSON.stringify({ enabled: [a.policy.id] }))
		// Eine kaputte Datei bleibt liegen und wird nur gemeldet.
		const kaputt = join(store.workspacesDir, 'ws_12.json')
		writeFileSync(kaputt, 'kein json')

		const geloescht = store.loeschen(a.policy.id)
		assert.equal(geloescht.ok, true, geloescht.ok ? '' : geloescht.message)
		assert.deepEqual(geloescht.aufgeraeumt.sort(), ['ws_10', 'ws_11'])
		assert.ok(!existsSync(join(store.policiesDir, `${a.policy.id}.md`)))
		assert.deepEqual(JSON.parse(readFileSync(join(store.workspacesDir, 'ws_10.json'), 'utf8')), { enabled: [b.policy.id] })
		assert.deepEqual(JSON.parse(readFileSync(join(store.workspacesDir, 'ws_11.json'), 'utf8')), { enabled: [] })
		assert.equal(readFileSync(kaputt, 'utf8'), 'kein json')

		// Ein zweiter Versuch meldet die unbekannte Policy, statt zu werfen.
		const zweite = store.loeschen(a.policy.id)
		assert.equal(zweite.ok, false)
		assert.ok(zweite.message.includes('unbekannte Policy'))
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test('fuerWorkspace traegt den Schalter, unbekannte Workspaces sind alle aus', () => {
	const { root, store } = werkstatt()
	try {
		store.ensure()
		const a = store.speichern({ title: 'A', body: 'A' })
		const b = store.speichern({ title: 'B', body: 'B' })
		store.schalten('ws_10', b.policy.id, true)

		const ws = store.fuerWorkspace('ws_10')
		assert.deepEqual(ws.broken, [])
		assert.deepEqual(ws.policies.map((eintrag) => [eintrag.title, eintrag.enabled]), [['A', false], ['B', true]])

		const leer = store.fuerWorkspace('ws_99')
		assert.deepEqual(leer.policies.map((eintrag) => eintrag.enabled), [false, false])
		assert.deepEqual(store.aktiviert('ws_99'), { ids: [], broken: null })
		assert.ok(workspaceNameOk('ws_10'))
		assert.ok(!workspaceNameOk('ws/10'))
		assert.ok(!workspaceNameOk(''))
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test('resolveTags findet nach Tag, ohne Ruecksicht auf Gross und Klein', () => {
	const { root, store } = werkstatt()
	try {
		store.ensure()
		store.speichern({ title: 'Team', body: 'T', tags: ['team', 'sequenziell'] })
		store.speichern({ title: 'Haus', body: 'H', tags: ['haus'] })
		assert.deepEqual(store.nachTags(['sequenziell']).map((eintrag) => eintrag.title), ['Team'])
		assert.deepEqual(store.nachTags(['SEQUENZIELL']).map((eintrag) => eintrag.title), ['Team'])
		assert.deepEqual(store.nachTags(['team', 'haus']).map((eintrag) => eintrag.title), ['Team', 'Haus'], 'Bibliotheksreihenfolge: Team hat order 0, Haus order 1')
		assert.deepEqual(store.nachTags(['gibtsnicht']), [])
		assert.deepEqual(store.nachTags([]), [])
		assert.deepEqual(store.nachTags([' team ']).map((eintrag) => eintrag.title), ['Team'])
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test('protokollieren schreibt eine Zeile nach logs/host.log und wirft nie', () => {
	const { root, store } = werkstatt()
	try {
		store.ensure()
		store.protokollieren('erste Meldung')
		const inhalt = readFileSync(join(store.logsDir, 'host.log'), 'utf8')
		assert.match(inhalt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z erste Meldung\n$/)
		// Auch ohne Ordner darf das Protokoll nichts verhindern.
		rmSync(join(store.logsDir, 'host.log'))
		mkdirSync(join(store.logsDir, 'blockiert'))
		assert.doesNotThrow(() => store.protokollieren('trotzdem'))
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})
