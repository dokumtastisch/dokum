'use server'

import { revalidatePath } from 'next/cache'
import { LessonCreateSchema, LessonReorderSchema, LessonSaveSchema } from '@/lib/schemas'
import { emptyLessonJson } from '@/lib/lessons/lesson-json'
import { LESSON_TASK_TITLE } from '@/lib/lessons/lesson-task'
import type { ActionResult } from '@/types'
import { logAdminAction } from '@/lib/audit'
import { getAdminUser, parseForm, revalidateAdminPages } from './_shared'

/**
 * Lernseiten (#107) — create and save.
 *
 * A LERNSEITE IS A `documents` ROW, and that is a deliberate storage decision
 * with a security reason behind it, spelled out in supabase/add_lessons.sql:
 * `units` SELECT gates on `kurse.published` alone so non-purchasers can browse
 * what they might buy, while `documents` SELECT requires an entitlement. Paid
 * teaching material therefore CANNOT live on the Unit row — it would be free to
 * read. Storing it as a Document inherits the paywall from policies that
 * already exist, and adds none.
 *
 * THE INVISIBLE AUFGABE IS THE PRICE OF THAT, and it is paid here rather than
 * by the author. `documents.task_id` is NOT NULL, so every Lernseite hangs
 * under a Task; {@link ensureLessonTask} creates one on demand and nothing in
 * the workspace ever shows it. Every existing query, RLS policy, cascade delete
 * and storage sweep keeps working untouched — which is the whole point of
 * choosing an invisible row over a nullable foreign key.
 */

/**
 * Creates the Lernseite of a Unit: the hidden Task if it is missing, then an
 * empty Document to write into.
 *
 * The page starts EMPTY rather than from the reference template. „Neue Seite"
 * that arrives pre-filled with someone else's finance example is content to
 * delete before content can be written; the template belongs behind an explicit
 * „aus Vorlage", which is a workspace affordance and not this action's job.
 */
export async function createLesson(
  formData: FormData
): Promise<ActionResult<{ documentId: string }>> {
  const { supabase, user } = await getAdminUser()

  const parsed = parseForm(LessonCreateSchema, formData, ['unit_id', 'title'])
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const { unit_id, title } = parsed.data

  const task = await ensureLessonTask(supabase, unit_id)
  if (!task.ok) return task

  // `position` counts the Lernseiten already under this Unit, so pages sort in
  // creation order without the author being asked for a number.
  const { count } = await supabase
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .eq('task_id', task.data)

  const { data, error } = await supabase
    .from('documents')
    .insert({
      task_id: task.data,
      title,
      file_type: 'lesson',
      content: emptyLessonJson(),
      position: count ?? 0,
    })
    .select('id')
    .single()
  if (error) return { ok: false, error: `Lernseite konnte nicht angelegt werden: ${error.message}` }

  await logAdminAction({
    actorId: user.id,
    action: 'create',
    entityType: 'document',
    entityId: data.id,
    entityTitle: title,
  })
  revalidateAdminPages()
  revalidatePath('/admin/lernseiten')
  return { ok: true, data: { documentId: data.id } }
}

/**
 * Saves a Lernseite's title and blocks.
 *
 * ⚠ THIS WRITES LIVE CONTENT. There is no draft layer yet: a Kurs that is
 * published shows what this action stored, immediately. That is a known gap and
 * the reason the course-wide draft mode is the next piece — it is recorded here
 * so nobody mistakes the current behaviour for the intended one.
 *
 * The update is scoped by `file_type` as well as by id. Without that, a wrong
 * id in the request would overwrite an interactive document's snapshot with
 * lesson JSON — a row that then renders as neither, because `file_type` (not
 * the blob's shape) is what picks the renderer.
 */
export async function saveLesson(formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await getAdminUser()

  const parsed = parseForm(LessonSaveSchema, formData, ['document_id', 'title', 'content'])
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const { document_id, title, content } = parsed.data

  const { data, error } = await supabase
    .from('documents')
    .update({ title, content })
    .eq('id', document_id)
    .eq('file_type', 'lesson')
    .select('id')
  if (error) return { ok: false, error: `Speichern fehlgeschlagen: ${error.message}` }
  if (!data || data.length === 0) {
    return { ok: false, error: 'Diese Lernseite existiert nicht (mehr).' }
  }

  await logAdminAction({
    actorId: user.id,
    action: 'update',
    entityType: 'document',
    entityId: document_id,
    entityTitle: title,
  })
  revalidateAdminPages()
  revalidatePath('/admin/lernseiten')
  return { ok: true, data: undefined }
}

