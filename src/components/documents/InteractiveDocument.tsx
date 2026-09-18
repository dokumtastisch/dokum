'use client'

import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { anchoredBlocks } from '@/lib/editor/anchors'
import { renderDocumentJson } from '@/lib/editor/document-render'
import { readDocumentJson } from '@/lib/editor/document-version'
import { loadMathJax } from '@/lib/editor/mathjax-loader'
import { documentIdInPath, linkHref, linkOpensOverlay } from '@/lib/link-navigation'
import type { LockedLinkTarget } from '@/lib/link-target-state'
import { resolveRenderedLinks } from '@/lib/unreachable-links'
import { DocumentPng } from './DocumentPng'
import { LinkLockedCard } from './LinkLockedCard'
import { Watermark } from './Watermark'
import './interactive-document.css'

/**
 * A published interactive document, rendered live for students (#67) and
 * editable where the author put an input (#68).
 *
 * React mounts the host and never reconciles inside it — the renderer owns
 * that DOM, including the student's controls and everything a keystroke
 * re-resolves. This component's remaining job is the browser half: typesetting
 * the formulas the renderer reports as changed.
 *
 * The PNG is a REAL PER-DOCUMENT RUNTIME FALLBACK, not a feature flag. If this
 * document cannot be rendered — a snapshot newer than this build, a failed
 * upgrade, an unrecognised node — the student gets the stored picture and the
 * failure is logged. What must never happen is a PARTIAL render: silently
 * dropping a node means someone who paid for this material misses a whole
 * section with no indication that anything is missing.
 *
 * There are three ways rendering can fail and all three land on the picture:
 * the read boundary refusing the snapshot, `renderDocumentJson` throwing, and
 * a render-phase error anywhere below — which is why the class boundary
 * exists as well as the try/catch (an error thrown inside an effect never
 * reaches an error boundary on its own).
 *
 * MathJax is the one failure that does NOT fall back: a formula that cannot
 * be typeset keeps its LaTeX source visible and the rest of the document
 * stays readable, which is strictly better than replacing a whole readable
 * document with a picture over one bad formula.
 */
export function InteractiveDocument({
  docId,
  title,
  content,
  watermarkId,
}: {
  docId: string
  title: string
  content: unknown
  watermarkId: string
}) {
  const fallback = <DocumentPng docId={docId} title={title} watermarkId={watermarkId} />
  return (
    <DocumentRenderBoundary docId={docId} fallback={fallback}>
      <LiveDocument docId={docId} content={content} watermarkId={watermarkId} fallback={fallback} />
    </DocumentRenderBoundary>
  )
}

