// @vitest-environment jsdom
/**
 * document-render tests (#67).
 *
 * Behavioural: given a published snapshot, what does the STUDENT get? Not
 * which helper ran, not the internal call order — what is on screen, what is
 * selectable, what is resolved, and what editor affordances are provably
 * absent.
 *
 * Runs in jsdom, in the style of the document-json suite: the renderer builds
 * real DOM and stays MathJax-free, so the formula assertions check the
 * resolved LaTeX handed to MathJax rather than its SVG output.
 */

import { describe, expect, it } from 'vitest'
import type { LatestEditorDocumentJson } from './document-json'
import { renderDocumentJson, type DocumentRenderAdapters } from './document-render'
import { linkTargetAnchorId, linkTargetId, type LinkTarget } from './links'

const IMG_ID = '44444444-4444-4444-8444-444444444444'

/**
 * The two things the renderer refuses to know by itself. Both are stubs on
 * purpose: a URL that looks nothing like the app's proves the chip is pointed
 * by the caller rather than by a route baked into the renderer.
 */
const ADAPTERS: DocumentRenderAdapters = {
  imageUrl: (id) => `/api/image/${id}`,
  linkHref: (target) => {
    const anchor = linkTargetAnchorId(target)
    return `/ziel/${linkTargetId(target)}` + (anchor ? `#${anchor}` : '')
  },
}

function mount(): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  return host
}

function render(doc: LatestEditorDocumentJson, host = mount()) {
  const result = renderDocumentJson(doc, host, ADAPTERS)
  return { host, result }
}

/** A document exercising every v1.1 block type plus the field graph. */
const DOC: LatestEditorDocumentJson = {
  version: '1.1',
  variables: [
    { id: 'v_rev', type: 'input', name: 'Revenue', refType: 'static', value: 1200 },
    { id: 'v_mar', type: 'input', name: 'Margin', refType: 'static', value: 0.2534 },
    { id: 'v_ebit', type: 'output', name: 'EBIT', expr: 'Revenue * Margin' },
  ],
  content: [
    { type: 'heading', level: 1, children: [{ text: 'Bewertung' }] },
    {
      type: 'paragraph',
      children: [{ text: 'Umsatz: ' }, { fieldId: 'v_rev' }, { text: ' | Marge: ' }, { fieldId: 'v_mar' }],
    },
    { type: 'formula', latex: 'EBIT = [input:Revenue] \\cdot [input:Margin]' },
    { type: 'paragraph', children: [{ text: 'Ergebnis: ' }, { fieldId: 'v_ebit' }] },
    { type: 'list', ordered: false, items: [[{ text: 'Punkt A' }], [{ text: 'Punkt B' }]] },
    { type: 'code', text: 'x^2' },
    { type: 'image', imageId: IMG_ID, alt: 'Diagramm' },
  ],
  library: [],
}

// ── Content renders as real content ─────────────────────────────────────────

describe('renderDocumentJson — structure', () => {
  it('renders each block type as its own element', () => {
    const { host } = render(DOC)
    expect(host.querySelector('h1')?.textContent).toBe('Bewertung')
    expect(host.querySelectorAll('p').length).toBe(2)
    expect(host.querySelectorAll('ul li').length).toBe(2)
    expect(host.querySelector('pre')?.textContent).toBe('x^2')
    expect(host.querySelector('.formula-block')).not.toBeNull()
    expect(host.querySelector('.image-block')).not.toBeNull()
  })

  it('produces real selectable text, not an image of text', () => {
    const { host } = render(DOC)
    // The words a student would want to copy are present as text nodes.
    expect(host.textContent).toContain('Bewertung')
    expect(host.textContent).toContain('Umsatz:')
    expect(host.textContent).toContain('Punkt A')
    expect(host.querySelectorAll('img[data-image-id]').length).toBe(1)
  })

  it('resolves images through the injected entitlement-gated route', () => {
    const { host } = render(DOC)
    const img = host.querySelector<HTMLImageElement>('img[data-image-id]')
    expect(img?.getAttribute('src')).toBe(`/api/image/${IMG_ID}`)
    expect(img?.getAttribute('alt')).toBe('Diagramm')
  })

  it('replaces previous content when the same container is rendered again', () => {
    const { host } = render(DOC)
    render(DOC, host)
    expect(host.querySelectorAll('h1').length).toBe(1)
    expect(host.querySelectorAll('.image-block').length).toBe(1)
  })
})

