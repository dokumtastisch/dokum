'use server'

import { getBacklinkScanRows } from '@/lib/dal'
import { findDocumentBacklinks, type BacklinkCandidate, type BacklinkScan } from '@/lib/editor/backlinks'
import { readDocumentJson } from '@/lib/editor/document-version'
import { BacklinkScanSchema } from '@/lib/schemas'
import type { ActionResult } from '@/types'
import { getAdminUser } from './_shared'

/**
 * What links to a Dokument, scanned on demand (#75, spec #63 §6).
 *
 * Backs both warnings: deleting a Dokument something points at, and publishing
 * „Als neues Dokument", the one publish path that mints a new Document id and
 * leaves inbound links on the old one. ONE scan, two call sites — a second
 * implementation would be a second answer.
 *
 * A READ through a server action rather than a route handler, for the same
 * reasons as `listLinkTargetDocuments`: admin-only, no cacheable URL worth
 * having, and `getAdminUser()` is the defence-in-depth check every admin action
 * starts with. It mutates nothing, so there is no audit entry and no
 * revalidation.
 *
 * The whole catalogue's content is parsed HERE and only the source names
 * travel on — no document content ever crosses the boundary.
 *
 * ⚠ THE TWO WAYS TO SEE NOTHING ARE KEPT APART. A snapshot this build cannot
 * parse is counted into `unreadable` rather than dropped, and a failed QUERY
 * returns `{ ok: false }` rather than an empty list. Both would otherwise read
 * as „nothing links here" and delete a linked document without a word — the
 * mistake #74 had to correct on the resolver route. Neither BLOCKS the delete:
 * the caller says what it could not check and lets the admin decide.
 */
export async function scanDocumentBacklinks(docId: string): Promise<ActionResult<BacklinkScan>> {
  await getAdminUser()

  const parsed = BacklinkScanSchema.safeParse({ document_id: docId })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]!.message }
  }

  try {
    const rows = await getBacklinkScanRows()
    const candidates: BacklinkCandidate[] = []
    let unreadable = 0
    for (const row of rows) {
      const doc = readDocumentJson(row.content)
      if (!doc.ok) {
        unreadable++
        continue
      }
      candidates.push({ kind: row.kind, id: row.id, title: row.title, content: doc.doc })
    }
    return {
      ok: true,
      data: { links: findDocumentBacklinks(candidates, parsed.data.document_id), unreadable },
    }
  } catch (err) {
    console.error('[scanDocumentBacklinks] scan failed:', err)
    return { ok: false, error: 'Verweise konnten nicht geprüft werden.' }
  }
}
