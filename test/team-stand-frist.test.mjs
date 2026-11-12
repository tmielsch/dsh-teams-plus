/**
 * team-stand-frist.test.mjs — die ECHTE Fristfunktion von team_stand (Prüfer-Fund 2, 2026-11-12)
 * =============================================================================================
 *
 * Bisher prüften die Tests 12 und 13 in test/team-stand-unteragenten.test.mjs eine Kopie der Frist.
 * Hier lädt `apply()` aus patches/team-modus.mjs in eine Kontext-Attrappe und prüft das Werkzeug
 * `team_stand` mit einem HÄNGENDEN `subagents.listChildren` gegen eine kurze Frist. Dadurch schlagen
 * die Mutationen fehl, die die Frist aus dem echten Modul entfernen.
 *
 * Die Frist wird über `umgebung.fristSekunden` (Test-Override) gekürzt; der Standard ist 120 Sekunden,
 * dafür prüft Test 22 den Wert ohne Override.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HEIM = mkdtempSync(join(tmpdir(), 'team-stand-frist-home-'))
process.env.HOME = HEIM
process.env.USERPROFILE = HEIM
process.env.DSH_HOME = join(HEIM, '.dsh')

const MODUL_URL = new URL('../patches/team-modus.mjs', import.meta.url)
const M = await import(MODUL_URL.href)
const { apply, STAND_FRIST_S, FRIST_ABGELAUFEN } = M

/**
 * Minimal-Kontext für apply(): nur die Schnittstellen, die apply() beim Laden und im Werkzeug braucht.
 * `listMembers` liefert die Mitgliederliste; `kinderListe` (über den Dienst `subagents`) ist ein Hook.
 */
function baueKontext({ mitglieder = [], kindListe, lebend = {}, beobachteHaengt = false }) {
	const ereignisse = {}
	const agenten = new Map(Object.entries(lebend))
	const dienste = {
		agentTeams: { listMembers: () => mitglieder },
		subagents: { listChildren: kindListe },
		sessionQuery: { observeSession: beobachteHaengt ? () => new Promise(() => {}) : async () => undefined },
	}
	const werkzeuge = []
	const ctx = {
		get: (name) => { if (!(name in dienste)) throw new Error(`kein Dienst ${name}`); return dienste[name] },
		effect: (fn) => { fn(); return () => {} },
		on: (art, fn) => { (ereignisse[art] ??= []).push(fn); return () => {} },
		agents: { get: (id) => agenten.get(id), list: () => [...agenten.values()], roots: () => [] },
		goals: { get: () => undefined },
		tools: {
			register: (werkzeug) => { werkzeuge.push(werkzeug); return () => {} },
			guard: () => () => {},
		},
		werkzeuge,
		logger: { info() {}, warn() {} },
	}
	return ctx
}

/** Startet apply() mit dem Kontext und liefert das registrierte team_stand-Werkzeug. */
async function ladeTeamStand(ctx, ordner, fristSekunden) {
	// Der Test verwendet ein eigenes Berichtsverzeichnis, damit keine Altlasten die Ausgabe stoeren.
	const abbau = apply(ctx, { ordner, fristSekunden })
	// Die Werkzeuge werden asynchron registriert (Kernbausteine laden). Warten bis team_stand da ist.
	for (let i = 0; i < 50 && !ctx.werkzeuge.some((w) => w.name === 'team_stand'); i += 1) {
		await new Promise((r) => setTimeout(r, 20))
	}
	const werkzeug = ctx.werkzeuge.find((w) => w.name === 'team_stand')
	return { werkzeug, abbau }
}

const haengt = () => new Promise(() => {}) // nie aufgelöst: der Kern antwortet nie

/** Nach jeder Prüfung: alle noch offenen Frist-Timer der Attrappe stoppen, damit der Runner endet. */
test.afterEach(() => { for (const t of globalThis.__fristTimer ?? []) clearTimeout(t); globalThis.__fristTimer = [] })

// ---------------------------------------------------------------------------------------------------
// 18. Hängender Katalog des GRUPPENKOPFS: team_stand bleibt innerhalb der Frist, nicht beliebig lang.
// ---------------------------------------------------------------------------------------------------