// ── No editor affordances reach the student ─────────────────────────────────

describe('renderDocumentJson — editor chrome is stripped', () => {
  it('carries no drag handles, delete buttons or draggable blocks', () => {
    const { host } = render(DOC)
    expect(host.querySelector('.drag-handle')).toBeNull()
    expect(host.querySelector('.img-remove')).toBeNull()
    expect(host.querySelector('[draggable]')).toBeNull()
  })

  it('leaves nothing contenteditable — the document text is fixed', () => {
    const doc: LatestEditorDocumentJson = {
      ...DOC,
      content: [{ type: 'formula', latex: 'a+b', caption: 'Eine Bildunterschrift' }],
    }
    const { host } = render(doc)
    expect(host.querySelector('[contenteditable]')).toBeNull()
    // The caption still renders — only its editability is gone.
    expect(host.textContent).toContain('Eine Bildunterschrift')
  })
})

// ── Computed values ─────────────────────────────────────────────────────────

describe('renderDocumentJson — field values', () => {
  it('shows a static input’s own value', () => {
    const { host } = render(DOC)
    // Since #68 a static input IS the student's editable control, so its value
    // lives on the control rather than in a text node.
    const rev = host.querySelector<HTMLInputElement>('input.input-field[data-field-id="v_rev"]')
    expect(rev?.value).toBe('1200')
  })

  it('shows an output’s computed value, German-formatted', () => {
    const { host } = render(DOC)
    const ebit = host.querySelector('.output-field[data-field-id="v_ebit"]')
    expect(ebit?.textContent).toBe('304,08')
  })

  it('marks a non-resolvable output as an error rather than blank', () => {
    const doc: LatestEditorDocumentJson = {
      version: '1.1',
      variables: [{ id: 'v_bad', type: 'output', name: 'Kaputt', expr: 'Unbekannt * 2' }],
      content: [{ type: 'paragraph', children: [{ fieldId: 'v_bad' }] }],
      library: [],
    }
    const { host } = render(doc)
    const field = host.querySelector('.output-field[data-field-id="v_bad"]')
    expect(field?.textContent).toBe('Err')
    expect(field?.classList.contains('is-error')).toBe(true)
  })

  it('resolves a reference input to the value it points at', () => {
    const doc: LatestEditorDocumentJson = {
      version: '1.1',
      variables: [
        { id: 'v_a', type: 'input', name: 'A', refType: 'static', value: 2500 },
        { id: 'v_out', type: 'output', name: 'Doppelt', expr: 'A * 2' },
        { id: 'v_clone', type: 'input', refType: 'ref', refId: 'v_out', referenceClone: true },
      ],
      content: [{ type: 'paragraph', children: [{ fieldId: 'v_clone' }] }],
      library: [],
    }
    const { host } = render(doc)
    expect(host.querySelector('.input-field[data-field-id="v_clone"]')?.textContent).toBe('5 000')
  })
})

// ── Formulas ────────────────────────────────────────────────────────────────

describe('renderDocumentJson — formulas', () => {
  it('returns a render target per formula, in document order', () => {
    const doc: LatestEditorDocumentJson = {
      version: '1.1',
      variables: [],
      content: [
        { type: 'formula', latex: 'a+b' },
        { type: 'paragraph', children: [{ text: 'dazwischen' }] },
        { type: 'formula', latex: 'c+d' },
      ],
      library: [],
    }
    const { result } = render(doc)
    expect(result.renderTargets.map((t) => t.dataset['rawLatex'])).toEqual(['a+b', 'c+d'])
  })

  it('hands MathJax the RESOLVED latex and keeps the raw source alongside', () => {
    const { result } = render(DOC)
    const target = result.renderTargets[0]
    expect(target?.dataset['rawLatex']).toBe('EBIT = [input:Revenue] \\cdot [input:Margin]')
    // Placeholders become German-formatted display values (reference parity).
    expect(target?.dataset['latex']).toContain('1 200')
    expect(target?.dataset['latex']).toContain('0,2534')
    expect(target?.dataset['latex']).not.toContain('[input:')
  })

  it('leaves an unknown placeholder name visible rather than silently blank', () => {
    const doc: LatestEditorDocumentJson = {
      version: '1.1',
      variables: [],
      content: [{ type: 'formula', latex: 'x = [input:GibtEsNicht]' }],
      library: [],
    }
    const { result } = render(doc)
    expect(result.renderTargets[0]?.dataset['latex']).toContain('[input:GibtEsNicht]')
  })
})

