// @vitest-environment jsdom
/**
 * document-json tests (PRD #28, slice 7 — #35).
 *
 * Golden cases are derived from the standalone reference editor's JSON
 * importer (latexEditor/…OUTPUT_AS_INPUT_LATEX_FIX.htm.html, L2306–2623) and
 * act as the port's parity contract — do not change expected values without
 * checking the reference behavior first.
 *
 * The serializer is NEW code (the reference never exported JSON); its
 * contract is byte-stability: for any serializer-produced J1,
 * JSON.stringify(J1) === JSON.stringify(serialize(import(J1))).
 *
 * Runs in jsdom (per the PRD testing decisions): the importer builds real
 * DOM, the serializer walks it, and colour canonicalisation depends on the
 * browser-faithful hex→rgb normalisation of inline styles.
 */

import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_JSON_VERSIONS,
  DocumentJsonSchema,
  JSON_IMPORT_EXAMPLE,
  LATEST_DOCUMENT_JSON_VERSION,
  collectDocumentAnchors,
  collectReferencedImageIds,
  describeDocumentJsonError,
  emptyEditorDocumentJson,
  importEditorJson,
  promoteStrayRunToBlock,
  serializeEditorState,
  serializesAsOwnBlock,
  withDocumentMeta,
  type ImportAdapters,
  type LatestEditorDocumentJson,
} from './document-json'
import { readDocumentJson } from './document-version'

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeEditor(): HTMLElement {
  const editor = document.createElement('div')
  editor.id = 'editor'
  document.body.appendChild(editor)
  return editor
}

/**
 * Deterministic id generator + identity resolver (the serializer never reads
 * resolved LaTeX) + stub image-URL builder (the serializer never reads the
 * URL back — only data-image-id).
 */
function makeAdapters(): ImportAdapters {
  let n = 0
  return {
    nextFieldId: () => `gen_${++n}`,
    resolvePlaceholders: (raw: string) => raw,
    imageUrl: (imageId: string) => `stub://editor-image/${imageId}`,
  }
}

/** Fixed editor_images row ids for the slice-8 image-block tests. */
const IMG_ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const IMG_ID_2 = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

/**
 * Parse AND upgrade — the read boundary every stored snapshot passes through.
 * The v1.0 fixtures below are therefore imported as the v1.1 documents the
 * importer actually consumes, which is also what exercises the upgrade hop on
 * every single golden case.
 */
function parse(doc: unknown): LatestEditorDocumentJson {
  const result = readDocumentJson(doc)
  if (!result.ok) throw new Error(result.error)
  return result.doc
}

/** Import J, then serialize the resulting DOM with the returned library list. */
function roundTrip(doc: LatestEditorDocumentJson): LatestEditorDocumentJson {
  const editor = makeEditor()
  const result = importEditorJson(doc, editor, makeAdapters())
  const out = serializeEditorState(editor, result.libraryLatex)
  editor.remove()
  return out
}

/** The reference file's JSON_IMPORT_EXAMPLE (L2310–2328), verbatim. */
const REFERENCE_EXAMPLE = {
  version: '1.0',
  meta: { title: 'Example JSON import' },
  variables: [
    { id: 'v_revenue', type: 'input', name: 'Revenue', value: 1200 },
    { id: 'v_margin', type: 'input', name: 'Margin', value: 0.2534 },
    { id: 'v_ebit', type: 'output', name: 'EBIT', expr: '' },
  ],
  content: [
    {
      type: 'heading',
      level: 1,
      children: [{ text: 'Imported valuation note', style: { color: '#00338D', bold: true } }],
    },
    {
      type: 'paragraph',
      children: [{ text: 'Revenue: ' }, { field: 'Revenue' }, { text: ' | Margin: ' }, { field: 'Margin' }],
    },
    {
      type: 'formula',
      latex: '\\begin{aligned}EBIT &= [input:Revenue] * [input:Margin] = [output:EBIT]\\end{aligned}',
      library: true,
    },
    {
      type: 'paragraph',
      children: [{ text: 'Result: ', style: { bold: true } }, { field: 'EBIT' }],
    },
  ],
}

// ── Schema ──────────────────────────────────────────────────────────────────

describe('DocumentJsonSchema', () => {
  it('accepts the reference JSON_IMPORT_EXAMPLE verbatim', () => {
    expect(DocumentJsonSchema.safeParse(REFERENCE_EXAMPLE).success).toBe(true)
  })

  it('rejects a wrong or missing version', () => {
    expect(DocumentJsonSchema.safeParse({ ...REFERENCE_EXAMPLE, version: '2.0' }).success).toBe(false)
    const withoutVersion: Record<string, unknown> = { ...REFERENCE_EXAMPLE }
    delete withoutVersion['version']
    expect(DocumentJsonSchema.safeParse(withoutVersion).success).toBe(false)
  })

  it('requires variables and content arrays', () => {
    expect(DocumentJsonSchema.safeParse({ version: '1.0', variables: [], content: [] }).success).toBe(true)
    expect(DocumentJsonSchema.safeParse({ version: '1.0', content: [] }).success).toBe(false)
    expect(DocumentJsonSchema.safeParse({ version: '1.0', variables: [], content: {} }).success).toBe(false)
  })

  it('rejects duplicate variable names case-insensitively with the German message', () => {
    const result = DocumentJsonSchema.safeParse({
      version: '1.0',
      variables: [
        { id: 'a', type: 'input', name: 'Revenue', value: 1 },
        { id: 'b', type: 'input', name: 'revenue', value: 2 },
      ],
      content: [],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'Doppelter Variablenname im JSON: "revenue". Variablennamen müssen eindeutig sein.'
      )
    }
  })

  it('allows several unnamed variables', () => {
    const result = DocumentJsonSchema.safeParse({
      version: '1.0',
      variables: [
        { id: 'a', type: 'input', value: 1 },
        { id: 'b', type: 'input', value: 2 },
      ],
      content: [],
    })
    expect(result.success).toBe(true)
  })

  it('rejects unknown block types', () => {
    const unknown = { version: '1.0', variables: [], content: [{ type: 'video' }] }
    expect(DocumentJsonSchema.safeParse(unknown).success).toBe(false)
  })

  it('accepts storage-reference image blocks (slice 8): imageId, optional alt and style', () => {
    const doc = {
      version: '1.0',
      variables: [],
      content: [
        { type: 'image', imageId: IMG_ID },
        { type: 'image', imageId: IMG_ID_2, alt: 'Screenshot', style: { align: 'center' } },
      ],
    }
    expect(DocumentJsonSchema.safeParse(doc).success).toBe(true)
  })

  it('makes base64 images structurally impossible: src is rejected, imageId must be a UUID', () => {
    // The reference import format carried { type:'image', src } — arbitrary
    // src (base64 data URLs) is forbidden by the PRD; strictObject rejects it.
    const withSrc = {
      version: '1.0',
      variables: [],
      content: [{ type: 'image', imageId: IMG_ID, src: 'data:image/png;base64,AAAA' }],
    }
    expect(DocumentJsonSchema.safeParse(withSrc).success).toBe(false)
    const srcOnly = { version: '1.0', variables: [], content: [{ type: 'image', src: 'data:x' }] }
    expect(DocumentJsonSchema.safeParse(srcOnly).success).toBe(false)
    const missingId = { version: '1.0', variables: [], content: [{ type: 'image' }] }
    expect(DocumentJsonSchema.safeParse(missingId).success).toBe(false)
    const badId = DocumentJsonSchema.safeParse({
      version: '1.0',
      variables: [],
      content: [{ type: 'image', imageId: 'nicht-uuid' }],
    })
    expect(badId.success).toBe(false)
    if (!badId.success) {
      expect(badId.error.issues[0]?.message).toBe('Ungültige Bildreferenz.')
    }
  })

  it('rejects unknown top-level and style keys (strict boundary)', () => {
    expect(DocumentJsonSchema.safeParse({ ...REFERENCE_EXAMPLE, extra: true }).success).toBe(false)
    const badStyle = {
      version: '1.0',
      variables: [],
      content: [{ type: 'paragraph', children: [{ text: 'x', style: { blink: true } }] }],
    }
    expect(DocumentJsonSchema.safeParse(badStyle).success).toBe(false)
  })

  it('accepts the slice-7 extensions (library list, code blocks, variable extras)', () => {
    const doc = {
      version: '1.0',
      variables: [
        { id: 'o1', type: 'output', name: 'A', expr: '', latexValue: '42' },
        { id: 'r1', type: 'input', refType: 'ref', refId: 'o1', referenceClone: true, sourceOutputName: 'A' },
      ],
      content: [{ type: 'code', text: 'x^2' }],
      library: ['a+b'],
    }
    expect(DocumentJsonSchema.safeParse(doc).success).toBe(true)
  })
})

