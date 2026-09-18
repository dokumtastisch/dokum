/**
 * publish-plan tests (#66).
 *
 * Behavioural: given a draft snapshot and the images that exist on both
 * sides, what does publishing have to do? The plan is deliberately pure so
 * the ORDERING GUARANTEE — build everything new first, swap in one statement,
 * clean up the old last — can be verified without touching storage.
 *
 * Runs in plain Node: no DOM, no Supabase.
 */

import { describe, expect, it } from 'vitest'
import type { LatestEditorDocumentJson } from './document-json'
import { planPublish, type DraftImageRef, type StoredImageRef } from './publish-plan'

const DRAFT_IMG_A = '11111111-1111-4111-8111-111111111111'
const DRAFT_IMG_B = '22222222-2222-4222-8222-222222222222'
const OLD_DOC_IMG = '33333333-3333-4333-8333-333333333333'

/** Deterministic id/path minting — the action injects the real generators. */
function fixtures() {
  let n = 0
  return {
    mintImageId: () => `new-id-${++n}`,
    mintImagePath: ({ index }: { index: number }) => `documents/u1/copy-${index}.png`,
  }
}

function docWithImages(...imageIds: string[]): LatestEditorDocumentJson {
  return {
    version: '1.1',
    variables: [],
    content: [
      { type: 'paragraph', children: [{ text: 'Vor dem Bild' }] },
      ...imageIds.map((imageId) => ({ type: 'image' as const, imageId })),
    ],
    library: [],
  }
}

function planFor(input: {
  content: LatestEditorDocumentJson
  draftImages?: DraftImageRef[]
  previousImages?: StoredImageRef[]
}) {
  return planPublish({
    content: input.content,
    draftImages: input.draftImages ?? [],
    previousImages: input.previousImages ?? [],
    ...fixtures(),
  })
}

// ── Documents without images ────────────────────────────────────────────────

