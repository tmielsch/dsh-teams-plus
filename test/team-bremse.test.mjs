/**
 * team-bremse.test.mjs — der Zaehler und die Bremse, mit Gegenprobe am Code
 * ========================================================================
 *
 * Die Spec (`docs/SPEC-LOKALMODUS.md`, Nachtrag 2026-11-03, 21:42) verlangt eine
 * Obergrenze: hoechstens N Agenten gleichzeitig, der Rest beendet seinen Zug und
 * wird geweckt, wenn ein Platz frei wird. Der Auftrag nennt fuenf Pruefungen,
 * jede mit einem Fall, der scheitern muss:
 *
 *   1. Grenze 2, drei Agenten wollen eine Runde → der dritte wird entwaffnet.
 *   2. Ein Agent geht auf `idle` → der aelteste Entwaffnete wird geweckt.
 *   3. Bremse `aus` → niemand wird angefasst.
 *   4. Kaputte Konfigurationsdatei → laute Meldung, Vorgaben, kein Absturz.
 *   5. Gegenprobe am Code: in einer Kopie unter /tmp ist die Zaehlung ausgebaut
 *      (`ueberGrenze` liefert immer `false`) → Test 1 und 2 muessen ROT werden.
 *
 * Gesteuert wird ueber TEAM_BREMSE_MODUL: ohne die Variable gilt das Modul des
 * Repos, mit ihr die Kopie. Dieselbe Umlenkung benutzt goal-await.test.mjs.
 *
 * Hermetisch: `HOME` und `DSH_HOME` zeigen auf ein Temp-Verzeichnis, damit weder
 * das echte Protokoll noch das echte `~/.dsh` beruehrt werden.
 *
 * Was hier NICHT geprueft wird, weil es ohne laufenden Host nicht messbar ist:
 * dass der Rundentreiber danach wirklich keine Runde mehr nachschiebt. Dafuer
 * stehen die gemessenen Quellstellen im Dateikopf von patches/team-bremse.mjs
 * (der Treiber kehrt bei `activation !== "armed"` zurueck, und `pre-step` weist
 * eine Runde ab, deren Ziel nicht mehr scharf ist).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Hermetisch machen, BEVOR das Modul benutzt wird: Protokoll und Konfiguration
// loesen ueber DSH_HOME auf, das Harness-Zuhause ueber os.homedir().
const HEIM = mkdtempSync(join(tmpdir(), 'team-bremse-home-'))
process.env.HOME = HEIM
process.env.USERPROFILE = HEIM
process.env.DSH_HOME = join(HEIM, '.dsh')

const MODUL = new URL('../patches/team-bremse.mjs', import.meta.url).pathname
const REPO = new URL('..', import.meta.url).pathname

/** Das zu pruefende Modul ist umlenkbar — sonst faehrt die Gegenprobe eine Nachbildung. */
const MODUL_DATEI = process.env.TEAM_BREMSE_MODUL ?? MODUL

const {
	apply,
	istBremsbar,
	leseKonfiguration,
	protokollPfad,
	ueberGrenze,
	WERKZEUG
} = await import(MODUL_DATEI)

const warte = (ms) => new Promise((fertig) => setTimeout(fertig, ms))

/** Ein frischer Ordner mit einem gegebenen Dateiinhalt (oder ohne Datei). */
function konfigurationsOrdner(inhalt) {
	const ordner = mkdtempSync(join(tmpdir(), 'team-bremse-config-'))
	const pfad = join(ordner, 'lokalmodus.json')
	if (inhalt !== undefined) writeFileSync(pfad, inhalt)
	return pfad
}

/**
 * Eine Szene: so viel Cordis-Kontext, wie `team-bremse` benutzt, plus die zwei
 * Ziel-Aufrufe des Kerns (`disarm`, `resume`), die der Patch wirklich macht.
 *
 * Die Attrappen werfen dort, wo der Kern wirft — `goals.get` fuer einen nicht
 * lebenden Agenten, `goals.resume` fuer ein schon scharfes oder erschoepftes
 * Ziel. Nur so prueft die Gegenprobe denselben Weg wie der Host.
 *
 * @param optionen - `{ konfigurationsPfad }`; ohne Angabe eine Datei, die es nicht gibt.
 */
