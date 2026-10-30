/**
 * Host-Haelfte von dsh-teams-plus: der Dienst `teamsPlus`.
 *
 * Ein Dienst, sechs Methoden, eine Ablage. Jede Ansicht (dieses Paket, ein spaeteres
 * Rechtsklick-Menue, ein fremdes Plugin) liest und schreibt ausschliesslich ueber diesen Dienst.
 * Keine Ansicht kennt einen Dateipfad, und keine Ansicht greift an einer anderen vorbei in die
 * Ablage. Genau dafuer gibt es den Vertrag.
 *
 *     listPolicies()                          alle Policies der Bibliothek
 *     listForWorkspace(workspaceId)            alle Policies mit dem Schalter eines Workspace
 *     savePolicy({id?, title, body, tags})     anlegen oder aendern
 *     deletePolicy(id)                         entfernen, samt Aktivierungen
 *     setEnabled(workspaceId, policyId, on)    einen Schalter setzen
 *     resolveTags(tags)                        die Policies, die einen der Tags tragen
 *
 * Auf der Leitung nimmt jede Methode EIN JSON-Objekt (`request`), wie das Muster in
 * dsh-projectOS; die Bedeutung der Felder steht je Methode unten.
 *
 * Die Ablage liegt in `src/policy/store.ts`; das Format in `src/policy/schema.ts`. Beide sind rein
 * und in node geprueft. Dieser Teil verdrahtet sie mit DSH: den Dienst ueber `ctx.provide` und die
 * Prompt-Injektion ueber `systemPrompt.context` mit order 130.
 *
 * Der Textaufbau der Prompt-Injektion ist UNVERAENDERT aus dsh-projectOS uebernommen
 * (policyPromptText, findWorkspace): eine aktive Policy traegt ihren Titel in der Ueberschrift,
 * mehrere bekommen `## <Titel>`-Abschnitte. Am Verhalten der Agenten aendert sich dadurch nichts.
 */
import { datenOrdner, createStore, fehlerText, startOrdner } from '../policy/store.ts'

/** Der Name, unter dem DSH dieses Plugin fuehrt. */
export const name = 'teams-plus'

/** Die Cordis-Dienste, ohne die der Dienst keinen Sinn hat (die Prompt-Seite). */
export const inject = ['systemPrompt', 'agents', 'workspaceRegistry']

/** Der Name des Dienstes in Cordis und in der Typert-Bindung. */
export const SERVICE = 'teamsPlus'

// ---------------------------------------------------------------------------
// Prompt-Seite: derselbe Textaufbau wie in dsh-projectOS (dort policyPromptText/findWorkspace).
// ---------------------------------------------------------------------------

/**
 * Sync-Workspace-Suche nach Verzeichnispfad: erst der genaue Pfad, dann der laengste
 * Workspace-Pfad, der die cwd enthaelt (eine Sitzung in einem Unterordner ihres Workspace).
 */
export function findWorkspace(registry, cwd) {
  if (typeof cwd !== 'string' || cwd === '') return undefined
  const clean = String(cwd).replace(/[/\\]+$/, '')
  let best
  for (const entity of registry.list()) {
    const path = String(entity.path).replace(/[/\\]+$/, '')
    if (path === clean) return entity
    if (clean.startsWith(path + '/') && (best === undefined || path.length > String(best.path).length)) best = entity
  }
  return best
}

/** Die aktiven Policies eines Workspace, in Bibliotheksreihenfolge, leere Bodies verworfen. */
export function aktivePolicies(store, workspaceId) {
  return store.fuerWorkspace(workspaceId).policies.filter((policy) => policy.enabled && policy.body.trim() !== '')
}

/**
 * Der Prompt-Block fuer einen Agenten: die aktiven Policies seines Workspace, oder '' wenn keine
 * gilt. Der Aufbau ist Zeile fuer Zeile der aus dsh-projectOS.
 */
export function policyPromptText(store, registry, cwd) {
  if (typeof cwd !== 'string' || cwd === '') return ''
  const workspace = findWorkspace(registry, cwd)
  if (workspace === undefined) return ''
  const cards = aktivePolicies(store, String(workspace.id))
  if (cards.length === 0) return ''
  const head = cards.length === 1
    ? `# Workspace Policy (${cards[0].title}) — active in this workspace`
    : '# Workspace Policies — active in this workspace'
  const bodies = cards.map((card) => (cards.length > 1 ? `## ${card.title}\n` : '') + card.body.trim())
  return `${head}\n\n${bodies.join('\n\n')}`
}

// ---------------------------------------------------------------------------
// Remote-Dienst: die sechs Methoden.
//
// Das Gateway findet einen Dienst ueber drei Dinge am lebenden Objekt:
//   - `typertRemote = { service, serviceKey, namespace }`,
//   - eine Marker-Beschreibung auf dem PROTOTYP, die jede Methode nennt
//     (byte-gleich die Form, die der uebersetzte `@Remote('name')`-Dekorator schreibt),
//   - die Methoden selbst auf dem Prototyp mit einer schlichten Parameterliste
//     (`methodParameterNames` liest sie aus dem Quelltext zurueck).
// Deshalb wird der Dienst als schlichtes Objekt ueber `ctx.provide` angemeldet und die Marker von
// Hand geschrieben: die Host-Haelfte braucht kein typert-Paket zur Laufzeit.
// ---------------------------------------------------------------------------

