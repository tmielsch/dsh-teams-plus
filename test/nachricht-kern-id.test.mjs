/**
 * nachricht-kern-id.test.mjs — liefert der ECHTE Kernbaustein eine `id`? (Backlog A5)
 *
 * Hintergrund (Red-Team HOCH-1). `baueNachricht` in `patches/send-to-session.mjs` baut die
 * Nachricht auf zwei Wegen:
 *
 *   1. KERN-WEG: `createUserMessage` aus `@deepseek-ai/dsh-llm` (Modulfunktion, NICHT der
 *      Dienst `llm`) — der Patch laedt sie in `apply` ueber `ladeKern(PAKET_NACHRICHTEN)`.
 *   2. FALLBACK: eine eigene Kennung `s2s-…`, wenn der Baustein nicht ladbar ist.
 *
 * Der Fallback ist in `test/send-to-session.test.mjs` abgedeckt ("die Nachricht hat IMMER eine
 * id", dort Zeile 129). Der KERN-Weg war es NICHT: jener Test schiebt einen NACHGEBAUTEN
 * Baustein ein, der die `id` selbst mitbringt (`createUserMessage: (input) => ({...input, id:
 * 'aus-dem-kern'})`). Das kann nicht fehlschlagen, wenn der echte Kern seine Meinung aendert —
 * dieselbe Fehlerklasse wie Red-Team NIEDRIG-2 ("ein Pruefer, der die gepruefte Stelle nicht
 * erreicht").
 *
 * Diese Datei laedt deshalb den WIRKLICHEN Kern von der Platte und ruft ihn auf. Die Frage, die
 * HOCH-1 offen liess: vergibt `@deepseek-ai/dsh-llm` beim Bauen einer User-Nachricht
 * tatsaechlich eine Kennung, und sind zwei Nachrichten unterscheidbar? Der Posteingang des
 * Ziels verlangt genau das (`dsh-agent-loop/lib/index.js:191-192`):
 *
 *     if (ids.has(message.id)) throw new Error(`message "${message.id}" is already pending`)
 *
 * Zwei Nachrichten ohne `id` haben dort BEIDE `undefined` — die zweite ausstehende wirft.
 *
 * HERMETISCH: `DSH_HOME` zeigt auf ein temporaeres Verzeichnis, BEVOR der Patch geladen wird
 * (dasselbe Muster wie `send-to-session.test.mjs`, Backlog A3/NIEDRIG-6).
 *
 * Findet sich der Kern auf diesem Rechner nicht, werden die Tests UEBERSPRUNGEN, aber mit
 * sichtbarem Grund — dasselbe Vorgehen wie der Kern-Test in `send-to-session.test.mjs`.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'

// Hermetisch machen, BEVOR irgendetwas aus dem Patch geladen wird.
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'kern-id-home-'))

const { baueInhalt, baueNachricht, baueQuelle } = await import('../patches/send-to-session.mjs')

/**
 * Den echten Kernbaustein aufloesen: zuerst ueber die Modulauflösung, dann ueber die bekannten
 * Installationsorte. Dieselben Orte wie `kernBasis()` im Patch und wie im Codec-Test.
 */
function findeKernPfad() {
	const kandidaten = []
	try {
		kandidaten.push(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-llm/lib/index.js'))
	} catch { /* nicht im Suchpfad */ }
	for (const basis of [
		'/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules',
		join(homedir(), '.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules'),
		'/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules',
	]) {
		kandidaten.push(join(basis, '@deepseek-ai', 'dsh-llm', 'lib', 'index.js'))
	}
	return kandidaten.find((pfad) => typeof pfad === 'string' && existsSync(pfad))
}

const KERN_PFAD = findeKernPfad()
const kern = KERN_PFAD === undefined ? undefined : await import(pathToFileURL(KERN_PFAD).href)
const skip = KERN_PFAD === undefined
	? 'der DSH-Kern (@deepseek-ai/dsh-llm) ist auf diesem Rechner nicht auffindbar — der Kern-Weg ist dann nicht pruefbar'
	: false

test('der ECHTE createUserMessage des Kerns vergibt eine eigene, nicht-leere id (A5)', { skip }, () => {
	assert.equal(typeof kern.createUserMessage, 'function', `${KERN_PFAD} exportiert kein createUserMessage`)
	const inhalt = baueInhalt('hallo', 'a', undefined)
	const quelle = baueQuelle('a', 'b')

	const erste = kern.createUserMessage({ content: inhalt, source: quelle })
	// Der Kern baut ueber `createMessage` (dsh-llm/lib/index.js): `id: brandString(randomUUID())`.
	assert.equal(typeof erste.id, 'string', `createUserMessage liefert keine Zeichenkette als id: ${JSON.stringify(erste)}`)
	assert.ok(erste.id.length > 0, 'die id des Kernbausteins ist leer')
	assert.equal(erste.role, 'user')
	assert.deepEqual(erste.source, quelle, 'der Kern reicht die Quelle nicht durch')

	// Zwei Nachrichten muessen VERSCHIEDENE Kennungen tragen. Waeren sie gleich, wuerfe der
	// Posteingang des Ziels bei der zweiten ausstehenden Nachricht (`ids.has(message.id)`).
	const zweite = kern.createUserMessage({ content: inhalt, source: quelle })
	assert.notEqual(erste.id, zweite.id, 'zwei Nachrichten des Kernbausteins tragen dieselbe id')
})

test('baueNachricht uebernimmt die id des ECHTEN Kernbausteins (A5)', { skip }, () => {
	const inhalt = baueInhalt('hallo', 'a', undefined)
	const quelle = baueQuelle('a', 'b')

	const nachricht = baueNachricht(inhalt, quelle, kern)
	assert.equal(typeof nachricht.id, 'string', 'der Kern-Weg von baueNachricht liefert keine id')
	assert.ok(nachricht.id.length > 0, 'der Kern-Weg von baueNachricht liefert eine leere id')
	assert.equal(nachricht.role, 'user')
	assert.deepEqual(nachricht.source, quelle)

	// Der Kern-Weg ist wirklich der Kern-Weg: die Notkennung des Fallbacks beginnt mit `s2s-`.
	// Kaeme hier der Fallback zum Zug, waere die Uebernahme der Kern-id unbewiesen.
	assert.ok(!nachricht.id.startsWith('s2s-'), `hier kam der Fallback zum Zug, nicht der Kern: ${nachricht.id}`)

	// Auch ueber baueNachricht: zwei Zustellungen sind zwei Kennungen.
	const zweite = baueNachricht(inhalt, quelle, kern)
	assert.notEqual(nachricht.id, zweite.id, 'zwei Nachrichten ueber den Kern-Weg tragen dieselbe id')
})