// ── Versioned family (#64) ──────────────────────────────────────────────────

describe('DocumentJsonSchema — versioned family', () => {
  it('discriminates on version: every supported version parses its own shape', () => {
    for (const version of DOCUMENT_JSON_VERSIONS) {
      const result = DocumentJsonSchema.safeParse({ version, variables: [], content: [] })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.version).toBe(version)
    }
  })

  it('reports an unsupported version on the version path, not as a shape failure', () => {
    // What keeps the German boundary message addressable — describeDocumentJsonError
    // branches on path[0] === 'version'.
    const result = DocumentJsonSchema.safeParse({ ...REFERENCE_EXAMPLE, version: '0.9' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'version')).toBe(true)
    }
  })

  it('names every supported version in the unsupported-version message', () => {
    const result = DocumentJsonSchema.safeParse({ ...REFERENCE_EXAMPLE, version: '0.9' })
    expect(result.success).toBe(false)
    if (result.success) return
    const message = describeDocumentJsonError(result.error, { ...REFERENCE_EXAMPLE, version: '0.9' })
    for (const version of DOCUMENT_JSON_VERSIONS) expect(message).toContain(`"${version}"`)
  })

  it('keeps per-version strictness: a valid version does not relax unknown keys', () => {
    for (const version of DOCUMENT_JSON_VERSIONS) {
      const result = DocumentJsonSchema.safeParse({
        version,
        variables: [],
        content: [],
        schmuggelware: true,
      })
      expect(result.success).toBe(false)
    }
  })
})

// ── JSON import modal boundary helpers (slice 9, #37) ───────────────────────

describe('JSON_IMPORT_EXAMPLE', () => {
  it('matches the reference JSON_IMPORT_EXAMPLE verbatim (drift guard, L2310–2328)', () => {
    expect(JSON_IMPORT_EXAMPLE).toEqual(REFERENCE_EXAMPLE)
  })

  it('validates against the schema and imports (the modal „Beispiel laden" path)', () => {
    const parsed = parse(JSON.parse(JSON.stringify(JSON_IMPORT_EXAMPLE, null, 2)))
    const editor = makeEditor()
    const result = importEditorJson(parsed, editor, makeAdapters())
    // Per-formula library flag (no top-level list in the example): the EBIT
    // formula lands in the library exactly once.
    expect(result.libraryLatex).toEqual([
      '\\begin{aligned}EBIT &= [input:Revenue] * [input:Margin] = [output:EBIT]\\end{aligned}',
    ])
    expect(editor.querySelectorAll('.input-field, .output-field').length).toBeGreaterThan(0)
    editor.remove()
  })
})

describe('describeDocumentJsonError', () => {
  function describeFor(doc: unknown): string {
    const result = DocumentJsonSchema.safeParse(doc)
    if (result.success) throw new Error('expected a schema failure')
    return describeDocumentJsonError(result.error, doc)
  }

  it('non-object roots get the German root-shape message', () => {
    const expected = 'Das JSON muss ein Objekt mit { version, variables, content } sein.'
    expect(describeFor('kein objekt')).toBe(expected)
    expect(describeFor([1, 2])).toBe(expected)
    expect(describeFor(null)).toBe(expected)
    expect(describeFor(42)).toBe(expected)
  })

  it('wrong or missing version → German version message', () => {
    const expected = 'Nicht unterstützte Schema-Version — erwartet wird "1.0" oder "1.1".'
    expect(describeFor({ ...REFERENCE_EXAMPLE, version: '2.0' })).toBe(expected)
    const withoutVersion: Record<string, unknown> = { ...REFERENCE_EXAMPLE }
    delete withoutVersion['version']
    expect(describeFor(withoutVersion)).toBe(expected)
  })

  it('reference-style image blocks with embedded src → German imageId hint', () => {
    const srcOnly = {
      version: '1.0',
      variables: [],
      content: [{ type: 'image', src: 'data:image/png;base64,AAAA' }],
    }
    const msg = describeFor(srcOnly)
    expect(msg).toContain('"imageId"')
    expect(msg).toContain('"src"')
    // Also when imageId is present but src sneaks in alongside it.
    const both = {
      version: '1.0',
      variables: [],
      content: [{ type: 'image', imageId: IMG_ID, src: 'data:x' }],
    }
    expect(describeFor(both)).toBe(msg)
  })

  it('passes through the schema’s own German messages (custom issues)', () => {
    const dupes = {
      version: '1.0',
      variables: [
        { id: 'a', type: 'input', name: 'X', value: 1 },
        { id: 'b', type: 'input', name: 'x', value: 2 },
      ],
      content: [],
    }
    expect(describeFor(dupes)).toBe(
      'Doppelter Variablenname im JSON: "x". Variablennamen müssen eindeutig sein.'
    )
  })

  it('other violations get the German lead-in plus the issue path', () => {
    const unknownBlock = { version: '1.0', variables: [], content: [{ type: 'video' }] }
    const msg = describeFor(unknownBlock)
    expect(msg).toContain(
      `Das JSON entspricht nicht dem Dokumentformat (Version ${DOCUMENT_JSON_VERSIONS.join('/')})`
    )
    expect(msg).toContain('content[0]')

    const missingVariables = { version: '1.0', content: [] }
    expect(describeFor(missingVariables)).toContain('variables')
  })

  it('translates unrecognized-keys violations', () => {
    const extraKey = {
      version: '1.0',
      variables: [],
      content: [{ type: 'code', text: 'x', bogus: true }],
    }
    const msg = describeFor(extraKey)
    expect(msg).toContain('content[0]')
    expect(msg).toContain('Unbekannte Eigenschaft(en): "bogus"')
  })
})

// ── Importer (ported — reference goldens) ───────────────────────────────────

