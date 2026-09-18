/**
 * backlinks tests (#75, spec #63 §6).
 *
 * Behavioural: given every document that could hold a link — published
 * snapshots AND unpublished drafts — what points at the one document about to
 * be deleted or orphaned?
 *
 * The scan is pure precisely so the awkward cases can be pinned without a
 * database: a link buried in a styled group inside a list item, an
 * anchor-qualified link that names a Sprungmarke rather than the document, and
 * a Kurs whose id happens to equal the document's.
 *
 * Runs in plain Node: no DOM, no Supabase.
 */

import { describe, expect, it } from 'vitest'
import {
  backlinkDeleteWarning,
  backlinkRepublishWarning,
  backlinkScanFailedWarning,
  findDocumentBacklinks,
  type Backlink,
  type BacklinkCandidate,
  type BacklinkScan,
} from './backlinks'
import type { InlineNode, LatestEditorDocumentJson } from './document-json'

const TARGET = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ANCHOR = 'anc_7fK2'

/** A document whose single paragraph holds the given inline nodes. */
function docWith(...children: InlineNode[]): LatestEditorDocumentJson {
  return {
    version: '1.1',
    variables: [],
    content: [{ type: 'paragraph', children }],
    library: [],
  }
}

/** The v1.1 link node, spelled out — `label` is what the chip reads as. */
function linkTo(docId: string, anchorId?: string): InlineNode {
  return {
    type: 'link',
    target: anchorId ? { docId, anchorId } : { docId },
    label: 'siehe dort',
  }
}

function published(id: string, title: string, content: LatestEditorDocumentJson): BacklinkCandidate {
  return { kind: 'published', id, title, content }
}

function draft(id: string, title: string, content: LatestEditorDocumentJson): BacklinkCandidate {
  return { kind: 'draft', id, title, content }
}

// ── Nothing to warn about ───────────────────────────────────────────────────

describe('findDocumentBacklinks — the quiet case', () => {
  it('finds nothing in an empty catalogue', () => {
    expect(findDocumentBacklinks([], TARGET)).toEqual([])
  })

  it('finds nothing when no document links anywhere', () => {
    const candidates = [
      published(OTHER, 'Aufgabe 1', docWith({ text: 'Nur Text' })),
      draft('d1', 'Entwurf', docWith('roher Text')),
    ]
    expect(findDocumentBacklinks(candidates, TARGET)).toEqual([])
  })

  it('ignores links that point at a different document', () => {
    const candidates = [published(OTHER, 'Aufgabe 1', docWith(linkTo('cccccccc-cccc-4ccc-8ccc-cccccccccccc')))]
    expect(findDocumentBacklinks(candidates, TARGET)).toEqual([])
  })

  it('does not mistake a Kurs or Einheit that shares the id for the document', () => {
    const kursLink: InlineNode = { type: 'link', target: { kursId: TARGET }, label: 'Kurs' }
    const unitLink: InlineNode = { type: 'link', target: { unitId: TARGET }, label: 'Einheit' }
    const candidates = [published(OTHER, 'Aufgabe 1', docWith(kursLink, unitLink))]
    expect(findDocumentBacklinks(candidates, TARGET)).toEqual([])
  })
})

// ── The warnable case ───────────────────────────────────────────────────────

