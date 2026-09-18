import { getKurseNewestFirst } from '@/lib/dal'
import { formatAdminDate } from '@/lib/format-date'
import { KurseTable, type KursRow } from '@/components/admin/KurseTable'

// Auth is enforced by the proxy (src/proxy.ts) — the single enforcement point
// for /admin/*. No role check is duplicated here (see CLAUDE.md).

/**
 * The admin entry point IS the Kurs list (#108). It used to be a menu of cards
 * in front of it, and the list sat at `/admin/kurse` behind a tab row; both were
 * a detour around the only screen the admin actually starts on. `/admin/kurse`
 * now redirects here so older links still land.
 *
 * Everything below a Kurs — Einheiten, Tasks, Dokumente, Lernseiten — is edited
 * in the workspace a row opens, which is why this page needs no navigation of
 * its own. The standalone LaTeX editor is the exception and sits as a button in
 * the table header.
 */
export default async function AdminPage() {
  // Newest first: the Kurs you just made is the one you are about to open.
  const kurse = await getKurseNewestFirst()

  const rows: KursRow[] = kurse.map((kurs) => ({
    id: kurs.id,
    title: kurs.title,
    description: kurs.description,
    position: kurs.position,
    published: kurs.published,
    kurs_type: kurs.kurs_type,
    sold_as: kurs.sold_as,
    // Formatted here, on the server, with a fixed time zone — see format-date.ts.
    createdLabel: formatAdminDate(kurs.created_at),
    units: (kurs.units ?? []).map((unit) => ({ id: unit.id })),
  }))

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Kurse verwalten</h1>
      <KurseTable kurse={rows} />
    </main>
  )
}
