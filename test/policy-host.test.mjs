/**
 * policy-host.test.mjs — der Vertrag `teamsPlus` und die Prompt-Injektion.
 *
 * Der Test belegt acht Dinge:
 *   1. der Dienst hat genau die sechs Methoden des Vertrags,
 *   2. jede Methode nimmt auf der Leitung genau ein schlichtes Parameterwort (`request`),
 *   3. der Typert-Marker auf dem Prototyp ist byte-gleich die Form, die das Gateway liest,
 *   4. alle sechs Methoden arbeiten gegen einen GEFALSCHTEN Ordner (temporaeres Verzeichnis),
 *   5. eine kaputte Datei wird gemeldet, aber nur einmal protokolliert,
 *   6. der Textaufbau der Prompt-Injektion ist unveraendert der aus dsh-projectOS
 *      (eine Policy: Titel in der Ueberschrift; mehrere: `## <Titel>`-Abschnitte),
 *   7. `apply` ist ausfallsicher: ein fehlender Dienst oder ein nicht anlegbarer Ordner
 *      protokolliert einmal und verhindert DSH nicht am Starten,
 *   8. die ganze Datei ist HERMETISCH: `HOME` und `TEAMS_PLUS_DATA_DIR` zeigen auf ein
 *      `mkdtemp`-Verzeichnis, bevor der Projektcode geladen wird; ein Waechter-Test haelt das
 *      fest. Ohne die Umlenkung schrieb `apply()` die Startdatei ins echte
 *      `~/.dsh/.tm/teams-plus` (Red-Team NIEDRIG-6, Backlog A3).
 */
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// HERMETISCH (Red-Team-Befund NIEDRIG-6, Backlog A3).
//
// `apply()` legt ohne eigene Wurzel `~/.dsh/.tm/teams-plus` an und schreibt die Startdatei
// `policies/lokalmodus.md` hinein. In einem Test ist das ein Schreibzugriff in das Zuhause des
// Menschen: die Suite mit gefaelschtem HOME legte genau diesen Baum an (gemessen 2026-10-31,
// `policies/lokalmodus.md`, 884 Bytes).
//
// Deshalb wird die Umgebung gesetzt, BEVOR der Projektcode geladen wird — dasselbe Muster wie in
// `send-to-session.test.mjs`. Zwei Umlenkungen, weil es zwei Wege in die Ablage gibt:
//   - `TEAMS_PLUS_DATA_DIR` ist die dokumentierte Wurzel aus der Umgebung
//     (`src/host/index.js`, Abschnitt "Anmeldung"); sie faengt jeden `apply()`-Aufruf ab.
//   - `HOME` lenkt den Rueckfall `datenOrdner()` -> `homedir()` um, falls die Variable einmal
//     fehlt oder geleert wird (POSIX: `os.homedir()` folgt `$HOME`, gemessen).
//
// Der Waechter-Test im Abschnitt `apply()` haelt beide Zeilen fest: nimmt jemand eine heraus, wird
// er rot. Aufgeraeumt wird das temporaere Zuhause im `after`-Haken.
// ---------------------------------------------------------------------------
const ECHTES_HEIM = homedir()
const TEST_HEIM = mkdtempSync(join(tmpdir(), 'teams-plus-host-home-'))
const TEST_DATEN = join(TEST_HEIM, '.dsh', '.tm', 'teams-plus')
process.env.HOME = TEST_HEIM
process.env.TEAMS_PLUS_DATA_DIR = TEST_DATEN
after(() => rmSync(TEST_HEIM, { recursive: true, force: true }))

// ERST JETZT den Projektcode laden. Er liest die Ablage zwar erst beim Aufruf, aber die
// Reihenfolge soll nicht davon abhaengen — und ein spaeterer Import-Zeit-Leser bleibt gedeckt.
const {
  METHODEN, TeamsPlusController, apply, findWorkspace, markRemote, policyPromptText,
} = await import('../src/host/index.js')
const { createStore, datenOrdner } = await import('../src/policy/store.ts')
const { bauen } = await import('../src/policy/schema.ts')

