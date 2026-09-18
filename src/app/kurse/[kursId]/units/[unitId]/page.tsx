import { notFound } from 'next/navigation'
import { getKursNavTree, getUnitById, getUnitWithTasks, userHasUnitAccess } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import UnitDetailClient from '@/components/UnitDetailClient'
import UnitPaywall from '@/components/kurse/UnitPaywall'
import { LessonUnitHeader, LessonUnitSection } from '@/components/lessons/LessonView'
import { documentAnchorId } from '@/lib/document-anchor'
import { readLessonJson } from '@/lib/lessons/lesson-version'
import { splitUnitLessons } from '@/lib/lessons/unit-lessons'

interface Props {
  params: Promise<{ kursId: string; unitId: string }>
  searchParams: Promise<{ openTask?: string; canceled?: string; purchased?: string }>
}

/**
 * One Einheit, rendered into the Kurs layout's content column (#106).
 *
 * There is no page chrome here any more — no background, no width cap, no
 * „Back to course" link. The Kurs shell supplies all three, and the way back is
 * the sidebar standing beside this content the whole time.
 */
export default async function UnitPage({ params, searchParams }: Props) {
  const { kursId, unitId } = await params
  const { openTask, canceled, purchased } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // Proxy already redirects unauthenticated visitors away from protected
  // pages, but guard defensively in case the matcher is ever loosened.
  if (!user) notFound()

  const role = user.app_metadata?.['role'] as string | undefined
  // The Kurs id is part of the question: an Einheit under a Kurs sold whole
  // is opened by the Kurs grant, not by one of its own.
  const hasAccess = await userHasUnitAccess(user.id, unitId, role, kursId)

  if (!hasAccess) {
    // The full tree is gated by RLS, so fall back to the bare-unit query that
    // only needs the published-Kurs visibility (still allowed for everyone).
    const meta = await getUnitById(unitId)
    if (!meta) notFound()

    // Memoised and already fetched by the Kurs layout — this is what the offer
    // is made of: `sold_as` decides whether the button sells this Einheit or
    // the whole Kurs, and `price_cents` what the latter costs.
    const kurs = await getKursNavTree(kursId)
    if (!kurs) notFound()

    return (
      <>
        <h1 className="text-3xl font-black tracking-[0] text-black">{meta.title}</h1>
        {meta.description && (
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-gray-600">{meta.description}</p>
        )}
        <UnitPaywall
          unitId={unitId}
          title={meta.title}
          description={meta.description}
          canceled={canceled === '1'}
          kursId={kursId}
          kursTitle={kurs.title}
          soldAs={kurs.sold_as}
          kursPriceCents={kurs.price_cents}
        />
      </>
    )
  }

  const unit = await getUnitWithTasks(unitId)
  if (!unit) notFound()

  const watermarkId = user.id.slice(0, 8).toUpperCase()

  // A Unit may hold Lernseiten, an Aufgaben-Akkordeon, or both (#107). The
  // split is a pure function so the rule lives in one testable place, and it
  // also removes the hidden „Lernseite" Aufgabe from what the accordion sees.
  const { lessons, tasks } = splitUnitLessons(unit.tasks)

  // „3.3" comes from where this Einheit sits in its Kurs. The nav tree is
  // memoised and the Kurs layout above already fetched it, so asking again
  // costs nothing — and it is the only place that knows the ordering the
  // student sees. `null` when the Einheit is not in the tree (it cannot
  // normally happen; a missing number is better than a wrong one).
  const navTree = await getKursNavTree(kursId)
  const unitIndex = navTree?.units.findIndex((u) => u.id === unitId) ?? -1
  const unitNumber = unitIndex >= 0 ? unitIndex + 1 : null

  return (
    <>
      <LessonUnitHeader
        title={unit.title}
        description={unit.description}
        unitNumber={unitNumber}
        isLernkurs={navTree?.kurs_type === 'lernkurs'}
      />
      {purchased === '1' && (
        <p className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Payment successful – this unit is unlocked.
        </p>
      )}

      {lessons.map((doc, index) => (
        <LessonSection
          key={doc.id}
          doc={doc}
          unitNumber={unitNumber}
          lessonIndex={index}
          lessonCount={lessons.length}
        />
      ))}

      {/* Rendered only when there is something in it. A Lernkurs Unit holds no
          Aufgaben, and an empty accordion below a lesson would be furniture. */}
      {tasks.length > 0 && (
        <UnitDetailClient tasks={tasks} openTaskId={openTask} watermarkId={watermarkId} />
      )}
    </>
  )
}

/**
 * One Lernseite on the Unit page.
 *
 * The stored JSON goes through the read boundary, and a refusal is SHOWN rather
 * than swallowed. A Lernseite has no PNG to fall back to — unlike an
 * interactive document — so „this page cannot be displayed" is the honest
 * outcome, and staying silent would leave a student staring at a heading with
 * nothing under it and no idea anything was wrong.
 */
function LessonSection({
  doc,
  unitNumber,
  lessonIndex,
  lessonCount,
}: {
  doc: { id: string; title: string; content: unknown }
  unitNumber: number | null
  lessonIndex: number
  lessonCount: number
}) {
  const result = readLessonJson(doc.content)
  if (!result.ok) {
    return (
      <div className="mt-8 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <p className="font-medium">{doc.title}</p>
        <p className="mt-1">{result.error}</p>
      </div>
    )
  }
  return (
    <LessonUnitSection
      lesson={result.lesson}
      title={doc.title}
      anchorId={documentAnchorId(doc.id)}
      unitNumber={unitNumber}
      lessonIndex={lessonIndex}
      lessonCount={lessonCount}
    />
  )
}
