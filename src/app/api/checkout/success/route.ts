import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getStripe } from '@/lib/stripe'
import { entitlementFromMetadata } from '@/lib/checkout'
import { logAuditWith } from '@/lib/audit'

// GET /api/checkout/success?session_id=cs_test_...
// Stripe redirects the buyer here after a successful checkout. We retrieve the
// session, eager-insert the entitlement (idempotent — UNIQUE on stripe_session_id),
// and bounce the buyer to the unit page. The webhook is the source of truth and
// will run too; this handler exists to make the unlock instant for the buyer.
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('session_id')
  if (!sessionId) {
    return NextResponse.redirect(new URL('/', request.url), { status: 303 })
  }

  const stripe = getStripe()
  let session
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId)
  } catch (err) {
    console.error('[checkout/success] sessions.retrieve failed', err)
    return new NextResponse('Sitzung konnte nicht überprüft werden.', { status: 502 })
  }

  if (session.payment_status !== 'paid') {
    // Async payment methods (SEPA, Klarna, etc.) may still be pending; the
    // webhook will grant access once it settles.
    return NextResponse.redirect(new URL('/kurse?pending=1', request.url), { status: 303 })
  }

  // Either a Unit or a Kurs was bought — the metadata says which, and saying
  // neither or both is unrecoverable rather than a thing to guess about.
  const grant = entitlementFromMetadata(session.metadata)
  if (!grant) {
    console.error('[checkout/success] missing or ambiguous metadata on session', { sessionId })
    return new NextResponse('Sitzungs-Metadaten unvollständig.', { status: 500 })
  }
  const { userId, unitId, kursId } = grant

  const service = createServiceClient()

  // Idempotent insert. The UNIQUE index on stripe_session_id (where not null)
  // guarantees a single entitlement per checkout session, even if both the
  // success-return and the webhook race.
  const { error: insertErr } = await service
    .from('entitlements')
    .insert({
      user_id: userId,
      unit_id: unitId,
      kurs_id: kursId,
      source: 'purchase',
      stripe_session_id: sessionId,
    })

  // Code 23505 = unique_violation. Treat as already-granted (the webhook beat us).
  if (insertErr && insertErr.code !== '23505') {
    console.error('[checkout/success] entitlement insert failed', insertErr)
    return new NextResponse('Freischaltung fehlgeschlagen.', { status: 500 })
  }

  if (!insertErr) {
    await logAuditWith(service, {
      actorId: userId,
      action: 'grant',
      entityType: 'entitlement',
      entityId: unitId ?? kursId!,
      metadata: {
        source: 'purchase',
        scope: unitId ? 'unit' : 'kurs',
        stripe_session_id: sessionId,
        via: 'success_return',
      },
    })
  }

  // Where the buyer lands: the Einheit they just unlocked, or — for a whole
  // Kurs — its front page, from which every Einheit is now open.
  if (kursId) {
    return NextResponse.redirect(
      new URL(`/kurse/${kursId}?purchased=1`, request.url),
      { status: 303 },
    )
  }

  // Look up parent kurs to redirect cleanly into the now-unlocked unit.
  const { data: unit } = await service
    .from('units')
    .select('kurs_id')
    .eq('id', unitId!)
    .single()

  const target = unit
    ? new URL(`/kurse/${unit.kurs_id}/units/${unitId}?purchased=1`, request.url)
    : new URL('/', request.url)

  return NextResponse.redirect(target, { status: 303 })
}