// ── Purity ──────────────────────────────────────────────────────────────────

describe('renderDocumentJson — purity', () => {
  it('does not mutate the snapshot it renders', () => {
    const before = JSON.stringify(DOC)
    render(DOC)
    expect(JSON.stringify(DOC)).toBe(before)
  })

  it('renders into the container it is given and nowhere else', () => {
    const other = mount()
    const { host } = render(DOC)
    expect(host.childNodes.length).toBeGreaterThan(0)
    expect(other.childNodes.length).toBe(0)
  })
})

// ── Student-editable inputs (#68) ───────────────────────────────────────────

/**
 * A worked example of the kind #68 exists for: a capital sum and an interest
 * rate the student may move, an output derived from both, a chained output
 * derived from that one, a reference pill reading the first output, a formula
 * whose placeholders quote the inputs, and a second clone of one input to
 * prove clones stay in step.
 */
const WORKED_EXAMPLE: LatestEditorDocumentJson = {
  version: '1.1',
  variables: [
    { id: 'v_kap', type: 'input', name: 'Kapital', refType: 'static', value: 1000 },
    { id: 'v_zins', type: 'input', name: 'Zins', refType: 'static', value: 5 },
    { id: 'v_ertrag', type: 'output', name: 'Ertrag', expr: 'Kapital * Zins / 100' },
    { id: 'v_gesamt', type: 'output', name: 'Gesamt', expr: 'Kapital + Ertrag' },
    { id: 'v_ref', type: 'input', refType: 'ref', refId: 'v_ertrag', referenceClone: true },
  ],
  content: [
    {
      type: 'paragraph',
      children: [
        { text: 'Kapital: ' },
        { fieldId: 'v_kap' },
        { text: ' zu ' },
        { fieldId: 'v_zins' },
        { text: ' %' },
      ],
    },
    { type: 'formula', latex: 'E = [input:Kapital] \\cdot [input:Zins] / 100' },
    {
      type: 'paragraph',
      children: [
        { text: 'Ertrag: ' },
        { fieldId: 'v_ertrag' },
        { text: ' — Referenz: ' },
        { fieldId: 'v_ref' },
      ],
    },
    {
      type: 'paragraph',
      children: [
        { text: 'Gesamt: ' },
        { fieldId: 'v_gesamt' },
        { text: ' bei erneut ' },
        { fieldId: 'v_kap' },
      ],
    },
  ],
  library: [],
}

function inputsFor(host: HTMLElement, fieldId: string): HTMLInputElement[] {
  return Array.from(host.querySelectorAll<HTMLInputElement>(`input[data-field-id="${fieldId}"]`))
}

function pillText(host: HTMLElement, fieldId: string): string {
  return host.querySelector(`.output-field[data-field-id="${fieldId}"]`)?.textContent ?? ''
}

