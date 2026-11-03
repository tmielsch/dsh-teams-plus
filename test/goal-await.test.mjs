/**
 * goal-await.test.mjs — der Weckruf des Wartens, mit Gegenprobe am Code.
 *
 * Der Patch entwaffnet ein Ziel, wenn ein Agent auf eine fremde Zutat wartet.
 * Der Mensch klagte: "Ich will vermeiden, dass sinnlos gewartet wird und eine
 * Runde nach der nächsten getriggert wird, ohne dass irgendwas passiert." Das
 * Warten war richtig — falsch war der WECKRUF: die erste Fassung ließ JEDE
 * Nachricht durch, ein Gruß eines Teammates weckte also ein Ziel, das auf einen
 * Messbericht wartete.
 *
 * Dieser Test prüft die zwei Wege, die den Weckruf verengen:
 *   (A) das Feld `von` — nur eine Nachricht VON DIESEM Absender weckt;
 *   (C) eine Team-Aufgabe, die auf `completed` geht, weckt ihre Wartenden.
 * und die Rückwärtsverträglichkeit: ohne Absenderangabe, ohne Team und bei
 * Ablauf der Frist bleibt alles genau wie vorher.
 *
 * Jede Prüfung hat eine Gegenprobe, und vier davon stehen als eigener Test am
 * Ende: eine Kopie des Moduls unter /tmp, in der genau eine Stelle ausgebaut
 * ist, muss den zugehörigen Test ROT machen. Bliebe er grün, prüfte der Test
 * nichts (die Lehre aus Issue #10 — eine Prüfung ohne Gegenprobe ist eine
 * Behauptung).
 *
 * Am 2026-11-03 kam ein dritter, gemessener Fehler dazu (Protokoll 22:07:53):
 * `grund=aufgabe` feuerte, aber `scharf=false` mit "session append cannot
 * reenter while another append is being published". Ein Sitzungs-Ereignis wird
 * SYNCHRON innerhalb von `session.append` zugestellt; ein `resume` von dort aus
 * schreibt in dieselbe Sitzung und ist verboten. Zwei Prüfungen decken die
 * Reparatur ab:
 *   (D) das Weiterschalten liegt in einem eigenen Durchlauf (`setImmediate`) —
 *       nachgestellt wird das durch `sende`, das `session/event` innerhalb eines
 *       laufenden append zustellt, in dem `resume` wirft;
 *   (E) der Wartezustand verschwindet erst nach gelungenem Scharfschalten —
 *       scheitert der Dienst, bleibt er samt Uhr stehen.
 * Die vierte Gegenprobe baut die Verschiebung aus und erwartet, dass der
 * Kerntest rot wird.
 *
 * Gesteuert wird über GOAL_AWAIT_MODUL: ohne die Variable gilt das Modul des
 * Repos, mit ihr die Kopie. Genau dieselbe Umlenkung benutzt team-board.test.mjs.
 *
 * Hermetisch: das Protokoll des Patches schreibt unter os.homedir()/.dsh/logs.
 * HOME zeigt deshalb für diesen Test auf ein Temp-Verzeichnis, damit kein Lauf
 * das echte Protokoll vollschreibt.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Hermetisch machen, BEVOR das Modul geladen wird: `protokoll()` benutzt
// `os.homedir()`, und das folgt auf POSIX dem $HOME zur Aufrufzeit.
const HEIM = mkdtempSync(join(tmpdir(), 'goal-await-home-'))
process.env.HOME = HEIM
process.env.USERPROFILE = HEIM

const MODUL = new URL('../patches/goal-await.mjs', import.meta.url).pathname
const REPO = new URL('..', import.meta.url).pathname

/**
 * Das zu prüfende Modul ist umlenkbar — sonst führen die Gegenproben am Ende
 * eine Nachbildung statt den Test, der den Patch prüft.
 */
const MODUL_DATEI = process.env.GOAL_AWAIT_MODUL ?? MODUL

const {
	absenderText,
	apply,
	bedingungText,
	fristMs,
	istAufgabenWecker,
	istZutat
} = await import(MODUL_DATEI)

/** Der Wartende und die Zutat — die Namen sind Absicht: bob liefert, carol grüßt. */
const BOB = 'sess-bob'
const CAROL = 'sess-carol'
const TEAM = 'sess-lead'

/** Wörtlich der Fehler, den der Kern aus einem laufenden append wirft (gemessen 2026-11-03). */
const REENTRANZ = 'session append cannot reenter while another append is being published'

/** Eine echte Team-Mailbox-Nachricht, so wie `mailbox.js` sie baut. */
const teamNachricht = (senderId, senderName) => ({
	source: { kind: 'team-message', teamId: TEAM, messageId: 'm-' + senderId + '-1', senderId, senderName }
})

/** Eine Nachricht aus `send_to_session` (dieses Paket): Quelle `plugin:…` mit `senderSessionId`. */
const relayNachricht = (senderSessionId) => ({
	source: { kind: 'plugin:@tmielsch/dsh-teams-plus', form: 'relay', senderSessionId }
})

/** Eine echte Eingabe des Menschen: kein Absender, nur die Quellart. */
const menschenNachricht = { source: { kind: 'user' } }

