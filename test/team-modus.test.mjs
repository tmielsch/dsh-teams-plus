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
import { join, dirname } from 'node:path'
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
	baueBerichtWerkzeug, baueStandWerkzeug, HINWEIS_OHNE_BERICHT, protokollPfad,
	uebernehmeGespraech, pruefeSendMessage, baueAuftragWerkzeug, baueFrageWerkzeug, HINWEIS_SEND_MESSAGE, HINWEIS_OHNE_ZIELBRIEF, uebernahmenPfad, fragenPfad, leseUebernahmen
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
		this.status = 'inactive'
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
	const aufrufe = []
	let abbau
	const ctx = {
		agents: s.registry,
		goals: {
			get: (a) => s.ziele.get(a),
			disarm: (a) => { aufrufe.push(['disarm', a.id]); const z = s.ziele.get(a); if (z) s.ziele.set(a, { ...z, activation: 'disarmed' }); return s.ziele.get(a) },
			pause: (a, ref) => { aufrufe.push(['pause', a.id, ref.id]); const z = s.ziele.get(a); if (z) s.ziele.set(a, { ...z, phase: 'paused' }); return s.ziele.get(a) },
			create: (a, anfrage) => { aufrufe.push(['create', a.id, anfrage]); const z = ziel('neu-' + a.id, { objective: anfrage.objective, maxGoalRounds: anfrage.maxGoalRounds }); s.ziele.set(a, z); return z }
		},
		tools: { guard: (f) => { wächter.push(f); return () => {} }, register: (d) => { werkzeuge.push(d); return () => {} } },
		logger: { info: () => {}, warn: (t) => warnungen.push(t) },
		on: (e, f) => { if (!horcher.has(e)) horcher.set(e, []); horcher.get(e).push(f); return () => {} },
		effect: (fn) => { abbau = fn(); return () => abbau?.() },
		get: (d) => { if (d === 'agentTeams' && !optionen.ohneTeamDienst) return s.dienst; if (d === 'sessionQuery' && optionen.beobachtung) return { observeSession: async () => optionen.beobachtung }; throw new Error('service not found') }
	}
	apply(ctx, { ordner: s.ordner })
	const ausloesen = (ereignis, daten) => { for (const f of horcher.get(ereignis) ?? []) f(daten) }
	return { ctx, ausloesen, werkzeuge, warnungen, wächter, aufrufe, abbau: () => abbau?.() }
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
	assert.deepEqual(p.werkzeuge.map((w) => w.name).sort(), ['ask_question', 'give_task', 'goal_report', 'team_stand'])
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

// ---------------------------------------------------------------------------------------------------
// 5. Gesprächsübernahme (F3) und die Kanäle (F5, Weg A)
// ---------------------------------------------------------------------------------------------------

const leereUebernahmen = () => M.schreibeUebernahmen([])
const mensch = (text = 'Hallo Experte') => ({ id: 'h-' + Math.random(), role: 'user', content: [{ type: 'text', text }], source: { kind: 'user', rpcId: 'rpc-1' } })

test('17. Übernahme: der Mensch schreibt einem Mitglied mit laufendem Ziel — entwaffnet, pausiert, EINE Meldung nach oben, Nachricht kommt an', async () => {
	leereUebernahmen()
	const s = baueSzene(); s.ziele.set(s.exp, ziel('g17'))
	const p = startePlugin(s); await warte(300)
	s.exp.send(mensch('erste'), 'next-turn', true)
	assert.deepEqual(p.aufrufe.map((a) => a[0]), ['disarm', 'pause'], 'erst entwaffnet, dann (ruhig) pausiert')
	assert.equal(s.exp.zugestellt.length, 1, 'die Nachricht des Menschen wird zugestellt')
	assert.equal(s.lead.gesteuert.length, 1, 'genau eine Meldung an den Vorgesetzten')
	assert.match(s.lead.gesteuert[0].content[0].text, /Mensch hat Kommunikation mit Agent exp übernommen, stand by/)
	s.exp.send(mensch('zweite'), 'next-turn', true); s.exp.send(mensch('dritte'), 'next-turn', true)
	assert.equal(s.lead.gesteuert.length, 1, 'weitere Nachrichten melden nichts')
	assert.equal(s.exp.zugestellt.length, 3)
	assert.equal(p.aufrufe.filter((a) => a[0] === 'disarm').length, 1, 'nur einmal entwaffnet')
	assert.equal(leseUebernahmen().some((e) => e.id === 'exp'), true, 'die Liste der Übernahmen steht in der Datei')
	p.abbau()
})

