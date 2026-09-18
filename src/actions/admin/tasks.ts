'use server'

import { TaskFormSchema, DocumentUpdateMetaSchema, TaskReorderSchema } from '@/lib/schemas'
import { LESSON_TASK_TITLE } from '@/lib/lessons/lesson-task'
import type { ActionResult } from '@/types'
import { logAdminAction } from '@/lib/audit'
import { getAdminUser, parseForm, revalidateAdminPages, collectStoragePaths, removeStorageObjects, type DocumentFileRef } from './_shared'

export async function createTask(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const { supabase, user } = await getAdminUser()

  const parsed = parseForm(TaskFormSchema, formData, ['unit_id', 'title', 'description', 'position'])
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const { unit_id, title, description, position } = parsed.data

  const { data, error } = await supabase
    .from('tasks')
    .insert({ unit_id, title, description, position })
    .select('id')
    .single()
  if (error) return { ok: false, error: `Failed to create Task: ${error.message}` }

  await logAdminAction({ actorId: user.id, action: 'create', entityType: 'task', entityId: data.id, entityTitle: title })
  revalidateAdminPages()
  return { ok: true, data: { id: data.id } }
}

export async function updateTask(taskId: string, formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await getAdminUser()

  const parsed = parseForm(DocumentUpdateMetaSchema, formData, ['title', 'description', 'position'])
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const { title, description, position } = parsed.data

  const { error } = await supabase.from('tasks').update({ title, description, position }).eq('id', taskId)
  if (error) return { ok: false, error: error.message }

  await logAdminAction({ actorId: user.id, action: 'update', entityType: 'task', entityId: taskId, entityTitle: title })
  revalidateAdminPages()
  return { ok: true, data: undefined }
}

export async function deleteTask(taskId: string): Promise<ActionResult> {
  const { supabase, user } = await getAdminUser()

  const { data: task } = await supabase
    .from('tasks')
    .select('id, documents(file_path, file_type, document_images(file_path))')
    .eq('id', taskId)
    .single()

  const { error } = await supabase.from('tasks').delete().eq('id', taskId)
  if (error) return { ok: false, error: error.message }

  const paths = collectStoragePaths((task?.documents ?? []) as DocumentFileRef[])
  await removeStorageObjects(supabase, paths, 'deleteTask')

  await logAdminAction({ actorId: user.id, action: 'delete', entityType: 'task', entityId: taskId, metadata: { paths_deleted: paths.length } })
  revalidateAdminPages()
  return { ok: true, data: undefined }
}

/**
 * Writes the order a drag of the Aufgaben produced. Same shape as
 * `reorderUnits`, with one addition: the invisible `Lernseite` Aufgabe (#107)
 * is EXCLUDED from the comparison. The tree filters it out, so it can never be
 * part of a dragged list, and demanding it would make every legitimate request
 * look incomplete.
 */
export async function reorderTasks(unitId: string, taskIds: string[]): Promise<ActionResult> {
  const { supabase, user } = await getAdminUser()

  const parsed = TaskReorderSchema.safeParse({ unit_id: unitId, task_ids: taskIds })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message }
  const { unit_id, task_ids } = parsed.data

  const { data: existing, error: readError } = await supabase
    .from('tasks')
    .select('id, title')
    .eq('unit_id', unit_id)
  if (readError) {
    return { ok: false, error: `Reihenfolge konnte nicht geprüft werden: ${readError.message}` }
  }

  const owned = new Set(
    (existing ?? [])
      .filter((row) => row.title !== LESSON_TASK_TITLE)
      .map((row) => row.id as string)
  )
  const requested = new Set(task_ids)
  if (owned.size !== requested.size || task_ids.some((id) => !owned.has(id))) {
    return { ok: false, error: 'Die Reihenfolge passt nicht zu dieser Einheit.' }
  }

  const results = await Promise.all(
    task_ids.map((id, index) =>
      supabase.from('tasks').update({ position: index }).eq('id', id).eq('unit_id', unit_id)
    )
  )
  const failed = results.find((result) => result.error)
  if (failed?.error) {
    return { ok: false, error: `Reihenfolge konnte nicht gespeichert werden: ${failed.error.message}` }
  }

  await logAdminAction({
    actorId: user.id,
    action: 'update',
    entityType: 'unit',
    entityId: unit_id,
    entityTitle: 'Reihenfolge der Aufgaben',
  })
  revalidateAdminPages()
  return { ok: true, data: undefined }
}
