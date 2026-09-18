'use server'

import { revalidatePath } from 'next/cache'
import { KursFormSchema, KursMetadataFormSchema, KursPublishedSchema } from '@/lib/schemas'
import type { ActionResult } from '@/types'
import { logAdminAction } from '@/lib/audit'
import { getAdminUser, parseForm, revalidateAdminPages, collectStoragePaths, removeStorageObjects, type DocumentFileRef } from './_shared'

export async function createKurs(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const { supabase, user } = await getAdminUser()

  const parsed = parseForm(KursFormSchema, formData, ['title', 'description', 'position', 'published', 'kurs_type', 'sold_as', 'price_euro'])
  if (!parsed.ok) return { ok: false, error: parsed.error }
  // `price_euro` left the schema as cents — see KursFormSchema.
  const { title, description, position, published, kurs_type, sold_as, price_euro: price_cents } = parsed.data

  const { data, error } = await supabase
    .from('kurse')
    .insert({ title, description, position, published, kurs_type, sold_as, price_cents })
    .select('id')
    .single()
  if (error) return { ok: false, error: `Failed to create Kurs: ${error.message}` }

  await logAdminAction({ actorId: user.id, action: 'create', entityType: 'kurs', entityId: data.id, entityTitle: title })
  revalidateAdminPages()
  return { ok: true, data: { id: data.id } }
}

export async function updateKurs(kursId: string, formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await getAdminUser()

  const parsed = parseForm(KursMetadataFormSchema, formData, ['title', 'description', 'position', 'kurs_type', 'sold_as', 'price_euro'])
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const { title, description, position, kurs_type, sold_as, price_euro: price_cents } = parsed.data

  const { error } = await supabase.from('kurse').update({ title, description, position, kurs_type, sold_as, price_cents }).eq('id', kursId)
  if (error) return { ok: false, error: error.message }

  await logAdminAction({ actorId: user.id, action: 'update', entityType: 'kurs', entityId: kursId, entityTitle: title })
  revalidateAdminPages()
  return { ok: true, data: undefined }
}

/** Changes only the course visibility; metadata edits cannot touch this flag. */
export async function setKursPublished(
  kursId: string,
  published: boolean
): Promise<ActionResult> {
  const { supabase, user } = await getAdminUser()
  const parsed = KursPublishedSchema.safeParse({ kurs_id: kursId, published })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message }

  const { data, error } = await supabase
    .from('kurse')
    .update({ published: parsed.data.published })
    .eq('id', parsed.data.kurs_id)
    .select('title')
    .single()
  if (error) return { ok: false, error: error.message }

  await logAdminAction({
    actorId: user.id,
    action: 'update',
    entityType: 'kurs',
    entityId: parsed.data.kurs_id,
    entityTitle: data.title,
    metadata: { published: parsed.data.published },
  })
  revalidateAdminPages()
  revalidatePath(`/admin/kurse/${parsed.data.kurs_id}`)
  return { ok: true, data: undefined }
}

export async function deleteKurs(kursId: string): Promise<ActionResult> {
  const { supabase, user } = await getAdminUser()

  const { data: kurs } = await supabase
    .from('kurse')
    .select('id, units(id, tasks(id, documents(file_path, file_type, document_images(file_path))))')
    .eq('id', kursId)
    .single()

  const { error } = await supabase.from('kurse').delete().eq('id', kursId)
  if (error) return { ok: false, error: error.message }

  type NestedTask = { id: string; documents: DocumentFileRef[] | null }
  type NestedUnit = { id: string; tasks: NestedTask[] | null }
  const allDocs = ((kurs?.units ?? []) as NestedUnit[])
    .flatMap((u) => u.tasks ?? [])
    .flatMap((t) => t.documents ?? [])
  const paths = collectStoragePaths(allDocs)
  await removeStorageObjects(supabase, paths, 'deleteKurs')

  await logAdminAction({ actorId: user.id, action: 'delete', entityType: 'kurs', entityId: kursId, metadata: { paths_deleted: paths.length } })
  revalidateAdminPages()
  return { ok: true, data: undefined }
}
