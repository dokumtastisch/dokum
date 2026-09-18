'use server'

import { STORAGE_BUCKET, MAX_FILE_SIZE_BYTES, ALLOWED_IMAGE_MIMES, ALLOWED_FILE_MIMES, MIME_TO_EXT } from '@/lib/constants'
import { DocumentMetaSchema, DocumentReorderSchema, DocumentUpdateMetaSchema } from '@/lib/schemas'
import { METADATA_ONLY_FILE_TYPES } from '@/lib/document-view'
import type { ActionResult } from '@/types'
import { logAdminAction } from '@/lib/audit'
import { getAdminUser, parseForm, revalidateAdminPages, collectStoragePaths, sanitise, removeStorageObjects, type DocumentFileRef } from './_shared'

export async function createDocument(formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await getAdminUser()

  const parsed = parseForm(DocumentMetaSchema, formData, ['task_id', 'title', 'description', 'position', 'doc_type'])
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const { task_id, title, description, position, doc_type } = parsed.data

  // ── Image collection branch ──────────────────────────────────────────────
  if (doc_type === 'image_collection') {
    const images = formData.getAll('images') as File[]
    const validImages = images.filter((f) => f.size > 0)
    if (validImages.length === 0) return { ok: false, error: 'At least one image is required.' }

    for (const img of validImages) {
      if (!(ALLOWED_IMAGE_MIMES as readonly string[]).includes(img.type))
        return { ok: false, error: `"${img.name}" ist kein unterstütztes Bildformat (JPEG, PNG, GIF, WebP).` }
      if (img.size > MAX_FILE_SIZE_BYTES)
        return { ok: false, error: `"${img.name}" ist zu groß (${(img.size / 1024 / 1024).toFixed(1)} MB). Maximal 4 MB pro Bild.` }
    }

    const { data: docData, error: insertError } = await supabase
      .from('documents')
      .insert({ task_id, title, description, file_path: null, file_type: 'image_collection', position })
      .select('id')
      .single()
    if (insertError) return { ok: false, error: `Failed to save document: ${insertError.message}` }

    const uploadedPaths: string[] = []
    for (let i = 0; i < validImages.length; i++) {
      const img = validImages[i]
      const ext = MIME_TO_EXT[img.type] ?? '.jpg'
      const storagePath = `documents/${user.id}/${Date.now()}-${i}-${sanitise(img.name, 40)}${ext}`

      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, img, { contentType: img.type, upsert: false })

      if (uploadError) {
        await rollback(supabase, docData.id, uploadedPaths)
        return { ok: false, error: `Upload fehlgeschlagen: ${uploadError.message}` }
      }
      uploadedPaths.push(storagePath)
    }

    const imgRows = uploadedPaths.map((file_path, i) => ({ document_id: docData.id, file_path, position: i }))
    const { error: imgInsertError } = await supabase.from('document_images').insert(imgRows)
    if (imgInsertError) {
      await rollback(supabase, docData.id, uploadedPaths)
      return { ok: false, error: `Failed to save images: ${imgInsertError.message}` }
    }

    await logAdminAction({ actorId: user.id, action: 'create', entityType: 'document', entityId: docData.id, entityTitle: title })
    revalidateAdminPages()
    return { ok: true, data: undefined }
  }

  // ── Single-file branch (pdf / image) ────────────────────────────────────
  const file = formData.get('pdf') as File | null
  if (!file || file.size === 0) return { ok: false, error: 'A file is required.' }
  if (!(ALLOWED_FILE_MIMES as readonly string[]).includes(file.type)) return { ok: false, error: 'Only PDF, JPEG, PNG, GIF, or WebP files are allowed.' }

  const file_type = (ALLOWED_IMAGE_MIMES as readonly string[]).includes(file.type) ? 'image' : 'pdf'
  const ext = MIME_TO_EXT[file.type] ?? '.bin'
  const storagePath = `documents/${user.id}/${Date.now()}-${sanitise(title)}${ext}`

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, file, { contentType: file.type, upsert: false })
  if (uploadError) return { ok: false, error: `Upload failed: ${uploadError.message}` }

  const { data: insertedDoc, error: insertError } = await supabase
    .from('documents')
    .insert({ task_id, title, description, file_path: storagePath, file_type, position })
    .select('id')
    .single()
  if (insertError) {
    await removeStorageObjects(supabase, [storagePath], 'createDocument rollback')
    return { ok: false, error: `Failed to save document: ${insertError.message}` }
  }

  await logAdminAction({ actorId: user.id, action: 'create', entityType: 'document', entityId: insertedDoc.id, entityTitle: title })
  revalidateAdminPages()
  return { ok: true, data: undefined }
}

