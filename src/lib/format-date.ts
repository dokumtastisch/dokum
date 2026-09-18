/**
 * Dates as the German admin surface shows them (#108).
 *
 * ⚠ FORMATTED ON THE SERVER, WITH AN EXPLICIT TIME ZONE — and both halves of
 * that matter. Without a fixed zone, the server renders the date in the
 * container's locale (UTC in practice) and the browser re-renders it in the
 * reader's, so a Kurs created at 23:30 shows one day in the HTML and another
 * after hydration: a mismatch React warns about and a reader would simply read
 * as a wrong date. Pinning the zone makes both sides agree.
 *
 * The zone is the one the courses are authored in, not the reader's. For an
 * admin list that is the right answer: „created yesterday" should mean
 * yesterday to the person who created it.
 */
const ADMIN_TIME_ZONE = 'Europe/Vienna'

const dateFormatter = new Intl.DateTimeFormat('de-AT', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: ADMIN_TIME_ZONE,
})

/**
 * `2026-08-11T09:12:00Z` → `11.08.2026`.
 *
 * An unparseable timestamp yields '' rather than „Invalid Date": the column is
 * incidental information, and a broken value there must not shout louder than
 * the Kurs it belongs to.
 */
export function formatAdminDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : dateFormatter.format(date)
}
