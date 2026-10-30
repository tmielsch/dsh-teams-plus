/**
 * Das Format einer Policy: ein flacher Kopfblock zwischen zwei `---`-Zeilen, darunter der
 * Prompt-Text. Eine Datei sieht so aus:
 *
 *     ---
 *     id: lokalmodus
 *     title: Lokalmodus
 *     tags: [team, sequenziell]
 *     order: 0
 *     description: Ein Team arbeitet rein sequentiell.
 *     ---
 *
 *     <Prompt-Text>
 *
 * Der Kopfblock ist absichtlich flach: Schluessel-Wert-Zeilen, eine Liste in eckigen Klammern.
 * Deshalb braucht es kein YAML-Paket, und der Mensch kann die Datei von Hand lesen und aendern.
 *
 * Dieses Modul ist REIN: kein DSH, kein Dateisystem, kein Prozess. `zerlegen` und `bauen` sind
 * zueinander invers fuer kanonische Texte (`bauen(zerlegen(text)) === text`), damit eine Datei
 * beim Speichern nicht umformatiert wird und ein Test die Verlustfreiheit belegen kann.
 */

/** Ids sind Pfad-Bausteine (`policies/<id>.md`) und deshalb auf harmlose Zeichen begrenzt. */
export const ID_MUSTER = /^[a-zA-Z0-9_-]+$/
export const MAX_ID = 80
export const MAX_TITEL = 120
export const MAX_BODY = 20000

/** Die Kopfzeile, die den Kopfblock oeffnet und schliesst. */
export const TRENNER = '---'

/** Die Schluessel des Kopfblocks, in der Reihenfolge, in der `bauen` sie schreibt. */
export const KOPF_SCHLUESSEL = ['id', 'title', 'tags', 'order', 'description'] as const

/** Eine Policy, wie sie in einer Datei steht und wie sie ueber die Leitung geht. */
export interface Policy {
  /** Pfad-Baustein: `[a-zA-Z0-9_-]+`, ohne Endung. */
  id: string
  /** Anzeigename; steht bei einer einzelnen aktiven Policy in der Prompt-Ueberschrift. */
  title: string
  /** Freie Woerter, keine feste Liste. Leer erlaubt. */
  tags: string[]
  /** Reihenfolge in der Bibliothek, Standard 0. */
  order: number
  /** Ein Satz zur Erklaerung; optional. */
  description?: string
  /** Der Prompt-Text, der in den Systemprompt geht. */
  body: string
}

/** Was `zerlegen` zurueckgibt: die Policy oder die gefundenen Fehler. */
export type Zerlegt = { ok: true; policy: Policy } | { ok: false; errors: string[] }

/** Ein Tag, wie er in der Datei steht: getrimmt, ohne Anfuehrungszeichen, ohne Leerstellen. */
export function normalisiereTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  const out: string[] = []
  for (const tag of tags) {
    if (typeof tag !== 'string') continue
    const sauber = tag.trim()
    if (sauber === '' || out.includes(sauber)) continue
    out.push(sauber)
  }
  return out
}

/** Bibliotheksreihenfolge: nach `order`, dann Titel in Code-Unit-Reihenfolge. */
export function sortierePolicies(policies: Policy[]): Policy[] {
  return [...policies].sort((a, b) => a.order - b.order || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0))
}

/** Ein Wert aus einer Kopfzeile: nur getrimmt. Anfuehrungszeichen sind hier Teil des Textes. */
function wertVon(zeile: string): string {
  return zeile.trim()
}

/**
 * Ein Eintrag einer Tag-Liste: getrimmt, und optionale Anfuehrungszeichen fallen weg, damit
 * `tags: ["Ganz genau"]` ein Tag mit Leerzeichen tragen kann.
 */
function tagWert(eintrag: string): string {
  let wert = eintrag.trim()
  if (wert.length >= 2) {
    const erste = wert[0]
    const letzte = wert[wert.length - 1]
    if ((erste === '"' || erste === "'") && letzte === erste) wert = wert.slice(1, -1).trim()
  }
  return wert
}

/** Eine Liste in eckigen Klammern: `[a, b]`, auch `[]`. Alles andere ist ein Fehler. */
function tagsVon(wert: string): { ok: true; tags: string[] } | { ok: false; error: string } {
  if (!wert.startsWith('[') || !wert.endsWith(']')) {
    return { ok: false, error: `tags muss eine Liste in eckigen Klammern sein, steht aber als "${wert}"` }
  }
  const innen = wert.slice(1, -1)
  const teile = innen.split(',').map((teil) => tagWert(teil))
  return { ok: true, tags: normalisiereTags(teile) }
}

/**
 * Pruefen einer Policy ohne Dateisystem. Gibt die Liste der Fehler zurueck; leer heisst in Ordnung.
 * Geprueft wird dasselbe, was der Zerleger prueft, damit Speichern und Lesen nicht auseinanderlaufen.
 */
