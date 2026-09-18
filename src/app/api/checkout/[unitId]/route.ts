import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createCheckoutSession } from '@/lib/checkout'
import { getEntitlementScope } from '@/lib/dal'

// POST /api/checkout/[unitId]
// Creates a Stripe Checkout Session for a single Einheit and 303-redirects the
// browser to Stripe's hosted checkout page.
//
// The sibling route /api/checkout/kurs/[kursId] sells a whole Kurs. Which of
// the two a Kurs uses is `kurse.sold_as`, and this handler REFUSES to sell an
// Einheit out of a Kurs sold as a whole: the button that posts here is server
// rendered from the same column, so a request that disagrees with it is a
// stale page or a hand-rolled POST — and honouring it would sell one Einheit
// of something that is only for sale entire.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ unitId: string }> },
) {
  const { unitId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    const back = new URL('/auth/login', request.url)
    back.searchParams.set('notice', 'sign-in-to-buy-unit')
    return NextResponse.redirect(back, { status: 303 })
  }

  // Resolve the unit (RLS keeps this readable as long as the parent Kurs is
  // published; non-existent or unpublished units return null → 404).
  const { data: unit } = await supabase
    .from('units')
    .select('id, kurs_id, title, kurse!inner(sold_as)')
    .eq('id', unitId)
    .single()

  if (!unit) {
    return new NextResponse('Unit nicht gefunden.', { status: 404 })
  }

  const kurs = unit.kurse as unknown as { sold_as: string }
  if (kurs.sold_as === 'kurs') {
    // Not an error the buyer caused — send them to the Kurs page, which is
    // where the whole-Kurs offer lives.
    return NextResponse.redirect(
      new URL(`/kurse/${unit.kurs_id}`, request.url),
      { status: 303 },
    )
  }

  // If already entitled, skip checkout and bounce straight to the unit. Both
  // grants count: an admin may have handed out a Kurs grant for a Kurs that
  // otherwise sells its Einheiten one by one, and charging for something the
  // buyer can already open would be the worst kind of bug to find out about
  // from a customer.
  const { unitIds, kursIds } = await getEntitlementScope(user.id)

  if (unitIds.has(unitId) || kursIds.has(unit.kurs_id as string)) {
    return NextResponse.redirect(
      new URL(`/kurse/${unit.kurs_id}/units/${unitId}`, request.url),
      { status: 303 },
    )
  }

  let session
  try {
    session = await createCheckoutSession(
      { kind: 'unit', unitId, kursId: unit.kurs_id as string, title: unit.title as string },
      user,
    )
  } catch (err) {
    console.error('[checkout] stripe.checkout.sessions.create failed', err)
    return new NextResponse('Bezahlung konnte nicht gestartet werden.', { status: 500 })
  }

  if (!session.url) {
    return new NextResponse('Stripe lieferte keine Checkout-URL.', { status: 502 })
  }

  return NextResponse.redirect(session.url, { status: 303 })
}
