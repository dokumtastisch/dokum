'use server'

import { STORAGE_BUCKET, MAX_FILE_SIZE_BYTES } from '@/lib/constants'
import { readDocumentJson } from '@/lib/editor/document-version'
import { planPublish, type PublishPlan, type StoredImageRef } from '@/lib/editor/publish-plan'
import { EditorPublishSchema } from '@/lib/schemas'
import type { ActionResult } from '@/types'
import { logAdminAction } from '@/lib/audit'
import { getAdminUser, parseForm, revalidateAdminPages, sanitise, removeStorageObjects } from './_shared'

/**
 * Publishes an editor draft as a Document (PRD #28, slice 11 — #39; extended
 * to the interactive dual-write in #66).
 *
 * The Document row is DUAL-WRITTEN: title, `file_type = 'interactive'`, the
 * validated content JSON and the PNG path all land in ONE statement. The
 * student renderer prefers the JSON and falls back to the PNG inside an error
 * boundary — a genuine per-document safety net for the release where the
 * renderer is unproven, not a feature flag. Once proven, a cleanup pass nulls
 * the file path and drops the PNGs with no code rewrite.
 *
 * The snapshot is read from the DRAFT ROW, not from the request: publish
 * implies save (the ExportBar saves before exporting), so the stored draft is
 * the authoritative thing to publish and the PNG can never diverge from it.
 * An unreadable draft is refused rather than published half-understood.
 *
 * IMAGES ARE COPIED, NEVER MOVED. `editor_images` rows cascade with their
 * draft and the draft must stay editable and re-publishable, so a published
 * document that pointed at draft images would blank out the moment its draft
 * was deleted. The ordering — copy, insert rows, swap in one statement, then
 * delete the previous publish's rows and objects — is the same ordering this
 * action already used for the PNG: fail before the swap and only orphans
 * exist while the live document is untouched; fail during cleanup and only
 * stale objects remain while the document is correct. The decisions are made
 * up front by the pure `planPublish` (publish-plan.ts); this action only
 * executes them.
 *
 * `mode: 'update'` (default) updates the linked Document in place when a live
 * link exists — task_id/description/position/TITLE stay untouched ("in place"
 * = same place; relocation is „Als neues Dokument" + manual delete). Students
 * keep the same Document entry (story 32) and the id never changes, so
 * bookmarks and future links to it stay valid.
 *
 * The title is deliberately excluded from the in-place update (#85). It is
 * derived from the ExportBar's „Dateiname" field, which is NOT persisted with
 * the draft and resets to its default on every reload — so re-publishing after
 * a reload (fix a typo → reopen the draft → update, i.e. the normal editing
 * loop) silently renamed live student-facing content. First publish still
 * seeds the title from the filename (story 27, no separate title input);
 * renaming afterwards goes through `updateDocument`, which #82 keeps expressly
 * as the rename path for interactive documents. When the link is dead
 * (Document deleted → FK SET NULL, or lost in a race) the same call falls
 * back to creating a new Document. `mode: 'new'` („Als neues Dokument")
 * always creates and RE-LINKS the draft.
 *
 * The draft row is not touched on update-in-place (its updated_at must not
 * reorder the draft list); on the create paths only published_document_id
 * changes — a failed link update rolls the whole publish back, because an
 * unlinked publish would silently duplicate on the next one.
 */