/**
 * Reorders the Lernseiten of one Einheit (#107) — what drag-and-drop in the
 * sidebar persists.
 *
 * ⚠ THE REQUEST IS CHECKED AGAINST THE EINHEIT, NOT TRUSTED. It arrives as a
 * list of ids, and a list is the easiest thing in the world to send with a
 * foreign id in it. The action reads what the Einheit actually holds and
 * refuses unless the two sets match exactly — same ids, same count. Without
 * that, a crafted request could renumber a page in another Kurs, and `position`
 * is the order a student reads in.
 *
 * `position` comes from the ARRAY INDEX rather than being sent along, so the
 * order the client showed and the order stored cannot disagree.
 *
 * The updates run one statement per page. There is no batch form that is
 * honest here — an upsert would have to carry every NOT NULL column of a row it
 * is only reordering — and a handful of pages per Einheit makes the round trips
 * a non-issue. A partial failure leaves a partial order, which is visible and
 * fixable by dragging again; the alternative (a stored procedure) is more
 * machinery than the problem deserves today.
 */
export async function reorderLessons(
  unitId: string,
  documentIds: string[]
): Promise<ActionResult> {
  const { supabase, user } = await getAdminUser()

  const parsed = LessonReorderSchema.safeParse({ unit_id: unitId, document_ids: documentIds })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message }
  const { unit_id, document_ids } = parsed.data

  const { data: existing, error: readError } = await supabase
    .from('documents')
    .select('id, tasks!inner(unit_id)')
    .eq('tasks.unit_id', unit_id)
    .eq('file_type', 'lesson')
  if (readError) {
    return { ok: false, error: `Reihenfolge konnte nicht geprüft werden: ${readError.message}` }
  }

  const owned = new Set((existing ?? []).map((row) => row.id as string))
  const requested = new Set(document_ids)
  if (owned.size !== requested.size || document_ids.some((id) => !owned.has(id))) {
    return { ok: false, error: 'Die Reihenfolge passt nicht zu dieser Einheit.' }
  }

  const results = await Promise.all(
    document_ids.map((id, index) =>
      supabase.from('documents').update({ position: index }).eq('id', id).eq('file_type', 'lesson')
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
    entityTitle: 'Reihenfolge der Lernseiten',
  })
  revalidateAdminPages()
  revalidatePath(`/admin/kurse/${unit_id}`)
  return { ok: true, data: undefined }
}

type SupabaseClient = Awaited<ReturnType<typeof getAdminUser>>['supabase']

/**
 * The Unit's hidden Task, created if this is its first Lernseite.
 *
 * Reused rather than created per page: one Task per Unit keeps the hidden row
 * count at one and makes the Lernseiten of a Unit siblings, which is what
 * `position` then orders. It is found by title because that is the only mark it
 * carries — a dedicated column would be a schema change to hold a fact only
 * this file cares about.
 */
async function ensureLessonTask(
  supabase: SupabaseClient,
  unitId: string
): Promise<ActionResult<string>> {
  const { data: existing, error: readError } = await supabase
    .from('tasks')
    .select('id')
    .eq('unit_id', unitId)
    .eq('title', LESSON_TASK_TITLE)
    .maybeSingle()
  if (readError) {
    return { ok: false, error: `Einheit konnte nicht gelesen werden: ${readError.message}` }
  }
  if (existing) return { ok: true, data: existing.id as string }

  const { data, error } = await supabase
    .from('tasks')
    .insert({ unit_id: unitId, title: LESSON_TASK_TITLE, position: 0 })
    .select('id')
    .single()
  if (error) {
    return { ok: false, error: `Einheit konnte nicht vorbereitet werden: ${error.message}` }
  }
  return { ok: true, data: data.id as string }
}
