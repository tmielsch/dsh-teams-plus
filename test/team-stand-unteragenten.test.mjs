/**
 * team-stand-unteragenten.test.mjs — die Unteragenten-Erweiterung von `team_stand` (Plan Abschnitt 7)
 * =====================================================================================================
 *
 * Geprüft wird `patches/team-modus.mjs` (Stand dieses Worktrees) gegen eine Attrappe des Hosts.
 * Plan: `docs/PLAN-TEAM-STAND-UNTERAGENTEN.md`, Zielbrief: `docs/ZIELBRIEF-BAU-TEAM-STAND-2026-11-10.md`.
 * Die Nummern unten nennen die Abnahmezeile des Plans, wo eine Attrappenform möglich ist; die Proben,
 * die einen echten Kernbaum brauchen (Gruppen gegen echten Katalog, Weckrufzähler, echte Übernahme-Datei),
 * laufen in der Wegwerf-Probeinstanz: `docs/messung-team-stand-unteragenten/ABNAHME-NACHBAU-2026-11-11.md`.
 *
 * Gegenprobe (Prüfung 9): das Alte Modul aus Git (Commit de28469 = Stand vor diesem Bau, noch ohne diese
 * Erweiterung) muss auf derselben Szene die Kinderzeilen schuldig bleiben. Wie in `team-modus.test.mjs`
 * Prüfungen 15/16 gilt: ein Test, der mit dem Alten genauso grün wäre, prüfte nichts.
 *
 * Hermetisch: `HOME` und `DSH_HOME` zeigen auf ein Temp-Verzeichnis, bevor das Modul geladen wird.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HEIM = mkdtempSync(join(tmpdir(), 'team-stand-ua-home-'))
process.env.HOME = HEIM
process.env.USERPROFILE = HEIM
process.env.DSH_HOME = join(HEIM, '.dsh')

const MODUL_URL = new URL('../patches/team-modus.mjs', import.meta.url)
const REPO = fileURLToPath(new URL('..', MODUL_URL)).replace(/\/$/, '')
const M = await import(MODUL_URL.href)
const {
	baueStandWerkzeug, leseMitglied, leseKinderGruppe, angehaltenSeitAus,
	UNTERAGENTEN_DIENST_FEHLT, UNBEKANNT_AKTIVIERUNG, KIND_GRENZE, STAND_FRIST_S,
	schreibeBericht, notschalterGedrueckt
} = M

// ---------------------------------------------------------------------------------------------------
// Die Attrappe: Lead mit Teammitgliedern und deren Unteragenten-Bäumen
// ---------------------------------------------------------------------------------------------------

/** Ein Kind im Katalog des Kerns: `listChildren` liefert je Zeile id, createdAt, mode, label (kein parentId). */
const katalogZeile = (id, label, createdAt) => ({ id, createdAt, mode: 'continuable', label })

/**
 * Eine Szene. `kataloge` bildet Elternkennung → Katalogzeilen; eine fehlende Kennung heißt „Katalog nicht
 * lesbar“ (der Helfer wirft), `dienstFehlt` heißt null. `lebendeZiele` sind die Agenten im Speicher samt Ziel,
 * alles andere fällt in die gespeicherte Sitzung; `beobachtungen` liefert je Kennung die Ziel-Projektion
 * (null = gültige Sitzung ohne Ziel), eine dort fehlende Kennung heißt „nicht lesbar“ (Plan Abnahme 3).
 */
