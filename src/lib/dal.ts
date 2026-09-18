import 'server-only'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import type { BacklinkSourceKind } from '@/lib/editor/backlinks'
import type { LinkTargetKind } from '@/lib/editor/links'
import type { LinkTargetOwnership } from '@/lib/link-target-state'
import type {
  Document,
  DocumentImage,
  DocumentWithAncestry,
  EditorDocument,
  EditorDocumentListItem,
  EditorTargetKurs,
  Kurs,
  KursNavTree,
  KursNavUnit,
  KursSoldAs,
  KursType,
  KursWithUnits,
  UnitWithTasks,
} from '@/types'
import { LESSON_TASK_TITLE } from '@/lib/lessons/lesson-task'

// ── Shared sort utility ─────────────────────────────────────────────────────
function sortByPosition<T extends { position: number; created_at: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at))
}

// ── Kurs queries ────────────────────────────────────────────────────────────

export async function getPublishedKurse(): Promise<Kurs[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('kurse')
    .select('*')
    .eq('published', true)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  return data ?? []
}

export async function getAllKurse(): Promise<Kurs[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('kurse')
    .select('*')
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  return data ?? []
}

export async function getKursById(
  kursId: string
): Promise<Pick<Kurs, 'title' | 'description' | 'position' | 'published' | 'kurs_type' | 'sold_as'> | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('kurse')
    .select('title, description, position, published, kurs_type, sold_as')
    .eq('id', kursId)
    .single()
  return data ?? null
}

/**
 * Every Kurs, NEWEST FIRST — the „Kurse verwalten" table (#108).
 *
 * A separate function rather than a flag on {@link getAllKurseWithUnits},
 * because the two orders answer different questions and both are right.
 * `position` is the order a STUDENT reads a catalogue in; `created_at DESC` is
 * the order an AUTHOR works in — the Kurs you just made is the one you are
 * about to open. The admin tree on the other pages still wants the student's
 * order, so one function cannot serve both without a caller having to know
 * which it is getting.
 *
 * Ordering stays in the DAL either way (the invariant): the page maps rows and
 * does not re-sort.
 *
 * `created_at` ties are broken by title so the order is total — two Kurse
 * created in the same millisecond (a seeded fixture, a scripted import) must
 * not swap places between two loads of the same page.
 */
export async function getKurseNewestFirst(): Promise<KursWithUnits[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('kurse')
    .select('*, units(id, kurs_id, title, description, position, created_at)')
    .order('created_at', { ascending: false })
    .order('title', { ascending: true })
  const kurse = (data ?? []) as KursWithUnits[]
  // The Einheiten inside each Kurs keep the hierarchy's own order — only the
  // Kurse themselves are listed by age.
  kurse.forEach((k) => { k.units = sortByPosition(k.units ?? []) })
  return kurse
}

// Returns Kurs + sorted Units (no tasks/documents). Used by admin/kurse and admin/units pages.
export async function getAllKurseWithUnits(): Promise<KursWithUnits[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('kurse')
    .select('*, units(id, kurs_id, title, description, position, created_at)')
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  const kurse = (data ?? []) as KursWithUnits[]
  kurse.forEach((k) => { k.units = sortByPosition(k.units ?? []) })
  return kurse
}

// Returns full deep tree. Used by admin/tasks and admin/documents pages.
export async function getAllKurseDeep(): Promise<KursWithUnits[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('kurse')
    .select(`
      *,
      units(
        *,
        tasks(
          *,
          documents(
            id, title, position, created_at, file_type,
            document_images(id)
          )
        )
      )
    `)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  const kurse = (data ?? []) as KursWithUnits[]
  kurse.forEach((k) => {
    k.units = sortByPosition(k.units ?? [])
    k.units.forEach((u) => {
      u.tasks = sortByPosition(u.tasks ?? [])
      u.tasks.forEach((t) => {
        t.documents = sortByPosition(t.documents ?? [])
      })
    })
  })
  return kurse
}

// The lean hierarchy used by the course-wide admin workspace. It deliberately
// omits `documents.content`: opening the course settings must not serialize all
// published editor snapshots and Lernseiten into the client just to render the
// navigation tree. The dedicated editors fetch that content on their own page.
export type AdminKursWorkspaceDocument = Pick<
  Document,
  'id' | 'task_id' | 'title' | 'description' | 'file_path' | 'file_type' | 'position' | 'created_at'