describe('importEditorJson', () => {
  it('imports the reference example: blocks, masters in the hidden store, pill clones', () => {
    const editor = makeEditor()
    const result = importEditorJson(parse(REFERENCE_EXAMPLE), editor, makeAdapters())

    // Block order, hidden store last (masters are inserted before it).
    const children = Array.from(editor.children)
    expect(children.map((el) => el.tagName)).toEqual(['H1', 'P', 'DIV', 'P', 'DIV'])
    expect(children[4]!.id).toBe('hiddenFields')

    // Styled heading text (hex colour normalises to rgb in the live DOM).
    const headingSpan = editor.querySelector<HTMLElement>('h1 span')!
    expect(headingSpan.textContent).toBe('Imported valuation note')
    expect(headingSpan.style.color).toBe('rgb(0, 51, 141)')
    expect(headingSpan.style.fontWeight).toBe('700')

    // Three masters in the hidden store with the reference dataset shape.
    const store = editor.querySelector<HTMLElement>('#hiddenFields')!
    const masters = Array.from(store.querySelectorAll<HTMLElement>('.input-field, .output-field'))
    expect(masters.map((m) => m.dataset['fieldId'])).toEqual(['v_revenue', 'v_margin', 'v_ebit'])
    expect(masters[0]!.dataset['refType']).toBe('static')
    expect(masters[0]!.dataset['value']).toBe('1200')
    expect(masters[0]!.textContent).toBe('1200')
    expect(masters[2]!.dataset['type']).toBe('output')
    expect(masters[2]!.dataset['expr']).toBe('')
    expect(masters[2]!.textContent).toBe('?')

    // Inline pills are clones sharing the master's field id.
    const firstParagraphPills = children[1]!.querySelectorAll<HTMLElement>('.input-field')
    expect(Array.from(firstParagraphPills).map((p) => p.dataset['fieldId'])).toEqual([
      'v_revenue',
      'v_margin',
    ])

    // Formula block: raw + resolved (identity adapter) dataset, render target returned.
    const target = editor.querySelector<HTMLElement>('.render-target')!
    expect(target.dataset['rawLatex']).toBe(
      '\\begin{aligned}EBIT &= [input:Revenue] * [input:Margin] = [output:EBIT]\\end{aligned}'
    )
    expect(target.dataset['latex']).toBe(target.dataset['rawLatex'])
    expect(result.renderTargets).toEqual([target])

    // Per-formula library flag drives the derived list (no top-level library).
    expect(result.libraryLatex).toEqual([target.dataset['rawLatex']])
    editor.remove()
  })

  it('sanitises field ids and regenerates colliding ones (reference safeFieldId)', () => {
    const editor = makeEditor()
    importEditorJson(
      parse({
        version: '1.0',
        variables: [
          { id: 'weird id!', type: 'input', name: 'A', value: 1 },
          { id: 'weird_id_', type: 'input', name: 'B', value: 2 },
        ],
        content: [
          { type: 'paragraph', children: [{ fieldId: 'weird id!' }, { fieldId: 'weird_id_' }] },
        ],
      }),
      editor,
      makeAdapters()
    )
    const store = editor.querySelector<HTMLElement>('#hiddenFields')!
    const masters = Array.from(store.querySelectorAll<HTMLElement>('span'))
    expect(masters[0]!.dataset['fieldId']).toBe('weird_id_') // sanitised
    expect(masters[1]!.dataset['fieldId']).toBe('gen_1') // collision → regenerated
    // Inline lookups resolve through the SOURCE ids.
    const pills = editor.querySelectorAll<HTMLElement>('p .input-field')
    expect(pills[0]!.dataset['fieldId']).toBe('weird_id_')
    expect(pills[1]!.dataset['fieldId']).toBe('gen_1')
    editor.remove()
  })

  it('resolves references via refId (idMap), refName and ref', () => {
    const editor = makeEditor()
    importEditorJson(
      parse({
        version: '1.0',
        variables: [
          { id: 'out 1', type: 'output', name: 'Ziel', expr: '2+2' },
          { id: 'a', type: 'input', name: 'ByRefId', refId: 'out 1' },
          { id: 'b', type: 'input', name: 'ByRefName', refName: 'ziel' },
          { id: 'c', type: 'input', name: 'ByRef', ref: 'Ziel' },
          { id: 'd', type: 'input', name: 'Dangling', refId: 'missing' },
        ],
        content: [],
      }),
      editor,
      makeAdapters()
    )
    const byName = (name: string) =>
      Array.from(editor.querySelectorAll<HTMLElement>('span')).find(
        (el) => el.dataset['name'] === name
      )!
    expect(byName('ByRefId').dataset['refType']).toBe('ref')
    expect(byName('ByRefId').dataset['refId']).toBe('out_1') // mapped through idMap
    expect(byName('ByRefName').dataset['refId']).toBe('out_1') // case-insensitive name lookup
    expect(byName('ByRef').dataset['refId']).toBe('out_1')
    expect(byName('Dangling').dataset['refId']).toBe('missing') // kept as-is (reference L2509)
    expect(byName('ByRefId').dataset['pendingRefId']).toBeUndefined()
    expect(byName('ByRefName').dataset['pendingRefName']).toBeUndefined()
    editor.remove()
  })

  it('renders unknown field references as the red [NOT FOUND] span', () => {
    const editor = makeEditor()
    importEditorJson(
      parse({
        version: '1.0',
        variables: [],
        content: [{ type: 'paragraph', children: [{ field: 'nope' }] }],
      }),
      editor,
      makeAdapters()
    )
    const missing = editor.querySelector<HTMLElement>('p span')!
    expect(missing.textContent).toBe('[NOT FOUND: nope]')
    expect(missing.style.color).toBe('rgb(255, 0, 0)')
    expect(missing.style.fontWeight).toBe('700')
    editor.remove()
  })

  it('clamps heading levels to 1–2 (reference L2524)', () => {
    const editor = makeEditor()
    importEditorJson(
      parse({
        version: '1.0',
        variables: [],
        content: [
          { type: 'heading', level: 5, children: [{ text: 'a' }] },
          { type: 'heading', level: 0, children: [{ text: 'b' }] },
          { type: 'heading', children: [{ text: 'c' }] },
        ],
      }),
      editor,
      makeAdapters()
    )
    expect(Array.from(editor.children).map((el) => el.tagName)).toEqual(['H2', 'H1', 'H1', 'DIV'])
    editor.remove()
  })

  it('imports lists with array, {children} and {text} items, ordered and unordered', () => {
    const editor = makeEditor()
    importEditorJson(
      parse({
        version: '1.0',
        variables: [],
        content: [
          { type: 'list', ordered: true, items: [[{ text: 'eins' }], { children: ['zwei'] }, { text: 'drei' }] },
          { type: 'list', items: [['vier']] },
        ],
      }),
      editor,
      makeAdapters()
    )
    const ol = editor.querySelector('ol')!
    expect(Array.from(ol.querySelectorAll('li')).map((li) => li.textContent)).toEqual([
      'eins',
      'zwei',
      'drei',
    ])
    expect(editor.querySelector('ul li')!.textContent).toBe('vier')
    editor.remove()
  })

  it('imports br nodes (both spellings), numbers and nested styled groups', () => {
    const editor = makeEditor()
    importEditorJson(
      parse({
        version: '1.0',
        variables: [],
        content: [
          {
            type: 'paragraph',
            children: [
              'plain ',
              42,
              { br: true },
              { type: 'br' },
              { children: [{ text: 'inner' }], style: { italic: true } },
            ],
          },
        ],
      }),
      editor,
      makeAdapters()
    )
    const p = editor.querySelector('p')!
    expect(p.querySelectorAll('br').length).toBe(2)
    expect(p.textContent).toBe('plain 42inner')
    const group = p.querySelector<HTMLElement>('span:last-of-type')!
    expect(group.style.fontStyle).toBe('italic')
    editor.remove()
  })

  it('restores empty paragraphs with a <br> (reference L2563)', () => {
    const editor = makeEditor()
    importEditorJson(
      parse({ version: '1.0', variables: [], content: [{ type: 'paragraph', children: [] }] }),
      editor,
      makeAdapters()
    )
    expect(editor.querySelector('p')!.innerHTML).toBe('<br>')
    editor.remove()
  })

  it('imports code blocks (slice-7 extension) and formula captions (reference-compat)', () => {
    const editor = makeEditor()
    importEditorJson(
      parse({
        version: '1.0',
        variables: [],
        content: [
          { type: 'code', text: 'a^2 + b^2' },
          { type: 'formula', latex: 'x', caption: 'Eine Formel' },
        ],
      }),
      editor,
      makeAdapters()
    )
    expect(editor.querySelector('pre')!.textContent).toBe('a^2 + b^2')
    const caption = editor.querySelector<HTMLElement>('.block-caption')!
    expect(caption.textContent).toBe('Eine Formel')
    expect(caption.dataset['ph']).toBe('Caption ...')
    editor.remove()
  })

  it('imports image blocks (slice 8): drag handle, adapter URL, data-image-id — reference DOM shape', () => {
    const editor = makeEditor()
    importEditorJson(
      parse({
        version: '1.0',
        variables: [],
        content: [
          { type: 'paragraph', children: ['davor'] },
          { type: 'image', imageId: IMG_ID, alt: 'Screenshot' },
          { type: 'image', imageId: IMG_ID_2 },
        ],
      }),
      editor,
      makeAdapters()
    )
    const blocks = editor.querySelectorAll<HTMLElement>('.image-block')
    expect(blocks.length).toBe(2)
    // Reference image-block shape (L2555–2559): draggable block, handle, img.
    const first = blocks[0]!
    expect(first.getAttribute('draggable')).toBe('true')
    const handle = first.querySelector<HTMLElement>('.drag-handle')!
    expect(handle.getAttribute('contenteditable')).toBe('false')
    const img = first.querySelector<HTMLImageElement>('img')!
    expect(img.getAttribute('src')).toBe(`stub://editor-image/${IMG_ID}`)
    expect(img.dataset['imageId']).toBe(IMG_ID)
    expect(img.alt).toBe('Screenshot')
    expect(img.getAttribute('contenteditable')).toBe('false')
    expect(blocks[1]!.querySelector('img')!.alt).toBe('')
    // Document order preserved around the paragraph.
    expect(Array.from(editor.children).map((el) => el.className || el.tagName)).toEqual([
      'P',
      'image-block',
      'image-block',
      'DIV',
    ])
    editor.remove()
  })

  it('renders the #44 image delete ✕ as editor chrome the serializer ignores', () => {
    const editor = makeEditor()
    importEditorJson(
      parse({
        version: '1.0',
        variables: [],
        content: [{ type: 'image', imageId: IMG_ID, alt: 'Screenshot' }],
      }),
      editor,
      makeAdapters()
    )
    const block = editor.querySelector<HTMLElement>('.image-block')!
    const remove = block.querySelector<HTMLButtonElement>('button.img-remove')!
    expect(remove).not.toBeNull()
    expect(remove.getAttribute('contenteditable')).toBe('false')
    expect(remove.getAttribute('type')).toBe('button')
    // The button is chrome only — serialization reads img[data-image-id] and
    // must round-trip the block unchanged despite the extra child.
    const json = serializeEditorState(editor, [])
    expect(json.content).toEqual([{ type: 'image', imageId: IMG_ID, alt: 'Screenshot' }])
    editor.remove()
  })

  it('restores the slice-7 variable extras as datasets', () => {
    const editor = makeEditor()
    importEditorJson(
      parse({
        version: '1.0',
        variables: [
          { id: 'o1', type: 'output', name: 'A', expr: '', latexValue: '42' },
          { id: 'r1', type: 'input', refType: 'ref', refId: 'o1', referenceClone: true, sourceOutputName: 'A' },
        ],
        content: [],
      }),
      editor,
      makeAdapters()
    )
    const output = editor.querySelector<HTMLElement>('.output-field')!
    expect(output.dataset['latexValue']).toBe('42')
    const clone = editor.querySelector<HTMLElement>('.input-field')!
    expect(clone.dataset['referenceClone']).toBe('true')
    expect(clone.dataset['sourceOutputName']).toBe('A')
    expect(clone.dataset['refId']).toBe('o1')
    editor.remove()
  })

  it('prefers the top-level library list over per-formula flags when present', () => {
    const editor = makeEditor()
    const result = importEditorJson(
      parse({
        version: '1.0',
        variables: [],
        content: [{ type: 'formula', latex: 'a', library: true }],
        library: ['b', 'c'],
      }),
      editor,
      makeAdapters()
    )
    expect(result.libraryLatex).toEqual(['b', 'c'])
    editor.remove()
  })

  it('excludes formulas with library:false from the derived library list', () => {
    const editor = makeEditor()
    const result = importEditorJson(
      parse({
        version: '1.0',
        variables: [],
        content: [
          { type: 'formula', latex: 'keep' },
          { type: 'formula', latex: 'skip', library: false },
        ],
      }),
      editor,
      makeAdapters()
    )
    expect(result.libraryLatex).toEqual(['keep'])
    editor.remove()
  })

  it('throws the German duplicate-name error (importer-level, reference L2416)', () => {
    const editor = makeEditor()
    const doc = {
      version: '1.0',
      variables: [
        { id: 'a', type: 'input', name: 'X', value: 1 },
        { id: 'b', type: 'input', name: ' x ', value: 2 },
      ],
      content: [],
    } as unknown as LatestEditorDocumentJson
    expect(() => importEditorJson(doc, editor, makeAdapters())).toThrow(
      'Doppelter Variablenname im JSON: "x". Variablennamen müssen eindeutig sein.'
    )
    editor.remove()
  })

  it('merge mode (replaceExisting:false) keeps content and rejects colliding names (reference L2418)', () => {
    const editor = makeEditor()
    editor.innerHTML =
      '<p>alt</p><span class="input-field" data-field-id="ex1" data-type="input" data-name="Bestand"></span>'
    const collide = parse({
      version: '1.0',
      variables: [{ id: 'n1', type: 'input', name: 'bestand', value: 1 }],
      content: [],
    })
    expect(() => importEditorJson(collide, editor, makeAdapters(), { replaceExisting: false })).toThrow(
      'Variablenname existiert bereits im Editor: "bestand". Bitte eindeutigen Namen verwenden oder Import mit Ersetzen ausführen.'
    )
    const merge = parse({
      version: '1.0',
      variables: [{ id: 'n1', type: 'input', name: 'Neu', value: 1 }],
      content: [{ type: 'paragraph', children: ['dazu'] }],
    })
    importEditorJson(merge, editor, makeAdapters(), { replaceExisting: false })
    expect(editor.querySelector('p')!.textContent).toBe('alt') // kept
    expect(editor.textContent).toContain('dazu')
    editor.remove()
  })

  it('falls back to a paragraph for unknown block types (reference default branch, lenient importer)', () => {
    const editor = makeEditor()
    const doc = {
      version: '1.0',
      variables: [],
      content: [{ type: 'mystery', text: 'huh' }],
    } as unknown as LatestEditorDocumentJson
    importEditorJson(doc, editor, makeAdapters())
    expect(editor.querySelector('p')!.textContent).toBe('huh')
    editor.remove()
  })
})

