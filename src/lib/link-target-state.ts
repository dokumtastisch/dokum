/**
 * link-target-state — is a link's target reachable, and if not, why (#74,
 * spec #63 §6, user stories 21–23).
 *
 * ⚠ THIS EXISTS BECAUSE RLS HIDES THE DIFFERENCE. A link resolves by reading
 * the target's row, and that read is entitlement-gated — so an unentitled
 * student's lookup returns **no row at all**, and locked is indistinguishable
 * from deleted in the browser. Telling the student „das liegt in Einheit 3,
 * schalte sie frei" requires knowing the target exists and which Einheit owns
 * it, which is exactly what the policy withholds from the reader we want to
 * sell to. So a server-side resolver reads it with a privileged client and
 * answers with a **minimal descriptor** — never the content.
 *
 * This module is the decision that route makes, split out from the reading so
 * it can be tested as what it is: a paywall rule. Pure, and free of
 * `server-only` on purpose — the browser half needs the same shapes to read
 * the answer, and one declaration is what stops the two ends drifting apart.
 *
 * FOUR VERDICTS, AND THE ORDER BETWEEN THEM IS LOAD-BEARING:
 *
 * - `missing`  — no such row. Nothing else is said about it.
 * - `archived` — it exists, but its Kurs is unpublished. Beats `locked`: the
 *                material is retired, and offering to sell it would take €3
 *                for an Einheit that stays dark.
 * - `locked`   — it exists and is live, the reader has simply not bought the
 *                Einheit. The one verdict that carries anything with it.
 * - `ok`       — reachable. Also what an admin gets for everything that
 *                exists, the same bypass `isDocumentReadable` and /api/file
 *                already carry, because the archive is retained for them.
 */

import { z } from 'zod'
import type { KursSoldAs } from '@/types'

/**
 * What a target IS, as a privileged read finds it — identity-free on purpose:
 * this half never sees who is asking, so it cannot leak per-reader data.
 */
export interface LinkTargetOwnership {
  /** The target's own title. Crosses to the browser only on `locked`. */
  title: string
  /** Whether the Kurs that owns it is published — what makes the archive dark. */
  kursPublished: boolean
  /**
   * The Einheit whose entitlement gates the target, and the teaser that sells
   * it. `null` where nothing has to be bought: a Kurs page and an Einheit page
   * are readable without a purchase, and the Einheit page is itself the unlock
   * surface — sending the student there beats any card we could interpose.
   */
  gatedBy: UnitTeaser | null
}

/**
 * The Einheit a locked link offers to unlock, named the way it sells itself.
 *
 * It carries its Kurs as well, because WHAT IS FOR SALE is a property of the
 * Kurs: `soldAs = 'kurs'` means this Einheit cannot be bought on its own, and
 * a card that did not know it would offer a purchase that the checkout route
 * refuses. `kursPriceCents` is dormant in the other case — see
 * `purchasePriceLabel`.
 */
export interface UnitTeaser {
  id: string
  title: string
  description: string | null
  kursId: string
  kursTitle: string
  soldAs: KursSoldAs
  kursPriceCents: number
}

/** Who is asking. Both flags come from the request, never from stored content. */
export interface LinkTargetReader {
  /** `app_metadata.role === 'admin'` — reaches the retained archive. */
  isAdmin: boolean
  /** Holds an entitlement for `gatedBy`. Meaningless when nothing is gated. */
  entitled: boolean
}

const UnitTeaserSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  kursId: z.string(),
  kursTitle: z.string(),
  soldAs: z.enum(['kurs', 'unit']),
  kursPriceCents: z.number().int(),
})

/**
 * The wire shape of a verdict — schema first, type derived, so the client's
 * parse and the server's return can only ever describe the same thing.
 *
 * `strictObject` throughout, matching the document JSON's contract: a field
 * nobody declared is a field nobody vetted, and on a route whose whole job is
 * withholding things, an unnoticed extra key is the failure mode.
 */
export const LinkTargetDescriptorSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('ok') }),
  z.strictObject({ state: z.literal('archived') }),
  z.strictObject({ state: z.literal('missing') }),
  z.strictObject({
    state: z.literal('locked'),
    /** The target's title — the student is told what they would be buying. */
    title: z.string(),
    /** Required: a locked card that cannot name the Einheit has no offer. */
    unit: UnitTeaserSchema,
  }),
])

export type LinkTargetDescriptor = z.infer<typeof LinkTargetDescriptorSchema>

export type LinkTargetState = LinkTargetDescriptor['state']

/** The one verdict that carries an offer with it — what the unlock card shows. */
export type LockedLinkTarget = Extract<LinkTargetDescriptor, { state: 'locked' }>

/**
 * The whole decision, and the whole of what may cross to the browser with it.
 *
 * Deciding the verdict and choosing the payload are ONE function deliberately:
 * every early return here is both „this is the verdict" and „and this is all
 * you are told", so there is no second place where a field could be attached
 * to a verdict that must not carry it.
 *
 * `target` is nullable because that is how a privileged read reports „no such
 * row", and the caller must not have to invent a shape for nothing.
 */
export function describeLinkTarget(
  target: LinkTargetOwnership | null,
  reader: LinkTargetReader
): LinkTargetDescriptor {
  if (!target) return { state: 'missing' }
  if (reader.isAdmin) return { state: 'ok' }
  if (!target.kursPublished) return { state: 'archived' }
  if (target.gatedBy && !reader.entitled) {
    return { state: 'locked', title: target.title, unit: target.gatedBy }
  }
  return { state: 'ok' }
}
