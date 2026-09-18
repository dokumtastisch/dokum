import 'server-only'
import { cache } from 'react'
import { getDocumentWithAncestry } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { isDocumentReadable } from '@/lib/document-access'
import type { DocumentWithAncestry } from '@/types'

export interface DocumentSurface {
  view: DocumentWithAncestry
  /** The reader's watermark — the first 8 characters of their user id. */
  watermarkId: string
}

/**
 * Everything a student surface needs to show one Dokument, or `null` if it may
 * not be shown at all.
 *
 * TWO ROUTES RENDER THE SAME DOCUMENT: the addressable full page (#69) and the
 * intercepted overlay (#70). They must be readable under exactly the same
 * conditions — an overlay that showed a document the full page refuses would
 * be a way to read content, invented by a navigation feature. So the auth
 * read, the access rule and the watermark live here once and neither route
 * re-derives them.
 *
 * `cache` collapses the repeats within a single request: the full page calls
 * this from both `generateMetadata` and the component, and the auth round-trip
 * plus the document query happen once for both.
 */
export const loadDocumentSurface = cache(async (docId: string): Promise<DocumentSurface | null> => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // The proxy already redirects unauthenticated visitors to the login page;
  // guard defensively in case the matcher is ever loosened.
  if (!user) return null

  const isAdmin = user.app_metadata?.['role'] === 'admin'
  const view = await getDocumentWithAncestry(docId)
  if (!isDocumentReadable(view, isAdmin)) return null

  return { view, watermarkId: user.id.slice(0, 8).toUpperCase() }
})
