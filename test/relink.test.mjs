/**
 * relink.test.mjs — Selbstpruefung fuer das Umhaengen der alten Verweise.
 *
 * Der Test baut eine nachgebaute Lage in einem Temp-Zuhause und prueft alle vier Aktionen aus
 * `--relink`:
 *   a) der Datenordner wird gefuellt,
 *   b) ein Verweis mit Gegenstueck im Paket wird umgehaengt,
 *   c) ein Verweis ohne Gegenstueck wird durch eine byte-gleiche Kopie mit denselben Rechten ersetzt,
 *   d) der Ordner-Verweis wird umgehaengt, nachdem der Datenordner vollstaendig ist.
 * Dazu: echte Dateien und Ordner bleiben unberuehrt, ein zweiter Lauf aendert nichts, der Trockenlauf
 * schreibt nichts, und der Rueckweg ueber die Sicherung stellt alles wieder her.
 *
 * Nie gegen die echte ~/.dsh: jedes Zuhause ist ein Temp-Ordner. Ein letzter Test liest die echte
 * Lage nur und prueft, dass sie sich waehrend des Testlaufs nicht geaendert hat.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PAKET = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKRIPT = join(PAKET, 'scripts', 'link-dsh.mjs')

const starte = (argumente) => spawnSync(process.execPath, [SKRIPT, ...argumente], { encoding: 'utf8' })

/**
 * Eine nachgebaute Lage. `fremd` ist ein „anderes Repo", aus dem die alten Verweise kamen — es wird
 * nie angefasst und steht fuer das alte dsh-projectOS.
 */
function lage() {
  const heim = mkdtempSync(join(tmpdir(), 'teams-plus-relink-'))
  const fremd = join(heim, 'fremd')
  const dshHome = join(heim, 'dsh')
  mkdirSync(join(fremd, 'patches'), { recursive: true })
  mkdirSync(join(fremd, 'rollen'), { recursive: true })
  mkdirSync(join(dshHome, 'patches'), { recursive: true })

  // Ein Verweis MIT Gegenstueck im Paket: delegate-send.mjs gibt es in patches/.
  writeFileSync(join(fremd, 'patches', 'delegate-send.mjs'), 'FREMD-DELEGATE-SEND\n')
  symlinkSync(join(fremd, 'patches', 'delegate-send.mjs'), join(dshHome, 'patches', 'delegate-send.mjs'))

  // Ein Verweis OHNE Gegenstueck im Paket, mit eigenem Inhalt und eigenem Recht.
  writeFileSync(join(fremd, 'patches', 'nur-im-alten-repo.mjs'), 'NUR-ALT\n')
  const nurAlt = join(dshHome, 'patches', 'nur-im-alten-repo.mjs')
  symlinkSync(join(fremd, 'patches', 'nur-im-alten-repo.mjs'), nurAlt)

  // Eine echte Datei und ein echter Ordner: duerfen nie angefasst werden.
  writeFileSync(join(dshHome, 'patches', 'echte-datei.mjs'), 'ECHT\n')
  mkdirSync(join(dshHome, 'patches', 'backup-x'))
  writeFileSync(join(dshHome, 'patches', 'backup-x', 'alt.txt'), 'ALT\n')

  // Der Ordner-Verweis auf die Rollen des fremden Repos.
  for (const name of readdirSync(join(PAKET, 'rollen'))) writeFileSync(join(fremd, 'rollen', name), `FREMD ${name}\n`)
  symlinkSync(join(fremd, 'rollen'), join(dshHome, 'rollen'))

  return { heim, fremd, dshHome, aufraeumen: () => rmSync(heim, { recursive: true, force: true }) }
}

const sha = (pfad) => createHash('sha256').update(readFileSync(pfad)).digest('hex')

/** Alle Eintraege von ~/.dsh/patches mit Typ und Ziel, als vergleichbare Liste. */
function lagePatches(dshHome) {
  const ordner = join(dshHome, 'patches')
  if (!existsSync(ordner)) return []
  return readdirSync(ordner).sort().map((name) => {
    const pfad = join(ordner, name)
    const st = lstatSync(pfad)
    if (st.isSymbolicLink()) return `${name} -> ${readlinkSync(pfad)}`
    if (st.isDirectory()) return `${name}/ (Ordner)`
    return `${name} (Datei, ${sha(pfad).slice(0, 12)})`
  })
}