/** Types `value` into a control the way a student would. */
function type(input: HTMLInputElement, value: string): void {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Everything the student can see resolved, for whole-document comparisons. */
function visibleState(host: HTMLElement): string[] {
  const fields = Array.from(
    host.querySelectorAll<HTMLElement>('.input-field, .output-field')
  ).map((el) => {
    const shown = el.tagName === 'INPUT' ? (el as HTMLInputElement).value : el.textContent
    return `${el.dataset['fieldId']}=${shown}`
  })
  const latex = Array.from(host.querySelectorAll<HTMLElement>('.render-target')).map(
    (el) => `latex:${el.dataset['latex']}`
  )
  return [...fields, ...latex]
}

describe('renderDocumentJson — which parts a student may touch', () => {
  it('gives every visible static input an editable control', () => {
    const { host } = render(WORKED_EXAMPLE)
    expect(inputsFor(host, 'v_kap').length).toBe(2) // both clones
    expect(inputsFor(host, 'v_zins').length).toBe(1)
    for (const input of inputsFor(host, 'v_kap')) {
      expect(input.disabled).toBe(false)
      expect(input.readOnly).toBe(false)
    }
  })

  it('marks the editable controls so they stand out from static text', () => {
    const { host } = render(WORKED_EXAMPLE)
    const kap = inputsFor(host, 'v_kap')[0]
    expect(kap?.classList.contains('student-input')).toBe(true)
    expect(kap?.classList.contains('input-field')).toBe(true)
  })

  it('offers a numeric keyboard and a name a screen reader can announce', () => {
    const { host } = render(WORKED_EXAMPLE)
    const kap = inputsFor(host, 'v_kap')[0]
    expect(kap?.getAttribute('inputmode')).toBe('decimal')
    // Free text, not type=number: parseFloat semantics and no spinner.
    expect(kap?.getAttribute('type')).toBe('text')
    expect(kap?.getAttribute('aria-label')).toContain('Kapital')
  })

  it('leaves outputs and reference inputs read-only', () => {
    const { host } = render(WORKED_EXAMPLE)
    expect(inputsFor(host, 'v_ertrag').length).toBe(0)
    expect(inputsFor(host, 'v_gesamt').length).toBe(0)
    expect(inputsFor(host, 'v_ref').length).toBe(0)
    expect(host.querySelector('.input-field[data-field-id="v_ref"]')?.tagName).toBe('SPAN')
  })

  it('leaves the document text and structure read-only', () => {
    const { host } = render(WORKED_EXAMPLE)
    expect(host.querySelector('[contenteditable]')).toBeNull()
    // The only editable nodes in the whole document are the input controls.
    const editable = Array.from(host.querySelectorAll('input, textarea, [contenteditable="true"]'))
    expect(editable.every((el) => el.classList.contains('student-input'))).toBe(true)
  })

  it('does not turn the invisible field masters into controls', () => {
    const { host } = render(WORKED_EXAMPLE)
    const store = host.querySelector('[id="hiddenFields"]')
    expect(store?.querySelector('input')).toBeNull()
  })
})

describe('renderDocumentJson — live recompute', () => {
  it('recomputes every dependent output when the student changes an input', () => {
    const { host } = render(WORKED_EXAMPLE)
    expect(pillText(host, 'v_ertrag')).toBe('50')
    expect(pillText(host, 'v_gesamt')).toBe('1 050')

    const kap = inputsFor(host, 'v_kap')[0]!
    type(kap, '2000')

    expect(pillText(host, 'v_ertrag')).toBe('100')
    // Chained: Gesamt depends on Kapital *and* on the recomputed Ertrag.
    expect(pillText(host, 'v_gesamt')).toBe('2 100')
  })

  it('recomputes reference pills that read a changed output', () => {
    const { host } = render(WORKED_EXAMPLE)
    expect(host.querySelector('[data-field-id="v_ref"]')?.textContent).toBe('50')
    type(inputsFor(host, 'v_zins')[0]!, '10')
    expect(host.querySelector('[data-field-id="v_ref"]')?.textContent).toBe('100')
  })

  it('re-resolves formula placeholders and reports only the formulas that changed', () => {
    const changed: HTMLElement[][] = []
    const host = mount()
    const { renderTargets } = renderDocumentJson(WORKED_EXAMPLE, host, {
      ...ADAPTERS,
      onRecompute: (targets) => changed.push(targets),
    })
    expect(renderTargets[0]?.dataset['latex']).toContain('1 000')

    type(inputsFor(host, 'v_kap')[0]!, '2000')

    expect(renderTargets[0]?.dataset['latex']).toContain('2 000')
    expect(changed.length).toBe(1)
    expect(changed[0]?.length).toBe(1)
    expect(changed[0]?.[0]).toBe(renderTargets[0])
  })

  it('reports no formula when the edit changes nothing a formula quotes', () => {
    const doc: LatestEditorDocumentJson = {
      ...WORKED_EXAMPLE,
      variables: [
        ...WORKED_EXAMPLE.variables,
        { id: 'v_unbeteiligt', type: 'input', name: 'Egal', refType: 'static', value: 1 },
      ],
      content: [
        ...WORKED_EXAMPLE.content,
        { type: 'paragraph', children: [{ text: 'Egal: ' }, { fieldId: 'v_unbeteiligt' }] },
      ],
    }
    const changed: HTMLElement[][] = []
    const host = mount()
    renderDocumentJson(doc, host, {
      ...ADAPTERS,
      onRecompute: (targets) => changed.push(targets),
    })
    type(inputsFor(host, 'v_unbeteiligt')[0]!, '7')
    expect(changed.length).toBe(1)
    expect(changed[0]).toEqual([])
  })

  it('keeps every clone of the edited variable in step', () => {
    const { host } = render(WORKED_EXAMPLE)
    const [first, second] = inputsFor(host, 'v_kap')
    type(first!, '2000')
    expect(second?.value).toBe('2000')
    // The invisible master is what the resolver reads — it must move too.
    const master = host.querySelector<HTMLElement>('[id="hiddenFields"] [data-field-id="v_kap"]')
    expect(master?.dataset['value']).toBe('2000')
  })

  it('lands on exactly the document a fresh render of that value would produce', () => {
    const edited = mount()
    render(WORKED_EXAMPLE, edited)
    type(inputsFor(edited, 'v_kap')[0]!, '2500')

    const fresh = mount()
    render(
      {
        ...WORKED_EXAMPLE,
        variables: WORKED_EXAMPLE.variables.map((v) =>
          v.id === 'v_kap' ? { ...v, value: 2500 } : v
        ),
      },
      fresh
    )

    expect(visibleState(edited)).toEqual(visibleState(fresh))
  })

  it('survives unparseable input by the existing resolution rules, and recovers', () => {
    const { host } = render(WORKED_EXAMPLE)
    expect(() => type(inputsFor(host, 'v_kap')[0]!, 'keine Zahl')).not.toThrow()
    // Not „Err": an unresolvable name substitutes as (0) inside an expression,
    // which is the resolver's documented behaviour and stays untouched here.
    expect(pillText(host, 'v_ertrag')).toBe('0')
    type(inputsFor(host, 'v_kap')[0]!, '1000')
    expect(pillText(host, 'v_ertrag')).toBe('50')
  })

  it('shows the existing „Err" display when a recompute makes an output non-finite', () => {
    const doc: LatestEditorDocumentJson = {
      version: '1.1',
      variables: [
        { id: 'v_n', type: 'input', name: 'Teiler', refType: 'static', value: 4 },
        { id: 'v_q', type: 'output', name: 'Quotient', expr: '100 / Teiler' },
      ],
      content: [
        { type: 'paragraph', children: [{ fieldId: 'v_n' }, { text: ' → ' }, { fieldId: 'v_q' }] },
      ],
      library: [],
    }
    const { host } = render(doc)
    expect(pillText(host, 'v_q')).toBe('25')

    type(inputsFor(host, 'v_n')[0]!, '0')
    expect(pillText(host, 'v_q')).toBe('Err')
    expect(host.querySelector('[data-field-id="v_q"]')?.classList.contains('is-error')).toBe(true)

    type(inputsFor(host, 'v_n')[0]!, '5')
    expect(pillText(host, 'v_q')).toBe('20')
    expect(host.querySelector('[data-field-id="v_q"]')?.classList.contains('is-error')).toBe(false)
  })

  it('reads a decimal comma the German way', () => {
    const { host } = render(WORKED_EXAMPLE)
    type(inputsFor(host, 'v_zins')[0]!, '7,5')
    expect(pillText(host, 'v_ertrag')).toBe('75')
  })

  it('reads back what a student copies out of the document', () => {
    // Every number the document shows is space-grouped with a decimal comma;
    // pasting one back in must mean what it says.
    const { host } = render(WORKED_EXAMPLE)
    type(inputsFor(host, 'v_kap')[0]!, '1 234,5')
    expect(pillText(host, 'v_ertrag')).toBe('61,73') // 1234.5 · 5 / 100
  })

  it('shows the value back in German, losslessly', () => {
    const { host } = render(WORKED_EXAMPLE)
    const zins = inputsFor(host, 'v_zins')[0]!
    type(zins, '7,5')
    // A refresh the student did not cause must not turn their comma into a
    // point — nor round it, which formatValue would.
    type(inputsFor(host, 'v_kap')[0]!, '1234.5678')
    expect(zins.value).toBe('7,5')
    expect(inputsFor(host, 'v_kap')[1]?.value).toBe('1234,5678')
  })

  it('marks a control the student has made unreadable, and clears the mark', () => {
    const { host } = render(WORKED_EXAMPLE)
    const kap = inputsFor(host, 'v_kap')[0]!
    type(kap, 'keine Zahl')
    expect(kap.classList.contains('is-error')).toBe(true)
    expect(kap.getAttribute('aria-invalid')).toBe('true')

    type(kap, '12')
    expect(kap.classList.contains('is-error')).toBe(false)
    expect(kap.getAttribute('aria-invalid')).toBeNull()
  })

  it('does not call an empty box a mistake — it is a box mid-edit', () => {
    const { host } = render(WORKED_EXAMPLE)
    const kap = inputsFor(host, 'v_kap')[0]!
    kap.focus()
    type(kap, '')
    expect(kap.classList.contains('is-error')).toBe(false)
  })

  it('settles an emptied box on the value the document is computing with', () => {
    const { host } = render(WORKED_EXAMPLE)
    const kap = inputsFor(host, 'v_kap')[0]!
    kap.focus()
    type(kap, '')
    kap.blur()
    // Leaving it empty would show nothing while every dependent value reads 0.
    expect(kap.value).toBe('0')
    expect(pillText(host, 'v_ertrag')).toBe('0')
  })

  it('settles the STORED value too, so the formulas agree with the box', () => {
    const { host } = render(WORKED_EXAMPLE)
    const kap = inputsFor(host, 'v_kap')[0]!
    kap.focus()
    type(kap, '')
    kap.blur()
    // A settled box shows „0"; an empty STORED value is unparseable and would
    // resolve to \text{Err} in the formula quoting it — the box and the
    // document contradicting each other on the same screen.
    expect(kap.dataset['value']).toBe('0')
    expect(host.querySelector<HTMLElement>('.render-target')?.dataset['latex']).not.toContain('Err')
    // And it lands where typing the same value by hand lands.
    const { host: typed } = render(WORKED_EXAMPLE)
    type(inputsFor(typed, 'v_kap')[0]!, '0')
    expect(visibleState(host)).toEqual(visibleState(typed))
  })

  it('leaves an already-settled box untouched on blur', () => {
    const changed: HTMLElement[][] = []
    const host = mount()
    renderDocumentJson(WORKED_EXAMPLE, host, {
      ...ADAPTERS,
      onRecompute: (targets) => changed.push(targets),
    })
    const kap = inputsFor(host, 'v_kap')[0]!
    kap.focus()
    type(kap, '2000')
    const afterTyping = changed.length
    kap.blur()
    // Nothing to reconcile, so no second resolution pass and no re-typeset.
    expect(changed.length).toBe(afterTyping)
    expect(kap.value).toBe('2000')
  })

  it('does not overwrite what the student is still typing', () => {
    const { host } = render(WORKED_EXAMPLE)
    const kap = inputsFor(host, 'v_kap')[0]!
    kap.focus()
    type(kap, '') // mid-edit: the box is momentarily empty
    expect(kap.value).toBe('')
    // The clone the student is NOT in falls back to the resolved display.
    expect(inputsFor(host, 'v_kap')[1]?.value).toBe('0')
  })

  it('does not mutate the snapshot when the student edits', () => {
    const before = JSON.stringify(WORKED_EXAMPLE)
    const { host } = render(WORKED_EXAMPLE)
    type(inputsFor(host, 'v_kap')[0]!, '9999')
    expect(JSON.stringify(WORKED_EXAMPLE)).toBe(before)
  })
})

// ── Link chips (#73) ────────────────────────────────────────────────────────

const KURS_ID = '11111111-1111-4111-8111-111111111111'
const UNIT_ID = '22222222-2222-4222-8222-222222222222'
const DOC_ID = '33333333-3333-4333-8333-333333333333'

/** One link inside a sentence, which is the only place a link ever sits. */
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

function chipIn(host: HTMLElement): HTMLAnchorElement {
  const chip = host.querySelector<HTMLAnchorElement>('a.doc-link')
  if (!chip) throw new Error('no link chip rendered')
  return chip
}

/** A click the way a student makes it, or with a modifier held. */
function click(el: HTMLElement, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init })
  el.dispatchEvent(event)
  return event
}

