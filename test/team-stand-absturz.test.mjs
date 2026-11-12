/**
 * team-stand-absturz.test.mjs — Absturzpfad der Frist und Kindlesung unter der Frist (Prüfer, 2026-11-12)
 * =====================================================================================================
 *
 * Geprüft wird die ECHTE `apply()` aus patches/team-modus.mjs gegen eine Kontext-Attrappe.
 *  - Fund 1: Frist 0 (oder schon vorbei) und eine Abfrage, die später ablehnt, darf den Prozess nicht
 *    beenden. Der Host beendet ihn bei einer unbehandelten Ablehnung (dsh-app-boot onRejection).
 *    Der Zähler für `unhandledRejection` muss 0 bleiben.
 *  - Fund 2: die Kindlesung (`beobachte`) steht unter der Frist, auch wenn die Speicherschicht das
 *    Abbruchsignal ignoriert.
 *  - Fund 4: eine fehlende oder unendliche Restzeit ist keine stille Frist.
 *
 * Jede Prüfung hat eine Mutation, die sie rot macht; siehe Messbeleg im Messblatt.
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HEIM = mkdtempSync(join(tmpdir(), 'team-stand-absturz-home-'))
process.env.HOME = HEIM
process.env.USERPROFILE = HEIM
process.env.DSH_HOME = join(HEIM, '.dsh')

const M = await import(new URL('../patches/team-modus.mjs', import.meta.url).href)
const { apply, FRIST_ABGELAUFEN } = M

/** Zähler für unbehandelte Ablehnungen; muss in jeder Prüfung 0 bleiben, wenn der Pfad sauber ist. */
let unbehandelt = 0
const zaehler = () => { unbehandelt += 1 }
process.on('unhandledRejection', zaehler)
afterEach(() => { unbehandelt = 0 })

/**
 * Kontext-Attrappe mit steuerbaren Dienstantworten.
 * `kinderListe(id)` bestimmt die Kinder-Abfrage, `beobachte(id)` das Lesen einer Sitzung.
 */
function baueKontext({ mitglieder = [], kinderListe = async () => [], beobachte = async () => undefined } = {}) {
	const dienste = {
		agentTeams: { listMembers: () => mitglieder },
		subagents: { listChildren: kinderListe },
		sessionQuery: { observeSession: beobachte },
	}
	const werkzeuge = []
	const ctx = {
		get: (name) => { if (!(name in dienste)) throw new Error(`kein Dienst ${name}`); return dienste[name] },
		effect: (fn) => { fn(); return () => {} },
		on: () => () => {},
		agents: { get: () => undefined, list: () => [], roots: () => [] },
		goals: { get: () => undefined },
		tools: { register: (w) => { werkzeuge.push(w); return () => {} }, guard: () => () => {} },
		werkzeuge,
		logger: { info() {}, warn() {} },
	}
	return ctx
}

async function ladeTeamStand(ctx, fristSekunden) {
	const abbau = apply(ctx, { ordner: mkdtempSync(join(HEIM, 'berichte-')), fristSekunden })
	for (let i = 0; i < 50 && !ctx.werkzeuge.some((w) => w.name === 'team_stand'); i += 1) {
		await new Promise((r) => setTimeout(r, 20))
	}
	return { werkzeug: ctx.werkzeuge.find((w) => w.name === 'team_stand'), abbau }
}

const lead = { role: 'lead', name: 'lead', id: 'lead', status: 'inactive' }
const haengt = () => new Promise(() => {})
const ablehnungNach = (ms) => new Promise((_, ablehnen) => setTimeout(() => ablehnen(new Error('Sitzung fehlt')), ms))

// ---------------------------------------------------------------------------------------------------
// 31. Fund 1: Frist 0 und eine Kinderliste, die nach 30 ms ablehnt — KEINE unbehandelte Ablehnung.
// ---------------------------------------------------------------------------------------------------

test('31. Frist 0 + Kinderliste lehnt nach 30 ms ab: keine unbehandelte Ablehnung, team_stand antwortet (Fund 1)', async () => {
	const ctx = baueKontext({
		mitglieder: [lead],
		kinderListe: () => ablehnungNach(30),
	})
	const { werkzeug, abbau } = await ladeTeamStand(ctx, 0)
	const wert = await werkzeug.execute({}, { agent: { id: 'lead' } })
	await new Promise((r) => setTimeout(r, 120)) // Zeit, in der die Ablehnung eintrifft
	assert.equal(unbehandelt, 0, 'der Prozess-Zähler für unbehandelte Ablehnungen bleibt 0')
	assert.ok(wert, 'team_stand antwortet trotzdem')
	abbau?.()
})

// ---------------------------------------------------------------------------------------------------
// 32. Fund 1, Gegenprobe: Frist im Rennen gewinnt NACH dem Start — die Abfrage läuft unbehindert weiter,
//     ihre Ablehnung wird abgefangen (kein Absturz).
// ---------------------------------------------------------------------------------------------------

test('32. Frist gewinnt nach dem Start: die Ablehnung der laufenden Abfrage wird abgefangen (Fund 1, Messung)', async () => {
	const ctx = baueKontext({
		mitglieder: [lead],
		kinderListe: () => ablehnungNach(300),
	})
	const { werkzeug, abbau } = await ladeTeamStand(ctx, 0.1) // 100 ms Frist, Ablehnung nach 300 ms
	await werkzeug.execute({}, { agent: { id: 'lead' } })
	await new Promise((r) => setTimeout(r, 450))
	assert.equal(unbehandelt, 0, 'die späte Ablehnung der schon laufenden Abfrage bleibt abgefangen')
	abbau?.()
})

