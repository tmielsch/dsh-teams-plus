/**
 * Die erste Ansicht auf den Policy-Vertrag — absichtlich klein.
 *
 * Sie zeigt die Policies des gewaehlten Workspace mit Titel, Tags und einem Schalter, und sie
 * spricht AUSSCHLIESSLICH mit dem Remote-Dienst `teamsPlus`: kein Dateipfad, kein Lesen, kein
 * Schreiben an der Ablage vorbei. Ein spaeteres Rechtsklick-Menue oder ein anderes Plugin zeigt
 * dieselben Policies ueber denselben Dienst, ohne mit dieser Ansicht zusammenzustossen.
 *
 * Was hier NICHT steht, ist Absicht: kein ziehbares Fenster, keine Fensterposition, kein
 * Rechtsklick-Menue, kein Editor. Das kommt als eigenes Plugin.
 */
import { useEffect, useState } from 'react'
import type { WorkspacePolicy } from './policy-schemas'

/** Der Ausschnitt des Dienstes, den diese Ansicht braucht. */
export interface TeamsPlusApi {
  listForWorkspace(request: { workspaceId: string }): Promise<{ ok: boolean; workspaceId?: string; policies?: WorkspacePolicy[]; message?: string }>
  setEnabled(request: { workspaceId: string; policyId: string; enabled: boolean }): Promise<{ ok: boolean; enabled?: boolean; message?: string }>
}

/** Ein Eintrag der Workspace-Liste des Harness (Kit-Prop `useWorkspaces`). */
export interface WorkspaceItem {
  workspaceId: string
  path: string
  title: string
}

/** Der Hook, den der Slot als Kit-Prop liefert; fehlt er, bleibt die Liste leer. */
type UseWorkspaces = <R>(selector: (state: { items: WorkspaceItem[] }) => R) => R

const leererHook: UseWorkspaces = () => [] as never

/** Die Policies eines Workspace laden, mit Neuladen beim Wechsel. */
function useWorkspacePolicies(api: TeamsPlusApi, workspaceId: string | undefined): [WorkspacePolicy[] | null, (next: WorkspacePolicy[]) => void] {
  const [policies, setPolicies] = useState<WorkspacePolicy[] | null>(null)
  useEffect(() => {
    if (workspaceId === undefined) { setPolicies(null); return undefined }
    let lebendig = true
    setPolicies(null)
    api.listForWorkspace({ workspaceId }).then((ergebnis) => {
      if (!lebendig) return
      setPolicies(ergebnis.ok === true && Array.isArray(ergebnis.policies) ? ergebnis.policies : [])
    }).catch(() => { if (lebendig) setPolicies([]) })
    return () => { lebendig = false }
  }, [api, workspaceId])
  return [policies, setPolicies]
}

/** Ein Schalter (role="switch"), wie ihn die Ansicht braucht. */
function Schalter({ an, titel, onFlip }: { an: boolean; titel: string; onFlip: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={an}
      aria-label={`Policy ${titel} ${an ? 'ausschalten' : 'einschalten'}`}
      className="tp-switch"
      data-on={an}
      onClick={onFlip}
    >
      <span className="tp-knob" />
    </button>
  )
}

/** Eine Zeile: Schalter, Titel, Tags. */
function PolicyZeile({ policy, onFlip }: { policy: WorkspacePolicy; onFlip: () => void }) {
  return (
    <li className="tp-policy" data-on={policy.enabled}>
      <Schalter an={policy.enabled} titel={policy.title} onFlip={onFlip} />
      <div className="tp-body">
        <span className="tp-title">{policy.title}</span>
        {policy.description !== undefined && policy.description !== '' && <span className="tp-desc">{policy.description}</span>}
        <span className="tp-tags">
          {policy.tags.length === 0
            ? <span className="tp-tag tp-tag-leer">ohne Tags</span>
            : policy.tags.map((tag) => <span className="tp-tag" key={tag}>{tag}</span>)}
        </span>
      </div>
    </li>
  )
}

