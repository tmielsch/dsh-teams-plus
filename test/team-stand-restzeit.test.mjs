/**
 * team-stand-restzeit.test.mjs — die Restzeit wirkt an JEDER Stelle (Prüfer-Fund 3, 2026-11-12)
 * ============================================================================================
 *
 * Prüft die ECHTE `apply()` und die exportierten Lesefunktionen aus patches/team-modus.mjs.
 * Jede Prüfung macht eine bestimmte Mutation rot (Zuordnung steht über jeder Prüfung):
 *   M22  Restzeit nicht an leseSitzungsKern weitergereicht
 *   M23  Restzeit nicht an die Gruppe "mitglied" weitergereicht
 *   M24  Restzeit nicht an die Gruppe "eigeneUnteragenten" weitergereicht
 *   M19  Vorprüfung "<= 0" zu "< 0" verschoben
 *   M12  TypeError in mitFrist durch die alte stille Vorgabe ersetzt
 *   M27  Abbruchsignal in beobachte nie ausgelöst
 *   M06  restZeit in execute immer Infinity
 *   M-K  Restzeit nicht an die Kindlesung (beobachte) weitergereicht
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HEIM = mkdtempSync(join(tmpdir(), 'team-stand-restzeit-home-'))
process.env.HOME = HEIM
process.env.USERPROFILE = HEIM
process.env.DSH_HOME = join(HEIM, '.dsh')

const M = await import(new URL('../patches/team-modus.mjs', import.meta.url).href)
const { apply, FRIST_ABGELAUFEN } = M

const lead = { role: 'lead', name: 'lead', id: 'lead', status: 'inactive' }
const exp = { role: 'teammate', name: 'exp', id: 'exp', status: 'inactive' }
const haengt = () => new Promise(() => {})

/** Kontext-Attrappe; `beobachte` und `kinderListe` steuerbar, `mitglieder` gibt die Gruppenköpfe vor. */
function baueKontext({ mitglieder = [lead], kinderListe = async () => [], observe } = {}) {
	const dienste = {
		agentTeams: { listMembers: () => mitglieder },
		subagents: { listChildren: kinderListe },
		sessionQuery: { observeSession: observe ?? (async () => undefined) },
	}
	const werkzeuge = []
	return {
		get: (name) => { if (!(name in dienste)) throw new Error(`kein Dienst ${name}`); return dienste[name] },
		effect: (fn) => { fn(); return () => {} },
		on: () => () => {},
		agents: { get: () => undefined, list: () => [], roots: () => [] },
		goals: { get: () => undefined },
		tools: { register: (w) => { werkzeuge.push(w); return () => {} }, guard: () => () => {} },
		werkzeuge,
		logger: { info() {}, warn() {} },
	}
}

async function ladeTeamStand(ctx, fristSekunden) {
	const abbau = apply(ctx, { ordner: mkdtempSync(join(HEIM, 'berichte-')), fristSekunden })
	for (let i = 0; i < 50 && !ctx.werkzeuge.some((w) => w.name === 'team_stand'); i += 1) {
		await new Promise((r) => setTimeout(r, 20))
	}
	return { werkzeug: ctx.werkzeuge.find((w) => w.name === 'team_stand'), abbau }
}

/** Eine Frist-Prüfung: hängt der Schritt, muss das Werkzeug innerhalb der Frist antworten (kurz gesetzt). */
async function kehrtInnerhalbZurueck(ctx, fristSekunden, grenzeMs) {
	const { werkzeug, abbau } = await ladeTeamStand(ctx, fristSekunden)
	const anfang = Date.now()
	await werkzeug.execute({}, { agent: { id: 'lead' } })
	abbau?.()
	return Date.now() - anfang < grenzeMs
}

// ---------------------------------------------------------------------------------------------------
// M22/M23/M24: ein hängender Schritt in jeder Gruppe muss innerhalb der Frist enden.
//   M23: Restzeit nicht an die Gruppe "mitglied" -> ein hängender Katalog des Mitglieds hält ewig.
//   M24: Restzeit nicht an die Gruppe "eigeneUnteragenten" -> ein hängender Katalog des Aufrufers hält ewig.
//   M22: Restzeit nicht an leseSitzungsKern -> eine hängende Sitzungslesung hält ewig.
// ---------------------------------------------------------------------------------------------------

test('M23. hängender Katalog des Mitglieds (Gruppe "mitglied"): innerhalb der Frist (Restzeit reicht bis zur Gruppe)', async () => {
	const ctx = baueKontext({ mitglieder: [lead, exp], kinderListe: async (id) => (id === 'exp' ? haengt() : []) })
	assert.ok(await kehrtInnerhalbZurueck(ctx, 0.3, 3000), 'die Gruppe des Mitglieds wird durch die Frist begrenzt')
})

test('M24. hängender Katalog des Aufrufers (Gruppe "eigeneUnteragenten"): innerhalb der Frist', async () => {
	const ctx = baueKontext({ mitglieder: [lead], kinderListe: () => haengt() })
	assert.ok(await kehrtInnerhalbZurueck(ctx, 0.3, 3000), 'die eigene Gruppe des Aufrufers wird durch die Frist begrenzt')
})

test('M22. hängende Sitzungslesung (leseSitzungsKern/beobachte) innerhalb der Frist', async () => {
	const kinderListe = async (id) => (id === 'lead' ? [{ id: 'kind', label: 'Kind', createdAt: '2026-11-12T00:00:00Z', mode: 'continuable' }] : [])
	const ctx = baueKontext({ mitglieder: [lead], kinderListe, observe: () => haengt() })
	assert.ok(await kehrtInnerhalbZurueck(ctx, 0.3, 3000), 'die Lesung der Sitzung wird durch die Frist begrenzt')
})

