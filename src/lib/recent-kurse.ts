/**
 * The „recently viewed" cookie behind the catalogue's second list.
 *
 * A cookie and not localStorage, for the same reason `recent_minicases` is one:
 * the catalogue renders on the server, so the list has to be readable there —
 * otherwise the section would pop in after hydration.
 *
 * It holds nothing but ids. Titles, types and counts are looked up in the Kurs
 * payload the page already has, which is also what makes a Kurs that was
 * unpublished or deleted in the meantime drop out of the list by itself.
 */
export const RECENT_KURSE_COOKIE = 'recent_kurse'

/** Four rows — the height the section had with mini cases in it. */
export const MAX_RECENT_KURSE = 4

export const RECENT_KURSE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

export function parseRecentKursIds(raw: string | undefined): string[] {
  return raw ? decodeURIComponent(raw).split(',').filter(Boolean) : []
}
