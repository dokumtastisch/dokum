// @vitest-environment jsdom
/**
 * links tests (#72).
 *
 * Two properties carry the ticket. First, what a link STORES: a published
 * primary key and nothing else, with the key name carrying the kind — so a
 * malformed or draft-shaped target cannot be built. Second, that a chip is one
 * atom: whatever goes into the dataset comes back out unchanged, including the
 * case where re-targeting has to CLEAR a Sprungmarke the chip used to carry.
 *
 * Runs in jsdom: half the module's job is reading and writing chip datasets.
 */

import { describe, expect, it } from 'vitest'
import {
  LINK_CHIP_CLASS,
  LinkNodeSchema,
  LinkTargetSchema,
  createLinkChip,
  linkTargetAnchorId,
  linkTargetIcon,
  linkTargetId,
  linkTargetKind,
  linkTargetKindLabel,
  readLinkChip,
  sameLinkTarget,
  writeLinkChip,
} from './links'

const KURS_ID = '11111111-1111-4111-8111-111111111111'
const UNIT_ID = '22222222-2222-4222-8222-222222222222'
const DOC_ID = '33333333-3333-4333-8333-333333333333'

// ── The wire shape ──────────────────────────────────────────────────────────

describe('LinkTargetSchema', () => {
  it('accepts the four target shapes of spec §6', () => {
    expect(LinkTargetSchema.safeParse({ kursId: KURS_ID }).success).toBe(true)
    expect(LinkTargetSchema.safeParse({ unitId: UNIT_ID }).success).toBe(true)
    expect(LinkTargetSchema.safeParse({ docId: DOC_ID }).success).toBe(true)
    expect(LinkTargetSchema.safeParse({ docId: DOC_ID, anchorId: 'anc_1' }).success).toBe(true)
  })

  it('refuses a Sprungmarke without the document that holds it', () => {
    // An anchor id is a spot INSIDE a document; on its own there is nothing to
    // fetch, and the forward path is a primary-key read of the Dokument row.
    expect(LinkTargetSchema.safeParse({ anchorId: 'anc_1' }).success).toBe(false)
    expect(LinkTargetSchema.safeParse({ kursId: KURS_ID, anchorId: 'anc_1' }).success).toBe(false)
    expect(LinkTargetSchema.safeParse({ unitId: UNIT_ID, anchorId: 'anc_1' }).success).toBe(false)
  })

  it('refuses a target that claims two kinds at once', () => {
    expect(LinkTargetSchema.safeParse({ kursId: KURS_ID, unitId: UNIT_ID }).success).toBe(false)
    expect(LinkTargetSchema.safeParse({ docId: DOC_ID, kursId: KURS_ID }).success).toBe(false)
  })

  it('refuses ids that are not primary keys and blank anchor ids', () => {
    expect(LinkTargetSchema.safeParse({ docId: 'draft-7' }).success).toBe(false)
    expect(LinkTargetSchema.safeParse({ kursId: '' }).success).toBe(false)
    expect(LinkTargetSchema.safeParse({ docId: DOC_ID, anchorId: '' }).success).toBe(false)
  })

  it('refuses unknown keys — no room for a stray draft id to ride along', () => {
    expect(LinkTargetSchema.safeParse({ docId: DOC_ID, draftId: DOC_ID }).success).toBe(false)
  })
})

describe('LinkNodeSchema', () => {
  it('accepts a labelled link node', () => {
    const node = { type: 'link', target: { docId: DOC_ID }, label: 'siehe Aufgabe 2' }
    expect(LinkNodeSchema.safeParse(node).success).toBe(true)
  })

  it('carries no style: a chip is styled by the group it sits in, like a field pill', () => {
    const styled = { type: 'link', target: { docId: DOC_ID }, label: 'x', style: { bold: true } }
    expect(LinkNodeSchema.safeParse(styled).success).toBe(false)
  })

  it('requires both a target and a label key', () => {
    expect(LinkNodeSchema.safeParse({ type: 'link', target: { docId: DOC_ID } }).success).toBe(false)
    expect(LinkNodeSchema.safeParse({ type: 'link', label: 'x' }).success).toBe(false)
  })
})

// ── Target accessors ────────────────────────────────────────────────────────

describe('target accessors', () => {
  it('reads kind, id and Sprungmarke off every shape', () => {
    expect(linkTargetKind({ kursId: KURS_ID })).toBe('kurs')
    expect(linkTargetKind({ unitId: UNIT_ID })).toBe('unit')
    expect(linkTargetKind({ docId: DOC_ID })).toBe('document')
    expect(linkTargetKind({ docId: DOC_ID, anchorId: 'anc_1' })).toBe('document')

    expect(linkTargetId({ unitId: UNIT_ID })).toBe(UNIT_ID)
    expect(linkTargetAnchorId({ docId: DOC_ID })).toBeNull()
    expect(linkTargetAnchorId({ docId: DOC_ID, anchorId: 'anc_1' })).toBe('anc_1')
    expect(linkTargetAnchorId({ kursId: KURS_ID })).toBeNull()
  })

  it('tells a document apart from a Sprungmarke inside it', () => {
    expect(sameLinkTarget({ docId: DOC_ID }, { docId: DOC_ID })).toBe(true)
    expect(sameLinkTarget({ docId: DOC_ID }, { docId: DOC_ID, anchorId: 'anc_1' })).toBe(false)
    expect(
      sameLinkTarget({ docId: DOC_ID, anchorId: 'anc_1' }, { docId: DOC_ID, anchorId: 'anc_2' })
    ).toBe(false)
  })

  it('an id shared across kinds is still a different target', () => {
    expect(sameLinkTarget({ kursId: KURS_ID }, { unitId: KURS_ID })).toBe(false)
  })
})

