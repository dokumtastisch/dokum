import { describe, expect, it } from 'vitest'
import {
  LATEST_LESSON_JSON_VERSION,
  LESSON_JSON_VERSIONS,
  LessonJsonSchema,
  emptyLessonJson,
} from './lesson-json'
import { LESSON_EXAMPLE } from './lesson-example'
import { LESSON_JSON_UPGRADES, readLessonJson, upgradeLessonJson } from './lesson-version'

describe('LessonJsonSchema', () => {
  it('accepts the reference page from the design', () => {
    // The load-bearing assertion of this file: if the schema can no longer
    // express the page the design specified, that is a schema bug, not a
    // fixture bug.
    expect(LessonJsonSchema.safeParse(LESSON_EXAMPLE).success).toBe(true)
  })

  it('accepts an empty page', () => {
    expect(LessonJsonSchema.safeParse(emptyLessonJson()).success).toBe(true)
  })

  it('rejects an unknown block type', () => {
    const withUnknownBlock = {
      version: '1.0',
      blocks: [{ type: 'table', rows: [] }],
    }
    expect(LessonJsonSchema.safeParse(withUnknownBlock).success).toBe(false)
  })

  it('rejects unknown keys on a block', () => {
    // strictObject everywhere: a typo'd key is a silent content loss on the
    // next save, so it must fail at the boundary instead.
    const withStrayKey = {
      version: '1.0',
      blocks: [{ type: 'divider', colour: 'red' }],
    }
    expect(LessonJsonSchema.safeParse(withStrayKey).success).toBe(false)
  })

  it('rejects an example nested inside an example', () => {
    // Containers hold leaf blocks only — one level of nesting by construction.
    const nested = {
      version: '1.0',
      blocks: [
        {
          type: 'example',
          label: 'Outer',
          blocks: [{ type: 'example', label: 'Inner', blocks: [] }],
        },
      ],
    }
    expect(LessonJsonSchema.safeParse(nested).success).toBe(false)
  })

  it('rejects a heading above level 2', () => {
    // Level 1 is the page title, which lives in the row, not in the blocks.
    const h1 = { version: '1.0', blocks: [{ type: 'heading', level: 1, content: ['Titel'] }] }
    expect(LessonJsonSchema.safeParse(h1).success).toBe(false)
  })

  it('rejects an unsupported version', () => {
    expect(LessonJsonSchema.safeParse({ version: '9.9', blocks: [] }).success).toBe(false)
  })

  it('requires a label on an example', () => {
    const unlabelled = { version: '1.0', blocks: [{ type: 'example', label: '', blocks: [] }] }
    expect(LessonJsonSchema.safeParse(unlabelled).success).toBe(false)
  })
})

describe('readLessonJson', () => {
  it('returns the page at the newest version', () => {
    const result = readLessonJson(LESSON_EXAMPLE)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.lesson.version).toBe(LATEST_LESSON_JSON_VERSION)
  })

  it('refuses a page with no version, naming the cause', () => {
    const result = readLessonJson({ blocks: [] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Schema-Version')
  })

  it('refuses a version this build does not know, quoting it', () => {
    const result = readLessonJson({ version: '2.0', blocks: [] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('"2.0"')
  })

  it('refuses a structurally broken page without a lesson on the failure branch', () => {
    const result = readLessonJson({ version: '1.0', blocks: 'nope' })
    expect(result.ok).toBe(false)
    // No repair, no partial page — the caller must not be handed something
    // that merely looks complete.
    expect('lesson' in result).toBe(false)
  })

  it('refuses null and primitives rather than throwing', () => {
    for (const raw of [null, undefined, 42, 'x', []]) {
      expect(readLessonJson(raw).ok).toBe(false)
    }
  })
})

describe('the upgrade ladder', () => {
  it('has a step for every supported version', () => {
    // Totality is what makes a half-done version addition fail to compile;
    // this asserts the runtime half of the same guarantee.
    for (const version of LESSON_JSON_VERSIONS) {
      expect(LESSON_JSON_UPGRADES[version]).toBeTypeOf('function')
    }
  })

  it('leaves a newest-version page untouched', () => {
    expect(upgradeLessonJson(LESSON_EXAMPLE)).toEqual(LESSON_EXAMPLE)
  })

  it('does not mutate its input', () => {
    const before = JSON.stringify(LESSON_EXAMPLE)
    upgradeLessonJson(LESSON_EXAMPLE)
    expect(JSON.stringify(LESSON_EXAMPLE)).toBe(before)
  })
})