/** Eine Zielrunde des Rundentreibers. */
const zielrunde = { source: { kind: 'goal' } }

/** Ein Team-Ereignis, wie `TeamJournal.appendAndFlush` es an die Session hängt. */
const aufgabenEreignis = (teamId, status) => ({
	type: 'team/task',
	data: { version: 2, teamId, task: { id: 'task-1', revision: 2, subject: 'Messung', description: 'x', status, blockedBy: [], writeScopes: [] } }
})

const warte = (ms) => new Promise((fertig) => setTimeout(fertig, ms))

/**
 * Wartet den Durchlauf ab, in den das Weiterschalten verschoben ist.
 *
 * `setImmediate` deckt beide zulässigen Techniken ab: es läuft nach allen
 * Microtasks (also auch nach `queueMicrotask`) und in einem eigenen Task.
 */
const naechsterDurchlauf = () => new Promise((fertig) => setImmediate(fertig))

/**
 * Eine Szene: ein Cordis-Kontext, so weit `goal-await` ihn benutzt, plus die
 * Ziel-Attrappe des Kerns. `goals.disarm` und `goals.resume` sind die zwei
 * öffentlichen Dienste, die der Patch wirklich ruft — mehr braucht er nicht.
 *
 * Zwei Dinge bildet die Attrappe nach, weil der Patch sie messbar machen muss:
 *   - `ctx.imAppend` ist gesetzt, während `sende('session/event', …)` läuft, und
 *     `resume` wirft dann den Fehler des Kerns. So ist die Verschiebung des
 *     Weiterschaltens prüfbar (Modulkopf (D)).
 *   - `optionen.resumeFehler` darf einzelne Anläufe scheitern lassen, damit
 *     „Wartezustand bleibt stehen" prüfbar ist (Modulkopf (D), Fehler 2).
 *
 * @param optionen - `{ team, resumeFehler }`: Team-Dienst und Fehler-Injektion.
 * @returns die Szene samt Zugriff auf den Diagnose-Dienst des Patches.
 */
function baueSzene(optionen = {}) {
	const ziele = new Map()
	const horcher = new Map()
	const werkzeuge = []
	const dienste = new Map()
	const aufrufe = { disarm: 0, resume: 0 }

	const ctx = {
		goals: {
			get: (agent) => ziele.get(agent),
			disarm: (agent) => {
				aufrufe.disarm += 1
				const ziel = ziele.get(agent)
				if (ziel !== undefined) ziel.activation = 'disarmed'
				return ziel
			},
			resume: (agent, ref) => {
				aufrufe.resume += 1
				// Der Kern verbietet ein resume, das aus einem laufenden append
				// kommt (dsh-session/lib/index.js: "cannot reenter while another
				// append is being published"). Genau das bildet diese Attrappe
				// nach, damit die Verschiebung des Weiterschaltens messbar ist.
				if (ctx.imAppend === true) throw new Error(REENTRANZ)
				// Fehler-Injektion für den Test „Wartezustand bleibt stehen".
				const erzwungen = optionen.resumeFehler?.(aufrufe.resume)
				if (erzwungen !== undefined) throw new Error(erzwungen)
				const ziel = ziele.get(agent)
				if (ziel === undefined || ziel.id !== ref.id || ziel.revision !== ref.revision) {
					throw new Error('goal is not resumable')
				}
				ziel.activation = 'armed'
				return ziel
			}
		},
		agents: { list: () => [], get: () => undefined },
		tools: { register: (definition) => { werkzeuge.push(definition); return () => {} } },
		systemPrompt: { section: () => () => {}, getSectionOrder: () => 5 },
		// `goal-await` meldet hier seinen Diagnose-Dienst an; die Szene hebt ihn
		// auf, damit „der Wartezustand ist weg/steht noch" von außen prüfbar ist.
		provide: (name, dienst) => {
			dienste.set(name, dienst)
			return () => { dienste.delete(name) }
		},
		// cordis wirft für einen Dienst, den das Profil nicht geladen hat.
		get: (name) => {
			if (name === 'agentTeams' && optionen.team !== undefined) return optionen.team
			throw new Error('service not found: ' + name)
		},
		on: (ereignis, fn) => {
			if (!horcher.has(ereignis)) horcher.set(ereignis, [])
			horcher.get(ereignis).push(fn)
			return () => {}
		},
		effect: (fn) => {
			const ab = fn()
			return () => { if (typeof ab === 'function') ab() }
		},
		logger: { warn: () => {}, info: () => {} }
	}

	apply(ctx, {})

	/** Ein Agent mit aktivem, scharfem Ziel. */
	const mitZiel = (id, objective = 'Ziel von ' + id) => {
		const agent = { id, session: {} }
		ziele.set(agent, {
			id: 'goal-' + id,
			revision: 1,
			phase: 'active',
			activation: 'armed',
			objective,
			maxGoalRounds: 10,
			roundsStarted: 0
		})
		return agent
	}

	/**
	 * Alle angemeldeten Horcher eines Ereignisses auslösen.
	 *
	 * `session/event` läuft im Kern SYNCHRON innerhalb von `session.append`
	 * (gemessen 2026-11-03, siehe Modulkopf (D)) — `ctx.imAppend` bildet das nach,
	 * und `resume` wirft dann den Fehler des Kerns. Ein `agent/inbox/inserted`
	 * läuft nicht in einem append; dort bleibt das Flag aus.
	 */
	const sende = (ereignis, ...argumente) => {
		const vorher = ctx.imAppend
		if (ereignis === 'session/event') ctx.imAppend = true
		try {
			for (const fn of horcher.get(ereignis) ?? []) fn(...argumente)
		} finally {
			ctx.imAppend = vorher
		}
	}

	/**
	 * Das Werkzeug, sobald es angemeldet ist.
	 *
	 * Die Anmeldung läuft in einem asynchronen Block, weil `defineTool` aus dem
	 * Kern dynamisch geladen wird. Fehlt der Kern, soll der Test LAUT scheitern
	 * statt still nichts zu prüfen.
	 */
	const werkzeug = async () => {
		for (let i = 0; i < 600; i += 1) {
			const treffer = werkzeuge.find((definition) => definition.name === 'await_goal_dependency')
			if (treffer !== undefined) return treffer
			await warte(10)
		}
		throw new Error('das Werkzeug await_goal_dependency wurde nicht angemeldet — ist @deepseek-ai/dsh-tools auffindbar?')
	}

	/**
	 * Die offenen Wartezustände, wie der Patch sie selbst meldet.
	 *
	 * Der Dienst wird synchron in `apply` angemeldet (`ctx.provide` steht im
	 * Rumpf der `ctx.effect`-Funktion), deshalb ist er hier schon da.
	 */
	const offene = () => dienste.get('goalAwait')?.offene() ?? []

	return { ctx, ziele, aufrufe, mitZiel, sende, werkzeug, offene, ziel: (agent) => ziele.get(agent) }
}

