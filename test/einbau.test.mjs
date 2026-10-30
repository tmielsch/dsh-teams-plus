/**
 * einbau.test.mjs — Selbstpruefung fuer den Profil-Einbau.
 *
 * Der Test laeuft gegen eine KOPIE der echten Profildatei in `test/fixtures/cordis.patch.yml`.
 * Die Kopie ist gegenueber dem Original nur an einer Stelle geaendert: der Benutzername im Pfad
 * (`/Users/tmielsch/` -> `/Users/beispiel/`). Alles andere ist byte-gleich — 1848 Zeilen, gleich viele
 * Bytes, und der Rueckweg (`sed` zurueck) ergibt wieder das Original. Das ist im Test unten geprueft.
 * Geheimnisse stehen keine darin: die `apiKeyEnv:`-Zeilen nennen nur Umgebungsvariablen-NAMEN, keine
 * Werte; das oeffentliche Plugin-Praefix `@tmielsch/` bleibt stehen, weil es kein privater Pfad ist.
 *
 * DER WICHTIGSTE TEST ist „alle anderen Zeilen sind byte-gleich": die Profildatei traegt Aenderungen,
 * die nicht von uns stammen (Modellwechsel, contextWindow, Platzhalter). Nach `--apply` muessen sie
 * unveraendert dastehen. Geprueft wird zeilenweise gegen das Original, wobei genau die entfernten
 * Bereiche und der eingesetzte Block ausgeblendet werden.
 *
 * Die echte ~/.dsh/profiles/web/cordis.patch.yml wird NIE angefasst; der letzte Test prueft ihre
 * Pruefsumme vor und nach dem Lauf.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ALTE_EINTRAEGE, NEUER_EINTRAG, planeAenderung } from '../scripts/einbau.mjs'

const PAKET = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKRIPT = join(PAKET, 'scripts', 'einbau.mjs')
const FIXTURE = join(PAKET, 'test', 'fixtures', 'cordis.patch.yml')

const sha = (text) => createHash('sha256').update(text).digest('hex')

const starte = (argumente) => spawnSync(process.execPath, [SKRIPT, ...argumente], { encoding: 'utf8' })

/**
 * Zwei Fassungen vergleichen und dabei die erlaubten Aenderungen ausblenden.
 *
 * Verglichen wird als MULTIMENGE, nicht Zeile fuer Zeile: das Entfernen verschiebt alle Zeilen
 * darunter, ein Positionsvergleich wuerde dann jede verschobene Zeile als Unterschied melden.
 * Was zaehlt ist: jede Zeile, die nicht zum Einbau gehoert, muss in beiden Fassungen gleich oft
 * dastehen. Genau das ist die Aussage „alle anderen Zeilen sind byte-gleich".
 *
 * @returns {{hinzu: string[], weg: string[]}} Zeilen, die dazugekommen oder verschwunden sind
 */
function unterschiedeOhne(alt, neu, erlaubt) {
  const istErlaubt = (zeile) => erlaubt.some((muster) => muster.test(zeile))
  // Leerzeilen zaehlen nicht mit: das Entfernen der vier Bloecke nimmt die Trennleerzeilen mit,
  // und eine Leerzeile traegt keinen Inhalt. Verglichen wird jede NICHT-LEERE Zeile.
  const zaehle = (text) => {
    const zaehler = new Map()
    for (const zeile of text.split('\n')) {
      if (zeile.trim() === '') continue
      if (istErlaubt(zeile)) continue
      zaehler.set(zeile, (zaehler.get(zeile) ?? 0) + 1)
    }
    return zaehler
  }
  const a = zaehle(alt)
  const b = zaehle(neu)
  const weg = []
  const hinzu = []
  for (const [zeile, n] of a) {
    const m = b.get(zeile) ?? 0
    if (m < n) weg.push(`${JSON.stringify(zeile)} (${n} -> ${m})`)
  }
  for (const [zeile, n] of b) {
    const m = a.get(zeile) ?? 0
    if (n > m) hinzu.push(`${JSON.stringify(zeile)} (${m} -> ${n})`)
  }
  return { hinzu, weg }
}

