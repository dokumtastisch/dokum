import { describe, expect, it } from 'vitest'
import { documentViewKind } from './document-view'

/**
 * The rule these cases pin down is the spec's dual-write contract (#63 §3):
 * a published interactive document PREFERS its JSON snapshot and falls back
 * to the stored picture, and every legacy file_type keeps rendering exactly
 * as it does today. Both the Unit accordion and the full-page document route
 * (#69) branch on this one function, so the two surfaces cannot drift.
 */
describe('documentViewKind', () => {
  it('renders a published interactive document from its snapshot', () => {
    expect(documentViewKind({ file_type: 'interactive', content: { version: '1.0' } })).toBe(
      'interactive'
    )
  })

  it('falls back to the picture when an interactive document has no snapshot', () => {
    expect(documentViewKind({ file_type: 'interactive', content: null })).toBe('picture')
    expect(documentViewKind({ file_type: 'interactive', content: undefined })).toBe('picture')
  })

  it('treats a legacy image document as the picture', () => {
    expect(documentViewKind({ file_type: 'image', content: null })).toBe('picture')
  })

  it('ignores a snapshot on a legacy row rather than rendering it live', () => {
    // Defensive: `content` is only ever written together with
    // file_type = 'interactive'. If the two ever disagree, file_type wins —
    // a legacy row must not start rendering through the live path.
    expect(documentViewKind({ file_type: 'image', content: { version: '1.0' } })).toBe('picture')
    expect(documentViewKind({ file_type: 'pdf', content: { version: '1.0' } })).toBe('file')
  })

  it('renders an image collection as its own kind', () => {
    expect(documentViewKind({ file_type: 'image_collection', content: null })).toBe('collection')
  })

  it('renders a PDF as a downloadable file', () => {
    expect(documentViewKind({ file_type: 'pdf', content: null })).toBe('file')
  })

  it('renders a written Lernseite from its JSON (#107)', () => {
    expect(documentViewKind({ file_type: 'lesson', content: { version: '1.0', blocks: [] } })).toBe(
      'lesson'
    )
  })

  it('treats an empty Lernseite as a picture, i.e. as nothing to show yet', () => {
    // A `lesson` row with no content is a page an author created and has not
    // written. There is no PNG behind a lesson, so this lands on the same
    // honest nothing an image-less picture row already renders as.
    expect(documentViewKind({ file_type: 'lesson', content: null })).toBe('picture')
  })
})