// ---------------------------------------------------------------------------
// 1. (A) Die richtige Nachricht weckt, die falsche nicht
// ---------------------------------------------------------------------------

test('die richtige Nachricht weckt das Ziel', async () => {
	const szene = baueSzene()
	const anna = szene.mitZiel('sess-anna')
	const werkzeug = await szene.werkzeug()

	const antwort = await werkzeug.execute(
		{ waiting_for: 'der Messbericht von bob', von: 'bob', max_wait_seconds: 60 },
		{ agent: anna }
	)

	assert.equal(antwort.waiting, true, 'das Ziel muss warten')
	assert.match(antwort.note, /bob/u, 'die Antwort muss sagen, von wem die Zutat erwartet wird')
	assert.equal(szene.ziel(anna).activation, 'disarmed', 'das Ziel muss entwaffnet sein, sonst verbraucht es weiter Runden')

	szene.sende('agent/inbox/inserted', { agent: anna, message: teamNachricht(BOB, 'bob') })
	// Das Scharfschalten liegt in einem eigenen Durchlauf (Modulkopf (D)).
	await naechsterDurchlauf()

	assert.equal(szene.ziel(anna).activation, 'armed', 'die Nachricht von bob ist die Zutat — das Ziel muss wieder scharf sein')
	assert.equal(szene.aufrufe.resume, 1, 'genau ein Scharfschalten')
})

test('die falsche Nachricht weckt das Ziel nicht', async () => {
	const szene = baueSzene()
	const anna = szene.mitZiel('sess-anna')
	const werkzeug = await szene.werkzeug()

	await werkzeug.execute({ waiting_for: 'der Messbericht von bob', von: 'bob', max_wait_seconds: 60 }, { agent: anna })

	// carol schreibt — das ist NICHT die Zutat.
	szene.sende('agent/inbox/inserted', { agent: anna, message: teamNachricht(CAROL, 'carol') })
	await naechsterDurchlauf()

	assert.equal(
		szene.ziel(anna).activation,
		'disarmed',
		'ein Gruß von carol hat ein Ziel geweckt, das auf bob wartet — genau der Fehler, der hier behoben wird'
	)
	assert.equal(szene.aufrufe.resume, 0, 'ohne Zutat darf nichts scharf geschaltet werden')

	// Gegenprobe im selben Aufbau: die richtige Nachricht weckt DENSELBEN
	// Wartezustand. Ohne diesen Teil würde der Test auch dann grün, wenn der
	// Wecker gar nicht mehr funktioniert.
	szene.sende('agent/inbox/inserted', { agent: anna, message: teamNachricht(BOB, 'bob') })
	await naechsterDurchlauf()
	assert.equal(szene.ziel(anna).activation, 'armed', 'danach muss bob das Ziel wecken — sonst prüft der Test nur, dass nichts passiert')
})

// ---------------------------------------------------------------------------
// 2. Rückwärtsverträglichkeit: kein Team, keine Absenderangabe
// ---------------------------------------------------------------------------