function baueSzene(optionen = {}) {
	const agenten = []
	const ziele = new Map()
	const aufrufe = { disarm: 0, resume: 0 }
	const warnungen = []
	const werkzeuge = []
	const horcher = new Map()

	const registry = {
		list: () => [...agenten],
		get: (id) => agenten.find((agent) => agent.id === id)
	}

	const goalDienst = {
		get: (agent) => {
			if (!agenten.includes(agent)) throw new Error('agent is not live in this registry')
			return ziele.get(agent)
		},
		disarm: (agent) => {
			aufrufe.disarm += 1
			const ziel = ziele.get(agent)
			if (ziel !== undefined) ziel.activation = 'disarmed'
			return ziel
		},
		resume: (agent, ref) => {
			aufrufe.resume += 1
			const ziel = ziele.get(agent)
			if (ziel === undefined || ziel.id !== ref.id || ziel.revision !== ref.revision) throw new Error('goal is not resumable')
			if (ziel.phase !== 'active') throw new Error('goal is ' + ziel.phase)
			if (ziel.activation === 'armed') throw new Error('goal is already active and armed')
			if (ziel.roundsStarted >= ziel.maxGoalRounds) throw new Error('goal exhausted its goal rounds')
			ziel.activation = 'armed'
			return ziel
		}
	}

	const ctx = {
		agents: registry,
		goals: goalDienst,
		tools: { register: (definition) => { werkzeuge.push(definition); return () => {} } },
		logger: { info: () => {}, warn: (text) => warnungen.push(text) },
		on: (ereignis, fn) => {
			if (!horcher.has(ereignis)) horcher.set(ereignis, [])
			horcher.get(ereignis).push(fn)
			return () => {}
		},
		effect: (fn) => {
			const ab = fn()
			return () => { if (typeof ab === 'function') ab() }
		},
		// cordis wirft fuer einen Dienst, den das Profil nicht geladen hat.
		get: () => { throw new Error('service not found') }
	}

	const pfad = optionen.konfigurationsPfad ?? konfigurationsOrdner()
	apply(ctx, { konfigurationsPfad: pfad })

	/** Ein lebender Agent, mit aktivem, scharfem Ziel ohne weitere Angabe. */
	const mitAgent = (id, einstellungen = {}) => {
		const agent = { id, session: {}, status: einstellungen.status ?? 'idle' }
		agenten.push(agent)
		if (einstellungen.ziel !== false) {
			ziele.set(agent, {
				id: 'goal-' + id,
				revision: 1,
				phase: 'active',
				activation: 'armed',
				objective: 'Ziel von ' + id,
				maxGoalRounds: 10,
				roundsStarted: 0
			})
		}
		return agent
	}

	const sende = (ereignis, ...argumente) => {
		for (const fn of horcher.get(ereignis) ?? []) fn(...argumente)
	}

	const aufIdle = (agent) => {
		agent.status = 'idle'
		sende('agent/status', { agent, status: 'idle' })
	}

	const aufRunning = (agent) => {
		agent.status = 'running'
		sende('agent/status', { agent, status: 'running' })
	}

	/**
	 * Das Werkzeug, sobald es angemeldet ist. Die Anmeldung laeuft asynchron, weil
	 * `defineTool` aus dem Kern dynamisch geladen wird; fehlt der Kern, soll der
	 * Test LAUT scheitern statt still nichts zu pruefen.
	 */
	const werkzeug = async () => {
		for (let i = 0; i < 600; i += 1) {
			const treffer = werkzeuge.find((definition) => definition.name === WERKZEUG)
			if (treffer !== undefined) return treffer
			await warte(10)
		}
		throw new Error('das Werkzeug team_bremse wurde nicht angemeldet — ist @deepseek-ai/dsh-tools auffindbar?')
	}

	return { agenten, aufrufe, warnungen, mitAgent, aufIdle, aufRunning, sende, werkzeug, ziel: (agent) => ziele.get(agent), pfad }
}