const PAKET = join(dirname(fileURLToPath(import.meta.url)), '..')
const START = join(PAKET, 'policies')
const DESCRIPTOR_KEY = '@deepseek-ai/dsh-typert-protocol/remote-methods'

/** Ein Dienst auf einem frischen, mit der Startdatei gefuellten Ordner. */
function werkstatt() {
	const root = mkdtempSync(join(tmpdir(), 'teams-plus-host-'))
	const store = createStore({ root, seed: START })
	store.ensure()
	store.seedWennLeer()
	return { root, store, dienst: new TeamsPlusController({}, store) }
}

const registry = (items) => ({ list: () => items })

/** Ein Host-Kontext, der nur mitschreibt, was angemeldet wird. */
function fakeCtx(over = {}) {
	const calls = { effects: [], contexts: [], warns: [], provided: [] }
	const ctx = {
		reflect: { provide: () => {} },
		provide: (name, value) => { calls.provided.push([name, value]); return () => {} },
		// Ein echter Cordis-Effect fuehrt sofort aus und behaelt den Rueckgabewert als Disposer.
		effect: (execute, label) => { calls.effects.push(label); const disposable = execute(); return () => { if (typeof disposable === 'function') disposable() } },
		logger: () => ({ warn: (meldung) => calls.warns.push(meldung) }),
		get: (key) => {
			if (key === 'systemPrompt') return over.systemPrompt === null ? undefined : { context: (kontext) => { calls.contexts.push(kontext); return () => {} } }
			if (key === 'agents') return over.agents === null ? undefined : { currentInitiator: () => ({ session: { header: { cwd: 'cwd' in over ? over.cwd : '/Users/t/proj' } } }) }
			if (key === 'workspaceRegistry') return over.registry === null ? undefined : registry([{ id: 'ws_10', path: '/Users/t/proj' }])
			return undefined
		},
	}
	return { ctx, calls }
}

// ---------------------------------------------------------------------------
// Form des Vertrags.
// ---------------------------------------------------------------------------

test('der Dienst hat genau die sechs Methoden des Vertrags', () => {
	assert.deepEqual(METHODEN, ['listPolicies', 'listForWorkspace', 'savePolicy', 'deletePolicy', 'setEnabled', 'resolveTags'])
	const { dienst } = werkstatt()
	for (const methode of METHODEN) assert.equal(typeof dienst[methode], 'function', `${methode} fehlt`)
	assert.equal(typeof dienst.typertRemote, 'object')
})

test('jede Methode nimmt genau ein schlichtes Parameterwort: request', () => {
	// methodParameterNames (api-gateway) liest die Parameterliste aus dem Quelltext: nur einfache
	// Namen ohne Destrukturierung, Vorgaben oder Rest.
	for (const methode of METHODEN) {
		const quelle = Function.prototype.toString.call(TeamsPlusController.prototype[methode])
		const parameter = quelle.slice(quelle.indexOf('(') + 1, quelle.indexOf(')')).trim()
		assert.match(parameter, /^[A-Za-z_$][\w]*$/, `${methode} muss genau einen schlichten Parameternamen haben, hat "${parameter}"`)
		assert.equal(parameter, 'request')
	}
})

test('der Typert-Marker steht gefroren und konfigurierbar am Prototyp, einmal je Methode', () => {
	const property = Object.getOwnPropertyDescriptor(TeamsPlusController.prototype, DESCRIPTOR_KEY)
	assert.equal(property.configurable, true)
	assert.equal(property.value.version, 1)
	assert.ok(Object.isFrozen(property.value))
	assert.equal(property.value.methods.length, 6)
	assert.deepEqual(property.value.methods.map((marker) => marker.method), METHODEN)
	for (const marker of property.value.methods) {
		assert.equal(marker.invocation.kind, 'direct')
		assert.equal(marker.exportName, undefined)
		assert.equal(marker.mode, undefined)
	}
	// Nochmal anhaengen legt keinen zweiten Marker an.
	markRemote(TeamsPlusController.prototype, 'setEnabled')
	assert.equal(Object.getOwnPropertyDescriptor(TeamsPlusController.prototype, DESCRIPTOR_KEY).value.methods.length, 6)
})

