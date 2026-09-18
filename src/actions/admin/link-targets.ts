'use server'

import { getLinkTargetDocuments } from '@/lib/dal'
import { collectDocumentAnchors } from '@/lib/editor/document-json'
import { readDocumentJson } from '@/lib/editor/document-version'
import { LinkTargetDocumentsSchema } from '@/lib/schemas'
import type { ActionResult, LinkTargetDocument } from '@/types'
import { getAdminUser } from './_shared'

/**
 * The link picker's fourth level (#72), fetched per Task when the author
 * expands it. The Kurs → Einheit → Aufgabe tree ships with the page; this is
 * the one level that does not, because shipping every document id (and, worse,
 * every published snapshot) to the client is exactly what `getEditorTargetTree`
 * was written to avoid.
 *
 * A READ through a server action rather than a route handler: it is
 * admin-only, it has no cacheable URL worth having, and `getAdminUser()` is
 * the same defence-in-depth check every other admin action starts with. It
 * mutates nothing, so there is no audit entry and no revalidation.
 *
 * The published snapshot is parsed HERE and only the Sprungmarken travel on —
 * the content itself never crosses the boundary. A snapshot that cannot be
 * read is not an error: it simply offers no Sprungmarken, and the document
 * stays linkable as a whole. Refusing the whole picker over one unreadable
 * legacy row would be the wrong trade.
 */
export async function listLinkTargetDocuments(
  taskId: string
): Promise<ActionResult<LinkTargetDocument[]>> {
  await getAdminUser()

  const parsed = LinkTargetDocumentsSchema.safeParse({ task_id: taskId })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]!.message }
  }

  try {
    const rows = await getLinkTargetDocuments(parsed.data.task_id)
    return {
      ok: true,
      data: rows.map((row) => ({
        id: row.id,
        title: row.title,
        anchors: anchorsOf(row.content),
      })),
    }
  } catch {
    return { ok: false, error: 'Ziele konnten nicht geladen werden.' }
  }
}

/** Sprungmarken of a stored snapshot; none for a legacy or unreadable row. */
function anchorsOf(content: unknown): LinkTargetDocument['anchors'] {
  if (content === null || content === undefined) return []
  const parsed = readDocumentJson(content)
  return parsed.ok ? collectDocumentAnchors(parsed.doc) : []
}
