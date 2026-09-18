// @vitest-environment jsdom
/**
 * anchors tests (#71).
 *
 * The load-bearing property is the one the ticket calls the real work: no two
 * blocks may ever answer to one link. Everything here is a variation on "the
 * DOM just produced a second block carrying an id" — paste, drag-copy, a
 * contenteditable Enter that cloned the block's attributes — and the question
 * is always which element keeps the id and which gets a fresh one.
 *
 * Runs in jsdom: the module's whole job is reading and writing block datasets.
 */

import { describe, expect, it } from 'vitest'
import {
  anchoredBlocks,
  clearBlockAnchor,
  createAnchorRegistry,
  readBlockAnchor,
  writeBlockAnchor,
} from './anchors'

/** Deterministic id generator — `anc_1`, `anc_2`, … */
function makeIds(): () => string {
  let n = 0
  return () => `anc_${++n}`
}

function makeEditor(html = ''): HTMLElement {
  const editor = document.createElement('div')
  editor.id = 'editor'
  editor.innerHTML = html
  document.body.appendChild(editor)
  return editor
}

/** `[id, label]` of every anchored block, in document order. */
function marks(editor: HTMLElement): [string, string][] {
  return anchoredBlocks(editor).map((el) => [
    el.dataset['anchorId'] ?? '',
    el.dataset['anchorLabel'] ?? '',
  ])
}

// ── The DOM contract ────────────────────────────────────────────────────────

describe('block anchor dataset', () => {
  it('round-trips an anchor through the block dataset', () => {
    const el = document.createElement('p')
    writeBlockAnchor(el, { id: 'anc_x', label: 'Kapitel 1' })
    expect(el.dataset['anchorId']).toBe('anc_x')
    expect(el.dataset['anchorLabel']).toBe('Kapitel 1')
    expect(readBlockAnchor(el)).toEqual({ id: 'anc_x', label: 'Kapitel 1' })
  })

  it('reads an unmarked block as null', () => {
    expect(readBlockAnchor(document.createElement('p'))).toBeNull()
  })

  it('treats a blank id as no anchor at all — a marker with no id is unlinkable', () => {
    const el = document.createElement('p')
    el.dataset['anchorId'] = '   '
    el.dataset['anchorLabel'] = 'Kapitel 1'
    expect(readBlockAnchor(el)).toBeNull()
  })

  it('defaults a missing label to the empty string rather than dropping the anchor', () => {
    const el = document.createElement('p')
    el.dataset['anchorId'] = 'anc_x'
    expect(readBlockAnchor(el)).toEqual({ id: 'anc_x', label: '' })
  })

  it('clearing removes both attributes, so the block serializes as unmarked', () => {
    const el = document.createElement('p')
    writeBlockAnchor(el, { id: 'anc_x', label: 'Kapitel 1' })
    clearBlockAnchor(el)
    expect(el.hasAttribute('data-anchor-id')).toBe(false)
    expect(el.hasAttribute('data-anchor-label')).toBe(false)
    expect(readBlockAnchor(el)).toBeNull()
  })

  it('lists anchored blocks in document order and ignores unmarked ones', () => {
    const editor = makeEditor(
      '<p data-anchor-id="a" data-anchor-label="A">1</p>' +
        '<p>2</p>' +
        '<h1 data-anchor-id="b" data-anchor-label="B">3</h1>'
    )
    expect(anchoredBlocks(editor).map((el) => el.dataset['anchorId'])).toEqual(['a', 'b'])
    editor.remove()
  })
})

// ── The duplicate hazard ────────────────────────────────────────────────────

