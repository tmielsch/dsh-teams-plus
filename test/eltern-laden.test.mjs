/**
 * eltern-laden.test.mjs — Haken A (Anschreiben), Haken B (Öffnen), Lader, Notschalter, Abbau
 * =========================================================================================
 *
 * Geprüft wird `patches/eltern-laden.mjs` gegen eine Attrappe des Hosts, und zwar die VERDRAHTUNG in den Haken
 * (`apply` hängt wirklich `subagents.prompt`, `sessionController.page` und `.follow` um), nicht nur Konstanten.
 * Was hier NICHT messbar ist (der echte Kern, der echte Session-Controller, Modellaufrufe der Attrappe im Kern),
 * misst die Bau-Probe: `docs/messung-eltern-laden/probe-bau.sh`, Bericht `docs/ABNAHME-BAU-ELTERN-LADEN-2026-11-12.md`.
 *
 * Aufbau: jede Prüfung ist eine Funktion `pruefung(modul) → true|false`. Der echte Test verlangt `true`.
 * Die Mutationstests laden Kopien des Moduls mit je EINER eingebauten Verfälschung (Frist weg, Schalter ignoriert,
 * Schalter immer aus, Dedup weg, Rücknahme weg, Laden nicht abwarten, Fehler nicht gefangen, Klassifizierung kaputt) und
 * verlangen, dass genau die zuständige Prüfung `false` liefert. Ein Test, der mit der Kopie genauso grün wäre,
 * prüfte nichts.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const HEIM = mkdtempSync(join(tmpdir(), 'eltern-laden-home-'))
process.env.HOME = HEIM
process.env.USERPROFILE = HEIM
process.env.DSH_HOME = join(HEIM, '.dsh')

const PATCHES = new URL('../patches/', import.meta.url).pathname
const MODUL = join(PATCHES, 'eltern-laden.mjs')
const M = await import(MODUL)

const warte = (ms) => new Promise((fertig) => setTimeout(fertig, ms))
const adresseKind = (eltern = 'E1', kind = 'K1') => ({ kind: 'subagent', parentSessionId: eltern, childSessionId: kind, mode: 'continuable' })
const anfrageKind = (eltern = 'E1', kind = 'K1') => ({ requestId: 'r', parentSessionId: eltern, childSessionId: kind, mode: 'continuable', delivery: 'queue', content: [] })

// ---------------------------------------------------------------------------------------------------
// Die Attrappe des Hosts
// ---------------------------------------------------------------------------------------------------

/**
 * @param modul - das Modul (echt oder mutiert)
 * @param opt - `{ lebend, ladeDauer, ladeFehler, ohneController, controllerSpaeter }`
 */
