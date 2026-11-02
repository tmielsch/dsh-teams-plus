/**
 * agents-block.test.mjs — Selbstpruefung fuer den Anweisungsblock.
 *
 * Der Test belegt, was das Skript verspricht:
 *   1. --install setzt den Block, --status meldet danach "aktuell",
 *   2. ein zweites --install aendert nichts (kein zweiter Block, keine neue Sicherung),
 *   3. der Block steht VOR einem vorhandenen PROJECTOS-Block, und der alte Block bleibt stehen,
 *   4. --revert entfernt ihn wieder byte-gleich,
 *   5. ein veralteter Block wird an seiner Stelle aktualisiert, nicht verdoppelt,
 *   6. ein beschaedigtes Markerpaar wird abgelehnt: nichts wird geschrieben, die Datei bleibt wie sie war,
 *   7. `bin/teams-plus.mjs agents ...` reicht an das Skript durch.
 *
 * Alles laeuft gegen Temp-Dateien ueber --target/--dsh-home. Die echte ~/.dsh/AGENTS.md wird nicht
 * angefasst; ein eigener Test prueft hoechstens ihre Pruefsumme, wenn sie da ist, und aendert sie nie.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PAKET = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKRIPT = join(PAKET, 'scripts', 'agents-block.mjs')
const BIN = join(PAKET, 'bin', 'teams-plus.mjs')
const QUELLE = join(PAKET, 'agents', 'teams-plus-agents.md')

const BEGIN = '<!-- TEAMSPLUS:ANFANG — kommt aus dsh-teams-plus (agents/teams-plus-agents.md); hier nicht ändern -->'
const END = '<!-- TEAMSPLUS:ENDE -->'
const ALT_ANFANG = '<!-- PROJECTOS:ANFANG — kommt aus dsh-projectOS (agents/projectos-agents.md); hier nicht ändern -->'
const ALT_ENDE = '<!-- PROJECTOS:ENDE -->'

const sha = (pfad) => createHash('sha256').update(readFileSync(pfad)).digest('hex')

/** Eine Datei, die wie ~/.dsh/AGENTS.md aussieht: oben Regeln, unten der alte PROJECTOS-Block. */
const vorlage = () => [
	'# Global agent instructions',
	'',
	'Regel eins.',
	'',
	'## Diese Maschine: Mac',
	'',
	'Pfade und Dienste.',
	'',
	ALT_ANFANG,
	'',
	'## Projekt-Manager: Namen und Aufträge (dsh-projectOS)',
	'',
	'Alter Text, der stehen bleiben soll.',
	'',
	ALT_ENDE,
	''
].join('\n')

/** Ein Zuhause und eine Zieldatei in einem Temp-Ordner. */
function werkstatt() {
	const heim = mkdtempSync(join(tmpdir(), 'teams-plus-agents-'))
	const dshHome = join(heim, 'dsh')
	const target = join(heim, 'AGENTS.md')
	return { heim, dshHome, target, aufraeumen: () => rmSync(heim, { recursive: true, force: true }) }
}

const lauf = (datei, argumente) => spawnSync(process.execPath, [datei, ...argumente], { encoding: 'utf8' })

/** Das Skript gegen die Zieldatei rufen; gibt Status, Ausgabe und die Datei danach. */
function rufe(ort, flag) {
	const ergebnis = lauf(SKRIPT, [flag, `--target=${ort.target}`, `--dsh-home=${ort.dshHome}`])
	return { ...ergebnis, text: existsSync(ort.target) ? readFileSync(ort.target, 'utf8') : '' }
}

/** Die Zahl der Sicherungen im Datenordner. */
function sicherungen(ort) {
	const ordner = join(ort.dshHome, '.tm', 'teams-plus', 'backup-agents')
	return existsSync(ordner) ? readdirSync(ordner).filter((name) => name.startsWith('AGENTS.md.')).length : 0
}

