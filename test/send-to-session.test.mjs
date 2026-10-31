/**
 * Test fuer patches/send-to-session.mjs — Fassung 0.6.0
 *
 * Der Patch haengt an Cordis-Diensten, die es in einem Test nicht gibt. Geprueft
 * wird deshalb, was ohne DSH pruefbar ist und genau die Stellen traegt, an denen
 * ein Fehler teuer waere.
 *
 * WAS DIESE FASSUNG AUS DEM RED-TEAM-BEFUND GELERNT HAT:
 *
 *   1. Der Test prueft die Quelle nicht mehr auf ihr ETIKETT, sondern schickt sie
 *      durch den **echten v4-Codec** des Kerns. v0.5.0 schrieb `kind: "plugin"`,
 *      der Codec lehnt das beim Schreiben ab ("format v4 message requires a
 *      producer-owned source kind") — die Persistenz der Ziel-Sitzung waere
 *      stehengeblieben. Der Etikett-Test war 22/22 gruen. Ein Test, der nur
 *      prueft, was man selbst geschrieben hat, prueft nichts.
 *   2. Das Kettenbudget ist durch ein **Paar-Budget** ersetzt. Die Kette war
 *      falsch positiv und falsch negativ zugleich (gemessen vom Red Team).
 *   3. Die Zielsuche liest `session.header.cwd`, nicht `session.title` — eine
 *      Session hat keinen Titel (nachgemessen an dsh-session/lib/types).
 *   4. Die Wurzelsitzung (die des Menschen) bekommt kein `followup`.
 *
 * HERMETISCH: `DSH_HOME` zeigt auf ein temporaeres Verzeichnis, BEVOR das Modul
 * geladen wird. Ohne das schriebe die Suite in `~/.dsh/logs/` des Menschen — dem
 * Red Team ist genau das aufgefallen.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// Hermetisch machen, BEVOR irgendetwas aus dem Patch geladen wird.
const HEIM = mkdtempSync(join(tmpdir(), 's2s-home-'))
process.env.DSH_HOME = HEIM

const { releasedV4SessionFormatCodec } = await import(
	'/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-format-v3-to-v4/lib/index.js'
)

const {
	GRENZEN,
	QUELL_ART,
	apply,
	baueInhalt,
	baueNachricht,
	baueQuelle,
	bremseOk,
	bremsePruefe,
	bremseVerbuche,
	findeZiel,
	leererZustand,
	ladeZustand,
	loeseModus,
	mitSperre,
	pruefeKette,
	speichereZustand,
	verbucheKette,
	verschmelzeZustand,
	zustandPfad,
	kante
} = await import('../patches/send-to-session.mjs')

/** Eine frische Zustandsdatei je Test. */
function frischeAblage() {
	const ordner = mkdtempSync(join(tmpdir(), 'send-to-session-'))
	return join(ordner, 'state.json')
}

// ---------------------------------------------------------------------------
// 1. Die Quelle — der Befund, der v0.5.0 gesperrt hat
// ---------------------------------------------------------------------------

test('die Quelle kommt durch den ECHTEN v4-Codec (der Blocker aus v0.5.0)', () => {
	const quelle = baueQuelle('abc123', 'def456')
	const nachricht = { role: 'user', content: [{ type: 'text', text: 'hallo' }], source: quelle }

	// Form 1: user/message — `data` IST die Nachricht (so baut der Host es).
	const userEvent = { type: 'user/message', seq: 1, data: nachricht }
	assert.doesNotThrow(
		() => releasedV4SessionFormatCodec.encodeEvent(userEvent),
		'der v4-Codec hat die Quelle abgelehnt — die Persistenz der Ziel-Sitzung bliebe stehen'
	)

	// Form 2: agent/inbox/spliced — `data.inserted[]` traegt Nachrichten.
	const spliced = {
		type: 'agent/inbox/spliced',
		seq: 2,
		data: { target: 'next-turn', start: 0, inserted: [nachricht] }
	}
	assert.doesNotThrow(
		() => releasedV4SessionFormatCodec.encodeEvent(spliced),
		'der v4-Codec hat die Quelle in einer Zustellung abgelehnt'
	)
})

test('die Quelle ist NICHT `plugin` — genau das lehnt der Codec ab', () => {
	const quelle = baueQuelle('a', 'b')
	assert.notEqual(quelle.kind, 'plugin', '`plugin` ist die abgelehnte Form')
	// Gegenprobe: so saehe es aus, und so muss es scheitern.
	const kaputt = { kind: 'plugin', plugin: 'x', form: 'relay' }
	assert.throws(
		() => releasedV4SessionFormatCodec.encodeEvent({ type: 'user/message', seq: 1, data: { role: 'user', content: [], source: kaputt } }),
		/producer-owned source kind/u,
		'die Gegenprobe greift nicht — dann prueft dieser Test nichts'
	)
})