> & { document_images: Pick<DocumentImage, 'id'>[] }

export type AdminKursWorkspaceTask = Pick<
  import('@/types').Task,
  'id' | 'unit_id' | 'title' | 'description' | 'position' | 'created_at'
> & { documents: AdminKursWorkspaceDocument[] }

export type AdminKursWorkspaceUnit = Pick<
  import('@/types').Unit,
  'id' | 'kurs_id' | 'title' | 'description' | 'position' | 'created_at'
> & { tasks: AdminKursWorkspaceTask[] }

export type AdminKursWorkspace = Kurs & { units: AdminKursWorkspaceUnit[] }

/** One course and its editable hierarchy for `/admin/kurse/[kursId]`. */
export async function getAdminKursWorkspace(
  kursId: string
): Promise<AdminKursWorkspace | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('kurse')
    .select(
      `*,
       units(id, kurs_id, title, description, position, created_at,
         tasks(id, unit_id, title, description, position, created_at,
           documents(
             id, task_id, title, description, file_path, file_type, position, created_at,
             document_images(id)
           )))`
    )
    .eq('id', kursId)
    .single()
  if (error || !data) return null

  const kurs = data as unknown as AdminKursWorkspace
  kurs.units = sortByPosition(kurs.units ?? [])
  kurs.units.forEach((unit) => {
    unit.tasks = sortByPosition(unit.tasks ?? [])
    unit.tasks.forEach((task) => {
      task.documents = sortByPosition(task.documents ?? [])
    })
  })
  return kurs
}

export async function getPublishedKurseDeep(): Promise<KursWithUnits[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('kurse')
    .select(`
      *,
      units(
        *,
        tasks(
          *,
          documents(
            id, title, position, created_at, file_type,
            document_images(id)
          )
        )
      )
    `)
    .eq('published', true)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  const kurse = (data ?? []) as KursWithUnits[]
  kurse.forEach((k) => {
    k.units = sortByPosition(k.units ?? [])
    k.units.forEach((u) => {
      u.tasks = sortByPosition(u.tasks ?? [])
      u.tasks.forEach((t) => {
        t.documents = sortByPosition(t.documents ?? [])
      })
    })
  })
  return kurse
}

// The Kurs sidebar's whole tree — Kurs → Unit → Aufgabe → Dokument, titles only
// (#106). One round trip, because the sidebar frames every page under
// /kurse/[kursId] and cannot render half of itself.
//
// `cache()` is what makes that affordable: the Kurs layout and the page inside
// it both need this tree, and React de-duplicates the two calls within a single
// request. It is the ONLY memoised read in this file, and it is memoised
// because two components in one render tree ask the same question — not as a
// general policy.
//
// THE COLUMN LIST IS THE POINT (getUnitWithTasks precedent). No `content`: the
// sidebar renders no document, and `*` here would ship every published
// snapshot in the Kurs on every page load. No `file_path` either — nothing
// below is a link to storage.
//
// Sorting is the hierarchy's, applied at all three levels here in the DAL;
// `position`/`created_at` ride along only to make that possible and are dropped
// on the way out, since this tree becomes a client component's prop.
//
// A LOCKED EINHEIT ARRIVES WITH NO CHILDREN, and that is RLS doing it, not a
// filter here: `tasks` and `documents` both require an entitlement (plus a
// published Kurs), while `units` gate on `published` alone. So an unpaid
// Einheit is still listed by name — it has to be, it is the thing being sold —
// but its Aufgaben and Dokumente are not readable and therefore not listable.
export const getKursNavTree = cache(async (kursId: string): Promise<KursNavTree | null> => {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('kurse')
    .select(
      `id, title, description, kurs_type, sold_as, price_cents,
       units(id, title, description, position, created_at,
         tasks(id, title, position, created_at,
           documents(id, title, file_type, position, created_at)))`
    )
    .eq('id', kursId)
    .single()
  if (error || !data) return null

  const row = data as unknown as KursNavTreeRow
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    kurs_type: row.kurs_type,
    sold_as: row.sold_as,
    price_cents: row.price_cents,
    units: sortByPosition(row.units ?? []).map((unit) => ({
      id: unit.id,
      title: unit.title,
      description: unit.description,
      tasks: sortByPosition(unit.tasks ?? []).map((task) => ({
        id: task.id,
        title: task.title,
        documents: sortByPosition(task.documents ?? []).map(({ id, title, file_type }) => ({
          id,
          title,
          file_type,
        })),
      })),
    })),
  }
})