function baueSzene({ kataloge = {}, mitglieder = [], lebendeZiele = {}, beobachtungen = {}, uebernahmen = [], dienstFehlt = false } = {}) {
	const ordner = mkdtempSync(join(tmpdir(), 'team-stand-ua-berichte-'))
	const agenten = new Map()
	for (const [id, z] of Object.entries(lebendeZiele)) {
		agenten.set(id, { id, status: z.status ?? 'running', session: { seq: 3, snapshotEvents: () => [{ time: Date.parse('2026-11-11T01:00:00Z') }] } })
	}
	const registry = { get: (id) => agenten.get(id), list: () => [...agenten.values()], roots: () => [] }
	const geleseneKataloge = []
	const umgebung = {
		agenten: registry,
		teams: () => ({ listMembers: () => mitglieder }),
		notschalter: () => notschalterGedrueckt(() => {}, join(HEIM, 'gibt-es-nicht.json')),
		ziel: (agent) => lebendeZiele[agent.id],
		uebernahmenListe: () => uebernahmen,
		beobachte: async (id) => {
			if (!(id in beobachtungen)) return undefined // nicht lesbar — unterscheidbar von „kein Ziel“ (null)
			return { projections: { values: { goal: beobachtungen[id] } }, events: [{ time: Date.parse('2026-11-11T00:00:00Z') }], [Symbol.dispose]() {} }
		},
		kinderListe: async (id) => {
			if (dienstFehlt) return null // der Unteragenten-Dienst fehlt (Plan Schritt 2)
			geleseneKataloge.push(id)
			if (!(id in kataloge)) throw new Error('Katalog-Datei kaputt')
			return kataloge[id]
		}
	}
	umgebung.leseMitglied = (zeile, o, liste) => leseMitglied(zeile, umgebung, o, liste)
	const lead = { id: 'lead', status: 'inactive' }
	return { umgebung, ordner, lead, geleseneKataloge, baue: (modul, werkzeugOrdner = ordner) => modul.baueStandWerkzeug({ defineTool: (d) => d, umgebung, ordner: werkzeugOrdner }) }
}

const ziel = (id, zusatz = {}) => ({ id, revision: 1, objective: 'Kind-Ziel ' + id, phase: 'active', activation: 'armed', roundsStarted: 2, maxGoalRounds: 40, status: 'running', ...zusatz })

// ---------------------------------------------------------------------------------------------------
// 1. Plan-Abnahme 1 in Attrappenform: gruppiert je Mitarbeiter, Enkel depth 2 mit parentId
// ---------------------------------------------------------------------------------------------------