// ── The DOM contract ────────────────────────────────────────────────────────

describe('link chip dataset', () => {
  it('round-trips every target shape through the chip', () => {
    for (const target of [
      { kursId: KURS_ID },
      { unitId: UNIT_ID },
      { docId: DOC_ID },
      { docId: DOC_ID, anchorId: 'anc_1' },
    ] as const) {
      const chip = createLinkChip(document, { target, label: 'Label' })
      expect(readLinkChip(chip)).toEqual({ target, label: 'Label' })
    }
  })

  it('builds an atom the caret cannot enter', () => {
    const chip = createLinkChip(document, { target: { kursId: KURS_ID }, label: 'Kurs' })
    expect(chip.tagName).toBe('SPAN')
    expect(chip.classList.contains(LINK_CHIP_CLASS)).toBe(true)
    expect(chip.getAttribute('contenteditable')).toBe('false')
  })

  it('keeps the kind icon out of the label — it is CSS chrome, not content', () => {
    const chip = createLinkChip(document, { target: { docId: DOC_ID }, label: 'Aufgabe 2' })
    expect(chip.textContent).toBe('Aufgabe 2')
    expect(chip.dataset['linkKind']).toBe('document')
  })

  it('re-targeting to a plain document clears the Sprungmarke the chip carried', () => {
    // The bug this prevents: a chip re-pointed away from a Sprungmarke keeps
    // data-link-anchor-id and silently jumps to a spot the author unchose.
    const chip = createLinkChip(document, {
      target: { docId: DOC_ID, anchorId: 'anc_1' },
      label: 'Marke',
    })
    writeLinkChip(chip, { target: { docId: DOC_ID }, label: 'Dokument' })
    expect(chip.dataset['linkAnchorId']).toBeUndefined()
    expect(readLinkChip(chip)).toEqual({ target: { docId: DOC_ID }, label: 'Dokument' })
  })

  it('re-targeting across kinds replaces the id rather than adding one', () => {
    const chip = createLinkChip(document, { target: { docId: DOC_ID }, label: 'Dokument' })
    writeLinkChip(chip, { target: { kursId: KURS_ID }, label: 'Kurs' })
    expect(readLinkChip(chip)).toEqual({ target: { kursId: KURS_ID }, label: 'Kurs' })
  })

  it('reads a chip with a blank or missing id as no link at all', () => {
    const blank = document.createElement('span')
    blank.className = LINK_CHIP_CLASS
    blank.dataset['linkKind'] = 'document'
    blank.dataset['linkId'] = '  '
    blank.textContent = 'kaputt'
    expect(readLinkChip(blank)).toBeNull()

    const noKind = document.createElement('span')
    noKind.className = LINK_CHIP_CLASS
    noKind.dataset['linkId'] = DOC_ID
    expect(readLinkChip(noKind)).toBeNull()
  })

  it('reads an unknown kind as no link rather than guessing one', () => {
    const el = document.createElement('span')
    el.className = LINK_CHIP_CLASS
    el.dataset['linkKind'] = 'task'
    el.dataset['linkId'] = DOC_ID
    expect(readLinkChip(el)).toBeNull()
  })

})

// ── What a chip says about its target (#73) ─────────────────────────────────

describe('how far a link travels', () => {
  it('gives each kind its own glyph, and a Sprungmarke its own', () => {
    const glyphs = [
      linkTargetIcon({ kursId: KURS_ID }),
      linkTargetIcon({ unitId: UNIT_ID }),
      linkTargetIcon({ docId: DOC_ID }),
      linkTargetIcon({ docId: DOC_ID, anchorId: 'anc_1' }),
    ]
    expect(new Set(glyphs).size).toBe(4)
    expect(glyphs.every((g) => g.length > 0)).toBe(true)
  })

  it('names the target in German for the readers who get no glyph', () => {
    // The glyph is CSS chrome so it never reaches a screen reader; this is what
    // does, and it has to draw the same four distinctions.
    expect(linkTargetKindLabel({ kursId: KURS_ID })).toBe('Kurs')
    expect(linkTargetKindLabel({ unitId: UNIT_ID })).toBe('Einheit')
    expect(linkTargetKindLabel({ docId: DOC_ID })).toBe('Dokument')
    expect(linkTargetKindLabel({ docId: DOC_ID, anchorId: 'anc_1' })).toBe('Sprungmarke')
  })
})