export async function updateDocument(docId: string, formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await getAdminUser()

  const parsed = parseForm(DocumentUpdateMetaSchema, formData, ['title', 'description', 'position'])
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const { title, description, position } = parsed.data

  const { data: currentDoc, error: fetchErr } = await supabase
    .from('documents')
    .select('file_path, file_type')
    .eq('id', docId)
    .single()
  if (fetchErr || !currentDoc) return { ok: false, error: 'Document not found.' }

  // Metadata-only kinds — no file replacement.
  //
  // `image_collection` because its pages are uploaded as a set, and (since
  // #66) `interactive` because its file IS the published PNG of a draft:
  // replacing it here would flip file_type away from 'interactive' while
  // leaving the content JSON and the re-homed document_images behind, i.e. a
  // document whose row disagrees with itself. Re-publishing the draft is the
  // only way to change an interactive document's file. This is also the
  // shape update-document collapses to entirely under #82.
  //
  // `lesson` (#107) joins them for the same reason and a starker one: a
  // Lernseite has NO file at all — it is its `content` — so an upload here
  // would invent a file_path, flip the row to 'pdf' and strand a written page
  // that nothing would ever render again.
  if (METADATA_ONLY_FILE_TYPES.has(currentDoc.file_type)) {
    const { error } = await supabase.from('documents').update({ title, description, position }).eq('id', docId)
    if (error) return { ok: false, error: error.message }
    await logAdminAction({ actorId: user.id, action: 'update', entityType: 'document', entityId: docId, entityTitle: title })
    revalidateAdminPages()
    return { ok: true, data: undefined }
  }

  // pdf / image: optionally replace the file
  const pdfFile = formData.get('pdf') as File | null
  if (pdfFile && pdfFile.size > 0) {
    if (!(ALLOWED_FILE_MIMES as readonly string[]).includes(pdfFile.type)) return { ok: false, error: 'Only PDF, JPEG, PNG, GIF, or WebP files are allowed.' }

    const file_type = (ALLOWED_IMAGE_MIMES as readonly string[]).includes(pdfFile.type) ? 'image' : 'pdf'
    const ext = MIME_TO_EXT[pdfFile.type] ?? '.bin'
    const newPath = `documents/${user.id}/${Date.now()}-${sanitise(title)}${ext}`

    const { error: uploadErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(newPath, pdfFile, { contentType: pdfFile.type, upsert: false })
    if (uploadErr) return { ok: false, error: `Upload failed: ${uploadErr.message}` }

    const { error: dbErr } = await supabase.from('documents').update({ title, description, position, file_path: newPath, file_type }).eq('id', docId)
    if (dbErr) {
      await removeStorageObjects(supabase, [newPath], 'updateDocument rollback')
      return { ok: false, error: dbErr.message }
    }

    if (currentDoc.file_path) {
      await removeStorageObjects(supabase, [currentDoc.file_path], 'updateDocument old-file cleanup')
    }
  } else {
    const { error } = await supabase.from('documents').update({ title, description, position }).eq('id', docId)
    if (error) return { ok: false, error: error.message }
  }

  await logAdminAction({ actorId: user.id, action: 'update', entityType: 'document', entityId: docId, entityTitle: title })
  revalidateAdminPages()
  return { ok: true, data: undefined }
}

export async function deleteDocument(docId: string): Promise<ActionResult> {
  const { supabase, user } = await getAdminUser()

  const { data: doc, error: fetchErr } = await supabase
    .from('documents')
    .select('file_path, file_type, document_images(file_path)')
    .eq('id', docId)
    .single()
  if (fetchErr || !doc) return { ok: false, error: 'Document not found' }

  const { error: dbErr } = await supabase.from('documents').delete().eq('id', docId)
  if (dbErr) return { ok: false, error: dbErr.message }

  const pathsToDelete = collectStoragePaths([doc as DocumentFileRef])
  await removeStorageObjects(supabase, pathsToDelete, 'deleteDocument')

  await logAdminAction({ actorId: user.id, action: 'delete', entityType: 'document', entityId: docId, metadata: { paths_deleted: pathsToDelete.length } })
  revalidateAdminPages()
  return { ok: true, data: undefined }
}

/**
 * Writes the order a drag in the admin tree produced (the Dokumente of ONE
 * Aufgabe). `position` stops being a number anyone types and becomes the index
 * of the row where it was dropped.
 *
 * ⚠ IT PROVES OWNERSHIP FIRST. The ids arrive from the browser, and without the
 * check a crafted call could renumber a Dokument in someone else's Aufgabe —
 * `.eq('task_id', …)` on the update is the second lock on the same door. The
 * list must also be COMPLETE: reordering a subset would silently collide with
 * the positions of the rows left out.
 *
 * One statement per row, like `reorderLessons`, and for the same reason: an
 * upsert would have to carry every NOT NULL column of a row it is only
 * renumbering. A partial failure leaves a partial order — visible, and fixed by
 * dragging again.
 */
export async function reorderDocuments(
  taskId: string,
  documentIds: string[]
): Promise<ActionResult> {
  const { supabase, user } = await getAdminUser()

  const parsed = DocumentReorderSchema.safeParse({ task_id: taskId, document_ids: documentIds })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message }
  const { task_id, document_ids } = parsed.data

  const { data: existing, error: readError } = await supabase
    .from('documents')
    .select('id')
    .eq('task_id', task_id)
  if (readError) {
    return { ok: false, error: `Reihenfolge konnte nicht geprüft werden: ${readError.message}` }
  }

  const owned = new Set((existing ?? []).map((row) => row.id as string))
  const requested = new Set(document_ids)
  if (owned.size !== requested.size || document_ids.some((id) => !owned.has(id))) {
    return { ok: false, error: 'Die Reihenfolge passt nicht zu dieser Aufgabe.' }
  }

  const results = await Promise.all(
    document_ids.map((id, index) =>
      supabase.from('documents').update({ position: index }).eq('id', id).eq('task_id', task_id)
    )
  )
  const failed = results.find((result) => result.error)
  if (failed?.error) {
    return { ok: false, error: `Reihenfolge konnte nicht gespeichert werden: ${failed.error.message}` }
  }

  await logAdminAction({
    actorId: user.id,
    action: 'update',
    entityType: 'task',
    entityId: task_id,
    entityTitle: 'Reihenfolge der Dokumente',
  })
  revalidateAdminPages()
  return { ok: true, data: undefined }
}

// ── Internal helpers ─────────────────────────────────────────────────────────

type SupabaseClient = Awaited<ReturnType<typeof getAdminUser>>['supabase']

async function rollback(supabase: SupabaseClient, docId: string, uploadedPaths: string[]) {
  const { error: dbErr } = await supabase.from('documents').delete().eq('id', docId)
  if (dbErr) console.error('[createDocument rollback] DB delete failed:', dbErr)
  await removeStorageObjects(supabase, uploadedPaths, 'createDocument rollback')
}