test('ohne Absenderangabe weckt jede Nachricht wie bisher (Rückwärtsverträglichkeit)', async () => {
	// Kein Team im Profil: `ctx.get("agentTeams")` wirft, wie in einem Profil
	// ohne dsh-experimental-agent-team. Genau dieser Fall muss unverändert sein.
	const szene = baueSzene()
	const anna = szene.mitZiel('sess-anna')
	const werkzeug = await szene.werkzeug()

	const antwort = await werkzeug.execute({ waiting_for: 'der Messbericht von bob', max_wait_seconds: 60 }, { agent: anna })
	assert.equal(antwort.waiting, true)
	assert.equal(szene.ziel(anna).activation, 'disarmed')

	// Ein beliebiger Absender — ohne `von` ist das weiterhin die Zutat.
	szene.sende('agent/inbox/inserted', { agent: anna, message: teamNachricht(CAROL, 'carol') })
	await naechsterDurchlauf()
	assert.equal(szene.ziel(anna).activation, 'armed', 'ohne Absenderangabe muss jede Nachricht wecken wie vorher')

	// Und der Mensch weckt immer, auch mit gesetztem Absender.
	const szene2 = baueSzene()
	const bert = szene2.mitZiel('sess-bert')
	const werkzeug2 = await szene2.werkzeug()
	await werkzeug2.execute({ waiting_for: 'die Antwort des Menschen', von: 'bob', max_wait_seconds: 60 }, { agent: bert })
	szene2.sende('agent/inbox/inserted', { agent: bert, message: menschenNachricht })
	await naechsterDurchlauf()
	assert.equal(szene2.ziel(bert).activation, 'armed', 'der Mensch darf nie am Absenderfilter hängen bleiben')
})

test('die Frist weckt das Ziel wie bisher', async () => {
	const szene = baueSzene()
	const anna = szene.mitZiel('sess-anna')
	const werkzeug = await szene.werkzeug()

	// 5 s ist die kleinste Frist, die `fristMs` zulässt — der Test wartet sie ab,
	// statt die Uhr zu fälschen: geprüft wird die Wirkung, nicht ein Aufruf.
	await werkzeug.execute({ waiting_for: 'etwas, das nie kommt', von: 'bob', max_wait_seconds: 5 }, { agent: anna })
	assert.equal(szene.ziel(anna).activation, 'disarmed')

	const grenze = Date.now() + 7000
	while (Date.now() < grenze && szene.ziel(anna).activation !== 'armed') await warte(50)

	assert.equal(szene.ziel(anna).activation, 'armed', 'nach Ablauf der Frist muss das Ziel wieder scharf sein — ein vergessener Wartezustand darf es nie stilllegen')
})

// ---------------------------------------------------------------------------
// 3. (C) Der Aufgaben-Wecker
// ---------------------------------------------------------------------------

/** Der native Team-Dienst, so weit `goal-await` ihn benutzt. */
function baueTeam(zuordnung) {
	return {
		tryMembership(agent) {
			return zuordnung[agent.id]
		}
	}
}

test('ein Teammitglied, das auf eine Aufgabe wartet, wird geweckt, wenn die Aufgabe fertig wird', async () => {
	const szene = baueSzene({ team: baueTeam({ 'sess-anna': { root: { id: TEAM }, id: TEAM, role: 'teammate', name: 'anna' } }) })
	const anna = szene.mitZiel('sess-anna')
	const werkzeug = await szene.werkzeug()

	await werkzeug.execute({ waiting_for: 'die Messung auf dem Board', max_wait_seconds: 60 }, { agent: anna })
	assert.equal(szene.ziel(anna).activation, 'disarmed')

	// Das Ereignis liegt auf der Sitzung der Team-Wurzel, nicht auf annas Sitzung —
	// geweckt wird trotzdem, weil die MITGLIEDSCHAFT entscheidet.
	szene.sende('session/event', { id: TEAM }, aufgabenEreignis(TEAM, 'completed'))
	await naechsterDurchlauf()

	assert.equal(szene.ziel(anna).activation, 'armed', 'eine fertige Aufgabe ist die Zutat — das Ziel muss wieder scharf sein')
})

test('ein fremdes Team weckt ein wartendes Ziel nicht', async () => {
	const szene = baueSzene({ team: baueTeam({ 'sess-anna': { root: { id: TEAM }, id: TEAM, role: 'teammate', name: 'anna' } }) })
	const anna = szene.mitZiel('sess-anna')
	const werkzeug = await szene.werkzeug()

	await werkzeug.execute({ waiting_for: 'die Messung auf dem Board', max_wait_seconds: 60 }, { agent: anna })

	szene.sende('session/event', { id: 'sess-anderes-team' }, aufgabenEreignis('sess-anderes-team', 'completed'))
	await naechsterDurchlauf()

	assert.equal(szene.ziel(anna).activation, 'disarmed', 'ein fremdes Team darf ein wartendes Ziel nicht wecken')
	assert.equal(szene.aufrufe.resume, 0)

	// Gegenprobe im selben Aufbau: das EIGENE Team weckt denselben Wartezustand.
	szene.sende('session/event', { id: TEAM }, aufgabenEreignis(TEAM, 'completed'))
	await naechsterDurchlauf()
	assert.equal(szene.ziel(anna).activation, 'armed', 'das eigene Team muss danach wecken — sonst prüft der Test nur, dass nichts passiert')
})