// The raw PostgREST shape of the query above — the nav types with the sort keys
// still attached, which the mapping strips.
type Positioned<T> = T & { position: number; created_at: string }
type KursNavTreeRow = Pick<
  KursNavTree,
  'id' | 'title' | 'description' | 'kurs_type' | 'sold_as' | 'price_cents'
> & {
  units:
    | Positioned<
        Pick<KursNavUnit, 'id' | 'title' | 'description'> & {
          tasks:
            | Positioned<
                Pick<import('@/types').KursNavTask, 'id' | 'title'> & {
                  documents: Positioned<import('@/types').KursNavDocument>[] | null
                }
              >[]
            | null
        }
      >[]
    | null
}

// ── Lernseiten workspace (#107) ─────────────────────────────────────────────

/** One Kurs in the workspace tree, with its Einheiten and their Lernseiten. */
export interface LessonWorkspaceKurs {
  id: string
  title: string
  kurs_type: KursType
  sold_as: KursSoldAs
  published: boolean
  units: LessonWorkspaceUnit[]
}

export interface LessonWorkspaceUnit {
  id: string
  title: string
  lessons: LessonWorkspacePage[]
}

/** A Lernseite as the workspace lists it — `content` included, it is what gets edited. */
export interface LessonWorkspacePage {
  id: string
  title: string
  content: unknown
}

/**
 * The whole authoring tree of the Lernseiten workspace (#107): every Kurs, its
 * Einheiten, and the Lernseiten inside them.
 *
 * ADMIN-ONLY IN PRACTICE, and it must stay that way. It selects `content` for
 * every Lernseite in the catalogue in one query — for an admin RLS grants that,
 * for anyone else the entitlement gate on `documents` would silently return a
 * partial tree that looks like an empty one. The only caller is the workspace
 * page, which sits behind the proxy's /admin guard.
 *
 * IT LOOKS PAST THE HIDDEN AUFGABE ON PURPOSE. Lernseiten hang under a Task
 * titled {@link LESSON_TASK_TITLE} that the author must never see, so the tree
 * is flattened here: the DAL is where the storage shape is known, and letting
 * that Task reach the UI would mean every component had to remember to skip it.
 *
 * `file_type = 'lesson'` is the filter, not the Task title alone — the title is
 * how the Task is recognised, the file_type is what a Lernseite IS. A Document
 * of another kind sitting under that Task (a stray upload) is not a page and
 * must not be opened in a lesson editor.
 */
export async function getLessonWorkspaceTree(): Promise<LessonWorkspaceKurs[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('kurse')
    .select(
      `id, title, kurs_type, sold_as, published, position, created_at,
       units(id, title, position, created_at,
         tasks(id, title, position, created_at,
           documents(id, title, content, file_type, position, created_at)))`
    )
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw new Error(`Kursbaum konnte nicht geladen werden: ${error.message}`)

  const kurse = (data ?? []) as unknown as LessonWorkspaceRow[]
  return sortByPosition(kurse).map((kurs) => ({
    id: kurs.id,
    title: kurs.title,
    kurs_type: kurs.kurs_type,
    sold_as: kurs.sold_as,
    published: kurs.published,
    units: sortByPosition(kurs.units ?? []).map((unit) => ({
      id: unit.id,
      title: unit.title,
      lessons: sortByPosition(unit.tasks ?? [])
        .filter((task) => task.title === LESSON_TASK_TITLE)
        .flatMap((task) =>
          sortByPosition(task.documents ?? [])
            .filter((doc) => doc.file_type === 'lesson')
            .map(({ id, title, content }) => ({ id, title, content }))
        ),
    })),
  }))
}