describe('createAnchorRegistry — re-stamping duplicates', () => {
  it('leaves a document with no duplicates completely alone', () => {
    const editor = makeEditor(
      '<p data-anchor-id="a" data-anchor-label="A">1</p>' +
        '<p data-anchor-id="b" data-anchor-label="B">2</p>'
    )
    const registry = createAnchorRegistry(editor, makeIds())
    expect(registry.sweep()).toBe(0)
    expect(marks(editor)).toEqual([
      ['a', 'A'],
      ['b', 'B'],
    ])
    editor.remove()
  })

  it('copy → paste: the original keeps its id, the copy gets a fresh one', () => {
    const editor = makeEditor('<p data-anchor-id="a" data-anchor-label="Kapitel 1">1</p>')
    const registry = createAnchorRegistry(editor, makeIds())
    registry.sweep() // adopt the original as the owner of "a"

    const copy = editor.children[0]!.cloneNode(true) as HTMLElement
    editor.appendChild(copy)

    expect(registry.sweep()).toBe(1)
    expect(marks(editor)).toEqual([
      ['a', 'Kapitel 1'],
      ['anc_1', 'Kapitel 1'],
    ])
    editor.remove()
  })

  it('the copy keeps the label — only the id has to be unique', () => {
    const editor = makeEditor('<p data-anchor-id="a" data-anchor-label="Kapitel 1">1</p>')
    const registry = createAnchorRegistry(editor, makeIds())
    registry.sweep()
    editor.appendChild(editor.children[0]!.cloneNode(true))
    registry.sweep()
    expect(readBlockAnchor(editor.children[1] as HTMLElement)).toEqual({
      id: 'anc_1',
      label: 'Kapitel 1',
    })
    editor.remove()
  })

  it('pasting ABOVE the original still re-stamps the copy, not the original', () => {
    // Document order alone would hand the id to whichever block came first —
    // which is why the registry remembers who held it before the paste.
    const editor = makeEditor('<p data-anchor-id="a" data-anchor-label="A">original</p>')
    const registry = createAnchorRegistry(editor, makeIds())
    registry.sweep()

    const original = editor.children[0]!
    const copy = original.cloneNode(true) as HTMLElement
    copy.textContent = 'kopie'
    editor.insertBefore(copy, original)

    expect(registry.sweep()).toBe(1)
    expect(copy.dataset['anchorId']).toBe('anc_1')
    expect((original as HTMLElement).dataset['anchorId']).toBe('a')
    editor.remove()
  })

  it('cut → paste keeps the id: a moved block is not a duplicated one', () => {
    const editor = makeEditor(
      '<p data-anchor-id="a" data-anchor-label="A">1</p><p>2</p>'
    )
    const registry = createAnchorRegistry(editor, makeIds())
    registry.sweep()

    const moved = editor.children[0]!
    moved.remove()
    editor.appendChild(moved)

    expect(registry.sweep()).toBe(0)
    expect(marks(editor)).toEqual([['a', 'A']])
    editor.remove()
  })

  it('duplicates that arrive together (neither known) resolve by document order', () => {
    const editor = makeEditor(
      '<p data-anchor-id="a" data-anchor-label="A">erste</p>' +
        '<p data-anchor-id="a" data-anchor-label="A">zweite</p>'
    )
    const registry = createAnchorRegistry(editor, makeIds())
    expect(registry.sweep()).toBe(1)
    expect(marks(editor)).toEqual([
      ['a', 'A'],
      ['anc_1', 'A'],
    ])
    editor.remove()
  })

  it('re-stamps every extra copy when a block is pasted more than once', () => {
    const editor = makeEditor('<p data-anchor-id="a" data-anchor-label="A">1</p>')
    const registry = createAnchorRegistry(editor, makeIds())
    registry.sweep()
    editor.appendChild(editor.children[0]!.cloneNode(true))
    editor.appendChild(editor.children[0]!.cloneNode(true))

    expect(registry.sweep()).toBe(2)
    const ids = anchoredBlocks(editor).map((el) => el.dataset['anchorId'])
    expect(new Set(ids).size).toBe(3)
    expect(ids[0]).toBe('a')
    editor.remove()
  })

  it('never mints an id that some other block already holds', () => {
    // The generator is deliberately hostile: its first output collides with a
    // live block, exactly like the importer's colliding-field-id guard.
    const editor = makeEditor(
      '<p data-anchor-id="a" data-anchor-label="A">1</p>' +
        '<p data-anchor-id="a" data-anchor-label="A">2</p>' +
        '<p data-anchor-id="anc_1" data-anchor-label="C">3</p>'
    )
    const registry = createAnchorRegistry(editor, makeIds())
    expect(registry.sweep()).toBe(1)
    const ids = anchoredBlocks(editor).map((el) => el.dataset['anchorId'])
    expect(new Set(ids).size).toBe(3)
    expect(ids).toEqual(['a', 'anc_2', 'anc_1'])
    editor.remove()
  })

  it('strips a blank id left behind by a partial clone instead of re-stamping it', () => {
    const editor = makeEditor('<p data-anchor-id="" data-anchor-label="A">1</p>')
    const registry = createAnchorRegistry(editor, makeIds())
    expect(registry.sweep()).toBe(0)
    expect(anchoredBlocks(editor)).toEqual([])
    expect(editor.children[0]!.hasAttribute('data-anchor-label')).toBe(false)
    editor.remove()
  })

  it('forgetting the owners lets a freshly loaded document keep its stored ids', () => {
    // After loadDocument the previous document's owners are meaningless; the
    // stored ids must be adopted verbatim, not re-stamped against stale state.
    const editor = makeEditor('<p data-anchor-id="a" data-anchor-label="A">alt</p>')
    const registry = createAnchorRegistry(editor, makeIds())
    registry.sweep()

    editor.innerHTML = '<h1 data-anchor-id="a" data-anchor-label="Neu">neu</h1>'
    registry.forget()

    expect(registry.sweep()).toBe(0)
    expect(marks(editor)).toEqual([['a', 'Neu']])
    editor.remove()
  })

  it('unmarks the duplicate instead of re-stamping it when asked', () => {
    // The Enter case: contenteditable clones the block's attributes when it
    // splits one, so the new half arrives carrying a Sprungmarke the author
    // never placed on it. Minting a second marke with the same name would put
    // an entry in the target picker nobody asked for.
    const editor = makeEditor('<p data-anchor-id="a" data-anchor-label="Kapitel 1">1</p>')
    const registry = createAnchorRegistry(editor, makeIds())
    registry.sweep()
    editor.appendChild(editor.children[0]!.cloneNode(true))

    expect(registry.sweep('unmark')).toBe(1)
    expect(marks(editor)).toEqual([['a', 'Kapitel 1']])
    expect(editor.children[1]!.hasAttribute('data-anchor-label')).toBe(false)
    editor.remove()
  })

  it('re-stamps by default — unmarking is opt-in', () => {
    const editor = makeEditor('<p data-anchor-id="a" data-anchor-label="A">1</p>')
    const registry = createAnchorRegistry(editor, makeIds())
    registry.sweep()
    editor.appendChild(editor.children[0]!.cloneNode(true))
    registry.sweep()
    expect(anchoredBlocks(editor).length).toBe(2)
    editor.remove()
  })

  it('unmarking still leaves the pre-edit owner holding the id', () => {
    const editor = makeEditor('<p data-anchor-id="a" data-anchor-label="A">original</p>')
    const registry = createAnchorRegistry(editor, makeIds())
    registry.sweep()
    const original = editor.children[0] as HTMLElement
    editor.insertBefore(original.cloneNode(true), original)

    expect(registry.sweep('unmark')).toBe(1)
    expect(original.dataset['anchorId']).toBe('a')
    expect((editor.children[0] as HTMLElement).hasAttribute('data-anchor-id')).toBe(false)
    editor.remove()
  })

  it('only looks at blocks inside its own editor', () => {
    const editor = makeEditor('<p data-anchor-id="a" data-anchor-label="A">1</p>')
    const other = makeEditor('<p data-anchor-id="a" data-anchor-label="A">fremd</p>')
    const registry = createAnchorRegistry(editor, makeIds())
    expect(registry.sweep()).toBe(0)
    expect(other.children[0]!.getAttribute('data-anchor-id')).toBe('a')
    editor.remove()
    other.remove()
  })
})
