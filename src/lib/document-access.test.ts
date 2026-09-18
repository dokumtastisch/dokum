import { describe, expect, it } from 'vitest'
import { isDocumentReadable } from './document-access'
import type { DocumentWithAncestry } from '@/types'

function view(kursPublished: boolean): DocumentWithAncestry {
  return {
    document: {
      id: 'doc-1',
      title: 'Zinsrechnung',
      description: null,
      file_type: 'interactive',
      content: {},
      document_images: [],
    },
    task: { id: 'task-1', title: 'Aufgabe 2' },
    unit: { id: 'unit-1', title: 'Einheit 3' },
    kurs: { id: 'kurs-1', title: 'Mathe I', published: kursPublished },
  }
}

/**
 * The rule these cases pin down is the one app-level access check of the
 * student document surfaces (#69, #70): RLS has already refused the row to
 * anyone without an entitlement — and, since #80, to anyone whose Kurs is
 * archived — so what is left here is that same `published` rule restated in
 * app code, plus the admin bypass /api/file has always had.
 *
 * That makes these cases the ONLY automated statement of the archive rule that
 * `npm test` can run: the policy half lives in the database and is proved by
 * supabase/checks/rls_published_conjunct_check.sql instead. Keep both.
 *
 * It is a predicate over a NULLABLE view on purpose. The full page and the
 * overlay must not be able to tell "no such document" apart from "not yours"
 * or "archived", and folding the missing row in here is what makes the two
 * routes answer identically without either of them re-deriving the rule.
 */
describe('isDocumentReadable', () => {
  it('lets an entitled student read a document in a published Kurs', () => {
    expect(isDocumentReadable(view(true), false)).toBe(true)
  })

  it('keeps an archived Kurs dark for a student', () => {
    // The entitlement is not in question — RLS already granted the row. The
    // archive cutover (#81) relies on exactly this re-check in app code.
    expect(isDocumentReadable(view(false), false)).toBe(false)
  })

  it('lets an admin read a document in an archived Kurs', () => {
    expect(isDocumentReadable(view(false), true)).toBe(true)
  })

  it('refuses a missing or unreadable row, admin or not', () => {
    // `null` is what the DAL returns for an unknown id AND for a row RLS
    // refused. Both must land on the same answer as an archived Kurs, or the
    // 404 starts leaking which documents exist.
    expect(isDocumentReadable(null, false)).toBe(false)
    expect(isDocumentReadable(null, true)).toBe(false)
  })
})
