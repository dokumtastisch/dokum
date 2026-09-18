import { notFound } from 'next/navigation'
import { KursManageWorkspace } from '@/components/admin/KursManageWorkspace'
import { getAdminKursWorkspace, getDocumentWithAncestry } from '@/lib/dal'

// Auth is enforced centrally by src/proxy.ts for every /admin route.
export default async function AdminKursWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ kursId: string }>
  searchParams: Promise<{ lessonId?: string }>
}) {
  const [{ kursId }, { lessonId }] = await Promise.all([params, searchParams])
  const [kurs, lessonDocument] = await Promise.all([
    getAdminKursWorkspace(kursId),
    lessonId ? getDocumentWithAncestry(lessonId) : Promise.resolve(null),
  ])
  if (!kurs) notFound()

  const initialLesson =
    lessonDocument?.kurs.id === kursId && lessonDocument.document.file_type === 'lesson'
      ? {
          id: lessonDocument.document.id,
          title: lessonDocument.document.title,
          content: lessonDocument.document.content,
        }
      : undefined

  return (
    <KursManageWorkspace
      key={initialLesson?.id ?? 'course'}
      kurs={kurs}
      initialLesson={initialLesson}
    />
  )
}