test('eine Aufgabe in Arbeit weckt ein wartendes Ziel nicht', async () => {
	const szene = baueSzene({ team: baueTeam({ 'sess-anna': { root: { id: TEAM }, id: TEAM, role: 'teammate', name: 'anna' } }) })
	const anna = szene.mitZiel('sess-anna')
	const werkzeug = await szene.werkzeug()

	await werkzeug.execute({ waiting_for: 'die Messung auf dem Board', max_wait_seconds: 60 }, { agent: anna })

	szene.sende('session/event', { id: TEAM }, aufgabenEreignis(TEAM, 'in_progress'))
	szene.sende('session/event', { id: TEAM }, aufgabenEreignis(TEAM, 'pending'))
	await naechsterDurchlauf()

	assert.equal(szene.ziel(anna).activation, 'disarmed', 'nur `completed` ist die Zutat — sonst wäre der Wecker wieder „jede Änderung weckt"')

	// Gegenprobe: `completed` weckt denselben Wartezustand.
	szene.sende('session/event', { id: TEAM }, aufgabenEreignis(TEAM, 'completed'))
	await naechsterDurchlauf()
	assert.equal(szene.ziel(anna).activation, 'armed')
})

test('ein Ziel ohne Wartezustand wird von einer fertigen Aufgabe nicht angefasst', async () => {
	const szene = baueSzene({ team: baueTeam({ 'sess-anna': { root: { id: TEAM }, id: TEAM, role: 'teammate', name: 'anna' } }) })
	// Ein laufendes Ziel, das NICHT über await_goal_dependency wartet.
	const anna = szene.mitZiel('sess-anna')
	await szene.werkzeug()

	szene.sende('session/event', { id: TEAM }, aufgabenEreignis(TEAM, 'completed'))
	await naechsterDurchlauf()

	assert.equal(szene.ziel(anna).activation, 'armed', 'das Ziel war scharf und muss scharf bleiben')
	assert.equal(szene.aufrufe.resume, 0, 'ohne Wartezustand darf niemand scharf geschaltet werden')
	assert.equal(szene.aufrufe.disarm, 0, 'ohne Wartezustand darf niemand entwaffnet werden')
})

// ---------------------------------------------------------------------------
// 3b. Der gemessene Fehler vom 2026-11-03: Weiterschalten und Wartezustand
// ---------------------------------------------------------------------------

test('der Kerntest: eine fertige Aufgabe weckt und schaltet weiter', async () => {
	const szene = baueSzene({ team: baueTeam({ 'sess-anna': { root: { id: TEAM }, id: TEAM, role: 'teammate', name: 'anna' } }) })
	const anna = szene.mitZiel('sess-anna')
	const werkzeug = await szene.werkzeug()

	await werkzeug.execute({ waiting_for: 'die Messung auf dem Board', max_wait_seconds: 60 }, { agent: anna })
	assert.equal(szene.ziel(anna).activation, 'disarmed')
	assert.equal(szene.offene().length, 1, 'der Wartezustand muss nach dem Aufruf angelegt sein')

	// `sende` stellt `session/event` — wie der Kern — innerhalb eines append zu;
	// ein resume von hier aus würde werfen (siehe `baueSzene`).
	szene.sende('session/event', { id: TEAM }, aufgabenEreignis(TEAM, 'completed'))
	await naechsterDurchlauf()

	assert.equal(szene.ziel(anna).activation, 'armed', 'die fertige Aufgabe muss das Ziel wieder scharf schalten')
	assert.equal(szene.aufrufe.resume, 1, 'genau ein Scharfschalten')
	assert.deepEqual(
		szene.offene(),
		[],
		'nach dem Wecken muss der Wartezustand weg sein — sonst weckt ihn die Frist ein zweites Mal'
	)
})

test('scheitert das Weiterschalten, bleibt der Wartezustand samt Uhr stehen', async () => {
	// Der Dienst wirft bei den ersten beiden Anläufen den GEMESSENEN Fehler des
	// Kerns (Reentrancy); der dritte Anlauf gelingt. Geprüft wird beides: der
	// Zustand überlebt den Fehlschlag, und die Uhr holt das Ziel danach wirklich.
	const szene = baueSzene({
		team: baueTeam({ 'sess-anna': { root: { id: TEAM }, id: TEAM, role: 'teammate', name: 'anna' } }),
		resumeFehler: (nummer) => (nummer <= 2 ? REENTRANZ : undefined)
	})
	const anna = szene.mitZiel('sess-anna')
	const werkzeug = await szene.werkzeug()

	// 5 s ist die kleinste Frist, die `fristMs` zulässt: der Test wartet sie ab,
	// statt die Uhr zu fälschen — geprüft wird die Wirkung, nicht ein Aufruf.
	await werkzeug.execute({ waiting_for: 'die Messung auf dem Board', max_wait_seconds: 5 }, { agent: anna })
	assert.equal(szene.ziel(anna).activation, 'disarmed')

	// Anlauf 1 kommt aus dem Aufgaben-Ereignis und scheitert.
	szene.sende('session/event', { id: TEAM }, aufgabenEreignis(TEAM, 'completed'))
	await naechsterDurchlauf()

	assert.equal(szene.ziel(anna).activation, 'disarmed', 'ein gescheitertes Weiterschalten darf das Ziel nicht scharf melden')
	assert.equal(szene.aufrufe.resume, 1, 'der Anlauf muss beim Dienst angekommen sein')
	assert.equal(
		szene.offene().length,
		1,
		'der Wartezustand darf bei einem Fehlschlag NICHT verschwinden — genau das ließ das Ziel am 2026-11-03 hängen'
	)

	// Anlauf 2 kommt von der Frist und scheitert ebenfalls; danach stellt der
	// Patch eine Wiederholungs-Uhr, und Anlauf 3 gelingt.
	const grenze = Date.now() + 12000
	while (Date.now() < grenze && szene.ziel(anna).activation !== 'armed') await warte(50)

	assert.equal(
		szene.ziel(anna).activation,
		'armed',
		'die Uhr muss das Ziel trotz des Fehlschlags wieder scharf bekommen — sonst bliebe es dauerhaft hängen'
	)
	assert.ok(szene.aufrufe.resume >= 3, `der dritte Anlauf fehlt (nur ${szene.aufrufe.resume} Versuche)`)
	assert.deepEqual(szene.offene(), [], 'nach dem gelungenen Anlauf muss der Wartezustand weg sein')
})