/** Die Seite: Workspace waehlen, dann dessen Policies mit Schalter. */
export function PolicyPanel({ api, useWorkspaces }: { api: TeamsPlusApi; useWorkspaces?: UseWorkspaces }): any {
  const items = (useWorkspaces ?? leererHook)((state) => state.items)
  const [gewaehlt, setGewaehlt] = useState<string | undefined>(undefined)
  const aktiv = gewaehlt ?? items[0]?.workspaceId
  const [policies, setPolicies] = useWorkspacePolicies(api, aktiv)

  const flip = (policy: WorkspacePolicy): void => {
    if (aktiv === undefined) return
    const ziel = !policy.enabled
    // Optimistisch umschalten; der Dienst ist die Wahrheit, ein Fehler laesst den Schalter zurueck.
    setPolicies((policies ?? []).map((eintrag) => (eintrag.id === policy.id ? { ...eintrag, enabled: ziel } : eintrag)))
    api.setEnabled({ workspaceId: aktiv, policyId: policy.id, enabled: ziel }).then((ergebnis) => {
      if (ergebnis.ok === true) return
      setPolicies((policies ?? []).map((eintrag) => (eintrag.id === policy.id ? { ...eintrag, enabled: policy.enabled } : eintrag)))
    }).catch(() => {
      setPolicies((policies ?? []).map((eintrag) => (eintrag.id === policy.id ? { ...eintrag, enabled: policy.enabled } : eintrag)))
    })
  }

  return (
    <div className="tp-panel">
      <div className="tp-workspaces">
        <span className="tp-label">Workspace</span>
        {items.map((item) => (
          <button
            key={item.workspaceId}
            type="button"
            className="tp-ws"
            aria-pressed={item.workspaceId === aktiv}
            onClick={() => setGewaehlt(item.workspaceId)}
          >
            {item.title === '' ? item.path : item.title}
          </button>
        ))}
      </div>
      {aktiv === undefined && <p className="tp-note">Kein Workspace vorhanden.</p>}
      {aktiv !== undefined && policies === null && <p className="tp-note">Policies werden geladen …</p>}
      {aktiv !== undefined && policies !== null && policies.length === 0 && (
        <p className="tp-note">Keine Policy in diesem Workspace.</p>
      )}
      {policies !== null && policies.length > 0 && (
        <ul className="tp-list">
          {policies.map((policy) => <PolicyZeile key={policy.id} policy={policy} onFlip={() => flip(policy)} />)}
        </ul>
      )}
    </div>
  )
}

/**
 * Das Symbol der Seitenleiste. Der Slot liefert `size` und `active` (`SidebarPanelIconOwnerProps`);
 * die Farbe kommt aus `currentColor`, damit sie dem Thema folgt.
 */
export function PolicyIcon({ size = 16 }: { size?: number; active?: boolean }): any {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 6h6M5 8.5h6M5 11h3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

/** Das Stylesheet der Ansicht; der Eintrag haengt es einmal ein. */
export const CSS_TAG = 'teams-plus.policies'

export const CSS = `
.tp-panel { display: flex; flex-direction: column; gap: 12px; padding: 16px; color: var(--dsw-alias-label-primary); }
.tp-workspaces { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.tp-label { font-size: 12px; color: var(--dsw-alias-label-secondary); text-transform: uppercase; letter-spacing: .04em; }
.tp-ws { border: 1px solid var(--dsw-alias-border-l1); background: transparent; color: inherit; border-radius: 999px; padding: 3px 10px; font: inherit; cursor: pointer; }
.tp-ws[aria-pressed="true"] { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.tp-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.tp-policy { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; }
.tp-policy[data-on="true"] { border-color: var(--dsw-alias-brand-primary); }
.tp-body { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.tp-title { font-weight: 600; }
.tp-desc { font-size: 13px; color: var(--dsw-alias-label-secondary); }
.tp-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
.tp-tag { font-size: 12px; padding: 1px 8px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); }
.tp-tag-leer { font-style: italic; }
.tp-note { color: var(--dsw-alias-label-secondary); margin: 0; }
.tp-switch { position: relative; flex: none; width: 34px; height: 20px; margin-top: 2px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: var(--dsw-alias-bg-layer-2); padding: 0; cursor: pointer; }
.tp-switch[data-on="true"] { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.tp-knob { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--dsw-alias-bg-base); transition: left .12s ease; }
.tp-switch[data-on="true"] .tp-knob { left: 17px; }
`

/** Das Stylesheet einmal einhaengen; ohne DOM (Node, Test) passiert nichts. */
export function addStyle(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css="${CSS_TAG}"]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = '@tmielsch/dsh-teams-plus'
  tag.dataset.pluginCss = CSS_TAG
  tag.textContent = CSS
  document.head.appendChild(tag)
}
