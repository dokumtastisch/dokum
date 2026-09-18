'use server'

import { UnitFormSchema, DocumentUpdateMetaSchema, UnitReorderSchema } from '@/lib/schemas'
import type { ActionResult } from '@/types'
import { logAdminAction } from '@/lib/audit'
import { getAdminUser, parseForm, revalidateAdminPages, collectStoragePaths, removeStorageObjects, type DocumentFileRef } from './_shared'

export async function createUnit(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const { supabase, user } = await getAdminUser()

  const parsed = parseForm(UnitFormSchema, formData, ['kurs_id', 'title', 'description', 'position'])
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const { kurs_id, title, description, position } = parsed.data

  const { data, error } = await supabase
    .from('units')
    .insert({ kurs_id, title, description, position })
    .select('id')
    .single()
  if (error) return { ok: false, error: `Failed to create Unit: ${error.message}` }

  await logAdminAction({ actorId: user.id, action: 'create', entityType: 'unit', entityId: data.id, entityTitle: title })
  revalidateAdminPages()
  return { ok: true, data: { id: data.id } }
}

export async function updateUnit(unitId: string, formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await getAdminUser()

  const parsed = parseForm(DocumentUpdateMetaSchema, formData, ['title', 'description', 'position'])
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const { title, description, position } = parsed.data

  const { error } = await supabase.from('units').update({ title, description, position }).eq('id', unitId)
  if (error) return { ok: false, error: error.message }

  await logAdminAction({ actorId: user.id, action: 'update', entityType: 'unit', entityId: unitId, entityTitle: title })
  revalidateAdminPages()
  return { ok: true, data: undefined }
}

export async function deleteUnit(unitId: string): Promise<ActionResult> {
  const { supabase, user } = await getAdminUser()

  const { data: unit } = await supabase
    .from('units')
    .select('id, tasks(id, documents(file_path, file_type, document_images(file_path)))')
    .eq('id', unitId)
    .single()

  const { error } = await supabase.from('units').delete().eq('id', unitId)
  if (error) return { ok: false, error: error.message }

  type NestedTask = { id: string; documents: DocumentFileRef[] | null }
  const allDocs = ((unit?.tasks ?? []) as NestedTask[]).flatMap((t) => t.documents ?? [])
  const paths = collectStoragePaths(allDocs)
  await removeStorageObjects(supabase, paths, 'deleteUnit')

  await logAdminAction({ actorId: user.id, action: 'delete', entityType: 'unit', entityId: unitId, metadata: { paths_deleted: paths.length } })
  revalidateAdminPages()
  return { ok: true, data: undefined }
}

/**
 * Writes the order a drag of the Einheiten produced. See `reorderDocuments`
 * for why the parent is named and why the list must be complete: the ids come
 * from the browser, so the action proves they are this Kurs's before it
 * renumbers anything, and `.eq('kurs_id', …)` locks the same door twice.
 */
export async function reorderUnits(kursId: string, unitIds: string[]): Promise<ActionResult> {
  const { supabase, user } = await getAdminUser()

  const parsed = UnitReorderSchema.safeParse({ kurs_id: kursId, unit_ids: unitIds })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message }
  const { kurs_id, unit_ids } = parsed.data

  const { data: existing, error: readError } = await supabase
    .from('units')
    .select('id')
    .eq('kurs_id', kurs_id)
  if (readError) {
    return { ok: false, error: `Reihenfolge konnte nicht geprüft werden: ${readError.message}` }
  }

  const owned = new Set((existing ?? []).map((row) => row.id as string))
  const requested = new Set(unit_ids)
  if (owned.size !== requested.size || unit_ids.some((id) => !owned.has(id))) {
    return { ok: false, error: 'Die Reihenfolge passt nicht zu diesem Kurs.' }
  }

  const results = await Promise.all(
    unit_ids.map((id, index) =>
      supabase.from('units').update({ position: index }).eq('id', id).eq('kurs_id', kurs_id)
    )
  )
  const failed = results.find((result) => result.error)
  if (failed?.error) {
    return { ok: false, error: `Reihenfolge konnte nicht gespeichert werden: ${failed.error.message}` }
  }

  await logAdminAction({
    actorId: user.id,
    action: 'update',
    entityType: 'kurs',
    entityId: kurs_id,
    entityTitle: 'Reihenfolge der Einheiten',
  })
  revalidateAdminPages()
  return { ok: true, data: undefined }
}