test('1. zwei Mitglieder plus Aufruferkind: drei Gruppen; Kind depth 1, Enkel depth 2 mit parentId aufs Kind (Plan Nr. 1)', async () => {
	const s = baueSzene({
		kataloge: {
			lead: [katalogZeile('hilf', 'Helfer des Leads', '2026-11-11T00:05:00Z')],
			exp: [katalogZeile('fachA', 'Facharbeiter A', '2026-11-11T00:01:00Z'), katalogZeile('fachB', 'Facharbeiter B ohne Ziel', '2026-11-11T00:02:00Z')],
			fachA: [katalogZeile('enkel', 'Enkelkind von A', '2026-11-11T00:03:00Z')],
			fachB: [], enkel: [], hilf: [], ruhig: []
		},
		mitglieder: [
			{ role: 'lead', name: 'lead', id: 'lead', status: 'inactive' },
			{ role: 'teammate', name: 'exp', id: 'exp', status: 'running' },
			{ role: 'teammate', name: 'ruhig', id: 'ruhig', status: 'inactive' }
		],
		lebendeZiele: { exp: ziel('z-exp'), fachA: ziel('z-fachA') },
		beobachtungen: { ruhig: null, fachB: null, enkel: { goal: { id: 'z-enkel', revision: 2, objective: 'Enkel-Ziel', phase: 'blocked' }, roundsStarted: 5 }, hilf: null }
	})
	const stand = await s.baue(M).execute({}, { agent: s.lead })
	assert.ok(Array.isArray(stand.untergruppen), 'Feld untergruppen ist eine Liste')
	const mitgliedGruppen = stand.untergruppen.filter((g) => g.gruppe === 'mitglied')
	assert.equal(mitgliedGruppen.length, 2, 'je Teammitglied eine Gruppe')
	assert.deepEqual(mitgliedGruppen.map((g) => g.id), ['exp', 'ruhig'], 'Reihenfolge folgt listMembers')
	assert.deepEqual(stand.untergruppen.map((g) => g.gruppe), ['mitglied', 'mitglied', 'eigeneUnteragenten'], 'die eigene Gruppe steht zuletzt')

	const gruppeExp = mitgliedGruppen[0]
	assert.equal(gruppeExp.unteragenten.length, 3, 'A, B und der Enkel stehen in derselben Gruppe (keine separate Enkel-Ebene)')
	const a = gruppeExp.unteragenten.find((z) => z.id === 'fachA'), b = gruppeExp.unteragenten.find((z) => z.id === 'fachB'), e = gruppeExp.unteragenten.find((z) => z.id === 'enkel')
	assert.equal(a.depth, 1); assert.equal(a.parentId, 'exp', 'direktes Kind zeigt auf den Gruppenkopf')
	assert.equal(b.depth, 1); assert.equal(b.parentId, 'exp'); assert.equal(b.ziel, null, 'Kind ohne Ziel: ziel ist null (Plan Nr. 3)')
	assert.equal(e.depth, 2, 'Enkel trägt depth 2 (Plan Nr. 1)')
	assert.equal(e.parentId, 'fachA', 'Enkel zeigt mit parentId auf das direkte Kind derselben Gruppe')
	assert.equal(a.ziel.phase, 'active'); assert.equal(a.ziel.runden, 2); assert.equal(a.ziel.maxRunden, 40)
	assert.equal(a.label, 'Facharbeiter A', 'lesbarer Name kommt aus dem Katalog-Label')
	assert.equal(e.ziel.phase, 'blocked'); assert.equal(e.ziel.runden, 5, 'Phase und Runden eines Abgekommenen kommen aus der Datei-Projektion (Messung T2b)')

	const gruppeRuhig = mitgliedGruppen[1]
	assert.deepEqual(gruppeRuhig.unteragenten, [], 'Mitglied ohne Kinder: leere Liste, kein Fehlerfeld')
	assert.equal(gruppeRuhig.fehler, undefined)
})

// ---------------------------------------------------------------------------------------------------
// 2. Plan-Abnahme 5: das Teammitglied erscheint als Gruppenkopf, nie noch einmal als Kinderzeile
// ---------------------------------------------------------------------------------------------------

test('2. Doppelung: der Experte steht im Kinderkatalog des Leads und doch nur als Gruppenkopf (Plan Nr. 5)', async () => {
	const s = baueSzene({
		kataloge: {
			lead: [katalogZeile('exp', 'Probe-Experte', '2026-11-11T00:00:00Z'), katalogZeile('hilf', 'Helfer des Leads', '2026-11-11T00:04:00Z')],
			exp: [katalogZeile('fachA', 'Facharbeiter A', '2026-11-11T00:01:00Z')],
			fachA: [], hilf: []
		},
		mitglieder: [{ role: 'lead', name: 'lead', id: 'lead', status: 'inactive' }, { role: 'teammate', name: 'exp', id: 'exp', status: 'running' }],
		lebendeZiele: { exp: ziel('z-exp'), fachA: ziel('z-fachA') },
		beobachtungen: { hilf: null }
	})
	const stand = await s.baue(M).execute({}, { agent: s.lead })
	const alle = stand.untergruppen.flatMap((g) => g.unteragenten.map((z) => ({ gruppe: g.gruppe, id: z.id })))
	assert.equal(alle.filter((z) => z.id === 'exp').length, 0, 'der Experte steht in keiner Kinderliste — nur als Gruppenkopf seiner eigenen Gruppe')
	assert.deepEqual(stand.untergruppen.map((g) => g.id), ['exp', 'lead'], 'Mitglied-Gruppe zuerst, dann die eigene Gruppe des Aufrufers')
	const eigene = stand.untergruppen.find((g) => g.gruppe === 'eigeneUnteragenten')
	assert.deepEqual(eigene.unteragenten.map((z) => z.id), ['hilf'], 'nur das echte eigene Kind bleibt in der eigenen Gruppe')
	assert.equal(s.geleseneKataloge.filter((i) => i === 'exp').length, 1, 'den Katalog des Experten lesen wir genau einmal (sein Unterbaum wird aus der eigenen Gruppe nicht erneut betreten) — Kennungsregel, nie Name')
})