// ── Serializer (new) ────────────────────────────────────────────────────────

describe('serializeEditorState', () => {
  it('serialises blocks, canonicalises styles (rgb→hex, px→number, 700→bold) and tags (b/i/u/s)', () => {
    const editor = makeEditor()
    const h1 = document.createElement('h1')
    const styled = document.createElement('span')
    styled.textContent = 'Titel'
    styled.style.color = '#e8722c'
    styled.style.fontSize = '24px'
    styled.style.fontWeight = '700'
    h1.appendChild(styled)
    editor.appendChild(h1)

    const p = document.createElement('p')
    p.appendChild(document.createTextNode('a '))
    const b = document.createElement('b')
    b.textContent = 'fett'
    p.appendChild(b)
    const u = document.createElement('u')
    u.textContent = 'unter'
    p.appendChild(u)
    const s = document.createElement('s')
    s.textContent = 'weg'
    p.appendChild(s)
    const deco = document.createElement('span')
    deco.textContent = 'beides'
    deco.style.textDecoration = 'underline line-through'
    p.appendChild(deco)
    p.style.textAlign = 'center'
    editor.appendChild(p)

    const pre = document.createElement('pre')
    pre.textContent = 'code'
    editor.appendChild(pre)

    const json = serializeEditorState(editor, [])
    expect(json.content).toEqual([
      {
        type: 'heading',
        level: 1,
        children: [{ text: 'Titel', style: { color: '#e8722c', fontSize: 24, bold: true } }],
      },
      {
        type: 'paragraph',
        children: [
          'a ',
          { text: 'fett', style: { bold: true } },
          { text: 'unter', style: { underline: true } },
          { text: 'weg', style: { strike: true } },
          { text: 'beides', style: { underline: true, strike: true } },
        ],
        style: { align: 'center' },
      },
      { type: 'code', text: 'code' },
    ])
    expect(DocumentJsonSchema.safeParse(json).success).toBe(true)
    editor.remove()
  })

  it('canonicalises the lone-<br> line to empty children and keeps multiple brs', () => {
    const editor = makeEditor()
    editor.innerHTML = '<p><br></p><p>a<br><br></p>'
    const json = serializeEditorState(editor, [])
    expect(json.content).toEqual([
      { type: 'paragraph', children: [] },
      { type: 'paragraph', children: ['a', { br: true }, { br: true }] },
    ])
    editor.remove()
  })

  it('reads formulas from data-raw-latex only and skips drag handles and MathJax output', () => {
    const editor = makeEditor()
    editor.innerHTML =
      '<div class="formula-block" draggable="true">' +
      '<span class="drag-handle" contenteditable="false">❚❚</span>' +
      '<div class="render-target" contenteditable="false" data-raw-latex="a*[input:x]" data-latex="a\\,\\cdot\\,5"><svg></svg></div>' +
      '</div>'
    const json = serializeEditorState(editor, ['a*[input:x]'])
    expect(json.content).toEqual([{ type: 'formula', latex: 'a*[input:x]' }])
    expect(json.library).toEqual(['a*[input:x]'])
    editor.remove()
  })

  it('serialises image blocks from data-image-id only — the src never enters the JSON', () => {
    const editor = makeEditor()
    editor.innerHTML =
      '<div class="image-block" draggable="true">' +
      '<span class="drag-handle" contenteditable="false">❚❚</span>' +
      `<img src="/api/editor-image/${IMG_ID}" alt="Screenshot" contenteditable="false" data-image-id="${IMG_ID}">` +
      '</div>' +
      '<div class="image-block" draggable="true" style="text-align: right;">' +
      '<span class="drag-handle" contenteditable="false">❚❚</span>' +
      `<img src="/api/editor-image/${IMG_ID_2}" alt="" contenteditable="false" data-image-id="${IMG_ID_2}">` +
      '</div>'
    const json = serializeEditorState(editor, [])
    expect(json.content).toEqual([
      { type: 'image', imageId: IMG_ID, alt: 'Screenshot' },
      { type: 'image', imageId: IMG_ID_2, style: { align: 'right' } },
    ])
    expect(JSON.stringify(json)).not.toContain('/api/editor-image')
    expect(DocumentJsonSchema.safeParse(json).success).toBe(true)
    editor.remove()
  })

  it('skips image blocks that are still uploading (blob: preview, no data-image-id)', () => {
    const editor = makeEditor()
    editor.innerHTML =
      '<p>text</p>' +
      '<div class="image-block is-uploading" draggable="true">' +
      '<span class="drag-handle" contenteditable="false">❚❚</span>' +
      '<img src="blob:http://localhost/preview" alt="pending" contenteditable="false">' +
      '</div>'
    const json = serializeEditorState(editor, [])
    expect(json.content).toEqual([{ type: 'paragraph', children: ['text'] }])
    expect(JSON.stringify(json)).not.toContain('blob:')
    editor.remove()
  })

  it('wraps stray top-level inline content into a paragraph and skips the hidden store', () => {
    const editor = makeEditor()
    editor.appendChild(document.createTextNode('lose'))
    const pill = document.createElement('span')
    pill.className = 'input-field'
    pill.dataset['fieldId'] = 'f1'
    pill.dataset['type'] = 'input'
    pill.dataset['refType'] = 'static'
    pill.dataset['value'] = '3'
    editor.appendChild(pill)
    const store = document.createElement('div')
    store.id = 'hiddenFields'
    editor.appendChild(store)
    const json = serializeEditorState(editor, [])
    expect(json.content).toEqual([{ type: 'paragraph', children: ['lose', { fieldId: 'f1' }] }])
    editor.remove()
  })

  it('orders variables inline-first (content order), then hidden-only (store order), deduped', () => {
    const editor = makeEditor()
    // Hidden store deliberately FIRST in the DOM — the ordering rule must not
    // depend on the store's position (the importer always re-appends it last).
    editor.innerHTML =
      '<div id="hiddenFields">' +
      '<span class="output-field" data-field-id="hidden1" data-type="output" data-name="H" data-expr=""></span>' +
      '<span class="input-field" data-field-id="vis1" data-type="input" data-name="V" data-ref-type="static" data-value="1"></span>' +
      '</div>' +
      '<p><span class="input-field" data-field-id="vis1" data-type="input" data-name="V" data-ref-type="static" data-value="1"></span></p>'
    const json = serializeEditorState(editor, [])
    expect(json.variables.map((v) => v.id)).toEqual(['vis1', 'hidden1'])
    editor.remove()
  })

  it('emits full field state: static, ref, output with latexValue, reference clones', () => {
    const editor = makeEditor()
    editor.innerHTML =
      '<p>' +
      '<span class="input-field" data-field-id="i1" data-type="input" data-name="preis" data-ref-type="static" data-value="2,5">2,5</span>' +
      '<span class="input-field is-ref" data-field-id="r1" data-type="input" data-ref-type="ref" data-ref-id="o1" data-reference-clone="true" data-source-output-name="summe" data-name="">5</span>' +
      '<span class="output-field" data-field-id="o1" data-type="output" data-name="summe" data-expr="" data-latex-value="5">5</span>' +
      '</p>'
    const json = serializeEditorState(editor, [])
    expect(json.variables).toEqual([
      { id: 'i1', type: 'input', name: 'preis', refType: 'static', value: '2,5' },
      { id: 'r1', type: 'input', refType: 'ref', refId: 'o1', referenceClone: true, sourceOutputName: 'summe' },
      { id: 'o1', type: 'output', name: 'summe', expr: '', latexValue: '5' },
    ])
    editor.remove()
  })
})