test('das Gateway findet den Dienst: typertRemote zeigt auf das lebende Objekt', () => {
	const { dienst } = werkstatt()
	assert.equal(dienst.typertRemote.service, dienst)
	assert.equal(dienst.typertRemote.serviceKey, 'teamsPlus')
	assert.equal(dienst.typertRemote.namespace, 'teamsPlus')
})

// ---------------------------------------------------------------------------
// Die sechs Methoden gegen einen gefaelschten Ordner.
// ---------------------------------------------------------------------------

test('listPolicies und listForWorkspace lesen die Ablage, der Schalter kommt aus der Datei', async () => {
	const { root, dienst } = werkstatt()
	try {
		const alle = await dienst.listPolicies({})
		assert.equal(alle.ok, true)
		assert.deepEqual(alle.policies.map((policy) => policy.id), ['lokalmodus'])
		assert.deepEqual(alle.broken, [])

		const vorher = await dienst.listForWorkspace({ workspaceId: 'ws_10' })
		assert.equal(vorher.ok, true)
		assert.equal(vorher.workspaceId, 'ws_10')
		assert.equal(vorher.policies[0].enabled, false)

		assert.deepEqual(await dienst.setEnabled({ workspaceId: 'ws_10', policyId: 'lokalmodus', enabled: true }), {
			ok: true, workspaceId: 'ws_10', policyId: 'lokalmodus', enabled: true,
		})
		const nachher = await dienst.listForWorkspace({ workspaceId: 'ws_10' })
		assert.equal(nachher.policies[0].enabled, true)
		// Die Wahrheit steht in der Datei, nicht im Speicher.
		assert.deepEqual(JSON.parse(readFileSync(join(root, 'workspaces', 'ws_10.json'), 'utf8')), { enabled: ['lokalmodus'] })
		// Ein anderer Workspace bleibt aus.
		assert.equal((await dienst.listForWorkspace({ workspaceId: 'ws_11' })).policies[0].enabled, false)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test('savePolicy legt an, aendert, und lehnt Unbekanntes ab', async () => {
	const { root, store, dienst } = werkstatt()
	try {
		const neu = await dienst.savePolicy({ title: '  Ruhig  ', body: '  Ein Text.  ', tags: ['team'] })
		assert.equal(neu.ok, true, neu.ok ? '' : neu.message)
		assert.match(neu.policy.id, /^p[0-9a-f]{16}$/)
		assert.equal(neu.policy.title, 'Ruhig')
		assert.equal(neu.policy.body, 'Ein Text.')
		assert.deepEqual(neu.policy.tags, ['team'])
		assert.ok(existsSync(join(store.policiesDir, `${neu.policy.id}.md`)))

		const geaendert = await dienst.savePolicy({ id: neu.policy.id, title: 'Ruhiger', body: 'Neuer Text.' })
		assert.equal(geaendert.ok, true)
		assert.equal(geaendert.policy.title, 'Ruhiger')
		assert.equal((await dienst.listPolicies({})).policies.length, 2)

		assert.equal((await dienst.savePolicy({ title: '', body: 'x' })).ok, false)
		assert.equal((await dienst.savePolicy({ title: 'x', body: '  ' })).ok, false)
		const unbekannt = await dienst.savePolicy({ id: 'gibtsnicht', title: 'x', body: 'y' })
		assert.equal(unbekannt.ok, false)
		assert.ok(unbekannt.message.includes('unbekannte Policy'))
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test('deletePolicy entfernt die Policy und raeumt ihre Aktivierungen auf', async () => {
	const { root, store, dienst } = werkstatt()
	try {
		const a = await dienst.savePolicy({ title: 'A', body: 'A' })
		await dienst.savePolicy({ title: 'B', body: 'B' })
		await dienst.setEnabled({ workspaceId: 'ws_10', policyId: a.policy.id, enabled: true })
		await dienst.setEnabled({ workspaceId: 'ws_11', policyId: a.policy.id, enabled: true })

		const geloescht = await dienst.deletePolicy({ id: a.policy.id })
		assert.equal(geloescht.ok, true, geloescht.ok ? '' : geloescht.message)
		assert.equal(geloescht.id, a.policy.id)
		assert.deepEqual(geloescht.removed.sort(), ['ws_10', 'ws_11'])
		assert.ok(!existsSync(join(store.policiesDir, `${a.policy.id}.md`)))
		assert.deepEqual(store.aktiviert('ws_10').ids, [])
		assert.equal((await dienst.deletePolicy({ id: a.policy.id })).ok, false)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test('resolveTags findet nach Tag, auch mit gemischter Schreibweise', async () => {
	const { root, dienst } = werkstatt()
	try {
		const a = await dienst.savePolicy({ title: 'Team', body: 'T', tags: ['team', 'sequenziell'] })
		await dienst.savePolicy({ title: 'Haus', body: 'H', tags: ['haus'] })
		const gefunden = await dienst.resolveTags({ tags: ['SEQUENZIELL'] })
		assert.equal(gefunden.ok, true)
		assert.deepEqual(gefunden.tags, ['SEQUENZIELL'])
		// Die Startdatei traegt den Tag "sequenziell" ebenfalls; Reihenfolge ist die Bibliothek.
		assert.deepEqual(gefunden.policies.map((policy) => policy.id), ['lokalmodus', a.policy.id])
		assert.deepEqual((await dienst.resolveTags({ tags: [] })).policies, [])
		assert.deepEqual((await dienst.resolveTags({ tags: ['gibtsnicht'] })).policies, [])
		assert.deepEqual((await dienst.resolveTags({})).policies, [])
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test('ungueltige Eingaben werden beantwortet, nicht geworfen', async () => {
	const { root, dienst } = werkstatt()
	try {
		const ws = await dienst.listForWorkspace({ workspaceId: '../evil' })
		assert.equal(ws.ok, false)
		assert.ok(ws.message.includes('workspaceId'))
		assert.deepEqual(ws.policies, [])
		assert.equal((await dienst.listForWorkspace({})).ok, false)
		assert.equal((await dienst.setEnabled({ workspaceId: 'ws_10', policyId: 'gibtsnicht', enabled: true })).ok, false)
		assert.equal((await dienst.deletePolicy({ id: '../x' })).ok, false)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test('eine kaputte Datei wird gemeldet und nur einmal protokolliert', async () => {
	const { root, store, dienst } = werkstatt()
	try {
		writeFileSync(join(store.policiesDir, 'kaputt.md'), 'kein Kopfblock\n')
		const eins = await dienst.listPolicies({})
		assert.equal(eins.ok, true)
		assert.deepEqual(eins.broken.map((eintrag) => eintrag.file), ['kaputt.md'])
		assert.ok(eins.broken[0].errors.length > 0)
		// Ein zweiter Aufruf meldet dieselbe Datei nicht noch einmal ins Protokoll.
		await dienst.listPolicies({})
		const protokoll = readFileSync(join(store.logsDir, 'host.log'), 'utf8')
		assert.equal(protokoll.split('\n').filter((zeile) => zeile.includes('kaputt.md')).length, 1)
		// Und ueberschrieben wird sie nicht.
		const versuch = await dienst.savePolicy({ id: 'kaputt', title: 'Neu', body: 'Neu' })
		assert.equal(versuch.ok, false)
		assert.equal(readFileSync(join(store.policiesDir, 'kaputt.md'), 'utf8'), 'kein Kopfblock\n')
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

// ---------------------------------------------------------------------------
// Prompt-Injektion: derselbe Textaufbau wie in dsh-projectOS.
// ---------------------------------------------------------------------------

test('findWorkspace: genauer Pfad zuerst, dann der laengste enthaltende Pfad', () => {
	const items = [
		{ id: 'ws_1', path: '/Users/t/proj' },
		{ id: 'ws_2', path: '/Users/t/proj/sub' },
		{ id: 'ws_3', path: '/Users/t/other' },
	]
	assert.equal(findWorkspace(registry(items), '/Users/t/proj/sub')?.id, 'ws_2')
	assert.equal(findWorkspace(registry(items), '/Users/t/proj/sub/deep')?.id, 'ws_2')
	assert.equal(findWorkspace(registry(items), '/Users/t/proj/')?.id, 'ws_1')
	assert.equal(findWorkspace(registry(items), '/Users/t/elsewhere'), undefined)
	assert.equal(findWorkspace(registry(items), ''), undefined)
})

test('policyPromptText: eine Policy traegt den Titel in der Ueberschrift, mehrere bekommen Abschnitte', async () => {
	const { root, store, dienst } = werkstatt()
	const reg = registry([{ id: 'ws_10', path: '/Users/t/proj' }])
	try {
		assert.equal(policyPromptText(store, reg, '/Users/t/proj'), '', 'ohne aktivierte Policy kein Text')

		await dienst.setEnabled({ workspaceId: 'ws_10', policyId: 'lokalmodus', enabled: true })
		const einer = policyPromptText(store, reg, '/Users/t/proj')
		assert.ok(einer.startsWith('# Workspace Policy (Lokalmodus) — active in this workspace'), einer)
		assert.ok(einer.includes('rein sequentiell'))
		assert.ok(!einer.includes('## '), 'bei einer einzelnen Policy gibt es keine Abschnittsueberschrift')

		const a = await dienst.savePolicy({ title: 'A', body: 'AAA', order: 1 })
		const b = await dienst.savePolicy({ title: 'B', body: 'BBB', order: 2 })
		store.speichern({ id: a.policy.id, title: 'A', body: 'AAA', order: 1 })
		await dienst.setEnabled({ workspaceId: 'ws_10', policyId: a.policy.id, enabled: true })
		await dienst.setEnabled({ workspaceId: 'ws_10', policyId: b.policy.id, enabled: true })

		const mehrere = policyPromptText(store, reg, '/Users/t/proj')
		assert.ok(mehrere.startsWith('# Workspace Policies — active in this workspace'), mehrere)
		assert.ok(mehrere.includes('## Lokalmodus\n'))
		assert.ok(mehrere.includes('## A\nAAA'))
		assert.ok(mehrere.includes('## B\nBBB'))

		// Kein Workspace, keine cwd: leerer Text.
		assert.equal(policyPromptText(store, registry([]), '/Users/t/proj'), '')
		assert.equal(policyPromptText(store, reg, undefined), '')
		assert.equal(policyPromptText(store, reg, ''), '')
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test('eine Policy ohne Text geht nicht in den Prompt', async () => {
	const { root, store, dienst } = werkstatt()
	const reg = registry([{ id: 'ws_10', path: '/Users/t/proj' }])
	try {
		const leer = await dienst.savePolicy({ title: 'Leer', body: 'Inhalt' })
		store.speichern({ id: leer.policy.id, title: 'Leer', body: 'Inhalt' })
		// Eine Datei mit leerem Body ist kaputt und wird nicht als aktiv gezaehlt.
		writeFileSync(join(store.policiesDir, 'ohnebody.md'), bauen({ id: 'ohnebody', title: 'Ohne Body', tags: [], order: 5, body: 'x' }).replace('x\n', ''))
		await dienst.setEnabled({ workspaceId: 'ws_10', policyId: 'ohnebody', enabled: true })
		const text = policyPromptText(store, reg, '/Users/t/proj')
		assert.equal(text, '', `eine Policy ohne Body darf keinen Prompt erzeugen: ${text}`)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

// ---------------------------------------------------------------------------
// apply(): Anmeldung und Ausfallsicherheit.
// ---------------------------------------------------------------------------

test('apply meldet den Dienst und die Prompt-Injektion mit order 130 an', async () => {
	const root = mkdtempSync(join(tmpdir(), 'teams-plus-apply-'))
	const vorher = process.env.TEAMS_PLUS_DATA_DIR
	try {
		process.env.TEAMS_PLUS_DATA_DIR = root
		const { ctx, calls } = fakeCtx()
		await apply(ctx)

		assert.equal(calls.provided.length, 1)
		assert.equal(calls.provided[0][0], 'teamsPlus')
		const dienst = calls.provided[0][1]
		assert.equal(dienst.typertRemote.namespace, 'teamsPlus')
		assert.ok(calls.effects.includes('teams-plus: service'))
		assert.ok(calls.effects.includes('teams-plus: policy prompt'))

		assert.equal(calls.contexts.length, 1)
		assert.equal(calls.contexts[0].name, 'teams-plus:policies')
		assert.equal(calls.contexts[0].order, 130)

		// Die Startdatei liegt im Datenordner, und der Prompt liest sie bei jedem Zusammenbau neu.
		assert.ok(existsSync(join(root, 'policies', 'lokalmodus.md')))
		for (const ordner of ['policies', 'workspaces', 'logs']) assert.ok(existsSync(join(root, ordner)), `${ordner} fehlt`)
		assert.equal(calls.contexts[0].text(), '', 'nichts aktiviert: leerer Text')

		await dienst.setEnabled({ workspaceId: 'ws_10', policyId: 'lokalmodus', enabled: true })
		const text = calls.contexts[0].text()
		assert.ok(text.startsWith('# Workspace Policy (Lokalmodus) — active in this workspace'), text)
		assert.ok(text.includes('cosplayt'))
	} finally {
		if (vorher === undefined) delete process.env.TEAMS_PLUS_DATA_DIR
		else process.env.TEAMS_PLUS_DATA_DIR = vorher
		rmSync(root, { recursive: true, force: true })
	}
})

test('apply ist ausfallsicher: fehlende Prompt-Seite und nicht anlegbarer Ordner verhindern nichts', async () => {
	// a) ohne systemPrompt wird der Dienst trotzdem angemeldet, die Prompt-Seite nur gemeldet.
	const ohnePrompt = fakeCtx({ systemPrompt: null })
	await apply(ohnePrompt.ctx)
	assert.equal(ohnePrompt.calls.provided.length, 1)
	assert.equal(ohnePrompt.calls.contexts.length, 0)
	// Die Wurzel kommt aus der Umgebung, nicht aus ~: die Startdatei liegt im Test-Datenordner.
	assert.ok(existsSync(join(TEST_DATEN, 'policies', 'lokalmodus.md')), 'apply hat die Startdatei nicht im Test-Datenordner angelegt')
	assert.ok(ohnePrompt.calls.warns.some((meldung) => meldung.includes('keine Prompt-Seite')), ohnePrompt.calls.warns.join(' | '))

	// b) ein Datenordner, der nicht angelegt werden kann: eine Meldung, kein Dienst, kein Absturz.
	const datei = join(mkdtempSync(join(tmpdir(), 'teams-plus-kaputt-')), 'datei')
	writeFileSync(datei, 'x')
	const vorher = process.env.TEAMS_PLUS_DATA_DIR
	try {
		process.env.TEAMS_PLUS_DATA_DIR = join(datei, 'darunter')
		const kaputt = fakeCtx()
		await assert.doesNotReject(() => apply(kaputt.ctx))
		assert.deepEqual(kaputt.calls.provided, [])
		assert.ok(kaputt.calls.warns.some((meldung) => meldung.includes('Datenordner')), kaputt.calls.warns.join(' | '))
	} finally {
		if (vorher === undefined) delete process.env.TEAMS_PLUS_DATA_DIR
		else process.env.TEAMS_PLUS_DATA_DIR = vorher
		rmSync(dirname(datei), { recursive: true, force: true })
	}
})

test('apply ohne agents/workspaceRegistry meldet die fehlende Prompt-Seite, statt zu werfen', async () => {
	const { ctx, calls } = fakeCtx({ agents: null })
	await assert.doesNotReject(() => apply(ctx))
	assert.equal(calls.provided.length, 1)
	assert.ok(calls.warns.some((meldung) => meldung.includes('keine Prompt-Seite')))
})

test('Waechter: HOME und TEAMS_PLUS_DATA_DIR halten die ganze Datei hermetisch', () => {
	// Nimmt jemand eine der beiden Umlenkungen oben heraus, wird dieser Test rot — ohne selbst
	// etwas zu schreiben. Er ist die Gegenprobe zu NIEDRIG-6: vor der Umlenkung legte die Suite
	// mit gefaelschtem HOME `<HOME>/.dsh/.tm/teams-plus/policies/lokalmodus.md` an.
	assert.equal(homedir(), TEST_HEIM, 'HOME ist nicht umgelenkt: der Rueckfall datenOrdner() -> homedir() zeigt ins echte Zuhause')
	assert.equal(datenOrdner(), TEST_DATEN, 'datenOrdner() zeigt nicht auf den Test-Datenordner')
	assert.equal(process.env.TEAMS_PLUS_DATA_DIR, TEST_DATEN, 'TEAMS_PLUS_DATA_DIR ist nicht gesetzt: apply() schriebe ins echte Zuhause')
	assert.ok(!TEST_DATEN.startsWith(join(ECHTES_HEIM, '.dsh')), `der Test-Datenordner liegt im echten Zuhause: ${TEST_DATEN}`)
})

// ---------------------------------------------------------------------------
// Beide Seiten, eine Schemadatei: die echten Ergebnisse gegen die Drahtschemas.
// ---------------------------------------------------------------------------

let zodDa = true
try { await import('zod') } catch { zodDa = false }

test('die Ergebnisse der sechs Methoden passen zu den Drahtschemas der Ansicht', { skip: zodDa ? false : 'zod ist nicht installiert (npm install fehlt)' }, async () => {
	const schemas = await import('../src/client/policy-schemas.ts')
	const { root, dienst } = werkstatt()
	try {
		const liste = await dienst.listPolicies({})
		assert.deepEqual(schemas.listPolicies_result$schema.parse(liste), liste)

		const ws = await dienst.listForWorkspace({ workspaceId: 'ws_10' })
		assert.deepEqual(schemas.listForWorkspace_result$schema.parse(ws), ws)

		const neu = await dienst.savePolicy({ title: 'Neu', body: 'Text', tags: ['a'] })
		assert.deepEqual(schemas.savePolicy_result$schema.parse(neu), neu)

		const an = await dienst.setEnabled({ workspaceId: 'ws_10', policyId: neu.policy.id, enabled: true })
		assert.deepEqual(schemas.setEnabled_result$schema.parse(an), an)

		const tags = await dienst.resolveTags({ tags: ['a'] })
		assert.deepEqual(schemas.resolveTags_result$schema.parse(tags), tags)

		const weg = await dienst.deletePolicy({ id: neu.policy.id })
		assert.deepEqual(schemas.deletePolicy_result$schema.parse(weg), weg)

		// Auch die Fehlerform passt (ok:false mit message).
		const fehler = await dienst.deletePolicy({ id: neu.policy.id })
		assert.equal(schemas.deletePolicy_result$schema.parse(fehler).ok, false)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test('die Startdatei im Paket traegt den Text aus LOKALMODUS_BODY', () => {
	const text = readFileSync(join(START, 'lokalmodus.md'), 'utf8')
	for (const satz of ['rein sequentiell', 'cosplayt', 'Prompt-Cache hin und her', 'EINE Compaction', 'Rückfrage-Kaskade']) {
		assert.ok(text.includes(satz), `der Lokalmodus-Text enthaelt "${satz}" nicht`)
	}
	// Der Kopfblock traegt genau die vereinbarten Felder.
	const kopf = text.slice(0, text.indexOf('\n---\n'))
	for (const zeile of ['id: lokalmodus', 'title: Lokalmodus', 'tags: [', 'order: 0', 'description: ']) {
		assert.ok(kopf.includes(zeile), `Kopfzeile "${zeile}" fehlt`)
	}
	assert.deepEqual(readdirSync(START).filter((name) => name.endsWith('.md')), ['lokalmodus.md'])
})
