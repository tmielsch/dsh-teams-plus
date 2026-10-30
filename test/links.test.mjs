/**
 * links.test.mjs — Selbstpruefung fuer den einfachen Modus von link-dsh.mjs.
 *
 * Herkunft: dieser Test stand bis 2026-10-30 als test/links.test.mjs in dsh-projectOS und prueft
 * `scripts/link-dsh.mjs`. Das Skript wohnt jetzt in diesem Paket, also zieht der Test mit. Gegenueber
 * dem Original sind zwei Dinge anzupassen: die Fixture schreibt das Manifest nach `scripts/dsh-links.json`
 * (dort liest das Skript es), und die Ziele unter dem Zuhause sind jetzt `.tm/teams-plus/...`.
 *
 * Was er belegt: byte-gleiche Dateien werden zu Verweisen, eine abweichende Datei wird NICHT angefasst,
 * ein fehlendes Ziel wird verknuepft, ein Verweis woandershin bleibt liegen, und der Rueckweg ersetzt
 * die Verweise durch Kopien.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, lstatSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, plan, revert } from '../scripts/link-dsh.mjs'

/**
 * Ein Paket und ein Zuhause. Das Manifest liegt in `scripts/`, die Ziele in `.tm/teams-plus/` —
 * genau so, wie dieses Paket es ausliefert.
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'teams-plus-links-'))
  const repo = join(root, 'repo')
  const home = join(root, 'dsh')
  const data = join(home, '.tm', 'teams-plus')
  mkdirSync(join(repo, 'patches'), { recursive: true })
  mkdirSync(join(repo, 'rollen'), { recursive: true })
  mkdirSync(join(repo, 'scripts'), { recursive: true })
  mkdirSync(join(home, 'patches'), { recursive: true })
  mkdirSync(data, { recursive: true })
  writeFileSync(join(repo, 'patches', 'a.mjs'), 'AAA')
  writeFileSync(join(repo, 'patches', 'b.mjs'), 'BBB')
  writeFileSync(join(repo, 'rollen', 'x.md'), 'XXX')
  writeFileSync(join(repo, 'scripts', 'dsh-links.json'), JSON.stringify({ links: [
    { from: 'patches/a.mjs', to: '.tm/teams-plus/patches/a.mjs' },
    { from: 'patches/b.mjs', to: '.tm/teams-plus/patches/b.mjs' },
    { from: 'rollen', to: '.tm/teams-plus/rollen', kind: 'dir' }
  ] }))
  return { root, repo, home, data, aufraeumen: () => rmSync(root, { recursive: true, force: true }) }
}

test('byte-gleiche Dateien werden zu Verweisen, eine abweichende Datei wird NICHT angefasst', () => {
  const f = fixture()
  try {
    mkdirSync(join(f.data, 'patches'), { recursive: true })
    mkdirSync(join(f.data, 'rollen'), { recursive: true })
    writeFileSync(join(f.data, 'patches', 'a.mjs'), 'AAA')      // byte-gleich: darf ersetzt werden
    writeFileSync(join(f.data, 'patches', 'b.mjs'), 'ANDERS')   // weicht ab: bleibt liegen
    writeFileSync(join(f.data, 'rollen', 'x.md'), 'XXX')

    assert.deepEqual(plan(f.repo, f.home).map((r) => r.state), ['copy-same', 'copy-diff', 'copy-same'])
    assert.deepEqual(apply(f.repo, f.home).map((r) => r.result), ['linked', 'copy-diff', 'linked'])
    assert.ok(lstatSync(join(f.data, 'patches', 'a.mjs')).isSymbolicLink())
    assert.equal(readFileSync(join(f.data, 'patches', 'b.mjs'), 'utf8'), 'ANDERS', 'die abweichende Datei wurde angetastet')
    assert.deepEqual(plan(f.repo, f.home).map((r) => r.state), ['linked', 'copy-diff', 'linked'])
  } finally {
    f.aufraeumen()
  }
})

test('ein fehlendes Ziel wird verknuepft, ein Verweis woandershin bleibt liegen, der Rueckweg kopiert zurueck', () => {
  const f = fixture()
  try {
    mkdirSync(join(f.data, 'patches'), { recursive: true })
    // Der Zielordner fuer die Rollen fehlt ganz; a.mjs zeigt auf die falsche Datei.
    symlinkSync(join(f.repo, 'patches', 'b.mjs'), join(f.data, 'patches', 'a.mjs'))

    assert.deepEqual(apply(f.repo, f.home).map((r) => r.result), ['wrong-link', 'linked', 'linked'])
    assert.ok(lstatSync(join(f.data, 'rollen')).isSymbolicLink(), 'der fehlende Zielordner wurde nicht verknuepft')
    assert.equal(readFileSync(join(f.data, 'rollen', 'x.md'), 'utf8'), 'XXX', 'die Rolle ist durch den Verweis nicht lesbar')

    assert.deepEqual(revert(f.repo, f.home).map((r) => r.result), ['wrong-link', 'copied-back', 'copied-back'])
    assert.ok(!lstatSync(join(f.data, 'patches', 'b.mjs')).isSymbolicLink(), 'revert hat den Verweis stehen lassen')
    assert.ok(!lstatSync(join(f.data, 'rollen')).isSymbolicLink(), 'revert hat den Ordner-Verweis stehen lassen')
    assert.equal(readFileSync(join(f.data, 'rollen', 'x.md'), 'utf8'), 'XXX')
  } finally {
    f.aufraeumen()
  }
})

test('das Manifest dieses Pakets ist lesbar und zeigt in den Datenordner, nicht nach ~/.dsh/patches', () => {
  const repo = join(import.meta.dirname, '..')
  const eintraege = plan(repo, join(tmpdir(), 'teams-plus-leeres-zuhause'))
  assert.equal(eintraege.length, 2, 'das Manifest muss patches/ und rollen/ nennen')
  for (const { link } of eintraege) {
    assert.ok(link.to.startsWith('.tm/teams-plus/'), `Ziel zeigt nicht in den Datenordner: ${link.to}`)
    assert.equal(link.kind, 'dir')
  }
  assert.deepEqual(eintraege.map(({ link }) => link.from).sort(), ['patches', 'rollen'])
})
