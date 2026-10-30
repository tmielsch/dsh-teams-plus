#!/usr/bin/env node
/**
 * link-dsh.mjs — haengt die Dateien dieses Repos als Verweise (Symlinks) in ~/.dsh ein.
 *
 * Warum: Patches, Rollen und Anweisungen der Teams liegen in EINEM Ordner (diesem Repo, SPEC A14 Punkt 3).
 * `~/.dsh` (Profil, doctor.sh, Rollen-Patch mit DSH_ROLLEN_DIR) behaelt seine Pfade, sie zeigen nur auf das Repo.
 *
 *   node scripts/link-dsh.mjs                 Trockenlauf: zeigt, was geschehen wuerde (aendert nichts)
 *   node scripts/link-dsh.mjs --apply         Verweise anlegen (Ersetzen nur, wenn die Datei im Ziel BYTE-GLEICH ist)
 *   node scripts/link-dsh.mjs --status        nur Zustand je Eintrag zeigen
 *   node scripts/link-dsh.mjs --revert        Verweise durch Kopien der Repo-Dateien ersetzen (Rueckweg)
 *   --dsh-home=<pfad>                         statt ~/.dsh (fuer Tests)
 *
 * Die Liste steht in scripts/dsh-links.json. Ein Eintrag ist entweder eine Datei oder ein ganzer Ordner.
 * Nie geloescht wird eine Datei, die vom Repo abweicht: sie wird gemeldet und bleibt liegen.
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

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

function main() {
  const args = process.argv.slice(2)
  const home = args.find((a) => a.startsWith('--dsh-home='))?.slice('--dsh-home='.length) ?? join(homedir(), '.dsh')
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