test('install setzt den Block vor den alten PROJECTOS-Block, status meldet aktuell, revert stellt byte-gleich her', () => {
	const ort = werkstatt()
	try {
		writeFileSync(ort.target, vorlage())
		const original = sha(ort.target)

		// 1) Vorher: Block fehlt, alter Block da.
		const vorher = rufe(ort, '--status')
		assert.equal(vorher.status, 1, 'status muss ohne Block mit 1 enden')
		assert.match(vorher.stdout, /TEAMSPLUS-Block: fehlt/u)
		assert.match(vorher.stdout, /alter PROJECTOS-Block vorhanden/u)
		assert.equal(sha(ort.target), original, 'status darf nichts schreiben')

		// 2) Installieren: Block da, und zwar VOR dem alten Block.
		const installiert = rufe(ort, '--install')
		assert.equal(installiert.status, 0, `${installiert.stdout}${installiert.stderr}`)
		const mitBlock = installiert.text
		assert.ok(mitBlock.includes(BEGIN), 'Anfangsmarke fehlt')
		assert.ok(mitBlock.includes(END), 'Endmarke fehlt')
		// Der Block ist seit dem Zeiger-Umbau die kurze Anweisung, nicht mehr der volle Text.
		// Sie muss die volle Fassung beim Namen nennen — sonst findet kein Agent sie je.
		assert.ok(mitBlock.includes('teams-plus-agents.voll.md'), 'der Zeiger nennt die volle Fassung nicht')
		assert.ok(mitBlock.length < 2000, 'der Block ist wieder der volle Text statt des Zeigers')
		const stelleNeu = mitBlock.indexOf(BEGIN)
		const stelleAlt = mitBlock.indexOf(ALT_ANFANG)
		assert.ok(stelleNeu >= 0 && stelleAlt >= 0, 'beide Bloecke muessen dastehen')
		assert.ok(stelleNeu < stelleAlt, 'der neue Block muss VOR dem alten stehen')
		assert.ok(mitBlock.includes('Alter Text, der stehen bleiben soll.'), 'der alte Block wurde angetastet')
		// Der alte Block bleibt vollstaendig, mit beiden Marken.
		assert.ok(mitBlock.indexOf(ALT_ENDE) > stelleAlt, 'die Endmarke des alten Blocks fehlt')
		// Genau ein Block eigenen Namens.
		assert.equal(mitBlock.split(BEGIN).length - 1, 1, 'die Anfangsmarke steht mehrfach da')
		assert.equal(mitBlock.split(END).length - 1, 1, 'die Endmarke steht mehrfach da')

		// 3) Sicherung liegt im Datenordner, nicht im Repo.
		assert.equal(sicherungen(ort), 1, 'es muss genau eine Sicherung geben')
		assert.ok(!existsSync(join(dirname(ort.target), 'patches')), 'die Sicherung darf nicht neben der Zieldatei landen')

		// 4) Status nach dem Setzen.
		const danach = rufe(ort, '--status')
		assert.equal(danach.status, 0, 'status muss mit aktuellem Block 0 liefern')
		assert.match(danach.stdout, /TEAMSPLUS-Block: aktuell/u)
		assert.match(danach.stdout, /alter PROJECTOS-Block vorhanden/u)

		// 5) Zweites --install aendert nichts und sichert nicht noch einmal.
		const zweimal = rufe(ort, '--install')
		assert.equal(zweimal.status, 0)
		assert.match(zweimal.stdout, /bereits aktuell, nichts zu tun/u)
		assert.equal(zweimal.text, mitBlock, 'das zweite install hat die Datei geaendert')
		assert.equal(sicherungen(ort), 1, 'das zweite install hat eine Sicherung angelegt')

		// 6) Zuruecknehmen: byte-gleich.
		const zurueck = rufe(ort, '--revert')
		assert.equal(zurueck.status, 0, `${zurueck.stdout}${zurueck.stderr}`)
		assert.equal(zurueck.text, vorlage(), 'die Ruecknahme hat die Datei nicht byte-gleich hergestellt')
		assert.equal(sha(ort.target), original, 'die Pruefsumme weicht nach revert ab')
		assert.equal(sicherungen(ort), 2, 'die Ruecknahme muss sichern')

		// 7) Nochmal zuruecknehmen: nichts zu tun, keine weitere Sicherung.
		const nochmal = rufe(ort, '--revert')
		assert.equal(nochmal.status, 0)
		assert.match(nochmal.stdout, /nichts zu tun/u)
		assert.equal(sicherungen(ort), 2, 'das zweite revert hat eine Sicherung angelegt')
	} finally {
		ort.aufraeumen()
	}
})

test('eine neue Datei beginnt mit der Marke, und revert laesst sie leer statt mit einer Leerzeile', () => {
	const ort = werkstatt()
	try {
		const neu = join(ort.heim, 'unterordner', 'AGENTS.md')
		assert.ok(!existsSync(neu), 'die Zieldatei darf vorher nicht da sein')
		const installiert = lauf(SKRIPT, ['--install', `--target=${neu}`, `--dsh-home=${ort.dshHome}`])
		assert.equal(installiert.status, 0, `${installiert.stdout}${installiert.stderr}`)
		const text = readFileSync(neu, 'utf8')
		assert.ok(text.startsWith(BEGIN), 'eine neue Datei muss mit der Anfangsmarke beginnen, nicht mit einer Leerzeile')
		assert.equal(lauf(SKRIPT, ['--status', `--target=${neu}`, `--dsh-home=${ort.dshHome}`]).status, 0)
		assert.equal(lauf(SKRIPT, ['--revert', `--target=${neu}`, `--dsh-home=${ort.dshHome}`]).status, 0)
		assert.equal(readFileSync(neu, 'utf8'), '', 'revert muss die Datei leer lassen, nicht mit einem Umbruch')
	} finally {
		ort.aufraeumen()
	}
})