// ---------------------------------------------------------------------------------------------------
// 3. Plan-Abnahme 9: angehaltenSeit kommt aus dem Eintrag selbst, unabhängig von pauseOffen (N1/N6)
// ---------------------------------------------------------------------------------------------------

test('3. angehaltenSeit: ruhend und laufend denselben Zeitstempel; ohne Eintrag null, nicht „unbekannt“ (Plan Nr. 9)', async () => {
	const seit = '2026-11-11T00:07:00.000Z'
	const s = baueSzene({
		kataloge: { exp: [katalogZeile('fachA', 'A', '2026-11-11T00:01:00Z'), katalogZeile('ruht', 'B', '2026-11-11T00:02:00Z')], fachA: [], ruht: [] },
		mitglieder: [{ role: 'lead', name: 'lead', id: 'lead', status: 'inactive' }, { role: 'teammate', name: 'exp', id: 'exp', status: 'running' }],
		lebendeZiele: { exp: ziel('z-exp'), fachA: ziel('z-fachA') },
		beobachtungen: { ruht: null },
		uebernahmen: [
			{ id: 'exp', name: 'exp', zielId: 'z-exp', seit, pauseOffen: false },   // Fall (a): ruhendes Mitglied
			{ id: 'fachA', name: 'A', zielId: 'z-fachA', seit, pauseOffen: true },  // Fall (b): Runde läuft noch
			{ id: 'ruht', name: 'B', zielId: 'z-ruht', seit, pauseOffen: false }    // Fall (a) für ein Kind
		]
	})
	const stand = await s.baue(M).execute({}, { agent: s.lead })
	assert.equal(stand.mitglieder.find((m) => m.name === 'exp').angehaltenSeit, seit, 'Fall (a): Mitglied zeigt den Zeitstempel')
	const kinder = stand.untergruppen.find((g) => g.id === 'exp').unteragenten
	assert.equal(kinder.find((z) => z.id === 'fachA').angehaltenSeit, seit, 'Fall (b): Kind mit pauseOffen true — derselbe Zeitstempel')
	assert.equal(kinder.find((z) => z.id === 'ruht').angehaltenSeit, seit, 'Fall (a) für ein Kind: beide Nachbarzustände zeigen dieselbe Zeit')
	// Fall (c): Agent ohne Eintrag („kein laufendes Ziel“ wird nie eingetragen).
	const s2 = baueSzene({ kataloge: { exp: [katalogZeile('ohneZiel', 'C', '2026-11-11T00:03:00Z')], ohneZiel: [] }, mitglieder: [{ role: 'teammate', name: 'exp', id: 'exp', status: 'running' }], beobachtungen: { ohneZiel: null } })
	const stand2 = await s2.baue(M).execute({}, { agent: s2.lead })
	assert.equal(stand2.untergruppen.find((g) => g.id === 'exp').unteragenten[0].angehaltenSeit, null, 'Fall (c): nie angehalten heißt null — ausdrücklich nicht „unbekannt“')
	// Der Helfer selbst, beide Nachbarzustände:
	const liste = [{ id: 'x', seit }, { id: 'y', seit, pauseOffen: true }]
	assert.equal(angehaltenSeitAus(liste, 'x'), seit)
	assert.equal(angehaltenSeitAus(liste, 'y'), seit)
	assert.equal(angehaltenSeitAus(liste, 'z'), null)
})

// ---------------------------------------------------------------------------------------------------
// 4. Plan-Abnahme 8: Aktivierung bei Abgebauten ehrlich unbekannt (Entscheidung O1)
// ---------------------------------------------------------------------------------------------------