test('18. hängender Katalog des Gruppenkopfs: team_stand kehrt innerhalb der Frist zurück (Fund 1)', async () => {
	const ctx = baueKontext({
		mitglieder: [{ role: 'lead', name: 'lead', id: 'lead', status: 'inactive' }, { role: 'teammate', name: 'exp', id: 'exp', status: 'inactive' }],
		kindListe: () => haengt(),
	})
	const { werkzeug } = await ladeTeamStand(ctx, undefined, 0.3)
	const anfang = Date.now()
	const wert = await werkzeug.execute({}, { agent: { id: 'lead' } })
	const dauer = Date.now() - anfang
	assert.ok(dauer < 5000, `team_stand kehrt bei hängendem Katalog zurück (Dauer ${dauer} ms)`)
	assert.ok(wert, 'eine Antwort kommt zurück')
})

// ---------------------------------------------------------------------------------------------------
// 19. Hängende Mitgliederzeile: die Gesamtfrist begrenzt auch die Mitgliederlesung.
// ---------------------------------------------------------------------------------------------------

test('19. hängende Mitgliederlesung: die Gesamtfrist begrenzt die Mitgliederzeile (Fund 1, Mutation „Mitgliederfrist entfernt“)', async () => {
	const ctx = baueKontext({
		mitglieder: [{ role: 'lead', name: 'lead', id: 'lead', status: 'inactive' }, { role: 'teammate', name: 'exp', id: 'exp', status: 'inactive' }],
		kindListe: async () => [],
		beobachteHaengt: true,
	})
	const { werkzeug } = await ladeTeamStand(ctx, undefined, 0.3)
	const anfang = Date.now()
	const wert = await werkzeug.execute({}, { agent: { id: 'lead' } })
	assert.ok(Date.now() - anfang < 5000, 'team_stand bleibt innerhalb der Frist, auch wenn die Mitgliederlesung hängt')
	assert.match(JSON.stringify(wert.mitglieder), /Zeitgrenze erreicht/, 'die Mitgliederzeile meldet die Zeitgrenze')
})

// ---------------------------------------------------------------------------------------------------
// 20. Hängender Katalog EINES Kindes: die Frist begrenzt auch das Lesen des Kind-Katalogs.
// ---------------------------------------------------------------------------------------------------

test('20. hängender Katalog eines Kindes: team_stand kehrt innerhalb der Frist zurück (Fund 1, Mutation „Kindfrist entfernt“)', async () => {
	const kindListe = async (id) => {
		if (id === 'lead') return [{ id: 'kind', label: 'Kind', createdAt: '2026-11-12T00:00:00Z', mode: 'continuable' }]
		return haengt() // das Kind selbst liefert seinen Katalog nie
	}
	const ctx = baueKontext({ mitglieder: [{ role: 'lead', name: 'lead', id: 'lead', status: 'inactive' }], kindListe })
	const { werkzeug } = await ladeTeamStand(ctx, undefined, 0.3)
	const anfang = Date.now()
	await werkzeug.execute({}, { agent: { id: 'lead' } })
	assert.ok(Date.now() - anfang < 5000, 'auch der hängende Kind-Katalog wird begrenzt')
})

// ---------------------------------------------------------------------------------------------------
// 21. Treffer der Frist erscheint als Zeile „Zeitgrenze erreicht“ (nicht still).
// ---------------------------------------------------------------------------------------------------

test('21. Treffer der Frist: die Ausgabe trägt „Zeitgrenze erreicht“ (Fund 1)', async () => {
	const ctx = baueKontext({ mitglieder: [{ role: 'lead', name: 'lead', id: 'lead', status: 'inactive' }], kindListe: () => haengt() })
	const { werkzeug } = await ladeTeamStand(ctx, undefined, 0.2)
	const wert = await werkzeug.execute({}, { agent: { id: 'lead' } })
	const text = JSON.stringify(wert)
	assert.match(text, /Zeitgrenze erreicht/, 'der Treffer ist in der Ausgabe sichtbar')
})

// ---------------------------------------------------------------------------------------------------
// 22. Der Standardwert ist 120 Sekunden, nicht 120 Millisekunden (Mutation „* 1 statt * 1000“).
// ---------------------------------------------------------------------------------------------------