// ── Round-trip byte-stability (the slice-7 acceptance criterion) ────────────

describe('export → import → export', () => {
  function expectStable(j1: LatestEditorDocumentJson) {
    expect(DocumentJsonSchema.safeParse(j1).success).toBe(true)
    const j2 = roundTrip(j1)
    expect(JSON.stringify(j2)).toBe(JSON.stringify(j1))
  }

  it('is byte-stable for an empty document', () => {
    const editor = makeEditor()
    expectStable(serializeEditorState(editor, []))
    editor.remove()
  })

  it('is byte-stable for rich text (headings, styles, lists, code, brs)', () => {
    const editor = makeEditor()
    const adapters = makeAdapters()
    importEditorJson(
      parse({
        version: '1.0',
        variables: [],
        content: [
          { type: 'heading', level: 2, children: [{ text: 'Abschnitt', style: { color: '#db3627', bold: true } }] },
          {
            type: 'paragraph',
            children: [
              'normal ',
              { text: 'gross', style: { fontSize: 18 } },
              { br: true },
              { children: [{ text: 'tief', style: { italic: true } }], style: { underline: true } },
            ],
          },
          { type: 'list', ordered: true, items: [[{ text: 'eins', style: { strike: true } }], ['zwei']] },
          { type: 'code', text: '\\frac{a}{b}' },
          { type: 'paragraph', children: [] },
        ],
      }),
      editor,
      adapters
    )
    // Serialize the LIVE DOM (import output) — this J1 is serializer-produced.
    expectStable(serializeEditorState(editor, []))
    editor.remove()
  })

  it('is byte-stable for fields, formulas with placeholders, hidden-only fields and reference clones', () => {
    const editor = makeEditor()
    importEditorJson(
      parse({
        version: '1.0',
        variables: [
          { id: 'i1', type: 'input', name: 'menge', value: '3' },
          { id: 'i2', type: 'input', name: 'faktor', value: '1,5' },
          { id: 'o1', type: 'output', name: 'summe', expr: '', latexValue: '4.5' },
          { id: 'r1', type: 'input', refType: 'ref', refId: 'o1', referenceClone: true, sourceOutputName: 'summe' },
          { id: 'hidden1', type: 'input', name: 'nurlatex', value: '7' },
        ],
        content: [
          { type: 'paragraph', children: ['Menge: ', { fieldId: 'i1' }, ' Faktor: ', { fieldId: 'i2' }] },
          { type: 'formula', latex: 'summe = [input:menge] * [input:faktor] = [output:summe]' },
          { type: 'paragraph', children: ['Ergebnis: ', { fieldId: 'r1' }] },
        ],
        library: ['summe = [input:menge] * [input:faktor] = [output:summe]', 'verwaist^2'],
      }),
      editor,
      makeAdapters()
    )
    const j1 = serializeEditorState(editor, [
      'summe = [input:menge] * [input:faktor] = [output:summe]',
      'verwaist^2',
    ])
    // The orphaned library entry (no matching formula block) must survive.
    expect(j1.library).toContain('verwaist^2')
    const j2 = roundTrip(j1)
    expect(JSON.stringify(j2)).toBe(JSON.stringify(j1))
    // And the fixed point holds on a further pass.
    expect(JSON.stringify(roundTrip(j2))).toBe(JSON.stringify(j2))
    editor.remove()
  })

  it('reaches a stable fixed point from the (non-canonical) reference example', () => {
    // The reference example itself is not serializer-produced (meta, number
    // values, per-formula library flag) — J1 may differ from it, but from
    // then on every pass must be identical.
    const editor = makeEditor()
    importEditorJson(parse(REFERENCE_EXAMPLE), editor, makeAdapters())
    const j1 = serializeEditorState(editor, [
      '\\begin{aligned}EBIT &= [input:Revenue] * [input:Margin] = [output:EBIT]\\end{aligned}',
    ])
    const j2 = roundTrip(j1)
    expect(JSON.stringify(j2)).toBe(JSON.stringify(j1))
    editor.remove()
  })

  it('is byte-stable for formula captions', () => {
    const editor = makeEditor()
    importEditorJson(
      parse({
        version: '1.0',
        variables: [],
        content: [{ type: 'formula', latex: 'x^2', caption: 'Beschriftung' }],
      }),
      editor,
      makeAdapters()
    )
    const j1 = serializeEditorState(editor, [])
    // Canonical caption form: { children: [...] } — the string caption became
    // a text span on import (reference caption handling, L2547).
    expect(j1.content[0]).toEqual({
      type: 'formula',
      latex: 'x^2',
      caption: { children: [{ text: 'Beschriftung' }] },
    })
    const j2 = roundTrip(j1)
    expect(JSON.stringify(j2)).toBe(JSON.stringify(j1))
    editor.remove()
  })

  it('is byte-stable for image blocks (slice 8), including alt and style', () => {
    const editor = makeEditor()
    importEditorJson(
      parse({
        version: '1.0',
        variables: [],
        content: [
          { type: 'paragraph', children: ['davor'] },
          { type: 'image', imageId: IMG_ID, alt: 'Screenshot' },
          { type: 'image', imageId: IMG_ID_2, style: { align: 'center' } },
        ],
      }),
      editor,
      makeAdapters()
    )
    const j1 = serializeEditorState(editor, [])
    expect(j1.content[1]).toEqual({ type: 'image', imageId: IMG_ID, alt: 'Screenshot' })
    expect(j1.content[2]).toEqual({ type: 'image', imageId: IMG_ID_2, style: { align: 'center' } })
    const j2 = roundTrip(j1)
    expect(JSON.stringify(j2)).toBe(JSON.stringify(j1))
    editor.remove()
  })
})

