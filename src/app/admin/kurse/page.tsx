import { redirect } from 'next/navigation'

/**
 * The Kurs list moved to `/admin`, which is where the admin now starts. This
 * route stays as a redirect rather than being deleted, because bookmarks and
 * the older links in this repo's history point at it.
 *
 * Only the exact path redirects — `/admin/kurse/[kursId]`, the course
 * workspace, is a different route and keeps working.
 */
export default function AdminKursePage() {
  redirect('/admin')
}