function baueWelt(modul, opt = {}) {
	const lebend = new Set(opt.lebend ?? [])
	const ordner = mkdtempSync(join(tmpdir(), 'eltern-laden-welt-'))
	const protokollDatei = join(ordner, 'eltern-laden.log')
	const notschalterDatei = join(ordner, 'eltern-laden.json')
	const welt = { lebend, protokollDatei, notschalterDatei, lookupAufrufe: [], originalAufrufe: [], pageAufrufe: [], gefragteDienste: [], agentsZugriffe: [], zielZugriffe: [], abbau: [] }

	const lookup = {
		resolve: async (id) => {
			welt.lookupAufrufe.push(id)
			await warte(opt.ladeDauer ?? 5) // wie im Kern: Laden ist nie sofort fertig
			if (opt.ladeFehler) throw Object.assign(new Error(`laden schlug fehl (${opt.ladeFehler})`), { code: opt.ladeFehler })
			lebend.add(id)
			return { agent: { id } }
		}
	}
	const agenten = new Proxy({}, { get: (_, eigenschaft) => { welt.agentsZugriffe.push(String(eigenschaft)); if (eigenschaft === 'get') return (id) => (lebend.has(id) ? { id } : undefined); return undefined } })
	const ziele = new Proxy({}, { get: (_, eigenschaft) => { welt.zielZugriffe.push(String(eigenschaft)); return undefined } })
	// Der Dienst `subagents`: genau wie der Kern lehnt er ab, wenn der Elternteil nicht lebt.
	const subagents = {
		prompt: async function (anfrage, signal) {
			welt.originalAufrufe.push({ elternLebte: lebend.has(anfrage.parentSessionId), abgebrochen: signal?.aborted === true })
			if (!lebend.has(anfrage.parentSessionId)) throw Object.assign(new Error(`parent session "${anfrage.parentSessionId}" is not live`), { code: 'subagent/parent-unavailable' })
			return { messageId: 'm-1' }
		}
	}
	const controller = {
		page: async function (anfrage) { welt.pageAufrufe.push(anfrage); return { records: [], hasMore: false } },
		follow: async function* (anfrage) { welt.pageAufrufe.push(anfrage); yield { type: 'snapshot' } }
	}
	welt.urspruenglich = { prompt: subagents.prompt, page: controller.page, follow: controller.follow }
	welt.controller = controller
	welt.subagents = subagents
	let controllerDa = !opt.ohneController && !opt.controllerSpaeter
	let injectRueckruf
	const ctx = {
		agents: agenten,
		goals: ziele,
		subagents,
		logger: { info: () => {}, warn: () => {} },
		effect: (fn) => { const ab = fn(); welt.abbau.push(ab); return () => ab?.() },
		get: (dienst) => {
			welt.gefragteDienste.push(dienst)
			if (dienst === 'typert') return { lookups: { get: (n) => (n === 'agent' ? lookup : undefined) } }
			if (dienst === 'sessionController' && controllerDa) return controller
			throw new Error('service not found')
		},
		inject: (liste, rueckruf) => { injectRueckruf = rueckruf; if (controllerDa) rueckruf(ctx) }
	}
	welt.controllerKommt = () => { controllerDa = true; injectRueckruf?.(ctx) }
	welt.ctx = ctx
	modul.apply(ctx, { protokollDatei, notschalterDatei })
	welt.abbauen = () => { for (const ab of welt.abbau.splice(0)) { try { if (typeof ab === 'function') ab() } catch { /* wie im Host */ } } }
	welt.protokoll = () => (existsSync(protokollDatei) ? readFileSync(protokollDatei, 'utf8') : '')
	welt.schreibeSchalter = (text) => writeFileSync(notschalterDatei, text)
	welt.loescheSchalter = () => rmSync(notschalterDatei, { force: true })
	welt.prompt = (eltern = 'E1', kind = 'K1', signal = new AbortController().signal) => subagents.prompt(anfrageKind(eltern, kind), signal)
	welt.page = (adresse = adresseKind()) => controller.page({ address: adresse, throughSeq: -1 }, new AbortController().signal)
	return welt
}

const fange = async (f) => { try { return { wert: await f() } } catch (fehler) { return { fehler } } }

// ---------------------------------------------------------------------------------------------------
// Die Prüfungen (true = in Ordnung)
// ---------------------------------------------------------------------------------------------------

