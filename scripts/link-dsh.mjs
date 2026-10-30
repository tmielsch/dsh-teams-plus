#!/usr/bin/env node
/**
 * link-dsh.mjs — haengt die Dateien dieses Pakets als Verweise (Symlinks) in ~/.dsh ein.
 *
 * Warum: Patches, Rollen und Anweisungen der Teams liegen in EINEM Ordner (dieses Paket, SPEC A14 Punkt 3).
 * `~/.dsh` (Profil, doctor.sh, Rollen-Patch mit DSH_ROLLEN_DIR) behaelt seine Pfade, sie zeigen nur hierher.
 *
 * ZWEI MODI
 *
 * 1) Die eigene Ablage (§ link): patches/ und rollen/ als Verweise nach ~/.dsh/.tm/teams-plus/.
 *   node scripts/link-dsh.mjs                 Trockenlauf: zeigt, was geschehen wuerde (aendert nichts)
 *   node scripts/link-dsh.mjs --apply         Verweise anlegen (Ersetzen nur, wenn die Datei im Ziel BYTE-GLEICH ist)
 *   node scripts/link-dsh.mjs --status        nur Zustand je Eintrag zeigen
 *   node scripts/link-dsh.mjs --revert        Verweise durch Kopien der Repo-Dateien ersetzen (Rueckweg)
 *
 * 2) Das Umhaengen der ALTEN Verweise (§ relink) — fuer die Umstellung aus dsh-projectOS:
 *   node scripts/link-dsh.mjs --relink                    Trockenlauf: jede geplante Aktion mit Grund
 *   node scripts/link-dsh.mjs --relink --apply            ausfuehren (sichert vorher)
 *   node scripts/link-dsh.mjs --relink --revert <datei>   die Verweise aus einer Sicherung zurueckstellen
 *
 *   Was --relink tut, in dieser Reihenfolge:
 *     a) ~/.dsh/.tm/teams-plus/patches und .../rollen fuellen (das tut auch der einfache Modus).
 *     b) Jeden Verweis in ~/.dsh/patches, der NICHT in den Datenordner zeigt und fuer den es eine
 *        gleichnamige Datei im Paket gibt: umhaengen auf <datenordner>/patches/<name>.
 *     c) Jeden solchen Verweis OHNE Gegenstueck im Paket: durch eine ECHTE, byte-gleiche Kopie des
 *        bisherigen Ziels ersetzen (mit denselben Dateirechten). Nie loeschen, nur kopieren.
 *     d) ~/.dsh/rollen: den Ordner-Verweis auf <datenordner>/rollen umhaengen, nachdem geprueft ist,
 *        dass dort alle Dateien liegen. Ist ~/.dsh/rollen ein echter Ordner: melden, nichts tun.
 *   Echte Dateien in ~/.dsh/patches werden nie angefasst. Ein zweiter --apply aendert nichts.
 *
 *   Vor dem ersten Schreibzugriff legt --relink eine Sicherung an:
 *   ~/.dsh/.tm/teams-plus/backup-links/<zeitstempel>.json — je angefasstem Pfad, worauf er vorher zeigte.
 *
 *   --dsh-home=<pfad>                         statt ~/.dsh (fuer Tests)
 *   --data=<pfad>                             der Datenordner (Vorgabe <dsh-home>/.tm/teams-plus)
 *
 * Die Liste fuer den einfachen Modus steht in scripts/dsh-links.json.
 * Nie geloescht wird eine Datei, die vom Repo abweicht: sie wird gemeldet und bleibt liegen.
 */
import { copyFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Der Datenordner eines Zuhauses. */
export function datenOrdner(dshHome) {
  return join(dshHome, '.tm', 'teams-plus')
}

/**
 * Eine Sicherung anlegen: je angefasstem Pfad, worauf er vorher zeigte.
 * @param {string} dshHome
 * @param {{pfad: string, vorher: string|null, art: string}[]} eintraege
 * @returns {string} Pfad der Sicherungsdatei
 */
export function sichereLage(dshHome, eintraege) {
  const ordner = join(datenOrdner(dshHome), 'backup-links')
  mkdirSync(ordner, { recursive: true })
  const stempel = new Date().toISOString().replace(/[:.]/gu, '-')
  const datei = join(ordner, `${stempel}.json`)
  writeFileSync(datei, `${JSON.stringify({
    angelegt: new Date().toISOString(),
    dshHome,
    hinweis: 'Vorher-Stand der Verweise. Zurueckstellen: node scripts/link-dsh.mjs --relink --revert <diese Datei>',
    eintraege
  }, null, 2)}\n`)
  return datei
}

/**
 * Wo ein Verweis hinzeigen soll und was mit ihm geschieht.
 *
 * Aktionen:
 *   umhaengen   Verweis zeigt nicht auf den Datenordner, es gibt eine gleichnamige Datei im Paket
 *   kopieren    Verweis zeigt nicht auf den Datenordner, es gibt KEINE Datei im Paket: echte Kopie
 *   ordner      der Ordner-Verweis ~/.dsh/rollen
 *   unberuehrt  Verweis zeigt schon richtig, oder echte Datei, oder kein Verweis
 *   melden      es geht nicht (Ziel fehlt, echter Ordner statt Verweis, Quelle unlesbar)
 *
 * @returns {{aktion: string, pfad: string, von: string|null, nach: string|null, grund: string}[]}
 */
export function planeRelink(repo, dshHome) {
  const data = datenOrdner(dshHome)
  const zielPatches = join(data, 'patches')
  const zielRollen = join(data, 'rollen')
  const plan = []

  // Der Datenordner muss noch nicht existieren; dann gibt es nichts, wohin ein Verweis zeigen koennte.
  const echtesZielPatches = (() => { try { return existsSync(zielPatches) ? realpathSync(zielPatches) : null } catch { return null } })()
  const echtesZielRollen = (() => { try { return existsSync(zielRollen) ? realpathSync(zielRollen) : null } catch { return null } })()

  // (b/c) Verweise in ~/.dsh/patches
  const patchesVerzeichnis = join(dshHome, 'patches')
  const namen = existsSync(patchesVerzeichnis) ? readdirSync(patchesVerzeichnis).sort() : []
  for (const name of namen) {
    const pfad = join(patchesVerzeichnis, name)
    let st
    try { st = lstatSync(pfad) } catch { continue }

    if (!st.isSymbolicLink()) continue  // echte Datei oder Ordner: nie anfassen

    let von
    try { von = readlinkSync(pfad) } catch { von = null }
    const aufgeloest = (() => { try { return realpathSync(pfad) } catch { return null } })()
    if (aufgeloest !== null && echtesZielPatches !== null && aufgeloest.startsWith(`${echtesZielPatches}/`)) {
      plan.push({ aktion: 'unberuehrt', pfad, von, nach: null, grund: 'zeigt schon in den Datenordner' })
      continue
    }

    const quelle = join(repo, 'patches', name)
    if (existsSync(quelle)) {
      // (b) Gegenstueck vorhanden. Der Datenordner wird in Schritt (a) gefuellt, deshalb ist hier die
      // Paketquelle die Bedingung — und sie muss lesbar sein, sonst gibt es nichts zu verweisen.
      try { readFileSync(quelle) } catch { plan.push({ aktion: 'melden', pfad, von, nach: null, grund: `Paketquelle nicht lesbar: ${quelle}` }); continue }
      plan.push({ aktion: 'umhaengen', pfad, von, nach: join(zielPatches, name), grund: 'Gegenstueck in patches/ vorhanden (Schritt a legt es an)' })
      continue
    }

    // (c) kein Gegenstueck: das bisherige Ziel als echte Kopie erhalten.
    if (aufgeloest === null) {
      plan.push({ aktion: 'melden', pfad, von, nach: null, grund: 'Verweis ist tot und hat kein Gegenstueck im Paket; nichts zu kopieren' })
      continue
    }
    let lesbar = true
    try { readFileSync(aufgeloest) } catch { lesbar = false }
    if (!lesbar) {
      plan.push({ aktion: 'melden', pfad, von, nach: null, grund: `bisheriges Ziel nicht lesbar: ${aufgeloest}` })
      continue
    }
    plan.push({ aktion: 'kopieren', pfad, von, nach: aufgeloest, grund: 'kein Gegenstueck im Paket: Verweis durch byte-gleiche Kopie ersetzen' })
  }

  // (d) der Ordner-Verweis ~/.dsh/rollen
  const rollenPfad = join(dshHome, 'rollen')
  let rollenSt
  try { rollenSt = lstatSync(rollenPfad) } catch { rollenSt = null }
  if (rollenSt === null) {
    plan.push({ aktion: 'melden', pfad: rollenPfad, von: null, nach: null, grund: 'gibt es nicht' })
  } else if (!rollenSt.isSymbolicLink()) {
    plan.push({ aktion: 'melden', pfad: rollenPfad, von: null, nach: null, grund: 'ist ein echter Ordner, kein Verweis; nichts getan' })
  } else {
    const von = readlinkSync(rollenPfad)
    const soll = echtesZielRollen
    const ist = (() => { try { return realpathSync(rollenPfad) } catch { return null } })()
    if (soll !== null && ist === soll) {
      plan.push({ aktion: 'unberuehrt', pfad: rollenPfad, von, nach: null, grund: 'zeigt schon in den Datenordner' })
    } else {
      // Der Datenordner wird in Schritt (a) gefuellt. Bedingung ist deshalb: das Paket bringt die
      // Rollen mit, sonst gaebe es nichts zu verweisen.
      const paketRollen = existsSync(join(repo, 'rollen')) ? readdirSync(join(repo, 'rollen')).filter((n) => n.endsWith('.md')) : []
      if (paketRollen.length === 0) {
        plan.push({ aktion: 'melden', pfad: rollenPfad, von, nach: null, grund: 'das Paket bringt keine Rollen mit (rollen/*.md); erst klaeren' })
      } else {
        plan.push({ aktion: 'ordner', pfad: rollenPfad, von, nach: zielRollen, grund: `${paketRollen.length} Rollen im Paket, Schritt a legt sie in den Datenordner` })
      }
    }
  }

  return plan
}

/** Den Plan ausfuehren. Sichert vorher, schreibt dann. Gibt die Sicherung und die Ergebnisse zurueck. */
export function relink(repo, dshHome) {
  const plan = planeRelink(repo, dshHome)
  const zuTun = plan.filter((e) => e.aktion === 'umhaengen' || e.aktion === 'kopieren' || e.aktion === 'ordner')

  // (a) den Datenordner fuellen — das ist der bestehende Modus.
  apply(repo, dshHome)

  if (zuTun.length === 0) return { sicherung: null, plan, ergebnisse: plan.map((e) => ({ ...e, ergebnis: e.aktion })) }

  const sicherung = sichereLage(dshHome, zuTun.map((e) => ({ pfad: e.pfad, vorher: e.von, art: e.aktion })))

  const ergebnisse = []
  for (const eintrag of plan) {
    if (eintrag.aktion === 'umhaengen' || eintrag.aktion === 'ordner') {
      rmSync(eintrag.pfad, { force: true })
      symlinkSync(eintrag.nach, eintrag.pfad)
      ergebnisse.push({ ...eintrag, ergebnis: 'umgehaengt' })
      continue
    }
    if (eintrag.aktion === 'kopieren') {
      const rechte = statSync(eintrag.nach).mode & 0o777
      const temp = `${eintrag.pfad}.relink-tmp`
      copyFileSync(eintrag.nach, temp)
      chmodSync(temp, rechte)
      rmSync(eintrag.pfad, { force: true })
      renameSync(temp, eintrag.pfad)
      ergebnisse.push({ ...eintrag, ergebnis: 'kopiert' })
      continue
    }
    ergebnisse.push({ ...eintrag, ergebnis: eintrag.aktion })
  }
  return { sicherung, plan, ergebnisse }
}

/** Die Verweise aus einer Sicherung zurueckstellen. */
export function relinkZurueck(datei) {
  const data = JSON.parse(readFileSync(datei, 'utf8'))
  if (!Array.isArray(data.eintraege)) throw new Error(`${datei}: Feld "eintraege" fehlt`)
  const ergebnisse = []
  for (const eintrag of data.eintraege) {
    if (typeof eintrag.pfad !== 'string') { ergebnisse.push({ pfad: '?', ergebnis: 'uebersprungen: kein Pfad' }); continue }
    if (eintrag.vorher === null || eintrag.vorher === undefined) {
      ergebnisse.push({ pfad: eintrag.pfad, ergebnis: 'uebersprungen: kein Vorher-Wert' })
      continue
    }
    rmSync(eintrag.pfad, { force: true, recursive: true })
    symlinkSync(eintrag.vorher, eintrag.pfad)
    ergebnisse.push({ pfad: eintrag.pfad, ergebnis: `zurueck auf ${eintrag.vorher}` })
  }
  return ergebnisse
}

/** @returns {{from: string, to: string, kind?: 'dir'}[]} */
export function readManifest(repo = REPO) {
  const data = JSON.parse(readFileSync(join(repo, 'scripts', 'dsh-links.json'), 'utf8'))
  if (!Array.isArray(data.links)) throw new Error('dsh-links.json: Feld "links" fehlt')
  for (const link of data.links) {
    if (typeof link.from !== 'string' || typeof link.to !== 'string') throw new Error('dsh-links.json: Eintrag ohne from/to')
    if (link.from.includes('..') || link.to.includes('..')) throw new Error(`dsh-links.json: "..” nicht erlaubt (${link.from})`)
  }
  return data.links
}

const same = (a, b) => readFileSync(a).equals(readFileSync(b))

function filesOf(dir, base = dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (lstatSync(full).isDirectory()) out.push(...filesOf(full, base))
    else out.push(full.slice(base.length + 1))
  }
  return out
}

