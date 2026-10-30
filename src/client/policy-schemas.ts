// Drahtschemas des Remote-Dienstes `teamsPlus`: EINE Datei als Quelle fuer beide Seiten.
//
// Der Host (src/host/index.js) liefert genau diese Formen, die Ansicht (src/client/entry.tsx)
// baut daraus den Typert-Wire-Beschreiber TYPERT_REMOTE — und der Test test/policy-host.test.mjs
// prueft die ECHTEN Ergebnisse der sechs Methoden gegen diese Schemas. Damit koennen Host und
// Ansicht nicht auseinanderlaufen, ohne dass ein Test rot wird.
//
// Die Form einer Policy ist dieselbe wie in der Ablage (src/policy/schema.ts): id, title, tags,
// order, description (optional) und der Prompt-Text in body. Die Ansicht sieht davon nur, was sie
// zeigt; sie kennt keinen Dateipfad.
import { z } from 'zod'

/** Eine Policy, wie sie ueber die Leitung geht. */
export const policy$schema = z.object({
  id: z.string(),
  title: z.string(),
  tags: z.array(z.string()),
  order: z.number().int(),
  description: z.string().optional(),
  body: z.string(),
})

/** Dieselbe Policy in einem Workspace, mit ihrem Schalter. */
export const workspacePolicy$schema = policy$schema.extend({
  enabled: z.boolean(),
})

/** Eine Datei, die nicht gelesen werden konnte: gemeldet, nie ueberschrieben. */
export const broken$schema = z.object({
  file: z.string(),
  errors: z.array(z.string()),
})

// --- listPolicies -----------------------------------------------------------

export const listPolicies_request$schema = z.object({})
export const listPolicies_result$schema = z.object({
  ok: z.boolean(),
  policies: z.array(policy$schema),
  broken: z.array(broken$schema),
  message: z.string().optional(),
})

// --- listForWorkspace -------------------------------------------------------

export const listForWorkspace_request$schema = z.object({ workspaceId: z.string() })
export const listForWorkspace_result$schema = z.object({
  ok: z.boolean(),
  workspaceId: z.string(),
  policies: z.array(workspacePolicy$schema),
  broken: z.array(broken$schema),
  message: z.string().optional(),
})

// --- savePolicy -------------------------------------------------------------

export const savePolicy_request$schema = z.object({
  id: z.string().optional(),
  title: z.string(),
  body: z.string(),
  tags: z.array(z.string()).optional(),
})
export const savePolicy_result$schema = z.object({
  ok: z.boolean(),
  policy: policy$schema.optional(),
  message: z.string().optional(),
})

// --- deletePolicy -----------------------------------------------------------

export const deletePolicy_request$schema = z.object({ id: z.string() })
export const deletePolicy_result$schema = z.object({
  ok: z.boolean(),
  id: z.string().optional(),
  removed: z.array(z.string()).optional(),
  message: z.string().optional(),
})

// --- setEnabled -------------------------------------------------------------

export const setEnabled_request$schema = z.object({
  workspaceId: z.string(),
  policyId: z.string(),
  enabled: z.boolean(),
})
export const setEnabled_result$schema = z.object({
  ok: z.boolean(),
  workspaceId: z.string().optional(),
  policyId: z.string().optional(),
  enabled: z.boolean().optional(),
  message: z.string().optional(),
})

// --- resolveTags ------------------------------------------------------------

export const resolveTags_request$schema = z.object({ tags: z.array(z.string()) })
export const resolveTags_result$schema = z.object({
  ok: z.boolean(),
  tags: z.array(z.string()),
  policies: z.array(policy$schema),
  broken: z.array(broken$schema),
  message: z.string().optional(),
})

export type Policy = z.infer<typeof policy$schema>
export type WorkspacePolicy = z.infer<typeof workspacePolicy$schema>
export type Broken = z.infer<typeof broken$schema>
