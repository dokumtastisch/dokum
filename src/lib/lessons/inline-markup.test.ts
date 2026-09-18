import { describe, expect, it } from 'vitest'
import type { LessonInline } from './lesson-json'
import { parseInlineMarkup, serializeInlineMarkup } from './inline-markup'
import { LESSON_EXAMPLE } from './lesson-example'

describe('parseInlineMarkup', () => {
  it('leaves plain text as one string node', () => {
    expect(parseInlineMarkup('nur Text')).toEqual(['nur Text'])
  })

  it('reads the three emphasis markers', () => {
    expect(parseInlineMarkup('**fett**')).toEqual([{ text: 'fett', bold: true }])
    expect(parseInlineMarkup('*kursiv*')).toEqual([{ text: 'kursiv', italic: true }])
    expect(parseInlineMarkup('***beides***')).toEqual([
      { text: 'beides', bold: true, italic: true },
    ])
  })

  it('reads an inline formula', () => {
    expect(parseInlineMarkup('vor $E[R_i]$ nach')).toEqual([
      'vor ',
      { type: 'math', latex: 'E[R_i]' },
      ' nach',
    ])
  })

  it('reads a defined term', () => {
    expect(parseInlineMarkup('die [[Rendite|Ertrag pro Kapital]] zählt')).toEqual([
      'die ',
      { type: 'term', label: 'Rendite', definition: 'Ertrag pro Kapital' },
      ' zählt',
    ])
  })

  it('merges adjacent literal characters into a single node', () => {
    const nodes = parseInlineMarkup('a\\$b c')
    expect(nodes).toEqual(['a$b c'])
  })
})

describe('unclosed markers are text, not errors', () => {
  // The rule that protects an author mid-sentence: an opener with no partner
  // must never swallow the rest of the paragraph.
  it('keeps a lone dollar sign', () => {
    expect(parseInlineMarkup('Kosten von $5 pro Stück')).toEqual(['Kosten von $5 pro Stück'])
  })

  it('keeps a lone asterisk', () => {
    expect(parseInlineMarkup('2 * 3 = 6')).toEqual(['2 * 3 = 6'])
  })

  it('keeps an unterminated term', () => {
    expect(parseInlineMarkup('[[halb getippt')).toEqual(['[[halb getippt'])
  })

  it('keeps a term with an empty half', () => {
    expect(parseInlineMarkup('[[|nur Erklärung]]')).toEqual(['[[|nur Erklärung]]'])
    expect(parseInlineMarkup('[[nur Begriff|]]')).toEqual(['[[nur Begriff|]]'])
  })

  it('keeps empty emphasis as the asterisks they are', () => {
    expect(parseInlineMarkup('****')).toEqual(['****'])
  })
})

describe('escaping', () => {
  it('takes an escaped marker literally', () => {
    expect(parseInlineMarkup('\\*kein kursiv\\*')).toEqual(['*kein kursiv*'])
    expect(parseInlineMarkup('\\$100 und \\$200')).toEqual(['$100 und $200'])
  })

  it('does not let an escaped delimiter close a construct', () => {
    expect(parseInlineMarkup('$a \\$ b$')).toEqual([{ type: 'math', latex: 'a $ b' }])
  })

  it('treats a trailing backslash as a literal backslash', () => {
    expect(parseInlineMarkup('Ende\\')).toEqual(['Ende\\'])
  })
})

describe('round-trip', () => {
  /**
   * The load-bearing property of this module: whatever the model can hold must
   * survive being written out and read back, or an author loses content on the
   * second save. LaTeX (backslashes everywhere), prose containing the markers
   * themselves, and terms containing pipes are the cases that break naive
   * escaping, so they are all here.
   */
  const cases: { name: string; nodes: LessonInline[] }[] = [
    { name: 'plain text', nodes: ['ganz gewöhnlich'] },
    { name: 'emphasis', nodes: [{ text: 'fett', bold: true }, ' und ', { text: 'kursiv', italic: true }] },
    { name: 'both styles at once', nodes: [{ text: 'beides', bold: true, italic: true }] },
    {
      name: 'LaTeX full of backslashes',
      nodes: [{ type: 'math', latex: 'E[R_P] = x_1\\,E[R_1] + \\dots' }],
    },
    { name: 'a formula containing a dollar sign', nodes: [{ type: 'math', latex: '\\$100' }] },
    {
      name: 'a term whose definition contains a pipe and a bracket',
      nodes: [{ type: 'term', label: 'a|b', definition: 'x]] y' }],
    },
    { name: 'text containing markers', nodes: ['Preis: $5, Faktor 2 * 3, [[nicht]] ein Begriff'] },
    { name: 'text containing a backslash', nodes: ['Pfad C:\\temp'] },
    {
      name: 'the mixed paragraph from the design',
      nodes: [
        "Each asset's ",
        { type: 'term', label: 'expected return', definition: 'Der Erwartungswert der Rendite.' },
        ' ',
        { type: 'math', latex: 'E[R_i]' },
        ' is scaled by ',
        { text: 'how much', bold: true },
        ' you hold.',
      ],
    },
  ]

  for (const { name, nodes } of cases) {
    it(`survives ${name}`, () => {
      expect(parseInlineMarkup(serializeInlineMarkup(nodes))).toEqual(nodes)
    })
  }

  it('survives every paragraph of the reference page', () => {
    // The design's own prose, run through the loop an author's save performs.
    for (const block of LESSON_EXAMPLE.blocks) {
      const paragraphs =
        block.type === 'example'
          ? block.blocks.filter((b) => b.type === 'paragraph')
          : block.type === 'paragraph'
            ? [block]
            : []
      for (const paragraph of paragraphs) {
        expect(parseInlineMarkup(serializeInlineMarkup(paragraph.content))).toEqual(
          paragraph.content
        )
      }
    }
  })

  it('writes an unstyled run as plain text rather than inventing markers', () => {
    expect(serializeInlineMarkup([{ text: 'schmucklos' }])).toBe('schmucklos')
  })
})
