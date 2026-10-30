#!/usr/bin/env node
/**
 * teams-plus — Bedienung fuer das Paket @tmielsch/dsh-teams-plus.
 *
 * In diesem Paket stecken zwei Arten von Patches:
 *
 *   A-Patches (patches/allow-*.mjs und die Helfer daneben) schreiben in die DSH-Installation
 *   unter /opt/homebrew/lib/node_modules (oder wo dsh sonst liegt). Sie gehen bei jedem
 *   DSH-Update verloren und laufen deshalb nur auf ausdruecklichen Befehl.
 *
 *   B-Patches (delegate-send, teammate-model, goal-await, stille-nachrichten, rolle-titel) sind
 *   Cordis-Plugins. Sie stehen in cordis.patch.yml, werden beim Start von DSH aus diesem Paket
 *   geladen und fassen die DSH-Dateien nicht an. Dieses Werkzeug bedient sie nicht.
 *
 * AUFRUF
 *   teams-plus status      was ist eingespielt (nur nachsehen, schreibt nichts)
 *   teams-plus apply       alle A-Patches einspielen
 *   teams-plus revert      alle A-Patches zuruecknehmen
 *   teams-plus doctor      fehlende Dateien und nicht eingespielte A-Patches melden
 *   teams-plus link        patches/ und rollen/ als Verweise nach ~/.dsh/.tm/teams-plus haengen
 *   teams-plus agents ...  den Anweisungsblock in ~/.dsh/AGENTS.md setzen (status, install, revert)
 *
 * Zusatzargumente: `status`, `apply`, `revert` und `doctor` nehmen `--ausfuehrlich` (die
 * Ausgabe der einzelnen Werkzeuge mitzeigen). `link` gibt alles weiter, was es bekommt, zum
 * Beispiel `--dsh-home=<pfad>`; so laesst es sich gegen ein anderes Zuhause pruefen, ohne
 * das echte ~/.dsh anzufassen.
 *
 * Der Ort dieses Pakets kommt aus import.meta.url (bin/teams-plus.mjs -> ein Ordner hoeher).
 * Er wird NICHT aus ~/.dsh/patches abgeleitet: die A-Patches liegen im Paket, nicht im
 * Konfigurationsordner.
 *
 * NACH apply UND revert: `dsh web` neu starten. Nach jedem DSH-Update `teams-plus doctor`
 * fragen und dann `teams-plus apply` laufen lassen.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PAKET = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PATCHES = join(PAKET, 'patches')

/**
 * Die A-Patches, gruppiert wie in der Aufgabe: je Eintrag das allow-*.mjs, das die Bedienung
 * macht (es hat --status und --revert), und die Dateien, die dazugehoeren.
 * @type {{werkzeug: string, dateien: string[], was: string}[]}
 */
const A_PATCHES = [
	{ werkzeug: 'allow-child-goal-resume.mjs', dateien: ['allow-child-goal-resume.mjs', 'child-goal-resume.mjs'], was: 'eigene Ziele in Kind-Sitzungen wieder aufnehmen' },
	{ werkzeug: 'allow-child-session-routing.mjs', dateien: ['allow-child-session-routing.mjs', 'child-session-routing.mjs'], was: 'Zustellung an lebende Kind-Sitzungen' },
	{ werkzeug: 'allow-subagent-goals.mjs', dateien: ['allow-subagent-goals.mjs', 'goals-for-subagents.mjs'], was: 'Ziele und await_goal_dependency fuer Unteragenten' },
	{ werkzeug: 'allow-subagent-model-fields.mjs', dateien: ['allow-subagent-model-fields.mjs', 'subagent-model-fields.mjs'], was: 'Modellfelder fuer Unteragenten' },
	{ werkzeug: 'allow-subagent-rolle.mjs', dateien: ['allow-subagent-rolle.mjs', 'subagent-rolle.mjs'], was: 'Rollenfeld und Rollentext fuer Unteragenten' },
	{ werkzeug: 'allow-subagent-files.mjs', dateien: ['allow-subagent-files.mjs', 'subagent-files.mjs'], was: 'Dateien an Unteragenten' },
	{ werkzeug: 'allow-member-images.mjs', dateien: ['allow-member-images.mjs', 'member-images.mjs', 'install-member-images.mjs', 'member-image-check.mjs'], was: 'Bild-Anhaenge an Teammitglieder' },
	{ werkzeug: 'allow-member-model.mjs', dateien: ['allow-member-model.mjs', 'member-model.mjs'], was: 'Modellwahl fuer Teammitglieder' }
]