describe('findDocumentBacklinks — what points here', () => {
  it('names the published document that links to the target', () => {
    const candidates = [published(OTHER, 'Aufgabe 2', docWith(linkTo(TARGET)))]
    expect(findDocumentBacklinks(candidates, TARGET)).toEqual([
      { kind: 'published', id: OTHER, title: 'Aufgabe 2', count: 1 },
    ])
  })

  it('sees links sitting in an unpublished draft — the cheapest break to catch', () => {
    const candidates = [draft('draft-1', 'Zinsrechnung', docWith(linkTo(TARGET)))]
    expect(findDocumentBacklinks(candidates, TARGET)).toEqual([
      { kind: 'draft', id: 'draft-1', title: 'Zinsrechnung', count: 1 },
    ])
  })

  it('finds an anchor-qualified link, not only a whole-document one', () => {
    const candidates = [published(OTHER, 'Aufgabe 2', docWith(linkTo(TARGET, ANCHOR)))]
    expect(findDocumentBacklinks(candidates, TARGET)).toEqual([
      { kind: 'published', id: OTHER, title: 'Aufgabe 2', count: 1 },
    ])
  })

  it('counts every chip in a source, anchored and whole-document alike', () => {
    const content = docWith(linkTo(TARGET), { text: ' und ' }, linkTo(TARGET, ANCHOR))
    expect(findDocumentBacklinks([published(OTHER, 'Aufgabe 2', content)], TARGET)).toEqual([
      { kind: 'published', id: OTHER, title: 'Aufgabe 2', count: 2 },
    ])
  })

  it('reports each source once, in the order it was handed', () => {
    const candidates = [
      published(OTHER, 'Aufgabe 2', docWith(linkTo(TARGET), linkTo(TARGET))),
      draft('draft-1', 'Zinsrechnung', docWith(linkTo(TARGET))),
    ]
    expect(findDocumentBacklinks(candidates, TARGET)).toEqual([
      { kind: 'published', id: OTHER, title: 'Aufgabe 2', count: 2 },
      { kind: 'draft', id: 'draft-1', title: 'Zinsrechnung', count: 1 },
    ])
  })
})

// ── Everywhere an inline node can hide ──────────────────────────────────────

describe('findDocumentBacklinks — where a link can hide', () => {
  function expectFound(content: LatestEditorDocumentJson) {
    expect(findDocumentBacklinks([published(OTHER, 'Aufgabe 2', content)], TARGET)).toEqual([
      { kind: 'published', id: OTHER, title: 'Aufgabe 2', count: 1 },
    ])
  }

  it('finds a link nested inside a styled group', () => {
    expectFound(docWith({ children: [{ children: [linkTo(TARGET)] }], style: { bold: true } }))
  })

  it('finds a link in a heading', () => {
    expectFound({
      version: '1.1',
      variables: [],
      content: [{ type: 'heading', level: 2, children: [linkTo(TARGET)] }],
      library: [],
    })
  })

  it('finds a link in a list item written as an inline array', () => {
    expectFound({
      version: '1.1',
      variables: [],
      content: [{ type: 'list', ordered: false, items: [[{ text: 'a' }, linkTo(TARGET)]] }],
      library: [],
    })
  })

  it('finds a link in a list item written as an object', () => {
    expectFound({
      version: '1.1',
      variables: [],
      content: [{ type: 'list', items: [{ children: [linkTo(TARGET)] }] }],
      library: [],
    })
  })

  it('finds a link in a formula caption', () => {
    expectFound({
      version: '1.1',
      variables: [],
      content: [{ type: 'formula', latex: 'x^2', caption: { children: [linkTo(TARGET)] } }],
      library: [],
    })
  })

  it('walks past blocks that hold no inline nodes at all', () => {
    expectFound({
      version: '1.1',
      variables: [],
      content: [
        { type: 'code', text: 'const x = 1' },
        { type: 'image', imageId: '99999999-9999-4999-8999-999999999999' },
        { type: 'formula', latex: 'x^2', caption: 'Nur ein String' },
        { type: 'paragraph', children: [linkTo(TARGET)] },
      ],
      library: [],
    })
  })
})

// ── The document being deleted is not its own backlink ──────────────────────

describe('findDocumentBacklinks — the target itself', () => {
  it('ignores a published document that links to itself — it goes away too', () => {
    const candidates = [published(TARGET, 'Aufgabe 1', docWith(linkTo(TARGET)))]
    expect(findDocumentBacklinks(candidates, TARGET)).toEqual([])
  })

  it('still reports a draft that links to the document being deleted', () => {
    // The draft survives the delete, so its link genuinely breaks — even the
    // draft whose own publish produced the document.
    const candidates = [draft(TARGET, 'Gleicher Id-Wert', docWith(linkTo(TARGET)))]
    expect(findDocumentBacklinks(candidates, TARGET)).toEqual([
      { kind: 'draft', id: TARGET, title: 'Gleicher Id-Wert', count: 1 },
    ])
  })
})