/**
 * Zustand eines Eintrags.
 *  linked      Verweis zeigt auf die Repo-Datei
 *  copy-same   echte Datei, byte-gleich (kann ersetzt werden)
 *  copy-diff   echte Datei, weicht ab (wird NICHT angefasst)
 *  wrong-link  Verweis zeigt woandershin (wird NICHT angefasst)
 *  missing     im Ziel nichts (kann angelegt werden)
 *  no-source   Quelle im Repo fehlt
 */
export function stateOf(repo, dshHome, link) {
  const source = join(repo, link.from)
  const target = join(dshHome, link.to)
  if (!existsSync(source)) return 'no-source'
  let st
  try { st = lstatSync(target) } catch { return 'missing' }
  if (st.isSymbolicLink()) {
    let real
    try { real = realpathSync(target) } catch { return 'wrong-link' }
    return real === realpathSync(source) ? 'linked' : 'wrong-link'
  }
  if (link.kind === 'dir') {
    if (!st.isDirectory()) return 'copy-diff'
    const mine = filesOf(source)
    const theirs = filesOf(target)
    const sameSet = mine.length === theirs.length && mine.every((f) => existsSync(join(target, f)) && same(join(source, f), join(target, f)))
    return sameSet ? 'copy-same' : 'copy-diff'
  }
  return same(source, target) ? 'copy-same' : 'copy-diff'
}