/** Die A-Dateien, die im Paket liegen muessen (18 Stueck). */
const A_DATEIEN = A_PATCHES.flatMap((patch) => patch.dateien)

/** Die B-Patches aus cordis.patch.yml (5 Stueck); hier nur zur Anzeige und zur Vollstaendigkeit. */
const B_PATCHES = ['delegate-send.mjs', 'teammate-model.mjs', 'goal-await.mjs', 'stille-nachrichten.mjs', 'rolle-titel.mjs']

const AUSFUEHRLICH = process.argv.includes('--ausfuehrlich')

/** Ein Unterbefehl der allow-*.mjs aufrufen und die Ausgabe einsammeln. */
function rufeWerkzeug(werkzeug, argumente = []) {
	const pfad = join(PATCHES, werkzeug)
	if (!existsSync(pfad)) return { fehlt: true, code: null, aus: '', fehler: '' }
	const lauf = spawnSync(process.execPath, [pfad, ...argumente], { encoding: 'utf8' })
	return { fehlt: false, code: lauf.status, aus: lauf.stdout ?? '', fehler: lauf.stderr ?? '' }
}

/**
 * Stand aus der Ausgabe eines allow-*.mjs lesen. Die Werkzeuge schreiben je Stelle entweder
 * "gesperrt" (Patch nicht drin) oder "freigegeben" (Patch drin); die Mitglieder-Werkzeuge
 * schreiben "Sperre aktiv" beziehungsweise "freigegeben".
 * @returns {'eingespielt'|'nicht eingespielt'|'teilweise'|'Anker fehlt'|'unbekannt'|string}
 */
function standAus(ergebnis) {
	if (ergebnis.fehlt) return 'Datei fehlt'
	if (ergebnis.code !== 0) {
		if (ergebnis.code === 1) return 'Anker fehlt oder Installation nicht gefunden'
		return `Fehler (Exit ${ergebnis.code})`
	}
	const text = `${ergebnis.aus}\n${ergebnis.fehler}`
	const offen = (text.match(/gesperrt|Sperre aktiv/gu) ?? []).length
	const drin = (text.match(/freigegeben/gu) ?? []).length
	if (offen > 0 && drin > 0) return 'teilweise'
	if (offen > 0) return 'nicht eingespielt'
	if (drin > 0) return 'eingespielt'
	return 'unbekannt'
}

function zeigeAusfuehrlich(ergebnis) {
	const text = `${ergebnis.aus}${ergebnis.fehler}`.trimEnd()
	if (AUSFUEHRLICH && text !== '') {
		for (const zeile of text.split('\n')) console.log(`      ${zeile}`)
	}
}

function kopfzeile() {
	console.log(`Paket:  ${PAKET}`)
	console.log(`Patches: ${A_DATEIEN.length} A-Dateien in ${A_PATCHES.length} Werkzeugen, ${B_PATCHES.length} B-Patches in cordis.patch.yml`)
}

