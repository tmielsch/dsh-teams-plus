/**
 * team-modus.test.mjs — Filter, Bericht, Wächter, Übersicht, Notschalter, Selbsttest
 * =================================================================================
 *
 * Geprüft wird `patches/team-modus.mjs` gegen eine Attrappe des Hosts. Was hier NICHT messbar ist (der echte
 * Kern, der echte Rundentreiber), prüft die Probe-Instanz: `docs/messung-gespraechsmodus/abnahme-team-modus.mjs`.
 *
 * Hermetisch: `HOME` und `DSH_HOME` zeigen auf ein Temp-Verzeichnis, bevor das Modul geladen wird.
 *
 * Gegenprobe am Code (Prüfung 12 unten): eine Kopie des Moduls, in der der Filter nichts verwirft, muss die
 * Prüfung „verwirft“ ROT machen. Ein Test, der mit der Kopie genauso grün wäre, prüfte nichts.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const HEIM = mkdtempSync(join(tmpdir(), 'team-modus-home-'))
process.env.HOME = HEIM
process.env.USERPROFILE = HEIM
process.env.DSH_HOME = join(HEIM, '.dsh')

const MODUL = new URL('../patches/team-modus.mjs', import.meta.url).pathname
const MODUL_DATEI = process.env.TEAM_MODUS_MODUL ?? MODUL

const M = await import(MODUL_DATEI)
const {
	apply, entscheide, istAbschlussOhneBefund, istTeamModus, notschalterGedrueckt, notschalterPfad,
	pruefeAbschluss, selbsttest, umwickleSend, wurzelVon, leseBericht, hatBericht, schreibeBericht,
	baueBerichtWerkzeug, baueStandWerkzeug, HINWEIS_OHNE_BERICHT, protokollPfad
} = M

const warte = (ms) => new Promise((fertig) => setTimeout(fertig, ms))

// ---------------------------------------------------------------------------------------------------
// Bausteine der Attrappe
// ---------------------------------------------------------------------------------------------------

const SATZ_FERTIG = (kind) => `Background subagent ${kind} finished and will do no further work unless you send it more.`
const SATZ_ABBRUCH = (kind) => `Background subagent ${kind} was stopped before it finished.`
const SATZ_FEHLER = (kind) => `Background subagent ${kind} failed before it finished.`

/** Eine Kernmeldung, so geformt wie `createSettlementMessage`. */
function kernMeldung(kind, satz) {
	return { id: `m-${Math.random().toString(36).slice(2)}`, role: 'user', content: [{ type: 'text', text: satz }, { type: 'text', text: 'It left no closing message.' }], source: { kind: 'subagent-settled', form: 'notice', summary: satz, senderSessionId: kind } }
}

/** Ein Agent mit einer zählenden `send`-Methode (Prototyp-Methode, wie beim echten Agenten). */
class AttrappenAgent {
	constructor(id, eltern) {
		this.id = id
		this.session = { header: { parentSession: eltern }, seq: 5, snapshotEvents: () => [{ time: Date.parse('2026-11-09T20:00:00Z') }] }
		this.zugestellt = []
		this.gesteuert = []
	}
	send(nachricht, ziel, wecken) { this.zugestellt.push({ nachricht, ziel, wecken }) }
	steer(nachricht) { this.gesteuert.push(nachricht) }
}

/** Eine Szene: Lead (Wurzel) mit Mitgliedern, Fork als zweite Wurzel, Ziele je Agent. */
function baueSzene(optionen = {}) {
	const agenten = new Map()
	const wurzeln = []
	const ziele = new Map()
	const mitglieder = optionen.mitglieder ?? [{ role: 'lead', name: 'lead', id: 'lead', status: 'inactive' }, { role: 'teammate', name: 'exp', id: 'exp', status: 'inactive' }]
	const dienst = { listMembers: () => mitglieder }
	const registry = {
		get: (id) => agenten.get(id),
		list: () => [...agenten.values()],
		roots: () => [...wurzeln]
	}
	const ordner = mkdtempSync(join(tmpdir(), 'team-modus-berichte-'))
	const umgebung = {
		agenten: registry,
		teams: () => (optionen.ohneTeamDienst ? undefined : dienst),
		notschalter: () => notschalterGedrueckt(() => {}, optionen.notschalterPfad ?? join(HEIM, 'gibt-es-nicht.json')),
		ziel: (agent) => ziele.get(agent),
		beobachte: async () => optionen.beobachtung
	}
	umgebung.leseMitglied = (zeile, o) => M.leseMitglied(zeile, umgebung, o)
	const neu = (id, eltern, istWurzel = false) => {
		const agent = new AttrappenAgent(id, eltern)
		agenten.set(id, agent)
		if (istWurzel) wurzeln.push(agent)
		return agent
	}
	const lead = neu('lead', undefined, true)
	const exp = neu('exp', 'lead')
	const worker = neu('worker', 'exp')
	const fork = neu('fork', 'lead', true)
	return { agenten, ziele, mitglieder, dienst, registry, umgebung, ordner, lead, exp, worker, fork }
}