test('die Nachricht hat IMMER eine id (Red-Team HOCH-1)', () => {
	// Der echte llm-DIENST hat kein createUserMessage — es ist eine Modulfunktion
	// (dsh-llm/lib/index.js:59), und erst sie vergibt ueber createMessage eine id.
	// Eine Nachricht ohne id laesst den Posteingang des Ziels werfen, sobald zwei
	// ausstehen (dsh-agent-loop/lib/index.js:191-192).
	const quelle = baueQuelle('a', 'b')
	const inhalt = baueInhalt('hallo', 'a', undefined)

	// (a) Ohne geladenen Kernbaustein muss der Fallback eine id vergeben.
	const ohneKern = baueNachricht(inhalt, quelle, undefined)
	assert.equal(typeof ohneKern.id, 'string', 'ohne Kernbaustein fehlt die id')
	assert.ok(ohneKern.id.length > 0)
	assert.equal(ohneKern.role, 'user')
	assert.deepEqual(ohneKern.source, quelle)

	// (b) Zwei Nachrichten duerfen nie dieselbe id tragen.
	const zweite = baueNachricht(inhalt, quelle, undefined)
	assert.notEqual(ohneKern.id, zweite.id, 'zwei Nachrichten mit derselben id kollidieren im Posteingang')

	// (c) Mit einem Baustein, der wie der Kern arbeitet, kommt dessen id.
	const kern = { createUserMessage: (input) => ({ ...input, role: 'user', id: 'aus-dem-kern' }) }
	const mitKern = baueNachricht(inhalt, quelle, kern)
	assert.equal(mitKern.id, 'aus-dem-kern', 'die Kennung des Kerns muss uebernommen werden')
})

test('die Quelle ist die dokumentierte Erzeuger-Art und oeffnet kein Ziel', () => {
	const quelle = baueQuelle('abc123', 'def456')
	assert.equal(quelle.kind, QUELL_ART)
	assert.equal(QUELL_ART, 'plugin:@tmielsch/dsh-teams-plus')
	// `hasDirectHumanInput` (dsh-tool-goal) kennt nur diese drei. Keine davon darf es sein.
	assert.notEqual(quelle.kind, 'user')
	assert.notEqual(quelle.kind, 'agent-message', 'agent-message waere eine Zielberechtigung')
	assert.notEqual(quelle.kind, 'team-message', 'team-message waere eine Zielberechtigung')
	assert.equal(quelle.senderSessionId, 'abc123')
	assert.equal(quelle.targetSessionId, 'def456')
	assert.equal(quelle.form, 'relay')
})

// ---------------------------------------------------------------------------
// 2. Herkunft im Text
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 3. Die zwei Fenster: je Absender und je Ziel
// ---------------------------------------------------------------------------

test('die Bremse greift nach sechs Zustellungen in zehn Minuten', () => {
	const jetzt = 1_000_000_000_000
	assert.equal(bremseOk([], jetzt).ok, true)

	const fuenf = [1, 2, 3, 4, 5].map((n) => jetzt - n * 1000)
	assert.equal(bremseOk(fuenf, jetzt).ok, true, 'fuenf Zustellungen muessen durchgehen')

	const sechs = [1, 2, 3, 4, 5, 6].map((n) => jetzt - n * 1000)
	assert.equal(bremseOk(sechs, jetzt).ok, false, 'die siebte muss gebremst werden')

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
			assert.equal(bremsePruefe(zustand, absender, 'ziel', jetzt).ok, true, `${absender} haette zustellen duerfen`)
			bremseVerbuche(zustand, absender, 'ziel', jetzt)
		}
	}

	// Jeder Absender liegt mit 2 klar unter 6 — die ZIEL-Bremse greift trotzdem.
	const sechste = bremsePruefe(zustand, 'a3', 'ziel', jetzt)
	assert.equal(sechste.ok, false, 'das Ziel hat schon sechs Nachrichten bekommen')
	assert.equal(sechste.grund, 'ziel', 'der Grund muss das Ziel sein, nicht der Absender')
})

// ---------------------------------------------------------------------------
// 4. Zielsuche — Kennung, Praefix, Ordner
// ---------------------------------------------------------------------------