// ---------------------------------------------------------------------------
// 1. Der Kerntest: Grenze 2, drei Agenten wollen eine Runde
// ---------------------------------------------------------------------------

test('Grenze 2: drei Agenten wollen eine Runde, der dritte wird entwaffnet', async () => {
	const szene = baueSzene()
	const a = szene.mitAgent('sess-a')
	const b = szene.mitAgent('sess-b')
	const c = szene.mitAgent('sess-c')
	const werkzeug = await szene.werkzeug()

	const antwort = await werkzeug.execute({ aktion: 'ein' })

	assert.equal(antwort.scharf, true, 'ein muss die Bremse scharf stellen')
	assert.equal(antwort.grenze, 2, 'die Vorgabe der Spec ist 2')
	assert.equal(szene.ziel(a).activation, 'armed', 'a hat einen Platz und behaelt ihn')
	assert.equal(szene.ziel(b).activation, 'armed', 'b hat den zweiten Platz')
	assert.equal(
		szene.ziel(c).activation,
		'disarmed',
		'der dritte Agent wuerde eine Runde bekommen und die Grenze reissen — er muss entwaffnet sein'
	)
	assert.equal(szene.aufrufe.disarm, 1, 'genau einer wird entwaffnet, nicht alle')
	assert.deepEqual(antwort.wartend, ['sess-c'], 'c steht in der Warteschlange')
	assert.deepEqual([...antwort.bremsbarIdle].sort(), ['sess-a', 'sess-b'], 'a und b bekommen ihre Runde')
	assert.equal(antwort.belegt, 2)

	// Gegenprobe im selben Aufbau: `aus` entlaesst den Wartenden wieder. Ohne
	// diesen Teil waere „c ist entwaffnet" auch dann gruen, wenn die Bremse c
	// einfach vergessen haette.
	const aus = await werkzeug.execute({ aktion: 'aus' })
	assert.equal(aus.scharf, false)
	assert.equal(szene.ziel(c).activation, 'armed', 'aus muss den Wartenden wieder scharf schalten')
	assert.equal(szene.aufrufe.resume, 1)
	assert.deepEqual(aus.wartend, [])
})

// ---------------------------------------------------------------------------
// 2. Ein Platz wird frei
// ---------------------------------------------------------------------------

test('Ein Agent geht auf idle: der aelteste Entwaffnete wird geweckt', async () => {
	const szene = baueSzene()
	const a = szene.mitAgent('sess-a', { status: 'running' })
	const b = szene.mitAgent('sess-b', { status: 'running' })
	const c = szene.mitAgent('sess-c')
	const werkzeug = await szene.werkzeug()

	await werkzeug.execute({ aktion: 'ein' })
	assert.equal(szene.ziel(c).activation, 'disarmed', 'c wartet, solange a und b laufen')

	// b ist fertig: sein Ziel wird beendet, sein Zug endet. Der Platz ist frei.
	const zielB = szene.ziel(b)
	zielB.phase = 'complete'
	zielB.activation = 'disarmed'
	szene.aufIdle(b)

	assert.equal(szene.ziel(c).activation, 'armed', 'der frei gewordene Platz gehoert dem aeltesten Wartenden')
	assert.equal(szene.aufrufe.resume, 1, 'genau einer wird geweckt')
	assert.equal(szene.ziel(a).activation, 'armed', 'a laeuft weiter und wird nicht angefasst')

	const stand = await werkzeug.execute({ aktion: 'status' })
	assert.deepEqual(stand.wartend, [], 'die Warteschlange ist leer')
	assert.deepEqual([...stand.running].sort(), ['sess-a'], 'nur a laeuft noch')
})

