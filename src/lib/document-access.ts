import type { DocumentWithAncestry } from '@/types'

/**
 * May this reader see this Dokument? Pure and free of `server-only` so it can
 * be tested directly; the loading half lives in `document-surface.ts`.
 *
 * THIS IS THE WHOLE APP-LEVEL RULE AND IT ADDS NO NEW WAY TO READ CONTENT.
 * Entitlement is RLS's job — `documents` SELECT already requires a purchase
 * for the owning Unit (or admin), so an unentitled reader's query returns
 * nothing and arrives here as `null`. Since #80 the same policy also requires
 * the parent Kurs to be published, so an archived Kurs arrives as `null` too.
 *
 * This check therefore no longer *creates* the archive rule for a non-admin —
 * it restates it one layer up, exactly as /api/file and /api/image do. Keep
 * it: it is the app's only executable statement of the rule, and `npm test`
 * cannot reach the policy that now also enforces it (only
 * supabase/checks/rls_published_conjunct_check.sql can). Deleting it would
 * leave the archive resting on RLS alone, silently.
 *
 * The `isAdmin` arm is not redundant and never was: admin SELECT policies are
 * unconditional, so an admin DOES receive the row for an archived Kurs, and
 * this is where "an admin may still open it" is said.
 *
 * The view is nullable on purpose. Unknown id, no entitlement and archived
 * Kurs must be indistinguishable to the reader, so they collapse into one
 * `false` here rather than into three branches at two call sites.
 */
export function isDocumentReadable(
  view: DocumentWithAncestry | null,
  isAdmin: boolean
): view is DocumentWithAncestry {
  if (!view) return false
  return isAdmin || view.kurs.published
}