function LiveDocument({
  docId,
  content,
  watermarkId,
  fallback,
}: {
  docId: string
  content: unknown
  watermarkId: string
  fallback: ReactNode
}) {
  // Upgrade-on-read (#64) is PURE, so it happens during render: an older
  // snapshot is migrated, an unreadable one is refused whole. That covers
  // every documented fallback reason — unknown version, failed upgrade,
  // unrecognised node — without a round-trip through state.
  const snapshot = useMemo(() => readDocumentJson(content), [content])
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [renderFailed, setRenderFailed] = useState(false)
  // The one thing the DOM below the host hands back to React (#74): a link into
  // material this student has not bought opens the unlock card rather than
  // travelling to the refusal it would otherwise land on. `useState`'s setter is
  // stable, so passing it into the effect does not make the effect re-run — and
  // re-running it would rebuild the document and lose everything typed into it.
  const [lockedTarget, setLockedTarget] = useState<LockedLinkTarget | null>(null)

  // The router is reached through a ref rather than through the effect's
  // dependencies, and that is not a style choice: re-running the effect calls
  // `renderDocumentJson` again, which rebuilds the whole document and throws
  // away every value the student typed into it. Nothing that merely CHANGES may
  // be a dependency of this effect.
  const router = useRouter()
  const routerRef = useRef(router)
  useEffect(() => {
    routerRef.current = router
  }, [router])

  useEffect(() => {
    if (!snapshot.ok) {
      console.error(`[InteractiveDocument ${docId}] Snapshot abgelehnt, PNG-Fallback:`, snapshot.error)
      return
    }
    const host = hostRef.current
    if (!host) return
    let cancelled = false

    // Typesetting runs are SERIALISED. A student holding a key down fires a
    // recompute per keystroke, and MathJax is async: two overlapping runs over
    // the same formula could otherwise settle in the wrong order and leave a
    // stale picture. Chaining them also makes each run read the LaTeX that is
    // current when it executes, so a burst collapses onto the final value.
    let queue: Promise<void> = Promise.resolve()
    const typeset = (targets: HTMLElement[]) => {
      if (!targets.length) return
      queue = queue
        .then(() => typesetFormulas(targets, () => cancelled))
        // A rejected link would swallow every run queued behind it, and the
        // document would silently stop typesetting for the rest of the session.
        .catch((err) => {
          console.error('[InteractiveDocument] Formelsatz fehlgeschlagen:', err)
        })
    }

    // Where a link lands inside THIS document (#73). Run after the first
    // typeset rather than straight after the render: a formula changes height
    // when its source is replaced by SVG, so scrolling before that settles
    // aims at a position the document is about to move out from under.
    const scrollToMarkedSpot = (anchorId: string) => {
      if (!anchorId) return
      // Matched by walking the marked blocks rather than by a selector: an
      // anchor id is opaque and only ever required to be non-empty, so it
      // cannot be interpolated into one safely.
      const block = anchoredBlocks(host).find((el) => el.dataset['anchorId'] === anchorId)
      block?.scrollIntoView({ block: 'start' })
    }

    // Whether THIS mounted copy is the one the URL is addressing (#99).
    //
    // The Einheit page renders every document of the unit live at once, so
    // opening the overlay on one of them puts the same `data-anchor-id` in the
    // DOM twice. Both copies would otherwise chase the same fragment and the
    // page underneath would scroll away behind the overlay — the one thing the
    // overlay (#70) exists to prevent, and invisible until the student closes
    // it and finds themselves somewhere else.
    //
    // Two conditions, both needed. The layer: a host's own dialog must be the
    // open one, which with `null === null` also says that while no dialog is
    // open only a host outside every dialog may move. And the address: the
    // document the path names must be this one, which is what separates two
    // different documents that happen to share an anchor id.
    const addressesThisDocument = () =>
      host.closest('dialog') === window.document.querySelector('dialog[open]') &&
      documentIdInPath(window.location.pathname) === docId

    // Cancels the link resolver's DOM writes when this document goes away —
    // the requests themselves are left to finish and their answers discarded.
    const linkResolution = new AbortController()

    try {
      const { renderTargets, links: renderedLinks } = renderDocumentJson(snapshot.doc, host, {
        imageUrl: (imageId) => `/api/image/${imageId}`,
        linkHref,
        // Client-side, so the page underneath is never unmounted and the
        // values the student typed survive the trip (#70). The href comes back
        // from the chip rather than being resolved again, so a click cannot
        // land anywhere other than where the chip says it goes.
        //
        // `scroll: false` only for the overlay: it stops the router discarding
        // the reading position of a page that stays on screen, and would
        // strand a student halfway down a Kurs page they have never seen.
        followLink: (target, href) => {
          routerRef.current.push(href, { scroll: !linkOpensOverlay(target) })
          // A Sprungmarke in the document ALREADY ON SCREEN moves nothing on
          // its own (#98): that push differs from the current URL only in its
          // fragment, so the router writes history with `pushState` — and
          // `pushState` never fires `hashchange`. The listener below is never
          // reached, which kills the most natural use of a Sprungmarke, a
          // table of contents linking down into its own document. So resolve
          // that case here instead of waiting for an event that never comes.
          //
          // The anchor comes off the target rather than out of the URL: it
          // does not depend on when the router commits the push.
          //
          // Guarded exactly like the listener, and for the same reason. On the
          // Einheit page this document is also rendered inline underneath, and
          // a Dokument link there opens the overlay — so the copy that must
          // scroll is the one the overlay is about to mount, never this one.
          if (!('docId' in target) || target.docId !== docId || !target.anchorId) return
          if (addressesThisDocument()) scrollToMarkedSpot(target.anchorId)
        },
        // Only the formulas whose value actually moved — an untouched formula
        // must not re-typeset, and re-typesetting is what this costs.
        onRecompute: typeset,
      })
      typeset(renderTargets)
      // Which of those chips actually goes anywhere (#74). Asynchronous and
      // deliberately not awaited: the document is already on screen and
      // readable, and a link that turns out to be locked or gone is rewritten
      // in place a moment later. Failures inside are already swallowed one
      // request at a time — every chip is simply left alone — so this catch is
      // for the DOM writes.
      void resolveRenderedLinks(renderedLinks, {
        onLocked: setLockedTarget,
        signal: linkResolution.signal,
      }).catch((err) => {
        console.error(`[InteractiveDocument ${docId}] Link-Auflösung fehlgeschlagen:`, err)
      })
      // Deliberately UNGUARDED, unlike the two paths above: this runs once per
      // mount, so only the copy that was just created by the navigation can
      // reach it. Asking `addressesThisDocument()` here would instead make the
      // first jump depend on whether the overlay's `showModal()` has landed by
      // the time the typeset queue drains.
      queue = queue.then(() => {
        if (!cancelled) scrollToMarkedSpot(markedSpotInUrl())
      })
    } catch (err) {
      // Leave nothing half-drawn behind before handing over to the picture.
      host.replaceChildren()
      console.error(`[InteractiveDocument ${docId}] Rendern fehlgeschlagen, PNG-Fallback:`, err)
      // The failure is discovered while synchronising with the DOM, so it has
      // to travel back into React — deferred by a microtask rather than set
      // synchronously here, which would cascade renders.
      void Promise.resolve().then(() => {
        if (!cancelled) setRenderFailed(true)
      })
    }

    // What is left for `hashchange` is history traversal — Back and Forward
    // between two fragment URLs, which no click adapter sees. Every mounted
    // document hears it, so the copy the URL is not addressing has to say so
    // itself; a marked spot can exist in more than one place at once.
    const onHashChange = () => {
      if (addressesThisDocument()) scrollToMarkedSpot(markedSpotInUrl())
    }
    window.addEventListener('hashchange', onHashChange)

    return () => {
      cancelled = true
      linkResolution.abort()
      window.removeEventListener('hashchange', onHashChange)
    }
  }, [snapshot, docId])

  if (!snapshot.ok || renderFailed) return <>{fallback}</>

  return (
    <div className="relative mt-2">
      <div ref={hostRef} className="dokum-document" />
      <Watermark id={watermarkId} />
      {/* Outside the host, which the renderer owns — React may only reconcile
          out here. A modal `<dialog>` lands in the top layer regardless, so
          sitting inside a `relative` box costs it no stacking. */}
      {lockedTarget && (
        <LinkLockedCard target={lockedTarget} onDismiss={() => setLockedTarget(null)} />
      )}
    </div>
  )
}

