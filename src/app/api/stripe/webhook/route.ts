import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { createServiceClient } from '@/lib/supabase/service'
import { getStripe, STRIPE_WEBHOOK_SECRET } from '@/lib/stripe'
import { entitlementFromMetadata } from '@/lib/checkout'
import { logAuditWith } from '@/lib/audit'

// Stripe sends the raw body; signature verification fails if Next pre-parses it.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/stripe/webhook
// Handles Stripe events. Currently only checkout.session.completed matters —
// we insert the entitlement (idempotent) and audit-log the grant.
export async function POST(request: NextRequest) {
  const sig = request.headers.get('stripe-signature')
  if (!sig) {
    return new NextResponse('Missing stripe-signature header', { status: 400 })
  }

  const rawBody = await request.text()

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET())
  } catch (err) {
    console.error('[stripe/webhook] signature verification failed', err)
    return new NextResponse('Invalid signature', { status: 400 })
  }

  if (event.type !== 'checkout.session.completed') {
    // Acknowledge other event types so Stripe stops retrying them.
    return NextResponse.json({ received: true, ignored: event.type })
  }

  const session = event.data.object as Stripe.Checkout.Session
  if (session.payment_status !== 'paid') {
    return NextResponse.json({ received: true, ignored: 'unpaid_session' })
  }

  const grant = entitlementFromMetadata(session.metadata)
  if (!grant) {
    console.error('[stripe/webhook] missing or ambiguous metadata on session', { sessionId: session.id })
    // 200 so Stripe doesn't endlessly retry an unrecoverable event.
    return NextResponse.json({ received: true, error: 'missing_metadata' })
  }
  const { userId, unitId, kursId } = grant

  const service = createServiceClient()

  const { error: insertErr } = await service
    .from('entitlements')
    .insert({
      user_id: userId,
      unit_id: unitId,
      kurs_id: kursId,
      source: 'purchase',
      stripe_session_id: session.id,
    })

  if (insertErr && insertErr.code !== '23505') {
    console.error('[stripe/webhook] entitlement insert failed', insertErr)
    // 500 → Stripe will retry, which is what we want for transient DB failures.
    return new NextResponse('Insert failed', { status: 500 })
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
        stripe_session_id: session.id,
        via: 'webhook',
      },
    })
  }

  return NextResponse.json({ received: true })
}
