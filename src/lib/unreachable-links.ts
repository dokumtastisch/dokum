/**
 * unreachable-links — what a link chip becomes when its target turns out to be
 * locked, archived or deleted (#74, spec #63 user stories 21–23).
 *
 * The renderer builds every chip as a live `<a href>` because it cannot know
 * any better: whether a target is REACHABLE is a server question, and asking it
 * would put a fetch inside a pure DOM module. So the chips are reported back
 * (`DocumentRenderResult.links`), resolved here, and the ones that turn out to
 * be unreachable are rewritten in place.
 *
 * Three outcomes, and each is a different KIND of thing in the sentence:
 *
 * - **ok** — untouched. Still the renderer's own anchor, still following
 *   through the router with the student's typed values intact.
 * - **archived / missing** — no longer a link at all. It degrades to the words
 *   the author wrote plus a quiet note, so the sentence still reads. Both say
 *   the same thing: which of the two it is belongs to the operator, and telling
 *   them apart would say something about a target the student cannot reach.
 * - **locked** — still a link, and now a better one. It re-points at the
 *   Einheit and opens the unlock card in place, so a reference becomes a way to
 *   get the content rather than a dead end.
 *
 * FAIL OPEN. A resolver that cannot be reached, an answer that does not parse,
 * an error status — all leave every chip exactly as the renderer built it. A
 * document must never silently unlink itself because a request failed; an
 * unresolved chip is no worse than it was before this ticket, and a wrongly
 * blanked one is a document the student cannot navigate.
 *
 * Imperative on purpose, like everything below the renderer's container: React
 * must not reconcile in there, so this reaches into the DOM directly and the
 * one thing it hands BACK to React is the locked descriptor, which the card is
 * rendered from as a sibling of the container.
 */

import { linkTargetUrl, unitUrl } from '@/lib/constants'
import type { RenderedDocumentLink } from '@/lib/editor/document-render'
import { isPlainLeftClick, linkTargetId, linkTargetKind, type LinkTarget } from '@/lib/editor/links'
import {
  LinkTargetDescriptorSchema,
  type LinkTargetDescriptor,
  type LockedLinkTarget,
} from '@/lib/link-target-state'

/** The class a degraded link wears — plain text, styled as an absence. */
export const LINK_GONE_CLASS = 'doc-link-gone'

/** …and the note beside it. Real text, not CSS: a reader has to hear it too. */
export const LINK_GONE_NOTE_CLASS = 'doc-link-gone-note'

/** What a link that no longer goes anywhere says. Deliberately quiet. */
export const LINK_GONE_NOTE = ' (nicht mehr verfügbar)'

/** The glyph a locked chip wears in place of its kind icon. */
const LOCKED_ICON = '🔒'

export interface ResolveLinksOptions {
  /** Called when the student clicks a locked chip — React opens the card. */
  onLocked(descriptor: LockedLinkTarget): void
  /**
   * Cancels the DOM writes, not the requests. The answers are tiny and
   * in-flight ones are simply discarded: aborting them would buy nothing and
   * cost a rejected promise to swallow on every unmount.
   */
  signal?: AbortSignal
}

/**
 * Resolves every rendered link and applies the verdict to its chip.
 *
 * One request per DISTINCT target, not per chip: a document with a table of
 * contents points at the same places repeatedly, and whether a target is
 * reachable does not depend on which Sprungmarke inside it a chip aims at.
 *
 * Resolution is deliberately EAGER rather than on click. „Degrades to plain
 * readable text" is a promise about what the student sees before they commit to
 * anything — a chip that still looks like a link until it is clicked has not
 * degraded, it has lied.
 */
export async function resolveRenderedLinks(
  links: RenderedDocumentLink[],
  options: ResolveLinksOptions
): Promise<void> {
  const byTarget = new Map<string, RenderedDocumentLink[]>()
  for (const link of links) {
    const key = targetKey(link.target)
    const group = byTarget.get(key)
    if (group) group.push(link)
    else byTarget.set(key, [link])
  }

  await Promise.all(
    Array.from(byTarget.values(), async (group) => {
      const first = group[0]
      if (!first) return
      const descriptor = await fetchLinkTarget(first.target)
      // No verdict, or the caller is gone: leave the chips as they are.
      if (!descriptor || options.signal?.aborted) return
      for (const link of group) applyLinkTargetDescriptor(link, descriptor, options.onLocked)
    })
  )
}

