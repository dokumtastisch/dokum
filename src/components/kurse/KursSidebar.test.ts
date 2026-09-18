import { describe, expect, it } from 'vitest'
import type { KursNavDocument, KursNavTask } from '@/types'
import { splitSidebarContents } from './KursSidebar'

function document(id: string, file_type: KursNavDocument['file_type']): KursNavDocument {
  return { id, title: id, file_type }
}

function task(id: string, documents: KursNavDocument[]): KursNavTask {
  return { id, title: id, documents }
}

describe('splitSidebarContents', () => {
  it('shows Lernseiten directly and removes their hidden carrier task', () => {
    const result = splitSidebarContents([
      task('lesson-task', [document('TestAlgebra', 'lesson')]),
    ])

    expect(result.lessons.map((lesson) => lesson.id)).toEqual(['TestAlgebra'])
    expect(result.tasks).toEqual([])
  })

  it('keeps ordinary documents in their task while flattening Lernseiten', () => {
    const result = splitSidebarContents([
      task('mixed', [document('page', 'lesson'), document('sheet', 'pdf')]),
    ])

    expect(result.lessons.map((lesson) => lesson.id)).toEqual(['page'])
    expect(result.tasks[0].documents.map((item) => item.id)).toEqual(['sheet'])
  })
})