export function pruefen(policy: Partial<Policy> | undefined): string[] {
  const errors: string[] = []
  if (policy === undefined || policy === null) return ['keine Policy uebergeben']
  const id = policy.id
  if (typeof id !== 'string' || id.trim() === '') errors.push('id fehlt')
  else if (!ID_MUSTER.test(id)) errors.push(`id "${id}" ist kein Pfad-Baustein (erlaubt: Buchstaben, Ziffern, _ und -)`)
  else if (id.length > MAX_ID) errors.push(`id ist zu lang (hoechstens ${MAX_ID} Zeichen)`)

  const title = policy.title
  if (typeof title !== 'string' || title.trim() === '') errors.push('title fehlt')
  else if (title.length > MAX_TITEL) errors.push(`title ist zu lang (hoechstens ${MAX_TITEL} Zeichen)`)

  if (policy.tags !== undefined && !Array.isArray(policy.tags)) errors.push('tags muss eine Liste sein')
  if (policy.order !== undefined && !Number.isInteger(policy.order)) errors.push('order muss eine Ganzzahl sein')
  if (policy.description !== undefined && typeof policy.description !== 'string') errors.push('description muss ein Text sein')

  const body = policy.body
  if (typeof body !== 'string') errors.push('body fehlt')
  else if (body.trim() === '') errors.push('body fehlt (der Prompt-Text ist leer)')
  else if (body.length > MAX_BODY) errors.push(`body ist zu lang (hoechstens ${MAX_BODY} Zeichen)`)

  // Ein Zeilenumbruch in einem Kopfwert wuerde beim naechsten Zerlegen eine neue Zeile erfinden.
  for (const [name, wert] of [['id', id], ['title', title], ['description', policy.description]] as const) {
    if (typeof wert === 'string' && /[\r\n]/.test(wert)) errors.push(`${name} darf keinen Zeilenumbruch enthalten`)
  }
  for (const tag of Array.isArray(policy.tags) ? policy.tags : []) {
    if (typeof tag !== 'string') continue
    // Komma und eckige Klammern wuerden die Liste beim naechsten Zerlegen zerschneiden.
    if (/[\r\n]/.test(tag) || tag.includes(',') || tag.includes('[') || tag.includes(']')) errors.push(`tag "${tag}" darf weder Zeilenumbruch noch Komma noch eckige Klammern enthalten`)
  }
  return errors
}

/**
 * Text -> Policy. Die erste nicht-leere Zeile muss der Trenner sein; der Kopfblock endet am
 * zweiten Trenner; alles danach ist der Body. Fehler werden gesammelt und zurueckgegeben, nie
 * geworfen: der Aufrufer meldet sie (kaputte Datei wird gemeldet, nicht ueberschrieben).
 */
export function zerlegen(text: string): Zerlegt {
  if (typeof text !== 'string') return { ok: false, errors: ['Datei ist kein Text'] }
  const zeilen = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')

  let start = 0
  while (start < zeilen.length && zeilen[start].trim() === '') start += 1
  if (start === zeilen.length) return { ok: false, errors: ['Datei ist leer'] }
  if (zeilen[start].trim() !== TRENNER) return { ok: false, errors: [`Die erste Zeile muss "${TRENNER}" sein`] }

  const ende = zeilen.findIndex((zeile, index) => index > start && zeile.trim() === TRENNER)
  if (ende < 0) return { ok: false, errors: [`Der Kopfblock wird nicht mit "${TRENNER}" geschlossen`] }

  const errors: string[] = []
  const kopf = new Map<string, string>()
  for (let i = start + 1; i < ende; i += 1) {
    const zeile = zeilen[i]
    if (zeile.trim() === '') continue
    const doppelpunkt = zeile.indexOf(':')
    if (doppelpunkt < 0) { errors.push(`Kopfzeile ohne Doppelpunkt: "${zeile.trim()}"`); continue }
    const schluessel = zeile.slice(0, doppelpunkt).trim().toLowerCase()
    const wert = zeile.slice(doppelpunkt + 1).trim()
    if (!(KOPF_SCHLUESSEL as readonly string[]).includes(schluessel)) { errors.push(`unbekannter Schluessel "${schluessel}"`); continue }
    if (kopf.has(schluessel)) { errors.push(`Schluessel "${schluessel}" steht zweimal im Kopfblock`); continue }
    kopf.set(schluessel, wert)
  }

  let tags: string[] = []
  if (kopf.has('tags')) {
    const liste = tagsVon(kopf.get('tags') as string)
    if (liste.ok) tags = liste.tags
    else errors.push(liste.error)
  }

  let order = 0
  if (kopf.has('order')) {
    const roh = kopf.get('order') as string
    if (!/^[+-]?\d+$/.test(roh)) errors.push(`order muss eine Ganzzahl sein, steht aber als "${roh}"`)
    else order = Number.parseInt(roh, 10)
  }

  const beschreibung = kopf.has('description') ? (kopf.get('description') as string) : ''
  const body = zeilen.slice(ende + 1).join('\n').replace(/^\n+/, '').replace(/\s+$/, '')

  const policy: Policy = {
    id: wertVon(kopf.get('id') ?? ''),
    title: wertVon(kopf.get('title') ?? ''),
    tags,
    order,
    ...(beschreibung === '' ? {} : { description: wertVon(beschreibung) }),
    body,
  }
  errors.push(...pruefen(policy))
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, policy }
}

/**
 * Policy -> kanonischer Text. Feste Schluesselreihenfolge, `tags:` und `order:` immer geschrieben
 * (auch leer beziehungsweise 0), `description` nur wenn gesetzt. Genau diese Form liest `zerlegen`
 * unveraendert zurueck.
 */
export function bauen(policy: Policy): string {
  const zeilen = [
    TRENNER,
    `id: ${policy.id}`,
    `title: ${policy.title}`,
    `tags: [${(policy.tags ?? []).join(', ')}]`,
    `order: ${policy.order ?? 0}`,
  ]
  if (typeof policy.description === 'string' && policy.description.trim() !== '') zeilen.push(`description: ${policy.description.trim()}`)
  zeilen.push(TRENNER)
  const body = typeof policy.body === 'string' ? policy.body.trim() : ''
  return body === '' ? `${zeilen.join('\n')}\n` : `${zeilen.join('\n')}\n\n${body}\n`
}