export async function publishEditorDraft(
  formData: FormData
): Promise<ActionResult<{ documentId: string; mode: 'created' | 'updated' }>> {
  const { supabase, user } = await getAdminUser()

  const parsed = parseForm(EditorPublishSchema, formData, ['draft_id', 'task_id', 'title', 'mode'])
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const { draft_id, task_id, title, mode } = parsed.data

  // The PNG itself — validated manually (documents.ts precedent). The size
  // re-check backs the client-side pre-check (ExportBar); an honest client
  // never sends an oversized request.
  const file = formData.get('file') as File | null
  if (!file || file.size === 0) return { ok: false, error: 'Kein PNG übermittelt.' }
  if (file.type !== 'image/png') {
    return { ok: false, error: 'Nur PNG-Dateien können veröffentlicht werden.' }
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      ok: false,
      error: `Das PNG ist zu groß (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximal 4 MB.`,
    }
  }

  const { data: draft, error: draftErr } = await supabase
    .from('editor_documents')
    .select('id, content, published_document_id')
    .eq('id', draft_id)
    .single()
  if (draftErr || !draft) return { ok: false, error: 'Entwurf nicht gefunden.' }

  // Upgrade-on-read (#64): the stored draft may carry any supported version;
  // what gets published is always the newest. A snapshot that cannot be read
  // is refused whole — publishing a half-understood document would hand a
  // paying student a document missing whatever the reader did not recognise.
  const snapshot = readDocumentJson(draft.content)
  if (!snapshot.ok) {
    return { ok: false, error: `Entwurf konnte nicht veröffentlicht werden: ${snapshot.error}` }
  }

  const { data: draftImages, error: draftImgErr } = await supabase
    .from('editor_images')
    .select('id, file_path')
    .eq('editor_document_id', draft_id)
  if (draftImgErr) {
    return { ok: false, error: `Bilder des Entwurfs konnten nicht gelesen werden: ${draftImgErr.message}` }
  }

  // ── Resolve the target: update in place, or create ────────────────────────
  let target: { id: string; file_path: string | null; title: string } | null = null
  if (mode === 'update' && draft.published_document_id) {
    const { data: linkedDoc, error: linkedErr } = await supabase
      .from('documents')
      .select('id, file_path, title')
      .eq('id', draft.published_document_id)
      .single()

    // Only a genuine "no rows" (PGRST116) means the link is dead and we may
    // fall through to create. A transient read error must NOT be mistaken for
    // a deleted link — falling through would create a duplicate Document and
    // orphan the still-live original.
    if (linkedErr && linkedErr.code !== 'PGRST116') {
      return {
        ok: false,
        error: `Verknüpftes Dokument konnte nicht gelesen werden: ${linkedErr.message}`,
      }
    }
    target = linkedDoc ?? null
  }

  // The previous publish's copies — the only rows and objects this publish is
  // allowed to delete, and only after the swap succeeds.
  let previousImages: StoredImageRef[] = []
  if (target) {
    const { data, error } = await supabase
      .from('document_images')
      .select('id, file_path')
      .eq('document_id', target.id)
    if (error) {
      return { ok: false, error: `Bilder des Dokuments konnten nicht gelesen werden: ${error.message}` }
    }
    previousImages = data ?? []
  }

  const stamp = Date.now()
  const planned = planPublish({
    content: snapshot.doc,
    draftImages: draftImages ?? [],
    previousImages,
    mintImageId: () => crypto.randomUUID(),
    mintImagePath: ({ fromPath, index }) =>
      `documents/${user.id}/${stamp}-${index}-${sanitise(title, 40)}${extensionOf(fromPath)}`,
  })
  if (!planned.ok) return { ok: false, error: planned.error }
  const plan = planned.plan

  // ── Step 1: build everything new (nothing live is touched yet) ────────────
  const pngPath = `documents/${user.id}/${stamp}-${sanitise(title)}.png`

  const { error: uploadErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(pngPath, file, { contentType: 'image/png', upsert: false })
  if (uploadErr) return { ok: false, error: `Upload fehlgeschlagen: ${uploadErr.message}` }

  const freshPaths: string[] = [pngPath]
  for (const copy of plan.copies) {
    const { error } = await supabase.storage.from(STORAGE_BUCKET).copy(copy.fromPath, copy.toPath)
    if (error) {
      await removeStorageObjects(supabase, freshPaths, 'publishEditorDraft image-copy rollback')
      return { ok: false, error: `Bild konnte nicht übernommen werden: ${error.message}` }
    }
    freshPaths.push(copy.toPath)
  }

  // ── Update-in-place path ──────────────────────────────────────────────────
  if (target) {
    // Step 2: the new document-image rows. They hang off the live Document
    // while the swap is still pending, which is harmless — an interactive
    // document does not render document_images, only its content JSON does.
    const insertErr = await insertPlannedImages(supabase, plan, target.id)
    if (insertErr) {
      await removeStorageObjects(supabase, freshPaths, 'publishEditorDraft image-row rollback')
      return { ok: false, error: `Bilder konnten nicht gespeichert werden: ${insertErr}` }
    }

    // Step 4: THE SWAP — content and file path in one statement. `title` is
    // deliberately NOT in this update (#85, see the header): the existing
    // document keeps the name students already see.
    const { error: dbErr } = await supabase
      .from('documents')
      .update({ file_path: pngPath, file_type: 'interactive', content: plan.content })
      .eq('id', target.id)
    if (dbErr) {
      await deleteImageRows(supabase, plan.inserts.map((r) => r.id), 'publishEditorDraft swap rollback')
      await removeStorageObjects(supabase, freshPaths, 'publishEditorDraft swap rollback')
      return { ok: false, error: `Dokument konnte nicht aktualisiert werden: ${dbErr.message}` }
    }

    // Step 5: the previous publish, last. Everything from here on is
    // best-effort — the document is already correct, and a failure leaves
    // only stale objects behind.
    await deleteImageRows(supabase, plan.stale.imageIds, 'publishEditorDraft stale-row cleanup')
    await removeStorageObjects(supabase, plan.stale.paths, 'publishEditorDraft stale-image cleanup')
    if (target.file_path) {
      await removeStorageObjects(supabase, [target.file_path], 'publishEditorDraft old-file cleanup')
    }

    await logAdminAction({
      actorId: user.id,
      action: 'update',
      entityType: 'document',
      entityId: target.id,
      // The document's OWN title — the submitted one only named the upload.
      entityTitle: target.title,
      metadata: {
        editor_document_id: draft_id,
        published_in_place: true,
        file_type: 'interactive',
        images_rehomed: plan.copies.length,
        images_retired: plan.stale.imageIds.length,
      },
    })
    revalidateAdminPages()
    return { ok: true, data: { documentId: target.id, mode: 'updated' } }
  }

  // ── Create path (first publish, „Als neues Dokument", dead-link fallback) ──
  const { data: insertedDoc, error: docInsertErr } = await supabase
    .from('documents')
    .insert({
      task_id,
      title,
      description: null,
      file_path: pngPath,
      file_type: 'interactive',
      content: plan.content,
      position: 0,
    })
    .select('id')
    .single()
  if (docInsertErr || !insertedDoc) {
    await removeStorageObjects(supabase, freshPaths, 'publishEditorDraft create rollback')
    return {
      ok: false,
      error: `Dokument konnte nicht angelegt werden: ${docInsertErr?.message ?? 'Unbekannter Fehler'}`,
    }
  }

  const imgErr = await insertPlannedImages(supabase, plan, insertedDoc.id)
  if (imgErr) {
    await rollbackCreatedDocument(supabase, insertedDoc.id, freshPaths, 'publishEditorDraft image-row rollback')
    return { ok: false, error: `Bilder konnten nicht gespeichert werden: ${imgErr}` }
  }

  const { error: linkErr } = await supabase
    .from('editor_documents')
    .update({ published_document_id: insertedDoc.id })
    .eq('id', draft_id)
  if (linkErr) {
    // Full rollback: an unlinked Document would duplicate on the next publish.
    // The image rows go with it through the document_id cascade.
    await rollbackCreatedDocument(supabase, insertedDoc.id, freshPaths, 'publishEditorDraft link rollback')
    return {
      ok: false,
      error: `Entwurf konnte nicht mit dem Dokument verknüpft werden: ${linkErr.message}`,
    }
  }

  await logAdminAction({
    actorId: user.id,
    action: 'create',
    entityType: 'document',
    entityId: insertedDoc.id,
    entityTitle: title,
    metadata: {
      editor_document_id: draft_id,
      file_type: 'interactive',
      images_rehomed: plan.copies.length,
    },
  })
  // The link change is a draft mutation of its own (operator story 35).
  await logAdminAction({
    actorId: user.id,
    action: 'update',
    entityType: 'editor_document',
    entityId: draft_id,
    metadata: { published_document_id: insertedDoc.id },
  })
  revalidateAdminPages()
  return { ok: true, data: { documentId: insertedDoc.id, mode: 'created' } }
}