// ── The warnings ────────────────────────────────────────────────────────────

const ONE_PUBLISHED: Backlink[] = [{ kind: 'published', id: OTHER, title: 'Aufgabe 2', count: 1 }]
const MIXED: Backlink[] = [
  { kind: 'published', id: OTHER, title: 'Aufgabe 2', count: 2 },
  { kind: 'draft', id: 'draft-1', title: 'Zinsrechnung', count: 1 },
]

/** A clean scan — everything readable, only the links vary. */
function scan(links: Backlink[], unreadable = 0): BacklinkScan {
  return { links, unreadable }
}

describe('backlinkDeleteWarning', () => {
  it('says nothing when nothing links here — an unlinked delete keeps its old friction', () => {
    expect(backlinkDeleteWarning(scan([]))).toBeNull()
  })

  it('is singular for a single reference', () => {
    const text = backlinkDeleteWarning(scan(ONE_PUBLISHED))
    expect(text).toContain('1 Verweis zeigt')
    expect(text).toContain('„Aufgabe 2" (veröffentlicht)')
  })

  it('totals the references across sources and names each one', () => {
    const text = backlinkDeleteWarning(scan(MIXED))
    expect(text).toContain('3 Verweise zeigen')
    expect(text).toContain('„Aufgabe 2" (veröffentlicht, 2 Verweise)')
    expect(text).toContain('„Zinsrechnung" (Entwurf)')
  })
})

describe('backlinkRepublishWarning', () => {
  it('says nothing when nothing links to the document being left behind', () => {
    expect(backlinkRepublishWarning(scan([]))).toBeNull()
  })

  it('warns that the references keep pointing at the old document, not the new one', () => {
    const text = backlinkRepublishWarning(scan(MIXED))
    expect(text).toContain('3 Verweise')
    expect(text).toContain('bisherige Dokument')
    expect(text).toContain('„Zinsrechnung" (Entwurf)')
  })

  it('is singular for a single reference', () => {
    expect(backlinkRepublishWarning(scan(ONE_PUBLISHED))).toContain('1 Verweis ')
  })
})

// ── What the scan could not see is never silence ────────────────────────────

describe('the unreadable caveat', () => {
  it('warns on its own when nothing was found but something could not be read', () => {
    const text = backlinkDeleteWarning(scan([], 2))
    expect(text).toContain('2 Dokumente konnten nicht gelesen')
    // No found-references sentence — there were none.
    expect(text).not.toContain('Verweise zeigen auf dieses Dokument')
  })

  it('is singular for a single unreadable document', () => {
    expect(backlinkDeleteWarning(scan([], 1))).toContain('1 Dokument konnte nicht gelesen')
  })

  it('rides along with found references rather than replacing them', () => {
    const text = backlinkDeleteWarning(scan(ONE_PUBLISHED, 1))
    expect(text).toContain('1 Verweis zeigt')
    expect(text).toContain('1 Dokument konnte nicht gelesen')
  })

  it('reaches the republish warning too', () => {
    expect(backlinkRepublishWarning(scan([], 1))).toContain('nicht gelesen')
  })
})

// ── A scan that never ran ───────────────────────────────────────────────────

describe('backlinkScanFailedWarning', () => {
  it('never falls silent — a caller reads silence as „go ahead"', () => {
    expect(backlinkScanFailedWarning('dieses Dokument')).toContain('fehlgeschlagen')
  })

  it('names the document in the caller-s own terms', () => {
    expect(backlinkScanFailedWarning('dieses Dokument')).toContain('auf dieses Dokument verweist')
    expect(backlinkScanFailedWarning('das bisherige Dokument')).toContain(
      'auf das bisherige Dokument verweist'
    )
  })

  it('carries the reason when there is one, and reads cleanly without', () => {
    expect(backlinkScanFailedWarning('dieses Dokument', 'Zeitüberschreitung')).toContain(
      '(Zeitüberschreitung)'
    )
    expect(backlinkScanFailedWarning('dieses Dokument')).not.toContain('(')
  })
})