const ziel = (id, zusatz = {}) => ({ id, revision: 1, objective: 'Probe-Ziel', phase: 'active', activation: 'armed', roundsStarted: 2, maxGoalRounds: 10, ...zusatz })

// ---------------------------------------------------------------------------------------------------
// 1. Der Filter verwirft genau „normal fertig“ im Team-Modus
// ---------------------------------------------------------------------------------------------------

test('1. Team-Modus: die Meldung „finished“ wird verworfen, der Lead bekommt nichts', () => {
	const s = baueSzene()
	const rueck = umwickleSend(s.lead, (a, n) => entscheide(a, n, s.umgebung))
	s.lead.send(kernMeldung('exp', SATZ_FERTIG('exp')), 'next-turn', true)
	assert.equal(s.lead.zugestellt.length, 0, 'verworfen, nicht zugestellt')
	rueck()
})

test('2. Fehler und Abbruch bleiben laut, ebenso jede unbekannte Form', () => {
	const s = baueSzene()
	umwickleSend(s.lead, (a, n) => entscheide(a, n, s.umgebung))
	s.lead.send(kernMeldung('exp', SATZ_ABBRUCH('exp')), 'next-turn', true)
	s.lead.send(kernMeldung('exp', SATZ_FEHLER('exp')), 'next-turn', true)
	s.lead.send(kernMeldung('exp', 'Background subagent exp ran out of room before it finished.'), 'next-turn', true)
	s.lead.send(kernMeldung('exp', 'Background subagent exp declined the task.'), 'next-turn', true)
	s.lead.send(kernMeldung('exp', 'Etwas ganz Neues, das ein Update erfunden hat.'), 'next-turn', true)
	// „finished“ mit Zusatz am Satzende ist NICHT der volle Satz: bleibt laut
	s.lead.send(kernMeldung('exp', SATZ_FERTIG('exp') + ' (mit Zusatz)'), 'next-turn', true)
	assert.equal(s.lead.zugestellt.length, 6, 'alle sechs kommen an')
})

test('3. Nachrichten von Agenten, Task-Updates und des Menschen gehen unverändert durch', () => {
	const s = baueSzene()
	umwickleSend(s.lead, (a, n) => entscheide(a, n, s.umgebung))
	for (const art of ['team-message', 'agent-message', 'user', 'plugin:@tmielsch/dsh-teams-plus', 'goal']) {
		s.lead.send({ id: art, role: 'user', content: [{ type: 'text', text: 'x' }], source: { kind: art } }, 'next-step', true)
	}
	assert.equal(s.lead.zugestellt.length, 5)
	assert.deepEqual(s.lead.zugestellt.map((z) => z.ziel), Array(5).fill('next-step'), 'Ziel und Wecken bleiben unverändert')
})