// ── Internal helpers ─────────────────────────────────────────────────────────

type SupabaseClient = Awaited<ReturnType<typeof getAdminUser>>['supabase']

/** `.png` / `.jpg` / … of a storage path; empty when it carries no extension. */
function extensionOf(path: string): string {
  const match = /\.[a-zA-Z0-9]+$/.exec(path)
  return match ? match[0] : ''
}

/**
 * Inserts the planned `document_images` rows with the ids the plan already
 * rewrote the snapshot to. Returns an error message, or null on success (and
 * on an empty plan).
 */
async function insertPlannedImages(
  supabase: SupabaseClient,
  plan: PublishPlan,
  documentId: string
): Promise<string | null> {
  if (plan.inserts.length === 0) return null
  const { error } = await supabase
    .from('document_images')
    .insert(plan.inserts.map((row) => ({ ...row, document_id: documentId })))
  return error ? error.message : null
}

async function deleteImageRows(
  supabase: SupabaseClient,
  ids: string[],
  context: string
): Promise<void> {
  if (ids.length === 0) return
  const { error } = await supabase.from('document_images').delete().in('id', ids)
  if (error) console.error(`[${context}] document_images delete failed:`, error)
}

async function rollbackCreatedDocument(
  supabase: SupabaseClient,
  documentId: string,
  paths: string[],
  context: string
): Promise<void> {
  const { error } = await supabase.from('documents').delete().eq('id', documentId)
  if (error) console.error(`[${context}] document delete failed:`, error)
  await removeStorageObjects(supabase, paths, context)
}