// ── Block anchors / Sprungmarken (v1.1, #71) ────────────────────────────────

describe('block anchors (schema v1.1)', () => {
  const ANCHORED = {
    version: '1.1',
    variables: [],
    content: [{ type: 'heading', level: 1, children: ['Kapitel'], anchor: { id: 'anc_a', label: 'Kapitel 1' } }],
  }

  it('accepts a block anchor on a v1.1 document', () => {
    expect(DocumentJsonSchema.safeParse(ANCHORED).success).toBe(true)
  })

  it('rejects a block anchor on a v1.0 document — the version discriminator means something', () => {
    // Anchors arrived WITH 1.1. Admitting them into 1.0 would make the version
    // decorative and let a snapshot claim a shape its version does not have.
    expect(DocumentJsonSchema.safeParse({ ...ANCHORED, version: '1.0' }).success).toBe(false)
  })

  it('accepts an anchor on every block type', () => {
    const anchor = { id: 'anc_x', label: 'Marke' }
    const doc = {
      version: '1.1',
      variables: [],
      content: [
        { type: 'paragraph', children: ['p'], anchor },
        { type: 'heading', level: 2, children: ['h'], anchor: { id: 'anc_h', label: 'H' } },
        { type: 'list', ordered: false, items: [['a']], anchor: { id: 'anc_l', label: 'L' } },
        { type: 'formula', latex: 'x', anchor: { id: 'anc_f', label: 'F' } },
        { type: 'code', text: 'x', anchor: { id: 'anc_c', label: 'C' } },
        { type: 'image', imageId: IMG_ID, anchor: { id: 'anc_i', label: 'I' } },
      ],
    }
    expect(DocumentJsonSchema.safeParse(doc).success).toBe(true)
  })

  it('requires a non-empty id and rejects unknown anchor keys', () => {
    const withAnchor = (anchor: unknown) => ({
      version: '1.1',
      variables: [],
      content: [{ type: 'paragraph', children: ['p'], anchor }],
    })
    expect(DocumentJsonSchema.safeParse(withAnchor({ id: '', label: 'X' })).success).toBe(false)
    expect(DocumentJsonSchema.safeParse(withAnchor({ label: 'X' })).success).toBe(false)
    expect(DocumentJsonSchema.safeParse(withAnchor({ id: 'anc_a' })).success).toBe(false)
    expect(DocumentJsonSchema.safeParse(withAnchor({ id: 'anc_a', label: 'X', href: 'y' })).success).toBe(false)
    // An empty label is fine — a Sprungmarke may be renamed to nothing.
    expect(DocumentJsonSchema.safeParse(withAnchor({ id: 'anc_a', label: '' })).success).toBe(true)
  })

  it('keeps v1.1 blocks strict — extending with `anchor` did not open them up', () => {
    const doc = {
      version: '1.1',
      variables: [],
      content: [{ type: 'code', text: 'x', bogus: true }],
    }
    expect(DocumentJsonSchema.safeParse(doc).success).toBe(false)
  })

  it('imports the anchor onto the block element’s dataset', () => {
    const editor = makeEditor()
    importEditorJson(parse(ANCHORED), editor, makeAdapters())
    const h1 = editor.querySelector<HTMLElement>('h1')!
    expect(h1.dataset['anchorId']).toBe('anc_a')
    expect(h1.dataset['anchorLabel']).toBe('Kapitel 1')
    editor.remove()
  })

  it('leaves unmarked blocks free of anchor attributes', () => {
    const editor = makeEditor()
    importEditorJson(
      parse({ version: '1.1', variables: [], content: [{ type: 'paragraph', children: ['p'] }] }),
      editor,
      makeAdapters()
    )
    expect(editor.querySelector('p')!.hasAttribute('data-anchor-id')).toBe(false)
    editor.remove()
  })

  it('serializes the anchor back out of the dataset', () => {
    const editor = makeEditor()
    editor.innerHTML = '<h1 data-anchor-id="anc_a" data-anchor-label="Kapitel 1">Kapitel</h1>'
    const json = serializeEditorState(editor, [])
    expect(json.content[0]).toEqual({
      type: 'heading',
      level: 1,
      children: ['Kapitel'],
      anchor: { id: 'anc_a', label: 'Kapitel 1' },
    })
    editor.remove()
  })

  it('skips a block whose anchor id is blank — an unlinkable marker is no marker', () => {
    const editor = makeEditor()
    editor.innerHTML = '<p data-anchor-id="" data-anchor-label="X">text</p>'
    expect(serializeEditorState(editor, []).content[0]).toEqual({
      type: 'paragraph',
      children: ['text'],
    })
    editor.remove()
  })

  it('emits the anchor in a fixed position — last, after style', () => {
    // Key order is part of the byte-stability contract; the schema declares
    // `anchor` in the same place, so parse order and emit order agree.
    const editor = makeEditor()
    editor.innerHTML =
      '<h2 style="text-align:center" data-anchor-id="anc_a" data-anchor-label="M">t</h2>'
    expect(Object.keys(serializeEditorState(editor, []).content[0]!)).toEqual([
      'type',
      'level',
      'children',
      'style',
      'anchor',
    ])
    editor.remove()
  })

  it('serializesAsOwnBlock agrees with what the serializer actually emits', () => {
    // The predicate gates where a Sprungmarke may be placed, so it has to
    // match the serializer exactly: a mark on something the save discards is
    // a mark the author can see but nothing can link to.
    const editor = makeEditor()
    editor.innerHTML =
      '<p>absatz</p>' +
      '<h1>titel</h1>' +
      '<pre>code</pre>' +
      '<ul><li>eins</li></ul>' +
      '<div class="formula-block"><div class="render-target" data-raw-latex="x"></div></div>' +
      `<div class="image-block"><img data-image-id="${IMG_ID}"></div>` +
      // Dropped by the serializer, so not markable:
      '<div id="hiddenFields"></div>' +
      '<div class="drop-indicator"></div>' +
      '<div class="image-block"><img src="blob:noch-am-hochladen"></div>' +
      '<span>streuner</span>'
    const emitted = serializeEditorState(editor, []).content.length
    const markable = Array.from(editor.children).filter((el) =>
      serializesAsOwnBlock(el as HTMLElement)
    )
    // The stray <span> is folded into a trailing paragraph, so the serializer
    // emits one block more than there are markable elements.
    expect(markable.map((el) => el.tagName + (el.className ? '.' + el.className : ''))).toEqual([
      'P',
      'H1',
      'PRE',
      'UL',
      'DIV.formula-block',
      'DIV.image-block',
    ])
    expect(emitted).toBe(markable.length + 1)
    editor.remove()
  })

  // #93: the first line of an empty document stays a bare text node, so it is
  // correctly unmarkable — and the author, seeing the caret in it, cannot tell
  // why. Promotion makes the line markable without changing what is saved.
  it('promotes the first bare line into the paragraph the serializer would emit', () => {
    const editor = makeEditor()
    editor.innerHTML = 'erste Zeile<div>zweite Zeile</div>'
    const before = serializeEditorState(editor, [])

    const promoted = promoteStrayRunToBlock(editor, editor.firstChild!)!
    expect(promoted.tagName).toBe('P')
    expect(promoted.textContent).toBe('erste Zeile')
    expect(serializesAsOwnBlock(promoted)).toBe(true)
    // The whole point: the saved document is untouched by the promotion.
    expect(serializeEditorState(editor, [])).toEqual(before)
    editor.remove()
  })

  it('promotes the whole contiguous stray run, not just the node passed in', () => {
    // The serializer folds a run of strays into ONE paragraph; promoting only
    // the caret's own node would split it into two and change the document.
    const editor = makeEditor()
    editor.innerHTML = 'links<b>fett</b>rechts<p>eigener Block</p>'
    const before = serializeEditorState(editor, [])

    const promoted = promoteStrayRunToBlock(editor, editor.childNodes[1]!)!
    expect(promoted.textContent).toBe('linksfettrechts')
    expect(editor.children.length).toBe(2)
    expect(serializeEditorState(editor, [])).toEqual(before)
    editor.remove()
  })

  it('stops the run at the hidden field store rather than folding it in', () => {
    // #hiddenFields inside a paragraph would be serialized as visible content
    // — the one place where following the serializer's own grouping exactly
    // would be actively wrong.
    const editor = makeEditor()
    editor.innerHTML = 'sichtbar<div id="hiddenFields"></div>dahinter'

    const promoted = promoteStrayRunToBlock(editor, editor.firstChild!)!
    expect(promoted.textContent).toBe('sichtbar')
    expect(promoted.querySelector('#hiddenFields')).toBeNull()
    expect(editor.querySelector('#hiddenFields')!.parentElement).toBe(editor)
    editor.remove()
  })

  it('refuses anything that is already a block, dropped chrome, or not a child of the editor', () => {
    const editor = makeEditor()
    editor.innerHTML =
      '<p>absatz</p><div id="hiddenFields"></div><div class="drop-indicator"></div>'
    const [paragraph, hidden, indicator] = Array.from(editor.children)
    expect(promoteStrayRunToBlock(editor, paragraph!)).toBeNull()
    expect(promoteStrayRunToBlock(editor, hidden!)).toBeNull()
    expect(promoteStrayRunToBlock(editor, indicator!)).toBeNull()
    // A node one level down is not a top-level stray — the caller resolves the
    // top-level node first.
    expect(promoteStrayRunToBlock(editor, paragraph!.firstChild!)).toBeNull()
    editor.remove()
  })

  it('is byte-stable across export → import → export for every anchored block type', () => {
    const editor = makeEditor()
    importEditorJson(
      parse({
        version: '1.1',
        variables: [],
        content: [
          { type: 'heading', level: 1, children: ['Kapitel'], anchor: { id: 'anc_h', label: 'Kapitel 1' } },
          { type: 'paragraph', children: ['text'], anchor: { id: 'anc_p', label: 'Absatz' } },
          { type: 'list', ordered: true, items: [['a']], anchor: { id: 'anc_l', label: 'Liste' } },
          { type: 'formula', latex: 'x^2', anchor: { id: 'anc_f', label: 'Formel' } },
          { type: 'code', text: 'x', anchor: { id: 'anc_c', label: 'Code' } },
          { type: 'image', imageId: IMG_ID, anchor: { id: 'anc_i', label: 'Bild' } },
          { type: 'paragraph', children: ['ohne Marke'] },
        ],
      }),
      editor,
      makeAdapters()
    )
    const j1 = serializeEditorState(editor, [])
    expect(j1.content.map((b) => b.anchor?.id ?? null)).toEqual([
      'anc_h',
      'anc_p',
      'anc_l',
      'anc_f',
      'anc_c',
      'anc_i',
      null,
    ])
    const j2 = roundTrip(j1)
    expect(JSON.stringify(j2)).toBe(JSON.stringify(j1))
    // And the fixed point holds on a further pass.
    expect(JSON.stringify(roundTrip(j2))).toBe(JSON.stringify(j2))
    editor.remove()
  })

  it('survives an anchor whose label carries quotes and angle brackets', () => {
    const editor = makeEditor()
    const label = 'Kapitel "1" <b> & mehr'
    importEditorJson(
      parse({
        version: '1.1',
        variables: [],
        content: [{ type: 'paragraph', children: ['t'], anchor: { id: 'anc_a', label } }],
      }),
      editor,
      makeAdapters()
    )
    const j1 = serializeEditorState(editor, [])
    expect(j1.content[0]!.anchor).toEqual({ id: 'anc_a', label })
    expect(JSON.stringify(roundTrip(j1))).toBe(JSON.stringify(j1))
    editor.remove()
  })
})

