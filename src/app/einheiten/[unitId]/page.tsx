import { notFound, redirect } from 'next/navigation'
import { getUnitById } from '@/lib/dal'

interface Props {
  params: Promise<{ unitId: string }>
}

/**
 * The flat URL of one Einheit (#73) — a redirect, and nothing else.
 *
 * IT EXISTS BECAUSE OF WHAT A LINK STORES. An Einheit link carries `{ unitId }`
 * and nothing else (spec #63 §6), while the Einheit itself is shown at
 * `/kurse/[kursId]/units/[unitId]`. Something has to supply the Kurs, and doing
 * it here — one server-side primary-key read — keeps the link chip's href a
 * pure function of the target, with no lookup in the browser and no Kurs id
 * copied into stored content where it could go stale.
 *
 * NO NEW ACCESS SURFACE. The lookup goes through the DAL under the reader's own
 * RLS, where `units` gate on `published`: an unpublished Einheit returns no row
 * and lands on the same 404 an unknown id does. Everything the Einheit page
 * itself enforces — entitlement, the paywall — is enforced there, unchanged,
 * because this hands the student straight to it.
 */
export default async function EinheitLinkPage({ params }: Props) {
  const { unitId } = await params

  const unit = await getUnitById(unitId)
  if (!unit) notFound()

  redirect(`/kurse/${unit.kurs_id}/units/${unitId}`)
}
