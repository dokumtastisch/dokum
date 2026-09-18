'use client'

import { useEffect, useRef } from 'react'
import { loadMathJax } from '@/lib/editor/mathjax-loader'

/**
 * One typeset formula on a Lernseite (#107).
 *
 * THE LATEX SOURCE IS THE SERVER-RENDERED CONTENT, and MathJax replaces it in
 * an effect. That ordering is the whole design: the page is readable — as
 * source, but readable — before the 800 kB MathJax chunk has arrived or if it
 * never does, which is the same fallback `InteractiveDocument` uses when the
 * loader fails. Rendering an empty box and filling it later would make every
 * formula on the page a hole for the length of that download.
 *
 * ⚠ THIS COMPONENT MUST NEVER RE-RENDER WITH DIFFERENT PROPS. `replaceChildren`
 * puts DOM inside a node React believes it owns, so a re-render would reconcile
 * against children that are no longer the ones it wrote. That is safe here for
 * a structural reason rather than by luck: a Lernseite is static content with
 * no state anywhere above it — nothing on the page can trigger a re-render. If
 * a lesson ever gains an interactive block, this component needs a `key` tied
 * to its LaTeX so a changed formula remounts instead of reconciling.
 *
 * `display` picks between the centred block form and the inline form that sits
 * in the middle of a sentence.
 */
export function LessonMath({
  latex,
  display = false,
  className,
}: {
  latex: string
  display?: boolean
  className?: string
}) {
  const host = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    let cancelled = false

    loadMathJax()
      .then(async (mathJax) => {
        const svg = await mathJax.tex2svgPromise(latex, { display })
        // The cancel check must sit AFTER the await: an unmount during the
        // typeset would otherwise write into a detached node.
        if (cancelled || !host.current) return
        host.current.replaceChildren(svg)
      })
      .catch((err) => {
        // The source stays on screen — see the note above. Nothing to repair.
        console.error('[LessonMath] MathJax konnte nicht geladen werden:', err)
      })

    return () => {
      cancelled = true
    }
  }, [latex, display])

  return (
    <span ref={host} className={className}>
      {latex}
    </span>
  )
}