test('Zielsuche: volle Kennung, eindeutiger Praefix, Ordner, Mehrdeutigkeit', () => {
	const agenten = [
		{ id: 'session-aaaa-1111', session: { header: { cwd: '/Users/tmielsch/dsh-interactive' } } },
		{ id: 'session-bbbb-2222', session: { header: { cwd: '/Users/tmielsch/dsh-teams-plus' } } },
		{ id: 'session-cccc-3333', session: { header: { cwd: '/Users/tmielsch/dsh-teams-plus' } } },
		{ id: 'session-dddd-4444' }
	]

	const liste = findeZiel(agenten)
	assert.equal(liste.art, 'liste')
	assert.equal(liste.alle.length, 4)
	assert.equal(liste.alle[3].ordner, undefined, 'eine Sitzung ohne cwd ist trotzdem gelistet')

	assert.equal(findeZiel(agenten, 'session-bbbb-2222').art, 'genau', 'die volle Kennung gewinnt')
	assert.equal(findeZiel(agenten, 'session-aaaa').art, 'genau', 'ein eindeutiger Praefix reicht')
	assert.equal(findeZiel(agenten, 'session-aaaa').ziel.id, 'session-aaaa-1111')

	const ordner = findeZiel(agenten, 'interactive')
	assert.equal(ordner.art, 'genau', 'ein eindeutiger Ordnerteil reicht')
	assert.equal(ordner.ziel.id, 'session-aaaa-1111')

	const mehr = findeZiel(agenten, 'teams-plus')
	assert.equal(mehr.art, 'mehrdeutig', 'zwei Treffer duerfen nicht geraten werden')
	assert.equal(mehr.kandidaten.length, 2)

	assert.equal(findeZiel(agenten, 'gibtesnicht').art, 'unbekannt')
})

test('die Zielsuche liest KEIN session.title — den gibt es nicht', () => {
	// Beweis: ein Agent mit `title` (alte Annahme) wird NICHT gefunden,
	// einer mit `header.cwd` schon. So faellt auf, wenn jemand zurueckbaut.
	const mitTitel = [{ id: 'x1', session: { title: 'AgentTeams Plus' } }]
	assert.equal(findeZiel(mitTitel, 'teams').art, 'unbekannt', 'auf session.title darf sich die Suche nicht stuetzen')
	const mitOrdner = [{ id: 'x2', session: { header: { cwd: '/tmp/AgentTeams' } } }]
	assert.equal(findeZiel(mitOrdner, 'teams').art, 'genau', 'der Ordner ist das, was zaehlt')
})

// ---------------------------------------------------------------------------
// 5. Das Paar-Budget (ersetzt das falsche Kettenbudget)
// ---------------------------------------------------------------------------

test('Paar-Budget: zwei Nachrichten je geordnetem Paar im Fenster', () => {
	const jetzt = 1_000_000_000_000
	const zustand = leererZustand()

	assert.equal(pruefeKette(zustand, 'a', 'b', 'eins', jetzt).ok, true)
	verbucheKette(zustand, 'a', 'b', 'eins', jetzt)

	assert.equal(pruefeKette(zustand, 'a', 'b', 'zwei', jetzt).ok, true, 'die zweite muss durch')
	verbucheKette(zustand, 'a', 'b', 'zwei', jetzt)

	const dritte = pruefeKette(zustand, 'a', 'b', 'drei', jetzt)
	assert.equal(dritte.ok, false, 'die dritte ist ein Rundlauf zu viel')
	assert.equal(dritte.befund, 'PING_PONG')

	// Die Gegenrichtung ist ein ANDERES Paar — der Red-Team-Befund: frueher
	// erbte sie die Kette von a→b und wurde nach EINER Nachricht abgewiesen.
	assert.equal(pruefeKette(zustand, 'b', 'a', 'eins', jetzt).ok, true, 'b → a ist ein eigenes Paar')
})

test('Paar-Budget: der Fehler aus v0.5.0 tritt nicht wieder auf (a→c nach a↔b)', () => {
	// Das war der gemessene Fehlbefund: A→C landete in der Kette von A→B und
	// C→A wurde dann nach einer eigenen Nachricht abgewiesen.
	const jetzt = 1_000_000_000_000
	const zustand = leererZustand()
	verbucheKette(zustand, 'a', 'b', 'hallo b', jetzt)
	verbucheKette(zustand, 'b', 'a', 'hallo a', jetzt)
	verbucheKette(zustand, 'a', 'b', 'nochmal b', jetzt)

	assert.equal(pruefeKette(zustand, 'a', 'c', 'hallo c', jetzt).ok, true, 'a → c ist voellig unberuehrt')
	assert.equal(pruefeKette(zustand, 'c', 'a', 'hallo zurueck', jetzt).ok, true, 'c → a auch')
	verbucheKette(zustand, 'c', 'a', 'hallo zurueck', jetzt)
	assert.equal(pruefeKette(zustand, 'c', 'a', 'zweite', jetzt).ok, true, 'c → a hat noch Budget')
})

test('Paar-Budget: nach dem Fenster ist das Paar wieder frei', () => {
	const jetzt = 1_000_000_000_000
	const zustand = leererZustand()
	verbucheKette(zustand, 'a', 'b', 'eins', jetzt)
	verbucheKette(zustand, 'a', 'b', 'zwei', jetzt)
	assert.equal(pruefeKette(zustand, 'a', 'b', 'drei', jetzt).ok, false)

	const spaeter = jetzt + GRENZEN.fensterMs + 1000
	assert.equal(pruefeKette(zustand, 'a', 'b', 'drei', spaeter).ok, true, 'ausserhalb des Fensters zaehlt nichts mehr')
})

