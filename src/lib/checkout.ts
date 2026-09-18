import 'server-only'
import type Stripe from 'stripe'
import { getStripe, STRIPE_UNIT_PRICE_ID, siteUrl } from '@/lib/stripe'

/**
 * What one checkout sells — the single place that turns a Kurs's `sold_as`
 * into a Stripe line item and the metadata both grant handlers read back.
 *
 * TWO PRICING MECHANISMS, DELIBERATELY:
 *
 *   Unit — a fixed Stripe Price (`STRIPE_UNIT_PRICE_ID`). Every Einheit in the
 *          app costs the same, so one Price object says it once and Stripe's
 *          dashboard stays the place it is changed.
 *   Kurs — an inline `price_data` amount from `kurse.price_cents`. Each Kurs
 *          has its own price and the admin edits it in this app; minting a
 *          Stripe Price per Kurs would mean a second store of the same number
 *          that can drift from the column.
 *
 * The metadata is what the success return and the webhook both insert from,
 * and it is the ONLY thing that says which of the two a session was — a
 * session carries either `unit_id` or `kurs_id`, never both, mirroring
 * `entitlements_target_check`.
 */
export type CheckoutTarget =
  | { kind: 'unit'; unitId: string; kursId: string; title: string }
  | { kind: 'kurs'; kursId: string; title: string; priceCents: number }

export async function createCheckoutSession(
  target: CheckoutTarget,
  user: { id: string; email?: string | null },
): Promise<Stripe.Checkout.Session> {
  // Inferred, not annotated: the SDK's param namespace is not reachable from
  // the default `Stripe` type export, and both branches are accepted by
  // `line_items` on their own shape.
  const lineItem =
    target.kind === 'unit'
      ? { price: STRIPE_UNIT_PRICE_ID(), quantity: 1 }
      : {
          quantity: 1,
          price_data: {
            currency: 'eur',
            unit_amount: target.priceCents,
            product_data: { name: target.title },
          },
        }

  // Where the buyer lands when they abandon or come back: the Einheit they
  // tried to open, or — for a whole Kurs — the Kurs page they bought it from.
  const cancelPath =
    target.kind === 'unit'
      ? `/kurse/${target.kursId}/units/${target.unitId}?canceled=1`
      : `/kurse/${target.kursId}?canceled=1`

  return getStripe().checkout.sessions.create({
    mode: 'payment',
    line_items: [lineItem],
    client_reference_id: user.id,
    customer_email: user.email ?? undefined,
    metadata:
      target.kind === 'unit'
        ? { user_id: user.id, unit_id: target.unitId }
        : { user_id: user.id, kurs_id: target.kursId },
    success_url: `${siteUrl()}/api/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl()}${cancelPath}`,
    // Customers should always pay in their own session; allow promo codes for
    // future flexibility without round-tripping through Stripe.
    allow_promotion_codes: true,
  })
}

/**
 * The entitlement row a paid session grants, read back from its metadata.
 *
 * `null` means the session is not one of ours (or lost its metadata), which
 * both handlers treat as unrecoverable rather than guessing.
 */
export function entitlementFromMetadata(
  metadata: Stripe.Metadata | null,
): { userId: string; unitId: string | null; kursId: string | null } | null {
  const userId = metadata?.['user_id'] ?? null
  const unitId = metadata?.['unit_id'] ?? null
  const kursId = metadata?.['kurs_id'] ?? null
  // Exactly one target, the same rule the CHECK constraint enforces.
  if (!userId || Boolean(unitId) === Boolean(kursId)) return null
  return { userId, unitId, kursId }
}