const pruefungen = {
	/** Haken A: kalter Elternteil → geladen, dann läuft das Original (und sieht einen lebenden Elternteil). */
	async anschreibenLaedtKalten(modul) {
		const w = baueWelt(modul)
		const r = await w.prompt()
		const ok = r?.messageId === 'm-1' && w.lookupAufrufe.length === 1 && w.lookupAufrufe[0] === 'E1' && w.originalAufrufe.length === 1 && w.originalAufrufe[0].elternLebte === true
		w.abbauen(); return ok
	},
	/** Haken A: lebender Elternteil → kein Laden. */
	async anschreibenLaedtLebendenNicht(modul) {
		const w = baueWelt(modul, { lebend: ['E1'] })
		const r = await w.prompt()
		const ok = r?.messageId === 'm-1' && w.lookupAufrufe.length === 0 && w.originalAufrufe.length === 1
		w.abbauen(); return ok
	},
	/** Haken A wartet auf das Laden: das Original läuft erst danach (gemessen an einem langsamen Laden). */
	async anschreibenWartetAufLaden(modul) {
		const w = baueWelt(modul, { ladeDauer: 80 })
		const r = await w.prompt()
		const ok = r?.messageId === 'm-1' && w.originalAufrufe[0]?.elternLebte === true
		w.abbauen(); return ok
	},
	/** Ladefehler: das Original läuft trotzdem, meldet seinen EIGENEN Fehler (ohne Hinweis für Kinder) und der Fehler steht im Protokoll. */
	async ladefehlerLaesstOriginalLaufen(modul) {
		const w = baueWelt(modul, { ladeFehler: 'gateway/internal' })
		const r = await fange(() => w.prompt())
		// derselbe Fall ohne Signal des Aufrufers (anderer Weg durch `warteMitAbbruch`)
		const ohneSignal = await fange(() => w.subagents.prompt(anfrageKind('E2', 'K2'), undefined))
		const ok = r.fehler?.code === 'subagent/parent-unavailable' && w.originalAufrufe.length === 2 && !String(r.fehler.message).includes('Issue DSH-Verwaltung 177') && w.protokoll().includes('ladefehler') && w.protokoll().includes('gateway/internal') && ohneSignal.fehler?.code === 'subagent/parent-unavailable'
		w.abbauen(); return ok
	},
	/** Bricht der Aufrufer ab, hört das Warten auf (die Frist des Aufrufers gilt), das Original läuft mit dem abgebrochenen Signal. */
	async abbruchBeendetDasWarten(modul) {
		const w = baueWelt(modul, { ladeDauer: 400 })
		const abbruch = new AbortController()
		const t0 = Date.now()
		setTimeout(() => abbruch.abort(), 20)
		await fange(() => w.prompt('E1', 'K1', abbruch.signal))
		const dauer = Date.now() - t0
		const ok = dauer < 250 && w.originalAufrufe.length === 1 && w.originalAufrufe[0].abgebrochen === true
		await warte(450); w.abbauen(); return ok
	},
	/** Elternteil ist selbst ein Kind: nicht geladen, lesbarer Hinweis am Fehler, Protokollzeile `eltern-ist-kind`. */
	async elternIstKindWirdLesbarAbgelehnt(modul) {
		const w = baueWelt(modul, { ladeFehler: 'session/agent-busy' })
		const r = await fange(() => w.prompt())
		const ok = r.fehler?.code === 'subagent/parent-unavailable' && String(r.fehler.message).includes('Issue DSH-Verwaltung 177') && String(r.fehler.message).includes('selbst ein Unteragent') && w.protokoll().includes('eltern-ist-kind') && w.lookupAufrufe.length === 1
		w.abbauen(); return ok
	},
	/** Haken B (page): kehrt sofort zurück, der Elternteil wird im Hintergrund geladen. */
	async oeffnenPageLaedtImHintergrund(modul) {
		const w = baueWelt(modul, { ladeDauer: 150 })
		const t0 = Date.now()
		const r = await w.page()
		const dauer = Date.now() - t0
		const sofortLebt = w.lebend.has('E1')
		await warte(300)
		const ok = Array.isArray(r?.records) && dauer < 100 && w.pageAufrufe.length === 1 && sofortLebt === false && w.lebend.has('E1') && w.lookupAufrufe.length === 1
		w.abbauen(); return ok
	},
	/** Haken B (follow): der Strom des Originals kommt unverändert, der Elternteil wird geladen. */
	async oeffnenFollowLaedtUndLiefertStrom(modul) {
		const w = baueWelt(modul, { ladeDauer: 30 })
		const g = w.controller.follow({ address: adresseKind(), assistantStream: true }, new AbortController().signal)
		const erster = await g.next()
		await g.return?.()
		await warte(100)
		const ok = erster.value?.type === 'snapshot' && w.lebend.has('E1') && w.lookupAufrufe.length === 1
		w.abbauen(); return ok
	},
	/** Eine gewöhnliche Sitzungsadresse (kein Kind) oder eine Anfrage ohne Adresse lädt nichts und bricht nichts. */
	async gewoehnlicheAdresseLaedtNicht(modul) {
		const w = baueWelt(modul)
		const a = await w.page({ kind: 'session', sessionId: 'E1' })
		const b = await w.controller.page({ throughSeq: -1 }, new AbortController().signal)
		const c = await w.controller.page(undefined, new AbortController().signal)
		await warte(50)
		const ok = Array.isArray(a?.records) && Array.isArray(b?.records) && Array.isArray(c?.records) && w.lookupAufrufe.length === 0
		w.abbauen(); return ok
	},
	/** Gleichzeitig Öffnen (page, follow) und Anschreiben: der Elternteil wird genau EINMAL angestoßen. */
	async gleichzeitigLaedtEinmal(modul) {
		const w = baueWelt(modul, { ladeDauer: 80 })
		const g = w.controller.follow({ address: adresseKind(), assistantStream: true }, new AbortController().signal)
		const alle = await Promise.all([w.page(), w.page(), g.next(), w.prompt(), w.prompt('E1', 'K2')])
		await g.return?.()
		const ok = w.lookupAufrufe.length === 1 && alle[3]?.messageId === 'm-1' && alle[4]?.messageId === 'm-1'
		w.abbauen(); return ok
	},
	/** Notschalter `{"aus": true}`: weder Anschreiben noch Öffnen lädt, das Original läuft unverändert; Datei weg → lädt wieder. */
	async notschalterSchaltetNurDenPatchAb(modul) {
		const w = baueWelt(modul)
		w.schreibeSchalter(JSON.stringify({ aus: true }))
		const aus = await fange(() => w.prompt())
		await w.page(); await warte(30)
		const keinLaden = w.lookupAufrufe.length === 0 && aus.fehler?.code === 'subagent/parent-unavailable' && w.originalAufrufe.length === 1 && w.pageAufrufe.length === 1
		w.loescheSchalter()
		const an = await fange(() => w.prompt())
		const ok = keinLaden && an.wert?.messageId === 'm-1' && w.lookupAufrufe.length === 1
		w.abbauen(); return ok
	},
	/** Der Schalter wird bei JEDEM Aufruf gelesen: erst an, dann aus (mit anderem Inhalt), dann wieder an, ohne Neustart. */
	async notschalterWirktOhneNeustart(modul) {
		const w = baueWelt(modul)
		const erst = await fange(() => w.prompt('E1', 'K1'))
		w.lebend.delete('E1')
		w.schreibeSchalter(JSON.stringify({ aus: true }))
		const dann = await fange(() => w.prompt('E1', 'K1'))
		w.schreibeSchalter(JSON.stringify({ aus: false, hinweis: 'wieder an' }))
		const zuletzt = await fange(() => w.prompt('E1', 'K1'))
		const ok = erst.wert?.messageId === 'm-1' && dann.fehler?.code === 'subagent/parent-unavailable' && zuletzt.wert?.messageId === 'm-1'
		w.abbauen(); return ok
	},
	/** Kaputte Schalterdatei zählt als „aus“ (sichere Richtung), mit einer Warnung im Protokoll. */
	async kaputterSchalterZaehltAlsAus(modul) {
		const w = baueWelt(modul)
		w.schreibeSchalter('das ist kein json')
		const r = await fange(() => w.prompt())
		const ok = r.fehler?.code === 'subagent/parent-unavailable' && w.lookupAufrufe.length === 0 && w.protokoll().includes('unlesbar')
		w.abbauen(); return ok
	},
	/** Abbau (HMR, Entladen): alle drei Methoden stehen wieder als genau die ursprünglichen Funktionen da; danach lädt nichts mehr. */
	async abbauStelltUrspruenglichesWiederHer(modul) {
		const w = baueWelt(modul)
		const umwickelt = w.subagents.prompt !== w.urspruenglich.prompt && w.controller.page !== w.urspruenglich.page && w.controller.follow !== w.urspruenglich.follow
		w.abbauen()
		const zurueck = w.subagents.prompt === w.urspruenglich.prompt && w.controller.page === w.urspruenglich.page && w.controller.follow === w.urspruenglich.follow
		const danach = await fange(() => w.prompt())
		return umwickelt && zurueck && danach.fehler?.code === 'subagent/parent-unavailable' && w.lookupAufrufe.length === 0
	},
	/** Der Controller kommt erst später (Web-Profil): Haken A wirkt von Anfang an, Haken B erst mit dem Controller. */
	async controllerKommtSpaeter(modul) {
		const w = baueWelt(modul, { controllerSpaeter: true })
		const vorher = w.controller.page === w.urspruenglich.page
		const a = await w.prompt()
		w.lebend.delete('E1')
		w.controllerKommt()
		const nachher = w.controller.page !== w.urspruenglich.page
		await w.page(); await warte(50)
		const ok = vorher && a?.messageId === 'm-1' && nachher && w.lebend.has('E1') && w.lookupAufrufe.length === 2
		w.abbauen(); return ok
	},
	/** Ohne Controller (Profil ohne Web): nichts bricht, Haken A läuft. */
	async ohneControllerBrichtNichts(modul) {
		const w = baueWelt(modul, { ohneController: true })
		const r = await w.prompt()
		const ok = r?.messageId === 'm-1' && w.protokoll().includes('geladen (Haken A aktiv)')
		w.abbauen(); return ok
	},
	/** O1: das Modul fragt nie nach Team oder Team-Modus; Laden rührt weder Agenten (nur `get`) noch Ziele noch eine Runde an. */
	async fragtNieNachTeamUndStartetNichts(modul) {
		const w = baueWelt(modul)
		await w.prompt(); w.lebend.delete('E1'); await w.page(); await warte(50)
		const dienste = w.gefragteDienste.filter((d, i, a) => a.indexOf(d) === i).sort().join(',')
		const ok = !w.gefragteDienste.some((d) => /team/i.test(d)) && dienste === 'sessionController,typert' && w.agentsZugriffe.every((e) => e === 'get') && w.zielZugriffe.length === 0
		w.abbauen(); return ok
	},
	/** Ein Fehler im Laden beim ÖFFNEN lässt das Öffnen gelingen, ohne unbehandelte Zurückweisung. */
	async ladefehlerBeimOeffnenBrichtNichtAb(modul) {
		let unbehandelt = 0
		const zaehle = () => { unbehandelt += 1 }
		// der Test-Läufer wertet jede unbehandelte Zurückweisung selbst als Fehler; hier zählen WIR sie, damit die Mutation sauber an dieser Prüfung rot wird
		const fremde = process.listeners('unhandledRejection')
		process.removeAllListeners('unhandledRejection')
		process.on('unhandledRejection', zaehle)
		try {
			const w = baueWelt(modul, { ladeFehler: 'gateway/internal' })
			const r = await w.page()
			const g = w.controller.follow({ address: adresseKind(), assistantStream: true }, new AbortController().signal)
			const e = await g.next(); await g.return?.()
			await warte(60)
			const ok = Array.isArray(r?.records) && e.value?.type === 'snapshot' && w.lookupAufrufe.length >= 1 && unbehandelt === 0
			w.abbauen(); return ok
		} finally { await warte(20); process.off('unhandledRejection', zaehle); for (const f of fremde) process.on('unhandledRejection', f) }
	},
	/** Der Lader allein: ein lebender Elternteil wird nie angestoßen; Laden, das den Elternteil nicht erzeugt, wird als „nicht-lebend“ gemeldet. */
	async laderLaedtLebendenNie(modul) {
		const zeilen = []
		let laeufe = 0
		const lebend = new Set(['A'])
		const lader = modul.baueLader({ lebt: (id) => lebend.has(id), laedt: async () => { laeufe += 1 }, protokoll: (t) => zeilen.push(t) })
		const a = await lader.laden('A', 'test')
		const b = await lader.laden('B', 'test')
		return a.ergebnis === 'lebt-schon' && laeufe === 1 && b.ergebnis === 'nicht-lebend' && zeilen.some((z) => z.includes('nicht-lebend'))
	}
}