test('Ein Agent mit eigenem Anspruch reiht sich hinter den Wartenden', async () => {
	const szene = baueSzene()
	const a = szene.mitAgent('sess-a', { status: 'running' })
	const b = szene.mitAgent('sess-b', { status: 'running' })
	const c = szene.mitAgent('sess-c')
	const werkzeug = await szene.werkzeug()

	await werkzeug.execute({ aktion: 'ein' })
	assert.equal(szene.ziel(c).activation, 'disarmed')

	// b wird idle und will seine naechste Runde. Mit ihm waere kein Platz mehr
	// fuer c — also geht c vor und b reiht sich hinten ein.
	szene.aufIdle(b)

	assert.equal(szene.ziel(c).activation, 'armed', 'der Wartende geht vor')
	assert.equal(szene.ziel(b).activation, 'disarmed', 'b reiht sich hinten ein statt den letzten Platz zu nehmen')

	const stand = await werkzeug.execute({ aktion: 'status' })
	assert.deepEqual(stand.wartend, ['sess-b'], 'b ist jetzt der Wartende')

	// Gegenprobe: geht ein Platz wirklich frei (a hoert auf), kommt b dran.
	szene.ziel(a).phase = 'complete'
	szene.ziel(a).activation = 'disarmed'
	szene.aufIdle(a)
	assert.equal(szene.ziel(b).activation, 'armed', 'danach muss b geweckt werden — sonst waere die Warteschlange eine Falle')
})

// ---------------------------------------------------------------------------
// 3. Bremse aus
// ---------------------------------------------------------------------------

test('Bremse aus: niemand wird angefasst', async () => {
	const szene = baueSzene()
	const a = szene.mitAgent('sess-a')
	const b = szene.mitAgent('sess-b')
	const c = szene.mitAgent('sess-c')
	const werkzeug = await szene.werkzeug()

	// Die Bremse ist beim Start AUS: der Mensch schaltet von Hand (Spec,
	// tragende Entscheidung 4).
	for (const agent of [a, b, c]) szene.aufIdle(agent)

	assert.equal(szene.aufrufe.disarm, 0, 'ohne scharfe Bremse darf niemand entwaffnet werden')
	assert.equal(szene.aufrufe.resume, 0, 'ohne scharfe Bremse wird auch niemand geweckt')
	for (const agent of [a, b, c]) assert.equal(szene.ziel(agent).activation, 'armed', 'alle Ziele bleiben scharf')

	const stand = await werkzeug.execute({ aktion: 'status' })
	assert.equal(stand.scharf, false)
	assert.deepEqual(stand.wartend, [])

	// Gegenprobe im selben Aufbau: scharf gestellt greift dieselbe Szene sehr wohl.
	await werkzeug.execute({ aktion: 'ein' })
	assert.equal(szene.aufrufe.disarm, 1, 'scharf gestellt muss der dritte entwaffnet werden')
	assert.equal(szene.ziel(c).activation, 'disarmed')
})

// ---------------------------------------------------------------------------
// 4. Konfiguration: Vorgaben, Datei, kaputte Datei
// ---------------------------------------------------------------------------