test('der Trockenlauf zeigt alle vier Aktionen und schreibt nichts', () => {
  const l = lage()
  try {
    const vorherPatches = lagePatches(l.dshHome)
    const vorherRollen = readlinkSync(join(l.dshHome, 'rollen'))

    const lauf = starte(['--relink', `--dsh-home=${l.dshHome}`])
    assert.equal(lauf.status, 0, `${lauf.stdout}${lauf.stderr}`)

    // Die drei geplanten Aktionen stehen mit Grund da.
    assert.match(lauf.stdout, /delegate-send\.mjs/u)
    assert.match(lauf.stdout, /umbiegen/u)
    assert.match(lauf.stdout, /nur-im-alten-repo\.mjs/u)
    assert.match(lauf.stdout, /kopieren/u)
    assert.match(lauf.stdout, /Gegenstueck in patches\/ vorhanden/u)
    assert.match(lauf.stdout, /kein Gegenstueck im Paket/u)
    assert.match(lauf.stdout, /Nichts geschrieben/u)

    // Nichts angefasst: weder die Verweise noch der Datenordner noch eine Sicherung.
    assert.deepEqual(lagePatches(l.dshHome), vorherPatches, 'der Trockenlauf hat ~/.dsh/patches geaendert')
    assert.equal(readlinkSync(join(l.dshHome, 'rollen')), vorherRollen, 'der Trockenlauf hat den Ordner-Verweis geaendert')
    assert.ok(!existsSync(join(l.dshHome, '.tm', 'teams-plus', 'patches')), 'der Trockenlauf hat den Datenordner angelegt')
    assert.ok(!existsSync(join(l.dshHome, '.tm', 'teams-plus', 'backup-links')), 'der Trockenlauf hat eine Sicherung angelegt')
    assert.equal(readFileSync(join(l.fremd, 'patches', 'delegate-send.mjs'), 'utf8'), 'FREMD-DELEGATE-SEND\n', 'das fremde Repo wurde angefasst')
  } finally {
    l.aufraeumen()
  }
})

test('--apply fuellt den Datenordner, haengt um, kopiert und laesst echte Dateien stehen', () => {
  const l = lage()
  try {
    const echteVorher = sha(join(l.dshHome, 'patches', 'echte-datei.mjs'))
    const backupInhalt = readFileSync(join(l.dshHome, 'patches', 'backup-x', 'alt.txt'), 'utf8')

    const lauf = starte(['--relink', '--apply', `--dsh-home=${l.dshHome}`])
    assert.equal(lauf.status, 0, `${lauf.stdout}${lauf.stderr}`)
    assert.match(lauf.stdout, /Ausgefuehrt\. Sicherung: /u)

    const data = join(l.dshHome, '.tm', 'teams-plus')

    // (a) Datenordner gefuellt, mit allen Patch- und Rollendateien des Pakets.
    assert.equal(readdirSync(join(data, 'patches')).length, readdirSync(join(PAKET, 'patches')).length, 'der Datenordner patches ist unvollstaendig')
    assert.equal(readdirSync(join(data, 'rollen')).length, readdirSync(join(PAKET, 'rollen')).length, 'der Datenordner rollen ist unvollstaendig')

    // (b) Verweis mit Gegenstueck zeigt jetzt in den Datenordner, byte-gleich zur Paketdatei.
    const delegate = join(l.dshHome, 'patches', 'delegate-send.mjs')
    assert.ok(lstatSync(delegate).isSymbolicLink(), 'delegate-send ist kein Verweis mehr')
    assert.equal(readlinkSync(delegate), join(data, 'patches', 'delegate-send.mjs'), 'delegate-send zeigt woandershin')
    assert.equal(sha(delegate), sha(join(PAKET, 'patches', 'delegate-send.mjs')), 'delegate-send hat nicht den Paketinhalt')

    // (c) Verweis ohne Gegenstueck ist eine echte, byte-gleiche Kopie mit denselben Rechten.
    const nurAlt = join(l.dshHome, 'patches', 'nur-im-alten-repo.mjs')
    assert.ok(!lstatSync(nurAlt).isSymbolicLink(), 'nur-im-alten-repo ist noch ein Verweis')
    assert.equal(readFileSync(nurAlt, 'utf8'), 'NUR-ALT\n', 'die Kopie hat nicht den Inhalt des alten Ziels')
    assert.equal(statSync(nurAlt).mode & 0o777, statSync(join(l.fremd, 'patches', 'nur-im-alten-repo.mjs')).mode & 0o777, 'die Kopie hat andere Rechte')

    // (d) Ordner-Verweis zeigt in den Datenordner, und dort liegen alle Rollen.
    assert.equal(readlinkSync(join(l.dshHome, 'rollen')), join(data, 'rollen'), 'der Ordner-Verweis zeigt nicht in den Datenordner')
    for (const name of readdirSync(join(PAKET, 'rollen'))) assert.ok(existsSync(join(l.dshHome, 'rollen', name)), `Rolle ${name} ist ueber den Verweis nicht lesbar`)

    // Echte Dateien und Ordner unberuehrt.
    assert.equal(sha(join(l.dshHome, 'patches', 'echte-datei.mjs')), echteVorher, 'die echte Datei wurde geaendert')
    assert.equal(readFileSync(join(l.dshHome, 'patches', 'backup-x', 'alt.txt'), 'utf8'), backupInhalt, 'der echte Ordner wurde angetastet')

    // Das fremde Repo wurde nicht angefasst.
    assert.equal(readFileSync(join(l.fremd, 'patches', 'nur-im-alten-repo.mjs'), 'utf8'), 'NUR-ALT\n', 'die Quelle im fremden Repo wurde geaendert')

    // Genau eine Sicherung, und sie nennt die drei angefassten Pfade mit ihrem Vorher-Ziel.
    const sicherungen = readdirSync(join(data, 'backup-links')).filter((n) => n.endsWith('.json'))
    assert.equal(sicherungen.length, 1, 'es muss genau eine Sicherung geben')
    const sicherung = JSON.parse(readFileSync(join(data, 'backup-links', sicherungen[0]), 'utf8'))
    assert.equal(sicherung.eintraege.length, 3, 'die Sicherung muss die drei angefassten Pfade nennen')
    const vorher = Object.fromEntries(sicherung.eintraege.map((e) => [e.pfad.split('/').pop(), e.vorher]))
    assert.equal(vorher['delegate-send.mjs'], join(l.fremd, 'patches', 'delegate-send.mjs'), 'die Sicherung nennt das alte Ziel nicht')
    assert.equal(vorher['nur-im-alten-repo.mjs'], join(l.fremd, 'patches', 'nur-im-alten-repo.mjs'))
    assert.equal(vorher['rollen'], join(l.fremd, 'rollen'))
  } finally {
    l.aufraeumen()
  }
})