test('4. abgebaut: aktivierung „unbekannt (sitzt nicht in der Datei)“, Phase trotzdem da; lebend mit Wert (Plan Nr. 8)', async () => {
	const s = baueSzene({
		kataloge: { exp: [katalogZeile('tot', 'Abgebaut', '2026-11-11T00:01:00Z')], tot: [] },
		mitglieder: [{ role: 'teammate', name: 'exp', id: 'exp', status: 'inactive' }],
		lebendeZiele: { exp: ziel('z-exp', { status: 'inactive' }) },
		beobachtungen: { tot: { goal: { id: 'z-tot', revision: 1, objective: 'Datei-Ziel', phase: 'paused' }, roundsStarted: 9 } }
	})
	const stand = await s.baue(M).execute({}, { agent: s.lead })
	const kind = stand.untergruppen.find((g) => g.id === 'exp').unteragenten[0]
	assert.equal(kind.zustand, 'abgebaut', 'Zustandszeile läuft/ruht/abgebaut')
	assert.equal(kind.ziel.phase, 'paused', 'die pausierte Phase überlebt den Abbau (Messung ua2)')
	assert.equal(kind.aktivierung, UNBEKANNT_AKTIVIERUNG)
	assert.equal(UNBEKANNT_AKTIVIERUNG, 'unbekannt (sitzt nicht in der Datei)', 'Wortlaut gemäß Menschenentscheidung O1')
	// Lebendes Kind dagegen: die Aktivierung sitzt da.
	const s2 = baueSzene({ kataloge: { exp: [katalogZeile('leb', 'Lebend', '2026-11-11T00:01:00Z')], leb: [] }, mitglieder: [{ role: 'teammate', name: 'exp', id: 'exp', status: 'inactive' }], lebendeZiele: { leb: ziel('z-leb') } })
	const stand2 = await s2.baue(M).execute({}, { agent: s2.lead })
	assert.equal(stand2.untergruppen.find((g) => g.id === 'exp').unteragenten[0].aktivierung, 'armed', 'lebendes Kind zeigt seine Aktivierung')
})

// ---------------------------------------------------------------------------------------------------
// 5. Plan-Abnahme 3: „kein Ziel“ (null) unterscheidbar von „nicht lesbar“
// ---------------------------------------------------------------------------------------------------

test('5. ziel null (Sitzung ohne Ziel) vs. gelesenAus „nicht lesbar“ — unterscheidbar (Plan Nr. 3)', async () => {
	const s = baueSzene({
		kataloge: { exp: [katalogZeile('keinZiel', 'Ohne Ziel', '2026-11-11T00:01:00Z'), katalogZeile('kaputtId', 'Kaputte Kopie', '2026-11-11T00:02:00Z')], keinZiel: [] },
		mitglieder: [{ role: 'teammate', name: 'exp', id: 'exp', status: 'inactive' }],
		beobachtungen: { keinZiel: null } // kaputtId fehlt absichtlich -> nicht lesbar
	})
	const stand = await s.baue(M).execute({}, { agent: s.lead })
	const kinder = stand.untergruppen.find((g) => g.id === 'exp').unteragenten
	assert.equal(kinder.length, 2, 'beide Kinder bleiben als Zeile stehen (Plan: kaputte Lesung != toter Agent)')
	const ohne = kinder.find((z) => z.id === 'keinZiel'), kaputt = kinder.find((z) => z.id === 'kaputtId')
	assert.equal(ohne.ziel, null); assert.equal(ohne.gelesenAus, 'gespeicherte Sitzung')
	assert.equal(kaputt.ziel, null); assert.equal(kaputt.gelesenAus, 'nicht lesbar')
})

// ---------------------------------------------------------------------------------------------------
// 6. O3-Budget: Kinder-Obergrenze 60 und Summenfrist 120 Sekunden; Schnittmeldung je Gruppe (Plan Schritt 3)
// ---------------------------------------------------------------------------------------------------