function status() {
	kopfzeile()
	console.log('')
	console.log('A-Patches (schreiben in die DSH-Installation):')
	const zaehler = { eingespielt: 0, offen: 0, sonstig: 0 }
	for (const patch of A_PATCHES) {
		const ergebnis = rufeWerkzeug(patch.werkzeug, ['--status'])
		const stand = standAus(ergebnis)
		if (stand === 'eingespielt') zaehler.eingespielt += 1
		else if (stand === 'nicht eingespielt' || stand === 'teilweise' || stand === 'Anker fehlt oder Installation nicht gefunden') zaehler.offen += 1
		else zaehler.sonstig += 1
		console.log(`  ${patch.werkzeug.padEnd(34)} ${stand.padEnd(46)} ${patch.was}`)
		zeigeAusfuehrlich(ergebnis)
	}
	console.log('')
	const teile = [`${zaehler.eingespielt} eingespielt`]
	if (zaehler.offen > 0) teile.push(`${zaehler.offen} nicht eingespielt`)
	if (zaehler.sonstig > 0) teile.push(`${zaehler.sonstig} unklar`)
	console.log(`${A_PATCHES.length} A-Patches geprueft: ${teile.join(', ')}.`)
	console.log('Nichts wurde geschrieben. Einspielen: `teams-plus apply`.')
}

function applyOderRevert(modus) {
	kopfzeile()
	console.log('')
	console.log(modus === 'revert'
		? 'A-Patches zuruecknehmen (--revert):'
		: 'A-Patches einspielen:')
	let fehler = 0
	for (const patch of A_PATCHES) {
		const ergebnis = rufeWerkzeug(patch.werkzeug, modus === 'revert' ? ['--revert'] : [])
		if (ergebnis.fehlt) {
			fehler += 1
			console.log(`  FEHLT      ${patch.werkzeug}`)
			continue
		}
		if (ergebnis.code !== 0) fehler += 1
		console.log(`  ${ergebnis.code === 0 ? 'ok        ' : 'FEHLER    '} ${patch.werkzeug}`)
		zeigeAusfuehrlich(ergebnis)
	}
	console.log('')
	if (fehler === 0) {
		console.log(modus === 'revert'
			? 'Zurueckgenommen. Jetzt `dsh web` neu starten.'
			: 'Eingespielt. Jetzt `dsh web` neu starten — der Host hat die alten Module im Speicher.')
	} else {
		console.log(`${fehler} Werkzeug(e) mit Fehler; dort wurde nichts geschrieben.`)
		process.exitCode = 1
	}
}

function doctor() {
	kopfzeile()
	const probleme = []

	console.log('')
	console.log(`Dateien im Paket (${A_DATEIEN.length} A, ${B_PATCHES.length} B):`)
	const fehlend = [...A_DATEIEN, ...B_PATCHES].filter((name) => !existsSync(join(PATCHES, name)))
	if (fehlend.length === 0) {
		console.log(`  alle ${A_DATEIEN.length + B_PATCHES.length} Dateien vorhanden`)
	} else {
		for (const name of fehlend) console.log(`  FEHLT  patches/${name}`)
		probleme.push(`${fehlend.length} Datei(en) fehlen im Paket`)
	}

	console.log('')
	console.log('Stand der A-Patches:')
	for (const patch of A_PATCHES) {
		const ergebnis = rufeWerkzeug(patch.werkzeug, ['--status'])
		const stand = standAus(ergebnis)
		const gut = stand === 'eingespielt'
		if (!gut) probleme.push(`${patch.werkzeug}: ${stand}`)
		console.log(`  ${gut ? 'ok        ' : 'nachholen '} ${patch.werkzeug.padEnd(34)} ${stand}`)
		zeigeAusfuehrlich(ergebnis)
	}

	console.log('')
	if (probleme.length === 0) {
		console.log('Alles in Ordnung: alle Dateien da, alle A-Patches eingespielt.')
		return
	}
	console.log('Zu tun:')
	for (const problem of probleme) console.log(`  - ${problem}`)
	console.log('Fehlende Dateien kommen aus dem Paket (npm install). Nicht eingespielte A-Patches:')
	console.log('`teams-plus apply`, danach `dsh web` neu starten.')
	process.exitCode = 1
}