test('ohne alten PROJECTOS-Block kommt der Block ans Ende, und revert ist wieder byte-gleich', () => {
	const ort = werkstatt()
	try {
		const ohneAlt = '# Global\n\nNur eigene Regeln.\n'
		writeFileSync(ort.target, ohneAlt)
		assert.equal(rufe(ort, '--install').status, 0)
		const mit = readFileSync(ort.target, 'utf8')
		assert.ok(mit.startsWith('# Global\n\nNur eigene Regeln.'), 'der Anfang der Datei wurde umgestellt')
		assert.ok(mit.indexOf(BEGIN) > mit.indexOf('Nur eigene Regeln.'), 'der Block gehoert ans Ende')
		assert.equal(rufe(ort, '--status').status, 0)
		assert.equal(rufe(ort, '--revert').text.trimEnd(), ohneAlt.trimEnd())
		assert.equal(sha(ort.target), createHash('sha256').update(ohneAlt).digest('hex'), 'revert nicht byte-gleich')
	} finally {
		ort.aufraeumen()
	}
})

test('ein veralteter Block wird an seiner Stelle aktualisiert, nicht verdoppelt', () => {
	const ort = werkstatt()
	try {
		writeFileSync(ort.target, vorlage())
		assert.equal(rufe(ort, '--install').status, 0)

		// Den Block kuenstlich veralten: eine Zeile im Inneren ersetzen. Der Zeiger ist kurz,
		// deshalb wird hier ein Satz aus IHM getauscht, nicht einer aus der vollen Fassung.
		const mit = readFileSync(ort.target, 'utf8')
		const veraltet = mit.replace('statt zu delegieren', 'statt zu arbeiten')
		assert.notEqual(veraltet, mit, 'die Veraltung hat nicht gegriffen')
		writeFileSync(ort.target, veraltet)

		const stand = rufe(ort, '--status')
		assert.equal(stand.status, 1, 'ein veralteter Block muss status 1 ergeben')
		assert.match(stand.stdout, /TEAMSPLUS-Block: veraltet/u)

		const repariert = rufe(ort, '--install')
		assert.equal(repariert.status, 0)
		assert.equal(repariert.text, mit, 'die Aktualisierung hat nicht die vorige Fassung hergestellt')
		assert.equal(repariert.text.split(BEGIN).length - 1, 1, 'die Aktualisierung hat einen zweiten Block angelegt')
		// Der alte PROJECTOS-Block steht weiterhin darunter.
		assert.ok(repariert.text.indexOf(ALT_ANFANG) > repariert.text.indexOf(END), 'der alte Block ist verrutscht')
	} finally {
		ort.aufraeumen()
	}
})

test('ein beschaedigtes Markerpaar wird abgelehnt, statt die Datei zu zerstoeren', () => {
	const faelle = {
		'nur Anfangsmarke': `# Global\n\n${BEGIN}\n\nText ohne Ende\n`,
		'nur Endmarke': `# Global\n\nText ohne Anfang\n\n${END}\n`,
		'Ende vor Anfang': `# Global\n\n${END}\n\n${BEGIN}\n`,
		'zwei Anfangsmarken': `# Global\n\n${BEGIN}\n\nA\n\n${END}\n\n${BEGIN}\n\nB\n\n${END}\n`
	}
	const ort = werkstatt()
	try {
		for (const [name, kaputt] of Object.entries(faelle)) {
			writeFileSync(ort.target, kaputt)
			const vorher = sha(ort.target)
			for (const flag of ['--install', '--revert', '--status']) {
				const ergebnis = rufe(ort, flag)
				assert.equal(ergebnis.status, 2, `${name}: ${flag} muss mit 2 enden, war ${ergebnis.status}\n${ergebnis.stdout}${ergebnis.stderr}`)
				assert.match(ergebnis.stderr, /FEHLER/u, `${name}: ${flag} muss einen Fehler melden`)
				assert.equal(sha(ort.target), vorher, `${name}: ${flag} hat die Datei angefasst`)
			}
			assert.equal(sicherungen(ort), 0, `${name}: eine Ablehnung darf nicht sichern (dann haette sie geschrieben)`)
		}
	} finally {
		ort.aufraeumen()
	}
})