test('22. Standard der Gesamtfrist ist 120 Sekunden: die Werkzeugfrist wird aus STAND_FRIST_S * 1000 gebildet (Mutation Werkzeugfrist 120 ms)', () => {
	assert.equal(STAND_FRIST_S, 120, 'Konstante ist 120 Sekunden')
	assert.equal(M.fristSekunden(undefined), 120, 'ohne Override gilt 120 Sekunden')
	assert.equal(M.fristSekunden(0.3), 0.3, 'der Override greift')
	// Die Umrechnung in Millisekunden steht im Modul: fristBis = startMs + fristSekunden(...) * 1000.
	const quelle = readFileSync(MODUL_URL, 'utf8')
	assert.match(quelle, /fristSekunden\(umgebung\.fristSekunden\) \* 1000/, 'die Werkzeugfrist rechnet Sekunden in Millisekunden um')
})

// ---------------------------------------------------------------------------------------------------
// 23. Gegenprobe: ein schneller Katalog wird NICHT durch die Frist abgeschnitten.
// ---------------------------------------------------------------------------------------------------

test('23. schneller Katalog: kein Fehler, keine Zeitgrenze (Gegenprobe zur Frist)', async () => {
	const ctx = baueKontext({ mitglieder: [{ role: 'lead', name: 'lead', id: 'lead', status: 'inactive' }], kindListe: async () => [] })
	const { werkzeug } = await ladeTeamStand(ctx, undefined, 5)
	const wert = await werkzeug.execute({}, { agent: { id: 'lead' } })
	assert.doesNotMatch(JSON.stringify(wert), /Zeitgrenze erreicht/, 'ohne Hängen keine Zeitgrenze')
})

// ---------------------------------------------------------------------------------------------------
// 24. Prüfer-Fund 3: in den Restzeilen einer abgeschnittenen Gruppe bleibt die ECHTE Elternkennung erhalten.
//     Kette kopf → a → b, Budget so knapp, dass b in die Restzeilen fällt: b muss parentId a tragen.
// ---------------------------------------------------------------------------------------------------

test('24. Restzeile einer Tiefe 2: parentId ist die Elternkennung a, nicht der Gruppenkopf (Fund 3)', async () => {
	const kinderVon = { lead: [{ id: 'a', label: 'a', createdAt: '2026-11-12T00:01:00Z', mode: 'continuable' }], a: [{ id: 'b', label: 'b', createdAt: '2026-11-12T00:02:00Z', mode: 'continuable' }], b: [] }
	const umgebung = {
		kinderListe: async (id) => kinderVon[id] ?? [],
		beobachte: async () => undefined,
		mitFrist: (promise) => promise,
		leseMitglied: async () => ({}),
		uebernahmenListe: () => [],
	}
	// Budget 58 vorbelegt: der Kopf zählt 1, a zählt 1; b rutscht in die Restzeilen, damit die Kette abgeschnitten wird.
	const budget = { gezaehlt: 58 }
	const gruppe = await M.leseKinderGruppe('eigeneUnteragenten', 'lead', umgebung, undefined, [], budget, () => false, false, new Set(), () => 120_000)
	const b = gruppe.unteragenten.find((z) => z.id === 'b')
	assert.ok(b, 'b steht in der Gruppe (als Restzeile)')
	assert.equal(b.parentId, 'a', 'die Restzeile b trägt die Elternkennung a, nicht den Gruppenkopf')
})

// ---------------------------------------------------------------------------------------------------
// 25. Prüfer-Fund 6: liefert der Unteragenten-Dienst null (fehlt), trägt der Gruppenkopf den Dienst-fehlt-Text.
// ---------------------------------------------------------------------------------------------------

test('25. Dienst fehlt (kinderListe liefert null): der Gruppenkopf trägt „Unteragenten nicht gelesen: Dienst fehlt“ (Fund 6)', async () => {
	const umgebung = { kinderListe: async () => null, beobachte: async () => undefined, mitFrist: (p) => p, leseMitglied: async () => ({}), uebernahmenListe: () => [] }
	const gruppe = await M.leseKinderGruppe('mitglied', 'exp', umgebung, undefined, [], { gezaehlt: 0 }, () => false, false, new Set(), () => 120_000)
	assert.equal(gruppe.fehler, M.UNTERAGENTEN_DIENST_FEHLT, 'der Null-Pfad erreicht den Dienst-fehlt-Text')
})