test('4. Kein Team-Modus: ohne Mitglied, mit ruhendem Team, mit Notschalter, als Fork — alles wie heute', () => {
	const meldung = (s) => kernMeldung('exp', SATZ_FERTIG('exp'))
	// (a) kein Teammitglied
	let s = baueSzene({ mitglieder: [{ role: 'lead', name: 'lead', id: 'lead', status: 'inactive' }] })
	umwickleSend(s.lead, (a, n) => entscheide(a, n, s.umgebung)); s.lead.send(meldung(s), 'next-turn', true)
	assert.equal(s.lead.zugestellt.length, 1, 'ohne Mitglied wird nichts verworfen')
	// (b) Team ruht (/team rest) und ein fehlgeschlagenes Mitglied
	s = baueSzene({ mitglieder: [{ role: 'lead', id: 'lead', status: 'inactive' }, { role: 'teammate', name: 'a', id: 'a', status: 'resting' }, { role: 'teammate', name: 'b', id: 'b', status: 'failed' }] })
	umwickleSend(s.lead, (a, n) => entscheide(a, n, s.umgebung)); s.lead.send(meldung(s), 'next-turn', true)
	assert.equal(s.lead.zugestellt.length, 1, 'ruhendes oder fehlgeschlagenes Team ist kein Team-Modus')
	// (c) Notschalter
	const pfad = join(HEIM, 'notschalter-test.json'); writeFileSync(pfad, JSON.stringify({ aus: true }))
	s = baueSzene({ notschalterPfad: pfad })
	umwickleSend(s.lead, (a, n) => entscheide(a, n, s.umgebung)); s.lead.send(meldung(s), 'next-turn', true)
	assert.equal(s.lead.zugestellt.length, 1, 'Notschalter gedrückt: alles wie heute')
	// (d) Fork des Leads: eigene Wurzel, leeres Team
	s = baueSzene({ mitglieder: [{ role: 'lead', id: 'fork', status: 'inactive' }] })
	umwickleSend(s.fork, (a, n) => entscheide(a, n, s.umgebung)); s.fork.send(meldung(s), 'next-turn', true)
	assert.equal(s.fork.zugestellt.length, 1, 'ein Fork ist nicht im Team-Modus')
	assert.equal(wurzelVon(s.registry, s.fork), s.fork, 'der Fork ist seine eigene Wurzel, nicht der Lead')
})

test('5. Der Team-Modus gilt für den ganzen Baum: der Experte filtert die Meldungen seiner Facharbeiter', () => {
	const s = baueSzene()
	assert.equal(wurzelVon(s.registry, s.worker), s.lead, 'der Facharbeiter hängt unter dem Lead')
	umwickleSend(s.exp, (a, n) => entscheide(a, n, s.umgebung))
	s.exp.send(kernMeldung('worker', SATZ_FERTIG('worker')), 'next-turn', true)
	s.exp.send(kernMeldung('worker', SATZ_FEHLER('worker')), 'next-turn', true)
	assert.equal(s.exp.zugestellt.length, 1, 'fertig verworfen, Fehler durchgelassen')
	assert.match(s.exp.zugestellt[0].nachricht.content[0].text, /failed/)
})

test('6. Umwickeln ist rückholbar, einmalig und fail-open', () => {
	const s = baueSzene()
	const original = AttrappenAgent.prototype.send
	const rueck = umwickleSend(s.lead, (a, n) => entscheide(a, n, s.umgebung))
	assert.notEqual(s.lead.send, original, 'umwickelt')
	assert.equal(umwickleSend(s.lead, () => ({ aktion: 'verwerfen' })), undefined, 'ein zweites Umwickeln ist ein No-op')
	rueck()
	assert.equal(s.lead.send, original, 'der Prototyp ist wieder da (keine eigene Eigenschaft übrig)')
	assert.equal(Object.hasOwn(s.lead, 'send'), false)
	// Der Filter wirft: die Nachricht geht trotzdem durch.
	umwickleSend(s.exp, () => { throw new Error('kaputt') })
	s.exp.send(kernMeldung('worker', SATZ_FERTIG('worker')), 'next-turn', true)
	assert.equal(s.exp.zugestellt.length, 1, 'bei einer Ausnahme im Filter wird zugestellt')
})

// ---------------------------------------------------------------------------------------------------
// 2. Bericht und Wächter
// ---------------------------------------------------------------------------------------------------

const ausfuehrung = (agent, aktion, name = 'update_goal') => ({ name, agent, arguments: { goal_id: 'g1', revision: 1, action: aktion } })

