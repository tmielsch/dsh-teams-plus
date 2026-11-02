/**
 * umzug.test.mjs — Selbstpruefung fuer den Umzug aus dsh-projectOS.
 *
 * Der Test belegt sieben Dinge:
 *   1. alle 23 Patch-Dateien liegen im Paket; 21 davon sind byte-gleich zum Original (sha256),
 *      die zwei Rollen-Patches tragen die neue Fassung (Begruendung bei SHA256_ABWEICHEND),
 *   2. package.json exportiert patches/*, und cordis.patch.yml nennt genau die sechs B-Patches,
 *   3. jede der 18 A-Dateien antwortet auf --status, ohne die DSH-Installation anzufassen,
 *   4. bin/teams-plus.mjs ist ausfuehrbar und `status` listet die A-Patches,
 *   5. `link` haengt patches/ und rollen/ nach ~/.dsh/.tm/teams-plus (geprueft in einem
 *      Temp-Zuhause, nicht im echten ~/.dsh),
 *   6. beide Rollen-Patches finden den Rollenordner: Datenordner des Pakets, Rueckfall auf
 *      ~/.dsh/rollen, und DSH_ROLLEN_DIR als Uebersteuerung,
 *   7. die zwei zurueckgezogenen Rollen (Red-Team-STOPP) liegen noch im Paket, kommen aber in
 *      der Auslieferungsliste nicht vor.
 *
 * Kein Netz, keine Schreibe in die echte DSH-Installation: die Werkzeuge laufen ausschliesslich
 * mit --status, und der Test vergleicht vorher/nachher Groesse und mtime der Zieldateien.
 * Die sha256-Werte sind am 2026-10-30 beim Umzug aus den Originalen festgehalten:
 *   /Users/tmielsch/dsh-projectOS/patches/<name>   (17 Dateien)
 *   /Users/tmielsch/.dsh/patches/<name>            (6 Dateien mit "member")
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HILFE } from '../patches/subagent-rolle.mjs'

const PAKET = join(dirname(fileURLToPath(import.meta.url)), '..')
const PATCHES = join(PAKET, 'patches')
const BIN = join(PAKET, 'bin', 'teams-plus.mjs')
const ROLLE_TITEL = join(PATCHES, 'rolle-titel.mjs')

/** sha256 der 21 Originale, die unveraendert übernommen wurden. */
const SHA256_ORIGINAL = {
	'allow-child-goal-resume.mjs': 'c87a4b1dc04468e4ec1a77d80e6619033fa7013d96776207e52eb8e84d716beb',
	'child-goal-resume.mjs': '87e26e8a225cea79f6135ef58ae5f09dbb5fa3c8b9bd1e153e88412f5b30509d',
	'allow-child-session-routing.mjs': 'ab86aeaea7da393723bc11395aaa380a1e32fa7e7eccb887f563490de60538a5',
	'child-session-routing.mjs': '302bfcbcebaccacb9094fc6359d8318a7305feda49a7978c51d7a4db942b2a74',
	'allow-subagent-goals.mjs': '0273abc405107b66718c82228aae422de5c840995b7d455bee7324852fc763b6',
	'goals-for-subagents.mjs': '27d90969244c1203ca7b0485113c79e604be42e8aeda67997df15644a42791ac',
	'allow-subagent-model-fields.mjs': 'f2b551039a62b61e0e80fb37af923dbe94957ce7f02ef787af068aef496de053',
	'subagent-model-fields.mjs': 'e0a0e28db5d3e26a3affc436824634c74d38e04d6824756aec2e157ff78def97',
	'allow-subagent-rolle.mjs': '798d0ec8e3c68c67ed8c36c1bc4bb7214b320e155e390fdf842807fda8b4df8f',
	'allow-subagent-files.mjs': 'a6fdbce5767a63c02bf0c8d9f807483d2924c3d635c86fc32e2368bacc4f8d1e',
	'subagent-files.mjs': 'f2acd36af722be2d1e60d54b6e01b7f5bab9015b9e22bc038d7207184e97ad6f',
	'allow-member-images.mjs': 'b2783a30eb91d4a54b9ba567d7fa34420767a6e71d7b17baddfe1b9f2beb485d',
	'member-images.mjs': 'ea348bd3bc8a4aa1e41dc620aad1d363257c6c2c36553c356a51dbdf1522e4e4',
	'install-member-images.mjs': 'ff138988a03f53c0a8afad03c01feb4d85c01d21a589e0c52ce63f6cca0fd427',
	'member-image-check.mjs': '8422495fcf0ec4079959617c9dd1215199c27e6fe2f96463e54e5410f1f5d140',
	'allow-member-model.mjs': 'f2822fe597ea5487c37ad1fb7acbd844da844bad4b325145019a629bdd24e9fd',
	'member-model.mjs': '8f56ff4eaceb8773c3a537a4d729fa89ffad4f36dd59c7902c4feaf830be4584',
	'delegate-send.mjs': '62af78119649e92e65fa97ff968e1fe04fe2e074cb4c7f9e8604b87325a69d17',
	'teammate-model.mjs': 'a02a381d027a478e474116357b4c1ebde876a229809bd90641ea2630e139a09c'
}

