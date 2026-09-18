import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { STORAGE_BUCKET } from '@/lib/constants'

export type DocumentFileRef = {
  file_path: string | null
  file_type: string
  document_images?: { file_path: string }[]
}

// Every stored object a set of Documents owns — the single source of truth for
// all four cascade-delete paths (document, task, unit, kurs).
//
// Two document kinds own document_images: an `image_collection` (its uploaded
// pages) and, since #66, an `interactive` document (the copies publishing
// re-homed out of the draft). Both must be swept, or deleting the document
// leaves their objects orphaned in the bucket forever — the rows cascade, the
// storage objects do not.
const KINDS_WITH_OWNED_IMAGES = new Set(['image_collection', 'interactive'])

export function collectStoragePaths(documents: DocumentFileRef[]): string[] {
  return documents.flatMap((d) => {
    const paths: string[] = []
    if (d.file_path) paths.push(d.file_path)
    if (KINDS_WITH_OWNED_IMAGES.has(d.file_type)) {
      paths.push(...(d.document_images ?? []).map((i) => i.file_path))
    }
    return paths
  })
}

export function parseForm<T>(
  schema: { safeParse: (data: unknown) => { success: true; data: T } | { success: false; error: { issues: { message: string }[] } } },
  formData: FormData,
  fields: string[],
): { ok: true; data: T } | { ok: false; error: string } {
  const raw: Record<string, unknown> = {}
  for (const field of fields) {
    const value = formData.get(field)
    raw[field] = value === null ? undefined : value
  }
  const result = schema.safeParse(raw)
  if (!result.success) return { ok: false, error: result.error.issues[0].message }
  return { ok: true, data: result.data }
}

export function revalidateAdminPages() {
  revalidatePath('/admin/kurse')
  revalidatePath('/admin/units/new')
  revalidatePath('/admin/tasks/new')
  revalidatePath('/admin/documents/new')
  revalidatePath('/admin/editor')
  revalidatePath('/admin/lernseiten')
  revalidatePath('/', 'layout')
}

export async function getAdminUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user || user.app_metadata?.['role'] !== 'admin') {
    redirect('/')
  }

  return { supabase, user }
}

export function sanitise(name: string, maxLen = 60) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, maxLen)
}

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

// storage.remove() returns {data, error} where data lists what was actually deleted;
// RLS denial or missing files surface as an empty data array, not an error.
export async function removeStorageObjects(
  supabase: SupabaseClient,
  paths: string[],
  context: string,
): Promise<void> {
  if (paths.length === 0) return
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).remove(paths)
  if (error) {
    console.error(`[${context}] storage.remove failed`, { paths, error })
    return
  }
  const deleted = new Set((data ?? []).map((o) => o.name))
  const missed = paths.filter((p) => !deleted.has(p))
  if (missed.length) {
    console.error(`[${context}] storage.remove returned without error but did not delete`, { missed })
  }
}