test('bin/teams-plus.mjs agents reicht an das Skript durch', () => {
	const ort = werkstatt()
	try {
		writeFileSync(ort.target, vorlage())

		const status = lauf(BIN, ['agents', 'status', `--target=${ort.target}`, `--dsh-home=${ort.dshHome}`])
		assert.equal(status.status, 0, `agents status ist ein Bericht und muss mit 0 enden:\n${status.stdout}${status.stderr}`)
		assert.match(status.stdout, /TEAMSPLUS-Block: fehlt/u)
		assert.match(status.stdout, /alter PROJECTOS-Block vorhanden/u)

		const installiert = lauf(BIN, ['agents', 'install', `--target=${ort.target}`, `--dsh-home=${ort.dshHome}`])
		assert.equal(installiert.status, 0, `${installiert.stdout}${installiert.stderr}`)
		assert.match(installiert.stdout, /Block .* in /u)

		const danach = lauf(BIN, ['agents', 'status', `--target=${ort.target}`, `--dsh-home=${ort.dshHome}`])
		assert.equal(danach.status, 0)
		assert.match(danach.stdout, /TEAMSPLUS-Block: aktuell/u)

		const zurueck = lauf(BIN, ['agents', 'revert', `--target=${ort.target}`, `--dsh-home=${ort.dshHome}`])
		assert.equal(zurueck.status, 0, `${zurueck.stdout}${zurueck.stderr}`)
		assert.equal(readFileSync(ort.target, 'utf8'), vorlage())

		// Ein unbekannter Unterbefehl erklaert sich und endet mit 1.
		const quatsch = lauf(BIN, ['agents', 'quatsch'])
		assert.equal(quatsch.status, 1)
		assert.match(quatsch.stdout, /teams-plus agents status \| install \| revert/u)

		// Die allgemeine Hilfe nennt den neuen Befehl.
		const hilfe = lauf(BIN, ['help'])
		assert.equal(hilfe.status, 0)
		assert.match(hilfe.stdout, /teams-plus agents/u)
	} finally {
		ort.aufraeumen()
	}
})

test('die Quelle ist ein Zeiger auf die volle Fassung, die den neuen Namen traegt', () => {
	const text = readFileSync(QUELLE, 'utf8')

	// Die Quelle ist seit dem Zeiger-Umbau kurz und nennt die volle Fassung beim Namen.
	assert.ok(text.includes('teams-plus-agents.voll.md'), 'die Quelle nennt die volle Fassung nicht')
	assert.ok(text.length < 2000, 'die Quelle ist wieder der volle Text statt des Zeigers')
	assert.ok(!/projectOS|Projekt-Manager/u.test(text), 'die Quelle nennt noch den alten Namen')

	// Ein Zeiger, der ins Leere zeigt, waere schlimmer als kein Zeiger: die Datei muss es geben.
	const voll = join(dirname(QUELLE), 'teams-plus-agents.voll.md')
	assert.ok(existsSync(voll), 'die volle Fassung fehlt — der Zeiger zeigt ins Leere')
	const vollText = readFileSync(voll, 'utf8')
	assert.ok(vollText.startsWith('## Teams Plus: Namen und Aufträge (dsh-teams-plus)'), 'die volle Fassung ist nicht der Teams-Plus-Text')
	assert.ok(vollText.includes('Wo frühere Anweisungen regeln'), 'der Vorrang-Satz fehlt in der vollen Fassung')

	// Die Marke traegt denselben Namen wie der Text, sonst finden sich Block und Datei nie.
	assert.ok(BEGIN.includes('teams-plus-agents.md'), 'die Anfangsmarke nennt nicht die Datei')
	assert.ok(BEGIN.startsWith('<!-- TEAMSPLUS:ANFANG'), 'die Anfangsmarke heisst nicht TEAMSPLUS')
	assert.equal(END, '<!-- TEAMSPLUS:ENDE -->')
})

test('~/.dsh/AGENTS.md bleibt unberuehrt (Pruefsumme vor und nach dem Test gleich)', () => {
	const echt = join(homedir(), '.dsh', 'AGENTS.md')
	if (!existsSync(echt)) return // auf einer Maschine ohne dieses Zuhause gibt es nichts zu pruefen
	const vorher = sha(echt)
	const text = readFileSync(echt, 'utf8')
	const alt = text.includes(ALT_ANFANG)
	// Nur lesen: der Zustand wird gegen den echten Text bestimmt, ohne ihn zu schreiben.
	const ort = werkstatt()
	try {
		copyFileSync(echt, ort.target)
		const status = rufe(ort, '--status')
		assert.equal(status.status, text.includes(BEGIN) ? 0 : 1, 'der status gegen eine Kopie ist unstimmig')
		if (alt) assert.match(status.stdout, /alter PROJECTOS-Block vorhanden/u)
	} finally {
		ort.aufraeumen()
	}
	const nachher = sha(echt)
	assert.equal(nachher, vorher, 'dieser Test hat ~/.dsh/AGENTS.md veraendert')
	assert.equal(readFileSync(echt, 'utf8'), text, '~/.dsh/AGENTS.md hat sich waehrend des Tests geaendert')
})
