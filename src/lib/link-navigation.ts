/**
 * link-navigation — where a stored link actually goes (#73, spec #63 §5/§6).
 *
 * A link stores a published primary key and nothing else. Turning that into a
 * URL is app knowledge, not editor knowledge, which is why it lives here rather
 * than in `lib/editor/links.ts`: the editor modules stay ignorant of this app's
 * routes, and the student renderer takes this function as an ADAPTER so the two
 * layers never point at each other.
 *
 * Two of the four shapes need more than an id substitution:
 *
 * - **An Einheit** is stored as `{ unitId }`, but its page lives under its Kurs
 *   (`/kurse/[kursId]/units/[unitId]`), and the link never recorded the Kurs.
 *   The flat `/einheiten/[unitId]` route is the server-side half that fills it
 *   in, so an Einheit link is followable without a client-side lookup.
 * - **A Sprungmarke** is a spot inside a document, which no route can address —
 *   it becomes the URL's fragment, resolved against the rendered DOM.
 *
 * Pure: a string in, a string out, no fetch and no auth. Whether the student
 * may actually SEE what is at the other end is decided where it is read, and
 * telling locked apart from gone is #74's resolver.
 */

import { kursUrl, documentUrl, unitUrl } from '@/lib/constants'
import { linkTargetAnchorId, type LinkTarget } from '@/lib/editor/links'

/** The browser URL a link chip points at. */
export function linkHref(target: LinkTarget): string {
  if ('kursId' in target) return kursUrl(target.kursId)
  if ('unitId' in target) return unitUrl(target.unitId)
  const anchorId = linkTargetAnchorId(target)
  return anchorId ? documentUrl(target.docId, anchorId) : documentUrl(target.docId)
}

/**
 * Whether following this target keeps the student where they are. Only a
 * Dokument has an intercepting overlay route (#70); a Kurs or an Einheit is a
 * page of its own and navigating to it is an ordinary, scroll-to-top departure.
 *
 * The distinction is not cosmetic: `scroll: false` is what stops the router
 * throwing away the reading position of the page the overlay opens on top of,
 * and applying it to a real navigation would land the student halfway down a
 * page they have never seen.
 */
export function linkOpensOverlay(target: LinkTarget): boolean {
  return 'docId' in target
}

/**
 * The Dokument a browser path names, or `null` where it names none — the
 * inverse of the `documentUrl` half of `linkHref`.
 *
 * Which mounted document may react to a fragment depends on this (#99): the
 * Einheit page renders every document of its unit live at once, so opening the
 * overlay puts the same Sprungmarke in the DOM twice, and a copy the URL is not
 * addressing must sit still rather than scroll the page out from under the
 * student. An Einheit or Kurs path names no document, which is exactly what
 * silences those inline copies.
 *
 * The intercepted overlay route resolves to the same flat path as the full
 * page, and that is deliberate: both are addressing that one document, and
 * which of the two is on screen is a question about the DOM, not the URL.
 */
export function documentIdInPath(pathname: string): string | null {
  const match = /^\/dokumente\/([^/?#]+)/.exec(pathname)
  if (!match) return null
  try {
    return decodeURIComponent(match[1]!)
  } catch {
    return match[1]!
  }
}