const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods'

/** Einen Typert-Remote-Marker anhaengen; byte-gleich die Form, die der Dekorator erzeugt. */
export function markRemote(prototype, method) {
  const existing = Object.getOwnPropertyDescriptor(prototype, REMOTE_METHOD_DESCRIPTOR)?.value
  const methods = existing?.methods ?? []
  if (methods.some((candidate) => candidate.method === method)) return
  const marker = Object.freeze({ method, invocation: Object.freeze({ kind: 'direct' }) })
  Object.defineProperty(prototype, REMOTE_METHOD_DESCRIPTOR, {
    configurable: true,
    value: Object.freeze({ version: 1, methods: Object.freeze([...methods, marker]) }),
  })
}

/** Die sechs Methoden des Vertrags, in der Reihenfolge, in der sie gemeldet werden. */
export const METHODEN = ['listPolicies', 'listForWorkspace', 'savePolicy', 'deletePolicy', 'setEnabled', 'resolveTags']

/**
 * Der Dienst. Er kennt nur den Store; DSH kommt erst in `apply` dazu. Dadurch laesst sich jede
 * Methode gegen einen gefaelschten Ordner pruefen.
 */
export class TeamsPlusController {
  /** @param ctx - Host-Kontext (nur zum Protokollieren); @param store - die Ablage. */
  constructor(ctx, store) {
    this.ctx = ctx
    this.store = store
    this.name = SERVICE
    this.typertRemote = Object.freeze({ service: this, serviceKey: SERVICE, namespace: SERVICE })
    /** Kaputte Dateien werden EINMAL gemeldet, nicht bei jedem Aufruf. */
    this.gemeldet = new Set()
  }

  /** Eine Meldung einmal je Vorgang: DSH-Protokoll und Datei logs/host.log. */
  melden(key, message) {
    if (this.gemeldet.has(key)) return
    this.gemeldet.add(key)
    try { this.store.protokollieren(message) } catch { /* Protokoll darf nichts verhindern */ }
    try { this.ctx?.logger?.(name)?.warn?.(message) } catch { /* kein Logger vorhanden */ }
  }

  /** Kaputte Dateien des letzten Lesens einmal melden. */
  meldeKaputte(broken) {
    for (const kaputt of broken ?? []) this.melden(`kaputt:${kaputt.file}`, `Policy-Datei ${kaputt.file} ist kaputt: ${kaputt.errors.join('; ')}`)
  }

  /** `request`: {} — alle Policies der Bibliothek, in Bibliotheksreihenfolge. */
  async listPolicies(request) {
    try {
      const { policies, broken } = this.store.listen()
      this.meldeKaputte(broken)
      return { ok: true, policies, broken }
    } catch (error) {
      this.melden('listPolicies', `listPolicies fehlgeschlagen: ${fehlerText(error)}`)
      return { ok: false, policies: [], broken: [], message: fehlerText(error) }
    }
  }

  /** `request`: { workspaceId } — alle Policies mit dem Schalter dieses Workspace. */
  async listForWorkspace(request) {
    try {
      const workspaceId = String(request?.workspaceId ?? '')
      if (!/^[a-zA-Z0-9_-]+$/.test(workspaceId)) return { ok: false, workspaceId, policies: [], broken: [], message: 'workspaceId fehlt oder ist ungueltig' }
      const { policies, broken } = this.store.fuerWorkspace(workspaceId)
      this.meldeKaputte(broken)
      return { ok: true, workspaceId, policies, broken }
    } catch (error) {
      this.melden('listForWorkspace', `listForWorkspace fehlgeschlagen: ${fehlerText(error)}`)
      return { ok: false, workspaceId: String(request?.workspaceId ?? ''), policies: [], broken: [], message: fehlerText(error) }
    }
  }

  /** `request`: { id?, title, body, tags? } — anlegen (ohne id) oder aendern (id gesetzt). */
  async savePolicy(request) {
    try {
      const ergebnis = this.store.speichern({
        ...(typeof request?.id === 'string' && request.id !== '' ? { id: request.id } : {}),
        title: typeof request?.title === 'string' ? request.title : '',
        body: typeof request?.body === 'string' ? request.body : '',
        tags: request?.tags,
      })
      if (ergebnis.ok !== true) return { ok: false, message: ergebnis.message }
      return { ok: true, policy: ergebnis.policy }
    } catch (error) {
      this.melden('savePolicy', `savePolicy fehlgeschlagen: ${fehlerText(error)}`)
      return { ok: false, message: fehlerText(error) }
    }
  }