describe('renderDocumentJson — link chips', () => {
  it('renders a link as a labelled chip inside its sentence', () => {
    const { host } = render(withLink({ docId: DOC_ID }))
    expect(chipIn(host).textContent).toBe('Kapitel 3')
    // The sentence still reads around it — a chip is a word, not a block.
    expect(host.querySelector('p')?.textContent).toBe('Siehe Kapitel 3 dazu.')
  })

  it('points the chip wherever the caller resolves the target', () => {
    const { host } = render(withLink({ unitId: UNIT_ID }))
    expect(chipIn(host).getAttribute('href')).toBe(`/ziel/${UNIT_ID}`)
  })

  it('shows what kind of thing it points at, without putting it in the text', () => {
    // The glyph is CSS chrome drawn from an attribute: it must not land in the
    // text a student selects and copies out of the document.
    const seen = new Set<string>()
    for (const target of [
      { kursId: KURS_ID },
      { unitId: UNIT_ID },
      { docId: DOC_ID },
      { docId: DOC_ID, anchorId: 'anc_1' },
    ] as const) {
      const chip = chipIn(render(withLink(target)).host)
      const icon = chip.dataset['linkIcon'] ?? ''
      expect(icon).not.toBe('')
      expect(chip.textContent).toBe('Kapitel 3')
      seen.add(icon)
    }
    expect(seen.size).toBe(4)
  })

  it('names the target kind for a screen reader, which gets no glyph', () => {
    expect(chipIn(render(withLink({ kursId: KURS_ID })).host).getAttribute('aria-label')).toBe(
      'Kapitel 3 – Kurs'
    )
    expect(
      chipIn(render(withLink({ docId: DOC_ID, anchorId: 'anc_1' })).host).getAttribute('aria-label')
    ).toBe('Kapitel 3 – Sprungmarke')
  })

  it('is reachable and activatable from the keyboard', () => {
    const { host } = render(withLink({ docId: DOC_ID }))
    const chip = chipIn(host)
    // A real anchor with a real href: focus, Enter and „open in new tab" all
    // come from the platform rather than from a key handler of ours.
    expect(chip.tagName).toBe('A')
    expect(chip.hasAttribute('href')).toBe(true)
    chip.focus()
    expect(document.activeElement).toBe(chip)
  })

  it('carries no hover behaviour at all — touch and desktop are identical', () => {
    const { host } = render(withLink({ docId: DOC_ID }))
    const chip = chipIn(host)
    // A `title` would be a tooltip, which is exactly the dropped peek.
    expect(chip.hasAttribute('title')).toBe(false)
    expect(chip.getAttribute('target')).toBeNull()
  })

  it('follows a plain click through the app instead of reloading the page', () => {
    const followed: Array<[LinkTarget, string]> = []
    const host = mount()
    renderDocumentJson(withLink({ docId: DOC_ID, anchorId: 'anc_1' }), host, {
      ...ADAPTERS,
      followLink: (target, href) => followed.push([target, href]),
    })
    const chip = chipIn(host)
    const event = click(chip)
    // Followed to exactly where the chip says it goes — resolving the target a
    // second time is how a click and its own href drift apart.
    expect(followed).toEqual([[{ docId: DOC_ID, anchorId: 'anc_1' }, chip.getAttribute('href')]])
    // Prevented, or the browser would navigate as well and unmount the page
    // holding everything the student typed.
    expect(event.defaultPrevented).toBe(true)
  })

  it('leaves a modified or middle click to the browser', () => {
    const followed: LinkTarget[] = []
    const host = mount()
    renderDocumentJson(withLink({ docId: DOC_ID }), host, {
      ...ADAPTERS,
      followLink: (target) => followed.push(target),
    })
    const chip = chipIn(host)
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) {
      expect(click(chip, init).defaultPrevented).toBe(false)
    }
    expect(followed).toEqual([])
  })

  it('still navigates when nobody is listening — a chip is never dead', () => {
    const { host } = render(withLink({ docId: DOC_ID }))
    // No `followLink`: the anchor's own href takes over, which is a worse
    // navigation (the source page unmounts) but never a broken one.
    expect(click(chipIn(host)).defaultPrevented).toBe(false)
    expect(chipIn(host).getAttribute('href')).toBe(`/ziel/${DOC_ID}`)
  })

  it('leaves a document without links exactly as it was', () => {
    const { host, result } = render(DOC)
    expect(host.querySelector('.doc-link')).toBeNull()
    expect(host.querySelector('a')).toBeNull()
    expect(result.links).toEqual([])
  })

  it('reports every chip it built, with the link it carries (#74)', () => {
    // The same contract `renderTargets` has: whether a target is still
    // REACHABLE is a server question this module refuses to ask, exactly as it
    // refuses to typeset — so it hands the elements back and the caller
    // resolves them.
    const target = { docId: DOC_ID, anchorId: 'anc_1' }
    const { host, result } = render(withLink(target))
    expect(result.links).toEqual([{ target, label: 'Kapitel 3', anchor: chipIn(host) }])
  })
})