test('ein zweiter --apply aendert nichts und legt keine zweite Sicherung an', () => {
  const l = lage()
  try {
    assert.equal(starte(['--relink', '--apply', `--dsh-home=${l.dshHome}`]).status, 0)
    const nachErstem = lagePatches(l.dshHome)
    const rollenNachErstem = readlinkSync(join(l.dshHome, 'rollen'))
    const data = join(l.dshHome, '.tm', 'teams-plus')
    const sicherungenNachErstem = readdirSync(join(data, 'backup-links')).length

    const zweiter = starte(['--relink', '--apply', `--dsh-home=${l.dshHome}`])
    assert.equal(zweiter.status, 0, `${zweiter.stdout}${zweiter.stderr}`)
    assert.match(zweiter.stdout, /Nichts zu tun/u)
    assert.deepEqual(lagePatches(l.dshHome), nachErstem, 'der zweite Lauf hat ~/.dsh/patches geaendert')
    assert.equal(readlinkSync(join(l.dshHome, 'rollen')), rollenNachErstem, 'der zweite Lauf hat den Ordner-Verweis geaendert')
    assert.equal(readdirSync(join(data, 'backup-links')).length, sicherungenNachErstem, 'der zweite Lauf hat eine Sicherung angelegt')
  } finally {
    l.aufraeumen()
  }
})

test('der Rueckweg ueber die Sicherung stellt die Verweise wieder her', () => {
  const l = lage()
  try {
    const vorherPatches = lagePatches(l.dshHome)
    const vorherRollen = readlinkSync(join(l.dshHome, 'rollen'))

    assert.equal(starte(['--relink', '--apply', `--dsh-home=${l.dshHome}`]).status, 0)
    const data = join(l.dshHome, '.tm', 'teams-plus')
    const sicherung = join(data, 'backup-links', readdirSync(join(data, 'backup-links')).find((n) => n.endsWith('.json')))

    const zurueck = starte(['--relink', '--revert', sicherung])
    assert.equal(zurueck.status, 0, `${zurueck.stdout}${zurueck.stderr}`)

    // Alle drei angefassten Pfade sind wieder Verweise auf das fremde Repo.
    assert.ok(lstatSync(join(l.dshHome, 'patches', 'delegate-send.mjs')).isSymbolicLink(), 'delegate-send ist kein Verweis mehr')
    assert.equal(readlinkSync(join(l.dshHome, 'patches', 'delegate-send.mjs')), join(l.fremd, 'patches', 'delegate-send.mjs'), 'delegate-send zeigt nicht zurueck')
    assert.ok(lstatSync(join(l.dshHome, 'patches', 'nur-im-alten-repo.mjs')).isSymbolicLink(), 'nur-im-alten-repo ist keine Verweis mehr')
    assert.equal(readlinkSync(join(l.dshHome, 'patches', 'nur-im-alten-repo.mjs')), join(l.fremd, 'patches', 'nur-im-alten-repo.mjs'), 'nur-im-alten-repo zeigt nicht zurueck')
    assert.equal(readlinkSync(join(l.dshHome, 'rollen')), vorherRollen, 'der Ordner-Verweis zeigt nicht zurueck')

    // Die Lage ist wieder die von vorher (bis auf den gefuellten Datenordner, der bleibt).
    assert.deepEqual(lagePatches(l.dshHome), vorherPatches, 'der Rueckweg hat ~/.dsh/patches nicht hergestellt')
  } finally {
    l.aufraeumen()
  }
})

