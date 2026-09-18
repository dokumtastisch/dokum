import { describe, expect, it } from 'vitest'
import type { LatestLessonJson } from './lesson-json'
import { LESSON_EXAMPLE } from './lesson-example'
import {
  LESSON_WORDS_PER_MINUTE,
  formatLessonNumber,
  lessonNumberPath,
  lessonPlainText,
  lessonReadingMinutes,
  lessonWordCount,
  unitNumberPath,
} from './lesson-meta'

function lesson(blocks: LatestLessonJson['blocks']): LatestLessonJson {
  return { version: '1.0', blocks }
}

describe('formatLessonNumber', () => {
  it('renders the tree path as a dotted number', () => {
    expect(formatLessonNumber([3, 3])).toBe('3.3')
    expect(formatLessonNumber([3])).toBe('3')
    expect(formatLessonNumber([3, 3, 1])).toBe('3.3.1')
  })

  it('renders nothing for a page with no position', () => {
    // A draft being written has no place in a tree yet — the header must show
    // no number rather than a stray separator.
    expect(formatLessonNumber([])).toBe('')
  })
})

describe('who carries the number', () => {
  // These four cases are the contract between the Einheit heading, the
  // Lernseite heading and BOTH navigation trees. They all read the same two
  // functions, so a change here is a change everywhere — which is the point.

  it('numbers an Einheit that holds Lernseiten', () => {
    expect(formatLessonNumber(unitNumberPath(1, true))).toBe('1')
  })

  it('leaves a Musterlösungs-Einheit unnumbered', () => {
    // No Lernseiten means no sequence to promise.
    expect(formatLessonNumber(unitNumberPath(1, false))).toBe('')
  })

  it('gives a lone Lernseite no number of its own', () => {
    // The Einheit heading IS that page's title — „1" above „1.1" saying the
    // same thing reads as a mistake.
    expect(formatLessonNumber(lessonNumberPath(1, 0, 1))).toBe('')
  })

  it('numbers Lernseiten from the second one on', () => {
    expect(formatLessonNumber(lessonNumberPath(1, 0, 2))).toBe('1.1')
    expect(formatLessonNumber(lessonNumberPath(3, 2, 4))).toBe('3.3')
  })

  it('numbers nothing when the Einheit has no place in its Kurs', () => {
    // `null` is „not found in the tree" — a missing number beats a wrong one.
    expect(formatLessonNumber(unitNumberPath(null, true))).toBe('')
    expect(formatLessonNumber(lessonNumberPath(null, 1, 3))).toBe('')
  })
})

describe('lessonWordCount', () => {
  it('counts words across paragraphs and headings', () => {
    expect(
      lessonWordCount(
        lesson([
          { type: 'heading', level: 2, content: ['Turning the Formula Around'] },
          { type: 'paragraph', content: ['one two three'] },
        ])
      )
    ).toBe(4 + 3)
  })

  it('counts a formula as one word regardless of its length', () => {
    const short = lesson([{ type: 'formula', latex: 'x' }])
    const long = lesson([
      { type: 'formula', latex: 'E[R_P] = x_1\\,E[R_1] + x_2\\,E[R_2] + \\dots' },
    ])
    expect(lessonWordCount(short)).toBe(1)
    expect(lessonWordCount(long)).toBe(1)
  })

  it('counts an example label plus everything inside it', () => {
    expect(
      lessonWordCount(
        lesson([
          {
            type: 'example',
            icon: '✏️',
            label: 'A two-stock portfolio',
            blocks: [
              { type: 'paragraph', content: ['one two'] },
              { type: 'calculation', latex: 'a = b' },
            ],
          },
        ])
      )
    ).toBe(3 + 2 + 1)
  })

  it('counts styled runs, inline formulas and defined terms', () => {
    expect(
      lessonWordCount(
        lesson([
          {
            type: 'paragraph',
            content: [
              'plain words ',
              { text: 'bold run', bold: true },
              { type: 'math', latex: 'E[R_i]' },
              { type: 'term', label: 'expected return', definition: 'irrelevant here' },
            ],
          },
        ])
      )
    ).toBe(2 + 2 + 1 + 2)
  })

  it('ignores dividers, video placeholders and an example icon', () => {
    expect(
      lessonWordCount(
        lesson([
          { type: 'divider' },
          { type: 'video', title: 'Ein sehr langer Videotitel' },
        ])
      )
    ).toBe(0)
  })
})

describe('lessonReadingMinutes', () => {
  it('derives the reading time from the word count', () => {
    const words = Array.from({ length: LESSON_WORDS_PER_MINUTE * 3 }, () => 'wort').join(' ')
    expect(lessonReadingMinutes(lesson([{ type: 'paragraph', content: [words] }]))).toBe(3)
  })

  it('rounds up — a page is never a fraction of a minute', () => {
    const words = Array.from({ length: LESSON_WORDS_PER_MINUTE + 1 }, () => 'wort').join(' ')
    expect(lessonReadingMinutes(lesson([{ type: 'paragraph', content: [words] }]))).toBe(2)
  })

  it('never reports zero minutes for an empty page', () => {
    expect(lessonReadingMinutes(lesson([]))).toBe(1)
  })

  it("prefers the author's override", () => {
    expect(lessonReadingMinutes({ version: '1.0', readingMinutes: 12, blocks: [] })).toBe(12)
  })
})

describe('lessonPlainText', () => {
  it('joins readable blocks and drops the unreadable ones', () => {
    expect(
      lessonPlainText(
        lesson([
          { type: 'heading', level: 2, content: ['Überschrift'] },
          { type: 'formula', latex: '\\frac{a}{b}' },
          { type: 'divider' },
          { type: 'paragraph', content: ['Ein ', { text: 'wichtiger', bold: true }, ' Satz.'] },
        ])
      )
    ).toBe('Überschrift\n\nEin wichtiger Satz.')
  })

  it('keeps a defined term as its label and leaves LaTeX out entirely', () => {
    const text = lessonPlainText(
      lesson([
        {
          type: 'paragraph',
          content: [
            'Die ',
            { type: 'term', label: 'erwartete Rendite', definition: 'egal' },
            ' ',
            { type: 'math', latex: 'E[R_i]' },
            ' zählt.',
          ],
        },
      ])
    )
    expect(text).toBe('Die erwartete Rendite  zählt.')
    expect(text).not.toContain('E[R_i]')
  })
})

describe('the reference page', () => {
  it('reads as the design describes it', () => {
    expect(LESSON_EXAMPLE.badge).toBe('Core Concept')
    // Every block type the schema knows appears in the reference page — that
    // is what makes it a specification rather than a sample.
    const types = new Set(LESSON_EXAMPLE.blocks.map((b) => b.type))
    expect(types).toEqual(new Set(['paragraph', 'formula', 'example', 'divider', 'heading']))
  })

  it('has a plausible reading time without an override', () => {
    expect(LESSON_EXAMPLE.readingMinutes).toBeUndefined()
    expect(lessonReadingMinutes(LESSON_EXAMPLE)).toBeGreaterThan(0)
  })
})