export function plan(repo, dshHome) {
  return readManifest(repo).map((link) => ({ link, state: stateOf(repo, dshHome, link) }))
}

export function apply(repo, dshHome) {
  const done = []
  for (const { link, state } of plan(repo, dshHome)) {
    const source = join(repo, link.from)
    const target = join(dshHome, link.to)
    if (state === 'missing' || state === 'copy-same') {
      mkdirSync(dirname(target), { recursive: true })
      if (state === 'copy-same') rmSync(target, { recursive: true })
      symlinkSync(source, target)
      done.push({ link, result: 'linked' })
    } else done.push({ link, result: state })
  }
  return done
}

export function revert(repo, dshHome) {
  const done = []
  for (const { link, state } of plan(repo, dshHome)) {
    const source = join(repo, link.from)
    const target = join(dshHome, link.to)
    if (state !== 'linked') { done.push({ link, result: state }); continue }
    const temp = `${target}.projectos-tmp`
    if (link.kind === 'dir') {
      mkdirSync(temp, { recursive: true })
      for (const f of filesOf(source)) { mkdirSync(dirname(join(temp, f)), { recursive: true }); copyFileSync(join(source, f), join(temp, f)) }
    } else copyFileSync(source, temp)
    rmSync(target)
    renameSync(temp, target)
    done.push({ link, result: 'copied-back' })
  }
  return done
}

const ZEICHEN = { umhaengen: 'umbiegen', kopieren: 'kopieren', ordner: 'umbiegen', unberuehrt: 'unberuehrt', melden: 'MELDEN' }

