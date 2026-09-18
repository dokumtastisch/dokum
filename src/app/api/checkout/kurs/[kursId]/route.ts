import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createCheckoutSession } from '@/lib/checkout'
import { getEntitlementScope } from '@/lib/dal'

// POST /api/checkout/kurs/[kursId]
// The whole-Kurs counterpart of /api/checkout/[unitId]: one payment for every
// Einheit in the Kurs, including the ones added after the sale (the grant is a
// single `entitlements` row carrying `kurs_id` — add_kurs_entitlements.sql).
//
// The two segments cannot collide: `[unitId]` matches one segment, this route
// two.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ kursId: string }> },
) {
  const { kursId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    const back = new URL('/auth/login', request.url)
    back.searchParams.set('notice', 'sign-in-to-buy-kurs')
    return NextResponse.redirect(back, { status: 303 })
  }

  // RLS keeps `kurse` readable while it is published, so an unpublished or
  // unknown Kurs is a 404 here rather than a checkout for something nobody
  // can open.
  const { data: kurs } = await supabase
    .from('kurse')
    .select('id, title, sold_as, price_cents')
    .eq('id', kursId)
    .single()

  if (!kurs) {
    return new NextResponse('Kurs nicht gefunden.', { status: 404 })
  }

  if (kurs.sold_as !== 'kurs') {
    // This Kurs sells its Einheiten one by one; the offer lives on each
    // Einheit's page. Same reasoning as the mirror image in the unit route.
    return NextResponse.redirect(new URL(`/kurse/${kursId}`, request.url), { status: 303 })
  }

  // Already bought — nothing to sell twice. Holding single Einheiten does NOT
  // count: the Kurs is still worth buying for the ones they do not have.
  const { kursIds } = await getEntitlementScope(user.id)

  if (kursIds.has(kursId)) {
    return NextResponse.redirect(new URL(`/kurse/${kursId}`, request.url), { status: 303 })
  }

  let session
  try {
    session = await createCheckoutSession(
      {
        kind: 'kurs',
        kursId,
        title: kurs.title as string,
        priceCents: kurs.price_cents as number,
      },
      user,
    )
  } catch (err) {
    console.error('[checkout/kurs] stripe.checkout.sessions.create failed', err)
    return new NextResponse('Bezahlung konnte nicht gestartet werden.', { status: 500 })
  }

  if (!session.url) {
    return new NextResponse('Stripe lieferte keine Checkout-URL.', { status: 502 })
  }

  return NextResponse.redirect(session.url, { status: 303 })
}