test('6. O3-Werte gesetzt: Grenze 60 Sitzungen, Frist 120 Sekunden; beide Schnitte melden an der Gruppengrenze', async () => {
	assert.equal(KIND_GRENZE, 60); assert.equal(STAND_FRIST_S, 120)

	// Zahlengrenze: 63 eigene Kinder. Kopf (lead) zählt mit -> 59 Kindzeilen gelesen, der Rest markiert.
	const viele = Array.from({ length: 63 }, (_, i) => katalogZeile(`k${i}`, 'Kind ' + i, `2026-11-11T00:${String(i).padStart(2, '0')}:00Z`))
	const s = baueSzene({ kataloge: { lead: viele }, mitglieder: [], beobachtungen: Object.fromEntries(viele.map((z) => [z.id, null])) })
	const stand = await s.baue(M).execute({}, { agent: s.lead })
	const eigene = stand.untergruppen.find((g) => g.gruppe === 'eigeneUnteragenten')
	const marker = eigene.unteragenten.filter((z) => z.marke === 'grenze')
	assert.equal(marker.length, 1, 'genau eine Markerzeile (eine je Gruppe, nicht je Sitzung)')
	assert.match(marker[0].text, /^Grenze erreicht: \d+ Kind-Sitzungen nicht gelesen$/)
	const gelesene = eigene.unteragenten.filter((z) => z.marke === undefined && z.gelesenAus !== 'nicht gelesen')
	assert.equal(gelesene.length, 59, 'mit Kopf sind das genau KIND_GRENZE=60 Sitzungen')
	assert.equal(eigene.unteragenten.filter((z) => z.gelesenAus === 'nicht gelesen').length, 4, 'die übrigen vier stehen als „nicht gelesen“ darunter')

	// Zeitgrenze direkt an der Gruppenfunktion: abgelaufene Frist vor dem ersten Kind -> Meldung am Kopf.
	const g1 = await leseKinderGruppe('eigeneUnteragenten', 'lead', s.umgebung, s.ordner, [], { gezaehlt: 0 }, () => true, false, new Set())
	assert.match(g1.fehler ?? '', /^Zeitgrenze erreicht: \d+ Kinder nicht gelesen$/, 'vollständig ungelesene Gruppe trägt die Zeitmeldung im Feld fehler')
	// Teilweise gelesen: drei Zeilen schaffen es noch vor der Frist, dann kommt der Marker.
	let tacker = 0
	const g2 = await leseKinderGruppe('eigeneUnteragenten', 'lead', s.umgebung, s.ordner, [], { gezaehlt: 0 }, () => (tacker += 1) > 3, false, new Set())
	assert.equal(g2.fehler, undefined)
	const m2 = g2.unteragenten.filter((z) => z.marke === 'grenze')
	assert.equal(m2.length, 1); assert.match(m2[0].text, /^Zeitgrenze erreicht: \d+ Kinder nicht gelesen$/)
})

// ---------------------------------------------------------------------------------------------------
// 7. Plan Schritt 2: fehlt der Unteragenten-Dienst, bleiben die Mitglieder; eine Zeile nennt den Grund
// ---------------------------------------------------------------------------------------------------

test('7. Dienst fehlt: jede Gruppe trägt „Unteragenten nicht gelesen: Dienst fehlt“, Mitgliederzeile bleibt (Plan Schritt 2)', async () => {
	const s = baueSzene({ dienstFehlt: true, mitglieder: [{ role: 'teammate', name: 'exp', id: 'exp', status: 'running' }], lebendeZiele: { exp: ziel('z-exp') } })
	const stand = await s.baue(M).execute({}, { agent: s.lead })
	assert.equal(stand.mitglieder.length, 1, 'die Mitgliederzeile steht weiterhin')
	assert.equal(stand.untergruppen.length, 2)
	for (const g of stand.untergruppen) {
		assert.equal(g.fehler, UNTERAGENTEN_DIENST_FEHLT)
		assert.deepEqual(g.unteragenten, [])
	}
})

