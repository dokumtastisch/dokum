'use client'

import { useEffect } from 'react'
import {
  MAX_RECENT_KURSE,
  RECENT_KURSE_COOKIE,
  RECENT_KURSE_MAX_AGE_SECONDS,
  parseRecentKursIds,
} from '@/lib/recent-kurse'

/**
 * Renders nothing; its only job is to note that this Kurs was opened, so the
 * catalogue can list it under „Recently viewed".
 *
 * It is mounted by the KURS LAYOUT, not by the Kurs landing page: a student who
 * follows a link straight into an Einheit has opened that Kurs just as much as
 * one who stopped on its front page, and the layout is the one thing both
 * routes share. The effect re-runs on `kursId`, so moving from one Kurs to the
 * next is recorded even though the layout itself stays mounted.
 */
export function RecentKursTracker({ kursId }: { kursId: string }) {
  useEffect(() => {
    const raw = document.cookie
      .split('; ')
      .find((row) => row.startsWith(`${RECENT_KURSE_COOKIE}=`))
      ?.split('=')[1]
    const ids = parseRecentKursIds(raw)
    const next = [kursId, ...ids.filter((id) => id !== kursId)].slice(0, MAX_RECENT_KURSE)
    document.cookie = `${RECENT_KURSE_COOKIE}=${encodeURIComponent(next.join(','))}; path=/; max-age=${RECENT_KURSE_MAX_AGE_SECONDS}`
  }, [kursId])

  return null
}
