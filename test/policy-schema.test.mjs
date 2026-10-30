/**
 * policy-schema.test.mjs — das Dateiformat einer Policy.
 *
 * Der Test belegt sechs Dinge:
 *   1. zerlegen und bauen sind verlustfrei: die mitgelieferte Startdatei geht unveraendert rein
 *      und raus, und ein zweiter Durchlauf aendert nichts mehr,
 *   2. fehlende Pflichtfelder und unbekannte Schluessel werden abgelehnt, nie stillschweigend
 *      fallen gelassen,
 *   3. tags ist eine freie Liste in eckigen Klammern, leer erlaubt,
 *   4. order ist eine Ganzzahl mit Standard 0, description ist optional,
 *   5. der Body bleibt in seiner inneren Form erhalten (Leerzeilen, Einrueckung),
 *   6. die Bibliotheksreihenfolge ist order, dann Titel in Code-Unit-Reihenfolge.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ID_MUSTER, bauen, normalisiereTags, pruefen, sortierePolicies, zerlegen,
} from '../src/policy/schema.ts'

const PAKET = join(dirname(fileURLToPath(import.meta.url)), '..')
const STARTDATEI = join(PAKET, 'policies', 'lokalmodus.md')

const beispiel = () => ({
  id: 'lokalmodus',
  title: 'Lokalmodus',
  tags: ['team', 'sequenziell'],
  order: 0,
  description: 'Ein Team arbeitet rein sequentiell, der Lead cosplayt die Rollen selbst.',
  body: 'Erste Zeile.\nZweite Zeile.',
})

/** Ein Text mit Kopfblock und Body, wie ihn der Mensch von Hand schreiben wuerde. */
const text = (kopf, body) => `${['---', ...kopf, '---', '', body].join('\n')}\n`

test('zerlegen und bauen sind verlustfrei fuer die mitgelieferte Startdatei', () => {
	const original = readFileSync(STARTDATEI, 'utf8')
	const gelesen = zerlegen(original)
	assert.equal(gelesen.ok, true, gelesen.ok ? '' : gelesen.errors.join('; '))
	assert.equal(gelesen.policy.id, 'lokalmodus')
	assert.equal(gelesen.policy.title, 'Lokalmodus')
	assert.deepEqual(gelesen.policy.tags, ['team', 'sequenziell'])
	assert.equal(gelesen.policy.order, 0)
	assert.ok(gelesen.policy.description.includes('cosplayt'))
	assert.ok(gelesen.policy.body.startsWith('Lokalmodus: dieses Team arbeitet rein sequentiell.'))
	assert.ok(gelesen.policy.body.includes('EINE Compaction'))

	// Gleicher Text rein und raus.
	assert.equal(bauen(gelesen.policy), original)
	// Und ein zweiter Durchlauf aendert nichts mehr.
	const wieder = zerlegen(bauen(gelesen.policy))
	assert.equal(wieder.ok, true)
	assert.equal(bauen(wieder.policy), original)
})

test('ein Text ohne description, mit leerer Tag-Liste und order 0 geht unveraendert zurueck', () => {
	const eingabe = text(['id: leer', 'title: Leer', 'tags: []', 'order: 0'], 'Ein Text.')
	const gelesen = zerlegen(eingabe)
	assert.equal(gelesen.ok, true, gelesen.ok ? '' : gelesen.errors.join('; '))
	assert.deepEqual(gelesen.policy, { id: 'leer', title: 'Leer', tags: [], order: 0, body: 'Ein Text.' })
	assert.equal(bauen(gelesen.policy), eingabe)
})

test('fehlende Pflichtfelder werden abgelehnt', () => {
	const ohneId = zerlegen(text(['title: Nur Titel'], 'Text'))
	assert.equal(ohneId.ok, false)
	assert.ok(ohneId.errors.some((fehler) => fehler.includes('id fehlt')), ohneId.errors.join('; '))

	const ohneTitel = zerlegen(text(['id: x'], 'Text'))
	assert.equal(ohneTitel.ok, false)
	assert.ok(ohneTitel.errors.some((fehler) => fehler.includes('title fehlt')))

	const ohneBody = zerlegen(text(['id: x', 'title: X'], ''))
	assert.equal(ohneBody.ok, false)
	assert.ok(ohneBody.errors.some((fehler) => fehler.includes('body fehlt')), ohneBody.errors.join('; '))

	const leer = zerlegen('')
	assert.equal(leer.ok, false)
	assert.ok(leer.errors.some((fehler) => fehler.includes('leer')))
})