test('7. Wächter: complete ohne Bericht wird abgelehnt, mit Bericht erlaubt', () => {
	const s = baueSzene()
	s.ziele.set(s.exp, ziel('g1'))
	assert.equal(pruefeAbschluss(ausfuehrung(s.exp, 'complete'), s.umgebung, s.ordner), HINWEIS_OHNE_BERICHT)
	assert.equal(pruefeAbschluss({ ...ausfuehrung(s.exp, 'complete'), arguments: JSON.stringify({ action: 'complete' }) }, s.umgebung, s.ordner), HINWEIS_OHNE_BERICHT, 'auch mit Argumenten als Text')
	schreibeBericht({ zielId: 'g1', revision: 1, sitzung: 'exp', bericht: 'Fertig, siehe Pfad.' }, s.ordner)
	assert.equal(pruefeAbschluss(ausfuehrung(s.exp, 'complete'), s.umgebung, s.ordner), undefined, 'mit Bericht erlaubt')
})

test('8. Wächter: andere Aktionen, andere Werkzeuge, die Wurzel und „kein Team-Modus“ bleiben unberührt', () => {
	const s = baueSzene()
	s.ziele.set(s.exp, ziel('g1')); s.ziele.set(s.lead, ziel('gl'))
	for (const aktion of ['edit', 'pause', 'resume', 'blocked']) assert.equal(pruefeAbschluss(ausfuehrung(s.exp, aktion), s.umgebung, s.ordner), undefined, aktion)
	assert.equal(pruefeAbschluss(ausfuehrung(s.exp, 'complete', 'send_message'), s.umgebung, s.ordner), undefined, 'anderes Werkzeug')
	assert.equal(pruefeAbschluss(ausfuehrung(s.lead, 'complete'), s.umgebung, s.ordner), undefined, 'Wurzel hat keinen Vorgesetzten')
	const ohneTeam = baueSzene({ mitglieder: [{ role: 'lead', id: 'lead', status: 'inactive' }] })
	ohneTeam.ziele.set(ohneTeam.exp, ziel('g1'))
	assert.equal(pruefeAbschluss(ausfuehrung(ohneTeam.exp, 'complete'), ohneTeam.umgebung, ohneTeam.ordner), undefined, 'kein Team-Modus')
	// Ausnahme beim Lesen des Ziels: durchlassen
	const kaputt = baueSzene(); kaputt.umgebung.ziel = () => { throw new Error('agent is not live') }
	assert.equal(pruefeAbschluss(ausfuehrung(kaputt.exp, 'complete'), kaputt.umgebung, kaputt.ordner), undefined, 'fail open')
})

test('9. goal_report speichert; leerer Bericht und fehlendes Ziel scheitern verständlich', async () => {
	const s = baueSzene()
	s.ziele.set(s.exp, ziel('g9'))
	const werkzeug = baueBerichtWerkzeug({ defineTool: (d) => d, umgebung: s.umgebung, ordner: s.ordner })
	const antwort = await werkzeug.execute({ bericht: '  Ergebnis X, Beleg Y.  ' }, { agent: s.exp })
	assert.equal(antwort.gespeichert, true)
	assert.equal(leseBericht('g9', s.ordner).bericht, 'Ergebnis X, Beleg Y.')
	assert.equal(hatBericht('g9', s.ordner), true)
	await assert.rejects(() => werkzeug.execute({ bericht: '   ' }, { agent: s.exp }), /empty/)
	await assert.rejects(() => werkzeug.execute({ bericht: 'x' }, { agent: s.worker }), /no goal/)
	assert.equal(werkzeug.name, 'goal_report')
	assert.ok(werkzeug.description.includes('exactly once'))
})

/** Löst die Ziel-Ereignisse der Anwendung aus. */
function startePlugin(s, optionen = {}) {
	const horcher = new Map()
	const werkzeuge = []
	const warnungen = []
	const wächter = []
	let abbau
	const ctx = {
		agents: s.registry, goals: { get: (a) => s.ziele.get(a) },
		tools: { guard: (f) => { wächter.push(f); return () => {} }, register: (d) => { werkzeuge.push(d); return () => {} } },
		logger: { info: () => {}, warn: (t) => warnungen.push(t) },
		on: (e, f) => { if (!horcher.has(e)) horcher.set(e, []); horcher.get(e).push(f); return () => {} },
		effect: (fn) => { abbau = fn(); return () => abbau?.() },
		get: (d) => { if (d === 'agentTeams' && !optionen.ohneTeamDienst) return s.dienst; if (d === 'sessionQuery' && optionen.beobachtung) return { observeSession: async () => optionen.beobachtung }; throw new Error('service not found') }
	}
	apply(ctx, { ordner: s.ordner })
	const ausloesen = (ereignis, daten) => { for (const f of horcher.get(ereignis) ?? []) f(daten) }
	return { ctx, ausloesen, werkzeuge, warnungen, wächter, abbau: () => abbau?.() }
}