test('Konfiguration: fehlende Datei ist leise, kaputte Felder sind laut und werden feldweise ersetzt', () => {
	const fehlt = leseKonfiguration(join(mkdtempSync(join(tmpdir(), 'team-bremse-fehlt-')), 'gibtsnicht.json'))
	assert.equal(fehlt.quelle, 'vorgabe')
	assert.deepEqual(fehlt.fehler, [], 'eine fehlende Datei ist der dokumentierte Weg zu den Vorgaben, kein Fehler')
	assert.equal(fehlt.werte.maxAktiv, 2)
	assert.equal(fehlt.werte.lokal.provider, 'homepc')
	assert.equal(fehlt.werte.lokal.model, 'swift-1.5-iq2_xs')
	assert.equal(fehlt.werte.cloud.provider, 'deepseek-official')
	assert.equal(fehlt.werte.cloud.model, 'deepseek-flash')

	// Ein kaputtes Feld macht die gueltigen nicht ungueltig.
	const halb = konfigurationsOrdner(JSON.stringify({ maxAktiv: 'zwei', lokal: { provider: 'homepc', model: 'swift-1.5-iq3_xxs' } }))
	const gelesen = leseKonfiguration(halb)
	assert.equal(gelesen.quelle, 'datei')
	assert.equal(gelesen.werte.maxAktiv, 2, 'ein kaputtes maxAktiv faellt auf die Vorgabe zurueck')
	assert.equal(gelesen.werte.lokal.model, 'swift-1.5-iq3_xxs', 'ein gueltiges Feld wird uebernommen')
	assert.equal(gelesen.fehler.length, 1, 'genau ein Befund')
	assert.match(gelesen.fehler[0], /maxAktiv/u)

	// Gegenprobe: eine ganze Zahl ab 1 wird genommen, ohne Meldung.
	const gut = konfigurationsOrdner(JSON.stringify({ maxAktiv: 4 }))
	const sauber = leseKonfiguration(gut)
	assert.equal(sauber.werte.maxAktiv, 4)
	assert.deepEqual(sauber.fehler, [])

	// Und null oder negativ sind keine Grenze, sondern ein Stillstand.
	for (const wert of [0, -1, 1.5]) {
		const pfad = konfigurationsOrdner(JSON.stringify({ maxAktiv: wert }))
		const stand = leseKonfiguration(pfad)
		assert.equal(stand.werte.maxAktiv, 2, `${wert} ist keine gueltige Grenze`)
		assert.equal(stand.fehler.length, 1)
	}
})

test('Kaputte Konfigurationsdatei: laute Meldung, Vorgaben, kein Absturz', async () => {
	const pfad = konfigurationsOrdner('{ "maxAktiv": 3, ')

	const szene = baueSzene({ konfigurationsPfad: pfad })
	const a = szene.mitAgent('sess-a')
	const b = szene.mitAgent('sess-b')
	const c = szene.mitAgent('sess-c')
	const werkzeug = await szene.werkzeug()

	assert.ok(
		szene.warnungen.some((text) => /KAPUTTE KONFIGURATION/u.test(text)),
		'die kaputte Datei muss beim Laden laut gemeldet werden: ' + JSON.stringify(szene.warnungen)
	)
	assert.ok(existsSync(protokollPfad()), 'das Protokoll muss angelegt sein')
	assert.match(readFileSync(protokollPfad(), 'utf8'), /KAPUTTE KONFIGURATION/u, 'die Meldung muss auch im Protokoll stehen')

	// Kein Absturz: das Werkzeug arbeitet, mit der Vorgabe 2.
	const stand = await werkzeug.execute({ aktion: 'status' })
	assert.equal(stand.grenze, 2, 'gearbeitet wird mit der Vorgabe')
	assert.equal(stand.konfiguration.quelle, 'vorgabe')
	assert.match(String(stand.warning), /JSON/u, 'die Antwort traegt die laute Meldung')

	await werkzeug.execute({ aktion: 'ein' })
	assert.equal(szene.ziel(a).activation, 'armed')
	assert.equal(szene.ziel(b).activation, 'armed')
	assert.equal(szene.ziel(c).activation, 'disarmed', 'die Bremse arbeitet trotz kaputter Datei')
})