// ── Image-reference helpers (slice 8, #36) ──────────────────────────────────

describe('collectReferencedImageIds', () => {
  it('returns image ids deduped in content order; empty without image blocks', () => {
    const doc = parse({
      version: '1.0',
      variables: [],
      content: [
        { type: 'paragraph', children: ['text'] },
        { type: 'image', imageId: IMG_ID_2 },
        { type: 'formula', latex: 'x' },
        { type: 'image', imageId: IMG_ID },
        { type: 'image', imageId: IMG_ID_2 },
      ],
    })
    expect(collectReferencedImageIds(doc)).toEqual([IMG_ID_2, IMG_ID])
    expect(collectReferencedImageIds(emptyEditorDocumentJson())).toEqual([])
  })
})

describe('emptyEditorDocumentJson', () => {
  it('produces a schema-valid canonical empty document (the anchor-draft content)', () => {
    const doc = emptyEditorDocumentJson()
    expect(DocumentJsonSchema.safeParse(doc).success).toBe(true)
    expect(doc).toEqual({
      version: LATEST_DOCUMENT_JSON_VERSION,
      variables: [],
      content: [],
      library: [],
    })
  })
})

// ── Save-time metadata (slice 10, #38) ──────────────────────────────────────

describe('withDocumentMeta', () => {
  it('attaches the trimmed term as meta.term and stays schema-valid', () => {
    const doc = withDocumentMeta(emptyEditorDocumentJson(), '  SS26  ')
    expect(doc.meta).toEqual({ term: 'SS26' })
    expect(DocumentJsonSchema.safeParse(doc).success).toBe(true)
  })

  it('returns the document unchanged for a blank term (no empty meta emitted)', () => {
    const base = emptyEditorDocumentJson()
    expect(withDocumentMeta(base, '')).toBe(base)
    expect(withDocumentMeta(base, '   ')).toBe(base)
  })

  it('does not mutate the input document', () => {
    const base = emptyEditorDocumentJson()
    const withMeta = withDocumentMeta(base, 'WS26')
    expect(withMeta).not.toBe(base)
    expect(base.meta).toBeUndefined()
  })

  it('meta is dropped by import → export (term is React-owned, re-injected each save)', () => {
    // Documents the intended asymmetry: the importer ignores meta and the
    // serializer never emits it, so serializeEditorState's byte-stability
    // contract holds for the meta-free core of a meta-carrying document.
    const doc = withDocumentMeta(emptyEditorDocumentJson(), 'SS26')
    const roundTripped = roundTrip(doc)
    expect(roundTripped.meta).toBeUndefined()
    expect(JSON.stringify(roundTripped)).toBe(JSON.stringify(emptyEditorDocumentJson()))
  })
})

