import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getLinkTargetOwnership, userHasUnitAccess } from '@/lib/dal'
import { describeLinkTarget } from '@/lib/link-target-state'
import { createClient } from '@/lib/supabase/server'

/**
 * The link resolver (#74) — „is this link's target still reachable, and if not,
 * why", answered as a minimal descriptor and nothing more.
 *
 * A THIN SHELL, deliberately: auth, then one identity-free privileged read
 * (`getLinkTargetOwnership`), then one entitlement read under the reader's own
 * RLS, then the pure decision. Everything about who may be told what lives in
 * `describeLinkTarget`, which is where it can be unit-tested as the paywall
 * rule it is.
 *
 * It mirrors the file proxies rather than inventing an access shape: same
 * authentication requirement, same `app_metadata.role` admin bypass, and the
 * same rule that the answer is the least the caller needs. What it never
 * returns is document content, a storage path, or anything at all about a
 * target the reader may not reach.
 *
 * The entitlement is read through the DAL with the READER'S OWN client, not the
 * privileged one: RLS on `entitlements` already restricts it to their own rows,
 * so no plumbing mistake here can hand someone another student's access.
 */

const ParamsSchema = z.strictObject({
  kind: z.enum(['kurs', 'unit', 'document']),
  id: z.string().uuid(),
})

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ kind: string; id: string }> }
) {
  const parsed = ParamsSchema.safeParse(await params)
  // A malformed target is a bug in the caller, not a state a student can be
  // in: every chip is built from a validated link node. Answering 400 rather
  // than „missing" keeps that distinction visible instead of dressing it up as
  // a deleted document.
  if (!parsed.success) {
    return NextResponse.json({ error: 'Ungültige Link-Referenz.' }, { status: 400 })
  }
  const { kind, id } = parsed.data

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // The proxy already redirects unauthenticated visitors; guard defensively in
  // case its matcher is ever loosened. JSON rather than a redirect — this is
  // only ever fetched, never navigated to.
  if (!user) {
    return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })
  }

  const role = user.app_metadata?.['role'] as string | undefined

  let target
  try {
    target = await getLinkTargetOwnership(kind, id)
  } catch (err) {
    // A read that FAILED is not a target that is GONE. Answering `missing`
    // here would degrade a perfectly live link to plain text over a transient
    // database error; a non-OK status is what the browser half reads as „no
    // verdict", leaving every chip exactly as it was.
    console.error('[link-target] Auflösung fehlgeschlagen:', err)
    return NextResponse.json({ error: 'Link-Ziel konnte nicht aufgelöst werden.' }, { status: 503 })
  }

  // Skipped where nothing is gated — a Kurs and an Einheit cost no purchase to
  // reach, so the query would be asked and thrown away.
  const entitled = target?.gatedBy
    ? await userHasUnitAccess(user.id, target.gatedBy.id, role, target.gatedBy.kursId)
    : false

  const descriptor = describeLinkTarget(target, { isAdmin: role === 'admin', entitled })

  return NextResponse.json(descriptor, {
    // Per-reader by definition — one student's „locked" is another's „ok", and
    // a purchase changes the answer mid-session. Nothing may hold it but the
    // page that asked.
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