test('Die Konfigurationsdatei wird wirklich gelesen: maxAktiv 1 laesst genau einen Platz', async () => {
	const pfad = konfigurationsOrdner(JSON.stringify({ maxAktiv: 1 }))
	const szene = baueSzene({ konfigurationsPfad: pfad })
	const a = szene.mitAgent('sess-a')
	const b = szene.mitAgent('sess-b')
	const c = szene.mitAgent('sess-c')
	const werkzeug = await szene.werkzeug()

	await werkzeug.execute({ aktion: 'ein' })

	assert.equal(szene.ziel(a).activation, 'armed', 'a hat den einen Platz')
	assert.equal(szene.ziel(b).activation, 'disarmed')
	assert.equal(szene.ziel(c).activation, 'disarmed')
	const stand = await werkzeug.execute({ aktion: 'status' })
	assert.equal(stand.grenze, 1)
	assert.equal(stand.konfiguration.quelle, 'datei')
	assert.deepEqual(stand.wartend, ['sess-b', 'sess-c'], 'die Warteschlange steht in der Reihenfolge des Eintreffens')
})

// ---------------------------------------------------------------------------
// 5. Der Zaehler und die ehrliche Grenze
// ---------------------------------------------------------------------------

test('status nennt Grenze, laufende, wartende und nicht bremsbare Agenten', async () => {
	const szene = baueSzene()
	const a = szene.mitAgent('sess-a', { status: 'running' })
	const b = szene.mitAgent('sess-b', { status: 'running' })
	const c = szene.mitAgent('sess-c')
	const ohne = szene.mitAgent('sess-ohne', { status: 'running', ziel: false })
	const werkzeug = await szene.werkzeug()

	const stand = await werkzeug.execute({ aktion: 'status' })
	assert.equal(stand.scharf, false)
	assert.deepEqual(stand.running, ['sess-a', 'sess-b', 'sess-ohne'])
	assert.deepEqual(stand.idle, ['sess-c'])
	assert.equal(stand.grenze, 2)
	assert.equal(stand.ueberschritten, true, 'drei laufende bei Grenze 2 sind ueberschritten')
	assert.deepEqual(stand.nichtBremsbar, ['sess-ohne'], 'ohne Ziel ist ein laufender Agent nicht bremsbar — das muss sichtbar sein')

	// Gegenprobe: unter der Grenze ist sie nicht ueberschritten.
	szene.aufIdle(ohne)
	const stand2 = await werkzeug.execute({ aktion: 'status' })
	assert.equal(stand2.ueberschritten, false)
	assert.equal(stand2.running.length, 2)
})

test('Ein Agent ohne scharfes Ziel wird nicht entwaffnet und belegt keinen Platz', async () => {
	const szene = baueSzene()
	const a = szene.mitAgent('sess-a', { status: 'running' })
	const b = szene.mitAgent('sess-b')
	const pausiert = szene.ziel(b)
	pausiert.phase = 'paused'
	pausiert.activation = 'disarmed'
	const c = szene.mitAgent('sess-c')
	const werkzeug = await szene.werkzeug()

	await werkzeug.execute({ aktion: 'ein' })

	// a laeuft (1 belegt), b hat kein scharfes Ziel (0), c bekommt den zweiten Platz.
	assert.equal(szene.ziel(c).activation, 'armed', 'c muss den freien Platz bekommen')
	assert.equal(szene.ziel(b).activation, 'disarmed', 'ein pausiertes Ziel wird nicht angefasst')
	assert.equal(szene.aufrufe.disarm, 0)

	// Gegenprobe: in derselben Szene wird b sehr wohl entwaffnet, wenn sein Ziel
	// wieder scharf wird und keinen Platz mehr findet.
	pausiert.phase = 'active'
	pausiert.activation = 'armed'
	szene.aufIdle(b)
	assert.equal(szene.aufrufe.disarm, 1, 'jetzt will b eine Runde und die Grenze ist voll')
})