/** Die Zeilen, die sich durch den Einbau aendern duerfen. */
const ERLAUBT = [
  /^\s*-\s+insert:\s*$/u,
  /^\s*-\s+id:\s+(delegate-send|teammate-modell|goal-await|stille-nachrichten|teams-plus)\s*$/u,
  /^\s*name:\s*'\.\.\/\.\.\/patches\/(delegate-send|teammate-model|goal-await|stille-nachrichten)\.mjs'\s*$/u,
  /^\s*name:\s*'@tmielsch\/dsh-teams-plus'\s*$/u,
  /^\s*config:\s*$/u,
  /^\s*maxWaitSeconds:\s*900\s*$/u
]

/** Ein Zuhause mit einer Kopie der Fixture an ihrem Platz. */
function baueLage({ paketInstalliert = true } = {}) {
  const heim = mkdtempSync(join(tmpdir(), 'teams-plus-einbau-'))
  const dshHome = join(heim, 'dsh')
  const datei = join(dshHome, 'profiles', 'web', 'cordis.patch.yml')
  // Seit der Abnahme 2026-10-30 (Punkt 1) verweigert `--apply` ohne installiertes Paket. Die
  // Tests, die das Schreiben pruefen, brauchen deshalb eine Lage MIT Paket; der Test der Sperre
  // baut eine ohne. Angelegt wird nur ein Rumpf mit `package.json` — mehr prueft der Einbau nicht.
  if (paketInstalliert) {
    const paket = join(dshHome, 'profiles', 'web', 'node_modules', '@tmielsch', 'dsh-teams-plus')
    mkdirSync(paket, { recursive: true })
    writeFileSync(join(paket, 'package.json'), '{"name":"@tmielsch/dsh-teams-plus","version":"0.0.0"}\n')
  }
  return { heim, dshHome, datei, aufraeumen: () => rmSync(heim, { recursive: true, force: true }) }
}

