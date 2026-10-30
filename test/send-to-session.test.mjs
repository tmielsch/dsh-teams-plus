/**
 * Test fuer patches/send-to-session.mjs
 *
 * Der Patch haengt an Cordis-Diensten, die es in einem Test nicht gibt. Geprueft
 * wird deshalb, was ohne DSH pruefbar ist und genau die Stellen traegt, an denen
 * ein Fehler teuer waere: die Herkunft im Text, die Quellenangabe, die Bremse,
 * die Zielsuche und die harten Regeln (nicht an sich selbst, keine schlafende
 * Sitzung, keine Zustellung ohne Ziel).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { baueInhalt, baueQuelle, bremseOk, findeZiel } from '../patches/send-to-session.mjs'

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

test('die Quelle nennt Absender und Ziel und ist nicht "user"', () => {
  const quelle = baueQuelle('abc123', 'def456')
  assert.equal(quelle.kind, 'agent-send', 'die Quelle darf nicht als Mensch durchgehen')
  assert.notEqual(quelle.kind, 'user')
  assert.equal(quelle.from, 'abc123')
  assert.equal(quelle.to, 'def456')
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

test('das Werkzeug wird angemeldet und liefert die lebenden Sitzungen ohne Ziel', async () => {
  const zustellungen = new Map()
  const [a1] = []
  const gesendet = []
  const ziel = { id: 'b2', session: { title: 'Andere Sitzung' }, steer: (m) => gesendet.push(['steer', m]), followup: (m) => gesendet.push(['followup', m]) }
  const absender = { id: 'a1', session: { title: 'Meine Sitzung' } }
  const { ctx, registriert } = baueKontext([absender, ziel])

  // apply ueber den echten Weg: erst defineTool laden, dann registrieren.
  const modul = await import('../patches/send-to-session.mjs')
  modul.apply(ctx)
  await new Promise((r) => setTimeout(r, 300)) // der Ladevorgang laeuft asynchron

  assert.equal(registriert.length, 1, 'das Werkzeug wurde nicht angemeldet')
  const def = registriert[0]
  assert.equal(def.name, 'send_to_session')
  // `defineTool` gibt `parameters` als JSON-Schema zurueck, nicht als flaches
  // Objekt — gemessen am 2026-10-30 an der echten Definition.
  const props = def.parameters.properties
  assert.ok(props.target, 'der Parameter target fehlt')
  assert.ok(props.message, 'der Parameter message fehlt')
  assert.deepEqual(props.mode.enum, ['steer', 'followup'])
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
  const { ctx, registriert } = baueKontext([absender, ziel])
  const modul = await import('../patches/send-to-session.mjs')
  modul.apply(ctx)
  await new Promise((r) => setTimeout(r, 300))

  const def = registriert[0]
  const ergebnis = await def.execute({ target: 'b2', message: 'Bitte pruefen' }, { agent: absender, signal: new AbortController().signal })
  assert.equal(ergebnis.delivered, true)
  assert.equal(ergebnis.mode, 'steer', 'die Vorgabe muss steer sein')
  assert.equal(gesendet.length, 1)
  assert.equal(gesendet[0][0], 'steer', 'steer darf nicht followup rufen')
  const nachricht = gesendet[0][1]
  assert.equal(nachricht.role, 'user')
  assert.match(nachricht.content[0].text, /nicht vom Menschen/u)
  assert.equal(nachricht.source.kind, 'agent-send', 'die Quelle muss den Agenten nennen')
})

test('followup wird nur auf ausdrueckliche Anforderung gerufen', async () => {
  const gesendet = []
  const ziel = { id: 'b2', session: {}, steer: (m) => gesendet.push(['steer', m]), followup: (m) => gesendet.push(['followup', m]) }
  const absender = { id: 'a1', session: {} }
  const { ctx, registriert } = baueKontext([absender, ziel])
  const modul = await import('../patches/send-to-session.mjs')
  modul.apply(ctx)
  await new Promise((r) => setTimeout(r, 300))

  const def = registriert[0]
  const e = await def.execute({ target: 'b2', message: 'Sofort bitte', mode: 'followup' }, { agent: absender, signal: new AbortController().signal })
  assert.equal(e.delivered, true)
  assert.equal(e.mode, 'followup')
  assert.equal(gesendet[0][0], 'followup')
})

test('an sich selbst wird nie zugestellt', async () => {
  const gesendet = []
  const absender = { id: 'a1', session: {}, steer: (m) => gesendet.push(m), followup: (m) => gesendet.push(m) }
  const { ctx, registriert } = baueKontext([absender])
  const modul = await import('../patches/send-to-session.mjs')
  modul.apply(ctx)
  await new Promise((r) => setTimeout(r, 300))

  const def = registriert[0]
  const e = await def.execute({ target: 'a1', message: 'Echo' }, { agent: absender, signal: new AbortController().signal })
  assert.equal(e.delivered, false)
  assert.match(e.note, /yourself/u)
  assert.equal(gesendet.length, 0, 'die eigene Sitzung darf nichts bekommen')
})

test('ohne Agenten-Dienst meldet das Werkzeug einen Grund statt zu werfen', async () => {
  const absender = { id: 'a1', session: {} }
  const { ctx, registriert } = baueKontext([absender], { ohneAgenten: true })
  const modul = await import('../patches/send-to-session.mjs')
  modul.apply(ctx)
  await new Promise((r) => setTimeout(r, 300))

  const def = registriert[0]
  const e = await def.execute({ target: 'x', message: 'Hallo' }, { agent: absender, signal: new AbortController().signal })
  assert.equal(e.delivered, false)
  assert.match(e.note, /agents/u)
})

test('die Bremse greift auch im Werkzeug, nicht nur im Helfer', async () => {
  const gesendet = []
  const ziel = { id: 'b2', session: {}, steer: (m) => gesendet.push(m), followup: (m) => gesendet.push(m) }
  const absender = { id: 'a1', session: {} }
  const { ctx, registriert } = baueKontext([absender, ziel])
  const modul = await import('../patches/send-to-session.mjs')
  modul.apply(ctx)
  await new Promise((r) => setTimeout(r, 300))

  const def = registriert[0]
  const laeufe = []
  for (let i = 0; i < 8; i += 1) {
    laeufe.push(await def.execute({ target: 'b2', message: `Nr ${i}` }, { agent: absender, signal: new AbortController().signal }))
  }
  const zugestellt = laeufe.filter((e) => e.delivered).length
  assert.equal(zugestellt, 6, `nach sechs Zustellungen muss Schluss sein, zugestellt waren ${zugestellt}`)
  const gebremst = laeufe.filter((e) => e.delivered === false && /rate limit/u.test(e.note))
  assert.equal(gebremst.length, 2)
})