test('eine ungueltige id wird abgelehnt: nur [a-zA-Z0-9_-] ist ein Pfad-Baustein', () => {
	for (const id of ['a b', 'a/b', 'a.b', '../x', 'ä']) {
		const gelesen = zerlegen(text([`id: ${id}`, 'title: T'], 'Text'))
		assert.equal(gelesen.ok, false, `id "${id}" haette abgelehnt werden muessen`)
	}
	assert.ok(ID_MUSTER.test('p0123456789abcdef'))
	assert.ok(ID_MUSTER.test('ws_10'))
})

test('unbekannte Schluessel im Kopfblock werden abgelehnt, nicht stillschweigend verworfen', () => {
	const gelesen = zerlegen(text(['id: x', 'title: X', 'category: Haus'], 'Text'))
	assert.equal(gelesen.ok, false)
	assert.ok(gelesen.errors.some((fehler) => fehler.includes('unbekannter Schluessel "category"')), gelesen.errors.join('; '))
})

test('Kopfblock ohne Doppelpunkt, doppelter Schluessel und offener Kopfblock werden gemeldet', () => {
	const ohneDoppelpunkt = zerlegen(text(['id: x', 'title: X', 'kaputt'], 'Text'))
	assert.equal(ohneDoppelpunkt.ok, false)
	assert.ok(ohneDoppelpunkt.errors.some((fehler) => fehler.includes('ohne Doppelpunkt')))

	const doppelt = zerlegen(text(['id: x', 'id: y', 'title: X'], 'Text'))
	assert.equal(doppelt.ok, false)
	assert.ok(doppelt.errors.some((fehler) => fehler.includes('zweimal')))

	const offen = zerlegen('---\nid: x\ntitle: X\n\nText\n')
	assert.equal(offen.ok, false)
	assert.ok(offen.errors.some((fehler) => fehler.includes('nicht')))

	const keinTrenner = zerlegen('id: x\ntitle: X\n\nText\n')
	assert.equal(keinTrenner.ok, false)
	assert.ok(keinTrenner.errors.some((fehler) => fehler.includes('erste Zeile')))
})

test('tags: freie Liste in eckigen Klammern, leer erlaubt, ohne Klammern ein Fehler', () => {
	assert.deepEqual(zerlegen(text(['id: x', 'title: X', 'tags: [a, b, c]'], 'T')).policy.tags, ['a', 'b', 'c'])
	assert.deepEqual(zerlegen(text(['id: x', 'title: X', 'tags: []'], 'T')).policy.tags, [])
	assert.deepEqual(zerlegen(text(['id: x', 'title: X', 'tags: [a, a,  b ]'], 'T')).policy.tags, ['a', 'b'])

	const ohneKlammern = zerlegen(text(['id: x', 'title: X', 'tags: a, b'], 'T'))
	assert.equal(ohneKlammern.ok, false)
	assert.ok(ohneKlammern.errors.some((fehler) => fehler.includes('eckigen Klammern')))

	const tagname = zerlegen(text(['id: x', 'title: X', 'tags: ["Ganz genau"]'], 'T'))
	assert.deepEqual(tagname.policy.tags, ['Ganz genau'])
})

test('order: Ganzzahl mit Standard 0, Text ist ein Fehler', () => {
	assert.equal(zerlegen(text(['id: x', 'title: X'], 'T')).policy.order, 0)
	assert.equal(zerlegen(text(['id: x', 'title: X', 'order: 7'], 'T')).policy.order, 7)
	assert.equal(zerlegen(text(['id: x', 'title: X', 'order: -2'], 'T')).policy.order, -2)
	const krumm = zerlegen(text(['id: x', 'title: X', 'order: sieben'], 'T'))
	assert.equal(krumm.ok, false)
	assert.ok(krumm.errors.some((fehler) => fehler.includes('Ganzzahl')))
})

test('Anfuehrungszeichen im Titel sind Text und gehen unveraendert zurueck', () => {
	const eingabe = text(['id: x', 'title: "Zitat"', 'tags: []', 'order: 0'], 'T')
	const gelesen = zerlegen(eingabe)
	assert.equal(gelesen.ok, true)
	assert.equal(gelesen.policy.title, '"Zitat"')
	assert.equal(bauen(gelesen.policy), eingabe)
})

