#!/usr/bin/env node
/**
 * einbau.mjs — traegt das Paket in ein DSH-Profil ein und nimmt die vier alten Patch-Eintraege heraus.
 *
 * WARUM
 * Im Profil (`~/.dsh/profiles/web/cordis.patch.yml`) stehen vier Plugin-Patches als eigene Eintraege.
 * Das Paket `@tmielsch/dsh-teams-plus` bringt dieselben vier Patches mit. Wer das Paket installiert und
 * die vier Eintraege stehen laesst, laedt jeden Patch ZWEIMAL — doppelte Werkzeugregistrierung ist
 * kein Schoenheitsfehler, sondern ein Absturzrisiko. Dieses Skript nimmt die vier heraus und setzt
 * dafuer `teams-plus` ein.
 *
 * AUFRUF
 *   node scripts/einbau.mjs                        Trockenlauf (Standard): zeigt den Ist-Zustand und den Plan
 *   node scripts/einbau.mjs --apply                sichert die Datei und fuehrt den Plan aus
 *   node scripts/einbau.mjs --revert <sicherung>   legt eine Sicherung byte-gleich zurueck
 *   node scripts/einbau.mjs --file=<pfad>          eine andere Profildatei (Tests)
 *   node scripts/einbau.mjs --dsh-home=<pfad>      ein anderes Zuhause (Tests); Vorgabe ~/.dsh
 *
 * GRUNDREGEL: KEIN YAML-PARSER
 * Die Datei hat ueber 1200 Zeilen Kommentar und traegt Aenderungen, die nicht von uns stammen (Modelle,
 * Kontextfenster, Platzhalter). Ein Parser wuerde beim Ausgeben alle Kommentare verlieren und alles neu
 * formatieren. Deshalb arbeitet dieses Skript zeilenweise und fasst AUSSCHLIESSLICH die Zeilen der vier
 * Eintraege und der neuen Zeile an. Jede andere Zeile bleibt byte-gleich — das ist der wichtigste Test.
 *
 * DIE VIER ALTEN EINTRAEGE (gemessen 2026-10-30)
 *   delegate-send       id: delegate-send,       name: '../../patches/delegate-send.mjs'
 *   teammate-modell     id: teammate-modell,     name: '../../patches/teammate-model.mjs'
 *   goal-await          id: goal-await,          name: '../../patches/goal-await.mjs'  (+ config: maxWaitSeconds)
 *   stille-nachrichten  id: stille-nachrichten,  name: '../../patches/stille-nachrichten.mjs'
 * Jeder steht in einem EIGENEN `- insert:`-Block mit zweizeiligem Eintrag (goal-await zusaetzlich mit
 * einem `config:`-Block). Faellt der Eintrag weg und bleibt der leere `- insert:` stehen, ist das YAML
 * kaputt. Deshalb entfernt das Skript den Block mit, wenn der Eintrag der einzige darin war.
 *
 * Der `teammate-modell` in Zeile ~1154 ist ein ANDERER Eintrag (ein `disabled: false` ohne `name:`) und
 * bleibt selbstverstaendlich stehen — das Skript fasst nur Eintraege mit `name:` an.
 *
 * STANDORT DES NEUEN EINTRAGS
 * Er kommt an die Stelle, wo der ERSTE entfernte Eintrag stand — und das wird gegen den Zustand NACH dem
 * Entfernen gerechnet, nicht davor. Sonst verrutscht die Zeilennummer um die bereits entfernten Zeilen.
 *
 * RUECKGABE
 *   0  in Ordnung (Trockenlauf: Plan steht; --apply: hat geklappt oder war nichts zu tun)
 *   1  ein Eintrag fehlt oder steht mehrfach da; es wurde nichts geschrieben
 *   2  Aufruf- oder Dateifehler; es wurde nichts geschrieben
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Die vier alten Eintraege: id im Profil und die Datei, die das Paket stattdessen mitbringt. */
export const ALTE_EINTRAEGE = [
  { id: 'delegate-send', name: '../../patches/delegate-send.mjs' },
  { id: 'teammate-modell', name: '../../patches/teammate-model.mjs' },
  { id: 'goal-await', name: '../../patches/goal-await.mjs' },
  { id: 'stille-nachrichten', name: '../../patches/stille-nachrichten.mjs' }
]