/** The raw PostgREST shape of the query above, sort keys still attached. */
type LessonWorkspaceRow = Positioned<{
  id: string
  title: string
  kurs_type: KursType
  sold_as: KursSoldAs
  published: boolean
  units:
    | Positioned<{
        id: string
        title: string
        tasks:
          | Positioned<{
              id: string
              title: string
              documents: Positioned<LessonWorkspacePage & { file_type: string }>[] | null
            }>[]
          | null
      }>[]
    | null
}>

// ── Unit queries ────────────────────────────────────────────────────────────

export async function getUnitById(
  unitId: string
): Promise<Pick<import('@/types').Unit, 'kurs_id' | 'title' | 'description' | 'position'> | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('units')
    .select('kurs_id, title, description, position')
    .eq('id', unitId)
    .single()
  return data ?? null
}

// Returns Unit with fully sorted Tasks → Documents → DocumentImages. Used by public Unit detail page.
//
// The document columns are listed EXPLICITLY rather than `documents(*)` (#65).
// `documents` gained a `content` JSONB column holding the full published
// snapshot, and `*` would ship every document's JSON to this page on every
// load. Listing the columns makes including `content` a deliberate decision
// instead of an accident — the DAL being the only read path means this
// discipline lives in exactly one place.
//
// `content` IS included here, deliberately (#67): this page renders published
// interactive documents live, so the snapshot is the thing being displayed,
// not dead weight. The cost is real — every interactive document in the Unit
// ships on load — and it is the reason the addressable per-document route
// (#69) exists. Any query that does NOT render the document must leave the
// column out.
export async function getUnitWithTasks(unitId: string): Promise<UnitWithTasks | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('units')
    .select(
      `*, tasks(*, documents(
        id, task_id, title, description, file_path, file_type, position, created_at, content,
        document_images(id, file_path, position, created_at)
      ))`
    )
    .eq('id', unitId)
    .single()
  if (error || !data) return null
  const unit = data as UnitWithTasks
  unit.tasks = sortByPosition(unit.tasks ?? [])
  unit.tasks.forEach((t) => {
    t.documents = sortByPosition(t.documents ?? [])
    t.documents.forEach((d) => {
      d.document_images = sortByPosition(d.document_images ?? [])
    })
  })
  return unit
}

// ── Task queries ────────────────────────────────────────────────────────────

export async function getTaskById(
  taskId: string
): Promise<Pick<import('@/types').Task, 'unit_id' | 'title' | 'description' | 'position'> | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('tasks')
    .select('unit_id, title, description, position')
    .eq('id', taskId)
    .single()
  return data ?? null
}

// ── Document queries ────────────────────────────────────────────────────────

export async function getDocumentById(
  docId: string
): Promise<Pick<import('@/types').Document, 'task_id' | 'title' | 'description' | 'position' | 'file_path' | 'file_type'> | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('documents')
    .select('task_id, title, description, position, file_path, file_type')
    .eq('id', docId)
    .single()
  return data ?? null
}

// Full-page document view (#69). Returns the document TOGETHER WITH the
// ancestry the page needs — the parent Kurs's `published` flag to enforce
// access, and the Kurs/Unit/Task ids and titles to render the way back into
// the hierarchy. One round-trip, because the page cannot show anything until
// all of it has arrived.
//
// Access is enforced by the same two mechanisms as everywhere else, not by
// new ones. RLS on `documents` already requires an entitlement for the owning
// Unit and a published parent Kurs (or admin), so neither an unentitled reader
// nor a reader of an archived Kurs gets a row at all; the `!inner` join up to
// `kurse` drops it a second time, since the `units` policy gates on published
// too. The caller re-checks `published` in app code with an admin bypass
// anyway, exactly as /api/file does — the archive must not depend on a join's
// emptiness alone.
//
// `content` IS selected here: this page's whole job is rendering the snapshot.
// `file_path` is NOT — the renderers address the stored file and every image
// through the proxy routes by id, so a storage path would cross to the browser
// for nothing.
export async function getDocumentWithAncestry(docId: string): Promise<DocumentWithAncestry | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('documents')
    .select(
      `id, title, description, file_type, content,
       document_images(id, position, created_at),
       tasks!inner(
         id, title,
         units!inner(
           id, title,
           kurse!inner(id, title, published)
         )
       )`
    )
    .eq('id', docId)
    .single()
  if (error || !data) return null

  // Deep nested joins are not inferred without generated types; the `!inner`
  // joins guarantee the relations exist, and the shape is pinned by the row
  // type right here — the one cast in this function.
  const { tasks: task, document_images: images, ...document } = data as unknown as DocumentAncestryRow
  return {
    document: { ...document, document_images: sortByPosition(images ?? []) },
    task: { id: task.id, title: task.title },
    unit: { id: task.units.id, title: task.units.title },
    kurs: { id: task.units.kurse.id, title: task.units.kurse.title, published: task.units.kurse.published },
  }
}