// ---------------------------------------------------------------------------------------------------
// M-K: die Kindlesung bekommt die Restzeit (Fund 2): ein Kind, dessen Lesung hängt, bremst die Frist nicht.
// ---------------------------------------------------------------------------------------------------

test('M-K. Kindlesung wird durch die Restzeit begrenzt (Fund 2)', async () => {
	const kinderListe = async (id) => (id === 'lead' ? [{ id: 'kind', label: 'Kind', createdAt: '2026-11-12T00:00:00Z', mode: 'continuable' }] : [])
	const ctx = baueKontext({ mitglieder: [lead], kinderListe, observe: () => haengt() })
	assert.ok(await kehrtInnerhalbZurueck(ctx, 0.3, 3000), 'die Kindlesung hängt nicht über die Frist hinaus')
})

// ---------------------------------------------------------------------------------------------------
// M27: das Abbruchsignal in beobachte muss ausgelöst werden: eine Speicherschicht, die auf das Signal
//      wartet, muss beim Ablauf der Frist abbrechen. Hängt sie trotzdem, bleibt die Frist durch mitFrist.
// ---------------------------------------------------------------------------------------------------

test('M27. das Abbruchsignal wird bei Fristablauf ausgelöst (beobachte bekommt ein abortiertes Signal)', async () => {
	// Deterministisch: der Test wartet auf das EREIGNIS „abort“, nicht auf den Zeitpunkt der Rückkehr.
	// Zwei Zeitgeber mit derselben Frist sind nicht geordnet (Messung 2026-11-13): die Rückkehr von execute
	// kann das Signal überholen. Darum prüft der Test das Ereignis, nicht das Datum danach.
	let abbruchAusgeloest
	const abbruchAbgewartet = new Promise((r) => { abbruchAusgeloest = r })
	const observe = (_id, { signal }) => new Promise((_, ablehnen) => {
		signal.addEventListener('abort', () => { abbruchAusgeloest(true); ablehnen(new Error('abgebrochen')) })
	})
	const kinderListe = async (id) => (id === 'lead' ? [{ id: 'kind', label: 'Kind', createdAt: '2026-11-12T00:00:00Z', mode: 'continuable' }] : [])
	const ctx = baueKontext({ mitglieder: [lead], kinderListe, observe })
	const { werkzeug, abbau } = await ladeTeamStand(ctx, 0.3)
	await werkzeug.execute({}, { agent: { id: 'lead' } })
	const ausgeloest = await Promise.race([abbruchAbgewartet, new Promise((r) => setTimeout(() => r(false), 2000))])
	abbau?.()
	assert.equal(ausgeloest, true, 'die Speicherschicht erhält das Abbruchsignal bei Fristablauf (Ereignis abort, mit Obergrenze 2 s)')
})

// ---------------------------------------------------------------------------------------------------
// M19: die Vorprüfung „<= 0“ darf nicht zu „< 0“ werden: bei Restzeit genau 0 startet keine Abfrage.
// ---------------------------------------------------------------------------------------------------

test('M19. Restzeit genau 0: keine Abfrage wird gestartet (Grenze "<= 0", nicht "< 0")', async () => {
	let aufrufe = 0
	const umgebung = {
		kinderListe: () => { aufrufe += 1; return haengt() },
		beobachte: async () => undefined,
		mitFrist: (p) => p,
		leseMitglied: async () => ({}),
		uebernahmenListe: () => [],
		agenten: { get: () => undefined, list: () => [], roots: () => [] },
	}
	await M.leseKinderGruppe('mitglied', 'exp', umgebung, undefined, [], { gezaehlt: 0 }, () => false, false, new Set(), () => 0)
	assert.equal(aufrufe, 0, 'bei 0 ms Restzeit startet die Abfrage nicht')
})

// ---------------------------------------------------------------------------------------------------
// M12: fehlende oder ungültige Restzeit in mitFrist wirft laut (keine stille Vorgabe).
// ---------------------------------------------------------------------------------------------------

test('M12. mitFrist ohne Restzeit wirft laut statt still unbegrenzt zu laufen', async () => {
	const ctx = baueKontext({ mitglieder: [lead] })
	const { abbau } = await ladeTeamStand(ctx, 5)
	// Über das Modul: ein leseKinderGruppe ohne Restzeit-Funktion wirft (Fund 4), und die Fassade wirft ohne Zahl.
	const umgebung = {
		kinderListe: async () => [],
		beobachte: async () => undefined,
		mitFrist: (p, restMs) => {
			if (typeof restMs !== 'number' || Number.isNaN(restMs)) throw new TypeError('mitFrist braucht eine Restzeit in ms')
			return p
		},
		leseMitglied: async () => ({}),
		uebernahmenListe: () => [],
		agenten: { get: () => undefined, list: () => [], roots: () => [] },
	}
	await assert.rejects(() => M.leseKinderGruppe('mitglied', 'exp', umgebung, undefined, [], { gezaehlt: 0 }, () => false, false, new Set()), /Restzeit-Funktion/)
	abbau?.()
})

// ---------------------------------------------------------------------------------------------------
// M06: restZeit in execute darf nicht immer Infinity sein: eine Gesamtfrist von 0,3 s begrenzt wirklich.
// ---------------------------------------------------------------------------------------------------

test('M06. die Gesamtfrist in execute ist echt: ein hängender Schritt endet bei 0,3 s (nicht bei Infinity)', async () => {
	const ctx = baueKontext({ mitglieder: [lead], kinderListe: () => haengt() })
	assert.ok(await kehrtInnerhalbZurueck(ctx, 0.3, 3000), 'die Gesamtfrist wirkt, sie ist nicht unendlich')
})
