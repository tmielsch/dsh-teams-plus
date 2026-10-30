#!/usr/bin/env node
/**
 * agents-block.mjs — setzt den Anweisungstext von Teams Plus zwischen zwei Marker in eine AGENTS.md.
 *
 * Warum: `agents/teams-plus-agents.md` ist der Anweisungstext des Pakets (Namen, Titelzeile, Spalten,
 * gemeinsame Aufgaben). DSH liest aber `~/.dsh/AGENTS.md`. Dieses Skript ist der Weg dazwischen —
 * es setzt den Text als einen Block mit Anfang und Ende hinein, aktualisiert ihn und nimmt ihn zurueck.
 *
 * AUFRUF
 *   node scripts/agents-block.mjs --status               ist der Block da, und ist er aktuell?
 *   node scripts/agents-block.mjs --install              Block einsetzen oder aktualisieren (sichert vorher)
 *   node scripts/agents-block.mjs --revert               Block wieder entfernen (sichert vorher)
 *   node scripts/agents-block.mjs --target=<datei>       eine andere Datei bearbeiten (Tests)
 *   node scripts/agents-block.mjs --dsh-home=<pfad>      ein anderes Zuhause als ~/.dsh (Tests)
 *
 * STANDORT DES BLOCKS — das ist der Punkt, an dem dieses Skript von seiner Vorlage abweicht
 * Der Anweisungstext beansprucht Vorrang („Wo fruehere Anweisungen regeln, gilt dieser Abschnitt").
 * Steht in derselben Datei noch der alte PROJECTOS-Block, gehoert die neue Fassung nach OBEN: der
 * Block wird unmittelbar vor den PROJECTOS-Anfang gesetzt, der alte Block bleibt darunter stehen,
 * bis der Mensch ihn entfernt. Ist kein PROJECTOS-Block da, kommt der Block ans Ende der Datei.
 * Ein vorhandener TEAMSPLUS-Block wird an seiner Stelle aktualisiert und nie verdoppelt; liegen
 * schon zwei Bloecke da, verweigert das Skript die Arbeit, statt einen davon zu ueberschreiben.
 *
 * SICHERUNG
 * Vor jeder Aenderung wird die Zieldatei nach `<dsh-home>/.tm/teams-plus/backup-agents/` kopiert
 * (Vorgabe `~/.dsh/.tm/teams-plus/backup-agents/`). Das ist der Datenordner des Pakets, nicht das
 * Repo: `teams-plus link` legt dorthin die Verweise, und ein Paket-Update ueberschreibt ihn nie.
 *
 * RUECKGABE
 *   0  in Ordnung (--status: der Block ist aktuell; --install/--revert: hat geklappt oder war nichts zu tun)
 *   1  --status: der Block fehlt oder ist veraltet
 *   2  Aufruf- oder Markenfehler; es wurde nichts geschrieben
 *
 * Zeilenenden werden nicht angefasst. Die Ruecknahme stellt die Datei byte-gleich wieder her, wenn sie
 * mit einem Zeilenumbruch endet (der Normalfall, auch bei ~/.dsh/AGENTS.md). Eine Datei ohne
 * abschliessenden Umbruch bekommt beim Zuruecknehmen einen — anders laesst sich nicht unterscheiden,
 * ob der Umbruch zur Datei gehoerte oder zum Block.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Anfang des eigenen Blocks. Wer hier etwas aendert, muss den Menschen fragen: er steht in ~/.dsh/AGENTS.md. */
export const BEGIN = '<!-- TEAMSPLUS:ANFANG — kommt aus dsh-teams-plus (agents/teams-plus-agents.md); hier nicht ändern -->'

/** Ende des eigenen Blocks. */
export const END = '<!-- TEAMSPLUS:ENDE -->'

/** Anfang des alten Blocks aus dsh-projectOS. Er ist nur der Bezugspunkt fuer den Standort. */
export const PROJECTOS_BEGIN = '<!-- PROJECTOS:ANFANG'

/** Kennung im Dateinamen der Sicherung. */
export const SICHERUNG_NAME = 'AGENTS.md'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Den Block bauen, den das Skript in die Zieldatei setzt. */
export function baueBlock(source) {
  return `${BEGIN}\n\n${source.trimEnd()}\n\n${END}`
}