test('10. Ziel erreicht: der Bericht geht GENAU EINMAL an den Vorgesetzten; Blockade wird gemeldet', async () => {
	const s = baueSzene()
	s.ziele.set(s.exp, ziel('g10', { phase: 'complete' }))
	schreibeBericht({ zielId: 'g10', revision: 1, sitzung: 'exp', bericht: 'Alles erreicht. Beleg: Datei A.' }, s.ordner)
	const p = startePlugin(s)
	const abschluss = { agent: s.exp, change: { operation: 'complete', goal: { id: 'g10', objective: 'Probe-Ziel' } } }
	p.ausloesen('goal/changed', abschluss)
	p.ausloesen('goal/changed', abschluss) // Wiederholung: darf nicht doppelt zustellen
	assert.equal(s.lead.gesteuert.length, 1, 'genau eine Zustellung')
	assert.match(s.lead.gesteuert[0].content[0].text, /Schlussbericht/)
	assert.match(s.lead.gesteuert[0].content[0].text, /Beleg: Datei A\./, 'der Text des Agenten, keine Statuszeile')
	assert.equal(s.lead.gesteuert[0].source.kind, 'plugin:@tmielsch/dsh-teams-plus', 'Art ohne Berechtigung')
	assert.equal(s.lead.gesteuert[0].source.senderSessionId, 'exp')
	assert.equal(leseBericht('g10', s.ordner).zugestellt, true)
	// Blockade
	p.ausloesen('goal/changed', { agent: s.exp, change: { operation: 'block', goal: { id: 'g10b', objective: 'Probe-Ziel', blockedReason: { code: 'no-access', message: 'Datei gesperrt' } } } })
	assert.equal(s.lead.gesteuert.length, 2)
	assert.match(s.lead.gesteuert[1].content[0].text, /no-access/)
	// Die Wurzel meldet an niemanden; kein Team-Modus meldet nichts
	p.ausloesen('goal/changed', { agent: s.lead, change: { operation: 'complete', goal: { id: 'g10', objective: 'x' } } })
	assert.equal(s.lead.gesteuert.length, 2)
	// complete ohne Bericht: nichts zuzustellen
	p.ausloesen('goal/changed', { agent: s.exp, change: { operation: 'complete', goal: { id: 'ohne', objective: 'x' } } })
	assert.equal(s.lead.gesteuert.length, 2)
	p.abbau()
})

// ---------------------------------------------------------------------------------------------------
// 3. Übersicht, Notschalter, Selbsttest
// ---------------------------------------------------------------------------------------------------

test('11. team_stand: lebend und gespeichert, ohne jemanden zu wecken', async () => {
	const beobachtung = { projections: { values: { goal: { goal: { id: 'gs', revision: 3, objective: 'Gespeichertes Ziel', phase: 'paused', maxGoalRounds: 40 }, roundsStarted: 7 } } }, events: [{ time: Date.parse('2026-11-09T19:00:00Z') }], [Symbol.dispose]() { this.freigegeben = true } }
	const s = baueSzene({ mitglieder: [{ role: 'lead', id: 'lead', status: 'inactive' }, { role: 'teammate', name: 'exp', id: 'exp', status: 'running' }, { role: 'teammate', name: 'alt', id: 'alt-id', status: 'inactive' }], beobachtung })
	s.ziele.set(s.exp, ziel('g11'))
	schreibeBericht({ zielId: 'g11', revision: 1, sitzung: 'exp', bericht: 'x' }, s.ordner)
	const werkzeug = baueStandWerkzeug({ defineTool: (d) => d, umgebung: s.umgebung, ordner: s.ordner })
	const stand = await werkzeug.execute({}, { agent: s.lead })
	assert.equal(stand.teamModus, true)
	assert.equal(stand.mitglieder.length, 2)
	const exp = stand.mitglieder.find((m) => m.name === 'exp'), alt = stand.mitglieder.find((m) => m.name === 'alt')
	assert.equal(exp.gelesenAus, 'lebender Agent'); assert.equal(exp.ziel.phase, 'active'); assert.equal(exp.bericht, true); assert.equal(exp.ziel.runden, 2)
	assert.equal(alt.gelesenAus, 'gespeicherte Sitzung'); assert.equal(alt.ziel.phase, 'paused'); assert.equal(alt.ziel.runden, 7); assert.equal(alt.zeitLetztesEreignis, '2026-11-09T19:00:00.000Z')
	assert.equal(beobachtung.freigegeben, true, 'die Beobachtung wurde freigegeben')
	assert.equal(s.lead.zugestellt.length + s.exp.zugestellt.length + s.lead.gesteuert.length, 0, 'niemand wurde angeschrieben')
	// nicht lesbar → verständliche Zeile statt Fehler
	const ohne = baueSzene({ mitglieder: [{ role: 'lead', id: 'lead', status: 'inactive' }, { role: 'teammate', name: 'weg', id: 'weg', status: 'inactive' }] })
	const w2 = baueStandWerkzeug({ defineTool: (d) => d, umgebung: ohne.umgebung, ordner: ohne.ordner })
	assert.equal((await w2.execute({}, { agent: ohne.lead })).mitglieder[0].gelesenAus, 'nicht lesbar')
})