describe('planPublish — no images', () => {
  it('plans nothing to copy and returns the content untouched', () => {
    const content = docWithImages()
    const result = planFor({ content })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.copies).toEqual([])
    expect(result.plan.inserts).toEqual([])
    expect(result.plan.content).toEqual(content)
  })

  it('still schedules the previous publish’s images for deletion', () => {
    const result = planFor({
      content: docWithImages(),
      previousImages: [{ id: OLD_DOC_IMG, file_path: 'documents/u1/old.png' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.stale.imageIds).toEqual([OLD_DOC_IMG])
    expect(result.plan.stale.paths).toEqual(['documents/u1/old.png'])
  })
})

// ── Copy fresh, then swap ───────────────────────────────────────────────────

describe('planPublish — image re-homing', () => {
  it('copies every referenced draft image to a fresh document-image path', () => {
    const result = planFor({
      content: docWithImages(DRAFT_IMG_A, DRAFT_IMG_B),
      draftImages: [
        { id: DRAFT_IMG_A, file_path: 'editor-images/d1/a.png' },
        { id: DRAFT_IMG_B, file_path: 'editor-images/d1/b.png' },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.copies).toEqual([
      {
        draftImageId: DRAFT_IMG_A,
        documentImageId: 'new-id-1',
        fromPath: 'editor-images/d1/a.png',
        toPath: 'documents/u1/copy-0.png',
        position: 0,
      },
      {
        draftImageId: DRAFT_IMG_B,
        documentImageId: 'new-id-2',
        fromPath: 'editor-images/d1/b.png',
        toPath: 'documents/u1/copy-1.png',
        position: 1,
      },
    ])
  })

  it('never reuses a draft storage path — the copy is what the document owns', () => {
    const result = planFor({
      content: docWithImages(DRAFT_IMG_A),
      draftImages: [{ id: DRAFT_IMG_A, file_path: 'editor-images/d1/a.png' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    for (const copy of result.plan.copies) expect(copy.toPath).not.toBe(copy.fromPath)
  })

  it('rewrites the stored JSON to the copies, not the draft images', () => {
    const result = planFor({
      content: docWithImages(DRAFT_IMG_A, DRAFT_IMG_B),
      draftImages: [
        { id: DRAFT_IMG_A, file_path: 'editor-images/d1/a.png' },
        { id: DRAFT_IMG_B, file_path: 'editor-images/d1/b.png' },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const ids = result.plan.content.content
      .filter((b) => b.type === 'image')
      .map((b) => (b.type === 'image' ? b.imageId : ''))
    expect(ids).toEqual(['new-id-1', 'new-id-2'])
    expect(JSON.stringify(result.plan.content)).not.toContain(DRAFT_IMG_A)
    expect(JSON.stringify(result.plan.content)).not.toContain(DRAFT_IMG_B)
  })

  it('plans one insert per copy, in content order', () => {
    const result = planFor({
      content: docWithImages(DRAFT_IMG_A, DRAFT_IMG_B),
      draftImages: [
        { id: DRAFT_IMG_A, file_path: 'editor-images/d1/a.png' },
        { id: DRAFT_IMG_B, file_path: 'editor-images/d1/b.png' },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.inserts).toEqual([
      { id: 'new-id-1', file_path: 'documents/u1/copy-0.png', position: 0 },
      { id: 'new-id-2', file_path: 'documents/u1/copy-1.png', position: 1 },
    ])
  })

  it('copies a repeatedly referenced image once and points every block at it', () => {
    const result = planFor({
      content: docWithImages(DRAFT_IMG_A, DRAFT_IMG_A),
      draftImages: [{ id: DRAFT_IMG_A, file_path: 'editor-images/d1/a.png' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.copies).toHaveLength(1)
    const ids = result.plan.content.content
      .filter((b) => b.type === 'image')
      .map((b) => (b.type === 'image' ? b.imageId : ''))
    expect(ids).toEqual(['new-id-1', 'new-id-1'])
  })

  it('ignores draft images the document no longer references', () => {
    const result = planFor({
      content: docWithImages(DRAFT_IMG_A),
      draftImages: [
        { id: DRAFT_IMG_A, file_path: 'editor-images/d1/a.png' },
        { id: DRAFT_IMG_B, file_path: 'editor-images/d1/unused.png' },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.copies).toHaveLength(1)
    expect(result.plan.copies[0]?.draftImageId).toBe(DRAFT_IMG_A)
  })

  it('preserves the other image-block keys and their order (byte stability)', () => {
    const content: LatestEditorDocumentJson = {
      version: '1.1',
      variables: [],
      content: [{ type: 'image', imageId: DRAFT_IMG_A, alt: 'Diagramm', style: { align: 'center' } }],
      library: [],
    }
    const result = planFor({
      content,
      draftImages: [{ id: DRAFT_IMG_A, file_path: 'editor-images/d1/a.png' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(JSON.stringify(result.plan.content.content[0])).toBe(
      JSON.stringify({ type: 'image', imageId: 'new-id-1', alt: 'Diagramm', style: { align: 'center' } })
    )
  })

  it('is pure — the draft snapshot handed in is not mutated', () => {
    const content = docWithImages(DRAFT_IMG_A)
    const before = JSON.stringify(content)
    planFor({ content, draftImages: [{ id: DRAFT_IMG_A, file_path: 'editor-images/d1/a.png' }] })
    expect(JSON.stringify(content)).toBe(before)
  })
})

// ── Cleanup is scheduled, never interleaved ─────────────────────────────────

describe('planPublish — what gets deleted', () => {
  it('marks only the PREVIOUS publish’s rows and objects as stale', () => {
    const result = planFor({
      content: docWithImages(DRAFT_IMG_A),
      draftImages: [{ id: DRAFT_IMG_A, file_path: 'editor-images/d1/a.png' }],
      previousImages: [{ id: OLD_DOC_IMG, file_path: 'documents/u1/old.png' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.stale).toEqual({
      imageIds: [OLD_DOC_IMG],
      paths: ['documents/u1/old.png'],
    })
  })

  it('never schedules a draft image or a freshly copied object for deletion', () => {
    // Copy-not-move: the draft must stay editable and re-publishable, so its
    // objects are never touched by a publish.
    const result = planFor({
      content: docWithImages(DRAFT_IMG_A),
      draftImages: [{ id: DRAFT_IMG_A, file_path: 'editor-images/d1/a.png' }],
      previousImages: [{ id: OLD_DOC_IMG, file_path: 'documents/u1/old.png' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.stale.paths).not.toContain('editor-images/d1/a.png')
    expect(result.plan.stale.imageIds).not.toContain(DRAFT_IMG_A)
    for (const copy of result.plan.copies) {
      expect(result.plan.stale.paths).not.toContain(copy.toPath)
    }
  })

  it('has nothing stale on a first publish', () => {
    const result = planFor({
      content: docWithImages(DRAFT_IMG_A),
      draftImages: [{ id: DRAFT_IMG_A, file_path: 'editor-images/d1/a.png' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.stale).toEqual({ imageIds: [], paths: [] })
  })
})

// ── Honest refusal ──────────────────────────────────────────────────────────

describe('planPublish — refusal', () => {
  it('refuses when the snapshot references an image the draft does not have', () => {
    // Publishing a document whose picture cannot be re-homed would produce a
    // student-facing document with a broken image. Fail before anything moves.
    const result = planFor({
      content: docWithImages(DRAFT_IMG_A),
      draftImages: [],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('Bild')
  })

  it('carries no plan on the failure branch', () => {
    const result = planFor({ content: docWithImages(DRAFT_IMG_A), draftImages: [] })
    expect('plan' in result).toBe(false)
  })
})

// ── Sprungmarken (v1.1, #71) ────────────────────────────────────────────────
//
// The stability contract: an anchor id is minted once in the editor and copied
// verbatim from then on. Publishing is the only step that rewrites a snapshot,
// so it is the one place where "verbatim" could quietly stop being true.

describe('planPublish — block anchors', () => {
  const anchored = (imageId: string): LatestEditorDocumentJson => ({
    version: '1.1',
    variables: [],
    content: [
      { type: 'heading', level: 1, children: [{ text: 'Kapitel' }], anchor: { id: 'anc_h', label: 'Kapitel 1' } },
      { type: 'image', imageId, anchor: { id: 'anc_i', label: 'Abbildung 1' } },
      { type: 'paragraph', children: [{ text: 'ohne Marke' }] },
    ],
    library: [],
  })

  it('copies every anchor verbatim rather than deriving or regenerating it', () => {
    const result = planFor({
      content: anchored(DRAFT_IMG_A),
      draftImages: [{ id: DRAFT_IMG_A, file_path: 'editor-images/d1/a.png' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.content.content.map((b) => b.anchor ?? null)).toEqual([
      { id: 'anc_h', label: 'Kapitel 1' },
      { id: 'anc_i', label: 'Abbildung 1' },
      null,
    ])
  })

  it('keeps the anchor on an image block whose imageId IS rewritten', () => {
    // The re-homing rewrite is the one place a block object is rebuilt — the
    // anchor has to survive it, and stay in its fixed key position.
    const result = planFor({
      content: anchored(DRAFT_IMG_A),
      draftImages: [{ id: DRAFT_IMG_A, file_path: 'editor-images/d1/a.png' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const image = result.plan.content.content[1]!
    expect(image).toEqual({ type: 'image', imageId: 'new-id-1', anchor: { id: 'anc_i', label: 'Abbildung 1' } })
    expect(Object.keys(image)).toEqual(['type', 'imageId', 'anchor'])
  })

  it('does not mutate the draft snapshot it was handed', () => {
    const content = anchored(DRAFT_IMG_A)
    const before = JSON.stringify(content)
    planFor({ content, draftImages: [{ id: DRAFT_IMG_A, file_path: 'editor-images/d1/a.png' }] })
    expect(JSON.stringify(content)).toBe(before)
  })
})