// The raw PostgREST shape of the query above: the document's own columns plus
// its embedded images and ancestry, which the function immediately splits
// apart. `position`/`created_at` ride along on the images only so the DAL can
// apply the hierarchy's sort here, as it does everywhere else.
type DocumentAncestryRow = Pick<Document, 'id' | 'title' | 'description' | 'file_type' | 'content'> & {
  document_images: Pick<DocumentImage, 'id' | 'position' | 'created_at'>[] | null
  tasks: {
    id: string
    title: string
    units: {
      id: string
      title: string
      kurse: { id: string; title: string; published: boolean }
    }
  }
}

// Used by /api/file/[docId] route
export async function getDocumentFilePath(
  docId: string
): Promise<{ file_path: string | null } | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('documents')
    .select('file_path')
    .eq('id', docId)
    .single()
  return data ?? null
}

// Used by /api/image/[imageId] route
export async function getImageFilePath(
  imageId: string
): Promise<{ file_path: string } | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('document_images')
    .select('file_path')
    .eq('id', imageId)
    .single()
  return data ?? null
}

// ── Editor draft queries (PRD #28, slice 7) ─────────────────────────────────

// Draft list for /admin/editor — RLS is admin-only and deliberately not
// filtered by created_by, so both admins see all drafts. Drafts have no
// `position`; the list sorts by last modification (here, in the DAL).
export async function getEditorDocuments(): Promise<EditorDocumentListItem[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('editor_documents')
    .select('id, title, created_at, updated_at, published_document_id')
    .order('updated_at', { ascending: false })
  return data ?? []
}

export async function getEditorDocumentById(draftId: string): Promise<EditorDocument | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('editor_documents')
    .select('*')
    .eq('id', draftId)
    .single()
  return data ?? null
}

// Target tree for the editor's ExportBar (slice 10) and link picker (#72):
// Kurs → Unit → Task only — deliberately not getAllKurseDeep(), which would
// drag every document + image id into the client bundle for nothing. Sorted
// here in the DAL at every level (invariant); the 1-based index in these
// arrays is the export filename's ordinal.
//
// `published` rides along unfiltered: the publish target may be an unpublished
// Kurs, the link picker's targets may not. Filtering here would break one of
// the two.
export async function getEditorTargetTree(): Promise<EditorTargetKurs[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('kurse')
    .select(
      'id, title, position, created_at, published, units(id, title, position, created_at, tasks(id, title, position, created_at))'
    )
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  const kurse = (data ?? []) as EditorTargetKurs[]
  kurse.forEach((k) => {
    k.units = sortByPosition(k.units ?? [])
    k.units.forEach((u) => {
      u.tasks = sortByPosition(u.tasks ?? [])
    })
  })
  return kurse
}

// The link picker's fourth level (#72), fetched per Task on expand: the
// Dokumente of one Task, WITH their published snapshot so the caller can read
// the Sprungmarken out of it.
//
// Returns [] when the Task's Kurs is unpublished: a link may only be authored
// against something a student can reach (spec #63 §6), so the level that costs
// a round trip refuses server-side rather than trusting the picker's filter.
//
// That is an AUTHORING-TIME rule, not an invariant of a stored link. A Kurs can
// be unpublished long after something linked into it, so nothing on the save
// path re-checks it — a target that has gone dark is the resolver's business
// (#74), which degrades it quietly for the student.
//
// The Kurs is reached through the `units!inner` / `kurse!inner` embed, so the
// gate and the rows arrive in one round trip.
export async function getLinkTargetDocuments(
  taskId: string
): Promise<LinkTargetDocumentRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('tasks')
    .select(
      'id, units!inner(kurse!inner(published)), documents(id, title, content, position, created_at)'
    )
    .eq('id', taskId)
    .maybeSingle()
  if (!data) return []

  // Nested embeds are not inferred without generated types; the `!inner` joins
  // guarantee the ancestry exists, and the shape is pinned by the row type
  // below — the one cast in this function (getDocumentWithAncestry precedent).
  const row = data as unknown as LinkTargetTaskRow
  if (!row.units?.kurse?.published) return []
  return sortByPosition(row.documents ?? []).map(({ id, title, content }) => ({
    id,
    title,
    content,
  }))
}