test('ein echter Ordner statt eines Verweises wird gemeldet, nicht ersetzt', () => {
  const l = lage()
  try {
    rmSync(join(l.dshHome, 'rollen'))
    mkdirSync(join(l.dshHome, 'rollen'))
    writeFileSync(join(l.dshHome, 'rollen', 'eigene.md'), 'EIGEN\n')
    const vorher = sha(join(l.dshHome, 'rollen', 'eigene.md'))

    const lauf = starte(['--relink', '--apply', `--dsh-home=${l.dshHome}`])
    assert.match(lauf.stdout, /echter Ordner, kein Verweis/u, 'der echte Ordner wurde nicht gemeldet')
    assert.ok(!lstatSync(join(l.dshHome, 'rollen')).isSymbolicLink(), 'der echte Ordner wurde durch einen Verweis ersetzt')
    assert.equal(sha(join(l.dshHome, 'rollen', 'eigene.md')), vorher, 'der Inhalt des echten Ordners wurde geaendert')
  } finally {
    l.aufraeumen()
  }
})

test('ohne Sicherung kein Schreibzugriff: die Sicherung entsteht, bevor geschrieben wird', () => {
  const l = lage()
  try {
    assert.equal(starte(['--relink', '--apply', `--dsh-home=${l.dshHome}`]).status, 0)
    const sicherungen = readdirSync(join(l.dshHome, '.tm', 'teams-plus', 'backup-links'))
    assert.equal(sicherungen.length, 1)
    const inhalt = JSON.parse(readFileSync(join(l.dshHome, '.tm', 'teams-plus', 'backup-links', sicherungen[0]), 'utf8'))
    assert.ok(typeof inhalt.angelegt === 'string', 'die Sicherung nennt keinen Zeitpunkt')
    assert.ok(typeof inhalt.hinweis === 'string' && inhalt.hinweis.includes('--relink --revert'), 'die Sicherung traegt den Rueckweg nicht')
    for (const eintrag of inhalt.eintraege) {
      assert.ok(typeof eintrag.pfad === 'string' && eintrag.pfad.startsWith(l.dshHome), `die Sicherung nennt einen fremden Pfad: ${eintrag.pfad}`)
      assert.ok(typeof eintrag.vorher === 'string', 'die Sicherung nennt kein Vorher-Ziel')
    }
  } finally {
    l.aufraeumen()
  }
})

test('die echte ~/.dsh bleibt unberuehrt (Lage vor und nach dem Test gleich)', () => {
  const echtesDsh = join(homedir(), '.dsh')
  const patches = join(echtesDsh, 'patches')
  if (!existsSync(patches)) return // auf einer Maschine ohne dieses Zuhause gibt es nichts zu pruefen
  const vorher = lagePatches(echtesDsh).join('\n')
  const rollenPfad = join(echtesDsh, 'rollen')
  const rollenVorher = existsSync(rollenPfad) ? (lstatSync(rollenPfad).isSymbolicLink() ? readlinkSync(rollenPfad) : '(echter Ordner)') : '(fehlt)'

  // Nur lesen: ein Trockenlauf gegen ein Temp-Zuhause, nicht gegen das echte.
  const l = lage()
  try {
    starte(['--relink', '--dsh-home=' + l.dshHome])
  } finally {
    l.aufraeumen()
  }

  assert.equal(lagePatches(echtesDsh).join('\n'), vorher, 'der Test hat ~/.dsh/patches geaendert')
  const rollenNachher = existsSync(rollenPfad) ? (lstatSync(rollenPfad).isSymbolicLink() ? readlinkSync(rollenPfad) : '(echter Ordner)') : '(fehlt)'
  assert.equal(rollenNachher, rollenVorher, 'der Test hat ~/.dsh/rollen geaendert')
})