test('18. Übernahme während eine Runde läuft: die Runde läuft zu Ende, die Pause folgt, wenn der Agent ruhig ist', async () => {
	leereUebernahmen()
	const s = baueSzene(); s.ziele.set(s.worker, ziel('g18'))
	s.worker.status = 'running'
	const p = startePlugin(s); await warte(300)
	s.worker.send(mensch(), 'next-turn', true)
	assert.deepEqual(p.aufrufe.map((a) => a[0]), ['disarm'], 'laufend: nur entwaffnet, keine Pause, kein Abbruch')
	p.ausloesen('agent/status', { agent: s.worker, status: 'running' })
	assert.deepEqual(p.aufrufe.map((a) => a[0]), ['disarm'])
	s.worker.status = 'inactive'
	p.ausloesen('agent/status', { agent: s.worker, status: 'inactive' })
	assert.deepEqual(p.aufrufe.map((a) => a[0]), ['disarm', 'pause'], 'nach dem Ende der Runde pausiert')
	p.ausloesen('agent/status', { agent: s.worker, status: 'inactive' })
	assert.equal(p.aufrufe.filter((a) => a[0] === 'pause').length, 1, 'nur einmal pausiert')
	p.abbau()
})

test('19. Keine Übernahme: Nachricht eines Agenten, Wurzel, kein Team-Modus, Ziel nicht aktiv, Notschalter', async () => {
	leereUebernahmen()
	const s = baueSzene(); s.ziele.set(s.exp, ziel('g19')); s.ziele.set(s.lead, ziel('gl'))
	const p = startePlugin(s); await warte(300)
	s.exp.send({ id: 'a', role: 'user', content: [{ type: 'text', text: 'x' }], source: { kind: 'team-message' } }, 'next-turn', true)
	s.exp.send({ id: 'b', role: 'user', content: [{ type: 'text', text: 'x' }], source: { kind: 'user' } }, 'next-turn', true)
	s.lead.send(mensch(), 'next-turn', true)
	assert.equal(p.aufrufe.length, 0, 'weder Agentennachricht noch Mensch ohne rpcId noch die Wurzel lösen etwas aus')
	s.ziele.set(s.exp, ziel('g19b', { phase: 'paused' })); s.exp.send(mensch(), 'next-turn', true)
	assert.equal(p.aufrufe.length, 0, 'ein pausiertes Ziel braucht keine Übernahme')
	p.abbau()
	const t = baueSzene({ mitglieder: [{ role: 'lead', name: 'lead', id: 'lead', status: 'inactive' }] }); t.ziele.set(t.exp, ziel('g19c'))
	const q = startePlugin(t); await warte(300)
	t.exp.send(mensch(), 'next-turn', true)
	assert.equal(q.aufrufe.length, 0, 'ohne Team-Modus bleibt alles wie heute')
	q.abbau()
	// apply liest den Notschalter von seinem echten Ort (DSH_HOME ist hier ein Temp-Ordner)
	mkdirSync(dirname(notschalterPfad()), { recursive: true }); writeFileSync(notschalterPfad(), JSON.stringify({ aus: true }))
	try {
		const n = baueSzene(); n.ziele.set(n.exp, ziel('g19d'))
		const r = startePlugin(n); await warte(300)
		n.exp.send(mensch(), 'next-turn', true)
		assert.equal(r.aufrufe.length, 0, 'Notschalter gedrückt: keine Übernahme')
		r.abbau()
	} finally { writeFileSync(notschalterPfad(), JSON.stringify({ aus: false })) }
})