/** One linkable Dokument, snapshot included so the caller can read its anchors. */
type LinkTargetDocumentRow = { id: string; title: string; content: unknown }

// The raw PostgREST shape of the query above: the published gate reached
// through the ancestry, plus the Task's documents. `position`/`created_at`
// ride along only so the DAL can apply the hierarchy's sort here, as everywhere.
type LinkTargetTaskRow = {
  units: { kurse: { published: boolean } } | null
  documents: (LinkTargetDocumentRow & { position: number; created_at: string })[] | null
}

// Used by /api/editor-image/[imageId] route (slice 8). RLS is admin-only, so
// non-admins get no row here regardless of the route's own role check.
export async function getEditorImageFilePath(
  imageId: string
): Promise<{ file_path: string } | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('editor_images')
    .select('file_path')
    .eq('id', imageId)
    .single()
  return data ?? null
}

// ── Link target resolution (#74) ────────────────────────────────────────────

/**
 * What a link's target IS — title, whether its Kurs is still published, and
 * the Einheit whose entitlement gates it. `null` when there is no such row.
 *
 * ⚠ THE ONE READ IN THIS FILE THAT BYPASSES RLS, and it does so for a reason
 * the policies cannot serve: `documents` SELECT requires an entitlement, so the
 * student we want to SELL to gets no row and cannot be told which Einheit to
 * buy — locked and deleted look identical from the browser (#74).
 *
 * Three rules keep that bypass safe, and all three are in this function:
 *
 * 1. **It selects only what a refusal may name.** No `content`, no
 *    `file_path`, no `description` of the target itself — the columns are
 *    listed one by one and the list is the audit.
 * 2. **It never learns who is asking.** No user id, no role, no entitlement
 *    read: it answers „what is this" and nothing about „may you have it".
 *    Being identity-free is what makes it unable to leak per-reader data.
 * 3. **Its result must go through `describeLinkTarget` before crossing to the
 *    browser** — that is where the reader's admin flag and entitlement decide
 *    which of these fields the answer is allowed to carry, and every field
 *    below is withheld from every verdict except `locked`.
 *
 * Consequently there is exactly one caller, `/api/link-target/[kind]/[id]`. A
 * page rendering this straight into HTML would be a new way to read the
 * catalogue.
 */
export async function getLinkTargetOwnership(
  kind: LinkTargetKind,
  id: string
): Promise<LinkTargetOwnership | null> {
  const supabase = createServiceClient()

  if (kind === 'kurs') {
    const { data, error } = await supabase.from('kurse').select('title, published').eq('id', id).maybeSingle()
    if (error) throw linkTargetReadFailed(kind, error)
    if (!data) return null
    // A Kurs page costs nothing to open — nothing gates it but its own
    // `published` flag, which is the archive.
    return { title: data.title as string, kursPublished: data.published as boolean, gatedBy: null }
  }

  if (kind === 'unit') {
    const { data, error } = await supabase
      .from('units')
      .select('title, kurse!inner(published)')
      .eq('id', id)
      .maybeSingle()
    if (error) throw linkTargetReadFailed(kind, error)
    if (!data) return null
    const row = data as unknown as { title: string; kurse: { published: boolean } }
    // Deliberately NOT gated, even though buying an Einheit is the whole
    // paywall: the Einheit page is readable without the purchase and IS the
    // unlock surface (paywall + teaser + „Freischalten"). Interposing a card
    // in front of a link to it would sell the student a worse copy of the page
    // they are one click from.
    return { title: row.title, kursPublished: row.kurse.published, gatedBy: null }
  }

  const { data, error } = await supabase
    .from('documents')
    .select(
      'title, tasks!inner(units!inner(id, title, description, kurse!inner(id, title, published, sold_as, price_cents)))'
    )
    .eq('id', id)
    .maybeSingle()
  if (error) throw linkTargetReadFailed(kind, error)
  if (!data) return null
  const row = data as unknown as LinkTargetDocumentOwnershipRow
  const unit = row.tasks.units
  return {
    title: row.title,
    kursPublished: unit.kurse.published,
    // The Kurs travels with the Einheit: the entitlement check needs its id
    // (a Kurs sold whole is opened by a Kurs grant), and the locked card needs
    // to know what is actually for sale before it offers anything.
    gatedBy: {
      id: unit.id,
      title: unit.title,
      description: unit.description,
      kursId: unit.kurse.id,
      kursTitle: unit.kurse.title,
      soldAs: unit.kurse.sold_as,
      kursPriceCents: unit.kurse.price_cents,
    },
  }
}

