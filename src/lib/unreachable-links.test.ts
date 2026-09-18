// @vitest-environment jsdom
/**
 * unreachable-links tests (#74).
 *
 * Behavioural, in the style of the document-render suite: given what the
 * resolver says about a target, what does the STUDENT end up with in the
 * sentence — is it still clickable, where does it go, and what does it say?
 *
 * The links under test are produced by the real renderer rather than by hand,
 * because half of what this module has to get right is UNDOING what the
 * renderer did: a locked chip must stop following its link through the router,
 * and only replacing the element it bound its listener to achieves that.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LatestEditorDocumentJson } from '@/lib/editor/document-json'
import { renderDocumentJson } from '@/lib/editor/document-render'
import { linkTargetId, type LinkTarget } from '@/lib/editor/links'
import type { LinkTargetDescriptor } from '@/lib/link-target-state'
import { applyLinkTargetDescriptor, resolveRenderedLinks } from './unreachable-links'

const DOC_ID = '11111111-1111-4111-8111-111111111111'
const KURS_ID = '33333333-3333-4333-8333-333333333333'
const UNIT_ID = '22222222-2222-4222-8222-222222222222'

const LOCKED: LinkTargetDescriptor = {
  state: 'locked',
  title: 'Aufgabe 2 — Herleitung',
  unit: {
    id: UNIT_ID,
    title: 'Einheit 3',
    description: 'DCF und Multiples.',
    kursId: KURS_ID,
    kursTitle: 'Unternehmensbewertung',
    soldAs: 'unit',
    kursPriceCents: 1500,
  },
}

function withLink(target: LinkTarget, label = 'Kapitel 3'): LatestEditorDocumentJson {
  return {
    version: '1.1',
    variables: [],
    content: [
      {
        type: 'paragraph',
        children: [{ text: 'Siehe ' }, { type: 'link', target, label }, { text: ' dazu.' }],
      },
    ],
    library: [],
  }
}

/** Renders one link and hands back the sentence it sits in plus what followed it. */
function renderOneLink(target: LinkTarget = { docId: DOC_ID }) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const followed: LinkTarget[] = []
  const { links } = renderDocumentJson(withLink(target), host, {
    imageUrl: (id) => `/api/image/${id}`,
    linkHref: (t) => `/ziel/${linkTargetId(t)}`,
    followLink: (t) => followed.push(t),
  })
  const link = links[0]
  if (!link) throw new Error('no link rendered')
  return { host, link, followed, sentence: () => host.querySelector('p')?.textContent ?? '' }
}

function click(el: Element, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init })
  el.dispatchEvent(event)
  return event
}

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('applyLinkTargetDescriptor — a reachable target', () => {
  it('leaves the chip exactly as the renderer built it', () => {
    const { link, followed } = renderOneLink()
    applyLinkTargetDescriptor(link, { state: 'ok' }, () => {})
    expect(link.anchor.isConnected).toBe(true)
    expect(link.anchor.getAttribute('href')).toBe(`/ziel/${DOC_ID}`)
    // Still the renderer's own anchor, so it still follows through the router
    // instead of unmounting the page the student is typing into.
    click(link.anchor)
    expect(followed).toEqual([{ docId: DOC_ID }])
  })
})

describe('applyLinkTargetDescriptor — a target that is gone', () => {
  for (const state of ['archived', 'missing'] as const) {
    it(`degrades a ${state} target to plain text the sentence still reads`, () => {
      const { link, sentence } = renderOneLink()
      applyLinkTargetDescriptor(link, { state }, () => {})
      expect(sentence()).toBe('Siehe Kapitel 3 (nicht mehr verfügbar) dazu.')
    })

    it(`leaves a ${state} target with nothing to click and nothing to focus`, () => {
      const { host, link, followed } = renderOneLink()
      applyLinkTargetDescriptor(link, { state }, () => {})
      expect(host.querySelector('a')).toBeNull()
      expect(host.querySelector('[href]')).toBeNull()
      expect(followed).toEqual([])
    })
  }

  it('says the same thing whether the target is archived or deleted', () => {
    // Which of the two it is is the operator's business. To the student both
    // are „gone", and telling them apart would say something about a target
    // they cannot reach.
    const archived = renderOneLink()
    applyLinkTargetDescriptor(archived.link, { state: 'archived' }, () => {})
    const missing = renderOneLink()
    applyLinkTargetDescriptor(missing.link, { state: 'missing' }, () => {})
    expect(archived.sentence()).toBe(missing.sentence())
  })

  it('drops the target it used to point at along with the link', () => {
    const { host, link } = renderOneLink({ docId: DOC_ID, anchorId: 'anc_1' })
    applyLinkTargetDescriptor(link, { state: 'missing' }, () => {})
    expect(host.innerHTML).not.toContain(DOC_ID)
    expect(host.innerHTML).not.toContain('anc_1')
  })
})

