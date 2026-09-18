'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import type { KursType } from '@/types'

export type KursFilter = KursType | 'all'

/** Anything that is not one of the two Kurs types means „alle Kurse". */
export function parseKursFilter(value: string | null): KursFilter {
  return value === 'musterloesung' || value === 'lernkurs' ? value : 'all'
}

export function useKursFilter(): KursFilter {
  return parseKursFilter(useSearchParams().get('typ'))
}

/**
 * A category switch that does NOT navigate.
 *
 * Which courses show is a question this page can already answer: every Kurs is
 * in the payload before the first click, and picking a category only hides some
 * of them. Routing to `?typ=…` made the server re-run the deep Kurs query, the
 * auth check and the proxy for an array filter the browser could do in a tick —
 * roughly a second and a half of waiting per click.
 *
 * So the click writes the URL through the History API instead. Next re-renders
 * every `useSearchParams()` reader from that push without a request, which
 * makes the switch immediate and still leaves a URL that can be shared,
 * bookmarked and walked back through with the browser's own buttons.
 */
export function FilterLink({
  href,
  ...props
}: Omit<React.ComponentProps<typeof Link>, 'href'> & { href: string }) {
  return (
    <Link
      {...props}
      href={href}
      onClick={(event) => {
        // Everything that is not a plain left click stays the browser's: a
        // cmd-click still opens the filtered catalogue in a new tab.
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return
        }
        event.preventDefault()
        window.history.pushState(null, '', href)
      }}
    />
  )
}