test('12. Notschalter: aus:true schaltet ab, kaputte Datei zählt als aus und wird EINMAL gemeldet', () => {
	const pfad = join(HEIM, 'notschalter-2.json')
	assert.equal(notschalterGedrueckt(() => {}, pfad), false, 'ohne Datei an')
	writeFileSync(pfad, JSON.stringify({ aus: false })); assert.equal(notschalterGedrueckt(() => {}, pfad), false)
	writeFileSync(pfad, JSON.stringify({ aus: true, zusatz: 1 })); assert.equal(notschalterGedrueckt(() => {}, pfad), true)
	const meldungen = []
	writeFileSync(pfad, '{ das ist kein json')
	assert.equal(notschalterGedrueckt((t) => meldungen.push(t), pfad), true, 'kaputt = aus')
	assert.equal(notschalterGedrueckt((t) => meldungen.push(t), pfad), true)
	assert.equal(meldungen.length, 1, 'nur eine Meldung je Stand der Datei')
	writeFileSync(pfad, JSON.stringify([1])); assert.equal(notschalterGedrueckt(() => {}, pfad), true, 'ein Array ist kein Objekt')
	writeFileSync(pfad, JSON.stringify({ aus: 'true' })); assert.equal(notschalterGedrueckt(() => {}, pfad), false, 'nur das echte true zählt')
})

test('13. Selbsttest meldet jede fehlende Schnittstelle, und apply warnt laut', async () => {
	assert.deepEqual(selbsttest({ defineTool: true, guard: true, teams: true, agentenListe: true, berichtOrdnerSchreibbar: true }), { ok: true, abweichungen: [] })
	const schlecht = selbsttest({ defineTool: false, guard: false, teams: false, agentenListe: false, berichtOrdnerSchreibbar: false })
	assert.equal(schlecht.ok, false); assert.equal(schlecht.abweichungen.length, 5)
	// apply ohne Team-Dienst: Warnung im Logger
	const s = baueSzene({ ohneTeamDienst: true })
	const p = startePlugin(s, { ohneTeamDienst: true })
	await warte(300)
	assert.ok(p.warnungen.some((t) => /selbsttest ABWEICHUNG/.test(t) && /agentTeams/.test(t)), 'Abweichung wird laut gemeldet: ' + JSON.stringify(p.warnungen))
	// ohne Team-Dienst gilt nie Team-Modus
	assert.equal(istTeamModus(s.lead, s.umgebung), false)
	p.abbau()
})