function link(weitere) {
	const skript = join(PAKET, 'scripts', 'link-dsh.mjs')
	if (!existsSync(skript)) {
		console.log(`FEHLER: ${skript} fehlt im Paket.`)
		process.exitCode = 1
		return
	}
	// `link` haengt Verweise nach ~/.dsh/.tm/teams-plus; die Liste steht in scripts/dsh-links.json.
	const lauf = spawnSync(process.execPath, [skript, '--apply', ...weitere], { stdio: 'inherit' })
	if (lauf.status !== 0) process.exitCode = lauf.status === null ? 1 : lauf.status
}

function agents(weitere) {
	const skript = join(PAKET, 'scripts', 'agents-block.mjs')
	if (!existsSync(skript)) {
		console.log(`FEHLER: ${skript} fehlt im Paket.`)
		process.exitCode = 1
		return
	}
	const [unterbefehl, ...rest] = weitere
	const flag = unterbefehl === 'install' ? '--install'
		: unterbefehl === 'revert' ? '--revert'
		: unterbefehl === 'status' ? '--status'
		: undefined
	if (flag === undefined) {
		console.log('Aufruf: teams-plus agents status | install | revert [--target=<datei>] [--dsh-home=<pfad>]')
		console.log('')
		console.log('  agents status   ist der Anweisungsblock in ~/.dsh/AGENTS.md, und ist er aktuell?')
		console.log('  agents install  Block einsetzen oder aktualisieren (sichert vorher unter ~/.dsh/.tm/teams-plus/backup-agents/)')
		console.log('  agents revert   Block wieder entfernen')
		if (unterbefehl !== undefined) process.exitCode = 1
		return
	}
	const lauf = spawnSync(process.execPath, [skript, flag, ...rest], { stdio: 'inherit' })
	// `agents status` ist ein Bericht und endet immer mit 0; install und revert geben ihren Code weiter.
	if (flag !== '--status' && lauf.status !== 0) process.exitCode = lauf.status === null ? 1 : lauf.status
}

function hilfe() {
	console.log('teams-plus — A-Patches einspielen, Anweisungsblock setzen, nachsehen und verlinken')
	console.log('')
	console.log('  teams-plus status      was ist eingespielt (schreibt nichts)')
	console.log('  teams-plus apply       alle A-Patches einspielen, danach `dsh web` neu starten')
	console.log('  teams-plus revert      alle A-Patches zuruecknehmen, danach `dsh web` neu starten')
	console.log('  teams-plus doctor      fehlende Dateien und nicht eingespielte A-Patches melden')
	console.log('  teams-plus link        patches/ und rollen/ nach ~/.dsh/.tm/teams-plus verlinken')
	console.log('  teams-plus agents ...  den Anweisungsblock in ~/.dsh/AGENTS.md: status, install, revert')
	console.log('')
	console.log('  --ausfuehrlich         bei status, apply, revert und doctor die Ausgabe der Werkzeuge mitzeigen')
	console.log('  teams-plus link --dsh-home=<pfad>      Trockenlauf gegen ein anderes Zuhause')
	console.log('  teams-plus agents install --target=<datei>   gegen eine andere Datei (Tests)')
}

function main() {
	const [befehl, ...weitere] = process.argv.slice(2)
	switch (befehl) {
		case 'status': status(); break
		case 'apply': applyOderRevert('apply'); break
		case 'revert': applyOderRevert('revert'); break
		case 'doctor': doctor(); break
		case 'link': link(weitere); break
		case 'agents': agents(weitere); break
		case undefined:
		case 'help':
		case '--help':
		case '-h': hilfe(); break
		default:
			console.log(`Unbekannter Befehl: ${befehl}`)
			console.log('')
			hilfe()
			process.exitCode = 1
	}
}

main()
