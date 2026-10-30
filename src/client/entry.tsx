/**
 * Browser-Haelfte von dsh-teams-plus.
 *
 * Zwei Aufgaben:
 *
 * 1. den Typert-Wire-Beschreiber `teamsPlus` anmelden — sechs Methoden, je ein JSON-Objekt, gebaut
 *    aus der Schemadatei `./policy-schemas` (dieselbe Datei, gegen die der Test die echten
 *    Ergebnisse des Hosts prueft). Damit gibt es EINE Quelle fuer beide Seiten.
 * 2. die erste Ansicht einhaengen: eine Zeile in der Seitenleiste und eine Seite, die die Policies
 *    des gewaehlten Workspace mit Titel, Tags und Schalter zeigt.
 *
 * Die Ansicht spricht NUR mit dem Remote `teamsPlus`; sie kennt keinen Dateipfad.
 */
import { PolicyIcon, PolicyPanel, addStyle, type TeamsPlusApi } from './policies'
import {
  deletePolicy_request$schema, deletePolicy_result$schema,
  listForWorkspace_request$schema, listForWorkspace_result$schema,
  listPolicies_request$schema, listPolicies_result$schema,
  resolveTags_request$schema, resolveTags_result$schema,
  savePolicy_request$schema, savePolicy_result$schema,
  setEnabled_request$schema, setEnabled_result$schema,
} from './policy-schemas'

/** Die Kennung der Seite; dieselbe Kennung traegt die Zeile in der Seitenleiste. */
export const PANEL_ID = 'teams-plus.policies'
const PANEL_ORDER = 60

/** Cordis-Dienste, die dieser Eintrag braucht (Namen, nicht Pakete). */
export const inject = ['slots', 'remote']

const PKG = '@tmielsch/dsh-teams-plus'
const SCHEMAS = 'src/client/policy-schemas.ts'

/** Eine Parameterbeschreibung des Wire-Beschreibers. */
const parameter = (requestSchema: () => unknown, typeSymbol: string) => ({
  name: 'request',
  wire: 'request',
  source: 'json',
  codec: { mode: 'strict', typeSymbol: `${PKG}/policy-schemas#${typeSymbol}`, create: requestSchema },
})

const result = (resultSchema: () => unknown, typeSymbol: string) => ({
  mode: 'strict',
  typeSymbol: `${PKG}/policy-schemas#${typeSymbol}`,
  create: resultSchema,
})

const descriptor = (method: string, requestSchema: () => unknown, requestType: string, resultSchema: () => unknown, resultType: string) => ({
  id: `${PKG}#teamsPlus/${method}`,
  service: 'teamsPlus',
  namespace: 'teamsPlus',
  method,
  invocation: { kind: 'direct' },
  parameters: [parameter(requestSchema, requestType)],
  result: result(resultSchema, resultType),
  sourceLocation: { file: SCHEMAS, line: 1, column: 1 },
})

/** Der Wire-Beschreiber des Dienstes: sechs direkte Methoden, je ein JSON-Objekt. */
export const TYPERT_REMOTE = {
  package: PKG,
  descriptors: [
    descriptor('listPolicies', () => listPolicies_request$schema, 'ListPoliciesRequest', () => listPolicies_result$schema, 'ListPoliciesResult'),
    descriptor('listForWorkspace', () => listForWorkspace_request$schema, 'ListForWorkspaceRequest', () => listForWorkspace_result$schema, 'ListForWorkspaceResult'),
    descriptor('savePolicy', () => savePolicy_request$schema, 'SavePolicyRequest', () => savePolicy_result$schema, 'SavePolicyResult'),
    descriptor('deletePolicy', () => deletePolicy_request$schema, 'DeletePolicyRequest', () => deletePolicy_result$schema, 'DeletePolicyResult'),
    descriptor('setEnabled', () => setEnabled_request$schema, 'SetEnabledRequest', () => setEnabled_result$schema, 'SetEnabledResult'),
    descriptor('resolveTags', () => resolveTags_request$schema, 'ResolveTagsRequest', () => resolveTags_result$schema, 'ResolveTagsResult'),
  ],
}

/** Die Methoden des Vertrags, in der Reihenfolge des Beschreibers. */
export const METHODEN = ['listPolicies', 'listForWorkspace', 'savePolicy', 'deletePolicy', 'setEnabled', 'resolveTags']

export async function apply(ctx: any): Promise<void> {
  addStyle()

  // Zuerst das Remote anmelden: die Ansicht unten verbraucht `remote.teamsPlus`, und dieser
  // Eintrag ist der einzige Anbieter dieses Namens.
  const disposeMount = await ctx.remote.$mount(TYPERT_REMOTE)
  ctx.effect(() => disposeMount, 'teams-plus: remote')

  await ctx.plugin({
    inject: ['slots', 'remote.teamsPlus'],
    apply: async (sub: any) => {
      const api: TeamsPlusApi = {
        listForWorkspace: (request) => sub.remote.teamsPlus.listForWorkspace(request),
        setEnabled: (request) => sub.remote.teamsPlus.setEnabled(request),
      }

      // Die Zeile in der Seitenleiste.
      sub.slots.inject('sidebar.panellist', () => sub.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: PANEL_ORDER,
        label: () => 'Teams Plus',
      }, PolicyIcon))

      // Die Seite: dieselbe Kennung wie die Zeile, damit der Klick sie oeffnet.
      sub.slots.inject('main', () => sub.slots.register({
        name: 'main',
        key: PANEL_ID,
        inject: () => ({ api }),
      }, PolicyPanel))
    },
  })
}