// ---------------------------------------------------------------------------------------------------
// 26. Prüfer-Fund 6, M16: das Feld teamModus folgt dem tatsächlichen Team-Modus (nicht immer true).
// ---------------------------------------------------------------------------------------------------

test('26. teamModus: false ohne aktives Teammitglied, true mit aktivem Teammitglied (M16)', async () => {
	// Ohne aktives Teammitglied: kein Team-Modus.
	const ohne = baueKontext({ mitglieder: [{ role: 'lead', name: 'lead', id: 'lead', status: 'inactive' }], kindListe: async () => [] })
	const { werkzeug: wOhne } = await ladeTeamStand(ohne, undefined, 5)
	const ergOhne = await wOhne.execute({}, { agent: { id: 'lead' } })
	assert.equal(ergOhne.teamModus, false, 'ohne aktives Teammitglied ist teamModus false')
	// Mit aktivem Teammitglied: Team-Modus an.
	const mit = baueKontext({ mitglieder: [{ role: 'lead', name: 'lead', id: 'lead', status: 'inactive' }, { role: 'teammate', name: 'exp', id: 'exp', status: 'running' }], kindListe: async () => [] })
	const { werkzeug: wMit } = await ladeTeamStand(mit, undefined, 5)
	const ergMit = await wMit.execute({}, { agent: { id: 'lead' } })
	assert.equal(ergMit.teamModus, true, 'mit aktivem Teammitglied ist teamModus true')
})

// ---------------------------------------------------------------------------------------------------
// 27. Prüfer-Fund 6: das Budget zählt nur tatsächlich eingetragene Restzeilen (nicht vor der Prüfung).
// ---------------------------------------------------------------------------------------------------

test('27. Budget: Restzeilen zählen nur, wenn sie eingetragen werden; vollständig ungelesene Gruppe trägt die Meldung am Kopf (Fund 6)', async () => {
	const kinder = Array.from({ length: 3 }, (_, i) => ({ id: `r${i}`, label: `r${i}`, createdAt: `2026-11-12T00:0${i}:00Z`, mode: 'continuable' }))
	const umgebung = {
		agenten: { get: () => undefined, list: () => [], roots: () => [] },
		kinderListe: async (id) => (id === 'lead' ? kinder : []),
		beobachte: async () => undefined,
		mitFrist: (p) => p,
		leseMitglied: async () => ({}),
		uebernahmenListe: () => [],
	}
	// Fall A: Budget voll (60): keine Kindzeile, Meldung am Kopf, Budget 61 (nur der Kopf).
	const budgetA = { gezaehlt: 60 }
	const gA = await M.leseKinderGruppe('eigeneUnteragenten', 'lead', umgebung, undefined, [], budgetA, () => false, false, new Set(), () => 120_000)
	assert.match(gA.fehler, /Grenze erreicht: 3 Kind-Sitzungen nicht gelesen/, 'vollständig ungelesene Gruppe trägt die Meldung am Kopf')
	assert.equal(budgetA.gezaehlt, 61, 'Budget steht bei 60 Vorbelegung + Kopf 1; die Grenze verhindert jede Kindzeile, und Restzeilen ohne Eintrag zählen nicht')
	// Fall B: Budget 57: Kopf 58, eine Kindzeile 59, dann Abbruch; die zwei übrigen werden Restzeilen.
	const budgetB = { gezaehlt: 57 }
	const gB = await M.leseKinderGruppe('eigeneUnteragenten', 'lead', umgebung, undefined, [], budgetB, () => false, false, new Set(), () => 120_000)
	const kindZeilen = gB.unteragenten.filter((z) => !z.marke)
	const restzeilen = kindZeilen.filter((z) => z.gelesenAus === 'nicht gelesen')
	assert.equal(restzeilen.length, 1, 'eine Restzeile: die dritte Kindzeile, weil das Budget nach zwei gelesenen Kindzeilen abbricht')
	assert.equal(budgetB.gezaehlt, 57 + 1 + 2 + 1, 'Budget (gemessen): Vorbelegung 57, Kopf 1, zwei gelesene Kindzeilen 2, eine Restzeile 1')
})