test('20. Freigabe: wenn der Mensch das Ziel fortsetzt, kommt EINE Meldung mit dem aktuellen Wortlaut', async () => {
	leereUebernahmen()
	const s = baueSzene(); s.ziele.set(s.exp, ziel('g20'))
	const p = startePlugin(s); await warte(300)
	s.exp.send(mensch(), 'next-turn', true)
	assert.equal(s.lead.gesteuert.length, 1)
	p.ausloesen('goal/changed', { agent: s.exp, change: { operation: 'resume', goal: { id: 'g20', objective: 'Neuer Wortlaut des Ziels' } } })
	assert.equal(s.lead.gesteuert.length, 2)
	assert.match(s.lead.gesteuert[1].content[0].text, /Mensch hat exp freigegeben, Ziel lautet jetzt: Neuer Wortlaut des Ziels/)
	p.ausloesen('goal/changed', { agent: s.exp, change: { operation: 'resume', goal: { id: 'g20', objective: 'x' } } })
	assert.equal(s.lead.gesteuert.length, 2, 'ein zweites resume ohne Übernahme meldet nichts')
	assert.equal(leseUebernahmen().some((e) => e.id === 'exp'), false)
	p.abbau()
})

test('21. send_message im Team-Modus: abgelehnt mit Hinweis; Unteragenten-Variante, Fork und kein Team-Modus bleiben frei', () => {
	const s = baueSzene()
	const a = (agent, args, name = 'send_message') => ({ name, agent, arguments: args })
	assert.equal(pruefeSendMessage(a(s.exp, { target: 'lead', message: 'x' }), s.umgebung), HINWEIS_SEND_MESSAGE)
	assert.equal(pruefeSendMessage(a(s.lead, { target: 'exp', message: 'x' }), s.umgebung), HINWEIS_SEND_MESSAGE)
	assert.equal(pruefeSendMessage(a(s.exp, JSON.stringify({ target: 'lead', message: 'x' })), s.umgebung), HINWEIS_SEND_MESSAGE, 'Argumente als Text')
	assert.equal(pruefeSendMessage(a(s.exp, { agent_id: 'worker', message: 'x' }), s.umgebung), undefined, 'das Unteragenten-Werkzeug (agent_id) bleibt frei')
	assert.equal(pruefeSendMessage(a(s.exp, { target: 'lead' }, 'send_to_session'), s.umgebung), undefined, 'andere Werkzeuge bleiben frei')
	const f = baueSzene({ mitglieder: [{ role: 'lead', id: 'fork', status: 'inactive' }] })
	assert.equal(pruefeSendMessage(a(f.fork, { target: 'lead', message: 'x' }), f.umgebung), undefined, 'ein Fork ist nicht im Team-Modus')
	const k = baueSzene({ mitglieder: [{ role: 'lead', id: 'lead', status: 'inactive' }] })
	assert.equal(pruefeSendMessage(a(k.exp, { target: 'lead', message: 'x' }), k.umgebung), undefined, 'ohne Team-Modus frei')
	assert.match(HINWEIS_SEND_MESSAGE, /give_task/); assert.match(HINWEIS_SEND_MESSAGE, /ask_question/)
})

function mitKanaelen(s) {
	const aufrufe = []
	s.umgebung.uebernommen = (id) => s.uebernommen?.has(id) ?? false
	s.umgebung.erzeugeZiel = (agent, anfrage) => { aufrufe.push(['ziel', agent.id, anfrage]); const z = ziel('neu', anfrage); s.ziele.set(agent, z); return z }
	s.umgebung.sendeFrage = async (absender, name, text) => { aufrufe.push(['frage', absender.id, name, text]) }
	return aufrufe
}