test('Ein Wartender, dessen Ziel inzwischen weg ist, wird verworfen statt geweckt', async () => {
	const szene = baueSzene()
	const a = szene.mitAgent('sess-a', { status: 'running' })
	const b = szene.mitAgent('sess-b', { status: 'running' })
	const c = szene.mitAgent('sess-c')
	const werkzeug = await szene.werkzeug()

	await werkzeug.execute({ aktion: 'ein' })
	assert.equal(szene.ziel(c).activation, 'disarmed')

	// c ist fertig, waehrend es wartet.
	szene.ziel(c).phase = 'complete'
	szene.ziel(c).activation = 'disarmed'

	szene.aufIdle(b)

	assert.equal(szene.aufrufe.resume, 0, 'ein beendetes Ziel wird nicht wiederbelebt')
	assert.equal(szene.ziel(b).activation, 'armed', 'b darf seine Runde nehmen — der Wartende ist weg')
	const stand = await werkzeug.execute({ aktion: 'status' })
	assert.deepEqual(stand.wartend, [], 'der veraltete Eintrag ist geraeumt')
})

test('Ein Wartender ohne Rundenvorrat wird verworfen, der naechste bekommt den Platz', async () => {
	const szene = baueSzene()
	const a = szene.mitAgent('sess-a', { status: 'running' })
	szene.mitAgent('sess-b', { status: 'running' })
	const c = szene.mitAgent('sess-c')
	const d = szene.mitAgent('sess-d')
	const werkzeug = await szene.werkzeug()

	await werkzeug.execute({ aktion: 'ein' })
	assert.equal(szene.ziel(c).activation, 'disarmed')
	assert.equal(szene.ziel(d).activation, 'disarmed')

	// c hat seinen Rundenvorrat aufgebraucht: `resume` wuerde im Kern werfen.
	szene.ziel(c).roundsStarted = szene.ziel(c).maxGoalRounds

	// a wird fertig, ein Platz wird frei.
	szene.ziel(a).phase = 'complete'
	szene.ziel(a).activation = 'disarmed'
	szene.aufIdle(a)

	const stand = await werkzeug.execute({ aktion: 'status' })
	assert.equal(szene.ziel(c).activation, 'disarmed', 'c wird nicht scharf geschaltet, wenn sein Vorrat aufgebraucht ist')
	assert.equal(szene.ziel(d).activation, 'armed', 'der naechste Wartende bekommt den Platz statt eines Absturzes')
	assert.deepEqual(stand.wartend, [])
})

// ---------------------------------------------------------------------------
// 6. Die Bausteine einzeln
// ---------------------------------------------------------------------------

test('die Bausteine: Grenze und Bremsbarkeit', () => {
	assert.equal(ueberGrenze(1, 2), false)
	assert.equal(ueberGrenze(2, 2), true, 'die Grenze ist erreicht, wenn sie erreicht ist')
	assert.equal(ueberGrenze(3, 2), true)

	const ziel = (felder) => ({ phase: 'active', activation: 'armed', roundsStarted: 0, maxGoalRounds: 3, ...felder })
	assert.equal(istBremsbar(undefined), false, 'ohne Ziel keine Runde und nichts zu entwaffnen')
	assert.equal(istBremsbar(ziel({})), true)
	assert.equal(istBremsbar(ziel({ activation: 'disarmed' })), false, 'ein entwaffnetes Ziel bekommt schon keine Runde')
	assert.equal(istBremsbar(ziel({ phase: 'paused' })), false)
	assert.equal(istBremsbar(ziel({ phase: 'complete' })), false)
	assert.equal(istBremsbar(ziel({ roundsStarted: 3, maxGoalRounds: 3 })), false, 'ohne Rundenvorrat wird geblockt, nicht gelaufen')
	// Ohne Rundenzahlen (aeltere oder fremde Sicht) bleibt es bei Phase und Aktivierung.
	assert.equal(istBremsbar({ phase: 'active', activation: 'armed' }), true)
})

// ---------------------------------------------------------------------------
// 7. Gegenprobe am Code — eine Kopie unter /tmp, die Zaehlung ausgebaut
// ---------------------------------------------------------------------------

/**
 * Legt eine Kopie des Moduls unter /tmp an, in der EINE Zeile ersetzt ist.
 *
 * Die Kopie entsteht aus DER Datei des Repos, nicht aus einer Nachbildung.
 * Greift die Ersetzung nicht, wirft die Funktion — sonst masze die Gegenprobe
 * die Zaehlung mit, die sie ausbauen soll, und waere keine.
 *
 * @param ersetzung - `[alt, neu]`.
 * @param name - Dateiname der Kopie.
 * @returns der Pfad der Kopie.
 */