test('Paar-Budget: wortgleiche Wiederholung an dasselbe Paar', () => {
	const jetzt = 1_000_000_000_000
	const zustand = leererZustand()
	verbucheKette(zustand, 'a', 'b', 'genau dieser Text', jetzt)

	const wieder = pruefeKette(zustand, 'a', 'b', 'genau dieser Text', jetzt)
	assert.equal(wieder.ok, false)
	assert.equal(wieder.befund, 'REPEATED_MESSAGE')

	// Anderes Ziel, gleicher Text: erlaubt.
	assert.equal(pruefeKette(zustand, 'a', 'c', 'genau dieser Text', jetzt).ok, true)
})

test('Paar-Buch vergisst alte Paare, damit die Datei nicht waechst', () => {
	const jetzt = 1_000_000_000_000
	const zustand = leererZustand()
	for (let i = 0; i < GRENZEN.paareGedaeschtnis + 10; i += 1) {
		verbucheKette(zustand, 'a', `ziel-${i}`, 'text', jetzt)
	}
	assert.equal(Object.keys(zustand.paare).length, GRENZEN.paareGedaeschtnis)
	assert.equal(kante('a', 'b'), 'a b')
})

// ---------------------------------------------------------------------------
// 6. Zustand: er ueberlebt den Neustart, und ein altes Modell wird verworfen
// ---------------------------------------------------------------------------

test('der Zustand ueberlebt einen Neustart', () => {
	const pfad = frischeAblage()
	const zustand = leererZustand()
	bremseVerbuche(zustand, 'a1', 'b2', 1_000)
	verbucheKette(zustand, 'a1', 'b2', 'hallo', 1_000)
	assert.equal(speichereZustand(zustand, pfad), true)

	const geladen = ladeZustand(pfad)
	assert.equal(geladen.absender.a1.length, 1, 'die Zustellzeit je Absender fehlt')
	assert.equal(geladen.absender.a1[0].t, 1_000)
	assert.equal(geladen.ziel.b2.length, 1, 'die Zustellzeit je Ziel fehlt')
	assert.equal(geladen.paare['a1 b2'].zeiten.length, 1)
	assert.equal(geladen.paare['a1 b2'].letzterText, 'hallo')

	// Zwei Zustellungen in DERSELBEN Millisekunde bleiben zwei Ereignisse.
	// (Das war der Grund fuer den sporadisch roten Test: ein Set ueber Zahlen
	// haette sie zu einer verschmolzen, und die Bremse haette zu wenig gezaehlt.)
	const zustand2 = leererZustand()
	bremseVerbuche(zustand2, 'c', 'd', 5_000)
	bremseVerbuche(zustand2, 'c', 'd', 5_000)
	assert.equal(zustand2.ziel.d.length, 2, 'zwei Zustellungen in einer Millisekunde muessen zwei Ereignisse bleiben')
	assert.notEqual(zustand2.ziel.d[0].id, zustand2.ziel.d[1].id)
})

test('eine Datei aus dem alten Kettenmodell wird verworfen, nicht migriert', () => {
	const pfad = frischeAblage()
	speichereZustand({ absender: { a: [1] }, ziel: {}, ketten: { k: { edges: {} } }, ketteVon: { b: { chainId: 'k', hop: 1 } } }, pfad)
	const geladen = ladeZustand(pfad)
	assert.deepEqual(geladen.paare, {}, 'das alte Kettenmodell darf nicht als Paar-Buch durchgehen')
	assert.equal(geladen.alt, true, 'der Ladevorgang meldet die alte Form')
})

test('eine kaputte Zustandsdatei verhindert den Start nicht — wird aber gemeldet', () => {
	const pfad = frischeAblage()
	speichereZustand({ kaputt: true }, pfad)
	const geladen = ladeZustand(pfad)
	assert.deepEqual(geladen.paare, {})
	assert.equal(geladen.kaputt, true, 'eine unlesbare Datei muss gemeldet werden, nicht stillschweigend leer sein (Red-Team H2)')

	// Fehlt die Datei ganz, ist das der erste Start — dann ist nichts kaputt.
	const frisch = ladeZustand('/gibt/es/nicht/state.json')
	assert.deepEqual(frisch, leererZustand())
	assert.notEqual(frisch.kaputt, true, 'eine fehlende Datei ist kein Fehler')

	// Skalare sind KAPUTT, nicht frisch (Red-Team NIEDRIG-1): die Datei war da,
	// hat aber die falsche Form. Vorher fielen genau diese drei still durch.
	for (const skalar of [null, 42, 'x']) {
		const p = frischeAblage()
		writeFileSync(p, JSON.stringify(skalar))
		assert.equal(ladeZustand(p).kaputt, true, 'Skalar ' + JSON.stringify(skalar) + ' muss als kaputt gelten')
	}
})