// ---------------------------------------------------------------------------------------------------
// 1. Die echten Prüfungen
// ---------------------------------------------------------------------------------------------------

const BESCHREIBUNG = {
	anschreibenLaedtKalten: '1. Anschreiben bei kaltem Elternteil: geladen, dann läuft das Original mit lebendem Elternteil',
	anschreibenLaedtLebendenNicht: '2. Anschreiben bei lebendem Elternteil: kein Laden',
	anschreibenWartetAufLaden: '3. Haken A wartet das Laden ab (langsames Laden, 80 ms)',
	ladefehlerLaesstOriginalLaufen: '4. Ladefehler: das Original läuft trotzdem und meldet seinen eigenen Fehler, Protokollzeile da',
	abbruchBeendetDasWarten: '5. Abbruch des Aufrufers beendet das Warten (Laden 400 ms, Abbruch bei 20 ms, Rückkehr unter 250 ms)',
	elternIstKindWirdLesbarAbgelehnt: '6. Elternteil ist selbst ein Kind: lesbarer Hinweis (Issue 177) und Protokollzeile eltern-ist-kind',
	oeffnenPageLaedtImHintergrund: '7. Öffnen (page) kehrt sofort zurück, Elternteil wird im Hintergrund geladen',
	oeffnenFollowLaedtUndLiefertStrom: '8. Öffnen (follow) liefert den Strom des Originals und lädt',
	gewoehnlicheAdresseLaedtNicht: '9. Gewöhnliche Adresse oder keine Adresse: kein Laden, kein Fehler',
	gleichzeitigLaedtEinmal: '10. Fünf gleichzeitige Aufrufe laden den Elternteil einmal',
	notschalterSchaltetNurDenPatchAb: '11. Notschalter {"aus": true}: nichts wird geladen, Original unverändert; Datei weg: lädt wieder',
	notschalterWirktOhneNeustart: '12. Notschalter wirkt bei jedem Aufruf, ohne Neustart',
	kaputterSchalterZaehltAlsAus: '13. Kaputte Schalterdatei zählt als aus, mit Warnung',
	abbauStelltUrspruenglichesWiederHer: '14. Abbau stellt prompt, page und follow wieder her; danach lädt nichts',
	controllerKommtSpaeter: '15. Controller kommt später: Haken B erst dann, Haken A von Anfang an',
	ohneControllerBrichtNichts: '16. Ohne Controller bricht nichts',
	fragtNieNachTeamUndStartetNichts: '17. Fragt nie nach Team; Laden rührt Agenten (nur get), Ziele und Runden nicht an',
	ladefehlerBeimOeffnenBrichtNichtAb: '18. Ladefehler beim Öffnen bricht das Öffnen nicht ab, keine unbehandelte Zurückweisung',
	laderLaedtLebendenNie: '19. Lader: lebender Elternteil wird nie angestoßen; Laden ohne Wirkung wird gemeldet'
}

