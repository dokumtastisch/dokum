/**
 * Where a Dokument sits on the page it is rendered into (#106).
 *
 * ⚠ THIS LIVES IN `lib/` AND NOT IN `document-reveal.tsx` FOR A LOAD-BEARING
 * REASON. That file is `'use client'`, and Next.js turns EVERY export of a
 * client module into a client reference — including plain functions and
 * constants. A server component that imports one and calls it during render
 * does not get the function; it gets the reference, and the call throws
 * („Attempted to call … from the server"). The Einheit page renders these
 * anchors server-side, so the id builder cannot live behind that boundary.
 *
 * It is not detectable by `tsc` or by `next build`: the types are identical and
 * the page is server-rendered on demand, so the failure only appears when the
 * route is actually requested. Keeping the pure pieces out of client modules is
 * the only thing that prevents it.
 */

/** The DOM id an Einheit page puts on a Dokument, and `reveal()` scrolls to. */
export function documentAnchorId(docId: string): string {
  return `dokument-${docId}`
}

/**
 * Where a jumped-to anchor lands, measured from the top of the viewport.
 *
 * 66px of that is the sticky navbar; the rest is the room a heading needs so it
 * reads as „here is the start of this page" rather than as something already
 * scrolled past.
 *
 * ⚠ IT IS A NUMBER RATHER THAN A TAILWIND CLASS BECAUSE TWO DIFFERENT
 * MECHANISMS NEED THE SAME VALUE: the CSS `scroll-margin-top` on the anchor
 * (for fragment navigation) and the arithmetic in the sidebar's own
 * `window.scrollTo`. Spelling it as `scroll-mt-28` in one place and `112` in
 * the other is how they drift.
 */
export const ANCHOR_SCROLL_OFFSET = 112

/**
 * How long to wait before scrolling when an Aufgabe had to be unfolded first.
 * The accordion animates `grid-template-rows` over 300ms (UnitDetailClient), and
 * scrolling to an element that is still mid-expansion lands at the wrong offset.
 * Keep this just above that duration — the two numbers belong together.
 */
export const REVEAL_UNFOLD_MS = 320