  /** `request`: { id } — die Policy und alle ihre Aktivierungen entfernen. */
  async deletePolicy(request) {
    try {
      const ergebnis = this.store.loeschen(String(request?.id ?? ''))
      if (ergebnis.ok !== true) return { ok: false, message: ergebnis.message }
      return { ok: true, id: ergebnis.id, removed: ergebnis.aufgeraeumt }
    } catch (error) {
      this.melden('deletePolicy', `deletePolicy fehlgeschlagen: ${fehlerText(error)}`)
      return { ok: false, message: fehlerText(error) }
    }
  }

  /** `request`: { workspaceId, policyId, enabled } — einen Schalter setzen. */
  async setEnabled(request) {
    try {
      const workspaceId = String(request?.workspaceId ?? '')
      const policyId = String(request?.policyId ?? '')
      const enabled = request?.enabled === true
      const ergebnis = this.store.schalten(workspaceId, policyId, enabled)
      if (ergebnis.ok !== true) return { ok: false, message: ergebnis.message }
      return { ok: true, workspaceId, policyId, enabled: ergebnis.enabled }
    } catch (error) {
      this.melden('setEnabled', `setEnabled fehlgeschlagen: ${fehlerText(error)}`)
      return { ok: false, message: fehlerText(error) }
    }
  }

  /** `request`: { tags } — die Policies, die mindestens einen dieser Tags tragen. */
  async resolveTags(request) {
    try {
      const tags = Array.isArray(request?.tags) ? request.tags.filter((tag) => typeof tag === 'string') : []
      const policies = this.store.nachTags(tags)
      return { ok: true, tags, policies, broken: [] }
    } catch (error) {
      this.melden('resolveTags', `resolveTags fehlgeschlagen: ${fehlerText(error)}`)
      return { ok: false, tags: [], policies: [], broken: [], message: fehlerText(error) }
    }
  }
}

for (const methode of METHODEN) markRemote(TeamsPlusController.prototype, methode)

// ---------------------------------------------------------------------------
// Anmeldung.
// ---------------------------------------------------------------------------

/**
 * Meldet den Dienst und die Prompt-Injektion an. ACHTUNG: ein Fehler an einer Stelle darf DSH nie
 * am Starten hindern; jeder Teil wird einzeln versucht, einmal protokolliert, und der Rest laeuft
 * weiter.
 */
export async function apply(ctx) {
  const log = (message) => {
    try { ctx.logger?.(name)?.warn?.(message) } catch { /* kein Logger */ }
  }

  // Die Ablage: Wurzel aus der Umgebung (fuer Tests und fremde Zuhause), sonst ~/.dsh/.tm/teams-plus.
  let store
  try {
    const root = typeof process.env.TEAMS_PLUS_DATA_DIR === 'string' && process.env.TEAMS_PLUS_DATA_DIR !== ''
      ? process.env.TEAMS_PLUS_DATA_DIR
      : datenOrdner()
    store = createStore({ root, seed: startOrdner() })
    store.ensure()
  } catch (error) {
    log(`teamsPlus off: Datenordner nicht anlegbar: ${fehlerText(error)}`)
    return
  }

  // Die mitgelieferte Startdatei, nur wenn der policies-Ordner leer ist.
  try {
    store.seedWennLeer()
  } catch (error) {
    log(`Startdatei nicht angelegt: ${fehlerText(error)}`)
  }

  // Der Dienst, den jede Ansicht ruft.
  try {
    const controller = new TeamsPlusController(ctx, store)
    if (ctx.effect === undefined) ctx.provide(SERVICE, controller)
    else ctx.effect(() => ctx.provide(SERVICE, controller), 'teams-plus: service')
  } catch (error) {
    log(`teamsPlus off: Dienst nicht angemeldet: ${fehlerText(error)}`)
    return
  }

  // Die Prompt-Seite: ein dynamischer Kontext, bei jedem Zusammenbau synchron gelesen.
  const systemPrompt = ctx.get?.('systemPrompt')
  const agents = ctx.get?.('agents')
  const registry = ctx.get?.('workspaceRegistry')
  if (systemPrompt === undefined || agents === undefined || registry === undefined) {
    log('teamsPlus: keine Prompt-Seite (systemPrompt/agents/workspaceRegistry fehlen)')
    return
  }
  try {
    // `systemPrompt.context()` liefert den Disposer; der Effect muss ihn BEHALTEN, nicht ausfuehren.
    const disposeContext = systemPrompt.context({
      name: 'teams-plus:policies',
      order: 130,
      text: () => {
        try {
          const agent = typeof agents.currentInitiator === 'function' ? agents.currentInitiator() : undefined
          return policyPromptText(store, registry, agent?.session?.header?.cwd)
        } catch {
          return ''
        }
      },
    })
    if (ctx.effect !== undefined) ctx.effect(() => disposeContext, 'teams-plus: policy prompt')
  } catch (error) {
    log(`teamsPlus: Prompt-Injektion nicht angemeldet: ${fehlerText(error)}`)
  }
}