for (const [schluessel, beschreibung] of Object.entries(BESCHREIBUNG)) {
	test(beschreibung, async () => {
		assert.equal(await pruefungen[schluessel](M), true)
	})
}

test('20. Jede Prüfung hat eine Beschreibung und umgekehrt', () => {
	assert.deepEqual(Object.keys(pruefungen).sort(), Object.keys(BESCHREIBUNG).sort())
})

// ---------------------------------------------------------------------------------------------------
// 2. Reine Funktionen
// ---------------------------------------------------------------------------------------------------

test('21. Eltern-Kennung aus Anschreiben und aus Öffnen: nur Kind-Adressen, nur brauchbare Kennungen', () => {
	assert.equal(M.elternKennungAusAnschreiben({ parentSessionId: 'E' }), 'E')
	assert.equal(M.elternKennungAusAnschreiben({ parentSessionId: '' }), undefined)
	assert.equal(M.elternKennungAusAnschreiben({ parentSessionId: 7 }), undefined)
	assert.equal(M.elternKennungAusAnschreiben(undefined), undefined)
	assert.equal(M.elternKennungAusOeffnen({ address: adresseKind('E') }), 'E')
	assert.equal(M.elternKennungAusOeffnen({ address: { kind: 'session', sessionId: 'E', parentSessionId: 'X' } }), undefined)
	assert.equal(M.elternKennungAusOeffnen({}), undefined)
	assert.equal(M.elternKennungAusOeffnen(null), undefined)
})