/** Den Plan als Zeilen ausgeben; gemeinsame Form fuer Trockenlauf und Ausfuehrung. */
function zeigePlan(ergebnisse) {
  const zaehler = {}
  for (const e of ergebnisse) {
    const wort = ZEICHEN[e.ergebnis] ?? ZEICHEN[e.aktion] ?? e.ergebnis
    zaehler[wort] = (zaehler[wort] ?? 0) + 1
    const nach = e.nach === null || e.nach === undefined ? '' : ` -> ${e.nach}`
    const von = e.von === null || e.von === undefined ? '' : ` (vorher: ${e.von})`
    console.log(`${(e.ergebnis ?? e.aktion).padEnd(11)} ${wort.padEnd(11)} ${basename(e.pfad)}${nach}${von}`)
    if (e.grund !== '' && e.aktion !== 'unberuehrt') console.log(`            ${e.grund}`)
  }
  console.log('')
  const teile = Object.entries(zaehler).sort().map(([wort, n]) => `${n} ${wort}`)
  console.log(`Zusammenfassung: ${teile.join(', ')}.`)
  return zaehler
}

function relinkMain(args, home) {
  const sicherungsArgument = args.find((a) => a.startsWith('--sicherung='))
  const revertDatei = sicherungsArgument !== undefined
    ? sicherungsArgument.slice('--sicherung='.length)
    : args[args.indexOf('--revert') + 1]

  if (args.includes('--revert')) {
    if (revertDatei === undefined || revertDatei.startsWith('--')) {
      console.error('Aufruf: --relink --revert <sicherung.json>   (die Sicherung steht in <datenordner>/backup-links/)')
      process.exitCode = 2
      return
    }
    if (!existsSync(revertDatei)) {
      console.error(`FEHLER: die Sicherung gibt es nicht: ${revertDatei}`)
      process.exitCode = 2
      return
    }
    for (const e of relinkZurueck(revertDatei)) console.log(`${e.ergebnis.padEnd(50)} ${basename(e.pfad)}`)
    console.log('\nZurueckgestellt. Nichts weiter geaendert.')
    return
  }

  if (!args.includes('--apply')) {
    // Trockenlauf: nur zeigen, nichts schreiben — auch den Datenordner nicht.
    const plan = planeRelink(REPO, home)
    const zaehler = zeigePlan(plan)
    console.log(`\nTrockenlauf gegen ${home}. Nichts geschrieben. Mit --apply ausfuehren.`)
    if ((zaehler.MELDEN ?? 0) > 0) process.exitCode = 1
    return
  }

  const { sicherung, ergebnisse } = relink(REPO, home)
  const zaehler = zeigePlan(ergebnisse)
  if (sicherung === null) {
    console.log('\nNichts zu tun: alle Verweise zeigen schon richtig.')
    return
  }
  console.log(`\nAusgefuehrt. Sicherung: ${sicherung}`)
  console.log(`Zurueckstellen: node scripts/link-dsh.mjs --relink --revert ${sicherung}`)
  if ((zaehler.MELDEN ?? 0) > 0) process.exitCode = 1
}

function main() {
  const args = process.argv.slice(2)
  const home = args.find((a) => a.startsWith('--dsh-home='))?.slice('--dsh-home='.length) ?? join(homedir(), '.dsh')
  if (args.includes('--relink')) { relinkMain(args, home); return }
  if (args.includes('--revert')) {
    for (const { link, result } of revert(REPO, home)) console.log(`${result.padEnd(11)} ${link.to}`)
    return
  }
  if (args.includes('--apply')) {
    let blocked = 0
    for (const { link, result } of apply(REPO, home)) {
      console.log(`${result.padEnd(11)} ${link.to}`)
      if (result !== 'linked' && result !== 'missing') blocked++
    }
    if (blocked > 0) { console.log(`\n${blocked} Eintrag/Eintraege NICHT angefasst (weichen ab oder zeigen woandershin). Erst klaeren.`); process.exitCode = 1 }
    return
  }
  const rows = plan(REPO, home)
  for (const { link, state } of rows) console.log(`${state.padEnd(11)} ${link.to}`)
  if (!args.includes('--status')) console.log('\nTrockenlauf. Mit --apply werden "copy-same" und "missing" zu Verweisen.')
  if (rows.some((r) => r.state === 'copy-diff' || r.state === 'wrong-link' || r.state === 'no-source')) process.exitCode = 1
}

if (process.argv[1] !== undefined && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) main()