// ---------------------------------------------------------------------------
// 6b. M1 — Lost Update über zwei Zustands-Halter
// ---------------------------------------------------------------------------

test('zwei Zustands-Halter verlieren keine Zähler (M1)', () => {
	// Zwei Prozesse: jeder hat seinen Speicherstand, beide schreiben nacheinander.
	const pfad = frischeAblage()
	const p1 = ladeZustand(pfad)
	const p2 = ladeZustand(pfad)

	// p1 stellt A→B zu, mit Read-Merge-Write wie im execute.
	{
		const stand = verschmelzeZustand(p1, ladeZustand(pfad))
		bremseVerbuche(stand, 'A', 'B', 1_000)
		verbucheKette(stand, 'A', 'B', 'hallo B', 1_000)
		speichereZustand(stand, pfad)
	}

	// p2 stellt A→C zu und weiß nichts von p1.
	{
		const stand = verschmelzeZustand(p2, ladeZustand(pfad))
		bremseVerbuche(stand, 'A', 'C', 2_000)
		verbucheKette(stand, 'A', 'C', 'hallo C', 2_000)
		speichereZustand(stand, pfad)
	}

	const final = ladeZustand(pfad)
	assert.deepEqual(final.ziel.B.map((e) => e.t), [1_000], 'der Zähler des ersten Schreibers ging verloren')
	assert.deepEqual(final.ziel.C.map((e) => e.t), [2_000], 'der Zähler des zweiten Schreibers fehlt')
	assert.deepEqual(final.absender.A.map((e) => e.t).sort(), [1_000, 2_000], 'der Absender-Zähler muss beide Zustellungen tragen')
	assert.deepEqual(Object.keys(final.paare).sort(), ['A B', 'A C'])
})

test('die Gegenprobe greift: ohne Verschmelzen geht ein Zähler verloren', () => {
	// Dieser Test ist der Beweis, dass der Test darüber etwas prüfen KANN.
	// Er bildet den alten Weg nach (laden → buchen → schreiben, ohne Merge)
	// und muss dabei den Verlust zeigen. Bliebe der Verlust aus, wäre die
	// Reparatur von M1 nicht die Ursache des grünen Tests oben.
	const pfad = frischeAblage()
	const p3 = ladeZustand(pfad)
	const p4 = ladeZustand(pfad)

	bremseVerbuche(p3, 'X', 'Y', 3_000)
	speichereZustand(p3, pfad)
	bremseVerbuche(p4, 'X', 'Z', 4_000)
	speichereZustand(p4, pfad)

	const ohne = ladeZustand(pfad)
	assert.equal(ohne.ziel.Y, undefined, 'ohne Merge muss Y verloren gehen — sonst prüft der Test oben nichts')
	assert.deepEqual(ohne.ziel.Z.map((e) => e.t), [4_000])
})

test('zwei apply()-Instanzen auf einer Datei verlieren keine Zustellung (M1, Integration)', async () => {
	// Das ist der Test, den die Gegenprobe treffen kann: zwei getrennte apply()
	// teilen sich eine Zustandsdatei — genau die Lage zweier Prozesse.
	const pfad = frischeAblage()
	const gesendet = []
	const zielB = { id: 'b2', session: {}, steer: (m) => gesendet.push(['B', m]), followup: (m) => gesendet.push(['B', m]) }
	const zielC = { id: 'c3', session: {}, steer: (m) => gesendet.push(['C', m]), followup: (m) => gesendet.push(['C', m]) }
	const absender = { id: 'a1', session: {} }
	const agenten = [absender, zielB, zielC]

	const erster = await anmelden(agenten, { pfad })
	const zweiter = await anmelden(agenten, { pfad })

	await erster.def.execute({ target: 'b2', message: 'an B' }, { agent: absender, signal: new AbortController().signal })
	// Der zweite Halter weiß nichts von der ersten Zustellung — er hat beim Laden gelesen.
	await zweiter.def.execute({ target: 'c3', message: 'an C' }, { agent: absender, signal: new AbortController().signal })

	const stand = ladeZustand(pfad)
	assert.ok(stand.ziel.b2, 'die Zustellung des ersten Halters ging verloren')
	assert.ok(stand.ziel.c3, 'die Zustellung des zweiten Halters fehlt')
	assert.equal(stand.absender.a1.length, 2, 'der Absender-Zähler muss beide Zustellungen tragen')
	assert.deepEqual(Object.keys(stand.paare).sort(), ['a1 b2', 'a1 c3'])
})