test('22. Ladefehler werden nach Code eingeordnet', () => {
	assert.equal(M.klassifiziereLadefehler({ code: 'session/agent-busy' }), 'eltern-ist-kind')
	assert.equal(M.klassifiziereLadefehler({ code: 'session/not-found' }), 'eltern-fehlt')
	assert.equal(M.klassifiziereLadefehler({ code: 'gateway/internal' }), 'fehler')
	assert.equal(M.klassifiziereLadefehler(new Error('x')), 'fehler')
	assert.equal(M.klassifiziereLadefehler(undefined), 'fehler')
})

test('23. Der Hinweis wird genau einmal angehängt und übersteht einen schreibgeschützten Fehler', () => {
	const f = new Error('basis')
	M.haengeHinweisAn(f); M.haengeHinweisAn(f)
	assert.equal(f.message.split('Issue DSH-Verwaltung 177').length, 2)
	const eingefroren = Object.freeze(new Error('fest'))
	assert.doesNotThrow(() => M.haengeHinweisAn(eingefroren))
	assert.doesNotThrow(() => M.haengeHinweisAn(undefined))
})

test('24. Selbsttest nennt jede fehlende Schnittstelle', () => {
	assert.equal(M.selbsttest({ prompt: true, page: true, follow: true, lookup: true }).ok, true)
	assert.equal(M.selbsttest({ prompt: true }).ok, true, 'ohne Controller-Befund (undefined) wird nichts beanstandet')
	const schlecht = M.selbsttest({ prompt: false, page: false, follow: false, lookup: false })
	assert.equal(schlecht.ok, false)
	assert.equal(schlecht.abweichungen.length, 4)
})