/** Der neue Eintrag. */
export const NEUER_EINTRAG = { id: 'teams-plus', name: '@tmielsch/dsh-teams-plus' }

/** Pfad der Profildatei unter einem Zuhause. */
export function profilPfad(dshHome) {
  return join(dshHome, 'profiles', 'web', 'cordis.patch.yml')
}

const sha256 = (text) => createHash('sha256').update(text).digest('hex')

/**
 * Die Zeilen eines Eintrags finden: von `- id: <id>` bis zur letzten Zeile, die tiefer eingerueckt ist.
 * Der Eintrag steht mit vier Leerzeichen Einrueckung unter `- insert:`.
 *
 * @returns {{von: number, bis: number, nameZeile: number|undefined, blockVon: number|undefined}|undefined}
 *   `von`/`bis` sind 0-basierte Zeilenindizes, beide eingeschlossen. `blockVon` ist der Index der
 *   `- insert:`-Zeile davor, wenn der Eintrag der einzige in diesem Block ist.
 */
export function findeEintrag(zeilen, eintrag) {
  const treffer = []
  for (let i = 0; i < zeilen.length; i += 1) {
    if (!/^\s*-\s+id:\s*(.+?)\s*$/u.test(zeilen[i])) continue
    const id = zeilen[i].match(/^\s*-\s+id:\s*(.+?)\s*$/u)[1].replace(/^["']|["']$/gu, '')
    if (id !== eintrag.id) continue
    const einrueckung = zeilen[i].match(/^(\s*)/u)[1].length
    // Der Eintrag endet vor der naechsten Zeile, die nicht tiefer eingerueckt ist.
    let bis = i
    for (let j = i + 1; j < zeilen.length; j += 1) {
      const zeile = zeilen[j]
      if (zeile.trim() === '') break
      const tiefe = zeile.match(/^(\s*)/u)[1].length
      if (tiefe <= einrueckung) break
      bis = j
    }
    // Hat der Eintrag ein `name:`? Nur solche fassen wir an — der `disabled:`-Eintrag bleibt.
    let nameZeile
    for (let j = i + 1; j <= bis; j += 1) {
      if (/^\s*name:\s*/u.test(zeilen[j])) { nameZeile = j; break }
    }
    // Ein Eintrag OHNE `name:` ist nicht der Patch-Eintrag, sondern ein `disabled:`-Schalter wie
    // `- id: teammate-modell` / `disabled: false` weiter unten in der Datei. Er zaehlt hier nicht mit
    // und bleibt selbstverstaendlich stehen.
    if (nameZeile === undefined) continue
    treffer.push({ von: i, bis, nameZeile, einrueckung })
  }

  if (treffer.length === 0) return undefined
  if (treffer.length > 1) {
    // Mehrfach: das ist ein Fehler, den das Skript meldet statt zu raten.
    return { mehrfach: treffer.length, stellen: treffer }
  }
  const stelle = treffer[0]
  // Ist der Eintrag der einzige Inhalt seines `- insert:`-Blocks?
  let blockVon
  for (let i = stelle.von - 1; i >= 0; i -= 1) {
    const zeile = zeilen[i]
    if (/^\s*-\s+insert:\s*$/u.test(zeile)) { blockVon = i; break }
    if (zeile.trim() !== '' && !/^\s*#/u.test(zeile) && zeile.match(/^(\s*)/u)[1].length === 0) break
    // Eine weitere Eintragszeile auf derselben Einrueckungsebene heisst: nicht der einzige.
    if (/^\s*-\s+id:/u.test(zeile) && zeile.match(/^(\s*)/u)[1].length === stelle.einrueckung) break
  }
  return { von: stelle.von, bis: stelle.bis, nameZeile: stelle.nameZeile, blockVon }
}

/**
 * Den Ist-Zustand beschreiben: welche der vier Eintraege sind da, ist teams-plus schon drin,
 * ist das Paket installiert?
 */
export function zustand(text, dshHome) {
  const zeilen = text.split('\n')
  const gefunden = ALTE_EINTRAEGE.map((eintrag) => ({ eintrag, stelle: findeEintrag(zeilen, eintrag) }))
  const neu = findeEintrag(zeilen, NEUER_EINTRAG)
  const paketPfad = join(dshHome, 'profiles', 'web', 'node_modules', '@tmielsch', 'dsh-teams-plus')
  return {
    gefunden,
    neu: neu !== undefined && neu.mehrfach === undefined,
    paketInstalliert: existsSync(paketPfad) || existsSync(join(dshHome, 'profiles', 'web', 'node_modules', '@tmielsch', 'dsh-teams-plus', 'package.json'))
  }
}

/**
 * Den Plan bauen: die Zeilen der vier Eintraege entfernen und den neuen Eintrag an der Stelle des
 * ERSTEN entfernten Eintrags einsetzen. Gerechnet gegen den Zustand NACH dem Entfernen.
 *
 * @returns {{text: string, entfernt: {id: string, von: number, bis: number}[], eingefuegt: number, probleme: string[]}}
 *   `eingefuegt` ist die 0-basierte Zeile im NEUEN Text, an der der Eintrag steht.
 */
export function planeAenderung(text, { ziel = NEUER_EINTRAG } = {}) {
  const zeilen = text.split('\n')
  const probleme = []
  const zuEntfernen = []

  for (const eintrag of ALTE_EINTRAEGE) {
    const stelle = findeEintrag(zeilen, eintrag)
    if (stelle === undefined) { probleme.push(`${eintrag.id}: nicht gefunden`); continue }
    if (stelle.mehrfach !== undefined) { probleme.push(`${eintrag.id}: steht ${stelle.mehrfach} mal da (erwartet genau einmal)`); continue }
    if (stelle.nameZeile === undefined) { probleme.push(`${eintrag.id}: Eintrag ohne name:-Zeile — das ist nicht der erwartete Patch-Eintrag`); continue }
    zuEntfernen.push({ id: eintrag.id, von: stelle.von, bis: stelle.bis, blockVon: stelle.blockVon })
  }

  const schonDa = findeEintrag(zeilen, ziel)
  if (schonDa !== undefined && schonDa.mehrfach !== undefined) probleme.push(`${ziel.id}: steht ${schonDa.mehrfach} mal da (erwartet hoechstens einmal)`)

  // IDEMPOTENZ: sind alle vier alten Eintraege weg und steht der neue schon da, ist nichts zu tun.
  // Das ist kein Fehler, sondern der Zustand nach einem erfolgreichen Lauf. Ein Sonderfall bleibt
  // Fehler: der neue steht da, aber einer der alten auch noch — dann ist die Datei halb umgestellt.
  const alleAltenWeg = ALTE_EINTRAEGE.every((eintrag) => findeEintrag(zeilen, eintrag) === undefined)
  const neuerDa = schonDa !== undefined && schonDa.mehrfach === undefined
  if (alleAltenWeg && neuerDa) return { text, entfernt: [], eingefuegt: -1, probleme: [], schonFertig: true }
  if (neuerDa && !alleAltenWeg) probleme.push(`${ziel.id} steht schon da, aber noch nicht alle vier alten Eintraege sind weg — halb umgestellt`)

  if (probleme.length > 0) return { text, entfernt: [], eingefuegt: -1, probleme }

  // Von hinten nach vorne entfernen, damit die Indizes gueltig bleiben.
  const sortiert = [...zuEntfernen].sort((a, b) => b.von - a.von)
  const neu = [...zeilen]
  for (const { von, bis, blockVon } of sortiert) {
    // Gehoert der Block nur diesem Eintrag? Dann den Block mit entfernen, sonst bliebe ein leeres
    // `- insert:` stehen und das YAML waere kaputt.
    const blockNurDieser = blockVon !== undefined && blockHatNurDiesen(zeilen, blockVon, von)
    const ab = blockNurDieser ? blockVon : von
    // Vor dem Eintrag stehende Leerzeilen mitnehmen, damit keine Luecke bleibt.
    let ende = bis
    while (ende + 1 < neu.length && neu[ende + 1].trim() === '') ende += 1
    neu.splice(ab, ende - ab + 1)
  }

  // Die Stelle des neuen Eintrags im NEUEN Text — gerechnet gegen den Zustand NACH dem Entfernen.
  // Der Eintrag gehoert dorthin, wo der ERSTE entfernte Block anfing (`- insert:` bzw. die id-Zeile,
  // wenn der Block bleibt). Alle weiter oben entfernten Zeilen verschieben diese Stelle nach oben;
  // die weiter unten entfernten aendern nichts an ihr.
  const erster = [...zuEntfernen].sort((a, b) => a.von - b.von)[0]
  const blockNurErster = erster.blockVon !== undefined && blockHatNurDiesen(zeilen, erster.blockVon, erster.von)
  const anfangErster = blockNurErster ? erster.blockVon : erster.von
  let wegOben = 0
  for (const e of sortiert) {
    if (e.von >= erster.von) continue
    const blockNurDieser = e.blockVon !== undefined && blockHatNurDiesen(zeilen, e.blockVon, e.von)
    let ende = e.bis
    while (ende + 1 < zeilen.length && zeilen[ende + 1].trim() === '') ende += 1
    wegOben += ende - (blockNurDieser ? e.blockVon : e.von) + 1
  }
  // Der erste Block selbst wurde entfernt: seine Zeilen (samt folgender Leerzeilen) sind weg, die
  // Einfuegestelle ist sein alter Anfang minus der oben entfernten Zeilen.
  let endeErster = erster.bis
  while (endeErster + 1 < zeilen.length && zeilen[endeErster + 1].trim() === '') endeErster += 1
  void endeErster
  const zielZeile = anfangErster - wegOben

  const neuerBlock = [`- insert:`, `    - id: ${ziel.id}`, `      name: '${ziel.name}'`]
  neu.splice(zielZeile, 0, ...neuerBlock)

  return {
    text: neu.join('\n'),
    entfernt: zuEntfernen.map(({ id, von, bis }) => ({ id, von, bis })),
    eingefuegt: zielZeile,
    probleme: []
  }
}

/** Steht in dem `- insert:`-Block ab `blockVon` nur der eine Eintrag ab `eintragVon`? */
function blockHatNurDiesen(zeilen, blockVon, eintragVon) {
  for (let i = blockVon + 1; i < eintragVon; i += 1) {
    const zeile = zeilen[i]
    if (zeile.trim() === '' || /^\s*#/u.test(zeile)) continue
    return false
  }
  // Nach dem Eintrag darf im Block nichts Weiteres stehen: die naechste Zeile auf gleicher oder
  // geringerer Einrueckung beendet ihn ohnehin.
  return true
}

/** Eine Sicherung der Profildatei anlegen; gibt den Pfad zurueck. */
export function sichere(datei, dshHome) {
  const ordner = join(dshHome, '.tm', 'teams-plus', 'backup-profile')
  mkdirSync(ordner, { recursive: true })
  const stempel = new Date().toISOString().replace(/[:.]/gu, '-')
  const ziel = join(ordner, `cordis.patch.yml.${stempel}`)
  copyFileSync(datei, ziel)
  return ziel
}

/**
 * Die Zeilen, die sich zwischen zwei Fassungen unterscheiden — fuer den Trockenlauf.
 *
 * Es gibt nur Aenderungen an EINER Stelle: die vier Eintraege fallen weg (an vier Orten) und der neue
 * kommt an die Stelle des ersten. Deshalb zeigt die Vorschau genau das: die entfernten Zeilen und den
 * eingesetzten Block. Alles dazwischen ist unveraendert und wird nicht gelistet — eine allgemeine
 * Diff-Rechnung ueber die ganze Datei wuerde bei jeder Verschiebung hunderte Zeilen als „geaendert"
 * ausgeben, obwohl sie nur verrutscht sind. Die harte Pruefung macht `nurGeplanteAenderung`.
 *
 * @param {{entfernt: {id: string, von: number, bis: number}[], eingefuegt: number}} plan
 * @param {string} alt
 * @param {string} neu
 */
export function zeigeUnterschied(plan, alt, neu) {
  const a = alt.split('\n')
  const zeilen = []
  for (const { id, von, bis } of [...plan.entfernt].sort((x, y) => x.von - y.von)) {
    for (let i = von; i <= bis; i += 1) zeilen.push({ art: '-', nr: i + 1, text: a[i], grund: id })
    // Die Trennleerzeile nach dem Eintrag gehoert mit zum Entfernten.
    if (a[bis + 1] !== undefined && a[bis + 1].trim() === '') zeilen.push({ art: '-', nr: bis + 2, text: a[bis + 1], grund: 'Trennleerzeile' })
  }
  const b = neu.split('\n')
  for (let j = plan.eingefuegt; j < plan.eingefuegt + 3; j += 1) zeilen.push({ art: '+', nr: j + 1, text: b[j], grund: 'neuer Eintrag' })
  return zeilen
}

/**
 * Die harte Nachkontrolle: bleibt nach dem Ausblenden der erlaubten Zeilen irgendetwas uebrig?
 *
 * Erlaubt sind genau die Zeilen, die zum Einbau gehoeren: die `- insert:`-Zeilen, die fuenf ids, die
 * fuenf `name:`-Zeilen, der `config:`/`maxWaitSeconds`-Block von goal-await und Leerzeilen. Alles
 * andere — vor allem die fremden Modellaenderungen — muss in beiden Fassungen gleich oft dastehen.
 *
 * @returns {string[]} die Zeilen, die sich unerlaubt unterscheiden (leer heisst: alles gut)
 */
export function nurGeplanteAenderung(alt, neu) {
  const erlaubt = /^\s*-\s+insert:\s*$|^\s*-\s+id:\s+(delegate-send|teammate-modell|goal-await|stille-nachrichten|teams-plus)\s*$|^\s*name:\s*'(\.\.\/\.\.\/patches\/(delegate-send|teammate-model|goal-await|stille-nachrichten)\.mjs|@tmielsch\/dsh-teams-plus)'\s*$|^\s*config:\s*$|^\s*maxWaitSeconds:\s*900\s*$|^\s*$/u
  const zaehle = (text) => {
    const zaehler = new Map()
    for (const zeile of text.split('\n')) {
      if (erlaubt.test(zeile)) continue
      zaehler.set(zeile, (zaehler.get(zeile) ?? 0) + 1)
    }
    return zaehler
  }
  const vorher = zaehle(alt)
  const nachher = zaehle(neu)
  const probleme = []
  for (const [zeile, n] of vorher) {
    const m = nachher.get(zeile) ?? 0
    if (m !== n) probleme.push(`fehlt/zu oft: ${JSON.stringify(zeile)} (${n} -> ${m})`)
  }
  for (const [zeile, n] of nachher) {
    if (!vorher.has(zeile)) probleme.push(`neu dazugekommen: ${JSON.stringify(zeile)} (${n} mal)`)
  }
  return probleme
}

/** Die Bedienung. Gibt den Exit-Code zurueck, statt ihn zu setzen — so ist sie pruefbar. */
export function main(argv, { dshHome: standardHome } = {}) {
  const args = argv.slice(2)
  const heimArgument = args.find((a) => a.startsWith('--dsh-home='))
  const dateiArgument = args.find((a) => a.startsWith('--file='))
  const dshHome = heimArgument === undefined ? (standardHome ?? join(homedir(), '.dsh')) : heimArgument.slice('--dsh-home='.length)
  const datei = dateiArgument === undefined ? profilPfad(dshHome) : dateiArgument.slice('--file='.length)

  if (!existsSync(datei)) {
    console.error(`FEHLER: die Profildatei gibt es nicht: ${datei}`)
    return 2
  }

  const alt = readFileSync(datei, 'utf8')

  if (args.includes('--revert')) {
    const i = args.indexOf('--revert')
    const sicherung = args[i + 1]
    if (sicherung === undefined || sicherung.startsWith('--')) {
      console.error('Aufruf: --revert <sicherung>   (die Sicherung steht unter <dsh-home>/.tm/teams-plus/backup-profile/)')
      return 2
    }
    if (!existsSync(sicherung)) {
      console.error(`FEHLER: die Sicherung gibt es nicht: ${sicherung}`)
      return 2
    }
    const vorher = readFileSync(sicherung)
    writeFileSync(datei, vorher)
    mkdirSync(dirname(datei), { recursive: true })
    console.log(`Zurueckgelegt: ${datei}`)
    console.log(`  aus        ${sicherung}`)
    console.log(`  Pruefsumme ${sha256(vorher)}`)
    return 0
  }

  const stand = zustand(alt, dshHome)
  const plan = planeAenderung(alt)

  console.log(`Profil:      ${datei}`)
  console.log(`Pruefsumme:  ${sha256(alt)}`)
  console.log('')
  console.log('Die vier alten Patch-Eintraege:')
  for (const { eintrag, stelle } of stand.gefunden) {
    if (stelle === undefined) console.log(`  fehlt        ${eintrag.id}`)
    else if (stelle.mehrfach !== undefined) console.log(`  MEHRFACH     ${eintrag.id} (${stelle.mehrfach} mal)`)
    else if (stelle.nameZeile === undefined) console.log(`  ohne name:   ${eintrag.id} — nicht der erwartete Eintrag`)
    else console.log(`  da           ${eintrag.id}  Zeile ${stelle.von + 1}–${stelle.bis + 1}`)
  }
  console.log(`  ${stand.neu ? 'da' : 'fehlt'}         ${NEUER_EINTRAG.id}  (der neue Eintrag)`)
  console.log(`Paket installiert: ${stand.paketInstalliert ? 'ja' : 'nein'}  (${join(dshHome, 'profiles', 'web', 'node_modules', '@tmielsch', 'dsh-teams-plus')})`)
  console.log('')

  if (plan.schonFertig === true) {
    console.log('Nichts zu tun: die vier alten Eintraege sind weg und der neue Eintrag steht schon da.')
    return 0
  }

  if (plan.probleme.length > 0) {
    console.log('Der Plan geht nicht auf:')
    for (const problem of plan.probleme) console.log(`  - ${problem}`)
    console.log('\nEs wurde nichts geschrieben. Bitte die Profildatei ansehen und den Fall klaeren.')
    return 1
  }

  const unterschied = zeigeUnterschied(plan, alt, plan.text)
  console.log('Geplante Aenderung (nur die angefassten Stellen):')
  for (const zeile of unterschied) console.log(`  ${zeile.art} ${String(zeile.nr).padStart(5)}  ${zeile.text}`)
  const unveraendert = alt.split('\n').length - plan.entfernt.reduce((n, e) => n + (e.bis - e.von + 1) + 1, 0)
  console.log(`  (${unveraendert} weitere Zeilen bleiben unangetastet.)`)
  console.log('')
  console.log(`${plan.entfernt.length} Eintrag/Eintraege entfernt, ${NEUER_EINTRAG.id} an Zeile ${plan.eingefuegt + 1} eingesetzt.`)

  if (!args.includes('--apply')) {
    console.log(`\nTrockenlauf gegen ${datei}. Nichts geschrieben. Mit --apply ausfuehren.`)
    return 0
  }

  // Vor dem ersten Schreibzugriff sichern.
  const sicherung = sichere(datei, dshHome)
  writeFileSync(datei, plan.text)
  const nachher = readFileSync(datei, 'utf8')

  // Nachkontrolle: nur die geplanten Zeilen duerfen sich unterscheiden.
  const probleme = nurGeplanteAenderung(alt, nachher)
  const nurGeplant = probleme.length === 0
  console.log(`\nAusgefuehrt. Sicherung: ${sicherung}`)
  console.log(`  Pruefsumme vorher:   ${sha256(alt)}`)
  console.log(`  Pruefsumme nachher:  ${sha256(nachher)}`)
  if (!nurGeplant) {
    console.log('\nACHTUNG: es haben sich Zeilen geaendert, die nicht zum Plan gehoeren:')
    for (const problem of probleme.slice(0, 10)) console.log(`  - ${problem}`)
    console.log('Sicherung zuruecklegen:')
    console.log(`  node scripts/einbau.mjs --revert ${sicherung}`)
    return 1
  }
  console.log('Nachkontrolle: nur die geplanten Zeilen haben sich geaendert.')
  console.log('Jetzt `dsh web` neu starten; das trifft alle laufenden Sitzungen.')
  return 0
}

const istHauptmodul = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (istHauptmodul) process.exitCode = main(process.argv)