/**
 * Den eigenen Block in einem Text finden.
 *
 * @returns {{before: string, inside: string|undefined, after: string}} `before` ist alles vor dem
 *   Anfang, `inside` der Block samt Marken (ohne den Umbruch nach der Endmarke), `after` der Rest.
 * @throws {Error} wenn nur eine der beiden Marken da ist oder sie in falscher Reihenfolge stehen.
 */
export function zerlege(text) {
  const anfaenge = text.split(BEGIN).length - 1
  const enden = text.split(END).length - 1
  const a = text.indexOf(BEGIN)
  const b = text.indexOf(END)
  if (anfaenge === 0 && enden === 0) return { before: text, inside: undefined, after: '' }
  if (anfaenge > 1) throw new Error(`die Anfangsmarke steht ${anfaenge} mal da; es muesste hoechstens ein Block sein`)
  if (enden > 1) throw new Error(`die Endmarke steht ${enden} mal da; es muesste hoechstens ein Block sein`)
  if (a < 0) throw new Error('die Endmarke steht ohne Anfangsmarke da')
  if (b < a) throw new Error('die Endmarke steht vor der Anfangsmarke')
  return {
    before: text.slice(0, a),
    inside: text.slice(a, b + END.length),
    // Alle Umbrueche nach der Endmarke fallen weg: sie sind der Abstand, den das Einsetzen gesetzt
    // hat. So kann das Aktualisieren denselben Abstand neu setzen, statt ihn bei jedem Lauf zu mehren.
    after: text.slice(b + END.length).replace(/^\n+/u, '')
  }
}

/**
 * Wo der Block hingehoert, wenn er noch nicht da ist: unmittelbar vor den alten PROJECTOS-Block,
 * sonst ans Ende. Der eigene Text beansprucht Vorrang, deshalb steht er oben.
 * @returns {{stelle: number, vorAltenBlock: boolean}}
 */
export function einfuegestelle(text) {
  const stelle = text.indexOf(PROJECTOS_BEGIN)
  return stelle < 0 ? { stelle: text.length, vorAltenBlock: false } : { stelle, vorAltenBlock: true }
}

/**
 * Den neuen Text bauen: einsetzen (Block fehlt) oder an seiner Stelle ersetzen (Block veraltet).
 * @returns {string}
 */
export function setzeBlock(text, block) {
  const teile = zerlege(text)
  if (teile.inside !== undefined) {
    // Vorhandener Block: an seiner Stelle ersetzen, nie ein zweiter.
    return teile.before + block + (teile.after === '' ? '\n' : '\n\n' + teile.after)
  }
  const { stelle } = einfuegestelle(text)
  const kopf = text.slice(0, stelle).trimEnd()
  const rest = text.slice(stelle)
  // Eine leere oder neue Datei beginnt mit der Anfangsmarke, nicht mit einer Leerzeile.
  const anfang = kopf === '' ? '' : kopf + '\n\n'
  return anfang + block + (rest === '' ? '\n' : '\n\n' + rest)
}

/**
 * Den Block wieder herausnehmen und die Datei so herstellen, wie sie ohne ihn aussah.
 * @returns {string|undefined} undefined, wenn kein Block da war.
 */
export function entferneBlock(text) {
  const teile = zerlege(text)
  if (teile.inside === undefined) return undefined
  const rest = teile.after.replace(/^\n+/u, '')
  const kopf = teile.before.trimEnd()
  if (kopf === '' && rest === '') return ''
  return kopf + (rest === '' ? '\n' : '\n\n' + rest)
}

/** Zustand des Blocks in einem Text: missing, current oder outdated. */
export function zustand(text, block) {
  const { inside } = zerlege(text)
  if (inside === undefined) return 'missing'
  return inside === block ? 'current' : 'outdated'
}

/**
 * Zeilenbereich des alten PROJECTOS-Blocks, nur zur Anzeige. `undefined`, wenn keiner da ist.
 * @returns {{von: number, bis: number}|undefined}
 */
export function alterBlock(text) {
  const anfang = text.indexOf(PROJECTOS_BEGIN)
  if (anfang < 0) return undefined
  const ende = text.indexOf('<!-- PROJECTOS:ENDE -->')
  const von = text.slice(0, anfang).split('\n').length
  const bis = ende < 0 ? undefined : text.slice(0, ende).split('\n').length
  return { von, bis }
}

/** Das Datenzuhause: wo Sicherungen hingehoeren. */
export function sicherungsOrdner(dshHome) {
  return join(dshHome, '.tm', 'teams-plus', 'backup-agents')
}

