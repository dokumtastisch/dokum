import type { LinkTargetKind } from '@/lib/editor/links'

export const STORAGE_BUCKET = 'pdfs'

export const MAX_FILE_SIZE_BYTES = 4 * 1024 * 1024 // 4 MB

export const SIGNED_URL_EXPIRY_SECONDS = 60

// Flat per-Unit price. MUST match the unit_amount of the Stripe Price referenced
// by STRIPE_UNIT_PRICE_ID — change both together. Currency is EUR.
export const UNIT_PRICE_CENTS = 300
export const UNIT_PRICE_CURRENCY = 'EUR' as const
export const UNIT_PRICE_DISPLAY = '€3'

/** Stripe refuses a Checkout Session below its minimum charge for EUR. */
export const MIN_PRICE_CENTS = 50

/**
 * A price for a badge or a button — „€15", „€12.50".
 *
 * Deliberately not `Intl.NumberFormat`: this runs on the server and in the
 * browser, and a locale-aware formatter would put „15,00 €" in the German
 * admin and „€15.00" in the English student UI for one and the same number.
 * The price shown to a buyer must not depend on where it was rendered.
 */
export function formatPriceEur(cents: number): string {
  return cents % 100 === 0 ? `€${cents / 100}` : `€${(cents / 100).toFixed(2)}`
}

export const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const

export const ALLOWED_FILE_MIMES = ['application/pdf', ...ALLOWED_IMAGE_MIMES] as const

export const MIME_TO_EXT: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
}

// Browser URL of a stored editor image (PRD #28, slice 8) — the streaming
// signed-URL proxy route. Single source for the path so the controller, the
// JSON importer wiring and the route itself cannot drift apart.
export function editorImageUrl(imageId: string): string {
  return `/api/editor-image/${imageId}`
}

// The addressable URL of a single Dokument (#69) — the thing a student
// bookmarks or sends to a classmate. Deliberately FLAT: a link stores the
// target's document id and nothing else (#63 §6), so the URL needs no Kurs or
// Unit in it, and a top-level segment is also the shape the overlay's
// intercepting route needs (#70).
//
// `anchorId` puts a Sprungmarke in the fragment (#73). A fragment rather than a
// query parameter because the spot inside a document is a client-side concern:
// it never reaches the server, so neither route re-renders for it, and both the
// full page and the overlay resolve it against the DOM they have already built.
// It is percent-encoded because an anchor id is opaque — the schema asks only
// that it be non-empty (anchors.ts).
export function documentUrl(docId: string, anchorId?: string): string {
  const base = `/dokumente/${docId}`
  return anchorId ? `${base}#${encodeURIComponent(anchorId)}` : base
}

// The Kurs a link points at (#73) — the existing public Kurs page.
export function kursUrl(kursId: string): string {
  return `/kurse/${kursId}`
}

// The Einheit a link points at (#73), FLAT for the same reason `documentUrl`
// is: a link stores `{ unitId }` and nothing else, while the Einheit page lives
// under its Kurs. This URL is the redirect that supplies the missing half, so
// following an Einheit link needs no client-side lookup of its Kurs.
export function unitUrl(unitId: string): string {
  return `/einheiten/${unitId}`
}

// The resolver a rendered link chip asks whether its target is still reachable
// (#74). Kind and id both ride in the path, mirroring the file proxies: this is
// a read of one named thing, not a query.
//
// It answers with a verdict and, for a locked target, the Einheit that unlocks
// it — never content. The route is the only caller of the DAL's one
// RLS-bypassing read, and `describeLinkTarget` is what decides how much of it
// may cross.
// The id is percent-encoded even though the route rejects anything that is not
// a uuid: it is read off a chip's dataset in the browser, and a value that
// could climb out of its path segment must not be able to address a different
// route on the way to being refused.
export function linkTargetUrl(kind: LinkTargetKind, id: string): string {
  return `/api/link-target/${kind}/${encodeURIComponent(id)}`
}