/**
 * Die zwei Dateien, die ABSICHTLICH vom Original abweichen — hier stehen die sha256 der
 * NEUEN Fassung, damit ein spaeterer Umbau auffaellt.
 *
 * Warum sie abweichen: der Rollenordner ist nach `~/.dsh/.tm/teams-plus/rollen` umgezogen
 * (Entscheidung des Menschen 2026-10-30, dorthin haengt `teams-plus link` die Rollen). Die
 * beiden Patches loesten ihn vorher fest auf `~/.dsh/rollen` auf; ohne Aenderung faende
 * `delegate_task` mit dem Feld `rolle` nach der Installation keine Rolle mehr, und
 * `rolle-titel` bekaeme eine leere Rollenliste.
 *
 * Die Abweichung ist genau die Ordneraufloesung plus ihr Kommentar: beide suchen in derselben
 * Reihenfolge und nehmen den ersten vorhandenen Ordner — 1. `DSH_ROLLEN_DIR` (Uebersteuerung),
 * 2. `~/.dsh/.tm/teams-plus/rollen` (der neue Ort), 3. `~/.dsh/rollen` (Rueckfall, damit eine
 * bestehende Installation, in der die Rollen heute dort liegen, nicht bricht). Dazu kommt je
 * Datei `existsSync` in den Importen, weil die Aufloesung pruefen muss, welcher Ordner da ist.
 *
 * Praezedenzfall im alten Repo: als `delegate-send` und `teammate-model` nach dsh-projectOS
 * einzogen, musste der Selbsttest auf `realpathSync` umgestellt werden, weil er ueber einen
 * Verweis sonst nichts geprueft haette. Auch diese Abweichung war beabsichtigt.
 */
const SHA256_ABWEICHEND = {
	// goal-await.mjs: die Werkzeugbeschreibung wurde am 2026-10-30 ausgeschrieben. Grund gemessen:
	// die globale AGENTS.md ist 77 078 Bytes gross, das Budget 65 536, und der TEAMSPLUS-Block
	// beginnt bei Byte 63 387 — von 13 691 Bytes kommen nur 2 149 an. Eine Anleitung dort waere
	// zu 84 % unsichtbar. Die Beschreibung des Werkzeugs kommt dagegen bei jedem Aufruf an.
	'goal-await.mjs': '674454d06e3a4acfc1770995f428b85a9bf8a4d5d6537cfa23285c95090426a8',
	'subagent-rolle.mjs': 'b6e1869ac8279ea9b890d1eb78b8c2ae6cd6a91d0287af2ee2250060bf71276a',
	'rolle-titel.mjs': '5deab0dae9366ea34be545c1b258a1510880300b477a6e9d5ac715664ce1a2d7',
	// stille-nachrichten.mjs: am 2026-10-31 repariert. Drei gemessene Fehler im Original:
	//  (1) 37 970 Protokollzeilen in 13 h, weil bei JEDEM `tools/change` eine Zeile je Agent
	//      geschrieben wurde — auch wenn nichts geschah;
	//  (2) 3 746 Warnungen fuer den Normalfall "fremdes Werkzeug mit demselben Namen";
	//  (3) die Prompt-Regel wurde ueber das Agenten-OBJEKT geschluesselt und bei jeder
	//      Neuerzeugung erneut eingetragen, ohne den alten Eintrag abzumelden — die Regel stand
	//      in der Test-Sitzung mehr als 20-mal im System-Prompt.
	// Aenderungen: Protokoll-Drossel (20 Zeilen/s), eigener Stand "fremd" ohne Warnung,
	// Schluessel ueber die Sitzungs-Kennung, Aufraeumer auf `agent/disposed`.
	//
	// Zweite Runde (Red-Team M3/M5/N1, 2026-10-31):
	//  (1) Logpfad nach ~/.dsh/.tm/teams-plus/logs/ (E1) samt mkdirSync — vorher haette
	//      der Umzug das Protokoll still verschluckt, weil appendFileSync ohne Ordner wirft;
	//  (2) der Spawn-Anhang der Kaskaden-Regel ist ENTFERNT — sie stand damit zweimal im
	//      Modell-Input (Spawn-Prompt und System-Sektion). Die Sektion traegt sie allein;
	//      Begruendung und gemessener Beleg stehen bei `kaskadenRegelTraeger`;
	//  (3) die Drossel-Summenzeile wird jetzt auch bei Ruhe geschrieben (Timer mit unref).
	'stille-nachrichten.mjs': '82a080adf2a872eb18d7786c55e8faa9aed7cb84d6089d183cc8992fc5456946'
}