/** Die Zieldatei vor der Aenderung sichern; gibt den Pfad der Sicherung zurueck. */
export function sichere(target, dshHome) {
  if (!existsSync(target)) return undefined
  const ordner = sicherungsOrdner(dshHome)
  mkdirSync(ordner, { recursive: true })
  const stempel = new Date().toISOString().replace(/[:.]/gu, '-')
  const ziel = join(ordner, `${SICHERUNG_NAME}.${stempel}`)
  copyFileSync(target, ziel)
  return ziel
}

/** Den Quelltext des Anweisungstexts lesen. */
export function liesQuelle(repo = REPO) {
  const pfad = join(repo, 'agents', 'teams-plus-agents.md')
  if (!existsSync(pfad)) throw new Error(`der Anweisungstext fehlt: ${pfad}`)
  return readFileSync(pfad, 'utf8')
}

/** Die Bedienung. Gibt den Exit-Code zurueck, statt ihn zu setzen — so ist sie pruefbar. */
export function main(argv, { repo = REPO } = {}) {
  const args = argv.slice(2)
  const zielArgument = args.find((a) => a.startsWith('--target='))
  const heimArgument = args.find((a) => a.startsWith('--dsh-home='))
  const target = zielArgument === undefined ? join(homedir(), '.dsh', 'AGENTS.md') : zielArgument.slice('--target='.length)
  const dshHome = heimArgument === undefined ? join(homedir(), '.dsh') : heimArgument.slice('--dsh-home='.length)

  let block
  try {
    block = baueBlock(liesQuelle(repo))
  } catch (fehler) {
    console.error(`FEHLER: ${fehler.message}`)
    return 2
  }

  const text = existsSync(target) ? readFileSync(target, 'utf8') : ''

  const modus = args.includes('--revert') ? 'revert'
    : args.includes('--install') ? 'install'
    : args.includes('--status') || args.length === 0 ? 'status'
    : undefined
  if (modus === undefined) {
    console.error('Aufruf: node scripts/agents-block.mjs --status | --install | --revert [--target=<datei>] [--dsh-home=<pfad>]')
    return 2
  }

  let stand
  let alt
  try {
    stand = zustand(text, block)
    alt = alterBlock(text)
  } catch (fehler) {
    // Beschaedigte Marken: nichts anfassen, sondern melden. Ein halber Block laesst sich nicht
    // sicher ersetzen, und raten wuerde die Datei zerstoeren.
    console.error(`FEHLER in ${target}: ${fehler.message}. Es wurde nichts geschrieben.`)
    console.error(`Bitte die Marken von Hand pruefen: "${BEGIN}" und "${END}".`)
    return 2
  }

  if (modus === 'status') {
    const lage = alt === undefined
      ? 'kein alter PROJECTOS-Block'
      : `alter PROJECTOS-Block vorhanden (Zeile ${alt.von}${alt.bis === undefined ? '' : ` bis ${alt.bis}`})`
    console.log(`${target}`)
    console.log(`  TEAMSPLUS-Block: ${stand === 'current' ? 'aktuell' : stand === 'missing' ? 'fehlt' : 'veraltet'}`)
    console.log(`  ${lage}`)
    if (stand === 'missing') console.log('  Naechster Schritt: --install (setzt den Block vor den alten Block)')
    else if (stand === 'outdated') console.log('  Naechster Schritt: --install (aktualisiert ihn an seiner Stelle)')
    return stand === 'current' ? 0 : 1
  }

  if (modus === 'install') {
    if (stand === 'current') {
      console.log(`bereits aktuell, nichts zu tun: ${target}`)
      return 0
    }
    const sicherung = sichere(target, dshHome)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, setzeBlock(text, block))
    const wo = stand === 'outdated' ? 'an seiner Stelle aktualisiert' : einfuegestelle(text).vorAltenBlock ? 'vor dem alten PROJECTOS-Block eingesetzt' : 'am Ende eingesetzt'
    console.log(`Block ${wo} in ${target}`)
    if (sicherung !== undefined) console.log(`Sicherung: ${sicherung}`)
    return 0
  }

  // revert
  const ohne = entferneBlock(text)
  if (ohne === undefined) {
    console.log(`kein TEAMSPLUS-Block da, nichts zu tun: ${target}`)
    return 0
  }
  const sicherung = sichere(target, dshHome)
  writeFileSync(target, ohne)
  console.log(`Block entfernt aus ${target}`)
  if (sicherung !== undefined) console.log(`Sicherung: ${sicherung}`)
  return 0
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv)
}