describe('applyLinkTargetDescriptor — a locked target', () => {
  it('stays clickable and opens the unlock card instead of the target', () => {
    const opened: LinkTargetDescriptor[] = []
    const { host, link, followed } = renderOneLink()
    applyLinkTargetDescriptor(link, LOCKED, (d) => opened.push(d))

    const chip = host.querySelector('a')
    if (!chip) throw new Error('a locked chip must stay a link')
    const event = click(chip)

    expect(opened).toEqual([LOCKED])
    expect(event.defaultPrevented).toBe(true)
    // The renderer's own follow must NOT also fire: it would push the document
    // URL and land the student on the refusal this ticket exists to replace.
    expect(followed).toEqual([])
  })

  it('re-points at the Einheit, so every path out of it sells rather than 404s', () => {
    // A middle click, „open in new tab", or a browser with our JS not running
    // all fall through to the href. Pointed at the document it would land on
    // the same dead end; pointed at the Einheit it lands on the paywall.
    const { host, link } = renderOneLink()
    applyLinkTargetDescriptor(link, LOCKED, () => {})
    expect(host.querySelector('a')?.getAttribute('href')).toBe(`/einheiten/${UNIT_ID}`)
  })

  it('leaves a modified click to the browser, exactly as a live chip does', () => {
    const opened: LinkTargetDescriptor[] = []
    const { host, link } = renderOneLink()
    applyLinkTargetDescriptor(link, LOCKED, (d) => opened.push(d))
    const chip = host.querySelector('a')!
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) {
      expect(click(chip, init).defaultPrevented).toBe(false)
    }
    expect(opened).toEqual([])
  })

  it('keeps the label and says it is locked to a reader who gets no glyph', () => {
    const { host, link } = renderOneLink()
    applyLinkTargetDescriptor(link, LOCKED, () => {})
    const chip = host.querySelector('a')!
    expect(chip.textContent).toBe('Kapitel 3')
    expect(chip.getAttribute('aria-label')).toContain('Einheit 3')
    expect(chip.getAttribute('aria-label')).toContain('gesperrt')
  })

  it('leaves the sentence itself carrying only the words the author wrote', () => {
    // The descriptor knows the target's title and the card DOES show it — the
    // student is told what they would be buying. What must not happen is the
    // resolver rewriting the running text of a document around it: the chip
    // stays the author's label, so a verdict can never edit the material.
    const { host, link } = renderOneLink()
    applyLinkTargetDescriptor(link, LOCKED, () => {})
    expect(host.textContent).not.toContain(LOCKED.title)
  })
})

describe('resolveRenderedLinks — asking the resolver', () => {
  function stubResolver(reply: (url: string) => unknown, ok = true) {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url)
        return { ok, json: async () => reply(url) } as Response
      })
    )
    return calls
  }

  it('asks the resolver for the target kind and id the chip carries', async () => {
    const calls = stubResolver(() => ({ state: 'ok' }))
    const { link } = renderOneLink({ kursId: KURS_ID })
    await resolveRenderedLinks([link], { onLocked: () => {} })
    expect(calls).toEqual([`/api/link-target/kurs/${KURS_ID}`])
  })

  it('asks once per distinct target, however many chips point at it', async () => {
    // Two chips into the same Dokument at different Sprungmarken are the same
    // question: whether a target is reachable does not depend on the spot
    // inside it.
    const calls = stubResolver(() => ({ state: 'ok' }))
    const a = renderOneLink({ docId: DOC_ID, anchorId: 'anc_1' })
    const b = renderOneLink({ docId: DOC_ID, anchorId: 'anc_2' })
    await resolveRenderedLinks([a.link, b.link], { onLocked: () => {} })
    expect(calls).toEqual([`/api/link-target/document/${DOC_ID}`])
  })

  it('applies one verdict to every chip that shares the target', async () => {
    stubResolver(() => ({ state: 'missing' }))
    const a = renderOneLink({ docId: DOC_ID })
    const b = renderOneLink({ docId: DOC_ID, anchorId: 'anc_2' })
    await resolveRenderedLinks([a.link, b.link], { onLocked: () => {} })
    expect(a.sentence()).toContain('nicht mehr verfügbar')
    expect(b.sentence()).toContain('nicht mehr verfügbar')
  })

  it('leaves every chip alone when the resolver cannot be reached', async () => {
    // FAIL OPEN, and deliberately so: a resolver outage must not silently
    // unlink a whole document. An unresolved chip behaves exactly as it did
    // before this ticket — clickable, and refused at the far end if it must be.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const { host, link, followed } = renderOneLink()
    await resolveRenderedLinks([link], { onLocked: () => {} })
    expect(host.querySelector('a')?.getAttribute('href')).toBe(`/ziel/${DOC_ID}`)
    click(host.querySelector('a')!)
    expect(followed).toEqual([{ docId: DOC_ID }])
  })

  it('leaves every chip alone when the answer is not a verdict', async () => {
    // What an unauthenticated fetch actually gets: the proxy's redirect to the
    // login page, i.e. HTML. Reading that as a verdict is the failure mode the
    // parse exists to stop.
    stubResolver(() => '<!DOCTYPE html><html lang="de">')
    const { host, link } = renderOneLink()
    await resolveRenderedLinks([link], { onLocked: () => {} })
    expect(host.querySelector('a')?.getAttribute('href')).toBe(`/ziel/${DOC_ID}`)
  })

  it('leaves every chip alone on an error status', async () => {
    stubResolver(() => ({ error: 'Nicht angemeldet.' }), false)
    const { host, link } = renderOneLink()
    await resolveRenderedLinks([link], { onLocked: () => {} })
    expect(host.querySelector('a')?.getAttribute('href')).toBe(`/ziel/${DOC_ID}`)
  })

  it('touches nothing once the caller has gone away', async () => {
    // The document is unmounted while the answers are in flight. Rewriting DOM
    // that a later render already replaced would resurrect a chip nobody is
    // looking at.
    stubResolver(() => ({ state: 'missing' }))
    const { host, link } = renderOneLink()
    const controller = new AbortController()
    controller.abort()
    await resolveRenderedLinks([link], { onLocked: () => {}, signal: controller.signal })
    expect(host.querySelector('a')?.getAttribute('href')).toBe(`/ziel/${DOC_ID}`)
  })

  it('does nothing at all for a document without links', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await resolveRenderedLinks([], { onLocked: () => {} })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