test('14. apply: umwickelt vorhandene und neue Agenten, meldet Selbsttest ok, baut rückstandsfrei ab', async () => {
	const s = baueSzene()
	const original = AttrappenAgent.prototype.send
	const p = startePlugin(s)
	await warte(300)
	for (const a of [s.lead, s.exp, s.worker, s.fork]) assert.notEqual(a.send, original, a.id + ' umwickelt')
	const neu = new AttrappenAgent('neu', 'lead'); s.agenten.set('neu', neu)
	p.ausloesen('agent/created', { agent: neu })
	assert.notEqual(neu.send, original, 'ein neuer Agent wird beim Anlegen umwickelt')
	assert.deepEqual(p.werkzeuge.map((w) => w.name).sort(), ['goal_report', 'team_stand'])
	assert.equal(p.warnungen.length, 0, 'keine Warnung beim Normalfall: ' + JSON.stringify(p.warnungen))
	// Ende-zu-Ende über die Anwendung: die Kernmeldung wird verworfen
	s.lead.send(kernMeldung('exp', SATZ_FERTIG('exp')), 'next-turn', true)
	assert.equal(s.lead.zugestellt.length, 0)
	p.abbau()
	for (const a of [s.lead, s.exp, s.worker, s.fork, neu]) assert.equal(Object.hasOwn(a, 'send'), false, a.id + ' wieder auf dem Prototyp')
	s.lead.send(kernMeldung('exp', SATZ_FERTIG('exp')), 'next-turn', true)
	assert.equal(s.lead.zugestellt.length, 1, 'nach dem Abbau verhält sich alles wie heute')
	assert.ok(existsSync(protokollPfad()), 'es gibt ein Protokoll')
	assert.match(readFileSync(protokollPfad(), 'utf8'), /verworfen empfaenger=lead art=subagent-settled/)
})

// ---------------------------------------------------------------------------------------------------
// 4. Gegenprobe am Code: ohne Filter wird die Prüfung ROT
// ---------------------------------------------------------------------------------------------------

test('15. Gegenprobe: eine Kopie, in der der Filter nie verwirft, macht die Prüfung „verwirft“ rot', async () => {
	if (process.env.TEAM_MODUS_MODUL) return // läuft schon gegen eine Kopie
	const quelle = readFileSync(MODUL, 'utf8')
	const mutiert = quelle
		.replace('if (!istAbschlussOhneBefund(nachricht)) return { aktion: "durchlassen"', 'if (true) return { aktion: "durchlassen"')
		.replace('from "./send-to-session.mjs"', `from "${pathToFileURL(join(new URL('../patches', import.meta.url).pathname, 'send-to-session.mjs')).href}"`)
	assert.notEqual(mutiert, quelle, 'die Mutation hat etwas geändert')
	const datei = join(mkdtempSync(join(tmpdir(), 'team-modus-mutant-')), 'team-modus-mutant.mjs')
	writeFileSync(datei, mutiert)
	const mut = await import(pathToFileURL(datei).href)
	const verwirft = (modul) => {
		const s = baueSzene()
		modul.umwickleSend(s.lead, (a, n) => modul.entscheide(a, n, s.umgebung))
		s.lead.send(kernMeldung('exp', SATZ_FERTIG('exp')), 'next-turn', true)
		return s.lead.zugestellt.length === 0
	}
	assert.equal(verwirft(M), true, 'das echte Modul verwirft')
	assert.equal(verwirft(mut), false, 'die Kopie ohne Filter verwirft NICHT: die Prüfung ist nicht leer')
})

test('16. Gegenprobe: eine Kopie ohne Wächter-Prüfung lässt complete ohne Bericht durch', async () => {
	if (process.env.TEAM_MODUS_MODUL) return
	const quelle = readFileSync(MODUL, 'utf8')
	const mutiert = quelle
		.replace('return hatBericht(ziel.id, ordner) ? undefined : HINWEIS_OHNE_BERICHT;', 'return undefined;')
		.replace('from "./send-to-session.mjs"', `from "${pathToFileURL(join(new URL('../patches', import.meta.url).pathname, 'send-to-session.mjs')).href}"`)
	assert.notEqual(mutiert, quelle)
	const datei = join(mkdtempSync(join(tmpdir(), 'team-modus-mutant2-')), 'team-modus-mutant.mjs')
	writeFileSync(datei, mutiert)
	const mut = await import(pathToFileURL(datei).href)
	const s = baueSzene(); s.ziele.set(s.exp, ziel('g1'))
	assert.equal(M.pruefeAbschluss(ausfuehrung(s.exp, 'complete'), s.umgebung, s.ordner), HINWEIS_OHNE_BERICHT, 'echtes Modul lehnt ab')
	assert.equal(mut.pruefeAbschluss(ausfuehrung(s.exp, 'complete'), s.umgebung, s.ordner), undefined, 'die Kopie lehnt nicht ab')
})