/**
 * The Sprungmarke the current URL asks for, or `''`.
 *
 * A fragment is user-supplied text — a hand-typed or truncated URL can carry a
 * broken escape sequence, and `decodeURIComponent` throws on those. Falling
 * back to the raw fragment keeps a bad URL from throwing out of a listener over
 * something as small as a scroll position.
 */
function markedSpotInUrl(): string {
  const raw = window.location.hash.slice(1)
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * Typesets each formula with the BUNDLED MathJax — no CDN, no `eval`, and so
 * no CSP change. The renderer deliberately stops at the resolved LaTeX so it
 * stays pure and jsdom-testable; this is the browser half.
 *
 * Each target's LaTeX is read here rather than captured by the caller, and
 * what was last typeset is remembered on the element — so a run that arrives
 * after a newer edit does no work instead of painting a stale formula.
 */
async function typesetFormulas(
  targets: HTMLElement[],
  isCancelled: () => boolean
): Promise<void> {
  let mathJax: Awaited<ReturnType<typeof loadMathJax>>
  try {
    mathJax = await loadMathJax()
  } catch (err) {
    console.error('[InteractiveDocument] MathJax konnte nicht geladen werden:', err)
    // Without MathJax the resolved source IS the formula the student reads, so
    // it has to keep up with their edits — on the first render it is already
    // there, on a recompute it is not.
    for (const target of targets) target.textContent = target.dataset['latex'] ?? ''
    return
  }

  for (const target of targets) {
    if (isCancelled()) return
    const latex = target.dataset['latex'] ?? ''
    if (target.dataset['typesetLatex'] === latex) continue
    try {
      const svg = await mathJax.tex2svgPromise(latex, { display: true })
      if (isCancelled()) return
      target.replaceChildren(svg)
      target.dataset['typesetLatex'] = latex
    } catch {
      const box = target.ownerDocument.createElement('div')
      box.className = 'formula-error'
      box.textContent = latex
      target.replaceChildren(box)
      target.dataset['typesetLatex'] = latex
    }
  }
}

/**
 * Catches render-phase errors from the live document and shows the picture
 * instead. The effect-level try/catch above cannot cover these: React does
 * not route errors thrown during render through the component that scheduled
 * them, and an effect's throw never reaches a boundary at all — so both
 * mechanisms are needed to make "never partial" actually true.
 */
class DocumentRenderBoundary extends Component<
  { docId: string; fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  override componentDidCatch(error: Error) {
    console.error(`[InteractiveDocument ${this.props.docId}] Renderfehler, PNG-Fallback:`, error)
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