/**
 * ⚠ A FAILED READ IS THROWN, NEVER COLLAPSED INTO `null`.
 *
 * `null` here means „no such row", which becomes the verdict `missing` and
 * degrades a live link to plain text in the middle of a sentence. A transient
 * database failure returning `null` would therefore silently unlink a document
 * that is perfectly fine — the exact opposite of the fail-open rule the rest of
 * this path is built on, and invisible, because it arrives as a confident 200.
 *
 * The route turns this into a non-OK status, which the browser half reads as
 * „no verdict" and leaves every chip exactly as the renderer built it. This is
 * the one DAL function that distinguishes the two, because it is the one whose
 * empty result is a user-visible statement rather than a 404.
 */
function linkTargetReadFailed(kind: LinkTargetKind, error: { message: string }): Error {
  return new Error(`Link-Ziel (${kind}) konnte nicht gelesen werden: ${error.message}`)
}

// The raw PostgREST shape of the document query above — nested embeds are not
// inferred without generated types, and the `!inner` joins guarantee the
// ancestry exists (getDocumentWithAncestry precedent).
type LinkTargetDocumentOwnershipRow = {
  title: string
  tasks: {
    units: {
      id: string
      title: string
      description: string | null
      kurse: {
        id: string
        title: string
        published: boolean
        sold_as: KursSoldAs
        price_cents: number
      }
    }
  }
}

// ── Backlink scan (#75) ─────────────────────────────────────────────────────

/** One document a backlink scan has to look inside, content still unparsed. */
export interface BacklinkScanRow {
  kind: BacklinkSourceKind
  id: string
  title: string
  /** Raw stored JSON — the caller parses it (`readDocumentJson`). */
  content: unknown
}

/**
 * Every document that could hold a link: published snapshots AND unpublished
 * drafts (#75, spec #63 §6).
 *
 * This is the thin shell under the pure scan — it fetches and orders, and
 * knows nothing about what a link looks like. The parse and the matching live
 * in `lib/editor/backlinks.ts`, which is where they can be unit-tested.
 *
 * ⚠ IT READS THE WHOLE CATALOGUE, DELIBERATELY. Nothing about links is
 * persisted — no links table, no index — so „what points at this document" can
 * only be answered by looking. That was the trade taken over a publish-written
 * table, which drifts and cannot see drafts at all. Two round trips, run only
 * when an author is about to delete or orphan something.
 *
 * Legacy rows (pdf, image, image_collection) carry no `content` and are
 * filtered out in the query rather than parsed and discarded: they predate
 * links entirely and can never hold one.
 *
 * Admin-only in practice — both callers start with `getAdminUser()`, and while
 * `documents` is readable by entitled students, `editor_documents` is
 * admin-only on all four verbs, so a non-admin would silently scan half the
 * catalogue. A read error is THROWN rather than returned empty: an empty scan
 * says „nothing links here", and letting a failed query say that would delete
 * a linked document without a word.
 *
 * Published rows first, then drafts, each group ordered by title — the
 * hierarchy's `position ASC, created_at ASC` is meaningless across Tasks, and
 * the result is read as a list of names. Grouping by kind rather than
 * interleaving is deliberate: the warning lists live content before drafts,
 * because that is the half a student can already see.
 */