// ---------------------------------------------------------------------------------------------------
// 33. Fund 2: Kindlesung ignoriert das Abbruchsignal und hängt — team_stand bleibt innerhalb der Frist.
// ---------------------------------------------------------------------------------------------------

test('33. Kindlesung hängt und ignoriert das Signal: team_stand kehrt innerhalb der Frist zurück (Fund 2)', async () => {
	const kinderListe = async (id) => (id === 'lead' ? [{ id: 'kind', label: 'Kind', createdAt: '2026-11-12T00:00:00Z', mode: 'continuable' }] : [])
	const ctx = baueKontext({
		mitglieder: [lead],
		kinderListe,
		beobachte: () => haengt(), // die Speicherschicht antwortet nie, egal welches Signal
	})
	const { werkzeug, abbau } = await ladeTeamStand(ctx, 0.3)
	const anfang = Date.now()
	const wert = await werkzeug.execute({}, { agent: { id: 'lead' } })
	const dauer = Date.now() - anfang
	assert.ok(dauer < 2000, `team_stand bleibt bei hängender Kindlesung innerhalb der Frist (Dauer ${dauer} ms)`)
	assert.ok(wert, 'eine Antwort kommt zurück')
	abbau?.()
})

// ---------------------------------------------------------------------------------------------------
// 34. Fund 4: eine unendliche Restzeit ist keine 1-ms-Frist. Eine Kindlesung, die 50 ms braucht, darf
//     mit Frist „Infinity“ NICHT abgebrochen werden (Mutation: mitFrist-Infinity-Zweig entfernt).
// ---------------------------------------------------------------------------------------------------

test('34. Kindlesung mit unendlicher Restzeit: das Ergebnis kommt zurück, kein 1-ms-Abbruch (Fund 4)', async () => {
	const kinderListe = async (id) => (id === 'lead' ? [{ id: 'kind', label: 'Kind', createdAt: '2026-11-12T00:00:00Z', mode: 'continuable' }] : [])
	const ctx = baueKontext({
		mitglieder: [lead],
		kinderListe,
		beobachte: () => new Promise((r) => setTimeout(() => r(undefined), 50)),
	})
	const { werkzeug, abbau } = await ladeTeamStand(ctx, Infinity)
	const wert = await werkzeug.execute({}, { agent: { id: 'lead' } })
	const text = JSON.stringify(wert)
	assert.doesNotMatch(text, /Zeitgrenze erreicht/, 'mit unendlicher Frist gibt es keine Zeitgrenze')
	abbau?.()
})

// ---------------------------------------------------------------------------------------------------
// 36. Fund 1, Kern: die ECHTE Fassade. Frist 1 ms; die Kinderliste lehnt nach 30 ms ab und läuft damit
//     in die Frist. Die spätere Ablehnung darf nicht unbehandelt bleiben (Mutation „catch entfernt“).
// ---------------------------------------------------------------------------------------------------

test('36. echte Fassade: Frist 1 ms, Kinderliste lehnt nach 30 ms ab: keine unbehandelte Ablehnung (Fund 1, Kern)', async () => {
	const ctx = baueKontext({ mitglieder: [lead], kinderListe: () => ablehnungNach(30) })
	const { werkzeug, abbau } = await ladeTeamStand(ctx, 0.001)
	await werkzeug.execute({}, { agent: { id: 'lead' } })
	await new Promise((r) => setTimeout(r, 120))
	assert.equal(unbehandelt, 0, 'die Ablehnung der laufenden Abfrage bleibt abgefangen')
	abbau?.()
})

// ---------------------------------------------------------------------------------------------------
// 35. Fund 4: eine fehlende Restzeit wirft laut statt still zu laufen.
// ---------------------------------------------------------------------------------------------------

test('35. leseKinderGruppe ohne Restzeit-Funktion wirft laut (Fund 4)', async () => {
	const umgebung = { kinderListe: async () => [], beobachte: async () => undefined, mitFrist: (p) => p, leseMitglied: async () => ({}), uebernahmenListe: () => [], agenten: { get: () => undefined, list: () => [], roots: () => [] } }
	await assert.rejects(() => M.leseKinderGruppe('mitglied', 'exp', umgebung, undefined, [], { gezaehlt: 0 }, () => false, false, new Set()), /Restzeit-Funktion/)
})


// ---------------------------------------------------------------------------------------------------
// 37. Fund 1, Frist 0 (der Lead-Fall): die Abfrage wird GAR NICHT gestartet, wenn die Restzeit schon vorbei
//     ist (Vorprüfung vor dem Aufruf). Mutation „Vorprüfung entfernt“ muss rot werden.
// ---------------------------------------------------------------------------------------------------

test('37. Frist 0: die Kinderliste startet gar nicht, es gibt keine späte Ablehnung (Fund 1, Lead-Fall)', async () => {
	let aufrufe = 0
	const ctx = baueKontext({ mitglieder: [lead], kinderListe: () => { aufrufe += 1; return ablehnungNach(30) } })
	const { werkzeug, abbau } = await ladeTeamStand(ctx, 0)
	await werkzeug.execute({}, { agent: { id: 'lead' } })
	await new Promise((r) => setTimeout(r, 120))
	assert.equal(aufrufe, 0, 'bei Frist 0 wird die Kinderliste nicht gestartet')
	assert.equal(unbehandelt, 0, 'und es entsteht keine unbehandelte Ablehnung')
	abbau?.()
})
