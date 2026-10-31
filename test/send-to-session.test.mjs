/**
 * Test fuer patches/send-to-session.mjs — Fassung 0.5.0
 *
 * Der Patch haengt an Cordis-Diensten, die es in einem Test nicht gibt. Geprueft
 * wird deshalb, was ohne DSH pruefbar ist und genau die Stellen traegt, an denen
 * ein Fehler teuer waere: die Herkunft im Text, die Quellart, die zwei Bremsen,
 * das Kettenbudget, die Zielsuche und die harten Regeln (nicht an sich selbst,
 * keine schlafende Sitzung, keine Zustellung ohne Ziel).
 *
 * NEU IN 0.5.0 und hier abgesichert:
 *   - die Quellart ist `plugin` (dokumentiert) und nicht mehr `agent-send`,
 *   - die Bremse gilt je Absender UND je Ziel,
 *   - das Kettenbudget weist zu tiefe Ketten, Rundlaeufe und Wortwiederholungen ab,
 *   - der Zustand ueberlebt einen Neustart (Datei).
 *
 * HERMETISCH: jeder Test bekommt seine eigene Zustandsdatei. Ohne das schriebe
 * die Suite in die echte Ablage des Menschen und die Tests beeinflussten sich
 * gegenseitig ueber die Zaehler.
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
	GRENZEN,
	apply,
	baueInhalt,
	baueQuelle,
	bremseOk,
	bremsePruefe,
	bremseVerbuche,
	findeZiel,
	ketteFuer,
	leererZustand,
	ladeZustand,
	loeseModus,
	pruefeKette,
	speichereZustand,
	verbucheKette
} from '../patches/send-to-session.mjs'

/** Eine frische Zustandsdatei je Test. */
function frischeAblage() {
	const ordner = mkdtempSync(join(tmpdir(), 'send-to-session-'))
	return join(ordner, 'state.json')
}