test('wakes_on nennt alle Wege, die das Ziel wieder scharf schalten', async () => {
	// Im Team sind alle drei Wege scharf; ein Einzelwert würde über zwei davon lügen.
	const mitTeam = baueSzene({ team: baueTeam({ 'sess-anna': { root: { id: TEAM }, id: TEAM, role: 'teammate', name: 'anna' } }) })
	const anna = mitTeam.mitZiel('sess-anna')
	const erste = await (await mitTeam.werkzeug()).execute(
		{ waiting_for: 'die Messung auf dem Board', max_wait_seconds: 60 },
		{ agent: anna }
	)
	assert.deepEqual(erste.wakes_on, ['message', 'task', 'timeout'], 'die Antwort muss alle drei Wege nennen')
	assert.match(erste.note, /task of your team/u, 'die Erklärung muss den Aufgaben-Weg nennen')

	// Ohne Team kann keine Aufgabe wecken — dann gehört `task` nicht in die Antwort.
	const ohneTeam = baueSzene()
	const bert = ohneTeam.mitZiel('sess-bert')
	const zweite = await (await ohneTeam.werkzeug()).execute(
		{ waiting_for: 'die Antwort des Menschen', max_wait_seconds: 60 },
		{ agent: bert }
	)
	assert.deepEqual(zweite.wakes_on, ['message', 'timeout'], 'ohne Team gibt es keinen Aufgaben-Wecker')
	assert.ok(!/task of your team/u.test(zweite.note), 'ohne Team darf die Erklärung keinen Aufgaben-Weg versprechen')

	// Nichts entwaffnet: leere Liste. Sie wäre falsch, sobald dort ein Weg stünde.
	const ohneZiel = baueSzene()
	const dritte = await (await ohneZiel.werkzeug()).execute({ waiting_for: 'egal' }, { agent: { id: 'sess-caesar', session: {} } })
	assert.equal(dritte.waiting, false)
	assert.deepEqual(dritte.wakes_on, [], 'ohne Ziel ist nichts entwaffnet, also weckt auch nichts')

	// Ein pausiertes Ziel wird ebenfalls nicht entwaffnet.
	const pausiert = baueSzene()
	const dora = pausiert.mitZiel('sess-dora')
	pausiert.ziel(dora).phase = 'paused'
	const vierte = await (await pausiert.werkzeug()).execute({ waiting_for: 'egal' }, { agent: dora })
	assert.equal(vierte.waiting, false)
	assert.deepEqual(vierte.wakes_on, [], 'ein nicht aktives Ziel wird nicht entwaffnet')
})

// ---------------------------------------------------------------------------
// 4. Die Bausteine einzeln — Quellarten und Normalisierung
// ---------------------------------------------------------------------------