// ---------------------------------------------------------------------------------------------------
// 8. Plan-Abnahme 7: Berichtsweg für Unteragenten — lebend wie abgebaut, über die Zielkennung
// ---------------------------------------------------------------------------------------------------

test('8. bericht true bei Kind mit Schlussbericht, lebend und aus der Datei (Plan Nr. 7)', async () => {
	const ordner = join(HEIM, 'bericht-ordner-8')
	schreibeBericht({ zielId: 'z-fachA', revision: 1, sitzung: 'fachA', zeit: new Date().toISOString(), wortlautZiel: 'Kind-Ziel z-fachA', bericht: 'Fertig gemessen.' }, ordner)
	schreibeBericht({ zielId: 'z-totkind', revision: 1, sitzung: 'totkind', zeit: new Date().toISOString(), wortlautZiel: 'Datei-Ziel', bericht: 'Auch fertig.' }, ordner)
	const s = baueSzene({
		kataloge: { exp: [katalogZeile('fachA', 'A', '2026-11-11T00:01:00Z'), katalogZeile('totkind', 'Tot', '2026-11-11T00:02:00Z')], fachA: [], totkind: [] },
		mitglieder: [{ role: 'teammate', name: 'exp', id: 'exp', status: 'inactive' }],
		lebendeZiele: { fachA: ziel('z-fachA') },
		beobachtungen: { totkind: { goal: { id: 'z-totkind', revision: 1, objective: 'Datei-Ziel', phase: 'complete' }, roundsStarted: 3 } }
	})
	const stand = await s.baue(M, ordner).execute({}, { agent: s.lead })
	const kinder = stand.untergruppen.find((g) => g.id === 'exp').unteragenten
	assert.equal(kinder.find((z) => z.id === 'fachA').bericht, true, 'lebendes Kind mit Bericht')
	assert.equal(kinder.find((z) => z.id === 'totkind').bericht, true, 'abgebautes Kind: die Zielkennung überlebt die Dateilesung und findet den Bericht')
})

// ---------------------------------------------------------------------------------------------------
// 10. Plan Nr. 2 + Kern-Ausgabepruefung: die Ausgabe ist in jedem Zweig verlustfrei JSON.
//     Die Kernpruefung wirft undefined-Werte, nicht-finite Zahlen, BigInt und Prototypen ausser Object/Array.
//     Ein Test, der nur „er läuft durch“ prueft, haette den Original-Fehler (aktivierung: undefined) durchgelassen.
// ---------------------------------------------------------------------------------------------------

function istPlainObjekt(wert) {
	if (wert === null || typeof wert !== "object") return false;
	const p = Object.getPrototypeOf(wert);
	return p === null || (typeof p === "object" && Object.getPrototypeOf(p) === null);
}

/** Prueft die Ausgabe gegen dieselben Regeln wie `snapshotJsonValue` in `dsh-util-values`. */
function pruefeVerlust(pfad, wert, funde) {
	const art = typeof wert;
	if (art === "function") { funde.push({ pfad, grund: "function" }); return; }
	if (wert === undefined) { funde.push({ pfad, grund: "undefined-Wert" }); return; }
	if (art === "number") { if (!Number.isFinite(wert) || Object.is(wert, -0)) funde.push({ pfad, grund: `Zahl ${String(wert)}` }); return; }
	if (art === "bigint") { funde.push({ pfad, grund: "BigInt" }); return; }
	if (art === "boolean" || art === "string" || wert === null) return;
	if (art !== "object") { funde.push({ pfad, grund: `Typ ${art}` }); return; }
	if (Array.isArray(wert)) {
		const own = Reflect.ownKeys(wert);
		if (own.length !== wert.length + 1) { funde.push({ pfad, grund: `Array-Extra-Keys ${own.length}` }); return; }
		for (const k of own) if (typeof k !== "string" && k !== "length") { funde.push({ pfad, grund: `Array-Symbol-Key ${String(k)}` }); return; }
		for (let i = 0; i < wert.length; i += 1) pruefeVerlust(`${pfad}[${i}]`, wert[i], funde); return;
	}
	if (!istPlainObjekt(wert)) { funde.push({ pfad, grund: `Prototyp ${String(Object.getPrototypeOf(wert)?.constructor?.name ?? "?")}` }); return; }
	for (const k of Reflect.ownKeys(wert)) if (typeof k !== "string" || !Object.prototype.propertyIsEnumerable.call(wert, k)) { funde.push({ pfad, grund: `Key ${String(k)}` }); return; }
	for (const k of Object.keys(wert)) pruefeVerlust(`${pfad}.${k}`, wert[k], funde);
}