// ── Inline links (v1.1, #72) ────────────────────────────────────────────────

describe('inline link nodes (schema v1.1)', () => {
  const KURS_ID = '11111111-1111-4111-8111-111111111111'
  const UNIT_ID = '22222222-2222-4222-8222-222222222222'
  const DOC_ID = '33333333-3333-4333-8333-333333333333'

  const linked = (target: unknown) => ({
    version: '1.1',
    variables: [],
    content: [
      { type: 'paragraph', children: ['siehe ', { type: 'link', target, label: 'Aufgabe 2' }] },
    ],
  })

  it('accepts a link node on a v1.1 document', () => {
    expect(DocumentJsonSchema.safeParse(linked({ docId: DOC_ID })).success).toBe(true)
    expect(DocumentJsonSchema.safeParse(linked({ kursId: KURS_ID })).success).toBe(true)
    expect(DocumentJsonSchema.safeParse(linked({ unitId: UNIT_ID })).success).toBe(true)
    expect(DocumentJsonSchema.safeParse(linked({ docId: DOC_ID, anchorId: 'anc_a' })).success).toBe(
      true
    )
  })

  it('rejects a link node on a v1.0 document — the version discriminator means something', () => {
    // Same rule the anchor follows: links arrived WITH 1.1, so a v1.0 snapshot
    // claiming one is refused rather than read as a shape its version lacks.
    expect(DocumentJsonSchema.safeParse({ ...linked({ docId: DOC_ID }), version: '1.0' }).success).toBe(
      false
    )
  })

  it('rejects a link hidden inside a styled group of a v1.0 document', () => {
    // The `children` group recurses into its OWN version's inline union — the
    // reason the schema is built per version rather than shared and extended.
    const nested = {
      version: '1.0',
      variables: [],
      content: [
        {
          type: 'paragraph',
          children: [{ children: [{ type: 'link', target: { docId: DOC_ID }, label: 'x' }] }],
        },
      ],
    }
    expect(DocumentJsonSchema.safeParse(nested).success).toBe(false)
    expect(DocumentJsonSchema.safeParse({ ...nested, version: '1.1' }).success).toBe(true)
  })

  it('accepts links in every inline position — headings, list items, captions', () => {
    const link = { type: 'link', target: { unitId: UNIT_ID }, label: 'Einheit 3' }
    const doc = {
      version: '1.1',
      variables: [],
      content: [
        { type: 'heading', level: 1, children: [link] },
        { type: 'list', ordered: false, items: [[link]] },
        { type: 'formula', latex: 'x', caption: { children: [link] } },
      ],
    }
    expect(DocumentJsonSchema.safeParse(doc).success).toBe(true)
  })

  it('rejects a draft-shaped or malformed target at the boundary', () => {
    expect(DocumentJsonSchema.safeParse(linked({ draftId: DOC_ID })).success).toBe(false)
    expect(DocumentJsonSchema.safeParse(linked({ docId: 'entwurf-7' })).success).toBe(false)
    expect(DocumentJsonSchema.safeParse(linked({ anchorId: 'anc_a' })).success).toBe(false)
    expect(DocumentJsonSchema.safeParse(linked({})).success).toBe(false)
  })

  it('imports a link as a contenteditable=false chip carrying the target', () => {
    const editor = makeEditor()
    importEditorJson(parse(linked({ docId: DOC_ID, anchorId: 'anc_a' })), editor, makeAdapters())
    const chip = editor.querySelector<HTMLElement>('.doc-link')!
    expect(chip.textContent).toBe('Aufgabe 2')
    expect(chip.getAttribute('contenteditable')).toBe('false')
    expect(chip.dataset['linkKind']).toBe('document')
    expect(chip.dataset['linkId']).toBe(DOC_ID)
    expect(chip.dataset['linkAnchorId']).toBe('anc_a')
    editor.remove()
  })

  it('serializes a chip back to one link node, not to its text', () => {
    const editor = makeEditor()
    editor.innerHTML =
      '<p>siehe <span class="doc-link" contenteditable="false" ' +
      `data-link-kind="unit" data-link-id="${UNIT_ID}">Einheit 3</span></p>`
    expect(serializeEditorState(editor, []).content[0]).toEqual({
      type: 'paragraph',
      children: ['siehe ', { type: 'link', target: { unitId: UNIT_ID }, label: 'Einheit 3' }],
    })
    editor.remove()
  })

  it('emits the link keys in the schema’s order — type, target, label', () => {
    const editor = makeEditor()
    editor.innerHTML = `<p><span class="doc-link" data-link-kind="kurs" data-link-id="${KURS_ID}">K</span></p>`
    const block = serializeEditorState(editor, []).content[0] as { children: unknown[] }
    expect(Object.keys(block.children[0] as object)).toEqual(['type', 'target', 'label'])
    editor.remove()
  })

  it('degrades a chip with no usable target to plain text rather than dropping it', () => {
    // An unfollowable node must not enter the JSON — but the sentence still
    // has to read, so the label survives as text.
    const editor = makeEditor()
    editor.innerHTML =
      '<p>vgl. <span class="doc-link" data-link-kind="document" data-link-id="">Aufgabe 2</span></p>'
    expect(serializeEditorState(editor, []).content[0]).toEqual({
      type: 'paragraph',
      children: ['vgl. ', { text: 'Aufgabe 2' }],
    })
    editor.remove()
  })

  it('is byte-stable through export → import → export', () => {
    const editor = makeEditor()
    importEditorJson(
      parse({
        version: '1.1',
        variables: [],
        content: [
          {
            type: 'paragraph',
            children: [
              'siehe ',
              { type: 'link', target: { docId: DOC_ID, anchorId: 'anc_a' }, label: 'Herleitung' },
              ' und ',
              { type: 'link', target: { kursId: KURS_ID }, label: 'den Kurs' },
            ],
          },
          {
            type: 'heading',
            level: 2,
            children: [{ type: 'link', target: { unitId: UNIT_ID }, label: 'Einheit 3' }],
            anchor: { id: 'anc_h', label: 'Verweise' },
          },
        ],
      }),
      editor,
      makeAdapters()
    )
    const j1 = serializeEditorState(editor, [])
    expect(DocumentJsonSchema.safeParse(j1).success).toBe(true)
    expect(JSON.stringify(roundTrip(j1))).toBe(JSON.stringify(j1))
    editor.remove()
  })
})

// ── Sprungmarken of a published document (#72) ──────────────────────────────

describe('collectDocumentAnchors', () => {
  const doc = (content: unknown[]) => parse({ version: '1.1', variables: [], content })

  it('lists the anchors in content order', () => {
    const anchors = collectDocumentAnchors(
      doc([
        { type: 'paragraph', children: ['a'] },
        { type: 'heading', level: 1, children: ['b'], anchor: { id: 'anc_2', label: 'Zwei' } },
        { type: 'formula', latex: 'x', anchor: { id: 'anc_1', label: 'Eins' } },
      ])
    )
    expect(anchors).toEqual([
      { id: 'anc_2', label: 'Zwei' },
      { id: 'anc_1', label: 'Eins' },
    ])
  })

  it('is empty for a document nobody marked', () => {
    expect(collectDocumentAnchors(doc([{ type: 'paragraph', children: ['a'] }]))).toEqual([])
  })

  it('lists a duplicated id once — a picker offering one target twice would lie', () => {
    const anchors = collectDocumentAnchors(
      doc([
        { type: 'paragraph', children: ['a'], anchor: { id: 'anc_1', label: 'Erste' } },
        { type: 'paragraph', children: ['b'], anchor: { id: 'anc_1', label: 'Kopie' } },
      ])
    )
    expect(anchors).toEqual([{ id: 'anc_1', label: 'Erste' }])
  })

  it('reads an upgraded v1.0 snapshot as having none', () => {
    const v10 = parse({
      version: '1.0',
      variables: [],
      content: [{ type: 'paragraph', children: ['a'] }],
    })
    expect(collectDocumentAnchors(v10)).toEqual([])
  })
})
