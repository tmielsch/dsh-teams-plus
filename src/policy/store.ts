/**
 * Die Ablage der Policies: ein Ordner, drei Unterordner, Dateien, die der Mensch von Hand lesen
 * und aendern kann.
 *
 *     ~/.dsh/.tm/teams-plus/
 *       policies/<id>.md              eine Datei je Policy (Markdown mit flachem Kopfblock)
 *       workspaces/<workspaceId>.json  {"enabled":["id1","id2"]}
 *       logs/                          Protokolle
 *
 * Regeln, die hier gelten:
 *
 *  - Legt der Ordner fehlt, wird er beim ersten Zugriff angelegt (`ensure`).
 *  - Geschrieben wird ATOMAR: erst eine temporaere Datei im selben Ordner, dann umbenannt. Ein
 *    Absturz mitten im Schreiben hinterlaesst damit nie eine halbe Policy.
 *  - Eine kaputte Datei wird GEMELDET, nie ueberschrieben: Lesen liefert sie in `broken`, und ein
 *    Speichern auf denselben Namen wird abgelehnt.
 *  - Loeschen einer Policy entfernt auch ihre Aktivierungen in allen workspaces-Dateien.
 *
 * Dieses Modul kennt DSH nicht. Es kennt nur einen Wurzelordner, den ihm der Aufrufer gibt; damit
 * ist es wie `schema.ts` in node pruefbar.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ID_MUSTER, bauen, normalisiereTags, pruefen, sortierePolicies, zerlegen, type Policy } from './schema.ts'

/** Eine Datei, die nicht gelesen werden konnte. `file` ist der Dateiname ohne Ordner. */
export interface Broken {
  file: string
  errors: string[]
}

/** Die Namen, unter denen die Ordner im Datenordner liegen. */
export const POLICIES = 'policies'
export const WORKSPACES = 'workspaces'
export const LOGS = 'logs'

/** Workspace-Ids werden Dateinamen (`workspaces/<id>.json`); DSH vergibt Namen wie `ws_10`. */
const WORKSPACE_MUSTER = /^[a-zA-Z0-9_-]+$/

/** Der Datenordner dieses Pakets: `~/.dsh/.tm/teams-plus`. */
export function datenOrdner(home: string = homedir()): string {
  return join(home, '.dsh', '.tm', 'teams-plus')
}

/**
 * Der Ordner mit den mitgelieferten Startdateien (`<paket>/policies`).
 *
 * Aufgeloest wird ueber den PAKETWURZELORDNER, nicht ueber eine feste Zahl von `..`: dieses Modul
 * liegt im Quellbaum unter `src/policy/`, im gebauten Paket aber eingeebnet in `lib/index.js`.
 * Eine feste Tiefe waere fuer eine der beiden Lagen falsch — im Buendel zeigte sie einen Ordner
 * neben das Paket. Deshalb wird von der Datei aus nach oben gegangen, bis ein Ordner mit
 * `package.json` kommt; das ist die Paketwurzel, und `policies` liegt daneben.
 *
 * `von` ist der Pfad, von dem aus gesucht wird; im Betrieb `import.meta.url`. Der Parameter ist
 * da, damit ein Test die Lage des gebauten Buendels nachstellen kann, ohne es zu laden.
 */
export function startOrdner(von: string = fileURLToPath(import.meta.url)): string {
  let ordner = dirname(von)
  for (let stufe = 0; stufe < 6; stufe += 1) {
    if (existsSync(join(ordner, 'package.json'))) return join(ordner, POLICIES)
    const hoeher = dirname(ordner)
    if (hoeher === ordner) break
    ordner = hoeher
  }
  // Kein package.json gefunden (etwa eine lose Kopie): dann wie im Quellbaum drei Ebenen hoch.
  return join(dirname(dirname(dirname(von))), POLICIES)
}

export interface StoreOptionen {
  /** Der Datenordner; im Betrieb `datenOrdner()`, im Test ein temporaerer Ordner. */
  root: string
  /** Wo die mitgelieferten Startdateien liegen; im Betrieb `startOrdner()`. */
  seed?: string
}

