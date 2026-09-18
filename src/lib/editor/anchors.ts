/**
 * anchors — Sprungmarken: the block-level anchor and its uniqueness guard
 * (#71, spec #63 §2).
 *
 * An anchor is an author-placed target another document can link to: an
 * **opaque id** plus the author's **label**. The split matters. The id is what
 * a link stores, so it must never change once minted — renaming a Sprungmarke
 * must not break the links pointing at it. The label is what a picker and a
 * link chip show, so it must be free text the author can rewrite at will.
 *
 * Stability is by construction rather than by convention: the id is minted
 * once, kept in the block's dataset, round-tripped through the document JSON
 * and copied verbatim at publish. Nothing in the snapshot pipeline derives it
 * from position, heading text or content, so nothing in the snapshot pipeline
 * can disturb it.
 *
 * **The duplicate hazard is the whole reason this module exists.** The editor
 * is a contenteditable with drag-reorder, copy/paste and a browser that clones
 * block attributes on Enter — so a marked block's id gets duplicated by
 * ordinary editing, and two blocks answering to one link is a silently wrong
 * document. {@link createAnchorRegistry} is the guard: it re-stamps every
 * extra holder of an id, the same class of fix the JSON importer already
 * applies to colliding field ids.
 *
 * Which holder keeps the id is the subtle part, and it is why the registry is
 * stateful rather than a pure sweep over the DOM:
 *
 *   - **copy → paste** leaves two holders. The one that held the id BEFORE the
 *     edit keeps it, wherever the copy landed — including above the original,
 *     where document order alone would hand the id to the wrong block.
 *   - **cut → paste** leaves one holder in a new position. That is a move, not
 *     a duplication, so the id survives untouched.
 *   - **pasted-in content that collides with nothing local** keeps its ids;
 *     only actual collisions are re-stamped.
 *   - **Enter inside a marked block** also leaves two holders, but the author
 *     never asked for a second Sprungmarke — see {@link DuplicateAnchorPolicy}.
 *
 * Pure DOM module: no controller state, no MathJax, no server imports, and the
 * id generator is injected — so it is deterministic under test and runs in the
 * browser and in jsdom alike.
 */

import { z } from 'zod'

/**
 * An author-placed jump target: the opaque id another document's link stores,
 * plus the author-written label a target picker and a link chip show.
 *
 * The schema lives here rather than in document-json.ts so the anchor's wire
 * shape, its type and its DOM contract stay one concept in one module;
 * document-json.ts composes it into the v1.1 block union.
 */
export const AnchorSchema = z.strictObject({
  /** Opaque, minted once, never derived — what a link stores. */
  id: z.string().min(1, 'Sprungmarke benötigt eine "id".'),
  /** Author-written display name — what a picker and a link chip show. */
  label: z.string(),
})

export type DocumentAnchor = z.infer<typeof AnchorSchema>

/**
 * The anchor a block carries, or `null` when it carries none.
 *
 * A blank id reads as no anchor: a marker nothing can link to is not a
 * Sprungmarke, and admitting it would let an unlinkable block into the
 * document JSON.
 */
export function readBlockAnchor(el: HTMLElement): DocumentAnchor | null {
  const id = (el.dataset['anchorId'] ?? '').trim()
  if (!id) return null
  return { id, label: el.dataset['anchorLabel'] ?? '' }
}

/** Stamps an anchor onto a block. Both halves always travel together. */
export function writeBlockAnchor(el: HTMLElement, anchor: DocumentAnchor): void {
  el.dataset['anchorId'] = anchor.id
  el.dataset['anchorLabel'] = anchor.label
}

/** Unmarks a block — both attributes go, so it serializes as plain again. */
export function clearBlockAnchor(el: HTMLElement): void {
  delete el.dataset['anchorId']
  delete el.dataset['anchorLabel']
}

/** Every anchored block inside `root`, in document order. */
export function anchoredBlocks(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-anchor-id]'))
}

/**
 * What to do with a block found holding an id another block already owns.
 *
 * `'restamp'` mints it a fresh id, keeping it a Sprungmarke — what the author
 * means by copying a marked block. `'unmark'` strips the mark instead, for the
 * one duplication the author did not ask for: a contenteditable Enter clones
 * the block's attributes when it splits one, and a second Sprungmarke under
 * the same name is noise in every target picker that lists it.
 *
 * Either way no two blocks are left sharing an id — that part is not a policy.
 */
export type DuplicateAnchorPolicy = 'restamp' | 'unmark'

export interface AnchorRegistry {
  /**
   * Resolves every duplicated anchor id, and drops blank markers. Returns how
   * many blocks were changed — 0 on the overwhelmingly common no-op path.
   *
   * Call it after anything that can clone a block: paste, block drop, and
   * ordinary typing.
   */
  sweep(policy?: DuplicateAnchorPolicy): number
  /**
   * Forgets who owned what. Call after replacing the whole document (draft
   * load, JSON import, reset): the previous document's owners say nothing
   * about the new one, and the stored ids must be adopted as they are.
   */
  forget(): void
}

/**
 * The uniqueness guard for one editor surface. See the module header for why
 * ownership is remembered rather than recomputed from document order.
 *
 * `nextAnchorId` is the controller's opaque-id generator; a minted id that
 * happens to collide with a live block is discarded and re-minted, mirroring
 * the importer's colliding-field-id loop.
 */
export function createAnchorRegistry(
  root: HTMLElement,
  nextAnchorId: () => string
): AnchorRegistry {
  /** Anchor id → the block that legitimately holds it, as of the last sweep. */
  let owners = new Map<string, HTMLElement>()

  function sweep(policy: DuplicateAnchorPolicy = 'restamp'): number {
    const holders = new Map<string, HTMLElement[]>()
    for (const el of anchoredBlocks(root)) {
      const anchor = readBlockAnchor(el)
      if (!anchor) {
        // Blank marker (a partial clone, a hand-edited attribute) — not a
        // Sprungmarke, and re-stamping it would invent one the author never
        // placed.
        clearBlockAnchor(el)
        continue
      }
      const existing = holders.get(anchor.id)
      if (existing) existing.push(el)
      else holders.set(anchor.id, [el])
    }

    let changed = 0
    const nextOwners = new Map<string, HTMLElement>()
    for (const [id, els] of holders) {
      // The pre-edit owner keeps the id if it is still on the page; otherwise
      // the first block in document order does.
      const keeper = els.find((el) => owners.get(id) === el) ?? els[0]!
      nextOwners.set(id, keeper)
      for (const el of els) {
        if (el === keeper) continue
        if (policy === 'unmark') {
          clearBlockAnchor(el)
        } else {
          let fresh = nextAnchorId()
          while (holders.has(fresh) || nextOwners.has(fresh)) fresh = nextAnchorId()
          el.dataset['anchorId'] = fresh
          nextOwners.set(fresh, el)
        }
        changed++
      }
    }

    owners = nextOwners
    return changed
  }

  return {
    sweep,
    forget() {
      owners = new Map()
    },
  }
}