test('25. Modul-Vertrag: Name, Abhängigkeiten, Notschalter-Datei getrennt vom Team-Modus, Protokolldatei', () => {
	assert.equal(M.name, 'eltern-laden')
	assert.deepEqual(M.inject, ['agents', 'subagents'], 'sessionController und typert kommen weich, nicht über inject')
	assert.match(M.notschalterPfad(), /eltern-laden\.json$/)
	assert.doesNotMatch(M.notschalterPfad(), /team-modus/)
	assert.match(M.protokollPfad(), /logs[\\/]eltern-laden\.log$/)
})

test('26. Keine Einzelfälle: im Quelltext steht keine Sitzungs-Kennung und kein fester Name', () => {
	const quelle = readFileSync(MODUL, 'utf8')
	assert.doesNotMatch(quelle, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, 'keine UUID')
	assert.doesNotMatch(quelle, /['"`](eltern|kind|lead|exp)[-_]?\d*['"`]/i, 'keine festen Sitzungsnamen')
})

test('27. Der Patch hängt nicht in team-modus.mjs: die Datei wird nur gelesen (import), nie geändert', () => {
	const quelle = readFileSync(MODUL, 'utf8')
	const importe = [...quelle.matchAll(/from\s+"(\.\/[^"]+)"/g)].map((t) => t[1])
	assert.deepEqual(importe, ['./team-modus.mjs'])
	assert.match(quelle, /import \{ datenOrdner \} from/)
})

// ---------------------------------------------------------------------------------------------------
// 3. Mutationen: Kopien mit je einer Verfälschung; die zuständige Prüfung muss ROT werden
// ---------------------------------------------------------------------------------------------------

const MUTATIONEN = [
	{
		beschreibung: 'Haken A wartet das Laden nicht ab',
		ersetze: [['const erg = await lader.laden(id, "anschreiben", signal);', 'lader.anstossen(id, "anschreiben"); const erg = { ergebnis: "x" };']],
		rot: ['anschreibenWartetAufLaden', 'anschreibenLaedtKalten']
	},
	{
		beschreibung: 'Notschalter wird in den Haken ignoriert',
		ersetze: [['if (zustand.aktiv && !schalter()) {', 'if (zustand.aktiv) {']],
		rot: ['notschalterSchaltetNurDenPatchAb', 'notschalterWirktOhneNeustart', 'kaputterSchalterZaehltAlsAus']
	},
	{
		beschreibung: 'Schalter-Feld ist immer false (Datei wird gelesen, wirkt nie)',
		ersetze: [['aus = wert.aus === true;', 'aus = false;']],
		rot: ['notschalterSchaltetNurDenPatchAb', 'notschalterWirktOhneNeustart']
	},
	{
		beschreibung: 'Haken B lädt nie',
		ersetze: [['if (id !== undefined) lader.anstossen(id, `oeffnen-${methode}`);', 'if (false) lader.anstossen(id, `oeffnen-${methode}`);']],
		rot: ['oeffnenPageLaedtImHintergrund', 'oeffnenFollowLaedtUndLiefertStrom']
	},
	{
		beschreibung: 'Die Menge „im Flug“ fehlt (kein Zusammenfassen gleichzeitiger Ladevorgänge)',
		ersetze: [['const vorhanden = imFlug.get(id);\n\t\tif (vorhanden !== undefined) return vorhanden;', '']],
		rot: ['gleichzeitigLaedtEinmal']
	},
	{
		beschreibung: 'Die Rücknahme beim Abbau stellt nichts wieder her',
		ersetze: [['if (objekt[methode] !== neu) return;', 'return;']],
		rot: ['abbauStelltUrspruenglichesWiederHer']
	},
	{
		beschreibung: 'Der Lader prüft nicht, ob der Elternteil schon lebt',
		ersetze: [['if (umgebung.lebt(id)) return { ergebnis: "lebt-schon" };', '']],
		rot: ['laderLaedtLebendenNie']
	},
	{
		beschreibung: 'Die Einordnung „Elternteil ist ein Kind“ ist kaputt',
		ersetze: [['if (code === "session/agent-busy") return "eltern-ist-kind";', 'if (false) return "eltern-ist-kind";']],
		rot: ['elternIstKindWirdLesbarAbgelehnt']
	},
	{
		beschreibung: 'Ladefehler werden nicht gefangen (brechen Anschreiben und Öffnen ab)',
		ersetze: [['return { ergebnis: art2 };', 'throw fehler;'], ['return { ergebnis: "fehler" };', 'throw fehler;']],
		rot: ['ladefehlerLaesstOriginalLaufen', 'elternIstKindWirdLesbarAbgelehnt']
	},
	{
		beschreibung: 'Ladefehler beim Öffnen werden nicht gefangen (Hintergrund-Laden ohne Auffangen)',
		ersetze: [['return { ergebnis: art2 };', 'throw fehler;'], ['void ladeEinmal(id, art).catch(() => {});', 'void ladeEinmal(id, art);']],
		rot: ['ladefehlerBeimOeffnenBrichtNichtAb']
	},
	{
		beschreibung: 'Der Abbruch des Aufrufers wird ignoriert (keine Frist)',
		ersetze: [['if (signal === undefined || signal === null', 'if (true || signal === null']],
		rot: ['abbruchBeendetDasWarten']
	},
	{
		beschreibung: 'Haken A wickelt nichts um (Anschreiben bleibt, wie es ist)',
		ersetze: [['const rueckA = umwickleAnschreiben(ctx.subagents, lader, schalter);', 'const rueckA = undefined;']],
		rot: ['anschreibenLaedtKalten', 'abbauStelltUrspruenglichesWiederHer']
	},
	{
		beschreibung: 'Das Modul fragt nach dem Team-Dienst (Verstoß gegen O1)',
		ersetze: [['const hole = (dienst) => { try { return ctx.get(dienst); } catch { return undefined; } };', 'const hole = (dienst) => { try { ctx.get("agentTeams"); return ctx.get(dienst); } catch { return undefined; } };']],
		rot: ['fragtNieNachTeamUndStartetNichts']
	}
]

let mutantenZaehler = 0
async function ladeMutante(ersetze) {
	let quelle = readFileSync(MODUL, 'utf8')
	const original = quelle
	for (const [alt, neu] of ersetze) {
		assert.ok(quelle.includes(alt), `die Stelle für die Mutation fehlt im Modul: ${alt.slice(0, 60)}`)
		quelle = quelle.split(alt).join(neu)
	}
	assert.notEqual(quelle, original, 'die Mutation hat etwas geändert')
	quelle = quelle.replace('from "./team-modus.mjs"', `from "${pathToFileURL(join(PATCHES, 'team-modus.mjs')).href}"`)
	const datei = join(mkdtempSync(join(tmpdir(), 'eltern-laden-mutant-')), `eltern-laden-mutant-${mutantenZaehler += 1}.mjs`)
	writeFileSync(datei, quelle)
	return import(pathToFileURL(datei).href)
}

for (const mutation of MUTATIONEN) {
	test(`Mutation: ${mutation.beschreibung} — die zuständige Prüfung wird rot`, async () => {
		const mutant = await ladeMutante(mutation.ersetze)
		for (const schluessel of mutation.rot) {
			let ergebnis
			try { ergebnis = await pruefungen[schluessel](mutant) } catch { ergebnis = false }
			assert.equal(ergebnis, false, `Prüfung „${BESCHREIBUNG[schluessel]}“ blieb grün: sie prüfte die Mutation nicht`)
		}
		// Gegenprobe der Gegenprobe: die echte Fassung besteht dieselben Prüfungen
		for (const schluessel of mutation.rot) assert.equal(await pruefungen[schluessel](M), true)
	})
}