test('die Sperre schützt über echte Prozessgrenzen (M1, Gegenprobe inklusive)', async () => {
	// Die einzige ehrliche Prüfung für eine Dateisperre: mehrere PROZESSE, die sich
	// im kritischen Abschnitt überlappen. In einem Prozess lässt sich das nicht
	// zeigen — und eine Prüfung, die das nicht zeigt, prüft die Sperre nicht.
	const { spawn } = await import('node:child_process')
	const modul = new URL('../patches/send-to-session.mjs', import.meta.url).pathname

	const lauf = (zahlKinder, mitSperre) => new Promise((fertig, fehler) => {
		const heim = mkdtempSync(join(tmpdir(), 'sperre-'))
		const pfad = join(heim, 'state.json')
		const kind = (n) => `
process.env.DSH_HOME = ${JSON.stringify(heim)};
const m = await import(${JSON.stringify(modul)});
const pfad = ${JSON.stringify(pfad)};
const warte = (ms) => { const bis = Date.now() + ms; while (Date.now() < bis) {} };
const arbeit = () => {
  const stand = m.verschmelzeZustand(m.leererZustand(), m.ladeZustand(pfad));
  warte(40);
  m.bremseVerbuche(stand, 'A', 'Ziel${n}', 1000);
  m.speichereZustand(stand, pfad);
};
${mitSperre ? 'await m.mitSperre(pfad, arbeit);' : 'arbeit();'}
`
		let offen = zahlKinder
		let kaputt = null
		for (let n = 0; n < zahlKinder; n += 1) {
			const p = spawn(process.execPath, ['--input-type=module', '-e', kind(n)], { stdio: ['ignore', 'ignore', 'pipe'] })
			let err = ''
			p.stderr.on('data', (d) => { err += d })
			p.on('close', (code) => {
				if (code !== 0 && kaputt === null) kaputt = new Error(err.slice(0, 300))
				offen -= 1
				if (offen > 0) return
				if (kaputt) return fehler(kaputt)
				fertig(Object.keys(ladeZustand(pfad).ziel ?? {}).length)
			})
		}
	})

	const mit = await lauf(4, true)
	const ohne = await lauf(4, false)

	assert.equal(mit, 4, 'mit Sperre darf kein Eintrag verloren gehen')
	assert.ok(ohne < 4, `ohne Sperre muss Verlust auftreten — sonst prüft dieser Test nichts (gemessen: ${ohne} von 4)`)
})

test('das Warten auf die Sperre blockiert den Ereignisfaden nicht', async () => {
	// Das Modul läuft IM HOST-PROZESS, in dem alle Sitzungen des Menschen leben.
	// Eine leere Warteschleife würde sie alle mit einfrieren — schlimmer als der
	// Zählerverlust, den die Sperre verhindern soll. Diese Prüfung hält das fest:
	// Während der Wartezeit muss ein Timer weiterlaufen.
	const pfad = frischeAblage()
	const { writeFileSync } = await import('node:fs')
	writeFileSync(`${pfad}.lock`, 'fremder Halter') // Sperre von außen belegt

	let ticks = 0
	const uhr = setInterval(() => { ticks += 1 }, 10)
	try {
		await mitSperre(pfad, () => 'durchgelassen')
	} finally {
		clearInterval(uhr)
	}

	assert.ok(ticks >= 5, `der Ereignisfaden war blockiert — nur ${ticks} Timer-Ticks in der Wartezeit`)
})

test('verschmelzeZustand vereinigt über die Ereignis-Kennung, nicht über den Zeitstempel', () => {
	const e1 = { t: 1_000, id: 'e1' }
	const e2 = { t: 2_000, id: 'e2' }
	const e3 = { t: 3_000, id: 'e3' }
	// e2 steht in BEIDEN Ständen — dasselbe Ereignis, zweimal gesehen.
	const a = { absender: { A: [e1, e2] }, ziel: { B: [e1] }, paare: { 'A B': { zeiten: [e1], letzterText: 'eins' } } }
	const b = { absender: { A: [e2, e3] }, ziel: { C: [e3] }, paare: { 'A B': { zeiten: [e2], letzterText: 'zwei' } } }
	const zusammen = verschmelzeZustand(a, b)

	assert.deepEqual(zusammen.absender.A.map((e) => e.id).sort(), ['e1', 'e2', 'e3'], 'dasselbe Ereignis darf nicht doppelt zählen, kein Ereignis darf fehlen')
	assert.equal(zusammen.absender.A.length, 3)
	assert.deepEqual(zusammen.ziel.B.map((e) => e.t), [1_000])
	assert.deepEqual(zusammen.ziel.C.map((e) => e.t), [3_000])
	assert.deepEqual(zusammen.paare['A B'].zeiten.map((e) => e.id).sort(), ['e1', 'e2'])
	// Bei Gleichstand gewinnt der eigene Stand (der des Aufrufs).
	assert.equal(zusammen.paare['A B'].letzterText, 'eins')

	// Zwei VERSCHIEDENE Ereignisse mit gleichem Zeitstempel bleiben zwei.
	const gleich = verschmelzeZustand(
		{ absender: { A: [{ t: 500, id: 'x' }] }, ziel: {}, paare: {} },
		{ absender: { A: [{ t: 500, id: 'y' }] }, ziel: {}, paare: {} }
	)
	assert.equal(gleich.absender.A.length, 2, 'gleicher Zeitstempel, verschiedene Ereignisse: zwei')
})