test('10. Ausgabe verlustfrei: kein Zweig schreibt undefined-Werte, auch nicht "nicht lesbar" (Kern-Ausgabepruefung)', async () => {
	// Szenario mit "nicht lesbar" (beobachte -> undefined), Kind ohne Ziel und abgebautes Kind mit Ziel.
	const s = baueSzene({
		kataloge: { exp: [katalogZeile('nl', 'NichtLesbar', '2026-11-11T00:01:00Z'), katalogZeile('nz', 'KeinZiel', '2026-11-11T00:02:00Z')] },
		mitglieder: [{ role: 'teammate', name: 'exp', id: 'exp', status: 'inactive' }],
		beobachtungen: { nz: null } // nl fehlt -> beobachte gibt undefined zurueck -> "nicht lesbar"
	})
	const stand = await s.baue(M).execute({}, { agent: s.lead })
	const funde = [];
	pruefeVerlust('root', stand, funde);
	assert.deepEqual(funde, [], `Kein verlustbehafteter Wert in der Ausgabe — funde=${JSON.stringify(funde)}`)
	// Gegenprobe: fuege ein Feld mit undefined von Hand ein, der Pruefer muss es finden.
	const kaputt = { a: { b: undefined } }
	const probe = []; pruefeVerlust('root', kaputt, probe)
	assert.deepEqual(probe.length, 1, `Der Pruefer findet undefined-Werte (Sonst ist die Pruefung wertlos): ${JSON.stringify(probe)}`)
})

test('9. Gegenprobe gegen das Git-Alte Modul: dieselbe Szene meldet dort keine Untergruppen (Plan Nr. 6)', async () => {
	const s = baueSzene({ kataloge: { exp: [katalogZeile('fachA', 'A', '2026-11-11T00:01:00Z')], fachA: [] }, mitglieder: [{ role: 'teammate', name: 'exp', id: 'exp', status: 'inactive' }], beobachtungen: { fachA: null } })
	const stand = await s.baue(M).execute({}, { agent: s.lead })
	assert.equal(stand.untergruppen.length, 2, 'gebaut: zwei Gruppen mit der Kinderzeile')
	assert.equal(stand.untergruppen.find((g) => g.id === 'exp').unteragenten.length, 1)

	// Das Alte Modul aus Git: Stand de28469 = main vor diesem Bau (team_stand kannte nur die Mitgliederliste).
	const alteOrdner = join(HEIM, 'patches-alt')
	mkdirSync(alteOrdner, { recursive: true })
	writeFileSync(join(alteOrdner, 'send-to-session.mjs'), execSync('git show de28469:patches/send-to-session.mjs', { cwd: REPO, encoding: 'utf8' }))
	const pfadAlt = join(alteOrdner, 'team-modus-alt.mjs')
	writeFileSync(pfadAlt, execSync('git show de28469:patches/team-modus.mjs', { cwd: REPO, encoding: 'utf8' }))
	const ALT = await import(pathToFileURL(pfadAlt).href)
	const standAlt = await s.baue(ALT).execute({}, { agent: s.lead })
	assert.equal(standAlt.untergruppen, undefined, 'Gegenprobe: im Alten fehlt das Feld — dieselbe Kinderzeile kann es dort nicht melden')
	assert.equal(standAlt.mitglieder.length, 1, 'und es bleibt nur die Mitgliederzeile (Messung T4c)')
})