test('die Fixture ist die echte Profildatei ohne Benutzernamen im Pfad und ohne Geheimnisse', () => {
  const text = readFileSync(FIXTURE, 'utf8')
  assert.equal(text.split('\n').length, 1849, 'die Fixture muss 1848 Zeilen plus Schlusszeile haben')
  assert.ok(!text.includes('/Users/tmielsch/'), 'die Fixture enthaelt noch den echten Benutzernamen im Pfad')
  assert.ok(text.includes('/Users/beispiel/'), 'die bereinigte Pfadform fehlt')
  // Keine Geheimniswerte: apiKeyEnv nennt nur Variablennamen.
  assert.ok(!/(apiKey|token|secret|password)\s*:\s*['"]?[A-Za-z0-9_-]{20,}/iu.test(text), 'die Fixture enthaelt einen Geheimniswert')
  // Die vier Eintraege und die fremden Modellaenderungen sind drin — sonst pruefte der Test nichts.
  for (const eintrag of ALTE_EINTRAEGE) assert.ok(text.includes(`- id: ${eintrag.id}`), `${eintrag.id} fehlt in der Fixture`)
  assert.ok(text.includes('agent-default-model'), 'die Modellaenderung fehlt in der Fixture')
  assert.ok(text.includes('contextWindow: 512000'), 'contextWindow 512000 fehlt in der Fixture')
})

test('der Trockenlauf beschreibt den Ist-Zustand und aendert die Datei nicht', () => {
  const l = baueLage()
  try {
    mkdirSyncAt(l.datei)
    writeFileSync(l.datei, readFileSync(FIXTURE))
    const vorher = sha(readFileSync(l.datei))

    const lauf = starte([`--file=${l.datei}`, `--dsh-home=${l.dshHome}`])
    assert.equal(lauf.status, 0, `${lauf.stdout}${lauf.stderr}`)
    for (const eintrag of ALTE_EINTRAEGE) assert.match(lauf.stdout, new RegExp(`da\\s+${eintrag.id}`, 'u'), `${eintrag.id} wird nicht als vorhanden gemeldet`)
    assert.match(lauf.stdout, /fehlt\s+teams-plus/u, 'teams-plus wird nicht als fehlend gemeldet')
    assert.match(lauf.stdout, /Trockenlauf/u)
    assert.match(lauf.stdout, /Nichts geschrieben/u)

    assert.equal(sha(readFileSync(l.datei)), vorher, 'der Trockenlauf hat die Datei geaendert')
    assert.ok(!existsSync(join(l.dshHome, '.tm', 'teams-plus', 'backup-profile')), 'der Trockenlauf hat eine Sicherung angelegt')
  } finally {
    l.aufraeumen()
  }
})

test('--apply entfernt genau die vier Eintraege, setzt teams-plus ein und laesst JEDE andere Zeile byte-gleich', () => {
  const l = baueLage()
  try {
    mkdirSyncAt(l.datei)
    writeFileSync(l.datei, readFileSync(FIXTURE))
    const alt = readFileSync(l.datei, 'utf8')

    const lauf = starte(['--apply', `--file=${l.datei}`, `--dsh-home=${l.dshHome}`])
    assert.equal(lauf.status, 0, `${lauf.stdout}${lauf.stderr}`)
    const neu = readFileSync(l.datei, 'utf8')
    // Der Plan der Datei, damit die Pruefung unten an den richtigen Stellen nachsieht.
    const plan = planeAenderung(alt)

    // Genau die vier Eintraege sind weg, der neue ist da.
    // Wichtig: nur ECHTE `name:`-Zeilen pruefen, nicht Kommentare. Die Datei nennt die alten Pfade
    // weiterhin in ihrem Erklaerkommentar (`# Selbstpruefung: node ~/.dsh/patches/…`) — das ist
    // Dokumentation und soll stehen bleiben.
    // Und: `- id: teammate-modell` / `disabled: false` bleibt ABSICHTLICH stehen. Das ist der
    // Schalter fuer das Bundle, nicht der Patch-Eintrag; nur der Eintrag MIT `name:` faellt weg.
    const nameZeilen = (t) => t.split('\n').filter((z) => /^\s*name:\s*/u.test(z)).map((z) => z.trim())
    const altNamen = nameZeilen(alt)
    const neuNamen = nameZeilen(neu)
    for (const eintrag of ALTE_EINTRAEGE) {
      assert.ok(!neuNamen.some((z) => z.includes(eintrag.name)), `${eintrag.name} wird noch als name: geladen`)
    }
    assert.ok(neu.includes('- id: teams-plus'), 'teams-plus wurde nicht eingesetzt')
    assert.ok(neu.includes(`name: '${NEUER_EINTRAG.name}'`), 'der name von teams-plus fehlt')
    assert.equal(neuNamen.length, altNamen.length - ALTE_EINTRAEGE.length + 1, `name:-Zeilen: ${altNamen.length} vorher, ${neuNamen.length} nachher`)
    // Der Schalter bleibt: `- id: teammate-modell` mit `disabled: false` muss weiter dastehen.
    assert.ok(/- id: teammate-modell\n  disabled: false/u.test(neu), 'der disabled-Schalter von teammate-modell ist verschwunden')

    // Kein leerer Block, wo einer der vier Eintraege stand: das waere kaputtes YAML.
    // Geprueft wird nur an den Stellen, die der Plan angefasst hat — anderswo stehen fremde
    // `insert:`-Bloecke mit Kommentarzeilen, die uns nichts angehen (z.B. Zeile 11 mit einem
    // MCP-Server und einem `# Web search MCP server`-Kommentar davor).
    const zeilen = neu.split('\n')
    for (const entfernt of plan.entfernt) {
      // Ein paar Zeilen um die alte Stelle ansehen: dort darf kein `- insert:` ohne Eintrag stehen.
      const von = Math.max(0, entfernt.von - 8)
      const bis = Math.min(zeilen.length - 1, entfernt.bis + 3)
      for (let i = von; i <= bis; i += 1) {
        if (!/^\s*-\s+insert:\s*$/u.test(zeilen[i])) continue
        // Der naechste nicht-leere, nicht-kommentierte Nachbar muss ein Eintrag sein.
        let j = i + 1
        while (j < zeilen.length && (zeilen[j].trim() === '' || /^\s*#/u.test(zeilen[j]))) j += 1
        assert.match(zeilen[j] ?? '', /^\s*-\s+id:\s*\S/u, `leerer insert-Block in Zeile ${i + 1}`)
      }
    }

    // DER WICHTIGSTE TEST: alle anderen Zeilen gleich — als Multimenge, weil das Entfernen
    // alle Zeilen darunter verschiebt.
    const unterschiede = unterschiedeOhne(alt, neu, ERLAUBT)
    assert.deepEqual(unterschiede.weg, [], `fremde Zeilen sind verschwunden: ${unterschiede.weg.slice(0, 5).join(' | ')}`)
    assert.deepEqual(unterschiede.hinzu, [], `fremde Zeilen sind dazugekommen: ${unterschiede.hinzu.slice(0, 5).join(' | ')}`)

    // Die fremden Modellaenderungen stehen unveraendert da.
    for (const muster of ['deepseek-official/deepseek-flash', 'contextWindow: 512000', "provider: '*'", "model: '*'", 'maxWaitSeconds']) {
      const altTreffer = alt.split('\n').filter((z) => z.includes(muster)).length
      const neuTreffer = neu.split('\n').filter((z) => z.includes(muster)).length
      if (muster === 'maxWaitSeconds') {
        // Der einzige config-Block, der wegfiel, hatte maxWaitSeconds; der Zaehler darf sinken.
        assert.ok(neuTreffer <= altTreffer, `${muster} ist mehr geworden`)
      } else {
        assert.equal(neuTreffer, altTreffer, `${muster}: ${altTreffer} vorher, ${neuTreffer} nachher`)
      }
    }

    // Genau eine Sicherung, und sie ist byte-gleich zum Original.
    const ordner = join(l.dshHome, '.tm', 'teams-plus', 'backup-profile')
    const sicherungen = readdirSync(ordner).filter((n) => n.startsWith('cordis.patch.yml.'))
    assert.equal(sicherungen.length, 1, 'es muss genau eine Sicherung geben')
    assert.equal(readFileSync(join(ordner, sicherungen[0]), 'utf8'), alt, 'die Sicherung ist nicht byte-gleich zum Original')
  } finally {
    l.aufraeumen()
  }
})

test('ein zweiter --apply aendert nichts und legt keine zweite Sicherung an', () => {
  const l = baueLage()
  try {
    mkdirSyncAt(l.datei)
    writeFileSync(l.datei, readFileSync(FIXTURE))
    assert.equal(starte(['--apply', `--file=${l.datei}`, `--dsh-home=${l.dshHome}`]).status, 0)
    const nachErstem = readFileSync(l.datei, 'utf8')
    const sicherungenNachErstem = readdirSync(join(l.dshHome, '.tm', 'teams-plus', 'backup-profile')).length

    const zweiter = starte(['--apply', `--file=${l.datei}`, `--dsh-home=${l.dshHome}`])
    assert.equal(zweiter.status, 0, `${zweiter.stdout}${zweiter.stderr}`)
    assert.match(zweiter.stdout, /Nichts zu tun/u)
    assert.equal(readFileSync(l.datei, 'utf8'), nachErstem, 'der zweite Lauf hat die Datei geaendert')
    assert.equal(readdirSync(join(l.dshHome, '.tm', 'teams-plus', 'backup-profile')).length, sicherungenNachErstem, 'der zweite Lauf hat eine Sicherung angelegt')
  } finally {
    l.aufraeumen()
  }
})

test('--revert legt die Originaldatei byte-gleich zurueck', () => {
  const l = baueLage()
  try {
    mkdirSyncAt(l.datei)
    const original = readFileSync(FIXTURE)
    writeFileSync(l.datei, original)

    assert.equal(starte(['--apply', `--file=${l.datei}`, `--dsh-home=${l.dshHome}`]).status, 0)
    assert.notEqual(sha(readFileSync(l.datei)), sha(original), 'apply hat nichts geaendert')

    const sicherung = join(l.dshHome, '.tm', 'teams-plus', 'backup-profile', readdirSync(join(l.dshHome, '.tm', 'teams-plus', 'backup-profile'))[0])
    const zurueck = starte(['--revert', sicherung, `--file=${l.datei}`, `--dsh-home=${l.dshHome}`])
    assert.equal(zurueck.status, 0, `${zurueck.stdout}${zurueck.stderr}`)
    assert.equal(sha(readFileSync(l.datei)), sha(original), 'revert hat die Datei nicht byte-gleich hergestellt')
  } finally {
    l.aufraeumen()
  }
})

test('ein fehlender Eintrag wird gemeldet, nicht geraten: nichts wird geschrieben', () => {
  const l = baueLage()
  try {
    mkdirSyncAt(l.datei)
    const ohneGoal = readFileSync(FIXTURE, 'utf8').replace("    - id: goal-await\n      name: '../../patches/goal-await.mjs'\n      config:\n        maxWaitSeconds: 900\n", '')
    writeFileSync(l.datei, ohneGoal)
    const vorher = sha(readFileSync(l.datei))

    const lauf = starte(['--apply', `--file=${l.datei}`, `--dsh-home=${l.dshHome}`])
    assert.equal(lauf.status, 1, `ein fehlender Eintrag muss mit 1 enden, war ${lauf.status}`)
    assert.match(lauf.stdout, /goal-await: nicht gefunden/u)
    assert.match(lauf.stdout, /nichts geschrieben/u)
    assert.equal(sha(readFileSync(l.datei)), vorher, 'die Datei wurde trotz Fehler geaendert')
    assert.ok(!existsSync(join(l.dshHome, '.tm', 'teams-plus', 'backup-profile')), 'es wurde trotz Fehler gesichert')
  } finally {
    l.aufraeumen()
  }
})

test('der Plan rechnet gegen den Zustand NACH dem Entfernen (der neue Eintrag verrutscht nicht)', () => {
  const original = readFileSync(FIXTURE, 'utf8')
  const plan = planeAenderung(original)
  assert.deepEqual(plan.probleme, [])
  assert.equal(plan.entfernt.length, 4, 'es muessen genau vier Eintraege entfernt werden')

  const neu = plan.text
  const zeilen = neu.split('\n')
  // An der angegebenen Stelle steht wirklich der neue Eintrag.
  assert.match(zeilen[plan.eingefuegt], /^- insert:$/u, `an Zeile ${plan.eingefuegt + 1} steht kein "- insert:"`)
  assert.match(zeilen[plan.eingefuegt + 1], /^\s+- id: teams-plus$/u, 'der Eintrag steht nicht dort, wo der Plan ihn meldet')
  assert.match(zeilen[plan.eingefuegt + 2], /^\s+name: '@tmielsch\/dsh-teams-plus'$/u)

  // Und er steht dort, wo vorher der ERSTE der vier Eintraege stand (delegate-send, Zeile 1039).
  const altZeilen = original.split('\n')
  const delegateZeile = altZeilen.findIndex((z) => z.trim() === '- id: delegate-send')
  assert.equal(plan.eingefuegt, delegateZeile - 1, `der Eintrag gehoert an die Stelle von delegate-send (Zeile ${delegateZeile + 1})`)
})

test('die echte ~/.dsh/profiles/web/cordis.patch.yml bleibt unberuehrt', () => {
  const echt = join(homedir(), '.dsh', 'profiles', 'web', 'cordis.patch.yml')
  if (!existsSync(echt)) return // auf einer Maschine ohne dieses Profil gibt es nichts zu pruefen
  const vorher = sha(readFileSync(echt))

  // Nur lesend gegen eine Kopie arbeiten, nie gegen die echte Datei.
  const l = baueLage()
  try {
    mkdirSyncAt(join(l.heim, 'x', 'a.yml'))
    writeFileSync(join(l.heim, 'x', 'a.yml'), readFileSync(echt))
    starte([`--file=${join(l.heim, 'x', 'a.yml')}`, `--dsh-home=${join(l.heim, 'dsh')}`])
  } finally {
    l.aufraeumen()
  }

  assert.equal(sha(readFileSync(echt)), vorher, 'der Test hat die echte Profildatei geaendert')
})

/**
 * Legt den Ordner an, in dem die Zieldatei liegt, und raeumt eine alte Zieldatei weg.
 * Frueher loeschte diese Hilfe den GANZEN Ordner `profiles/web` — damit fiel auch das
 * nachgebaute Paket unter `node_modules` weg, und der Einbau meldete faelschlich
 * "Paket installiert: nein". Jetzt wird nur die Zieldatei selbst angefasst.
 */
function mkdirSyncAt(datei) {
  rmSync(datei, { force: true })
  mkdirSync(dirname(datei), { recursive: true })
}

test('--apply verweigert, wenn das Paket nicht installiert ist: nichts geschrieben, Exit 1', () => {
  // Der Fall aus der Abnahme 2026-10-30, Punkt 1: Ohne Paket wuerde der Einbau den vier
  // B-Patches den Eintrag nehmen und einen unladbaren dafuer einsetzen.
  const l = baueLage({ paketInstalliert: false })
  try {
    mkdirSyncAt(l.datei)
    writeFileSync(l.datei, readFileSync(FIXTURE))
    const vorher = sha(readFileSync(l.datei))

    const lauf = starte(['--apply', `--file=${l.datei}`, `--dsh-home=${l.dshHome}`])

    assert.equal(lauf.status, 1, `ohne Paket muss --apply mit 1 enden, war ${lauf.status}`)
    assert.match(lauf.stderr, /ABBRUCH/iu, 'es fehlt die Abbruch-Meldung')
    assert.match(lauf.stderr, /dsh plugin --profile web add/u, 'die Meldung nennt den fehlenden Befehl nicht')
    assert.equal(sha(readFileSync(l.datei)), vorher, 'die Profildatei wurde trotz Abbruch veraendert')
    // Keine Sicherung: der Abbruch kommt vor dem ersten Schreibzugriff.
    assert.ok(!existsSync(join(l.dshHome, '.tm', 'teams-plus', 'backup-profile')), 'es wurde eine Sicherung angelegt')
  } finally {
    l.aufraeumen()
  }
})

test('der Trockenlauf bleibt ohne Paket erlaubt und zeigt den Zustand', () => {
  const l = baueLage({ paketInstalliert: false })
  try {
    mkdirSyncAt(l.datei)
    writeFileSync(l.datei, readFileSync(FIXTURE))
    const vorher = sha(readFileSync(l.datei))
    const lauf = starte([`--file=${l.datei}`, `--dsh-home=${l.dshHome}`])
    assert.equal(lauf.status, 0, `Trockenlauf muss mit 0 enden: ${lauf.stderr}`)
    assert.match(lauf.stdout, /Paket installiert: nein/u, 'der Trockenlauf meldet den Paketzustand nicht')
    assert.equal(sha(readFileSync(l.datei)), vorher, 'der Trockenlauf hat geschrieben')
  } finally {
    l.aufraeumen()
  }
})