test('22. give_task: ohne Zielbrief oder Rundenzahl scheitert mit verständlicher Meldung; sonst Ziel für den Empfänger', async () => {
	const s = baueSzene(); const aufrufe = mitKanaelen(s)
	const w = baueAuftragWerkzeug({ defineTool: (d) => d, umgebung: s.umgebung })
	const lang = 'Zweck: Teil von Ziel X. Gegenstand: Datei A. Grenzen: nur A. Abnahme: Zahl 5.'
	await assert.rejects(w.execute({ empfaenger: 'exp', maxrunden: 5 }, { agent: s.lead }), (e) => e.message === HINWEIS_OHNE_ZIELBRIEF)
	await assert.rejects(w.execute({ empfaenger: 'exp', zielbrief: 'kurz', maxrunden: 5 }, { agent: s.lead }), /goal brief/)
	await assert.rejects(w.execute({ empfaenger: 'exp', zielbrief: lang }, { agent: s.lead }), /round limit/)
	assert.equal(aufrufe.length, 0, 'bei Fehlern wird nichts angelegt')
	await assert.rejects(w.execute({ empfaenger: 'gibtsnicht', zielbrief: lang, maxrunden: 5 }, { agent: s.lead }), /unknown recipient/)
	await assert.rejects(w.execute({ empfaenger: 'lead', zielbrief: lang, maxrunden: 5 }, { agent: s.exp }), /DOWN|only goes DOWN|yourself|unknown/)
	const erg = await w.execute({ empfaenger: 'exp', zielbrief: lang, maxrunden: 7, aufgabenliste: 'a\nb' }, { agent: s.lead })
	assert.equal(erg.angelegt, true); assert.equal(aufrufe.length, 1)
	assert.equal(aufrufe[0][1], 'exp'); assert.equal(aufrufe[0][2].maxGoalRounds, 7)
	assert.match(aufrufe[0][2].objective, /Zweck: Teil von Ziel X/); assert.match(aufrufe[0][2].objective, /todo_write/)
	await assert.rejects(w.execute({ empfaenger: 'exp', zielbrief: lang, maxrunden: 7 }, { agent: s.lead }), /already has a goal/)
	s.ziele.delete(s.exp); s.uebernommen = new Set(['exp'])
	await assert.rejects(w.execute({ empfaenger: 'exp', zielbrief: lang, maxrunden: 7 }, { agent: s.lead }), /talking to the human/)
})

test('23. ask_question: still zugestellt, ohne Ziel; an den Menschen aufgezeichnet; übernommene Mitglieder nicht erreichbar', async () => {
	const s = baueSzene(); const aufrufe = mitKanaelen(s)
	const fragen = join(mkdtempSync(join(tmpdir(), 'fragen-')), 'f.jsonl')
	const w = baueFrageWerkzeug({ defineTool: (d) => d, umgebung: s.umgebung, fragen })
	const erg = await w.execute({ empfaenger: 'lead', frage: 'Wie viele Wände?' }, { agent: s.exp })
	assert.equal(erg.zugestellt, true); assert.deepEqual(aufrufe[0].slice(0, 3), ['frage', 'exp', 'lead'])
	assert.equal(s.lead.gesteuert.length, 0, 'keine Meldung nach oben, kein Ziel')
	await w.execute({ empfaenger: 'mensch', frage: 'Soll das Dach rund sein?' }, { agent: s.exp })
	assert.match(readFileSync(fragen, 'utf8'), /Soll das Dach rund sein\?/)
	s.uebernommen = new Set(['exp'])
	await assert.rejects(w.execute({ empfaenger: 'exp', frage: 'x' }, { agent: s.lead }), /talking to the human/)
	await assert.rejects(w.execute({ empfaenger: 'exp', frage: '' }, { agent: s.lead }), /empty|talking/)
})

test('24. Gegenprobe: eine Kopie ohne Entwaffnen lässt die Übernahme wirkungslos — die Prüfung 17 ist nicht leer', async () => {
	if (process.env.TEAM_MODUS_MODUL) return
	const quelle = readFileSync(MODUL, 'utf8')
	const mutiert = quelle
		.replace('	aktion.disarm(agent);\n', '')
		.replace('from "./send-to-session.mjs"', `from "${pathToFileURL(join(new URL('../patches', import.meta.url).pathname, 'send-to-session.mjs')).href}"`)
	assert.notEqual(mutiert, quelle)
	const datei = join(mkdtempSync(join(tmpdir(), 'team-modus-mutant3-')), 'team-modus-mutant.mjs')
	writeFileSync(datei, mutiert)
	const mut = await import(pathToFileURL(datei).href)
	const lauf = (modul) => {
		const s = baueSzene(); s.ziele.set(s.exp, ziel('gm'))
		const sp = []
		modul.uebernehmeGespraech(s.exp, mensch(), s.umgebung, { ziel: (a) => s.ziele.get(a), disarm: () => sp.push('disarm'), pause: () => sp.push('pause'), laeuft: () => false, name: () => 'exp', melde: () => {} }, new Map())
		return sp
	}
	assert.deepEqual(lauf(M), ['disarm', 'pause'])
	assert.deepEqual(lauf(mut), ['pause'], 'die Kopie entwaffnet nicht')
})