test('der Absender wird nur gegen einen FREMDEN Absender geprüft', () => {
	// Ohne Absenderangabe: alles außer der Zielrunde.
	assert.equal(istZutat(teamNachricht(CAROL, 'carol'), ''), true)
	assert.equal(istZutat(teamNachricht(CAROL, 'carol')), true, 'ohne zweiten Parameter bleibt das alte Verhalten')
	assert.equal(istZutat(zielrunde, 'bob'), false, 'die Zielrunde weckt nie — sonst eine Schleife')
	assert.equal(istZutat(undefined), true, 'eine Nachricht ohne Quelle zählt wie bisher')

	// Mit Absenderangabe: Name, Sitzungs-Kennung und Groß/Klein zählen.
	assert.equal(istZutat(teamNachricht(BOB, 'bob'), 'bob'), true)
	assert.equal(istZutat(teamNachricht(BOB, 'Bob'), 'BOB'), true, 'Namen werden ohne Rücksicht auf Groß/Klein verglichen')
	assert.equal(istZutat(relayNachricht(BOB), BOB), true, 'send_to_session trägt den Absender als senderSessionId')
	assert.equal(istZutat({ source: { kind: 'subagent-settled', senderSessionId: 'sess-kind' } }, 'sess-kind'), true, 'das fertige Kind ist eine Zutat')
	assert.equal(istZutat(teamNachricht(CAROL, 'carol'), 'bob'), false, 'carol ist nicht bob')
	assert.equal(istZutat(relayNachricht(CAROL), BOB), false, 'eine fremde Sitzung ist nicht die erwartete')
	assert.equal(istZutat(menschenNachricht, 'bob'), true, 'der Mensch weckt immer')
	assert.equal(istZutat({ source: { kind: 'schedule' } }, 'bob'), true, 'ein Kern-Ereignis ohne Absender weckt wie bisher')

	// Und der Aufgaben-Wecker nimmt nur das fertige Team-Ereignis.
	assert.equal(istAufgabenWecker(aufgabenEreignis(TEAM, 'completed')), true)
	assert.equal(istAufgabenWecker(aufgabenEreignis(TEAM, 'in_progress')), false)
	assert.equal(istAufgabenWecker({ type: 'team/member', data: {} }), false)
	assert.equal(istAufgabenWecker({ type: 'team/task' }), false, 'ein Ereignis ohne Aufgabe weckt nicht')
	assert.equal(istAufgabenWecker(undefined), false)
})

test('die Absenderangabe wird normalisiert, aber nicht in einen Satz verwandelt', () => {
	assert.equal(absenderText(undefined), '')
	assert.equal(absenderText(7), '')
	assert.equal(absenderText('  bob  '), 'bob')
	// Eine Sitzungs-Kennung darf nicht zerschrieben werden: der Vergleich sucht
	// genau diese Zeichenkette.
	assert.equal(absenderText(' ' + BOB + ' '), BOB)
	assert.equal(absenderText('a'.repeat(500)).length, 200, 'eine riesige Angabe wird gekappt')

	// Die Wartebedingung wird dagegen einzeilig und mit Auslassungszeichen gekürzt.
	assert.equal(bedingungText('a\nb'), 'a b')
	assert.ok(bedingungText('a'.repeat(500)).endsWith('…'))

	// Und die alte Frist-Grenze bleibt, wie sie war.
	assert.equal(fristMs(0), 5000, 'die kleinste Frist bleibt 5 s')
	assert.equal(fristMs(999999), 7200000, 'die größte Frist bleibt 2 h')
	assert.equal(fristMs(undefined), 900000)
})

// ---------------------------------------------------------------------------
// 5. Gegenproben am Code — eine Kopie unter /tmp, genau ein Filter ausgebaut
// ---------------------------------------------------------------------------

/**
 * Legt eine Kopie des Moduls unter /tmp an, in der EINE Zeile ersetzt ist.
 *
 * Die Kopie entsteht aus DER Datei des Repos, nicht aus einer Nachbildung.
 * Greift die Ersetzung nicht, wirft die Funktion — sonst maße die Gegenprobe
 * den Filter mit, den sie ausbauen soll, und wäre keine.
 *
 * @param ersetzung - `[alt, neu]`.
 * @param name - Dateiname der Kopie.
 * @returns der Pfad der Kopie.
 */
function kopieOhne(ersetzung, name) {
	const quelle = readFileSync(MODUL, 'utf8')
	if (!quelle.includes(ersetzung[0])) {
		throw new Error('die Zeile "' + ersetzung[0] + '" steht so nicht im Modul — die Gegenprobe wuerde sonst den Filter mitmessen')
	}
	const angepasst = quelle.replace(ersetzung[0], ersetzung[1])
	if (angepasst.includes(ersetzung[0])) {
		throw new Error('die Ersetzung ' + name + ' hat nicht gegriffen — die Gegenprobe waere keine')
	}
	const ordner = mkdtempSync(join(tmpdir(), 'goal-await-' + name + '-'))
	const ziel = join(ordner, 'goal-await.mjs')
	writeFileSync(ziel, angepasst)
	return ziel
}

/**
 * Fährt DIESE Testdatei erneut — nur mit den Tests, deren Name auf `muster`
 * passt, und gegen `modulPfad` statt gegen das Modul des Repos.
 *
 * @returns `{ code, ausgabe }` des Kindprozesses.
 */
function laufeTests(muster, modulPfad) {
	return new Promise((fertig, fehler) => {
		// `NODE_TEST_CONTEXT` erbt der Kindprozess vom laufenden Test-Runner; mit ihr
		// hält sich `node --test` für einen rekursiven Lauf und startet gar nichts.
		const umgebung = { ...process.env, GOAL_AWAIT_MODUL: modulPfad }
		delete umgebung.NODE_TEST_CONTEXT
		const prozess = spawn(process.execPath, ['--test', '--test-name-pattern=' + muster, 'test/goal-await.test.mjs'], {
			cwd: REPO,
			env: umgebung,
			stdio: ['ignore', 'pipe', 'pipe']
		})
		let ausgabe = ''
		prozess.stdout.on('data', (teil) => { ausgabe += teil })
		prozess.stderr.on('data', (teil) => { ausgabe += teil })
		prozess.on('error', fehler)
		prozess.on('close', (code) => fertig({ code, ausgabe }))
	})
}