/** Ein Laufzaehler fuer die temporaeren Namen; zusammen mit der Prozess-Id eindeutig genug. */
let zaehler = 0

/** Schreiben in eine temporaere Datei und umbenennen: entweder die ganze Datei oder keine. */
function atomarSchreiben(pfad: string, text: string): void {
  const ordner = dirname(pfad)
  mkdirSync(ordner, { recursive: true })
  zaehler += 1
  const temp = join(ordner, `.${basename(pfad)}.tmp-${process.pid}-${zaehler}`)
  writeFileSync(temp, text, 'utf8')
  try {
    renameSync(temp, pfad)
  } catch (error) {
    try { rmSync(temp, { force: true }) } catch { /* die temporaere Datei bleibt liegen, der Fehler zaehlt */ }
    throw error
  }
}

/** Ein Workspace-Name, der als Dateiname taugt; sonst ein Fehlertext. */
export function workspaceNameOk(workspaceId: unknown): boolean {
  return typeof workspaceId === 'string' && workspaceId.trim() !== '' && WORKSPACE_MUSTER.test(workspaceId)
}

export interface Store {
  root: string
  policiesDir: string
  workspacesDir: string
  logsDir: string
  /** Die drei Ordner anlegen, wenn sie fehlen. Wirft nur, wenn das Dateisystem es verweigert. */
  ensure(): void
  /** Die Startdatei anlegen, wenn der policies-Ordner leer ist; liefert die angelegte Id oder null. */
  seedWennLeer(): string | null
  /** Alle Policies in Bibliotheksreihenfolge, dazu die kaputten Dateien. */
  listen(): { policies: Policy[]; broken: Broken[] }
  /** Eine Policy lesen; `null`, wenn es die Datei nicht gibt. Kaputt -> im `broken`-Feld. */
  lesen(id: string): { policy: Policy | null; broken: Broken | null }
  /** Anlegen (ohne `id`) oder aendern (`id` gesetzt). Eine kaputte Datei wird nicht ueberschrieben. */
  speichern(eingabe: SpeicherEingabe): { ok: true; policy: Policy } | { ok: false; message: string }
  /** Eine Policy samt ihren Aktivierungen entfernen. */
  loeschen(id: string): { ok: true; id: string; aufgeraeumt: string[] } | { ok: false; message: string }
  /** Die aktivierten Ids eines Workspace, in der Reihenfolge der Datei. */
  aktiviert(workspaceId: string): { ids: string[]; broken: Broken | null }
  /** Einen Schalter setzen. */
  schalten(workspaceId: string, policyId: string, enabled: boolean): { ok: true; enabled: boolean } | { ok: false; message: string }
  /** Alle Policies eines Workspace mit ihrem Schalter, in Bibliotheksreihenfolge. */
  fuerWorkspace(workspaceId: string): { policies: (Policy & { enabled: boolean })[]; broken: Broken[] }
  /** Die Policies, die mindestens einen der Tags tragen (ohne Ruecksicht auf Gross/Klein). */
  nachTags(tags: string[]): Policy[]
  /** Eine Zeile ins Protokoll schreiben; Fehler hier duerfen den Aufrufer nie stoeren. */
  protokollieren(text: string): void
}

/** Die Felder, die der Aufrufer beim Speichern liefert. */
export interface SpeicherEingabe {
  id?: string
  title: string
  body: string
  tags?: string[]
  order?: number
  description?: string
}

/** Die naechste freie Id: `p` plus 16 Hex-Zeichen, damit sie `ID_MUSTER` erfuellt. */
function neueId(): string {
  const hex = (n: number): string => Math.floor(n).toString(16).padStart(2, '0')
  return `p${Array.from(crypto.getRandomValues(new Uint8Array(8))).map(hex).join('')}`
}

/**
 * Einen Store auf einem Wurzelordner bauen. Nichts wird angelegt, bevor `ensure` laeuft; damit
 * entscheidet der Aufrufer, wann das Dateisystem angefasst wird.
 */