function kopieOhne(ersetzung, name) {
	const quelle = readFileSync(MODUL, 'utf8')
	if (!quelle.includes(ersetzung[0])) {
		throw new Error('die Zeile "' + ersetzung[0] + '" steht so nicht im Modul — die Gegenprobe wuerde sonst die Zaehlung mitmessen')
	}
	const angepasst = quelle.replace(ersetzung[0], ersetzung[1])
	if (angepasst.includes(ersetzung[0])) {
		throw new Error('die Ersetzung ' + name + ' hat nicht gegriffen — die Gegenprobe waere keine')
	}
	const ordner = mkdtempSync(join(tmpdir(), 'team-bremse-' + name + '-'))
	const ziel = join(ordner, 'team-bremse.mjs')
	writeFileSync(ziel, angepasst)
	return ziel
}

/**
 * Faehrt DIESE Testdatei erneut — nur mit den Tests, deren Name auf `muster`
 * passt, und gegen `modulPfad` statt gegen das Modul des Repos.
 *
 * @returns `{ code, ausgabe }` des Kindprozesses.
 */
function laufeTests(muster, modulPfad) {
	return new Promise((fertig, fehler) => {
		// `NODE_TEST_CONTEXT` erbt der Kindprozess vom laufenden Test-Runner; mit ihr
		// haelt sich `node --test` fuer einen rekursiven Lauf und startet gar nichts.
		const umgebung = { ...process.env, TEAM_BREMSE_MODUL: modulPfad }
		delete umgebung.NODE_TEST_CONTEXT
		const prozess = spawn(process.execPath, ['--test', '--test-name-pattern=' + muster, 'test/team-bremse.test.mjs'], {
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

test('Gegenprobe am Code: ohne die Zaehlung werden die zwei Kerntests rot', async () => {
	const muster = '^(Grenze 2|Ein Agent geht auf idle)'

	// Erst die Probe auf dem ECHTEN Modul: beide Tests muessen hier gruen sein.
	const echt = await laufeTests(muster, MODUL)
	assert.equal(echt.code, 0, 'die zwei Kerntests sind auf dem echten Modul rot:\n' + echt.ausgabe)
	assert.match(echt.ausgabe, /# pass 2/u, 'es liefen nicht genau die zwei Kerntests:\n' + echt.ausgabe)

	// Jetzt dieselbe Probe gegen die Kopie, in der die Zaehlung IMMER „kein Platz"
	// liefert (`ueberGrenze` gibt immer false zurueck = die Grenze greift nie).
	const ohne = kopieOhne(['\treturn anzahl >= grenze;', '\treturn false;'], 'ohne-zaehlung')
	const kaputt = await laufeTests(muster, ohne)
	assert.notEqual(kaputt.code, 0, 'die Kerntests blieben ohne Zaehlung gruen — sie pruefen die Grenze nicht:\n' + kaputt.ausgabe)
	assert.match(kaputt.ausgabe, /# fail 2/u, 'ohne Zaehlung muessen BEIDE Kerntests rot werden:\n' + kaputt.ausgabe)
	// Der Kindprozess schreibt TAP (`not ok 1 - …`), ein TTY-Lauf `✖ …`; beide
	// Schreibweisen muessen als Rot gelten, sonst haengt der Test am Reporter.
	assert.match(kaputt.ausgabe, /(?:✖ |not ok \d+ - )Grenze 2/u, 'der Grenztest ist nicht rot geworden:\n' + kaputt.ausgabe)
	assert.match(kaputt.ausgabe, /(?:✖ |not ok \d+ - )Ein Agent geht auf idle/u, 'der Wecktest ist nicht rot geworden:\n' + kaputt.ausgabe)
})