test('Gegenprobe am Code: ohne den Absenderfilter wird der Kern-Test rot', async () => {
	const muster = '^(die richtige Nachricht|die falsche Nachricht)'

	// Erst die Probe auf dem ECHTEN Modul: beide Tests müssen hier grün sein.
	const echt = await laufeTests(muster, MODUL)
	assert.equal(echt.code, 0, 'die zwei Weckruf-Tests sind auf dem echten Modul rot:\n' + echt.ausgabe)
	assert.match(echt.ausgabe, /# pass 2/u, 'es liefen nicht genau die zwei Weckruf-Tests:\n' + echt.ausgabe)

	// Jetzt dieselbe Probe gegen die Kopie, in der der Filter IMMER durchlässt
	// (der alte Zustand: jede Nachricht weckt).
	const ohne = kopieOhne(['\tif (!abgesendetVon(quelle, von)) return false;', '\tif (false) return false;'], 'ohne-absenderfilter')
	const kaputt = await laufeTests(muster, ohne)
	assert.notEqual(kaputt.code, 0, 'der Kern-Test blieb ohne Absenderfilter grün — er prüft den Filter nicht:\n' + kaputt.ausgabe)
	assert.match(kaputt.ausgabe, /# fail 1/u, 'ohne Filter wurde nicht GENAU der Kern-Test rot:\n' + kaputt.ausgabe)
	assert.match(kaputt.ausgabe, /# pass 1/u, 'die richtige Nachricht muss weiterhin wecken:\n' + kaputt.ausgabe)
})

test('Gegenprobe am Code: ohne den Teamfilter wird der Fremdteam-Test rot', async () => {
	const muster = '^ein fremdes Team'

	const echt = await laufeTests(muster, MODUL)
	assert.equal(echt.code, 0, 'der Fremdteam-Test ist auf dem echten Modul rot:\n' + echt.ausgabe)
	assert.match(echt.ausgabe, /# pass 1/u, 'es lief nicht genau der Fremdteam-Test:\n' + echt.ausgabe)

	const ohne = kopieOhne(
		['\t\t\treturn String(mitglied.id) === teamId;', '\t\t\treturn true;'],
		'ohne-teamfilter'
	)
	const kaputt = await laufeTests(muster, ohne)
	assert.notEqual(kaputt.code, 0, 'der Fremdteam-Test blieb ohne Teamfilter grün — er prüft die Mitgliedschaft nicht:\n' + kaputt.ausgabe)
	assert.match(kaputt.ausgabe, /# fail 1/u, 'ohne Teamfilter wurde nicht genau dieser Test rot:\n' + kaputt.ausgabe)
})

test('Gegenprobe am Code: ohne den Statusfilter wird der In-Arbeit-Test rot', async () => {
	const muster = '^eine Aufgabe in Arbeit'

	const echt = await laufeTests(muster, MODUL)
	assert.equal(echt.code, 0, 'der In-Arbeit-Test ist auf dem echten Modul rot:\n' + echt.ausgabe)
	assert.match(echt.ausgabe, /# pass 1/u, 'es lief nicht genau der In-Arbeit-Test:\n' + echt.ausgabe)

	const ohne = kopieOhne(['\tif (ereignis.data?.task?.status !== "completed") return false;', '\tif (false) return false;'], 'ohne-statusfilter')
	const kaputt = await laufeTests(muster, ohne)
	assert.notEqual(kaputt.code, 0, 'der In-Arbeit-Test blieb ohne Statusfilter grün — er prüft den Status nicht:\n' + kaputt.ausgabe)
	assert.match(kaputt.ausgabe, /# fail 1/u, 'ohne Statusfilter wurde nicht genau dieser Test rot:\n' + kaputt.ausgabe)
})

test('Gegenprobe am Code: ohne die Verschiebung wird der Kerntest rot', async () => {
	const muster = '^der Kerntest'

	// Erst die Probe auf dem ECHTEN Modul: der Kerntest muss hier grün sein.
	const echt = await laufeTests(muster, MODUL)
	assert.equal(echt.code, 0, 'der Kerntest ist auf dem echten Modul rot:\n' + echt.ausgabe)
	assert.match(echt.ausgabe, /# pass 1/u, 'es lief nicht genau der Kerntest:\n' + echt.ausgabe)

	// Jetzt dieselbe Probe gegen die Kopie, in der das Weiterschalten wieder
	// DIREKT im Horcher läuft — das ist der gemessene Zustand vom 2026-11-03.
	const direkt = kopieOhne(['\tsetImmediate(arbeit);', '\tarbeit();'], 'ohne-verschieben')
	const kaputt = await laufeTests(muster, direkt)
	assert.notEqual(kaputt.code, 0, 'der Kerntest blieb ohne die Verschiebung grün — er prüft den Aufrufkontext nicht:\n' + kaputt.ausgabe)
	assert.match(kaputt.ausgabe, /# fail 1/u, 'ohne die Verschiebung wurde nicht GENAU der Kerntest rot:\n' + kaputt.ausgabe)
})