/** Die 18 A-Dateien: sie schreiben in die DSH-Installation. */
const A_DATEIEN = [
	'allow-child-goal-resume.mjs', 'child-goal-resume.mjs',
	'allow-child-session-routing.mjs', 'child-session-routing.mjs',
	'allow-subagent-goals.mjs', 'goals-for-subagents.mjs',
	'allow-subagent-model-fields.mjs', 'subagent-model-fields.mjs',
	'allow-subagent-rolle.mjs', 'subagent-rolle.mjs',
	'allow-subagent-files.mjs', 'subagent-files.mjs',
	'allow-member-images.mjs', 'member-images.mjs', 'install-member-images.mjs', 'member-image-check.mjs',
	'allow-member-model.mjs', 'member-model.mjs'
]

/** Die B-Patches: Cordis-Plugins aus cordis.patch.yml.
 *  Fuenf sind umgezogen; `send-to-session.mjs` und `team-board.mjs` entstehen in
 *  diesem Paket und sind deshalb ohne sha256-Anker gegen projectOS. */
const B_PATCHES = ['delegate-send.mjs', 'teammate-model.mjs', 'goal-await.mjs', 'stille-nachrichten.mjs', 'rolle-titel.mjs', 'send-to-session.mjs', 'team-board.mjs']

/** Die Werkzeuge mit eigener Bedienung (--status, --revert). */
const WERKZEUGE = A_DATEIEN.filter((name) => name.startsWith('allow-'))

/**
 * Die Dateien in rollen/, jede einzeln beim Namen genannt — nicht nur gezaehlt.
 * Seit dem Red-Team-STOPP sind es neun: sechs ausgelieferte Rollen (research, redteam,
 * implementer, draft, rag, projektmanager), zwei ZURUECKGEZOGENE Rollen (abteilungsleiter,
 * arbeitsgruppenleiter — aufbewahrt, aber nicht mehr ausgeliefert) und der Entwurf des
 * Team-Profils. Die zwei zurueckgezogenen und der Entwurf beginnen mit einem Unterstrich;
 * die Patches filtern genau solche Dateien aus, deshalb stehen sie in der Auslieferungsliste
 * nicht (eigener Test unten).
 */
const ROLLEN = [
	'research.md', 'redteam.md', 'implementer.md', 'draft.md', 'rag.md', 'projektmanager.md',
	'_ZURUECKGEZOGEN-abteilungsleiter.md', '_ZURUECKGEZOGEN-arbeitsgruppenleiter.md',
	'_ENTWURF-team-profile.md'
]

/**
 * Die Rollen, die das Paket ausliefert: sechs, alphabetisch — so, wie `rollenListe()` und
 * `subagentRollenListe()` sie zurueckgeben. Festgeschrieben und NICHT aus dem Ordner abgeleitet:
 * eine zurueckgezogene Rolle, die wieder ohne Unterstrich in rollen/ liegt, soll auffallen und
 * nicht die Erwartung mitverschieben.
 */
const AUSGELIEFERTE_ROLLEN = ['draft', 'implementer', 'projektmanager', 'rag', 'redteam', 'research']

/**
 * Bekannte Meldungen, mit denen ein Werkzeug ehrlich aufhoert, wenn es nichts findet.
 * Ein Exit 1 ist nur dann in Ordnung, wenn eine davon in der Ausgabe steht.
 */
const BEKANNT = [
	/Keine vollstaendige .* gefunden/,
	/Keine DSH-Installation gefunden/,
	/Dieses Verzeichnis gibt es nicht/
]

const starte = (datei, argumente) => spawnSync(process.execPath, [datei, ...argumente], { encoding: 'utf8' })

/**
 * Die Dateien der DSH-Installation, die ein A-Patch anfassen kann: alle lib/index.js und
 * lib/client.js der @deepseek-ai-Pakete. Aufgenommen werden Groesse und mtime; schreibt ein
 * Werkzeug, aendert sich beides.
 */