test('die Herkunft steht sichtbar im Text, damit niemand den Menschen vermutet', () => {
	const inhalt = baueInhalt('Bitte pruefe den Branch.', 'abc123', 'Agent Teams Lead')
	assert.equal(inhalt.length, 1)
	assert.equal(inhalt[0].type, 'text')
	assert.match(inhalt[0].text, /^\[Nachricht von Agent /u, 'die Nachricht beginnt nicht mit der Herkunft')
	assert.match(inhalt[0].text, /nicht vom Menschen/u, 'es fehlt der Hinweis, dass ein Agent schreibt')
	assert.match(inhalt[0].text, /Agent Teams Lead \(abc123\)/u, 'Name und Kennung fehlen')
	assert.ok(inhalt[0].text.endsWith('Bitte pruefe den Branch.'), 'der eigentliche Text fehlt am Ende')
})

test('ohne lesbaren Namen traegt der Text wenigstens die Kennung', () => {
	const inhalt = baueInhalt('Hallo', 'abc123', undefined)
	assert.match(inhalt[0].text, /Agent abc123/u)
	const gleich = baueInhalt('Hallo', 'abc123', 'abc123')
	assert.match(gleich[0].text, /Agent abc123/u, 'gleicher Name und Kennung werden nicht doppelt geschrieben')
	assert.ok(!gleich[0].text.includes('abc123 (abc123)'), 'Name und Kennung sind doppelt')
})

test('die Quelle ist die dokumentierte Art `plugin` — und nicht `agent-send`', () => {
	const quelle = baueQuelle('abc123', 'def456')
	assert.equal(quelle.kind, 'plugin', 'die dokumentierte Quellart ist plugin')
	assert.notEqual(quelle.kind, 'agent-send', 'agent-send steht nicht in der geschlossenen Liste des Formatpruefers')
	assert.notEqual(quelle.kind, 'user', 'die Quelle darf nicht als Mensch durchgehen')
	assert.notEqual(quelle.kind, 'agent-message', 'agent-message waere eine Zielberechtigung — genau das darf hier nicht passieren')
	assert.notEqual(quelle.kind, 'team-message', 'team-message waere eine Zielberechtigung vom Elternteil')
	assert.equal(quelle.plugin, 'dsh-teams-plus', 'der Paketname gehoert in die Quelle')
	assert.equal(quelle.senderSessionId, 'abc123', 'der Absender muss im Protokoll stehen')
	assert.equal(quelle.targetSessionId, 'def456')
})

test('die Bremse greift nach sechs Zustellungen in zehn Minuten', () => {
	const jetzt = 1_000_000_000_000
	const leer = bremseOk([], jetzt)
	assert.equal(leer.ok, true)

	const fuenf = [1, 2, 3, 4, 5].map((n) => jetzt - n * 1000)
	assert.equal(bremseOk(fuenf, jetzt).ok, true, 'fuenf Zustellungen muessen durchgehen')

	const sechs = [1, 2, 3, 4, 5, 6].map((n) => jetzt - n * 1000)
	assert.equal(bremseOk(sechs, jetzt).ok, false, 'die siebte muss gebremst werden')

	// Alte Zustellungen zaehlen nicht mehr.
	const alt = [1, 2, 3, 4, 5, 6].map((n) => jetzt - 11 * 60 * 1000 - n * 1000)
	assert.equal(bremseOk(alt, jetzt).ok, true, 'Zustellungen ausserhalb des Fensters zaehlen nicht')
	assert.equal(bremseOk(alt, jetzt).frisch.length, 0)
})

test('die Bremse gilt je Absender UND je Ziel', () => {
	const jetzt = 1_000_000_000_000
	const zustand = leererZustand()

	// Drei verschiedene Absender, je zwei Zustellungen an dasselbe Ziel.
	for (const absender of ['a1', 'a2', 'a3']) {
		for (let i = 0; i < 2; i += 1) {
			const pruefung = bremsePruefe(zustand, absender, 'ziel', jetzt)
			assert.equal(pruefung.ok, true, `${absender} haette zustellen duerfen`)
			bremseVerbuche(zustand, absender, 'ziel', jetzt)
		}
	}

	// Jeder Absender liegt mit 2 klar unter 6 — die ZIEL-Bremse greift trotzdem.
	const sechste = bremsePruefe(zustand, 'a3', 'ziel', jetzt)
	assert.equal(sechste.ok, false, 'das Ziel hat schon sechs Nachrichten bekommen')
	assert.equal(sechste.grund, 'ziel', 'der Grund muss das Ziel sein, nicht der Absender')
})

test('Zielsuche: Kennung, Titelteil, Mehrdeutigkeit, Unbekanntes', () => {
	const agenten = [
		{ id: 'a1', session: { title: 'DSH-Interactive Plugin' } },
		{ id: 'a2', session: { title: 'AgentTeams Plus' } },
		{ id: 'a3', session: { title: 'AgentTeams Plus Nacharbeit' } },
		{ id: 'a4' }
	]

	const liste = findeZiel(agenten)
	assert.equal(liste.art, 'liste')
	assert.equal(liste.alle.length, 4, 'ohne Ziel kommen alle lebenden Sitzungen')
	assert.equal(liste.alle[0].id, 'a1')
	assert.equal(liste.alle[3].titel, undefined, 'eine Sitzung ohne Titel ist trotzdem gelistet')

	assert.equal(findeZiel(agenten, 'a2').art, 'genau', 'die genaue Kennung gewinnt')
	assert.equal(findeZiel(agenten, 'a2').ziel.id, 'a2')

	const titel = findeZiel(agenten, 'interactive')
	assert.equal(titel.art, 'genau', 'ein eindeutiger Titelteil reicht')
	assert.equal(titel.ziel.id, 'a1')

	const mehr = findeZiel(agenten, 'agentteams')
	assert.equal(mehr.art, 'mehrdeutig', 'zwei Treffer duerfen nicht geraten werden')
	assert.equal(mehr.kandidaten.length, 2)

	assert.equal(findeZiel(agenten, 'gibtesnicht').art, 'unbekannt')
})

test('Zielsuche ohne Titel bricht nicht', () => {
	const ohne = [{ id: 'x1' }, { id: 'x2' }]
	assert.equal(findeZiel(ohne, 'x1').art, 'genau')
	assert.equal(findeZiel(ohne, 'irgendwas').art, 'unbekannt')
})

// ---------------------------------------------------------------------------
// Kettenbudget — die drei Waechter aus 0.5.0
// ---------------------------------------------------------------------------

test('Kette: ein Rundlaufbudget von zwei Nachrichten je geordnetem Paar', () => {
	const jetzt = 1_000_000_000_000
	const zustand = leererZustand()
	const kette = ketteFuer(zustand, 'a')

	assert.equal(pruefeKette(zustand, kette, 'a', 'b', 'eins').ok, true)
	verbucheKette(zustand, kette, 'a', 'b', 'eins')

	assert.equal(pruefeKette(zustand, kette, 'a', 'b', 'zwei').ok, true, 'die zweite Nachricht muss durch')
	verbucheKette(zustand, kette, 'a', 'b', 'zwei')

	const dritte = pruefeKette(zustand, kette, 'a', 'b', 'drei')
	assert.equal(dritte.ok, false, 'die dritte Nachricht an dasselbe Ziel ist ein Rundlauf zu viel')
	assert.equal(dritte.befund, 'PING_PONG')

	// Die Gegenrichtung ist ein ANDERES geordnetes Paar und darf noch.
	assert.equal(pruefeKette(zustand, kette, 'b', 'a', 'eins').ok, true, 'b → a ist ein eigenes Paar')
	void jetzt
})

test('Kette: wortgleiche Wiederholung an dasselbe Ziel wird abgewiesen', () => {
	const zustand = leererZustand()
	const kette = ketteFuer(zustand, 'a')
	verbucheKette(zustand, kette, 'a', 'b', 'genau dieser Text')

	// Ein anderes Ziel: gleicher Text ist dort erlaubt.
	assert.equal(pruefeKette(zustand, kette, 'a', 'c', 'genau dieser Text').ok, true)

	// Dasselbe Ziel, gleicher Text: der Wiederholungs-Waechter greift vor dem Budget,
	// weil nach EINER Zustellung noch Budget frei ist und der Text trotzdem gleich.
	const wieder = pruefeKette(zustand, kette, 'a', 'b', 'genau dieser Text')
	assert.equal(wieder.ok, false)
	assert.equal(wieder.befund, 'REPEATED_MESSAGE')

	// Anderer Text, gleiches Ziel: jetzt ist das Rundlaufbudget die Grenze.
	verbucheKette(zustand, kette, 'a', 'b', 'zweiter Text')
	const dritte = pruefeKette(zustand, kette, 'a', 'b', 'dritter Text')
	assert.equal(dritte.ok, false)
	assert.equal(dritte.befund, 'PING_PONG', 'die dritte Nachricht an dasselbe Ziel ist ein Rundlauf zu viel')
})

test('Kette: nach vier Weiterleitungen ist Schluss', () => {
	const zustand = leererZustand()
	const kette = { chainId: 'k-test', hop: 5 }
	const zuTief = pruefeKette(zustand, kette, 'a', 'b', 'hallo')
	assert.equal(zuTief.ok, false)
	assert.equal(zuTief.befund, 'CHAIN_EXHAUSTED')

	const gerade = { chainId: 'k-test', hop: 4 }
	assert.equal(pruefeKette(zustand, gerade, 'a', 'b', 'hallo').ok, true, 'Hop 4 ist noch erlaubt')
})

test('Kette: das Ziel erbt die Unterhaltung, eine Stufe tiefer', () => {
	const zustand = leererZustand()
	const erste = ketteFuer(zustand, 'a')
	verbucheKette(zustand, erste, 'a', 'b', 'hallo')

	const vomZiel = ketteFuer(zustand, 'b')
	assert.equal(vomZiel.chainId, erste.chainId, 'das Ziel sitzt in derselben Unterhaltung')
	assert.equal(vomZiel.hop, 1, 'und eine Stufe tiefer')

	// Ein Unbeteiligter beginnt eine neue Unterhaltung.
	const fremd = ketteFuer(zustand, 'z')
	assert.notEqual(fremd.chainId, erste.chainId)
	assert.equal(fremd.hop, 0)
})

test('Kettenbuch vergisst alte Unterhaltungen, damit die Datei nicht waechst', () => {
	const zustand = leererZustand()
	for (let i = 0; i < GRENZEN.kettenGedaeschtnis + 10; i += 1) {
		const kette = { chainId: `k-${i}`, hop: 0 }
		verbucheKette(zustand, kette, 'a', `ziel-${i}`, 'text')
	}
	assert.equal(Object.keys(zustand.ketten).length, GRENZEN.kettenGedaeschtnis)
})

// ---------------------------------------------------------------------------
// Zustand: er ueberlebt den Neustart
// ---------------------------------------------------------------------------

test('der Zustand ueberlebt einen Neustart', () => {
	const pfad = frischeAblage()
	const zustand = leererZustand()
	bremseVerbuche(zustand, 'a1', 'b2', 1_000)
	verbucheKette(zustand, { chainId: 'k-1', hop: 0 }, 'a1', 'b2', 'hallo')
	assert.equal(speichereZustand(zustand, pfad), true)

	const geladen = ladeZustand(pfad)
	assert.deepEqual(geladen.absender.a1, [1_000], 'die Zustellzeit je Absender fehlt')
	assert.deepEqual(geladen.ziel.b2, [1_000], 'die Zustellzeit je Ziel fehlt')
	assert.equal(geladen.ketten['k-1'].edges['a1 b2'], 1)
	assert.equal(geladen.ketteVon.b2.chainId, 'k-1')
})

test('eine kaputte Zustandsdatei verhindert den Start nicht', () => {
	const pfad = frischeAblage()
	speichereZustand({ kaputt: true }, pfad)
	const geladen = ladeZustand(pfad)
	assert.deepEqual(geladen, leererZustand(), 'unbekannte Form faellt auf den leeren Zustand zurueck')

	// Eine Datei, die nicht existiert, ebenso.
	assert.deepEqual(ladeZustand('/gibt/es/nicht/state.json'), leererZustand())
})

// ---------------------------------------------------------------------------
// Zustellart `auto`
// ---------------------------------------------------------------------------

test('auto waehlt nach dem lebenden Zustand des Ziels, Vorgabe bleibt steer', () => {
	assert.equal(loeseModus('auto', { status: 'running' }), 'steer')
	assert.equal(loeseModus('auto', { status: 'idle' }), 'followup')
	assert.equal(loeseModus(undefined, { status: 'idle' }), 'steer', 'ohne auto bleibt die Vorgabe steer')
	assert.equal(loeseModus('followup', {}), 'followup')
	assert.equal(loeseModus('steer', { status: 'idle' }), 'steer', 'eine ausdrueckliche Wahl gewinnt')
})

// ---------------------------------------------------------------------------
// Funktionstest des Werkzeugs gegen einen nachgebauten Agenten-Dienst.
// Ohne diesen Test waere die Zustellung selbst ungeprueft: die reinen Helfer
// oben sagen nichts darueber, ob `followup`/`steer` richtig gerufen werden.
// ---------------------------------------------------------------------------

/**
 * Baut einen minimalen Cordis-Kontext mit `tools` und `agents`.
 * `defineTool` gibt die Definition unveraendert zurueck — geprueft wird, was
 * `execute` tut, nicht wie der Host die Definition verpackt.
 */
function baueKontext(agenten, optionen = {}) {
	const registriert = []
	const ctx = {
		logger: { info() {}, warn() {}, error() {} },
		get(name) {
			if (name === 'agents') return optionen.ohneAgenten ? undefined : { list: () => agenten, get: (id) => agenten.find((a) => a.id === id) }
			if (name === 'llm') return { createUserMessage: (input) => ({ ...input, role: 'user' }) }
			return undefined
		},
		tools: { register: (def) => { registriert.push(def); return () => {} } },
		effect(fn) { fn() },
		provide() { return () => {} }
	}
	return { ctx, registriert }
}

/** Laedt das Modul und meldet das Werkzeug an; gibt die Definition zurueck. */
async function anmelden(agenten, optionen = {}) {
	const pfad = optionen.pfad ?? frischeAblage()
	const { ctx, registriert } = baueKontext(agenten, optionen)
	const modul = await import('../patches/send-to-session.mjs')
	modul.apply(ctx, { pfad })
	await new Promise((r) => setTimeout(r, 300)) // der Ladevorgang laeuft asynchron
	return { def: registriert[0], registriert, pfad }
}

test('das Werkzeug wird angemeldet und liefert die lebenden Sitzungen ohne Ziel', async () => {
	const gesendet = []
	const ziel = { id: 'b2', session: { title: 'Andere Sitzung' }, steer: (m) => gesendet.push(['steer', m]), followup: (m) => gesendet.push(['followup', m]) }
	const absender = { id: 'a1', session: { title: 'Meine Sitzung' } }
	const { def, registriert } = await anmelden([absender, ziel])

	assert.equal(registriert.length, 1, 'das Werkzeug wurde nicht angemeldet')
	assert.equal(def.name, 'send_to_session')
	// `defineTool` gibt `parameters` als JSON-Schema zurueck, nicht als flaches
	// Objekt — gemessen am 2026-10-30 an der echten Definition.
	const props = def.parameters.properties
	assert.ok(props.target, 'der Parameter target fehlt')
	assert.ok(props.message, 'der Parameter message fehlt')
	assert.deepEqual(props.mode.enum, ['auto', 'steer', 'followup'])
	assert.equal(props.message.type, 'string')

	const ohneZiel = await def.execute({ message: 'Hallo' }, { agent: absender, signal: new AbortController().signal })
	assert.equal(ohneZiel.delivered, false)
	assert.equal(ohneZiel.sessions.length, 2, 'ohne Ziel muessen alle lebenden Sitzungen kommen')
	assert.match(ohneZiel.note, /no target/u)
	assert.equal(gesendet.length, 0, 'ohne Ziel darf nichts zugestellt werden')
})

test('die Zustellung geht an den naechsten Schritt, nicht in eine neue Runde', async () => {
	const gesendet = []
	const ziel = { id: 'b2', session: { title: 'Andere' }, steer: (m) => gesendet.push(['steer', m]), followup: (m) => gesendet.push(['followup', m]) }
	const absender = { id: 'a1', session: { title: 'Meine' } }
	const { def } = await anmelden([absender, ziel])

	const ergebnis = await def.execute({ target: 'b2', message: 'Bitte pruefen' }, { agent: absender, signal: new AbortController().signal })
	assert.equal(ergebnis.delivered, true)
	assert.equal(ergebnis.mode, 'steer', 'die Vorgabe muss steer sein')
	assert.equal(gesendet.length, 1)
	assert.equal(gesendet[0][0], 'steer', 'steer darf nicht followup rufen')
	const nachricht = gesendet[0][1]
	assert.equal(nachricht.role, 'user')
	assert.match(nachricht.content[0].text, /nicht vom Menschen/u)
	assert.equal(nachricht.source.kind, 'plugin', 'die Quelle muss die dokumentierte Art tragen')
	assert.equal(nachricht.source.senderSessionId, 'a1')
})

test('followup wird nur auf ausdrueckliche Anforderung gerufen', async () => {
	const gesendet = []
	const ziel = { id: 'b2', session: {}, steer: (m) => gesendet.push(['steer', m]), followup: (m) => gesendet.push(['followup', m]) }
	const absender = { id: 'a1', session: {} }
	const { def } = await anmelden([absender, ziel])

	const e = await def.execute({ target: 'b2', message: 'Sofort bitte', mode: 'followup' }, { agent: absender, signal: new AbortController().signal })
	assert.equal(e.delivered, true)
	assert.equal(e.mode, 'followup')
	assert.equal(gesendet[0][0], 'followup')
})

test('an sich selbst wird nie zugestellt', async () => {
	const gesendet = []
	const absender = { id: 'a1', session: {}, steer: (m) => gesendet.push(m), followup: (m) => gesendet.push(m) }
	const { def } = await anmelden([absender])

	const e = await def.execute({ target: 'a1', message: 'Echo' }, { agent: absender, signal: new AbortController().signal })
	assert.equal(e.delivered, false)
	assert.match(e.note, /yourself/u)
	assert.equal(gesendet.length, 0, 'die eigene Sitzung darf nichts bekommen')
})

test('ohne Agenten-Dienst meldet das Werkzeug einen Grund statt zu werfen', async () => {
	const absender = { id: 'a1', session: {} }
	const { def } = await anmelden([absender], { ohneAgenten: true })

	const e = await def.execute({ target: 'x', message: 'Hallo' }, { agent: absender, signal: new AbortController().signal })
	assert.equal(e.delivered, false)
	assert.match(e.note, /agents/u)
})

test('die Bremse greift auch im Werkzeug, nicht nur im Helfer', async () => {
	const gesendet = []
	const ziel = { id: 'b2', session: {}, steer: (m) => gesendet.push(m), followup: (m) => gesendet.push(m) }
	const absender = { id: 'a1', session: {} }
	const { def } = await anmelden([absender, ziel])

	const laeufe = []
	for (let i = 0; i < 8; i += 1) {
		laeufe.push(await def.execute({ target: 'b2', message: `Nr ${i}` }, { agent: absender, signal: new AbortController().signal }))
	}
	const zugestellt = laeufe.filter((e) => e.delivered).length
	assert.equal(zugestellt, 2, `nach zwei Rundlaeufen je Paar muss Schluss sein, zugestellt waren ${zugestellt}`)
	const gebremst = laeufe.filter((e) => e.delivered === false && /PING_PONG/u.test(e.note))
	assert.equal(gebremst.length, 6, 'die uebrigen muessen als Rundlauf abgewiesen werden')
})

test('das Kettenbudget greift im Werkzeug: die dritte Nachricht an dasselbe Ziel wird abgewiesen', async () => {
	const gesendet = []
	const ziel = { id: 'b2', session: {}, status: 'idle', steer: (m) => gesendet.push(m), followup: (m) => gesendet.push(m) }
	const absender = { id: 'a1', session: {} }
	const { def } = await anmelden([absender, ziel])

	const eins = await def.execute({ target: 'b2', message: 'erste' }, { agent: absender, signal: new AbortController().signal })
	const zwei = await def.execute({ target: 'b2', message: 'zweite' }, { agent: absender, signal: new AbortController().signal })
	const drei = await def.execute({ target: 'b2', message: 'dritte' }, { agent: absender, signal: new AbortController().signal })

	assert.equal(eins.delivered, true)
	assert.equal(zwei.delivered, true)
	assert.equal(drei.delivered, false)
	assert.match(drei.note, /PING_PONG/u)
	assert.equal(gesendet.length, 2, 'die dritte darf das Ziel nicht erreichen')
})