test('der Zustandspfad liegt unter .tm/teams-plus (E1)', () => {
	// E1: alle eigenen Daten eines Plugins unter ~/.dsh/.tm/<plugin>.
	assert.match(zustandPfad(), /\/\.tm\/teams-plus\/state\/send-to-session\.json$/u)
	// Und er folgt DSH_HOME, damit ein Test nie in die echte Ablage schreibt.
	assert.ok(zustandPfad().startsWith(process.env.DSH_HOME ?? ''), 'der Pfad ignoriert DSH_HOME')
})

// ---------------------------------------------------------------------------
// 7. Zustellart
// ---------------------------------------------------------------------------

test('auto waehlt nach dem lebenden Zustand des Ziels, Vorgabe bleibt steer', () => {
	assert.equal(loeseModus('auto', { status: 'running' }), 'steer')
	assert.equal(loeseModus('auto', { status: 'idle' }), 'followup')
	assert.equal(loeseModus(undefined, { status: 'idle' }), 'steer', 'ohne auto bleibt die Vorgabe steer')
	assert.equal(loeseModus('followup', {}), 'followup')
	assert.equal(loeseModus('steer', { status: 'idle' }), 'steer', 'eine ausdrueckliche Wahl gewinnt')
})

// ---------------------------------------------------------------------------
// 8. Das Werkzeug gegen einen nachgebauten Agenten-Dienst
// ---------------------------------------------------------------------------

function baueKontext(agenten, optionen = {}) {
	const registriert = []
	const ctx = {
		logger: { info() {}, warn() {}, error() {} },
		get(name) {
			if (name === 'agents') {
				return optionen.ohneAgenten
					? undefined
					: {
						list: () => agenten,
						get: (id) => agenten.find((a) => a.id === id),
						roots: () => agenten.filter((a) => a.wurzel === true)
					}
			}
			if (name === 'llm') return { createUserMessage: (input) => ({ ...input, role: 'user' }) }
			return undefined
		},
		tools: { register: (def) => { registriert.push(def); return () => {} } },
		effect(fn) { fn() },
		provide() { return () => {} }
	}
	return { ctx, registriert }
}

async function anmelden(agenten, optionen = {}) {
	const pfad = optionen.pfad ?? frischeAblage()
	const { ctx, registriert } = baueKontext(agenten, optionen)
	const modul = await import('../patches/send-to-session.mjs')
	modul.apply(ctx, { pfad })
	await new Promise((r) => setTimeout(r, 300))
	return { def: registriert[0], registriert, pfad }
}

test('das Werkzeug wird angemeldet und liefert die lebenden Sitzungen ohne Ziel', async () => {
	const gesendet = []
	const ziel = { id: 'b2', session: {}, steer: (m) => gesendet.push(['steer', m]), followup: (m) => gesendet.push(['followup', m]) }
	const absender = { id: 'a1', session: {} }
	const { def, registriert } = await anmelden([absender, ziel])

	assert.equal(registriert.length, 1, 'das Werkzeug wurde nicht angemeldet')
	assert.equal(def.name, 'send_to_session')
	const props = def.parameters.properties
	assert.ok(props.target, 'der Parameter target fehlt')
	assert.ok(props.message, 'der Parameter message fehlt')
	assert.deepEqual(props.mode.enum, ['auto', 'steer', 'followup'])

	const ohneZiel = await def.execute({ message: 'Hallo' }, { agent: absender, signal: new AbortController().signal })
	assert.equal(ohneZiel.delivered, false)
	assert.equal(ohneZiel.sessions.length, 2, 'ohne Ziel muessen alle lebenden Sitzungen kommen')
	assert.match(ohneZiel.note, /no target/u)
	assert.equal(gesendet.length, 0, 'ohne Ziel darf nichts zugestellt werden')
})

test('die Zustellung geht an den naechsten Schritt, nicht in eine neue Runde', async () => {
	const gesendet = []
	const ziel = { id: 'b2', session: {}, steer: (m) => gesendet.push(['steer', m]), followup: (m) => gesendet.push(['followup', m]) }
	const absender = { id: 'a1', session: {} }
	const { def } = await anmelden([absender, ziel])

	const ergebnis = await def.execute({ target: 'b2', message: 'Bitte pruefen' }, { agent: absender, signal: new AbortController().signal })
	assert.equal(ergebnis.delivered, true)
	assert.equal(ergebnis.mode, 'steer', 'die Vorgabe muss steer sein')
	assert.equal(gesendet.length, 1)
	assert.equal(gesendet[0][0], 'steer', 'steer darf nicht followup rufen')
	const nachricht = gesendet[0][1]
	assert.equal(nachricht.role, 'user')
	assert.match(nachricht.content[0].text, /nicht vom Menschen/u)
	assert.equal(nachricht.source.kind, QUELL_ART, 'die Quelle muss die v4-taugliche Art tragen')

	// Die zugestellte Nachricht muss durch den echten Codec passen.
	assert.doesNotThrow(() =>
		releasedV4SessionFormatCodec.encodeEvent({ type: 'user/message', seq: 1, data: nachricht })
	)
})