/** Identity of the thing a chip points at — the Sprungmarke is not part of it. */
function targetKey(target: LinkTarget): string {
  return `${linkTargetKind(target)}:${linkTargetId(target)}`
}

/**
 * One resolver round-trip, or `null` for every way it can fail to produce a
 * verdict — unreachable, non-OK status, unparseable body.
 *
 * The parse is not ceremony. An unauthenticated request is answered by the
 * proxy with a redirect to the login page, so what arrives is HTML with a 200
 * on it; without the schema that would be read as a verdict.
 */
async function fetchLinkTarget(target: LinkTarget): Promise<LinkTargetDescriptor | null> {
  try {
    const response = await fetch(linkTargetUrl(linkTargetKind(target), linkTargetId(target)), {
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return null
    const parsed = LinkTargetDescriptorSchema.safeParse(await response.json())
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * Rewrites one chip for what its target turned out to be.
 *
 * Both rewrites REPLACE the element rather than mutating it, and that is the
 * load-bearing part: the renderer bound a click listener that pushes the
 * target's URL through the router, there is no handle to remove it with, and a
 * locked chip that still ran it would navigate to the very refusal this ticket
 * exists to replace. A fresh element carries no listeners.
 */
export function applyLinkTargetDescriptor(
  link: RenderedDocumentLink,
  descriptor: LinkTargetDescriptor,
  onLocked: (descriptor: LockedLinkTarget) => void
): void {
  if (descriptor.state === 'ok') return
  if (descriptor.state === 'locked') {
    link.anchor.replaceWith(lockedChip(link, descriptor, onLocked))
    return
  }
  link.anchor.replaceWith(goneText(link))
}

/**
 * The author's words, a quiet note, and no link — built fresh rather than
 * stripped down, so no `data-link-*` attribute survives to say where the
 * sentence used to point.
 */
function goneText(link: RenderedDocumentLink): HTMLElement {
  const doc = link.anchor.ownerDocument
  const span = doc.createElement('span')
  span.className = LINK_GONE_CLASS
  span.textContent = link.label
  const note = doc.createElement('span')
  note.className = LINK_GONE_NOTE_CLASS
  // Real text rather than a CSS `::after`, unlike the kind glyph: the glyph is
  // decoration a sighted reader can infer, while „this no longer exists" is the
  // whole message and has to reach a screen reader too.
  note.textContent = LINK_GONE_NOTE
  span.append(note)
  return span
}

/**
 * A locked chip: same words, a lock instead of the kind glyph, and an href that
 * now points at the EINHEIT rather than at the target.
 *
 * Re-pointing the href is what makes every path out of this chip land
 * somewhere that sells. A plain click is intercepted and opens the card without
 * leaving the page — but a middle click, „open in new tab", or our JS simply
 * not running all fall through to the href, and the Einheit page is the paywall
 * with its teaser and „Freischalten" button. Left pointing at the document,
 * every one of those would land on a refusal.
 */
function lockedChip(
  link: RenderedDocumentLink,
  descriptor: LockedLinkTarget,
  onLocked: (descriptor: LockedLinkTarget) => void
): HTMLAnchorElement {
  const chip = link.anchor.cloneNode(true) as HTMLAnchorElement
  chip.setAttribute('href', unitUrl(descriptor.unit.id))
  chip.dataset['linkIcon'] = LOCKED_ICON
  // What the stylesheet mutes the chip by. Kept as state rather than a class so
  // the chip stays a `.doc-link` and keeps its shape in the sentence.
  chip.dataset['linkState'] = 'locked'
  // The glyph is CSS chrome, so this is how „locked, and it is in that Einheit"
  // reaches a reader who gets no icon.
  chip.setAttribute('aria-label', `${link.label} – gesperrt: Einheit ${descriptor.unit.title}`)
  chip.addEventListener('click', (event) => {
    if (!isPlainLeftClick(event)) return
    event.preventDefault()
    onLocked(descriptor)
  })
  return chip
}
