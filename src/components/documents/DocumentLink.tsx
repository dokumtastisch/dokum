import Link from 'next/link'
import type { ReactNode } from 'react'
import { documentUrl } from '@/lib/constants'

/**
 * A link to a Dokument from inside the app — the gesture that opens the
 * overlay (#70), and the one every future link chip (#73) will reuse.
 *
 * `scroll={false}` is the load-bearing part. The router scrolls to the top of
 * the document on a normal navigation, and here the "document" being
 * navigated to is a slot rendered on top: letting it scroll would silently
 * throw away the reading position of the page underneath, which is still
 * mounted and which the student is coming straight back to.
 *
 * There is no `target="_blank"` and no `prefetch` opt-out to think about: the
 * point of the overlay is that the student does NOT leave the page, and a
 * prefetched document is exactly what makes it open instantly.
 */
export function DocumentLink({
  docId,
  className,
  children,
}: {
  docId: string
  className?: string
  children: ReactNode
}) {
  return (
    <Link href={documentUrl(docId)} scroll={false} className={className}>
      {children}
    </Link>
  )
}