test('die Wurzelsitzung des Menschen wird NIE geweckt (Red-Team HOCH-2)', async () => {
	// Korrektur: `steer` weckt ebenfalls (dsh-agent-loop:809-811 ruft send(…, true);
	// "an idle driver starts a turn" steht im Kernvertrag). Die einzige Zustellart
	// ohne Wecken ist `inject` — also bekommt eine Wurzel `inject`.
	const gesendet = []
	const mensch = {
		id: 'mensch',
		session: {},
		wurzel: true,
		steer: (m) => gesendet.push(['steer', m]),
		followup: (m) => gesendet.push(['followup', m]),
		inject: (m) => gesendet.push(['inject', m])
	}
	const absender = { id: 'a1', session: {} }
	const { def } = await anmelden([absender, mensch])

	for (const mode of ['followup', 'steer', 'auto']) {
		// Je Modus eine frische Instanz, sonst greift das Paar-Budget (2 je Paar)
		// und der Test misst das Falsche.
		gesendet.length = 0
		const frisch = await anmelden([absender, mensch])
		const e = await frisch.def.execute({ target: 'mensch', message: 'Hallo ' + mode, mode }, { agent: absender, signal: new AbortController().signal })
		assert.equal(e.delivered, true, 'Modus ' + mode + ' wurde nicht zugestellt')
		assert.equal(e.mode, 'inject', 'Modus ' + mode + ' auf einer Wurzel muss inject werden')
		assert.equal(gesendet[0][0], 'inject', 'weder steer noch followup duerfen die Menschensitzung wecken')
	}
})

test('ein werfendes roots() zerstoert den Werkzeugaufruf nicht (MITTEL-4)', async () => {
	const gesendet = []
	const mensch = { id: 'mensch', session: {}, steer: (m) => gesendet.push(['steer', m]), followup: (m) => gesendet.push(['followup', m]), inject: (m) => gesendet.push(['inject', m]) }
	const absender = { id: 'a1', session: {} }
	const { ctx, registriert } = baueKontext([absender, mensch])
	const original = ctx.get
	ctx.get = (name) => {
		const d = original(name)
		if (name === 'agents' && d) return { list: d.list, get: d.get, roots: () => { throw new Error('roots kaputt') } }
		return d
	}
	const modul = await import('../patches/send-to-session.mjs')
	modul.apply(ctx, { pfad: frischeAblage() })
	await new Promise((r) => setTimeout(r, 300))

	const e = await registriert[0].execute({ target: 'mensch', message: 'Hallo' }, { agent: absender, signal: new AbortController().signal })
	assert.equal(e.delivered, true, 'ein werfendes roots() darf die Zustellung nicht verhindern')
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

test('das Paar-Budget greift im Werkzeug: die dritte Nachricht an dasselbe Ziel wird abgewiesen', async () => {
	const gesendet = []
	const ziel = { id: 'b2', session: {}, steer: (m) => gesendet.push(m), followup: (m) => gesendet.push(m) }
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

test('die Schutzbremse je Ziel greift auch im Werkzeug', async () => {
	const gesendet = []
	const ziel = { id: 'b2', session: {}, steer: (m) => gesendet.push(m), followup: (m) => gesendet.push(m) }
	const absender = { id: 'a1', session: {} }
	const { def } = await anmelden([absender, ziel])

	const laeufe = []
	for (let i = 0; i < 8; i += 1) {
		laeufe.push(await def.execute({ target: 'b2', message: `Nr ${i}` }, { agent: absender, signal: new AbortController().signal }))
	}
	assert.equal(laeufe.filter((e) => e.delivered).length, 2, 'nach zwei Nachrichten je Paar ist Schluss')
	const spaeter = laeufe.filter((e) => e.delivered === false)
	assert.ok(spaeter.every((e) => /PING_PONG|REPEATED_MESSAGE/u.test(e.note)), 'jede weitere braucht einen Kettenbefund')
})

test('die Tests schreiben nicht ins echte ~/.dsh des Menschen', () => {
	assert.match(process.env.DSH_HOME ?? '', /s2s-home-/u)
	assert.ok(!String(process.env.DSH_HOME).startsWith(join(process.env.HOME ?? '', '.dsh')))
	// Der Zustandspfad folgt DSH_HOME: der Test darf die echte Ablage nie anfassen.
	assert.ok(zustandPfad().startsWith(process.env.DSH_HOME), `Zustandspfad zeigt nicht auf DSH_HOME: ${zustandPfad()}`)
	void readFileSync
	void existsSync
})