test('ein Tag mit Komma oder eckigen Klammern wird abgelehnt, weil die Liste sonst zerbricht', () => {
	for (const tag of ['mit, Komma', 'mit [Klammer', 'mit] Klammer']) {
		assert.ok(pruefen({ id: 'x', title: 'X', tags: [tag], order: 0, body: 'T' }).length > 0, `Tag "${tag}" haette abgelehnt werden muessen`)
	}
})

test('description ist optional und einzeilig', () => {
	assert.equal(zerlegen(text(['id: x', 'title: X'], 'T')).policy.description, undefined)
	const einsatz = zerlegen(text(['id: x', 'title: X', 'description: Ein Satz mit: Doppelpunkt.'], 'T'))
	assert.equal(einsatz.policy.description, 'Ein Satz mit: Doppelpunkt.')
	const umbruch = pruefen({ id: 'x', title: 'X\ny', body: 'T' })
	assert.ok(umbruch.some((fehler) => fehler.includes('Zeilenumbruch')))
})

test('der Body behaelt seine innere Form: Leerzeilen und Einrueckung bleiben stehen', () => {
	const body = 'Absatz eins.\n\n  eingerueckte Zeile\n\nAbsatz zwei.'
	const eingabe = text(['id: x', 'title: X', 'tags: []', 'order: 0'], body)
	const gelesen = zerlegen(eingabe)
	assert.equal(gelesen.ok, true)
	assert.equal(gelesen.policy.body, body)
	assert.equal(bauen(gelesen.policy), eingabe)
	// Fuehrende Leerzeilen und Schluesselleerzeichen am Ende sind Kanonisierung, kein Verlust.
	assert.equal(zerlegen(bauen(gelesen.policy)).policy.body, body)
})

test('CRLF wird zu LF normalisiert, ein BOM am Anfang stoert nicht', () => {
	const eingabe = `\uFEFF${text(['id: x', 'title: X', 'tags: []', 'order: 0'], 'Zeile eins.\nZeile zwei.')}`.replace(/\n/g, '\r\n')
	const gelesen = zerlegen(eingabe)
	assert.equal(gelesen.ok, true)
	assert.equal(gelesen.policy.body, 'Zeile eins.\nZeile zwei.')
	assert.ok(!bauen(gelesen.policy).includes('\r'))
})

test('pruefen: dieselben Regeln wie der Zerleger, auch fuer Eingaben von aussen', () => {
	assert.deepEqual(pruefen(beispiel()), [])
	assert.ok(pruefen({ ...beispiel(), id: 'a b' }).some((fehler) => fehler.includes('Pfad-Baustein')))
	assert.ok(pruefen({ ...beispiel(), title: '   ' }).some((fehler) => fehler.includes('title fehlt')))
	assert.ok(pruefen({ ...beispiel(), body: ' ' }).some((fehler) => fehler.includes('body fehlt')))
	assert.ok(pruefen({ ...beispiel(), order: 1.5 }).some((fehler) => fehler.includes('Ganzzahl')))
	assert.ok(pruefen({ ...beispiel(), tags: 'team' }).some((fehler) => fehler.includes('Liste')))
	assert.ok(pruefen({ ...beispiel(), tags: ['mit, Komma'] }).some((fehler) => fehler.includes('Komma')))
	assert.ok(pruefen({ ...beispiel(), body: 'x'.repeat(20001) }).some((fehler) => fehler.includes('zu lang')))
	assert.deepEqual(pruefen(undefined), ['keine Policy uebergeben'])
})

test('normalisiereTags trimmt, verwirft Leeres und Doppeltes', () => {
	assert.deepEqual(normalisiereTags([' a ', '', 'a', 7, 'b']), ['a', 'b'])
	assert.deepEqual(normalisiereTags(undefined), [])
	assert.deepEqual(normalisiereTags('a'), [])
})

test('Bibliotheksreihenfolge: order, dann Titel in Code-Unit-Reihenfolge', () => {
	const policies = [
		{ ...beispiel(), id: 'c', title: 'Beta', order: 1 },
		{ ...beispiel(), id: 'a', title: 'Alpha', order: 1 },
		{ ...beispiel(), id: 'z', title: 'Zeta', order: 0 },
	]
	assert.deepEqual(sortierePolicies(policies).map((policy) => policy.id), ['z', 'a', 'c'])
})