function zieldateien() {
	const stan = []
	const wurzeln = ['/opt/homebrew/lib/node_modules', '/usr/local/lib/node_modules', join(homedir(), '.local', 'lib', 'node_modules')]
	const profile = join(homedir(), '.dsh', 'profiles')
	if (existsSync(profile)) {
		for (const name of readdirSync(profile)) wurzeln.push(join(profile, name, 'node_modules'))
	}
	for (const wurzel of wurzeln) {
		for (const basis of [join(wurzel, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'), join(wurzel, '@deepseek-ai')]) {
			if (!existsSync(basis)) continue
			for (const paket of readdirSync(basis)) {
				for (const datei of ['index.js', 'client.js']) {
					const pfad = join(basis, paket, 'lib', datei)
					if (!existsSync(pfad)) continue
					const stand = statSync(pfad)
					stan.push(`${pfad} ${stand.size} ${stand.mtimeMs}`)
				}
			}
		}
	}
	return stan.sort()
}

test('alle 23 Patch-Dateien liegen im Paket; 21 byte-gleich, zwei mit der neuen Rollenaufloesung', () => {
	const alle = { ...SHA256_ORIGINAL, ...SHA256_ABWEICHEND }
	assert.equal(Object.keys(SHA256_ORIGINAL).length, 19, 'die Liste der unveraenderten Originale muss 19 Dateien haben')
	assert.equal(Object.keys(SHA256_ABWEICHEND).length, 4, 'es sind genau vier Dateien mit Absicht geaendert (zwei Rollen + goal-await + stille-nachrichten)')

	const abweichend = []
	for (const [name, soll] of Object.entries(alle)) {
		const pfad = join(PATCHES, name)
		if (!existsSync(pfad)) { abweichend.push(`${name}: fehlt im Paket`); continue }
		const ist = createHash('sha256').update(readFileSync(pfad)).digest('hex')
		if (ist !== soll) abweichend.push(`${name}: sha256 ${ist} statt ${soll}`)
	}
	assert.deepEqual(abweichend, [], 'Dateien weichen von ihrer festgehaltenen Fassung ab')
	// patches/package.json ist die Paketgrenze fuer den Client-Modul-Regler (siehe test/bundle.test.mjs);
	// sie ist kein Patch und steht deshalb nicht in den sha256-Listen.
	// `send-to-session.mjs` und `team-board.mjs` sind EIGENE Werkzeuge dieses Pakets, keine
	// umgezogenen Patches: sie entstehen hier und haben deshalb keinen sha256-Anker gegen projectOS.
	const erwartet = [...Object.keys(alle), 'package.json', 'send-to-session.mjs', 'team-board.mjs'].sort()
	assert.deepEqual(readdirSync(PATCHES).sort(), erwartet, 'im Ordner patches/ liegt eine andere Dateiliste als erwartet')
})

test('die zwei geaenderten Rollen-Patches weichen nur in der Ordneraufloesung und ihrem Kommentar ab', () => {
	// Gegenprobe zur Begruendung oben: alles andere muss byte-gleich zum Original sein.
	const original = '/Users/tmielsch/dsh-projectOS/patches'
	if (!existsSync(original)) return // auf einer anderen Maschine liegt das alte Repo nicht
	const zeilen = (pfad) => readFileSync(pfad, 'utf8').split('\n')
	for (const name of Object.keys(SHA256_ABWEICHEND)) {
		const alt = zeilen(join(original, name))
		const neu = zeilen(join(PATCHES, name))
		// Die geaenderten Stellen sind Kommentarzeilen oder die Aufloesungsfunktion selbst;
		// deshalb darf sich die Zeilenzahl nur um den Kommentar wachsen, nicht schrumpfen.
		assert.ok(neu.length >= alt.length, `${name}: die neue Fassung ist kuerzer als das Original`)
		assert.ok(neu.join('\n').includes('.tm'), `${name}: der neue Rollenordner kommt im Text nicht vor`)
		assert.ok(neu.join('\n').includes('.dsh", "rollen"'), `${name}: der Rueckfall auf ~/.dsh/rollen fehlt`)
	}
})

test('die neun Dateien in rollen/ sind vorhanden, keine fehlt, keine ist unerwartet', () => {
	const fehlend = ROLLEN.filter((name) => !existsSync(join(PAKET, 'rollen', name)))
	assert.deepEqual(fehlend, [], 'in rollen/ fehlt eine Rollendatei')
	// Namen gegen Namen, nicht Anzahl gegen Anzahl: so faellt auch eine umbenannte oder
	// zusaetzliche Datei auf, die die Anzahl gleich liesse.
	assert.deepEqual(readdirSync(join(PAKET, 'rollen')).sort(), [...ROLLEN].sort(), 'in rollen/ liegt eine andere Dateiliste als erwartet')
})

/**
 * Der Red-Team-STOPP als Test: `abteilungsleiter.md` und `arbeitsgruppenleiter.md` sind aus dem
 * Auslieferungspfad zurueckgezogen (Red-Team-Pass mit STOPP; der Bericht liegt beim
 * Auftraggeber) und tragen seither `_ZURUECKGEZOGEN-` vor dem Namen. Der Rollenordner ist der
 * Auslieferungspfad: was dort ohne Unterstrich liegt, steht in `rollenListe()` und ist ueber
 * `delegate_task` mit dem Feld `rolle` abrufbar. Deshalb haelt dieser Test BEIDES fest — die
 * zwei Dateien sind noch da (die Arbeit ist nicht verloren), und ihre Namen kommen in keiner
 * Auslieferungsliste mehr vor. Rot werden soll er, sobald eine der beiden wieder ohne
 * Unterstrich in rollen/ liegt; genau so wurde die Gegenprobe gefahren.
 */
test('die zwei zurueckgezogenen Rollen bleiben im Paket, werden aber nicht ausgeliefert', () => {
	// Die Erwartung steht fest und wird nicht aus dem Ordner abgeleitet: sonst wuerde eine wieder
	// ausgelieferte Rolle die Erwartung mitverschieben, und der Test bliebe gruen.
	const zurueckgezogen = ['abteilungsleiter', 'arbeitsgruppenleiter']
	const werkstatt = mkdtempSync(join(tmpdir(), 'teams-plus-zurueckgezogen-'))
	try {
		// Derselbe Hilfsmodul-Bau wie im Rollenaufloesungs-Test: der Text, der eingespielt wird,
		// wird als Modul geladen. Geprueft wird also der Patch, nicht eine Nachbildung.
		const hilfeText = HILFE.nachher.split('\n').filter((zeile) => !zeile.startsWith('import z ')).join('\n')
		const hilfePfad = join(werkstatt, 'hilfe.mjs')
		writeFileSync(hilfePfad, `${hilfeText}\nexport { subagentRollenListe };\n`)
		const laufPfad = join(werkstatt, 'lauf.mjs')
		writeFileSync(laufPfad, [
			'const [hilfePfad, titelPfad] = process.argv.slice(2)',
			'const hilfe = await import(hilfePfad)',
			'const titel = await import(titelPfad)',
			'console.log(JSON.stringify({ listeA: hilfe.subagentRollenListe(), listeB: titel.rollenListe() }))',
			''
		].join('\n'))

		// DSH_ROLLEN_DIR zeigt auf den Rollenordner des Pakets — denselben Ordner, auf den
		// `teams-plus link` in ~/.dsh/.tm/teams-plus/rollen verweist. Ein eigenes HOME haelt das
		// echte ~/.dsh aus dem Spiel.
		const heim = join(werkstatt, 'heim')
		mkdirSync(heim, { recursive: true })
		const lauf = spawnSync(process.execPath, [laufPfad, hilfePfad, ROLLE_TITEL], {
			encoding: 'utf8',
			env: { ...process.env, HOME: heim, DSH_ROLLEN_DIR: join(PAKET, 'rollen') }
		})
		assert.equal(lauf.status, 0, `Kindprozess endet mit ${lauf.status}:\n${lauf.stdout}${lauf.stderr}`)
		const stand = JSON.parse(lauf.stdout)
		assert.deepEqual(stand.listeA, stand.listeB, 'A- und B-Patch liefern verschiedene Rollenlisten')

		// (1) Keine der beiden wird ausgeliefert. Einzeln geprueft, damit die Fehlermeldung die
		// Rolle nennt, statt nur zwei Listen gegeneinanderzustellen.
		for (const rolle of zurueckgezogen) {
			assert.ok(!stand.listeA.includes(rolle), `der Patch liefert ${rolle} aus, obwohl die Rolle zurueckgezogen ist`)
		}

		// (2) Die Arbeit ist nicht verloren: beide Dateien liegen weiterhin im Paket. Rot wird
		// dieser Teil, wenn jemand sie loescht oder umbenennt, statt sie aufzubewahren.
		for (const rolle of zurueckgezogen) {
			const pfad = join(PAKET, 'rollen', `_ZURUECKGEZOGEN-${rolle}.md`)
			assert.ok(existsSync(pfad), `${pfad} fehlt — die zurueckgezogene Rolle wurde geloescht statt aufbewahrt`)
		}

		// (3) Die uebrigen sechs Rollen sind weiterhin vollstaendig da. Eine leere oder halbe
		// Liste wuerde (1) sonst bestehen, ohne irgendetwas zu belegen.
		assert.deepEqual(stand.listeA, AUSGELIEFERTE_ROLLEN, 'die Auslieferungsliste ist nicht die der sechs Rollen')

		// (4) Die Regel haengt am Unterstrich, nicht an diesen zwei Namen: JEDE Datei mit
		// fuehrendem Unterstrich in rollen/ muss aus der Auslieferung verschwinden. So faellt auch
		// eine kuenftig zurueckgezogene Rolle auf.
		const gesperrt = readdirSync(join(PAKET, 'rollen')).filter((name) => name.startsWith('_') && name.endsWith('.md'))
		assert.ok(gesperrt.length > 0, 'in rollen/ liegt keine Datei mit fuehrendem Unterstrich mehr — dann prueft (4) nichts')
		for (const name of gesperrt) {
			assert.ok(!stand.listeA.includes(name.slice(0, -3)), `${name} liegt in rollen/, wird aber ausgeliefert`)
		}
	} finally {
		rmSync(werkstatt, { recursive: true, force: true })
	}
})

test('package.json exportiert patches/*, und cordis.patch.yml nennt genau die sechs B-Patches', () => {
	const paket = JSON.parse(readFileSync(join(PAKET, 'package.json'), 'utf8'))
	assert.equal(paket.exports['./patches/*'], './patches/*', 'Wildcard-Export "./patches/*" fehlt')
	assert.equal(paket.exports['./rollen/*'], './rollen/*', 'Wildcard-Export "./rollen/*" fehlt')
	assert.equal(paket.bin['teams-plus'], './bin/teams-plus.mjs')

	const yml = readFileSync(join(PAKET, 'cordis.patch.yml'), 'utf8')
	const genannt = [...yml.matchAll(/@tmielsch\/dsh-teams-plus\/patches\/([\w.-]+\.mjs)/gu)].map((treffer) => treffer[1])
	assert.deepEqual(genannt.sort(), [...B_PATCHES].sort(), 'cordis.patch.yml nennt andere Dateien als die sechs B-Patches')
	for (const name of genannt) assert.ok(existsSync(join(PATCHES, name)), `patches/${name} fehlt`)
})

test('jede A-Datei antwortet auf --status, und die DSH-Installation bleibt unberuehrt', () => {
	const vorher = zieldateien()
	const abweichend = []

	for (const name of A_DATEIEN) {
		const lauf = starte(join(PATCHES, name), ['--status'])
		const text = `${lauf.stdout}${lauf.stderr}`
		// Kein Absturz: ein Absturz hinterlaesst eine Ausnahme im Text.
		assert.ok(!/(TypeError|ReferenceError|SyntaxError|RangeError|node:internal)/u.test(text), `${name} ist abgestuerzt:\n${text}`)
		if (lauf.status === 0) continue
		if (lauf.status === 1 && BEKANNT.some((muster) => muster.test(text))) continue
		abweichend.push(`${name}: Exit ${lauf.status}\n${text}`)
	}
	assert.deepEqual(abweichend, [], 'A-Dateien ohne Antwort auf --status')

	const nachher = zieldateien()
	assert.deepEqual(nachher, vorher, 'ein --status hat in der DSH-Installation etwas geschrieben')
	assert.ok(vorher.length > 0, 'keine DSH-Installation gefunden — der Test konnte nichts vergleichen')
})

test('bin/teams-plus.mjs ist ausfuehrbar und status listet die A-Patches', () => {
	assert.ok(existsSync(BIN), 'bin/teams-plus.mjs fehlt')
	assert.ok((statSync(BIN).mode & 0o111) !== 0, 'bin/teams-plus.mjs hat kein Ausfuehrungsrecht')
	assert.ok(readFileSync(BIN, 'utf8').startsWith('#!/usr/bin/env node'), 'Shebang fehlt')

	const lauf = starte(BIN, ['status'])
	assert.equal(lauf.status, 0, `status endet mit ${lauf.status}:\n${lauf.stdout}${lauf.stderr}`)
	for (const werkzeug of WERKZEUGE) {
		assert.ok(lauf.stdout.includes(werkzeug), `${werkzeug} fehlt in der Ausgabe von status`)
	}
	assert.match(lauf.stdout, /18 A-Dateien in 8 Werkzeugen/u)
	assert.match(lauf.stdout, /Nichts wurde geschrieben/u)

	const hilfe = starte(BIN, ['help'])
	assert.equal(hilfe.status, 0)
	assert.match(hilfe.stdout, /teams-plus apply/u)
})

test('link haengt patches/ und rollen/ nach ~/.dsh/.tm/teams-plus, nicht nach ~/.dsh/patches', () => {
	const heim = mkdtempSync(join(tmpdir(), 'teams-plus-link-'))
	try {
		// Seit der Abnahme 2026-10-30 (Punkt B1) ist `link` ohne Schalter ein Trockenlauf.
		// Angelegt wird nur noch mit `--apply`.
		const lauf = starte(BIN, ['link', '--apply', `--dsh-home=${heim}`])
		assert.equal(lauf.status, 0, `${lauf.stdout}${lauf.stderr}`)

		const ziel = join(heim, '.tm', 'teams-plus')
		assert.ok(lstatSync(join(ziel, 'patches')).isSymbolicLink(), 'patches ist kein Verweis')
		assert.ok(lstatSync(join(ziel, 'rollen')).isSymbolicLink(), 'rollen ist kein Verweis')
		assert.ok(!existsSync(join(heim, 'patches')), 'es wurde ein Ordner ~/.dsh/patches angelegt')
		// 23 umgezogene Patch-Dateien, dazu send-to-session.mjs und team-board.mjs als eigene
		// Werkzeuge dieses Pakets; patches/package.json ist die Paketgrenze fuer den
		// Client-Modul-Regler und zaehlt nicht mit (.mjs-Filter).
		assert.equal(readdirSync(join(ziel, 'patches')).filter((n) => n.endsWith('.mjs')).length, 25)
		// Der Verweis muss jede Rollendatei erreichbar machen — Namen, nicht nur die Anzahl.
		assert.deepEqual(readdirSync(join(ziel, 'rollen')).sort(), [...ROLLEN].sort(), 'der Verweis auf rollen/ erreicht nicht jede Rollendatei')
		assert.ok(readFileSync(join(ziel, 'patches', 'delegate-send.mjs')).equals(readFileSync(join(PATCHES, 'delegate-send.mjs'))))

		// Der Rueckweg ersetzt die Verweise durch byte-gleiche Kopien.
		const zurueck = spawnSync(process.execPath, [join(PAKET, 'scripts', 'link-dsh.mjs'), '--revert', `--dsh-home=${heim}`], { encoding: 'utf8' })
		assert.equal(zurueck.status, 0, `${zurueck.stdout}${zurueck.stderr}`)
		assert.ok(!lstatSync(join(ziel, 'patches')).isSymbolicLink(), 'patches ist nach --revert noch ein Verweis')
		assert.ok(readFileSync(join(ziel, 'patches', 'delegate-send.mjs')).equals(readFileSync(join(PATCHES, 'delegate-send.mjs'))))
	} finally {
		rmSync(heim, { recursive: true, force: true })
	}
})

test('der Anweisungstext ist ein Zeiger, die volle Fassung traegt den neuen Namen', () => {
	// Die Quelle ist seit dem Zeiger-Umbau die kurze Anweisung, nicht mehr der volle Text.
	// Sie muss die volle Fassung nennen und darf den alten Namen nicht tragen.
	const zeiger = readFileSync(join(PAKET, 'agents', 'teams-plus-agents.md'), 'utf8')
	assert.ok(zeiger.includes('teams-plus-agents.voll.md'), 'der Zeiger nennt die volle Fassung nicht')
	assert.ok(!/projectOS|Projekt-Manager/u.test(zeiger), 'der Zeiger nennt noch dsh-projectOS oder Projekt-Manager')
	const text = readFileSync(join(PAKET, 'agents', 'teams-plus-agents.voll.md'), 'utf8')
	assert.ok(text.startsWith('## Teams Plus: Namen und Aufträge (dsh-teams-plus)'), 'Titelzeile ist nicht umgestellt')
	assert.ok(!/projectOS|Projekt-Manager/u.test(text), 'der Text nennt noch dsh-projectOS oder Projekt-Manager')
	assert.ok(text.includes('tmielsch/dsh-teams-plus'), 'der Repo-Name fehlt')
	assert.ok(text.includes('Wo frühere Anweisungen regeln'), 'der Vorrang-Satz fehlt')
})

/**
 * Die Rollenaufloesung beider Patches. Sie steht im A-Patch in dem Text, der in die
 * DSH-Installation geht (HILFE.nachher) — also wird genau dieser Text als Modul geladen und
 * geprueft, nicht eine Nachbildung. `subagentRollenOrdner` selbst ist dort nicht exportiert,
 * deshalb exportiert der Test es beim Bau des Hilfsmoduls mit.
 *
 * Gesteuert wird ueber ein eigenes HOME im Kindprozess: `os.homedir()` folgt auf POSIX dem
 * $HOME. So bleibt das echte ~/.dsh unberuehrt, und die drei Faelle sind sauber trennbar.
 */
test('beide Rollen-Patches finden den Ordner: Datenordner, Rueckfall, DSH_ROLLEN_DIR', () => {
	const werkstatt = mkdtempSync(join(tmpdir(), 'teams-plus-rollen-'))
	try {
		// Das Hilfsmodul des A-Patches: derselbe Text, der eingespielt wird.
		const hilfeText = HILFE.nachher.split('\n').filter((zeile) => !zeile.startsWith('import z ')).join('\n')
		const hilfePfad = join(werkstatt, 'hilfe.mjs')
		writeFileSync(hilfePfad, `${hilfeText}\nexport { subagentRolleVoran, subagentRollenListe, subagentRollenOrdner };\n`)

		// Der Laeufer im Kindprozess: fragt beide Patches nach Ordner und Rollenliste.
		const laufPfad = join(werkstatt, 'lauf.mjs')
		writeFileSync(laufPfad, [
			'const [hilfePfad, titelPfad] = process.argv.slice(2)',
			'const hilfe = await import(hilfePfad)',
			'const titel = await import(titelPfad)',
			'console.log(JSON.stringify({',
			'  patchA: hilfe.subagentRollenOrdner(),',
			'  patchB: titel.rollenOrdner(),',
			'  listeA: hilfe.subagentRollenListe(),',
			'  listeB: titel.rollenListe()',
			'}))',
			''
		].join('\n'))

		/** Ein Zuhause mit den genannten Ordnern; `rollen` legt .md-Dateien in einen Ordner. */
		const zuhause = (name, ordner) => {
			const heim = join(werkstatt, name)
			mkdirSync(join(heim, '.dsh'), { recursive: true })
			for (const [relativ, rollen] of Object.entries(ordner)) {
				mkdirSync(join(heim, '.dsh', relativ), { recursive: true })
				for (const rolle of rollen) writeFileSync(join(heim, '.dsh', relativ, `${rolle}.md`), `# Rolle: ${rolle}\n`)
			}
			return heim
		}

		/** Beide Patches im Kindprozess befragen; `rollenDir` setzt DSH_ROLLEN_DIR. */
		const frage = (heim, rollenDir) => {
			const env = { ...process.env, HOME: heim }
			delete env.DSH_ROLLEN_DIR
			if (rollenDir !== undefined) env.DSH_ROLLEN_DIR = rollenDir
			const lauf = spawnSync(process.execPath, [laufPfad, hilfePfad, ROLLE_TITEL], { encoding: 'utf8', env })
			assert.equal(lauf.status, 0, `Kindprozess fuer ${heim} endet mit ${lauf.status}:\n${lauf.stdout}${lauf.stderr}`)
			return JSON.parse(lauf.stdout)
		}

		// Fall 1: nur der Datenordner des Pakets existiert.
		const nurNeu = zuhause('nur-neu', { '.tm/teams-plus/rollen': ['probe'] })
		{
			const stand = frage(nurNeu)
			assert.equal(stand.patchA, join(nurNeu, '.dsh', '.tm', 'teams-plus', 'rollen'), 'A-Patch findet den Datenordner nicht')
			assert.equal(stand.patchB, join(nurNeu, '.dsh', '.tm', 'teams-plus', 'rollen'), 'B-Patch findet den Datenordner nicht')
			assert.deepEqual(stand.listeA, ['probe'], 'A-Patch listet die Rolle im Datenordner nicht')
			assert.deepEqual(stand.listeB, ['probe'], 'B-Patch listet die Rolle im Datenordner nicht')
		}

		// Fall 2: nur der bisherige Ort existiert (bestehende Installation).
		const nurAlt = zuhause('nur-alt', { rollen: ['altprobe'] })
		{
			const stand = frage(nurAlt)
			for (const [seite, ordner] of [['patchA', stand.patchA], ['patchB', stand.patchB]]) {
				assert.equal(ordner, join(nurAlt, '.dsh', 'rollen'), `${seite} faellt nicht auf ~/.dsh/rollen zurueck`)
			}
			assert.deepEqual(stand.listeA, ['altprobe'])
			assert.deepEqual(stand.listeB, ['altprobe'])
		}

		// Fall 3: beide existieren — der neue Ort gewinnt.
		const beide = zuhause('beide', { '.tm/teams-plus/rollen': ['neu'], rollen: ['alt'] })
		{
			const stand = frage(beide)
			assert.equal(stand.patchA, join(beide, '.dsh', '.tm', 'teams-plus', 'rollen'), 'A-Patch nimmt nicht den neuen Ort')
			assert.equal(stand.patchB, join(beide, '.dsh', '.tm', 'teams-plus', 'rollen'), 'B-Patch nimmt nicht den neuen Ort')
			assert.deepEqual(stand.listeA, ['neu'], 'A-Patch liest die alte Rolle statt der neuen')
			assert.deepEqual(stand.listeB, ['neu'], 'B-Patch liest die alte Rolle statt der neuen')
		}

		// Fall 4: DSH_ROLLEN_DIR gesetzt — die Umgebungsvariable gewinnt gegen beide Ordner.
		const mitUmgebung = join(werkstatt, 'umgebung-rollen')
		mkdirSync(mitUmgebung, { recursive: true })
		writeFileSync(join(mitUmgebung, 'envprobe.md'), '# Rolle: envprobe\n')
		{
			const stand = frage(beide, mitUmgebung)
			assert.equal(stand.patchA, mitUmgebung, 'A-Patch laesst DSH_ROLLEN_DIR nicht gewinnen')
			assert.equal(stand.patchB, mitUmgebung, 'B-Patch laesst DSH_ROLLEN_DIR nicht gewinnen')
			assert.deepEqual(stand.listeA, ['envprobe'])
			assert.deepEqual(stand.listeB, ['envprobe'])
		}

		// Die Rollen, die mit dem Paket kamen, sind in beiden Listen wirklich lesbar.
		const paketRollen = frage(zuhause('leer', {}), join(PAKET, 'rollen'))
		// Die sechs ausgelieferten Rollen alphabetisch, wie `rollenListe()` sie liefert. Die beiden
		// zurueckgezogenen Rollen und `_ENTWURF-team-profile.md` fehlen hier absichtlich — die
		// Patches filtern Dateien mit fuehrendem Unterstrich aus (eigener Test unten).
		assert.deepEqual(paketRollen.listeA, AUSGELIEFERTE_ROLLEN, 'A-Patch liest die Paketrollen nicht')
		assert.deepEqual(paketRollen.listeB, paketRollen.listeA, 'A- und B-Patch sehen verschiedene Rollenlisten')
	} finally {
		rmSync(werkstatt, { recursive: true, force: true })
	}
})

test('link ohne Schalter ist ein Trockenlauf und legt nichts an (Abnahme 2026-10-30, B1)', () => {
	// Frueher haengte der Wrapper `--apply` an: wer `teams-plus link` tippte, um zu sehen was
	// passiert, schrieb sofort in ~/.dsh. Bei einem Befehl, der Verweise umbaut, ist das zu gefaehrlich.
	const heim = mkdtempSync(join(tmpdir(), 'teams-plus-link-dry-'))
	try {
		const lauf = starte(BIN, ['link', `--dsh-home=${heim}`])
		assert.equal(lauf.status, 0, `${lauf.stdout}${lauf.stderr}`)
		assert.match(lauf.stdout, /Trockenlauf/u, 'der Aufruf meldet keinen Trockenlauf')
		assert.ok(!existsSync(join(heim, '.tm', 'teams-plus', 'patches')), 'der Trockenlauf hat patches/ angelegt')

		// Mit --apply wird wirklich angelegt — der Schalter wirkt also noch.
		const echt = starte(BIN, ['link', '--apply', `--dsh-home=${heim}`])
		assert.equal(echt.status, 0, `${echt.stdout}${echt.stderr}`)
		assert.ok(existsSync(join(heim, '.tm', 'teams-plus', 'patches')), 'mit --apply wurde nichts angelegt')
	} finally {
		rmSync(heim, { recursive: true, force: true })
	}
})