export async function getBacklinkScanRows(): Promise<BacklinkScanRow[]> {
  const supabase = await createClient()
  const [publishedResult, draftResult] = await Promise.all([
    supabase
      .from('documents')
      .select('id, title, content')
      .not('content', 'is', null)
      .order('title', { ascending: true }),
    supabase
      .from('editor_documents')
      .select('id, title, content')
      .order('title', { ascending: true }),
  ])
  if (publishedResult.error) {
    throw new Error(
      `Veröffentlichte Dokumente konnten nicht gelesen werden: ${publishedResult.error.message}`
    )
  }
  if (draftResult.error) {
    throw new Error(`Entwürfe konnten nicht gelesen werden: ${draftResult.error.message}`)
  }
  return [
    ...(publishedResult.data ?? []).map((row) => ({ kind: 'published' as const, ...row })),
    ...(draftResult.data ?? []).map((row) => ({ kind: 'draft' as const, ...row })),
  ]
}

// ── Entitlement queries ─────────────────────────────────────────────────────

/**
 * What a user has bought — Einheiten and whole Kurse, in one round trip.
 *
 * Both halves matter since add_kurs_entitlements.sql: a Musterlösung sells
 * Einheit by Einheit, a Lernkurs sells the Kurs, and an entitlement row
 * carries one or the other (never both — `entitlements_target_check`).
 *
 * Read in full and intersected in memory rather than filtered in the query:
 * a user holds a handful of rows, and it keeps every caller free of a
 * PostgREST `.or()` filter string built from ids.
 *
 * Admins are entitled to everything; callers holding an admin user can skip
 * this entirely.
 */
export async function getEntitlementScope(
  userId: string
): Promise<{ unitIds: Set<string>; kursIds: Set<string> }> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('entitlements')
    .select('unit_id, kurs_id')
    .eq('user_id', userId)
  const unitIds = new Set<string>()
  const kursIds = new Set<string>()
  for (const row of data ?? []) {
    if (row.unit_id) unitIds.add(row.unit_id as string)
    if (row.kurs_id) kursIds.add(row.kurs_id as string)
  }
  return { unitIds, kursIds }
}

/**
 * Who is reading and which Einheiten they may open — the lock state the Kurs
 * sidebar and the Kurs page both paint with (#106).
 *
 * Memoised for the same reason `getKursNavTree` is: a layout and the page
 * inside it ask it in the same render. Admins short-circuit the entitlement
 * query entirely — RLS lets them through everything anyway, so the two sets
 * would be lists they do not consult.
 *
 * `locked` is decided HERE and nowhere else — and it takes BOTH sets: an
 * Einheit is open when it was bought itself or when its Kurs was. It is a
 * display state — a lock and a price badge — never the enforcement: that stays
 * with RLS and with the Einheit page's own `userHasUnitAccess` check.
 */
export const getKursViewerAccess = cache(
  async (): Promise<{
    isAdmin: boolean
    entitledUnitIds: Set<string>
    entitledKursIds: Set<string>
  }> => {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const isAdmin = user?.app_metadata?.['role'] === 'admin'
    if (!user || isAdmin) {
      return { isAdmin, entitledUnitIds: new Set<string>(), entitledKursIds: new Set<string>() }
    }
    const { unitIds, kursIds } = await getEntitlementScope(user.id)
    return { isAdmin, entitledUnitIds: unitIds, entitledKursIds: kursIds }
  }
)

/**
 * Single-Einheit access check — the gate the Einheit page itself runs.
 *
 * `kursId` is required, not optional: an Einheit under a Kurs sold as a whole
 * is opened by the KURS grant, and a caller that forgot to pass it would show
 * a paywall to someone who has already paid. Making it part of the signature
 * is what stops that from being a thing anyone can forget.
 *
 * Pass the `app_metadata.role` value (or undefined) so admins short-circuit
 * without a DB round-trip.
 */
export async function userHasUnitAccess(
  userId: string,
  unitId: string,
  role: string | undefined,
  kursId: string,
): Promise<boolean> {
  if (role === 'admin') return true
  const { unitIds, kursIds } = await getEntitlementScope(userId)
  return unitIds.has(unitId) || kursIds.has(kursId)
}