export function createStore(optionen: StoreOptionen): Store {
  const root = optionen.root
  const policiesDir = join(root, POLICIES)
  const workspacesDir = join(root, WORKSPACES)
  const logsDir = join(root, LOGS)
  const seed = optionen.seed ?? startOrdner()

  const datei = (id: string): string => join(policiesDir, `${id}.md`)
  const workspaceDatei = (workspaceId: string): string => join(workspacesDir, `${workspaceId}.json`)

  function ensure(): void {
    for (const ordner of [policiesDir, workspacesDir, logsDir]) mkdirSync(ordner, { recursive: true })
  }

  function protokollieren(text: string): void {
    try {
      mkdirSync(logsDir, { recursive: true })
      appendFileSync(join(logsDir, 'host.log'), `${new Date().toISOString()} ${text}\n`, 'utf8')
    } catch { /* ein Protokoll, das nicht schreibbar ist, darf nichts anderes verhindern */ }
  }

  function policyDateien(): string[] {
    try {
      return readdirSync(policiesDir)
        .filter((name) => name.endsWith('.md') && !name.startsWith('.'))
        .sort()
    } catch {
      return []
    }
  }

  function leseDatei(name: string): { policy: Policy | null; broken: Broken | null } {
    const pfad = join(policiesDir, name)
    try {
      const inhalt = readFileSync(pfad, 'utf8')
      const ergebnis = zerlegen(inhalt)
      if (ergebnis.ok) {
        // Der Dateiname ist die Wahrheit fuer den Pfad: weicht die id im Kopfblock ab, ist die
        // Datei kaputt (sonst faende ein Speichern ueber die Id die Datei nicht wieder).
        const ohneEndung = name.slice(0, -3)
        if (ergebnis.policy.id !== ohneEndung) {
          return { policy: null, broken: { file: name, errors: [`id "${ergebnis.policy.id}" passt nicht zum Dateinamen "${ohneEndung}"`] } }
        }
        return { policy: ergebnis.policy, broken: null }
      }
      return { policy: null, broken: { file: name, errors: ergebnis.errors } }
    } catch (error) {
      return { policy: null, broken: { file: name, errors: [`Datei ist nicht lesbar: ${fehlerText(error)}`] } }
    }
  }

  function lesen(id: string): { policy: Policy | null; broken: Broken | null } {
    if (typeof id !== 'string' || !ID_MUSTER.test(id)) return { policy: null, broken: null }
    const pfad = datei(id)
    if (!existsSync(pfad)) return { policy: null, broken: null }
    return leseDatei(`${id}.md`)
  }

  function listen(): { policies: Policy[]; broken: Broken[] } {
    const policies: Policy[] = []
    const broken: Broken[] = []
    for (const name of policyDateien()) {
      const gelesen = leseDatei(name)
      if (gelesen.policy !== null) policies.push(gelesen.policy)
      if (gelesen.broken !== null) broken.push(gelesen.broken)
    }
    return { policies: sortierePolicies(policies), broken }
  }

  function seedWennLeer(): string | null {
    try {
      ensure()
      if (policyDateien().length > 0) return null
      if (!existsSync(seed)) return null
      for (const name of readdirSync(seed).filter((n) => n.endsWith('.md')).sort()) {
        const text = readFileSync(join(seed, name), 'utf8')
        const ergebnis = zerlegen(text)
        if (!ergebnis.ok) { protokollieren(`Startdatei ${name} ist nicht lesbar: ${ergebnis.errors.join('; ')}`); continue }
        atomarSchreiben(datei(ergebnis.policy.id), bauen(ergebnis.policy))
        return ergebnis.policy.id
      }
      return null
    } catch (error) {
      protokollieren(`Startdatei nicht angelegt: ${fehlerText(error)}`)
      return null
    }
  }

  function speichern(eingabe: SpeicherEingabe): { ok: true; policy: Policy } | { ok: false; message: string } {
    try {
      const { policies } = listen()
      const tags = normalisiereTags(eingabe?.tags)
      const body = typeof eingabe?.body === 'string' ? eingabe.body.trim() : ''
      const title = typeof eingabe?.title === 'string' ? eingabe.title.trim() : ''

      if (typeof eingabe?.id === 'string' && eingabe.id !== '') {
        const id = eingabe.id
        const vorhanden = lesen(id)
        if (vorhanden.broken !== null) {
          return { ok: false, message: `die Datei ${vorhanden.broken.file} ist kaputt und wird nicht ueberschrieben: ${vorhanden.broken.errors.join('; ')}` }
        }
        if (vorhanden.policy === null) return { ok: false, message: `unbekannte Policy ${id}` }
        const policy: Policy = { ...vorhanden.policy, title, body, tags }
        if (typeof eingabe.order === 'number') policy.order = eingabe.order
        // Ein leerer Text entfernt die Beschreibung; fehlt das Feld, bleibt die alte stehen.
        if (typeof eingabe.description === 'string') {
          const beschreibung = eingabe.description.trim()
          if (beschreibung === '') delete policy.description
          else policy.description = beschreibung
        }
        const errors = pruefen(policy)
        if (errors.length > 0) return { ok: false, message: errors.join('; ') }
        atomarSchreiben(datei(policy.id), bauen(policy))
        return { ok: true, policy }
      }

      const id = neueId()
      const order = typeof eingabe?.order === 'number'
        ? eingabe.order
        : policies.reduce((max, policy) => Math.max(max, policy.order + 1), 0)
      const policy: Policy = {
        id,
        title,
        body,
        tags,
        order,
        ...(typeof eingabe?.description === 'string' && eingabe.description.trim() !== '' ? { description: eingabe.description.trim() } : {}),
      }
      const errors = pruefen(policy)
      if (errors.length > 0) return { ok: false, message: errors.join('; ') }
      atomarSchreiben(datei(policy.id), bauen(policy))
      return { ok: true, policy }
    } catch (error) {
      protokollieren(`Speichern fehlgeschlagen: ${fehlerText(error)}`)
      return { ok: false, message: `Speichern fehlgeschlagen: ${fehlerText(error)}` }
    }
  }

  /** Eine workspaces-Datei lesen. Fehlt sie, ist der Workspace leer. Kaputt -> `broken`. */
  function leseWorkspace(workspaceId: string): { ids: string[]; broken: Broken | null } {
    const pfad = workspaceDatei(workspaceId)
    if (!existsSync(pfad)) return { ids: [], broken: null }
    const name = `${workspaceId}.json`
    try {
      const data: unknown = JSON.parse(readFileSync(pfad, 'utf8'))
      const rohe = (data as { enabled?: unknown })?.enabled
      if (!Array.isArray(rohe)) return { ids: [], broken: { file: name, errors: ['Feld "enabled" fehlt oder ist keine Liste'] } }
      const ids = rohe.filter((id): id is string => typeof id === 'string' && id !== '')
      return { ids, broken: null }
    } catch (error) {
      return { ids: [], broken: { file: name, errors: [`Datei ist nicht lesbar: ${fehlerText(error)}`] } }
    }
  }

  function schreibeWorkspace(workspaceId: string, ids: string[]): void {
    atomarSchreiben(workspaceDatei(workspaceId), `${JSON.stringify({ enabled: ids }, null, 2)}\n`)
  }

  function aktiviert(workspaceId: string): { ids: string[]; broken: Broken | null } {
    if (!workspaceNameOk(workspaceId)) return { ids: [], broken: { file: `${String(workspaceId)}.json`, errors: ['ungueltige Workspace-Id'] } }
    try {
      ensure()
      return leseWorkspace(workspaceId)
    } catch (error) {
      return { ids: [], broken: { file: `${workspaceId}.json`, errors: [fehlerText(error)] } }
    }
  }

  function schalten(workspaceId: string, policyId: string, enabled: boolean): { ok: true; enabled: boolean } | { ok: false; message: string } {
    if (!workspaceNameOk(workspaceId)) return { ok: false, message: `ungueltige Workspace-Id "${String(workspaceId)}"` }
    if (typeof policyId !== 'string' || !ID_MUSTER.test(policyId)) return { ok: false, message: `ungueltige Policy-Id "${String(policyId)}"` }
    try {
      ensure()
      const vorhanden = lesen(policyId)
      if (vorhanden.broken !== null) return { ok: false, message: `die Policy ${policyId} ist kaputt: ${vorhanden.broken.errors.join('; ')}` }
      if (vorhanden.policy === null) return { ok: false, message: `unbekannte Policy ${policyId}` }
      const gelesen = leseWorkspace(workspaceId)
      if (gelesen.broken !== null) return { ok: false, message: `die Datei ${gelesen.broken.file} ist kaputt und wird nicht ueberschrieben: ${gelesen.broken.errors.join('; ')}` }
      const ids = gelesen.ids.filter((id) => id !== policyId)
      if (enabled) ids.push(policyId)
      schreibeWorkspace(workspaceId, ids)
      return { ok: true, enabled }
    } catch (error) {
      protokollieren(`Schalten fehlgeschlagen: ${fehlerText(error)}`)
      return { ok: false, message: `Schalten fehlgeschlagen: ${fehlerText(error)}` }
    }
  }

  function loeschen(id: string): { ok: true; id: string; aufgeraeumt: string[] } | { ok: false; message: string } {
    if (typeof id !== 'string' || !ID_MUSTER.test(id)) return { ok: false, message: `ungueltige Policy-Id "${String(id)}"` }
    try {
      ensure()
      const pfad = datei(id)
      if (!existsSync(pfad)) return { ok: false, message: `unbekannte Policy ${id}` }
      rmSync(pfad, { force: true })
      const aufgeraeumt: string[] = []
      let namen: string[] = []
      try {
        namen = readdirSync(workspacesDir).filter((name) => name.endsWith('.json')).sort()
      } catch { namen = [] }
      for (const name of namen) {
        const workspaceId = name.slice(0, -5)
        if (!workspaceNameOk(workspaceId)) continue
        const gelesen = leseWorkspace(workspaceId)
        // Eine kaputte Datei bleibt liegen: sie wird gemeldet, nicht ueberschrieben.
        if (gelesen.broken !== null) { protokollieren(`Aktivierung nicht aufgeraeumt, Datei kaputt: ${gelesen.broken.file}`); continue }
        if (!gelesen.ids.includes(id)) continue
        schreibeWorkspace(workspaceId, gelesen.ids.filter((eintrag) => eintrag !== id))
        aufgeraeumt.push(workspaceId)
      }
      return { ok: true, id, aufgeraeumt }
    } catch (error) {
      protokollieren(`Loeschen fehlgeschlagen: ${fehlerText(error)}`)
      return { ok: false, message: `Loeschen fehlgeschlagen: ${fehlerText(error)}` }
    }
  }

  function fuerWorkspace(workspaceId: string): { policies: (Policy & { enabled: boolean })[]; broken: Broken[] } {
    const { policies, broken } = listen()
    const gelesen = aktiviert(workspaceId)
    if (gelesen.broken !== null) broken.push(gelesen.broken)
    const an = new Set(gelesen.ids)
    return { policies: policies.map((policy) => ({ ...policy, enabled: an.has(policy.id) })), broken }
  }

  function nachTags(tags: string[]): Policy[] {
    const gesucht = normalisiereTags(tags).map((tag) => tag.toLowerCase())
    if (gesucht.length === 0) return []
    const { policies } = listen()
    return policies.filter((policy) => policy.tags.some((tag) => gesucht.includes(tag.toLowerCase())))
  }

  return {
    root, policiesDir, workspacesDir, logsDir,
    ensure, seedWennLeer, listen, lesen, speichern, loeschen, aktiviert, schalten, fuerWorkspace, nachTags, protokollieren,
  }
}

/** Fehler als ein Satz, ohne Stack: Meldungen gehen an Oberflaeche und Protokoll. */
export function fehlerText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
